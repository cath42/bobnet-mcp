import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Envelope } from "@bobnet/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { GhCiPoll } from "../src/ci-poll.ts";
import { callTool, handlers } from "../src/mcp.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { REMOTE_TOOLS_SINCE, Supervisor } from "../src/supervisor.ts";
import { type FakeSession, fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";
import { FakeNetwork } from "./network.ts";

// Requests of a `v: 2` worker go to its spawner (ADR 0007 §4; BOB-66): announced as a `request`
// event, each settle told as `settled` from the store's one hook, an orphaned one answered with
// `resume` resumed as a new worker of the same spawner (`resumed`), and the requester's
// `remote_asks` copies, changed only forward. On the FakeNetwork: ubu1's supervisor is real;
// mbp-1's is real, or played by the test where the order of what it gets matters.

const POLICY = new Policy(`
rules:
  - id: probe
    tools: [Bash]
    command: "^echo probe$"
    decision: escalate
    tier: orchestrator
    reason: the probe
`);
const UBU = `  studio:
    path: /work/studio
    roles:
      ann: { dir: /work/studio-ann }
      bea: { dir: /work/studio-bea }
remote:
  supervisor@mbp-1: { spawn: { studio: [ann, bea] } }
`;
const SUP_MBP = "supervisor@mbp-1";
const SUP_UBU = "supervisor@ubu1";
const SPAWN = { v: 2, op: "spawn", project: "studio", role: "ann", task: "one fix", by: "poe" } as const;
const PROBE = { command: "echo probe" };

const dirs: string[] = [];
const stores = new Set<Store>();
const running: Supervisor[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.shutdown()));
  await tick(20);
  for (const s of stores) s.close();
  stores.clear();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function newStore(): { dir: string; store: Store } {
  const dir = mkdtempSync(join(tmpdir(), "bobnet-requests-"));
  dirs.push(dir);
  const store = new Store(join(dir, "supervisor.db"));
  stores.add(store);
  return { dir, store };
}

async function boot(net: FakeNetwork, laptop: string, over: string, at = newStore()) {
  const link = net.link(laptop);
  const query = fakeQuery();
  const ciPoll = new GhCiPoll(quiet, async () => {
    throw new Error("no gh in tests");
  });
  const sup = new Supervisor({ config: testConfig(at.dir, over), policy: POLICY, store: at.store, broker: link, queryFn: query.queryFn, log: quiet, sandboxCheck: async () => null, ownerCheck: async () => false, sleep: net.sleep, ciPoll });
  link.onPush = (f) => sup.onPush(f);
  await sup.start();
  running.push(sup);
  return { sup, store: at.store, at, link, sessions: query.sessions };
}

/** mbp-1's supervisor scripted: it sends requests and keeps what it gets. */
async function scripted(net: FakeNetwork) {
  const link = net.link("mbp-1");
  const got: Envelope[] = [];
  link.onPush = (f) => {
    if (f.t === "deliver") got.push(f.msg);
  };
  await link.register({ name: "supervisor" });
  const ask = async (body: unknown) => {
    const sent = await link.request<{ id: string }>({ t: "send", as: "supervisor", to: [SUP_UBU], body: JSON.stringify(body) });
    await until(() => got.some((m) => m.in_reply_to === sent.id));
    return { id: sent.id, reply: JSON.parse(got.find((m) => m.in_reply_to === sent.id)!.body) as Record<string, any> };
  };
  const events = (event: string) => got.map((m) => JSON.parse(m.body) as Record<string, any>).filter((b) => b["event"] === event);
  return { link, got, ask, events };
}

/** ubu1 real with Bob its orchestrator, mbp-1 scripted, and one v: 2 worker of mbp-1's running on ubu1. */
async function spawned(over = "") {
  const net = new FakeNetwork();
  const ubu = await boot(net, "ubu1", `${UBU}${over}`);
  await ubu.link.register({ name: "Bob" });
  const mbp = await scripted(net);
  const { id: req, reply } = await mbp.ask(SPAWN);
  const id = reply["worker"].id as string;
  await until(() => ubu.sessions.length === 1);
  const bob = () => net.between(SUP_UBU, "Bob@ubu1");
  return { net, ubu, mbp, req, id, bob };
}

/** A permission request as the CLI makes one, with the signal the SDK aborts when the call is cancelled. */
function askWith(session: FakeSession, signal: AbortSignal) {
  return session.options.canUseTool!("Bash", PROBE, { signal } as never);
}

/** A v: 2 worker left running with an open request by a supervisor that died, and its store. */
function leftBehind(at = newStore()) {
  const w = at.store.createWorker({ project: "studio", role: "ann", task: "one fix", handoff: null, priority: 0, resume_session: null, spawned_by: SUP_MBP, remote_by: "poe", spawn_req: "m_spawn1" });
  at.store.updateWorker(w.id, { state: "waiting-approval", session_id: "sess-old" });
  const r = at.store.createRequest({ worker_id: w.id, kind: "approval", tool: "Bash", input: JSON.stringify(PROBE), tier: "orchestrator", rule: "probe", reason: "the probe" });
  return { at, w, r };
}

describe("a request is announced to its spawner (AC 1)", () => {
  it("a v: 2 worker's: a request event to its spawner (id, worker, kind, tool, tier, rule, preview, created_at), no notice to the target's orchestrator", async () => {
    const s = await spawned();
    void s.ubu.sessions[0]!.ask("Bash", PROBE);
    await until(() => s.mbp.events("request").length === 1);
    const r = s.ubu.store.requests(["open"])[0]!;
    expect(s.mbp.events("request")[0]).toEqual({ v: 2, event: "request", worker: s.id, spawn_req: s.req, request: r.id, kind: "approval", tool: "Bash", tier: "orchestrator", rule: "probe", preview: "echo probe", created_at: r.created_at });
    await tick(20);
    expect(s.bob().filter((b) => b.includes(r.id))).toEqual([]);
  });

  it("a local worker's and a v-less spawn's: announced to the orchestrator as today, no event", async () => {
    const net = new FakeNetwork();
    const ubu = await boot(net, "ubu1", UBU);
    await ubu.link.register({ name: "Bob" });
    const mbp = await scripted(net);
    ubu.sup.spawn({ project: "studio", role: "ann", task: "local" });
    const { reply } = await mbp.ask({ op: "spawn", project: "studio", role: "bea", task: "old wire" });
    expect(reply).toMatchObject({ ok: true, op: "spawn" });
    await until(() => ubu.sessions.length === 2);
    for (const session of ubu.sessions) void session.ask("Bash", PROBE);
    await until(() => net.between(SUP_UBU, "Bob@ubu1").filter((b) => b.includes("needs approval for Bash")).length === 2);
    expect(net.between(SUP_UBU, "Bob@ubu1").filter((b) => b.includes("needs approval for Bash"))).toEqual([
      expect.stringMatching(/^Ann needs approval for Bash \(r_\w+, orchestrator decides; rule probe\): echo probe\. See pending_requests/),
      expect.stringMatching(/needs approval for Bash \(r_\w+, orchestrator decides; rule probe\): echo probe\. See pending_requests/),
    ]);
    expect(mbp.events("request")).toEqual([]);
  });
});

describe("every settle is told, from one hook (AC 2, 3, 5)", () => {
  it("router.answer: settled answered, by the orchestrator", async () => {
    const s = await spawned();
    const result = s.ubu.sessions[0]!.ask("Bash", PROBE);
    await until(() => s.mbp.events("request").length === 1);
    const rid = s.mbp.events("request")[0]!["request"] as string;
    s.ubu.sup.answer(rid, { decision: "allow" }, "orchestrator");
    expect(await result).toMatchObject({ behavior: "allow" });
    await until(() => s.mbp.events("settled").length === 1);
    expect(s.mbp.events("settled")[0]).toEqual({ v: 2, event: "settled", worker: s.id, spawn_req: s.req, request: rid, state: "answered", decision: "allow", decided_by: "orchestrator" });
  });

  it("the timeout: denies as for a local request, and settled expired, by timeout (AC 5)", async () => {
    const s = await spawned("request_timeout_minutes: 0.001\n");
    const result = await s.ubu.sessions[0]!.ask("Bash", PROBE);
    expect(result).toMatchObject({ behavior: "deny", message: expect.stringMatching(/^No answer within/) });
    await until(() => s.mbp.events("settled").length === 1);
    const rid = s.mbp.events("request")[0]!["request"];
    expect(s.mbp.events("settled")[0]).toEqual({ v: 2, event: "settled", worker: s.id, spawn_req: s.req, request: rid, state: "expired", decision: "deny", decided_by: "timeout" });
    expect(s.ubu.store.request(rid)).toMatchObject({ state: "expired", decided_by: "timeout" });
  });

  it("markOrphaned at start: settled orphaned, queued until registered and then sent", async () => {
    const { at, w, r } = leftBehind();
    const net = new FakeNetwork();
    const mbp = await scripted(net);
    await boot(net, "ubu1", UBU, at);
    await until(() => mbp.events("settled").length === 1);
    expect(mbp.events("settled")[0]).toEqual({ v: 2, event: "settled", worker: w.id, spawn_req: "m_spawn1", request: r.id, state: "orphaned", decision: null, decided_by: null });
    // After the worker's exit, as made.
    expect(mbp.got.map((m) => JSON.parse(m.body)["event"])).toEqual(["exit", "settled"]);
  });

  it("the dismiss: settled answered deny, by the orchestrator", async () => {
    const { at, r } = leftBehind();
    const net = new FakeNetwork();
    const mbp = await scripted(net);
    const ubu = await boot(net, "ubu1", UBU, at);
    await until(() => mbp.events("settled").length === 1);
    ubu.sup.answer(r.id, { decision: "deny" }, "orchestrator", false);
    await until(() => mbp.events("settled").length === 2);
    expect(mbp.events("settled")[1]).toMatchObject({ request: r.id, state: "answered", decision: "deny", decided_by: "orchestrator" });
  });

  it("expireOrphans: settled expired, by the supervisor", async () => {
    const { at, r } = leftBehind();
    const net = new FakeNetwork();
    const mbp = await scripted(net);
    const ubu = await boot(net, "ubu1", UBU, at);
    await until(() => mbp.events("settled").length === 1);
    expect(ubu.sup.expireOrphans(Date.now() + 30 * 86_400_000)).toBe(1);
    await until(() => mbp.events("settled").length === 2);
    expect(mbp.events("settled")[1]).toMatchObject({ request: r.id, state: "expired", decision: "deny", decided_by: "supervisor" });
  });

  it("a v: 2 worker stopped while it waits: its row settles expired, by stop, and settled is sent (AC 3)", async () => {
    const s = await spawned();
    const cancel = new AbortController();
    const result = askWith(s.ubu.sessions[0]!, cancel.signal);
    await until(() => s.mbp.events("request").length === 1);
    const rid = s.mbp.events("request")[0]!["request"] as string;
    await s.ubu.sup.stop(s.id);
    cancel.abort();
    expect(await result).toMatchObject({ behavior: "deny", message: "Worker stopped" });
    expect(s.ubu.store.request(rid)).toMatchObject({ state: "expired", decision: "deny", decided_by: "stop" });
    await until(() => s.mbp.events("settled").length === 1);
    expect(s.mbp.events("settled")[0]).toEqual({ v: 2, event: "settled", worker: s.id, spawn_req: s.req, request: rid, state: "expired", decision: "deny", decided_by: "stop" });
  });

  it("a local worker stopped while it waits: its row settles too, not left open until a restart (AC 3)", async () => {
    const net = new FakeNetwork();
    const ubu = await boot(net, "ubu1", UBU);
    const w = ubu.sup.spawn({ project: "studio", role: "ann", task: "local" });
    await until(() => ubu.sessions.length === 1);
    const cancel = new AbortController();
    const result = askWith(ubu.sessions[0]!, cancel.signal);
    await until(() => ubu.store.requests(["open"]).length === 1);
    const rid = ubu.store.requests(["open"])[0]!.id;
    await ubu.sup.stop(w.id);
    cancel.abort();
    expect(await result).toMatchObject({ behavior: "deny", message: "Worker stopped" });
    expect(ubu.store.request(rid)).toMatchObject({ state: "expired", decided_by: "stop" });
    expect(ubu.store.requests(["open", "orphaned"])).toEqual([]);
  });

  it("a shutdown's request stays open, so the next start orphans it and answering resumes the worker", async () => {
    const net = new FakeNetwork();
    const ubu = await boot(net, "ubu1", UBU);
    ubu.sup.spawn({ project: "studio", role: "ann", task: "local" });
    await until(() => ubu.sessions.length === 1);
    const cancel = new AbortController();
    void askWith(ubu.sessions[0]!, cancel.signal);
    await until(() => ubu.store.requests(["open"]).length === 1);
    const rid = ubu.store.requests(["open"])[0]!.id;
    const closing = ubu.sup.shutdown();
    cancel.abort();
    await closing;
    expect(ubu.store.request(rid)).toMatchObject({ state: "open", decided_by: null });
  });
});

describe("a target restart and an orphaned request (AC 4)", () => {
  it("settled orphaned at start; answered with resume, a new worker of the same spawner, resumed sent, the local queue rule followed", async () => {
    const { at, w, r } = leftBehind();
    const net = new FakeNetwork();
    const mbp = await scripted(net);
    const ubu = await boot(net, "ubu1", UBU, at);
    await until(() => mbp.events("settled").length === 1);
    expect(mbp.events("settled")[0]).toMatchObject({ request: r.id, state: "orphaned" });
    // ann is busy with a local worker: the resume continues an admitted worker, so it queues.
    ubu.sup.spawn({ project: "studio", role: "ann", task: "local" });
    await until(() => ubu.sessions.length === 1);
    const { resumed } = ubu.sup.answer(r.id, { decision: "allow" }, "orchestrator");
    expect(resumed).toMatchObject({ state: "queued", spawned_by: SUP_MBP, remote_by: "poe", spawn_req: "m_spawn1", resume_session: "sess-old" });
    await until(() => mbp.events("resumed").length === 1);
    expect(mbp.events("settled")[1]).toMatchObject({ request: r.id, state: "answered", decision: "allow", decided_by: "orchestrator" });
    expect(mbp.events("resumed")[0]).toEqual({ v: 2, event: "resumed", worker: resumed!.id, spawn_req: "m_spawn1", previous: w.id, request: r.id });
  });
});

/** ubu1's and mbp-1's real supervisors, Bob as mbp-1's orchestrator. */
async function real() {
  const net = new FakeNetwork();
  net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
  const at = newStore();
  const ubu = await boot(net, "ubu1", UBU, at);
  const mbp = await boot(net, "mbp-1", "");
  await mbp.link.register({ name: "Bob" });
  const tools = handlers(mbp.sup);
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse((await callTool(tools, name, args)).content[0]!.text);
  return { net, at, ubu, mbp, call };
}

describe("the new worker is its spawner's (AC 7)", () => {
  it("after a restart, the resumed worker's events carry v: its exit reaches the requester, and the copy is made", async () => {
    const { net, at, ubu, mbp, call } = await real();
    const w = await call("spawn_worker", { project: "studio", role: "ann", task: "one fix", laptop: "ubu1" });
    await until(() => ubu.sessions.length === 1);
    const cancel = new AbortController();
    void askWith(ubu.sessions[0]!, cancel.signal);
    await until(() => mbp.store.remoteAsks("ubu1").length === 1);
    const rid = mbp.store.remoteAsks("ubu1")[0]!.id;
    // ubu1 restarts: the request is left open, then orphaned at the next start.
    const closing = ubu.sup.shutdown();
    cancel.abort();
    await closing;
    running.splice(running.indexOf(ubu.sup), 1);
    const again = await boot(net, "ubu1", UBU, at);
    await until(() => mbp.store.remoteAsk("ubu1", rid)?.state === "orphaned");

    const { resumed } = again.sup.answer(rid, { decision: "allow" }, "orchestrator");
    expect(resumed).toMatchObject({ spawned_by: SUP_MBP, remote_by: "Bob", spawn_req: ubu.store.worker(w.id)!.spawn_req });
    await until(() => again.sessions.length === 1);
    again.sessions[0]!.finish();
    await until(() => mbp.store.remoteCopy("ubu1", resumed!.id)?.ended === 1);
    expect(mbp.store.remoteCopy("ubu1", resumed!.id)).toMatchObject({ state: "done", spawn_req: ubu.store.worker(w.id)!.spawn_req });
    expect(mbp.store.remoteAsk("ubu1", rid)).toMatchObject({ state: "answered", decided_by: "orchestrator" });
  });

  it("after reset on the target: the fresh worker carries spawn_req and remote_by, and its exit makes the copy", async () => {
    const { ubu, mbp, call } = await real();
    const w = await call("spawn_worker", { project: "studio", role: "ann", task: "one fix", laptop: "ubu1" });
    await until(() => ubu.sessions.length === 1);
    const resetting = ubu.sup.reset(w.id);
    ubu.sessions[0]!.finish();
    const fresh = await resetting;
    expect(fresh).toMatchObject({ spawned_by: SUP_MBP, remote_by: "Bob", spawn_req: ubu.store.worker(w.id)!.spawn_req });
    await until(() => ubu.sessions.length === 2);
    ubu.sessions[1]!.finish();
    await until(() => mbp.store.remoteCopy("ubu1", fresh.id)?.ended === 1);
    expect(mbp.store.remoteCopy("ubu1", fresh.id)).toMatchObject({ state: "done", spawn_req: ubu.store.worker(w.id)!.spawn_req });
  });
});

/** mbp-1's real supervisor, ubu1's played by the test: it answers the spawn with worker w_9 and sends what the test says. */
async function playedTarget() {
  const net = new FakeNetwork();
  net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
  const ubu = net.link("ubu1");
  let spawnReq = "";
  const send = (body: unknown) => ubu.request<{ id: string }>({ t: "send", as: "supervisor", to: [SUP_MBP], body: JSON.stringify(body) });
  ubu.onPush = (f) => {
    if (f.t !== "deliver") return;
    const body = JSON.parse(f.msg.body) as Record<string, any>;
    if (body["op"] === "spawn") {
      spawnReq = f.msg.id;
      void send({ v: 2, re: "spawn", req: f.msg.id, ok: true, worker: { id: "w_9", project: "studio", role: "ann", state: "running", spawn_req: f.msg.id } });
    }
  };
  await ubu.register({ name: "supervisor" });
  const mbp = await boot(net, "mbp-1", "");
  await mbp.link.register({ name: "Bob" });
  await JSON.parse((await callTool(handlers(mbp.sup), "spawn_worker", { project: "studio", role: "ann", task: "one fix", laptop: "ubu1" })).content[0]!.text);
  const request = (over: Record<string, unknown> = {}) => ({ v: 2, event: "request", worker: "w_9", spawn_req: spawnReq, request: "r_1", kind: "approval", tool: "Bash", tier: "orchestrator", rule: "probe", preview: "echo probe", created_at: "2026-11-17T12:00:00.000Z", ...over });
  const settled = (state: string, over: Record<string, unknown> = {}) => ({ v: 2, event: "settled", worker: "w_9", spawn_req: spawnReq, request: "r_1", state, decision: state === "orphaned" ? null : "deny", decided_by: state === "orphaned" ? null : "timeout", ...over });
  /** Sends each body in turn, and waits until mbp-1 has handled them all. */
  const deliver = async (...bodies: unknown[]) => {
    const ids: string[] = [];
    for (const b of bodies) ids.push((await send(b)).id);
    await until(() => ids.every((id) => net.acked(id)));
  };
  return { mbp, deliver, request, settled, ask: () => mbp.store.remoteAsk("ubu1", "r_1") };
}

describe("the requester's remote_asks (AC 6)", () => {
  it("a request event makes the copy, open, with its preview fields", async () => {
    const t = await playedTarget();
    await t.deliver(t.request());
    expect(t.ask()).toMatchObject({ laptop: "ubu1", id: "r_1", to_name: SUP_UBU, worker: "w_9", kind: "approval", tool: "Bash", tier: "orchestrator", rule: "probe", preview: "echo probe", created_at: "2026-11-17T12:00:00.000Z", state: "open", decision: null });
  });

  it("a settled makes it final: a later settled or request changes nothing", async () => {
    const t = await playedTarget();
    await t.deliver(t.request(), t.settled("expired"));
    expect(t.ask()).toMatchObject({ state: "expired", decision: "deny", decided_by: "timeout", preview: "echo probe" });
    await t.deliver(t.settled("orphaned"), t.request(), t.settled("answered", { decision: "allow", decided_by: "orchestrator" }));
    expect(t.ask()).toMatchObject({ state: "expired", decision: "deny", decided_by: "timeout" });
  });

  it("a request arriving after its settled changes nothing", async () => {
    const t = await playedTarget();
    await t.deliver(t.settled("expired"));
    const made = t.ask();
    await t.deliver(t.request());
    expect(t.ask()).toEqual(made);
  });

  it("a settled for an unknown request makes the copy in that state; orphaned then moves forward, never back", async () => {
    const t = await playedTarget();
    await t.deliver(t.settled("orphaned"));
    expect(t.ask()).toMatchObject({ worker: "w_9", state: "orphaned", kind: null, preview: null });
    await t.deliver(t.request());
    expect(t.ask()).toMatchObject({ state: "orphaned", preview: null });
    await t.deliver(t.settled("answered", { decision: "allow", decided_by: "orchestrator" }));
    expect(t.ask()).toMatchObject({ state: "answered", decision: "allow", decided_by: "orchestrator" });
  });
});
