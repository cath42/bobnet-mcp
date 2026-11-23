import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrokerError } from "@bobnet/client/connection";
import { BoardOp, type BoardOpInput } from "@bobnet/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSupervisorConfig } from "../src/config.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { downsample, repoName, Supervisor } from "../src/supervisor.ts";
import type { Releases } from "../src/upgrade.ts";
import { ZERO_USAGE } from "../src/worker.ts";
import { FakeBroker, fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";

// A project on BobNet's board service (ADR 0001 §6, §8, §9, §10, §12): spawns
// join their session first, runs report through the outbox, and workers get
// the board's tools as their role, with their ctx.

const POLICY = new Policy(`
rules:
  - { id: read, tools: [Read], decision: allow }
`);

const BOBNET = `
  bobnet:
    path: /work/bobnet
    priority: 2
    board: service
    roles:
      luigi: { dir: /work/bobnet-luigi/packages, name: Luigi }
      toad: { dir: /work/bobnet-toad/architecture, name: Toad }
`;

let dir: string;
let store: Store;
let running: Supervisor[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bobnet-board-"));
  store = new Store(join(dir, "supervisor.db"));
});
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.shutdown()));
  await tick(20);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function setup(config = testConfig(dir, BOBNET), opts: { remoteControl?: boolean; releases?: Releases } = {}) {
  const broker = new FakeBroker();
  const { queryFn, sessions } = fakeQuery(opts);
  const captureDir = join(dir, "captures");
  const sup = new Supervisor({ config, policy: POLICY, store, broker, queryFn, log: quiet, sandboxCheck: async () => null, captureDir, ...(opts.releases ? { releases: opts.releases } : {}) });
  await sup.start();
  running.push(sup);
  return { sup, broker, sessions, captureDir };
}

const spawn = { project: "bobnet", role: "luigi", task: "Build step 2", tasks: ["BOB-2"], session: { feature: "BOB-2", kind: "build" as const } };
const ops = (broker: FakeBroker, name?: string) => broker.boardOps.filter((o) => name === undefined || o.op.op === name);

describe("a spawn into a session", () => {
  it("joins the session first, as the role, with the worker's ctx; a build with no label is build 1", async () => {
    const { sup, broker } = await setup();
    const w = await sup.spawnJoined(spawn);
    const ctx = { worker: w.id, role: "luigi", project: "bobnet", session: { feature: "BOB-2", kind: "build", label: "1" }, tasks: ["BOB-2"] };
    expect(ops(broker)[0]).toEqual({ as: "Luigi", ctx, op: { op: "session_join", project: "bobnet", session: ctx.session } });
    await until(() => ops(broker, "run_start").length === 1);
    expect(ops(broker, "run_start")[0]).toMatchObject({ as: "Luigi", ctx, op: { id: w.id, session: ctx.session, tasks: ["BOB-2"], resumed: false } });
  });

  it("fails, starting nothing, when the board refuses the join or can't be reached", async () => {
    const { sup, broker } = await setup();
    broker.board = (op) => {
      if (op.op === "session_join") throw new BrokerError("conflict", "BOB-2 build 1 is closed; name another label");
      return { ref: null, seq: 1 };
    };
    await expect(sup.spawnJoined(spawn)).rejects.toThrow("Luigi isn't spawned: the board refused to join BOB-2 build: BOB-2 build 1 is closed; name another label");
    broker.boardUp = false;
    await expect(sup.spawnJoined(spawn)).rejects.toThrow(/the board can't be reached to join BOB-2 build: the board is unavailable since/);
    expect(store.workers({ project: "bobnet" })).toEqual([]);
  });

  it("names its items and session, as ids the board knows", async () => {
    const { sup } = await setup();
    const { tasks: _, ...untasked } = spawn;
    await expect(sup.spawnJoined(untasked)).rejects.toThrow("bobnet has a board: say which items");
    await expect(sup.spawnJoined({ ...spawn, tasks: ["BOB-1234567"] })).rejects.toThrow("not item ids on bobnet's board: BOB-1234567");
    await expect(sup.spawnJoined({ ...spawn, session: { feature: "BOB-2.", kind: "build" } })).rejects.toThrow("isn't a feature id");
  });

  it("takes an imported dotted ref as a task, and as a session's feature once promoted (ADR 0001 §2)", async () => {
    const { sup, broker } = await setup();
    const w = await sup.spawnJoined({ ...spawn, tasks: ["bob-1.1"], session: { feature: "BOB-1.1", kind: "build" } });
    const session = { feature: "BOB-1.1", kind: "build", label: "1" };
    expect(ops(broker)[0]).toEqual({ as: "Luigi", ctx: { worker: w.id, role: "luigi", project: "bobnet", session, tasks: ["BOB-1.1"] }, op: { op: "session_join", project: "bobnet", session } });
  });

  it("reads its feature's release from the board, for the Remote Control name; a board that can't say leaves it out (BOB-116)", async () => {
    const { sup, broker, sessions } = await setup(testConfig(dir, BOBNET), { remoteControl: true });
    broker.board = (op) => (op.op === "get" ? { item: { ref: "BOB-2", release: "R2" } } : { ref: null, seq: 1 });
    const w = await sup.spawnJoined({ ...spawn, session: { feature: "BOB-2", kind: "build", label: "A" } });
    expect(ops(broker, "get")[0]).toMatchObject({ as: "Luigi", op: { op: "get", project: "bobnet", ref: "BOB-2" } });
    expect(JSON.parse(w.declared_session!)).toEqual({ feature: "BOB-2", kind: "build", label: "A", release: "R2" });
    await until(() => sessions[0]?.remoteCalls.length === 1);
    expect(sessions[0]!.remoteCalls[0]![1]).toBe("Luigi@mbp-1 Bob.r2.2.bA");
    broker.board = (op) => {
      if (op.op === "get") throw new BrokerError("unavailable", "the board is unavailable since then; wait and retry");
      return { ref: null, seq: 1 };
    };
    const t = await sup.spawnJoined({ ...spawn, role: "toad", session: { feature: "BOB-2", kind: "review", label: "B" } });
    expect(JSON.parse(t.declared_session!)).toEqual({ feature: "BOB-2", kind: "review", label: "B" });
  });

  it("leaves a project on Backlog.md alone", async () => {
    const { sup, broker } = await setup();
    await sup.spawnJoined({ project: "helix", role: "bill", task: "x" });
    await tick(20);
    expect(broker.boardOps).toEqual([]);
  });
});

describe("a run's reports", () => {
  it("ends with its own tokens and context per call, after its start", async () => {
    const { sup, broker, sessions } = await setup();
    const w = await sup.spawnJoined(spawn);
    await until(() => ops(broker, "run_remote").length === 1);
    sessions[0]!.say("one", { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    sessions[0]!.say("two", { input_tokens: 2000, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    sessions[0]!.totals = { inputTokens: 3000, outputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1 };
    sessions[0]!.finish();
    await until(() => ops(broker, "run_end").length === 1);
    expect(ops(broker).map((o) => o.op.op)).toEqual(["session_join", "get", "run_start", "run_remote", "run_end"]);
    const end = ops(broker, "run_end")[0]!.op as Extract<BoardOpInput, { op: "run_end" }>;
    expect(end).toMatchObject({ id: w.id, calls: 2, tokens: { input: 3000, output: 30, cache_read: 0, cache_write: 0 } });
    expect(end.ctx).toHaveLength(2);
    expect(end).not.toHaveProperty("cost_usd");
    expect(store.outbox()).toEqual([]);
  });

  it("reports its tokens by model, its subagent's too, adding up to its own; a resumed run's net of the earlier one (ADR 0014 §2)", async () => {
    const { sup, broker, sessions } = await setup();
    const first = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1 && store.worker(first.id)!.session_id !== null);
    const opus = (inputTokens: number, outputTokens: number) => ({ inputTokens, outputTokens, cacheReadInputTokens: 7, cacheCreationInputTokens: 5 });
    const zero = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 };
    sessions[0]!.totals = zero;
    sessions[0]!.others = { "claude-opus-5-5": opus(1000, 100), "claude-haiku-5-5": opus(300, 30) };
    sessions[0]!.finish();
    await until(() => ops(broker, "run_end").length === 1);
    const ends = () => ops(broker, "run_end").map((o) => o.op as Extract<BoardOpInput, { op: "run_end" }>);
    expect(ends()[0]).toMatchObject({ tokens: { input: 1300, output: 130, cache_read: 14, cache_write: 10 } });
    expect(ends()[0]!.models).toEqual([
      { model: "claude-opus-5-5", tokens: { input: 1000, output: 100, cache_read: 7, cache_write: 5 } },
      { model: "claude-haiku-5-5", tokens: { input: 300, output: 30, cache_read: 7, cache_write: 5 } },
    ]);
    // The SDK's totals for the resumed session include the first run; Haiku wasn't used again.
    const again = await sup.spawnJoined({ ...spawn, session: { ...spawn.session, label: "2" }, resume_session: store.worker(first.id)!.session_id! });
    await until(() => sessions.length === 2);
    sessions[1]!.totals = zero;
    sessions[1]!.others = { "claude-opus-5-5": opus(1600, 150), "claude-haiku-5-5": opus(300, 30) };
    sessions[1]!.finish();
    await until(() => ops(broker, "run_end").length === 2);
    expect(ends()[1]).toMatchObject({ id: again.id, tokens: { input: 600, output: 50, cache_read: 0, cache_write: 0 } });
    expect(ends()[1]!.models).toEqual([{ model: "claude-opus-5-5", tokens: { input: 600, output: 50, cache_read: 0, cache_write: 0 } }]);
  });

  it("sends no models for a run that ended mid-turn, nor for one resuming a session whose models aren't known", async () => {
    const { sup, broker, sessions } = await setup();
    const first = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1 && store.worker(first.id)!.session_id !== null);
    sessions[0]!.totals = { inputTokens: 1000, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 };
    sessions[0]!.turnDone();
    sessions[0]!.say("into the next turn", { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    sessions[0]!.end();
    await until(() => ops(broker, "run_end").length === 1);
    const ends = () => ops(broker, "run_end").map((o) => o.op as Extract<BoardOpInput, { op: "run_end" }>);
    expect(ends()[0]).toMatchObject({ tokens: { input: 1050, output: 105 } });
    expect(ends()[0]).not.toHaveProperty("models");
    // Its usage as a supervisor before this one kept it: totals, no models.
    store.updateWorker(first.id, { usage: JSON.stringify({ cum: { tokens: { input: 1000, output: 100, cache_read: 0, cache_write: 0 } }, base: ZERO_USAGE }) });
    await sup.spawnJoined({ ...spawn, session: { ...spawn.session, label: "2" }, resume_session: store.worker(first.id)!.session_id! });
    await until(() => sessions.length === 2);
    sessions[1]!.totals = { inputTokens: 1600, outputTokens: 150, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 };
    sessions[1]!.finish();
    await until(() => ops(broker, "run_end").length === 2);
    expect(ends()[1]).toMatchObject({ tokens: { input: 600, output: 50 } });
    expect(ends()[1]).not.toHaveProperty("models");
  });

  it("says how it ended: done with no reason, failed with its error, stopped with its reason (ADR 0005 §3)", async () => {
    const { sup, broker, sessions } = await setup();
    const done = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    sessions[0]!.finish();
    await until(() => ops(broker, "run_end").length === 1);
    const failed = await sup.spawnJoined({ ...spawn, session: { ...spawn.session, label: "2" } });
    await until(() => sessions.length === 2);
    sessions[1]!.fail();
    await until(() => ops(broker, "run_end").length === 2);
    const stopped = await sup.spawnJoined({ ...spawn, session: { ...spawn.session, label: "3" } });
    await until(() => sessions.length === 3);
    // Stopped mid-turn: it gets its last turn for the handoff, then ends.
    const stopping = sup.stop(stopped.id);
    await until(() => sessions[2]!.inputs.length === 2);
    sessions[2]!.turnDone("handoff written");
    await stopping;
    await until(() => ops(broker, "run_end").length === 3);
    const ends = ops(broker, "run_end").map((o) => o.op as Extract<BoardOpInput, { op: "run_end" }>);
    expect(ends.map((e) => [e.id, e.outcome, e.reason])).toEqual([
      [done.id, "done", undefined],
      [failed.id, "failed", expect.any(String)],
      [stopped.id, "stopped", "stopped by the orchestrator"],
    ]);
    expect(ends[1]!.reason!.length).toBeGreaterThan(0);
  });

  it("ends a run the supervisor didn't see end as lost at its next start, tokens unknown, through the outbox (ADR 0005 §3)", async () => {
    const first = await setup();
    const w = await first.sup.spawnJoined(spawn);
    await until(() => ops(first.broker, "run_start").length === 1);
    // The supervisor dies with the worker running; a new one starts on the same store.
    const second = await setup();
    await until(() => ops(second.broker, "run_end").length === 1);
    expect(ops(second.broker, "run_end")[0]).toMatchObject({
      as: "Luigi",
      ctx: { worker: w.id },
      op: { op: "run_end", project: "bobnet", id: w.id, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, calls: 0, outcome: "lost", reason: "supervisor restarted" },
    });
    expect(ops(second.broker, "run_end")[0]!.op).not.toHaveProperty("models");
  });

  it("gives its run the Remote Control link once the worker has it, after its start; nothing when it has none", async () => {
    const { sup, broker } = await setup();
    const w = await sup.spawnJoined(spawn);
    await until(() => ops(broker, "run_remote").length === 1);
    expect(ops(broker).map((o) => o.op.op)).toEqual(["session_join", "get", "run_start", "run_remote"]);
    expect(ops(broker, "run_remote")[0]).toMatchObject({ as: "Luigi", ctx: { worker: w.id }, op: { op: "run_remote", project: "bobnet", id: w.id, remote_url: "https://claude.ai/code/session_test" } });
    expect(ops(broker, "run_start")[0]!.op).not.toHaveProperty("remote_url");

    const without = await setup(testConfig(dir, BOBNET), { remoteControl: false });
    const v = await without.sup.spawnJoined(spawn);
    await until(() => store.auditLog().some((a) => a.action === "remote-control:failed" && a.worker_id === v.id));
    await tick(20);
    expect(ops(without.broker, "run_remote")).toEqual([]);
  });

  /** The board away for everything but the join a spawn waits for; what it took, in order. */
  function away(broker: FakeBroker) {
    const state = { away: true, taken: [] as string[] };
    broker.board = (op) => {
      if (state.away && op.op !== "session_join") throw new BrokerError("unavailable", "the board is unavailable since then; wait and retry");
      state.taken.push(`${op.op}${"id" in op ? ` ${op.id}` : ""}`);
      return { ref: null, seq: 1 };
    };
    return state;
  }

  it("waits in the outbox while the board is away, and goes in order once the broker is back", async () => {
    const { sup, broker, sessions } = await setup();
    const board = away(broker);
    const w = await sup.spawnJoined(spawn);
    await until(() => store.outbox("board_op").length === 2);
    sessions[0]!.finish();
    await until(() => store.outbox("board_op").length === 3);
    board.away = false;
    sup.onConnected();
    await until(() => store.outbox().length === 0);
    expect(board.taken).toEqual(["session_join", `run_start ${w.id}`, `run_remote ${w.id}`, `run_end ${w.id}`]);
  });

  it("drops a report the board refuses, so it holds up none behind it", async () => {
    const { sup, broker, sessions } = await setup();
    const board = away(broker);
    await sup.spawnJoined(spawn);
    await until(() => store.outbox("board_op").length === 2);
    sessions[0]!.finish();
    await until(() => store.outbox("board_op").length === 3);
    board.away = false;
    broker.board = (op) => {
      if (op.op === "run_start") throw new BrokerError("invalid", "No session BOB-2 build 1 in bobnet");
      return { ref: null, seq: 1 };
    };
    sup.onConnected();
    await until(() => store.outbox().length === 0);
    expect(ops(broker, "run_end")).toHaveLength(1);
    expect(store.auditLog().find((a) => a.action === "board:refused")).toMatchObject({ detail: expect.stringContaining("No session BOB-2 build 1") });
  });

  it("drops a report made as a role no longer configured, and one that doesn't parse, so neither holds up the rest", async () => {
    const { sup, broker } = await setup();
    const ctx = { worker: "w_gone", role: "gone", project: "bobnet", session: null, tasks: [] };
    store.addOutbox("Gone", JSON.stringify({ ctx, op: { op: "run_end", project: "bobnet", id: "w_gone", ended_at: "2026-11-15T00:00:00.000Z", tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, calls: 0 } }), "board_op");
    store.addOutbox("Luigi", "{not json", "board_op");
    store.addOutbox("Luigi", JSON.stringify({ ctx: { ...ctx, worker: "w_1", role: "luigi" }, op: { op: "run_end", project: "bobnet", id: "w_1", ended_at: "2026-11-15T00:00:00.000Z", tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, calls: 0 } }), "board_op");
    broker.board = () => ({ ref: null, seq: 1 });
    sup.onConnected();
    await until(() => store.outbox().length === 0);
    expect(ops(broker, "run_end").map((o) => o.as)).toEqual(["Luigi"]);
    expect(store.auditLog().filter((a) => a.action === "board:refused").map((a) => JSON.parse(a.detail).code).sort()).toEqual(["bad_row", "not_hosted"]);
  });

  it("clips a slot run's long name, and drops a row the protocol won't take, so neither holds up the rest (BOB-27)", async () => {
    const { sup, broker } = await setup();
    const ctx = { worker: "w_1", role: "luigi", project: "bobnet", session: null, tasks: [] };
    const long = `cd /Users/ct/Code/bobnet-mcp-luigi/packages/broker; npx vitest run test/board.test.ts -t "progress" 2>&1 | tail -15`;
    store.addOutbox("Luigi", JSON.stringify({ ctx, op: { op: "slot_run", project: "bobnet", external_id: "mbp-1:s1", name: long, status: "running" } }), "board_op");
    store.addOutbox("Luigi", JSON.stringify({ ctx, op: { op: "run_end", project: "bobnet" } }), "board_op");
    store.addOutbox("Luigi", JSON.stringify({ ctx, op: { op: "run_end", project: "bobnet", id: "w_1", ended_at: "2026-11-15T00:00:00.000Z", tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, calls: 0 } }), "board_op");
    broker.board = () => ({ ref: null, seq: 1 });
    sup.onConnected();
    await until(() => store.outbox().length === 0);
    const [slot] = ops(broker, "slot_run").map((o) => o.op as Extract<BoardOpInput, { op: "slot_run" }>);
    expect(slot!.name).toHaveLength(100);
    expect(slot!.name.endsWith("…")).toBe(true);
    expect(ops(broker, "run_end")).toHaveLength(1);
    expect(store.auditLog().filter((a) => a.action === "board:refused").map((a) => JSON.parse(a.detail).code)).toEqual(["bad_row"]);
  });
});

describe("the board outbox in the report (BOB-28, ADR 0012 §3)", () => {
  const ctx = { worker: "w_1", role: "luigi", project: "bobnet", session: null, tasks: [] };
  const runEnd = (id: string) => ({ op: "run_end", project: "bobnet", id, ended_at: "2026-11-15T00:00:00.000Z", tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, calls: 0 });

  it("reads empty, then the count, the oldest and the code the head waits on, then empty again", async () => {
    const { sup, broker } = await setup();
    expect(sup.snapshot().board_outbox).toEqual({ count: 0, oldest_at: null, code: null });
    broker.board = () => {
      throw new BrokerError("unavailable", "the board is unavailable since then; wait and retry");
    };
    store.addOutbox("Luigi", JSON.stringify({ ctx, op: runEnd("w_1") }), "board_op");
    const oldest = store.outbox("board_op")[0]!.created_at;
    // Queued, not yet tried: no code.
    expect(sup.snapshot().board_outbox).toEqual({ count: 1, oldest_at: oldest, code: null });
    store.addOutbox("Luigi", JSON.stringify({ ctx, op: runEnd("w_2") }), "board_op");
    sup.onConnected();
    await until(() => sup.snapshot().board_outbox?.code === "unavailable");
    expect(sup.snapshot().board_outbox).toEqual({ count: 2, oldest_at: oldest, code: "unavailable" });
    // The head went another way (here, by hand): its code isn't the new head's.
    store.removeOutbox(store.outbox("board_op")[0]!.seq);
    expect(sup.snapshot().board_outbox).toMatchObject({ count: 1, code: null });
    broker.board = () => ({ ref: null, seq: 1 });
    sup.onConnected();
    await until(() => store.outbox().length === 0);
    expect(sup.snapshot().board_outbox).toEqual({ count: 0, oldest_at: null, code: null });
  });

  it("drops a row whose ctx the protocol won't take, audited board:refused, so it holds up none behind it (BOB-28 AC 2)", async () => {
    const { sup, broker } = await setup();
    store.addOutbox("Luigi", JSON.stringify({ ctx: { ...ctx, tasks: "BOB-2" }, op: runEnd("w_1") }), "board_op");
    store.addOutbox("Luigi", JSON.stringify({ ctx, op: runEnd("w_2") }), "board_op");
    broker.board = () => ({ ref: null, seq: 1 });
    sup.onConnected();
    await until(() => store.outbox().length === 0);
    expect(ops(broker, "run_end").map((o) => (o.op as { id: string }).id)).toEqual(["w_2"]);
    const refused = store.auditLog().filter((a) => a.action === "board:refused").map((a) => JSON.parse(a.detail));
    expect(refused).toEqual([{ op: "run_end", code: "bad_row", message: expect.stringMatching(/^ctx: /) }]);
  });

  it("clips a slot run's name by whole code points, never splitting a surrogate pair, and still within the limit (BOB-28 AC 2)", async () => {
    const { sup, broker } = await setup();
    // A pair at units 98-99: a clip at 99 units would split it.
    const pair = `${"x".repeat(98)}🚀 and the rest of a long command`;
    const wide = "🚀".repeat(60);
    for (const [i, name] of [pair, wide].entries()) {
      store.addOutbox("Luigi", JSON.stringify({ ctx, op: { op: "slot_run", project: "bobnet", external_id: `mbp-1:s${i}`, name, status: "running" } }), "board_op");
    }
    broker.board = () => ({ ref: null, seq: 1 });
    sup.onConnected();
    await until(() => store.outbox().length === 0);
    const names = ops(broker, "slot_run").map((o) => (o.op as Extract<BoardOpInput, { op: "slot_run" }>).name);
    expect(names).toEqual([`${"x".repeat(98)}…`, `${"🚀".repeat(49)}…`]);
    expect(names.every((n) => n.length <= 100 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(n))).toBe(true);
    expect(store.auditLog().filter((a) => a.action === "board:refused")).toEqual([]);
  });
});

describe("the board tools a worker gets", () => {
  type Tool = { handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> };
  const toolsOf = (srv: unknown) => (srv as { instance: { _registeredTools: Record<string, Tool> } }).instance._registeredTools;

  it("come only on a project on the service, made as the role with the worker's ctx", async () => {
    const { sup, broker, sessions } = await setup();
    sup.spawn({ project: "helix", role: "bill", task: "x" });
    const w = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 2);
    const helix = toolsOf(sessions[0]!.options.mcpServers!["bobnet"]);
    const bobnet = toolsOf(sessions[1]!.options.mcpServers!["bobnet"]);
    expect(Object.keys(helix)).not.toContain("board_list");
    expect(Object.keys(bobnet)).toEqual(expect.arrayContaining(["board_list", "board_get", "board_capture", "board_write", "board_ask", "close_session", "board_grants"]));

    broker.board = () => ({ items: [], total: 0, cursor: null });
    await bobnet["board_list"]!.handler({ of: "backlog" }, {});
    expect(ops(broker, "list")[0]).toMatchObject({ as: "Luigi", ctx: { worker: w.id, session: { feature: "BOB-2" } }, op: { project: "bobnet", of: "backlog" } });
  });

  it("read a close's handoff only from the worker's own places", async () => {
    const { sup, sessions } = await setup();
    await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    const close = toolsOf(sessions[0]!.options.mcpServers!["bobnet"])["close_session"]!;
    const outside = join(dir, "secret.md");
    writeFileSync(outside, "x");
    const r = await close.handler({ session: { feature: "BOB-2", kind: "build", label: "1" }, need: "none", summary: "s", handoff: outside }, {});
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/reads a handoff in your worktree, the project or the project's handoffs folder/);
  });

  it("follow no symlink out of the worker's own places", async () => {
    const worktree = join(dir, "bobnet-luigi");
    mkdirSync(join(worktree, "packages"), { recursive: true });
    const outside = join(dir, "secret.md");
    writeFileSync(outside, "x");
    symlinkSync(outside, join(worktree, "packages", "handoff.md"));
    const config = testConfig(dir, BOBNET.replace("/work/bobnet-luigi/packages", join(worktree, "packages")));
    const { sup, sessions } = await setup(config);
    await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    const close = toolsOf(sessions[0]!.options.mcpServers!["bobnet"])["close_session"]!;
    const r = await close.handler({ session: { feature: "BOB-2", kind: "build", label: "1" }, need: "none", summary: "s", handoff: "handoff.md" }, {});
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/reads a handoff in your worktree/);
  });

  it("queue a capture with the worker's ctx, and the supervisor sends it once the board is back", async () => {
    const { sup, broker, sessions, captureDir } = await setup();
    const w = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    broker.boardUp = false;
    const capture = toolsOf(sessions[0]!.options.mcpServers!["bobnet"])["board_capture"]!;
    const r = await capture.handler({ title: "The chart is slow" }, {});
    expect(JSON.parse(r.content[0]!.text)).toMatchObject({ queued: true });
    expect(readdirSync(captureDir).filter((n) => n.endsWith(".json"))).toHaveLength(1);
    broker.boardUp = true;
    broker.board = () => ({ ref: "BOB-30", seq: 9, duplicate: false, dropped: [] });
    sup.onConnected();
    await until(() => ops(broker, "capture").length > 0 && readdirSync(captureDir).filter((n) => n.endsWith(".json")).length === 0);
    expect(ops(broker, "capture").at(-1)).toMatchObject({ as: "Luigi", ctx: { worker: w.id }, op: { project: "bobnet", title: "The chart is slow" } });
  });
});

describe("pushes and slot runs", { timeout: 20_000 }, () => {
  it("reports what a land pushed, and its land slot run passed", async () => {
    const worktree = join(dir, "bobnet-luigi");
    mkdirSync(join(worktree, "packages"), { recursive: true });
    const g = (...args: string[]) => execFileSync("git", ["-C", worktree, ...args]).toString().trim();
    execFileSync("git", ["init", "-q", worktree]);
    writeFileSync(join(worktree, "README"), "x");
    g("add", ".");
    g("-c", "user.name=Luigi", "-c", "user.email=l@x", "commit", "-qm", "init");
    g("remote", "add", "origin", "https://github.com/cath42/bobnet-mcp.git");
    const script = join(dir, "land.sh");
    writeFileSync(script, "#!/bin/sh\necho landed\n");
    chmodSync(script, 0o755);
    const config = parseSupervisorConfig(
      `
orchestrator: Mario
state_dir: ${dir}
projects:
  bobnet:
    path: ${worktree}
    board: service
    land: { command: [${script}] }
    roles:
      luigi: { dir: ${join(worktree, "packages")}, name: Luigi }
`,
      (d) => d,
    );
    const { sup, broker, sessions } = await setup(config);
    const w = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    expect(await sup.land(w.id)).toMatchObject({ ok: true });
    await until(() => ops(broker, "push").length === 1 && ops(broker, "slot_run").length === 2);
    expect(ops(broker, "push")[0]).toMatchObject({ as: "Luigi", ctx: { worker: w.id }, op: { project: "bobnet", repo: "cath42/bobnet-mcp", branch: "main", sha: g("rev-parse", "HEAD") } });
    expect(ops(broker, "slot_run").map((o) => (o.op as { status: string }).status)).toEqual(["running", "passed"]);
  });

  /** A worktree of bobnet with one commit, its origin `remote` (GitHub's URL by default), and a land script that runs `script`. */
  function landable(script = "echo landed", remote = "https://github.com/cath42/bobnet-mcp.git", extra = "") {
    const worktree = join(dir, "bobnet-luigi");
    mkdirSync(join(worktree, "packages"), { recursive: true });
    const g = (...args: string[]) => execFileSync("git", ["-C", worktree, "-c", "user.name=Luigi", "-c", "user.email=l@x", ...args]).toString().trim();
    execFileSync("git", ["init", "-q", "-b", "main", worktree]);
    writeFileSync(join(worktree, "README"), "x");
    g("add", ".");
    g("commit", "-qm", "init");
    g("remote", "add", "origin", remote);
    const land = join(dir, "land.sh");
    writeFileSync(land, `#!/bin/sh\n${script}\n`);
    chmodSync(land, 0o755);
    const config = parseSupervisorConfig(
      `
orchestrator: Mario
state_dir: ${dir}
projects:
  bobnet:
    path: ${worktree}
    board: service
    land: { command: [${land}]${extra} }
    roles:
      luigi: { dir: ${join(worktree, "packages")}, name: Luigi }
`,
      (d) => d,
    );
    const commit = (message: string) => {
      writeFileSync(join(worktree, "README"), message);
      g("commit", "-qam", message);
      return g("rev-parse", "HEAD");
    };
    return { worktree, g, config, commit };
  }

  it("reports the bug a landed commit's Fixes: trailer names, beside its Co-Authored-By:, and two from one trailer (ADR 0011 §1)", async () => {
    const { config, commit } = landable();
    const { sup, broker, sessions } = await setup(config);
    const w = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    const subject = "v2: BOB-27: board reports no longer stall behind a row the protocol won't take";
    const first = commit(`${subject}\n\nThe report skips the row.\n\nFixes: BOB-27\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`);
    expect(await sup.land(w.id)).toMatchObject({ ok: true });
    await until(() => ops(broker, "push").length === 1);
    expect(ops(broker, "push")[0]!.op).toMatchObject({ sha: first, fixes: [{ ref: "BOB-27", sha: first, subject }] });
    const second = commit("v2: BOB-30: the waits link\n\nFixes: BOB-27, BOB-30\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>");
    expect(await sup.land(w.id)).toMatchObject({ ok: true });
    await until(() => ops(broker, "push").length === 2);
    expect(ops(broker, "push")[1]!.op).toMatchObject({ sha: second, fixes: [{ ref: "BOB-27", sha: second }, { ref: "BOB-30", sha: second }] });
    // A ref in the subject alone fixes nothing: the push has no fixes.
    commit("v2: BOB-122: plan");
    expect(await sup.land(w.id)).toMatchObject({ ok: true });
    await until(() => ops(broker, "push").length === 3);
    expect(ops(broker, "push")[2]!.op).not.toHaveProperty("fixes");
  });

  it("tells a worker, in land's description, to carry Fixes: <REF>, and in its board tools to keep, withdraw and ask on the board", async () => {
    const { config } = landable();
    const { sup, sessions } = await setup(config);
    await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    const tools = (sessions[0]!.options.mcpServers!["bobnet"] as unknown as { instance: { _registeredTools: Record<string, { description: string }> } }).instance._registeredTools;
    expect(tools["land"]!.description).toMatch(/A commit that fixes a bug carries the trailer Fixes: <REF>\.$/);
    expect(tools["board_ask"]!.description).toContain("A lead waiting on Casper asks here, with holds_sessions, never only in plain text.");
    expect(tools["board_write"]!.description).toMatch(/keep \{ref, reason\}.*withdraw \{ref, reason\}/);
  });

  it("clips what it sends to what the board takes: a subject of 200 at most, 20 fixes at most (review A)", async () => {
    const { config, commit } = landable();
    const { sup, broker, sessions } = await setup(config);
    const w = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    const refs = Array.from({ length: 25 }, (_, i) => `BOB-${i + 1}`);
    const sha = commit(`v2: ${"x".repeat(296)}\n\nFixes: ${refs.join(", ")}`);
    expect(await sup.land(w.id)).toMatchObject({ ok: true });
    await until(() => ops(broker, "push").length === 1);
    const op = ops(broker, "push")[0]!.op as Extract<BoardOpInput, { op: "push" }>;
    expect(op.fixes!.map((f) => f.ref)).toEqual(refs.slice(0, 20));
    expect(op.fixes!.every((f) => f.sha === sha && f.subject.length === 200)).toBe(true);
    expect(BoardOp.safeParse(op).success).toBe(true);
  });

  it("reads every commit the land brought onto its target, not only HEAD", async () => {
    const origin = join(dir, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    const { config, g, commit } = landable("git push -q origin HEAD:main", origin, ", target: origin/main");
    g("push", "-q", "origin", "HEAD:main");
    const { sup, broker, sessions } = await setup(config);
    const w = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    const a = commit("v2: BOB-27: the fix\n\nFixes: BOB-27");
    commit("v2: BOB-31: a test\n\nFixes: not-a-ref");
    const c = commit("v2: BOB-30: the other\n\nFixes: bob-30");
    expect(await sup.land(w.id)).toMatchObject({ ok: true });
    await until(() => ops(broker, "push").length === 1);
    expect(ops(broker, "push")[0]!.op).toMatchObject({ sha: c, fixes: [{ ref: "BOB-30", sha: c }, { ref: "BOB-27", sha: a }] });
  });

  it("reports the tag an upgrade built on a landed tip, its repo written as the push's, for the service project whose repo it is (ADR 0011 §1)", async () => {
    const { config, commit } = landable();
    const sha = commit("v2: BOB-27: the fix\n\nFixes: BOB-27");
    // The upgrade's clone names the repo in another case: what is sent is the push's spelling.
    const tags: Record<string, { repo: string; sha: string }> = { "v2.0.0-rc.34": { repo: "Cath42/BobNet-MCP", sha }, "v2.0.0-rc.35": { repo: "cath42/helix", sha } };
    const releases: Releases = {
      root: join(dir, "releases"),
      missing: () => null,
      installed: async () => null,
      verify: async (tag) => tag.slice(1),
      build: async () => {},
      discard: () => {},
      check: async () => {},
      switch: () => {},
      tagged: async (tag) => (asked.push(tag), tags[tag] ?? null),
    };
    const asked: string[] = [];
    const { sup, broker, sessions } = await setup(config, { releases });
    const w = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    expect(await sup.land(w.id)).toMatchObject({ ok: true });
    await until(() => ops(broker, "push").length === 1);
    await sup.upgradeSupervisor(undefined, "v2.0.0-rc.34", "no");
    await until(() => ops(broker, "release_tag").length === 1);
    const push = ops(broker, "push")[0]!.op as Extract<BoardOpInput, { op: "push" }>;
    expect(ops(broker, "release_tag")[0]).toEqual({ as: "supervisor", ctx: undefined, op: { op: "release_tag", project: "bobnet", repo: push.repo, tag: "v2.0.0-rc.34", sha: push.sha } });
    expect(push.fixes).toEqual([{ ref: "BOB-27", sha, subject: "v2: BOB-27: the fix" }]);
    // A repo no service project here has: not sent, since the broker would refuse it.
    await sup.upgradeSupervisor(undefined, "v2.0.0-rc.35", "no");
    // Its row is open from before the build: none open once it was asked for is its end, so nothing runs past the test.
    await until(() => asked.includes("v2.0.0-rc.35") && store.upgradesOpen().length === 0);
    await tick(50);
    expect(ops(broker, "release_tag")).toHaveLength(1);
  });

  it("refuses a project on both the board service and a backlog", () => {
    expect(() => testConfig(dir, `${BOBNET}    backlog: { dir: product/backlog }\n`)).toThrow(/the service or a backlog, not both/);
  });

  it("names a repo from its remote's URL, either form", () => {
    expect(repoName("https://github.com/cath42/bobnet-mcp.git")).toBe("cath42/bobnet-mcp");
    expect(repoName("git@github.com:cath42/bobnet-mcp.git")).toBe("cath42/bobnet-mcp");
    expect(repoName("/local/path")).toBe("local/path");
  });

  it("keeps a run's context per call to the board's 2000 points, first and last kept", () => {
    const points = Array.from({ length: 5000 }, (_, i) => i);
    const kept = downsample(points, 2000);
    expect(kept).toHaveLength(2000);
    expect([kept[0], kept.at(-1)]).toEqual([0, 4999]);
    expect(downsample([1, 2], 2000)).toEqual([1, 2]);
  });

  it("reports a worker's run slot from its grant to its release, with an id unique to the laptop", async () => {
    const { sup, broker, sessions } = await setup();
    mkdirSync(join(dir, "wt"), { recursive: true });
    const w = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    // The slot a tool call takes, as a policy rule with slot: true would.
    const internals = sup as unknown as { takeCallSlot: (id: string, author: string, toolUseId: string, label: string, signal: AbortSignal) => Promise<void>; releaseCall: (id: string) => void };
    await internals.takeCallSlot(w.id, "Luigi <luigi@bobnet>", "tu_1", "pnpm test", new AbortController().signal);
    internals.releaseCall("tu_1");
    await until(() => ops(broker, "slot_run").length === 2);
    const [start, end] = ops(broker, "slot_run").map((o) => o.op as Extract<BoardOpInput, { op: "slot_run" }>);
    expect(start).toMatchObject({ name: "pnpm test", status: "running" });
    expect(end).toMatchObject({ external_id: start!.external_id, status: "passed", ended_at: expect.any(String) });
    expect(start!.external_id).toMatch(/^mbp-1:[0-9a-f-]{36}$/);
  });

  it("reports a slot cut off by an interrupt as cancelled", async () => {
    const { sup, broker, sessions } = await setup();
    const w = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    const internals = sup as unknown as { takeCallSlot: (id: string, author: string, toolUseId: string, label: string, signal: AbortSignal) => Promise<void>; releaseCalls: (id: string) => void };
    await internals.takeCallSlot(w.id, "Luigi <luigi@bobnet>", "tu_1", "pnpm test", new AbortController().signal);
    internals.releaseCalls(w.id);
    await until(() => ops(broker, "slot_run").length === 2);
    expect(ops(broker, "slot_run").map((o) => (o.op as { status: string }).status)).toEqual(["running", "cancelled"]);
  });

  it("reports a land refused before its check as cancelled", async () => {
    const worktree = join(dir, "bobnet-luigi");
    mkdirSync(join(worktree, "packages"), { recursive: true });
    const g = (...args: string[]) => execFileSync("git", ["-C", worktree, ...args]).toString().trim();
    execFileSync("git", ["init", "-q", worktree]);
    writeFileSync(join(worktree, "README"), "x");
    g("add", ".");
    g("-c", "user.name=Luigi", "-c", "user.email=l@x", "commit", "-qm", "init");
    g("remote", "add", "origin", join(dir, "no-such-remote"));
    const config = parseSupervisorConfig(
      `
orchestrator: Mario
state_dir: ${dir}
projects:
  bobnet:
    path: ${worktree}
    board: service
    land: { command: [/usr/bin/true], target: origin/v2 }
    roles:
      luigi: { dir: ${join(worktree, "packages")}, name: Luigi }
`,
      (d) => d,
    );
    const { sup, broker, sessions } = await setup(config);
    const w = await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    expect(await sup.land(w.id)).toMatchObject({ ok: false });
    await until(() => ops(broker, "slot_run").length === 2);
    expect(ops(broker, "slot_run").map((o) => (o.op as { status: string }).status)).toEqual(["running", "cancelled"]);
  });
});
