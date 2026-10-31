import { LIMITS, type PeerInfo, type ProjectBoard, type ServerFrame } from "@bobnet/protocol";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { agent, Client, errorCode, laptopToken, ORIGIN, ownerToken } from "./helpers.ts";

type Deliver = Extract<ServerFrame, { t: "deliver" }>;
type Presence = Extract<ServerFrame, { t: "presence" }>;
const isDeliver = (f: ServerFrame): f is Deliver => f.t === "deliver";
const presence = (event: Presence["event"], name: string) => (f: ServerFrame): f is Presence =>
  f.t === "presence" && f.event === event && f.peer.name === name;

describe("registration", () => {
  it("registers under the token's laptop and lists peers", async () => {
    const bob = await agent(1, "Bob", "land");
    const bill = await Client.open(await laptopToken(2));
    expect(await bill.request({ t: "register", name: "Bill", team: "land", expertise: ["adr"] })).toEqual({
      address: "Bill@mbp-2",
      queued: 0,
    });
    const { peers } = await bob.request<{ peers: PeerInfo[] }>({ t: "peers" });
    expect(peers.map((p) => [p.address, p.online, p.team])).toEqual([
      ["Bob@mbp-1", true, "land"],
      ["Bill@mbp-2", true, "land"],
    ]);
  });

  it("refuses a name that is online on another connection, and allows takeover once it's gone", async () => {
    const first = await agent(1, "Riker");
    const second = await Client.open(await laptopToken(1));
    expect(await errorCode(second.request({ t: "register", name: "riker" }))).toBe("name_in_use");
    first.close();
    await second.next(presence("left", "Riker")).catch(() => undefined);
    await expect(second.request({ t: "register", name: "Riker" })).resolves.toMatchObject({ address: "Riker@mbp-1" });
  });

  it("lets a name be taken over from a connection that has gone silent", async () => {
    const stale = await agent(1, "Riker");
    const closed = new Promise<number>((r) => stale.ws.addEventListener("close", (e) => r(e.code)));
    const fresh = await Client.open(await laptopToken(1));
    expect(await errorCode(fresh.request({ t: "register", name: "Riker" }))).toBe("name_in_use");
    // Age the holder past the silence window, as if its laptop went to sleep.
    await runInDurableObject(env.BROKER.getByName("network"), (_obj, state) => {
      for (const ws of state.getWebSockets()) {
        const a = ws.deserializeAttachment() as { connectedAt: number };
        ws.serializeAttachment({ ...a, connectedAt: Date.now() - 120_000 });
      }
    });
    await expect(fresh.request({ t: "register", name: "Riker" })).resolves.toMatchObject({ address: "Riker@mbp-1" });
    expect(await closed).toBe(4001);
  });

  it("hands a name straight back to the same client process reconnecting", async () => {
    const before = await Client.open(await laptopToken(1));
    await before.request({ t: "register", name: "Riker", instance: "proc-abc123" });
    const after = await Client.open(await laptopToken(1));
    // Another process can't take it while the first still answers pings...
    expect(await errorCode(after.request({ t: "register", name: "Riker", instance: "proc-other1" }))).toBe("name_in_use");
    // ...but the same process, on its new socket, gets it at once.
    await expect(after.request({ t: "register", name: "Riker", instance: "proc-abc123" })).resolves.toMatchObject({ address: "Riker@mbp-1" });
  });

  it("lets the same name exist on two laptops", async () => {
    await agent(1, "Homer");
    await expect(agent(2, "Homer")).resolves.toBeInstanceOf(Client);
  });

  it("only acts as peers this connection hosts", async () => {
    await agent(1, "Luke");
    const other = await agent(1, "Howard");
    expect(await errorCode(other.request({ t: "send", as: "Luke", to: ["Howard"], body: "spoof" }))).toBe("not_hosted");
  });

  it("does not let the owner host peers", async () => {
    const owner = await Client.open(await ownerToken(), { origin: ORIGIN });
    expect(await errorCode(owner.request({ t: "register", name: "Casper" }))).toBe("forbidden");
  });

  it("hosts several peers on one connection", async () => {
    const supervisor = await Client.open(await laptopToken(1));
    await supervisor.request({ t: "register", name: "Bill", team: "land" });
    await supervisor.request({ t: "register", name: "Marvin", team: "land" });
    const r = await supervisor.request({ t: "send", as: "Bill", to: ["Marvin"], body: "evidence?" });
    expect(r.delivered_to).toEqual(["Marvin@mbp-1"]);
    expect((await supervisor.next(isDeliver)).to).toBe("Marvin@mbp-1");
  });
});

describe("direct messages", () => {
  it("delivers to an online peer with wake, and resolves bare names on the sender's laptop", async () => {
    const bob = await agent(1, "Bob", "land");
    const bill = await agent(1, "Bill", "land");
    const r = await bob.request({ t: "send", as: "Bob", to: ["bill"], body: "LAND-3 ready, see lead/plan.md" });
    expect(r).toMatchObject({ delivered_to: ["Bill@mbp-1"], queued_for: [] });
    const d = await bill.next(isDeliver);
    expect(d.wake).toBe(true);
    expect(d.msg).toMatchObject({ id: r.id, type: "message", from: "Bob@mbp-1", to: ["Bill@mbp-1"], team: "land", laptop: "mbp-1" });
  });

  it("reaches another laptop only with an explicit address", async () => {
    const bob = await agent(1, "Bob");
    const bill = await agent(2, "Bill");
    expect(await errorCode(bob.request({ t: "send", as: "Bob", to: ["Bill"], body: "hi" }))).toBe("unknown_peer");
    await bob.request({ t: "send", as: "Bob", to: ["Bill@mbp-2"], body: "hi" });
    expect((await bill.next(isDeliver)).msg.from).toBe("Bob@mbp-1");
  });

  it("queues for an offline peer and delivers on its return, until acked", async () => {
    const bob = await agent(1, "Bob");
    const garfield = await agent(1, "Garfield");
    garfield.close();
    await bob.next(presence("left", "Garfield"));

    const r = await bob.request({ t: "send", as: "Bob", to: ["Garfield"], body: "review LAND-4" });
    expect(r).toMatchObject({ delivered_to: [], queued_for: ["Garfield@mbp-1"] });

    const back = await Client.open(await laptopToken(1));
    expect(await back.request({ t: "register", name: "Garfield" })).toMatchObject({ queued: 1 });
    const d = await back.next(isDeliver);
    expect(d.msg.id).toBe(r.id);
    back.close();

    // Not acked: delivered again on the next return.
    const again = await Client.open(await laptopToken(1));
    await again.request({ t: "register", name: "Garfield" });
    const d2 = await again.next(isDeliver);
    expect(d2.msg.id).toBe(r.id);
    again.raw(JSON.stringify({ t: "ack", as: "Garfield", ids: [r.id] }));
    again.close();

    const third = await Client.open(await laptopToken(1));
    expect(await third.request({ t: "register", name: "Garfield" })).toMatchObject({ queued: 0 });
  });

  it("rejects unknown peers all-or-nothing", async () => {
    const bob = await agent(1, "Bob");
    const bill = await agent(1, "Bill");
    expect(await errorCode(bob.request({ t: "send", as: "Bob", to: ["Bill", "Nobody"], body: "x" }))).toBe("unknown_peer");
    expect(await bill.never(isDeliver)).toBe(true);
  });

  it("checks replies point at a real message", async () => {
    const bob = await agent(1, "Bob");
    const bill = await agent(1, "Bill");
    expect(await errorCode(bob.request({ t: "send", as: "Bob", to: ["Bill"], body: "x", in_reply_to: "m_nope" }))).toBe("unknown_message");
    const r = await bob.request({ t: "send", as: "Bob", to: ["Bill"], body: "q?" });
    await expect(bill.request({ t: "send", as: "Bill", to: ["Bob"], body: "a.", in_reply_to: r.id })).resolves.toBeDefined();
    expect((await bob.next(isDeliver)).msg.in_reply_to).toBe(r.id);
  });

  it("refuses anything that looks like a credential", async () => {
    const bob = await agent(1, "Bob");
    await agent(1, "Bender");
    expect(await errorCode(bob.request({ t: "send", as: "Bob", to: ["Bender"], body: "use ghp_" + "x".repeat(36) }))).toBe("secret_detected");
  });
});

describe("broadcasts", () => {
  it("scopes to the team by default, wakes only when urgent, and queues for offline teammates", async () => {
    const bob = await agent(1, "Bob", "land");
    const bill = await agent(2, "Bill", "land");
    const other = await agent(1, "Mario", "games");
    const homer = await agent(1, "Homer", "land");
    homer.close();
    await bob.next(presence("left", "Homer"));

    expect(await bob.request({ t: "broadcast", as: "Bob", scope: "team", body: "standup at 10" })).toMatchObject({ recipients: 2 });
    expect((await bill.next(isDeliver)).wake).toBe(false);
    expect(await other.never(isDeliver)).toBe(true);

    await bob.request({ t: "broadcast", as: "Bob", scope: "team", body: "push hold", urgent: true });
    expect((await bill.next(isDeliver)).wake).toBe(true);

    const back = await Client.open(await laptopToken(1));
    expect(await back.request({ t: "register", name: "Homer", team: "land" })).toMatchObject({ queued: 2 });
  });

  it("reaches everyone with scope all, and needs a team for scope team", async () => {
    const loner = await agent(1, "Linus");
    const mario = await agent(2, "Mario", "games");
    expect(await errorCode(loner.request({ t: "broadcast", as: "Linus", scope: "team", body: "x" }))).toBe("no_team");
    await loner.request({ t: "broadcast", as: "Linus", scope: "all", body: "hello all" });
    expect((await mario.next(isDeliver)).msg.type).toBe("broadcast");
  });
});

describe("presence", () => {
  it("tells teammates and teamless peers, not other teams", async () => {
    const bob = await agent(1, "Bob", "land");
    const loner = await agent(1, "Linus");
    const mario = await agent(1, "Mario", "games");
    const owner = await Client.open(await ownerToken(), { origin: ORIGIN });
    await agent(2, "Bill", "land");
    await bob.next(presence("joined", "Bill"));
    await loner.next(presence("joined", "Bill"));
    await owner.next(presence("joined", "Bill"));
    expect(await mario.never(presence("joined", "Bill"))).toBe(true);
  });

  it("announces status changes and departures", async () => {
    const bob = await agent(1, "Bob", "land");
    const bill = await agent(1, "Bill", "land");
    await bill.request({ t: "status", as: "Bill", status: "writing ADR 0090" });
    expect((await bob.next(presence("status", "Bill"))).peer.status).toBe("writing ADR 0090");
    await bill.request({ t: "deregister", as: "Bill" });
    await bob.next(presence("left", "Bill"));
    const { peers } = await bob.request<{ peers: PeerInfo[] }>({ t: "peers" });
    expect(peers.map((p) => p.name)).toEqual(["Bob"]);
  });
});

describe("frames", () => {
  it("answers malformed and oversized frames with errors, keeping the socket", async () => {
    const c = await agent(1, "Bob");
    c.raw("not json");
    expect(await c.next((f) => f.t === "error" && f.code === "bad_frame")).toMatchObject({ rid: null });
    c.raw(JSON.stringify({ t: "send", rid: "x1", as: "Bob" }));
    expect(await c.next((f) => f.t === "error" && f.rid === "x1")).toMatchObject({ code: "bad_frame" });
    c.raw(JSON.stringify({ t: "peers", rid: "big", pad: "x".repeat(70_000) }));
    expect(await c.next((f) => f.t === "error" && f.rid === "big")).toMatchObject({ code: "frame_too_large" });
    await expect(c.request({ t: "peers" })).resolves.toBeDefined();
  });
});

describe("dashboard", () => {
  const snapshot = {
    supervisor: { started_at: "2026-10-30T00:00:00.000Z", concurrency: 3, active: 1, queued: 0 },
    workers: [
      {
        id: "w_1", name: "Bill", project: "helix", role: "bill", state: "running" as const, task: "ADR 0094", model: "opus", effort: "high", checkpoint: null,
        started_at: "2026-10-30T00:00:00.000Z", ended_at: null, last_event_at: "2026-10-30T00:01:00.000Z",
        tokens: { input: 10, output: 2, cache_read: 0, cache_write: 0 }, cost_usd: 0.01,
        session: "LAND-41 build 3", task_ref: "LAND-41.16", calls: 3, context: 41000, ctx: [30000, 36000, 41000],
      },
    ],
    pending: [],
    usage: [],
  };

  it("keeps each laptop's latest snapshot and streams it to the owner", async () => {
    const owner = await Client.open(await ownerToken(), { origin: ORIGIN });
    const supervisor = await agent(1, "supervisor");
    await supervisor.request({ t: "report", as: "supervisor", snapshot });
    const live = await owner.next((f) => f.t === "report");
    expect(live).toMatchObject({ laptop: "mbp-1", snapshot: { workers: [{ id: "w_1" }] } });
    const d = await owner.request({ t: "dashboard" });
    expect(d.laptops).toEqual([{ laptop: "mbp-1", at: expect.any(String), snapshot }]);
  });

  const board: ProjectBoard = {
    project: "helix",
    ref: "1b8c34f4aa00",
    backlog: {
      milestones: [{ id: "m-2", title: "R1 Partner demo" }],
      items: [{ id: "LAND-41", title: "An agent proposes changes", status: "Ready", type: "increment", parent: null, milestone: "m-2", assignee: [], labels: [], deps: [], desc: "R1 increment 7c", ac: [[false, "an agent proposes a change (e2e)"]] }],
      done_counts: {},
      drafts: [],
    },
    sessions: [{ name: "LAND-41 build 3", kind: "build", started_at: "2026-10-31T17:30:00Z", ended_at: null, workers: 2, calls: 120, tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 } }],
    runs: [],
    baseline: { runs: 0, p25: [], p50: [], p75: [] },
    commits: [],
    ci: null,
  };

  it("keeps each project's board, streams it to the owner, and takes one larger than other frames", async () => {
    const owner = await Client.open(await ownerToken(), { origin: ORIGIN });
    const supervisor = await agent(1, "supervisor");
    // Past runs' context per call make a board bigger than the 64 KiB other frames are held to.
    const big: ProjectBoard = {
      ...board,
      runs: Array.from({ length: 60 }, (_, i) => ({ id: `w_${i}`, name: "Homer", role: "homer", session: "LAND-41 build 2", task_ref: "LAND-41.16", model: "opus", effort: "high", started_at: null, ended_at: null, resumed: false, tokens: 1, ctx: Array.from({ length: 300 }, (_, j) => 100000 + j) })),
    };
    expect(JSON.stringify(big).length).toBeGreaterThan(LIMITS.frameBytes);
    await supervisor.request({ t: "board", as: "supervisor", board: big });
    const live = await owner.next((f) => f.t === "board");
    expect(live).toMatchObject({ laptop: "mbp-1", board: { project: "helix" } });
    await supervisor.request({ t: "board", as: "supervisor", board });
    const d = await owner.request({ t: "dashboard" });
    expect(d.boards).toEqual([{ laptop: "mbp-1", at: expect.any(String), board }]);
  });

  it("takes a snapshot larger than other frames: a busy day's workers", async () => {
    const supervisor = await agent(1, "supervisor");
    const busy = { ...snapshot, workers: Array.from({ length: 100 }, (_, i) => ({ ...snapshot.workers[0]!, id: `w_${i}`, task: "x".repeat(200), checkpoint: "y".repeat(300) })) };
    expect(JSON.stringify(busy).length).toBeGreaterThan(LIMITS.frameBytes);
    await expect(supervisor.request({ t: "report", as: "supervisor", snapshot: busy })).resolves.toMatchObject({ laptop: "mbp-1" });
  });

  it("rejects a malformed snapshot", async () => {
    const supervisor = await agent(1, "supervisor");
    expect(await errorCode(supervisor.request({ t: "report", as: "supervisor", snapshot: { ...snapshot, supervisor: null } as never }))).toBe("bad_frame");
  });

  it("feeds session updates, checked for credentials, to the owner", async () => {
    const owner = await Client.open(await ownerToken(), { origin: ORIGIN });
    const orch = await agent(1, "Orchestrator", "sandbox");
    await orch.request({ t: "update", as: "Orchestrator", text: "Story 3: build done, review next" });
    expect((await owner.next((f) => f.t === "update"))).toMatchObject({ item: { from: "Orchestrator@mbp-1", text: "Story 3: build done, review next" } });
    expect(await errorCode(orch.request({ t: "update", as: "Orchestrator", text: "key AKIAIOSFODNN7EXAMPLE" }))).toBe("secret_detected");
    const d = await owner.request({ t: "dashboard" });
    expect(d.updates.map((u: { text: string }) => u.text)).toEqual(["Story 3: build done, review next"]);
  });

  it("shows message traffic and counts without bodies", async () => {
    const owner = await Client.open(await ownerToken(), { origin: ORIGIN });
    const bob = await agent(1, "Bob", "land");
    const bill = await agent(1, "Bill", "land");
    bill.close();
    await bob.next(presence("left", "Bill"));
    await bob.request({ t: "send", as: "Bob", to: ["Bill"], body: "the confidential plan" });
    const t = await owner.next((f) => f.t === "traffic");
    expect(JSON.stringify(t)).not.toContain("confidential");
    const d = await owner.request({ t: "dashboard" });
    expect(JSON.stringify(d)).not.toContain("confidential");
    expect(d.traffic[0]).toMatchObject({ from: "Bob@mbp-1", to: ["Bill@mbp-1"], type: "message" });
    const byAddr = new Map(d.peers.map((p: { address: string }) => [p.address, p]));
    expect(byAddr.get("Bob@mbp-1")).toMatchObject({ online: true, connected_at: expect.any(String), stats: { sent_24h: 1, received_24h: 0, inbox: 0 } });
    expect(byAddr.get("Bill@mbp-1")).toMatchObject({ online: false, connected_at: null, stats: { received_24h: 1, inbox: 1 } });
  });

  it("is for the owner only", async () => {
    const bob = await agent(1, "Bob");
    expect(await errorCode(bob.request({ t: "dashboard" }))).toBe("forbidden");
  });
});

describe("dashboard actions", () => {
  const snapshot = {
    supervisor: { started_at: "2026-10-30T00:00:00.000Z", concurrency: 3, active: 0, queued: 0 },
    workers: [],
    pending: [],
    usage: [],
  };

  it("hands an owner's action, with the owner's token, to the laptop's supervisor and relays the result", async () => {
    const sup = await agent(1, "supervisor");
    await sup.request({ t: "report", as: "supervisor", snapshot });
    const token = await ownerToken();
    const owner = await Client.open(token, { origin: ORIGIN });
    const { id } = await owner.request({ t: "action", laptop: "mbp-1", action: { kind: "stop", worker: "w_1" } });
    const handed = await sup.next((f) => f.t === "action");
    expect(handed).toEqual({ t: "action", id, to: "supervisor@mbp-1", by: "owner@example.com", token, action: { kind: "stop", worker: "w_1" } });
    sup.raw(JSON.stringify({ t: "action_result", as: "supervisor", id, ok: true, message: "stopped" }));
    expect(await owner.next((f) => f.t === "action_result")).toMatchObject({ id, laptop: "mbp-1", ok: true, message: "stopped" });
  });

  it("refuses actions from laptops, and for a laptop with no supervisor online", async () => {
    const bob = await agent(1, "Bob");
    expect(await errorCode(bob.request({ t: "action", laptop: "mbp-1", action: { kind: "stop", worker: "w_1" } }))).toBe("forbidden");
    const owner = await Client.open(await ownerToken(), { origin: ORIGIN });
    expect(await errorCode(owner.request({ t: "action", laptop: "mbp-2", action: { kind: "stop", worker: "w_1" } }))).toBe("offline");
  });
});

describe("keepalive", () => {
  it("answers ping with pong", async () => {
    const c = await agent(1, "Bob");
    const pong = new Promise<string>((r) =>
      c.ws.addEventListener("message", (e) => e.data === '{"t":"pong"}' && r(e.data as string)),
    );
    c.raw('{"t":"ping"}');
    expect(await pong).toBe('{"t":"pong"}');
  });
});

describe("retention", () => {
  it("sweeps expired messages and their deliveries", async () => {
    const bob = await agent(1, "Bob");
    const bill = await agent(1, "Bill");
    bill.close();
    await bob.next(presence("left", "Bill"));
    await bob.request({ t: "send", as: "Bob", to: ["Bill"], body: "soon stale", ttl_seconds: 60 });

    const stub = env.BROKER.getByName("network");
    await runInDurableObject(stub, (_obj, state) => {
      state.storage.sql.exec("UPDATE messages SET expires_at = '2000-01-01T00:00:00.000Z'");
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, (_obj, state) => {
      expect(state.storage.sql.exec("SELECT count(*) AS n FROM messages").one().n).toBe(0);
      expect(state.storage.sql.exec("SELECT count(*) AS n FROM deliveries").one().n).toBe(0);
    });
    const back = await Client.open(await laptopToken(1));
    expect(await back.request({ t: "register", name: "Bill" })).toMatchObject({ queued: 0 });
  });

  it("never writes message bodies to the audit log", async () => {
    const bob = await agent(1, "Bob");
    await agent(1, "Bill");
    await bob.request({ t: "send", as: "Bob", to: ["Bill"], body: "the secret plan" });
    await runInDurableObject(env.BROKER.getByName("network"), (_obj, state) => {
      const rows = state.storage.sql.exec<{ detail: string }>("SELECT detail FROM audit").toArray();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.detail.includes("secret plan"))).toBe(false);
    });
  });
});
