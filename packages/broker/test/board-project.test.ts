import type { BoardCaller, BoardOpInput, BoardReply, BoardResults, SessionRef } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CI_HISTORY_SQL } from "../src/board/store.ts";

// BOB-121's project data (ADR 0014 §3, §3a, §4): the current release, a project's page, its CI
// history and a feature's own criteria, called as the broker calls them.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const board = () => env.BOARD.getByName("board");

async function call(caller: BoardCaller, op: BoardOpInput): Promise<BoardReply> {
  return (await board().apply(caller, op)) as unknown as BoardReply;
}
async function ok<K extends keyof BoardResults>(caller: BoardCaller, op: BoardOpInput & { op: K }): Promise<BoardResults[K]> {
  const reply = await call(caller, op);
  if (!reply.ok) throw new Error(`${op.op} refused: ${reply.code}: ${reply.message}`);
  return reply.result as BoardResults[K];
}
const sql = (run: (sql: SqlStorage) => void) => runInDurableObject(board(), (_, state) => run(state.storage.sql));

async function project(key = "helix") {
  await ok(owner, { op: "create_project", key, name: key[0]!.toUpperCase() + key.slice(1), prefix: key === "helix" ? "LAND" : key.slice(0, 3).toUpperCase() });
}
const release = async (title: string, key = "helix") => (await ok(owner, { op: "create_release", project: key, title })).ref!;
const feature = async (title: string, rel: string | null, key = "helix") =>
  (await ok(owner, { op: "create", project: key, kind: "feature", type: "increment", title, ...(rel ? { release: rel } : {}) })).ref!;
const done = (ref: string, key = "helix") => ok(owner, { op: "update", project: key, ref, set: { status: "Done" } });
const setStatus = (ref: string, status: "planned" | "open" | "closed") =>
  sql((s) => {
    s.exec("UPDATE releases SET status = ?, closed_at = ?, closed_by = ? WHERE ref = ?", status, ...(status === "closed" ? [new Date().toISOString(), "owner@example.com"] : [null, null]), ref);
  });

async function overviewRow(key = "helix") {
  return (await ok(owner, { op: "overview", project: key })).projects[0]!;
}
async function statusRelease(key = "helix") {
  return (await ok(owner, { op: "status", project: key, since: new Date(Date.now() - 3600_000).toISOString() })).projects[0]!.backlog.release;
}

describe("the current release (ADR 0014 §4, BOB-163)", () => {
  it("is R2, planned with work, after an R1 that is open and all done: number 2 and R2's own count", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    for (const t of ["A", "B", "C", "D"]) await done(await feature(t, r1));
    await setStatus(r1, "open");
    await done(await feature("E", r2));
    for (const t of ["F", "G", "H", "I", "J"]) await feature(t, r2);
    const row = await overviewRow();
    expect(row.release).toMatchObject({ ref: r2, status: "planned", features: { done: 1, total: 6 } });
    expect(row.release_number).toBe(2);
    expect(await statusRelease()).toEqual({ ref: r2, todo: 5, ready: 0 });
  });

  it("is an open R2 with work after a closed R1", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    await feature("A", r1);
    await feature("B", r2);
    await setStatus(r1, "closed");
    await setStatus(r2, "open");
    const row = await overviewRow();
    expect([row.release?.ref, row.release_number]).toEqual([r2, 2]);
    expect((await statusRelease())?.ref).toBe(r2);
  });

  it("is the last release neither closed nor planned when every one is done", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    const r3 = await release("Release 3");
    await done(await feature("A", r1));
    await done(await feature("B", r2));
    for (const r of [r1, r2]) await setStatus(r, "open");
    await setStatus(r3, "closed");
    const row = await overviewRow();
    expect(row.release).toMatchObject({ ref: r2, features: { done: 1, total: 1 } });
    expect(row.release_number).toBe(2);
    expect(await statusRelease()).toEqual({ ref: r2, todo: 0, ready: 0 });
  });

  it("is the done release waiting for its close, not a planned empty one after it, on the Overview and the status read alike (BOB-192)", async () => {
    await project();
    const r1 = await release("Release 1");
    for (const t of ["Release 2", "Release 3", "Release 4", "Release 5"]) await release(t);
    await done(await feature("A", r1));
    await setStatus(r1, "open");
    const row = await overviewRow();
    expect([row.release?.ref, row.release_number, row.release?.features]).toEqual([r1, 1, { done: 1, total: 1 }]);
    expect((await statusRelease())?.ref).toBe(r1);
    expect((await ok(owner, { op: "project", project: "helix" })).done_unclosed).toEqual([]);
    expect(row.done_unclosed).toEqual([]);
  });

  it("gives an earlier release that is all done and not closed as waiting for its close, on the Overview as on the project's page (BOB-179)", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    await done(await feature("A", r1));
    await feature("B", r2);
    await setStatus(r1, "open");
    const row = await overviewRow();
    expect([row.release?.ref, row.release?.features, row.done_unclosed]).toEqual([r2, { done: 0, total: 1 }, [{ ref: r1, title: "Release 1" }]]);
    expect((await ok(owner, { op: "project", project: "helix" })).done_unclosed).toEqual(row.done_unclosed);
    await setStatus(r1, "closed");
    expect((await overviewRow()).done_unclosed).toEqual([]);
  });

  it("is never a planned release that only holds Done features; with no open release it is none (BOB-192)", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    await done(await feature("A", r2));
    expect(await overviewRow()).toMatchObject({ release: null, release_number: null });
    expect(await statusRelease()).toBeNull();
    expect(await ok(owner, { op: "project", project: "helix" })).toMatchObject({ release: null, done_unclosed: [] });
    await setStatus(r1, "open");
    expect((await overviewRow()).release?.ref).toBe(r1);
    // Work in the planned one makes it current again (BOB-163).
    await feature("B", r2);
    expect((await overviewRow()).release?.ref).toBe(r2);
    expect((await statusRelease())?.ref).toBe(r2);
  });

  it("is none without releases, or with every one closed", async () => {
    await project();
    expect(await overviewRow()).toMatchObject({ release: null, release_number: null });
    expect(await statusRelease()).toBeNull();
    const r1 = await release("Release 1");
    await setStatus(r1, "closed");
    expect(await overviewRow()).toMatchObject({ release: null, release_number: null });
  });

  it("counts an archived feature that isn't Done as no work", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    await done(await feature("A", r1));
    const gone = await feature("B", r1);
    await ok(owner, { op: "archive", project: "helix", ref: gone, reason: "Dropped" });
    await feature("C", r2);
    const row = await overviewRow();
    expect([row.release?.ref, row.release_number, row.release?.features]).toEqual([r2, 2, { done: 0, total: 1 }]);
  });

  it("follows the board's order of releases, not their creation", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    await feature("A", r1);
    await feature("B", r2);
    await ok(owner, { op: "order_releases", project: "helix", refs: [r2, r1] });
    const row = await overviewRow();
    expect([row.release?.ref, row.release_number]).toEqual([r2, 1]);
  });
});

const SHA = (n: number) => n.toString(16).padStart(40, "a");
const supervisor = (worker: string, name = "Bill"): BoardCaller => ({
  kind: "agent",
  name,
  laptop: "mbp-1",
  supervisor: true,
  ctx: { worker, role: name.toLowerCase(), project: "helix", session: null, tasks: [] },
});
async function ci(n: number, o: { name?: string; status?: "queued" | "running" | "passed" | "failed"; sha?: string; start?: string | null }) {
  const at = o.start === undefined ? new Date(Date.parse("2026-11-20T10:00:00Z") + n * 60_000).toISOString() : o.start;
  const reply = (await board().reportCi("github-actions", {
    external_id: `run-${n}`,
    name: o.name ?? "ci",
    url: `https://github.com/cath42/helix/actions/runs/${n}`,
    repo: "cath42/helix",
    branch: "main",
    sha: o.sha ?? SHA(n),
    status: o.status ?? "passed",
    started_at: at,
    ended_at: at && (o.status ?? "passed") !== "running" ? at : null,
  })) as unknown as BoardReply;
  if (!reply.ok) throw new Error(`ci_run refused: ${reply.message}`);
}

describe("CI history from the board (ADR 0014 §3a, BOB-168)", () => {
  it("gives each workflow its latest run and the 5 before it, newest first, passed ones too; a slot run is no workflow", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", repos: ["cath42/helix"] });
    for (let n = 1; n <= 8; n++) await ci(n, { status: n === 7 ? "failed" : "passed" });
    await ci(9, { name: "deploy", status: "running" });
    await ci(10, { name: "deploy", status: "queued", start: null });
    const bill = supervisor("w_bill");
    await ok(bill, { op: "run_start", project: "helix", id: "w_bill", started_at: new Date().toISOString(), session: null });
    await ok(bill, { op: "slot_run", project: "helix", external_id: "s_1", name: "land", status: "passed", started_at: new Date().toISOString() });
    const flows = (await overviewRow()).ci!;
    expect(flows.map((f) => [f.name, f.runs.length])).toEqual([
      ["ci", 6],
      ["deploy", 2],
    ]);
    expect(flows[0]!.runs.map((r) => [r.sha, r.status])).toEqual([8, 7, 6, 5, 4, 3].map((n) => [SHA(n), n === 7 ? "failed" : "passed"]));
    expect(flows[0]!.runs[0]).toEqual({
      name: "ci",
      branch: "main",
      status: "passed",
      sha: SHA(8),
      url: "https://github.com/cath42/helix/actions/runs/8",
      started_at: "2026-11-20T10:08:00.000Z",
      ended_at: "2026-11-20T10:08:00.000Z",
      agent: null,
    });
    // A run not started yet is the newest.
    expect(flows[1]!.runs.map((r) => r.status)).toEqual(["queued", "running"]);
  });

  it("names the agent whose land pushed the sha a run ran on, and none without a push", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", repos: ["cath42/helix"] });
    const toad = supervisor("w_toad", "Toad");
    await ok(toad, { op: "run_start", project: "helix", id: "w_toad", started_at: new Date().toISOString(), session: null });
    await ok(toad, { op: "push", project: "helix", repo: "Cath42/Helix", branch: "v2", sha: SHA(1) });
    await ci(1, {});
    await ci(2, {});
    // A push after its run's report ties it too.
    await ci(3, {});
    await ok(toad, { op: "push", project: "helix", repo: "cath42/helix", branch: "v2", sha: SHA(3) });
    const runs = (await overviewRow()).ci![0]!.runs;
    expect(runs.map((r) => [r.sha, r.agent])).toEqual([
      [SHA(3), "Toad"],
      [SHA(2), null],
      [SHA(1), "Toad"],
    ]);
  });

  it("keeps 6 per workflow over many runs and pushes, joining pushes only for those (Toad, BOB-121 review A, B1)", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", repos: ["cath42/helix"] });
    const runs = 400;
    const sha = (n: number) => n.toString(16).padStart(40, "0");
    let read = 0;
    await sql((s) => {
      const p = s.exec<{ pk: number }>("SELECT pk FROM projects WHERE key = 'helix'").one().pk;
      for (let n = 1; n <= runs; n++) {
        const at = new Date(Date.parse("2026-11-20T10:00:00Z") + n * 60_000).toISOString();
        s.exec(
          "INSERT INTO ci_runs (source, external_id, project, name, repo, branch, sha, status, started_at) VALUES ('github-actions', ?, ?, ?, 'cath42/helix', 'main', ?, 'passed', ?)",
          `run-${n}`,
          p,
          n % 2 ? "ci" : "deploy",
          sha(n),
          at,
        );
        s.exec("INSERT INTO pushes (project, repo, branch, sha, worker, at) VALUES (?, 'cath42/helix', 'v2', ?, 'w_bill', ?)", p, sha(n), at);
      }
      const history = s.exec(CI_HISTORY_SQL, p);
      history.toArray();
      read = history.rowsRead;
    });
    const flows = (await overviewRow()).ci!;
    expect(flows.map((f) => [f.name, f.runs.length, f.runs[0]!.sha])).toEqual([
      ["ci", 6, sha(runs - 1)],
      ["deploy", 6, sha(runs)],
    ]);
    // Joined before the window, every run scanned every push: about runs × pushes, 161615 rows here.
    expect(read).toBeLessThan(runs * 2 * 6 * 2);
  });

  it("lists a run once when two pushes of its sha differ only by the repo's case (BOB-192)", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", repos: ["cath42/helix"] });
    const toad = supervisor("w_toad", "Toad");
    await ok(toad, { op: "run_start", project: "helix", id: "w_toad", started_at: new Date().toISOString(), session: null });
    await ok(toad, { op: "push", project: "helix", repo: "Cath42/Helix", branch: "v2", sha: SHA(1) });
    await ok(toad, { op: "push", project: "helix", repo: "cath42/helix", branch: "v2", sha: SHA(1) });
    await sql((s) => expect(s.exec("SELECT 1 FROM pushes").toArray()).toHaveLength(2));
    await ci(1, {});
    expect((await overviewRow()).ci![0]!.runs.map((r) => [r.sha, r.agent])).toEqual([[SHA(1), "Toad"]]);
  });

  it("says a workflow's usual duration once 3 of its runs passed, and not before (BOB-192)", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", repos: ["cath42/helix"] });
    const took = async (n: number, name: string, min: number, status: "passed" | "failed" = "passed") => {
      await ci(n, { name, status });
      await sql((s) => {
        s.exec("UPDATE ci_runs SET ended_at = ? WHERE external_id = ?", new Date(Date.parse("2026-11-20T10:00:00Z") + (n + min) * 60_000).toISOString(), `run-${n}`);
      });
    };
    for (const [n, min] of [[1, 8], [2, 9], [3, 30]] as const) await took(n, "ci", min);
    await took(4, "deploy", 5);
    await took(5, "deploy", 5);
    await took(6, "deploy", 90, "failed");
    const flows = (await overviewRow()).ci!;
    expect(flows.map((f) => [f.name, f.usual_ms])).toEqual([
      ["ci", 9 * 60_000],
      ["deploy", undefined],
    ]);
    expect("usual_ms" in flows[1]!).toBe(false);
  });

  it("gives every project on the Overview its ci, none as an empty list", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", repos: ["cath42/helix"] });
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB" });
    await ci(1, {});
    const rows = (await ok(owner, { op: "overview" })).projects;
    expect(rows.map((r) => [r.project.key, r.ci?.length])).toEqual([
      ["bobnet", 0],
      ["helix", 1],
    ]);
  });
});

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const each = (n: number) => ({ input: n, output: n, cache_read: n, cache_write: n });
const inSession = (worker: string, role: string, session: SessionRef | null): BoardCaller => ({
  kind: "agent",
  name: role[0]!.toUpperCase() + role.slice(1),
  laptop: "mbp-1",
  supervisor: true,
  ctx: { worker, role, project: "helix", session, tasks: [] },
});

describe("the project read (ADR 0014 §3, BOB-171)", () => {
  it("lists open sessions and those ended in the span with their runs by start, other work apart, and its close counted", async () => {
    await project();
    const r1 = await release("Release 1");
    const f1 = await feature("Roadmap", r1);
    const f2 = await feature("Steps", r1);
    const task = (await ok(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "Draw it", parent: f2 })).ref!;
    const open: SessionRef = { feature: f1, kind: "build", label: "1" };
    const shut: SessionRef = { feature: f2, kind: "review", label: "A" };
    // A closed review: its builder failed, then its reviewer finished.
    const rev = inSession("w_rev", "reviewer", shut);
    await ok(rev, { op: "session_join", project: "helix", session: shut });
    const bld = inSession("w_bld", "builder", shut);
    await ok(bld, { op: "run_start", project: "helix", id: "w_bld", started_at: ago(60), session: shut, model: "opus", effort: "high" });
    await ok(rev, { op: "run_start", project: "helix", id: "w_rev", started_at: ago(50), session: shut, model: "sonnet" });
    await ok(bld, { op: "run_end", project: "helix", id: "w_bld", ended_at: ago(45), tokens: each(10), calls: 4, outcome: "failed", reason: "The build broke" });
    await ok(rev, { op: "run_end", project: "helix", id: "w_rev", ended_at: ago(40), tokens: each(5), calls: 2, outcome: "done" });
    const q = (await ok(owner, { op: "ask", project: "helix", text: "Ship with it?" })).ref!;
    await ok(owner, { op: "close_session", project: "helix", session: shut, need: "casper", waits_on: [q], summary: "One blocker", blockers: [task], majors: [task], handoff: { path: "/h.md", text: "x" } });
    // An open build with a run still going, after it.
    const lead = inSession("w_lead", "builder", open);
    await ok(lead, { op: "session_join", project: "helix", session: open });
    await ok(lead, { op: "run_start", project: "helix", id: "w_lead", started_at: ago(30), session: open, model: "opus" });
    // A consult outside any session; and an old session, ended before the span.
    const consult = inSession("w_con", "architect", null);
    await ok(consult, { op: "run_start", project: "helix", id: "w_con", started_at: ago(20), session: null });
    await ok(consult, { op: "run_end", project: "helix", id: "w_con", ended_at: ago(19), tokens: each(3), calls: 1, outcome: "done" });
    const old: SessionRef = { feature: f1, kind: "design", label: "0" };
    await ok(inSession("w_old", "designer", old), { op: "session_join", project: "helix", session: old });
    await sql((s) => {
      s.exec("UPDATE sessions SET ended_at = ?, need = 'none', summary = 'Old', closed_by = 'x' WHERE label = '0'", ago(20 * 24 * 60));
    });

    const page = await ok(owner, { op: "project", project: "helix" });
    expect(page.sessions.map((s) => s.session)).toEqual([open, shut]);
    expect(page.sessions[0]).toEqual({
      session: open,
      feature_title: "Roadmap",
      started_at: expect.any(String),
      ended_at: null,
      close: null,
      tokens: each(0),
      weighted: 0,
      unknown: 0,
      lost: 0,
      runs: [
        {
          id: "w_lead",
          agent: "Builder",
          role: "builder",
          laptop: "mbp-1",
          model: "opus",
          effort: null,
          started_at: expect.any(String),
          ended_at: null,
          tokens: each(0),
          weighted: 0,
          calls: 0,
          outcome: null,
          outcome_reason: null,
        },
      ],
    });
    const s2 = page.sessions[1]!;
    expect([s2.feature_title, s2.close, s2.tokens, s2.weighted, s2.unknown, s2.lost]).toEqual([
      "Steps",
      { need: "casper", summary: "One blocker", blockers: 1, majors: 1, sent_back: 0 },
      each(15),
      80 + 20,
      0,
      0,
    ]);
    expect(s2.runs.map((r) => [r.id, r.outcome, r.outcome_reason, r.weighted, r.calls])).toEqual([
      ["w_bld", "failed", "The build broke", 80, 4],
      ["w_rev", "done", null, 20, 2],
    ]);
    expect(page.other_runs.map((r) => [r.id, r.role, r.weighted])).toEqual([["w_con", "architect", 12]]);
    expect(page.more).toEqual({});
    expect(page.release).toMatchObject({ ref: r1, number: 1, features: { done: 0, total: 2 } });
  });

  it("gives the waits, backlog, usage and ci the waits, status, usage and overview reads give for it", async () => {
    await project();
    const r1 = await release("Release 1");
    const r2 = await release("Release 2");
    await done(await feature("Done", r1));
    const f = await feature("Next", r2);
    await ok(owner, { op: "criteria", project: "helix", ref: f, change: { action: "add", text: "It works" } });
    await ok(owner, { op: "update", project: "helix", ref: f, set: { status: "Ready" } });
    await ok(owner, { op: "ask", project: "helix", text: "Ship it?", holds: [f] });
    await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "bug", title: "Crash", blocks_use: true });
    const con = inSession("w_con", "architect", null);
    await ok(con, { op: "run_start", project: "helix", id: "w_con", started_at: ago(90), session: null, model: "haiku" });
    await ok(con, { op: "run_end", project: "helix", id: "w_con", ended_at: ago(80), tokens: each(100), calls: 9, outcome: "done" });
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB" });

    const page = await ok(owner, { op: "project", project: "helix", days: 7, tz: "Europe/Copenhagen" });
    expect(page.project.key).toBe("helix");
    expect(page.release).toMatchObject({ ref: r2, number: 2 });
    expect(page.done_unclosed).toEqual([{ ref: r1, title: "Release 1" }]);
    expect(page.waits).toEqual((await ok(owner, { op: "waits", project: "helix" })).waits);
    expect(page.waits).toHaveLength(2);
    const status = (await ok(owner, { op: "status", project: "helix", since: ago(60) })).projects[0]!;
    expect(page.backlog).toEqual(status.backlog);
    expect(page.backlog.ready.map((r) => r.ref)).toEqual([f]);
    const usage = await ok(owner, { op: "usage", project: "helix", days: 7, tz: "Europe/Copenhagen" });
    expect(page.usage).toEqual(usage.projects[0]);
    expect(page.usage.points).toHaveLength(7);
    expect(page.ci).toEqual((await overviewRow()).ci);
    expect(await call({ kind: "agent", name: "Nobody", laptop: "mbp-1", supervisor: false, ctx: null }, { op: "project", project: "helix" })).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("cuts sessions and other runs at 50 and says how many more; the backlog's lists are the status read's", async () => {
    await project();
    const f = await feature("Roadmap", null);
    for (let i = 0; i < 51; i++) await feature(`Thin ${i}`, null);
    await sql((s) => {
      const { project, pk } = s.exec<{ project: number; pk: number }>("SELECT i.project, i.pk FROM items i JOIN item_refs r ON r.item = i.pk WHERE r.ref = ?", f).one();
      for (let i = 0; i < 52; i++) {
        s.exec("INSERT INTO sessions (project, feature, kind, label, started_at) VALUES (?, ?, 'build', ?, ?)", project, pk, String(i), ago(200 - i));
        s.exec(
          "INSERT INTO runs (project, id, agent, role, laptop, started_at, ended_at, input, output, cache_read, cache_write, calls) VALUES (?, ?, 'A', 'architect', 'mbp-1', ?, ?, 1, 1, 1, 1, 1)",
          project,
          `w_${i}`,
          ago(200 - i),
          ago(190 - i),
        );
      }
    });
    const page = await ok(owner, { op: "project", project: "helix" });
    expect([page.sessions.length, page.other_runs.length, page.more]).toEqual([50, 50, { sessions: 2, other_runs: 2 }]);
    expect([page.sessions[0]!.session.label, page.other_runs[0]!.id]).toEqual(["51", "w_51"]);
    expect(page.backlog).toEqual((await ok(owner, { op: "status", project: "helix", since: ago(60) })).projects[0]!.backlog);
    expect(page.backlog.no_criteria).toHaveLength(52);
  });

  it("weighs each run once, from one read of the per-model rows: 100 runs more don't make 100 queries more (BOB-182 c9, Toad review B minor 3)", async () => {
    await project();
    const f = await feature("Roadmap", null);
    const ss: SessionRef = { feature: f, kind: "build", label: "1" };
    await ok(inSession("w_0", "builder", ss), { op: "session_join", project: "helix", session: ss });
    const run = async (id: string, session: SessionRef | null, min: number) => {
      const who = inSession(id, "builder", session);
      await ok(who, { op: "run_start", project: "helix", id, started_at: ago(min + 5), session, model: "opus" });
      await ok(who, { op: "run_end", project: "helix", id, ended_at: ago(min), tokens: each(10), calls: 1, outcome: "done", models: [{ model: "claude-opus-5-5", tokens: each(6) }, { model: "claude-haiku-5-5", tokens: each(4) }] });
    };
    const count = () =>
      runInDurableObject(board(), (instance) => {
        const store = (instance as unknown as { store: { sql: SqlStorage } }).store;
        const real = store.sql;
        const queries: string[] = [];
        store.sql = new Proxy(real, { get: (t, k) => (k === "exec" ? (q: string, ...args: SqlStorageValue[]) => (queries.push(q), t.exec(q, ...args)) : Reflect.get(t, k)) });
        try {
          (store as unknown as { read(c: BoardCaller, op: unknown): unknown }).read(owner, { op: "project", project: "helix", days: 14, tz: "UTC" });
        } finally {
          store.sql = real;
        }
        return { all: queries.length, models: queries.filter((q) => q.includes("run_models")).length };
      });
    await run("w_1", ss, 60);
    // One from before the span, of the session that is still open: weighed by its models too.
    await run("w_old", ss, 60 * 24 * 40);
    const few = await count();
    for (let i = 0; i < 100; i++) await run(`w_n${i}`, i % 2 ? ss : null, 30);
    const many = await count();
    expect([few.models, many.models]).toEqual([1, 1]);
    expect(many.all).toBeLessThanOrEqual(few.all + 5);
    const page = await ok(owner, { op: "project", project: "helix" });
    // Opus at 2, Haiku at 0.05 (its cache reads 0.1): 4 x 6 x 2 + 3 x 4 x 0.05 + 4 x 0.1.
    expect([...new Set([...page.sessions[0]!.runs, ...page.other_runs].map((r) => r.weighted))]).toEqual([49]);
    expect(page.sessions[0]!.runs.map((r) => r.id)).toContain("w_old");
    expect(page.sessions[0]!.weighted).toBe(52 * 49);
  });

  it("weighs a session and its runs on get, an undeclared model as unknown", async () => {
    await project();
    const s: SessionRef = { feature: await feature("Roadmap", null), kind: "build", label: "1" };
    const a = inSession("w_a", "builder", s);
    await ok(a, { op: "session_join", project: "helix", session: s });
    await ok(a, { op: "run_start", project: "helix", id: "w_a", started_at: ago(10), session: s, model: "claude-opus-5-5" });
    await ok(a, { op: "run_end", project: "helix", id: "w_a", ended_at: ago(5), tokens: each(10), calls: 1, outcome: "done" });
    const b = inSession("w_b", "reviewer", s);
    await ok(b, { op: "run_start", project: "helix", id: "w_b", started_at: ago(4), session: s, model: null });
    await ok(b, { op: "run_end", project: "helix", id: "w_b", ended_at: ago(1), tokens: each(25), calls: 1, outcome: "done" });
    const got = (await ok(owner, { op: "get", project: "helix", session: s })).session!;
    expect([got.weighted, got.unknown]).toEqual([80 + 100, 100]);
    expect(got.runs.map((r) => [r.id, r.weighted, r.unknown])).toEqual([
      ["w_a", 80, 0],
      ["w_b", 100, 100],
    ]);
  });
});
