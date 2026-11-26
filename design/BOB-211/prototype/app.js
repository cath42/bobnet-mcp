// BOB-211 prototype: Usage, from a session's bar to its agents (spec.md). Draws the way app.js should; the data is data.js.
"use strict";

// ---------- Helpers (as app.js) ----------
const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
function s(tag, attrs, ...kids) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  for (const c of kids.flat(Infinity)) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmtTokens = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : fmtInt.format(Math.round(n)));
const fmtTick = (n) => fmtTokens(n);
function niceStep(max, n = 4) { const step0 = max / n, mag = 10 ** Math.floor(Math.log10(step0 || 1)); return [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= step0); }
const plural = (n, w, ws = `${w}s`) => `${fmtInt.format(n)} ${n === 1 ? w : ws}`;
const callsSaid = (n) => plural(n, "call");
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayDate = (d) => new Date(`${d}T00:00:00`);
const shortDay = (d) => `${dayDate(d).getDate()} ${MON[dayDate(d).getMonth()]}`;
const wordDay = (d) => `${WD[dayDate(d).getDay()]} ${shortDay(d)}`;
const quantile = (xs, q) => { const a = [...xs].sort((x, y) => x - y), i = (a.length - 1) * q, lo = Math.floor(i); return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo); };
const fine = () => matchMedia("(hover: hover) and (pointer: fine)").matches;

// ---------- State and the link ----------
const state = { span: 14, weigh: false, day: new Map(), sess: new Map(), agent: new Map(), stop: new Map(), seg: new Map(), focus: null };
const fig = (x) => (state.weigh ? x.w : x.raw);
const tokensWord = () => (state.weigh ? "Sonnet-equivalent tokens" : "tokens");

function readHash() {
  const [path, q] = location.hash.slice(1).split("?");
  const p = new URLSearchParams(q ?? "");
  state.weigh = p.get("weigh") === "1";
  state.span = p.get("days") === "30" ? 30 : 14;
  state.day.clear(); state.sess.clear(); state.agent.clear();
  const [v, key, day, f, kind, label, agent] = (path || "usage").split("/").map(decodeURIComponent);
  if (v !== "usage" || !key || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) return;
  state.day.set(key, day);
  if (f && kind && label) state.sess.set(key, `${f}/${kind}/${label}`);
  if (agent) state.agent.set(key, agent);
  state.scroll = key;
}
function writeHash(key) {
  const q = new URLSearchParams();
  if (state.weigh) q.set("weigh", "1");
  if (state.span === 30) q.set("days", "30");
  const day = key && state.day.get(key), sid = key && state.sess.get(key), agent = key && state.agent.get(key);
  const path = ["usage", ...(day ? [key, day] : []), ...(day && sid ? sid.split("/") : []), ...(day && sid && agent ? [agent] : [])].map(encodeURIComponent).join("/");
  history.replaceState(null, "", `#${path}${q.size ? `?${q}` : ""}`);
}

// ---------- The data, in the reads' shapes ----------
const sid = (ss) => `${ss.feature}/${ss.kind}/${ss.label}`;
const stepName = (ss) => (ss.label === "Fixes" ? ss.label : `${ss.kind} ${ss.label}`);
const sessName = (ss) => `${ss.feature} ${stepName(ss)}`;
const byId = new Map(SESSIONS.map((ss) => [`${ss.project}|${sid(ss)}`, ss]));

function dayList(n) {
  const out = [], t = dayDate(TODAY);
  for (let i = n - 1; i >= 0; i--) { const d = new Date(t); d.setDate(t.getDate() - i); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`); }
  return out;
}
/** A project's days as the usage read gives them: totals, by model, and `top` (the 3 biggest by raw and by weighted, ≤ 6), plus what runs now. */
function seriesOf(key, days) {
  return days.map((d) => {
    const entries = [];
    const by = new Map();
    for (const ss of SESSIONS.filter((x) => x.project === key)) {
      let raw = 0, w = 0, live = false;
      for (const r of ss.runs) {
        const k = r.on[d] ?? 0;
        if (!k) continue;
        raw += r.raw * k; w += r.w * k; live ||= r.live;
        const m = by.get(r.model) ?? { raw: 0, w: 0 };
        m.raw += r.raw * k; m.w += r.w * k; by.set(r.model, m);
      }
      if (raw) entries.push({ session: ss, raw: Math.round(raw), w: Math.round(w), live });
    }
    const loose = (LOOSE[key][d] ?? 0) * 1e6;
    if (loose) {
      entries.push({ session: null, raw: loose, w: Math.round(loose * 1.6) });
      const m = by.get("sonnet") ?? { raw: 0, w: 0 }; m.raw += loose * 0.4; m.w += loose * 0.4; by.set("sonnet", m);
      const o = by.get("opus") ?? { raw: 0, w: 0 }; o.raw += loose * 0.6; o.w += loose * 1.2; by.set("opus", o);
    }
    const raw = entries.reduce((n, e) => n + e.raw, 0), w = entries.reduce((n, e) => n + e.w, 0);
    const top3 = (f) => [...entries].sort((a, b) => b[f] - a[f]).slice(0, 3);
    const top = [...new Set([...top3("raw"), ...top3("w")])].sort((a, b) => b.raw - a.raw);
    return { day: d, raw, w, top, models: [...by].map(([model, x]) => ({ model, raw: x.raw, w: x.w })), so_far: d === TODAY };
  });
}
/** A day's bar in parts, bottom up: the 3 biggest of `top` by the switch, then the rest (clamped at 0: the read rounds each entry). */
function partsOf(pt) {
  const named = [...pt.top].sort((a, b) => fig(b) - fig(a)).slice(0, 3);
  const rest = Math.max(0, fig(pt) - named.reduce((n, e) => n + fig(e), 0));
  return [...named.map((e, i) => ({ ...e, rank: i, v: fig(e), id: e.session ? sid(e.session) : "none" })), ...(rest > 0.5 ? [{ session: null, rest: true, v: rest, rank: 3, id: "rest" }] : [])];
}
const median = (xs) => (xs.length < 3 ? null : quantile(xs, 0.5));
function figures(series) {
  const vals = series.map(fig), med = median(vals.filter((_, i) => series[i].raw > 0));
  return { vals, med, total: vals.reduce((a, b) => a + b, 0), spikes: med === null ? [] : series.filter((p, i) => vals[i] > 2 * med && vals[i] > 4e6).map((p) => p.day) };
}

// A run's context per call, shaped so its calls add up to the run's own context tokens (data.js says why).
const ctxCache = new Map();
function ctxOf(r) {
  const k = `${r.agent}|${r.raw}|${r.calls}`;
  if (ctxCache.has(k)) return ctxCache.get(k);
  let seed = (r.seed || 1) * 9301 + r.calls * 49297;
  const rnd = () => ((seed = (seed * 233280 + 49297) % 2147483647) / 2147483647);
  const n = r.calls, raw = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1);
    raw.push((0.3 + 1.4 * t ** 0.85) * (0.9 + rnd() * 0.2) + (rnd() < 0.08 ? 0.35 : 0));
  }
  const sum = raw.reduce((a, b) => a + b, 0), want = r.raw - r.out;
  const pts = raw.map((v) => Math.round((v / sum) * want));
  ctxCache.set(k, pts);
  return pts;
}

// ---------- The page ----------
const colorOf = (i) => (i < 6 ? `var(--ag-${i + 1})` : "var(--idle)");
const shade = [1, 0.68, 0.46];

function usageWidth(cols) {
  const pad = innerWidth <= 760 ? 24 : 32, page = Math.min(1320, $("view").clientWidth || innerWidth) - pad;
  return Math.max(260, Math.round((page - 14 * (cols - 1)) / cols) - 30);
}

function render() {
  const view = $("view");
  view.className = "wide";
  view.replaceChildren(...viewUsage());
  if (state.focus) { const el = view.querySelector(`[data-fk="${CSS.escape(state.focus)}"]`); el?.focus({ preventScroll: true }); state.focus = null; }
  if (state.scroll) { view.querySelector(`.ucard[data-project="${state.scroll}"] ${state.sess.has(state.scroll) ? ".sp" : ".uday"}`)?.scrollIntoView({ block: "start" }); state.scroll = null; }
}

function viewUsage() {
  const days = dayList(state.span), W = usageWidth(innerWidth >= 1200 ? 2 : 1);
  const seg = (label, items) => h("span", { class: "seg", role: "group", "aria-label": label }, items);
  return [
    h("div", { class: "bar-row u-bar" }, h("span", { class: "u-lab" }, "Weigh by model"),
      seg("Weigh by model", [[false, "Raw tokens"], [true, "Sonnet-equivalent"]].map(([on, t]) => h("button", { type: "button", "aria-pressed": String(state.weigh === on), onclick: () => { state.weigh = on; writeHash(null); render(); } }, t))),
      seg("Span", [14, 30].map((n) => h("button", { type: "button", "aria-pressed": String(state.span === n), onclick: () => { state.span = n; writeHash(null); render(); } }, `${n} days`)))),
    h("div", { class: "u-says" }, h("p", null, state.weigh
      ? "Sonnet-equivalent: each model's tokens count at its list-price ratio to Sonnet 5.5 (Opus 5.5 ×2, Haiku 5.5 ×0.05, Fable 5.1 ×5). Effort isn't weighted: higher effort already shows as more tokens. Tokens only, nothing is priced."
      : "Raw tokens: input, output, cache reads and writes as reported, every model counted the same."), h("details", { class: "factored" }, h("summary", null, "What's factored"), h("p", { class: "note" }, "The table, as today."))),
    h("div", { class: "ugrid" }, PROJECTS.map((p) => usageCard(p, days, W))),
    h("p", { class: "note" }, "Each bar is its day's sessions, the biggest at its foot: point at a part, or tap the day, to see which session it is; open one for its agents. A run's tokens are spread over the days it ran; today's include the workers running now, so far."),
  ];
}

function usageCard(p, days, W) {
  const key = p.project, series = seriesOf(key, days), { vals, med, total } = figures(series);
  const esc = (e) => {
    if (e.key !== "Escape") return;
    if (state.sess.has(key)) closeSession(key); else if (state.day.has(key)) letDayGo(key);
  };
  return h("section", { class: "card ucard", dataset: { project: key }, onkeydown: esc },
    h("div", { class: "u-h" }, h("a", { class: "u-name", href: "#usage", onclick: (e) => { e.preventDefault(); toast(`${p.name}'s page opens, as today.`); } }, p.name),
      h("span", { class: "u-tot" }, h("b", null, fmtTokens(total)), h("span", { class: "muted" }, ` ${tokensWord()}, ${days.length} days`)),
      h("span", { class: "muted u-today" }, `today so far ${fmtTokens(vals.at(-1))} · median day ${med === null ? "–" : fmtTokens(med)}`)),
    usageBars(key, p.name, series, days, W),
    dayLine(key, series, days),
    state.sess.has(key) ? sessionPanel(key, W) : dayDetail(key),
    notes(key, series, p));
}

/** One project's days as bars, each in its sessions' parts. */
function usageBars(key, name, series, days, W) {
  const { vals, spikes } = figures(series);
  const max = Math.max(1, ...vals) * 1.12, step = niceStep(max, 4), top = Math.ceil(max / step) * step;
  const H = 160, L = 46, R = 8, B = 22, T = 18, bw = (W - L - R) / days.length;
  const x = (i) => L + i * bw, y = (v) => T + (1 - v / top) * (H - T - B);
  const picked = state.day.get(key), open = state.sess.get(key), byFine = fine();
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const tip = h("div", { class: "u-tip tip", role: "status", hidden: true });
  const stop = [state.stop.get(key), picked, days.at(-1)].find((d) => days.includes(d));
  const bars = [];
  const wrap = h("div", { class: "ugraph" });
  const showTip = (part, d, i, yTop) => {
    tip.replaceChildren(...tipOf(part, series[i], d));
    tip.hidden = false;
    // Beside the bar, never over it: to its right, else to its left; level with the part, kept inside the graph.
    const scale = (wrap.clientWidth || W) / W, cw = wrap.clientWidth || W, right = (x(i) + bw * 0.9) * scale + 8, left = (x(i) + bw * 0.1) * scale - 8 - 240;
    tip.style.left = `${right + 240 <= cw ? right : Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, Math.min(yTop * scale - 20, H * scale - 130))}px`;
    for (const el of wrap.querySelectorAll(".sg")) el.classList.toggle("hl", part.session !== null && el.dataset.sid === part.id);
    wrap.classList.toggle("dim", part.session !== null);
  };
  const hideTip = () => { tip.hidden = true; wrap.classList.remove("dim"); for (const el of wrap.querySelectorAll(".sg.hl")) el.classList.remove("hl"); };
  days.forEach((d, i) => {
    const pt = series[i], v = vals[i], spike = spikes.includes(d), so = d === TODAY, parts = partsOf(pt);
    const said = `${wordDay(d)}${so ? ", so far" : ""}: ${fmtTokens(v)} ${tokensWord()}${spike ? ", a spike" : ""}; ${parts.filter((x) => x.session).map((x) => `${sessName(x.session)} ${fmtTokens(x.v)}`).join(", ") || "no session named"}`;
    const g = s("g", { class: ["bar", spike && "spike", so && "today", picked === d && "sel"].filter(Boolean).join(" "), tabindex: d === stop ? "0" : "-1", role: "button", "aria-label": said, "aria-pressed": String(picked === d), "data-fk": `bar/${key}/${d}` },
      s("rect", { class: "hit", x: x(i), y: 0, width: bw, height: H }));
    let base = 0;
    parts.forEach((part, k) => {
      const y0 = y(base + part.v), hgt = Math.max(part.v > 0 ? 1 : 0, y(base) - y(base + part.v));
      base += part.v;
      const cls = ["sg", part.rest ? "rest" : part.session ? `r${part.rank}` : "none", open === part.id && "open"].filter(Boolean).join(" ");
      const r = s("rect", { class: cls, x: x(i) + bw * 0.15, y: y0, width: bw * 0.7, height: hgt, "data-sid": part.id, "fill-opacity": part.rest ? 0.26 : part.session ? shade[part.rank] : null });
      g.append(r);
      if (!byFine) return;
      // With a mouse each part is its own target, the column's width; on a touch screen the bar is one (a phone's bar is 9 px wide).
      const hit = s("rect", { class: "shit", x: x(i), y: y0, width: bw, height: hgt, "data-sid": part.id });
      hit.addEventListener("pointerenter", () => showTip(part, d, i, y0));
      hit.addEventListener("pointerleave", hideTip);
      hit.addEventListener("click", (e) => { e.stopPropagation(); state.stop.set(key, d); part.session ? openSession(key, d, part.id) : pickDay(key, d, true); });
      g.append(hit);
    });
    g.addEventListener("click", () => { state.stop.set(key, d); pickDay(key, d); });
    g.addEventListener("blur", () => { state.seg.delete(key); hideTip(); });
    g.addEventListener("keydown", (e) => {
      const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key], to = by && bars[i + by];
      if (by) {
        e.preventDefault();
        if (!to) return;
        state.stop.set(key, days[i + by]); state.seg.delete(key);
        g.setAttribute("tabindex", "-1"); to.setAttribute("tabindex", "0"); to.focus();
        return;
      }
      // Up and Down go through the day's parts, bottom up; the tip names each.
      const up = { ArrowUp: 1, ArrowDown: -1 }[e.key];
      if (up) {
        e.preventDefault();
        const at = Math.max(0, Math.min(parts.length - 1, (state.seg.get(key) ?? -1) + up));
        state.seg.set(key, at);
        let b = 0; for (let k = 0; k < at; k++) b += parts[k].v;
        showTip(parts[at], d, i, y(b + parts[at].v));
        for (const el of g.querySelectorAll(".sg")) el.classList.toggle("kf", el === g.querySelectorAll(".sg")[at]);
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      const part = parts[state.seg.get(key) ?? -1];
      part?.session ? openSession(key, d, part.id, true) : pickDay(key, d, true);
    });
    bars.push(g);
  });
  const every = Math.ceil(days.length / (W < 420 ? 4 : 6));
  const labelled = spikes.map((d) => { const i = days.indexOf(d); return s("text", { class: "spike-lab", x: Math.min(W - 22, Math.max(L + 22, x(i) + bw / 2)), y: y(vals[i]) - 4, "text-anchor": "middle" }, fmtTokens(vals[i])); });
  wrap.append(s("svg", { viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": `${name}: ${tokensWord()} per day, the last ${days.length} days, each day in its sessions` },
    s("g", { class: "grid" }, ...ticks.map((v) => s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }))),
    ...bars,
    s("g", { class: "axis" }, ...ticks.map((v) => s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, fmtTick(v))),
      ...days.map((d, i) => ((days.length - 1 - i) % every ? "" : s("text", { x: Math.min(W - 18, x(i) + bw / 2), y: H - 5, "text-anchor": "middle" }, d === TODAY ? "today" : shortDay(d))))),
    ...labelled), tip);
  return wrap;
}

/** The tip over a part of a day's bar: which session, its title, that day's share, the whole session. */
function tipOf(part, pt, d) {
  const share = pt && fig(pt) ? Math.round((part.v / fig(pt)) * 100) : 0;
  const dayLine = h("span", null, `${wordDay(d)}${d === TODAY ? ", so far" : ""}: ${fmtTokens(part.v)} ${tokensWord()} · ${share}% of the day`);
  if (part.rest) return [h("b", null, "The rest"), dayLine, h("span", { class: "muted" }, "Smaller sessions, and work outside any. The day's three biggest are named.")];
  if (!part.session) return [h("b", null, "Outside any session"), dayLine, h("span", { class: "muted" }, "Runs that declared no session: fix passes, board moves, consults.")];
  const ss = part.session, whole = ss.runs.reduce((n, r) => n + fig(r), 0), ran = spanOf(ss);
  return [
    h("b", null, sessName(ss), ss.open ? h("span", { class: "t-run" }, " · running") : null),
    h("span", { class: "t-title" }, ss.title),
    dayLine,
    h("span", null, `Whole session: ${fmtTokens(whole)}${ss.open ? " so far" : ""} · ${ran}`),
    h("span", { class: "muted" }, "Click for its agents"),
  ];
}
function spanOf(ss) {
  const ds = [...new Set(ss.runs.flatMap((r) => Object.keys(r.on)))].sort();
  return ds.length === 1 ? `ran ${shortDay(ds[0])}` : `ran ${dayDate(ds[0]).getDate()}–${shortDay(ds.at(-1))}, ${ds.length} days`;
}

function pickDay(key, day, keep = false) {
  if (state.day.get(key) === day && !state.sess.has(key) && !keep) return letDayGo(key);
  state.day.set(key, day);
  state.sess.delete(key); state.agent.delete(key);
  writeHash(key);
  state.focus = `bar/${key}/${day}`;
  render();
}
function letDayGo(key) {
  const day = state.day.get(key);
  state.day.delete(key); state.sess.delete(key); state.agent.delete(key);
  writeHash(null);
  state.focus = `bar/${key}/${day}`;
  render();
}
function openSession(key, day, id, fromKeys = false) {
  state.day.set(key, day);
  state.sess.set(key, id);
  state.agent.delete(key);
  writeHash(key);
  state.focus = fromKeys ? `bar/${key}/${day}` : `sp-x/${key}`;
  render();
  if (!fromKeys) document.querySelector(`.ucard[data-project="${key}"] .sp`)?.scrollIntoView({ block: "nearest" });
}
function closeSession(key) {
  const id = state.sess.get(key);
  state.sess.delete(key); state.agent.delete(key);
  writeHash(key);
  state.focus = `ss/${key}/${id}`;
  render();
}
function stepDay(key, days, by) {
  const d = days[days.indexOf(state.day.get(key)) + by];
  if (!d) return;
  state.stop.set(key, d);
  pickDay(key, d, true);
  state.focus = `step/${key}/${by}`;
  render();
}

/** Under the graph: the picked day, its models, and its sessions as a list that names each part of the bar. */
function dayLine(key, series, days) {
  const day = state.day.get(key), i = days.indexOf(day), pt = series[i];
  if (!pt) return null;
  const parts = partsOf(pt), open = state.sess.get(key);
  const go = (by, mark, word) => h("button", { type: "button", class: "u-step", "aria-label": `The day ${word}`, "data-fk": `step/${key}/${by}`, disabled: !days[i + by] || null, onclick: () => stepDay(key, days, by) }, mark);
  const models = pt.models.map((m) => [m.model, fig(m)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const hover = (id, on) => { for (const el of document.querySelectorAll(`.ucard[data-project="${key}"] .sg`)) el.classList.toggle("hl", on && el.dataset.sid === id); document.querySelector(`.ucard[data-project="${key}"] .ugraph`)?.classList.toggle("dim", on); };
  return h("div", { class: "uday" },
    h("div", { class: "u-day-h" }, go(-1, "‹", "before"), go(1, "›", "after"), h("b", null, `${wordDay(day)}${pt.so_far ? ", so far" : ""}: ${fmtTokens(fig(pt))} ${tokensWord()}`)),
    models.length ? h("span", { class: "muted" }, models.map(([m, v]) => `${m} ${fmtTokens(v)}`).join(" · ")) : null,
    parts.length ? h("ul", { class: "u-ss", "aria-label": `${wordDay(day)}'s sessions, biggest first` }, parts.map((part) => {
      const sw = h("i", { class: `sw ${part.rest ? "rest" : part.session ? `r${part.rank}` : "none"}`, "aria-hidden": "true" });
      const val = h("span", { class: "v" }, fmtTokens(part.v));
      if (!part.session) return h("li", { class: "u-s quiet" }, sw, h("span", { class: "n" }, part.rest ? "The rest" : "Outside any session"), h("span", { class: "t" }, part.rest ? "smaller sessions, and work outside any" : "runs that declared no session"), val);
      const ss = part.session;
      return h("li", null, h("button", { type: "button", class: "u-s", "aria-pressed": String(open === part.id), "data-fk": `ss/${key}/${part.id}`, onclick: () => (open === part.id ? closeSession(key) : openSession(key, day, part.id)),
          onpointerenter: () => hover(part.id, true), onpointerleave: () => hover(part.id, false), onfocus: () => hover(part.id, true), onblur: () => hover(part.id, false) },
        sw, h("span", { class: "n" }, h("span", { class: "id" }, ss.feature), stepName(ss), ss.open ? h("span", { class: "run-dot", title: "running" }, " ●") : null), h("span", { class: "t" }, ss.title), val, h("span", { class: "go", "aria-hidden": "true" }, "›")));
    })) : null);
}

/** The day's detail, as built (BOB-121 §2.9): not redrawn here. */
function dayDetail(key) {
  const day = state.day.get(key);
  if (!day) return null;
  return h("div", { class: "ud" },
    h("div", { class: "ud-h" }, h("h3", null, `${wordDay(day)} in detail`),
      h("span", { class: "seg", role: "group" }, h("button", { type: "button", "aria-pressed": "true" }, "Total"), h("button", { type: "button", "aria-pressed": "false" }, "By agent")),
      h("button", { type: "button", class: "ud-x", "aria-label": `Close ${wordDay(day)}'s detail`, onclick: () => letDayGo(key) }, "×")),
    h("div", { class: "ud-frame proto-asis" }, h("p", null, "The day's context per call and calls per day, Total or By agent, as built (BOB-121 §2.9)."), h("p", { class: "muted" }, "Unchanged by BOB-211; this prototype doesn't redraw it. Pick a session above for its agents.")));
}

// ---------- A session's panel: spend per agent, and its context per call, all agents or one ----------
function agentsOf(ss) {
  const m = new Map();
  for (const r of ss.runs) {
    const a = m.get(r.agent) ?? { name: r.agent, role: r.role, model: r.model, effort: r.effort, runs: [], raw: 0, w: 0, calls: 0 };
    a.runs.push(r); a.raw += r.raw; a.w += r.w; a.calls += r.calls; m.set(r.agent, a);
  }
  return [...m.values()].sort((a, b) => fig(b) - fig(a) || a.name.localeCompare(b.name)).map((a, i) => ({ ...a, color: colorOf(i) }));
}

function sessionPanel(key, W) {
  const id = state.sess.get(key), ss = byId.get(`${key}|${id}`), day = state.day.get(key);
  if (!ss) return null;
  const agents = agentsOf(ss), pick = agents.find((a) => a.name === state.agent.get(key)) ?? null;
  const total = agents.reduce((n, a) => n + fig(a), 0), onDay = Math.round(ss.runs.reduce((n, r) => n + fig(r) * (r.on[day] ?? 0), 0));
  const calls = agents.reduce((n, a) => n + a.calls, 0), many = Object.keys(Object.assign({}, ...ss.runs.map((r) => r.on))).length > 1;
  const side = W >= 820;
  const setAgent = (name, fk) => {
    name && name !== state.agent.get(key) ? state.agent.set(key, name) : state.agent.delete(key);
    writeHash(key); state.focus = fk; render();
  };
  const head = h("div", { class: "sp-h" },
    h("span", { class: "kind", dataset: { kind: ss.kind } }, ss.kind),
    h("h3", null, h("a", { class: "id", href: "#", onclick: (e) => { e.preventDefault(); toast(`${ss.feature}'s page opens at ${stepName(ss)}'s card, as today.`); } }, ss.feature), stepName(ss)),
    ss.open ? h("span", { class: "badge run" }, "running") : null,
    h("button", { type: "button", class: "ud-x", "aria-label": `Close ${sessName(ss)}`, "data-fk": `sp-x/${key}`, onclick: () => closeSession(key) }, "×"));
  const meta = h("div", { class: "sp-m" },
    h("p", { class: "sp-title" }, ss.title),
    h("p", { class: "muted" }, `${ss.when[0]} – ${ss.when[1] ?? "now"}`, ` · ${plural(agents.length, "agent")} · ${plural(ss.runs.length, "run")} · ${callsSaid(calls)}`),
    h("p", { class: "sp-tot" }, h("b", null, `${fmtTokens(total)} ${tokensWord()}`), ss.open ? " so far" : "", ", whole session",
      many || ss.open ? h("span", { class: "muted" }, ` · ${wordDay(day)}: ${fmtTokens(onDay)} of it`) : null));
  return h("section", { class: "sp", "aria-label": `${sessName(ss)}: spend per agent and context per call`, dataset: { session: id } },
    head, meta,
    h("div", { class: `sp-body${side ? " side" : ""}` },
      spendChart(key, ss, agents, pick, total, setAgent),
      ctxGraph(key, ss, agents, pick, setAgent, side ? Math.round((W - 20) * 0.58) : W)),
    h("p", { class: "note sp-foot" }, `Tokens are the whole session's, every run's, as its card on ${ss.feature}'s page has them. `, h("a", { href: "#", onclick: (e) => { e.preventDefault(); toast(`${ss.feature}'s page opens at ${stepName(ss)}'s card, as today.`); } }, `${ss.feature}'s page ›`)));
}

/** Spend per agent: a bar each, biggest first, its runs as parts; the rows add up to the session. */
function spendChart(key, ss, agents, pick, total, setAgent) {
  const max = Math.max(1, ...agents.map(fig));
  return h("div", { class: "sp-spend" },
    h("h4", null, "Spend per agent"),
    h("ul", { class: "sp-rows" }, agents.map((a) => {
      const stopped = a.runs.filter((r) => r.outcome === "stopped").length;
      const said = `${a.name}: ${fmtTokens(fig(a))} ${tokensWord()}, ${plural(a.runs.length, "run")}, ${callsSaid(a.calls)}`;
      return h("li", null, h("button", { type: "button", class: "sp-row", "aria-pressed": String(pick?.name === a.name), "aria-label": said, "data-fk": `ag/${key}/${a.name}`, style: `--k:${a.color}`, onclick: () => setAgent(a.name, `ag/${key}/${a.name}`) },
        h("span", { class: "who" }, h("i", { class: "sw", "aria-hidden": "true" }), h("b", null, a.name),
          h("span", { class: "muted" }, ` ${a.model} · ${plural(a.runs.length, "run")}${stopped ? (a.runs.length === 1 ? ", stopped" : `, ${stopped} stopped`) : ""}${a.runs.some((r) => r.live) ? " · running" : ""}`)),
        h("span", { class: "sp-bar", "aria-hidden": "true" }, a.runs.map((r) => h("i", { style: `width:${(fig(r) / max) * 100}%`, title: `${r.start ? `${r.start}${r.end ? `–${r.end}` : ", running"}` : "a run"} · ${r.outcome === "stopped" ? r.reason : r.live ? "running" : "done"} · ${fmtTokens(fig(r))} · ${callsSaid(r.calls)}` }))),
        h("span", { class: "v" }, fmtTokens(fig(a)), a.runs.some((r) => r.live) ? h("small", null, " so far") : null)));
    })),
    h("div", { class: "sp-sum" }, h("span", null, "Session"), h("b", null, fmtTokens(total))),
    h("p", { class: "note" }, agents.length > 1 ? "Pick an agent for its own context per call; pick it again for all of them." : "Pick the agent for its own context per call, against its earlier runs."));
}

/** Context per call: every agent's calls summed as the session goes (each stretch its agent's colour), or one agent's runs. */
function ctxGraph(key, ss, agents, pick, setAgent, W) {
  const H = innerWidth <= 600 ? 190 : 220, L = 46, R = 10, T = 10, B = 22;
  const color = new Map(agents.map((a) => [a.name, a.color]));
  const prev = SESSIONS.filter((x) => x.project === ss.project && x.feature === ss.feature && x.kind === ss.kind && SESSIONS.indexOf(x) < SESSIONS.indexOf(ss)).at(-1);
  let lines = [], base = null, band = null, resets = [], xMax, top, key2 = [], note, who = [];
  if (!pick) {
    // The session's runs in start order, their context summed as they go.
    let t = 0, c = 0;
    for (const r of ss.runs) {
      const pts = ctxOf(r).map((v) => { c++; t += v; return [c, t]; });
      lines.push({ pts: c - r.calls > 0 ? [[c - r.calls, pts[0][1] - ctxOf(r)[0]], ...pts] : pts, color: color.get(r.agent), agent: r.agent });
      who.push({ from: c - r.calls + 1, to: c, agent: r.agent });
    }
    if (prev) { let u = 0; base = prev.runs.flatMap((r) => ctxOf(r)).map((v, i) => [i + 1, (u += v)]); }
    xMax = Math.max(2, c, base?.length ?? 0);
    top = Math.max(1, t, base?.at(-1)?.[1] ?? 0);
    key2 = [...agents.map((a) => h("span", null, h("i", { style: `--k:${a.color}` }), `${a.name} · ${callsSaid(a.calls)}`)),
      prev ? h("span", null, h("i", { class: "dash", style: "--k:var(--muted)" }), `${stepName(prev)} · ${callsSaid(base.length)}`) : null];
    note = `Every call in the session, its runs in the order they started, with context summed as they go; each stretch is the agent whose call it was. ${prev ? `Dashed: ${stepName(prev)}, the ${ss.kind} before it.` : `No dashed line: no ${ss.kind} on ${ss.feature} before it.`}`;
  } else {
    // One agent's runs one after another; a new run starts again from a small context.
    let c = 0;
    const pts = [];
    for (const r of pick.runs) { if (c) resets.push(c + 1); ctxOf(r).forEach((v) => pts.push([++c, v])); }
    lines = pick.runs.map((r, k) => ({ pts: pts.filter(([cc]) => cc >= (k ? resets[k - 1] : 1) && cc < (resets[k] ?? Infinity)), color: pick.color, agent: pick.name }));
    // Earlier runs of the role on this feature: their median and middle half at each call, while three reach it.
    const earlier = SESSIONS.filter((x) => x.project === ss.project && x.feature === ss.feature && SESSIONS.indexOf(x) < SESSIONS.indexOf(ss)).flatMap((x) => x.runs).filter((r) => r.role === pick.role);
    const ls = earlier.map(ctxOf);
    const b = [];
    for (let i = 0; ; i++) { const v = ls.map((p) => p[i]).filter((x) => x !== undefined); if (v.length < 3) break; b.push([quantile(v, 0.25), quantile(v, 0.5), quantile(v, 0.75)]); }
    if (b.length) { band = b; base = b.map((q, i) => [i + 1, q[1]]); }
    xMax = Math.max(2, c, b.length);
    top = Math.max(1, ...pts.map((p) => p[1]), ...b.map((q) => q[2]));
    key2 = [h("span", null, h("i", { style: `--k:${pick.color}` }), `${pick.name} · ${callsSaid(pick.calls)}`),
      band ? h("span", null, h("i", { class: "band", style: "--k:var(--idle)" }), `earlier ${pick.name} runs on ${ss.feature}, middle half`) : null,
      band ? h("span", null, h("i", { class: "dash", style: "--k:var(--muted)" }), "their median") : null,
      resets.length ? h("span", null, h("i", { class: "dot", style: `--k:${pick.color}` }), "a new run starts") : null];
    note = `${pick.name}'s ${pick.runs.length > 1 ? `${pick.runs.length} runs in the session, one after another; each new run starts again from a small context (dotted)` : "run in the session"}. ${band ? `The grey band is the middle half of ${earlier.length} earlier ${pick.name} runs on ${ss.feature} at the same call, dashed their median. A line above it carried more context per call than usual.` : `No band: fewer than 3 earlier ${pick.name} runs on ${ss.feature}.`}`;
  }
  const step = niceStep(top, 2), yTop = Math.ceil(top / step) * step;
  const x = (c) => L + ((c - 1) / (xMax - 1)) * (W - L - R), y = (v) => T + (1 - v / yTop) * (H - T - B);
  const at = (ps) => ps.map(([c, v]) => `${x(c).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const said = pick ? `${pick.name}'s context per call in ${sessName(ss)}, ${callsSaid(pick.calls)}` : `${sessName(ss)}: context summed call by call, every agent, ${callsSaid(who.at(-1)?.to ?? 0)}`;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": said, tabindex: "0", "data-fk": `ctx/${key}/${pick?.name ?? ""}` });
  svg.append(s("g", null, ...[0, yTop / 2, yTop].flatMap((v) => [s("line", { class: "gl", x1: L, x2: W - R, y1: y(v), y2: y(v) }), s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, fmtTick(v))])),
    s("g", { class: "axis" }, s("text", { x: L, y: H - 5, "text-anchor": "start" }, "1"), s("text", { x: W - R, y: H - 5, "text-anchor": "end" }, `${fmtInt.format(xMax)} calls`)));
  if (band) svg.append(s("polygon", { points: `${at(band.map((q, i) => [i + 1, q[2]]))} ${at(band.map((q, i) => [i + 1, q[0]]).reverse())}`, fill: "var(--idle)", "fill-opacity": 0.18 }));
  if (base) svg.append(s("polyline", { points: at(base), fill: "none", stroke: "var(--muted)", "stroke-width": 2, "stroke-dasharray": "6 4" }));
  for (const l of lines) if (l.pts.length) svg.append(s("polyline", { class: "ln", points: at(l.pts), fill: "none", stroke: l.color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  for (const r of resets) svg.append(s("line", { x1: x(r - 0.5), x2: x(r - 0.5), y1: T, y2: H - B, stroke: pick.color, "stroke-dasharray": "2 3", "stroke-opacity": 0.7 }));
  const cross = s("line", { y1: T, y2: H - B, stroke: "var(--muted)", visibility: "hidden" });
  const hit = s("rect", { x: L, y: 0, width: W - L - R, height: H, fill: "transparent", style: pick ? null : "cursor:pointer" });
  svg.append(cross, hit);
  const tip = h("div", { class: "tip", role: "status", hidden: true });
  const wrap = h("div", { class: "ud-plot" }, svg, tip);
  const flat = lines.flatMap((l) => l.pts.map(([c, v]) => ({ c, v, agent: l.agent })));
  const show = (call) => {
    const c = Math.round(Math.min(xMax, Math.max(1, call)));
    const own = flat.filter((p) => p.c === c).at(-1), med = base?.find((p) => p[0] === c);
    if (!own && !med) return hide();
    tip.textContent = [`call ${fmtInt.format(c)}`, own && !pick ? own.agent : null, own ? `${fmtTokens(own.v)} context${pick ? "" : " summed"}` : null, med ? `${pick ? "median" : stepName(prev)} ${fmtTokens(med[1])}` : null].filter(Boolean).join(" · ");
    cross.setAttribute("x1", x(c)); cross.setAttribute("x2", x(c)); cross.setAttribute("visibility", "visible");
    tip.hidden = false;
    const scale = (wrap.clientWidth || W) / W;
    tip.style.left = `${Math.max(0, Math.min((wrap.clientWidth || W) - 220, x(c) * scale + 10))}px`;
    tip.style.top = `${T}px`;
    svg.dataset.call = String(c);
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
  const callAt = (ev) => { const r = svg.getBoundingClientRect(); return 1 + ((((ev.clientX - r.left) / (r.width || W)) * W - L) / (W - L - R)) * (xMax - 1); };
  hit.addEventListener("pointermove", (ev) => show(callAt(ev)));
  hit.addEventListener("pointerdown", (ev) => show(callAt(ev)));
  hit.addEventListener("pointerleave", hide);
  // All agents: a click on a stretch picks its agent.
  const pickAt = (c) => { const w = who.find((x) => c >= x.from && c <= x.to); if (w) setAgent(w.agent, `ctx/${key}/${w.agent}`); };
  if (!pick) hit.addEventListener("click", (ev) => pickAt(Math.round(callAt(ev))));
  svg.addEventListener("focus", () => show(Number(svg.dataset.call ?? xMax)));
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    const c = Number(svg.dataset.call ?? xMax), far = Math.max(1, Math.round(xMax / 40));
    if (e.key === "Enter" && !pick) { e.preventDefault(); return pickAt(c); }
    const to = { ArrowLeft: c - far, ArrowRight: c + far, Home: 1, End: xMax }[e.key];
    if (to === undefined) return;
    e.preventDefault(); show(to);
  });
  const sw = h("span", { class: "seg sp-pick", role: "group", "aria-label": "Context per call of" },
    h("button", { type: "button", "aria-pressed": String(!pick), "data-fk": `pick/${key}/`, onclick: () => setAgent(null, `pick/${key}/`) }, "All agents"),
    agents.map((a) => h("button", { type: "button", "aria-pressed": String(pick?.name === a.name), "data-fk": `pick/${key}/${a.name}`, style: `--k:${a.color}`, onclick: () => setAgent(a.name, `pick/${key}/${a.name}`) }, h("i", { class: "sw", "aria-hidden": "true" }), a.name)));
  return h("div", { class: "sp-ctx" },
    h("div", { class: "sp-ctx-h" }, h("h4", null, pick ? `${pick.name}'s context per call` : "Context, summed call by call"), sw),
    h("figure", null, wrap),
    h("div", { class: "key" }, key2),
    h("p", { class: "note" }, note),
    state.weigh ? h("p", { class: "note" }, "Context is raw tokens: weighing applies to the bars.") : null,
    ss.open ? h("p", { class: "note" }, `Running: ${ss.runs.filter((r) => r.live).map((r) => r.agent).join(" and ")}'s calls so far, from ${ss.project === "bobnet" ? "mbp-1" : "its laptop"}'s last report.`) : null);
}

function notes(key, series, p) {
  const { spikes, vals } = figures(series);
  return [
    spikes.length ? h("p", { class: "u-spike" }, h("b", null, plural(spikes.length, "spike")), " over twice the median day: ", spikes.map((d) => h("button", { type: "button", class: "more-t", onclick: () => pickDay(key, d, true) }, `${shortDay(d)} ${fmtTokens(vals[series.findIndex((x) => x.day === d)])}`))) : null,
    p.lost ? h("p", { class: "muted u-lost" }, `${plural(p.lost, "run")} lost, tokens unknown: not counted`) : null,
  ];
}

let toastT = 0;
function toast(text) { const t = $("toast"); t.textContent = text; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }

addEventListener("hashchange", () => { readHash(); render(); });
let rw = innerWidth;
addEventListener("resize", () => { if (Math.abs(innerWidth - rw) > 40) { rw = innerWidth; render(); } });
document.addEventListener("DOMContentLoaded", () => {
  for (const a of document.querySelectorAll("#tabs a:not([aria-current])")) a.addEventListener("click", (e) => { e.preventDefault(); toast("Only Usage is in this prototype."); });
  readHash(); render();
});
