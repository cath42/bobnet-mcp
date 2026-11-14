import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrokerError } from "@bobnet/client/connection";
import type { BoardOpInput } from "@bobnet/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSupervisorConfig } from "../src/config.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { downsample, repoName, Supervisor } from "../src/supervisor.ts";
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

async function setup(config = testConfig(dir, BOBNET)) {
  const broker = new FakeBroker();
  const { queryFn, sessions } = fakeQuery();
  const captureDir = join(dir, "captures");
  const sup = new Supervisor({ config, policy: POLICY, store, broker, queryFn, log: quiet, sandboxCheck: async () => null, captureDir });
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
    await expect(sup.spawnJoined(spawn)).rejects.toThrow(/the board can't be reached BOB-2 build: the board is unavailable since/);
    expect(store.workers({ project: "bobnet" })).toEqual([]);
  });

  it("names its items and session, as ids the board knows", async () => {
    const { sup } = await setup();
    const { tasks: _, ...untasked } = spawn;
    await expect(sup.spawnJoined(untasked)).rejects.toThrow("bobnet has a board: say which items");
    await expect(sup.spawnJoined({ ...spawn, tasks: ["BOB-2.1"] })).rejects.toThrow("not item ids on bobnet's board: BOB-2.1");
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
    await until(() => sessions.length === 1);
    sessions[0]!.say("one", { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    sessions[0]!.say("two", { input_tokens: 2000, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    sessions[0]!.totals = { inputTokens: 3000, outputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1 };
    sessions[0]!.finish();
    await until(() => ops(broker, "run_end").length === 1);
    expect(ops(broker).map((o) => o.op.op)).toEqual(["session_join", "run_start", "run_end"]);
    const end = ops(broker, "run_end")[0]!.op as Extract<BoardOpInput, { op: "run_end" }>;
    expect(end).toMatchObject({ id: w.id, calls: 2, tokens: { input: 3000, output: 30, cache_read: 0, cache_write: 0 } });
    expect(end.ctx).toHaveLength(2);
    expect(end).not.toHaveProperty("cost_usd");
    expect(store.outbox()).toEqual([]);
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
    await until(() => sessions.length === 1);
    sessions[0]!.finish();
    await until(() => store.outbox("board_op").length === 2);
    board.away = false;
    sup.onConnected();
    await until(() => store.outbox().length === 0);
    expect(board.taken).toEqual(["session_join", `run_start ${w.id}`, `run_end ${w.id}`]);
  });

  it("drops a report the board refuses, so it holds up none behind it", async () => {
    const { sup, broker, sessions } = await setup();
    const board = away(broker);
    await sup.spawnJoined(spawn);
    await until(() => sessions.length === 1);
    sessions[0]!.finish();
    await until(() => store.outbox("board_op").length === 2);
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
    expect(r.content[0]!.text).toMatch(/reads a handoff in your worktree, the project or the handoffs folder/);
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
});
