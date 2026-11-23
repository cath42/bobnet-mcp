import type { BoardCaller, BoardCtx, BoardOpInput, BoardReply, BoardResults, SessionRef, TokenTotals } from "@bobnet/protocol";
import { USAGE_WEIGHTS } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { BoardStore, USAGE_RUNS_SQL } from "../src/board/store.ts";

// BOB-121's usage reads (ADR 0014 §3, §3a): a series per project, weighted by model, spread over the days a
// run ran, and a day's context per call. Called as the broker calls them, on a board with a fixed clock.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const board = () => env.BOARD.getByName("board");
const H = 3600_000;
/** The board's now: noon UTC, 1 pm in Copenhagen. */
const NOW = Date.parse("2026-11-22T12:00:00.000Z");
const iso = (t: number) => new Date(t).toISOString();

async function call(caller: BoardCaller, op: BoardOpInput): Promise<BoardReply> {
  return (await board().apply(caller, op)) as unknown as BoardReply;
}
async function ok<K extends keyof BoardResults>(caller: BoardCaller, op: BoardOpInput & { op: K }): Promise<BoardResults[K]> {
  const reply = await call(caller, op);
  if (!reply.ok) throw new Error(`${op.op} refused: ${reply.code}: ${reply.message}`);
  return reply.result as BoardResults[K];
}
async function fixedClock() {
  await runInDurableObject(board(), (instance, state) => {
    (instance as unknown as { store: BoardStore }).store = new BoardStore(state.storage.sql, () => NOW);
  });
}

async function project(key: string, prefix: string) {
  await ok(owner, { op: "create_project", key, name: key[0]!.toUpperCase() + key.slice(1), prefix });
}
const feature = async (key: string, title: string) => (await ok(owner, { op: "create", project: key, kind: "feature", type: "increment", title })).ref!;
const each = (n: number): TokenTotals => ({ input: n, output: n, cache_read: n, cache_write: n });

let runs = 0;
/** A run of `role`, started and ended as told, in a session or not. */
async function run(o: {
  project?: string;
  role?: string;
  session?: SessionRef | null;
  model?: string | null;
  start: number;
  end: number;
  tokens?: TokenTotals;
  models?: Array<{ model: string; tokens: TokenTotals }>;
  calls?: number;
  ctx?: number[];
  outcome?: "done" | "lost";
  resumed?: boolean;
}) {
  const project = o.project ?? "helix";
  const role = o.role ?? "builder";
  const id = `w_${role}_${++runs}`;
  const who: BoardCaller = {
    kind: "agent",
    name: role[0]!.toUpperCase() + role.slice(1),
    laptop: "mbp-1",
    supervisor: true,
    ctx: { worker: id, role, project, session: o.session ?? null, tasks: [] } satisfies BoardCtx,
  };
  if (o.session) await ok(who, { op: "session_join", project, session: o.session });
  await ok(who, { op: "run_start", project, id, started_at: iso(o.start), session: o.session ?? null, model: o.model ?? null, resumed: o.resumed ?? false });
  await ok(who, {
    op: "run_end",
    project,
    id,
    ended_at: iso(o.end),
    tokens: o.tokens ?? each(0),
    ...(o.models ? { models: o.models } : {}),
    calls: o.calls ?? 0,
    ctx: o.ctx ?? [],
    outcome: o.outcome ?? "done",
  });
  return id;
}

const usage = (op: Partial<Extract<BoardOpInput, { op: "usage" }>> = {}, caller: BoardCaller = owner) => ok(caller, { op: "usage", ...op });
const series = (r: BoardResults["usage"], key = "helix") => r.projects.find((p) => p.project === key)!;
const today = (r: BoardResults["usage"], key = "helix") => series(r, key).points.at(-1)!;

describe("the usage read (ADR 0014 §3, BOB-167)", () => {
  it("gives every project its own series over the days to today, a project with no runs all zeros (AC11)", async () => {
    await fixedClock();
    await project("helix", "LAND");
    await project("bobnet", "BOB");
    await run({ project: "helix", start: NOW - 2 * H, end: NOW - H, tokens: each(10), calls: 3, model: "sonnet" });
    await run({ project: "bobnet", start: NOW - 30 * H, end: NOW - 26 * H, tokens: each(5), calls: 2, model: "sonnet" });
    await project("quiet", "QT");
    const r = await usage();
    expect(r.days).toHaveLength(30);
    expect([r.days[0], r.days.at(-1), r.tz]).toEqual(["2026-10-24", "2026-11-22", "UTC"]);
    expect(r.projects.map((p) => [p.project, p.name, p.points.length])).toEqual([
      ["bobnet", "Bobnet", 30],
      ["helix", "Helix", 30],
      ["quiet", "Quiet", 30],
    ]);
    expect(today(r).raw).toEqual(each(10));
    expect(today(r, "bobnet").raw).toEqual(each(0));
    expect(series(r, "bobnet").points.at(-2)!.raw).toEqual(each(5));
    expect(series(r, "quiet").points.every((p) => p.calls === 0 && p.weighted === 0 && p.top.length === 0)).toBe(true);
    expect(series(r, "quiet").lost).toBe(0);
    expect((await usage({ project: "helix", days: 7 })).projects.map((p) => [p.project, p.points.length])).toEqual([["helix", 7]]);
  });

  it("weighs an Opus run double a Sonnet run with the same tokens, and puts a run declared null in unknown (AC12)", async () => {
    await fixedClock();
    await project("helix", "LAND");
    await run({ start: NOW - 3 * H, end: NOW - 2 * H, tokens: each(100), model: "claude-sonnet-5-5" });
    await run({ start: NOW - 3 * H, end: NOW - 2 * H, tokens: each(100), model: "opus" });
    await run({ start: NOW - 3 * H, end: NOW - 2 * H, tokens: each(50), model: null });
    const r = await usage({ project: "helix" });
    const p = today(r);
    expect(p.raw).toEqual(each(250));
    expect(p.weighted).toBe(400 + 800 + 200);
    expect(p.unknown).toBe(200);
    expect(p.by_model).toEqual([
      { model: "claude-opus-5-5", raw: 400, weighted: 800 },
      { model: "claude-sonnet-5-5", raw: 400, weighted: 400 },
      { model: "unknown", raw: 200, weighted: 200 },
    ]);
    expect(r.weights).toEqual({ read_at: "2026-11-22", rows: [...USAGE_WEIGHTS] });
  });

  it("counts a lost run in lost, never in the tokens", async () => {
    await fixedClock();
    await project("helix", "LAND");
    await run({ start: NOW - 3 * H, end: NOW - 2 * H, tokens: each(7), calls: 2, model: "sonnet" });
    await run({ start: NOW - 3 * H, end: NOW - 2 * H, tokens: each(0), calls: 0, outcome: "lost" });
    const s = series(await usage({ project: "helix" }));
    expect(s.lost).toBe(1);
    expect(s.points.at(-1)!.raw).toEqual(each(7));
    expect(s.points.at(-1)!.calls).toBe(2);
  });

  it("splits a 48-hour run across three days by its hours, its calls as its tokens", async () => {
    await fixedClock();
    await project("helix", "LAND");
    await run({ start: NOW - 48 * H, end: NOW, tokens: each(480), calls: 48, model: "sonnet" });
    const pts = series(await usage({ project: "helix", days: 4 })).points;
    expect(pts.map((p) => p.raw.input)).toEqual([0, 120, 240, 120]);
    expect(pts.map((p) => p.calls)).toEqual([0, 12, 24, 12]);
    expect(pts.map((p) => p.by_role)).toEqual([
      [],
      [{ role: "builder", calls: 12, raw: 480, weighted: 480 }],
      [{ role: "builder", calls: 24, raw: 960, weighted: 960 }],
      [{ role: "builder", calls: 12, raw: 480, weighted: 480 }],
    ]);
  });

  it("follows tz's calendar: a run at 23:30 UTC is the next day in Copenhagen", async () => {
    await fixedClock();
    await project("helix", "LAND");
    const late = Date.parse("2026-11-21T23:30:00.000Z");
    await run({ start: late - 10 * 60_000, end: late, tokens: each(1), model: "sonnet" });
    const utc = await usage({ project: "helix", days: 2 });
    expect(series(utc).points.map((p) => p.raw.input)).toEqual([1, 0]);
    const cph = await usage({ project: "helix", days: 2, tz: "Europe/Copenhagen" });
    expect([cph.days, cph.tz]).toEqual([["2026-11-21", "2026-11-22"], "Europe/Copenhagen"]);
    expect(series(cph).points.map((p) => p.raw.input)).toEqual([0, 1]);
    expect(await call(owner, { op: "usage", tz: "Mars/Olympus" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("leaves out a project the caller can't read, and refuses it by name", async () => {
    await fixedClock();
    await project("helix", "LAND");
    await project("bobnet", "BOB");
    await ok(owner, { op: "grant", project: "helix", agent: "Data", role: "dev", read: true, items: "none", fields: [] });
    const data: BoardCaller = { kind: "agent", name: "Data", laptop: "mbp-1", supervisor: false, ctx: null };
    expect((await usage({}, data)).projects.map((p) => p.project)).toEqual(["helix"]);
    expect(await call(data, { op: "usage", project: "bobnet" })).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("puts two roles' calls in their own by_role rows", async () => {
    await fixedClock();
    await project("helix", "LAND");
    await run({ role: "builder", start: NOW - 3 * H, end: NOW - 2 * H, tokens: each(10), calls: 5, model: "sonnet" });
    await run({ role: "builder", start: NOW - 2 * H, end: NOW - H, tokens: each(10), calls: 4, model: "sonnet" });
    await run({ role: "reviewer", start: NOW - 3 * H, end: NOW - 2 * H, tokens: each(5), calls: 7, model: "opus" });
    const p = today(await usage({ project: "helix" }));
    expect(p.calls).toBe(16);
    expect(p.by_role).toEqual([
      { role: "builder", calls: 9, raw: 80, weighted: 80 },
      { role: "reviewer", calls: 7, raw: 20, weighted: 40 },
    ]);
  });

  it("names the day's biggest sessions by raw and by weighted, other work as session null (§3a, spec §6 Q4)", async () => {
    await fixedClock();
    await project("helix", "LAND");
    const titles = ["Alpha", "Beta", "Haiku", "Delta"];
    const s = await Promise.all(titles.map(async (t): Promise<SessionRef> => ({ feature: await feature("helix", t), kind: "build", label: "1" })));
    const at = { start: NOW - 3 * H, end: NOW - 2 * H };
    await run({ ...at, session: s[0]!, model: "sonnet", tokens: each(250) }); // raw 1000, weighted 1000
    await run({ ...at, session: s[1]!, model: "sonnet", tokens: each(225) }); // raw 900, weighted 900
    await run({ ...at, session: s[2]!, model: "haiku", tokens: each(500) }); // raw 2000, weighted 125
    await run({ ...at, session: s[3]!, model: "opus", tokens: each(150) }); // raw 600, weighted 1200
    await run({ ...at, session: null, model: "sonnet", tokens: each(100) }); // other work: 400 and 400
    await run({ ...at, session: null, role: "consult", model: "sonnet", tokens: each(140) }); // with it, 960 and 960
    const top = today(await usage({ project: "helix" })).top;
    // Raw: Haiku, Alpha, other work; weighted: Delta, Alpha, other work. Beta is in neither.
    expect(top).toEqual([
      { session: s[2]!, feature_title: "Haiku", raw: 2000, weighted: 125 },
      { session: s[0]!, feature_title: "Alpha", raw: 1000, weighted: 1000 },
      { session: null, feature_title: null, raw: 960, weighted: 960 },
      { session: s[3]!, feature_title: "Delta", raw: 600, weighted: 1200 },
    ]);
  });

  it("weighs a run by the models its supervisor reported, and by its declared one without them (ADR 0014 §2, BOB-173)", async () => {
    await fixedClock();
    await project("helix", "LAND");
    // Declared Opus; its subagent ran on Haiku.
    await run({ model: "opus", start: NOW - 2 * H, end: NOW - H, tokens: each(110), calls: 3, models: [{ model: "claude-opus-5-5", tokens: each(10) }, { model: "claude-haiku-5-5", tokens: each(100) }] });
    let pt = today(await usage());
    expect(pt.raw).toEqual(each(110));
    expect([pt.weighted, pt.unknown, pt.calls]).toEqual([80 + 25, 0, 3]);
    expect(pt.by_model).toEqual([
      { model: "claude-haiku-5-5", raw: 400, weighted: 25 },
      { model: "claude-opus-5-5", raw: 40, weighted: 80 },
    ]);
    expect(pt.by_role).toEqual([{ role: "builder", calls: 3, raw: 440, weighted: 105 }]);
    // Undeclared, with models: known; a run without them, by its declared one.
    await run({ model: null, start: NOW - 2 * H, end: NOW - H, tokens: each(5), models: [{ model: "claude-sonnet-5-5", tokens: each(5) }] });
    await run({ model: "opus", start: NOW - 2 * H, end: NOW - H, tokens: each(1) });
    pt = today(await usage());
    expect([pt.weighted, pt.unknown]).toEqual([105 + 20 + 8, 0]);
    const page = await ok(owner, { op: "project", project: "helix" });
    expect(page.other_runs.map((r) => r.weighted).sort((a, b) => a - b)).toEqual([8, 20, 105]);
    expect(page.usage.points.at(-1)).toEqual(pt);
  });

  it("drops models that don't add up to the run's tokens, a lost run's, and adds up one named twice; a run in a session weighs by them too (BOB-173)", async () => {
    await project("helix", "LAND");
    const s: SessionRef = { feature: await feature("helix", "Roadmap"), kind: "build", label: "1" };
    await run({ session: s, model: "opus", start: NOW - 2 * H, end: NOW - H, tokens: each(10), models: [{ model: "claude-haiku-5-5", tokens: each(9) }] });
    await run({ role: "other", model: "opus", start: NOW - 2 * H, end: NOW - H, tokens: each(0), outcome: "lost", models: [{ model: "claude-haiku-5-5", tokens: each(0) }] });
    const twice = await run({ session: s, role: "reviewer", model: null, start: NOW - 2 * H, end: NOW - H, tokens: each(10), models: [{ model: "claude-opus-5-5", tokens: each(4) }, { model: "claude-opus-5-5", tokens: each(6) }] });
    const got = (await ok(owner, { op: "get", project: "helix", session: s })).session!;
    expect(got.runs.map((r) => [r.weighted, r.unknown])).toEqual([[80, 0], [80, 0]]);
    const rows = await runInDurableObject(board(), (_, state) => state.storage.sql.exec<{ id: string; model: string; input: number }>("SELECT r.id, m.model, m.input FROM run_models m JOIN runs r ON r.pk = m.run").toArray().map((r) => ({ ...r })));
    expect(rows).toEqual([{ id: twice, model: "claude-opus-5-5", input: 10 }]);
  });

  it("reads its runs by named columns, without their context per call (BOB-192)", () => {
    expect(USAGE_RUNS_SQL).not.toMatch(/\*|\bctx\b/);
  });
});

const day = (op: Omit<Extract<BoardOpInput, { op: "usage_day" }>, "op" | "project"> & { project?: string }, caller: BoardCaller = owner) =>
  ok(caller, { op: "usage_day", project: "helix", ...op });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const DAY = 24 * H;

describe("the usage_day read (ADR 0014 §3a, BOB-170)", () => {
  it("gives a day with two roles each role's runs in start order with their first call, and lists roles most calls first", async () => {
    await fixedClock();
    await project("helix", "LAND");
    const s: SessionRef = { feature: await feature("helix", "Usage"), kind: "build", label: "1" };
    const b2 = await run({ role: "builder", session: s, model: "opus", start: NOW - 2 * H, end: NOW - H, calls: 3, ctx: [5, 6, 7] });
    const r1 = await run({ role: "reviewer", start: NOW - 4 * H, end: NOW - 3 * H, calls: 2, ctx: [9, 10] });
    const b1 = await run({ role: "builder", session: s, model: "opus", start: NOW - 5 * H, end: NOW - 4 * H, calls: 2, ctx: [1, 2], resumed: true });
    await run({ role: "builder", start: NOW - 30 * H, end: NOW - 29 * H, calls: 2, ctx: [3, 4] });
    const d = await day({ day: "2026-11-22" });
    expect([d.project, d.day, d.days.length, d.days.at(-1), d.lost]).toEqual(["helix", "2026-11-22", 30, "2026-11-22", 0]);
    expect(d.runs.map((r) => [r.id, r.role, r.first, r.ctx])).toEqual([
      [b1, "builder", 1, { calls: 2, pts: [1, 2] }],
      [r1, "reviewer", 1, { calls: 2, pts: [9, 10] }],
      [b2, "builder", 1, { calls: 3, pts: [5, 6, 7] }],
    ]);
    expect(d.runs[0]).toMatchObject({ agent: "Builder", session: s, model: "opus", resumed: true, started_at: iso(NOW - 5 * H), ended_at: iso(NOW - 4 * H) });
    expect(d.runs[1]).toMatchObject({ session: null, model: null, resumed: false });
    expect(d.baseline.roles.map((r) => [r.role, r.runs])).toEqual([
      ["builder", 3],
      ["reviewer", 1],
    ]);
    // Fewer than 3 days with calls: no Total baseline yet.
    expect(d.baseline.total).toEqual({ days: 2, calls: 0, p50: { calls: 0, pts: [] } });
  });

  it("splits a run from 22:00 to 02:00 in tz: 2 h of its calls and points to each day, the second day from the next call", async () => {
    await fixedClock();
    await project("helix", "LAND");
    // 22:00 to 02:00 in Copenhagen, which is UTC+1 in November.
    const start = Date.parse("2026-11-21T21:00:00.000Z");
    const id = await run({ start, end: start + 4 * H, calls: 8, ctx: range(1, 8) });
    const first = await day({ day: "2026-11-21", tz: "Europe/Copenhagen" });
    const second = await day({ day: "2026-11-22", tz: "Europe/Copenhagen" });
    expect(first.runs.map((r) => [r.id, r.first, r.ctx])).toEqual([[id, 1, { calls: 4, pts: [1, 2, 3, 4] }]]);
    expect(second.runs.map((r) => [r.id, r.first, r.ctx])).toEqual([[id, 5, { calls: 4, pts: [5, 6, 7, 8] }]]);
    // In UTC the same run is 21:00 to 01:00: three hours, then one.
    expect((await day({ day: "2026-11-22" })).runs.map((r) => [r.first, r.ctx.calls])).toEqual([[7, 2]]);
  });

  it("takes a role's baseline call by call over its runs in the period, each from its own first call, and stops where only two reach", async () => {
    await fixedClock();
    await project("helix", "LAND");
    for (const [i, [calls, v]] of ([[10, 10], [8, 20], [6, 30], [4, 40]] as const).entries()) {
      await run({ role: "builder", start: NOW - (i + 1) * DAY, end: NOW - (i + 1) * DAY + H, calls, ctx: new Array<number>(calls).fill(v) });
    }
    await run({ role: "builder", start: NOW - 2 * H, end: NOW - H, calls: 1, ctx: [99] });
    const b = (await day({ day: "2026-11-22" })).baseline.roles;
    expect(b.map((r) => [r.role, r.runs])).toEqual([["builder", 5]]);
    // Calls 1: 99, 40, 30, 20, 10; calls 2-4: 40, 30, 20, 10; calls 5-6: 30, 20, 10; call 7 only two reach.
    expect(b[0]!.p50).toEqual({ calls: 6, pts: [30, 25, 25, 25, 20, 20] });
    expect(b[0]!.p25).toEqual({ calls: 6, pts: [20, 18, 18, 18, 15, 15] });
    expect(b[0]!.p75).toEqual({ calls: 6, pts: [40, 33, 33, 33, 25, 25] });
    // The role's median day over the 30: most days it made no calls.
    expect(b[0]!.calls).toBe(0);
  });

  it("takes the Total baseline over the period's days, each summed as it goes: with 10, 20 and 30 calls it stops after 10 (Toad, c_6590696d)", async () => {
    await fixedClock();
    await project("helix", "LAND");
    for (const [i, calls] of [10, 20, 30].entries()) await run({ start: NOW - i * DAY - 2 * H, end: NOW - i * DAY - H, calls, ctx: new Array<number>(calls).fill(i + 1) });
    const d = await day({ day: "2026-11-21", days: 3 });
    // Call k: the days sum to k, 2k and 3k; the median is 2k. Call 11 is reached by two days only.
    expect(d.baseline.total).toEqual({ days: 3, calls: 20, p50: { calls: 10, pts: range(1, 10).map((k) => 2 * k) } });
    expect((await day({ day: "2026-11-21", days: 5 })).baseline.total.calls).toBe(10);
  });

  it("sends a run over 2000 calls as at most 2000 points with its true calls, and counts a lost run without drawing it", async () => {
    await fixedClock();
    await project("helix", "LAND");
    await run({ start: NOW - 3 * H, end: NOW - 2 * H, calls: 5000, ctx: range(1, 2000) });
    await run({ start: NOW - 2 * H, end: NOW - H, calls: 0, outcome: "lost" });
    const d = await day({ day: "2026-11-22" });
    expect(d.runs).toHaveLength(1);
    expect(d.runs[0]!.ctx.calls).toBe(5000);
    expect(d.runs[0]!.ctx.pts).toHaveLength(2000);
    expect([d.runs[0]!.ctx.pts[0], d.runs[0]!.ctx.pts.at(-1)]).toEqual([1, 2000]);
    expect(d.lost).toBe(1);
    expect(d.baseline.roles[0]!.p50.calls).toBe(0);
  });

  it("refuses a project the caller can't read, and a day outside the period", async () => {
    await fixedClock();
    await project("helix", "LAND");
    await project("bobnet", "BOB");
    await ok(owner, { op: "grant", project: "helix", agent: "Data", role: "dev", read: true, items: "none", fields: [] });
    const data: BoardCaller = { kind: "agent", name: "Data", laptop: "mbp-1", supervisor: false, ctx: null };
    expect((await day({ day: "2026-11-22" }, data)).runs).toEqual([]);
    expect(await call(data, { op: "usage_day", project: "bobnet", day: "2026-11-22" })).toMatchObject({ ok: false, code: "forbidden" });
    for (const d of ["2026-11-23", "2026-10-23"]) expect(await call(owner, { op: "usage_day", project: "helix", day: d })).toMatchObject({ ok: false, code: "invalid" });
    expect((await day({ day: "2026-10-24" })).day).toBe("2026-10-24");
    expect(await call(owner, { op: "usage_day", project: "helix", day: "2026-11-21", days: 1 })).toMatchObject({ ok: false, code: "invalid" });
  });
});
