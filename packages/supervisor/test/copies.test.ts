import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@bobnet/client/log";
import { findSecret } from "@bobnet/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GhCiPoll } from "../src/ci-poll.ts";
import { callTool, handlers } from "../src/mcp.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { REMOTE_TOOLS_SINCE, sleepFor, Supervisor } from "../src/supervisor.ts";
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

async function boot(net: FakeNetwork, laptop: string, over: string, at = newStore(), log: Logger = quiet) {
  const link = net.link(laptop);
  const { queryFn, sessions } = fakeQuery();
  const ciPoll = new GhCiPoll(quiet, async () => {
    throw new Error("no gh in tests");
  });
  const sup = new Supervisor({ config: testConfig(at.dir, over), policy: POLICY, store: at.store, broker: link, queryFn, log, sandboxCheck: async () => null, ownerCheck: async () => false, sleep: net.sleep, ciPoll });
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
 * no reply; `{ event: "withheld" }`, the broker's stand-in), `send` sends any body as supervisor@ubu1 (or another name there), `spawnReq` is the
 * message id of the spawn it got, the one its worker w_9 was made by.
 */
async function scripted(log: Logger = quiet) {
  const net = new FakeNetwork();
  net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
  const ubu = net.link("ubu1");
  const got: Array<{ id: string; body: Record<string, any> }> = [];
  let spawnReq = "";
  const answer: Record<string, (body: Record<string, any>) => Record<string, unknown> | null> = {
    spawn: () => ({ worker: view("w_9", spawnReq) }),
  };
  const send = (body: unknown, as = "supervisor") => ubu.request<{ id: string }>({ t: "send", as, to: [SUP_MBP], body: JSON.stringify(body) });
  ubu.onPush = (f) => {
    if (f.t !== "deliver") return;
    const body = JSON.parse(f.msg.body) as Record<string, any>;
    got.push({ id: f.msg.id, body });
    if (body["op"] === "spawn") spawnReq = f.msg.id;
    const fields = answer[body["op"]]?.(body);
    // `{ event: "withheld" }` answers as the broker's stand-in for a reply it refused (§2).
    if (fields?.["event"] === "withheld") void send({ v: 2, event: "withheld", re: body["op"], req: f.msg.id });
    else if (fields) void send({ v: 2, re: body["op"], req: f.msg.id, ok: true, ...fields });
  };
  await ubu.register({ name: "supervisor" });
  await ubu.register({ name: "Mallory" });
  const mbp = await boot(net, "mbp-1", "", newStore(), log);
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
    const forged: string[] = [];
    // Another name on ubu1, and a supervisor on another laptop.
    forged.push((await s.send(EXIT(s.spawnReq()), "Mallory")).id);
    const pi = s.net.link("pi");
    await pi.register({ name: "supervisor" });
    for (const body of [EXIT(s.spawnReq()), { ...EXIT(s.spawnReq()), worker: "w_new" }]) forged.push((await pi.request<{ id: string }>({ t: "send", as: "supervisor", to: [SUP_MBP], body: JSON.stringify(body) })).id);
    // A reply to a request sent, from the wrong sender.
    s.answer["status"] = () => null;
    s.answer["list"] = () => ({ workers: [] });
    const asking = s.call("worker_status", { id: "w_9" }).catch(() => null);
    await until(() => s.ops().includes("status"));
    const statusReq = s.got.at(-1)!.id;
    forged.push((await s.send({ v: 2, re: "status", req: statusReq, ok: true, worker: view("w_9", s.spawnReq(), { state: "failed" }) }, "Mallory")).id);
    // Each one handled (acked) before asserting it changed nothing.
    await until(() => forged.every((id) => s.net.acked(id)));
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
    const due = s.net.now + 300_000;
    s.net.advance(299);
    // The reconcile's wait is still on the clock: nothing could have asked yet.
    expect(s.net.pending()).toContain(due);
    expect(s.ops()).toEqual(["spawn"]);
    s.net.advance(1);
    await until(() => s.ops().length === 2);
    expect(s.got[1]!.body).toEqual({ v: 2, op: "list", ids: ["w_9"] });
    await s.send(EXIT(s.spawnReq()));
    await until(() => s.mbp.store.remoteCopy("ubu1", "w_9")?.ended === 1);
    s.net.advance(300);
    s.net.advance(300);
    // The loop woke, found every copy ended, and waits again: only then is "not at all" shown.
    await until(() => s.net.pending().includes(s.net.now + 300_000));
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
    const { id } = await s.send(EXIT(s.spawnReq()));
    await until(() => s.net.acked(id));
    expect(s.bob().length).toBe(1);
    expect(again.store.remoteCopy("ubu1", "w_9")!.told).toBe(1);
  });
});

describe("an end the broker withholds (BOB-72)", () => {
  it("the broker refuses what the target doesn't: the copy is ended, one notice, no further summary or list for it", async () => {
    const { net, ubu, mbp, call, bob, sent } = await real();
    // The broker's detector before BOB-72 narrowed password_assignment; the target's is the narrowed one.
    net.detector = (t) => findSecret(t) ?? (/\b(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/i.test(t) ? "password_assignment" : null);
    const { id } = await call("spawn_worker", ANN);
    await until(() => ubu.sessions.length === 1);
    ubu.writeHandoff(id, "# Handoff\n\nThe service reads its api_key:\n\nthen goes on.\n");
    ubu.sessions[0]!.finish();
    await until(() => bob().length === 1);
    expect(bob()).toEqual([`Ann (${id}, studio/ann) on ubu1 done; handoff withheld: ask Ann on ubu1.`]);
    // The exit and the summary both came as stand-ins.
    expect(net.refused.filter((r) => r.to.includes(SUP_MBP)).map((r) => r.code)).toEqual(["secret_detected", "secret_detected"]);
    expect(sent().map((b) => b["op"])).toEqual(["spawn", "status", "summary"]);
    expect(mbp.store.remoteCopy("ubu1", id)).toMatchObject({ state: "done", ended: 1, told: 1, handoff: JSON.stringify({ handoff_text: null, handoff_withheld: true }) });
    // Not asked again: a reconnect, a reconcile run to its end, the 5-minute timer.
    const asked = sent().length;
    net.disconnect("mbp-1");
    await net.reconnect("mbp-1");
    mbp.sup.onConnected();
    await mbp.sup.reconcile();
    net.advance(300);
    net.advance(300);
    await until(() => net.pending().includes(net.now + 300_000));
    expect(sent().slice(asked).filter((b) => b["op"] === "summary" || b["op"] === "list")).toEqual([]);
    expect(bob().length).toBe(1);
  });
});

/** 25 copies on ubu1 not ended, three batches of list: w_00..w_09, w_10..w_19, w_20..w_24. */
async function many(log: Logger = quiet) {
  const s = await scripted(log);
  s.answer["summary"] = () => null;
  const now = new Date(s.net.now).toISOString();
  const ids = Array.from({ length: 25 }, (_, i) => `w_${String(i).padStart(2, "0")}`);
  for (const id of ids) s.mbp.store.putRemoteCopy({ laptop: "ubu1", id, to_name: SUP_UBU, spawn_req: null, view: null, state: "running", as_of: now, ended: 0, handoff: null, remote_url: null, told: 0, state_withheld: 0 });
  const lists = () => s.got.filter((g) => g.body["op"] === "list").map((g) => g.body["ids"] as string[]);
  return { ...s, ids, lists };
}

describe("a withheld list or status (BOB-78)", () => {
  it("the middle of three batches withheld: the later batch is still asked and its copies update; the withheld one reported once (AC 1)", async () => {
    const { log, said } = logged();
    const s = await many(log);
    s.answer["list"] = (b) => (b["ids"].includes("w_10") ? { event: "withheld" } : { workers: b["ids"].map((id: string) => view(id, "m_x", { checkpoint: "seen" })) });
    expect(await s.mbp.sup.reconcileOn("ubu1")).toBeNull();
    expect(s.lists()).toEqual([s.ids.slice(0, 10), s.ids.slice(10, 20), s.ids.slice(20)]);
    const views = s.ids.map((id) => JSON.parse(s.mbp.store.remoteCopy("ubu1", id)!.view ?? "{}")["checkpoint"] ?? null);
    expect(views).toEqual([...Array(10).fill("seen"), ...Array(10).fill(null), ...Array(5).fill("seen")]);
    const reported = said.filter((l) => l.msg.includes("withheld a list reply"));
    expect(reported).toEqual([expect.objectContaining({ level: "warn", laptop: "ubu1", withheld: s.ids.slice(10, 20) })]);
    expect(s.mbp.store.auditLog(50).filter((a) => a.action === "remote:list_withheld").map((a) => JSON.parse(a.detail))).toEqual([{ withheld: s.ids.slice(10, 20) }]);
    expect(s.bob()).toEqual([]);
  });

  it("no reply, or the laptop offline, still stops the pass there (AC 5)", async () => {
    const s = await many();
    s.answer["list"] = () => null;
    const silent = s.mbp.sup.reconcileOn("ubu1");
    await until(() => s.lists().length === 1);
    s.net.advance(50);
    expect(await silent).toBe("no reply from ubu1 within 50 s");
    expect(s.lists().length).toBe(1);
    s.net.disconnect("ubu1");
    expect(await s.mbp.sup.reconcileOn("ubu1")).toMatch(/ubu1's supervisor/);
    expect(s.lists().length).toBe(1);
  });

  it("a withheld event and then a withheld status: one notice, and later reconciles add none and ask no status (AC 2)", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    s.answer["status"] = () => ({ event: "withheld" });
    s.answer["list"] = () => ({ event: "withheld" });
    await s.send({ v: 2, event: "withheld", worker: "w_9", spawn_req: s.spawnReq() });
    await until(() => s.bob().length === 1);
    expect(s.bob()).toEqual(["Ann on ubu1: state withheld, ask there."]);
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ state: "running", ended: 0, state_withheld: 2 });
    const asked = s.ops().length;
    // Another withheld event (the exit after a url), two reconciles: no status, no second notice.
    await s.send({ v: 2, event: "withheld", worker: "w_9", spawn_req: s.spawnReq() });
    await s.mbp.sup.reconcileOn("ubu1");
    await s.mbp.sup.reconcileOn("ubu1");
    await tick(20);
    expect(s.ops().slice(asked)).toEqual(["list", "list"]);
    expect(s.bob().length).toBe(1);
  });

  it("it heals: a list that passes ends the copy, and the real exit is told as before (AC 3)", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    s.answer["status"] = () => ({ event: "withheld" });
    await s.send({ v: 2, event: "withheld", worker: "w_9", spawn_req: s.spawnReq() });
    await until(() => s.bob().length === 1);
    // The broker carries the narrowed detector: list passes, the copy ends, summary brings its handoff.
    s.answer["list"] = () => ({ workers: [view("w_9", s.spawnReq(), { state: "done", checkpoint: "fixed" })] });
    s.answer["summary"] = () => ({ worker: view("w_9", s.spawnReq(), { state: "done", checkpoint: "fixed" }), handoff_text: "# Done\n" });
    expect(await s.mbp.sup.reconcileOn("ubu1")).toBeNull();
    await until(() => s.bob().length === 2);
    expect(s.bob()[1]).toBe("Ann (w_9, studio/ann) on ubu1 done: fixed; handoff in worker_summary.");
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ state: "done", ended: 1, told: 1 });
  });

  it("it heals by the exit itself: a copy told 'state withheld' still takes its real exit (AC 3)", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    s.answer["status"] = () => ({ event: "withheld" });
    await s.send({ v: 2, event: "withheld", worker: "w_9", spawn_req: s.spawnReq() });
    await until(() => s.bob().length === 1);
    await s.send(EXIT(s.spawnReq()));
    await until(() => s.bob().length === 2);
    expect(s.bob()[1]).toBe("Ann (w_9, studio/ann) on ubu1 done: fixed; handoff in worker_summary.");
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ state: "done", ended: 1, told: 1 });
  });
});

describe("A-fixes-2's minors (BOB-87)", () => {
  /** One withheld episode: a withheld event, then a withheld status; the orchestrator told. */
  async function episode(s: Awaited<ReturnType<typeof scripted>>, notices: number) {
    s.answer["status"] = () => ({ event: "withheld" });
    await s.send({ v: 2, event: "withheld", worker: "w_9", spawn_req: s.spawnReq() });
    await until(() => s.bob().length === notices);
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ ended: 0, state_withheld: 2 });
  }

  it("state_withheld goes back to 0 on a view that passes: two episodes on one copy, one notice each (AC 1)", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    await episode(s, 1);
    // A list that passes, the worker still running: the episode is over.
    s.answer["list"] = () => ({ workers: [view("w_9", s.spawnReq(), { checkpoint: "half way" })] });
    expect(await s.mbp.sup.reconcileOn("ubu1")).toBeNull();
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ state: "running", ended: 0, state_withheld: 0 });
    const asked = s.ops().length;
    await episode(s, 2);
    expect(s.ops().slice(asked)).toEqual(["status"]);
    expect(s.bob()).toEqual(["Ann on ubu1: state withheld, ask there.", "Ann on ubu1: state withheld, ask there."]);
    // Without a passing view between, a third withheld event is no new episode.
    await s.send({ v: 2, event: "withheld", worker: "w_9", spawn_req: s.spawnReq() });
    await tick(20);
    expect(s.bob().length).toBe(2);
  });

  it("and on an event that passes (AC 1)", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    await episode(s, 1);
    const { id } = await s.send({ v: 2, event: "remote_control", worker: "w_9", spawn_req: s.spawnReq(), url: "https://claude.ai/code/s1" });
    await until(() => s.net.acked(id));
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ remote_url: "https://claude.ai/code/s1", state_withheld: 0 });
    await episode(s, 2);
    expect(s.bob().length).toBe(2);
  });

  it.each([
    ["no reply", () => null, "no reply from ubu1 within 50 s"],
    ["ok: false", () => ({ ok: false, error: "busy" }), "busy"],
  ])("reconcile reports a withheld batch before it stops at %s (AC 3)", async (_, stopping, why) => {
    const { log, said } = logged();
    const s = await many(log);
    s.answer["list"] = (b) => (b["ids"].includes("w_00") ? { event: "withheld" } : stopping());
    const pass = s.mbp.sup.reconcileOn("ubu1");
    await until(() => s.lists().length === 2);
    s.net.advance(50);
    expect(await pass).toBe(why);
    expect(s.lists()).toEqual([s.ids.slice(0, 10), s.ids.slice(10, 20)]);
    expect(said.filter((l) => l.msg.includes("withheld a list reply"))).toEqual([expect.objectContaining({ level: "warn", laptop: "ubu1", withheld: s.ids.slice(0, 10) })]);
    expect(s.mbp.store.auditLog(50).filter((a) => a.action === "remote:list_withheld").map((a) => JSON.parse(a.detail))).toEqual([{ withheld: s.ids.slice(0, 10) }]);
  });
});

/** A logger that keeps its warnings and errors. */
function logged(): { log: Logger; said: Array<{ level: string; msg: string } & Record<string, unknown>> } {
  const said: Array<{ level: string; msg: string } & Record<string, unknown>> = [];
  const keep = (level: string) => (msg: string, fields?: Record<string, unknown>) => void said.push({ level, msg, ...fields });
  return { log: { ...quiet, warn: keep("warn"), error: keep("error") }, said };
}

describe("build A's minors (BOB-74)", () => {
  it("a reply with a missing or non-string id is logged and dropped; the supervisor keeps running (AC 1)", async () => {
    const { log, said } = logged();
    const s = await scripted(log);
    await s.call("spawn_worker", ANN);
    s.answer["status"] = () => null;
    const asking = s.call("worker_status", { id: "w_9" });
    await until(() => s.ops().includes("status"));
    const req = s.got.at(-1)!.id;
    const malformed = [
      { worker: { ...view("w_9", s.spawnReq()), id: undefined } },
      { worker: { ...view("w_9", s.spawnReq()), id: 42 } },
      { workers: [view("w_9", s.spawnReq()), { state: "failed" }] },
    ];
    for (const fields of malformed) await s.send({ v: 2, re: "status", req, ok: true, ...fields });
    // An exit whose state ends nothing is dropped the same way.
    await s.send(EXIT(s.spawnReq(), { state: "running" }));
    await until(() => said.filter((l) => l.msg.includes("doesn't parse")).length === 4);
    expect(said.filter((l) => l.level === "error")).toEqual([]);
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")).toMatchObject({ state: "running", ended: 0 });
    // Still running: the good reply is taken.
    await s.send({ v: 2, re: "status", req, ok: true, worker: view("w_9", s.spawnReq(), { checkpoint: "half way" }) });
    expect(await asking).toMatchObject({ id: "w_9", checkpoint: "half way" });
  });

  it("remoteAsk's wait is cleared when its reply comes: none left on the clock (AC 6)", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    const before = s.net.pending();
    s.answer["status"] = () => ({ worker: view("w_9", s.spawnReq()) });
    await s.call("worker_status", { id: "w_9" });
    expect(s.net.pending()).toEqual(before);
  });

  it("the supervisor's own sleep clears its timer when aborted (AC 6, fake timers)", async () => {
    vi.useFakeTimers();
    try {
      const waiting = new AbortController();
      const slept = sleepFor(90_000, waiting.signal);
      expect(vi.getTimerCount()).toBe(1);
      waiting.abort();
      await slept;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("list_workers laptop '*' asks the laptops in parallel: two silent targets cost one wait (AC 7)", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    // A second laptop with a copy on it, whose supervisor never answers either.
    const pi = s.net.link("pi");
    const piGot: string[] = [];
    pi.onPush = (f) => void (f.t === "deliver" && piGot.push(f.msg.body));
    await pi.register({ name: "supervisor" });
    s.net.clients.set("supervisor@pi", { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
    const now = new Date(s.net.now).toISOString();
    s.mbp.store.putRemoteCopy({ laptop: "pi", id: "w_7", to_name: "supervisor@pi", spawn_req: null, view: null, state: "running", as_of: now, ended: 0, handoff: null, remote_url: null, told: 0, state_withheld: 0 });
    s.answer["list"] = () => null;
    const listing = s.call("list_workers", { laptop: "*" });
    // Both lists are out before any wait ends.
    await until(() => s.ops().includes("list") && piGot.length === 1);
    s.net.advance(50);
    const rows = await listing;
    expect(rows.map((r: { id?: string; laptop: string; unreachable?: string }) => [r.id ?? null, r.laptop, r.unreachable])).toEqual([
      ["w_9", "ubu1", "no reply from ubu1 within 50 s"],
      ["w_7", "pi", "no reply from pi within 50 s"],
    ]);
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
    const { id } = await s.send({ v: 2, event: "remote_control", worker: "w_9", spawn_req: s.spawnReq(), error: "Remote Control is off" });
    await until(() => s.net.acked(id));
    expect(s.mbp.store.remoteCopy("ubu1", "w_9")!.remote_url).toBe("https://claude.ai/code/s1");
  });
});

// BOB-75 (B7): a spawn whose broker ack was lost (ADR 0007 §14, the ruling): kept unacked, not failed;
// reconcile's bare list adopts its worker by project and role; an unknown event from that laptop
// triggers it; a day on, the row goes; and at start, rows the dead tools left are settled as they would have.

const isSpawn = (f: { body: string }) => (JSON.parse(f.body) as { op?: string }).op === "spawn";
const LOST = "the broker's ack of the spawn was lost, so spawn_worker couldn't say whether it ran";

describe("a spawn whose broker ack was lost (BOB-75)", () => {
  it("kept unacked, not failed, its tool saying it may or may not have run; 'not connected' still failed (AC 1)", async () => {
    const { ubu, mbp, call } = await real();
    mbp.link.loseAck = (f) => (isSpawn(f) ? "timeout" : null);
    await expect(call("spawn_worker", ANN)).rejects.toThrow(
      "no ack from the broker for the spawn to supervisor@ubu1 (No reply to send within 15000 ms): the spawn may or may not have run; if it did, you are told when its worker is found",
    );
    expect(mbp.store.remoteSentList().filter((r) => r.op === "spawn")).toMatchObject([{ state: "unacked" }]);
    await until(() => ubu.sessions.length === 1);
    // A drop while it waited for the ack: the same.
    mbp.link.loseAck = (f) => (isSpawn(f) ? "disconnected" : null);
    await expect(call("spawn_worker", { ...ANN, role: "bea" })).rejects.toThrow("(Connection to the BobNet broker dropped): the spawn may or may not have run");
    expect(mbp.store.remoteSentList().filter((r) => r.op === "spawn").map((r) => r.state)).toEqual(["unacked", "unacked"]);
    // Not connected: the frame never left.
    mbp.link.loseAck = () => null;
    mbp.link.failSend = (f) => (isSpawn(f) ? "disconnected" : null);
    await expect(call("spawn_worker", { ...ANN, role: "bea" })).rejects.toThrow("could not send spawn to supervisor@ubu1: Not connected to the BobNet broker; retrying in the background");
    expect(mbp.store.remoteSentList().filter((r) => r.op === "spawn").at(-1)).toMatchObject({ state: "failed", message_id: null });
  });

  it("reconcile's bare list adopts each worker for the one unacked spawn of its project and role, never mixing two (AC 2)", async () => {
    const { ubu, mbp, call, bob } = await real();
    mbp.link.loseAck = (f) => (isSpawn(f) ? "timeout" : null);
    // No list gets through until both spawns are unacked, so one list has both workers.
    mbp.link.failSend = (f) => ((JSON.parse(f.body) as { op?: string }).op === "list" ? "unknown_peer" : null);
    await expect(call("spawn_worker", ANN)).rejects.toThrow(/may or may not have run/);
    await expect(call("spawn_worker", { ...ANN, role: "bea" })).rejects.toThrow(/may or may not have run/);
    await until(() => ubu.sessions.length === 2);
    expect(mbp.store.remoteCopies("ubu1")).toEqual([]);
    mbp.link.loseAck = () => null;
    mbp.link.failSend = () => null;
    await mbp.sup.reconcile();
    await until(() => mbp.store.remoteCopies("ubu1").length === 2);
    for (const w of ubu.store.workers()) {
      const row = mbp.store.remoteSentByMessage(w.spawn_req!)!;
      expect(row).toMatchObject({ op: "spawn", state: "unacked" });
      expect(JSON.parse(row.body)).toMatchObject({ role: w.role });
      expect(mbp.store.remoteCopy("ubu1", w.id)).toMatchObject({ spawn_req: w.spawn_req, state: "running" });
    }
    const [ann, bea] = ubu.store.workers().sort((a, b) => a.role.localeCompare(b.role));
    await until(() => bob().filter((b) => b.includes("spawned after all")).length === 2);
    expect(bob().filter((b) => b.includes("spawned after all")).sort()).toEqual([
      `Ann (${ann!.id}, studio/ann) on ubu1 spawned after all: ${LOST}. worker_status ${ann!.id} for more.`,
      `Bea (${bea!.id}, studio/bea) on ubu1 spawned after all: ${LOST}. worker_status ${bea!.id} for more.`,
    ]);
    // Adopted, its events match: the end reaches the copy.
    ubu.sessions[0]!.finish();
    await until(() => mbp.store.remoteCopy("ubu1", ann!.id)?.ended === 1);
  });

  it("an event for an unknown spawn, from a laptop with an unacked spawn, reconciles and adopts; its open requests come with the list (AC 3)", async () => {
    const s = await scripted();
    const bare = () => s.got.filter((g) => g.body["op"] === "list" && !g.body["ids"] && !g.body["reqs"]).length;
    s.answer["list"] = () => ({ workers: [] });
    s.mbp.link.loseAck = (f) => (isSpawn(f) ? "timeout" : null);
    await expect(s.call("spawn_worker", ANN)).rejects.toThrow(/may or may not have run/);
    // Its reply, matching no message id here, was dropped; the reconcile its loss started found nothing yet.
    await until(() => bare() === 1);
    expect(s.mbp.store.remoteCopies("ubu1")).toEqual([]);
    const ask = { request: "r_1", kind: "approval", tool: "Bash", tier: "orchestrator", rule: "probe", preview: "echo probe", state: "open", created_at: "2026-11-17T12:00:00.000Z" };
    s.answer["list"] = () => ({ workers: [{ ...view("w_9", s.spawnReq()), requests: [ask] }] });
    await s.send({ v: 2, event: "request", worker: "w_9", spawn_req: s.spawnReq(), ...ask });
    await until(() => bare() === 2);
    await until(() => s.mbp.store.remoteCopy("ubu1", "w_9") !== null);
    expect(s.mbp.store.remoteSentByMessage(s.spawnReq())).toMatchObject({ op: "spawn", state: "unacked" });
    await until(() => s.mbp.store.remoteAsk("ubu1", "r_1") !== null);
    expect(s.mbp.store.remoteAsk("ubu1", "r_1")).toMatchObject({ worker: "w_9", state: "open", tool: "Bash" });
    await until(() => s.bob().length === 2);
    expect(s.bob()).toEqual([
      `Ann (w_9, studio/ann) on ubu1 spawned after all: ${LOST}. worker_status w_9 for more.`,
      "Ann@ubu1 needs approval for Bash (r_1, ubu1, orchestrator decides; rule probe): echo probe. See pending_requests and answer with answer_request.",
    ]);
  });

  it("an event for an unknown spawn from a laptop with no unacked spawn is only dropped (AC 3)", async () => {
    const s = await scripted();
    await s.call("spawn_worker", ANN);
    s.answer["list"] = () => ({ workers: [view("w_8", "m_nothing", { role: "bea" })] });
    const { id } = await s.send({ v: 2, event: "remote_control", worker: "w_8", spawn_req: "m_nothing", url: "https://claude.ai/code/x" });
    await until(() => s.net.acked(id));
    await tick(20);
    expect(s.ops()).toEqual(["spawn"]);
    expect(s.mbp.store.remoteCopy("ubu1", "w_8")).toBeNull();
  });

  it("a worker a bare list names that no spawn here made, or that two unacked spawns could be, isn't adopted", async () => {
    const s = await scripted();
    s.answer["list"] = () => ({ workers: [] });
    s.mbp.link.loseAck = (f) => (isSpawn(f) ? "timeout" : null);
    await expect(s.call("spawn_worker", ANN)).rejects.toThrow(/may or may not have run/);
    await expect(s.call("spawn_worker", ANN)).rejects.toThrow(/may or may not have run/);
    s.answer["list"] = () => ({ workers: [view("w_9", "m_x1"), view("w_7", "m_x2", { role: "bea" })] });
    await s.mbp.sup.reconcile();
    expect(s.mbp.store.remoteCopies("ubu1")).toEqual([]);
    expect(s.mbp.store.remoteSentList().filter((r) => r.op === "spawn").map((r) => [r.state, r.message_id])).toEqual([
      ["unacked", null],
      ["unacked", null],
    ]);
  });

  it("an unacked row is dropped after a day (AC 4)", async () => {
    const s = await scripted();
    const bare = () => s.got.filter((g) => g.body["op"] === "list" && !g.body["ids"] && !g.body["reqs"]).length;
    s.answer["list"] = () => ({ workers: [] });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-20T10:00:00.000Z"));
      s.mbp.store.addRemoteSent({ id: "rs_old", to: SUP_UBU, op: "spawn", target: null, body: JSON.stringify({ v: 2, op: "spawn", project: "studio", role: "ann", task: "x", by: "Bob" }), deadline: "2026-11-20T10:01:30.000Z" });
      s.mbp.store.settleRemoteSent("rs_old", { state: "unacked" });
      vi.setSystemTime(new Date("2026-11-21T09:59:00.000Z"));
      await s.mbp.sup.reconcile();
      expect(s.mbp.store.remoteSent("rs_old")).toMatchObject({ state: "unacked" });
      expect(bare()).toBe(1);
      vi.setSystemTime(new Date("2026-11-21T10:00:01.000Z"));
      await s.mbp.sup.reconcile();
      expect(s.mbp.store.remoteSent("rs_old")).toBeNull();
      expect(bare()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("at the requester's start: sent becomes unanswered, sending unacked, so a spawn whose tool died still gets 'spawned after all' (AC 5)", async () => {
    const net = new FakeNetwork();
    net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
    const ubu = await boot(net, "ubu1", UBU);
    const at = newStore();
    const first = await boot(net, "mbp-1", "", at);
    await first.link.register({ name: "Bob" });
    // The spawn tool wrote its row and the frame left, then the process died before the broker's ack.
    const body = JSON.stringify({ v: 2, op: "spawn", project: "studio", role: "ann", task: "one fix", by: "Bob" });
    at.store.addRemoteSent({ id: "rs_ann", to: SUP_UBU, op: "spawn", target: null, body, deadline: new Date(Date.now() + 90_000).toISOString() });
    await first.link.request({ t: "send", as: "supervisor", to: [SUP_UBU], body });
    // A status whose wait the restart ended, its deadline still ahead.
    at.store.addRemoteSent({ id: "rs_status", to: SUP_UBU, op: "status", target: "w_1", body: JSON.stringify({ v: 2, op: "status", id: "w_1" }), deadline: new Date(Date.now() + 50_000).toISOString() });
    at.store.remoteSentAs("rs_status", "m_status");
    await until(() => ubu.sessions.length === 1);
    await first.sup.shutdown();
    running.splice(running.indexOf(first.sup), 1);
    await boot(net, "mbp-1", "", at);
    expect(at.store.remoteSent("rs_status")).toMatchObject({ state: "unanswered" });
    expect(at.store.remoteSent("rs_ann")!.state).toBe("unacked");
    const ann = ubu.store.workers()[0]!;
    await until(() => at.store.remoteCopy("ubu1", ann.id) !== null);
    expect(at.store.remoteSent("rs_ann")).toMatchObject({ state: "unacked", message_id: ann.spawn_req });
    await until(() => net.between(SUP_MBP, "Bob@mbp-1").some((b) => b.includes("spawned after all")));
    expect(net.between(SUP_MBP, "Bob@mbp-1").filter((b) => b.includes("spawned after all"))).toEqual([`Ann (${ann.id}, studio/ann) on ubu1 spawned after all: ${LOST}. worker_status ${ann.id} for more.`]);
  });
});
