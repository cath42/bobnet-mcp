// BobNet dashboard: one owner WebSocket, a full snapshot on connect, then live frames.
// Each laptop's supervisor reports a snapshot (its workers, every few seconds) and, when it
// changes, a board per project (backlog, sessions, past runs, commits, CI).
// Agent-supplied text is only ever set as textContent.

const state = {
  peers: [],
  laptops: new Map(),
  /** "laptop|project" → { laptop, at, board } */
  boards: new Map(),
  traffic: [],
  project: null,
  inc: null,
  release: null,
  showAccepted: false,
  openLanes: new Set(),
  openCards: new Set(),
  open: new Set(),
  chart: { mode: "session", role: null, run: null },
  /** The steps view: folds Casper opened or shut, the agent line whose detail row is open, open context panels and history. */
  folds: new Map(),
  agentOpen: null,
  ctxOpen: new Map(),
  hist: new Map(),
  /** Triage's filter (all, bugs, none or a release) and whether past 25 rows show. */
  triage: { filter: "all", all: false },
  /** Needs you: the project picked, and the one answer form open with what Casper has put in it so far (notes 40). */
  waitsProject: "all",
  answering: null,
  /** Needs you items shown whole, and those with their context open ("ctx:" + id): kept for the tab's life (BOB-31). */
  whole: new Set(),
  /** Usage weighed by model (Sonnet-equivalent), or raw: the hash's, else this device's (ADR 0014; spec 2.9). */
  weigh: false,
  /** When the page last read the laptops whole (this device's clock), null before it has: what Needs you is up to date with. */
  refreshed: null,
  last: 10,
};
/** Messages kept in the page, as many as the broker's snapshot has. */
const TRAFFIC_MAX = 50;
const ACTIVE = ["running", "waiting-approval", "waiting-answer"];
let ws = null;
let rid = 0;
let backoff = 1000;

const $ = (id) => document.getElementById(id);

/** What is open survives a redraw, a tab switch and a reload, in sessionStorage; a new tab starts folded (BOB-31). */
const WHOLE = "bobnet.open";
function loadWhole() {
  try { return new Set(JSON.parse(sessionStorage.getItem(WHOLE) ?? "[]")); } catch { return new Set(); }
}
function saveWhole() {
  try { sessionStorage.setItem(WHOLE, JSON.stringify([...state.whole])); } catch {}
}
state.whole = loadWhole();
function toggleWhole(id) {
  state.whole.has(id) ? state.whole.delete(id) : state.whole.add(id);
  saveWhole();
  render();
}

/** The hash's path ("usage", "helix", a day), without its filters (`?weigh=1`). */
const hashPath = () => location.hash.slice(1).split("?")[0].split("/");
const hashFilter = (name) => new URLSearchParams(location.hash.split("?")[1] ?? "").get(name);

/** Builds an element; string children become text nodes, never HTML. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v !== undefined && v !== null) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

// ---------- Actions ----------

/** Requests sent and not yet answered by the broker, by rid: the button, and the toast its result reads as, if not the supervisor's. */
const sentActions = new Map();
/** The toast a sent action's result reads as, by the broker's action id: a text, or what makes [text, tone] from the result. */
const actionToasts = new Map();
let toastTimer = null;

/** A toast (`ok`: true, false or "warn"); with `undo`, an Undo button that takes the change back. */
function toast(text, ok = true, undo = null, keep = false) {
  const el = $("toast");
  // `keep`: it stays until closed or the next tab change (BOB-33: I'm caught up's Undo).
  el.replaceChildren(text, undo ? button("Undo", "undo", () => { el.hidden = true; undo(); }) : "", keep ? button("×", "close-t", () => (el.hidden = true)) : "");
  el.querySelector(".close-t")?.setAttribute("aria-label", "Close");
  el.dataset.ok = String(ok);
  el.dataset.keep = String(keep);
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!keep) toastTimer = setTimeout(() => (el.hidden = true), 8000);
}

/** Sends a dashboard action to a laptop's supervisor; the button stays disabled until it's settled. True once sent. With `done`, its result's toast. */
function act(laptop, action, button, confirmText, done = null) {
  if (confirmText && !confirm(confirmText)) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast("Not connected; try again in a moment.", false);
    return false;
  }
  const id = String(++rid);
  sentActions.set(id, { button, done });
  if (button) button.disabled = true;
  ws.send(JSON.stringify({ t: "action", rid: id, laptop, action }));
  return true;
}

function button(label, cls, onClick) {
  const b = h("button", { type: "button", class: cls });
  b.textContent = label;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(b);
  });
  return b;
}

// ---------- Formatting ----------

const fmtInt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const fmtTokens = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : fmtInt.format(n));
const totalTokens = (t) => t.input + t.output + t.cache_read + t.cache_write;

function duration(ms) {
  if (ms < 0 || !Number.isFinite(ms)) return "–";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  if (hr < 48) return `${hr}h ${m % 60}m`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}
const since = (iso) => (iso ? duration(Date.now() - Date.parse(iso)) : "–");
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const shortName = (address) => address.split("@")[0];
const fmtModel = (w) => `${w.model ?? "default"} · ${w.effort ?? "default"}`;
/** A brief's own headline, when it opens with one ("Bob's brief: red main, fix first (ADR 0060 §4). …"). */
const headlineOf = (task) => (task.match(/^Bob(?:'s brief)?:\s*([^.(]+)/)?.[1] ?? "").trim() || null;
const chip = (id, onClick) => (onClick ? h("button", { type: "button", class: "chip", onclick: (e) => (e.stopPropagation(), onClick()) }, id) : h("span", { class: "chip", style: "display:inline-block;border:1px solid var(--accent)" }, id));
const ago = (iso) => h("span", { "data-ago": iso }, since(iso));
/** Bytes on disk, as df reads them: decimal units. */
const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${Math.max(0, n)} B`);
/** What a cleanup freed: the change in free space, or unknown when it couldn't be read (never 0 for that). */
const freedText = (n) => (n === null || n === undefined ? "unknown" : fmtBytes(n));
const CLEANUP_TRIGGER = { schedule: "scheduled", floor: "disk low", demand: "asked for" };

/** A board outbox is stuck once its oldest report has waited this long; below it the reports are in flight (ADR 0012 §3). */
const OUTBOX_STUCK_MS = 5 * 60_000;
/** A laptop's board reports it couldn't send (BOB-28; design/BOB-48/spec.md §2b): only when stuck, never "0", nothing from an older supervisor. */
function outboxLine(o) {
  if (!o || !o.count || !o.oldest_at || brokerNow() - Date.parse(o.oldest_at) <= OUTBOX_STUCK_MS) return null;
  return h("div", { class: "outbox", title: `This laptop's supervisor has board reports it couldn't send since ${new Date(o.oldest_at).toLocaleString()}. It retries every minute; the board on the dashboard is behind until they go through.` },
    h("b", null, "Board reports stuck"), ` · ${o.count} waiting · oldest `, ago(o.oldest_at), o.code ? ` · last error ${o.code}` : null);
}

/** A laptop's last cleanup on its row (BOB-123): when, what started it, what it freed per project (unknown said so), each failed or skipped step. */
function cleanupLine(c) {
  if (!c) return h("div", { class: "cleanup" }, "No cleanup yet");
  const why = CLEANUP_TRIGGER[c.trigger] ?? c.trigger;
  if (c.skipped) return h("div", { class: "cleanup", dataset: { skipped: "" } }, h("span", null, h("b", null, "Cleanup skipped"), ` · ${c.skipped === "busy" ? "the run slot was busy" : c.skipped} · ${why} · `, ago(c.at), " ago · it tries again at the next check"));
  const parts = [...c.projects.map((p) => ({ name: p.project, freed: p.freed_bytes, steps: p.steps })), ...(c.steps?.length ? [{ name: "supervisor logs", freed: c.steps.reduce((a, s) => (a === null || s.freed_bytes === null ? null : a + s.freed_bytes), 0), steps: c.steps }] : [])];
  return h("div", { class: "cleanup" },
    h("span", null, h("b", null, "Last cleanup"), " ", ago(c.at), ` ago · ${why} · freed `, h("span", { class: "num" }, freedText(c.freed_bytes))),
    parts.length ? h("ul", null, parts.map((p) => h("li", null,
      h("span", null, p.name, " ", h("span", { class: "num" }, freedText(p.freed))),
      p.steps.filter((s) => !s.ok || s.skipped).map((s) => h("span", { class: s.ok ? "skip" : "fail" }, s.ok ? `${s.step} skipped: ${s.skipped}` : `${s.step} failed: ${s.error ?? "no reason given"}`))))) : null);
}

// ---------- Data ----------

/** Every worker the supervisors report: running ones, and those that ended in the last 24 hours. */
const workers = () => [...state.laptops.values()].flatMap((l) => l.snapshot.workers.map((w) => ({ ...w, laptop: l.laptop })));
const running = () => workers().filter((w) => ACTIVE.includes(w.state));
const workerTokens = (w) => (typeof w.tokens === "number" ? w.tokens : totalTokens(w.tokens));

/**
 * The service's projects with a laptop's board, the one shown first being the one with a backlog and the
 * most recent work. A board of a project the service doesn't have is drawn nowhere (ADR 0012 §2), nor
 * any before the list is read: its row stays in the broker until the sweep.
 */
function projects() {
  const by = new Map(), listed = new Set((svc.projects ?? []).map((p) => p.key));
  for (const e of state.boards.values()) {
    if (!listed.has(e.board.project)) continue;
    const prev = by.get(e.board.project);
    if (!prev || e.at > prev.at) by.set(e.board.project, e);
  }
  return [...by.values()].sort((a, b) => Number(!!b.board.backlog) - Number(!!a.board.backlog) || (b.board.sessions.at(-1)?.started_at ?? "").localeCompare(a.board.sessions.at(-1)?.started_at ?? ""));
}
function current() {
  const all = projects();
  const e = all.find((x) => x.board.project === state.project) ?? all[0];
  return e ? { ...e.board, laptop: e.laptop } : null;
}
/** The project a page shows: the hash's, else the one last picked on a page, else the first with a board; null before the list is read. */
function pageProject() {
  const keys = (svc.projects ?? []).map((p) => p.key);
  return [hashPath()[1], state.project, current()?.project, keys[0]].find((k) => keys.includes(k)) ?? null;
}
/** A project's laptop board, none when no laptop has sent one. */
function laptopBoard(key) {
  const e = projects().find((x) => x.board.project === key);
  return e ? { ...e.board, laptop: e.laptop } : null;
}
/**
 * A page's project switch (spec 2.0): one picked, and picking another stays on the page. The pick is also
 * what Roadmap, Triage, Usage, Features and Capture open on next, when their link names no project.
 */
function projectSwitch(key, to) {
  return h("span", { class: "seg projects" }, svc.projects.map((q) => h("button", { type: "button", "aria-pressed": String(q.key === key), onclick: () => {
    Object.assign(state, { project: q.key, inc: null, release: null });
    location.hash = to(q.key);
  } }, q.name)));
}
/** The switch at the top of a page that has no bar of its own; none with one project. */
const switchBar = (key, to) => (key && svc.projects.length > 1 ? h("div", { class: "bar-row" }, projectSwitch(key, to)) : null);

/** The latest session (a build, design, review or retro), and the two before it of the same kind, to compare with. */
function sessionsOf(b) {
  const named = b.sessions.filter((x) => x.kind !== "other");
  const cur = named.at(-1) ?? b.sessions.at(-1) ?? null;
  const same = b.sessions.filter((x) => x.kind === cur?.kind && x !== cur);
  return { cur, prev: same.at(-1) ?? null, prev2: same.at(-2) ?? null };
}

/** A session's runs: the board's ended ones, and the snapshot's for those still running or not yet on the board. */
function sessionRuns(b, name) {
  if (!name) return [];
  const seen = new Set();
  const out = [];
  for (const w of workers()) {
    if (w.project !== b.project || w.session !== name || (!ACTIVE.includes(w.state) && !w.ended_at)) continue;
    const ended = b.runs.find((r) => r.id === w.id);
    seen.add(w.id);
    out.push(ended && w.ended_at ? { ...ended, laptop: b.laptop } : { ...w, ctx: w.ctx.length ? w.ctx : (ended?.ctx ?? []), tokens: totalTokens(w.tokens) });
  }
  for (const r of b.runs) if (r.session === name && !seen.has(r.id)) out.push({ ...r, laptop: b.laptop });
  return out.sort((a, c) => (a.started_at ?? "").localeCompare(c.started_at ?? ""));
}

// ---------- Backlog ----------

/** The backlog items a worker or run is on, as its spawn named them (a supervisor before that sends only task_ref). */
const refsOf = (w) => (w.task_refs?.length ? w.task_refs : w.task_ref ? [w.task_ref] : []);

function backlogModel(b) {
  const items = b.backlog?.items ?? [];
  const byId = new Map(items.map((x) => [x.id, x]));
  const kids = (pid) => items.filter((x) => x.parent === pid);
  const settled = (st) => st === "In Review" || st === "Done";
  const live = running().filter((w) => w.project === b.project);
  const workerOn = (id) => live.filter((w) => refsOf(w).includes(id));
  const runningOnInc = (id) => live.filter((w) => refsOf(w).some((r) => r === id || byId.get(r)?.parent === id));
  const { cur } = sessionsOf(b);
  const commitsFor = (id) => b.commits.filter((c) => new RegExp(`\\b${id.replace(/\./g, "\\.")}(?![\\d.])`).test(c.subject));
  /** Commits on main for the task since the current session started, not counting docs-only ones. */
  const commitsInBuild = (id) => (cur ? commitsFor(id).filter((c) => c.at >= cur.started_at && !/Docs only/.test(c.subject)) : []);
  const milestone = (id) => b.backlog?.milestones.find((m) => m.id === id)?.title ?? id;
  return { items, byId, kids, settled, workerOn, runningOnInc, commitsInBuild, milestone, cur };
}

const owner = (x) => (x.assignee.join(", ") || x.labels.find((l) => /^(svc|layer):/.test(l)) || "unassigned");

/**
 * An increment's tasks by session. A task's `build:<n>` (or `build:design`) label places it; without
 * one, the latest session whose workers had it as their task does; the rest are not in a build yet.
 */
function lanesOf(b, m, inc) {
  const ks = m.kids(inc.id);
  const place = new Map();
  for (const x of ks) {
    const l = x.labels.find((v) => /^build:/.test(v))?.slice(6);
    if (l) place.set(x.id, l === "design" ? "design" : `build ${l}`);
  }
  const prefix = `${inc.id} `;
  // Only design and build sessions place work; a review's fix-up leaves a task in the build that made it.
  const sessions = b.sessions.filter((x) => x.name.startsWith(prefix) && (x.kind === "design" || x.kind === "build"));
  for (const ss of sessions) {
    const key = ss.name.slice(prefix.length);
    for (const r of sessionRuns(b, ss.name)) for (const id of refsOf(r)) if (ks.some((k) => k.id === id) && !ks.find((k) => k.id === id).labels.some((v) => v.startsWith("build:"))) place.set(id, key);
  }
  // In the order the sessions started, design first; a lane only a build:<n> label names goes after them.
  const order = (k) => (k === "design" ? "" : sessions.find((x) => x.name === `${prefix}${k}`)?.started_at ?? `~${k}`);
  const keys = [...new Set(place.values())].sort((a, c) => (order(a) < order(c) ? -1 : order(a) > order(c) ? 1 : 0));
  const lanes = keys.map((key) => {
    const ids = ks.filter((k) => place.get(k.id) === key).map((k) => k.id);
    const ss = sessions.find((x) => x.name === `${prefix}${key}`);
    const now = !!ss && m.cur?.name === ss.name;
    // A lane with an agent on one of its cards stays open, as during a review of its build.
    return { title: key[0].toUpperCase() + key.slice(1), ids, now, closed: !now && ids.every((id) => m.settled(m.byId.get(id).status) && !m.workerOn(id).length) };
  });
  const rest = ks.filter((k) => !place.has(k.id)).map((k) => k.id);
  if (rest.length) lanes.push({ title: "Not in a build yet", ids: rest, now: false, closed: false });
  return lanes;
}

// ---------- Rendering: Now ----------

/** Opens Usage with the context chart on one run (or, with no run, on a role). */
function showRun(w) {
  state.chart = { mode: "agent", role: w.role, run: w.id ?? null };
  location.hash = w.project ? `usage/${w.project}` : "usage";
}


// ---------- Rendering: kanban ----------

/** A worker with no activity this long is flagged, never interrupted (Casper, 2026-11-07): you decide. */
const QUIET_MIN = 15;
const quietMinutes = (w) => (w.last_event_at ? Math.floor((Date.now() - Date.parse(w.last_event_at)) / 60_000) : 0);

function agentTag(w, showTask, m) {
  const refs = refsOf(w), x = refs.length === 1 ? m.byId.get(refs[0]) : null;
  const head = headlineOf(w.task);
  return h("div", { class: "agent", role: "button", tabindex: "0", title: "Show its context per call", style: "cursor:pointer", onclick: (e) => (e.stopPropagation(), showRun(w)), onkeydown: (e) => e.key === "Enter" && (e.stopPropagation(), showRun(w)) },
    h("b", null, w.name),
    showTask ? h("span", { class: "d" }, head ? `${head}${refs.length ? ` · ${refs.join(", ")}` : ""}` : `${refs.join(", ")} · ${x ? x.title.slice(0, 60) : w.task.slice(0, 60)}`)
      : w.checkpoint ? h("span", { class: "d" }, w.checkpoint.length > 90 ? `${w.checkpoint.slice(0, 90)}…` : w.checkpoint) : null,
    h("span", { class: "d" }, `${fmtModel(w)} · ${w.laptop} · ${since(w.started_at)} · ${fmtTokens(totalTokens(w.tokens))} tokens`));
}

const narrow = () => window.innerWidth < 600;

function board(cols, lanes) {
  if (narrow()) return boardList(cols, lanes);
  // Below desktop width, columns empty on the whole board give their room to the rest.
  if (window.innerWidth < 1100) cols = cols.filter((c) => (c.count ?? lanes.reduce((n, l) => n + l.cells[c.key].length, 0)) > 0);
  const grid = h("div", { class: "board", style: `--cols:${cols.length}` }, cols.map((c) => h("div", { class: `col-h${c.live ? " live" : ""}` }, h("span", null, c.name), h("span", null, String(c.count ?? lanes.reduce((n, l) => n + l.cells[c.key].length, 0))))));
  for (const l of lanes) {
    const folded = l.closed && !state.openLanes.has(l.title);
    const n = cols.reduce((k, c) => k + l.cells[c.key].length, 0);
    if (l.title) grid.append(laneHead(l, folded, `show ${n} tasks, all built`));
    if (folded) continue;
    for (const c of cols) grid.append(h("div", { class: "col" }, l.cells[c.key]));
  }
  return h("div", { class: "board-wrap" }, grid);
}

function laneHead(l, folded, label) {
  return h("div", { class: "lane-h" }, h("b", null, l.title), l.now ? h("span", { class: "now" }, "now") : null, l.sub ? h("span", { class: "muted" }, l.sub) : null,
    l.closed ? h("button", { type: "button", class: "chip", onclick: () => { folded ? state.openLanes.add(l.title) : state.openLanes.delete(l.title); render(); } }, folded ? label : "fold") : null);
}

/** The board on a phone: each lane a list, its cards under their column's heading, empty columns left out. */
function boardList(cols, lanes) {
  const out = h("div", { class: "board-list" });
  for (const l of lanes) {
    const n = cols.reduce((k, c) => k + l.cells[c.key].length, 0);
    const folded = l.closed && !state.openLanes.has(l.title);
    if (l.title) out.append(laneHead(l, folded, `show ${n}, all built`));
    if (folded) continue;
    for (const c of cols) if (l.cells[c.key].length) out.append(h("div", { class: "grp" }, h("div", { class: `grp-h${c.live ? " live" : ""}` }, h("span", null, c.name), h("span", null, String(c.count ?? l.cells[c.key].length))), l.cells[c.key]));
  }
  return out;
}

const boardDown = (text) => h("div", { class: "banner down" }, h("b", null, "Board unavailable"), h("span", null, text));
/** Why the Overview's reads failed, or the list of projects' with none read yet. */
const boardError = () => ov.error ?? (svc.projects ? null : svc.error);
/** Before the list of projects is read: that it is being read, or why it couldn't be. */
const unread = () => (svc.error ? boardDown(svc.error) : h("div", { class: "empty-card" }, "Reading the board…"));
/** No project to show: the list isn't read yet, or has none. */
const noProjects = () => (svc.projects ? h("div", { class: "empty-card" }, "No project's board is in the service yet.") : unread());
const empty = (b) => !svc.projects ? h("section", null, unread()) : h("section", null, h("div", { class: "banner idle" }, h("span", null, b ? "This project has no backlog configured." : "No board yet."), h("span", { class: "muted" }, b ? "Set backlog: { dir } for it in supervisor.yaml." : "A supervisor sends its projects' boards within a minute of starting.")));

function viewFeature() {
  // `#feature/<project>/<id>`: a feature in the service opens on its steps; one on a Backlog.md board opens as before.
  const id = hashPath()[1];
  const route = featureRoute();
  const bar = (key) => switchBar(key, (k) => `#feature/${k}`);
  if (route) return [bar(route.p.key), ...viewServiceFeature(route.p, route.ref)];
  // `#feature/<project>`, where the switch goes, is that project's feature view.
  const key = pageProject();
  if (id && id !== key) state.inc = id;
  const b = key ? laptopBoard(key) : current();
  if (!b?.backlog) return [bar(key), empty(b)];
  const m = backlogModel(b);
  const open = m.items.filter((x) => x.type === "increment" && x.status !== "Done" && m.kids(x.id).length);
  const curInc = m.cur?.name.split(" ")[0];
  const inc = m.byId.get(state.inc) ?? m.byId.get(curInc) ?? open[0];
  if (!inc) return [bar(key), empty(b)];
  const ks = m.kids(inc.id);
  const cols = [{ key: "Draft", name: "Draft" }, { key: "Ready", name: "Ready" }, { key: "In Progress", name: "In progress", live: true }, { key: "In Review", name: "Built, awaiting review" }, { key: "Done", name: "Done" }];
  // An agent on it, or commits on main this session, put a task in progress before the board's own move.
  const column = (x) => (!m.settled(x.status) && (m.workerOn(x.id).length || m.commitsInBuild(x.id).length) ? "In Progress" : cols.some((c) => c.key === x.status) ? x.status : "Draft");
  const card = (x) => {
    const ws = m.workerOn(x.id), opened = ws.length > 0 || state.openCards.has(x.id);
    const bl = x.deps.filter((d) => m.byId.get(d) && !m.settled(m.byId.get(d).status)), cs = m.commitsInBuild(x.id), moved = column(x) !== x.status;
    const waits = bl.length && !m.settled(x.status) && !cs.length ? h("span", { style: "color:var(--warn)" }, `waits on ${bl.map((d) => d.replace(/^[A-Z]+-/, "")).join(", ")}`) : null;
    const toggle = () => { state.openCards.has(x.id) ? state.openCards.delete(x.id) : state.openCards.add(x.id); render(); };
    return h("div", { class: `kc${ws.length ? " live" : ""}${opened ? "" : " compact"}`, role: "button", tabindex: "0", "aria-expanded": String(opened), dataset: { id: x.id }, onclick: toggle, onkeydown: (e) => e.key === "Enter" && toggle() },
      h("span", { class: "t", style: opened ? "" : "color:var(--text)" }, h("b", { style: "font-weight:600;margin-right:6px" }, x.id.replace(/^[A-Z]+-/, "")), x.title),
      opened
        ? [
            h("span", { class: "m" }, h("span", null, owner(x)), waits, cs.length ? h("span", null, `${cs.length} commit${cs.length > 1 ? "s" : ""} on main`) : null),
            moved ? h("span", { class: "overlay" }, `board says ${x.status} until the session closes`) : null,
            state.openCards.has(x.id) && x.desc ? h("span", { class: "m", style: "display:block" }, x.desc.replace(/^## What\s*/, "")) : null,
            state.openCards.has(x.id) && x.ac.length ? h("span", { class: "m" }, `Acceptance: ${x.ac.filter((a) => a[0]).length} of ${x.ac.length} met`) : null,
          ]
        : cs.length ? h("span", { class: "m" }, `${cs.length} commit${cs.length > 1 ? "s" : ""} on main`) : waits ? h("span", { class: "m" }, waits) : null,
      ws.map((w) => agentTag(w, false, m)));
  };
  const lanes = lanesOf(b, m, inc).map((l) => {
    const cells = Object.fromEntries(cols.map((c) => [c.key, []]));
    for (const id of l.ids) cells[column(m.byId.get(id))].push(card(m.byId.get(id)));
    return { ...l, cells };
  });
  const ws = m.runningOnInc(inc.id), onFeature = ws.filter((w) => refsOf(w).includes(inc.id));
  return [
    bar(key),
    h("div", { class: "bar-row" },
      h("label", { for: "inc-pick", class: "muted" }, "Feature"),
      h("select", { id: "inc-pick", onchange: (e) => { state.inc = e.target.value; render(); } }, (open.includes(inc) ? open : [inc, ...open]).map((x) => h("option", { value: x.id, selected: x.id === inc.id || null }, `${x.id} · ${x.title.slice(0, 70)}`))),
      h("span", { class: "muted" }, `${inc.milestone ? m.milestone(inc.milestone) : "no release"} · ${ks.filter((k) => m.settled(k.status)).length} of ${ks.length} built · ${ws.length ? `${ws.length} agent${ws.length > 1 ? "s" : ""} on it now` : "nobody on it now"}`)),
    details("feature-desc", { class: "card" }, h("summary", { style: "margin:0;color:var(--text);font-weight:600" }, inc.title),
      inc.desc ? h("div", { class: "sub" }, inc.desc.replace(/^## What\s*/, "")) : null,
      inc.ac.length ? h("ol", { class: "ac", style: "font-size:13px" }, inc.ac.map(([on, t]) => h("li", null, on ? "✓ " : "", t))) : null),
    onFeature.length ? h("div", { class: "card" }, h("div", { class: "muted", style: "margin-bottom:6px" }, "On the feature as a whole"), onFeature.map((w) => agentTag(w, true, m))) : null,
    board(cols, lanes),
    h("p", { class: "note" }, "Click a task to open it. Tasks with an agent on them stay open, and the agent links to its context per call. A task's build:<n> label puts it in a build; without one, the build whose workers had it as their task."),
  ];
}

// ---------- The steps view: a feature in the service, its sessions, outcomes and tasks (BOB-4) ----------

/** "<project>/<ref>" → { item, history, tasks, sessions, error }: read when opened, refetched on board_changed. */
const feats = new Map();
const featLoading = new Set(), featAgain = new Set();

async function loadFeature(key, ref) {
  const id = `${key}/${ref}`;
  if (featLoading.has(id)) return void featAgain.add(id);
  featLoading.add(id);
  try {
    const [got, tasks] = await Promise.all([
      boardOp({ op: "get", project: key, ref, history: true, with_tasks: true }),
      listAll({ op: "list", project: key, of: "tasks", feature: ref }, "items"),
    ]);
    const sessions = await Promise.all(got.item.sessions.map(({ feature, kind, label }) => boardOp({ op: "get", project: key, session: { feature, kind, label }, ctx: true }).then((r) => r.session)));
    sessions.sort((a, b) => a.started_at.localeCompare(b.started_at));
    feats.set(id, { item: got.item, history: got.history ?? [], tasks, sessions, error: null });
  } catch (err) {
    feats.set(id, { ...(feats.get(id) ?? { item: null, history: [], tasks: [], sessions: [] }), error: err.message });
  } finally {
    featLoading.delete(id);
  }
  if (viewName() === "feature") scheduleRender();
  if (featAgain.delete(id)) await loadFeature(key, ref);
}

/** `#feature/<project>/<id>`; a bare `#feature/<id>` finds its project by prefix, or draft prefix (Toad, BOB-3 finding 2). */
function featureRoute() {
  const [, a, b] = hashPath();
  const ps = svc.projects ?? [];
  if (b) { const p = ps.find((x) => x.key === a); return p ? { p, ref: b } : null; }
  if (!a) return null;
  const p = ps.find((x) => a.startsWith(`${x.prefix}-`)) ?? ps.find((x) => x.draft_prefix && a.startsWith(`${x.draft_prefix}-`));
  return p ? { p, ref: a } : null;
}
/** A feature's link: with its project when its board is in the service. */
const featureHref = (key, ref) => (knownProjects().some((p) => p.key === key) ? `#feature/${key}/${ref}` : `#feature/${ref}`);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MON[d.getMonth()]}`; };
/** "15 Nov 04:42" */
const stamp = (iso) => `${day(iso)} ${clock(iso)}`;
/** "15 Nov 05:31 – 06:10 · 39 min"; running: "since 15 Nov 05:31 · 39 min". */
function span(a, b) {
  if (!b) return `since ${stamp(a)} · ${since(a)}`;
  return `${stamp(a)} – ${day(a) === day(b) ? clock(b) : stamp(b)} · ${duration(Date.parse(b) - Date.parse(a))}`;
}
const sessionKey = (ss) => `${ss.feature} ${ss.kind} ${ss.label}`;
const stepId = (ss) => `step-${ss.kind}-${ss.label}`.replace(/\W+/g, "-");
/** A <details> open by default (or not) until Casper opens or shuts it; then as he left it. */
function fold(key, dflt, attrs, ...children) {
  const d = h("details", { ...attrs, open: (state.folds.get(key) ?? dflt) || null }, ...children);
  d.addEventListener("toggle", () => state.folds.set(key, d.open));
  return d;
}

/** A session's runs: the board's, with the snapshot's live numbers for those still running, and live workers the board hasn't yet. */
function runsOf(key, ss) {
  const live = new Map(workers().filter((w) => w.project === key && w.session === sessionKey(ss) && (ACTIVE.includes(w.state) || w.ended_at)).map((w) => [w.id, w]));
  const out = ss.runs.map((r) => {
    const w = live.get(r.id);
    live.delete(r.id);
    return w && !r.ended_at ? { ...r, name: r.agent, tokens: workerTokens(w), calls: w.calls ?? r.calls, ctx: w.ctx?.length ? w.ctx : r.ctx } : { ...r, name: r.agent, tokens: totalTokens(r.tokens) };
  });
  for (const w of live.values()) out.push({ id: w.id, name: w.name, role: w.role, model: w.model, laptop: w.laptop, started_at: w.started_at, resumed: false, tokens: workerTokens(w), calls: w.calls ?? 0, ctx: w.ctx ?? [], tasks: refsOf(w) });
  return out.sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
}

/** The CI and slot runs an agent or session waits on now: running or queued, or failed and not run again since (notes 44-48). */
function waitingRuns(ss) {
  const runs = ss.ci_runs ?? [];
  return runs.filter((c) => c.status === "running" || c.status === "queued" || (c.status === "failed" && !runs.some((d) => d !== c && d.name === c.name && d.source === c.source && (d.started_at ?? "") > (c.started_at ?? ""))));
}
/** A run line: "Waiting on CI · 12 min · CI › e2e #4812 ↗ · source · usually about N min" (spec: Waiting on a run). */
function runLine(c) {
  const ms = c.started_at ? Date.now() - Date.parse(c.started_at) : 0;
  const long = c.status === "running" && c.usual_ms && ms > c.usual_ms * 1.5;
  const slot = c.source === "slot";
  const name = slot ? h("span", { class: "run-link" }, `run slot on ${c.laptop ?? "a laptop"}: `, h("b", null, c.name)) : c.url ? h("a", { class: "run-link", href: c.url, target: "_blank", rel: "noopener" }, `CI › ${c.name} ↗`) : h("span", { class: "run-link" }, `CI › ${c.name}`);
  const head = c.status === "failed" ? "CI failed" : c.status === "queued" ? (slot ? "Queued for the run slot" : "Queued on CI") : slot ? "Waiting on a run" : "Waiting on CI";
  return h("div", { class: `runw${long ? " long" : ""}${c.status === "failed" ? " failed" : ""}${c.status === "queued" ? " queued" : ""}` }, h("i", { class: "ring", "aria-hidden": "true" }),
    h("span", null, h("b", null, slot && c.status === "failed" ? "Run failed" : head), c.started_at ? [" · ", ago(c.started_at)] : null, " · ", name,
      h("span", { class: "muted" }, slot ? "" : ` · ${[c.source, c.repo, c.branch].filter(Boolean).join(", ")}`),
      c.usual_ms ? h("span", { class: "muted" }, ` · ${long ? "running long, " : ""}usually about ${Math.max(1, Math.round(c.usual_ms / 60_000))} min`) : null));
}

/** An agent's state for its line: what it waits on, or quiet, or working (spec, BOB-3 gap 2). */
function agentState(w, run) {
  if (run) return { text: run.status === "failed" ? "CI failed" : run.source === "slot" ? "waiting on a run" : "waiting on CI", cls: "run" };
  const p = pendingAll().find((x) => x.worker_id === w.id);
  if (p && p.tier === "human") return { text: "waiting on you", cls: "warn" };
  if (p) return { text: `waiting on ${waitsOnName(w)}`, cls: "muted" };
  if (w.state !== "running") return { text: waitingText(w), cls: "warn" };
  const q = quietMinutes(w);
  if (q >= QUIET_MIN) return { text: `quiet ${q} min`, cls: "warn", title: "No activity from it in that long. Nothing interrupts it: stop or reset it if it's stuck." };
  return { text: "working", cls: "" };
}
const leadName = (key) => { const l = knownProjects().find((p) => p.key === key)?.lead; return l ? shortName(l) : "the orchestrator"; };

/**
 * An agent's line that opens its detail row (spec, BOB-3 gap 2): one open at a time. `lead`: what
 * leads the line; `ctx`: what Context per call does, or null; `place`: which of its lines this is.
 */
function agentLine(w, lead, rest, ctx, place = "") {
  // The same agent shows in On it now and on its session's card: each line opens on its own.
  const key = `${place}${w.id}`, open = state.agentOpen === key;
  const toggle = () => { state.agentOpen = open ? null : key; render(); };
  return h("li", { class: `a-line${open ? " open" : ""}`, dataset: { state: w.state, worker: w.id } },
    h("div", { class: "a-btn", role: "button", tabindex: "0", "aria-expanded": String(open), onclick: (e) => { if (!e.target.closest("a")) toggle(); }, onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle()) }, lead, rest),
    open ? agentDetail(w, ctx) : null);
}

function agentDetail(w, ctx) {
  const asks = pendingAll().filter((x) => x.worker_id === w.id);
  const p = asks.find((x) => x.tier !== "human"), mine = asks.find((x) => x.tier === "human");
  return h("div", { class: "a-detail" },
    h("span", { class: "muted" }, `${fmtModel(w)} · ${w.laptop} · worked ${since(w.started_at)} · context ${w.calls ? `${fmtTokens(w.context ?? 0)} · ${w.calls} calls` : "–"}`),
    w.checkpoint ? h("div", { class: "checkpoint" }, w.checkpoint) : null,
    spawnedLine(w),
    p ? askOf(w, p) : null,
    // Casper's own is answered on Needs you.
    mine ? h("div", { class: "ask-h" }, h("b", null, askTitle(mine)), h("span", { class: "muted" }, " · ", ago(mine.created_at), " · "),
      h("a", { href: "#needs", onclick: () => (scrollAfter = `w-${permId(mine)}`) }, "on Needs you →")) : null,
    h("div", { class: "actions" },
      w.remote_url ? h("a", { href: w.remote_url, target: "_blank", rel: "noopener", title: "Follow it and type to it in Claude" }, "Open in Claude ↗") : null,
      itsSession(w),
      ctx ? h("button", { type: "button", class: "ctx-btn", onclick: ctx }, "Context per call") : null),
    // Two groups, never Stop beside Deny (spec, BOB-4 as built).
    h("div", { class: "actions groups" },
      p ? h("span", { class: "grp" },
          button("Allow", "primary", (b) => act(p.laptop, { kind: "answer", request: p.id, decision: "allow" }, b)),
          button("Deny", "danger", (b) => act(p.laptop, { kind: "answer", request: p.id, decision: "deny" }, b))) : null,
      h("span", { class: "grp" },
        button("Stop", "danger", (b) => act(w.laptop, { kind: "stop", worker: w.id }, b, `Stop ${w.name} (${w.id})? It is interrupted, then ended.`)),
        button("Reset", "", (b) => act(w.laptop, { kind: "reset", worker: w.id }, b, `Reset ${w.name} (${w.id})? It is stopped and a fresh worker starts the same task with no prior context.`)))));
}
/** "Marvin asks", "Howard wants Bash". */
const askTitle = (p) => (p.kind === "question" ? `${p.name} asks` : `${p.name} wants ${p.tool}`);
/** Who answers a worker's request: "Helix's lead, Picard, answers", or whoever spawned it from another laptop. */
function whoAnswers(w) {
  const lead = knownProjects().find((x) => x.key === w.project)?.lead;
  return w.remote_by || !lead ? `${waitsOnName(w)} answers` : `${projectName(w.project)}'s lead, ${shortName(lead)}, answers`;
}
/** A worker's request that its lead answers, whole on the agent's row (BOB-51 AC1): folded to its first question until Show all. */
function askOf(w, p) {
  const id = permId(p), open = state.whole.has(id), qs = p.ask?.questions ?? [];
  // An option or a second question is always more; a long text is measured (measureAsks).
  const more = qs.length > 1 || qs.some((q) => q.options.length);
  return [
    h("div", { class: "ask-h" }, h("b", null, askTitle(p)), h("span", { class: "muted" }, " · ", ago(p.created_at), ` · ${whoAnswers(w)}`)),
    askBlock(p, open),
    p.ask ? h("button", { type: "button", class: "more-t ask-more", hidden: !(open || more) || null, "aria-expanded": String(open), onclick: (e) => { e.stopPropagation(); toggleWhole(id); } }, open ? "Show less" : "Show all") : null,
    open && qs.length ? h("p", { class: "note later" }, "Picking an option here is BOB-161, planned for later. Today Allow and Deny override the lead.") : null,
  ];
}
/** What a request asks, as its laptop sent it: a command, or each question with its header, how many to pick and the options. Read only. Without it, the preview. */
function askBlock(p, open) {
  const a = p.ask;
  if (!a) return h("div", { class: "ask" }, h("code", { class: "preview" }, p.preview));
  const many = a.questions.length > 1;
  return h("div", { class: `ask${open ? "" : " folded"}` },
    a.questions.length ? (open ? a.questions : a.questions.slice(0, 1)).map((q, i) => h("div", { class: "aq" },
      q.header ? h("span", { class: "hd" }, many ? `${i + 1} · ${q.header}` : q.header) : null,
      h("div", { class: "qt" }, q.question),
      open && q.options.length ? [h("span", { class: "pick" }, q.multi ? "Pick any" : "Pick one"),
        h("ul", { class: "opts" }, q.options.map((o) => h("li", null, h("span", { class: "lb" }, o.label), o.description ? h("span", { class: "ds" }, o.description) : null)))] : null))
      : h("code", { class: "preview" }, a.text),
    a.cut ? h("span", { class: "cutnote" }, "Cut at the laptop: too long to send whole.") : null);
}
/** After each draw and on resize: a folded ask whose text is clamped has more to show. */
function measureAsks() {
  for (const el of document.querySelectorAll(".ask.folded")) {
    const t = el.querySelector(".qt, .preview"), more = el.parentElement.querySelector(".ask-more");
    if (more?.hidden && t && t.scrollHeight > t.clientHeight + 1) more.hidden = false;
  }
}
/** Its session's card, on its feature's page. */
function itsSession(w) {
  const ss = sessionOf(w);
  if (!ss || !knownProjects().some((p) => p.key === w.project)) return null;
  const [kind, ...label] = ss.label.split(" "), step = stepId({ kind, label: label.join(" ") }), href = featureHref(w.project, ss.feature);
  // Already on that page, no page change will bring it into view.
  return h("a", { href, onclick: () => { if (location.hash === href) $(step)?.scrollIntoView({ block: "start" }); else scrollAfter = step; } }, "Its session →");
}
/** "spawned by poe@mbp-1", for a worker spawned from another laptop (BOB-44): who answers its requests and gets its result. */
function spawnedLine(w) {
  const by = spawnerOf(w);
  return by && by.slice(by.indexOf("@") + 1) !== w.laptop ? h("div", { class: "muted spawned" }, `spawned by ${by}`) : null;
}
const stateSpan = (st) => h("span", { class: `a-st ${st.cls}`, title: st.title ?? null }, st.text);
/** Opens a session card's context panel on an agent: on this page, or on its feature's. */
function openCtx(key, feature, session, agent) {
  state.ctxOpen.set(`${key}/${session}`, { agent });
  const to = featureHref(key, feature);
  if (location.hash !== to) location.hash = to;
  else render();
}

/** What the feature's state calls for next (steps-view 5): what waits on Casper, else the session that follows the last. */
function nextOf(p, f, sessions) {
  // A Done feature has no Next: the chain ends on its last session (spec, BOB-4 as built 1).
  if (f.status === "Done") return null;
  const waits = (ov.waits ?? []).filter((w) => w.project === p.key && (w.feature === f.ref || w.holds.items.includes(f.ref) || w.holds.sessions.some((s) => s.feature === f.ref) || w.waiting_sessions.some((s) => s.feature === f.ref)));
  if (waits.length) return { wait: waits[0], more: waits.length - 1, you: true };
  if (f.status === "Draft") return { text: `${poOf(p)} makes it Ready` };
  const last = sessions.at(-1);
  if (!last) return { text: "a design session" };
  const after = { design: "a build session", build: "a review session", retro: "nothing more on this feature" }[last.kind]
    ?? (last.close && (last.close.majors.length || last.close.blockers.length || last.close.sent_back.length) ? "a build session for the fixes" : `${poOf(p)}'s acceptance`);
  if (!last.close) return { text: after, when: `once ${stepName(last)} closes` };
  if (last.close.need !== "none") return { text: `${stepName(last)} waits on ${last.close.need === "casper" ? "you" : "an answer"}`, refs: last.close.waits_on, you: last.close.need === "casper" };
  return { text: after };
}

function viewServiceFeature(p, ref) {
  const data = svc.roadmaps.get(p.key);
  if (!data && !svc.loading.has(p.key)) loadRoadmap(p.key);
  const id = `${p.key}/${ref}`, fd = feats.get(id);
  if (!fd && !featLoading.has(id)) loadFeature(p.key, ref);
  if (!ov.waits && !ov.loading && !ov.error) loadOverview();
  if (!data || (!fd?.item && !fd?.error)) return [h("div", { class: "empty-card" }, "Reading the board…")];
  const f = data.features.find((x) => x.ref === ref || x.ref === fd?.item?.ref);
  if (!f) return [h("div", { class: "empty-card" }, `No feature ${ref} in ${p.name}.`)];
  if (!fd.item) return [h("div", { class: "banner down" }, h("b", null, "Board unavailable"), h("span", null, fd.error))];
  const r = data.releases.find((x) => x.ref === f.release);
  const n = data.features.filter((x) => x.release === f.release).indexOf(f) + 1;
  const st = featureState(f), on = onFeature(p.key, f.ref);
  const { checked, total } = f.progress;
  const sessions = fd.sessions;
  const tasks = fd.tasks;
  const nx = nextOf(p, f, sessions);
  // A task some session moved, or a running agent is on, is in a session; the rest are in none yet.
  const touched = new Set([...sessions.flatMap((ss) => ss.tasks_moved.map((m) => m.task)), ...on.flatMap(refsOf)]);
  const loose = tasks.filter((t) => !touched.has(t.ref));
  const runOf = (w) => sessions.flatMap(waitingRuns).find((c) => c.worker === w.id) ?? null;
  const picks = [...svc.roadmaps.entries()].flatMap(([k, d]) => d.features.filter((x) => x.status !== "Done" && (x.open_since || x.status === "Ready")).map((x) => [k, x]));
  if (!picks.some(([, x]) => x === f)) picks.unshift([p.key, f]);
  for (const q of svc.projects) if (!svc.roadmaps.has(q.key) && !svc.loading.has(q.key)) loadRoadmap(q.key);
  return [
    h("div", { class: "bar-row" },
      h("label", { for: "feat-pick", class: "muted" }, "Feature"),
      h("select", { id: "feat-pick", onchange: (e) => (location.hash = `#feature/${e.target.value}`) },
        picks.map(([k, x]) => h("option", { value: `${k}/${x.ref}`, selected: x === f || null }, `${x.ref} · ${x.title.slice(0, 60)}`)))),
    h("div", { class: "feat" },
      h("div", { class: `card feature-head${st === "open" ? " is-open" : ""}`, id: "feature-head" },
        h("div", { class: "fh-top" }, h("span", { class: "id" }, f.ref), h("span", { class: "muted" }, `${p.name} · ${r ? `${r.title} · number ${n}` : "not in a release"}`), badge(st)),
        h("h2", null, f.title),
        h("div", { class: "fh-m" },
          total ? h("div", { class: "crit" }, meterOf(checked, total, st === "done" ? "idle" : "ok"), h("span", { class: "m" }, `${checked} of ${total} criteria`)) : h("span", { class: "muted" }, "no criteria yet"),
          f.status === "Done" && total && checked < total ? h("span", { class: "sub-note" }, "Done, criteria not ticked") : null,
          h("span", null, f.tasks?.total ? `${f.tasks.done} of ${f.tasks.total} tasks done` : h("span", { class: "muted" }, "no tasks")),
          h("span", null, plural(sessions.length, "session")),
          on.length ? h("span", { class: "now" }, "● ", whoNames(on), " on it now") : st === "open" ? h("span", { class: "muted" }, "nobody on it now") : null)),
      fd.error ? h("div", { class: "banner down" }, h("b", null, "Board unavailable"), h("span", null, `Showing what it last said. ${fd.error}`)) : null,
      nx ? nextBanner(nx) : null,
      on.length ? h("section", { class: "card on-now", id: "on-now" }, h("h2", { style: "margin:0" }, "On it now"),
        h("ul", { class: "lines" }, on.map((w) => {
          const ss = sessions.find((x) => sessionKey(x) === w.session), run = runOf(w);
          return agentLine(w, agentWho(w, agentState(w, run)),
            [h("span", { class: "l-m" }, ss ? `${stepName(ss)} › ` : "", taskRefs(w, f, tasks)), run ? runLine(run) : null],
            ss ? () => openCtx(p.key, f.ref, sessionKey(ss), w.name) : null);
        }))) : null,
      h("div", { class: "two" },
        h("section", { class: "chain" }, h("h2", null, "Sessions, in the order they ran"),
          sessions.length || nx
            ? h("ol", { class: "steps" }, sessions.map((ss, i) => stepItem(p, f, ss, sessions, tasks, i === sessions.length - 1, runOf)), nx ? nextItem(nx) : null)
            : h("div", { class: "empty-card" }, "No session has run on this feature yet.")),
        h("aside", null, h("h2", null, "Tasks ", h("span", { class: "count" }, tasks.length || "")),
          loose.length ? h("div", { class: "card loose" }, h("div", { class: "muted" }, "In no session yet"), h("ul", { class: "tasks" }, loose.map((t) => taskLi(p.key, t, t.status, true, false, runOf)))) : null,
          tasks.length
            ? fold(`all-tasks:${id}`, window.innerWidth >= 1100, { class: "card", id: "all-tasks" }, h("summary", null, `All ${tasks.length}, as the board has them now`), h("ul", { class: "tasks" }, tasks.map((t) => taskLi(p.key, t, t.status, true, true, runOf))))
            : h("div", { class: "empty-card" }, "No tasks on this feature.")),
        historySection(p, f, fd))),
    h("p", { class: "note" }, h("a", { href: `#roadmap/${p.key}` }, `${p.name}'s roadmap`), ". Sessions and their outcomes are read from the board's session closes; who is on what, from what each agent's spawn declared."),
  ];
}

const agentWho = (w, st) => h("span", { class: "l-who" }, h("i", { class: `dot ${st.cls === "warn" ? "warn" : st.cls === "run" ? "run" : "on"}`, "aria-hidden": "true" }), whoName(w), h("span", { class: "muted" }, ` ${w.role} · `), stateSpan(st), h("span", { class: "muted" }, ` · ${fmtTokens(workerTokens(w))} tokens`));
/** The tasks an agent's spawn named, with their titles; the feature itself is no task. */
const taskRefs = (w, f, tasks) => refsOf(w).filter((r) => r !== f.ref).map((r, i) => [i ? h("span", { class: "muted tsep" }, " · ") : null, h("span", { class: "tref" }, h("span", { class: "id" }, r), tasks.find((t) => t.ref === r)?.title ?? "")]);

/** Amber means "you" (spec, BOB-4 as built 1): the next step is amber only when it waits on Casper, else accent. */
function nextBanner(nx) {
  const go = (e) => { e.preventDefault(); $("next")?.scrollIntoView({ block: "center" }); };
  const cls = `banner next-banner${nx.you ? " you" : ""}`;
  return nx.wait
    ? h("a", { href: "#", class: cls, onclick: go }, h("b", null, "Next: waits on you"), h("span", null, `${nx.wait.ref} · ${nx.wait.text}`))
    : h("a", { href: "#", class: cls, onclick: go }, h("b", null, "Next"), h("span", null, nx.text, nx.when ? h("span", { class: "muted" }, `, ${nx.when}`) : null, nx.refs?.length ? ` (${nx.refs.join(", ")})` : ""));
}

function nextItem(nx) {
  const w = nx.wait;
  return h("li", { class: `step next${nx.you ? " you" : ""}`, id: "next" }, h("span", { class: "dot2", "aria-hidden": "true" }),
    h("div", { class: "card" },
      h("div", { class: "top" }, h("span", { class: "kind" }, "Next"), h("b", null, w ? "Waits on you" : nx.text)),
      w ? [h("div", null, h("span", { class: "id" }, w.ref), " ", h("b", null, w.text)),
          w.recommended ? h("div", { class: "sub" }, "Recommended: ", w.recommended.text) : null,
          w.edits?.length ? h("div", { class: "meta" }, editsOf(w, "item")) : null,
          nx.more ? h("div", { class: "sub muted" }, `and ${nx.more} more waiting on you for this feature`) : null]
        : [nx.when ? h("div", { class: "sub muted" }, nx.when[0].toUpperCase() + nx.when.slice(1)) : null, nx.refs?.length ? h("div", { class: "sub" }, `Waits on ${nx.refs.join(", ")}`) : null]));
}

/** A task's row: id, title, status, criteria now, and the agents on it now (steps-view 4, 8). */
function taskLi(key, t, status, withSession, anchor = false, runOf = () => null) {
  const ws = running().filter((w) => w.project === key && refsOf(w).includes(t.ref));
  const { checked, total } = t.progress;
  return h("li", { class: ws.length ? "on" : null, id: anchor ? `task-${t.ref}` : null }, h("span", { class: "id" }, t.ref), h("span", { class: "tt", title: t.title }, t.title),
    badge(status === "In Review" ? "in review" : status === "In Progress" ? "running" : status.toLowerCase(), status), h("span", { class: "ac" }, total ? `${checked}/${total}` : "–"),
    // One state per agent: the same state, dot and colour as On it now (spec, BOB-4 as built).
    ws.length ? h("span", { class: "on-it" }, ws.map((w) => { const s = agentState(w, runOf(w)); return h("span", { class: "who", dataset: { state: s.text } }, h("i", { class: `dot ${s.cls === "warn" ? "warn" : s.cls === "run" ? "run" : "on"}`, "aria-hidden": "true" }), whoName(w), ` ${w.role} · `, stateSpan(s), ` · ${fmtTokens(workerTokens(w))} tokens`, withSession && sessionOf(w) ? ` · ${declaredStep(w)}` : ""); })) : null);
}

function stepItem(p, f, ss, sessions, tasks, last, runOf) {
  const agents = inSession(p.key, ss);
  const c = ss.close;
  const st = c ? "closed" : agents.some((w) => w.state === "running") ? "running" : "waiting";
  const byRef = new Map(tasks.map((t) => [t.ref, t]));
  const runs = runsOf(p.key, ss);
  const calls = runs.reduce((n, r) => n + (r.ctx?.length || r.calls || 0), 0);
  // Running: the tasks its agents' spawns named, then any it moved; closed: those it moved, with the status it left them in.
  const on = st === "running" ? [...new Set([...agents.flatMap(refsOf), ...ss.tasks_moved.map((m) => m.task)])].filter((r) => byRef.has(r)) : [];
  const moved = st === "running" ? on.map((r) => taskLi(p.key, byRef.get(r), byRef.get(r).status, false, false, runOf)) : ss.tasks_moved.filter((m) => byRef.has(m.task)).map((m) => taskLi(p.key, byRef.get(m.task), m.status, false, false, runOf));
  const closedN = ss.tasks_moved.filter((m) => m.status === "Done").length;
  const rc = runs.find((r) => r.remote_url)?.remote_url ?? agents.find((w) => w.remote_url)?.remote_url;
  const panelKey = `${p.key}/${sessionKey(ss)}`;
  const hand = state.open.has(`handoff:${panelKey}`);
  const repo = svc.projects.find((x) => x.key === p.key)?.repos?.[0];
  const loose = waitingRuns(ss).filter((r) => !agents.some((w) => w.id === r.worker));
  return h("li", { class: "step", id: stepId(ss), dataset: { kind: ss.kind, state: st } }, h("span", { class: "dot2", "aria-hidden": "true" }),
    h("div", { class: "card" },
      h("div", { class: "top" }, h("span", { class: "kind" }, ss.kind), h("b", null, ss.label), h("span", { class: "when" }, span(ss.started_at, ss.ended_at)), badge(st)),
      c ? h("div", { class: "outcome" },
        h("span", { class: "need", dataset: { need: c.need } }, `need: ${c.need}`, c.waits_on.length ? ` (${c.waits_on.join(", ")})` : ""),
        h("span", null, `${plural(c.blockers.length, "blocker")} · ${plural(c.majors.length, "major")}`),
        c.minors_fixed ? h("span", null, `${plural(c.minors_fixed, "minor")} fixed`) : null,
        c.sent_back.length ? h("span", null, `${c.sent_back.length} sent back`) : null,
        h("span", null, closedN ? `closed ${plural(closedN, "task")}` : `moved ${plural(ss.tasks_moved.length, "task")}`),
        h("span", { class: "muted" }, `${fmtTokens(totalTokens(ss.tokens))} tokens`)) : null,
      agents.length ? h("ul", { class: "lines s-agents" }, agents.map((w) => {
        const run = runOf(w);
        return agentLine(w, agentWho(w, agentState(w, run)),
          [h("span", { class: "l-m" }, taskRefs(w, f, tasks)), run ? runLine(run) : null, w.checkpoint ? h("span", { class: "l-m cp" }, w.checkpoint) : null],
          () => openCtx(p.key, f.ref, sessionKey(ss), w.name), "step:");
      })) : null,
      loose.map(runLine),
      c?.summary ? h("div", { class: "sub" }, c.summary) : null,
      h("div", { class: "links" },
        c?.handoff_text ? h("button", { type: "button", class: "ctx-btn", "aria-expanded": String(hand), title: c.handoff_path ?? "", onclick: () => { hand ? state.open.delete(`handoff:${panelKey}`) : state.open.add(`handoff:${panelKey}`); render(); } }, "Handoff")
          : c?.handoff_path ? h("span", { class: "off", title: c.handoff_path }, "Handoff on its laptop") : h("span", { class: "off" }, "No handoff"),
        c?.commit ? (repo ? h("a", { href: `https://github.com/${repo}/commit/${c.commit}`, target: "_blank", rel: "noopener" }, `Close ${c.commit.slice(0, 7)} ↗`) : h("span", null, `Close ${c.commit.slice(0, 7)}`)) : null,
        rc ? h("a", { href: rc, target: "_blank", rel: "noopener" }, "Remote Control ↗") : null,
        h("button", { type: "button", class: "ctx-btn", "aria-expanded": String(state.ctxOpen.has(panelKey)), onclick: () => { state.ctxOpen.has(panelKey) ? state.ctxOpen.delete(panelKey) : state.ctxOpen.set(panelKey, { agent: null }); render(); } }, `Context per call · ${plural(calls, "call")}`)),
      hand ? h("pre", { class: "handoff" }, c.handoff_text) : null,
      state.ctxOpen.has(panelKey) ? ctxPanel(p.key, ss, sessions, runs, panelKey) : null,
      moved.length ? fold(`moved:${panelKey}`, last, { class: "moved" }, h("summary", null, st === "running" ? `Tasks it is on (${moved.length})` : `Tasks it moved (${moved.length})`), h("ul", { class: "tasks" }, moved)) : null));
}

/** Context per call inside a session card (notes 36-39): the whole session cumulative, or one agent's runs as one line. */
function ctxPanel(key, ss, sessions, runs, panelKey) {
  const pick = state.ctxOpen.get(panelKey).agent;
  const names = [...new Set(runs.map((r) => r.name))];
  const set = (agent) => { state.ctxOpen.set(panelKey, { agent }); render(); };
  const prev = sessions.filter((x) => x.kind === ss.kind && x.started_at < ss.started_at).at(-1);
  const cum = (rs) => { let t = 0; return rs.flatMap((r) => r.ctx ?? []).map((v) => (t += v)); };
  let series, band = null, note;
  if (!pick) {
    series = [{ name: `${stepName(ss)}${ss.close ? "" : " so far"}`, pts: cum(runs), color: "var(--accent)", style: "solid", w: 2.5 },
      prev ? { name: stepName(prev), pts: cum(runsOf(key, prev)), color: "var(--muted)", style: "dash", w: 2 } : null].filter(Boolean);
    note = "Every call in the session, in order, across all its agents, with its context summed. A steeper line means each call carries more context.";
  } else {
    const mine = runs.filter((r) => r.name === pick);
    const line = roleLine(mine);
    const role = mine[0]?.role;
    // Earlier runs of that role on the feature: the middle half and median at each call, once three reach it.
    const earlier = sessions.filter((x) => x.started_at < ss.started_at).flatMap((x) => runsOf(key, x)).filter((r) => r.role === role && r.ctx?.length);
    band = [];
    for (let i = 0; ; i++) { const v = earlier.map((r) => r.ctx[i]).filter((x) => x !== undefined); if (v.length < 3) break; band.push([quantile(v, 0.25), quantile(v, 0.5), quantile(v, 0.75)]); }
    const laps = [...new Set(mine.map((r) => r.laptop).filter(Boolean))];
    series = [{ name: `${pick}, ${stepName(ss)}`, tip: laps.length === 1 ? `${whoText({ name: pick, laptop: laps[0] }, key)}, ${stepName(ss)}` : null, pts: line.pts, resets: line.resets, color: "var(--accent)", style: "solid", w: 2.5 }];
    note = `${pick}'s runs in the session, one after another; a new worker starts again from a small context (dotted). ${band.length ? `The grey band is the middle half of ${earlier.length} earlier ${pick} runs on this feature at the same call.` : `No band: fewer than three earlier ${pick} runs on this feature.`}`;
  }
  const { svg, tip, wrap } = plotChart(series, band?.length ? band : null);
  const key2 = series.map((sr) => h("span", null, h("i", { class: sr.style === "solid" ? "" : sr.style, style: `--k:${sr.color}` }), `${sr.name} · ${sr.pts.length} calls`));
  if (band?.length) key2.push(h("span", null, h("i", { class: "band", style: "--k:var(--idle)" }), "earlier runs, middle half and median"));
  wrap.append(svg, h("div", { class: "key" }, key2), tip);
  const rows = names.map((nm) => {
    const rs = runs.filter((r) => r.name === nm);
    const laps = [...new Set(rs.map((r) => r.laptop).filter(Boolean))];
    return { nm, laptop: laps.length === 1 ? laps[0] : null, model: rs.at(-1)?.model ?? "default", runs: rs.length, calls: rs.reduce((n, r) => n + (r.ctx?.length || r.calls || 0), 0), peak: Math.max(0, ...rs.flatMap((r) => r.ctx ?? [])), tokens: rs.reduce((n, r) => n + r.tokens, 0) };
  });
  const top = Math.max(1, ...rows.map((x) => x.peak));
  return h("div", { class: "ctxp" },
    h("span", { class: "seg" }, h("button", { type: "button", "aria-pressed": String(!pick), onclick: () => set(null) }, "Whole session"), names.map((nm) => h("button", { type: "button", "aria-pressed": String(pick === nm), onclick: () => set(nm) }, nm))),
    wrap, h("p", { class: "note", style: "margin:0" }, note),
    h("div", { class: "table-wrap" }, h("table", { class: "stack ctx-agents" },
      h("thead", null, h("tr", null, h("th", null, "Agent"), h("th", null, "Model"), h("th", { class: "num" }, "Runs"), h("th", { class: "num" }, "Calls"), h("th", { class: "num" }, "Peak context"), h("th", null, ""), h("th", { class: "num" }, "Tokens"))),
      h("tbody", null, rows.map((x) => h("tr", { class: `pick${pick === x.nm ? " sel" : ""}`, tabindex: "0", onclick: () => set(x.nm), onkeydown: (e) => e.key === "Enter" && set(x.nm) },
          h("td", null, whoName({ name: x.nm, laptop: x.laptop }, true, key)), h("td", { "data-label": "Model" }, x.model), h("td", { class: "num", "data-label": "Runs" }, String(x.runs)), h("td", { class: "num", "data-label": "Calls" }, String(x.calls)),
          h("td", { class: "num", "data-label": "Peak" }, fmtTokens(x.peak)), h("td", { class: "bar" }, meterOf(x.peak, top)), h("td", { class: "num", "data-label": "Tokens" }, fmtTokens(x.tokens)))),
        h("tr", { class: "total" }, h("td", null, h("b", null, "Session")), h("td", { "data-label": "Model" }, ""), h("td", { class: "num", "data-label": "Runs" }, String(runs.length)),
          h("td", { class: "num", "data-label": "Calls" }, String(rows.reduce((n, x) => n + x.calls, 0))), h("td", { class: "num", "data-label": "Peak" }, fmtTokens(Math.max(0, ...rows.map((x) => x.peak)))), h("td", { class: "bar" }),
          h("td", { class: "num", "data-label": "Tokens" }, fmtTokens(totalTokens(ss.tokens) || rows.reduce((n, x) => n + x.tokens, 0))))))));
}

// ---------- History: the board's events for a feature, and its tasks' (BOB-14 #5; spec: Feature, History) ----------

const HISTORY_PAGE = 50;
const CRIT = /^(ac|dod) #(\d+) (state|evidence|text)$/;
const actorName = (a) => (a.kind === "owner" ? "Casper" : a.kind === "ci" ? "CI" : a.kind === "board" ? "the board" : shortName(a.who));
/** "Peach, PO"; a role that is only the agent's own name says nothing more. */
function actorWho(a) {
  const nm = actorName(a);
  if (a.kind !== "agent" || !a.role || a.role.toLowerCase() === nm.toLowerCase()) return nm;
  return `${nm}, ${a.role === "po" ? "PO" : a.role}`;
}

/** An event's changes in words, one line each (spec: History, What). */
function changeLines(e, mutedRef) {
  if (e.op === "import") return [];
  if (e.op === "create" || e.op === "capture") return [h("span", null, e.op === "capture" ? "captured" : "created")];
  if (e.op === "archive") return [h("span", null, "archived")];
  if (e.op === "restore") return [h("span", null, "restored")];
  if (e.op === "undo") return [h("span", null, `${actorName(e.actor)} took back ${e.actor.kind === "owner" ? "his" : "the"} change of ${mutedRef ? stamp(mutedRef.at) : `event ${e.undo_of}`}`)];
  const out = [];
  const evidence = new Map(e.changes.filter((c) => CRIT.exec(c.field)?.[3] === "evidence").map((c) => [c.field.replace(/evidence$/, "state"), c.new]));
  for (const c of e.changes) {
    const m = CRIT.exec(c.field);
    if (m) {
      const what = `${m[1] === "ac" ? "criterion" : "DoD"} ${m[2]}`;
      if (m[3] === "state") {
        const ev = evidence.get(c.field);
        out.push(h("span", null, `${what} ${c.new === "checked" ? "checked" : c.new === "open" ? "unchecked" : c.new}`, ev ? h("span", { class: "ev", tabindex: "0", onclick: (x) => x.currentTarget.classList.toggle("all") }, ev) : null));
      } else if (m[3] === "text") out.push(showChange(`${what} changed`, c));
      else if (!e.changes.some((d) => d.field === c.field.replace(/evidence$/, "state"))) out.push(h("span", null, `${what} evidence`, h("span", { class: "ev", tabindex: "0", onclick: (x) => x.currentTarget.classList.toggle("all") }, c.new ?? "–")));
      continue;
    }
    if (["title", "description", "notes", "plan", "casper_words"].includes(c.field)) out.push(showChange(`${c.field.replace("_", " ")} changed`, c));
    else if (c.field === "label") out.push(h("span", null, c.new ? `label ${c.new} added` : `label ${c.old} removed`));
    else if (c.field === "dep") out.push(h("span", null, c.new ? `depends on ${c.new}` : `no longer depends on ${c.old}`));
    else if (c.field === "ord") out.push(h("span", null, "moved in the order"));
    else if (c.field === "open_since") out.push(h("span", null, c.new ? "opened: a session is on it" : "no longer open"));
    else out.push(h("span", null, `${c.field.replace("_", " ")} ${c.old ?? "none"} → ${c.new ?? "none"}`));
  }
  return out.length ? out : [h("span", { class: "muted" }, e.op.replace("_", " "))];
}
/** "title changed", with Show opening old and new, old struck through. */
function showChange(label, c) {
  const d = h("details", { class: "chg" }, h("summary", null, label, " ", h("span", { class: "show" }, "Show")),
    h("del", { class: "muted" }, c.old ?? "–"), h("div", { class: "new" }, c.new ?? "–"));
  return d;
}

function historySection(p, f, fd) {
  const id = `${p.key}/${f.ref}`;
  const hs = state.hist.get(id) ?? { open: false, tasks: false, n: HISTORY_PAGE };
  const set = (x) => { state.hist.set(id, { ...hs, ...x }); render(); };
  const own = fd.history.filter((e) => e.record.table !== "items" || e.record.ref === fd.item.ref);
  const all = fd.history;
  const shown = hs.tasks ? all : own;
  const lines = [...shown].reverse();
  // The folded button counts the feature's own, whichever side was open last (spec, BOB-4 as built 2).
  const head = `History · ${plural(own.length, "change")}${own[0] ? ` since ${day(own[0].at)}` : ""}`;
  if (!hs.open) return h("section", { class: "hist" }, h("button", { type: "button", class: "hist-btn", "aria-expanded": "false", onclick: () => set({ open: true }) }, head));
  const bySeq = new Map(all.map((e) => [e.seq, e]));
  const undone = new Set(all.filter((e) => e.op === "undo" && e.undo_of).map((e) => e.undo_of));
  // With its tasks, the task id gets its own column, as wide as the longest, empty on the feature's own lines (as built 5).
  const idw = Math.max(0, ...all.filter((e) => e.record.table === "items" && e.record.ref !== fd.item.ref).map((e) => e.record.ref.length));
  const toTask = (ref) => (ev) => { ev.preventDefault(); state.folds.set(`all-tasks:${id}`, true); render(); $(`task-${ref}`)?.scrollIntoView({ block: "center" }); };
  const toStep = (ss) => (ev) => { ev.preventDefault(); $(stepId(ss))?.scrollIntoView({ block: "start" }); };
  return h("section", { class: "hist open" },
    h("button", { type: "button", class: "hist-btn", "aria-expanded": "true", onclick: () => set({ open: false }) }, head),
    h("span", { class: "seg" },
      h("button", { type: "button", "aria-pressed": String(!hs.tasks), onclick: () => set({ tasks: false, n: HISTORY_PAGE }) }, `This feature (${own.length})`),
      h("button", { type: "button", "aria-pressed": String(hs.tasks), onclick: () => set({ tasks: true, n: HISTORY_PAGE }) }, `With its tasks (${all.length})`)),
    h("ol", { class: `events${hs.tasks ? " with-tasks" : ""}`, style: hs.tasks ? `--idw:${idw}ch` : null }, lines.slice(0, hs.n).map((e) => {
      if (e.op === "import") {
        const src = /^imported from (.+?) \(/.exec(e.reason ?? "")?.[1] ?? "";
        const sha = /\bat \S+ ([0-9a-f]{7,40})\b/.exec(src)?.[1];
        return h("li", { class: "ev-import muted" }, /^Backlog\.md/.test(src) || !src
          ? `Came over from Backlog.md in the import, ${day(e.at)} ${new Date(e.at).getFullYear()}. Its history before that is in git${sha ? ` (${sha})` : ""}.`
          : `Came over in the import from ${src}, ${day(e.at)} ${new Date(e.at).getFullYear()}.`);
      }
      const ss = e.actor.session;
      const task = e.record.table === "items" && e.record.ref !== fd.item.ref ? e.record.ref : null;
      return h("li", { class: undone.has(e.seq) ? "undone" : null, dataset: { seq: e.seq } },
        h("div", { class: "ev-h" },
          hs.tasks ? h("span", { class: "ev-task" }, task ? h("a", { class: "id", href: "#", onclick: toTask(task) }, task) : null) : null,
          h("span", { class: "ev-at", title: new Date(e.at).toString() }, stamp(e.at)),
          h("span", { class: "ev-who" }, actorWho(e.actor), ss ? [" · ", ss.feature === fd.item.ref ? h("a", { href: "#", onclick: toStep(ss) }, stepName(ss)) : `${ss.feature} ${stepName(ss)}`] : null)),
        h("div", { class: "ev-what" }, changeLines(e, e.undo_of ? bySeq.get(e.undo_of) : null)),
        e.reason ? h("div", { class: "ev-why muted" }, `“${e.reason}”`) : null);
    })),
    lines.length > hs.n ? h("button", { type: "button", class: "more-btn", onclick: () => set({ n: hs.n + HISTORY_PAGE }) }, `Show older (${lines.length - hs.n})`) : null);
}

/** A <details> that stays open or closed across re-renders. */
function details(key, attrs, ...children) {
  const d = h("details", { ...attrs, open: state.open.has(key) || null }, ...children);
  d.addEventListener("toggle", () => (d.open ? state.open.add(key) : state.open.delete(key)));
  return d;
}

/** A project still on its supervisor's Backlog.md board: features in columns by where they stand. */
function viewBacklogRoadmap() {
  const b = current();
  if (!b?.backlog) return [empty(b)];
  const m = backlogModel(b);
  const curInc = m.cur?.name.split(" ")[0];
  const release = state.release ?? m.byId.get(curInc)?.milestone ?? b.backlog.milestones[0]?.id ?? "all";
  const incs = m.items.filter((x) => x.type === "increment" && (release === "all" ? x.status !== "Done" : release === "none" ? !x.milestone : x.milestone === release));
  const column = (x) => {
    if (x.status === "Done") return "accepted";
    const ks = m.kids(x.id);
    if (ks.length && ks.every((k) => m.settled(k.status))) return "review";
    if (m.runningOnInc(x.id).length || ks.some((k) => m.settled(k.status) || k.status === "In Progress")) return "building";
    return x.status === "Ready" ? "ready" : "shaping";
  };
  const cols = [{ key: "shaping", name: "Shaping" }, { key: "ready", name: "Ready" }, { key: "building", name: "Building", live: true }, { key: "review", name: "Awaiting review" }, { key: "accepted", name: "Accepted" }];
  const cells = Object.fromEntries(cols.map((c) => [c.key, []]));
  const accepted = [];
  for (const x of incs) {
    const col = column(x), ks = m.kids(x.id), ws = m.runningOnInc(x.id);
    const openIt = () => { state.inc = x.id; location.hash = "feature"; };
    if (col === "accepted") {
      accepted.push(h("button", { type: "button", class: "kc compact", onclick: openIt }, h("span", null, chip(x.id)), h("span", { class: "t" }, x.title)));
      continue;
    }
    const total = ks.length || b.backlog.done_counts[x.id] || 0;
    const built = ks.filter((k) => m.settled(k.status)).length;
    const sess = b.sessions.filter((ss) => ss.name.startsWith(`${x.id} `) && ss.kind === "build");
    cells[col].push(h("div", { class: `kc${ws.length ? " live" : ""}`, role: "button", tabindex: "0", onclick: openIt, onkeydown: (e) => e.key === "Enter" && openIt() },
      h("span", null, chip(x.id), release === "all" ? h("span", { class: "muted" }, ` ${x.milestone ? m.milestone(x.milestone).split(" ")[0] : "no release"}`) : null),
      h("span", { class: "t" }, x.title),
      total ? h("div", { class: "meter" }, h("i", { class: "ok", style: `width:${(ks.filter((k) => k.status === "Done").length / total) * 100}%` }), h("i", { style: `width:${(ks.filter((k) => k.status === "In Review").length / total) * 100}%` })) : null,
      h("span", { class: "m" }, total ? h("span", null, `${built} of ${total} tasks built`) : h("span", null, "no tasks yet"), sess.length ? h("span", null, `${sess.length} build${sess.length > 1 ? "s" : ""} so far`) : null),
      ws.map((w) => agentTag(w, true, m))));
  }
  cols.find((c) => c.key === "accepted").count = accepted.length;
  if (accepted.length) cells.accepted.push(state.showAccepted ? [...accepted, button("Fold", "", () => { state.showAccepted = false; render(); })] : button(`Show all ${accepted.length}`, "", () => { state.showAccepted = true; render(); }));
  const pick = (v, label) => h("button", { type: "button", "aria-pressed": String(release === v), onclick: () => { state.release = v; render(); } }, label);
  const live = running().filter((w) => w.project === b.project);
  return [
    switchBar(b.project, (k) => `#roadmap/${k}`),
    h("div", { class: "bar-row" }, h("span", { class: "seg" }, ...b.backlog.milestones.map((ms) => pick(ms.id, ms.title)), pick("none", "Not in a release"), pick("all", "All open")),
      h("span", { class: "muted" }, live.length ? `${live.length} agent${live.length > 1 ? "s" : ""} working, shown on their feature` : "No agents working right now")),
    board(cols, [{ cells }]),
    h("p", { class: "note" }, "A feature is Building once any of its tasks is built or has an agent on it, whatever its board status. Open a card for its task board."),
    h("section", null, details("drafts", null, h("summary", null, "Drafts, not yet placed ", h("span", { class: "count" }, b.backlog.drafts.length)),
      h("ul", { class: "feed" }, [...b.backlog.drafts].sort((a, c) => (c.updated ?? "").localeCompare(a.updated ?? "")).map((d) => h("li", null, h("time", null, (d.updated ?? "").slice(5, 10)), h("span", null, h("b", null, d.id), " ", d.title)))))),
  ];
}

// ---------- The board service: the roadmap and Casper's gates ----------

/**
 * Projects whose board is in the service (ADR 0001) read it over the owner's socket; the rest still show
 * their supervisor's Backlog.md board. Casper's gates (board-writes 4, 5; design/BOB-1/spec.md) are his
 * own writes: each saves at once, with Undo in its toast.
 */
/** `projects`: the service's, null until read; `error`: why the last read of them failed. */
const svc = { projects: null, error: null, roadmaps: new Map(), loading: new Set(), again: new Set() };
/** Board operations sent and not yet answered, by rid; a write keeps its frame, to resend under its key. */
const sentOps = new Map();

function boardOp(op, write = false) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Not connected; try again in a moment."));
  const id = String(++rid);
  // A write carries a key, made once per write, so the board takes it once (ADR 0001 §12).
  const frame = JSON.stringify({ t: "board_op", rid: id, op, ...(write ? { key: crypto.randomUUID() } : {}) });
  ws.send(frame);
  return new Promise((resolve, reject) => sentOps.set(id, { resolve, reject, frame: write ? frame : null }));
}

async function listAll(op, field) {
  const out = [];
  let cursor = null;
  do {
    const r = await boardOp(cursor ? { ...op, cursor } : op);
    out.push(...(r[field] ?? []));
    cursor = r.cursor;
  } while (cursor);
  return out;
}

async function loadProjects() {
  try {
    svc.projects = (await boardOp({ op: "projects" })).projects;
    svc.error = null;
    followOldLink();
  } catch (err) {
    // Every view lists by it: a failed read keeps the last list, never an empty one (ADR 0012 §2).
    svc.error = err.message;
  }
  for (const key of svc.roadmaps.keys()) loadRoadmap(key);
  for (const key of backlogs.keys()) loadBacklog(key);
  if (rules.rows || rules.error) loadRules();
  // What waits on Casper counts on the tab, on every view (waiting-on-casper 3).
  // A failed list doesn't hold back the overview and the waits, which are read on their own (BOB-176 m2).
  if (svc.projects?.length || ov.rows || svc.error) loadOverview();
  // The Status tab's dot and the Overview's line read from the start, on every view.
  loadStatus();
  scheduleRender();
}

async function loadRoadmap(key) {
  // A change while it reads: read again once it is done.
  if (svc.loading.has(key)) return void svc.again.add(key);
  svc.loading.add(key);
  try {
    const [releases, features, o] = await Promise.all([listAll({ op: "list", project: key, of: "releases" }, "releases"), listAll({ op: "list", project: key, of: "features" }, "items"), boardOp({ op: "overview", project: key })]);
    // Backlog items in no release: a broker before BOB-3 doesn't count them, and the line is left out (spec: Roadmap).
    svc.roadmaps.set(key, { releases, features, none: o.projects[0]?.no_release ?? null, error: null });
  } catch (err) {
    svc.roadmaps.set(key, { ...(svc.roadmaps.get(key) ?? { releases: [], features: [] }), error: err.message });
  } finally {
    svc.loading.delete(key);
  }
  if (viewName() === "roadmap" || viewName() === "feature") scheduleRender();
  if (svc.again.delete(key)) await loadRoadmap(key);
}

/** `#roadmap/<project>[/edit]`, or the project last picked on a page, when its board is in the service; null for a Backlog.md one. */
function roadmapRoute() {
  const [, key, mode] = hashPath();
  const keys = (svc.projects ?? []).map((p) => p.key);
  const edit = mode === "edit";
  if (keys.includes(key)) return { key, edit };
  if (keys.includes(state.project)) return { key: state.project, edit };
  if (current()?.backlog || !keys.length) return null;
  return { key: keys[0], edit };
}

function viewRoadmap() {
  const route = roadmapRoute();
  return route ? viewBoardRoadmap(route.key, route.edit) : viewBacklogRoadmap();
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const badge = (st, text = st) => h("span", { class: "badge", dataset: { state: st } }, text);
const meterOf = (done, total, cls = "ok") => h("div", { class: "meter", role: "img", "aria-label": `${done} of ${total}` }, h("i", { class: cls, style: `width:${total ? (done / total) * 100 : 0}%` }));
/** "1–19, 21–22" */
function ranges(ns) {
  const out = [];
  let a = null, b = null;
  for (const n of ns) {
    if (a !== null && n === b + 1) b = n;
    else { if (a !== null) out.push(a === b ? `${a}` : `${a}–${b}`); a = b = n; }
  }
  if (a !== null) out.push(a === b ? `${a}` : `${a}–${b}`);
  return out.join(", ");
}
/** open: a session is on it (the board's open feature) and it isn't Done (notes 15). */
const featureState = (f) => (f.status === "Done" ? "done" : f.open_since ? "open" : f.status.toLowerCase());
const poOf = (p) => (p?.po ? shortName(p.po) : "the project's PO");

function viewBoardRoadmap(key, edit) {
  const p = svc.projects.find((x) => x.key === key);
  const data = svc.roadmaps.get(key);
  if (!data && !svc.loading.has(key)) loadRoadmap(key);
  const to = (k, e) => `#roadmap/${k}${e ? "/edit" : ""}`;
  const rels = data?.releases ?? [];
  const bar = h("div", { class: "bar-row" },
    svc.projects.length > 1 ? projectSwitch(key, (k) => to(k, edit)) : h("b", null, p.name),
    data ? h("span", { class: "muted" }, `${plural(rels.length, "release")} · ${plural(data.features.length, "feature")}`) : null,
    rels.length || data?.features.length ? h("button", { type: "button", class: `gates-btn${edit ? " primary" : ""}`, onclick: () => (location.hash = to(key, !edit)) }, edit ? "Done" : "Edit your gates") : null);
  if (!data) return [bar, h("div", { class: "empty-card" }, "Reading the board…")];
  const out = [bar];
  if (data.error) out.push(h("div", { class: "banner down" }, h("b", null, "Board unavailable"), h("span", null, data.error)));
  if (edit) {
    out.push(h("div", { class: "banner editing" }, h("b", null, "Your gates"),
      h("span", null, `Move a feature into or out of a release, change the order of releases, close or reopen a release: yours, and ${poOf(p)}'s. Changes save as you make them, each with Undo, and go in the board's history as yours. Anything else is a request to ${poOf(p)}.`)));
  }
  if (!rels.length) out.push(h("div", { class: "empty-card" }, `${p.name} has no releases yet. Its PO makes the first one.`));
  rels.forEach((r, i) => out.push(releaseSection(key, data, r, i, edit)));
  const none = data.features.filter((f) => f.release === null);
  if (none.length || data.none?.items) out.push(releaseSection(key, data, null, null, edit));
  out.push(h("p", { class: "note" }, `Order inside a release is ${poOf(p)}'s; the order of releases is yours, and ${poOf(p)}'s. A number in italics: the board has no order for it, so it follows the ordered ones by id. Criteria: acceptance criteria ticked, the feature's own and its tasks'.`));
  return out;
}

/** One release and its features in their order; `r` null is "Not in a release". */
function releaseSection(key, data, r, i, edit) {
  const fs = data.features.filter((f) => f.release === (r?.ref ?? null));
  const done = fs.filter((f) => f.status === "Done");
  const closed = r?.status === "closed";
  // A closed release stays on the roadmap, folded (notes 21); more than three done features fold into one row (notes 10).
  const shut = closed && !state.open.has(`rel:${key}:${r.ref}`);
  const folded = !closed && done.length > 3 && !state.open.has(`done:${key}:${r?.ref ?? "-"}`);
  const cols = edit ? 5 : 4;
  const rows = [];
  if (folded) {
    rows.push(h("tr", { class: "fold" }, h("td", { colspan: cols, class: "full" },
      button(`${done.length} done (${ranges(fs.flatMap((f, j) => (f.status === "Done" ? [j + 1] : [])))}): show them`, "", () => { state.open.add(`done:${key}:${r?.ref ?? "-"}`); render(); }))));
  }
  fs.forEach((f, j) => { if (!(folded && f.status === "Done")) rows.push(featureRow(key, data, r, f, j + 1, edit)); });
  const relState = !r ? null : closed ? "closed" : fs.length && done.length === fs.length ? "all done" : r.status;
  const rels = data.releases;
  const b = r ? r.backlog : data.none;
  return h("section", { class: "release", id: r ? `rel-${r.ref}` : "rel-none" },
    h("div", { class: "rel-h" },
      r ? h("span", { class: "n" }, i + 1) : null,
      h("b", null, r ? r.title : "Not in a release"),
      relState ? badge(relState === "all done" ? "done" : relState, relState) : null,
      h("span", { class: "muted" }, r ? releaseCount(r) : plural(fs.length, "feature")),
      edit && r ? h("span", { class: "gate" },
        h("button", { type: "button", disabled: i === 0 || null, "aria-label": `Move ${r.title} earlier`, onclick: () => moveRelease(key, rels, i, -1) }, "↑ Earlier"),
        h("button", { type: "button", disabled: i === rels.length - 1 || null, "aria-label": `Move ${r.title} later`, onclick: () => moveRelease(key, rels, i, 1) }, "↓ Later"),
        closed ? button("Reopen", "", () => reopenRelease(key, r)) : button("Close release", "danger", () => closeRelease(key, data, r))) : null),
    r?.goal ? h("p", { class: "rel-goal" }, r.goal) : null,
    b ? countsLine(key, b, r?.ref ?? "none") : null,
    shut
      ? fs.length
        ? h("div", { class: "table-wrap" }, h("table", { class: "stack" }, h("tbody", null, h("tr", { class: "fold" }, h("td", { colspan: cols, class: "full" },
            button(`Closed, folded: ${plural(fs.length, "feature")}. Show them`, "", () => { state.open.add(`rel:${key}:${r.ref}`); render(); }))))))
        : h("div", { class: "empty-card" }, "Closed, with no features")
      : fs.length
        ? h("div", { class: "table-wrap" }, h("table", { class: "stack" },
            h("thead", null, h("tr", null, h("th", null, "# Feature"), h("th", null, "State"), h("th", null, "Criteria"), h("th", null, "Tasks"), edit ? h("th", null, "Release") : null)),
            h("tbody", null, rows)))
        : h("div", { class: "empty-card" }, r ? "No features in this release yet." : "No features out of a release."));
}

/** A release's backlog items, open bugs and oldest; the count opens the triage list on that release (roadmap-view 7). */
const countsLine = (key, c, filter) => h("div", { class: "counts-line" },
  h("a", { href: `#triage/${key}`, onclick: () => (state.triage = { filter, all: false }) }, plural(c.items, "backlog item")),
  h("span", null, plural(c.bugs, "open bug")),
  c.oldest ? h("span", null, `oldest ${age(c.oldest)}`) : null);

/** A release's count line: a closed one never reads "0 of 0" (Daisy, spec at 249115d). */
function releaseCount(r) {
  const { done, total } = r.features;
  const count = !total ? "No features" : r.status === "closed" && done === total ? `${plural(total, "feature")}, all done` : `${done} of ${plural(total, "feature")} done`;
  return r.status === "closed" && r.closed_at ? `${count} · closed ${r.closed_at.slice(0, 10)}` : count;
}

function featureRow(key, data, r, f, n, edit) {
  const st = featureState(f);
  const on = onFeature(key, f.ref);
  const unticked = f.status === "Done" && f.progress.total && f.progress.checked < f.progress.total;
  const { checked, total } = f.progress;
  // A closed release drops out of the move selects (notes 21), except as where a feature in it is now.
  const options = [...data.releases.filter((x) => x.status !== "closed" || x.ref === r?.ref).map((x) => [x.ref, x.title]), ["", "No release"]];
  return h("tr", { class: `${st === "done" ? "done" : ""}${st === "open" ? " is-open" : ""}` },
    h("td", { class: "wide keep", "data-label": "" },
      h("span", { class: `ord${f.ord === null ? " unset" : ""}`, title: f.ord === null ? "No order on the board: after the ordered ones, by id" : `Order ${n}` }, r ? n : "·"),
      h("a", { class: "id", href: featureHref(key, f.ref) }, f.ref), h("span", { class: "title" }, f.title),
      on.length ? h("div", { class: "now" }, "● ", whoNames(on), " on it now") : st === "open" ? h("div", { class: "now idle" }, "open · nobody on it now") : null),
    h("td", { "data-label": "State" }, badge(st), unticked ? h("div", { class: "sub-note" }, "Done, criteria not ticked") : null),
    h("td", { "data-label": "Criteria" }, total ? h("div", { class: "crit" }, meterOf(checked, total, st === "done" ? "idle" : "ok"), h("span", { class: "m" }, `${checked} of ${total}`)) : h("span", { class: "muted" }, "none yet")),
    h("td", { "data-label": "Tasks" }, f.tasks?.total ? `${f.tasks.done} of ${f.tasks.total} done` : h("span", { class: "muted" }, "none yet")),
    edit ? h("td", { "data-label": "Release" }, h("select", { class: "move", "aria-label": `Release of ${f.ref}`, onchange: (e) => moveFeature(key, data, f, e.target.value || null, e.target) },
      options.map(([v, label]) => h("option", { value: v, selected: v === (r?.ref ?? "") || null }, label)))) : null);
}

// ---------- Casper's gates: each saves at once, Undo in the toast ----------

/** Sends a gate, then refreshes the project; a refusal says why, in red. */
async function gate(key, op, said, undoOp) {
  try {
    const res = await boardOp(op, true);
    // seq 0: the board wrote nothing (a stale view, a repeat), so there is nothing to undo.
    toast(said, true, res.seq === 0 || !undoOp ? null : () => undoGate(key, typeof undoOp === "function" ? undoOp(res) : undoOp));
  } catch (err) {
    toast(err.message, false);
  }
  await loadRoadmap(key);
}

async function undoGate(key, op) {
  try {
    await boardOp(op, true);
    toast("Undone.");
  } catch (err) {
    toast(err.message, false);
  }
  await loadRoadmap(key);
}

function moveFeature(key, data, f, to, select) {
  if (select) select.disabled = true;
  const dest = data.releases.find((x) => x.ref === to);
  const po = poOf(svc.projects.find((x) => x.key === key));
  // A moved feature goes last in its new release; the PO orders it (notes 19).
  gate(key, { op: "set_release", project: key, ref: f.ref, release: to }, `Moved ${f.ref} to ${dest ? `“${dest.title}”` : "no release"}, last in its order (${po} orders it). Recorded as yours.`,
    (res) => ({ op: "undo", project: key, seq: res.seq }));
}

/** Its Undo is the order before, sent again: an order of releases isn't the board's `undo`. */
function moveRelease(key, rels, i, d) {
  const before = rels.map((x) => x.ref);
  const after = [...before];
  const j = i + d;
  [after[i], after[j]] = [after[j], after[i]];
  gate(key, { op: "order_releases", project: key, refs: after }, `${rels[i].title} is now release ${j + 1}.`, { op: "order_releases", project: key, refs: before });
}

/** A reopen has no Undo: closing it again is the way back (Daisy, BOB-189). */
function reopenRelease(key, r) {
  gate(key, { op: "reopen_release", project: key, ref: r.ref }, `Reopened ${r.title}.`, null);
}

/** Closing names each feature not Done and where it goes (board-writes 5): by default the next open release (notes 20). */
function closeRelease(key, data, r) {
  const open = data.features.filter((f) => f.release === r.ref && f.status !== "Done");
  const others = data.releases.filter((x) => x.ref !== r.ref && x.status !== "closed");
  const i = data.releases.indexOf(r);
  const next = data.releases.slice(i + 1).find((x) => x.status !== "closed") ?? null;
  const dlg = $("confirm");
  const finish = () => {
    const moves = open.map((f) => ({ feature: f.ref, to: dlg.querySelector(`select[data-ref="${f.ref}"]`).value || null }));
    dlg.close();
    gate(key, { op: "close_release", project: key, ref: r.ref, moves }, `Closed ${r.title}${open.length ? `; ${plural(open.length, "open feature")} moved` : ""}.`, (res) => ({ op: "undo", project: key, seq: res.seq }));
  };
  dlg.replaceChildren(h("form", { method: "dialog", onsubmit: (e) => { e.preventDefault(); finish(); } },
    h("h2", { id: "confirm-h" }, `Close ${r.title}?`),
    open.length
      ? [h("p", null, `${plural(open.length, "feature")} in it ${open.length === 1 ? "isn't" : "aren't"} done. Each goes where you pick:`),
         h("ul", { class: "dest" }, open.map((f) => h("li", null,
           h("span", null, h("span", { class: "id" }, f.ref), f.title.length > 60 ? `${f.title.slice(0, 60)}…` : f.title, " ", badge(featureState(f))),
           h("select", { "data-ref": f.ref, "aria-label": `Where ${f.ref} goes` },
             others.map((x) => h("option", { value: x.ref, selected: x === next || null }, `To ${x.title}`)),
             h("option", { value: "", selected: next === null || null }, "Out of any release")))))]
      : h("p", null, `${r.features.total ? "Every feature in it is done." : "It has no features."} Closing it records that ${r.title} is finished; it stays on the roadmap, folded, and takes no features.`),
    h("div", { class: "foot" }, button("Cancel", "", () => dlg.close()), h("button", { type: "submit", class: "danger" }, `Close ${r.ref}`))));
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
}

// ---------- Overview: what needs Casper, who is working on what, where each project stands (spec: Overview; notes 31-34) ----------

/** The service's overview rows and what waits on Casper, null until read; `at`: when they last were (this device's clock). Refetched on board_changed. */
const ov = { rows: null, waits: null, answered: [], error: null, at: null, loading: false, again: false };
/** Ids no longer waiting leave what is open; a permission's only once a laptop has reported, so a reload keeps it. */
function pruneWhole() {
  const live = new Set([...(ov.waits ?? []).map(waitId), ...pendingAll().map(permId)]);
  const reported = state.laptops.size > 0;
  const before = state.whole.size;
  for (const id of state.whole) {
    const of = id.replace(/^ctx:/, "");
    if (!live.has(of) && (reported || !of.startsWith("perm/"))) state.whole.delete(id);
  }
  if (state.whole.size !== before) saveWhole();
}
/** Casper's day starts at his midnight, which only the dashboard knows: "Answered from here today" counts from it. */
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

async function loadOverview() {
  if (ov.loading) return void (ov.again = true);
  ov.loading = true;
  try {
    const [o, w] = await Promise.all([boardOp({ op: "overview" }), boardOp({ op: "waits", since: midnight() })]);
    Object.assign(ov, { rows: o.projects, waits: w.waits, answered: w.answered ?? [], error: null, at: Date.now() });
    pruneWhole();
    noteEditedUnderForm();
    void closeWithdrawnForm();
  } catch (err) {
    // What was read before stays; with nothing read yet it stays unread, never "none".
    ov.error = err.message;
  } finally {
    ov.loading = false;
  }
  // The tab's count shows on every view.
  scheduleRender();
  if (ov.again) {
    ov.again = false;
    await loadOverview();
  }
}

/** A worker's session as its spawn declared it ("BOB-3 build A"): the feature, then the rest as its label. */
function sessionOf(w) {
  if (!w.session) return null;
  const [feature, ...rest] = w.session.split(" ");
  return { feature, label: rest.join(" ") };
}
/** A declared session's step name ("build A", "Fixes"), from "<feature> <kind> <label>" (spec, BOB-3 gap 5). */
function declaredStep(w) {
  const ss = sessionOf(w);
  if (!ss) return null;
  const [kind, ...label] = ss.label.split(" ");
  return label.length ? stepName({ kind, label: label.join(" ") }) : ss.label;
}
/** The agents on a feature now, from their declared sessions; nothing is guessed from a brief (roadmap-view 5). */
const onFeature = (key, ref) => running().filter((w) => w.project === key && sessionOf(w)?.feature === ref);
/**
 * How far this device's clock runs ahead of the broker's: a report's `at` is the broker's, and a phone
 * set a few minutes off would otherwise call every laptop stale (Toad, BOB-26 minor 6). Taken from the
 * dashboard reply's `now`, then from each live report, which the broker stamps as it sends.
 */
let skew = 0;
const brokerNow = () => Date.now() - skew;
/** A laptop whose supervisor hasn't reported for three heartbeats (60 s each): it is down or cut off, so its last report is history. */
const staleReport = (l) => brokerNow() - Date.parse(l.at) > 3 * 60_000;
/** A request lives a day wherever it is shown: the supervisor's ORPHAN_TTL_MS, applied here too for an older supervisor or a stale report (ADR 0012 §1). */
const REQUEST_MAX_AGE_MS = 24 * 3600_000;
/** A laptop's pending rows under a day old, by the broker's clock, whose worker runs: a stopped one's request is history too (spec 2.2). */
const livePending = (l) => l.snapshot.pending.filter((p) => brokerNow() - Date.parse(p.created_at) <= REQUEST_MAX_AGE_MS
  && l.snapshot.workers.some((w) => w.id === p.worker_id && ACTIVE.includes(w.state)));
/** Requests a live supervisor can still act on: a stale laptop's last list is never offered (BOB-26). */
const pendingAll = () => [...state.laptops.values()].filter((l) => !staleReport(l)).flatMap((l) => livePending(l).map((p) => ({ ...p, laptop: l.laptop })));
/** The service's projects, or while its list can't be read the overview's, which are the same. */
const knownProjects = () => svc.projects ?? ov.rows?.map((r) => r.project) ?? [];
const projectName = (key) => knownProjects().find((p) => p.key === key)?.name ?? key;
/** The laptops a project runs on: its supervisor's board, and its agents'. */
const laptopsOf = (key) => [...new Set([...projects().filter((e) => e.board.project === key).map((e) => e.laptop), ...workers().filter((w) => w.project === key).map((w) => w.laptop)])];

/**
 * A worker's laptop after its name, "Luigi@ubu1" (BOB-44; design/BOB-44/laptop-mark.md): only once its project has run on
 * more than one laptop, and always while its laptop has gone quiet. `key`: its project, for a board run that names none.
 */
function lapMark(w, key = w.project) {
  if (!w?.laptop) return null;
  const l = state.laptops.get(w.laptop);
  if (l && staleReport(l)) {
    const min = Math.floor((brokerNow() - Date.parse(l.at)) / 60_000);
    return [h("span", { class: "lap stale", title: `Runs on ${w.laptop}; no report for ${min} min` }, `@${w.laptop}`), h("span", { class: "lap-age" }, ` · no report ${min} min`)];
  }
  return laptopsOf(key).length > 1 ? h("span", { class: "lap", title: `Runs on ${w.laptop}` }, `@${w.laptop}`) : null;
}
/** A worker's name and its mark, kept on one line. */
const whoName = (w, bold = true, key = w.project) => h("span", { class: "who-at" }, bold ? h("b", null, w.name) : w.name, lapMark(w, key));
/** Workers' names with their marks: "Luigi@ubu1, Toad@mbp-1". */
const whoNames = (ws, bold = false) => ws.map((w, i) => [i ? ", " : null, whoName(w, bold)]);
/** The text form, for a tooltip or a chart's key: "Luigi@ubu1" when the mark would show. */
const whoText = (w, key = w.project) => (w.laptop && laptopsOf(key).length > 1 ? `${w.name}@${w.laptop}` : w.name);
/** Who spawned a worker from another laptop, "poe@mbp-1" (ADR 0007 §7), or its sender when it named none; null for a local spawn or an older supervisor's. */
function spawnerOf(w) {
  if (!w.remote_from) return null;
  return w.remote_by ? `${w.remote_by}@${w.remote_from.slice(w.remote_from.indexOf("@") + 1)}` : w.remote_from;
}
/** Whom its requests wait on: a v: 2 remote spawn's spawner (ADR 0007 §4), its laptop said when it isn't the worker's; else the project's lead. */
function waitsOnName(w) {
  if (!w.remote_from || !w.remote_by) return leadName(w.project);
  const lap = w.remote_from.slice(w.remote_from.indexOf("@") + 1);
  return lap === w.laptop ? w.remote_by : `${w.remote_by}@${lap}`;
}

/** A worker's state when it isn't working: what it waits on, and whose it is. */
function waitingText(w) {
  if (w.state === "running") return null;
  const p = pendingAll().find((x) => x.worker_id === w.id);
  return p ? (p.tier === "human" ? "waiting on you" : `waiting on ${waitsOnName(w)}`) : w.state === "waiting-answer" ? "waiting on an answer" : "waiting on a permission";
}

const WAIT_KIND = { question: ["question", "question"], action: ["action", "action"], review_gate: ["review", "review gate"], bug: ["bug", "bug · blocks use"] };
/** A wait's badge: a bug whose fix landed no longer blocks use (BOB-49 spec a). */
const waitKind = (w) => (w.kind === "bug" && w.fix ? ["fixed", "bug · fix landed"] : WAIT_KIND[w.kind]);
/** A session by its kind and label ("build A", "review 1"), never repeating the kind; "Fixes" is a build label and stays "Fixes" (spec, BOB-3 gap 5). */
const stepName = (ss) => (ss.label === "Fixes" || ss.label.toLowerCase().startsWith(`${ss.kind} `) ? ss.label : `${ss.kind} ${ss.label}`);
/** The agents in a board session, from their declared sessions. */
const inSession = (key, ss) => running().filter((w) => w.project === key && w.session === `${ss.feature} ${ss.kind} ${ss.label}`);
/** An agent a wait holds up, with its live dot. */
const heldAgent = (w) => h("span", { class: "who-live" }, h("i", { class: `dot ${agentState(w).cls === "warn" ? "warn" : "on"}`, "aria-hidden": "true" }), whoName(w, false));
/** Agents in a session, each with its dot, then the step: "● Howard, ● Marvin (Fixes)". */
const heldIn = (ws, step) => [ws.map((w, i) => [i ? ", " : null, heldAgent(w)]), step ? ` (${step})` : null];

/** What a wait holds up (spec, BOB-3 gap 5; BOB-121 spec 2.2): a session by who is in it, its own feature's first, then items; a feature and its own session count once; two, then "+N more". */
function heldParts(w) {
  const sessions = [...new Map([...w.holds.sessions, ...w.waiting_sessions].map((ss) => [`${ss.feature} ${ss.kind} ${ss.label}`, ss])).values()]
    .sort((a, b) => (b.feature === w.feature) - (a.feature === w.feature));
  const items = w.holds.items.filter((ref) => !sessions.some((ss) => ss.feature === ref));
  const parts = [
    ...sessions.map((ss) => {
      const step = ss.feature === w.feature ? stepName(ss) : `${ss.feature} ${stepName(ss)}`;
      const who = inSession(w.project, ss);
      return who.length ? heldIn(who, step) : step;
    }),
    ...items,
  ];
  if (!parts.length) parts.push(w.feature ?? projectName(w.project));
  return [parts.slice(0, 2).map((x, i) => [i ? ", " : null, x]), parts.length > 2 ? ` +${parts.length - 2} more` : null];
}

function viewOverview() {
  if (svc.projects && !ov.rows && !ov.loading && !ov.error) loadOverview();
  const now = running();
  const down = boardError();
  return [
    down ? boardDown(down) : null,
    staleBanners(),
    h("div", { class: "ov" },
      statusLine(),
      h("section", { class: "ov-needs" }, h("h2", null, "Needs you ", h("span", { class: "count", id: "needs-count" }, waitCount() || "")),
        h("div", { class: "card" }, needsBody(needsItems(), true))),
      h("section", { class: "ov-now" }, h("h2", null, "Working now ", h("span", { class: "count" }, now.length || "")),
        now.length ? h("div", { class: "card" }, h("ul", { class: "lines now-list", id: "working" }, now.map(nowLine)), queuedLine(), ciLines()) : h("div", { class: "empty-card" }, "No agent is working.", queuedLine(), ciLines())),
      h("section", { class: "ov-proj" }, h("h2", null, "Projects"),
        h("div", { class: "plist", id: "plist" },
          ov.rows?.length ? ov.rows.map(projectRow) : h("div", { class: "empty-card" }, ov.rows && !down ? "No project's board yet." : down ? "The board's projects couldn't be read." : "Reading the board…")))),
  ];
}

/** The laptops that stopped reporting within a day, oldest report first. */
const quietLaptops = () => [...state.laptops.values()].filter((l) => staleReport(l) && brokerNow() - Date.parse(l.at) < REQUEST_MAX_AGE_MS).sort((a, b) => a.at.localeCompare(b.at));
/**
 * A laptop that stopped reporting, at the top of Overview and Needs you (design/BOB-48/spec.md §1): one banner each, oldest
 * report first, or one for three or more. Only for a report under a day old, and never while this page itself is cut off.
 */
function staleBanners() {
  if ($("conn").dataset.state !== "live") return null;
  const quiet = quietLaptops();
  if (!quiet.length) return null;
  const forYou = (l) => livePending(l).filter((p) => p.tier === "human").length;
  const waits = (n, one) => (n ? h("span", null, `${plural(n, "request")} for you from ${one ? "it" : "them"} wait${n === 1 ? "s" : ""} until ${one ? "it reports" : "they report"} again`) : null);
  const link = () => h("a", { href: "#laptops" }, "Laptops →");
  const when = (l) => new Date(l.at).toLocaleString();
  const banners = quiet.length < 3
    ? quiet.map((l) => h("div", { class: "banner", title: `No report from ${l.laptop}'s supervisor since ${when(l)}. Its requests are not offered here until it reports; nothing is lost.` },
      h("b", null, `${l.laptop} stopped reporting`), h("span", null, "last report ", ago(l.at), " ago"), waits(forYou(l), true), link()))
    : [h("div", { class: "banner", title: `No report from ${quiet.map((l) => `${l.laptop} since ${when(l)}`).join(", ")}. Their requests are not offered here until they report; nothing is lost.` },
      h("b", null, `${quiet.length} laptops stopped reporting`),
      h("span", null, quiet.map((l, i) => [i ? " · " : null, `${l.laptop} `, ago(l.at)])),
      waits(quiet.reduce((n, l) => n + forYou(l), 0), false), link())];
  return h("div", { class: "stale-banners" }, banners);
}

const CI_FAILED = new Set(["failure", "timed_out", "startup_failure"]);
/**
 * One muted line per CI run in progress, a failed one in red (BOB-5 as built 3): "CI running: BobNet · test on 1a2b3c4d · started 4 min ago".
 * A run failed shows until its workflow runs again. A stopgap for Now's banner; it goes when the per-agent run line lands (BOB-4 gap 4).
 */
function ciLines() {
  return projects().flatMap((e) => {
    const latest = new Map();
    for (const r of [...(e.board.ci ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))) if (!latest.has(r.name)) latest.set(r.name, r);
    return [...latest.values()].filter((r) => r.status !== "completed" || CI_FAILED.has(r.conclusion)).reverse().map((r) => {
      const failed = r.status === "completed";
      return h("p", { class: "more ci-line", dataset: failed ? { failed: "" } : {} },
        `CI ${failed ? "failed" : "running"}: ${projectName(e.board.project)} · ${r.name} on ${r.sha.slice(0, 8)} · started `, ago(r.created_at), " ago");
    });
  });
}

/** "2 queued: Luigi, Toad" (spec, BOB-3 gap 2). */
const queuedLine = () => { const q = workers().filter((w) => w.state === "queued"); return q.length ? h("p", { class: "more queued" }, `${q.length} queued: `, whoNames(q)) : null; };

// ---------- Needs you: what waits on Casper, across projects, and his answers from here (BOB-121 spec 2.2; notes 22-24, 35, 40-43) ----------

/** Casper's own permission requests, not the orchestrator's: a stale laptop's are never offered (BOB-26). */
const humanPerms = () => pendingAll().filter((p) => p.tier === "human");
/** What the tab and Needs you count: the board's waits and his permissions. */
const waitCount = () => humanPerms().length + (ov.waits?.length ?? 0);
const waitId = (w) => `${w.project}/${w.ref}`;
/** Permissions and the board's waits in one list, oldest first in each group, as { p } or { w }. */
const needsItems = () => [...humanPerms().map((p) => ({ p, project: permProject(p), since: p.created_at, blocking: true })), ...(ov.waits ?? []).map((w) => ({ w, project: w.project, since: w.since, blocking: w.blocking }))]
  .sort((a, b) => a.since.localeCompare(b.since));
const permId = (p) => `perm/${p.laptop}/${p.id}`;
/** "Howard wants Bash: " and its command in monospace, or "Howard asks: " and its question. The whole ask when the laptop sends it, else its preview. */
const permText = (p) => (p.kind === "question" ? [`${p.name} asks: `, p.ask?.text ?? p.preview] : [`${p.name} wants ${p.tool}: `, h("code", null, p.ask?.text ?? p.preview)]);
const ANSWER_VERB = { question: "Answer", action: "Mark done", permission: "Allow or deny" };
/** Under a day, how long; then days. */
const waitAge = (iso) => (Date.now() - Date.parse(iso) < DAY ? since(iso) : age(iso));
/** Who asked: an agent by name; the owner's sign-in is an email (a domain with a dot), and that is Casper himself. */
const askedBy = (a) => (/@[^@]*\./.test(a) ? "you" : shortName(a));
/** "Mario, BobNet's lead," before "gets a message" (BOB-5 as built). */
const leadOf = (key) => `${leadName(key)}, ${projectName(key)}'s lead,`;
/** Names as a sentence lists them: "Bob", "Bob and Peach", "Bob, Peach and poe". */
const andList = (addrs) => { const n = addrs.map(shortName); return n.length < 2 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`; };
/**
 * Who got an answer's message, from the board's reply: "sent to" (Daisy), never "heard by"; whom it waits for,
 * and a project no supervisor runs (ADR 0009 §5). A reply without `supervisor` (an older broker) says neither.
 */
const sentTo = (res, project) => (res?.told?.length ? `; sent to ${andList(res.told)}` : "")
  + (res?.waiting?.length ? `; waiting for ${andList(res.waiting)} to come online` : "")
  + (res?.supervisor === null ? `; no supervisor runs ${projectName(project)}` : "");

/**
 * A question's record, with its options, read when its form opens: "<project>/<ref>" → record, or { error }.
 * `edits`: how many edits Waits counts on it now; a record read before the last of them is read again, the old one shown meanwhile (BOB-119).
 */
const questions = new Map();
const questionReads = new Set();
async function loadQuestion(key, ref, edits = 0) {
  const id = `${key}/${ref}`;
  const had = questions.get(id);
  if (questionReads.has(id) || (had && (had.error || (had.edits_seen ?? 0) >= edits))) return;
  questionReads.add(id);
  if (!had) questions.set(id, null);
  try {
    const q = (await boardOp({ op: "get", project: key, ref })).question;
    questions.set(id, q ? { ...q, edits_seen: edits } : { error: `${ref} isn't on the board` });
  } catch (err) {
    questions.set(id, { error: err.message });
  }
  questionReads.delete(id);
  // The options come in under the box he may be typing in: draw them now, and give him the box back.
  if (!document.activeElement?.closest?.("form.answer")) return scheduleRender();
  render();
}

/** The button that opens an item's answer form; one form is open at a time (notes 40). */
function answerToggle(id, verb) {
  const open = state.answering?.id === id;
  return h("button", { type: "button", class: "answer-btn", "aria-expanded": String(open), onclick: (e) => {
    e.stopPropagation();
    state.answering = open ? null : { id, pick: null, words: "" };
    // He answers what he has read: the form opens the line whole too (BOB-31).
    if (!open) { state.whole.add(id); saveWhole(); }
    render();
    if (!open) $("view").querySelector("form.answer")?.querySelector("input, textarea")?.focus();
  } }, open ? "Close" : verb);
}

/** The form under a question or an action (notes 41, 42): his words go to the board verbatim; the lead gets a message. */
function answerForm(w) {
  const a = state.answering, qid = waitId(w);
  const q = questions.get(qid) ?? null;
  // An action's record too: one filed before BOB-187 may have options to show.
  loadQuestion(w.project, w.ref, w.edits?.length ?? 0);
  const close = () => { state.answering = null; render(); };
  const form = h("form", { class: "answer", onsubmit: (e) => { e.preventDefault(); send(); } });
  const options = q?.options ? [...q.options].sort((x, y) => y.recommended - x.recommended) : [];
  const ready = () => !!(a.pick || a.words.trim());
  const check = () => { const b = form.querySelector('button[type="submit"]'); if (b && w.kind === "question") b.disabled = !ready(); };
  const words = (label, placeholder) => h("label", { class: "words" }, h("span", null, label),
    h("textarea", { rows: 2, placeholder, oninput: (e) => { a.words = e.target.value; check(); } }, a.words));
  const foot = (...btns) => h("div", { class: "foot" }, h("span", { class: "who-gets" }, `Recorded on ${w.ref} as yours, word for word; ${leadOf(w.project)} gets a message.`),
    h("button", { type: "button", onclick: close }, "Cancel"), ...btns);
  async function send() {
    if (w.kind === "question" && !ready()) return;
    for (const b of form.querySelectorAll("button")) b.disabled = true;
    const said = a.words.trim() || undefined;
    const op = w.kind === "question" ? { op: "answer_question", project: w.project, ref: w.ref, ...(a.pick ? { key: a.pick } : {}), ...(said ? { words: said } : {}) }
      : { op: "mark_done", project: w.project, ref: w.ref, ...(said ? { note: said } : {}) };
    try {
      // One write, one key: a resend after a drop goes under the same key, and the board takes it once (ADR 0001 §12).
      const res = await boardOp(op, true);
      state.answering = null;
      // It leaves its group at once, and the counts drop; the board's next read says the same.
      ov.waits = (ov.waits ?? []).filter((x) => waitId(x) !== qid);
      if (res.seq) {
        undoable.set(qid, { seq: res.seq, until: Date.now() + UNDO_MS });
        setTimeout(scheduleRender, UNDO_MS);
      }
      render();
      toast(`${w.kind === "question" ? `Answered ${w.ref}` : `Marked ${w.ref} done`}. Recorded as your words${sentTo(res, w.project)}.`, true,
        res.seq ? () => undoAnswer(w, res.seq) : null);
    } catch (err) {
      for (const b of form.querySelectorAll("button")) b.disabled = false;
      check();
      toast(err.message, false);
    }
    await loadOverview();
  }
  // His draft stays; the note says the question moved under it (BOB-119). Its option keys are stable, so the answer still goes.
  const note = a.edited ? h("p", { class: "edited-note" }, "Question edited since you opened this") : null;
  if (w.kind === "action") {
    // An action is done or not, never picked from (BOB-187): one that was filed with options shows them as text.
    const filed = q?.options?.length ? q.options : null;
    form.append(note ?? "",
      filed ? h("div", { class: "filed" }, h("p", { class: "muted" }, "It was filed with these options:"), h("ul", null, filed.map((o) => h("li", null, o.text, o.recommended ? " (recommended)" : "")))) : "",
      words(filed ? "Note (optional): if you chose one, say which" : "Note (optional)", "Anything they should know"), foot(h("button", { type: "submit", class: "primary" }, "Mark done")));
    return form;
  }
  form.append(
    note ?? "",
    !q ? h("p", { class: "muted", style: "margin:0" }, "Reading its options…")
      : q.error ? h("p", { class: "muted", style: "margin:0" }, q.error)
      : options.length ? h("fieldset", null, h("legend", null, "Pick one"),
          options.map((o) => h("label", { class: "opt-row" },
            h("input", { type: "radio", name: `o-${qid}`, value: o.key, checked: a.pick === o.key || null, onchange: () => { a.pick = o.key; check(); } }),
            h("span", null, o.text, o.recommended ? h("span", { class: "rec-tag" }, "recommended") : null))))
      : null,
    words(options.length ? "Your words (optional with an option; enough on their own)" : "Your answer", "Write what you want them to read."),
    foot(h("button", { type: "submit", class: "primary", disabled: !ready() || null }, "Send answer")));
  return form;
}

/** His answers from this page that he can still take back, by item: the board takes one back for two minutes (§7). */
const UNDO_MS = 120_000;
const undoable = new Map();
/** His answer or done mark, taken back within two minutes (§7): the question opens again, and the lead hears. */
async function undoAnswer(w, seq) {
  undoable.delete(waitId(w));
  try {
    const res = await boardOp({ op: "undo", project: w.project, seq }, true);
    toast(`Undone: ${w.ref} waits on you again${sentTo(res, w.project)}.`);
  } catch (err) {
    toast(err.message, false);
  }
  await loadOverview();
}

/** Whether a laptop's supervisor sends a note with Allow (ADR 0013 §2): an older one, whose report has no `decided`, drops it. */
const takesNotes = (laptop) => state.laptops.get(laptop)?.snapshot.decided !== undefined;

/**
 * A permission's form (notes 42; BOB-51): a note, then Deny or Allow, with a confirmation for Allow. On an older
 * supervisor's laptop the note goes only with Deny. The supervisor's answer can't be taken back: no Undo.
 */
function permissionForm(p) {
  const a = state.answering, asks = p.kind === "question", notes = takesNotes(p.laptop);
  const close = () => { state.answering = null; render(); };
  const what = `${p.name}'s ${asks ? "question" : p.tool}`;
  const decide = (decision, b) => {
    const message = decision === "deny" || notes ? a.words.trim() : "";
    const done = decision === "deny" ? `Denied ${what}${message ? `; your note went to ${p.name}` : ""}.`
      : !message ? `Allowed ${what}.`
      : (f) => f.note_delivered ? [`Allowed ${what}; your note went to ${p.name}.`]
        : f.note_delivered === false ? [`Allowed ${what}, but your note didn't reach ${p.name} (it had stopped).`, "warn"]
        : [`Allowed ${what}, but ${p.laptop}'s supervisor is older and dropped your note.`, "warn"];
    const sent = act(p.laptop, { kind: "answer", request: p.id, decision, ...(message ? { message } : {}) }, b,
      decision === "allow" ? `Allow ${p.name} to run ${p.tool}?\n\n${p.preview}${message ? "\n\nYour note goes with it." : ""}` : null, done);
    if (sent) close();
  };
  return h("form", { class: "answer", onsubmit: (e) => e.preventDefault() },
    h("label", { class: "words" }, h("span", null, notes ? `Note to ${p.name} (optional)` : `Note to ${p.name}, sent with Deny (optional)`),
      h("textarea", { rows: 2, placeholder: notes && !asks ? "e.g. fine, but use the pool's stop script next time" : "e.g. not that process; use the pool's stop script", oninput: (e) => (a.words = e.target.value) }, a.words)),
    h("div", { class: "foot" },
      h("span", { class: "who-gets" }, asks ? `Answer it through the orchestrator, or deny it here; ${p.name} gets your note. It can't be taken back.`
        : notes ? `${p.name} gets your decision, and your note as its next message. It can't be taken back.`
        : `${p.name} gets your decision; a note goes only with Deny. It can't be taken back.`),
      h("button", { type: "button", onclick: close }, "Cancel"),
      button("Deny", "danger", (b) => decide("deny", b)),
      asks ? null : button("Allow", "primary", (b) => decide("allow", b))));
}

/** "needed before …": an item, a release or a few words (notes 35). */
function neededBefore(w) {
  const nb = w.needed_before;
  if (!nb) return null;
  const what = "item" in nb ? h("a", { href: featureHref(w.project, nb.item) }, nb.item)
    : "release" in nb ? h("a", { href: `#roadmap/${w.project}` }, svc.roadmaps.get(w.project)?.releases.find((r) => r.ref === nb.release)?.title ?? nb.release)
    : nb.text;
  return h("span", { class: "needed" }, "needed before ", what);
}

/** Where a bug or a review is looked at: its button is a link (notes 43). */
function waitLink(w) {
  if (w.kind === "bug") return h("a", { class: "answer-btn", href: `#triage/${w.project}` }, "Open in triage");
  return w.kind === "review_gate" ? h("a", { class: "answer-btn", href: featureHref(w.project, w.feature ?? w.ref) }, `Open ${w.ref}`) : null;
}

/**
 * Whether the question changed under his open answer form with a draft in it (BOB-119): then the form keeps the
 * draft and says so, and its edits open. An untouched form just takes the question as it is now.
 */
function editedUnderForm(w) {
  const a = state.answering, n = w.edits?.length ?? 0;
  if (a?.id !== waitId(w)) return false;
  a.seen ??= n;
  if (n > a.seen) {
    if (a.pick || a.words.trim()) a.edited = true;
    else a.seen = n;
  }
  return !!a.edited;
}

/**
 * His open answer form's question left Waits: if its asker withdrew it, the form closes and a toast says so, with
 * the start of his draft so his words aren't lost silently (BOB-49 spec b). Answered elsewhere, it is left as it is.
 */
async function closeWithdrawnForm() {
  const a = state.answering;
  if (!a || a.id.startsWith("perm/") || (ov.waits ?? []).some((x) => waitId(x) === a.id)) return;
  const [key, ref] = a.id.split("/");
  let q;
  try {
    q = (await boardOp({ op: "get", project: key, ref })).question;
  } catch {
    return;
  }
  if (q?.state !== "withdrawn" || state.answering !== a) return;
  const draft = a.words.trim();
  state.answering = null;
  toast(`${ref} was withdrawn by ${q.asked_by ? askedBy(q.asked_by) : "its asker"}; it no longer waits on you.${draft ? ` Your draft: “${draft.length > 80 ? `${draft.slice(0, 80)}…` : draft}”` : ""}`, true, null, !!draft);
  render();
}

/** While he is in his form the page doesn't redraw: the note goes into it now, and the rest follows on the next redraw. */
function noteEditedUnderForm() {
  const a = state.answering, w = a && (ov.waits ?? []).find((x) => waitId(x) === a.id);
  if (!w || !editedUnderForm(w)) return;
  state.folds.set(`edits:waits:${a.id}`, true);
  const form = $("view").querySelector("form.answer");
  if (form && !form.querySelector(".edited-note")) form.prepend(h("p", { class: "edited-note" }, "Question edited since you opened this"));
}

/** What an edit changed, by field, as its line names them. */
const EDIT_FIELD = { text: "text", context: "context", needed_before: "needed before", holds: "holds", holds_sessions: "sessions held", options: "options" };
const editField = (f) => EDIT_FIELD[f.startsWith("option") ? "options" : f] ?? f.replace(/_/g, " ");

/**
 * A question's or action's edits (BOB-119), one render for Needs you and the item page: "edited ×n", muted after
 * its text, opening its edits newest first: when, who and what, the reason on its own line, the old text struck
 * through. None when it was never edited, or on an older broker's waits. `opened` opens it whatever he left it as.
 */
function editsOf(w, where, opened = false) {
  const edits = w.edits ?? [];
  if (!edits.length) return null;
  const key = `edits:${where}:${waitId(w)}`;
  if (opened) state.folds.set(key, true);
  const change = (c) => c.field === "text" || c.field === "context"
    ? (c.old ? h("del", { class: "muted" }, c.old) : null)
    : h("div", { class: "muted" }, `${c.field.startsWith("option ") ? c.field : editField(c.field)}: ${c.old ?? "none"} → ${c.new ?? "none"}`);
  return fold(key, where === "item" && edits.length <= 2, { class: "edits" },
    h("summary", null, `edited ×${edits.length}`),
    h("ol", null, [...edits].reverse().map((e) => h("li", { dataset: { seq: e.seq } },
      h("div", { class: "ed-h" }, h("span", { title: new Date(e.at).toString() }, stamp(e.at)), ` · ${askedBy(e.by)} · ${[...new Set(e.changes.map((c) => editField(c.field)))].join(", ")}`),
      e.reason ? h("div", { class: "ed-why" }, `“${e.reason}”`) : null,
      e.changes.map(change)))));
}

/** Who closes a fixed bug: the project's PO, else its lead (BOB-49 spec a). */
function closerOf(key) {
  const p = knownProjects().find((x) => x.key === key);
  return p?.po ? shortName(p.po) : p?.lead ? shortName(p.lead) : "its PO";
}

/** A fixed bug's line: the commit, its release when one is known, and who closes it (BOB-49 spec a). */
function fixLine(w) {
  const f = w.fix;
  if (!f) return null;
  const where = f.release ? `, in ${f.release}` : f.tags_known ? ", not in a release yet" : "";
  return h("div", { class: "fix" }, "Fix landed ", h("span", { class: "sha", title: f.subject }, f.sha.slice(0, 7)), where,
    h("span", { class: "muted" }, ` · waits on ${closerOf(w.project)} to close it`));
}

/** How long a row has waited unchanged, and whom the board asked to check it; else its owner's latest keep (BOB-49 spec b). */
function staleSpan(w) {
  const s = w.stale;
  if (s) {
    const tail = !s.owner ? ", nobody to ask" : s.flagged_at ? [`, ${askedBy(s.owner)} asked to check it `, ago(s.flagged_at), " ago"] : `, ${askedBy(s.owner)} is asked within the hour`;
    return h("span", { class: "stale" }, "Unchanged for ", ago(s.changed_at), tail);
  }
  const k = w.kept;
  return k ? h("span", { class: "kept" }, `Kept by ${askedBy(k.by)} `, ago(k.at), ` ago: “${k.reason}”`) : null;
}

/**
 * One thing that needs him (spec 2.2), the same wherever it is listed: badge, text, age, where it is and what it holds
 * up, and its one action. `compact`: no button, opened in place; `page`: the Needs you page, where its context opens
 * too; `before`: the start of Status's span; `project` false leaves its name out.
 */
function needItem(x, { compact = false, page = false, project = true, before = null } = {}) {
  const { p, w } = x;
  const id = p ? permId(p) : waitId(w), since = p ? p.created_at : w.since;
  const open = state.whole.has(id), answering = !compact && state.answering?.id === id;
  const worker = p && workers().find((y) => y.id === p.worker_id), ss = worker && sessionOf(worker);
  const key = p ? worker?.project : w.project, feature = p ? ss?.feature : w.feature;
  const [st, label] = p ? ["permission", "permission"] : waitKind(w);
  const edited = !!w && editedUnderForm(w);
  const text = p ? permText(p) : w.text;
  const toggle = () => toggleWhole(id);
  const where = [project ? (key ? projectName(key) : p.laptop) : null, feature && feature !== w?.ref ? h("a", { class: "id", href: featureHref(key, feature) }, feature) : null].filter(Boolean);
  const closed = w ? w.waiting_sessions.map((y) => `${y.feature === w.feature ? stepName(y) : `${y.feature} ${stepName(y)}`}`) : [];
  const holds = p ? ["holds up ", worker ? heldIn([worker], ss ? declaredStep(worker) : null) : p.name] : w.kind === "bug" ? "blocks use" : ["holds up ", heldParts(w)];
  const meta = [
    where.length ? where.map((y, i) => [i ? " › " : null, y]) : null,
    x.blocking ? h("span", { class: "holds" }, holds) : before ? "when you have time" : null,
    w?.asked_by ? `from ${askedBy(w.asked_by)}` : null,
    w ? neededBefore(w) : null,
    p ? `on ${p.laptop}` : null,
    compact && w?.stale ? ["unchanged ", waitAge(w.stale.changed_at)] : null,
    closed.length ? `${upTo2(closed)} closed on it (need: casper)` : null,
  ].filter(Boolean);
  const old = before && since < before ? h("span", { class: "before" }, `from before ${stClock(before)}`) : null;
  const whole = open ? [
    p?.ask?.questions.length ? askBlock(p, true) : p?.ask?.cut ? h("span", { class: "cutnote" }, "Cut at the laptop: too long to send whole.") : null,
    w?.recommended ? h("div", { class: "rec" }, h("b", null, "Recommended "), w.recommended.text) : null,
    compact && w ? staleSpan(w) : null,
    // The context stays on the Needs you page, where it opens: it can be pages long (BOB-31).
    !page && w?.context ? h("a", { href: "#needs", class: "more-t", onclick: () => { state.whole.add(`ctx:${id}`); saveWhole(); scrollAfter = `c-${id}`; } }, "Its context, on Needs you →") : null,
    compact ? h("a", { href: "#needs", class: "more-t", onclick: () => (scrollAfter = `w-${id}`) }, w?.kind === "bug" || w?.kind === "review_gate" ? "On Needs you →" : "Answer it on Needs you →") : null,
  ].filter(Boolean) : [];
  const unchanged = !compact && w ? staleSpan(w) : null;
  const act = compact ? null : p ? answerToggle(id, ANSWER_VERB.permission) : ANSWER_VERB[w.kind] ? answerToggle(id, ANSWER_VERB[w.kind]) : waitLink(w);
  return h("li", { id: `w-${id}`, class: `need${open ? " open" : ""}${compact ? " compact" : ""}`, dataset: { id, ref: p ? p.id : w.ref, kind: p ? "permission" : w.kind, blocking: String(!!x.blocking) } },
    h("span", { class: "n-b" }, badge(st, label), w ? h("span", { class: "id" }, w.ref) : null),
    h("span", { class: "l-h" },
      h("span", { class: "l-t", id: `t-${id}`, role: "button", tabindex: "0", "aria-expanded": String(open), title: open ? null : "Show all",
        // Not while he is selecting the text to copy it.
        onclick: () => { if (!String(getSelection() ?? "")) toggle(); },
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); $(`t-${id}`)?.focus(); } } }, text),
      w && (!compact || open) ? editsOf(w, "waits", edited) : null),
    h("span", { class: "age", title: `${p ? "asked" : "since"} ${stamp(since)}` }, waitAge(since)),
    w ? fixLine(w) : null,
    whole.length ? h("div", { class: "whole" }, whole) : null,
    h("div", { class: "m-row" }, h("span", { class: "l-m" }, meta.map((y, i) => [i ? " · " : null, y]), old),
      unchanged || act ? h("span", { class: "m-r" }, unchanged, act ? h("span", { class: "acts" }, act) : null) : null),
    page && w ? contextRow(w, id) : null,
    answering ? (p ? permissionForm(p) : answerForm(w)) : null);
}
/** Several names: at most two, then "+N more". */
const upTo2 = (names) => (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2} more` : names.join(", "));

/** Needs you's two groups and what they are up to date with (spec 2.2). On the Overview what can wait is three, compact. */
function needsBody(items, overview = false) {
  const unreadWaits = !ov.waits;
  const couldnt = "What waits on you couldn't be read.";
  if (unreadWaits && !items.length) return [h("p", { class: "muted", style: "margin:8px 0" }, boardError() ? couldnt : "Reading the board…")];
  const blocking = items.filter((x) => x.blocking), rest = items.filter((x) => !x.blocking);
  if (!items.length) return [h("p", { class: "st-empty ok" }, "Nothing needs you. Anything new shows here within a minute."), freshLine()];
  const shown = overview ? rest.slice(0, 3) : rest;
  const group = (id, tone, name, list, n, opts, none) => h("div", { class: "ngrp", id: `needs-${id}`, dataset: { tone } }, h("h3", null, name, " ", h("span", { class: "count" }, n || "")),
    list.length ? h("ul", { class: "lines", id: id === "holding" ? "needs" : null }, list.map((x) => needItem(x, opts))) : h("p", { class: "st-empty" }, none));
  return [
    group("holding", "bad", "Holds work up", blocking, blocking.length, { page: !overview }, "Nothing is held up by you."),
    unreadWaits ? h("p", { class: "st-empty" }, boardError() ? couldnt : "Reading the board…")
      : group("rest", "", "When you have time", shown, rest.length, { page: !overview, compact: overview }, "Nothing else waits on you."),
    overview ? h("a", { class: "more", href: "#needs" }, rest.length > 3 ? `${rest.length - 3} more when you have time, and today's answers, on Needs you →` : "Needs you, with today's answers →") : null,
    freshLine(),
  ];
}

const FRESH_MS = 3 * 60_000;
/** Whether what the page shows may be behind: cut off, a read that failed, or none for three minutes. */
const pageLate = () => $("conn").dataset.state !== "live" || !!ov.error || Date.now() - (state.refreshed ?? 0) > FRESH_MS;
/** What Needs you is up to date with: each laptop that reports, or in warn that the page itself isn't (spec 2.2). */
function freshLine() {
  if (!ov.waits) return null;
  if (pageLate()) {
    const at = ov.error ? ov.at : state.refreshed;
    return h("p", { class: "fresh late", dataset: { late: "true" } }, "Last updated ", at ? [ago(new Date(at).toISOString()), " ago"] : "before this page opened");
  }
  const live = [...state.laptops.values()].filter((l) => !staleReport(l));
  return h("p", { class: "fresh", dataset: { late: "false" } }, live.length ? ["Up to date: ", live.map((l, i) => [i ? ", " : null, `${l.laptop} reported `, ago(l.at), " ago"]), "."] : "Up to date. No laptop is reporting.",
    " An item leaves when it's answered or its worker stops.");
}

/** Show context / Hide context, and the asker's context whole under it; none without one (BOB-31). An older broker sends no field. */
function contextRow(w, id) {
  const context = w.context ?? null;
  if (!context) return null;
  const open = state.whole.has(`ctx:${id}`);
  return h("div", { class: "ctx-row" },
    h("button", { type: "button", class: "more-t", "aria-expanded": String(open), "aria-controls": `c-${id}`, onclick: () => toggleWhole(`ctx:${id}`) }, open ? "Hide context" : "Show context"),
    open ? h("div", { class: "ctx", id: `c-${id}` }, context) : null);
}

/** One answer or done mark he sent from here today (notes 43): the question muted, the option he picked, his words exactly. */
function answeredItem(x) {
  const q = questions.get(`${x.project}/${x.ref}`);
  if (x.key && !questions.has(`${x.project}/${x.ref}`)) loadQuestion(x.project, x.ref);
  const undo = undoable.get(`${x.project}/${x.ref}`);
  const option = x.key ? (q?.options?.find((o) => o.key === x.key)?.text ?? x.key) : null;
  return h("li", { class: "answered", dataset: { ref: x.ref } },
    h("div", { class: "top" }, badge("done", x.kind === "action" ? "done" : "answered"), h("span", { class: "id" }, x.ref),
      h("span", { class: "muted" }, projectName(x.project)), h("span", { class: "age" }, `today ${clock(x.at)}`)),
    h("div", { class: "q" }, x.text),
    h("div", { class: "said" }, option ? h("div", null, h("span", { class: "muted" }, "You picked "), option) : null,
      x.words ? h("blockquote", null, `“${x.words}”`) : null),
    h("div", { class: "meta" }, h("span", null, `${leadOf(x.project)} got a message`), h("span", null, "from the dashboard"),
      undo && Date.now() < undo.until ? button("Undo", "answer-btn", (b) => { b.disabled = true; undoAnswer(x, undo.seq); }) : null));
}

/** The requests he decided from the dashboard since midnight, from every laptop's report; an older supervisor's adds none (ADR 0013 §2). */
function decidedToday() {
  const by = new Map(), from = Date.parse(midnight());
  for (const l of state.laptops.values()) for (const d of l.snapshot.decided ?? []) if (Date.parse(d.decided_at) >= from) by.set(`${l.laptop}/${d.id}`, { ...d, laptop: l.laptop });
  return [...by.values()];
}
/** One of them: what it wanted, what he decided, his note. Never whether the note arrived (the report doesn't say), and no Undo. */
function decidedItem(d) {
  const allowed = d.decision === "allow";
  return h("li", { class: "answered", dataset: { ref: d.id, decision: d.decision } },
    h("div", { class: "top" }, badge(allowed ? "done" : "failed", allowed ? "allowed" : "denied"), h("span", { class: "id" }, d.tool),
      h("span", { class: "muted" }, projectName(d.project)), h("span", { class: "age" }, `today ${clock(d.decided_at)}`)),
    h("div", { class: "q" }, d.kind === "question" ? `${d.name} asked: ${d.preview}` : [`${d.name} wanted ${d.tool}: `, h("code", null, d.preview)]),
    h("div", { class: "said" }, h("div", null, `You ${allowed ? "allowed" : "denied"} it`, h("span", { class: "muted" }, ` · on ${d.laptop}`)), d.note ? h("blockquote", null, `your note: “${d.note}”`) : null));
}

function viewNeeds() {
  if (svc.projects && !ov.waits && !ov.loading && !ov.error) loadOverview();
  const keys = knownProjects().map((p) => p.key);
  const all = needsItems();
  const pick = state.waitsProject !== "all" && keys.includes(state.waitsProject) ? state.waitsProject : "all";
  const of = (k) => all.filter((x) => k === "all" || x.project === k);
  const shown = of(pick);
  const today = [...(ov.answered ?? []).map((x) => ({ at: x.at, project: x.project, el: () => answeredItem(x) })), ...decidedToday().map((d) => ({ at: d.decided_at, project: d.project, el: () => decidedItem(d) }))]
    .filter((x) => pick === "all" || x.project === pick).sort((a, b) => b.at.localeCompare(a.at));
  // Not read: how many is not known, and is never said to be none (Daisy, review B m1).
  const n = (k) => (ov.waits ? ` ${of(k).length}` : "");
  const seg = (v, label) => h("button", { type: "button", "aria-pressed": String(pick === v), onclick: () => { state.waitsProject = v; render(); } }, label, n(v));
  return [
    boardError() ? boardDown(boardError()) : null,
    staleBanners(),
    h("div", { class: "bar-row" },
      keys.length > 1 ? h("span", { class: "seg filters" }, seg("all", "All projects"), keys.map((k) => seg(k, projectName(k)))) : null,
      ov.waits ? h("span", { class: "muted" }, `${plural(shown.length, "item")}, oldest first`) : null),
    h("section", { class: "card needs-page" }, needsBody(shown)),
    today.length ? h("section", { id: "needs-answered" }, h("h2", null, "Answered from here today ", h("span", { class: "count" }, today.length)),
      h("ul", { class: "list waits" }, today.map((x) => x.el()))) : null,
    h("p", { class: "note" }, "Oldest first in each group. Answer here or in the project's conversation: your answer is kept on the item word for word, and the project's lead gets a message. A permission request shows for a day at most, and only while its worker runs; a quiet laptop's requests wait under its banner. A review and a bug open where they are looked at."),
  ];
}

/** An agent working now: who, its state, tokens, then project › feature › session › tasks; it opens its detail row (spec, BOB-3 gap 2). */
function nowLine(w) {
  const ss = sessionOf(w);
  const st = agentState(w);
  const items = projects().find((e) => e.board.project === w.project)?.board.backlog?.items ?? [];
  const tasks = refsOf(w).filter((id) => id !== ss?.feature);
  const href = ss ? featureHref(w.project, ss.feature) : null;
  return agentLine(w,
    [h("span", { class: "l-who" }, h("i", { class: `dot ${st.cls === "warn" ? "warn" : "on"}`, "aria-hidden": "true" }), whoName(w), h("span", { class: "muted" }, ` ${w.role}`)),
      h("span", { class: "l-path" }, h("span", { class: "muted" }, projectName(w.project), " › "),
        ss ? [h("a", { class: "id", href }, ss.feature), h("span", { class: "muted" }, `${declaredStep(w)}${tasks.length ? " › " : ""}`),
            tasks.map((id, i) => [i ? h("span", { class: "muted tsep" }, " · ") : null, h("a", { href, class: "l-task" }, h("span", { class: "id" }, id), items.find((x) => x.id === id)?.title ?? "")])]
          : h("span", { class: "muted", style: "font-style:italic" }, "Other work (no session)")),
      h("span", { class: "l-m" }, st.text !== "working" ? [stateSpan(st), " · "] : null, `${fmtTokens(workerTokens(w))} tokens`)],
    null,
    ss && svc.projects?.some((p) => p.key === w.project) ? () => openCtx(w.project, ss.feature, w.session, w.name) : null);
}

const cell = (label, ...kids) => h("div", { class: "pc" }, h("span", { class: "lab" }, label), ...kids);

/** One project's row: five cells, the project, Release, Open now, Next and Backlog (notes 34). */
function projectRow(o) {
  const p = o.project, r = o.release, open = o.open[0], next = o.next_ready, b = o.backlog;
  const on = open ? onFeature(p.key, open.ref) : [];
  const toTriage = () => (state.triage = { filter: "all", all: false });
  return h("div", { class: "card prow", dataset: { project: p.key } },
    h("div", { class: "pc pname" }, h("a", { href: `#roadmap/${p.key}` }, p.name),
      h("span", { class: "muted" }, [...laptopsOf(p.key), p.lead ? `lead ${shortName(p.lead)}` : null, p.po ? `PO ${shortName(p.po)}` : null].filter(Boolean).join(" · "))),
    cell("Release", r
      ? [h("span", { class: "v" }, h("b", null, String(o.release_number)), " ", r.title), meterOf(r.features.done, r.features.total), h("span", { class: "muted" }, `${r.features.done} of ${plural(r.features.total, "feature")} done`)]
      : h("span", { class: "muted" }, "no open release")),
    cell("Open now", open
      ? [h("a", { href: featureHref(p.key, open.ref), class: "v clamp" }, h("span", { class: "id" }, open.ref), open.title),
         h("span", { class: "muted" }, `${open.progress.checked} of ${open.progress.total} criteria · `, on.length ? h("span", { style: "color:var(--ok)" }, whoNames(on), " on it") : "nobody on it"),
         o.open.length > 1 ? h("a", { href: `#roadmap/${p.key}`, class: "muted" }, `and ${o.open.length - 1} more open`) : null]
      : h("span", { class: "muted" }, "no feature open")),
    cell("Next", o.waits_on_you ? h("span", { class: "v", style: "color:var(--warn)" }, `Waits on you: ${o.waits_on_you}`) : null,
      next ? h("span", { class: "muted clamp" }, o.waits_on_you ? "Then Ready: " : "Ready: ", h("a", { class: "id", href: featureHref(p.key, next.ref) }, next.ref), next.title) : h("span", { class: "muted" }, "none Ready yet")),
    cell("Backlog", b.items
      ? [h("a", { href: `#triage/${p.key}`, class: "v", onclick: toTriage }, plural(b.items, "item")), h("span", { class: "muted" }, `${plural(b.bugs, "bug")} · oldest ${age(b.oldest)}`)]
      : h("span", { class: "muted" }, "nothing to triage")));
}

// ---------- Status: catch up after hours away (BOB-33; design/BOB-33/spec.md, ADR 0005) ----------

/** This device's last visit, the broker's `at` when Casper said he was caught up: one for every project (ADR 0005 §1). */
const STATUS_MARK = "bobnet.status.lastVisit";
/** Sections he opened or folded, per project and section, for the tab's life. */
const STATUS_OPEN = "bobnet.status.open";
const SPAN_MS = { "24h": 86_400_000, week: 7 * 86_400_000 };
/** The read on the marker (`base`: the dot, the Overview's line, the visit span) and, while a chip is pressed, its span's. */
const stv = { base: null, baseFor: null, wide: null, error: null, errorAt: null, loading: false, again: false, last: 0, timer: null, span: null, showAll: new Set(), scrollFor: null };
let connDownAt = null;

const markOf = () => { try { return localStorage.getItem(STATUS_MARK); } catch { return null; } };
function setMark(at) {
  try { at ? localStorage.setItem(STATUS_MARK, at) : localStorage.removeItem(STATUS_MARK); } catch {}
}
const stOpen = () => { try { return JSON.parse(sessionStorage.getItem(STATUS_OPEN) ?? "{}"); } catch { return {}; } };
function setStOpen(key, open) {
  const all = stOpen();
  all[key] = open;
  try { sessionStorage.setItem(STATUS_OPEN, JSON.stringify(all)); } catch {}
}
/** The span pressed: since the visit, 24 h or a week. With no marker, the visit is the last 24 hours. */
function stSpan() {
  const span = stv.span ?? "visit";
  return span === "visit" && !markOf() ? "24h" : span;
}
/** Whether the span is the marker read's: the visit, or a first visit's 24 hours. */
const onBase = () => stSpan() === "visit" || (stSpan() === "24h" && !markOf());
function stReply() {
  if (onBase()) return stv.base;
  return stv.wide?.span === stSpan() ? stv.wide.reply : null;
}

/** One read for the whole tab, two while a chip is pressed (ADR 0005 §2); what shows stays until the reply. */
async function loadStatus() {
  if (stv.loading) return void (stv.again = true);
  stv.loading = true;
  stv.last = Date.now();
  const mark = markOf(), span = stSpan();
  try {
    const base = await boardOp({ op: "status", since: mark ?? new Date(brokerNow() - SPAN_MS["24h"]).toISOString() });
    if (!Array.isArray(base?.projects)) throw new Error("The board's answer has no status in it.");
    const wide = onBase() ? null : await boardOp({ op: "status", since: new Date(Date.parse(base.at) - SPAN_MS[span]).toISOString() });
    Object.assign(stv, { base, baseFor: mark, wide: wide ? { span, reply: wide } : null, error: null });
  } catch (err) {
    Object.assign(stv, { error: err.message, errorAt: new Date(brokerNow()).toISOString() });
  } finally {
    stv.loading = false;
  }
  scheduleRender();
  if (stv.again) {
    stv.again = false;
    await loadStatus();
  }
}
/** On board_changed: at most once per 5 s while Status or the Overview shows; otherwise the minute's tick keeps the dot. */
function statusChanged() {
  const v = viewName();
  if (v !== "status" && v !== "overview") return;
  clearTimeout(stv.timer);
  const wait = stv.last + 5000 - Date.now();
  if (wait <= 0) loadStatus();
  else stv.timer = setTimeout(loadStatus, wait);
}

/** Times as the page says them: "23:10" today, "Sun 23:10" this week, "Mon 9 Nov" before. */
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad2 = (n) => String(n).padStart(2, "0");
function stClock(iso) {
  const d = new Date(iso), now = new Date(brokerNow());
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const midnightOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const back = Math.round((midnightOf(now) - midnightOf(d)) / 86_400_000);
  if (back <= 0) return hm;
  if (back < 7) return `${WD[d.getDay()]} ${hm}`;
  return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}
/** "7 h", "2 h 15 min" under 3 h, "3 d": non-breaking. */
function stAge(iso) {
  const m = Math.max(0, Math.floor((brokerNow() - Date.parse(iso)) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  if (m < 1440) { const hrs = Math.floor(m / 60), mins = m % 60; return hrs < 3 && mins >= 10 ? `${hrs} h ${mins} min` : `${hrs} h`; }
  return `${Math.floor(m / 1440)} d`;
}
const stAgo = (iso) => (stAge(iso) === "just now" ? "just now" : `${stAge(iso)} ago`);
/** A list's whole length: what came and what the board left out past 100. */
const whole = (row, path, list) => list.length + (row.more?.[path] ?? 0);
const sessName = (ss) => `${ss.feature} ${stepName(ss)}`;
const workerName = (id) => workers().find((w) => w.id === id)?.name ?? id;
const permProject = (p) => workers().find((w) => w.id === p.worker_id)?.project ?? null;

/** What's stuck in a row, as the page lists it: bad first, then newest (spec: What's stuck). */
function stuckOf(row) {
  const s = row.stuck;
  const items = [
    ...s.runs.map((r) => stuckRun(r)),
    ...s.ci.map((c) => stuckCi(c)),
    ...s.idle_sessions.map((x) => ({ tone: "warn", label: "Nobody on it", ref: x.session.feature, text: `${sessName(x.session)} is open with no agent for ${stAge(x.since)}`, meta: null, at: x.since })),
    ...s.idle_features.map((x) => ({ tone: "warn", label: "No run", ref: x.ref, text: `${x.ref} is In Progress with no open run for ${stAge(x.since)}`, meta: x.title, at: x.since })),
    ...s.answered_holding.map((x) => stuckAnswered(x)),
  ];
  return items.sort((a, b) => (a.tone === b.tone ? b.at.localeCompare(a.at) : a.tone === "bad" ? -1 : 1));
}
function stuckRun(r) {
  const on = r.session ? sessName(r.session) : "other work";
  const said = { failed: ["Run failed", "bad", "failed"], stopped: ["Run stopped", "warn", "was stopped"], lost: ["Run lost", "warn", "was lost"] }[r.outcome];
  return { tone: said[1], label: said[0], ref: r.session?.feature ?? null, text: `${r.agent}'s run on ${on} ${said[2]}`,
    // The laptop it ran on, from a broker that says it (BOB-44); a lost run is that laptop's restart.
    meta: [r.laptop ? `on ${r.laptop}` : null, r.outcome === "lost" ? "Running when its supervisor restarted; nobody has started it again." : r.reason].filter(Boolean).join(" · ") || null, at: r.ended_at };
}
function stuckCi(c) {
  const land = c.source === "slot" && c.name === "land";
  const sha = c.sha ? (c.url ? h("a", { href: c.url, target: "_blank", rel: "noopener" }, c.sha.slice(0, 8)) : c.sha.slice(0, 8)) : null;
  const who = c.worker ? workerName(c.worker) : null;
  return land
    ? { tone: "bad", label: "Land failed", ref: c.session?.feature ?? null, text: `${who ?? "A"}'s land failed`, meta: [[c.name, c.branch].filter(Boolean).join(" · "), sha ? [" · ", sha] : null], at: c.ended_at }
    : { tone: "bad", label: "CI red", ref: c.session?.feature ?? null, text: `${c.name} failed${c.branch ? ` on ${c.branch}` : ""}`, meta: [who, sha ? [who ? " · " : "", sha] : null], at: c.ended_at, ci: true };
}
const stuckAnswered = (x) => ({ tone: "warn", label: "Answered, still holding", ref: x.feature, text: `${x.ref} was answered ${stAgo(x.answered_at)}; nothing has started${x.feature ? ` on ${x.feature}` : ""}`, meta: null, at: x.answered_at });
const settledOf = (x) => (x.kind === "runs" ? stuckRun(x.entry) : x.kind === "ci" ? stuckCi(x.entry) : stuckAnswered(x.entry));
/** How many are stuck, whole. */
const stuckCount = (row) => ["runs", "ci", "idle_sessions", "idle_features", "answered_holding"].reduce((n, k) => n + whole(row, `stuck.${k}`, row.stuck[k]), 0);

/** Needs you: the board's waits and his permissions from the snapshots, oldest first; a permission holds work up. */
function needsOf(rows, all) {
  const keys = new Set(rows.map((r) => r.project));
  const waits = rows.flatMap((r) => r.waits.map((w) => ({ w, since: w.since, blocking: w.blocking })));
  const perms = humanPerms().filter((p) => all || keys.has(permProject(p))).map((p) => ({ p, since: p.created_at, blocking: true }));
  const list = [...waits, ...perms].sort((a, b) => a.since.localeCompare(b.since));
  const more = rows.reduce((n, r) => n + (r.more?.waits ?? 0), 0);
  return { list, count: list.length + more, more, blocking: list.filter((x) => x.blocking).length };
}
function verdict(rows) {
  const stuck = rows.flatMap(stuckOf);
  const count = rows.reduce((n, r) => n + stuckCount(r), 0);
  const tone = stuck.some((x) => x.tone === "bad") ? "bad" : count ? "warn" : "ok";
  const ci = rows.filter((r) => stuckOf(r).some((x) => x.ci)).map((r) => r.name);
  const done = rows.reduce((n, r) => n + r.done.counts.sessions, 0);
  const sub = [ci.length ? `CI red${rows.length > 1 ? ` on ${ci.join(", ")}` : ""}` : null, count ? `${count} stuck` : null, `${done} done`].filter(Boolean).join(" · ");
  return { tone, word: { bad: "Needs a look", warn: "Mostly OK", ok: "Going OK" }[tone], sub, done, stuck: count, ci };
}
/** The dot on the tab: anything closed, Done or stuck since this device's marker (spec: The dot on the tab). */
function statusNew() {
  const r = stv.base;
  if (!r || (markOf() && stv.baseFor !== markOf())) return false;
  return r.projects.some((p) => p.done.counts.sessions + p.done.counts.features + p.done.counts.releases > 0 || stuckOf(p).some((x) => x.at >= r.since));
}

function caughtUp() {
  const reply = stReply() ?? stv.base;
  if (!reply) return;
  const before = { mark: markOf(), span: stv.span };
  setMark(reply.at);
  stv.span = "visit";
  toast(`Caught up at ${stClock(reply.at)}. This device's next visit starts from here.`, true, () => {
    setMark(before.mark);
    stv.span = before.span;
    loadStatus();
    render();
  }, true);
  loadStatus();
  render();
  window.scrollTo(0, 0);
}

function spanBar(reply, caught) {
  const mark = markOf(), span = stSpan();
  const since = reply?.since ?? (mark && span === "visit" ? mark : new Date(brokerNow() - SPAN_MS[span === "visit" ? "24h" : span]).toISOString());
  const fresh = mark && brokerNow() - Date.parse(mark) < 60_000;
  const [head, sub] = span === "visit" ? ["Since your last visit", fresh ? `${stClock(mark)}, just now` : `${stClock(mark)}, ${stAgo(mark)}`]
    : [span === "week" ? "The last week" : "The last 24 hours", `since ${stClock(since)}`];
  const chipBtn = (key, text) => h("button", { type: "button", "aria-pressed": String(span === key), onclick: () => { stv.span = key; stv.showAll.clear(); render(); if (!onBase()) loadStatus(); } }, text);
  const asked = mark && span === "visit" ? Date.parse(mark) : null;
  const clamped = reply && asked !== null && Date.parse(reply.since) > asked + 60_000;
  return h("div", { class: "span-bar" },
    h("div", { class: "when" }, h("b", null, head), h("span", null, sub)),
    h("div", { class: "seg span-chips", role: "group", "aria-label": "Look back over" },
      mark ? chipBtn("visit", fresh ? "Since now" : `Since ${stClock(mark)}`) : null, chipBtn("24h", "24 h"), chipBtn("week", "A week")),
    caught ? h("button", { type: "button", class: "primary caught", disabled: !(stReply() ?? stv.base) || null, onclick: caughtUp }, "I'm caught up") : null,
    clamped ? h("p", { class: "span-note" }, `Your last visit was ${stAge(mark)} ago; this shows the last 31 days.`)
      : !mark ? h("p", { class: "span-note" }, "First visit on this device, so the last 24 hours. From now on it starts at your last “I'm caught up”.")
      : span !== "visit" ? h("p", { class: "span-note" }, `Widened. Your last visit stays at ${stClock(mark)}.`)
      : caught ? h("p", { class: "span-note" }, "Opening this page doesn't move it; only I'm caught up does.") : null);
}

function answers(rows, needsHref, okHref, all) {
  if (!rows) {
    return h("div", { class: "answers" },
      h("div", { class: "ans", dataset: { tone: "none" } }, h("span", { class: "lab" }, "Needs you"), h("b", null, "…"), h("span", { class: "sub" }, "Reading the board…")),
      h("div", { class: "ans", dataset: { tone: "none" } }, h("span", { class: "lab" }, "Is it going OK?"), h("b", null, "…"), h("span", { class: "sub" }, "Reading the board…")));
  }
  const n = needsOf(rows, all), v = verdict(rows);
  const ntone = n.blocking ? "bad" : n.count ? "warn" : "ok";
  return h("div", { class: "answers" },
    h("a", { class: "ans", href: needsHref, dataset: { tone: ntone } },
      h("span", { class: "lab" }, "Needs you"),
      h("b", null, n.count ? String(n.count) : "Nothing"),
      h("span", { class: "sub" }, n.count ? `${n.blocking} hold${n.blocking === 1 ? "s" : ""} work up · oldest ${stAge(n.list[0]?.since ?? new Date().toISOString())}` : "Nothing waits on you")),
    h("a", { class: "ans", href: okHref, dataset: { tone: v.tone },
      onclick: all ? (e) => { e.preventDefault(); document.querySelector(".pcards")?.scrollIntoView({ behavior: "smooth" }); } : null },
      h("span", { class: "lab" }, "Is it going OK?"),
      h("b", null, v.word),
      h("span", { class: "sub" }, v.sub)));
}

const cutLine = (n, newer, link) => h("p", { class: "note cut" }, `and ${n} more, ${newer ? "newer" : "older"}. The board lists ${newer ? "the oldest" : "the newest"} 100.`, link ? [" ", link] : null);

function statusBanners(reply) {
  if ($("conn").dataset.state === "down") {
    return h("div", { class: "banner down" }, `Can't reach the broker since ${stClock(connDownAt ?? new Date().toISOString())}. This is what this device read then; I'm caught up still works.`);
  }
  if (!stv.error) return null;
  return h("div", { class: "banner down" }, h("b", null, "Board unavailable"), h("span", null, reply ? `Showing what it said at ${stClock(reply.at)}.` : stv.error));
}

function viewStatus() {
  if (svc.projects && !stv.base && !stv.loading && !stv.error) loadStatus();
  const [, k, sec] = hashPath();
  const reply = stReply();
  if (k && k !== "needs") return statusProject(k, sec, reply);
  const rows = reply?.projects ?? null;
  const n = rows ? needsOf(rows, true) : null;
  return [
    statusBanners(reply),
    h("div", { class: "st" },
      spanBar(reply, true),
      answers(rows, "#status/needs", "#status", true),
      !rows ? h("div", { class: "empty-card" }, "Reading the board…")
        : [
          h("section", null, h("h2", null, "Projects ", h("span", { class: "count" }, String(rows.length))),
            rows.length ? h("div", { class: "pcards" }, rows.map(pcard)) : h("div", { class: "empty-card" }, "No project's board on BobNet yet.")),
          h("section", { id: "status-needs" }, h("h2", null, "Needs you ", h("span", { class: "count" }, String(n.count))),
            n.count ? h("div", { class: "card st-card" }, h("ul", { class: "lines st-needs" }, n.list.map((x) => needItem(x, { compact: true, before: reply.since }))),
              n.more ? cutLine(n.more, true, h("a", { href: "#needs" }, "on Needs you")) : null,
              h("a", { class: "more-t sec-link", href: "#needs" }, "Answer them on Needs you →"))
              : h("div", { class: "empty-card" }, "Nothing waits on you.")),
        ],
      h("div", { class: "caught-foot" },
        h("button", { type: "button", class: "primary", disabled: !reply || null, onclick: caughtUp }, "I'm caught up"),
        reply ? h("span", null, `Next time, this page starts at ${stClock(reply.at)}.`) : null)),
  ];
}

function pcard(row) {
  const v = verdict([row]), n = needsOf([row], false), stuck = stuckOf(row), u = row.usage, b = row.backlog;
  const stat = (lab, val, tone, sub) => h("div", { class: "pstat", dataset: { tone } }, h("span", { class: "lab" }, lab), h("b", null, String(val)), sub ? h("span", { class: "s" }, sub) : null);
  return h("a", { class: "pcard card", href: `#status/${row.project}`, dataset: { tone: v.tone, project: row.project } },
    h("div", { class: "top" }, h("span", { class: "name" }, row.name), badge(v.tone === "ok" ? "running" : v.tone === "warn" ? "waiting" : "failed", v.word), h("span", { class: "chev", "aria-hidden": "true" }, "›")),
    h("div", { class: "pstats" },
      stat("Needs you", n.count, n.blocking ? "bad" : n.count ? "warn" : null),
      stat("Done", row.done.counts.sessions, null, row.done.counts.features ? plural(row.done.counts.features, "feature") : null),
      stat("Stuck", v.stuck, stuck.some((x) => x.tone === "bad") ? "bad" : v.stuck ? "warn" : null),
      stat("Tokens", fmtTokens(totalTokens(u.tokens)), null, u.lost ? `+ ${u.lost} unknown` : null)),
    h("div", { class: "pflags" },
      stuck.filter((x) => x.tone === "bad").map((x) => badge("failed", x.label)),
      b.thin ? badge("waiting", "backlog thin") : null,
      b.release && b.release.ready === 0 && b.release.todo > 0 ? badge("ready", `${b.release.ref} has nothing Ready`) : null));
}

const SECTIONS = ["needs", "done", "stuck", "recurring", "backlog", "usage"];
function statusProject(k, focus, reply) {
  const back = h("a", { class: "back", href: "#status" }, "‹ All projects");
  const row = reply?.projects.find((r) => r.project === k);
  if (reply && !row) {
    return [statusBanners(reply), h("div", { class: "st" }, h("div", { class: "p-head" }, back, h("h2", { class: "p-name" }, k)),
      h("div", { class: "empty-card" }, `No project ${k} on BobNet, or you can't read its board.`))];
  }
  const p = svc.projects?.find((x) => x.key === k);
  const who = [p?.lead ? `lead ${shortName(p.lead)}` : null, p?.po ? `PO ${shortName(p.po)}` : null].filter(Boolean).join(" · ");
  const wide = window.matchMedia?.("(min-width: 700px)").matches ?? true;
  const opened = stOpen();
  return [
    statusBanners(reply),
    h("div", { class: "st" },
      h("div", { class: "p-head" }, back, h("h2", { class: "p-name" }, row?.name ?? p?.name ?? k, who ? [" ", h("span", { class: "muted" }, who)] : null)),
      spanBar(reply, false),
      answers(row ? [row] : null, `#status/${k}/needs`, `#status/${k}/stuck`, false),
      row ? h("div", { class: "secs" }, SECTIONS.map((s) => statusSection(k, s, SECTION[s](row, reply), opened[`${k}/${s}`], focus === s || wide)))
        : h("div", { class: "empty-card" }, "Reading the board…"),
      h("p", { class: "note foot-note" }, "I'm caught up is on ", h("a", { href: "#status" }, "All projects"), ": this device keeps one last visit for every project.")),
  ];
}

/** A section's card: open as he left it, else by width (open from 700 px) or because the route names it. */
function statusSection(k, sec, body, kept, dflt) {
  const d = h("details", { class: "sec card", id: `sec-${sec}`, open: (kept ?? dflt) || null, dataset: { sec, tone: body.tone ?? null } },
    h("summary", { class: "sec-h" },
      h("span", { class: "t" }, body.title),
      h("span", { class: "n", dataset: { tone: body.tone ?? null } }, body.count),
      h("span", { class: "scope" }, body.scope),
      h("span", { class: "hl" }, body.headline)),
    h("div", { class: "sec-b" }, body.el));
  // Kept only where he went against the default, so a phone turned to a tablet still opens the rest.
  d.addEventListener("toggle", () => setStOpen(`${k}/${sec}`, d.open === dflt ? undefined : d.open));
  return d;
}

const stEmpty = (text, ok) => h("p", { class: `st-empty${ok ? " ok" : ""}` }, text);
const featLink = (k, ref, label = ref) => h("a", { class: "id", href: featureHref(k, ref) }, label);
/** A session opens on its feature's page, at its step. */
const sessLink = (k, ss) => h("a", { class: "id", href: featureHref(k, ss.feature), onclick: () => (scrollAfter = stepId(ss)) }, ss.feature);

const SECTION = {
  needs(row, reply) {
    const n = needsOf([row], false);
    return {
      title: "Needs you", count: String(n.count), scope: "open now", tone: n.blocking ? "bad" : n.count ? "warn" : "ok",
      headline: n.count ? `${n.blocking} hold${n.blocking === 1 ? "s" : ""} work up · oldest ${stAge(n.list[0].since)}` : "Nothing waits on you",
      el: n.count ? [h("ul", { class: "lines st-needs" }, n.list.map((x) => needItem(x, { compact: true, before: reply.since, project: false }))),
        n.more ? cutLine(n.more, true, h("a", { href: "#needs" }, "on Needs you")) : null,
        h("a", { class: "more-t sec-link", href: "#needs" }, "Answer on Needs you →")] : stEmpty("Nothing waits on you.", true),
    };
  },
  done(row, reply) {
    const k = row.project, d = row.done, c = d.counts, from = stClock(reply.since);
    const parts = [c.features && `${plural(c.features, "feature")} Done`, `${plural(c.sessions, "session")} closed`, c.lands && plural(c.lands, "land"), c.releases && `${plural(c.releases, "release")} closed`].filter(Boolean);
    const nothing = !c.sessions && !c.lands && !c.features && !c.releases;
    const heavy = new Set(row.usage.heavy.map((x) => sessionKey(x.session)));
    const all = stv.showAll.has(`${k}/sessions`);
    const sessions = all ? d.sessions : d.sessions.slice(0, 5);
    return {
      title: "What got done", count: String(c.sessions), scope: `since ${from}`, tone: null,
      headline: nothing ? `Nothing closed since ${from}` : parts.join(" · "),
      el: nothing ? stEmpty(`Nothing closed or landed since ${from}.`) : [
        d.features.length || d.releases.length ? h("div", { class: "grp" }, h("h3", null, "Moved to Done"),
          h("ul", { class: "rows" },
            d.releases.map((r) => h("li", null, badge("done", "release"), h("span", null, h("a", { class: "id", href: `#roadmap/${k}` }, r.ref), r.title.replace(/^R\d+ /, "")), h("time", null, stClock(r.closed_at)))),
            d.features.map((f) => h("li", null, badge(f.type === "bug" ? "bug" : "done", f.type === "bug" ? "bug fixed" : "Done"), h("span", null, featLink(k, f.ref), f.title), h("time", null, stClock(f.at))))),
          whole(row, "done.features", d.features) > d.features.length ? cutLine(row.more["done.features"], false, h("a", { href: `#roadmap/${k}` }, "on the Roadmap")) : null) : null,
        d.sessions.length ? h("div", { class: "grp" }, h("h3", null, "Sessions closed"),
          h("ul", { class: "rows sess" }, sessions.map((s) => sessionRow(k, s, heavy.has(sessionKey(s.session)))),
            d.sessions.length > 5 ? h("li", { class: "show-all" }, h("button", { type: "button", class: "more-t", onclick: () => { all ? stv.showAll.delete(`${k}/sessions`) : stv.showAll.add(`${k}/sessions`); render(); } },
              all ? "Show fewer" : `Show all ${whole(row, "done.sessions", d.sessions)} sessions`)) : null),
          all && row.more?.["done.sessions"] ? cutLine(row.more["done.sessions"], false, h("a", { href: featureHref(k, d.sessions.at(-1).session.feature) }, "on its feature's page")) : null) : null,
      ],
    };
  },
  stuck(row, reply) {
    const s = stuckOf(row), n = stuckCount(row), from = stClock(reply.since);
    const settled = row.stuck.settled;
    const cut = n - s.length;
    return {
      title: "What's stuck", count: String(n), scope: "open now", tone: s.some((x) => x.tone === "bad") ? "bad" : n ? "warn" : "ok",
      headline: n ? [...new Set(s.map((x) => x.label))].join(" · ") : "Nothing stuck",
      el: [
        s.length ? h("ul", { class: "rows stuck" }, s.map((x) => h("li", { dataset: { sev: x.tone } },
          badge(x.tone === "bad" ? "failed" : "waiting", x.label),
          h("span", { class: "what" }, h("span", null, x.ref ? featLink(row.project, x.ref) : null, x.text), x.meta ? h("span", { class: "m" }, x.meta) : null),
          h("time", null, `since ${stClock(x.at)}`, x.at < reply.since ? h("span", { class: "before" }, `before ${from}`) : null)))) : stEmpty("Nothing stuck.", true),
        cut > 0 ? cutLine(cut, false, null) : null,
        settled.length ? h("details", { class: "settled" }, h("summary", null, `Settled since ${from}: ${whole(row, "stuck.settled", settled)}`),
          h("ul", { class: "rows" }, settled.map((x) => { const e = settledOf(x); return h("li", null, badge("done", "settled"), h("span", null, e.ref ? featLink(row.project, e.ref) : null, e.text), h("time", null, stClock(x.settled_at))); })),
          row.more?.["stuck.settled"] ? cutLine(row.more["stuck.settled"], false, null) : null) : null,
      ],
    };
  },
  // BOB-35 fills row.recurring; until then the section shows and says so (Casper, 2026-11-15).
  recurring() {
    return { title: "Recurring problems", count: "–", scope: "", tone: null, headline: "Comes with theme tags (BOB-35)",
      el: stEmpty("Review findings get a theme when their session closes, from BOB-35 on. Until then this section has nothing to group.") };
  },
  backlog(row) {
    const k = row.project, b = row.backlog, rel = b.release;
    const ready = whole(row, "backlog.ready", b.ready), none = whole(row, "backlog.no_criteria", b.no_criteria);
    const about = b.sessions_estimate === null ? "" : `, about ${plural(b.sessions_estimate, "session")}`;
    const nothingReady = rel && rel.ready === 0 && rel.todo > 0;
    return {
      title: "Backlog health", count: b.thin ? "thin" : "OK", scope: "now", tone: b.thin || nothingReady ? "warn" : "ok",
      headline: `${plural(ready, "Ready feature")} with criteria${about} · ${b.triage.count} in triage`,
      el: [
        b.thin ? h("p", { class: "thin" }, `Thin: fewer than 2 Ready features with criteria, and ${rel.ref} has ${rel.todo} more to do.`) : null,
        h("ul", { class: "rows health" },
          h("li", null, h("span", { class: "k" }, "Ready, with criteria"), h("span", null, `${plural(ready, "feature")}${b.sessions_estimate === null ? "" : `, about ${plural(b.sessions_estimate, "session")} of work`}`,
            b.ready.length ? h("span", { class: "m" }, b.ready.map((f, i) => [i ? ", " : "", featLink(k, f.ref), `${f.criteria} criteria`])) : null,
            row.more?.["backlog.ready"] ? cutLine(row.more["backlog.ready"], false, h("a", { href: `#roadmap/${k}` }, "on the Roadmap")) : null)),
          h("li", null, h("span", { class: "k" }, "No criteria yet"),
            none ? h("span", null, plural(none, "feature"), h("span", { class: "m" }, b.no_criteria.map((f, i) => [i ? " · " : "", featLink(k, f.ref), f.title])),
              row.more?.["backlog.no_criteria"] ? cutLine(row.more["backlog.no_criteria"], false, h("a", { href: `#roadmap/${k}` }, "on the Roadmap")) : null) : h("span", null, "None")),
          h("li", null, h("span", { class: "k" }, "In triage"), h("span", null, b.triage.count
            ? [`${plural(b.triage.count, "item")}, the oldest ${stAge(b.triage.oldest.at)} `, h("a", { class: "id", href: `#triage/${k}` }, b.triage.oldest.ref)] : "Nothing to triage")),
          h("li", { dataset: { warn: String(Boolean(nothingReady)) } }, h("span", { class: "k" }, "Open release"), rel
            ? h("span", null, h("a", { class: "id", href: `#roadmap/${k}` }, rel.ref), `${plural(rel.todo, "feature")} to do`, nothingReady ? ", nothing Ready" : "")
            : h("span", null, "No open release"))),
      ],
    };
  },
  usage(row, reply) {
    const u = row.usage, from = stClock(reply.since), total = totalTokens(u.tokens);
    const max = Math.max(1, ...u.by_agent.map((a) => totalTokens(a.tokens)));
    const unknown = (n) => (n === 1 ? "1 run's tokens unknown" : `${n} runs' tokens unknown`);
    const live = running().filter((w) => w.project === row.project).sort((a, b) => workerTokens(b) - workerTokens(a));
    const kindOf = (ss) => ss.kind;
    return {
      title: "Usage", count: fmtTokens(total), scope: `since ${from}`, tone: u.heavy.length ? "warn" : null,
      headline: [`${fmtTokens(total)} tokens`, u.lost ? unknown(u.lost) : null, u.heavy.length ? plural(u.heavy.length, "heavy session") : null].filter(Boolean).join(" · "),
      el: [
        u.by_agent.length ? h("ul", { class: "rows usage" }, u.by_agent.map((a) => {
          const n = totalTokens(a.tokens);
          return h("li", null,
            h("span", { class: "who-u" }, h("b", null, a.agent), h("span", { class: "m" }, a.role)),
            h("span", { class: "meter" }, n ? h("i", { style: `width:${Math.max(2, (n / max) * 100)}%` }) : null),
            h("span", { class: "num" }, n ? fmtTokens(n) : null, a.lost ? h("span", { class: "unk" }, `${n ? "+ " : ""}${plural(a.lost, "run")} unknown`) : null));
        })) : stEmpty(`No runs ended since ${from}.`),
        u.lost ? h("p", { class: "note" }, `${unknown(u.lost)}: ${u.lost === 1 ? "it was" : "they were"} running when the supervisor restarted, so ${u.lost === 1 ? "its" : "their"} use was never reported. Not counted as zero.`) : null,
        u.heavy.length ? h("div", { class: "grp" }, h("h3", null, "Heavier than usual"),
          h("ul", { class: "rows" }, u.heavy.map((x) => h("li", { dataset: { sev: "warn" } }, badge("waiting", `${(totalTokens(x.tokens) / Math.max(1, totalTokens(x.usual))).toFixed(1)}×`),
            h("span", null, sessLink(row.project, x.session), `${stepName(x.session)}: ${fmtTokens(totalTokens(x.tokens))} tokens, a ${kindOf(x.session)}'s usual is ${fmtTokens(totalTokens(x.usual))}`))))) : null,
        live.length ? h("div", { class: "grp" }, h("h3", null, "Running now"), h("p", { class: "note" }, "From the laptops. Counted above when each run ends."),
          h("ul", { class: "rows running" }, live.map((w) => h("li", null, h("span", { class: "dot on" }), h("span", null, whoName(w), ` ${w.role}`), h("span", { class: "num" }, `${fmtTokens(workerTokens(w))} so far`))))) : null,
      ],
    };
  },
};

function sessionRow(k, s, heavy) {
  const c = s.counts;
  const finds = [c.blockers && plural(c.blockers, "blocker"), c.majors && plural(c.majors, "major"), c.sent_back && `${c.sent_back} sent back`].filter(Boolean);
  return h("li", { class: "srow", style: `--k: var(--k-${s.session.kind})` },
    h("span", { class: "kind" }, s.session.kind),
    h("span", { class: "what" },
      h("span", null, sessLink(k, s.session), h("b", null, stepName(s.session)), s.closed_by ? ` · ${askedBy(s.closed_by)}` : ""),
      h("span", { class: "outcome" }, h("span", { class: "need", dataset: { need: s.need } }, s.need === "casper" ? "needs you" : s.need === "answer" ? "waited on an answer" : "need none"),
        finds.length ? h("span", null, finds.join(", ")) : null,
        h("span", { class: `tk${heavy ? " heavy" : ""}` }, `${fmtTokens(totalTokens(s.tokens))} tokens`),
        s.lost ? h("span", { class: "tk heavy" }, `+ ${plural(s.lost, "run")} unknown`) : null),
      s.summary ? h("span", { class: "sum" }, s.summary) : null),
    h("time", null, stClock(s.ended_at)));
}

/** The Overview's one line (BOB-40): the marker read's done and stuck, linking to Status; not drawn while loading or on an error. */
function statusLine() {
  const r = stv.base;
  if (!r || stv.error) return null;
  const mark = markOf();
  const v = verdict(r.projects);
  return h("a", { class: "st-line banner", href: "#status", dataset: { tone: v.tone } },
    h("span", null, h("b", null, `Since ${stClock(mark ?? r.since)}`), mark ? ` (${stAgo(mark)})` : "", ": ",
      `${v.done} done, ${v.stuck} stuck`, v.ci.length ? `, CI red on ${v.ci.join(", ")}` : ""),
    h("span", { class: "go" }, "Status ›"));
}

/** After a draw: #status/needs and #status/<project>/<section> land on what they name, once per route. */
function statusScroll() {
  if (viewName() !== "status" || stv.scrollFor === location.hash || !stReply()) return;
  stv.scrollFor = location.hash;
  const [, k, sec] = hashPath();
  const el = k === "needs" ? $("status-needs") : sec ? $(`sec-${sec}`) : null;
  el?.scrollIntoView({ block: "start" });
}

// ---------- Triage: a project's backlog items, bugs first (capture 4, 5; spec: Triage) ----------

/** "<project>" → { items, releases, error }: the whole triage list, read once and refetched on board_changed. */
const backlogs = new Map();
/** Items captured from this page, marked "just captured" on the list. */
const capturedHere = new Set();

async function loadBacklog(key) {
  const busy = `triage:${key}`;
  if (svc.loading.has(busy)) return void svc.again.add(busy);
  svc.loading.add(busy);
  try {
    const [releases, items] = await Promise.all([listAll({ op: "list", project: key, of: "releases" }, "releases"), listAll({ op: "list", project: key, of: "backlog" }, "items")]);
    backlogs.set(key, { releases, items, error: null });
  } catch (err) {
    backlogs.set(key, { ...(backlogs.get(key) ?? { releases: [], items: [] }), error: err.message });
  } finally {
    svc.loading.delete(busy);
  }
  if (viewName() === "triage") scheduleRender();
  if (svc.again.delete(busy)) await loadBacklog(key);
}

/** `#triage/<project>[/edit]`, or the project last picked on a page, or the first in the service. */
function triageRoute() {
  const [, key, mode] = hashPath();
  const keys = (svc.projects ?? []).map((p) => p.key);
  const edit = mode === "edit";
  if (keys.includes(key)) return { key, edit };
  if (keys.includes(state.project)) return { key: state.project, edit };
  return keys.length ? { key: keys[0], edit } : null;
}

const DAY = 86_400_000;
const days = (iso) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY));
const age = (iso) => { const d = days(iso); return d === 0 ? "today" : d === 1 ? "1 day" : `${d} days`; };
const isBug = (d) => d.type === "bug";

function viewTriage() {
  const route = triageRoute();
  if (!route) return [noProjects()];
  const { key, edit } = route;
  const p = svc.projects.find((x) => x.key === key);
  const data = backlogs.get(key);
  if (!data && !svc.loading.has(`triage:${key}`)) loadBacklog(key);
  const to = (k, e) => `#triage/${k}${e ? "/edit" : ""}`;
  const all = data?.items ?? [];
  // Releases to filter by and move into: those still open, and any a listed item names.
  const rels = (data?.releases ?? []).filter((r) => r.status !== "closed" || all.some((d) => d.release === r.ref));
  const f = rels.some((r) => r.ref === state.triage.filter) || ["all", "bugs", "none"].includes(state.triage.filter) ? state.triage.filter : "all";
  const pick = (v, label) => h("button", { type: "button", "aria-pressed": String(f === v), onclick: () => { state.triage = { filter: v, all: false }; render(); } }, label);
  const bar = h("div", { class: "bar-row" },
    svc.projects.length > 1 ? projectSwitch(key, (k) => to(k, edit)) : h("b", null, p.name),
    all.length ? h("span", { class: "seg filters" }, pick("all", `All ${all.length}`), pick("bugs", `Bugs ${all.filter(isBug).length}`),
      rels.map((r) => pick(r.ref, `${r.ref} ${all.filter((d) => d.release === r.ref).length}`)), pick("none", `No release ${all.filter((d) => !d.release).length}`)) : null,
    all.length && rels.length ? h("button", { type: "button", class: `gates-btn${edit ? " primary" : ""}`, onclick: () => (location.hash = to(key, !edit)) }, edit ? "Done" : "Edit your gates") : null);
  if (!data) return [bar, h("div", { class: "empty-card" }, "Reading the board…")];
  const out = [bar];
  if (data.error) out.push(h("div", { class: "banner down" }, h("b", null, "Board unavailable"), h("span", null, data.error)));
  if (edit) out.push(h("div", { class: "banner editing" }, h("b", null, "Your gates"), h("span", null, `Put an item in a release or take it out. Everything else on an item is ${poOf(p)}'s triage.`)));
  if (!all.length) {
    out.push(h("div", { class: "empty-card" }, `Nothing to triage in ${p.name}. Capture something with + Capture; it lands here.`));
    return out;
  }
  const shown = all.filter((d) => f === "all" || (f === "bugs" ? isBug(d) : f === "none" ? !d.release : d.release === f))
    .sort((a, c) => isBug(c) - isBug(a) || a.created_at.localeCompare(c.created_at) || a.ref.localeCompare(c.ref, undefined, { numeric: true }));
  const cut = state.triage.all ? shown : shown.slice(0, 25);
  const ages = all.map((d) => days(d.created_at)).sort((a, c) => a - c);
  const bugs = all.filter(isBug).length;
  out.push(h("div", { class: "totals" },
    h("div", null, h("b", null, all.length), h("span", null, "backlog items")),
    h("div", { class: bugs ? "hot" : "" }, h("b", null, bugs), h("span", null, "open bugs")),
    h("div", null, h("b", null, `${ages.at(-1)} d`), h("span", null, "oldest")),
    h("div", null, h("b", null, `${ages[Math.floor(ages.length / 2)]} d`), h("span", null, "median age")),
    h("div", null, h("b", null, ages.filter((d) => d < 7).length), h("span", null, "captured this week"))));
  const options = [...rels.filter((r) => r.status !== "closed").map((r) => [r.ref, r.title]), ["", "No release"]];
  // An item in a closed release shows it, selected and not to be picked again (Toad, BOB-8 review 3).
  const optionsOf = (d) => {
    const closed = rels.find((r) => r.ref === d.release && r.status === "closed");
    return closed ? [[closed.ref, closed.title, true], ...options] : options;
  };
  out.push(shown.length
    ? h("div", { class: "table-wrap" }, h("table", { class: "stack triage" },
        h("thead", null, h("tr", null, h("th", null, "Item"), h("th", null, "Type"), h("th", null, "Release"), h("th", null, "Age"))),
        h("tbody", null,
          cut.map((d) => h("tr", { class: capturedHere.has(`${key}:${d.ref}`) ? "is-open" : "" },
            h("td", { class: "wide keep", "data-label": "" }, h("span", { class: "id" }, d.ref), h("span", { class: "title" }, d.title),
              d.casper_words ? h("div", { class: "sub" }, `Casper: “${d.casper_words}”`) : null,
              d.parent_hint ? h("div", { class: "sub muted" }, "Parent hint: ", h("a", { href: featureHref(key, d.parent_hint) }, d.parent_hint)) : null,
              capturedHere.has(`${key}:${d.ref}`) ? h("div", { class: "now" }, "just captured, from the dashboard") : null),
            h("td", { "data-label": "Type" }, isBug(d) ? badge("bug", d.blocks_use ? "bug · blocks use" : "bug") : h("span", { class: "muted" }, d.type)),
            h("td", { "data-label": "Release" }, edit
              ? h("select", { class: "move", "aria-label": `Release of ${d.ref}`, onchange: (e) => moveItem(key, data, d, e.target.value || null, e.target) },
                  optionsOf(d).map(([v, label, off]) => h("option", { value: v, selected: v === (d.release ?? "") || null, disabled: off || null }, label)))
              : d.release ?? h("span", { class: "muted" }, "none")),
            h("td", { "data-label": "Age", class: "age" }, age(d.created_at)))),
          shown.length > cut.length ? h("tr", { class: "fold" }, h("td", { colspan: 4, class: "full" }, button(`Show all ${shown.length}`, "", () => { state.triage.all = true; render(); }))) : null)))
    : h("div", { class: "empty-card" }, "No items here."));
  out.push(h("p", { class: "note" }, `Bugs first, then oldest first. Triage is ${poOf(p)}'s, with the board tools: slot into a feature, make it a feature, put it in a release or take it out, drop it with a reason; each keeps its id. Putting one in a release is also yours, under Edit your gates.`));
  return out;
}

/** Casper's gate on a backlog item: its release (notes 26). Its Undo puts the release before back. */
async function moveItem(key, data, d, to, select) {
  if (select) select.disabled = true;
  const before = d.release ?? null;
  const name = (ref) => (ref ? `in “${data.releases.find((r) => r.ref === ref)?.title ?? ref}”` : "in no release");
  const send = async (release, said, undo) => {
    try {
      const res = await boardOp({ op: "update", project: key, ref: d.ref, set: { release } }, true);
      toast(said, true, undo && res.seq ? undo : null);
    } catch (err) {
      toast(err.message, false);
    }
    await loadBacklog(key);
  };
  await send(to, `${d.ref} is ${name(to)}. Recorded as yours.`, () => send(before, "Undone.", null));
}

// ---------- Capture: one field, on any screen (capture 6; spec: Capture) ----------

/** Captures made while the board was away, sent on the next welcome (README C4). */
const QUEUE = "bobnet.captures";
const queued = () => { try { return JSON.parse(localStorage.getItem(QUEUE) ?? "[]"); } catch { return []; } };
const setQueued = (ops) => (ops.length ? localStorage.setItem(QUEUE, JSON.stringify(ops)) : localStorage.removeItem(QUEUE));
/** The board refused these as they stand: they never go as they are, so each comes back in the dialog (Toad, BOB-8 review 1). */
const REFUSED = new Set(["invalid", "forbidden", "conflict", "bad_frame", "frame_too_large", "secret_detected"]);
const refused = (err) => REFUSED.has(err.code);

/** The first sentence, or line, is the title; the whole text is kept as Casper's words. */
const titleOf = (text) => text.split(/(?<=[.!?])\s|\n/)[0].trim().slice(0, 300);

/** The project on screen, else the one last picked on a page, else the first. */
function captureProject() {
  const keys = (svc.projects ?? []).map((p) => p.key);
  const [v, key] = hashPath();
  if (["roadmap", "triage", "usage"].includes(v) && keys.includes(key)) return key;
  if (v === "feature") return featureRoute()?.p.key ?? pageProject() ?? keys[0];
  if (v === "triage") return triageRoute()?.key ?? keys[0];
  if (v === "roadmap") return roadmapRoute()?.key ?? keys[0];
  return keys.includes(state.project) ? state.project : keys[0];
}

/** The feature on screen, for a capture's found in: only on the Feature view. */
function foundHere() {
  if (viewName() !== "feature") return null;
  const route = featureRoute();
  if (!route) return null;
  const f = feats.get(`${route.p.key}/${route.ref}`)?.item ?? svc.roadmaps.get(route.p.key)?.features.find((x) => x.ref === route.ref);
  return f ? { ref: f.ref, title: f.title } : null;
}

/** With `back`, a refused capture, its text and choices as Casper made them, and why it was refused. */
function openCapture(back = null) {
  const dlg = $("capture");
  let key = back?.op.project ?? captureProject();
  let bug = back?.op.type === "bug", where = back?.op.bug_where ?? "staging", blocks = !!back?.op.blocks_use;
  // Opened on a feature, it is found there (spec: Capture from the Feature view); every other screen leaves it empty.
  let found = back ? (back.op.found_in ? { ref: back.op.found_in, title: null } : null) : foundHere();
  const nameOf = (k) => svc.projects.find((p) => p.key === k)?.name ?? k;
  const keep = (fn) => { const v = $("cap-text")?.value ?? ""; fn(); $("cap-text").value = v; $("cap-text").focus(); };
  const draw = () => dlg.replaceChildren(h("form", { method: "dialog", onsubmit: (e) => { e.preventDefault(); submit(); } },
    h("h2", { id: "capture-h" }, "Capture"),
    h("textarea", { id: "cap-text", "aria-label": "What to capture", placeholder: "What is it? A title and a sentence is enough.", required: true }),
    found ? h("p", { class: "found-in" }, h("span", null, `Found in ${found.ref}${found.title ? ` · ${found.title}` : ""}`),
      h("button", { type: "button", class: "x", "aria-label": `Not found in ${found.ref}`, onclick: () => keep(() => { found = null; draw(); }) }, "×")) : null,
    svc.projects.length > 1 ? h("div", { class: "opt" }, h("span", null, "Project"), h("span", { class: "seg" }, svc.projects.map((p) => h("button", { type: "button", "aria-pressed": String(p.key === key), onclick: () => keep(() => { if (p.key !== key) found = null; key = p.key; draw(); }) }, p.name)))) : null,
    h("div", { class: "opt" }, h("span", null, "Is it a bug?"), h("span", { class: "seg" },
      h("button", { type: "button", "aria-pressed": String(!bug), onclick: () => keep(() => { bug = false; draw(); }) }, "No"),
      h("button", { type: "button", "aria-pressed": String(bug), onclick: () => keep(() => { bug = true; draw(); }) }, "Bug"))),
    bug ? h("div", { class: "opt" }, h("span", null, "Where"), h("span", { class: "seg" }, ["staging", "production"].map((w) => h("button", { type: "button", "aria-pressed": String(where === w), onclick: () => keep(() => { where = w; draw(); }) }, w))),
      h("label", { class: "check" }, h("input", { type: "checkbox", id: "cap-blocks", checked: blocks || null, onchange: (e) => keep(() => { blocks = e.target.checked; draw(); }) }), "Blocks use")) : null,
    back ? h("p", { class: "note refused" }, `Not captured: ${back.message}`) : null,
    h("p", { class: "note" }, bug && blocks ? "A bug that blocks use also goes on Needs you until it is slotted or closed." : `It goes to ${nameOf(key)}'s triage list, with your words as you typed them. Release and feature are set at triage.`),
    h("div", { class: "foot" }, button("Cancel", "", () => dlg.close()), h("button", { type: "submit", class: "primary" }, "Capture"))));
  const submit = () => {
    const text = $("cap-text").value.trim();
    if (!text) return $("cap-text").focus();
    dlg.close();
    capture(key, nameOf(key), {
      op: "capture", project: key, capture_id: crypto.randomUUID(), title: titleOf(text), casper_words: text, type: bug ? "bug" : "task",
      ...(bug ? { bug_where: where, ...(blocks ? { blocks_use: true } : {}) } : {}),
      ...(found ? { found_in: found.ref } : {}),
    });
  };
  draw();
  if (back) $("cap-text").value = back.op.casper_words;
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
  $("cap-text").focus();
}

/** Never asks back: with the board away, it waits on this device and goes when the board is back. */
async function capture(key, name, op) {
  // A bug that blocks use also waits on Casper (spec: Capture; BOB-8 as built, gap 3).
  const also = op.blocks_use ? ", and on Needs you" : "";
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setQueued([...queued(), op]);
    return toast(`Captured. It waits on this device and goes to ${name}'s triage list when the board is back.`);
  }
  try {
    const res = await boardOp(op, true);
    capturedHere.add(`${key}:${res.ref}`);
    toast(`Captured as ${res.ref} in ${name}'s triage list${also}.`);
  } catch (err) {
    if (refused(err)) return openCapture({ op, message: err.message });
    // The board away, or the socket: it waits here under its capture_id, which the board takes once.
    setQueued([...queued(), op]);
    return toast(`Captured. It waits on this device and goes to ${name}'s triage list when the board is back.`);
  }
  if (backlogs.has(key)) await loadBacklog(key);
}

/** Sends what waited on this device; each leaves the queue once the board has answered it. */
async function flushCaptures() {
  const ops = queued();
  let sent = 0;
  for (const op of ops) {
    try {
      const res = await boardOp(op, true);
      capturedHere.add(`${op.project}:${res.ref}`);
      sent++;
    } catch (err) {
      // Still away: the rest wait for the next welcome.
      if (!refused(err)) return;
      setQueued(queued().filter((x) => x.capture_id !== op.capture_id));
      // One refusal at a time in the dialog; once Casper has sent it again or let it go, the rest go.
      if (sent) toast(`Sent ${plural(sent, "capture")} that waited on this device.`);
      const dlg = $("capture");
      const show = () => {
        dlg.addEventListener("close", () => flushCaptures(), { once: true });
        openCapture({ op, message: err.message });
      };
      // Not over a capture Casper is typing (Toad, BOB-10 review 6): it opens once he has closed that one.
      if (dlg.open) dlg.addEventListener("close", show, { once: true });
      else show();
      return;
    }
    setQueued(queued().filter((x) => x.capture_id !== op.capture_id));
    if (backlogs.has(op.project)) loadBacklog(op.project);
  }
  if (sent) toast(`Sent ${plural(sent, "capture")} that waited on this device.`);
}

// ---------- Rendering: usage ----------

const quantile = (xs, q) => { const v = [...xs].sort((a, c) => a - c); const i = (v.length - 1) * q; return v[Math.floor(i)] + (v[Math.ceil(i)] - v[Math.floor(i)]) * (i % 1); };
function niceStep(max, n = 4) { const step0 = max / n, mag = 10 ** Math.floor(Math.log10(step0 || 1)); return [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= step0); }
/** The chart's drawing width: the page's column less the card's padding, so its text stays at its set size. */
function chartWidth() { const w = ($("view")?.clientWidth || 760) - (window.innerWidth <= 760 ? 24 : 32) - 30; return Math.max(280, Math.min(720, Math.round(w))); }
const runName = (r) => r.name ?? r.role;

/** A role's runs as one line: the call count carries on, and each new worker starts from a small context again. */
function roleLine(runs) {
  const pts = [], resets = [];
  for (const r of runs.filter((x) => x.ctx?.length)) { if (pts.length) resets.push({ at: pts.length + 1, resumed: !!r.resumed }); pts.push(...r.ctx); }
  return { pts, resets };
}

function chartSeries(b) {
  const { cur, prev, prev2 } = sessionsOf(b);
  const curRuns = sessionRuns(b, cur?.name), prevRuns = sessionRuns(b, prev?.name);
  const band = b.baseline.p50.map((_, i) => [b.baseline.p25[i], b.baseline.p50[i], b.baseline.p75[i]]);
  const bandNote = `The grey band is the middle half of ${b.baseline.runs} earlier runs at the same call, the line in it their median.`;
  const c = state.chart;
  if (c.mode === "session") {
    const cum = (runs) => { let t = 0; return runs.flatMap((r) => r.ctx ?? []).map((v) => (t += v)); };
    return {
      series: [
        cur ? { name: `${cur.name} so far`, pts: cum(curRuns), color: "var(--accent)", style: "solid", w: 2.5 } : null,
        prev ? { name: prev.name, pts: cum(prevRuns), color: "var(--muted)", style: "dash", w: 2 } : null,
        prev2 ? { name: prev2.name, pts: cum(sessionRuns(b, prev2.name)), color: "var(--idle)", style: "dot", w: 2 } : null,
      ].filter(Boolean),
      band: null,
      note: "Every call in the session, in order, across all agents, with its context summed. A steeper line means each call carries more context.",
    };
  }
  if (!c.role) return { series: curRuns.filter((r) => r.ctx?.length).map((r) => ({ name: runName(r), pts: r.ctx, color: "var(--accent)", style: "solid", w: 1.5, op: 0.55 })), band, note: `Each line is one run in ${cur?.name ?? "the session"}, from its own first call. ${bandNote}` };
  const one = c.run ? [...curRuns, ...prevRuns, ...b.runs].find((r) => r.id === c.run) : null;
  if (one) {
    const pr = roleLine(prevRuns.filter((r) => r.role === one.role));
    return { series: [{ name: `${runName(one)}, this run`, pts: one.ctx ?? [], color: "var(--accent)", style: "solid", w: 2.5 }, pr.pts.length ? { name: `${one.role}, ${prev.name}`, pts: pr.pts, resets: pr.resets, color: "var(--muted)", style: "dash", w: 2 } : null].filter(Boolean), band, note: `This run alone, from its first call. ${bandNote}` };
  }
  const now = roleLine(curRuns.filter((r) => r.role === c.role)), pr = roleLine(prevRuns.filter((r) => r.role === c.role));
  return {
    series: [{ name: `${c.role}, ${cur?.name ?? ""}`, pts: now.pts, resets: now.resets, color: "var(--accent)", style: "solid", w: 2.5 }, pr.pts.length ? { name: `${c.role}, ${prev.name}`, pts: pr.pts, resets: pr.resets, color: "var(--muted)", style: "dash", w: 2 } : null].filter(Boolean),
    band,
    note: `All of the role's runs in the session, one after another. The count of calls carries on; a new worker starts again from a small context, so the line drops there (dotted). A resumed worker keeps its context. ${bandNote}`,
  };
}

/** Pauses re-rendering while the pointer is over a chart, so its tooltip isn't rebuilt from under it. */
let holdRender = false;

function contextChart(b) {
  const { cur } = sessionsOf(b);
  const roles = [...new Set(sessionRuns(b, cur?.name).map((r) => r.role))];
  const { series, band, note } = chartSeries(b);
  const { svg, tip, wrap } = plotChart(series, band);
  const c = state.chart;
  const seg = (mode, label) => h("button", { type: "button", "aria-pressed": String(c.mode === mode && !c.role), onclick: () => { state.chart = { mode, role: null, run: null }; render(); } }, label);
  const one = c.run && [...sessionRuns(b, cur?.name), ...b.runs].find((r) => r.id === c.run);
  const key = c.mode === "session" || c.role
    ? series.map((sr) => h("span", null, h("i", { class: sr.style === "solid" ? "" : sr.style, style: `--k:${sr.color}` }), `${sr.name} · ${sr.pts.length} calls`))
    : [h("span", null, h("i", { style: "--k:var(--accent)" }), `every run in ${cur?.name ?? "the session"}`)];
  if (band) key.push(h("span", null, h("i", { class: "band", style: "--k:var(--idle)" }), "earlier runs, middle half and median"));
  if (series.some((sr) => sr.resets?.length)) key.push(h("span", null, h("i", { class: "dot", style: "--k:var(--muted)" }), "a new worker for the role starts"));
  wrap.append(
    h("div", { class: "bar-row", style: "margin:0" },
      h("span", { class: "seg" }, seg("session", "Whole session"), seg("agent", "Every run")),
      h("label", { for: "role-pick", class: "muted" }, "one role"),
      h("select", { id: "role-pick", onchange: (e) => { state.chart = { mode: e.target.value ? "agent" : "session", role: e.target.value || null, run: null }; render(); } },
        h("option", { value: "" }, "–"), roles.map((r) => h("option", { value: r, selected: c.role === r || null }, r))),
      one ? h("span", { class: "muted" }, `showing ${runName(one)}'s run · `, h("button", { type: "button", class: "chip", onclick: () => { state.chart = { ...c, run: null }; render(); } }, `all ${one.role} runs`)) : null),
    svg, h("div", { class: "key" }, key), h("div", { class: "note", style: "margin:0" }, note), tip);
  return wrap;
}

/** The context-per-call chart itself: lines, the band, labels at line ends and a tooltip; the caller adds its controls and key. */
function plotChart(series, band) {
  const W = chartWidth(), H = W < 500 ? 240 : 260, L = 46, R = W < 500 ? 16 : 140, T = 14, B = 28;
  const xMax = Math.max(10, ...series.map((x) => x.pts.length), band?.length ?? 0);
  const yMax0 = Math.max(1, ...series.flatMap((x) => x.pts), ...(band ?? []).map((x) => x[2]));
  const step = niceStep(yMax0), yMax = Math.ceil(yMax0 / step) * step;
  const yt = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const xs = niceStep(xMax, W < 500 ? 4 : 6), xt = Array.from({ length: Math.floor(xMax / xs) + 1 }, (_, i) => i * xs);
  const x = (i) => L + (i / xMax) * (W - L - R), y = (v) => T + (1 - v / yMax) * (H - T - B);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Context size per call" });
  svg.append(s("g", { class: "grid" }, ...yt.map((v) => s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }))));
  svg.append(s("g", { class: "axis" }, ...yt.map((v) => s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, fmtTokens(v))), ...xt.map((v) => s("text", { x: x(v), y: H - 8, "text-anchor": "middle" }, String(v))), s("text", { x: W - R, y: H - 8, dx: 6 }, "calls")));
  if (band?.length) {
    svg.append(s("polygon", { points: [...band.map((q, i) => `${x(i + 1)},${y(q[2])}`), ...band.map((q, i) => `${x(i + 1)},${y(q[0])}`).reverse()].join(" "), fill: "var(--idle)", "fill-opacity": 0.18 }));
    svg.append(s("polyline", { points: band.map((q, i) => `${x(i + 1)},${y(q[1])}`).join(" "), fill: "none", stroke: "var(--idle)", "stroke-width": 1.5 }));
  }
  const dash = { solid: null, dash: "6 4", dot: "1.5 4" };
  const labels = [];
  for (const sr of series) {
    if (!sr.pts.length) continue;
    // A role's line breaks at each new worker, so the drop reads as a restart, not a fall.
    const cuts = [0, ...(sr.resets ?? []).map((r) => r.at - 1), sr.pts.length];
    for (let k = 0; k < cuts.length - 1; k++) {
      svg.append(s("polyline", { points: sr.pts.slice(cuts[k], cuts[k + 1]).map((v, j) => `${x(cuts[k] + j + 1)},${y(v)}`).join(" "), fill: "none", stroke: sr.color, "stroke-width": sr.w, "stroke-dasharray": dash[sr.style], "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-opacity": sr.op ?? 1 }));
    }
    for (const r of sr.resets ?? []) svg.append(s("line", { x1: x(r.at - 0.5), x2: x(r.at - 0.5), y1: T, y2: H - B, stroke: sr.color, "stroke-width": 1, "stroke-dasharray": "2 3", "stroke-opacity": 0.6 }));
    labels.push({ y: y(sr.pts.at(-1)), x: x(sr.pts.length), text: sr.name, m: sr.style !== "solid" });
  }
  // Direct labels at line ends when there are few enough to read, nudged apart; the key carries them otherwise.
  if (labels.length <= 4 && R > 60) {
    labels.sort((a, c) => a.y - c.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    for (const l of labels) svg.append(s("text", { class: `lab${l.m ? " m" : ""}`, x: l.x + 6, y: l.y + 4 }, l.text));
  }
  const cross = s("line", { y1: T, y2: H - B, stroke: "var(--muted)", "stroke-width": 1, visibility: "hidden" });
  const hit = s("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" });
  svg.append(cross, hit);
  const tip = h("div", { class: "tip", hidden: true });
  const wrap = h("div", { class: "chart" });
  const leave = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); holdRender = false; };
  const move = (ev) => {
    holdRender = true;
    const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * xMax);
    if (i < 1 || i > xMax) return leave();
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    const rows = series.filter((sr) => sr.pts.length >= i).map((sr) => [sr, sr.pts[i - 1]]).sort((a, c) => c[1] - a[1]).slice(0, 6);
    tip.replaceChildren(h("b", null, `Call ${i}`), ...rows.map(([sr, v]) => h("div", { class: "row" }, h("span", null, h("i", { class: sr.style === "solid" ? "" : "dash", style: `--k:${sr.color}` }), sr.tip ?? sr.name), h("span", null, fmtTokens(v)))),
      band?.[i - 1] ? h("div", { class: "row muted" }, h("span", null, "earlier runs, median"), h("span", null, fmtTokens(band[i - 1][1]))) : null);
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    tip.style.left = `${Math.min(ev.clientX - wr.left + 14, wr.width - 200)}px`;
    tip.style.top = `${ev.clientY - wr.top + 10}px`;
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", leave);
  return { svg, tip, wrap };
}

const KIND = { build: "var(--k-build)", design: "var(--k-design)", review: "var(--k-review)", retro: "var(--k-retro)", other: "var(--idle)" };
/** A session's name in a few letters, for narrow bars: "b3", "des", "other". */
const shortSession = (ss) => (ss.kind === "build" ? `b${ss.name.split(" ").at(-1)}` : ss.kind === "other" ? "other" : ss.kind.slice(0, 3));

function sessionBars(b) {
  // Other work spans everything between sessions: as a bar it would set the scale for all the rest.
  const sessions = b.sessions.filter((x) => x.kind !== "other");
  const xs = sessions.slice(-state.last);
  const max = Math.max(1, ...xs.map((ss) => totalTokens(ss.tokens)));
  const step = niceStep(max), top = Math.ceil(max / step) * step;
  const yt = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const W = chartWidth(), H = 220, L = 46, R = 8, T = 14, B = 44;
  const gap = (W - L - R) / Math.max(1, xs.length), bw = Math.min(56, gap * 0.7);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Tokens per session" });
  svg.append(s("g", { class: "grid" }, ...yt.map((v) => s("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }))));
  svg.append(s("g", { class: "axis" }, ...yt.map((v) => s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, fmtTokens(v)))));
  const tip = h("div", { class: "tip", hidden: true });
  const wrap = h("div", { class: "chart" });
  xs.forEach((ss, i) => {
    const v = totalTokens(ss.tokens), cx = L + gap * i + gap / 2, x0 = cx - bw / 2, y0 = y(v), r = Math.min(4, bw / 2, y(0) - y0);
    // A bar with a rounded top, square on the baseline.
    const g = s("g", { tabindex: "0" },
      s("rect", { x: cx - gap / 2, y: T, width: gap, height: H - T - B, fill: "transparent" }),
      s("path", { d: `M${x0},${y(0)} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${y(0)} Z`, fill: KIND[ss.kind] }),
      s("text", { class: "lab m", x: cx, y: H - B + 14, "text-anchor": "middle" }, gap < 64 ? shortSession(ss) : ss.name.replace(/^[A-Z]+-\d+ /, "")),
      gap >= 64 ? s("text", { class: "lab m", x: cx, y: H - B + 28, "text-anchor": "middle" }, ss.name.match(/^[A-Z]+-\d+/)?.[0] ?? "") : s("g"),
      gap >= 40 ? s("text", { class: "lab", x: cx, y: y0 - 5, "text-anchor": "middle" }, fmtTokens(v)) : s("g"));
    const show = () => {
      holdRender = true;
      tip.replaceChildren(h("b", null, ss.name), ...[["tokens", fmtTokens(v)], ...(ss.orchestrator ? [[`of which ${ss.orchestrator.name}`, fmtTokens(ss.orchestrator.tokens)]] : []), ["output", fmtTokens(ss.tokens.output)], ["workers", ss.workers], ["calls", ss.calls], ["started", `${ss.started_at.slice(5, 10)} ${clock(ss.started_at)}`]].map(([k, val]) => h("div", { class: "row" }, h("span", null, k), h("span", null, String(val)))));
      tip.hidden = false;
      const wr = wrap.getBoundingClientRect(), gr = g.getBoundingClientRect();
      tip.style.left = `${Math.min(gr.left - wr.left + gr.width / 2, wr.width - 190)}px`;
      tip.style.top = `${gr.top - wr.top + 10}px`;
    };
    const hide = () => { tip.hidden = true; holdRender = false; };
    g.addEventListener("pointerenter", show); g.addEventListener("focus", show);
    g.addEventListener("pointerleave", hide); g.addEventListener("blur", hide);
    svg.append(g);
  });
  const kinds = new Set(sessions.map((x) => x.kind));
  const pick = (n) => h("button", { type: "button", "aria-pressed": String(state.last === n), onclick: () => { state.last = n; render(); } }, `Last ${n}`);
  wrap.append(h("div", { class: "bar-row", style: "margin:0" }, h("span", { class: "seg" }, pick(10), pick(20), pick(50)), h("span", { class: "muted" }, `${sessions.length} sessions on record`)),
    svg,
    h("div", { class: "key" }, ["build", "design", "review", "retro"].map((k) => h("span", { style: kinds.has(k) ? "" : "opacity:.55" }, h("i", { class: "band", style: `--k:${KIND[k]};opacity:1;width:10px;height:10px;border-radius:2px` }), k))),
    h("div", { class: "note", style: "margin:0" }, "Each session's tokens, cache reads included. A worker belongs to the session its brief names, else to the one running when it started; work outside any session isn't shown."), tip);
  return wrap;
}

function viewUsage() {
  const key = pageProject(), bar = switchBar(key, (k) => `#usage/${k}`);
  const b = key ? laptopBoard(key) : current();
  if (!b) return [bar, empty(null)];
  const { cur, prev } = sessionsOf(b);
  const runs = sessionRuns(b, cur?.name), prevRuns = sessionRuns(b, prev?.name);
  const roles = new Map();
  for (const r of runs) {
    const e = roles.get(r.role) ?? { rs: [], models: new Set(), machines: new Set() };
    e.rs.push(r); e.models.add(fmtModel(r)); e.machines.add(r.laptop); roles.set(r.role, e);
  }
  const sum = (rs, f) => rs.reduce((n, r) => n + f(r), 0);
  const rows = [...roles.entries()].sort((a, c) => sum(c[1].rs, workerTokens) - sum(a[1].rs, workerTokens));
  const rmax = rows.length ? sum(rows[0][1].rs, workerTokens) : 1;
  const pickRole = (role) => { state.chart = { mode: "agent", role, run: null }; render(); $("ctx")?.scrollIntoView({ block: "start" }); };
  return [
    bar,
    h("section", { id: "ctx" }, h("h2", null, "Context size per call"), contextChart(b)),
    h("section", null, h("h2", null, `Agents in ${cur?.name ?? "the session"} `, h("span", { class: "count" }, `${fmtTokens(sum(runs, workerTokens))} tokens so far${prev ? ` · ${prev.name} ${fmtTokens(sum(prevRuns, workerTokens))}` : ""}`)),
      h("div", { class: "table-wrap" }, h("table", { class: "stack", id: "roles" },
        h("thead", null, h("tr", null, h("th", null, "Role"), h("th", null, "Model"), h("th", { class: "num" }, "Runs"), h("th", { class: "num" }, "Calls"), h("th", { class: "num" }, "Peak context"), h("th", null, ""), h("th", { class: "num" }, "Tokens"), h("th", { class: "num" }, prev ? prev.name.replace(/^[A-Z]+-\d+ /, "") : "Before"))),
        h("tbody", null, rows.map(([role, e]) => {
          const before = sum(prevRuns.filter((r) => r.role === role), workerTokens);
          return h("tr", { class: "pick", tabindex: "0", "aria-selected": String(state.chart.role === role), title: "Show its context per call", onclick: () => pickRole(role), onkeydown: (ev) => ev.key === "Enter" && pickRole(role) },
            h("td", null, h("b", null, role), h("div", { class: "cp" }, [...e.machines].join(", "))),
            h("td", { "data-label": "Model" }, [...e.models].join(", ")),
            h("td", { class: "num", "data-label": "Runs" }, e.rs.length),
            h("td", { class: "num", "data-label": "Calls" }, sum(e.rs, (r) => r.ctx?.length ?? 0)),
            h("td", { class: "num", "data-label": "Peak context" }, fmtTokens(Math.max(0, ...e.rs.flatMap((r) => r.ctx ?? [])))),
            h("td", { class: "full", style: "width:20%" }, h("div", { class: "meter" }, h("i", { style: `width:${(sum(e.rs, workerTokens) / rmax) * 100}%` }))),
            h("td", { class: "num", "data-label": "Tokens" }, fmtTokens(sum(e.rs, workerTokens))),
            h("td", { class: "num muted", "data-label": prev?.name ?? "Before" }, before ? fmtTokens(before) : "–"));
        })))),
      h("p", { class: "note" }, "Click a role to see its context per call above. Tokens count everything a run read and wrote, cache reads included. The orchestrator's row is its own session's calls while this session ran, its subagents' tokens included.")),
    h("section", null, h("h2", null, "Tokens per session"), sessionBars(b)),
  ];
}

// ---------- Usage data: weighed, what runs now, a day's detail (ADR 0014; BOB-172). Its views read these. ----------

const WEIGH = "bobnet.weigh";
/** A link's setting holds for the page, and doesn't change the device's. */
function hashWeigh() {
  const of = hashFilter("weigh");
  if (of !== null) state.weigh = of === "1";
}
function setWeigh(on) {
  state.weigh = on;
  try { localStorage.setItem(WEIGH, on ? "1" : "0"); } catch {}
  history.replaceState(null, "", `#${hashPath().join("/")}?weigh=${on ? 1 : 0}`);
  render();
}
/** A usage figure as the toggle shows it: a point, or a by_model, by_role or top row (whose `raw` is one number). */
const usageFigure = (x) => (state.weigh ? x.weighted : typeof x.raw === "number" ? x.raw : totalTokens(x.raw));

const TOKEN_KINDS = ["input", "output", "cache_read", "cache_write"];
/** A model's row of the read's weights, by the board's rule: its full id, an alias, its family's current model; else null. */
function weightRow(model, rows) {
  const m = (model ?? "").trim().toLowerCase().replace(/\[[^\]]*\]$/, "");
  const alias = rows.find((r) => r.alias !== null && r.alias === m);
  if (alias) return alias;
  const id = /^claude-([a-z]+)-(\d{1,2}(?:-\d{1,2})?)(?:-\d{8})?$/.exec(m);
  return id ? (rows.find((r) => r.model === `claude-${id[1]}-${id[2]}`) ?? rows.find((r) => r.alias === id[1]) ?? null) : null;
}
/** Tokens weighed as the board weighs them; an unknown model's count at ×1. */
function weighTokens(tokens, model, rows) {
  const row = weightRow(model, rows), raw = totalTokens(tokens);
  return row ? { weighted: TOKEN_KINDS.reduce((sum, k) => sum + tokens[k] * row[k], 0), unknown: 0 } : { weighted: raw, unknown: raw };
}

/** The zone the usage reads are asked in: this device's, so a day starts at its own midnight. */
const usageTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayStart = (day) => new Date(`${day}T00:00:00`).getTime();
function localDay(t) {
  const d = new Date(t), two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** A project's workers whose run the board doesn't have yet: the laptop reports' running, queued and waiting. */
const liveWorkers = (key) => workers().filter((w) => w.project === key && [...ACTIVE, "queued"].includes(w.state));
/** How much of a running worker came before today, 0 to 1, by wall time. */
function beforeToday(w, today) {
  const start = Date.parse(w.started_at), now = brokerNow();
  return now > start ? Math.min(1, Math.max(0, (dayStart(today) - start) / (now - start))) : 0;
}

/**
 * A project's series with what runs now in today's point (`so_far`): each worker's share of today, by
 * wall time, weighed with the read's own table. `top` stays the board's, of runs that ended. A reply
 * from before midnight has no today in it, and takes none.
 */
function usageSoFar(reply, key) {
  const series = reply.projects.find((p) => p.project === key);
  const today = reply.days.at(-1);
  if (!series || today !== localDay(brokerNow())) return series ?? null;
  const last = series.points.at(-1);
  const pt = { ...last, raw: { ...last.raw }, by_model: last.by_model.map((m) => ({ ...m })), by_role: last.by_role.map((r) => ({ ...r })), so_far: true };
  const add = (list, field, name, row) => {
    const e = list.find((x) => x[field] === name) ?? list[list.push({ [field]: name, raw: 0, weighted: 0, ...(field === "role" ? { calls: 0 } : {}) }) - 1];
    for (const [k, v] of Object.entries(row)) e[k] += v;
  };
  for (const w of liveWorkers(key)) {
    if (!w.started_at) continue;
    const before = beforeToday(w, today);
    const part = (n) => n - Math.round(n * before);
    const whole = typeof w.tokens === "number" ? { input: w.tokens, output: 0, cache_read: 0, cache_write: 0 } : w.tokens;
    const tokens = Object.fromEntries(TOKEN_KINDS.map((k) => [k, part(whole[k])]));
    const raw = totalTokens(tokens), calls = part(w.calls ?? 0);
    const { weighted, unknown } = weighTokens(tokens, w.model, reply.weights.rows);
    for (const k of TOKEN_KINDS) pt.raw[k] += tokens[k];
    pt.weighted += weighted;
    pt.unknown += unknown;
    pt.calls += calls;
    if (raw) add(pt.by_model, "model", weightRow(w.model, reply.weights.rows)?.model ?? (w.model || "unknown"), { raw, weighted });
    if (raw || calls) add(pt.by_role, "role", w.role, { raw, weighted, calls });
  }
  for (const x of [pt, ...pt.by_model, ...pt.by_role]) x.weighted = Math.round(x.weighted);
  for (const list of [pt.by_model, pt.by_role]) list.sort((a, b) => b.raw - a.raw || b.weighted - a.weighted);
  return { ...series, points: [...series.points.slice(0, -1), pt] };
}

/** "<project>|<day>|<days>|<tz>" → { reply, error, loading, at, old }: a day's detail, read on the tap and kept. */
const usageDays = new Map();
const USAGE_DAY_AGAIN_MS = 30_000;
/**
 * A day's detail: asked once and kept; `again` is Retry's. Today's is asked again, at most twice a
 * minute, once the board has changed (a run that ended leaves the laptop's report for the board), and
 * any day's once its period has moved on; what shows stays until the reply.
 */
function usageDay(key, day, days, again = false) {
  const tz = usageTz(), id = [key, day, days, tz].join("|");
  const e = usageDays.get(id) ?? { reply: null, error: null, loading: false, at: 0, old: false };
  const today = localDay(brokerNow());
  const old = e.reply && (e.reply.days.at(-1) !== today || (e.old && day === today)) && Date.now() - e.at > USAGE_DAY_AGAIN_MS;
  if (e.loading || (usageDays.has(id) && !again && !old)) return e;
  usageDays.set(id, e);
  Object.assign(e, { loading: true, error: null, at: Date.now(), old: false });
  boardOp({ op: "usage_day", project: key, day, days, tz })
    .then((reply) => (e.reply = reply), (err) => (e.error = err.message))
    .finally(() => {
      e.loading = false;
      scheduleRender();
    });
  return e;
}
function usageDayChanged(key) {
  for (const [id, e] of usageDays) if (id.startsWith(`${key}|`)) e.old = true;
}

/** Context at each of a running worker's calls from `from` (0-based); its report has the last 400, so `known` is the first call it has. */
function liveLine(w, from) {
  const calls = Math.max(w.calls ?? 0, w.ctx?.length ?? 0), n = w.ctx?.length ?? 0;
  const lead = Math.max(0, calls - n - from);
  return { calls: calls - from, pts: (w.ctx ?? []).slice(Math.max(0, from - (calls - n))), ...(n && lead ? { known: lead + 1 } : {}) };
}
/** A day's runs, by start: the reply's, and today's running workers as runs (`live`, `ended_at` null). */
function dayRuns(reply) {
  if (reply.day !== localDay(brokerNow())) return reply.runs;
  const have = new Set(reply.runs.map((r) => r.id));
  const live = liveWorkers(reply.project).filter((w) => w.started_at && !have.has(w.id)).map((w) => {
    const from = Math.round(Math.max(w.calls ?? 0, w.ctx?.length ?? 0) * beforeToday(w, reply.day));
    return { id: w.id, agent: w.name, role: w.role, session: null, declared: w.session ?? null, model: w.model ?? null, started_at: w.started_at, ended_at: null, resumed: false, first: from + 1, ctx: liveLine(w, from), live: true };
  }).filter((r) => r.ctx.calls > 0);
  return [...reply.runs, ...live].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}
/** The call (1-based) a line's point i is at: evenly taken over its calls, first and last kept; a running worker's are its last. */
function callAt(line, i) {
  if (line.known) return line.known + i;
  return line.pts.length > 1 ? 1 + Math.round((i * (line.calls - 1)) / (line.pts.length - 1)) : 1;
}
/** Total: runs in start order, their context summed as they go; a point counts for the calls it stands for. A run with no context draws nothing. */
function totalLine(runs) {
  const out = [];
  let sum = 0, done = 0;
  for (const { ctx } of runs) {
    if (!ctx.pts.length) continue;
    ctx.pts.forEach((v, i) => out.push({ call: done + callAt(ctx, i), sum: (sum += v * (ctx.calls / ctx.pts.length)) }));
    done += ctx.calls;
  }
  return out;
}

// ---------- Laptops: the supervisors, the agents, the rules and who messaged whom (BOB-121 spec 2.11) ----------

/** Which client an agent runs: "supervisor 0.2.0 · protocol 1". */
const clientLabel = (c) => c ? `${c.package.replace(/^@bobnet\//, "")} ${c.version} · protocol ${c.protocol}` : "client version unknown";

/** A laptop's supervisor version, from an agent of its supervisor: "supervisor 2.0.0-rc.55"; null when none says it. */
function supervisorVersion(laptop) {
  const of = state.peers.filter((p) => p.laptop === laptop && p.client?.package.endsWith("/supervisor"));
  const p = of.find((x) => x.online) ?? of[0];
  return p ? `supervisor ${p.client.version}` : null;
}

function laptopCard(l) {
  const sup = l.snapshot.supervisor, stale = staleReport(l), n = livePending(l).length, version = supervisorVersion(l.laptop);
  return h("div", { class: "card" },
    h("div", { class: "top" }, h("span", { class: "name" }, l.laptop), h("span", { class: "badge", dataset: { state: stale ? "stopped" : "running" } }, stale ? "no recent report" : "supervisor up")),
    h("div", { class: "meta" }, h("span", null, `${sup.active} of ${sup.concurrency} slots busy`), h("span", null, `${sup.queued} queued`), h("span", null, "up ", ago(sup.started_at)), h("span", null, "reported ", ago(l.at), " ago"),
      version ? h("span", null, version) : null,
      stale && n ? h("span", null, `${plural(n, "request")} wait${n === 1 ? "s" : ""} until it reports again`) : null),
    outboxLine(l.snapshot.board_outbox),
    cleanupLine(l.snapshot.cleanup ?? null));
}

/** Not a tab: the header's connection and a quiet laptop's banner lead here. */
function viewLaptops() {
  const peers = [...state.peers].sort((a, c) => Number(c.online) - Number(a.online) || a.address.localeCompare(c.address));
  return [
    h("p", { class: "note", style: "margin:0" }, "The laptops' supervisors, the agents on BobNet, and the rules for every project."),
    h("section", null, h("h2", null, "Laptops"), h("div", { class: "cards", id: "laptops" },
      state.laptops.size ? [...state.laptops.values()].map(laptopCard) : h("div", { class: "empty" }, "No laptop has reported in the last 30 days."))),
    h("section", null, h("h2", null, "Agents ", h("span", { class: "count", id: "agents-count" }, `${peers.filter((p) => p.online).length} online of ${peers.length}`)),
      h("div", { class: "table-wrap" }, h("table", { class: "stack", id: "agents" },
        h("thead", null, h("tr", null, h("th", null, "Agent"), h("th", null, "Status"), h("th", { class: "num" }, "Up"), h("th", { class: "num" }, "In / out 24h"), h("th", { class: "num" }, "Inbox"))),
        h("tbody", null, peers.map((p) => h("tr", null,
          h("td", { class: "wide" }, h("span", { class: `dot${p.online ? " on" : ""}` }), h("span", { class: "addr" }, p.address), p.team ? h("div", { class: "team" }, p.team) : null, h("div", { class: "client" }, clientLabel(p.client))),
          h("td", { "data-label": "Status" }, p.status ?? (p.online ? "" : `last seen ${since(p.last_seen)} ago`)),
          h("td", { class: "num", "data-label": "Up" }, p.online && p.connected_at ? ago(p.connected_at) : "–"),
          h("td", { class: "num", "data-label": "In / out 24h" }, `${p.stats.received_24h} / ${p.stats.sent_24h}`),
          h("td", { class: "num", "data-label": "Inbox" }, p.stats.inbox ? String(p.stats.inbox) : "–"))))))),
    ...rulesSections(),
    details("messages", { class: "card msgs" },
      h("summary", null, "Messages in the last 24 hours ", h("span", { class: "count" }, state.traffic.length < TRAFFIC_MAX ? state.traffic.length : `the latest ${TRAFFIC_MAX}`)),
      h("ul", { class: "feed", id: "traffic" }, state.traffic.length
        ? state.traffic.map((t) => h("li", null, h("time", { datetime: t.at, title: t.at }, clock(t.at)), h("span", null, t.from, t.type === "broadcast" ? ` broadcast to ${t.to.length}` : ` → ${t.to.join(", ")}`, t.urgent ? " (urgent)" : "")))
        : h("li", { class: "empty" }, "No messages in the last 24 hours.")),
      h("p", { class: "note" }, "Who messaged whom, never what was said.")),
  ];
}

// ---------- Rules for every project: Casper makes an agent global admin (BOB-118) ----------

/** The '*' rules, read through the first project's grants (every project's answer includes them). */
const rules = { rows: null, error: null, loading: false, busy: false, who: "poe@mbp-1" };

async function loadRules() {
  if (rules.loading) return;
  const key = svc.projects?.[0]?.key;
  if (!key) return;
  rules.loading = true;
  try {
    rules.rows = (await boardOp({ op: "grants", project: key })).grants.filter((g) => g.project === "*");
    rules.error = null;
  } catch (err) {
    rules.error = err.message;
  } finally {
    rules.loading = false;
    scheduleRender();
  }
}

/** Admin on or off for one agent@laptop on every project. A rule it already has keeps the rest; a new one reads and writes no items. */
async function setGlobalAdmin(who, admin) {
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(who.trim());
  if (!m) return toast(`${who} is not name@laptop`, false);
  const [, agent, laptop] = m;
  const old = rules.rows?.find((g) => g.agent.toLowerCase() === agent.toLowerCase() && g.laptop.toLowerCase() === laptop.toLowerCase());
  const rule = old ? { role: old.role, read: old.read || admin, items: old.items, fields: old.fields, sessions: old.sessions, questions: old.questions } : { role: "admin", read: true, items: "none", fields: [], sessions: false, questions: false };
  rules.busy = true;
  render();
  try {
    await boardOp({ op: "grant", project: "*", agent, laptop, ...rule, admin }, true);
    toast(admin ? `${agent}@${laptop} is admin on every project: it can set any project's rules.` : `${agent}@${laptop} is no longer admin on every project.`);
  } catch (err) {
    toast(err.message, false);
  }
  rules.busy = false;
  await loadRules();
}

function rulesSections() {
  if (!svc.projects?.length) return [h("section", null, h("h2", null, "Rules for every project"), noProjects())];
  if (rules.rows === null && !rules.error) loadRules();
  const rows = rules.rows ?? [];
  const yes = (b) => (b ? "yes" : "no");
  return [
    h("section", null, h("h2", null, "Rules for every project ", h("span", { class: "count" }, rules.rows ? String(rows.length) : "")),
      rules.error ? h("p", { class: "note bad" }, rules.error) : null,
      rows.length
        ? h("div", { class: "table-wrap" }, h("table", { class: "stack", id: "global-rules" },
          h("thead", null, h("tr", null, h("th", null, "Agent"), h("th", null, "Role"), h("th", null, "Reads"), h("th", null, "Items"), h("th", null, "Admin"), h("th", null, ""))),
          h("tbody", null, rows.map((g) => h("tr", null,
            h("td", { class: "wide" }, h("b", null, `${g.agent}@${g.laptop}`)),
            h("td", { "data-label": "Role" }, g.role),
            h("td", { "data-label": "Reads" }, yes(g.read)),
            h("td", { "data-label": "Items" }, g.items, g.fields.length ? h("div", { class: "muted" }, g.fields.join(", ")) : null),
            h("td", { "data-label": "Admin" }, g.admin ? h("b", null, "yes") : "no"),
            h("td", { class: "full" }, rules.busy ? null : button(g.admin ? "Take admin away" : "Make admin", g.admin ? "" : "primary", () => setGlobalAdmin(`${g.agent}@${g.laptop}`, !g.admin))))))))
        : h("div", { class: "empty-card" }, rules.rows ? "No rule for every project yet." : "Reading the rules…"),
      h("p", { class: "note" }, "A rule here holds on every project. Admin lets that agent set any project's rules, so you need not.")),
    h("section", null, h("h2", null, "Make an agent global admin"),
      h("form", { class: "rule-form", onsubmit: (e) => { e.preventDefault(); setGlobalAdmin(e.target.elements.who.value, true); } },
        h("label", { for: "rule-who" }, "Agent"),
        h("input", { id: "rule-who", name: "who", value: rules.who, oninput: (e) => (rules.who = e.target.value), autocomplete: "off", autocapitalize: "off", spellcheck: "false", required: true, pattern: "[^@\\s]+@[^@\\s]+", placeholder: "name@laptop" }),
        h("button", { type: "submit", class: "primary", disabled: rules.busy || !rules.rows || null }, "Make global admin")),
      h("p", { class: "note" }, "Admin, reads every board, writes no items. A rule the agent already has keeps the rest. Only you can do this.")),
  ];
}

// ---------- Views ----------

// Now left the tabs (BOB-5 as built 3): "#now" opens the Overview, as any unknown view does.
const VIEWS = { overview: viewOverview, needs: viewNeeds, status: viewStatus, feature: viewFeature, roadmap: viewRoadmap, triage: viewTriage, usage: viewUsage, laptops: viewLaptops };
const viewName = () => (VIEWS[hashPath()[0]] ? hashPath()[0] : "overview");

function render() {
  const v = viewName();
  for (const a of $("tabs").querySelectorAll("a")) a.toggleAttribute("aria-current", a.getAttribute("href").split("/")[0] === `#${v}`);
  // Nothing waits: the count leaves the tab.
  $("needs-n").textContent = waitCount() || "";
  $("tabs").querySelector('a[href="#status"]').dataset.new = String(statusNew());
  drawConn();
  // Capture always has a project (Casper, 2026-11-13): only once the service has one.
  $("capture-open").hidden = !svc.projects?.length;
  $("view").classList.toggle("wide", v === "overview" || v === "feature" || v === "roadmap" || v === "status");
  // The answer box he is typing in keeps its focus and caret across a draw.
  const box = document.activeElement?.closest?.("form.answer") ? document.activeElement : null;
  const at = box?.selectionStart;
  $("view").replaceChildren(...VIEWS[v]().filter(Boolean));
  measureAsks();
  statusScroll();
  if (box) {
    const again = $("view").querySelector("form.answer textarea");
    again?.focus();
    if (again && at !== undefined && at !== null) again.setSelectionRange(at, at);
  }
}

/**
 * Where a link from before the new pages goes (spec 2.0, build C), or null for one that still stands. #features
 * and #project come with their pages (BOB-182, BOB-185). A `%` that decodes to nothing is taken as it is.
 */
function oldLink(hash) {
  const [v, ...rest] = hash.replace(/^#/, "").split("?")[0].split("/");
  if (v === "waits") return { to: "#needs" };
  if (v === "sessions") return { to: "#laptops", toast: "Sessions moved: laptops and agents are under Laptops." };
  if (v === "rules") return { to: "#laptops" };
  if (v === "feature" && rest.length === 1 && rest[0]) {
    let ref = rest[0];
    try { ref = decodeURIComponent(ref); } catch {}
    const ps = svc.projects ?? [];
    const p = ps.find((x) => ref.startsWith(`${x.prefix}-`)) ?? ps.find((x) => x.draft_prefix && ref.startsWith(`${x.draft_prefix}-`));
    if (p) return { to: `#feature/${p.key}/${ref}` };
  }
  return null;
}
/** Takes the page from an old link to where it goes, in the same history entry; a feature's once the projects are read. */
function followOldLink() {
  const old = oldLink(location.hash);
  if (!old) return;
  history.replaceState(null, "", old.to);
  if (old.toast) toast(old.toast);
}

/** Live frames re-render at most a few times a second, and not while a chart is pointed at or a menu is open. */
let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderTimer = null;
    // Not while he writes an answer: a live frame would take the box from under his typing.
    if (holdRender || document.activeElement?.tagName === "SELECT" || document.activeElement?.closest?.("form.answer, form.rule-form")) return scheduleRender();
    render();
  }, 250);
}

$("capture-open").addEventListener("click", () => openCapture());
/** An element to bring into view after the next view change: the Overview's context link lands on it (BOB-31). */
let scrollAfter = null;
let lastView = viewName();
window.addEventListener("hashchange", () => {
  holdRender = false;
  followOldLink();
  hashWeigh();
  // A toast that stays (I'm caught up's) goes with the tab it was made on.
  if (viewName() !== lastView && $("toast").dataset.keep === "true") $("toast").hidden = true;
  lastView = viewName();
  stv.scrollFor = null;
  render();
  window.scrollTo(0, 0);
  stv.scrollFor = null;
  statusScroll();
  if (scrollAfter) $(scrollAfter)?.closest("li")?.scrollIntoView({ block: "start" });
  scrollAfter = null;
});
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => {
  // A phone turning clamps or unclamps a folded ask: measured again at once.
  measureAsks();
  if (Math.abs(window.innerWidth - lastWidth) < 20) return;
  lastWidth = window.innerWidth;
  scheduleRender();
});

// Durations tick without a re-render.
setInterval(() => {
  for (const el of document.querySelectorAll("[data-ago]")) el.textContent = since(el.dataset.ago);
  // The page itself gone late, with no frame to say so (a phone that slept): Needs you says it.
  const fresh = document.querySelector(".fresh");
  if (fresh && renderTimer === null && fresh.dataset.late !== String(pageLate())) scheduleRender();
}, 1000);

// ---------- Socket ----------

function setConn(st) {
  if (st === "down" && $("conn").dataset.state !== "down") connDownAt = new Date().toISOString();
  // Leaving live hides the stale banners (design/BOB-48/spec.md §1): every laptop looks stale to a page cut off.
  if ($("conn").dataset.state === "live" && st !== "live") scheduleRender();
  $("conn").dataset.state = st;
  drawConn();
}
/** The connection, a link to Laptops: "live · 2 laptops", or "1 quiet" in warn while one has stopped reporting (spec 2.0). */
function drawConn() {
  const el = $("conn"), st = el.dataset.state;
  const quiet = st === "live" ? quietLaptops().length : 0;
  const up = [...state.laptops.values()].filter((l) => !staleReport(l)).length;
  el.toggleAttribute("data-quiet", quiet > 0);
  el.replaceChildren(quiet ? `${quiet} quiet` : st === "live" ? "live" : st === "down" ? "reconnecting" : "connecting",
    st === "live" && !quiet && up ? h("span", { class: "lap-n" }, ` · ${plural(up, "laptop")}`) : "");
}

function request(t) {
  const id = String(++rid);
  ws?.send(JSON.stringify({ t, rid: id }));
  return id;
}

let dashboardRid = null;

function connect() {
  setConn("connecting");
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/ws`);
  ws.addEventListener("message", (e) => {
    if (e.data === '{"t":"pong"}') return;
    const f = JSON.parse(e.data);
    switch (f.t) {
      case "welcome":
        backoff = 1000;
        dashboardRid = request("dashboard");
        // A write the drop cut off goes again under its key: the board answers a repeat with its first reply (Toad, BOB-7 review).
        for (const op of sentOps.values()) if (op.frame) ws.send(op.frame);
        loadProjects();
        flushCaptures();
        break;
      case "error":
        if (sentOps.has(f.rid)) {
          sentOps.get(f.rid).reject(Object.assign(new Error(f.message), { code: f.code }));
          sentOps.delete(f.rid);
          break;
        }
        if (sentActions.has(f.rid)) {
          const { button: b } = sentActions.get(f.rid);
          sentActions.delete(f.rid);
          if (b) b.disabled = false;
          toast(f.message, false);
        }
        break;
      case "action_result":
        {
          const done = f.ok ? actionToasts.get(f.id) : null;
          actionToasts.delete(f.id);
          toast(...(typeof done === "function" ? done(f) : [done ?? f.message, f.ok]));
        }
        break;
      case "ok":
        if (sentOps.has(f.rid)) {
          sentOps.get(f.rid).resolve(f.result);
          sentOps.delete(f.rid);
          break;
        }
        if (sentActions.has(f.rid)) {
          const { done } = sentActions.get(f.rid);
          sentActions.delete(f.rid);
          if (done && f.result?.id) actionToasts.set(f.result.id, done);
          toast("Sent; waiting for the supervisor…");
          break;
        }
        if (f.rid === dashboardRid) {
          state.refreshed = Date.now();
          if (f.result.now) skew = Date.now() - Date.parse(f.result.now);
          state.peers = f.result.peers;
          state.laptops = new Map(f.result.laptops.map((l) => [l.laptop, l]));
          state.boards = new Map((f.result.boards ?? []).map((b) => [`${b.laptop}|${b.board.project}`, b]));
          state.traffic = f.result.traffic;
          // Live before the render: the stale banners draw only on a live page.
          setConn("live");
          render();
        }
        break;
      case "presence": {
        const i = state.peers.findIndex((p) => p.address === f.peer.address);
        const prev = i === -1 ? { stats: { sent_24h: 0, received_24h: 0, inbox: 0 }, connected_at: null } : state.peers[i];
        const next = { ...prev, ...f.peer, connected_at: f.event === "joined" ? new Date().toISOString() : f.peer.online ? prev.connected_at : null };
        if (i === -1) state.peers.push(next);
        else state.peers[i] = next;
        if (viewName() === "laptops") scheduleRender();
        break;
      }
      case "report":
        skew = Date.now() - Date.parse(f.at);
        state.laptops.set(f.laptop, { laptop: f.laptop, at: f.at, snapshot: f.snapshot });
        scheduleRender();
        break;
      case "board":
        state.boards.set(`${f.laptop}|${f.board.project}`, { laptop: f.laptop, at: f.at, board: f.board });
        scheduleRender();
        break;
      case "board_changed":
        if (!svc.projects?.some((p) => p.key === f.project)) loadProjects();
        else {
          if (svc.roadmaps.has(f.project)) loadRoadmap(f.project);
          if (backlogs.has(f.project)) loadBacklog(f.project);
          for (const id of feats.keys()) if (id.startsWith(`${f.project}/`)) loadFeature(f.project, id.slice(f.project.length + 1));
        }
        usageDayChanged(f.project);
        if (ov.rows || ov.error) loadOverview();
        if (rules.rows) loadRules();
        statusChanged();
        break;
      case "traffic":
        state.traffic = [f.item, ...state.traffic].slice(0, TRAFFIC_MAX);
        if (viewName() === "laptops") scheduleRender();
        break;
    }
  });
  ws.addEventListener("close", () => {
    setConn("down");
    for (const [id, op] of sentOps) {
      if (op.frame) continue;
      op.reject(new Error("The connection dropped; try again in a moment."));
      sentOps.delete(id);
    }
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  });
}

try { state.weigh = localStorage.getItem(WEIGH) === "1"; } catch {}
followOldLink();
hashWeigh();
render();
connect();
// Keepalive, and a full refresh every minute for the 24-hour counts.
setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 30_000);
setInterval(() => ws?.readyState === WebSocket.OPEN && (dashboardRid = request("dashboard")), 60_000);
// The Status tab's dot, on any view (ADR 0005 §2: every 60 s when Status and the Overview aren't showing).
setInterval(() => ws?.readyState === WebSocket.OPEN && (svc.projects ? (loadStatus(), ov.error ? loadOverview() : null) : loadProjects()), 60_000);
// Waits, hourly: a row goes stale and is flagged with no change on the board to say so (ADR 0011 §2; review A m3).
setInterval(() => ws?.readyState === WebSocket.OPEN && svc.projects && loadOverview(), 60 * 60_000);

// For the tests: what the views read that has no screen of its own yet.
export { state, usageFigure, setWeigh, weighTokens, usageSoFar, usageDay, dayRuns, callAt, totalLine, oldLink };
