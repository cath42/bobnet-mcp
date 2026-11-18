import type { ServerFrame } from "@bobnet/protocol";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { agent, Client, errorCode, laptopToken } from "./helpers.ts";

// What the supervisors' FakeNetwork copies from the broker (ADR 0007, Consequences "Testing";
// packages/supervisor/test/network.ts): pinned here on the real broker, between two laptops'
// supervisors, so the fake can't drift from it. One test per behaviour, each named as the fake's is.

type Deliver = Extract<ServerFrame, { t: "deliver" }>;
type Presence = Extract<ServerFrame, { t: "presence" }>;
const isDeliver = (f: ServerFrame): f is Deliver => f.t === "deliver";
const left = (name: string) => (f: ServerFrame): f is Presence => f.t === "presence" && f.event === "left" && f.peer.name === name;

const network = () => env.BROKER.getByName("network");

/** Moves stored messages' clock columns: workerd's clock can't be advanced, so the rows are. */
async function setMessage(id: string, set: { expires_at?: string; created_at?: string }): Promise<void> {
  await runInDurableObject(network(), (_obj, state) => {
    if (set.expires_at) state.storage.sql.exec("UPDATE messages SET expires_at = ? WHERE id = ?", set.expires_at, id);
    if (set.created_at) state.storage.sql.exec("UPDATE messages SET created_at = ? WHERE id = ?", set.created_at, id);
  });
}

const PAST = "2000-01-01T00:00:00.000Z";

/** ubu1's supervisor on laptop 2, gone: what is sent to it waits. */
async function offlineTarget(requester: Client): Promise<void> {
  const target = await agent(2, "supervisor");
  target.close();
  await requester.next(left("supervisor"));
}

describe("what the FakeNetwork copies (ADR 0007 Testing)", () => {
  it("says who got a message now and who it is queued for", async () => {
    const mbp = await agent(1, "supervisor");
    const ubu = await agent(2, "supervisor");
    await agent(2, "Ann").then((c) => c.close());
    await mbp.next(left("Ann"));

    const r = await mbp.request({ t: "send", as: "supervisor", to: ["supervisor@mbp-2", "Ann@mbp-2"], body: "{}" });
    expect(r).toMatchObject({ delivered_to: ["supervisor@mbp-2"], queued_for: ["Ann@mbp-2"] });
    expect((await ubu.next(isDeliver)).msg.id).toBe(r.id);
  });

  it("drops an undelivered message once its ttl_seconds pass, even before the sweep", async () => {
    const mbp = await agent(1, "supervisor");
    await offlineTarget(mbp);
    const r = await mbp.request({ t: "send", as: "supervisor", to: ["supervisor@mbp-2"], body: `{"v":2,"op":"list"}`, ttl_seconds: 20 });
    await runInDurableObject(network(), (_obj, state) => {
      const row = state.storage.sql.exec<{ created_at: string; expires_at: string }>("SELECT created_at, expires_at FROM messages WHERE id = ?", r.id).one();
      expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(20_000);
    });
    await setMessage(r.id, { expires_at: PAST });

    const back = await Client.open(await laptopToken(2));
    expect(await back.request({ t: "register", name: "supervisor" })).toMatchObject({ queued: 0 });
    expect(await back.never(isDeliver)).toBe(true);
  });

  it("refuses an in_reply_to to a message the sweep has dropped, and only then", async () => {
    const mbp = await agent(1, "supervisor");
    const ubu = await agent(2, "supervisor");
    const req = await mbp.request({ t: "send", as: "supervisor", to: ["supervisor@mbp-2"], body: `{"v":2,"op":"list"}`, ttl_seconds: 20 });
    await setMessage(req.id, { expires_at: PAST });

    // Expired but not yet swept: the reply still threads.
    const first = await ubu.request({ t: "send", as: "supervisor", to: ["supervisor@mbp-1"], body: `{"v":2,"re":"list","req":"${req.id}","ok":true}`, in_reply_to: req.id });
    expect(first.id).toMatch(/^m_/);

    expect(await runDurableObjectAlarm(network())).toBe(true);
    const body = `{"v":2,"re":"list","req":"${req.id}","ok":true,"workers":[]}`;
    expect(await errorCode(ubu.request({ t: "send", as: "supervisor", to: ["supervisor@mbp-1"], body, in_reply_to: req.id }))).toBe("unknown_message");
    // Resent without it, as the outbox does, it goes.
    await expect(ubu.request({ t: "send", as: "supervisor", to: ["supervisor@mbp-1"], body })).resolves.toMatchObject({ delivered_to: ["supervisor@mbp-1"] });
  });

  it("redelivers what wasn't acked when the laptop reconnects, in the broker's order, and not what was", async () => {
    const mbp = await agent(1, "supervisor");
    await offlineTarget(mbp);
    const send = (body: string) => mbp.request<{ id: string }>({ t: "send", as: "supervisor", to: ["supervisor@mbp-2"], body });
    const a = await send("a");
    const b = await send("b");
    const c = await send("c");
    const d = await send("d");
    // created_at first: c made earliest; then id, for b and d made at the same instant.
    await setMessage(c.id, { created_at: "2026-01-01T00:00:00.000Z" });
    await setMessage(b.id, { created_at: "2026-01-01T00:00:01.000Z" });
    await setMessage(d.id, { created_at: "2026-01-01T00:00:01.000Z" });
    const [first, second] = [b.id, d.id].sort();

    const back = await Client.open(await laptopToken(2));
    expect(await back.request({ t: "register", name: "supervisor" })).toMatchObject({ queued: 4 });
    const got: string[] = [];
    for (let i = 0; i < 4; i++) got.push((await back.next(isDeliver)).msg.id);
    expect(got).toEqual([c.id, first, second, a.id]);
    back.raw(JSON.stringify({ t: "ack", as: "supervisor", ids: [c.id, a.id] }));
    back.close();
    await mbp.next(left("supervisor"));

    const again = await Client.open(await laptopToken(2));
    expect(await again.request({ t: "register", name: "supervisor" })).toMatchObject({ queued: 2 });
    expect([(await again.next(isDeliver)).msg.id, (await again.next(isDeliver)).msg.id]).toEqual([first, second]);
  });
});
