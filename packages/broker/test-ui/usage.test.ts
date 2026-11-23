import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { $, changed, click, FakeSocket, go, iso, key, open, project, refuse, reply, report, sent, settle, snapshot, text, texts, tok, view, worker, world, type Op } from "./page.ts";

// The Usage page (BOB-180) and a day's detail (BOB-181), on a fake broker's `usage` and `usage_day`.

const BOBNET = project("bobnet", "BobNet", "BOB"), HELIX = project("helix", "Helix", "LAND"), VITALS = project("vitals", "Vitals", "VIT");
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (back: number) => {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const span = (n: number) => Array.from({ length: n }, (_, i) => dayOf(n - 1 - i));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const date = (d: string) => new Date(`${d}T00:00:00`);
const short = (d: string) => `${date(d).getDate()} ${MON[date(d).getMonth()]}`;
const word = (d: string) => `${WD[date(d).getDay()]} ${short(d)}`;

const weights = {
  read_at: "2026-11-22",
  rows: [
    { model: "claude-sonnet-5-5", alias: "sonnet", input: 1, output: 1, cache_read: 1, cache_write: 1 },
    { model: "claude-opus-5-5", alias: "opus", input: 2, output: 2, cache_read: 2, cache_write: 2 },
    { model: "claude-haiku-5-5", alias: "haiku", input: 0.05, output: 0.05, cache_read: 0.1, cache_write: 0.05 },
    { model: "claude-fable-5-1", alias: "fable", input: 5, output: 5, cache_read: 2.5, cache_write: 5 },
    { model: "claude-fable-5-2", alias: null, input: 4, output: 4, cache_read: 2, cache_write: 4 },
  ],
};
type Pt = Record<string, unknown>;
const zero = (): Pt => ({ raw: tok(0), weighted: 0, unknown: 0, calls: 0, by_model: [], by_role: [], top: [] });
/** A day of `m` million tokens on Opus, so twice that weighed. */
const opus = (m: number, over: Pt = {}): Pt => ({ raw: tok(m * 1e6), weighted: m * 2e6, unknown: 0, calls: 10, by_model: [{ model: "claude-opus-5-5", raw: m * 1e6, weighted: m * 2e6 }], by_role: [{ role: "luigi", calls: 10, raw: m * 1e6, weighted: m * 2e6 }], top: [], ...over });
/** Each project's days back from today, as points; the rest zero. */
let data: Record<string, { back: Record<number, Pt>; every?: () => Pt; lost?: number }>;
const series = (p: { key: string; name: string }, n: number) => ({
  project: p.key, name: p.name, lost: data[p.key]?.lost ?? 0,
  points: Array.from({ length: n }, (_, i) => data[p.key]?.back[n - 1 - i] ?? data[p.key]?.every?.() ?? zero()),
});
const usage = (op: Op) => ({ weights, tz: op["tz"], days: span(op["days"] as number), projects: [BOBNET, HELIX, VITALS].filter((p) => !op["project"] || op["project"] === p.key).map((p) => series(p, op["days"] as number)) });
const overviewRow = (p: unknown) => ({ project: p, release: null, release_number: null, open: [], next_ready: null, waits_on_you: null, backlog: { items: 0, bugs: 0, oldest: null }, no_release: null, ci: [] });

const card = (k: string) => view().querySelector(`.ucard[data-project="${k}"]`)!;
const bar = (k: string, back: number) => card(k).querySelector(`.bar[data-day="${dayOf(back)}"]`)!;
const figures = (k: string) => ({ total: text(".u-tot", card(k)), today: text(".u-today", card(k)), bars: [...card(k).querySelectorAll(".bar")].map((b) => b.getAttribute("aria-label")), spikes: text(".u-spike", card(k)), day: text(".uday b", card(k)) });
const weigh = (label: string) => click([...view().querySelectorAll(".seg.weigh button")].find((b) => b.textContent === label));
const spanOf = (label: string) => click([...view().querySelectorAll(".u-bar .seg button")].find((b) => b.textContent === label));

beforeAll(async () => {
  Object.assign(world.reads, {
    projects: () => ({ projects: [BOBNET, HELIX, VITALS] }),
    overview: () => ({ projects: [BOBNET, HELIX, VITALS].map(overviewRow) }),
    waits: () => ({ waits: [], answered: [] }),
    status: (op: Op) => ({ at: iso(0), since: op["since"], projects: [] }),
    usage,
  });
});
beforeEach(() => {
  localStorage.clear();
  world.laptops = [];
  world.reads["usage"] = usage;
  data = {
    // Median 20M; 13 days back is a spike of 84M, 5 days back one under twice it.
    bobnet: { every: () => opus(20), back: { 0: opus(8), 5: opus(39), 13: opus(84.3) }, lost: 1 },
    // Small: median 1M, a spike of 5M, and 3.9M over twice the median but not over 4M.
    helix: { every: () => opus(1), back: { 3: opus(5), 8: opus(3.9) } },
    vitals: { back: {} },
  };
});

describe("the Usage page (BOB-180)", () => {
  it("has one graph per project, all of them with none picked, each its own series and scale (c1; BOB-121 AC11)", async () => {
    await open("#usage");
    expect(texts(".ucard .u-name")).toEqual(["BobNet", "Helix", "Vitals"]);
    expect(view().querySelector(".seg.projects")).toBeNull();
    for (const k of ["bobnet", "helix", "vitals"]) expect(card(k).querySelectorAll(".bar")).toHaveLength(30);
    expect(sent("usage").map((f) => f.op)).toEqual([{ op: "usage", days: 30, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }]);
    // Its own scale: Helix's 5M spike stands higher than BobNet's 20M days, on an axis of its own.
    const axis = (k: string) => texts(".axis text", card(k)).filter((t) => /^[\d.]+(M|k)?$/.test(t));
    expect(axis("bobnet").at(-1)).toBe("100.0M");
    expect(axis("helix").at(-1)).toBe("6.0M");
    const tall = (el: Element) => Number(el.querySelector(".b")!.getAttribute("height"));
    expect(tall(bar("helix", 3))).toBeGreaterThan(3 * tall(bar("bobnet", 2)));
    // A project with no runs has its graph, empty, and 0 for what is 0.
    expect(text(".u-tot", card("vitals"))).toBe("0 tokens, 30 days");
    expect(axis("vitals")).toEqual(["0"]);
  });

  it("switches every number between raw and Sonnet-equivalent; off equals the read's raw; says what is factored (c2; AC12)", async () => {
    await open("#usage");
    await click(bar("bobnet", 13));
    const raw = figures("bobnet");
    // 27 days of 20, then 8, 39 and 84.3.
    expect(raw).toMatchObject({ total: "671.3M tokens, 30 days", today: "today so far 8.0M · median day 20.0M", spikes: `1 spike over twice the median day: ${short(dayOf(13))} 84.3M`, day: `${word(dayOf(13))}: 84.3M tokens` });
    expect(text(".u-says p")).toBe("Raw tokens: input, output, cache reads and writes as reported, every model counted the same.");
    await weigh("Sonnet-equivalent");
    const on = figures("bobnet");
    expect(on).toMatchObject({ total: "1.34B Sonnet-equivalent tokens, 30 days", today: "today so far 16.0M · median day 40.0M", spikes: `1 spike over twice the median day: ${short(dayOf(13))} 168.6M`, day: `${word(dayOf(13))}: 168.6M Sonnet-equivalent tokens` });
    expect(raw.bars.every((b, i) => b !== on.bars[i])).toBe(true);
    expect(on.bars.at(-1)).toBe(`${word(dayOf(0))}, so far: 16.0M Sonnet-equivalent tokens`);
    expect(text(".u-says p")).toBe("Sonnet-equivalent: each model's tokens count at its list-price ratio to Sonnet 5.5 (Opus 5.5 ×2, Haiku 5.5 ×0.05, Fable 5.1 ×5). Effort isn't weighted: higher effort already shows as more tokens. Tokens only, nothing is priced.");
    expect(texts(".factored tbody tr")).toEqual(["Sonnet 5.5 (sonnet)×1×1×1×1", "Opus 5.5 (opus)×2×2×2×2", "Haiku 5.5 (haiku)×0.05×0.05×0.05×0.1", "Fable 5.1 (fable)×5×5×5×2.5", "Fable 5.2×4×4×4×2"]);
    expect(text(".factored .note")).toBe("Ratios of each model's list price to Sonnet 5.5's, per kind of token, read 2026-11-22. Effort is ×1 at every level. A model not in the table counts ×1 and is named under its graph.");
    await weigh("Raw tokens");
    expect(figures("bobnet")).toEqual(raw);
    expect(sent("usage")).toHaveLength(1);
  });

  it("marks a day a spike over twice the median and over 4M, with its value; today lighter; the list's buttons pick the day (c3)", async () => {
    await open("#usage");
    const spikes = (k: string) => [...card(k).querySelectorAll(".bar.spike")].map((b) => b.getAttribute("data-day"));
    expect(spikes("bobnet")).toEqual([dayOf(13)]);
    // 3.9M is over twice Helix's median of 1M, and not over 4M.
    expect(spikes("helix")).toEqual([dayOf(3)]);
    expect(texts(".spike-lab", card("helix"))).toEqual(["5.0M"]);
    expect(spikes("vitals")).toEqual([]);
    expect(card("vitals").querySelector(".u-spike")).toBeNull();
    expect([...card("helix").querySelectorAll(".bar.today")].map((b) => b.getAttribute("data-day"))).toEqual([dayOf(0)]);
    await click(card("helix").querySelector(".u-spike button"));
    expect(bar("helix", 3).classList.contains("sel")).toBe(true);
    expect(text(".uday b", card("helix"))).toBe(`${word(dayOf(3))}: 5.0M tokens`);
    expect(card("bobnet").querySelector(".uday")).toBeNull();
  });

  it("counts an unnamed model's tokens only when there are some; a lost run reads tokens unknown, never 0 (c4)", async () => {
    data["helix"]!.back[2] = opus(1, { unknown: 98e6 });
    await open("#usage");
    expect(text(".u-unk", card("helix"))).toBe("98.0M tokens on an unnamed model, counted at ×1");
    expect(card("bobnet").querySelector(".u-unk")).toBeNull();
    expect(text(".u-lost", card("bobnet"))).toBe("1 run lost, tokens unknown: not counted");
    expect(card("helix").querySelector(".u-lost")).toBeNull();
  });

  it("opens a day's line on a tap and on Enter: its total, its models, its biggest sessions by the switch, linked (c5)", async () => {
    const ss = (feature: string, kind: string, label: string) => ({ feature, kind, label });
    data["helix"]!.back[4] = opus(3, {
      by_model: [{ model: "claude-opus-5-5", raw: 2.4e6, weighted: 4.8e6 }, { model: "claude-haiku-5-5", raw: 5e5, weighted: 25e3 }, { model: "unknown", raw: 1e5, weighted: 1e5 }],
      top: [
        { session: ss("LAND-49", "build", "2"), feature_title: "Audit", raw: 1.4e6, weighted: 7e4 },
        { session: ss("LAND-49", "review", "1"), feature_title: "Audit", raw: 9e5, weighted: 1.8e6 },
        { session: null, feature_title: null, raw: 4e5, weighted: 8e5 },
        { session: ss("LAND-50", "design", "A"), feature_title: "Edit", raw: 1e5, weighted: 2e5 },
      ],
    });
    await open("#usage");
    await key(bar("helix", 4), "Enter");
    expect(text(".uday b", card("helix"))).toBe(`${word(dayOf(4))}: 3.0M tokens`);
    expect(text(".uday .muted", card("helix"))).toBe("opus 2.4M · haiku 500k · unnamed model 100k");
    expect(text(".biggest", card("helix"))).toBe("Biggest: LAND-49 build 2 1.4M, LAND-49 review 1 900k, work outside any session 400k");
    expect([...card("helix").querySelectorAll(".biggest a")].map((a) => a.getAttribute("href"))).toEqual(["#feature/helix/LAND-49", "#feature/helix/LAND-49"]);
    await weigh("Sonnet-equivalent");
    expect(text(".uday .muted", card("helix"))).toBe("opus 4.8M · unnamed model 100k · haiku 25k");
    expect(text(".biggest", card("helix"))).toBe("Biggest: LAND-49 review 1 1.8M, work outside any session 800k, LAND-50 design A 200k");
    // Again lets it go.
    await click(bar("helix", 4));
    expect(card("helix").querySelector(".uday")).toBeNull();
  });

  it("has today's running workers in today's bar, line and total, so far (c5, D5)", async () => {
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([worker({ project: "bobnet", tokens: tok(2e6), started_at: iso(0) })]) }];
    await open("#usage");
    await click(bar("bobnet", 0));
    expect(text(".u-today", card("bobnet"))).toBe("today so far 10.0M · median day 20.0M");
    expect(text(".uday b", card("bobnet"))).toBe(`${word(dayOf(0))}, so far: 10.0M tokens`);
    expect(figures("bobnet").total).toBe("673.3M tokens, 30 days");
  });

  it("reads usage again on board_changed, so today doesn't fall when a worker ends and its run is the board's (c7, 5)", async () => {
    const running = worker({ id: "w_x", project: "bobnet", tokens: tok(2e6), started_at: iso(0) });
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([running]) }];
    await open("#usage");
    expect(text(".u-today", card("bobnet"))).toContain("today so far 10.0M");
    data["bobnet"]!.back[0] = opus(10);
    changed("bobnet");
    report("mbp-1", snapshot([{ ...running, state: "done", ended_at: iso(0) }]));
    await settle();
    expect(sent("usage")).toHaveLength(2);
    expect(text(".u-today", card("bobnet"))).toContain("today so far 10.0M");
    // One while it reads is read again when that ends; one while the page is away, when it is back.
    delete world.reads["usage"];
    changed("helix");
    await settle();
    changed("helix");
    expect(sent("usage")).toHaveLength(3);
    reply(sent("usage").at(-1)!, usage);
    await settle();
    expect(sent("usage")).toHaveLength(4);
    reply(sent("usage").at(-1)!, usage);
    world.reads["usage"] = usage;
    await go("#status");
    changed("bobnet");
    await settle();
    expect(sent("usage")).toHaveLength(4);
    await go("#usage");
    expect(sent("usage")).toHaveLength(5);
  });

  it("takes the median day over the days with raw tokens: a young project's days before it, and days off, are no days to compare with; under three, none and no spike (review D M1; ADR 0014 §3a)", async () => {
    const usual = { 0: 18, 1: 22, 2: 20, 3: 61, 4: 19, 7: 21 };
    data = {
      // Eight days old, two of them off: one spike, and not one per bar.
      bobnet: { back: Object.fromEntries(Object.entries(usual).map(([b, m]) => [b, opus(m)])) },
      // Two days: nothing to compare with, whatever their size.
      helix: { back: { 1: opus(5), 2: opus(90) } },
      // A day that weighs nothing still counts: raw picks the days.
      vitals: { back: { 1: opus(3), 2: opus(5), 3: opus(1, { weighted: 0 }) } },
    };
    await open("#usage");
    expect(figures("bobnet")).toMatchObject({ today: "today so far 18.0M · median day 20.5M", spikes: `1 spike over twice the median day: ${short(dayOf(3))} 61.0M` });
    expect([...card("bobnet").querySelectorAll(".bar.spike")].map((b) => b.getAttribute("data-day"))).toEqual([dayOf(3)]);
    expect(figures("helix")).toMatchObject({ total: "95.0M tokens, 30 days", today: "today so far 0 · median day –", spikes: null });
    expect(card("helix").querySelector(".bar.spike, .spike-lab")).toBeNull();
    expect(text(".u-today", card("vitals"))).toBe("today so far 0 · median day 3.0M");
    await weigh("Sonnet-equivalent");
    expect(text(".u-today", card("bobnet"))).toBe("today so far 36.0M · median day 41.0M");
    expect(text(".u-today", card("helix"))).toBe("today so far 0 · median day –");
    expect(text(".u-today", card("vitals"))).toBe("today so far 0 · median day 6.0M");
    // Today's running workers make it a day with work.
    await weigh("Raw tokens");
    report("mbp-1", snapshot([worker({ id: "w_h", project: "helix", tokens: tok(2e6), started_at: iso(0) })]));
    await settle();
    expect(text(".u-today", card("helix"))).toBe("today so far 2.0M · median day 5.0M");
  });

  it("keeps the hash's other filters when one is set, and takes both from a link (c7, 6)", async () => {
    await open("#usage?days=14&weigh=1");
    expect(card("bobnet").querySelectorAll(".bar")).toHaveLength(14);
    expect(text(".u-tot", card("helix"))).toContain("Sonnet-equivalent tokens, 14 days");
    await weigh("Raw tokens");
    expect(location.hash).toBe("#usage?days=14&weigh=0");
    expect(localStorage.getItem("bobnet.weigh")).toBe("0");
    await spanOf("30 days");
    expect(location.hash).toBe("#usage?days=30&weigh=0");
    await settle();
    expect(card("bobnet").querySelectorAll(".bar")).toHaveLength(30);
  });

  it("says it is reading, and what failed, with Retry; a failed read again keeps what was read", async () => {
    delete world.reads["usage"];
    await open("#usage");
    expect(text(".empty-card")).toBe("Reading usage…");
    reply(sent("usage")[0]!, () => refuse("The board's database isn't answering."));
    await settle();
    expect(text(".banner.down")).toBe("Usage couldn't be readThe board's database isn't answering.Retry");
    expect(view().querySelector(".ucard")).toBeNull();
    await click(view().querySelector(".banner.down button"));
    reply(sent("usage").at(-1)!, usage);
    await settle();
    expect(view().querySelector(".banner.down")).toBeNull();
    expect(view().querySelectorAll(".ucard")).toHaveLength(3);
    changed("bobnet");
    reply(sent("usage").at(-1)!, () => refuse("Gone."));
    await settle();
    expect(text(".banner.down")).toMatch(/^Usage couldn't be readGone\. What shows is from .+\.Retry$/);
    expect(view().querySelectorAll(".ucard")).toHaveLength(3);
  });

  it("keeps the keyboard on a bar over a live frame's redraw", async () => {
    await open("#usage");
    (bar("bobnet", 6) as unknown as HTMLElement).focus();
    report("mbp-1", snapshot([]));
    await settle();
    expect(document.activeElement!.getAttribute("data-fk")).toBe(`bar/bobnet/${dayOf(6)}`);
  });

  it("links an agent on a Backlog.md task to its session's card, not to Usage", () => {
    expect(readFileSync(join(import.meta.dirname, "../public/app.js"), "utf8")).not.toMatch(/location\.hash = .*usage/);
  });

  it("shows tokens only: no currency and no sum, only the two sentences Toad ruled (c6)", async () => {
    const source = readFileSync(join(import.meta.dirname, "../public/app.js"), "utf8");
    const said = source.split("\n").filter((l) => /\bcosts?\b|\bpric(e|es|ed|ing)\b|\bdollars?\b|€|£|\$\d/i.test(l.replace(/\$\{/g, "")));
    expect(said.every((l) => /list-price ratio|list price to Sonnet 5\.5's/.test(l))).toBe(true);
    await open("#usage");
    expect(view().textContent!.replace(/\(.*list-price.*\)|list price/g, "")).not.toMatch(/[$€£]|\bcosts?\b/i);
  });
});

describe("a day's detail (BOB-181)", () => {
  type Line = { calls: number; pts: number[] };
  const line = (n: number, v: number): Line => ({ calls: n, pts: Array.from({ length: n }, () => v) });
  const run = (id: string, role: string, pts: number[], over: Record<string, unknown> = {}) => ({ id, agent: role[0]!.toUpperCase() + role.slice(1), role, session: null, model: "opus", started_at: iso(600), ended_at: iso(500), resumed: false, first: 1, ctx: { calls: pts.length, pts }, ...over });
  const none: Line = { calls: 0, pts: [] };
  /** What `usage_day` has: toad's 2 calls, then luigi's two runs of 3 and 2. */
  let detail: Record<string, unknown>;
  const usageDay = (op: Op) => ({ project: op["project"], day: op["day"], days: span(op["days"] as number), lost: 0, ...detail });
  const ud = (k = "bobnet") => card(k).querySelector(".ud");
  const button = (label: string, k = "bobnet") => [...card(k).querySelectorAll(".ud button")].find((b) => b.textContent === label);
  const points = (sel: string, k = "bobnet") => card(k).querySelector(sel)?.getAttribute("points")?.trim().split(" ").length ?? 0;
  beforeEach(() => {
    world.reads["usage_day"] = usageDay;
    detail = {
      runs: [run("r1", "toad", [10_000, 20_000]), run("r2", "luigi", [30_000, 40_000, 50_000]), run("r3", "luigi", [31_000, 41_000])],
      baseline: {
        total: { days: 25, calls: 286, p50: line(6, 100_000) },
        roles: [{ role: "luigi", runs: 9, calls: 4, p25: line(4, 20_000), p50: line(4, 35_000), p75: line(4, 60_000) }, { role: "toad", runs: 2, calls: 2, p25: none, p50: none, p75: none }],
      },
    };
    data["bobnet"]!.back[4] = opus(20, { calls: 7, by_role: [{ role: "luigi", calls: 5, raw: 1, weighted: 1 }, { role: "toad", calls: 2, raw: 1, weighted: 1 }] });
  });

  it("opens on a tap and on Enter with one usage_day call; Close, a second tap and Escape close it and focus the bar; one open day per card (c1)", async () => {
    await open("#usage");
    await click(bar("bobnet", 4));
    expect(sent("usage_day").map((f) => f.op)).toEqual([{ op: "usage_day", project: "bobnet", day: dayOf(4), days: 30, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }]);
    await settle();
    expect(text(".ud h3")).toBe(`${word(dayOf(4))} in detail`);
    expect(location.hash).toBe(`#usage/bobnet/${dayOf(4)}`);
    const focused = () => document.activeElement!.getAttribute("data-fk");
    // A second tap.
    await click(bar("bobnet", 4));
    expect([ud(), focused(), location.hash]).toEqual([null, `bar/bobnet/${dayOf(4)}`, "#usage"]);
    // Opened again, it is kept: no fetch.
    await key(bar("bobnet", 4), "Enter");
    expect(sent("usage_day")).toHaveLength(1);
    expect(card("bobnet").querySelectorAll(".ud")).toHaveLength(1);
    await click(ud()!.querySelector(`[aria-label="Close ${word(dayOf(4))}'s detail"]`));
    expect([ud(), focused()]).toEqual([null, `bar/bobnet/${dayOf(4)}`]);
    await key(bar("bobnet", 4), "Enter");
    await key(ud()!.querySelector("svg"), "Escape");
    expect([ud(), focused()]).toEqual([null, `bar/bobnet/${dayOf(4)}`]);
    // Another day moves it; another card keeps its own.
    await click(bar("bobnet", 4));
    await click(bar("bobnet", 9));
    await click(bar("helix", 3));
    await settle();
    expect(texts(".ud h3")).toEqual([`${word(dayOf(9))} in detail`, `${word(dayOf(3))} in detail`]);
    expect(sent("usage_day")).toHaveLength(3);
  });

  it("Total: the day's calls and the median day's in the key, the dashed line as long as the baseline; none with too few days (c2)", async () => {
    await open("#usage");
    await click(bar("bobnet", 4));
    await settle();
    expect(text(".k-day")).toBe(`${word(dayOf(4))} · 7 calls`);
    expect(text(".k-med")).toBe("median day · 286 calls");
    expect([points(".ud polyline.day"), points(".ud polyline.base")]).toEqual([7, 6]);
    expect(card("bobnet").querySelector(".ud .band")).toBeNull();
    expect(text(".ud-note")).toBe("Dashed: the median over these 30 days. Total: a day's calls, call by call. By agent: a role's runs at the same call, the band their middle half. A line above it carried more context per call than usual.");
    // The calls graph: the tapped day's dot with its value, today's hollow, the median across.
    expect(texts(".ud .val")).toEqual(["7"]);
    expect(card("bobnet").querySelectorAll(".ud .dot.picked:not(.hollow), .ud .dot.hollow")).toHaveLength(2);
    expect(card("bobnet").querySelector(".ud line.median")).not.toBeNull();
    detail["baseline"] = { total: { days: 2, calls: 7, p50: none }, roles: [] };
    await click(bar("bobnet", 6));
    await settle();
    expect(points(".ud polyline.base")).toBe(0);
    expect(text(".ud-note")).toBe("No dashed line: fewer than 3 days in these 30 to compare with.");
  });

  it("no median day under three days with a call: no dashed calls line, and the key says –; a role only running now takes it from the days it made a call (ADR 0014 §3a, R1)", async () => {
    detail["baseline"] = { total: { days: 2, calls: 0, p50: none }, roles: [] };
    await open("#usage");
    await click(bar("bobnet", 4));
    await settle();
    expect(text(".k-med")).toBe("median day –");
    expect(card("bobnet").querySelector(".ud line.median")).toBeNull();
    expect(card("bobnet").querySelectorAll(".ud figure > svg")[0]!.getAttribute("aria-label")).toBe(`calls per day, the last 30 days; ${word(dayOf(4))} 7 calls`);
    // No run of it ended today, so the read has no baseline for it: the page's own, over its days.
    const luigi = (calls: number) => opus(1, { calls, by_role: [{ role: "luigi", calls, raw: 1, weighted: 1 }] });
    data["helix"] = { back: { 5: luigi(7), 9: luigi(11) } };
    detail = { runs: [], baseline: { total: { days: 2, calls: 0, p50: none }, roles: [] } };
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([worker({ id: "w_l", role: "luigi", project: "helix", started_at: iso(0), calls: 3, ctx: [1000, 2000, 3000], ctx_even: true })]) }];
    await open("#usage");
    await click(bar("helix", 0));
    await settle();
    await click(button("By agent", "helix"));
    expect(text(".k-med", card("helix"))).toBe("median day · 7 calls");
    expect(card("helix").querySelector(".ud line.median")).not.toBeNull();
    delete data["helix"]!.back[9];
    changed("helix");
    await settle();
    expect(text(".k-med", card("helix"))).toBe("median day –");
  });

  it("a call's tip: its context, and the median where the baseline reaches, by pointer and by keyboard (2.9)", async () => {
    await open("#usage");
    await click(bar("bobnet", 4));
    await settle();
    const svg = () => ud()!.querySelector("svg") as unknown as SVGElement & { focus(): void };
    svg().focus();
    // The last call, past the baseline's six.
    expect(text(".ud .tip")).toBe("call 7 · 222k context summed");
    await key(svg(), "Home");
    expect(text(".ud .tip")).toBe("call 1 · 10k context summed · median 100k");
    await click(button("By agent"));
    svg().focus();
    await key(svg(), "ArrowLeft");
    expect(text(".ud .tip")).toBe("call 4 · 31k context · median 35k");
    const at = (x: number) => ud()!.querySelector(".ud-plot rect.hit")!.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: x }));
    at(46);
    expect(text(".ud .tip")).toBe("call 1 · 30k context · median 35k");
    ud()!.querySelector(".ud-plot rect.hit")!.dispatchEvent(new Event("pointerleave"));
    expect((ud()!.querySelector(".tip") as HTMLElement).hidden).toBe(true);
  });

  it("draws live again once Escape or Enter on the bar closes the day under the pointer, and not while its graph is pointed at (Toad, review D M1)", async () => {
    // happy-dom sends a hashchange for replaceState, as no browser does, and that lets go of the graph too.
    const replaced = vi.spyOn(history, "replaceState").mockImplementation(() => {});
    await open("#usage");
    const pointed = () => ud()!.querySelector(".ud-plot rect.hit")!.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: 46 }));
    const drawn = async () => {
      const before = card("bobnet");
      report("mbp-1", snapshot([]));
      await settle();
      return card("bobnet") !== before;
    };
    for (const close of [() => key(ud()!.querySelector("svg"), "Escape"), () => key(bar("bobnet", 4), "Enter")]) {
      await click(bar("bobnet", 4));
      await settle();
      pointed();
      expect(await drawn()).toBe(false);
      await close();
      expect(ud()).toBeNull();
      // Past the frame that waited: the next one draws too.
      await settle();
      expect([await drawn(), await drawn()]).toEqual([true, true]);
    }
    replaced.mockRestore();
  });

  it("By agent: the day's roles, most calls first; one's runs with a break between, its band and its median, named in the note; a role whose runs were all lost isn't there (c3)", async () => {
    detail["lost"] = 2;
    await open("#usage");
    await click(bar("bobnet", 4));
    await settle();
    await click(button("By agent"));
    expect(texts(".ud-roles button")).toEqual(["luigi · 5 calls", "toad · 2 calls"]);
    expect(card("bobnet").querySelector('.ud-roles [aria-pressed="true"]')!.textContent).toBe("luigi · 5 calls");
    expect(text(".k-day")).toBe(`${word(dayOf(4))} · 5 calls`);
    expect(text(".k-med")).toBe("median day · 4 calls");
    expect(text(".k-band")).toBe("luigi's runs, middle half");
    expect([...card("bobnet").querySelectorAll(".ud polyline.day")].map((p) => p.getAttribute("points")!.split(" ").length).slice(0, 2)).toEqual([3, 2]);
    expect(card("bobnet").querySelectorAll(".ud .reset")).toHaveLength(1);
    expect([points(".ud polyline.base"), points(".ud polygon.band")]).toEqual([4, 8]);
    expect(text(".ud-note")).toContain("By agent: luigi's runs at the same call, the band their middle half.");
    expect(texts(".ud .val")).toEqual(["5"]);
    expect(text(".ud .u-lost")).toBe("2 runs lost: no context recorded");
    await click(button("toad · 2 calls"));
    expect(text(".k-day")).toBe(`${word(dayOf(4))} · 2 calls`);
    expect(points(".ud polyline.base")).toBe(0);
    expect(card("bobnet").querySelector(".k-band")).toBeNull();
    expect(text(".ud-note")).toBe("No dashed line: fewer than 3 toad runs in these 30 days.");
    // A redraw keeps the switch and the role.
    report("mbp-1", snapshot([]));
    await settle();
    expect(card("bobnet").querySelector('.ud-roles [aria-pressed="true"]')!.textContent).toBe("toad · 2 calls");
  });

  it("says it is loading with the day line already there, what failed with Retry, and a day with no calls and its lost runs (c4)", async () => {
    delete world.reads["usage_day"];
    await open("#usage");
    await click(bar("bobnet", 4));
    expect(text(".uday b", card("bobnet"))).toBe(`${word(dayOf(4))}: 20.0M tokens`);
    expect(text(".ud-frame")).toBe(`Loading ${word(dayOf(4))}'s calls…`);
    expect((ud()!.querySelector(".ud-frame") as HTMLElement).style.minHeight).toMatch(/^\d{3}px$/);
    // The switch works while it loads.
    await click(button("By agent"));
    expect(button("By agent")!.getAttribute("aria-pressed")).toBe("true");
    reply(sent("usage_day")[0]!, () => refuse("No"));
    await settle();
    expect(text(".ud-frame")).toBe(`Couldn't load ${word(dayOf(4))}'s calls.Retry`);
    detail = { runs: [], baseline: { total: { days: 25, calls: 286, p50: none }, roles: [] }, lost: 1 };
    world.reads["usage_day"] = usageDay;
    await click(button("Retry"));
    await settle();
    expect(text(".ud-frame")).toBe(`No calls on ${word(dayOf(4))}.1 run lost: no context recorded`);
    expect(ud()!.querySelector(".seg")).toBeNull();
    expect(ud()!.querySelector("svg")).toBeNull();
  });

  it("stays through the weigh switch, no figure changed nor fetched; a span that leaves its day out closes it; its link opens it (c5)", async () => {
    await open(`#usage/bobnet/${dayOf(20)}`);
    await settle();
    expect(text(".ud h3", card("bobnet"))).toBe(`${word(dayOf(20))} in detail`);
    const before = ud()!.querySelector("svg")!.outerHTML;
    await weigh("Sonnet-equivalent");
    expect(ud()!.querySelector("svg")!.outerHTML).toBe(before);
    expect(text(".ud-raw")).toBe("Context is raw tokens: weighing applies to the bars.");
    expect(sent("usage_day")).toHaveLength(1);
    expect(location.hash).toBe(`#usage/bobnet/${dayOf(20)}?weigh=1`);
    await spanOf("14 days");
    await settle();
    expect([ud(), card("bobnet").querySelector(".uday"), location.hash]).toEqual([null, null, "#usage?weigh=1&days=14"]);
    // A day still in it is read again for the new period.
    await click(bar("bobnet", 4));
    await spanOf("30 days");
    await settle();
    expect(sent("usage_day").map((f) => f.op!["days"])).toEqual([30, 14, 30]);
    expect(text(".ud h3", card("bobnet"))).toBe(`${word(dayOf(4))} in detail`);
  });

  it("scrolls to the link's card", async () => {
    const scrolled: number[] = [];
    const by = vi.spyOn(window, "scrollBy").mockImplementation(((_x: number, y: number) => void scrolled.push(y)) as never);
    await open(`#usage/helix/${dayOf(3)}`);
    await settle();
    expect(scrolled).toHaveLength(1);
    expect(text(".ud h3", card("helix"))).toBe(`${word(dayOf(3))} in detail`);
    by.mockRestore();
  });

  it("has a running worker's calls and context in today's detail, so far; an older supervisor's makes Total approximate (c6)", async () => {
    detail["runs"] = [run("r1", "toad", [10_000, 20_000])];
    data["bobnet"]!.back[0] = opus(8, { calls: 2, by_role: [{ role: "toad", calls: 2, raw: 1, weighted: 1 }] });
    const live = worker({ id: "w_l", name: "Luigi", role: "luigi", project: "bobnet", started_at: iso(0), calls: 3, ctx: [30_000, 40_000, 50_000], ctx_even: true });
    world.laptops = [{ laptop: "mbp-1", at: iso(0), snapshot: snapshot([live]) }];
    await open("#usage");
    await click(bar("bobnet", 0));
    await settle();
    expect(text(".k-day")).toBe(`${word(dayOf(0))} so far · 5 calls`);
    expect(points(".ud polyline.day")).toBe(5);
    expect(texts(".ud .val")).toEqual(["5"]);
    expect(card("bobnet").querySelector(".ud .dot.picked.hollow")).not.toBeNull();
    expect(card("bobnet").querySelector(".ud-approx")).toBeNull();
    await click(button("By agent"));
    expect(texts(".ud-roles button")).toEqual(["luigi · 3 calls", "toad · 2 calls"]);
    await click(button("Total"));
    report("mbp-1", snapshot([{ ...live, calls: 500, ctx: Array.from({ length: 400 }, () => 40_000), ctx_even: undefined }]));
    await settle();
    expect(text(".ud-approx")).toBe("Total is approximate while Luigi runs: its laptop's supervisor reports only the last 400 calls.");
  });
});
