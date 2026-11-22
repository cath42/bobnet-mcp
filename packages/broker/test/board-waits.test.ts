import type { BoardCaller, BoardCtx, BoardNoticeEvent, BoardOpInput, BoardReply, BoardResults, WaitRecord } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { BOARD_MIGRATIONS } from "../src/board/schema.ts";
import { BoardStore, type NoticeRow } from "../src/board/store.ts";

// Waits is never stale (ADR 0011; BOB-49): a landed fix marks its bug, a release tag fills its release,
// and a row a day unchanged is flagged to its owner once a day.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const agent = (name: string, ctx: BoardCtx | null = null): BoardCaller => ({ kind: "agent", name, laptop: "mbp-1", supervisor: ctx !== null, ctx });
/** A laptop's supervisor, ctx-less, serving `serves`. */
const supervisor = (serves: string[] = ["bobnet"]): BoardCaller => ({ kind: "agent", name: "poe", laptop: "mbp-1", supervisor: true, ctx: null, serves });
const board = () => env.BOARD.getByName("board");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const H = 60 * 60 * 1000;

async function call(caller: BoardCaller, op: BoardOpInput): Promise<BoardReply> {
  return (await board().apply(caller, op)) as unknown as BoardReply;
}

async function ok<K extends keyof BoardResults>(caller: BoardCaller, op: BoardOpInput & { op: K }): Promise<BoardResults[K]> {
  const reply = await call(caller, op);
  if (!reply.ok) throw new Error(`${op.op} refused: ${reply.code}: ${reply.message}`);
  return reply.result as BoardResults[K];
}

async function refused(caller: BoardCaller, op: BoardOpInput): Promise<{ code: string; message: string }> {
  const reply = await call(caller, op);
  if (reply.ok) throw new Error(`${op.op} was not refused`);
  return reply;
}

const notices = async () => (await board().notices()) as unknown as NoticeRow[];
const waitOf = async (ref: string, project?: string): Promise<WaitRecord | undefined> =>
  (await ok(owner, { op: "waits", ...(project ? { project } : {}) })).waits.find((w) => w.ref === ref && (project === undefined || w.project === project));

/** The Board's store on a clock the test moves (ADR 0011 §2): `clock.t` is now. */
async function moveableClock(t: number): Promise<{ t: number }> {
  const clock = { t };
  await runInDurableObject(board(), (instance, state) => {
    (instance as unknown as { store: BoardStore }).store = new BoardStore(state.storage.sql, () => clock.t);
  });
  return clock;
}

describe("board migration 7: bug_fixes, release_tags, wait_flags, and notices remade (ADR 0011 §4)", () => {
  it("takes a board at 6, with notices and pushes, to 7 with its rows intact", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND" });
    const rows = await runInDurableObject(board(), (_, state) => {
      const sql = state.storage.sql;
      // The tables as migration 6 left them, then migration 7 over them.
      sql.exec("DROP TABLE bug_fixes; DROP TABLE release_tags; DROP TABLE wait_flags; DROP TABLE notices;");
      sql.exec(BOARD_MIGRATIONS[5]!);
      sql.exec("INSERT INTO pushes (project, repo, branch, sha, worker, at) SELECT pk, 'cath42/helix', 'main', ?, 'w_1', '2026-11-20T10:00:00.000Z' FROM projects", "a".repeat(40));
      sql.exec(
        `INSERT INTO notices (seq, project, question, state, to_json, "except", text, notice, taken_at) VALUES
           (7, 'helix', 'Q-1', 'answered', '["Picard@mbp-1"]', NULL, 'Casper answered Q-1', '{"event":"answer"}', NULL),
           (9, 'helix', 'A-2', 'done', '[]', 'Riker@mbp-1', 'Casper marked A-2 done', '{"event":"answer"}', '2026-11-20T11:00:00.000Z')`,
      );
      expect(() => sql.exec("INSERT INTO notices (seq, project, question, state, to_json, text, notice) VALUES (10, 'helix', 'BOB-1', 'fix_landed', '[]', 't', '{}')")).toThrow(
        /CHECK constraint failed/,
      );
      sql.exec(BOARD_MIGRATIONS[6]!);
      return {
        notices: sql.exec('SELECT seq, project, kind, subject, state, to_json, "except", text, notice, taken_at FROM notices ORDER BY seq').toArray(),
        pushes: sql.exec("SELECT repo, branch, sha, worker FROM pushes").toArray(),
        untaken: sql.exec("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'notices_untaken'").toArray().length,
        tables: sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('bug_fixes', 'release_tags', 'wait_flags') ORDER BY name").toArray().map((r) => r["name"]),
      };
    });
    expect(rows.notices).toEqual([
      { seq: 7, project: "helix", kind: "answer", subject: "Q-1", state: "answered", to_json: '["Picard@mbp-1"]', except: null, text: "Casper answered Q-1", notice: '{"event":"answer"}', taken_at: null },
      { seq: 9, project: "helix", kind: "answer", subject: "A-2", state: "done", to_json: "[]", except: "Riker@mbp-1", text: "Casper marked A-2 done", notice: '{"event":"answer"}', taken_at: "2026-11-20T11:00:00.000Z" },
    ]);
    expect(rows.pushes).toEqual([{ repo: "cath42/helix", branch: "main", sha: "a".repeat(40), worker: "w_1" }]);
    expect(rows.untaken).toBe(1);
    expect(rows.tables).toEqual(["bug_fixes", "release_tags", "wait_flags"]);
    // The untaken one is still drained, under its new names; a fix's state now fits.
    expect((await notices()).map((n) => [n.seq, n.kind, n.subject])).toEqual([[7, "answer", "Q-1"]]);
    await runInDurableObject(board(), (_, state) => {
      state.storage.sql.exec("INSERT INTO notices (seq, project, kind, subject, state, to_json, text, notice) VALUES (10, 'helix', 'fix', 'LAND-1', 'fix_landed', '[]', 't', '{}')");
    });
  });
});

describe("a landed fix marks its bug and tells the PO; a release tag fills its release (ADR 0011 §1; BOB-49 AC1)", () => {
  const FIX = "5d4617f4bed3884d73deb1a9cc71e1ed366215f4";
  const LATER = "6e151ac8a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const SUBJECT = "v2: BOB-27: board reports no longer stall behind a row the protocol won't take";
  const ctx: BoardCtx = { worker: "w_mario", role: "lead", project: "bobnet", session: null, tasks: [] };
  const mario = agent("Mario", ctx);
  const push = (sha: string, fixes?: Array<{ ref: string; sha: string; subject: string }>) =>
    ok(mario, { op: "push", project: "bobnet", repo: "cath42/bobnet", branch: "v2", sha, ...(fixes ? { fixes } : {}) });

  /** BobNet, its PO Peach, with BOB-27 a bug that blocks use; Mario's run lands. */
  async function bobnet(): Promise<void> {
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB", lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: ["cath42/bobnet"] });
    for (let n = 1; n <= 26; n++) await ok(owner, { op: "create", project: "bobnet", kind: n === 1 ? "feature" : "backlog", type: n === 1 ? "increment" : "task", title: `Item ${n}` });
    const bug = await ok(agent("Casper"), { op: "capture", project: "bobnet", capture_id: uuid(27), title: "Board reports stall", type: "bug", blocks_use: true, bug_where: "production" });
    expect(bug.ref).toBe("BOB-27");
    await ok(mario, { op: "run_start", project: "bobnet", id: "w_mario", started_at: "2026-11-15T16:00:00.000Z", session: null });
  }

  it("leaves BOB-27 on Waits, not blocking, with its fix, tells Peach, and its release follows the tag", async () => {
    await bobnet();
    expect(await waitOf("BOB-27")).toMatchObject({ kind: "bug", blocking: true, fix: null });

    const landed = await push(FIX, [{ ref: "BOB-27", sha: FIX, subject: SUBJECT }]);
    expect(landed).toMatchObject({ fixed: ["BOB-27"], fixes_ignored: [] });
    const wait = await waitOf("BOB-27");
    expect(wait).toMatchObject({ kind: "bug", blocking: false, fix: { sha: FIX, subject: SUBJECT, release: null, tags_known: false } });
    expect(Date.parse(wait!.fix!.landed_at)).not.toBeNaN();
    // The overview's "waits on you" follows `blocking`.
    expect((await ok(owner, { op: "overview", project: "bobnet" })).projects[0]!.waits_on_you).toBeNull();

    const [fix] = await notices();
    expect(fix).toMatchObject({ project: "bobnet", kind: "fix", subject: "BOB-27", state: "fix_landed", to: ["Peach@mbp-1"], except: null });
    expect(fix!.text).toContain("5d4617f");
    expect(fix!.text).toContain("close BOB-27");
    expect(fix!.text).toBe(`BOB-27's fix landed: 5d4617f "${SUBJECT}", by Mario@mbp-1. Check it and close BOB-27: tick its criterion with the commit as evidence, then move it to Done.`);
    expect(fix!.notice as BoardNoticeEvent).toMatchObject({ v: 2, event: "board_notice", project: "bobnet", ref: "BOB-27", kind: "fix_landed", to: ["Peach@mbp-1"], lead: "Mario@mbp-1", asked_by: "Peach@mbp-1" });
    // The fix is a change to the bug: its history says so.
    const history = (await ok(owner, { op: "get", project: "bobnet", ref: "BOB-27", history: true })).history!;
    expect(history.at(-1)).toMatchObject({ op: "push", changes: [{ field: "fix", old: null, new: FIX }] });
    await board().noticesTaken([fix!.seq]);

    // rc.34 is tagged on a later push: the fix is in it, and Peach hears.
    await push(LATER);
    expect(await ok(supervisor(), { op: "release_tag", repo: "cath42/bobnet", tag: "v2.0.0-rc.34", sha: LATER })).toMatchObject({ released: ["BOB-27"] });
    expect(await waitOf("BOB-27")).toMatchObject({ blocking: false, fix: { sha: FIX, release: "v2.0.0-rc.34", tags_known: true } });
    const [released] = await notices();
    expect(released).toMatchObject({ kind: "fix", subject: "BOB-27", state: "fix_released", to: ["Peach@mbp-1"], text: "BOB-27's fix 5d4617f is in v2.0.0-rc.34" });
    expect(released!.notice).toMatchObject({ event: "board_notice", kind: "fix_released", ref: "BOB-27" });
    // The release is a change to the bug too, so its day starts again (ADR 0011 §6.3).
    const after = (await ok(owner, { op: "get", project: "bobnet", ref: "BOB-27", history: true })).history!;
    expect(after.at(-1)).toMatchObject({ op: "release_tag", changes: [{ field: "release", old: null, new: "v2.0.0-rc.34" }] });
    // A tag reported again changes nothing.
    expect(await ok(supervisor(), { op: "release_tag", project: "bobnet", repo: "cath42/bobnet", tag: "v2.0.0-rc.34", sha: LATER })).toMatchObject({ released: [] });
  });

  it("marks nothing for a feature, a Done bug, another project's ref, or one unknown; the same push twice marks once", async () => {
    await bobnet();
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND" });
    await ok(agent("Data"), { op: "capture", project: "helix", capture_id: uuid(1), title: "Elsewhere", type: "bug", blocks_use: true });
    const done = (await ok(agent("Casper"), { op: "capture", project: "bobnet", capture_id: uuid(28), title: "Fixed already", type: "bug" })).ref!;
    await ok(owner, { op: "criteria", project: "bobnet", ref: done, change: { action: "check", n: 1, evidence: "landed abc1234" } });
    await ok(owner, { op: "update", project: "bobnet", ref: done, set: { status: "Done" } });

    const ignored = await push(FIX, [
      { ref: "BOB-1", sha: FIX, subject: "a feature" },
      { ref: done, sha: FIX, subject: "a Done bug" },
      { ref: "LAND-1", sha: FIX, subject: "Helix's bug" },
      { ref: "BOB-99", sha: FIX, subject: "nothing" },
    ]);
    expect(ignored).toMatchObject({ fixed: [], fixes_ignored: ["BOB-1", done, "LAND-1", "BOB-99"] });
    const pushed = (await ok(owner, { op: "get", project: "bobnet", ref: "BOB-1", history: true })).history!;
    expect(pushed.some((e) => e.op === "push")).toBe(false);
    expect(await waitOf("LAND-1", "helix")).toMatchObject({ blocking: true, fix: null });
    expect(await notices()).toEqual([]);

    const fixes = [{ ref: "BOB-27", sha: LATER, subject: "the fix" }];
    expect(await push(LATER, fixes)).toMatchObject({ fixed: ["BOB-27"] });
    expect(await push(LATER, fixes)).toMatchObject({ fixed: [] });
    const marks = await runInDurableObject(board(), (_, state) => state.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM bug_fixes").one().n);
    expect(marks).toBe(1);
    expect((await notices()).map((n) => n.state)).toEqual(["fix_landed"]);
  });

  it("takes a release tag only from a supervisor serving the project; a tag never pushed marks nothing", async () => {
    await bobnet();
    await push(FIX, [{ ref: "BOB-27", sha: FIX, subject: SUBJECT }]);
    const tag = { op: "release_tag" as const, repo: "cath42/bobnet", tag: "v2.0.0-rc.34", sha: LATER };
    expect(await refused(supervisor(["helix"]), tag)).toMatchObject({ code: "forbidden", message: expect.stringMatching(/didn't register bobnet/) });
    expect(await refused(agent("Mario"), tag)).toMatchObject({ code: "forbidden" });
    expect(await refused(owner, tag)).toMatchObject({ code: "forbidden" });
    expect(await refused(supervisor(), { ...tag, repo: "cath42/unknown" })).toMatchObject({ code: "invalid" });
    // LATER was never pushed: stored, and nothing is in it; the repo's tags are known now.
    expect(await ok(supervisor(), tag)).toMatchObject({ released: [] });
    expect(await waitOf("BOB-27")).toMatchObject({ fix: { release: null, tags_known: true } });
  });
});

describe("the stale rule, on an injected clock (ADR 0011 §2; BOB-49 AC2)", () => {
  const T0 = Date.parse("2026-11-21T16:40:00.000Z");
  const data = agent("Data");

  /** Helix, PO Riker and lead Picard; Data asks Q-1 at the clock's now. */
  async function helix(po: string | null = "Riker@mbp-1"): Promise<void> {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", lead: "Picard@mbp-1", ...(po ? { po } : {}) });
    await ok(owner, { op: "grant", project: "helix", agent: "Data", role: "dev", read: true, items: "none", fields: [], questions: false });
    await ok(owner, { op: "grant", project: "helix", agent: "Riker", role: "po", read: true, items: "all", fields: ["status"], questions: true });
    await ok(owner, { op: "grant", project: "helix", agent: "Bill", role: "builder", read: true, items: "none", fields: [] });
  }
  const ask = async (caller: BoardCaller, text: string) => (await ok(caller, { op: "ask", project: "helix", text })).ref!;
  const flag = () => board().flagStale();

  it("flags a question to its asker after a day, once a day, and a keep starts its day again", async () => {
    const clock = await moveableClock(T0);
    await helix();
    await ok(owner, { op: "grant", project: "helix", agent: "Data", role: "dev", read: true, items: "none", fields: [], questions: true });
    const q = await ask(data, "Which chart?");

    clock.t = T0 + 23 * H;
    expect((await waitOf(q))!.stale).toBeNull();
    expect(await flag()).toEqual({ flagged: [], no_owner: [] });

    clock.t = T0 + 25 * H;
    expect((await waitOf(q))!.stale).toEqual({ changed_at: new Date(T0).toISOString(), owner: "Data@mbp-1", flagged_at: null });
    const first = await flag();
    expect(first.flagged).toEqual([{ project: "helix", ref: q, owner: "Data@mbp-1", seq: expect.any(Number) }]);
    const [n] = await notices();
    expect(n).toMatchObject({ kind: "stale", subject: q, state: "stale", to: ["Data@mbp-1"] });
    expect(n!.text).toBe(
      "Q-1 (helix) has waited on Casper for 25 h unchanged since 2026-11-21 16:40Z. If it is still current, keep it (board_write keep, with why); if not, edit it, withdraw it, or move it.",
    );
    expect(n!.notice).toMatchObject({ event: "board_notice", kind: "stale", ref: q, to: ["Data@mbp-1"], lead: "Picard@mbp-1", asked_by: "Data@mbp-1" });
    expect((await waitOf(q))!.stale).toMatchObject({ owner: "Data@mbp-1", flagged_at: new Date(T0 + 25 * H).toISOString() });
    await board().noticesTaken([n!.seq]);
    // The flag doesn't change the question's record, so its day doesn't start again.
    expect((await ok(owner, { op: "get", project: "helix", ref: q, history: true })).history!.map((e) => e.op)).toEqual(["ask"]);

    clock.t = T0 + 26 * H;
    expect((await flag()).flagged).toEqual([]);
    clock.t = T0 + 49 * H;
    expect((await flag()).flagged).toHaveLength(1);
    await board().noticesTaken((await notices()).map((x) => x.seq));

    clock.t = T0 + 50 * H;
    await ok(data, { op: "keep", project: "helix", ref: q, reason: "Casper said he'd look on Monday" });
    expect(await waitOf(q)).toMatchObject({ stale: null, kept: { by: "Data@mbp-1", at: new Date(T0 + 50 * H).toISOString(), reason: "Casper said he'd look on Monday" } });
    for (const h of [51, 73, 74]) {
      clock.t = T0 + h * H;
      expect((await flag()).flagged).toEqual([]);
    }
    clock.t = T0 + 75 * H;
    expect(await waitOf(q)).toMatchObject({ stale: { changed_at: new Date(T0 + 50 * H).toISOString(), flagged_at: null }, kept: { by: "Data@mbp-1" } });
    expect((await flag()).flagged).toHaveLength(1);
    expect(await notices()).toHaveLength(1);
  });

  it("owns a review gate and a bug by the PO, by the lead when there is none; a row with no owner sends nothing", async () => {
    const clock = await moveableClock(T0);
    await helix();
    const gate = (await ok(owner, { op: "create", project: "helix", kind: "backlog", type: "task", title: "Ship it" })).ref!;
    await ok(owner, { op: "criteria", project: "helix", ref: gate, change: { action: "add", text: "Casper accepts", casper_gate: true } });
    await ok(owner, { op: "update", project: "helix", ref: gate, set: { status: "In Review" } });
    const bug = (await ok(agent("Bill"), { op: "capture", project: "helix", capture_id: uuid(1), title: "Crashes", type: "bug", blocks_use: true })).ref!;
    // The owner's own question has no agent to tell.
    const mine = await ask(owner, "Mine?");

    clock.t = T0 + 25 * H;
    expect((await waitOf(gate))!.stale).toMatchObject({ owner: "Riker@mbp-1" });
    expect((await waitOf(bug))!.stale).toMatchObject({ owner: "Riker@mbp-1" });
    expect((await waitOf(mine))!.stale).toMatchObject({ owner: null });
    const flagged = await flag();
    expect(flagged.flagged.map((f) => [f.ref, f.owner])).toEqual([
      [gate, "Riker@mbp-1"],
      [bug, "Riker@mbp-1"],
    ]);
    expect(flagged.no_owner).toEqual([{ project: "helix", ref: mine }]);
    expect((await notices()).map((n) => n.subject)).toEqual([gate, bug]);
    // Its flag holds too: not returned again within the day.
    clock.t = T0 + 26 * H;
    expect(await flag()).toEqual({ flagged: [], no_owner: [] });

    // The PO keeps the gate: a status holder may; a builder may not.
    expect(await refused(agent("Bill"), { op: "keep", project: "helix", ref: gate, reason: "Still current" })).toMatchObject({ code: "forbidden" });
    await ok(agent("Riker"), { op: "keep", project: "helix", ref: gate, reason: "Casper reviews it Monday" });
    expect(await waitOf(gate)).toMatchObject({ stale: null, kept: { by: "Riker@mbp-1", reason: "Casper reviews it Monday" } });

    // No PO: the lead owns them.
    await ok(owner, { op: "create_project", key: "solo", name: "Solo", prefix: "SOLO", lead: "Mario@mbp-2" });
    const solo = (await ok(agent("Bill"), { op: "capture", project: "solo", capture_id: uuid(2), title: "Breaks", type: "bug", blocks_use: true })).ref!;
    clock.t = T0 + 51 * H;
    expect((await waitOf(solo, "solo"))!.stale).toMatchObject({ owner: "Mario@mbp-2" });
  });

  it("withdraws a question: it leaves Waits and its flag goes; only its asker or a questions holder may", async () => {
    const clock = await moveableClock(T0);
    await helix();
    await ok(owner, { op: "grant", project: "helix", agent: "Data", role: "dev", read: true, items: "none", fields: [], questions: true });
    const q = await ask(data, "Which chart?");
    const other = await ask(agent("Riker"), "Which colour?");
    clock.t = T0 + 25 * H;
    await flag();
    await board().noticesTaken((await notices()).map((n) => n.seq));
    const flags = () => runInDurableObject(board(), (_, state) => state.storage.sql.exec<{ ref: string }>("SELECT ref FROM wait_flags ORDER BY ref").toArray().map((r) => r.ref));
    expect(await flags()).toEqual([q, other]);

    expect(await refused(agent("Bill"), { op: "withdraw", project: "helix", ref: q, reason: "Moot" })).toMatchObject({ code: "forbidden", message: expect.stringMatching(/its asker, Data@mbp-1/) });
    expect(await ok(data, { op: "withdraw", project: "helix", ref: q, reason: "Moot: the chart went" })).toMatchObject({ ref: q });
    // A questions holder may withdraw another's.
    await ok(agent("Riker"), { op: "withdraw", project: "helix", ref: other, reason: "Asked again as Q-3" });
    expect((await ok(owner, { op: "waits", project: "helix" })).waits).toEqual([]);
    const got = await ok(owner, { op: "get", project: "helix", ref: q, history: true });
    expect(got.question).toMatchObject({ state: "withdrawn" });
    expect(got.history!.at(-1)).toMatchObject({ op: "withdraw", reason: "Moot: the chart went", changes: [{ field: "state", old: "open", new: "withdrawn" }] });

    await flag();
    expect(await flags()).toEqual([]);
    expect(await refused(data, { op: "withdraw", project: "helix", ref: q, reason: "Again" })).toMatchObject({ code: "conflict" });
    expect(await refused(data, { op: "keep", project: "helix", ref: q, reason: "Still" })).toMatchObject({ code: "conflict" });
    expect(await refused(owner, { op: "answer_question", project: "helix", ref: q, words: "Bars" })).toMatchObject({ code: "conflict" });
    expect(await notices()).toEqual([]);
  });
});

describe("review A's fixes (architecture/bob49/review-A.md B1, M1)", () => {
  const T0 = Date.parse("2026-11-21T16:40:00.000Z");

  it("flags a project with 120 rows on Waits, and still deletes the flag of one answered (B1)", async () => {
    const clock = await moveableClock(T0);
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", lead: "Picard@mbp-1" });
    await ok(owner, { op: "grant", project: "helix", agent: "Data", role: "dev", read: true, items: "none", fields: [], questions: true });
    const refs: string[] = [];
    for (let n = 0; n < 120; n++) refs.push((await ok(agent("Data"), { op: "ask", project: "helix", text: `Question ${n}?` })).ref!);
    clock.t = T0 + 25 * H;
    expect((await board().flagStale()).flagged).toHaveLength(120);
    await ok(owner, { op: "answer_question", project: "helix", ref: refs[0]!, words: "Yes" });
    clock.t = T0 + 26 * H;
    expect(await board().flagStale()).toEqual({ flagged: [], no_owner: [] });
    const flags = await runInDurableObject(board(), (_, state) => state.storage.sql.exec<{ ref: string }>("SELECT ref FROM wait_flags").toArray().map((r) => r.ref));
    expect(flags).toHaveLength(119);
    expect(flags).not.toContain(refs[0]);
  });

  it("tells the PO a fixed bug waits on them, not on Casper, when it goes stale (m2, ADR 0011 §6.9)", async () => {
    const clock = await moveableClock(T0);
    const ctx: BoardCtx = { worker: "w_mario", role: "lead", project: "bobnet", session: null, tasks: [] };
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB", lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: ["cath42/bobnet"] });
    const bug = (await ok(agent("Casper"), { op: "capture", project: "bobnet", capture_id: uuid(3), title: "Stalls", type: "bug", blocks_use: true })).ref!;
    await ok(agent("Mario", ctx), { op: "run_start", project: "bobnet", id: "w_mario", started_at: new Date(T0).toISOString(), session: null });
    const sha = "5d4617f4bed3884d73deb1a9cc71e1ed366215f4";
    await ok(agent("Mario", ctx), { op: "push", project: "bobnet", repo: "cath42/bobnet", branch: "v2", sha, fixes: [{ ref: bug, sha, subject: "the fix" }] });
    await board().noticesTaken((await notices()).map((n) => n.seq));
    clock.t = T0 + 26 * H;
    expect((await board().flagStale()).flagged).toEqual([{ project: "bobnet", ref: bug, owner: "Peach@mbp-1", seq: expect.any(Number) }]);
    expect((await notices())[0]!.text).toBe(`${bug} (bobnet) has waited on its PO for 26 h since its fix landed, unchanged since 2026-11-21 16:40Z. Check it and close it, or keep it (board_write keep, with why).`);
  });

  it("refuses a fix whose bug is another project's, in the table itself (M1)", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND" });
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB" });
    await ok(agent("Casper"), { op: "capture", project: "bobnet", capture_id: uuid(1), title: "Stalls", type: "bug" });
    await runInDurableObject(board(), (_, state) => {
      const sql = state.storage.sql;
      const pk = (key: string) => sql.exec<{ pk: number }>("SELECT pk FROM projects WHERE key = ?", key).one().pk;
      const bug = sql.exec<{ pk: number }>("SELECT pk FROM items WHERE project = ?", pk("bobnet")).one().pk;
      const push = (project: number) => sql.exec<{ pk: number }>("INSERT INTO pushes (project, repo, branch, sha, worker, at) VALUES (?, ?, 'main', ?, 'w_1', 'x') RETURNING pk", project, `r/${project}`, "a".repeat(40)).one().pk;
      const fix = (project: number) => sql.exec("INSERT INTO bug_fixes (project, item, sha, subject, push, at) VALUES (?, ?, ?, 's', ?, 'x')", project, bug, "b".repeat(40), push(project));
      expect(() => fix(pk("helix"))).toThrow(/FOREIGN KEY constraint failed/);
      fix(pk("bobnet"));
    });
  });
});
