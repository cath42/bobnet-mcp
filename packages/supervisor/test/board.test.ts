import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectBoard } from "@bobnet/protocol";
import { describe, expect, it } from "vitest";
import { assignSessions, baseline, Boards, briefTask, downsample, namedSession, parseBacklogItem, sessionAt, shapeBacklog, transcriptCalls, transcriptCtx, transcriptFolder, workerTasks } from "../src/board.ts";
import { parseSupervisorConfig } from "../src/config.ts";
import { Store, type WorkerRow } from "../src/store.ts";
import { quiet } from "./fakes.ts";

const row = (over: Partial<WorkerRow>): WorkerRow => ({
  id: "w_x", project: "helix", role: "homer", task: "", handoff: null, state: "done", priority: 1, resume_session: null, session_id: null,
  checkpoint: null, error: null, created_at: "2026-10-31T10:00:00.000Z", started_at: null, ended_at: null, last_event_at: null, tasks: null, declared_session: null,
  usage: null, model: null, effort: null, ctx: null, ...over,
});

describe("sessions", () => {
  it("reads the session a brief names", () => {
    expect(namedSession("Bob's brief, LAND-41 build 3 (lead/rulings.md M-21).")).toEqual({ name: "LAND-41 build 3", kind: "build" });
    expect(namedSession("LAND-41 design session (Bob's plan, 2026-10-30).")).toEqual({ name: "LAND-41 design", kind: "design" });
    expect(namedSession("Bob's brief, LAND-41 build (2026-10-31). Fresh worker.")).toEqual({ name: "LAND-41 build 1", kind: "build" });
    expect(namedSession("land-42 review session: tier 3")).toEqual({ name: "LAND-42 review", kind: "review" });
    expect(namedSession("Fix the red main")).toBeNull();
  });

  it("puts a worker in the session its spawn declared, whatever its brief says; none is Other work", () => {
    const ws = [
      row({ id: "a", task: "LAND-43 build A, then on to build 3", declared_session: JSON.stringify({ feature: "LAND-43", kind: "build", label: "B" }), created_at: "2026-11-04T00:00:00Z" }),
      row({ id: "b", task: "LAND-43 design session", declared_session: JSON.stringify({ feature: "LAND-43", kind: "design" }), created_at: "2026-11-04T00:01:00Z" }),
      // Declared none: not the session last active, not what its brief names.
      row({ id: "c", task: "LAND-43 build B fix", declared_session: "null", created_at: "2026-11-04T00:02:00Z" }),
    ];
    const s = assignSessions(ws);
    expect([...s.entries()].map(([id, x]) => `${id}:${x.name}:${x.kind}`)).toEqual(["a:LAND-43 build B:build", "b:LAND-43 design:design", "c:Other work:other"]);
  });

  it("puts a worker whose brief names none in the session last active in its project", () => {
    const ws = [
      row({ id: "a", task: "LAND-41 build 3. Fresh worker.", created_at: "2026-10-31T17:30:00Z", ended_at: "2026-10-31T18:00:00Z" }),
      row({ id: "b", task: "[Consult c_1] changesets asks Luke", created_at: "2026-10-31T17:34:00Z" }),
      row({ id: "c", task: "Bob's brief: red main, fix first", created_at: "2026-10-31T20:18:00Z" }),
      row({ id: "d", project: "games", task: "Write a haiku", created_at: "2026-10-31T17:35:00Z" }),
      row({ id: "e", task: "PILOT of the supervisor", created_at: "2026-10-30T09:00:00Z" }),
    ];
    const s = assignSessions(ws);
    expect([...s.entries()].map(([id, x]) => `${id}:${x.name}`).sort()).toEqual(["a:LAND-41 build 3", "b:LAND-41 build 3", "c:LAND-41 build 3", "d:Other work", "e:Other work"]);
  });

  it("finds the task a brief is about", () => {
    expect(briefTask("Bob's brief, LAND-41 build 3. Your task: LAND-41.16 AC #16 only, then LAND-41.18")).toBe("LAND-41.16");
    expect(briefTask("Fresh worker. LAND-41 build 2, LAND-41.17's documents half (note LAND-41.10)")).toBe("LAND-41.17");
    expect(briefTask("No backlog id here")).toBeNull();
  });

  it("takes a worker's items from its spawn, and from its brief only for a worker spawned before spawns named them", () => {
    expect(workerTasks({ task: "LAND-41 review 1, mentions LAND-41.33", tasks: JSON.stringify(["LAND-41"]) })).toEqual(["LAND-41"]);
    expect(workerTasks({ task: "A consult, LAND-41.33 in passing", tasks: "[]" })).toEqual([]);
    expect(workerTasks({ task: "Your task: LAND-41.16", tasks: null })).toEqual(["LAND-41.16"]);
    expect(workerTasks({ task: "LAND-41 review 1", tasks: null })).toEqual([]);
  });
});

describe("context per call", () => {
  it("keeps at most the asked number of points, first and last included", () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i);
    const d = downsample(xs, 100);
    expect(d).toHaveLength(100);
    expect([d[0], d.at(-1)]).toEqual([0, 999]);
    expect(downsample([1, 2, 3], 100)).toEqual([1, 2, 3]);
  });

  it("gives the middle half and median while enough runs are that long", () => {
    const runs = [[10, 20, 30], [20, 40], [30, 60], [40, 80], [50, 100]];
    expect(baseline(runs, 5)).toEqual({ runs: 5, p25: [20, 40], p50: [30, 60], p75: [40, 80] });
    expect(baseline(runs.slice(0, 4), 5).p50).toEqual([]);
  });

  it("reads a transcript's calls in the run's window, once per response, without subagents", () => {
    const line = (id: string, ts: string, cached: number, side = false) =>
      JSON.stringify({ type: "assistant", isSidechain: side, timestamp: ts, message: { id, usage: { input_tokens: 2, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } } });
    const jsonl = [
      line("m0", "2026-10-31T09:59:00Z", 1),
      line("m1", "2026-10-31T10:01:00Z", 30000),
      line("m1", "2026-10-31T10:01:01Z", 30000),
      line("ms", "2026-10-31T10:02:00Z", 5000, true),
      '{"type":"user","message":{}}',
      line("m2", "2026-10-31T10:03:00Z", 45000),
      line("m3", "2026-10-31T11:00:00Z", 1),
    ].join("\n");
    expect(transcriptCtx(jsonl, "2026-10-31T10:00:00Z", "2026-10-31T10:30:00Z")).toEqual([30002, 45002]);
  });
});

const task = (fm: string, body = "") => `---\n${fm}\n---\n\n${body}`;

describe("backlog", () => {
  it("reads an item's front matter, description and criteria", () => {
    const text = task(
      `id: LAND-41.17
title: 'documents: a citation names the fields it supports'
status: In Review
assignee:
  - records-agent
labels:
  - 'svc:documents'
  - 'build:2'
milestone: m-2
dependencies:
  - LAND-41.10
parent_task_id: LAND-41
type: task`,
      `## Description\n\n<!-- SECTION:DESCRIPTION:BEGIN -->\nFrom note LAND-41.10.\n<!-- SECTION:DESCRIPTION:END -->\n\n## Acceptance Criteria\n<!-- AC:BEGIN -->\n- [x] #1 A citation names its fields (service-test)\n- [ ] #2 Old citations still read (service-test)\n<!-- AC:END -->\n`,
    );
    expect(parseBacklogItem(text)).toEqual({
      id: "LAND-41.17", title: "documents: a citation names the fields it supports", status: "In Review", type: "task", parent: "LAND-41", milestone: "m-2",
      assignee: ["records-agent"], labels: ["svc:documents", "build:2"], deps: ["LAND-41.10"], desc: "From note LAND-41.10.",
      ac: [[true, "A citation names its fields (service-test)"], [false, "Old citations still read (service-test)"]],
    });
    expect(parseBacklogItem("no front matter")).toBeNull();
  });

  it("lists open increments' tasks and counts accepted ones'", () => {
    const item = (id: string, status: string, type: string, parent: string | null) => ({ id, title: id, status, type, parent, milestone: "m-2", assignee: [], labels: [], deps: [], desc: "d", ac: [] as Array<[boolean, string]> });
    const shaped = shapeBacklog([
      item("LAND-22.1", "Done", "task", "LAND-22"),
      item("LAND-41.2", "Done", "task", "LAND-41"),
      item("LAND-22", "Done", "increment", null),
      item("LAND-41", "Ready", "increment", null),
      item("LAND-41.10", "Ready", "task", "LAND-41"),
    ]);
    expect(shaped.items.map((x) => x.id)).toEqual(["LAND-22", "LAND-41", "LAND-41.2", "LAND-41.10"]);
    expect(shaped.items.find((x) => x.id === "LAND-41.2")!.desc).toBeNull();
    expect(shaped.done_counts).toEqual({ "LAND-22": 1 });
  });
});

describe("the board", () => {
  it("is read from git at the backlog's ref, with sessions, past runs and commits", async () => {
    const repo = mkdtempSync(join(tmpdir(), "bobnet-board-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "Riker");
    for (const d of ["tasks", "drafts", "milestones"]) mkdirSync(join(repo, "product/backlog", d), { recursive: true });
    writeFileSync(join(repo, "product/backlog/milestones/m-2 - r1.md"), task(`id: m-2\ntitle: "R1 Partner demo"`));
    writeFileSync(join(repo, "product/backlog/tasks/land-41 - x.md"), task(`id: LAND-41\ntitle: An agent proposes changes\nstatus: Ready\nmilestone: m-2\ntype: increment`));
    writeFileSync(join(repo, "product/backlog/tasks/land-41.16 - x.md"), task(`id: LAND-41.16\ntitle: changesets takes updates\nstatus: Ready\nparent_task_id: LAND-41\nlabels: ['build:3']\ntype: task`));
    writeFileSync(join(repo, "product/backlog/drafts/draft-1 - x.md"), task(`id: DRAFT-1\ntitle: An idea\nstatus: Draft\nupdated_date: '2026-10-31 09:00'`));
    git("add", ".");
    git("commit", "-q", "-m", "LAND-41: backlog");
    // Uncommitted edits in the working tree are never read.
    writeFileSync(join(repo, "product/backlog/tasks/land-41.16 - x.md"), task(`id: LAND-41.16\ntitle: half edited\nstatus: Done`));

    const store = new Store(":memory:");
    const a = store.createWorker({ project: "helix", role: "changesets", task: "Bob's brief, LAND-41 build 2. Your task: LAND-41.17", handoff: null, priority: 1, resume_session: null });
    store.updateWorker(a.id, { state: "done", started_at: "2026-10-31T14:00:00Z", ended_at: "2026-10-31T15:00:00Z", ctx: "[30000,60000]" });
    const b = store.createWorker({ project: "helix", role: "changesets", task: "Bob's brief, LAND-41 build 3. Your task: LAND-41.16", handoff: null, priority: 1, resume_session: null });
    const config = parseSupervisorConfig(
      `orchestrator: Bob\nprojects:\n  helix:\n    path: ${repo}\n    backlog: { dir: product/backlog, ref: main }\n    roles:\n      changesets: { dir: ${repo} }\n`,
      (d) => d,
    );
    const sent: ProjectBoard[] = [];
    const boards = new Boards(
      {
        projects: config.projects,
        store,
        log: quiet,
        send: async (x) => void sent.push(x),
        liveCtx: (id) => (id === b.id ? [31000, 52000, 70000] : undefined),
        ownTokens: () => ({ input: 10, output: 5, cache_read: 1000, cache_write: 0 }),
        nameOf: () => "changesets-agent",
        transcriptsDir: join(repo, "no-transcripts"),
      },
      // No gh in tests: the CI reads as unknown.
      async (cmd, args, cwd) => {
        if (cmd === "gh") throw new Error("gh: not found");
        return execFileSync(cmd, args, { cwd, encoding: "utf8" });
      },
    );
    await boards.refresh();
    expect(sent).toHaveLength(1);
    const board = sent[0]!;
    expect(board.ref).toMatch(/^[0-9a-f]{12}$/);
    expect(board.backlog!.milestones).toEqual([{ id: "m-2", title: "R1 Partner demo" }]);
    expect(board.backlog!.items.map((x) => [x.id, x.title, x.labels])).toEqual([
      ["LAND-41", "An agent proposes changes", []],
      ["LAND-41.16", "changesets takes updates", ["build:3"]],
    ]);
    expect(board.backlog!.drafts).toEqual([{ id: "DRAFT-1", title: "An idea", updated: "2026-10-31 09:00" }]);
    expect(board.sessions.map((s) => [s.name, s.kind, s.workers, s.calls, s.ended_at === null])).toEqual([
      ["LAND-41 build 2", "build", 1, 2, false],
      ["LAND-41 build 3", "build", 1, 3, true],
    ]);
    expect(board.runs).toMatchObject([{ id: a.id, role: "changesets", session: "LAND-41 build 2", ctx: [30000, 60000], tokens: 1015 }]);
    expect(board.commits).toMatchObject([{ author: "Riker", subject: "LAND-41: backlog" }]);
    expect(board.ci).toBeNull();

    // Nothing changed: nothing is sent again.
    await boards.refresh();
    expect(sent).toHaveLength(1);
  });
});

const call = (id: string, at: string, input: number, over: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", timestamp: at, message: { id, model: "claude-opus-5-5", usage: { input_tokens: input, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } }, ...over });

describe("the orchestrator's usage", () => {
  it("reads each call once, its final count, and gives a subagent's tokens but no context", () => {
    const jsonl = [call("m1", "2026-10-31T14:10:00Z", 5), call("m1", "2026-10-31T14:10:01Z", 7), call("m2", "2026-10-31T14:20:00Z", 3, { isSidechain: true }), "not json"].join("\n");
    expect(transcriptCalls(jsonl)).toEqual([
      { id: "m1", at: "2026-10-31T14:10:00Z", model: "claude-opus-5-5", tokens: { input: 7, output: 10, cache_read: 1000, cache_write: 0 }, ctx: 1007 },
      { id: "m2", at: "2026-10-31T14:20:00Z", model: "claude-opus-5-5", tokens: { input: 3, output: 10, cache_read: 1000, cache_write: 0 }, ctx: null },
    ]);
    expect(transcriptCalls(call("m3", "2026-10-31T14:30:00Z", 1), true)[0]!.ctx).toBeNull();
    expect(transcriptFolder("/t", "/Users/ct/Code/helix-navigator-bob")).toBe("/t/-Users-ct-Code-helix-navigator-bob");
  });

  it("puts a call in the session whose span holds it, the latest if spans overlap; never in Other work's", () => {
    const ss = [
      { name: "Other work", kind: "other", started_at: "2026-10-30T00:00:00Z", ended_at: null },
      { name: "LAND-41 build 2", kind: "build", started_at: "2026-10-31T14:00:00Z", ended_at: "2026-10-31T15:00:00Z" },
      { name: "LAND-41 review 1", kind: "review", started_at: "2026-10-31T14:50:00Z", ended_at: null },
    ];
    const now = "2026-10-31T18:00:00Z";
    expect(sessionAt(ss, "2026-10-31T14:30:00Z", now)).toBe("LAND-41 build 2");
    expect(sessionAt(ss, "2026-10-31T14:55:00Z", now)).toBe("LAND-41 review 1");
    expect(sessionAt(ss, "2026-10-31T17:00:00Z", now)).toBe("LAND-41 review 1");
    expect(sessionAt(ss, "2026-10-31T13:00:00Z", now)).toBeNull();
  });

  it("shows on the board in the sessions it worked in, as a run beside its workers, and the rest as Other work", async () => {
    const repo = mkdtempSync(join(tmpdir(), "bobnet-orch-"));
    execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
    execFileSync("git", ["-C", repo, "-c", "user.name=R", "-c", "user.email=r@x", "commit", "-q", "--allow-empty", "-m", "init"]);
    const root = join(repo, "transcripts"), folder = transcriptFolder(root, "/work/bob");
    mkdirSync(join(folder, "s1", "subagents"), { recursive: true });
    const main = join(folder, "s1.jsonl");
    writeFileSync(main, [call("p1", "2026-10-31T12:00:00Z", 5), call("b1", "2026-10-31T14:10:00Z", 5), call("b2", "2026-10-31T14:40:00Z", 5)].join("\n") + "\n");
    writeFileSync(join(folder, "s1", "subagents", "agent-a.jsonl"), call("sa", "2026-10-31T14:20:00Z", 5) + "\n");
    // A resumed session's file repeats an earlier call: counted once.
    writeFileSync(join(folder, "s2.jsonl"), call("b2", "2026-10-31T14:40:00Z", 5) + "\n");

    const store = new Store(":memory:");
    const a = store.createWorker({ project: "helix", role: "changesets", task: "LAND-41 build 2", handoff: null, priority: 1, resume_session: null });
    store.updateWorker(a.id, { state: "done", created_at: "2026-10-31T14:00:00Z", started_at: "2026-10-31T14:00:00Z", ended_at: "2026-10-31T15:00:00Z", ctx: "[30000]" });
    const config = parseSupervisorConfig(`orchestrator: Bob\nprojects:\n  helix:\n    path: ${repo}\n    orchestrator_dir: /work/bob\n    roles:\n      changesets: { dir: ${repo} }\n`, (d) => d);
    const sent: ProjectBoard[] = [];
    const boards = new Boards(
      { projects: config.projects, store, log: quiet, send: async (x) => void sent.push(x), liveCtx: () => undefined, ownTokens: () => ({ input: 10, output: 5, cache_read: 1000, cache_write: 0 }), nameOf: () => "changesets-agent", transcriptsDir: root },
      async (cmd, args, cwd) => {
        if (cmd === "gh") throw new Error("gh: not found");
        return execFileSync(cmd, args, { cwd, encoding: "utf8" });
      },
    );
    await boards.refresh();
    const each = 5 + 10 + 1000;
    expect(sent[0]!.sessions.map((s) => [s.name, s.calls, s.orchestrator])).toEqual([
      ["Other work", 1, { name: "Bob", calls: 1, tokens: each }],
      ["LAND-41 build 2", 3, { name: "Bob", calls: 2, tokens: 3 * each }],
    ]);
    expect(sent[0]!.sessions[1]!.tokens.input).toBe(10 + 15);
    expect(sent[0]!.runs.find((r) => r.role === "Bob" && r.session === "LAND-41 build 2")).toMatchObject({ id: "orchestrator:LAND-41 build 2", name: "Bob", session: "LAND-41 build 2", model: "claude-opus-5-5", tokens: 3 * each, ctx: [1005, 1005] });

    // A file that grows is read on from where it was.
    writeFileSync(main, call("b3", "2026-10-31T14:50:00Z", 5) + "\n", { flag: "a" });
    await boards.refresh();
    expect(sent.at(-1)!.sessions[1]!.orchestrator).toEqual({ name: "Bob", calls: 3, tokens: 4 * each });
  });
});
