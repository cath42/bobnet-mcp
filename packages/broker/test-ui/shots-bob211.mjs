// Screenshots of BOB-211 as built (design/BOB-211/spec.md §6): Usage from a session's bar to its agents, at 390 (phone, touch),
// 1024 (tablet, touch) and 1440 (desktop, mouse), against a fake broker in the page whose board is the prototype's data
// (design/BOB-211/prototype/data.js) in the reads' own shapes: `usage`, a feature's `get` and its sessions' `get` with `ctx`,
// and the laptop's report for what runs now. The clock is held at 26 Nov 2026 12:30 in Casper's zone, the data's today.
//   node test-ui/shots-bob211.mjs [prefix]   (from packages/broker; writes test-ui/shots/bob211-*.png)
// Prints any page error, any page wider than its viewport, and at 390 the tap targets under 44 px in the Usage cards.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "../public");
const out = join(here, "shots");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const data = await readFile(join(here, "../../../design/BOB-211/prototype/data.js"), "utf8");

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try {
    const body = await readFile(join(pub, path === "/" ? "index.html" : path));
    res.writeHead(200, { "content-type": types[extname(path || ".html")] ?? "text/html" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

/** Runs in the page: the prototype's data (`src`), and a broker that answers from it. */
function fakeBroker(src) {
  // data.js declares TODAY, SESSIONS, LOOSE and PROJECTS.
  const { TODAY, SESSIONS, LOOSE, PROJECTS, TITLES } = new Function(`${src}; return { TODAY, SESSIONS, LOOSE, PROJECTS, TITLES };`)();
  const MODEL = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" };
  const weights = { read_at: "2026-11-22", rows: [
    { model: "claude-sonnet-5-5", alias: "sonnet", input: 1, output: 1, cache_read: 1, cache_write: 1 },
    { model: "claude-opus-5-5", alias: "opus", input: 2, output: 2, cache_read: 2, cache_write: 2 },
    { model: "claude-haiku-5-5", alias: "haiku", input: 0.05, output: 0.05, cache_read: 0.05, cache_write: 0.05 },
    { model: "claude-fable-5-1", alias: "fable", input: 5, output: 5, cache_read: 5, cache_write: 5 },
  ] };
  const tok = (n) => ({ input: Math.round(n), output: 0, cache_read: 0, cache_write: 0 });
  const two = (n) => String(n).padStart(2, "0");
  const dayOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  /** "Mon 23 Nov 20:13" → its time in this zone (Casper's). */
  const when = (s) => { const [, d, , hm] = s.split(" "); return new Date(`2026-11-${two(Number(d))}T${hm}:00`).getTime(); };
  // A run's context per call, shaped as the prototype shapes it: its calls add up to its context tokens.
  const ctxOf = (r) => {
    let seed = (r.seed || 1) * 9301 + r.calls * 49297;
    const rnd = () => ((seed = (seed * 233280 + 49297) % 2147483647) / 2147483647);
    const raw = Array.from({ length: r.calls }, (_, i) => { const t = r.calls === 1 ? 1 : i / (r.calls - 1); return (0.3 + 1.4 * t ** 0.85) * (0.9 + rnd() * 0.2) + (rnd() < 0.08 ? 0.35 : 0); });
    const sum = raw.reduce((a, b) => a + b, 0);
    return raw.map((v) => Math.round((v / sum) * (r.raw - r.out)));
  };
  // Each run's start and end: its own where data.js has them, else its turn in its session's span.
  let n = 0;
  for (const ss of SESSIONS) {
    const from = when(ss.when[0]), to = ss.when[1] ? when(ss.when[1]) : Date.now(), k = ss.runs.length;
    ss.runs.forEach((r, i) => {
      r.id = `run_${++n}`;
      const days = Object.keys(r.on).sort();
      if (r.start) {
        // "Wed 22:07", or "22:07" on the run's first day; an end before its start is the next day's.
        const at = (s) => { const [w, hm] = s.includes(" ") ? s.split(" ") : [null, s]; return [(w && days.find((d) => WD[new Date(`${d}T00:00:00`).getDay()] === w)) ?? days[0], hm]; };
        const [d0, hm0] = at(r.start);
        r.t0 = new Date(`${d0}T${hm0}:00`).getTime();
        if (r.end) { const hm1 = r.end.split(" ").at(-1); r.t1 = new Date(`${dayOf(r.t0)}T${hm1}:00`).getTime(); if (r.t1 < r.t0) r.t1 += 86_400_000; }
      } else {
        r.t0 = from + ((to - from) * i) / k;
        r.t1 = from + ((to - from) * (i + 1)) / k;
      }
      if (r.live) r.t1 = null;
      r.ctx = ctxOf(r);
    });
  }
  const key = (ss) => `${ss.feature} ${ss.kind} ${ss.label}`;
  const runRecord = (r) => ({ id: r.id, agent: r.agent, role: r.role, laptop: "mbp-1", model: r.model, effort: r.effort, started_at: new Date(r.t0).toISOString(), ended_at: r.t1 ? new Date(r.t1).toISOString() : null,
    resumed: false, tokens: tok(r.live ? 0 : r.raw), calls: r.live ? 0 : r.calls, ctx: r.live ? [] : r.ctx, remote_url: null, tasks: [], outcome: r.live ? null : r.outcome, outcome_reason: r.reason, weighted: r.live ? 0 : r.w, unknown: 0 });
  const record = (ss) => {
    const runs = ss.runs.map(runRecord);
    return { feature: ss.feature, kind: ss.kind, label: ss.label, started_at: new Date(when(ss.when[0])).toISOString(), ended_at: ss.when[1] ? new Date(when(ss.when[1])).toISOString() : null, imported: false, close: null, tasks_moved: [],
      tokens: tok(runs.reduce((a, r) => a + r.tokens.input, 0)), weighted: runs.reduce((a, r) => a + r.weighted, 0), unknown: 0, runs, ci_runs: [] };
  };
  // The board's usage: runs that ended only; what runs now comes from the laptop's report, today's share of it.
  const usage = (op) => {
    const days = Array.from({ length: op.days }, (_, i) => { const d = new Date(`${TODAY}T12:00:00`); d.setDate(d.getDate() - (op.days - 1 - i)); return dayOf(d); });
    const projects = PROJECTS.filter((p) => !op.project || op.project === p.project).map((p) => ({ project: p.project, name: p.name, lost: p.lost, points: days.map((d) => {
      const pt = { raw: 0, weighted: 0, unknown: 0, calls: 0, models: new Map(), roles: new Map(), sessions: [] };
      const add = (map, k, raw, w, calls = 0) => { const e = map.get(k) ?? { raw: 0, weighted: 0, calls: 0 }; e.raw += raw; e.weighted += w; e.calls += calls; map.set(k, e); };
      for (const ss of SESSIONS.filter((x) => x.project === p.project)) {
        let raw = 0, w = 0;
        for (const r of ss.runs) {
          const f = r.on[d] ?? 0;
          if (!f || r.live) continue;
          raw += r.raw * f; w += r.w * f;
          add(pt.models, MODEL[r.model], r.raw * f, r.w * f);
          add(pt.roles, r.role, r.raw * f, r.w * f, Math.round(r.calls * f));
        }
        if (raw) pt.sessions.push({ session: { feature: ss.feature, kind: ss.kind, label: ss.label }, feature_title: TITLES[ss.feature] ?? "", raw: Math.round(raw), weighted: Math.round(w) });
      }
      const loose = (LOOSE[p.project][d] ?? 0) * 1e6;
      if (loose) { pt.sessions.push({ session: null, feature_title: null, raw: loose, weighted: Math.round(loose * 1.6) }); add(pt.models, MODEL.opus, loose * 0.6, loose * 1.2); add(pt.models, MODEL.sonnet, loose * 0.4, loose * 0.4); }
      const raw = pt.sessions.reduce((a, e) => a + e.raw, 0), w = pt.sessions.reduce((a, e) => a + e.weighted, 0);
      const top3 = (f) => [...pt.sessions].sort((a, b) => b[f] - a[f]).slice(0, 3);
      const top = [...new Set([...top3("raw"), ...top3("weighted")])].sort((a, b) => b.raw - a.raw);
      const roles = [...pt.roles].map(([role, e]) => ({ role, calls: e.calls, raw: Math.round(e.raw), weighted: Math.round(e.weighted) }));
      return { raw: tok(raw), weighted: w, unknown: 0, calls: roles.reduce((a, r) => a + r.calls, 0), by_model: [...pt.models].map(([model, e]) => ({ model, raw: Math.round(e.raw), weighted: Math.round(e.weighted) })).sort((a, b) => b.raw - a.raw), by_role: roles, top };
    }) }));
    return { weights, tz: op.tz, days, projects };
  };
  const usageDay = (op) => {
    const runs = SESSIONS.filter((x) => x.project === op.project).flatMap((ss) => ss.runs.filter((r) => r.on[op.day] && !r.live).map((r) => ({ id: r.id, agent: r.agent, role: r.role, session: { feature: ss.feature, kind: ss.kind, label: ss.label }, model: MODEL[r.model], started_at: new Date(r.t0).toISOString(), ended_at: new Date(r.t1).toISOString(), resumed: false, first: 1, ctx: { calls: r.calls, pts: r.ctx } })));
    return { project: op.project, day: op.day, days: [], lost: 0, runs, baseline: { total: { days: 14, calls: 300, p50: { calls: 300, pts: Array.from({ length: 300 }, (_, i) => 60e3 + i * 300) } }, roles: [] } };
  };
  const answer = (op) => {
    switch (op.op) {
      case "projects": return { projects: PROJECTS.map((p) => ({ key: p.project, name: p.name, prefix: p.project === "bobnet" ? "BOB" : "LAND", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] })) };
      case "overview": return { projects: [] };
      case "waits": return { waits: [], answered: [] };
      case "status": return { at: new Date().toISOString(), since: op.since, projects: [] };
      case "list": return op.of === "releases" ? { releases: [], total: 0, cursor: null } : { items: [], total: 0, cursor: null };
      case "usage": return usage(op);
      case "usage_day": return usageDay(op);
      case "project": return { project: { key: op.project, name: PROJECTS.find((p) => p.project === op.project).name }, release: null, done_unclosed: [], waits: [], backlog: { ready: [], sessions_estimate: null, no_criteria: [], triage: { count: 0, oldest: null }, release: null, thin: false }, ci: [], sessions: [], other_runs: [], usage: {}, more: {} };
      case "get": {
        if (op.session) return { session: record(SESSIONS.find((x) => x.feature === op.session.feature && x.kind === op.session.kind && x.label === op.session.label)) };
        const of = SESSIONS.filter((x) => x.feature === op.ref);
        return { item: { ref: op.ref, kind: "feature", type: "increment", status: "In Progress", title: TITLES[op.ref] ?? op.ref, sessions: of.map((ss) => { const r = record(ss); return { feature: r.feature, kind: r.kind, label: r.label, started_at: r.started_at, ended_at: r.ended_at }; }) }, history: [] };
      }
      default: return {};
    }
  };
  // The laptop's report: each run that runs now, with its calls and its context so far.
  const workers = SESSIONS.flatMap((ss) => ss.runs.filter((r) => r.live).map((r) => ({ id: r.id, name: r.agent, project: ss.project, role: r.role, state: "running", task: "t", model: r.model, effort: r.effort, checkpoint: null,
    started_at: new Date(r.t0).toISOString(), ended_at: null, last_event_at: new Date().toISOString(), tokens: tok(r.raw), session: key(ss), task_ref: null, task_refs: [], calls: r.calls, context: r.ctx.at(-1), ctx: r.ctx, ctx_even: true,
    remote_url: null, remote_from: null, remote_by: null })));
  const snapshot = { supervisor: { started_at: new Date(Date.now() - 3 * 3600e3).toISOString(), concurrency: 3, active: workers.length, queued: 0 }, workers, pending: [], usage: [], decided: [] };
  const dashboard = { now: new Date().toISOString(), peers: [], laptops: [{ laptop: "mbp-1", at: new Date().toISOString(), snapshot }], boards: [], traffic: [] };
  class FakeSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      super();
      setTimeout(() => this.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } }));
    }
    frame(f) { this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(f) })); }
    send(raw) {
      const f = JSON.parse(raw);
      if (f.t === "dashboard") setTimeout(() => this.frame({ t: "ok", rid: f.rid, result: dashboard }));
      if (f.t === "board_op") setTimeout(() => this.frame({ t: "ok", rid: f.rid, result: answer(f.op) }), 30);
    }
    close() {}
  }
  window.WebSocket = FakeSocket;
}

const widths = { 390: [390, 844], 1024: [1024, 768], 1440: [1440, 900] };
const bobnet = '.ucard[data-project="bobnet"]';
const re = "usage/bobnet/2026-11-25/BOB-121/review/E";
// With a mouse, point at a part; on a touch screen, tap its day, which names its sessions under the bar.
const point = (day, sid, card = bobnet) => async (p, w) => {
  if (w === "1440") await p.locator(`${card} rect.shit[data-sid="${sid}"]`).first().hover();
  else await p.locator(`${card} g.bar[data-day="${day}"]`).tap();
};
const small = (day, sid) => async (p, w) => {
  if (w === "1440") await p.locator(`.puse rect.shit[data-sid="${sid}"]`).first().hover();
  else await p.locator(`.puse g.bar[data-day="${day}"]`).tap();
};
// [file, hash, steps after load, colour scheme, element to shoot (none: the whole page)]
const shots = [
  ["01-bar-names-its-session", "usage", [point("2026-11-23", "BOB-121/build/E")]],
  ["02-session-build-e", "usage/bobnet/2026-11-23/BOB-121/build/E", []],
  ["03-session-review-e-all-agents", re, []],
  ["04-review-e-daisy", `${re}/Daisy`, []],
  ["05-review-e-mario-no-band", `${re}/Mario`, []],
  ["06-review-e-from-its-bar-on-23-nov", "usage", [async (p, w) => {
    if (w === "1440") await p.locator(`${bobnet} rect.shit[data-sid="BOB-121/review/E"]`).first().hover();
    else { await p.locator(`${bobnet} g.bar[data-day="2026-11-25"]`).tap(); await p.waitForTimeout(150); await p.locator(`${bobnet} button.u-s`, { hasText: "review E" }).tap(); }
  }]],
  ["07-running-session-today", "usage/bobnet/2026-11-26/BOB-211/design/A", []],
  ["08-review-e-weighted", `${re}?weigh=1`, []],
  ["09-review-e-dark", `${re}/Toad`, [], "dark"],
  ["10-helix-fixes-running", "usage/helix/2026-11-26/LAND-50/build/Fixes", []],
  // The project page's small graph: its parts, and the tip with a mouse (BOB-215 AC3, BOB-216 AC4).
  ["11-project-page-small-graph", "project/bobnet", [small("2026-11-23", "BOB-121/build/E")], null, ".puse"],
];

const only = process.argv[2];
const taps = new Map();
const browser = await chromium.launch();
let errors = 0;
try {
  for (const [file, hash, after, scheme, el] of shots.filter(([f]) => !only || f.startsWith(only))) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      const touch = width < 1200;
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme ?? "light", isMobile: touch, hasTouch: touch, timezoneId: "America/Chicago" });
      const p = await ctx.newPage();
      await p.clock.setFixedTime(new Date("2026-11-26T12:30:00-06:00"));
      p.on("pageerror", (e) => { errors++; console.error(`${file}-${w}: ${e.message}`); });
      await p.addInitScript(fakeBroker, data);
      // At 14 days, as the prototype's shots are.
      await p.goto(`${base}#${hash}${hash.startsWith("usage") ? `${hash.includes("?") ? "&" : "?"}days=14` : ""}`);
      await p.waitForSelector(hash.startsWith("project") ? ".puse .ugraph" : ".ucard");
      await p.waitForTimeout(700);
      for (const step of after) { await step(p, w); await p.waitForTimeout(300); }
      const over = (await p.evaluate(() => document.documentElement.scrollWidth)) - width;
      if (over > 0) console.log(`${file}-${w}: ${over} px wider than its viewport`);
      if (w === "390") {
        const under = await p.evaluate(() => [...document.querySelectorAll(".ucard a, .ucard button, .puse a, .puse button")].filter((x) => { const b = x.getBoundingClientRect(); return b.height > 0 && b.height < 43.5; })
          .map((x) => `${x.textContent.trim().slice(0, 28)} (${x.className || x.tagName.toLowerCase()} ${Math.round(x.getBoundingClientRect().height)})`));
        for (const t of under) taps.set(t, [...(taps.get(t) ?? []), file]);
      }
      await p.addStyleTag({ content: "header { position: static !important; } #toast { display: none !important; }" });
      const path = join(out, `bob211-${file}-${w}.png`);
      if (el) await p.locator(el).first().screenshot({ path });
      else await p.screenshot({ path, fullPage: true });
      await ctx.close();
    }
    console.log(file);
  }
  console.log(`Under 44 px at 390:\n${[...taps].map(([t, names]) => `  ${t}: ${names.length === 1 ? names[0] : `${names.length} scenes`}`).join("\n")}`);
} finally {
  await browser.close();
  server.close();
}
if (errors) process.exit(1);
