import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GhCiPoll } from "../src/ci-poll.ts";
import { callTool, handlers } from "../src/mcp.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { REMOTE_TOOLS_SINCE, Supervisor } from "../src/supervisor.ts";
import { fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";
import { FakeNetwork } from "./network.ts";

// The requester's copies and reconciling (ADR 0007 §7, §8, §5's answer from the copy; BOB-65): mbp-1's
// supervisor keeps a copy of each worker it spawned on ubu1, changed only by ubu1's replies and events,
// and reconciles it on start, on each connect and on a timer. ubu1 is real, or played by the test
// where the order of what it sends matters.

const POLICY = new Policy(`rules: []`);
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
const ANN = { project: "studio", role: "ann", task: "one fix", laptop: "ubu1" };

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
  const dir = mkdtempSync(join(tmpdir(), "bobnet-copies-"));
  dirs.push(dir);
  const store = new Store(join(dir, "supervisor.db"));
  stores.add(store);
  return { dir, store };
}

async function boot(net: FakeNetwork, laptop: string, over: string, at = newStore()) {
  const link = net.link(laptop);
  const { queryFn, sessions } = fakeQuery();
  const ciPoll = new GhCiPoll(quiet, async () => {
    throw new Error("no gh in tests");
  });
  const sup = new Supervisor({ config: testConfig(at.dir, over), policy: POLICY, store: at.store, broker: link, queryFn, log: quiet, sandboxCheck: async () => null, ownerCheck: async () => false, sleep: net.sleep, ciPoll });
  link.onPush = (f) => sup.onPush(f);
  await sup.start();
  running.push(sup);
  const writeHandoff = (id: string, text: string) => {
    mkdirSync(join(at.dir, "handoffs", "studio"), { recursive: true });
    writeFileSync(join(at.dir, "handoffs", "studio", `${id}.md`), text);
  };
  return { sup, store: at.store, at, link, sessions, writeHandoff };
}

/** A tool as the orchestrator calls it: its JSON result, or its error text thrown. */
function caller(sup: Supervisor) {
  const tools = handlers(sup);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = await callTool(tools, name, args);
    const text = r.content[0]!.text;
    if (r.isError) throw new Error(text);
    return JSON.parse(text);
  };
}

/** ubu1's and mbp-1's real supervisors, Bob as mbp-1's orchestrator. */
async function real(opts: { teams?: [string, string] } = {}) {
  const net = new FakeNetwork();
  net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
  const ubu = await boot(net, "ubu1", `${UBU}${opts.teams ? `team: ${opts.teams[0]}\n` : ""}`);
  const mbp = await boot(net, "mbp-1", opts.teams ? `team: ${opts.teams[1]}\n` : "");
  await mbp.link.register({ name: "Bob", ...(opts.teams ? { team: opts.teams[1] } : {}) });
  const bob = () => net.between(SUP_MBP, "Bob@mbp-1");
  const sent = () => net.between(SUP_MBP, SUP_UBU).map((b) => JSON.parse(b) as Record<string, unknown>);
  return { net, ubu, mbp, call: caller(mbp.sup), bob, sent };
}

/** A view of a worker as ubu1's remoteView makes it. */
const view = (id: string, spawnReq: string, over: Record<string, unknown> = {}) => ({
  id, project: "studio", role: "ann", name: "Ann", as: "worker", state: "running", session: null, checkpoint: null, error: null,
  started_at: "2026-11-17T12:00:00.000Z", ended_at: null, remote_url: null, spawn_req: spawnReq, ...over,
});

/**
 * mbp-1's real supervisor, and ubu1's played by the test: `answer[op]` makes the reply's fields (none,
 * no reply), `send` sends any body as supervisor@ubu1 (or another name there), `spawnReq` is the
 * message id of the spawn it got, the one its worker w_9 was made by.
 */
async function scripted() {
  const net = new FakeNetwork();
  net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
  const ubu = net.link("ubu1");
  const got: Array<{ id: string; body: Record<string, any> }> = [];
  let spawnReq = "";
  const answer: Record<string, (body: Record<string, any>) => Record<string, unknown> | null> = {
    spawn: () => ({ worker: view("w_9", spawnReq) }),
  };
  const send = (body: unknown, as = "supervisor") => ubu.request({ t: "send", as, to: [SUP_MBP], body: JSON.stringify(body) });
  ubu.onPush = (f) => {
    if (f.t !== "deliver") return;
    const body = JSON.parse(f.msg.body) as Record<string, any>;
    got.push({ id: f.msg.id, body });
    if (body["op"] === "spawn") spawnReq = f.msg.id;
    const fields = answer[body["op"]]?.(body);
    if (fields) void send({ v: 2, re: body["op"], req: f.msg.id, ok: true, ...fields });
  };
  await ubu.register({ name: "supervisor" });
  await ubu.register({ name: "Mallory" });
  const mbp = await boot(net, "mbp-1", "");
  await mbp.link.register({ name: "Bob" });
  const bob = () => net.between(SUP_MBP, "Bob@mbp-1");
  const ops = () => got.map((g) => g.body["op"]);
  return { net, got, answer, send, mbp, call: caller(mbp.sup), bob, ops, spawnReq: () => spawnReq };
}

const EXIT = (spawnReq: string, over: Record<string, unknown> = {}) => ({ v: 2, event: "exit", worker: "w_9", spawn_req: spawnReq, state: "done", checkpoint: "fixed", lands: [], handoff_text: "# Done\n", ...over });

describe("the copies (criterion 1)", () => {
  it("one per remote worker: its laptop, id, spawn_req, last view and as_of, and the handoff once ended", async () => {
    const { ubu, mbp, call } = await real();
    const w = await call("spawn_worker", ANN);
    await until(() => ubu.sessions.length === 1);
    const c = mbp.store.remoteCopy("ubu1", w.id)!;
    expect(c).toMatchObject({ laptop: "ubu1", id: w.id, to_name: SUP_UBU, state: "running", ended: 0, handoff: null, as_of: w.as_of });
    expect(c.spawn_req).toBe(ubu.store.worker(w.id)!.spawn_req);
    expect(JSON.parse(c.view!)).toMatchObject({ id: w.id, name: "Ann", state: "running" });
    ubu.writeHandoff(w.id, "# Done\n\nFixed.\n");
    ubu.sessions[0]!.finish();
    await until(() => mbp.store.remoteCopy("ubu1", w.id)!.ended === 1);
    expect(mbp.store.remoteCopy("ubu1", w.id)).toMatchObject({ state: "done", handoff: JSON.stringify({ handoff_text: "# Done\n\nFixed.\n" }), told: 1 });
  });

  it("change only from the target, only forward: an exit then a late remote_control and a stale status leave it ended", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    await s.send(EXIT(s.spawnReq()));
    await until(() => s.mbp.store.remoteCopy("ubu1", "w_9")?.ended === 1);
    // Out of order: the url comes after the end, then a status reply made before it.
    await s.send({ v: 2, event: "remote_control", worker: "w_9", spawn_req: s.spawnReq(), url: "https://claude.ai/code/late" });
    s.answer["status"] = () => ({ worker: view("w_9", s.spawnReq(), { state: "running", checkpoint: "half way" }) });
    const shown = await s.call("worker_status", { id: "w_9" });
    expect(shown).toMatchObject({ id: "w_9", state: "done", checkpoint: "fixed", remote_url: null, laptop: "ubu1" });
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ state: "done", ended: 1, remote_url: null });
  });

  it("never from the requester's own writes: a stop with no reply leaves the copy as the target last said", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    s.answer["list"] = () => ({ workers: [view("w_9", s.spawnReq())] });
    const stopping = s.call("stop_worker", { id: "w_9" });
    await until(() => s.ops().includes("stop"));
    s.net.advance(50);
    expect(await stopping).toMatchObject({ id: "w_9", state: "running", note: expect.stringMatching(/^no reply in time/) });
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ state: "running", ended: 0 });
  });
});

describe("the sender check (criterion 2)", () => {
  it("an event or reply from any address but the worker's supervisor is dropped", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    const before = s.mbp.store.remoteCopy("ubu1", "w_9")!;
    // Another name on ubu1, and a supervisor on another laptop.
    await s.send(EXIT(s.spawnReq()), "Mallory");
    const pi = s.net.link("pi");
    await pi.register({ name: "supervisor" });
    await pi.request({ t: "send", as: "supervisor", to: [SUP_MBP], body: JSON.stringify(EXIT(s.spawnReq())) });
    await pi.request({ t: "send", as: "supervisor", to: [SUP_MBP], body: JSON.stringify({ ...EXIT(s.spawnReq()), worker: "w_new" }) });
    // A reply to a request sent, from the wrong sender.
    s.answer["status"] = () => null;
    s.answer["list"] = () => ({ workers: [] });
    const asking = s.call("worker_status", { id: "w_9" }).catch(() => null);
    await until(() => s.ops().includes("status"));
    const statusReq = s.got.at(-1)!.id;
    await s.send({ v: 2, re: "status", req: statusReq, ok: true, worker: view("w_9", s.spawnReq(), { state: "failed" }) }, "Mallory");
    await tick(30);
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toEqual(before);
    expect(s.mbp.store.remoteCopy("pi", "w_9")).toBeNull();
    expect(s.mbp.store.remoteCopy("pi", "w_new")).toBeNull();
    expect(s.mbp.store.remoteSentList().find((r) => r.message_id === statusReq)!.state).toBe("sent");
    expect(s.bob()).toEqual([]);
    s.net.advance(60);
    await asking;
  });
});

describe("an event for a worker with no copy (criterion 3)", () => {
  it("the spawn reply was lost: the event makes the copy, tied to spawn_req, and status fills it", async () => {
    const s = await scripted();
    s.answer["spawn"] = () => null;
    s.answer["list"] = () => ({ workers: [] });
    const spawning = s.call("spawn_worker", ANN).catch((err: Error) => err.message);
    await until(() => s.ops().includes("spawn"));
    s.net.advance(90);
    expect(await spawning).toMatch(/^no reply from supervisor@ubu1 within 90 s: the spawn may or may not have run/);
    expect(s.mbp.store.remoteCopies()).toEqual([]);
    s.answer["status"] = () => ({ worker: view("w_9", s.spawnReq(), { checkpoint: "started" }) });
    await s.send({ v: 2, event: "remote_control", worker: "w_9", spawn_req: s.spawnReq(), url: "https://claude.ai/code/s1" });
    await until(() => s.mbp.store.remoteCopy("ubu1", "w_9")?.state === "running");
    expect(s.got.at(-1)!.body).toEqual({ v: 2, op: "status", id: "w_9" });
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ spawn_req: s.spawnReq(), remote_url: "https://claude.ai/code/s1", ended: 0 });
    expect(JSON.parse(s.mbp.store.remoteCopy("ubu1", "w_9")!.view!)).toMatchObject({ name: "Ann", checkpoint: "started" });
    await until(() => s.bob().length === 1);
    expect(s.bob()[0]).toMatch(/^ann \(w_9, studio\/ann\) on ubu1 spawned after all/);
    expect((await s.call("worker_status", { id: "w_9" })).laptop).toBe("ubu1");
  });

  it("an exit for a worker with no copy makes it ended, with its handoff, and tells the orchestrator", async () => {
    const s = await scripted();
    s.answer["spawn"] = () => null;
    s.answer["list"] = () => ({ workers: [] });
    const spawning = s.call("spawn_worker", ANN).catch(() => null);
    await until(() => s.ops().includes("spawn"));
    s.net.advance(90);
    await spawning;
    s.answer["status"] = () => ({ worker: view("w_9", s.spawnReq(), { state: "done", checkpoint: "fixed" }) });
    await s.send(EXIT(s.spawnReq()));
    await until(() => s.bob().some((b) => b.includes("done")));
    expect(s.bob().at(-1)).toBe("ann (w_9, studio/ann) on ubu1 done: fixed; handoff in worker_summary.");
    await until(() => JSON.parse(s.mbp.store.remoteCopy("ubu1", "w_9")!.view!)["name"] === "Ann");
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ state: "done", ended: 1, told: 1, handoff: JSON.stringify({ handoff_text: "# Done\n" }) });
  });
});

describe("reconciling (criterion 4)", () => {
  it("on the requester's start: list with the ids of its copies not ended; an id not returned is unknown, not dropped", async () => {
    const net = new FakeNetwork();
    net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
    const ubu = await boot(net, "ubu1", UBU);
    const at = newStore();
    const first = await boot(net, "mbp-1", "", at);
    const call = caller(first.sup);
    const ann = await call("spawn_worker", ANN);
    const bea = await call("spawn_worker", { ...ANN, role: "bea" });
    await first.sup.shutdown();
    // Meanwhile bea is no longer mbp-1's on ubu1 (as if its row were lost): asked for, and not returned.
    (ubu.store as unknown as { run: (sql: string, ...a: string[]) => void }).run("UPDATE workers SET spawned_by = 'someone@else' WHERE id = ?", bea.id);
    await boot(net, "mbp-1", "", at);
    await until(() => at.store.remoteCopy("ubu1", bea.id)!.state === "unknown");
    const lists = net.between(SUP_MBP, SUP_UBU).map((b) => JSON.parse(b)).filter((b) => b.op === "list");
    expect(lists).toEqual([{ v: 2, op: "list", ids: [ann.id, bea.id] }]);
    expect(at.store.remoteCopy("ubu1", ann.id)).toMatchObject({ state: "running" });
    expect(at.store.remoteCopies().length).toBe(2);
  });

  it("on each connect to the broker, and reqs for a spawn with no reply makes its copy", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    s.answer["spawn"] = () => null;
    s.answer["list"] = (b) => ({ workers: (b["reqs"] ?? []).length ? [view("w_8", b["reqs"][0], { role: "bea", name: "Bea" })] : [] });
    // The list the tool asks after its wait finds nothing yet; the worker is made later.
    const lost = s.answer["list"];
    s.answer["list"] = () => ({ workers: [] });
    const spawning = s.call("spawn_worker", { ...ANN, role: "bea" }).catch(() => null);
    await until(() => s.ops().filter((o) => o === "spawn").length === 2);
    const beaReq = s.got.at(-1)!.id;
    s.net.advance(90);
    await spawning;
    s.answer["list"] = lost;
    s.net.disconnect("mbp-1");
    const before = s.got.length;
    await s.net.reconnect("mbp-1");
    s.mbp.sup.onConnected();
    await until(() => s.got.length > before);
    expect(s.got.slice(before).map((g) => g.body)).toEqual([{ v: 2, op: "list", ids: ["w_9"], reqs: [beaReq] }]);
    await until(() => s.mbp.store.remoteCopy("ubu1", "w_8") !== null);
    expect(s.mbp.store.remoteCopy("ubu1", "w_8")).toMatchObject({ spawn_req: beaReq, state: "running" });
    // w_9 wasn't returned: unknown, not dropped.
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ state: "unknown", ended: 0 });
  });

  it("every 5 minutes while any copy isn't ended, then not at all", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    s.answer["list"] = () => ({ workers: [view("w_9", s.spawnReq())] });
    s.net.advance(299);
    await tick(20);
    expect(s.ops()).toEqual(["spawn"]);
    s.net.advance(1);
    await until(() => s.ops().length === 2);
    expect(s.got[1]!.body).toEqual({ v: 2, op: "list", ids: ["w_9"] });
    await s.send(EXIT(s.spawnReq()));
    await until(() => s.mbp.store.remoteCopy("ubu1", "w_9")?.ended === 1);
    s.net.advance(300);
    s.net.advance(300);
    await tick(30);
    expect(s.ops()).toEqual(["spawn", "list"]);
  });

  it("not on a target's join, whether or not the team rule lets it be heard", async () => {
    for (const teams of [["portfolio", "land"], ["land", "land"]] as Array<[string, string]>) {
      const { net, ubu, mbp, call, sent } = await real({ teams });
      await call("spawn_worker", ANN);
      await until(() => ubu.sessions.length === 1);
      net.disconnect("ubu1");
      await net.reconnect("ubu1");
      await tick(30);
      // On one team the join is heard (mbp-1 also hosts roles with no team, which hear every join).
      if (teams[0] === teams[1]) expect(mbp.link.pushes.some((p) => p.t === "presence" && p.event === "joined" && p.peer.address === SUP_UBU)).toBe(true);
      expect(sent().map((b) => b["op"])).toEqual(["spawn"]);
    }
  });

  it("a copy seen ended without its handoff gets it with summary, and the orchestrator hears of the end", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    s.answer["status"] = () => ({ worker: view("w_9", s.spawnReq(), { state: "failed", error: "it broke" }) });
    s.answer["summary"] = () => ({ worker: view("w_9", s.spawnReq(), { state: "failed", error: "it broke" }), tool_calls: {}, handoff_text: null });
    expect(await s.call("worker_status", { id: "w_9" })).toMatchObject({ state: "failed" });
    await until(() => s.ops().includes("summary"));
    await until(() => s.bob().length === 1);
    expect(s.bob()).toEqual(["Ann (w_9, studio/ann) on ubu1 failed: it broke; no handoff file."]);
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ handoff: JSON.stringify({ handoff_text: null }), told: 1 });
  });
});

describe("the end, told and kept (criterion 5)", () => {
  it("the orchestrator hears '… done: …; handoff in worker_summary', and worker_summary returns handoff_text", async () => {
    const { ubu, mbp, call, bob } = await real();
    const { id } = await call("spawn_worker", ANN);
    await until(() => ubu.sessions.length === 1);
    ubu.store.updateWorker(id, { checkpoint: "fix landed" });
    ubu.writeHandoff(id, "# Done\n\nFixed it.\n");
    ubu.sessions[0]!.finish();
    await until(() => bob().length === 1);
    expect(bob()).toEqual([`Ann (${id}, studio/ann) on ubu1 done: fix landed; handoff in worker_summary.`]);
    expect(await call("worker_summary", { id })).toMatchObject({ laptop: "ubu1", worker: { id, state: "done" }, handoff_text: "# Done\n\nFixed it.\n" });
    expect(mbp.store.remoteCopy("ubu1", id)!.told).toBe(1);
  });

  it("a redelivered exit, even after the requester's restart, isn't told twice", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    await s.send(EXIT(s.spawnReq()));
    await until(() => s.bob().length === 1);
    await s.mbp.sup.shutdown();
    const again = await boot(s.net, "mbp-1", "", s.mbp.at);
    await s.send(EXIT(s.spawnReq()));
    await tick(30);
    expect(s.bob().length).toBe(1);
    expect(again.store.remoteCopy("ubu1", "w_9")!.told).toBe(1);
  });
});

describe("the target offline: answers from the copy (criterion 6)", () => {
  it("worker_status and worker_summary answer from the copy with as_of and say so; list_workers shows remote rows with as_of", async () => {
    const { net, ubu, mbp, call } = await real();
    const ann = await call("spawn_worker", ANN);
    const bea = await call("spawn_worker", { ...ANN, role: "bea" });
    await until(() => ubu.sessions.length === 2);
    ubu.writeHandoff(ann.id, "# Ann's handoff\n");
    ubu.sessions[0]!.finish();
    await until(() => mbp.store.remoteCopy("ubu1", ann.id)!.told === 1);
    const annAsOf = mbp.store.remoteCopy("ubu1", ann.id)!.as_of;
    net.disconnect("ubu1");
    const offline = /^ubu1's supervisor is offline \(last seen [^)]+\): nothing was sent to supervisor@ubu1: this is its copy as of /;

    const status = await call("worker_status", { id: bea.id });
    expect(status).toMatchObject({ id: bea.id, state: "running", laptop: "ubu1", as_of: bea.as_of, note: expect.stringMatching(offline) });
    const summary = await call("worker_summary", { id: ann.id });
    expect(summary).toMatchObject({ worker: { id: ann.id, state: "done" }, handoff_text: "# Ann's handoff\n", laptop: "ubu1", as_of: annAsOf, note: expect.stringMatching(offline) });
    expect(summary).not.toHaveProperty("from_copy");

    const live = await call("list_workers", { laptop: "ubu1" });
    expect(live).toEqual([expect.objectContaining({ id: bea.id, as_of: bea.as_of, unreachable: expect.stringMatching(/^ubu1's supervisor is offline/) })]);
    const all = await call("list_workers", { laptop: "ubu1", all: true });
    expect(all.map((w: { id: string; state: string; as_of: string }) => [w.id, w.state, w.as_of])).toEqual([
      [ann.id, "done", annAsOf],
      [bea.id, "running", bea.as_of],
    ]);
    // tail has no copy: it still refuses.
    await expect(call("tail_worker", { id: bea.id, n: 5 })).rejects.toThrow("ubu1's supervisor is offline");
  });
});

describe("a new orchestrator session and the requester's restart (criterion 7)", () => {
  it("fresh tools see every remote worker; restarted on its SQLite, the requester loses none", async () => {
    const net = new FakeNetwork();
    net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
    const ubu = await boot(net, "ubu1", UBU);
    const at = newStore();
    const first = await boot(net, "mbp-1", "", at);
    const ann = await caller(first.sup)("spawn_worker", ANN);
    const bea = await caller(first.sup)("spawn_worker", { ...ANN, role: "bea" });
    await until(() => ubu.sessions.length === 2);
    // A new orchestrator session: the same supervisor, its tools called fresh.
    expect((await caller(first.sup)("list_workers", { laptop: "*" })).map((w: { id: string }) => w.id)).toEqual([ann.id, bea.id]);
    await first.sup.shutdown();
    const second = await boot(net, "mbp-1", "", at);
    const call = caller(second.sup);
    expect((await call("list_workers", { laptop: "*" })).map((w: { id: string; laptop: string }) => [w.id, w.laptop])).toEqual([
      [ann.id, "ubu1"],
      [bea.id, "ubu1"],
    ]);
    expect(await call("worker_status", { id: ann.id })).toMatchObject({ id: ann.id, state: "running", laptop: "ubu1" });
    ubu.writeHandoff(bea.id, "bea's");
    ubu.sessions[1]!.finish();
    await until(() => at.store.remoteCopy("ubu1", bea.id)!.ended === 1);
    expect(await call("worker_summary", { id: bea.id })).toMatchObject({ handoff_text: "bea's", laptop: "ubu1" });
  });
});

describe("the requester away (criterion 8)", () => {
  it("the worker runs to its end on the target; its exit waits and arrives on return", async () => {
    const { net, ubu, mbp, call, bob } = await real();
    const { id } = await call("spawn_worker", ANN);
    await until(() => ubu.sessions.length === 1);
    // mbp-1 asleep: its supervisor and poe both gone.
    net.disconnect("mbp-1");
    ubu.writeHandoff(id, "# Done while you slept\n");
    ubu.sessions[0]!.finish();
    await until(() => ubu.store.worker(id)!.state === "done");
    await until(() => net.between(SUP_UBU, SUP_MBP).some((b) => b.includes('"event":"exit"')));
    await tick(30);
    expect(mbp.store.remoteCopy("ubu1", id)!.ended).toBe(0);
    await net.reconnect("mbp-1");
    mbp.sup.onConnected();
    await until(() => mbp.store.remoteCopy("ubu1", id)!.told === 1);
    expect(mbp.store.remoteCopy("ubu1", id)).toMatchObject({ state: "done", handoff: JSON.stringify({ handoff_text: "# Done while you slept\n" }) });
    await until(() => bob().length === 1);
    expect(bob()[0]).toBe(`Ann (${id}, studio/ann) on ubu1 done; handoff in worker_summary.`);
  });
});

describe("remote_url on the copy (criterion 9)", () => {
  it("set from the remote_control event; a later null never clears it", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    await s.send({ v: 2, event: "remote_control", worker: "w_9", spawn_req: s.spawnReq(), url: "https://claude.ai/code/s1" });
    await until(() => s.mbp.store.remoteCopy("ubu1", "w_9")!.remote_url !== null);
    s.answer["status"] = () => ({ worker: view("w_9", s.spawnReq(), { remote_url: null, checkpoint: "later" }) });
    expect(await s.call("worker_status", { id: "w_9" })).toMatchObject({ checkpoint: "later", remote_url: "https://claude.ai/code/s1" });
    await s.send({ v: 2, event: "remote_control", worker: "w_9", spawn_req: s.spawnReq(), error: "Remote Control is off" });
    await tick(30);
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")!.remote_url).toBe("https://claude.ai/code/s1");
  });
});
