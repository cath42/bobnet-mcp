import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { changed, click, go, iso, key, open, project, refuse, reply, report, sent, settle, snapshot, text, texts, tok, view, worker, world, type Op } from "./page.ts";

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
 * Five sessions on a day of 74M (163M weighed): builds C and D and review E are the biggest raw; build E is fourth
 * raw and weighed. The broker's `top` is the 3 by raw with the 3 by weighted: work outside any session is in neither.
 */
const busy = () => day(74, 163, [entry(C, 21.6, 43.2), entry(D, 18.1, 36.2), entry(RE, 16.3, 40), entry(E, 5, 10)]);
let data: Record<string, Record<number, Pt>>;
const series = (p: { key: string; name: string }, n: number) => ({ project: p.key, name: p.name, lost: 0, points: Array.from({ length: n }, (_, i) => data[p.key]?.[n - 1 - i] ?? day(12, 24)) });
const usage = (op: Op) => ({ weights, tz: op["tz"], days: span(op["days"] as number), projects: [BOBNET, HELIX].filter((p) => !op["project"] || op["project"] === p.key).map((p) => series(p, op["days"] as number)) });

const card = (k: string) => view().querySelector(`.ucard[data-project="${k}"]`)!;
const bar = (k: string, back: number, at: ParentNode = card(k)) => at.querySelector(`.bar[data-day="${dayOf(back)}"]`)!;
/** A bar's parts bottom up: which, and how tall. */
const parts = (b: Element) => [...b.querySelectorAll(".sg")].map((r) => [r.getAttribute("data-sid"), Number(r.getAttribute("height"))] as const);
const weigh = (label: string) => click([...view().querySelectorAll(".seg.weigh button")].find((b) => b.textContent === label));
const spanOf = (label: string) => click([...view().querySelectorAll(".u-bar .seg button")].find((b) => b.textContent === label));
const short = (d: string) => `${date(d).getDate()} ${MON[date(d).getMonth()]}`;
/** A mouse (fine, with hover) or a finger: what `(hover: hover) and (pointer: fine)` says. */
const pointing = (fine: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: fine && q.includes("pointer: fine"), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
};
const fire = (el: Element | null | undefined, type: string, over: Record<string, unknown> = {}) => el!.dispatchEvent(Object.assign(new Event(type, { bubbles: type === "click" }), over));
const focused = () => document.activeElement!.getAttribute("data-fk");

// BOB-121's sessions, as its feature's read has them: review E is Daisy's two runs, Mario's and Toad's, one of Toad's lost.
type Run = Record<string, unknown>;
const ctx = (n: number, from: number, by: number) => Array.from({ length: n }, (_, i) => from + i * by);
const brun = (id: string, agent: string, raw: number, weighted: number, pts: number[], at: number, over: Run = {}): Run => ({
  id, agent, role: agent.toLowerCase(), laptop: "mbp-1", model: "opus", effort: "high", started_at: iso(at), ended_at: iso(at - 10), resumed: false,
  tokens: tok(raw * 1e6), calls: pts.length, ctx: pts, remote_url: null, tasks: [], outcome: "done", outcome_reason: null, weighted: weighted * 1e6, unknown: 0, ...over,
});
const record = (ref: ReturnType<typeof ss>, from: number, to: number | null, runs: Run[]) => ({
  ...ref, started_at: iso(from), ended_at: to === null ? null : iso(to), imported: false, close: null, tasks_moved: [],
  tokens: tok(runs.reduce((n, r) => n + (r["tokens"] as { input: number }).input, 0)), weighted: runs.reduce((n, r) => n + (r["weighted"] as number), 0), unknown: 0, runs, ci_runs: [],
});
let sessions: ReturnType<typeof record>[];
const reviewE = () => record(RE, 6000, 100, [
  brun("re1", "Daisy", 4, 8, ctx(5, 10e3, 10e3), 6000, { outcome: "stopped", outcome_reason: "by the orchestrator" }),
  brun("re2", "Mario", 6.3, 12.6, ctx(4, 30e3, 10e3), 5000),
  brun("re3", "Daisy", 3.2, 6.4, ctx(3, 12e3, 12e3), 3000),
  brun("re4", "Toad", 2.5, 15, ctx(2, 50e3, 50e3), 2000, { model: "fable" }),
  brun("re5", "Toad", 0, 0, [], 1000, { model: null, outcome: "lost", outcome_reason: "ubu1 restarted mid-run" }),
]);
const feature = (op: Op) => {
  if (op["session"]) {
    const want = op["session"] as ReturnType<typeof ss>;
    return { session: sessions.find((x) => x.feature === want.feature && x.kind === want.kind && x.label === want.label) ?? refuse("No such session") };
  }
  return { item: { ref: op["ref"], kind: "feature", type: "increment", status: "In Progress", title: `${op["ref"]}'s title`, sessions: sessions.filter((x) => x.feature === op["ref"]).map(({ feature, kind, label, started_at, ended_at }) => ({ feature, kind, label, started_at, ended_at })) }, history: [] };
};
/** The panel's spend rows: who, and the figure. */
const spend = (k = "bobnet") => [...card(k).querySelectorAll(".sp-row")].map((r) => [text(".who", r), text(".v", r)]);
const panel = (k = "bobnet") => card(k).querySelector(".sp");
const row = (id: string, k = "bobnet") => card(k).querySelector(`.u-s[data-fk="ss/${k}/${id}"]`);
const lines = (k = "bobnet") => [...card(k).querySelectorAll(".sp polyline.ln")].map((l) => [l.getAttribute("data-agent"), l.getAttribute("points")!.trim().split(" ").length, l.getAttribute("stroke")]);
const pick = (label: string, k = "bobnet") => click([...card(k).querySelectorAll(".sp-pick button")].find((b) => b.textContent === label));
/** The context graph's tip at a call, by keyboard. */
const tipAt = async (k: string, keyName: string) => {
  const svg = card(k).querySelector(".sp svg") as unknown as HTMLElement;
  svg.focus();
  await key(svg, keyName);
  return text(".sp .tip", card(k));
};

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
  pointing(false);
  sessions = [
    record(ss("BOB-121", "review", "C"), 10000, 9900, [brun("rc1", "Daisy", 1, 2, ctx(4, 20e3, 10e3), 10000)]),
    record(E, 9000, 8900, [brun("be1", "Luigi", 16.3, 32.6, ctx(6, 10e3, 5e3), 9000)]),
    record(ss("BOB-121", "review", "D"), 8000, 7900, [brun("rd1", "Daisy", 1, 2, ctx(3, 25e3, 10e3), 8000), brun("rd2", "Daisy", 1, 2, ctx(5, 15e3, 5e3), 7990), brun("rd3", "Mario", 1, 2, ctx(2, 40e3, 10e3), 7980)]),
    reviewE(),
  ];
  world.reads["get"] = feature;
  world.reads["list"] = () => ({ items: [], total: 0, cursor: null });
});

describe("a day's bar in its sessions (BOB-215)", () => {
  it("stacks the 3 biggest by the figure shown and the rest, which add up to the bar under both switches; the switch re-ranks them (AC1)", async () => {
    await open("#usage");
    const b = bar("bobnet", 3), whole = () => Number(b.querySelector(".b")!.getAttribute("height"));
    expect(parts(b).map(([id]) => id)).toEqual(["BOB-121/build/C", "BOB-121/build/D", "BOB-121/review/E", "rest"]);
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
    expect(parts(bar("bobnet", 3, small)).map(([id]) => id)).toEqual(["BOB-121/build/C", "BOB-121/build/D", "BOB-121/review/E", "rest"]);
    expect(text(".puse h3")).toMatch(/tokens, 14 days$/);
  });
});

describe("pointing at a part, tapping a day, the keyboard through the parts (BOB-216)", () => {
  const ran = (a: string, b: string) => (date(a).getMonth() === date(b).getMonth() ? `${date(a).getDate()}–${short(b)}` : `${short(a)}–${short(b)}`);

  it("with a mouse, a part's tip names its session, its title, the day's share and the whole session; its parts light up on every day, the rest dim (AC1)", async () => {
    pointing(true);
    data["bobnet"]![4] = day(20, 40, [entry(RE, 8, 16)]);
    await open("#usage");
    const hit = (back: number, id: string) => bar("bobnet", back).querySelector(`.shit[data-sid="${id}"]`);
    fire(hit(3, "BOB-121/review/E"), "pointerenter");
    const tip = card("bobnet").querySelector(".u-tip") as HTMLElement;
    expect(tip.hidden).toBe(false);
    expect([...tip.children].map((c) => c.textContent)).toEqual(["BOB-121 review E", "BOB-121's title", `${word(dayOf(3))}: 16.3M tokens · 22% of the day`, `Named on ${ran(dayOf(4), dayOf(3))}: 24.3M · click for the whole session`, "Click for its agents"]);
    const lit = [...card("bobnet").querySelectorAll(".sg.hl")].map((r) => [r.closest(".bar")!.getAttribute("data-day"), r.getAttribute("data-sid")]);
    expect(lit).toEqual([[dayOf(4), "BOB-121/review/E"], [dayOf(3), "BOB-121/review/E"]]);
    expect(card("bobnet").querySelector(".ugraph")!.classList.contains("dim")).toBe(true);
    // Its native title would say it twice.
    expect(bar("bobnet", 3).querySelector("title")).toBeNull();
    fire(hit(3, "BOB-121/review/E"), "pointerleave");
    expect([tip.hidden, card("bobnet").querySelectorAll(".sg.hl").length, card("bobnet").querySelector(".ugraph")!.classList.contains("dim")]).toEqual([true, 0, false]);
    fire(hit(3, "rest"), "pointerenter");
    expect([...tip.children].map((c) => c.textContent)).toEqual(["The rest", `${word(dayOf(3))}: 18.0M tokens · 24% of the day`, "Smaller sessions, and work outside any. The day's three biggest are named."]);
    expect(card("bobnet").querySelector(".ugraph")!.classList.contains("dim")).toBe(false);
    data["bobnet"]![5] = day(10, 20, [entry(null, 4, 8)]);
    await open("#usage");
    pointing(true);
    fire(bar("bobnet", 5).querySelector('.shit[data-sid="none"]'), "pointerenter");
    expect(texts(".u-tip > *", card("bobnet"))).toEqual(["Outside any session", `${word(dayOf(5))}: 4.0M tokens · 40% of the day`, "Runs that declared no session: fix passes, board moves, consults."]);
  });

  it("before its feature is read it says only what the bars name, a day it fell out of the top missing; once read, the whole session from its runs (BOB-222)", async () => {
    pointing(true);
    // Review E on 5 days back, not in 4 days back's top six, and on 3 days back.
    data["bobnet"]![5] = day(20, 40, [entry(RE, 2, 4)]);
    data["bobnet"]![4] = day(20, 40, [entry(C, 8, 16)]);
    await open("#usage");
    const hit = () => bar("bobnet", 3).querySelector('.shit[data-sid="BOB-121/review/E"]');
    fire(hit(), "pointerenter");
    const named = date(dayOf(5)).getMonth() === date(dayOf(3)).getMonth() ? `${date(dayOf(5)).getDate()}, ${short(dayOf(3))}` : `${short(dayOf(5))}, ${short(dayOf(3))}`;
    expect(texts(".u-tip > *", card("bobnet"))[3]).toBe(`Named on ${named}: 18.3M · click for the whole session`);
    expect(texts(".u-tip > *", card("bobnet")).join(" ")).not.toMatch(/Whole session|days/);
    await click(hit());
    await settle();
    fire(hit(), "pointerenter");
    expect(texts(".u-tip > *", card("bobnet"))[3]).toMatch(/^Whole session: 16\.0M · ran /);
  });

  it("says the whole session as its runs have it once its feature is read, and that it runs", async () => {
    pointing(true);
    sessions[3] = { ...reviewE(), ended_at: null };
    await open(`#usage/bobnet/${dayOf(3)}/BOB-121/review/E`);
    await settle();
    fire(bar("bobnet", 3).querySelector('.shit[data-sid="BOB-121/review/E"]'), "pointerenter");
    const lines = texts(".u-tip > *", card("bobnet"));
    expect(lines[0]).toBe("BOB-121 review E · running");
    expect(lines[3]).toMatch(/^Whole session: 16\.0M so far · ran /);
  });

  it("with a finger on any width, a tablet's too, the day's rows and the panel's × are 44 px (BOB-223)", () => {
    const css = readFileSync(join(import.meta.dirname, "../public/style.css"), "utf8");
    expect(css).toContain("@media (pointer: coarse) { .u-s, .ud-x { min-height: 44px; } .ud-x { min-width: 44px; } }");
    expect(css).toContain(".sp-h h3 .lb { white-space: nowrap; }");
  });

  it("a click on a session's part opens its agents; on the rest it picks the day, as before (AC1)", async () => {
    pointing(true);
    await open("#usage");
    await click(bar("bobnet", 3).querySelector('.shit[data-sid="rest"]'));
    expect([card("bobnet").querySelector(".uday") !== null, panel()]).toEqual([true, null]);
    await click(bar("bobnet", 3).querySelector('.shit[data-sid="BOB-121/review/E"]'));
    expect(panel()!.getAttribute("data-session")).toBe("BOB-121/review/E");
  });

  it("with a finger there are no part targets: a tap picks the day and lists its sessions under the bar (AC2)", async () => {
    await open("#usage");
    expect(card("bobnet").querySelector(".shit")).toBeNull();
    expect(bar("bobnet", 3).querySelector("title")).not.toBeNull();
    await click(bar("bobnet", 3));
    expect(texts(".u-ss .n", card("bobnet"))).toEqual(["BOB-121 build C", "BOB-121 build D", "BOB-121 review E", "The rest"]);
    expect(panel()).toBeNull();
  });

  it("Up and Down go through a focused day's parts, the tip naming each; Enter on a session's opens it, keeping the bar; on the rest it picks the day (AC3)", async () => {
    await open("#usage");
    const b = () => bar("bobnet", 3) as unknown as HTMLElement;
    b().focus();
    await key(b(), "ArrowUp");
    expect(text(".u-tip b", card("bobnet"))).toBe("BOB-121 build C");
    expect([...b().querySelectorAll(".sg")].map((r) => r.classList.contains("kf"))).toEqual([true, false, false, false]);
    for (let i = 0; i < 4; i++) await key(b(), "ArrowUp");
    expect(text(".u-tip b", card("bobnet"))).toBe("The rest");
    await key(b(), "Enter");
    expect([card("bobnet").querySelector(".uday") !== null, panel(), focused()]).toEqual([true, null, `bar/bobnet/${dayOf(3)}`]);
    await key(b(), "ArrowDown");
    expect(text(".u-tip b", card("bobnet"))).toBe("BOB-121 review E");
    await key(b(), "Enter");
    expect([panel()!.getAttribute("data-session"), focused()]).toEqual(["BOB-121/review/E", `bar/bobnet/${dayOf(3)}`]);
    // Left and Right leave the parts.
    await key(b(), "ArrowLeft");
    expect((card("bobnet").querySelector(".u-tip") as HTMLElement).hidden).toBe(true);
  });

  it("has the tip on the project page's small graph too, and no panel there (AC4)", async () => {
    pointing(true);
    Object.assign(world.reads, { project: () => ({ project: BOBNET, release: null, done_unclosed: [], waits: [], backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false }, ci: [], sessions: [], other_runs: [], usage: {}, more: {} }) });
    await open("#project/bobnet");
    const small = view().querySelector(".puse")!;
    fire(bar("bobnet", 3, small).querySelector('.shit[data-sid="BOB-121/build/C"]'), "pointerenter");
    expect(texts(".u-tip > *", small)).toEqual(["BOB-121 build C", "BOB-121's title", `${word(dayOf(3))}: 21.6M tokens · 29% of the day`, `Named on ${short(dayOf(3))}: 21.6M`]);
    await click(bar("bobnet", 3, small).querySelector('.shit[data-sid="BOB-121/build/C"]'));
    expect([view().querySelector(".puse .uday") !== null, view().querySelector(".sp")]).toEqual([true, null]);
  });
});

describe("the picked day's sessions, the bar's key (BOB-217)", () => {
  it("lists a row per part in the bar's order: a session's a button that opens it, pressed while open; the rest and outside any muted, not buttons; pointing or focus lights its parts (AC1)", async () => {
    data["bobnet"]![3] = day(74, 163, [entry(C, 21.6, 43.2), entry(null, 18.1, 36.2), entry(E, 16.3, 32.6)]);
    await open("#usage");
    await click(bar("bobnet", 3));
    const list = card("bobnet").querySelector(".u-ss")!;
    expect(list.getAttribute("aria-label")).toBe(`${word(dayOf(3))}'s sessions, biggest first`);
    expect([...list.children].map((li) => [li.querySelector("button") ? "button" : li.className, text(".n", li)])).toEqual([["button", "BOB-121 build C"], ["u-s quiet", "Outside any session"], ["button", "BOB-121 build E"], ["u-s quiet", "The rest"]]);
    expect([...list.querySelectorAll(".sw")].map((x) => x.className)).toEqual(["sw r0", "sw none", "sw r2", "sw rest"]);
    expect(row("BOB-121/build/C")!.getAttribute("aria-label")).toBe("BOB-121 build C, BOB-121's title: 21.6M tokens");
    fire(row("BOB-121/build/E"), "pointerenter");
    expect([...card("bobnet").querySelectorAll(".sg.hl")].map((r) => r.getAttribute("data-sid"))).toEqual(["BOB-121/build/E"]);
    expect(card("bobnet").querySelector(".ugraph")!.classList.contains("dim")).toBe(true);
    fire(row("BOB-121/build/E"), "pointerleave");
    expect(card("bobnet").querySelectorAll(".sg.hl")).toHaveLength(0);
    fire(row("BOB-121/build/C"), "focus");
    expect([...card("bobnet").querySelectorAll(".sg.hl")].map((r) => r.getAttribute("data-sid"))).toEqual(["BOB-121/build/C"]);
    expect(row("BOB-121/build/E")!.getAttribute("aria-pressed")).toBe("false");
    await click(row("BOB-121/build/E"));
    expect([row("BOB-121/build/E")!.getAttribute("aria-pressed"), panel()!.getAttribute("data-session")]).toEqual(["true", "BOB-121/build/E"]);
    expect(card("bobnet").querySelector(".sg.open")!.getAttribute("data-sid")).toBe("BOB-121/build/E");
    // A tap on the open row closes it.
    await click(row("BOB-121/build/E"));
    expect([panel(), card("bobnet").querySelector(".ud") !== null]).toEqual([null, true]);
  });

  it("marks a running session's row, so far; the project page's rows link to Usage's panel (AC1)", async () => {
    data["bobnet"]![0] = day(8, 16, [entry(C, 8, 16)]);
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([worker({ id: "w_1", project: "bobnet", session: "BOB-211 design A", tokens: tok(12e6), started_at: iso(0) })]) }];
    Object.assign(world.reads, { project: () => ({ project: BOBNET, release: null, done_unclosed: [], waits: [], backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false }, ci: [], sessions: [], other_runs: [], usage: {}, more: {} }) });
    await open("#usage");
    await click(bar("bobnet", 0));
    expect(text(".u-ss li .n", card("bobnet"))).toBe("BOB-211 design A ●");
    expect(text(".uday b", card("bobnet"))).toBe(`${word(dayOf(0))}, so far: 20.0M tokens`);
    await go("#project/bobnet");
    await click(bar("bobnet", 3, view().querySelector(".puse")!));
    expect([...view().querySelectorAll(".puse a.u-s")].map((a) => a.getAttribute("href"))).toEqual([`#usage/bobnet/${dayOf(3)}/BOB-121/build/C`, `#usage/bobnet/${dayOf(3)}/BOB-121/build/D`, `#usage/bobnet/${dayOf(3)}/BOB-121/review/E`]);
  });

  it("says what a bar is in the foot note (AC2; spec §2.9)", async () => {
    await open("#usage");
    expect(texts("#view > p.note").at(-1)).toBe("Each bar is its day's sessions, the biggest at its foot: point at a part, or tap the day, to see which session it is; open one for its agents. A run's tokens are spread over the days it ran; today's include the workers running now, so far.");
  });
});

describe("a session's panel: spend per agent (BOB-218)", () => {
  it("opens with one read of its feature: a row per agent, its runs summed, biggest first; the Session sum is the session's tokens, and its weighed figure (AC1)", async () => {
    await open("#usage");
    await click(bar("bobnet", 3));
    await click(row("BOB-121/review/E"));
    await settle();
    expect(sent("get").filter((f) => f.op!["ref"]).map((f) => f.op!["ref"])).toEqual(["BOB-121"]);
    expect([text(".sp-h .kind", card("bobnet")), text(".sp-h h3", card("bobnet")), card("bobnet").querySelector(".sp-h .ud-x")!.getAttribute("aria-label")]).toEqual(["review", "BOB-121 review E", "Close BOB-121 review E"]);
    expect(card("bobnet").querySelector(".sp-h h3 a")!.getAttribute("href")).toBe("#feature/bobnet/BOB-121");
    // The kind and label kept together, so a phone breaks the head before "running", not inside the name (BOB-223).
    expect(text(".sp-h h3 .lb", card("bobnet"))).toBe("review E");
    expect(texts(".sp-m p", card("bobnet"))).toEqual(["BOB-121's title", expect.stringMatching(/^\w{3} \d+ \w{3} \d\d:\d\d – \w{3} \d+ \w{3} \d\d:\d\d · 3 agents · 5 runs · 1 run lost · 14 calls$/), `16.0M tokens, whole session · ${word(dayOf(3))}: 16.3M of it`]);
    expect(spend()).toEqual([["Daisy opus · 2 runs, 1 stopped", "7.2M"], ["Mario opus · 1 run", "6.3M"], ["Toad fable · 2 runs · tokens unknown for 1 run", "2.5M"]]);
    expect([...card("bobnet").querySelectorAll(".sp-row")].map((r) => r.querySelectorAll(".sp-bar i").length)).toEqual([2, 1, 1]);
    expect(card("bobnet").querySelector(".sp-row .sp-bar i")!.getAttribute("title")).toMatch(/^\d\d:\d\d–\d\d:\d\d · stopped: by the orchestrator · 4\.0M · 5 calls$/);
    expect([...card("bobnet").querySelectorAll(".sp-row")].map((r) => (r as HTMLElement).style.getPropertyValue("--k"))).toEqual(["var(--ag-1)", "var(--ag-2)", "var(--ag-3)"]);
    const rec = reviewE();
    expect(text(".sp-sum", card("bobnet"))).toBe(`Session${(rec.tokens.input / 1e6).toFixed(1)}M`);
    await weigh("Sonnet-equivalent");
    expect(spend()).toEqual([["Toad fable · 2 runs · tokens unknown for 1 run", "15.0M"], ["Daisy opus · 2 runs, 1 stopped", "14.4M"], ["Mario opus · 1 run", "12.6M"]]);
    expect(text(".sp-sum", card("bobnet"))).toBe(`Session${(rec.weighted / 1e6).toFixed(1)}M`);
    expect(text(".sp-tot", card("bobnet"))).toBe(`42.0M Sonnet-equivalent tokens, whole session · ${word(dayOf(3))}: 40.0M of it`);
    // Closed and opened again, it is kept: no read.
    await click(card("bobnet").querySelector(".sp .ud-x"));
    await click(row("BOB-121/review/E"));
    expect(sent("get").filter((f) => f.op!["ref"])).toHaveLength(1);
    expect(spend()[0]).toEqual(["Toad fable · 2 runs · tokens unknown for 1 run", "15.0M"]);
  });

  it("an agent whose every run was lost has its row, tokens unknown, and nothing to pick; an older broker's runs show raw, and say so (AC2)", async () => {
    const rec = reviewE();
    rec.runs = rec.runs.filter((r) => r["id"] !== "re4");
    sessions[3] = rec;
    await open(`#usage/bobnet/${dayOf(3)}/BOB-121/review/E`);
    await settle();
    expect(spend().at(-1)).toEqual(["Toad 1 run", "tokens unknown"]);
    expect(card("bobnet").querySelector(".sp-rows li:last-child button")).toBeNull();
    expect(texts(".sp-pick button", card("bobnet"))).toEqual(["All agents", "Daisy", "Mario"]);
    expect(text(".sp-sum", card("bobnet"))).toBe("Session13.5M");
    for (const r of rec.runs) delete r["weighted"];
    changed("bobnet");
    await settle();
    await weigh("Sonnet-equivalent");
    expect(spend()[0]).toEqual(["Daisy opus · 2 runs, 1 stopped", "7.2M"]);
    expect(text(".sp-m .note", card("bobnet"))).toBe("This session's runs aren't weighed: raw tokens.");
    expect(text(".sp-tot b", card("bobnet"))).toBe("13.5M tokens");
  });

  it("says it is reading, with what the bar knows, and what failed with Retry; the head and × stay (AC2)", async () => {
    delete world.reads["get"];
    await open("#usage");
    await click(bar("bobnet", 3));
    await click(row("BOB-121/review/E"));
    expect(text(".sp-h h3", card("bobnet"))).toBe("BOB-121 review E");
    expect(texts(".sp-m p", card("bobnet"))).toEqual(["BOB-121's title", `${word(dayOf(3))}: 16.3M of it`]);
    expect(text(".sp-frame", card("bobnet"))).toBe("Reading BOB-121 review E's agents…");
    expect((card("bobnet").querySelector(".sp-frame") as HTMLElement).style.minHeight).toMatch(/^\d{3}px$/);
    reply(sent("get").find((f) => f.op!["ref"])!, () => refuse("No"));
    await settle();
    expect(text(".sp-frame", card("bobnet"))).toBe("Couldn't read BOB-121 review E's agents.Retry");
    expect(card("bobnet").querySelector(".sp .ud-x")).not.toBeNull();
    world.reads["get"] = feature;
    await click(card("bobnet").querySelector(".sp-frame button"));
    await settle();
    expect(spend()).toHaveLength(3);
  });

  it("shows tokens only: no currency, cost or price in the panel (AC3)", async () => {
    await open(`#usage/bobnet/${dayOf(3)}/BOB-121/review/E`);
    await settle();
    for (const on of ["Raw tokens", "Sonnet-equivalent"]) {
      await weigh(on);
      expect(panel()!.textContent).not.toMatch(/\$|USD|\bcosts?\b|\bprice/i);
    }
  });

  it("a running session: its badge, so far, now, its laptop's live runs, and the note (AC4)", async () => {
    const design = ss("BOB-211", "design", "A");
    data["bobnet"]![0] = day(8, 16, [entry(C, 8, 16)]);
    sessions.push(record(design, 30, null, [brun("w_d", "Daisy", 0, 0, [], 30, { ended_at: null, outcome: null, calls: 0 })]));
    const live = worker({ id: "w_d", name: "Daisy", role: "daisy", project: "bobnet", session: "BOB-211 design A", tokens: tok(3e6), started_at: iso(30), calls: 3, ctx: [20e3, 30e3, 40e3], ctx_even: true });
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([live]) }];
    await open("#usage");
    await click(bar("bobnet", 0));
    await click(row("BOB-211/design/A"));
    await settle();
    expect(text(".sp-h .badge", card("bobnet"))).toBe("running");
    expect(texts(".sp-m p", card("bobnet"))[1]).toMatch(/ – now · 1 agent · 1 run · 3 calls$/);
    expect(text(".sp-tot", card("bobnet"))).toBe(`3.0M tokens so far, whole session · ${word(dayOf(0))}: 3.0M of it`);
    expect(spend()).toEqual([["Daisy opus · 1 run · running", "3.0M so far"]]);
    expect(text(".sp-live", card("bobnet"))).toBe("Running: Daisy's calls so far, from mbp-1's last report.");
    expect(lines()).toEqual([["Daisy", 3, "var(--ag-1)"]]);
    // Each report moves it, the agent picked staying; an older supervisor's last 400 calls are said, never padded.
    await pick("Daisy");
    report("mbp-1", snapshot([{ ...live, tokens: tok(4e6), calls: 500, ctx: Array.from({ length: 400 }, () => 40e3), ctx_even: undefined }]));
    await settle();
    expect(spend()).toEqual([["Daisy opus · 1 run · running", "4.0M so far"]]);
    expect(card("bobnet").querySelector('.sp-pick [aria-pressed="true"]')!.textContent).toBe("Daisy");
    expect(lines()).toEqual([["Daisy", 400, "var(--ag-1)"]]);
    expect(text(".ud-approx", card("bobnet"))).toBe("The session's line is approximate while Daisy runs: its laptop's supervisor reports only the last 400 calls.");
  });
});

describe("a session's context per call: all agents, or one (BOB-219)", () => {
  it("All agents: a stretch per run in its agent's colour, in start order, summed as the feature page's Whole session; the review before it dashed (AC1, AC4)", async () => {
    await open(`#usage/bobnet/${dayOf(3)}/BOB-121/review/E`);
    await settle();
    expect(text(".sp-ctx h4", card("bobnet"))).toBe("Context, summed call by call");
    expect(texts(".sp-pick button", card("bobnet"))).toEqual(["All agents", "Daisy", "Mario", "Toad"]);
    expect(lines()).toEqual([["Daisy", 5, "var(--ag-1)"], ["Mario", 5, "var(--ag-2)"], ["Daisy", 4, "var(--ag-1)"], ["Toad", 3, "var(--ag-3)"]]);
    expect(card("bobnet").querySelector(".sp polyline.base")!.getAttribute("points")!.split(" ")).toHaveLength(10);
    expect(texts(".sp .key span", card("bobnet"))).toEqual(["Daisy · 8 calls", "Mario · 4 calls", "Toad · 2 calls", "review D · 10 calls"]);
    expect(text(".sp-note", card("bobnet"))).toBe("Every call in the session, its runs in the order they started, with context summed as they go; each stretch is the agent whose call it was. Dashed: review D, the review before it.");
    // The last call carries every call's context: 150k, 180k, 72k and 150k.
    expect(await tipAt("bobnet", "End")).toBe("call 14 · Toad · 552k context summed");
    expect(await tipAt("bobnet", "Home")).toBe("call 1 · Daisy · 10k context summed · review D 25k");
    // A session with none before it says so.
    await go(`#usage/bobnet/${dayOf(3)}/BOB-121/review/C`);
    await settle();
    expect(text(".sp-note", card("bobnet"))).toBe("Every call in the session, its runs in the order they started, with context summed as they go; each stretch is the agent whose call it was. No dashed line: no review on BOB-121 before it.");
  });

  it("picks an agent by the picker or its row, the two in step, again for All: only its runs' calls, with the reset; the band with 3 earlier runs of its role, none with fewer (AC2)", async () => {
    await open(`#usage/bobnet/${dayOf(3)}/BOB-121/review/E`);
    await settle();
    await pick("Daisy");
    expect(text(".sp-ctx h4", card("bobnet"))).toBe("Daisy's context per call");
    expect(lines()).toEqual([["Daisy", 5, "var(--ag-1)"], ["Daisy", 3, "var(--ag-1)"]]);
    expect(card("bobnet").querySelectorAll(".sp .reset")).toHaveLength(1);
    expect(card("bobnet").querySelector(".sp polygon.band")).not.toBeNull();
    expect(card("bobnet").querySelector('.sp-row[aria-pressed="true"] b')!.textContent).toBe("Daisy");
    expect(location.hash).toBe(`#usage/bobnet/${dayOf(3)}/BOB-121/review/E/Daisy`);
    expect(texts(".sp .key span", card("bobnet"))).toEqual(["Daisy · 8 calls", "earlier Daisy runs on BOB-121, middle half", "their median", "a new run starts"]);
    expect(text(".sp-note", card("bobnet"))).toBe("Daisy's 2 runs in the session, one after another; each new run starts again from a small context (dotted). The grey band is the middle half of 3 earlier Daisy runs on BOB-121 at the same call, dashed their median. A line above it carried more context per call than usual.");
    expect(await tipAt("bobnet", "Home")).toBe("call 1 · 10k context · median 20k");
    // Its row again: All agents.
    await click(card("bobnet").querySelector('.sp-row[aria-pressed="true"]'));
    expect([text(".sp-ctx h4", card("bobnet")), card("bobnet").querySelector('.sp-pick [aria-pressed="true"]')!.textContent]).toEqual(["Context, summed call by call", "All agents"]);
    await click([...card("bobnet").querySelectorAll(".sp-row")].find((r) => text("b", r) === "Mario"));
    expect(card("bobnet").querySelector('.sp-pick [aria-pressed="true"]')!.textContent).toBe("Mario");
    expect(lines()).toEqual([["Mario", 4, "var(--ag-2)"]]);
    expect(card("bobnet").querySelector(".sp polygon.band")).toBeNull();
    expect(text(".sp-note", card("bobnet"))).toBe("Mario's run in the session. No band: fewer than 3 earlier Mario runs on BOB-121.");
  });

  it("a click on a stretch picks its agent, as Enter at a call does; the weigh switch changes no context figure; a run with no context is said (AC3)", async () => {
    const rec = reviewE();
    rec.runs.splice(1, 0, brun("re6", "Toad", 0.1, 0.2, [], 5500, { calls: 4 }));
    sessions[3] = rec;
    await open(`#usage/bobnet/${dayOf(3)}/BOB-121/review/E`);
    await settle();
    expect(text(".sp-blank", card("bobnet"))).toBe("Toad's first run has no context recorded.");
    const figures = () => [...card("bobnet").querySelectorAll(".sp svg polyline, .sp svg text")].map((x) => x.getAttribute("points") ?? x.textContent);
    const before = figures();
    await weigh("Sonnet-equivalent");
    expect(figures()).toEqual(before);
    expect(text(".sp .ud-raw", card("bobnet"))).toBe("Context is raw tokens: weighing applies to the bars.");
    // Call 1 is Daisy's.
    fire(card("bobnet").querySelector(".sp rect.hit"), "click", { clientX: 46 });
    await settle(20);
    expect(card("bobnet").querySelector('.sp-pick [aria-pressed="true"]')!.textContent).toBe("Daisy");
    await pick("All agents");
    const svg = card("bobnet").querySelector(".sp svg") as unknown as HTMLElement;
    svg.focus();
    await key(svg, "End");
    await key(svg, "Enter");
    expect([card("bobnet").querySelector('.sp-pick [aria-pressed="true"]')!.textContent, focused()]).toEqual(["Toad", "ctx/bobnet/Toad"]);
  });
});

describe("the panel's link, closing and focus (BOB-220)", () => {
  it("a link opens the day, the panel and the agent; closing takes the link back to the day; the filters stay; each part is encoded (AC1)", async () => {
    await open(`#usage/bobnet/${dayOf(3)}/BOB-121/review/E/Daisy?weigh=1`);
    await settle();
    expect([bar("bobnet", 3).getAttribute("aria-pressed"), panel()!.getAttribute("data-session"), text(".sp-ctx h4", card("bobnet"))]).toEqual(["true", "BOB-121/review/E", "Daisy's context per call"]);
    await click(card("bobnet").querySelector(".sp .ud-x"));
    expect(location.hash).toBe(`#usage/bobnet/${dayOf(3)}?weigh=1`);
    const fix = ss("BOB-121", "build", "Fix pass");
    data["bobnet"]![4] = day(10, 20, [entry(fix, 6, 12)]);
    sessions.push(record(fix, 5000, 4900, [brun("f1", "Luigi", 6, 12, ctx(3, 1e3, 1e3), 5000)]));
    await open("#usage");
    await click(bar("bobnet", 4));
    await click(row("BOB-121/build/Fix pass"));
    expect(location.hash).toBe(`#usage/bobnet/${dayOf(4)}/BOB-121/build/Fix%20pass`);
    await settle();
    expect(spend()).toEqual([["Luigi opus · 1 run", "6.0M"]]);
  });

  it("×, a tap on the open row and Escape close it, focusing its row; Escape again closes the day; opening focuses × (AC2)", async () => {
    await open("#usage");
    await click(bar("bobnet", 3));
    await click(row("BOB-121/review/E"));
    expect(focused()).toBe("sp-x/bobnet");
    await click(card("bobnet").querySelector(".sp .ud-x"));
    expect([panel(), focused(), card("bobnet").querySelector(".ud") !== null]).toEqual([null, "ss/bobnet/BOB-121/review/E", true]);
    await click(row("BOB-121/review/E"));
    await click(row("BOB-121/review/E"));
    expect([panel(), focused()]).toEqual([null, "ss/bobnet/BOB-121/review/E"]);
    await click(row("BOB-121/review/E"));
    await settle();
    await key(card("bobnet").querySelector(".sp-row"), "Escape");
    expect([panel(), focused(), card("bobnet").querySelector(".uday") !== null]).toEqual([null, "ss/bobnet/BOB-121/review/E", true]);
    await key(row("BOB-121/review/E"), "Escape");
    expect([card("bobnet").querySelector(".uday"), focused(), location.hash]).toEqual([null, `bar/bobnet/${dayOf(3)}`, "#usage"]);
  });

  it("a span that leaves the day out closes the panel and the day (AC3)", async () => {
    data["bobnet"]![20] = busy();
    await open(`#usage/bobnet/${dayOf(20)}/BOB-121/review/E`);
    await settle();
    expect(panel()).not.toBeNull();
    await spanOf("14 days");
    await settle();
    expect([panel(), card("bobnet").querySelector(".uday"), location.hash]).toEqual([null, null, "#usage?days=14"]);
    await spanOf("30 days");
    await settle();
    expect(panel()).toBeNull();
  });
});
