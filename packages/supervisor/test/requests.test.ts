import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Envelope, LIMITS } from "@bobnet/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GhCiPoll } from "../src/ci-poll.ts";
import { callTool, handlers } from "../src/mcp.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import type { RequestRow } from "../src/store.ts";
import { type Detect, fitRequest, REMOTE_TOOLS_SINCE, Supervisor, SupervisorError } from "../src/supervisor.ts";
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
  - id: human
    tools: [Bash]
    command: "^echo human"
    decision: escalate
    tier: human
    reason: the user decides
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

async function boot(net: FakeNetwork, laptop: string, over: string, at = newStore(), opts: { remoteControl?: boolean; detect?: Detect } = {}) {
  const link = net.link(laptop);
  const query = fakeQuery(opts);
  const ciPoll = new GhCiPoll(quiet, async () => {
    throw new Error("no gh in tests");
  });
  const sup = new Supervisor({ config: testConfig(at.dir, over), policy: POLICY, store: at.store, broker: link, queryFn: query.queryFn, log: quiet, sandboxCheck: async () => null, ownerCheck: async (token) => token === "owner-token", sleep: net.sleep, ciPoll, ...(opts.detect ? { detect: opts.detect } : {}) });
  link.onPush = (f) => sup.onPush(f);
  await sup.start();
  running.push(sup);
  return { sup, store: at.store, at, link, sessions: query.sessions };
}

/** mbp-1's supervisor scripted (or another sender, by laptop and name): it sends requests and keeps what it gets. */
async function scripted(net: FakeNetwork, laptop = "mbp-1", name = "supervisor") {
  const link = net.link(laptop);
  const got: Envelope[] = [];
  link.onPush = (f) => {
    if (f.t === "deliver") got.push(f.msg);
  };
  await link.register({ name });
  const ask = async (body: unknown) => {
    const sent = await link.request<{ id: string }>({ t: "send", as: name, to: [SUP_UBU], body: JSON.stringify(body) });
    await until(() => got.some((m) => m.in_reply_to === sent.id));
    const raw = got.find((m) => m.in_reply_to === sent.id)!.body;
    return { id: sent.id, raw, reply: JSON.parse(raw) as Record<string, any> };
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

describe("a stop that races a shutdown (BOB-100 AC 2)", () => {
  it("a stop asked before the shutdown still settles the request (BOB-100 AC 2): the next start has nothing to orphan or resume", async () => {
    const s = await spawned();
    const at = s.ubu.at;
    const cancel = new AbortController();
    const result = askWith(s.ubu.sessions[0]!, cancel.signal);
    await until(() => s.mbp.events("request").length === 1);
    const rid = s.mbp.events("request")[0]!["request"] as string;
    // The stop is asked for, the shutdown starts, and only then does the SDK abort the call.
    const stopping = s.ubu.sup.stop(s.id);
    const closing = s.ubu.sup.shutdown();
    cancel.abort();
    await Promise.all([stopping, closing]);
    expect(await result).toMatchObject({ behavior: "deny", message: "Worker stopped" });
    expect(at.store.request(rid)).toMatchObject({ state: "expired", decision: "deny", decided_by: "stop" });
    running.splice(running.indexOf(s.ubu.sup), 1);
    const again = await boot(s.net, "ubu1", UBU, at);
    await tick(20);
    expect(again.store.requests(["open", "orphaned"])).toEqual([]);
    expect(() => again.sup.answer(rid, { decision: "allow" }, "orchestrator")).toThrow();
  });

  it("a stop of another worker doesn't settle a shutdown's request of this one", async () => {
    const net = new FakeNetwork();
    const ubu = await boot(net, "ubu1", UBU);
    const ann = ubu.sup.spawn({ project: "studio", role: "ann", task: "local" });
    const bea = ubu.sup.spawn({ project: "studio", role: "bea", task: "local" });
    await until(() => ubu.sessions.length === 2);
    const cancel = new AbortController();
    void askWith(ubu.sessions[0]!, cancel.signal);
    await until(() => ubu.store.requests(["open"]).length === 1);
    const r = ubu.store.requests(["open"])[0]!;
    const other = r.worker_id === ann.id ? bea.id : ann.id;
    const stopping = ubu.sup.stop(other);
    const closing = ubu.sup.shutdown();
    cancel.abort();
    await Promise.all([stopping, closing]);
    expect(ubu.store.request(r.id)).toMatchObject({ state: "open", decided_by: null });
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
  /** The requests mbp-1 sent it after the spawn, and what it replies to one: nothing unless the test says. */
  const asked: Array<Record<string, any>> = [];
  const replies: { to: (body: Record<string, any>) => Record<string, unknown> | null } = { to: () => null };
  const send = (body: unknown, inReplyTo?: string) => ubu.request<{ id: string }>({ t: "send", as: "supervisor", to: [SUP_MBP], body: JSON.stringify(body), ...(inReplyTo ? { in_reply_to: inReplyTo } : {}) });
  ubu.onPush = (f) => {
    if (f.t !== "deliver") return;
    const body = JSON.parse(f.msg.body) as Record<string, any>;
    if (body["op"] === "spawn") {
      spawnReq = f.msg.id;
      void send({ v: 2, re: "spawn", req: f.msg.id, ok: true, worker: { id: "w_9", project: "studio", role: "ann", state: "running", spawn_req: f.msg.id } });
    } else if (typeof body["op"] === "string") {
      asked.push(body);
      const out = replies.to(body);
      if (out) void send({ v: 2, re: body["op"], req: f.msg.id, ...out }, f.msg.id);
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
  return { net, mbp, deliver, request, settled, asked, replies, ask: () => mbp.store.remoteAsk("ubu1", "r_1") };
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

// BOB-67 (B2): the target's `request` and `answer` ops (ADR 0007 §4): checked in order against the
// config of the moment, then answered as a local answer; every one audited.

const ANSWER = (id: string, over: Record<string, unknown> = {}) => ({ v: 2, op: "answer", id, decision: "allow", user_decided: false, resume: true, ...over });
const audits = (store: Store, action: string) => store.auditLog(200).filter((a) => a.action === action).map((a) => ({ ...a, detail: JSON.parse(a.detail) as Record<string, unknown> }));

/** A v: 2 worker of mbp-1's on ubu1 with one open request, raised by the session's call. */
async function asking(tool = "Bash", input: Record<string, unknown> = PROBE, over = "") {
  const s = await spawned(over);
  const result = s.ubu.sessions[0]!.ask(tool, input);
  await until(() => s.mbp.events("request").length === 1);
  return { ...s, result, rid: s.mbp.events("request")[0]!["request"] as string };
}

describe("the answer op's checks, in order (BOB-67 AC 1, 4)", () => {
  it("a sender not in remote is refused, and audited remote:refused with the request, decision and by", async () => {
    const s = await asking();
    const poe = await scripted(s.net, "mbp-1", "poe");
    const { id, reply } = await poe.ask(ANSWER(s.rid));
    expect(reply).toMatchObject({ v: 2, re: "answer", ok: false, error: "poe@mbp-1 may not make requests here: it isn't in this supervisor's remote list" });
    expect(s.ubu.store.request(s.rid)!.state).toBe("open");
    expect(audits(s.ubu.store, "remote:refused")).toEqual([expect.objectContaining({ actor: "poe@mbp-1", worker_id: s.id, detail: { message: id, request: s.rid, decision: "allow", by: "orchestrator", error: expect.any(String) } })]);
  });

  it("an entry removed after the spawn: the config at the answer's time refuses it (criterion 6)", async () => {
    const { at, w, r } = leftBehind();
    const net = new FakeNetwork();
    const mbp = await scripted(net);
    // Casper took ann out of mbp-1's entry; the supervisor read its config again at start.
    const ubu = await boot(net, "ubu1", UBU.replace("studio: [ann, bea]", "studio: [bea]"), at);
    await until(() => mbp.events("settled").length === 1);
    const { reply } = await mbp.ask(ANSWER(r.id));
    expect(reply).toMatchObject({ ok: false, error: `${SUP_MBP} may no longer spawn studio/ann here, so it can't act on ${r.id}` });
    expect(ubu.store.request(r.id)!.state).toBe("orphaned");
    expect(ubu.store.workers().filter((x) => x.id !== w.id)).toEqual([]);
    expect(audits(ubu.store, "remote:refused")[0]).toMatchObject({ actor: SUP_MBP, worker_id: w.id, detail: { request: r.id, decision: "allow", by: "orchestrator" } });
  });

  it("a request of another sender's worker, or none at all, is refused the same way", async () => {
    const s = await asking("Bash", PROBE, "  supervisor@mbp-2: { spawn: { studio: [ann, bea] } }\n");
    const other = await scripted(s.net, "mbp-2");
    const theirs = await other.ask(ANSWER(s.rid));
    expect(theirs.reply).toMatchObject({ ok: false, error: `${s.rid} isn't a request of a worker supervisor@mbp-2 spawned` });
    const none = await other.ask(ANSWER("r_nothing"));
    expect(none.reply).toMatchObject({ ok: false, error: "r_nothing isn't a request of a worker supervisor@mbp-2 spawned" });
    expect(s.ubu.store.request(s.rid)!.state).toBe("open");
    // Newest first.
    expect(audits(s.ubu.store, "remote:refused").map((a) => [a.actor, a.worker_id, a.detail["request"]])).toEqual([
      ["supervisor@mbp-2", null, "r_nothing"],
      ["supervisor@mbp-2", s.id, s.rid],
    ]);
  });

  it("a request no longer open or orphaned is refused", async () => {
    const s = await asking();
    expect((await s.mbp.ask(ANSWER(s.rid))).reply).toMatchObject({ ok: true });
    expect((await s.mbp.ask(ANSWER(s.rid, { decision: "deny" }))).reply).toMatchObject({ ok: false, error: `${s.rid} is already answered` });
  });
});

describe("a passing answer runs as a local one (BOB-67 AC 2, 4)", () => {
  it("an approval: allow runs the call; audited remote:answer besides answer:allow with decided_by", async () => {
    const s = await asking();
    const { id, reply } = await s.mbp.ask(ANSWER(s.rid));
    expect(reply).toEqual({ v: 2, re: "answer", req: id, ok: true, request: s.rid, worker_id: s.id, state: "answered", decision: "allow" });
    expect(await s.result).toMatchObject({ behavior: "allow" });
    expect(audits(s.ubu.store, "remote:answer")).toEqual([expect.objectContaining({ actor: SUP_MBP, worker_id: s.id, detail: { message: id, request: s.rid, decision: "allow", by: "orchestrator" } })]);
    expect(audits(s.ubu.store, "answer:allow")).toEqual([expect.objectContaining({ actor: "orchestrator", worker_id: s.id })]);
    expect(s.ubu.store.request(s.rid)).toMatchObject({ decided_by: "orchestrator" });
    await until(() => s.mbp.events("settled").length === 1);
  });

  it("an approval: deny refuses the call, with the message; answer is refused", async () => {
    const s = await asking();
    expect((await s.mbp.ask(ANSWER(s.rid, { decision: "answer", answers: { a: "b" } }))).reply).toMatchObject({ ok: false, error: `Request ${s.rid} is an approval: allow or deny it` });
    expect((await s.mbp.ask(ANSWER(s.rid, { decision: "deny", message: "not now" }))).reply).toMatchObject({ ok: true, decision: "deny" });
    expect(await s.result).toMatchObject({ behavior: "deny", message: expect.stringContaining("not now") });
  });

  it("a human-tier request needs user_decided; with it, decided by human", async () => {
    const s = await asking("Bash", { command: "echo human" });
    expect((await s.mbp.ask(ANSWER(s.rid))).reply).toMatchObject({ ok: false, error: expect.stringMatching(/needs the user's own decision/) });
    expect(audits(s.ubu.store, "remote:refused")[0]!.detail).toMatchObject({ request: s.rid, by: "orchestrator" });
    expect((await s.mbp.ask(ANSWER(s.rid, { user_decided: true }))).reply).toMatchObject({ ok: true, state: "answered" });
    expect(await s.result).toMatchObject({ behavior: "allow" });
    expect(s.ubu.store.request(s.rid)).toMatchObject({ decided_by: "human" });
    expect(audits(s.ubu.store, "remote:answer")[0]!.detail).toMatchObject({ by: "human" });
  });

  it("a question takes answer (with answers) or deny, not allow", async () => {
    const input = { questions: [{ question: "Which index?", header: "Index", options: [{ label: "GiST" }, { label: "BRIN" }], multiSelect: false }] };
    const s = await asking("AskUserQuestion", input);
    expect((await s.mbp.ask(ANSWER(s.rid))).reply).toMatchObject({ ok: false, error: expect.stringMatching(/is a question/) });
    expect((await s.mbp.ask(ANSWER(s.rid, { decision: "answer" }))).reply).toMatchObject({ ok: false, error: 'decision "answer" needs answers' });
    expect((await s.mbp.ask(ANSWER(s.rid, { decision: "answer", answers: { "Which index?": "GiST" } }))).reply).toMatchObject({ ok: true, decision: "answer" });
    expect(await s.result).toEqual({ behavior: "allow", updatedInput: { ...input, answers: { "Which index?": "GiST" } } });
    const q = await asking("AskUserQuestion", input);
    expect((await q.mbp.ask(ANSWER(q.rid, { decision: "deny" }))).reply).toMatchObject({ ok: true, decision: "deny" });
    expect(await q.result).toMatchObject({ behavior: "deny" });
  });

  it("an orphan: resume runs it as a new worker of the same spawner; without resume, a deny dismisses it", async () => {
    const { at, w, r } = leftBehind();
    const net = new FakeNetwork();
    const mbp = await scripted(net);
    const ubu = await boot(net, "ubu1", UBU, at);
    await until(() => mbp.events("settled").length === 1);
    const { reply } = await mbp.ask(ANSWER(r.id));
    expect(reply).toMatchObject({ ok: true, request: r.id, worker_id: w.id, state: "answered", decision: "allow", resumed: expect.stringMatching(/^w_/) });
    expect(ubu.store.worker(reply["resumed"])).toMatchObject({ spawned_by: SUP_MBP, remote_by: "poe", spawn_req: "m_spawn1", resume_session: "sess-old" });
    await until(() => mbp.events("resumed").length === 1);
    expect(mbp.events("resumed")[0]).toMatchObject({ worker: reply["resumed"], previous: w.id, request: r.id });

    const left = leftBehind();
    const net2 = new FakeNetwork();
    const mbp2 = await scripted(net2);
    const ubu2 = await boot(net2, "ubu1", UBU, left.at);
    await until(() => mbp2.events("settled").length === 1);
    expect((await mbp2.ask(ANSWER(left.r.id, { resume: false }))).reply).toMatchObject({ ok: false, error: expect.stringMatching(/^Dismiss .* with decision "deny"/) });
    expect((await mbp2.ask(ANSWER(left.r.id, { decision: "deny", resume: false }))).reply).toEqual(expect.objectContaining({ ok: true, state: "answered", decision: "deny" }));
    expect((await mbp2.ask(ANSWER(left.r.id, { decision: "deny", resume: false }))).reply).toMatchObject({ ok: false });
    expect(ubu2.store.workers().length).toBe(1);
  });
});

describe("the request op (BOB-67 AC 3)", () => {
  it("returns the request in full, for the spawner only", async () => {
    const s = await asking("Bash", PROBE, "  supervisor@mbp-2: { spawn: { studio: [ann, bea] } }\n");
    const { reply } = await s.mbp.ask({ v: 2, op: "request", id: s.rid });
    expect(reply).toMatchObject({ ok: true, request: { id: s.rid, worker_id: s.id, kind: "approval", tool: "Bash", input: JSON.stringify(PROBE), tier: "orchestrator", rule: "probe", state: "open" } });
    expect(reply["truncated"]).toBeUndefined();
    const other = await scripted(s.net, "mbp-2");
    expect((await other.ask({ v: 2, op: "request", id: s.rid })).reply).toMatchObject({ ok: false, error: `${s.rid} isn't a request of a worker supervisor@mbp-2 spawned` });
    expect(audits(s.ubu.store, "remote:refused")[0]).toMatchObject({ actor: "supervisor@mbp-2" });
  });

  it("an oversized input is cut to fit 16 KiB, truncated: true", async () => {
    const s = await asking("Bash", { command: `echo human ${"x\"y ".repeat(10_000)}` });
    const { raw, reply } = await s.mbp.ask({ v: 2, op: "request", id: s.rid });
    expect(raw.length).toBeLessThanOrEqual(16 * 1024);
    expect(reply).toMatchObject({ ok: true, truncated: true, request: { id: s.rid, input: expect.stringMatching(/^\{"command":"echo human .*…$/) } });
  });
});

describe("list carries each worker's open and orphaned requests (ADR 0007 §2)", () => {
  it("the request event's fields and its state; none once settled", async () => {
    const s = await asking();
    const listed = await s.mbp.ask({ v: 2, op: "list", ids: [s.id] });
    const r = s.ubu.store.request(s.rid)!;
    expect(listed.reply["workers"][0]["requests"]).toEqual([{ request: s.rid, kind: "approval", tool: "Bash", tier: "orchestrator", rule: "probe", preview: "echo probe", state: "open", created_at: r.created_at }]);
    await s.mbp.ask(ANSWER(s.rid));
    expect((await s.mbp.ask({ v: 2, op: "list", ids: [s.id] })).reply["workers"][0]["requests"]).toEqual([]);
  });
});

// BOB-68 (B3): one answerer on the target (ADR 0007 §4): its orchestrator neither lists nor answers a
// v: 2 worker's request, nor hears of its end, its Remote Control failing or its restart; its spawner
// does, as events. The worker's preamble names that orchestrator in full (§3).

/** ubu1's MCP tools as its own orchestrator calls them; an error comes back as its text. */
const toolsOf = (sup: Supervisor) => {
  const tools = handlers(sup);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = await callTool(tools, name, args);
    return r.isError ? { error: r.content[0]!.text } : JSON.parse(r.content[0]!.text);
  };
};

describe("one answerer on the target (BOB-68 AC 1)", () => {
  it("pending_requests leaves out a v: 2 worker's request and answer_request refuses it, naming the spawner; a local one's as today; the dashboard lists both", async () => {
    const s = await asking();
    s.ubu.sup.spawn({ project: "studio", role: "bea", task: "local" });
    await until(() => s.ubu.sessions.length === 2);
    const local = s.ubu.sessions[1]!.ask("Bash", PROBE);
    await until(() => s.ubu.store.requests(["open"]).length === 2);
    const lid = s.ubu.store.requests(["open"]).find((r) => r.id !== s.rid)!.id;
    const call = toolsOf(s.ubu.sup);
    expect((await call("pending_requests")).map((r: { id: string }) => r.id)).toEqual([lid]);
    expect(await call("answer_request", { id: s.rid, decision: "allow" })).toEqual({ error: `${s.rid} is ${SUP_MBP}'s worker's; it answers` });
    expect(s.ubu.store.request(s.rid)!.state).toBe("open");
    expect(await call("answer_request", { id: lid, decision: "allow" })).toMatchObject({ id: lid, state: "answered", decision: "allow" });
    expect(await local).toMatchObject({ behavior: "allow" });
    // The dashboard's report still carries the v: 2 worker's request.
    expect(s.ubu.sup.snapshot().pending.map((r) => r.id)).toContain(s.rid);
  });
});

describe("a v: 2 worker's other notices go to its spawner, never the target's orchestrator (BOB-68 AC 2)", () => {
  it("its end: an exit event, no notice to Bob@ubu1; a local worker's end still notifies", async () => {
    const s = await spawned();
    s.ubu.sessions[0]!.finish();
    await until(() => s.mbp.events("exit").length === 1);
    expect(s.mbp.events("exit")[0]).toMatchObject({ worker: s.id, state: "done" });
    s.ubu.sup.spawn({ project: "studio", role: "bea", task: "local" });
    await until(() => s.ubu.sessions.length === 2);
    s.ubu.sessions[1]!.finish();
    await until(() => s.bob().some((b) => b.startsWith("Bea (")));
    expect(s.bob().filter((b) => b.includes(s.id))).toEqual([]);
  });

  it("Remote Control failing: a remote_control event with the error, no notice to Bob@ubu1; a local worker's still notifies", async () => {
    const net = new FakeNetwork();
    const ubu = await boot(net, "ubu1", UBU, newStore(), { remoteControl: false });
    await ubu.link.register({ name: "Bob" });
    const mbp = await scripted(net);
    const id = (await mbp.ask(SPAWN)).reply["worker"].id as string;
    await until(() => mbp.events("remote_control").length === 1);
    expect(mbp.events("remote_control")[0]).toMatchObject({ worker: id, error: expect.stringMatching(/no enableRemoteControl/) });
    const local = ubu.sup.spawn({ project: "studio", role: "bea", task: "local" });
    await until(() => net.between(SUP_UBU, "Bob@ubu1").some((b) => b.includes(`(${local.id}) runs without Remote Control`)));
    expect(net.between(SUP_UBU, "Bob@ubu1").filter((b) => b.includes(id))).toEqual([]);
  });

  it("the restart notice: a v: 2 worker failed and its orphaned request go as exit and settled; the notice names only local ones", async () => {
    const { at, w, r } = leftBehind();
    const lw = at.store.createWorker({ project: "studio", role: "bea", task: "local", handoff: null, priority: 0, resume_session: null });
    at.store.updateWorker(lw.id, { state: "waiting-approval", session_id: "sess-local" });
    const lr = at.store.createRequest({ worker_id: lw.id, kind: "approval", tool: "Bash", input: JSON.stringify(PROBE), tier: "orchestrator", rule: "probe", reason: "the probe" });
    const net = new FakeNetwork();
    const mbp = await scripted(net);
    const bob = net.link("ubu1");
    await bob.register({ name: "Bob" });
    await boot(net, "ubu1", UBU, at);
    await until(() => net.between(SUP_UBU, "Bob@ubu1").some((b) => b.startsWith("Supervisor restarted.")));
    const notice = net.between(SUP_UBU, "Bob@ubu1").find((b) => b.startsWith("Supervisor restarted."))!;
    expect(notice).toContain(`Bea (${lw.id})`);
    expect(notice).toContain(lr.id);
    expect(notice).not.toContain(w.id);
    expect(notice).not.toContain(r.id);
    await until(() => mbp.events("settled").length === 1);
    expect(mbp.events("exit")[0]).toMatchObject({ worker: w.id, state: "failed", error: "supervisor restarted" });
    expect(mbp.events("settled")[0]).toMatchObject({ request: r.id, state: "orphaned" });
  });

  it("the restart notice: none at all when only v: 2 workers were left behind", async () => {
    const { at } = leftBehind();
    const net = new FakeNetwork();
    const mbp = await scripted(net);
    const bob = net.link("ubu1");
    await bob.register({ name: "Bob" });
    await boot(net, "ubu1", UBU, at);
    await until(() => mbp.events("settled").length === 1);
    await tick(20);
    expect(net.between(SUP_UBU, "Bob@ubu1")).toEqual([]);
  });
});

describe("a v: 2 worker's preamble names its orchestrator in full (BOB-68 AC 3)", () => {
  it("<by>@<the requester's laptop>, never a bare name; a local worker's names its project's orchestrator", async () => {
    const s = await spawned();
    const append = (i: number) => (s.ubu.sessions[i]!.options.systemPrompt as { append: string }).append;
    expect(append(0)).toContain("Permission requests and AskUserQuestion go to the orchestrator (poe@mbp-1)");
    expect(append(0)).toContain("message it as poe@mbp-1, in full. A bare name reaches an agent on this laptop.");
    expect(append(0)).not.toMatch(/\(poe\)|\bpoe\b(?!@)/);
    s.ubu.sup.spawn({ project: "studio", role: "bea", task: "local" });
    await until(() => s.ubu.sessions.length === 2);
    expect(append(1)).toMatch(/go to the orchestrator \([^@)]+\)/);
    expect(append(1)).not.toContain("another laptop");
  });
});

describe("Casper answers a remote worker's request on the dashboard (BOB-68 AC 4)", () => {
  it("decided by human on the target; the requester learns from settled and its copy clears", async () => {
    const { ubu, mbp, call } = await real();
    const w = await call("spawn_worker", { project: "studio", role: "ann", task: "one fix", laptop: "ubu1" });
    await until(() => ubu.sessions.length === 1);
    const result = ubu.sessions[0]!.ask("Bash", PROBE);
    await until(() => mbp.store.remoteAsks("ubu1").length === 1);
    const rid = mbp.store.remoteAsks("ubu1")[0]!.id;
    expect(mbp.store.remoteAsk("ubu1", rid)).toMatchObject({ state: "open" });
    ubu.sup.onPush({ t: "action", id: "a_1", to: SUP_UBU, by: "owner@example.com", token: "owner-token", action: { kind: "answer", request: rid, decision: "allow" } } as never);
    expect(await result).toMatchObject({ behavior: "allow" });
    expect(ubu.store.request(rid)).toMatchObject({ state: "answered", decided_by: "human" });
    await until(() => mbp.store.remoteAsk("ubu1", rid)?.state === "answered");
    expect(mbp.store.remoteAsk("ubu1", rid)).toMatchObject({ state: "answered", decision: "allow", decided_by: "human" });
    expect(w.id).toBe(ubu.store.request(rid)!.worker_id);
  });
});

// BOB-69 (B4): the requester's request tools with remote ids (ADR 0007 §5, §4 "The requester shows it
// as its own"): pending_requests lists the remote copies with laptop, request_detail and answer_request
// resolve a remote id to its laptop, the notice reads as a local one's, and a lead's tools stay home.

/** A tool's error text, from the tool as poe calls it. */
async function refusal(tools: ReturnType<typeof handlers>, name: string, args: Record<string, unknown>): Promise<string> {
  const r = await callTool(tools, name, args);
  expect(r.isError).toBe(true);
  return r.content[0]!.text;
}

/** Both supervisors real: one v: 2 worker of mbp-1's on ubu1 with an open request, and its copy on mbp-1. */
async function remoteAsking() {
  const r = await real();
  const w = await r.call("spawn_worker", { project: "studio", role: "ann", task: "one fix", laptop: "ubu1" });
  await until(() => r.ubu.sessions.length === 1);
  const cancel = new AbortController();
  const result = askWith(r.ubu.sessions[0]!, cancel.signal);
  await until(() => r.mbp.store.remoteAsks("ubu1").length === 1);
  return { ...r, w, cancel, result, rid: r.mbp.store.remoteAsks("ubu1")[0]!.id };
}

/** A local worker of mbp-1's (helix/bill) with an open request. */
async function localAsking(mbp: Awaited<ReturnType<typeof boot>>) {
  mbp.sup.spawn({ project: "helix", role: "bill", task: "local" });
  await until(() => mbp.sessions.length === 1);
  const result = mbp.sessions[0]!.ask("Bash", PROBE);
  await until(() => mbp.store.requests(["open"]).length === 1);
  return { result, rid: mbp.store.requests(["open"])[0]!.id };
}

describe("pending_requests, request_detail and answer_request find a remote id (BOB-69 AC 1)", () => {
  it("pending_requests lists local and remote together, each with laptop; a remote one from its copy, with as_of", async () => {
    const s = await remoteAsking();
    const local = await localAsking(s.mbp);
    const rows = (await s.call("pending_requests", {})) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: local.rid, laptop: "mbp-1", project: "helix", tool: "Bash", state: "open" });
    expect(rows[0]).not.toHaveProperty("as_of");
    expect(rows[1]).toEqual({
      id: s.rid,
      worker_id: s.w.id,
      kind: "approval",
      tool: "Bash",
      tier: "orchestrator",
      rule: "probe",
      state: "open",
      created_at: s.ubu.store.request(s.rid)!.created_at,
      worker: "Ann",
      project: "studio",
      preview: "echo probe",
      laptop: "ubu1",
      as_of: s.mbp.store.remoteAsk("ubu1", s.rid)!.as_of,
    });
  });

  it("request_detail and answer_request resolve a remote id to its laptop; laptop, if given, must match", async () => {
    const s = await remoteAsking();
    const tools = handlers(s.mbp.sup);
    expect(await s.call("request_detail", { id: s.rid })).toMatchObject({ id: s.rid, worker_id: s.w.id, input: JSON.stringify(PROBE), state: "open", laptop: "ubu1" });
    expect(await s.call("request_detail", { id: s.rid, laptop: "ubu1" })).toMatchObject({ id: s.rid, laptop: "ubu1" });
    expect(await refusal(tools, "request_detail", { id: s.rid, laptop: "mbp-2" })).toBe(`${s.rid} is a request on ubu1, not mbp-2`);
    expect(await refusal(tools, "answer_request", { id: s.rid, decision: "allow", laptop: "mbp-2" })).toBe(`${s.rid} is a request on ubu1, not mbp-2`);
    expect(s.ubu.store.request(s.rid)!.state).toBe("open");
    expect(await s.call("answer_request", { id: s.rid, decision: "allow", laptop: "ubu1" })).toEqual({ id: s.rid, state: "answered", decision: "allow", laptop: "ubu1" });
    expect(await s.result).toMatchObject({ behavior: "allow" });
  });

  it("an id on two laptops asks for laptop", async () => {
    const r = await real();
    const local = await localAsking(r.mbp);
    // The same id on ubu1 too (ids are random; a clash is rare, not impossible).
    r.mbp.store.putRemoteCopy({ laptop: "ubu1", id: "w_9", to_name: SUP_UBU, spawn_req: null, view: null, state: "running", as_of: "2026-11-17T12:00:00.000Z", ended: 0, handoff: null, remote_url: null, told: 0, state_withheld: 0 });
    r.mbp.store.putRemoteAsk({ laptop: "ubu1", id: local.rid, to_name: SUP_UBU, worker: "w_9", kind: "approval", tool: "Bash", tier: "orchestrator", rule: "probe", preview: "echo probe", created_at: null, state: "open", decision: null, decided_by: null, as_of: "2026-11-17T12:00:00.000Z" });
    const tools = handlers(r.mbp.sup);
    expect(await refusal(tools, "request_detail", { id: local.rid })).toBe(`${local.rid} is a request on mbp-1 and ubu1: say which with laptop`);
    expect(await refusal(tools, "answer_request", { id: local.rid, decision: "allow" })).toBe(`${local.rid} is a request on mbp-1 and ubu1: say which with laptop`);
    expect(await r.call("request_detail", { id: local.rid, laptop: "mbp-1" })).toMatchObject({ id: local.rid, input: JSON.stringify(PROBE) });
  });
});

// BOB-101 (Toad m7): what a reply or event carries, read by the real requester from the real target.
describe("answer_request with both ends real (BOB-101)", () => {
  /** A remote request left open by a restart of ubu1, orphaned at its next start, and that start. */
  async function orphaned() {
    const s = await remoteAsking();
    const closing = s.ubu.sup.shutdown();
    s.cancel.abort();
    await closing;
    running.splice(running.indexOf(s.ubu.sup), 1);
    const again = await boot(s.net, "ubu1", UBU, s.at);
    await until(() => s.mbp.store.remoteAsk("ubu1", s.rid)?.state === "orphaned");
    return { ...s, again };
  }

  it("resume on an orphaned remote request: the reply's resumed, and the resumed event's new copy (AC 1)", async () => {
    const s = await orphaned();
    const spawnReq = s.ubu.store.worker(s.w.id)!.spawn_req;
    const out = await s.call("answer_request", { id: s.rid, decision: "allow" });
    expect(out).toEqual({ id: s.rid, state: "answered", decision: "allow", resumed: expect.stringMatching(/^w_/), laptop: "ubu1" });
    expect(out.resumed).not.toBe(s.w.id);
    expect(s.again.store.worker(out.resumed)).toMatchObject({ spawned_by: SUP_MBP, remote_by: "Bob", spawn_req: spawnReq });
    // The resumed event makes the new worker's copy: same spawn, no "spawned after all".
    await until(() => s.mbp.store.remoteCopy("ubu1", out.resumed) !== null);
    expect(s.mbp.store.remoteCopy("ubu1", out.resumed)).toMatchObject({ to_name: SUP_UBU, spawn_req: spawnReq, ended: 0 });
    expect(s.mbp.store.auditLog(50).filter((a) => a.action === "remote:spawned_after_all")).toEqual([]);
    expect(s.mbp.store.remoteAsk("ubu1", s.rid)).toMatchObject({ state: "answered", decision: "allow" });
    expect(await s.call("pending_requests", {})).toEqual([]);
    await until(() => s.again.sessions.length === 1);
    s.again.sessions[0]!.finish();
    await until(() => s.mbp.store.remoteCopy("ubu1", out.resumed)?.ended === 1);
  });

  it("an orphan whose resume fails on the target: not_resumed through the requester's tool, and no new copy (AC 1, BOB-99)", async () => {
    const s = await orphaned();
    vi.spyOn(s.again.sup, "spawn").mockImplementation(() => {
      throw new SupervisorError("no room");
    });
    const out = await s.call("answer_request", { id: s.rid, decision: "allow" });
    expect(out).toEqual({ id: s.rid, state: "answered", decision: "allow", not_resumed: `${s.rid} is answered, but ${s.w.id} didn't resume: no room`, laptop: "ubu1" });
    expect(s.mbp.store.remoteAsk("ubu1", s.rid)).toMatchObject({ state: "answered" });
    await tick(20);
    expect(s.mbp.store.remoteCopies("ubu1").map((c) => c.id)).toEqual([s.w.id]);
  });

  it("a question answered through the requester's tool: answers reach the worker (AC 2)", async () => {
    const r = await real();
    await r.call("spawn_worker", { project: "studio", role: "ann", task: "one fix", laptop: "ubu1" });
    await until(() => r.ubu.sessions.length === 1);
    const input = { questions: [{ question: "Which index?", header: "Index", options: [{ label: "GiST" }, { label: "BRIN" }], multiSelect: false }] };
    const result = r.ubu.sessions[0]!.ask("AskUserQuestion", input);
    await until(() => r.mbp.store.remoteAsks("ubu1").length === 1);
    const rid = r.mbp.store.remoteAsks("ubu1")[0]!.id;
    expect(r.mbp.store.remoteAsk("ubu1", rid)).toMatchObject({ kind: "question", tool: "AskUserQuestion", state: "open" });
    const out = await r.call("answer_request", { id: rid, decision: "answer", answers: { "Which index?": "GiST" } });
    expect(out).toEqual({ id: rid, state: "answered", decision: "answer", laptop: "ubu1" });
    expect(await result).toEqual({ behavior: "allow", updatedInput: { ...input, answers: { "Which index?": "GiST" } } });
    expect(r.ubu.store.request(rid)).toMatchObject({ state: "answered", decision: "answer", answers: JSON.stringify({ "Which index?": "GiST" }) });
    expect(r.mbp.store.remoteAsk("ubu1", rid)).toMatchObject({ state: "answered", decision: "answer" });
  });
});

describe("answer_request for a remote id: the target's result; the copy clears with settled (BOB-69 AC 2)", () => {
  it("sends answer, returns the target's reply; the reply's state updates the copy, and its settled changes nothing more (BOB-97 AC 3)", async () => {
    const t = await playedTarget();
    await t.deliver(t.request());
    t.replies.to = (b) => (b["op"] === "answer" ? { ok: true, request: "r_1", worker_id: "w_9", state: "answered", decision: "allow" } : null);
    const tools = handlers(t.mbp.sup);
    const got = JSON.parse((await callTool(tools, "answer_request", { id: "r_1", decision: "allow", message: "go" })).content[0]!.text);
    expect(t.asked.filter((b) => b["op"] === "answer")).toEqual([{ v: 2, op: "answer", id: "r_1", decision: "allow", message: "go", user_decided: false, resume: true }]);
    // A target before ADR 0013 replies without note_delivered: it dropped the note.
    expect(got).toEqual({ id: "r_1", state: "answered", decision: "allow", note_delivered: false, note: "not delivered: ubu1's supervisor is older and drops a note sent with allow", laptop: "ubu1" });
    // The reply alone settles the copy, should its settled be missed; decided by whom the answer said.
    expect(t.ask()).toMatchObject({ state: "answered", decision: "allow", decided_by: "orchestrator" });
    expect(JSON.parse((await callTool(tools, "pending_requests", {})).content[0]!.text)).toEqual([]);
    await t.deliver(t.settled("answered", { decision: "allow", decided_by: "orchestrator" }));
    expect(t.ask()).toMatchObject({ state: "answered", decision: "allow", decided_by: "orchestrator" });
  });

  it("a refusal (another worker's request) comes back as the tool's error", async () => {
    const s = await remoteAsking();
    // A local worker of ubu1's asks too; mbp-1 holds a copy naming its request as its own worker's.
    s.ubu.sup.spawn({ project: "studio", role: "bea", task: "local" });
    await until(() => s.ubu.sessions.length === 2);
    void s.ubu.sessions[1]!.ask("Bash", PROBE);
    await until(() => s.ubu.store.requests(["open"]).length === 2);
    const theirs = s.ubu.store.requests(["open"]).find((r) => r.id !== s.rid)!.id;
    s.mbp.store.putRemoteAsk({ ...s.mbp.store.remoteAsk("ubu1", s.rid)!, id: theirs });
    expect(await refusal(handlers(s.mbp.sup), "answer_request", { id: theirs, decision: "allow" })).toBe(`${theirs} isn't a request of a worker ${SUP_MBP} spawned`);
    expect(s.ubu.store.request(theirs)!.state).toBe("open");
  });

  it("a refusal (the entry no longer lists the role) comes back as the tool's error (criterion 6)", async () => {
    const s = await remoteAsking();
    const closing = s.ubu.sup.shutdown();
    s.cancel.abort();
    await closing;
    running.splice(running.indexOf(s.ubu.sup), 1);
    // Casper took ann out of mbp-1's entry; ubu1 read its config again at start, and orphaned the request.
    const again = await boot(s.net, "ubu1", UBU.replace("studio: [ann, bea]", "studio: [bea]"), s.at);
    await until(() => s.mbp.store.remoteAsk("ubu1", s.rid)?.state === "orphaned");
    expect(await refusal(handlers(s.mbp.sup), "answer_request", { id: s.rid, decision: "allow" })).toBe(`${SUP_MBP} may no longer spawn studio/ann here, so it can't act on ${s.rid}`);
    expect(again.store.request(s.rid)!.state).toBe("orphaned");
  });
});

describe("a remote worker's request reaches the orchestrator as a local one's (BOB-69 AC 3)", () => {
  it("an approval and a question, told through notify with the id and laptop; an orphaned one says answering resumes it", async () => {
    const t = await playedTarget();
    await t.deliver(t.request(), t.request({ request: "r_2", kind: "question", tool: "AskUserQuestion", tier: "orchestrator", rule: null, preview: "Which one?" }));
    await until(() => t.net.between(SUP_MBP, "Bob@mbp-1").length === 2);
    expect(t.net.between(SUP_MBP, "Bob@mbp-1")).toEqual([
      "ann@ubu1 needs approval for Bash (r_1, ubu1, orchestrator decides; rule probe): echo probe. See pending_requests and answer with answer_request.",
      "ann@ubu1 asks a question (r_2, ubu1). See pending_requests and answer with answer_request.",
    ]);
    // A request event again (a resend) tells nothing new.
    await t.deliver(t.request(), t.settled("orphaned"));
    await until(() => t.net.between(SUP_MBP, "Bob@mbp-1").length === 3);
    expect(t.net.between(SUP_MBP, "Bob@mbp-1")[2]).toBe("ann@ubu1's request r_1 (Bash, ubu1) was orphaned by a restart there: answering it with answer_request resumes the worker; deny with resume: false closes it.");
  });

  it("on the real target: the notice names the worker as ubu1 names it, and Bob@ubu1 hears nothing", async () => {
    const s = await remoteAsking();
    await until(() => s.net.between(SUP_MBP, "Bob@mbp-1").some((b) => b.includes(s.rid)));
    expect(s.net.between(SUP_MBP, "Bob@mbp-1").filter((b) => b.includes(s.rid))).toEqual([`Ann@ubu1 needs approval for Bash (${s.rid}, ubu1, orchestrator decides; rule probe): echo probe. See pending_requests and answer with answer_request.`]);
    expect(s.net.between(SUP_UBU, "Bob@ubu1").filter((b) => b.includes(s.rid))).toEqual([]);
  });
});

describe("a lead's tools stay on its laptop (BOB-69 AC 4)", () => {
  it("a lead's pending_requests lists no remote request; request_detail and answer_request refuse a remote id", async () => {
    const s = await remoteAsking();
    const local = await localAsking(s.mbp);
    const lead = handlers(s.mbp.sup, { lead: "w_lead" });
    const rows = JSON.parse((await callTool(lead, "pending_requests", {})).content[0]!.text) as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r["id"], r["laptop"]])).toEqual([[local.rid, "mbp-1"]]);
    const away = `A lead's tools act on its own laptop only (mbp-1); ${s.rid} is a request on another laptop, the orchestrator's`;
    expect(await refusal(lead, "request_detail", { id: s.rid })).toBe(away);
    expect(await refusal(lead, "answer_request", { id: s.rid, decision: "allow" })).toBe(away);
    expect(await refusal(lead, "answer_request", { id: local.rid, decision: "allow", laptop: "ubu1" })).toBe("A lead's tools act on its own laptop only (mbp-1); laptop ubu1 is the orchestrator's");
    expect(s.ubu.store.request(s.rid)!.state).toBe("open");
    expect(await callTool(lead, "answer_request", { id: local.rid, decision: "allow" })).not.toHaveProperty("isError");
  });

  it("the slot tools and reset_worker refuse another laptop, the orchestrator's and a lead's", async () => {
    const r = await real();
    const calls: Array<[string, Record<string, unknown>]> = [
      ["run_slots", {}],
      ["take_slot", { project: "helix", name: "x", label: "probe" }],
      ["free_slot", { name: "x" }],
      ["order_run_queue", { names: ["x"] }],
      ["reset_worker", { id: "w_1" }],
    ];
    for (const [name, args] of calls) {
      expect(await refusal(handlers(r.mbp.sup), name, { ...args, laptop: "ubu1" })).toBe(`${name} acts on this laptop only (mbp-1); ubu1's is its own orchestrator's`);
      expect(await refusal(handlers(r.mbp.sup, { lead: "w_lead" }), name, { ...args, laptop: "ubu1" })).toBe("A lead's tools act on its own laptop only (mbp-1); laptop ubu1 is the orchestrator's");
    }
  });
});

describe("poe answers a remote request exactly as a local one (BOB-69 AC 5)", () => {
  it("one tool, the same arguments, no laptop: one local and one remote request answered", async () => {
    const s = await remoteAsking();
    const local = await localAsking(s.mbp);
    const out: unknown[] = [];
    for (const id of [local.rid, s.rid]) out.push(await s.call("answer_request", { id, decision: "allow" }));
    expect(out).toEqual([
      { id: local.rid, state: "answered", decision: "allow" },
      { id: s.rid, state: "answered", decision: "allow", laptop: "ubu1" },
    ]);
    expect(await local.result).toMatchObject({ behavior: "allow" });
    expect(await s.result).toMatchObject({ behavior: "allow" });
    await until(() => s.mbp.store.remoteAsk("ubu1", s.rid)?.state === "answered");
    expect(await s.call("pending_requests", {})).toEqual([]);
  });
});

// BOB-97 (review B F1; Toad's M1, independent m2, m3): a request copy whose `settled` was missed is
// finalised by a full list that leaves it out (`gone`), bounded to a day in pending_requests, pruned a
// day after it is final, settled by the `answer` reply too; and a copy's view keeps no `requests`.

const DAY_MS = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** The played target's list reply: w_9 as ubu1 shows it, with `requests` as given (none: an older target's view). */
function listReply(t: Awaited<ReturnType<typeof playedTarget>>, requests?: unknown[], over: Record<string, unknown> = {}) {
  t.replies.to = (b) => (b["op"] === "list" ? { ok: true, workers: [{ id: "w_9", project: "studio", role: "ann", state: "running", spawn_req: t.request()["spawn_req"], ...(requests ? { requests } : {}) }], ...over } : null);
}

describe("a copy that missed its settled is finalised by a full list (BOB-97 AC 1)", () => {
  it("open with no settled, then a list showing the worker with requests: [] makes it gone, and pending_requests is empty (Toad M1)", async () => {
    const t = await playedTarget();
    await t.deliver(t.request({ created_at: new Date().toISOString() }));
    expect(JSON.parse((await callTool(handlers(t.mbp.sup), "pending_requests", {})).content[0]!.text)).toHaveLength(1);
    listReply(t, []);
    await t.mbp.sup.reconcile();
    expect(t.asked.filter((b) => b["op"] === "list")).toHaveLength(1);
    expect(t.ask()).toMatchObject({ state: "gone", decision: null, decided_by: null, preview: "echo probe" });
    expect(JSON.parse((await callTool(handlers(t.mbp.sup), "pending_requests", {})).content[0]!.text)).toEqual([]);
  });

  it("an orphaned copy left out is gone too; one the list still names stays as it is", async () => {
    const t = await playedTarget();
    await t.deliver(t.request(), t.settled("orphaned"), t.request({ request: "r_2" }));
    listReply(t, [{ request: "r_2", kind: "approval", tool: "Bash", tier: "orchestrator", rule: "probe", preview: "echo probe", state: "open", created_at: "2026-11-17T12:00:00.000Z" }]);
    await t.mbp.sup.reconcile();
    expect(t.ask()).toMatchObject({ state: "gone" });
    expect(t.mbp.store.remoteAsk("ubu1", "r_2")).toMatchObject({ state: "open" });
  });

  it("a view with no requests key (a target before rc.43) changes nothing (Toad M1)", async () => {
    const t = await playedTarget();
    await t.deliver(t.request());
    listReply(t);
    await t.mbp.sup.reconcile();
    expect(t.asked.filter((b) => b["op"] === "list")).toHaveLength(1);
    expect(t.ask()).toMatchObject({ state: "open" });
  });

  it("a list cut to fit (truncated) changes nothing", async () => {
    const t = await playedTarget();
    await t.deliver(t.request());
    listReply(t, [], { truncated: true });
    await t.mbp.sup.reconcile();
    expect(t.ask()).toMatchObject({ state: "open" });
  });

  it("a copy changed after the list was sent (its request event overtook the reply) is left open", async () => {
    const t = await playedTarget();
    await t.deliver(t.request());
    t.mbp.store.putRemoteAsk({ ...t.ask()!, as_of: new Date(Date.now() + 60_000).toISOString() });
    listReply(t, []);
    await t.mbp.sup.reconcile();
    expect(t.ask()).toMatchObject({ state: "open" });
  });

  it("gone is final against a request or orphaned, but the target's own answered or expired replaces it", async () => {
    const t = await playedTarget();
    await t.deliver(t.request());
    listReply(t, []);
    await t.mbp.sup.reconcile();
    await t.deliver(t.request(), t.settled("orphaned"));
    expect(t.ask()).toMatchObject({ state: "gone" });
    await t.deliver(t.settled("answered", { decision: "allow", decided_by: "human" }));
    expect(t.ask()).toMatchObject({ state: "answered", decision: "allow", decided_by: "human" });
  });

  it("both ends real: a settled lost while mbp-1 was away a day; list_workers finalises the copy (the independent probe's case)", async () => {
    const s = await remoteAsking();
    s.net.disconnect("mbp-1");
    s.ubu.sup.answer(s.rid, { decision: "allow" }, "orchestrator");
    expect(await s.result).toMatchObject({ behavior: "allow" });
    expect(s.ubu.store.request(s.rid)).toMatchObject({ state: "answered" });
    // The settled expires at the broker before mbp-1 is back.
    s.net.advance(86_401);
    s.net.sweep();
    expect(s.mbp.store.remoteAsk("ubu1", s.rid)).toMatchObject({ state: "open" });
    // Back, its reconcile on connect lists the worker with requests: [], so the copy is final.
    await s.net.reconnect("mbp-1");
    await until(() => s.mbp.store.remoteAsk("ubu1", s.rid)?.state === "gone");
    expect(await s.call("pending_requests", {})).toEqual([]);
    const rows = (await s.call("list_workers", { laptop: "ubu1" })) as Array<Record<string, unknown>>;
    expect(rows.find((r) => r["id"] === s.w.id)).not.toHaveProperty("requests");
    expect(s.mbp.store.remoteAsk("ubu1", s.rid)).toMatchObject({ state: "gone" });
  });
});

describe("pending_requests and the copies are bounded to a day (BOB-97 AC 2)", () => {
  it("leaves out an open or orphaned copy over a day old", async () => {
    const t = await playedTarget();
    await t.deliver(t.request());
    const ask = (id: string, state: string, created_at: string) => t.mbp.store.putRemoteAsk({ ...t.ask()!, id, state, created_at });
    ask("r_old", "open", ago(DAY_MS + 60_000));
    ask("r_orph", "orphaned", ago(DAY_MS + 60_000));
    ask("r_new", "orphaned", ago(DAY_MS - 60_000));
    ask("r_1", "open", ago(1000));
    const rows = JSON.parse((await callTool(handlers(t.mbp.sup), "pending_requests", {})).content[0]!.text) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r["id"]).sort()).toEqual(["r_1", "r_new"]);
  });

  it("a copy with no created_at (made by a settled) is aged by its as_of", async () => {
    const t = await playedTarget();
    await t.deliver(t.settled("orphaned"));
    t.mbp.store.putRemoteAsk({ ...t.ask()!, as_of: ago(DAY_MS + 60_000) });
    expect(t.mbp.sup.remotePending()).toEqual([]);
  });

  it("reconcile prunes final copies a day old; open ones and newer final ones stay", async () => {
    const t = await playedTarget();
    await t.deliver(t.request());
    const ask = (id: string, state: string, as_of: string) => t.mbp.store.putRemoteAsk({ ...t.ask()!, id, state, as_of });
    for (const state of ["answered", "expired", "gone"]) ask(`r_${state}`, state, ago(DAY_MS + 60_000));
    ask("r_open", "open", ago(DAY_MS + 60_000));
    ask("r_fresh", "answered", ago(60_000));
    listReply(t, [{ request: "r_1", state: "open" }, { request: "r_open", state: "open" }]);
    await t.mbp.sup.reconcile();
    expect(t.mbp.store.remoteAsks("ubu1").map((a) => a.id).sort()).toEqual(["r_1", "r_fresh", "r_open"]);
  });
});

describe("a copy keeps no stale requests list (BOB-97 AC 3)", () => {
  it("copyView strips requests: list_workers and worker_status show none, before and after the answer", async () => {
    const s = await remoteAsking();
    await s.call("list_workers", { laptop: "ubu1" });
    const c = s.mbp.store.remoteCopy("ubu1", s.w.id)!;
    expect(JSON.parse(c.view!)).not.toHaveProperty("requests");
    expect(s.mbp.sup.copyRow(c)).not.toHaveProperty("requests");
    expect(await s.call("answer_request", { id: s.rid, decision: "allow" })).toEqual({ id: s.rid, state: "answered", decision: "allow", laptop: "ubu1" });
    expect(s.mbp.store.remoteAsk("ubu1", s.rid)).toMatchObject({ state: "answered", decision: "allow", decided_by: "orchestrator" });
    expect(await s.call("worker_status", { id: s.w.id })).not.toHaveProperty("requests");
    expect((await s.call("list_workers", { laptop: "ubu1" })).find((r: Record<string, unknown>) => r["id"] === s.w.id)).not.toHaveProperty("requests");
  });
});

describe("one answerer for a worker spawned without v: 2; a v: 2 spawn's by is a BobNet name (BOB-98)", () => {
  it("the answer op refuses a v-less worker's request: its requests are answered on the target (AC 1); request still reads it", async () => {
    const net = new FakeNetwork();
    const ubu = await boot(net, "ubu1", UBU);
    await ubu.link.register({ name: "Bob" });
    const mbp = await scripted(net);
    const { reply: spawn } = await mbp.ask({ op: "spawn", project: "studio", role: "ann", task: "one fix" });
    expect(spawn).toMatchObject({ ok: true });
    await until(() => ubu.sessions.length === 1);
    const result = ubu.sessions[0]!.ask("Bash", PROBE);
    await until(() => ubu.store.requests(["open"]).length === 1);
    const r = ubu.store.requests(["open"])[0]!;
    const { reply } = await mbp.ask(ANSWER(r.id));
    expect(reply).toMatchObject({ v: 2, re: "answer", ok: false, error: `${r.id} is a request of a worker spawned without v: 2: its requests are answered on ubu1` });
    expect(ubu.store.request(r.id)!.state).toBe("open");
    expect(audits(ubu.store, "remote:refused")[0]).toMatchObject({ actor: SUP_MBP, detail: { request: r.id, decision: "allow" } });
    expect((await mbp.ask({ v: 2, op: "request", id: r.id })).reply).toMatchObject({ ok: true, request: { id: r.id, state: "open" } });
    expect(mbp.events("request")).toEqual([]);
    void result;
  });

  it("a v: 2 spawn whose by isn't a valid segment is refused, and nothing is spawned (AC 2)", async () => {
    const net = new FakeNetwork();
    const ubu = await boot(net, "ubu1", UBU);
    const mbp = await scripted(net);
    for (const by of ["p".repeat(41), "poe the lead", "1poe", "poe@mbp-1"]) {
      const { reply } = await mbp.ask({ ...SPAWN, by });
      expect(reply).toMatchObject({ v: 2, re: "spawn", ok: false, error: expect.stringMatching(/^by ".*" isn't a BobNet name/) });
    }
    expect(ubu.store.workers()).toEqual([]);
    expect((await mbp.ask({ ...SPAWN, by: "p".repeat(32) })).reply).toMatchObject({ ok: true, worker: { state: expect.any(String) } });
  });
});

describe("fitRequest cuts answers, and a request still over goes with its input a stub (BOB-99 AC 1)", () => {
  const FIT = LIMITS.bodyChars - 1024;
  const row = (over: Partial<RequestRow> = {}): RequestRow => ({ id: "r_1", worker_id: "w_1", kind: "question", tool: "AskUserQuestion", input: "{}", tier: "orchestrator", rule: "probe", reason: "the probe", state: "answered", decision: "answer", message: null, answers: null, decided_by: "orchestrator", created_at: "2026-11-21T10:00:00.000Z", decided_at: "2026-11-21T10:01:00.000Z", via: null, ...over });

  it("large answers are cut until the request fits, truncated: true", () => {
    const answers = JSON.stringify({ "Which index?": "GiST ".repeat(8_000) });
    const out = fitRequest(row({ input: "x".repeat(4_000), answers }));
    expect(out.truncated).toBe(true);
    expect(JSON.stringify({ request: out.request }).length).toBeLessThanOrEqual(FIT);
    expect(out.request.answers!.length).toBeLessThan(answers.length);
    expect(out.request.answers).toMatch(/^\{"Which index\?":"GiST .*…$/);
  });

  it("over with every field cut (a long tool), the input goes as a stub, and the result fits", () => {
    const pad = FIT - JSON.stringify({ request: row({ input: "…", tool: "" }) }).length - 10;
    const out = fitRequest(row({ input: "x".repeat(4_000), tool: "T".repeat(pad) }));
    expect(out).toMatchObject({ truncated: true, request: { input: "…", tool: "T".repeat(pad) } });
    expect(JSON.stringify({ request: out.request }).length).toBeLessThanOrEqual(FIT);
  });

  it("both ends real: a question answered with large answers reads back through the request op in 16 KiB, truncated", async () => {
    const input = { questions: [{ question: "Which index?", header: "Index", options: [{ label: "GiST" }, { label: "BRIN" }], multiSelect: false }] };
    const s = await asking("AskUserQuestion", input);
    s.ubu.store.settleRequest(s.rid, { state: "answered", decision: "answer", message: null, answers: JSON.stringify({ "Which index?": "GiST ".repeat(8_000) }), decided_by: "orchestrator" });
    const { raw, reply } = await s.mbp.ask({ v: 2, op: "request", id: s.rid });
    expect(raw.length).toBeLessThanOrEqual(16 * 1024);
    expect(reply).toMatchObject({ ok: true, truncated: true, request: { id: s.rid, state: "answered", answers: expect.stringMatching(/…$/) } });
  });
});

describe("a withheld reply's advice fits its op (BOB-99 AC 2, Toad m5)", () => {
  it("answer: the answer may have been taken; request: ask the role there or the dashboard; tail: list_workers", async () => {
    const t = await playedTarget();
    await t.deliver(t.request());
    t.replies.to = () => ({ event: "withheld" });
    const tools = handlers(t.mbp.sup);
    expect(await refusal(tools, "answer_request", { id: "r_1", decision: "allow" })).toBe("ubu1's reply to the answer was withheld (it looked like a credential to the broker); the answer may have been taken: pending_requests drops r_1 when its settled comes");
    expect(await refusal(tools, "request_detail", { id: "r_1" })).toBe("ubu1's reply to the request was withheld (it looked like a credential to the broker); ask the role on ubu1, or see r_1 on the dashboard");
    expect(await refusal(tools, "tail_worker", { id: "w_9", laptop: "ubu1" })).toMatch(/was withheld .*; list_workers with laptop "ubu1" shows what ran$/);
    expect(t.ask()).toMatchObject({ state: "open" });
  });
});

describe("the answer op audits what happened (BOB-99 AC 3, independent m5)", () => {
  it("an answer applied whose reply is withheld: audited remote:answer (withheld: true) besides remote:withheld, not refused", async () => {
    const net = new FakeNetwork();
    const ubu = await boot(net, "ubu1", UBU, newStore(), { detect: (t) => (/"re":"answer".*"state":"answered"/.test(t) ? "test_secret" : null) });
    await ubu.link.register({ name: "Bob" });
    const mbp = await scripted(net);
    const id = (await mbp.ask(SPAWN)).reply["worker"].id as string;
    await until(() => ubu.sessions.length === 1);
    const result = ubu.sessions[0]!.ask("Bash", PROBE);
    await until(() => mbp.events("request").length === 1);
    const rid = mbp.events("request")[0]!["request"] as string;
    const { id: msg, reply } = await mbp.ask(ANSWER(rid));
    expect(reply).toEqual({ v: 2, event: "withheld", re: "answer", req: msg });
    expect(await result).toMatchObject({ behavior: "allow" });
    expect(ubu.store.request(rid)!.state).toBe("answered");
    expect(audits(ubu.store, "remote:answer")).toEqual([expect.objectContaining({ actor: SUP_MBP, worker_id: id, detail: { message: msg, request: rid, decision: "allow", by: "orchestrator", withheld: true } })]);
    expect(audits(ubu.store, "remote:withheld")).toEqual([expect.objectContaining({ detail: { message: msg, re: "answer" } })]);
    expect(audits(ubu.store, "remote:refused")).toEqual([]);
  });

  it("an orphan whose resume spawn() throws: answered, not resumed, audited remote:answer with the error, and the reply says so", async () => {
    const { at, w, r } = leftBehind();
    const net = new FakeNetwork();
    const mbp = await scripted(net);
    const ubu = await boot(net, "ubu1", UBU, at);
    await until(() => mbp.events("settled").length === 1);
    vi.spyOn(ubu.sup, "spawn").mockImplementation(() => {
      throw new SupervisorError("no room");
    });
    const { id: msg, reply } = await mbp.ask(ANSWER(r.id));
    const said = `${r.id} is answered, but ${w.id} didn't resume: no room`;
    expect(reply).toEqual({ v: 2, re: "answer", req: msg, ok: true, request: r.id, worker_id: w.id, state: "answered", decision: "allow", resume_error: said });
    expect(ubu.store.request(r.id)).toMatchObject({ state: "answered", decision: "allow" });
    expect(audits(ubu.store, "remote:answer")).toEqual([expect.objectContaining({ worker_id: w.id, detail: { message: msg, request: r.id, decision: "allow", by: "orchestrator", resumed: false, resume_error: said } })]);
    expect(audits(ubu.store, "remote:refused")).toEqual([]);
    expect(mbp.events("resumed")).toEqual([]);
    // Asked again, it is already answered: nothing resumes later by surprise.
    expect((await mbp.ask(ANSWER(r.id))).reply).toMatchObject({ ok: false, error: `${r.id} is already answered` });
  });

  it("the requester's answer_request passes it on as not_resumed, and the copy is answered", async () => {
    const t = await playedTarget();
    await t.deliver(t.request(), t.settled("orphaned"));
    t.replies.to = (b) => (b["op"] === "answer" ? { ok: true, request: "r_1", worker_id: "w_9", state: "answered", decision: "allow", resume_error: "r_1 is answered, but w_9 didn't resume: no room" } : null);
    const out = JSON.parse((await callTool(handlers(t.mbp.sup), "answer_request", { id: "r_1", decision: "allow" })).content[0]!.text);
    expect(out).toEqual({ id: "r_1", state: "answered", decision: "allow", not_resumed: "r_1 is answered, but w_9 didn't resume: no room", laptop: "ubu1" });
    expect(t.ask()).toMatchObject({ state: "answered", decision: "allow" });
  });
});
