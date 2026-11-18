import { BrokerError } from "@bobnet/client/connection";
import { describe, expect, it } from "vitest";
import { FakeNetwork } from "./network.ts";
import { tick } from "./fakes.ts";

// The FakeNetwork itself (ADR 0007, Consequences "Testing"): each behaviour it copies from the broker.

async function twoLaptops() {
  const net = new FakeNetwork();
  const a = net.link("mbp-1");
  const b = net.link("ubu1");
  await a.register({ name: "supervisor", supervisor: true });
  await b.register({ name: "supervisor", supervisor: true });
  return { net, a, b };
}

const send = (link: ReturnType<FakeNetwork["link"]>, to: string, body: string, more: { in_reply_to?: string; ttl_seconds?: number } = {}) =>
  link.request<{ id: string; delivered_to: string[]; queued_for: string[] }>({ t: "send", as: "supervisor", to: [to], body, ...more });

const delivered = (link: ReturnType<FakeNetwork["link"]>) => link.pushes.flatMap((p) => (p.t === "deliver" ? [p.msg] : []));

describe("FakeNetwork", () => {
  it("routes by name@laptop between laptops, and a bare name to the sender's own laptop", async () => {
    const { net, a, b } = await twoLaptops();
    await a.register({ name: "Poe" });
    const r = await send(b, "supervisor@mbp-1", "to mbp-1");
    await tick();
    expect(delivered(a)).toMatchObject([{ id: r.id, from: "supervisor@ubu1", to: ["supervisor@mbp-1"], laptop: "ubu1", body: "to mbp-1" }]);
    expect(delivered(b)).toEqual([]);
    // Bare "Poe" from ubu1 is Poe@ubu1, who isn't there.
    await expect(send(b, "Poe", "x")).rejects.toMatchObject({ code: "unknown_peer" });
    await send(a, "Poe", "bare");
    await tick();
    expect(delivered(a).at(-1)).toMatchObject({ from: "supervisor@mbp-1", to: ["Poe@mbp-1"] });
    expect(net.log.map((m) => m.body)).toEqual(["to mbp-1", "bare"]);
  });

  it("says who got a message now and who it is queued for", async () => {
    const { net, a } = await twoLaptops();
    expect(await send(a, "supervisor@ubu1", "now")).toMatchObject({ delivered_to: ["supervisor@ubu1"], queued_for: [] });
    net.disconnect("ubu1");
    expect(await send(a, "supervisor@ubu1", "later")).toMatchObject({ delivered_to: [], queued_for: ["supervisor@ubu1"] });
  });

  it("drops an undelivered message once its ttl_seconds pass", async () => {
    const { net, a, b } = await twoLaptops();
    net.disconnect("ubu1");
    await send(a, "supervisor@ubu1", "short", { ttl_seconds: 30 });
    await send(a, "supervisor@ubu1", "long", { ttl_seconds: 86400 });
    net.advance(31);
    await net.reconnect("ubu1");
    await tick();
    expect(delivered(b).map((m) => m.body)).toEqual(["long"]);
    expect(delivered(b)[0]!.expires_at).toBe("2026-11-18T12:00:00.000Z");
  });

  it("refuses an in_reply_to to a message the sweep has dropped, and only then", async () => {
    const { net, a, b } = await twoLaptops();
    const req = await send(a, "supervisor@ubu1", "a request", { ttl_seconds: 20 });
    net.advance(25);
    // Expired but not yet swept: the broker still has it.
    await expect(send(b, "supervisor@mbp-1", "reply", { in_reply_to: req.id })).resolves.toMatchObject({ delivered_to: ["supervisor@mbp-1"] });
    net.sweep();
    await expect(send(b, "supervisor@mbp-1", "reply", { in_reply_to: req.id })).rejects.toMatchObject({ code: "unknown_message" });
    await expect(send(b, "supervisor@mbp-1", "reply")).resolves.toBeTruthy();
    expect(net.refused).toEqual([{ from: "supervisor@ubu1", to: ["supervisor@mbp-1"], code: "unknown_message" }]);
  });

  it("redelivers what wasn't acked when the laptop reconnects, in the broker's order, and not what was", async () => {
    const { net, a, b } = await twoLaptops();
    const one = await send(a, "supervisor@ubu1", "one");
    await send(a, "supervisor@ubu1", "two");
    await tick();
    b.sendRaw({ t: "ack", as: "supervisor", ids: [one.id] });
    net.disconnect("ubu1");
    net.advance(1);
    await send(a, "supervisor@ubu1", "three");
    await tick();
    expect(delivered(b).map((m) => m.body)).toEqual(["one", "two"]);
    await net.reconnect("ubu1");
    await tick();
    expect(delivered(b).map((m) => m.body)).toEqual(["one", "two", "two", "three"]);
  });

  it("tells a laptop of peers joining and leaving only on its team or with no team", async () => {
    const net = new FakeNetwork();
    const a = net.link("mbp-1");
    const b = net.link("ubu1");
    const c = net.link("pi");
    await a.register({ name: "Mario", team: "bobnet" });
    await b.register({ name: "Bill", team: "land" });
    await c.register({ name: "supervisor", supervisor: true });
    await b.register({ name: "Toad", team: "bobnet" });
    net.disconnect("ubu1");
    await tick();
    const heard = (l: typeof a) => l.pushes.flatMap((p) => (p.t === "presence" ? [`${p.event} ${p.peer.address}`] : []));
    // mbp-1 hosts only bobnet; pi hosts a peer with no team, so it hears everyone. A peer with no
    // team is heard only where another has none: ubu1 (land, bobnet) never hears of pi.
    expect(heard(a)).toEqual(["joined Toad@ubu1", "left Toad@ubu1"]);
    expect(heard(c)).toEqual(["joined Toad@ubu1", "left Bill@ubu1", "left Toad@ubu1"]);
    expect(heard(b)).toEqual([]);
    expect(net.peerList().find((p) => p.address === "Toad@ubu1")).toMatchObject({ online: false, team: "bobnet" });
  });

  it("refuses a body that looks like a credential, as the broker's findSecret does", async () => {
    const { net, a } = await twoLaptops();
    const err = await send(a, "supervisor@ubu1", `the key is sk-ant-${"x".repeat(30)}`).catch((e: BrokerError) => e);
    expect(err).toBeInstanceOf(BrokerError);
    expect(err).toMatchObject({ code: "secret_detected", message: expect.stringMatching(/anthropic_key/) });
    expect(net.log).toEqual([]);
  });

  it("refuses sends past its limit, so a runaway exchange fails a test instead of spinning", async () => {
    const { net, a } = await twoLaptops();
    net.limit = 2;
    await send(a, "supervisor@ubu1", "1");
    await send(a, "supervisor@ubu1", "2");
    await expect(send(a, "supervisor@ubu1", "3")).rejects.toMatchObject({ code: "bad_frame" });
  });
});
