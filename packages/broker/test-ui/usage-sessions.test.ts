import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { click, iso, open, project, report, settle, snapshot, text, tok, view, worker, world, type Op } from "./page.ts";

// Usage, from a session's bar to its agents (BOB-211, design/BOB-211/spec.md), on a fake broker's `usage` and `get`.

const BOBNET = project("bobnet", "BobNet", "BOB"), HELIX = project("helix", "Helix", "LAND");
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (back: number) => {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const span = (n: number) => Array.from({ length: n }, (_, i) => dayOf(n - 1 - i));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const date = (d: string) => new Date(`${d}T00:00:00`);
const word = (d: string) => `${WD[date(d).getDay()]} ${date(d).getDate()} ${MON[date(d).getMonth()]}`;

const weights = {
  read_at: "2026-11-22",
  rows: [
    { model: "claude-sonnet-5-5", alias: "sonnet", input: 1, output: 1, cache_read: 1, cache_write: 1 },
    { model: "claude-opus-5-5", alias: "opus", input: 2, output: 2, cache_read: 2, cache_write: 2 },
    { model: "claude-fable-5-1", alias: "fable", input: 5, output: 5, cache_read: 5, cache_write: 5 },
  ],
};
type Pt = Record<string, unknown>;
const ss = (feature: string, kind: string, label: string) => ({ feature, kind, label });
const entry = (session: ReturnType<typeof ss> | null, raw: number, weighted: number) => ({ session, feature_title: session ? `${session.feature}'s title` : null, raw: raw * 1e6, weighted: weighted * 1e6 });
const zero = (): Pt => ({ raw: tok(0), weighted: 0, unknown: 0, calls: 0, by_model: [], by_role: [], top: [] });
/** A day of `raw` and `weighted` million tokens, its `top` as the broker's. */
const day = (raw: number, weighted: number, top: unknown[] = []): Pt => ({ raw: tok(raw * 1e6), weighted: weighted * 1e6, unknown: 0, calls: 10, by_model: [{ model: "claude-opus-5-5", raw: raw * 1e6, weighted: weighted * 1e6 }], by_role: [{ role: "luigi", calls: 10, raw: raw * 1e6, weighted: weighted * 1e6 }], top });
const C = ss("BOB-121", "build", "C"), D = ss("BOB-121", "build", "D"), E = ss("BOB-121", "build", "E"), RE = ss("BOB-121", "review", "E");
/**
 * Five sessions on a day of 74M (163M weighed): C, D and E are the biggest raw; review E, on fable, is second
 * weighed. The broker's `top` is the 3 by raw with the 3 by weighted: work outside any session is in neither.
 */
const busy = () => day(74, 163, [entry(C, 21.6, 43.2), entry(D, 18.1, 36.2), entry(E, 16.3, 32.6), entry(RE, 5, 40)]);
let data: Record<string, Record<number, Pt>>;
const series = (p: { key: string; name: string }, n: number) => ({ project: p.key, name: p.name, lost: 0, points: Array.from({ length: n }, (_, i) => data[p.key]?.[n - 1 - i] ?? day(12, 24)) });
const usage = (op: Op) => ({ weights, tz: op["tz"], days: span(op["days"] as number), projects: [BOBNET, HELIX].filter((p) => !op["project"] || op["project"] === p.key).map((p) => series(p, op["days"] as number)) });

const card = (k: string) => view().querySelector(`.ucard[data-project="${k}"]`)!;
const bar = (k: string, back: number, at: ParentNode = card(k)) => at.querySelector(`.bar[data-day="${dayOf(back)}"]`)!;
/** A bar's parts bottom up: which, and how tall. */
const parts = (b: Element) => [...b.querySelectorAll(".sg")].map((r) => [r.getAttribute("data-sid"), Number(r.getAttribute("height"))] as const);
const weigh = (label: string) => click([...view().querySelectorAll(".seg.weigh button")].find((b) => b.textContent === label));

beforeAll(() => {
  Object.assign(world.reads, {
    projects: () => ({ projects: [BOBNET, HELIX] }),
    overview: () => ({ projects: [] }),
    waits: () => ({ waits: [], answered: [] }),
    status: (op: Op) => ({ at: iso(0), since: op["since"], projects: [] }),
    usage,
  });
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  world.laptops = [];
  data = { bobnet: { 3: busy() }, helix: { 2: zero() } };
});

describe("a day's bar in its sessions (BOB-215)", () => {
  it("stacks the 3 biggest by the figure shown and the rest, which add up to the bar under both switches; the switch re-ranks them (AC1)", async () => {
    await open("#usage");
    const b = bar("bobnet", 3), whole = () => Number(b.querySelector(".b")!.getAttribute("height"));
    expect(parts(b).map(([id]) => id)).toEqual(["BOB-121/build/C", "BOB-121/build/D", "BOB-121/build/E", "rest"]);
    const sum = (b: Element) => parts(b).reduce((n, [, hgt]) => n + hgt, 0);
    expect(sum(b)).toBeCloseTo(whole(), 6);
    // The rest is the day's 74M less the three's 56M.
    const [c, , , rest] = parts(b);
    expect(rest![1] / c![1]).toBeCloseTo(18 / 21.6, 6);
    expect([...b.querySelectorAll(".sg")].map((r) => r.getAttribute("fill-opacity"))).toEqual(["1", "0.68", "0.46", "0.26"]);
    await weigh("Sonnet-equivalent");
    const w = bar("bobnet", 3);
    expect(parts(w).map(([id]) => id)).toEqual(["BOB-121/build/C", "BOB-121/review/E", "BOB-121/build/D", "rest"]);
    expect(sum(w)).toBeCloseTo(Number(w.querySelector(".b")!.getAttribute("height")), 6);
    expect(parts(w)[3]![1] / parts(w)[0]![1]).toBeCloseTo(43.6 / 43.2, 6);
  });

  it("draws work outside any session among the three as its own part; the rest never below 0, and none when the three are the day (AC1)", async () => {
    // The read rounds each entry: the three come to a token more than the day.
    data["bobnet"]![5] = day(10, 20, [entry(C, 6, 12), entry(null, 3, 6), { ...entry(D, 1, 2), raw: 1e6 + 1 }]);
    const app = await open("#usage");
    expect(parts(bar("bobnet", 5)).map(([id]) => id)).toEqual(["BOB-121/build/C", "none", "BOB-121/build/D"]);
    expect(bar("bobnet", 5).querySelector(".sg.none")!.getAttribute("fill-opacity")).toBeNull();
    const dayParts = app["dayParts"] as (pt: Pt) => Array<{ id: string; v: number; rest?: boolean }>;
    expect(dayParts(data["bobnet"]![5]!).map((p) => [p.id, p.v])).toEqual([["BOB-121/build/C", 6e6], ["none", 3e6], ["BOB-121/build/D", 1e6 + 1]]);
    // Five sessions: three and the rest.
    const five = day(20, 40, [entry(C, 5, 10), entry(D, 4, 8), entry(E, 3, 6), entry(RE, 2, 4), entry(ss("BOB-9", "build", "A"), 1, 2)]);
    expect(dayParts(five).map((p) => [p.id, p.v])).toEqual([["BOB-121/build/C", 5e6], ["BOB-121/build/D", 4e6], ["BOB-121/build/E", 3e6], ["rest", 8e6]]);
    expect(dayParts(day(1, 2, [{ ...entry(C, 1, 2), raw: 1e6 + 2 }])).map((p) => p.id)).toEqual(["BOB-121/build/C"]);
    // A day with no session named is all the rest; one with nothing has no part.
    expect(parts(bar("bobnet", 6)).map(([id]) => id)).toEqual(["rest"]);
    expect(parts(bar("helix", 2))).toEqual([]);
  });

  it("keeps the bar's colour, spike and today's look; its label names the parts (AC2)", async () => {
    data["bobnet"]![3] = day(124.4, 248.8, [entry(C, 21.6, 43.2), entry(D, 18.1, 36.2), entry(E, 16.3, 32.6)]);
    await open("#usage");
    const b = bar("bobnet", 3);
    expect(b.classList.contains("spike")).toBe(true);
    expect(b.getAttribute("aria-label")).toBe(`${word(dayOf(3))}: 124.4M tokens, a spike; BOB-121 build C 21.6M, BOB-121 build D 18.1M, BOB-121 build E 16.3M`);
    expect(bar("bobnet", 0).classList.contains("today")).toBe(true);
    data["bobnet"]![4] = day(10, 20, [entry(null, 4, 8)]);
    await open("#usage");
    expect(bar("bobnet", 4).getAttribute("aria-label")).toBe(`${word(dayOf(4))}: 10.0M tokens; outside any session 4.0M`);
  });

  it("names a running worker's declared session on today's bar, so far; one that declared none is the rest (§3)", async () => {
    data["bobnet"]![0] = day(8, 16, [entry(C, 8, 16)]);
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([
      worker({ id: "w_1", project: "bobnet", session: "BOB-211 build A", tokens: tok(12e6), started_at: iso(0) }),
      worker({ id: "w_2", project: "bobnet", session: null, tokens: tok(1e6), started_at: iso(0) }),
    ]) }];
    await open("#usage");
    expect(parts(bar("bobnet", 0)).map(([id]) => id)).toEqual(["BOB-211/build/A", "BOB-121/build/C", "rest"]);
    expect(bar("bobnet", 0).getAttribute("aria-label")).toBe(`${word(dayOf(0))}, so far: 21.0M tokens; BOB-211 build A 12.0M, BOB-121 build C 8.0M`);
    report("mbp-1", snapshot([worker({ id: "w_1", project: "bobnet", session: "BOB-121 build C", tokens: tok(12e6), started_at: iso(0) })]));
    await settle();
    expect(bar("bobnet", 0).getAttribute("aria-label")).toBe(`${word(dayOf(0))}, so far: 20.0M tokens; BOB-121 build C 20.0M`);
  });

  it("draws the same parts on the project page's small graph (AC3)", async () => {
    Object.assign(world.reads, { project: (op: Op) => ({ project: op["project"] === "bobnet" ? BOBNET : HELIX, release: null, done_unclosed: [], waits: [], backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false }, ci: [], sessions: [], other_runs: [], usage: {}, more: {} }), list: () => ({ items: [], total: 0, cursor: null }) });
    await open("#project/bobnet");
    const small = view().querySelector(".puse")!;
    expect(parts(bar("bobnet", 3, small)).map(([id]) => id)).toEqual(["BOB-121/build/C", "BOB-121/build/D", "BOB-121/build/E", "rest"]);
    expect(text(".puse h3")).toMatch(/tokens, 14 days$/);
  });
});
