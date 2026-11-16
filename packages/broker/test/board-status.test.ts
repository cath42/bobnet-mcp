import type { BoardCaller, BoardCtx, BoardOpInput, BoardReply, BoardResults, GrantField, SessionRef, StatusRow } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// The status read (ADR 0005 §2, BOB-37) and how a run ended (§3, BOB-38), called as the broker calls them.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const board = () => env.BOARD.getByName("board");

async function ok<K extends keyof BoardResults>(caller: BoardCaller, op: BoardOpInput & { op: K }): Promise<BoardResults[K]> {
  const reply = (await board().apply(caller, op)) as unknown as BoardReply;
  if (!reply.ok) throw new Error(`${op.op} refused: ${reply.code}: ${reply.message}`);
  return reply.result as BoardResults[K];
}

const sup = (name: string, session: SessionRef | null, project = "helix", worker = `w_${name.toLowerCase()}`): BoardCaller => ({
  kind: "agent",
  name,
  laptop: "mbp-1",
  supervisor: true,
  ctx: { worker, role: name.toLowerCase(), project, session, tasks: [] } satisfies BoardCtx,
});
const tokens = (n: number) => ({ input: n, output: n, cache_read: n, cache_write: n });
/** A time `min` minutes before now. */
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
/** A moment that sorts after every write before it, and before every one after. */
async function mark(): Promise<string> {
  await new Promise((r) => setTimeout(r, 5));
  const t = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5));
  return t;
}
const sql = (run: (sql: SqlStorage) => void) => runInDurableObject(board(), (_, state) => run(state.storage.sql));

async function status(since: string, caller: BoardCaller = owner, project?: string) {
  return ok(caller, { op: "status", since, ...(project ? { project } : {}) });
}
const row = (r: BoardResults["status"], key = "helix"): StatusRow => r.projects.find((p) => p.project === key)!;

/** Helix with a release, two features with a task each, and its PO's rule. */
async function helix() {
  await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", lead: "Picard@mbp-1", po: "Picard@mbp-1" });
  const po = { read: true, fields: ["status", "order", "content", "criteria", "triage", "create"] as GrantField[] };
  await ok(owner, { op: "grant", project: "helix", agent: "Picard", role: "PO", ...po, items: "all", sessions: true, questions: true, admin: true });
  const r1 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 1" })).ref!;
  const f1 = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Roadmap", release: r1 })).ref!;
  const f2 = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Steps", release: r1 })).ref!;
  const t1 = (await ok(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "Draw it", parent: f1, criteria: [{ text: "Drawn" }] })).ref!;
  const t2 = (await ok(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "Count it", parent: f2 })).ref!;
  return { r1, f1, f2, t1, t2 };
}

/** A session with one run of `agent`, ended as told, then closed by Picard. */
async function session(feature: string, label: string, opts: { agent?: string; tokens?: number; close?: Partial<Extract<BoardOpInput, { op: "close_session" }>>; project?: string } = {}) {
  const project = opts.project ?? "helix";
  const s = { feature, kind: "build" as const, label };
  const agent = opts.agent ?? "Bill";
  const id = `w_${agent.toLowerCase()}_${feature}_${label}`;
  const who = sup(agent, s, project, id);
  await ok(who, { op: "session_join", project, session: s });
  await ok(who, { op: "run_start", project, id, started_at: ago(30), session: s });
  await ok(who, { op: "run_end", project, id, ended_at: new Date().toISOString(), tokens: tokens(opts.tokens ?? 10), calls: 1, outcome: "done" });
  if (opts.close !== undefined) {
    // Picard is Helix's PO; another project's session the owner closes.
    const closer: BoardCaller = project === "helix" ? { kind: "agent", name: "Picard", laptop: "mbp-1", supervisor: false, ctx: null } : owner;
    await ok(closer, {
      op: "close_session",
      project,
      session: s,
      need: "none",
      summary: `Built ${feature} ${label}`,
      handoff: { path: "/h.md", text: "Done." },
      ...opts.close,
    });
  }
  return s;
}

describe("the status read (BOB-37)", () => {
  it("covers a span per project: done, usage and needs you, leaving out what is before it and another project's (AC 1)", async () => {
    const { r1, f1, f2, t1, t2 } = await helix();
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB" });
    const bob = (await ok(owner, { op: "create", project: "bobnet", kind: "feature", type: "increment", title: "Status" })).ref!;
    // Before the span: a closed session, a land.
    await session(f2, "0", { close: {} });
    await ok(sup("Bill", null, "helix", "w_land0"), { op: "push", project: "helix", repo: "cath42/helix", branch: "main", sha: "aaaaaaa1" });
    const since = await mark();

    // In the span: a session with findings, a feature and a bug to Done, two lands, a release closed, a question.
    await session(f1, "1", { agent: "Bill", tokens: 100, close: { blockers: [t1], majors: [t1], sent_back: [t1], need: "none" } });
    await ok(owner, { op: "update", project: "helix", ref: f2, set: { status: "Done" } });
    const bug = (await ok(owner, { op: "create", project: "helix", kind: "task", type: "bug", title: "Chart is blank", parent: f2 })).ref!;
    await ok(owner, { op: "criteria", project: "helix", ref: bug, change: { action: "check", n: 1, evidence: "abc1234" } });
    await ok(owner, { op: "update", project: "helix", ref: bug, set: { status: "Done" } });
    await ok(owner, { op: "update", project: "helix", ref: t2, set: { status: "Done" } });
    await ok(sup("Bill", null, "helix", "w_land1"), { op: "push", project: "helix", repo: "cath42/helix", branch: "main", sha: "aaaaaaa2" });
    await ok(sup("Bill", null, "helix", "w_land2"), { op: "push", project: "helix", repo: "cath42/helix", branch: "main", sha: "aaaaaaa3" });
    const r2 = (await ok(owner, { op: "create_release", project: "helix", title: "Hotfix" })).ref!;
    await ok(owner, { op: "close_release", project: "helix", ref: r2 });
    await ok({ kind: "agent", name: "Picard", laptop: "mbp-1", supervisor: false, ctx: null }, { op: "ask", project: "helix", text: "Ship it?", holds: [f1] });
    await session(bob, "1", { project: "bobnet", agent: "Toad", tokens: 7, close: {} });

    const r = await status(since);
    expect(r.since).toBe(since);
    expect(Date.parse(r.at)).toBeGreaterThanOrEqual(Date.parse(since));
    expect(r.projects.map((p) => p.project)).toEqual(["bobnet", "helix"]);
    const h = row(r);
    expect(h).toMatchObject({ name: "Helix", note: null, recurring: null, more: {} });
    expect(h.done.counts).toEqual({ features: 2, sessions: 1, lands: 2, releases: 1 });
    expect(h.done.features.map((f) => [f.ref, f.type, f.release])).toEqual([[bug, "bug", r1], [f2, "increment", r1]]);
    expect(h.done.sessions).toEqual([
      {
        session: { feature: f1, kind: "build", label: "1" },
        ended_at: expect.any(String),
        need: "none",
        summary: `Built ${f1} 1`,
        closed_by: "Picard@mbp-1",
        tokens: tokens(100),
        lost: 0,
        counts: { blockers: 1, majors: 1, sent_back: 1 },
      },
    ]);
    expect(h.done.releases).toEqual([{ ref: r2, title: "Hotfix", closed_at: expect.any(String) }]);
    // The session before the span ended its run before it too: only the run that ended in it counts.
    expect(h.usage.tokens).toEqual(tokens(100));
    expect(h.usage.by_agent).toEqual([{ agent: "Bill", role: "bill", tokens: tokens(100), runs: 1, lost: 0 }]);
    // Needs you is the very list the waits read returns.
    const waits = (await ok(owner, { op: "waits", project: "helix" })).waits;
    expect(h.waits).toEqual(waits);
    expect(h.waits.map((w) => w.text)).toEqual(["Ship it?"]);
    // The other project's work is its own row's.
    expect(row(r, "bobnet").done.counts).toEqual({ features: 0, sessions: 1, lands: 0, releases: 0 });
    expect(row(r, "bobnet").usage.tokens).toEqual(tokens(7));
    // One project named, or one an agent reads: that row only.
    expect((await status(since, owner, "bobnet")).projects.map((p) => p.project)).toEqual(["bobnet"]);
    expect((await status(since, { kind: "agent", name: "Picard", laptop: "mbp-1", supervisor: false, ctx: null })).projects.map((p) => p.project)).toEqual(["helix"]);
  });

  it("flags a thin backlog and an open release with nothing Ready, counts triage, lists idle sessions and features, and clamps the span (AC 2)", async () => {
    const { r1, f1, f2 } = await helix();
    const r2 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 2" })).ref!;
    await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Later", release: r2, status: "Ready", criteria: [{ text: "Works" }] });
    const triaged = (await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "chore", title: "Tidy" })).ref!;
    await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "task", title: "More" });
    // R1 opens with a session on f1; f2 goes In Progress with nobody on it; f3's session closed with it In Progress.
    const s = await session(f1, "1");
    await ok(owner, { op: "update", project: "helix", ref: f2, set: { status: "In Progress" } });
    const f3 = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Left", criteria: [{ text: "x" }] })).ref!;
    await session(f3, "1", { close: {} });
    await ok(owner, { op: "update", project: "helix", ref: f3, set: { status: "In Progress" } });
    let h = row(await status(ago(60)));
    expect(h.backlog).toMatchObject({
      ready: [{ ref: expect.any(String), title: "Later", release: r2, criteria: 1 }],
      sessions_estimate: null,
      // f1's task has a criterion, which counts as the feature's.
      no_criteria: [{ ref: f2, title: "Steps" }],
      triage: { count: 2, oldest: { ref: triaged, at: expect.any(String) } },
      release: { ref: r1, todo: 2, ready: 0 },
      thin: true,
    });
    // Nothing is idle yet: the run just ended, and f2 moved just now.
    expect(h.stuck.idle_sessions).toEqual([]);
    expect(h.stuck.idle_features).toEqual([]);
    await sql((db) => {
      db.exec("UPDATE runs SET started_at = ?, ended_at = ?", ago(200), ago(180));
      db.exec("UPDATE sessions SET started_at = ?", ago(200));
      db.exec("UPDATE sessions SET ended_at = ? WHERE ended_at IS NOT NULL", ago(190));
    });
    h = row(await status(ago(60)));
    expect(h.stuck.idle_sessions).toEqual([{ session: s, since: expect.any(String) }]);
    // f2 moved just now, so only f3 is idle: since its session ended.
    expect(h.stuck.idle_features).toEqual([{ ref: f3, title: "Left", since: expect.any(String) }]);
    expect(Date.parse(h.stuck.idle_sessions[0]!.since)).toBeLessThan(Date.now() - 2 * 3600_000);
    // A live run keeps the session from idling.
    await ok(sup("Ann", s, "helix", "w_ann"), { op: "run_start", project: "helix", id: "w_ann", started_at: ago(1), session: s });
    expect(row(await status(ago(60))).stuck.idle_sessions).toEqual([]);

    // A span over 31 days is clamped, and the reply says what it used; one in the future is now.
    const old = await status(ago(60 * 24 * 40));
    expect(Date.parse(old.at) - Date.parse(old.since)).toBe(31 * 24 * 3600_000);
    const ahead = await status(new Date(Date.now() + 3600_000).toISOString());
    expect(ahead.since).toBe(ahead.at);
  });

  it("estimates sessions from the last Done features and keeps a backlog with two Ready features from thin", async () => {
    const { r1 } = await helix();
    for (const n of [1, 2, 3]) {
      const f = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: `Done ${n}`, release: r1 })).ref!;
      for (let k = 1; k <= n; k++) await session(f, String(k), { close: {} });
      await ok(owner, { op: "update", project: "helix", ref: f, set: { status: "Done" } });
    }
    for (const n of [1, 2]) await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: `Ready ${n}`, release: r1, status: "Ready", criteria: [{ text: "x" }] });
    const h = row(await status(ago(60)));
    // Median 2 sessions per feature, two Ready: about 4.
    expect(h.backlog).toMatchObject({ sessions_estimate: 4, thin: false, release: { ref: r1, todo: 4, ready: 2 } });
  });

  it("cuts a list at 100 and says how many more, keeping counts whole", async () => {
    await helix();
    for (let n = 0; n < 103; n++) await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: `F${n}` });
    const h = row(await status(ago(60)));
    expect(h.backlog.no_criteria).toHaveLength(100);
    // 103 and Steps; Roadmap's task has a criterion.
    expect(h.more).toEqual({ "backlog.no_criteria": 4 });
  });

  it("marks heavy a session over twice its kind's usual of the 30 days before, with at least 5 to compare", async () => {
    const { f1 } = await helix();
    for (let n = 1; n <= 5; n++) await session(f1, `old${n}`, { tokens: 10 * n, close: {} });
    await sql((db) => db.exec("UPDATE sessions SET ended_at = ? WHERE label LIKE 'old%'", ago(60 * 24)));
    const since = await mark();
    const heavy = await session(f1, "big", { tokens: 70, close: {} });
    await session(f1, "small", { tokens: 40, close: {} });
    const h = row(await status(since));
    expect(h.usage.heavy).toEqual([{ session: heavy, tokens: tokens(70), usual: tokens(30) }]);
  });

  it("never judges heavy a session with a lost run, nor compares against one, the 5 included (BOB-42)", async () => {
    const { f1 } = await helix();
    for (let n = 1; n <= 4; n++) await session(f1, `old${n}`, { tokens: 10 * n, close: {} });
    await session(f1, "oldlost", { tokens: 0, close: {} });
    await sql((db) => db.exec("UPDATE runs SET outcome = 'lost' WHERE session = (SELECT pk FROM sessions WHERE label = 'oldlost')"));
    await sql((db) => db.exec("UPDATE sessions SET ended_at = ? WHERE label LIKE 'old%'", ago(60 * 24)));
    const since = await mark();
    const big = await session(f1, "big", { tokens: 70, close: {} });
    // Four known to compare: the lost one would make five, and its zero a median of 20.
    expect(row(await status(since)).usage.heavy).toEqual([]);

    await session(f1, "old5", { tokens: 50, close: {} });
    await sql((db) => db.exec("UPDATE sessions SET ended_at = ? WHERE label = 'old5'", ago(60 * 24)));
    await session(f1, "lostbig", { tokens: 500, close: {} });
    await sql((db) => db.exec("UPDATE runs SET outcome = 'lost' WHERE session = (SELECT pk FROM sessions WHERE label = 'lostbig')"));
    expect(row(await status(since)).usage.heavy).toEqual([{ session: big, tokens: tokens(70), usual: tokens(30) }]);
  });
});

describe("how a run ended (BOB-38)", () => {
  it("records a run's outcome and reason; old runs read as unknown; lost runs' tokens as unknown, not zero (AC 1)", async () => {
    const { f1 } = await helix();
    const s = { feature: f1, kind: "build" as const, label: "1" };
    await ok(sup("Sup", s), { op: "session_join", project: "helix", session: s });
    const end = (id: string, extra: object) => ok(sup("Bill", s, "helix", id), { op: "run_end", project: "helix", id, ended_at: ago(5), tokens: tokens(3), calls: 1, ...extra });
    const started = ago(10);
    for (const id of ["w_1", "w_2", "w_3", "w_4"]) await ok(sup("Bill", s, "helix", id), { op: "run_start", project: "helix", id, started_at: started, session: s });
    await end("w_1", { outcome: "done", reason: "ignored for done" });
    await end("w_2", { outcome: "failed", reason: "Bash exited 1" });
    await end("w_3", {});
    await ok(sup("Bill", s, "helix", "w_4"), { op: "run_end", project: "helix", id: "w_4", ended_at: ago(4), tokens: tokens(0), calls: 0, outcome: "lost", reason: "supervisor restarted" });
    const runs = (await ok(owner, { op: "get", project: "helix", session: s })).session!.runs;
    expect(runs.map((r) => [r.id, r.outcome, r.outcome_reason])).toEqual([
      ["w_1", "done", null],
      ["w_2", "failed", "Bash exited 1"],
      ["w_3", null, null],
      ["w_4", "lost", "supervisor restarted"],
    ]);
    const h = row(await status(ago(60)));
    // The run with no outcome is never stuck; the lost one is.
    expect(h.stuck.runs.map((r) => [r.id, r.outcome])).toEqual([["w_4", "lost"], ["w_2", "failed"]]);
    expect(h.usage).toMatchObject({ tokens: tokens(9), lost: 1, by_agent: [{ agent: "Bill", runs: 4, lost: 1, tokens: tokens(9) }] });
    expect(h.done.counts.sessions).toBe(0);
    // The export carries it, and an import restores it.
    const doc = await board().exportBoard({ kind: "owner", email: "owner@example.com" });
    const exported = doc.projects[0]!.runs.map((r) => [r.id, r.outcome ?? null, r.outcome_reason ?? null]);
    expect(exported).toContainEqual(["w_2", "failed", "Bash exited 1"]);
    expect(exported).toContainEqual(["w_3", null, null]);
  });

  it("leaves failed, stopped and lost runs once a later run starts in their session, into settled (AC 2, BOB-37 AC 3)", async () => {
    const { f1, f2 } = await helix();
    const s1 = { feature: f1, kind: "build" as const, label: "1" };
    const s2 = { feature: f2, kind: "build" as const, label: "1" };
    await ok(sup("Sup", s1), { op: "session_join", project: "helix", session: s1 });
    await ok(sup("Sup", s2), { op: "session_join", project: "helix", session: s2 });
    const run = async (id: string, s: SessionRef | null, start: number, end: number | null, outcome?: string) => {
      const who = sup("Bill", s, "helix", id);
      await ok(who, { op: "run_start", project: "helix", id, started_at: ago(start), session: s });
      if (end !== null) await ok(who, { op: "run_end", project: "helix", id, ended_at: ago(end), tokens: tokens(1), calls: 1, ...(outcome ? { outcome: outcome as never, reason: "why" } : {}) });
    };
    await run("w_a", s1, 50, 40, "failed");
    await run("w_b", s1, 30, null);
    await run("w_c", s2, 50, 40, "stopped");
    // A run with no session settles by the same agent's later run.
    await run("w_d", null, 25, 22, "lost");
    await run("w_e", null, 20, 10, "done");
    const h = row(await status(ago(60)));
    expect(h.stuck.runs.map((r) => [r.id, r.outcome, r.reason, r.session])).toEqual([["w_c", "stopped", "why", s2]]);
    expect(h.stuck.settled.map((x) => [x.kind, x.kind === "runs" ? x.entry.id : null])).toEqual([["runs", "w_d"], ["runs", "w_a"]]);
    // Settled before the span: neither stuck nor settled.
    const later = row(await status(ago(15)));
    expect(later.stuck.runs.map((r) => r.id)).toEqual([]);
    expect(later.stuck.settled).toEqual([]);
  });

  it("lists CI and land failures until a later pass of the same run, and answered questions still holding work", async () => {
    const { f1, t1 } = await helix();
    const ci = (id: string, name: string, status: "failed" | "passed", end: number) =>
      board().reportCi("github-actions", { project: "helix", external_id: id, name, branch: "main", status, ended_at: ago(end) });
    await ci("1", "test", "failed", 50);
    await ci("2", "test", "passed", 40);
    await ci("3", "lint", "failed", 30);
    const s = await session(f1, "1");
    await ok(sup("Bill", s, "helix", `w_bill_${f1}_1`), { op: "slot_run", project: "helix", external_id: "s1", name: "land", status: "failed", ended_at: ago(15) });
    const picard: BoardCaller = { kind: "agent", name: "Picard", laptop: "mbp-1", supervisor: false, ctx: null };
    const q = (await ok(picard, { op: "ask", project: "helix", text: "Which way?", holds: [t1] })).ref!;
    await ok(picard, { op: "record_answer", project: "helix", ref: q, words: "Left" });
    await sql((db) => {
      db.exec("UPDATE questions SET answered_at = ?", ago(150));
      db.exec("UPDATE runs SET started_at = ?", ago(170));
    });

    let h = row(await status(ago(180)));
    expect(h.stuck.ci.map((c) => [c.source, c.name, c.worker])).toEqual([["slot", "land", `w_bill_${f1}_1`], ["github-actions", "lint", null]]);
    expect(h.stuck.ci[0]!.session).toEqual(s);
    // f1's only run started before the answer: it still holds.
    expect(h.stuck.answered_holding).toEqual([{ ref: q, answered_at: expect.any(String), feature: f1 }]);
    expect(h.stuck.settled.map((x) => [x.kind, x.kind === "ci" ? x.entry.name : null])).toEqual([["ci", "test"]]);
    // A run on the feature after the answer settles it.
    await ok(sup("Ann", s, "helix", "w_ann"), { op: "run_start", project: "helix", id: "w_ann", started_at: ago(5), session: s });
    h = row(await status(ago(180)));
    expect(h.stuck.answered_holding).toEqual([]);
    expect(h.stuck.settled.map((x) => x.kind)).toEqual(["answered_holding", "ci"]);
  });
});
