import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrokerError } from "@bobnet/client/connection";
import type { Envelope } from "@bobnet/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { GhCiPoll } from "../src/ci-poll.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { fitLines, Supervisor } from "../src/supervisor.ts";
import { fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";
import { FakeNetwork, type FakeLink } from "./network.ts";

// The target's side of a `v: 2` request (ADR 0007 §3, BOB-62): a spawn starts now under the
// target's own config or is refused with the reason, never queued; its role and a place are
// reserved through the board join; status, stop, list, tail and summary answer only for the
// sender's own workers. On the FakeNetwork: ubu1's supervisor is real, mbp-1's and pi's scripted.

const POLICY = new Policy(`rules: []`);
const PROJECTS = `  studio:
    path: /work/studio
    roles:
      ann: { dir: /work/studio-ann, model: claude-sonnet-5-5 }
      bea: { dir: /work/studio-bea }
      cal: { dir: /work/studio-cal }
  works:
    path: /work/works
    board: service
    roles:
      kim: { dir: /work/works-kim }
`;
const REMOTE = `remote:
  supervisor@mbp-1: { spawn: { studio: [ann, bea, cal], works: [kim] } }
  supervisor@pi: { spawn: { studio: [bea] } }
`;
const SUP_MBP = "supervisor@mbp-1";
const SUP_PI = "supervisor@pi";
const SUP_UBU = "supervisor@ubu1";
const SPAWN = { v: 2, op: "spawn", project: "studio", role: "ann", task: "one fix", by: "poe" } as const;
const BOARD_SPAWN = { v: 2, op: "spawn", project: "works", role: "kim", task: "build it", tasks: ["WRK-1"], session: { feature: "WRK-1", kind: "build" }, by: "poe" } as const;

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

/** ubu1's real supervisor (concurrency 2), and two scripted requesters, mbp-1 and pi. */
async function setup() {
  const net = new FakeNetwork();
  const dir = mkdtempSync(join(tmpdir(), "bobnet-target-"));
  dirs.push(dir);
  const store = new Store(join(dir, "supervisor.db"));
  stores.add(store);
  const link = net.link("ubu1");
  const { queryFn, sessions } = fakeQuery();
  const ciPoll = new GhCiPoll(quiet, async () => {
    throw new Error("no gh in tests");
  });
  const sup = new Supervisor({ config: testConfig(dir, `${PROJECTS}${REMOTE}`), policy: POLICY, store, broker: link, queryFn, log: quiet, sandboxCheck: async () => null, ownerCheck: async () => false, sleep: net.sleep, ciPoll });
  link.onPush = (f) => sup.onPush(f);
  await sup.start();
  running.push(sup);
  const mbp = await scripted(net, "mbp-1");
  const pi = await scripted(net, "pi");
  return { net, sup, store, link, sessions, mbp, pi };
}

async function scripted(net: FakeNetwork, laptop: string): Promise<{ link: FakeLink; got: Envelope[]; ask: (body: unknown) => Promise<{ id: string; reply: Record<string, any> }> }> {
  const link = net.link(laptop);
  const got: Envelope[] = [];
  link.onPush = (f) => {
    if (f.t === "deliver") got.push(f.msg);
  };
  await link.register({ name: "supervisor" });
  /** Sends ubu1's supervisor a request; resolves with its message id and the reply. */
  const ask = async (body: unknown) => {
    const sent = await link.request<{ id: string }>({ t: "send", as: "supervisor", to: [SUP_UBU], body: typeof body === "string" ? body : JSON.stringify(body) });
    await until(() => got.some((m) => m.in_reply_to === sent.id));
    return { id: sent.id, reply: JSON.parse(got.find((m) => m.in_reply_to === sent.id)!.body) as Record<string, any> };
  };
  return { link, got, ask };
}

/** The board join waits until released, or fails with `code` when told. */
function slowJoin(link: FakeLink): { joining: () => boolean; release: () => void; fail: (code: string) => void } {
  let release = () => {};
  let fail: (code: string) => void = () => {};
  let joining = false;
  const original = link.boardOp.bind(link);
  link.boardOp = (async (as: string, op: Parameters<FakeLink["boardOp"]>[1], ctx?: Parameters<FakeLink["boardOp"]>[2]) => {
    if (op.op === "session_join" && !joining) {
      joining = true;
      await new Promise<void>((resolve, reject) => {
        release = resolve;
        fail = (code) => reject(new BrokerError(code as ConstructorParameters<typeof BrokerError>[0], "no grant for kim on ubu1"));
      });
    }
    return original(as, op, ctx);
  }) as FakeLink["boardOp"];
  return { joining: () => joining, release: () => release(), fail: (code) => fail(code) };
}

const refusals = (store: Store) => store.auditLog(100).filter((a) => a.action === "remote:refused");

describe("a v: 2 spawn starts now, under the target's own config (criterion 1)", () => {
  it("runs the worker on ubu1 with spawned_by the sender, remote_by its by and spawn_req the message id", async () => {
    const { store, sessions, mbp } = await setup();
    const { id: req, reply } = await mbp.ask(SPAWN);
    expect(reply).toMatchObject({ v: 2, re: "spawn", req, ok: true, worker: { project: "studio", role: "ann", as: "worker", state: "running", spawn_req: req } });
    const w = store.worker(reply["worker"].id)!;
    expect(w).toMatchObject({ spawned_by: SUP_MBP, remote_by: "poe", spawn_req: req, run_as: "worker", state: "running" });
    // The target's role config decides what it runs on, and its own session runs it.
    expect(w.model).toBe("claude-sonnet-5-5");
    expect(sessions).toHaveLength(1);
    expect(store.auditLog(20).find((a) => a.action === "remote:spawn")).toMatchObject({ actor: SUP_MBP, worker_id: w.id });
    expect(JSON.parse(store.auditLog(20).find((a) => a.action === "spawn")!.detail)).toMatchObject({ spawn_req: req, by: "poe" });
    // Its events are v: 2 and name the spawn that made it.
    await until(() => mbp.got.some((m) => m.body.includes('"event":"remote_control"')));
    expect(JSON.parse(mbp.got.find((m) => m.body.includes('"event":"remote_control"'))!.body)).toEqual({ v: 2, event: "remote_control", worker: w.id, spawn_req: req, url: "https://claude.ai/code/session_test" });
  });
});

describe("never queued: refused at once where a local spawn would queue (criterion 2)", () => {
  it("refuses when the role already has a worker running: no row, nothing queued", async () => {
    const { sup, store, mbp } = await setup();
    sup.spawn({ project: "studio", role: "ann", task: "local work" });
    const { reply } = await mbp.ask(SPAWN);
    expect(reply).toMatchObject({ ok: false, error: "Ann isn't spawned: studio/ann already has a worker running" });
    expect(store.workers({ project: "studio" })).toHaveLength(1);
    expect(store.queued()).toEqual([]);
    expect(refusals(store)).toMatchObject([{ actor: SUP_MBP, detail: expect.stringContaining("already has a worker running") }]);
  });

  it("refuses when the laptop is at its concurrency: no row, nothing queued", async () => {
    const { sup, store, mbp } = await setup();
    sup.spawn({ project: "studio", role: "bea", task: "one" });
    sup.spawn({ project: "studio", role: "cal", task: "two" });
    const { reply } = await mbp.ask(SPAWN);
    expect(reply).toMatchObject({ ok: false, error: "Ann isn't spawned: 2 workers running, the laptop's limit" });
    expect(store.workers({ project: "studio" })).toHaveLength(2);
    expect(store.queued()).toEqual([]);
  });
});

describe("the reservation through the board join (criterion 3)", () => {
  it("holds the role and a place while it joins: a racing spawn of the role is refused busy, another at the limit too, a local one waits", async () => {
    const { sup, store, link, sessions, mbp } = await setup();
    const join = slowJoin(link);
    sup.spawn({ project: "studio", role: "bea", task: "local" });
    const first = mbp.ask(BOARD_SPAWN);
    await until(() => join.joining());
    // Two spawns racing during the join: the second is refused busy.
    const { reply: second } = await mbp.ask({ ...BOARD_SPAWN, task: "again" });
    expect(second).toMatchObject({ ok: false, error: "Kim isn't spawned: works/kim already has a worker starting" });
    // bea and the reservation fill the laptop's two places.
    expect((await mbp.ask(SPAWN)).reply).toMatchObject({ ok: false, error: "Ann isn't spawned: 2 workers running, the laptop's limit" });
    // A local spawn queues behind the reservation rather than take its place, and says why.
    const local = sup.spawn({ project: "works", role: "kim", task: "local kim", tasks: [], session: null });
    expect(local).toMatchObject({ state: "queued", note: expect.stringMatching(/^queued: Kim has a worker starting for another laptop/) });
    expect(store.workers({ project: "works" })).toHaveLength(1);

    join.release();
    const { reply } = await first;
    expect(reply).toMatchObject({ ok: true, worker: { role: "kim", state: "running" } });
    expect(store.worker(local.id)!.state).toBe("queued");
    expect(sessions).toHaveLength(2);
  });

  it("frees the reservation when the join fails: no row, and the next spawn of the role starts", async () => {
    const { store, link, mbp } = await setup();
    const join = slowJoin(link);
    const first = mbp.ask(BOARD_SPAWN);
    await until(() => join.joining());
    join.fail("forbidden");
    const { reply } = await first;
    expect(reply).toMatchObject({ ok: false, error: expect.stringMatching(/^Kim isn't spawned: the board refused to join WRK-1 build/) });
    expect(store.workers({ project: "works" })).toEqual([]);
    expect((await mbp.ask(SPAWN)).reply).toMatchObject({ ok: true });
    expect((await mbp.ask({ ...BOARD_SPAWN, task: "after" })).reply).toMatchObject({ ok: true, worker: { role: "kim", state: "running" } });
  });
});

describe("who may spawn what (criterion 4)", () => {
  it("refuses a role or project not in the sender's entry, a sender with none, and a lead, each audited remote:refused", async () => {
    const net = await setup();
    const { store, sessions, mbp, pi } = net;
    expect((await pi.ask(SPAWN)).reply).toMatchObject({ ok: false, error: `${SUP_PI} may not spawn studio/ann; it may spawn studio/bea` });
    expect((await pi.ask(BOARD_SPAWN)).reply).toMatchObject({ ok: false, error: `${SUP_PI} may not spawn works/kim; it may spawn studio/bea` });
    const stranger = await scripted(net.net, "nas");
    expect((await stranger.ask(SPAWN)).reply).toMatchObject({ ok: false, error: "supervisor@nas may not make requests here: it isn't in this supervisor's remote list" });
    expect((await mbp.ask({ ...SPAWN, as: "lead" })).reply).toMatchObject({ v: 2, re: "spawn", ok: false, error: expect.stringMatching(/^bad request: as /) });
    await tick(20);
    expect(sessions).toHaveLength(0);
    expect(store.workers()).toEqual([]);
    expect(refusals(store).map((a) => a.actor).reverse()).toEqual([SUP_PI, SUP_PI, "supervisor@nas", SUP_MBP]);
  });
});

describe("never a path (criterion 5)", () => {
  it.each([
    ["handoff", "/Users/ct/handoff.md"],
    ["resume_session", "sess-1"],
    ["cwd", "/tmp"],
  ])("refuses a spawn carrying %s as a bad request and starts nothing", async (key, value) => {
    const { store, sessions, mbp } = await setup();
    const { id, reply } = await mbp.ask({ ...SPAWN, [key]: value });
    expect(reply).toEqual({ v: 2, re: "spawn", req: id, ok: false, error: `bad request: ${key} is not allowed` });
    await tick(20);
    expect(sessions).toHaveLength(0);
    expect(store.workers()).toEqual([]);
  });
});

describe("a retry is safe (criterion 6)", () => {
  it("refuses a retried spawn of a worker that did start as busy", async () => {
    const { store, sessions, mbp } = await setup();
    const { reply: first } = await mbp.ask(SPAWN);
    expect(first).toMatchObject({ ok: true });
    const { reply: retry } = await mbp.ask(SPAWN);
    expect(retry).toMatchObject({ ok: false, error: "Ann isn't spawned: studio/ann already has a worker running" });
    expect(store.workers()).toHaveLength(1);
    expect(sessions).toHaveLength(1);
  });
});

describe("the snapshot names a remote spawn's sender, never a local one's (BOB-70, ADR 0007 §7)", () => {
  it("remote_from is the sender and remote_by its by; a v-less remote spawn has remote_by null; a local or a lead's spawn has neither", async () => {
    const { sup, mbp, pi } = await setup();
    const { reply: v2 } = await mbp.ask(SPAWN);
    const { reply: v1 } = await pi.ask({ op: "spawn", project: "studio", role: "bea", task: "old style" });
    const local = sup.spawn({ project: "studio", role: "cal", task: "local work" });
    const byLead = sup.spawn({ project: "studio", role: "ann", task: "lead's, queued", spawnedBy: "w_lead1" });
    const shown = (id: string) => sup.snapshot().workers.find((w) => w.id === id)!;
    expect(shown(v2["worker"].id)).toMatchObject({ remote_from: SUP_MBP, remote_by: "poe" });
    expect(shown(v1["worker"].id)).toMatchObject({ remote_from: SUP_PI, remote_by: null });
    expect(shown(local.id)).toMatchObject({ remote_from: null, remote_by: null });
    expect(shown(byLead.id)).toMatchObject({ remote_from: null, remote_by: null });
  });
});

describe("a v-less spawn is served as today (criterion 7)", () => {
  it("queues when the role is busy, and says why", async () => {
    const { sup, store, mbp } = await setup();
    sup.spawn({ project: "studio", role: "ann", task: "local work" });
    const { reply } = await mbp.ask({ op: "spawn", project: "studio", role: "ann", task: "one fix" });
    expect(reply).toMatchObject({ ok: true, op: "spawn", worker: { state: "queued", note: "queued: Ann already has a worker running; it starts after that one ends" } });
    expect(store.queued()).toHaveLength(1);
    expect(store.queued()[0]).toMatchObject({ spawned_by: SUP_MBP, remote_by: null, spawn_req: null });
  });
});

describe("the other ops answer only for the sender's own workers (criterion 8)", () => {
  it("status, stop, tail and summary of another sender's worker are refused and audited", async () => {
    const { sup, store, mbp, pi } = await setup();
    const theirs = (await pi.ask({ ...SPAWN, role: "bea" })).reply["worker"].id as string;
    const local = sup.spawn({ project: "studio", role: "cal", task: "local" }).id;
    for (const id of [theirs, local]) {
      for (const op of [{ op: "status" }, { op: "stop" }, { op: "tail", n: 10 }, { op: "summary" }]) {
        expect((await mbp.ask({ v: 2, ...op, id })).reply).toMatchObject({ v: 2, re: op.op, ok: false, error: `${id} isn't a worker ${SUP_MBP} spawned` });
      }
    }
    expect(refusals(store)).toHaveLength(8);
    expect(store.worker(theirs)!.state).toBe("running");
  });

  it("status, tail and summary of its own: the view, the log's lines, the digest", async () => {
    const { mbp } = await setup();
    const { id: req, reply } = await mbp.ask(SPAWN);
    const id = reply["worker"].id as string;
    expect((await mbp.ask({ v: 2, op: "status", id })).reply).toMatchObject({ ok: true, worker: { id, state: "running", spawn_req: req } });
    expect((await mbp.ask({ v: 2, op: "tail", id, n: 5 })).reply).toMatchObject({ ok: true, id, lines: expect.any(Array) });
    expect((await mbp.ask({ v: 2, op: "summary", id })).reply).toMatchObject({ ok: true, worker: { id }, tool_calls: {}, files_changed: [], errors: 0 });
  });

  it("list returns the sender's own only: by ids, by the spawn's message id, else its live ones", async () => {
    const { mbp, pi } = await setup();
    const { id: req, reply } = await mbp.ask(SPAWN);
    const mine = reply["worker"].id as string;
    const theirs = (await pi.ask({ ...SPAWN, role: "bea" })).reply["worker"].id as string;
    const ids = (r: Record<string, any>) => (r["workers"] as Array<{ id: string }>).map((w) => w.id);
    expect(ids((await mbp.ask({ v: 2, op: "list", ids: [theirs, mine] })).reply)).toEqual([mine]);
    expect(ids((await mbp.ask({ v: 2, op: "list", reqs: [req] })).reply)).toEqual([mine]);
    expect(ids((await mbp.ask({ v: 2, op: "list", reqs: ["m_none"] })).reply)).toEqual([]);
    expect(ids((await mbp.ask({ v: 2, op: "list" })).reply)).toEqual([mine]);
    expect(ids((await pi.ask({ v: 2, op: "list", ids: [mine, theirs] })).reply)).toEqual([theirs]);
  });

  it("tail cuts to fit the 16 KiB body: its last lines, truncated: true", () => {
    expect(fitLines(["a", "b"])).toEqual({ lines: ["a", "b"] });
    const lines = Array.from({ length: 400 }, (_, i) => `${i} ${"x".repeat(100)}`);
    const fit = fitLines(lines);
    expect(fit.truncated).toBe(true);
    expect(fit.lines.at(-1)).toBe(lines.at(-1));
    expect(JSON.stringify(fit).length).toBeLessThan(16 * 1024 - 512);
    expect(JSON.stringify(fitLines(["y".repeat(40_000)])).length).toBeLessThan(16 * 1024);
  });

  it("request and answer of a request that doesn't exist are refused", async () => {
    const { mbp } = await setup();
    expect((await mbp.ask({ v: 2, op: "request", id: "r_1" })).reply).toMatchObject({ ok: false, error: `r_1 isn't a request of a worker ${SUP_MBP} spawned` });
    expect((await mbp.ask({ v: 2, op: "answer", id: "r_1", decision: "allow", user_decided: false, resume: true })).reply).toMatchObject({ ok: false, error: `r_1 isn't a request of a worker ${SUP_MBP} spawned` });
  });
});

describe("stop of a worker already ended (criterion 9)", () => {
  it("stops a running one with its last turn, then replies ok with already_ended and its view", async () => {
    const { sessions, mbp } = await setup();
    const id = (await mbp.ask(SPAWN)).reply["worker"].id as string;
    const stopping = mbp.ask({ v: 2, op: "stop", id });
    await until(() => sessions[0]!.inputs.length === 2);
    sessions[0]!.turnDone("handoff written");
    expect((await stopping).reply).toMatchObject({ ok: true, re: "stop", worker: { id } });
    await until(() => mbp.got.some((m) => m.body.includes('"event":"exit"')));
    const { reply } = await mbp.ask({ v: 2, op: "stop", id });
    expect(reply).toMatchObject({ v: 2, re: "stop", ok: true, already_ended: true, worker: { id, state: "stopped", error: `stopped by ${SUP_MBP}` } });
  });
});
