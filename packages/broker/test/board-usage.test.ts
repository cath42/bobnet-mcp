import type { BoardCaller, BoardCtx, BoardOpInput, BoardReply, BoardResults, SessionRef, TokenTotals } from "@bobnet/protocol";
import { USAGE_WEIGHTS } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { BoardStore } from "../src/board/store.ts";

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
});
