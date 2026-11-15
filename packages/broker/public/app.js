// BobNet dashboard: one owner WebSocket, a full snapshot on connect, then live frames.
// Each laptop's supervisor reports a snapshot (its workers, every few seconds) and, when it
// changes, a board per project (backlog, sessions, past runs, commits, CI).
// Agent-supplied text is only ever set as textContent.

const state = {
  peers: [],
  laptops: new Map(),
  /** "laptop|project" → { laptop, at, board } */
  boards: new Map(),
  updates: [],
  traffic: [],
  taskFilter: null,
  project: null,
  inc: null,
  release: null,
  showAccepted: false,
  openLanes: new Set(),
  openCards: new Set(),
  open: new Set(),
  chart: { mode: "session", role: null, run: null },
  /** Triage's filter (all, bugs, none or a release) and whether past 25 rows show. */
  triage: { filter: "all", all: false },
  last: 10,
};
/** Updates kept in the page: the broker's snapshot plus what arrives live. */
const UPDATES_MAX = 200;
const ACTIVE = ["running", "waiting-approval", "waiting-answer"];
let ws = null;
let rid = 0;
let backoff = 1000;

const $ = (id) => document.getElementById(id);

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

/** Requests sent and not yet answered by the broker, by rid. */
const sentActions = new Map();
let toastTimer = null;

/** A toast; with `undo`, an Undo button that takes the change back. */
function toast(text, ok = true, undo = null) {
  const el = $("toast");
  el.replaceChildren(text, undo ? button("Undo", "undo", () => { el.hidden = true; undo(); }) : "");
  el.dataset.ok = String(ok);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 8000);
}

/** Sends a dashboard action to a laptop's supervisor; the button stays disabled until it's settled. */
function act(laptop, action, button, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return toast("Not connected; try again in a moment.", false);
  const id = String(++rid);
  sentActions.set(id, button);
  if (button) button.disabled = true;
  ws.send(JSON.stringify({ t: "action", rid: id, laptop, action }));
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

/**
 * The task number an update is about: of the backlog ids in it (LAND-41, LAND-41.2),
 * the most specific, the first on a tie. Same rule as the supervisor's taskRef.
 */
function taskRef(text) {
  let best = null;
  for (const [ref] of text.matchAll(/\b[A-Z][A-Z0-9]*-\d+(?:\.\d+)*\b/g)) {
    if (!best || ref.split(".").length > best.split(".").length) best = ref;
  }
  return best;
}
/** An update's text without its leading "LAND-41.2 · ", which the chip shows. */
const withoutTask = (text, task) => (task && text.startsWith(task) ? text.slice(task.length).replace(/^\s*[·:-]\s*/, "") : text);

// ---------- Data ----------

/** Every worker the supervisors report: running ones, and those that ended in the last 24 hours. */
const workers = () => [...state.laptops.values()].flatMap((l) => l.snapshot.workers.map((w) => ({ ...w, laptop: l.laptop })));
const running = () => workers().filter((w) => ACTIVE.includes(w.state));
const workerTokens = (w) => (typeof w.tokens === "number" ? w.tokens : totalTokens(w.tokens));

/** The projects with a board, the one shown first being the one with a backlog and the most recent work. */
function projects() {
  const by = new Map();
  for (const e of state.boards.values()) {
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
  location.hash = "usage";
}

function viewNow() {
  const run = running();
  const pending = [...state.laptops.values()].flatMap((l) => l.snapshot.pending.map((p) => ({ ...p, laptop: l.laptop })));
  const queued = workers().filter((w) => w.state === "queued");
  const ci = projects().flatMap((e) => (e.board.ci ?? []).filter((r) => r.status !== "completed").map((r) => ({ ...r, project: e.board.project })));
  const out = [];
  for (const r of ci) out.push(h("div", { class: "banner" }, h("b", null, "Waiting on CI"), h("span", null, `${r.project}: ${r.name} on ${r.sha.slice(0, 8)}`), h("span", { class: "muted" }, "started ", ago(r.created_at), " ago")));
  if (pending.length) {
    out.push(h("section", null, h("h2", null, "Waiting on a decision ", h("span", { class: "count" }, pending.length)),
      h("ul", { class: "list", id: "needs-list" }, pending.map((p) => h("li", { dataset: { tier: p.tier } },
        h("b", null, p.name), p.kind === "question" ? " asks a question" : ` wants ${p.tool}`,
        h("div", { class: "muted" }, `${p.tier === "human" ? "needs you" : "orchestrator decides"} · ${p.id} · ${p.laptop} · waiting `, ago(p.created_at)),
        h("div", { class: "preview" }, p.preview),
        p.kind === "question"
          ? h("div", { class: "actions" }, h("span", { class: "muted" }, "Answer it through the orchestrator, or "), button("Deny", "danger", (b) => act(p.laptop, { kind: "answer", request: p.id, decision: "deny" }, b)))
          : h("div", { class: "actions" },
              button("Allow", "primary", (b) => act(p.laptop, { kind: "answer", request: p.id, decision: "allow" }, b, p.tier === "human" ? `Allow ${p.name} to run ${p.tool}?\n\n${p.preview}` : null)),
              button("Deny", "danger", (b) => act(p.laptop, { kind: "answer", request: p.id, decision: "deny" }, b))))))));
  }
  const boardOf = (w) => projects().find((e) => e.board.project === w.project)?.board;
  out.push(h("section", null, h("h2", null, "Running now ", h("span", { class: "count" }, run.length || "")),
    run.length
      ? h("div", { class: "table-wrap" }, h("table", { class: "stack", id: "running" },
          h("thead", null, h("tr", null, h("th", null, "Agent"), h("th", null, "Working on"), h("th", null, "Model"), h("th", null, "Machine"), h("th", { class: "num" }, "Worked"), h("th", { class: "num" }, "Tokens"), h("th", { class: "num" }, "Context now"), h("th", null, ""))),
          h("tbody", null, run.map((w) => {
            const xs = refsOf(w).map((id) => boardOf(w)?.backlog?.items.find((i) => i.id === id)).filter(Boolean), x = xs.length === 1 ? xs[0] : null;
            const head = headlineOf(w.task);
            return h("tr", { class: "pick", tabindex: "0", title: "Show its context per call", onclick: () => showRun(w), onkeydown: (e) => e.key === "Enter" && showRun(w) },
              h("td", null, h("b", null, w.name), h("div", { class: "cp" }, w.session ?? w.project), w.state !== "running" ? h("div", null, h("span", { class: "badge", dataset: { state: w.state } }, w.state)) : null,
                w.remote_url ? h("div", null, h("a", { href: w.remote_url, target: "_blank", rel: "noopener", title: "Follow it and type to it in Claude", onclick: (e) => e.stopPropagation() }, "Open in Claude ↗")) : null,
                quietMinutes(w) >= QUIET_MIN ? h("div", { class: "quiet", style: "color:var(--warn)", title: "No activity from it in that long. Nothing interrupts it: stop or reset it if it's stuck." }, `quiet ${quietMinutes(w)} min`) : null),
              h("td", { class: "wide" },
                head ? [h("span", { class: "title" }, head), x ? h("div", { class: "cp" }, "about ", chip(x.id), x.title) : xs.length ? h("div", { class: "cp" }, "about ", xs.map((i) => chip(i.id))) : null]
                  : x ? [chip(x.id), " ", h("span", { class: "title" }, x.title)] : [xs.map((i) => chip(i.id)), h("span", { class: "title" }, w.task)],
                w.checkpoint ? h("div", { class: "cp" }, w.checkpoint) : null),
              h("td", { "data-label": "Model" }, fmtModel(w)),
              h("td", { "data-label": "Machine" }, w.laptop),
              h("td", { class: "num", "data-label": "Worked" }, w.started_at ? ago(w.started_at) : "–"),
              h("td", { class: "num", "data-label": "Tokens" }, fmtTokens(totalTokens(w.tokens))),
              h("td", { class: "num", "data-label": "Context now" }, w.calls ? `${fmtTokens(w.context ?? 0)} · ${w.calls} calls` : "–"),
              h("td", { class: "full" }, h("div", { class: "actions", style: "margin:0;justify-content:flex-end" },
                button("Stop", "danger", (b) => act(w.laptop, { kind: "stop", worker: w.id }, b, `Stop ${w.name} (${w.id})? It is interrupted, then ended.`)),
                button("Reset", "", (b) => act(w.laptop, { kind: "reset", worker: w.id }, b, `Reset ${w.name} (${w.id})? It is stopped and a fresh worker starts the same task with no prior context.`)))));
          }))))
      : h("div", { class: "banner idle" }, h("span", null, "Nothing is running."), (() => { const last = workers().map((w) => w.ended_at).filter(Boolean).sort().at(-1); return last ? h("span", { class: "muted" }, "The last worker ended ", ago(last), " ago.") : null; })()),
    h("p", { class: "note" }, queued.length ? `${queued.length} queued: ${queued.map((w) => w.name).join(", ")}. ` : "", run.length ? "Click an agent for its context per call." : "")));
  return out;
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

const empty = (b) => h("section", null, h("div", { class: "banner idle" }, h("span", null, b ? "This project has no backlog configured." : "No board yet."), h("span", { class: "muted" }, b ? "Set backlog: { dir } for it in supervisor.yaml." : "A supervisor sends its projects' boards within a minute of starting.")));

function viewFeature() {
  // `#feature/<id>`: a feature in the service shows its head card; one on a Backlog.md board opens as before.
  const id = location.hash.slice(1).split("/")[1];
  const sp = id && svc.projects?.find((x) => id.startsWith(`${x.prefix}-`));
  if (sp) return viewServiceFeature(sp, id);
  if (id) state.inc = id;
  const b = current();
  if (!b?.backlog) return [empty(b)];
  const m = backlogModel(b);
  const open = m.items.filter((x) => x.type === "increment" && x.status !== "Done" && m.kids(x.id).length);
  const curInc = m.cur?.name.split(" ")[0];
  const inc = m.byId.get(state.inc) ?? m.byId.get(curInc) ?? open[0];
  if (!inc) return [empty(b)];
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

/** A feature in the service: its head card (spec: Feature, head card). Its sessions, outcomes and tasks are the steps view's (BOB-4). */
function viewServiceFeature(p, ref) {
  const data = svc.roadmaps.get(p.key);
  if (!data && !svc.loading.has(p.key)) loadRoadmap(p.key);
  if (!data) return [h("div", { class: "empty-card" }, "Reading the board…")];
  const f = data.features.find((x) => x.ref === ref);
  if (!f) return [h("div", { class: "empty-card" }, `No feature ${ref} in ${p.name}.`)];
  const r = data.releases.find((x) => x.ref === f.release);
  const n = data.features.filter((x) => x.release === f.release).indexOf(f) + 1;
  const st = featureState(f), on = onFeature(p.key, f.ref);
  const { checked, total } = f.progress;
  return [
    h("div", { class: `card feature-head${st === "open" ? " is-open" : ""}`, id: "feature-head" },
      h("div", { class: "fh-top" }, h("span", { class: "id" }, f.ref), h("span", { class: "muted" }, `${p.name} · ${r ? `${r.title} · number ${n}` : "not in a release"}`), badge(st)),
      h("h2", null, f.title),
      h("div", { class: "fh-m" },
        total ? h("div", { class: "crit" }, meterOf(checked, total, st === "done" ? "idle" : "ok"), h("span", { class: "m" }, `${checked} of ${total} criteria`)) : h("span", { class: "muted" }, "no criteria yet"),
        f.status === "Done" && total && checked < total ? h("span", { class: "sub-note" }, "Done, criteria not ticked") : null,
        h("span", null, f.tasks?.total ? `${f.tasks.done} of ${f.tasks.total} tasks done` : h("span", { class: "muted" }, "no tasks")),
        on.length ? h("span", { class: "now" }, `● ${on.map((w) => w.name).join(", ")} on it now`) : st === "open" ? h("span", { class: "muted" }, "nobody on it now") : null)),
    h("p", { class: "note" }, "Its sessions, their outcomes and its tasks come here with the steps view. ", h("a", { href: `#roadmap/${p.key}` }, `${p.name}'s roadmap`)),
  ];
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
const svc = { projects: null, roadmaps: new Map(), loading: new Set(), again: new Set() };
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
  } catch {
    svc.projects = [];
  }
  for (const key of svc.roadmaps.keys()) loadRoadmap(key);
  for (const key of backlogs.keys()) loadBacklog(key);
  if (ov.rows || viewName() === "overview") loadOverview();
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

/** `#roadmap/<project>[/edit]`, or the project picked above, when its board is in the service; null for a Backlog.md one. */
function roadmapRoute() {
  const [, key, mode] = location.hash.slice(1).split("/");
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
    svc.projects.length > 1 ? h("span", { class: "seg" }, svc.projects.map((q) => h("button", { type: "button", "aria-pressed": String(q.key === key), onclick: () => (location.hash = to(q.key, edit)) }, q.name))) : h("b", null, p.name),
    data ? h("span", { class: "muted" }, `${plural(rels.length, "release")} · ${plural(data.features.length, "feature")}`) : null,
    rels.length || data?.features.length ? h("button", { type: "button", class: `gates-btn${edit ? " primary" : ""}`, onclick: () => (location.hash = to(key, !edit)) }, edit ? "Done" : "Edit your gates") : null);
  if (!data) return [bar, h("div", { class: "empty-card" }, "Reading the board…")];
  const out = [bar];
  if (data.error) out.push(h("div", { class: "banner down" }, h("b", null, "Board unavailable"), h("span", null, data.error)));
  if (edit) {
    out.push(h("div", { class: "banner editing" }, h("b", null, "Your gates"),
      h("span", null, `Move a feature into or out of a release, change the order of releases, close a release. Changes save as you make them, each with Undo, and go in the board's history as yours. Anything else is a request to ${poOf(p)}.`)));
  }
  if (!rels.length) out.push(h("div", { class: "empty-card" }, `${p.name} has no releases yet. Its PO makes the first one.`));
  rels.forEach((r, i) => out.push(releaseSection(key, data, r, i, edit)));
  const none = data.features.filter((f) => f.release === null);
  if (none.length || data.none?.items) out.push(releaseSection(key, data, null, null, edit));
  out.push(h("p", { class: "note" }, `Order inside a release is ${poOf(p)}'s; the order of releases is yours. A number in italics: the board has no order for it, so it follows the ordered ones by id. Criteria: acceptance criteria ticked, the feature's own and its tasks'.`));
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
  const relState = !r ? null : closed ? "closed" : fs.length && done.length === fs.length ? "all done" : r.status === "open" ? "open" : null;
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
        closed ? null : button("Close release", "danger", () => closeRelease(key, data, r))) : null),
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
      h("a", { class: "id", href: `#feature/${f.ref}` }, f.ref), h("span", { class: "title" }, f.title),
      on.length ? h("div", { class: "now" }, `● ${on.map((w) => w.name).join(", ")} on it now`) : st === "open" ? h("div", { class: "now idle" }, "open · nobody on it now") : null),
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
    toast(said, true, res.seq === 0 ? null : () => undoGate(key, typeof undoOp === "function" ? undoOp(res) : undoOp));
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

/** The service's overview rows and what waits on Casper: read on the Overview, refetched on board_changed. */
const ov = { rows: null, waits: null, error: null, loading: false, again: false };

async function loadOverview() {
  if (ov.loading) return void (ov.again = true);
  ov.loading = true;
  try {
    const [o, w] = await Promise.all([boardOp({ op: "overview" }), boardOp({ op: "waits" })]);
    Object.assign(ov, { rows: o.projects, waits: w.waits, error: null });
  } catch (err) {
    Object.assign(ov, { rows: ov.rows ?? [], waits: ov.waits ?? [], error: err.message });
  } finally {
    ov.loading = false;
  }
  if (viewName() === "overview") scheduleRender();
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
/** The agents on a feature now, from their declared sessions; nothing is guessed from a brief (roadmap-view 5). */
const onFeature = (key, ref) => running().filter((w) => w.project === key && sessionOf(w)?.feature === ref);
const pendingAll = () => [...state.laptops.values()].flatMap((l) => l.snapshot.pending.map((p) => ({ ...p, laptop: l.laptop })));
const projectName = (key) => svc.projects?.find((p) => p.key === key)?.name ?? key;
/** The laptops a project runs on: its supervisor's board, and its agents'. */
const laptopsOf = (key) => [...new Set([...projects().filter((e) => e.board.project === key).map((e) => e.laptop), ...workers().filter((w) => w.project === key).map((w) => w.laptop)])];

/** A worker's state when it isn't working: what it waits on, and whose it is. */
function waitingText(w) {
  if (w.state === "running") return null;
  const p = pendingAll().find((x) => x.worker_id === w.id);
  return p ? (p.tier === "human" ? "waiting on you" : "waiting on the orchestrator") : w.state === "waiting-answer" ? "waiting on an answer" : "waiting on a permission";
}

const WAIT_KIND = { question: ["question", "question"], action: ["action", "action"], review_gate: ["review", "review gate"], bug: ["bug", "bug · blocks use"] };
/** A session by its kind and label ("build A", "review 1"), never repeating the kind; "Fixes" is a build label and stays "Fixes" (spec, BOB-3 gap 5). */
const stepName = (ss) => (ss.label === "Fixes" || ss.label.toLowerCase().startsWith(`${ss.kind} `) ? ss.label : `${ss.kind} ${ss.label}`);
/** The agents in a board session, from their declared sessions. */
const inSession = (key, ss) => running().filter((w) => w.project === key && w.session === `${ss.feature} ${ss.kind} ${ss.label}`);
/** Several names: at most two, then "+N more". */
const upTo2 = (names) => (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2} more` : names.join(", "));

/** What a wait holds up, in words (spec, BOB-3 gap 5): a session of its own feature by who is in it, another's with its feature, then items; a feature and its own session count once. */
function heldNames(w) {
  const sessions = [...new Map([...w.holds.sessions, ...w.waiting_sessions].map((ss) => [`${ss.feature} ${ss.kind} ${ss.label}`, ss])).values()]
    .sort((a, b) => (b.feature === w.feature) - (a.feature === w.feature));
  const items = w.holds.items.filter((ref) => !sessions.some((ss) => ss.feature === ref));
  return upTo2([
    ...sessions.map((ss) => {
      if (ss.feature !== w.feature) return `${ss.feature} ${stepName(ss)}`;
      const who = inSession(w.project, ss);
      return who.length ? `${who.map((x) => x.name).join(" and ")} (${stepName(ss)})` : stepName(ss);
    }),
    ...items,
  ]);
}

function viewOverview() {
  if (svc.projects && !ov.rows && !ov.loading) loadOverview();
  // A permission holds up its agent; only those that are Casper's, not the orchestrator's, need him.
  const perms = pendingAll().filter((p) => p.tier === "human");
  const waits = ov.waits ?? [];
  const blocking = waits.filter((w) => w.blocking);
  const holding = perms.length + blocking.length;
  const rest = waits.length - blocking.length;
  const now = running();
  const svcKeys = new Set((ov.rows ?? []).map((o) => o.project.key));
  const legacy = projects().map((e) => e.board.project).filter((k) => !svcKeys.has(k));
  return [
    ov.error ? h("div", { class: "banner down" }, h("b", null, "Board unavailable"), h("span", null, ov.error)) : null,
    h("div", { class: "ov" },
      h("section", { class: "ov-needs" }, h("h2", null, "Needs you ", h("span", { class: "count", id: "needs-count" }, perms.length + waits.length || "")),
        h("div", { class: "card" },
          !ov.waits && !perms.length ? h("p", { class: "muted", style: "margin:0" }, "Reading the board…")
            : holding ? h("ul", { class: "lines", id: "needs" }, perms.map(permissionLine), blocking.map(waitLine))
            : h("p", { class: "muted", style: "margin:0" }, "Nothing is held up by you."),
          // The Waits on you tab isn't here yet, so this names it without a link (spec, BOB-8 gap 3).
          rest ? h("p", { class: "more" }, `${holding} ${holding === 1 ? "holds" : "hold"} work up · ${rest} more when you have time`) : null)),
      h("section", { class: "ov-now" }, h("h2", null, "Working now ", h("span", { class: "count" }, now.length || "")),
        now.length ? h("div", { class: "card" }, h("ul", { class: "lines now-list", id: "working" }, now.map(nowLine))) : h("div", { class: "empty-card" }, "No agent is working.")),
      h("section", { class: "ov-proj" }, h("h2", null, "Projects"),
        h("div", { class: "plist", id: "plist" },
          !ov.rows && !legacy.length ? h("div", { class: "empty-card" }, svc.projects ? "Reading the board…" : "No project's board yet.") : null,
          (ov.rows ?? []).map(projectRow), legacy.map(legacyRow)))),
  ];
}

function waitLine(w) {
  const [st, label] = WAIT_KIND[w.kind];
  return h("li", { class: "hold" }, badge(st, label),
    h("span", { class: "l-t", title: w.text }, w.text),
    h("span", { class: "l-m" }, `${projectName(w.project)}${w.feature ? ` · ${w.feature}` : ""} · ${w.kind === "bug" ? "blocks use" : `holds up ${heldNames(w)}`}`));
}

function permissionLine(p) {
  const w = workers().find((x) => x.id === p.worker_id);
  const ss = w && sessionOf(w);
  return h("li", { class: "hold can" }, badge("permission"),
    h("span", { class: "l-t", title: p.preview }, p.kind === "question" ? `${p.name} asks: ${p.preview}` : `${p.name} wants ${p.tool}`),
    h("span", { class: "acts" },
      p.kind === "question" ? h("span", { class: "muted hint" }, "Answer it through the orchestrator, or ") : button("Allow", "primary", (b) => act(p.laptop, { kind: "answer", request: p.id, decision: "allow" }, b, `Allow ${p.name} to run ${p.tool}?\n\n${p.preview}`)),
      button("Deny", "danger", (b) => act(p.laptop, { kind: "answer", request: p.id, decision: "deny" }, b))),
    h("span", { class: "l-m" }, `${w ? projectName(w.project) : p.laptop}${ss ? ` · ${ss.feature}` : ""} · holds up ${p.name}${ss ? ` (${ss.label})` : ""}`));
}

function nowLine(w) {
  const ss = sessionOf(w);
  const waiting = waitingText(w);
  const items = projects().find((e) => e.board.project === w.project)?.board.backlog?.items ?? [];
  const tasks = refsOf(w).filter((id) => id !== ss?.feature);
  return h("li", { dataset: { state: w.state } },
    h("span", { class: "l-who" }, h("i", { class: `dot ${waiting ? "warn" : "on"}`, "aria-hidden": "true" }), h("b", null, w.name), h("span", { class: "muted" }, ` ${w.role}`)),
    h("span", { class: "l-path" }, h("span", { class: "muted" }, projectName(w.project), " › "),
      ss ? [h("a", { class: "id", href: `#feature/${ss.feature}` }, ss.feature), h("span", { class: "muted" }, `${ss.label}${tasks.length ? " › " : ""}`),
          tasks.map((id) => h("a", { href: `#feature/${ss.feature}`, class: "l-task" }, h("span", { class: "id" }, id), items.find((x) => x.id === id)?.title ?? ""))]
        : h("span", { class: "muted", style: "font-style:italic" }, "Other work (no session)")),
    h("span", { class: "l-m" }, waiting ? h("span", { style: "color:var(--warn)" }, `${waiting} · `) : null, `${fmtTokens(workerTokens(w))} tokens`));
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
      ? [h("a", { href: `#feature/${open.ref}`, class: "v clamp" }, h("span", { class: "id" }, open.ref), open.title),
         h("span", { class: "muted" }, `${open.progress.checked} of ${open.progress.total} criteria · `, on.length ? h("span", { style: "color:var(--ok)" }, `${on.map((w) => w.name).join(", ")} on it`) : "nobody on it"),
         o.open.length > 1 ? h("a", { href: `#roadmap/${p.key}`, class: "muted" }, `and ${o.open.length - 1} more open`) : null]
      : h("span", { class: "muted" }, "no feature open")),
    cell("Next", o.waits_on_you ? h("span", { class: "v", style: "color:var(--warn)" }, `Waits on you: ${o.waits_on_you}`) : null,
      next ? h("span", { class: "muted clamp" }, o.waits_on_you ? "Then Ready: " : "Ready: ", h("a", { class: "id", href: `#feature/${next.ref}` }, next.ref), next.title) : h("span", { class: "muted" }, "none Ready yet")),
    cell("Backlog", b.items
      ? [h("a", { href: `#triage/${p.key}`, class: "v", onclick: toTriage }, plural(b.items, "item")), h("span", { class: "muted" }, `${plural(b.bugs, "bug")} · oldest ${age(b.oldest)}`)]
      : h("span", { class: "muted" }, "nothing to triage")));
}

/** A project whose board is still its supervisor's Backlog.md one: its name and laptop; its roadmap shows the rest. */
function legacyRow(key) {
  return h("div", { class: "card prow", dataset: { project: key } },
    h("div", { class: "pc pname" }, h("a", { href: "#roadmap", onclick: () => (state.project = key) }, key), h("span", { class: "muted" }, laptopsOf(key).join(" · "))),
    h("div", { class: "pc legacy" }, h("span", { class: "muted" }, "Its board is still on Backlog.md, not in the service yet: its roadmap shows where it stands.")));
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

/** `#triage/<project>[/edit]`, or the project picked above, or the first in the service. */
function triageRoute() {
  const [, key, mode] = location.hash.slice(1).split("/");
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
  if (!route) return [h("div", { class: "empty-card" }, svc.projects ? "No project's board is in the service yet." : "Reading the board…")];
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
    svc.projects.length > 1 ? h("span", { class: "seg" }, svc.projects.map((q) => h("button", { type: "button", "aria-pressed": String(q.key === key), onclick: () => (location.hash = to(q.key, edit)) }, q.name))) : h("b", null, p.name),
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
              d.parent_hint ? h("div", { class: "sub muted" }, "Parent hint: ", h("a", { href: `#feature/${d.parent_hint}` }, d.parent_hint)) : null,
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

/** The project on screen, else the one picked above, else the first. */
function captureProject() {
  const keys = (svc.projects ?? []).map((p) => p.key);
  const [v, key] = location.hash.slice(1).split("/");
  if ((v === "roadmap" || v === "triage") && keys.includes(key)) return key;
  if (v === "triage") return triageRoute()?.key ?? keys[0];
  if (v === "roadmap") return roadmapRoute()?.key ?? keys[0];
  return keys.includes(state.project) ? state.project : keys[0];
}

/** With `back`, a refused capture, its text and choices as Casper made them, and why it was refused. */
function openCapture(back = null) {
  const dlg = $("capture");
  let key = back?.op.project ?? captureProject();
  let bug = back?.op.type === "bug", where = back?.op.bug_where ?? "staging", blocks = !!back?.op.blocks_use;
  const nameOf = (k) => svc.projects.find((p) => p.key === k)?.name ?? k;
  const keep = (fn) => { const v = $("cap-text")?.value ?? ""; fn(); $("cap-text").value = v; $("cap-text").focus(); };
  const draw = () => dlg.replaceChildren(h("form", { method: "dialog", onsubmit: (e) => { e.preventDefault(); submit(); } },
    h("h2", { id: "capture-h" }, "Capture"),
    h("textarea", { id: "cap-text", "aria-label": "What to capture", placeholder: "What is it? A title and a sentence is enough.", required: true }),
    svc.projects.length > 1 ? h("div", { class: "opt" }, h("span", null, "Project"), h("span", { class: "seg" }, svc.projects.map((p) => h("button", { type: "button", "aria-pressed": String(p.key === key), onclick: () => keep(() => { key = p.key; draw(); }) }, p.name)))) : null,
    h("div", { class: "opt" }, h("span", null, "Is it a bug?"), h("span", { class: "seg" },
      h("button", { type: "button", "aria-pressed": String(!bug), onclick: () => keep(() => { bug = false; draw(); }) }, "No"),
      h("button", { type: "button", "aria-pressed": String(bug), onclick: () => keep(() => { bug = true; draw(); }) }, "Bug"))),
    bug ? h("div", { class: "opt" }, h("span", null, "Where"), h("span", { class: "seg" }, ["staging", "production"].map((w) => h("button", { type: "button", "aria-pressed": String(where === w), onclick: () => keep(() => { where = w; draw(); }) }, w))),
      h("label", { class: "check" }, h("input", { type: "checkbox", id: "cap-blocks", checked: blocks || null, onchange: (e) => keep(() => { blocks = e.target.checked; draw(); }) }), "Blocks use")) : null,
    back ? h("p", { class: "note refused" }, `Not captured: ${back.message}`) : null,
    h("p", { class: "note" }, bug && blocks ? "A bug that blocks use goes first in the triage list, marked blocks use." : `It goes to ${nameOf(key)}'s triage list, with your words as you typed them. Release and feature are set at triage.`),
    h("div", { class: "foot" }, button("Cancel", "", () => dlg.close()), h("button", { type: "submit", class: "primary" }, "Capture"))));
  const submit = () => {
    const text = $("cap-text").value.trim();
    if (!text) return $("cap-text").focus();
    dlg.close();
    capture(key, nameOf(key), {
      op: "capture", project: key, capture_id: crypto.randomUUID(), title: titleOf(text), casper_words: text, type: bug ? "bug" : "task",
      ...(bug ? { bug_where: where, ...(blocks ? { blocks_use: true } : {}) } : {}),
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
  // Not "and on Waits on you" until BOB-5 ships that tab (spec: BOB-8 as built).
  const also = op.blocks_use ? ", marked blocks use" : "";
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
    tip.replaceChildren(h("b", null, `Call ${i}`), ...rows.map(([sr, v]) => h("div", { class: "row" }, h("span", null, h("i", { class: sr.style === "solid" ? "" : "dash", style: `--k:${sr.color}` }), sr.name), h("span", null, fmtTokens(v)))),
      band?.[i - 1] ? h("div", { class: "row muted" }, h("span", null, "earlier runs, median"), h("span", null, fmtTokens(band[i - 1][1]))) : null);
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    tip.style.left = `${Math.min(ev.clientX - wr.left + 14, wr.width - 200)}px`;
    tip.style.top = `${ev.clientY - wr.top + 10}px`;
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", leave);

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
  const b = current();
  if (!b) return [empty(null)];
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

// ---------- Rendering: sessions (debugging) ----------

function taskChip(task) {
  const b = h("button", { type: "button", class: `chip${state.taskFilter === task ? " on" : ""}`, title: `Show only ${task}` }, task);
  b.addEventListener("click", () => {
    state.taskFilter = state.taskFilter === task ? null : task;
    render();
  });
  return b;
}

function workerCard(w) {
  return h("div", { class: "card" },
    h("div", { class: "top" }, h("span", { class: "name" }, w.name), h("span", { class: "badge", dataset: { state: w.state } }, w.state)),
    h("div", { class: "sub" }, `${w.project} / ${w.role} · ${w.id} · ${fmtModel(w)} · ${w.laptop}${w.session ? ` · ${w.session}` : ""}`),
    h("div", { class: "task" }, w.task),
    w.checkpoint ? h("div", { class: "checkpoint" }, w.checkpoint) : null,
    h("div", { class: "meta" },
      h("span", null, w.started_at && w.ended_at ? `ran ${duration(Date.parse(w.ended_at) - Date.parse(w.started_at))}` : "not started"),
      h("span", null, `${fmtTokens(totalTokens(w.tokens))} tokens`),
      w.calls ? h("span", null, `${w.calls} calls, last context ${fmtTokens(w.context ?? 0)}`) : null));
}

/** Which client an agent runs: "supervisor 0.2.0 · protocol 1". */
const clientLabel = (c) => c ? `${c.package.replace(/^@bobnet\//, "")} ${c.version} · protocol ${c.protocol}` : "client version unknown";

function viewSessions() {
  const items = state.updates.map((u) => ({ ...u, task: taskRef(u.text) }));
  const shown = state.taskFilter ? items.filter((u) => u.task === state.taskFilter) : items;
  const ended = workers().filter((w) => w.ended_at).sort((a, c) => c.ended_at.localeCompare(a.ended_at));
  const peers = [...state.peers].sort((a, c) => Number(c.online) - Number(a.online) || a.address.localeCompare(c.address));
  return [
    h("p", { class: "note", style: "margin:0" }, "For debugging: what each session said and did."),
    h("section", null, h("h2", null, "Session updates ", h("span", { class: "count", id: "updates-filter" }, state.taskFilter ? [`${state.taskFilter} only · `, taskChip(state.taskFilter)] : [])),
      h("ul", { class: "feed", id: "updates" }, shown.length
        ? shown.map((u) => h("li", null, h("time", { datetime: u.at, title: u.at }, clock(u.at)), h("span", null, u.task ? taskChip(u.task) : null, h("b", null, shortName(u.from)), " ", withoutTask(u.text, u.task))))
        : h("li", { class: "empty" }, "No updates yet."))),
    h("section", null, details("ended", null, h("summary", null, "Workers ended in the last 24 hours ", h("span", { class: "count" }, ended.length)), h("div", { class: "cards", id: "ended" }, ended.map(workerCard)))),
    h("section", null, h("h2", null, "Messages"), h("ul", { class: "feed", id: "traffic" }, state.traffic.length
      ? state.traffic.map((t) => h("li", null, h("time", { datetime: t.at, title: t.at }, clock(t.at)), h("span", null, t.from, t.type === "broadcast" ? ` broadcast to ${t.to.length}` : ` → ${t.to.join(", ")}`, t.urgent ? " (urgent)" : "")))
      : h("li", { class: "empty" }, "No messages in the last 24 hours.")), h("p", { class: "note" }, "Who messaged whom, never what was said.")),
    h("section", null, h("h2", null, "Laptops"), h("div", { class: "cards", id: "laptops" }, [...state.laptops.values()].map((l) => {
      const sup = l.snapshot.supervisor, stale = Date.now() - Date.parse(l.at) > 3 * 60_000;
      return h("div", { class: "card" },
        h("div", { class: "top" }, h("span", { class: "name" }, l.laptop), h("span", { class: "badge", dataset: { state: stale ? "stopped" : "running" } }, stale ? "no recent report" : "supervisor up")),
        h("div", { class: "meta" }, h("span", null, `${sup.active} of ${sup.concurrency} slots busy`), h("span", null, `${sup.queued} queued`), h("span", null, "up ", ago(sup.started_at)), h("span", null, "reported ", ago(l.at), " ago")));
    }))),
    h("section", null, h("h2", null, "Agents ", h("span", { class: "count", id: "agents-count" }, `${peers.filter((p) => p.online).length} online of ${peers.length}`)),
      h("div", { class: "table-wrap" }, h("table", { id: "agents" },
        h("thead", null, h("tr", null, h("th", null, "Agent"), h("th", null, "Status"), h("th", { class: "num" }, "Up"), h("th", { class: "num" }, "In / out 24h"), h("th", { class: "num" }, "Inbox"))),
        h("tbody", null, peers.map((p) => h("tr", null,
          h("td", null, h("span", { class: `dot${p.online ? " on" : ""}` }), h("span", { class: "addr" }, p.address), p.team ? h("div", { class: "team" }, p.team) : null, h("div", { class: "client" }, clientLabel(p.client))),
          h("td", null, p.status ?? (p.online ? "" : `last seen ${since(p.last_seen)} ago`)),
          h("td", { class: "num" }, p.online && p.connected_at ? ago(p.connected_at) : "–"),
          h("td", { class: "num" }, `${p.stats.received_24h} / ${p.stats.sent_24h}`),
          h("td", { class: "num" }, p.stats.inbox ? String(p.stats.inbox) : "–"))))))),
  ];
}

// ---------- Views ----------

const VIEWS = { overview: viewOverview, now: viewNow, feature: viewFeature, roadmap: viewRoadmap, triage: viewTriage, usage: viewUsage, sessions: viewSessions };
const viewName = () => (VIEWS[location.hash.slice(1).split("/")[0]] ? location.hash.slice(1).split("/")[0] : "overview");

function render() {
  const v = viewName();
  for (const a of $("tabs").querySelectorAll("a")) a.toggleAttribute("aria-current", a.getAttribute("href").split("/")[0] === `#${v}`);
  $("now-count").textContent = running().length ? String(running().length) : "";
  const keys = [...new Set([...projects().map((e) => e.board.project), ...(svc.projects ?? []).map((p) => p.key)])];
  const shown = v === "roadmap" ? (roadmapRoute()?.key ?? current()?.project) : v === "triage" ? triageRoute()?.key : current()?.project;
  const pick = $("project");
  pick.hidden = keys.length < 2;
  pick.replaceChildren(...keys.map((k) => h("option", { value: k, selected: k === shown || null }, k)));
  // Capture always has a project (Casper, 2026-11-13): only once the service has one.
  $("capture-open").hidden = !svc.projects?.length;
  $("view").classList.toggle("wide", v === "overview" || v === "feature" || v === "roadmap");
  $("view").replaceChildren(...VIEWS[v]().filter(Boolean));
}

/** Live frames re-render at most a few times a second, and not while a chart is pointed at or a menu is open. */
let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (holdRender || document.activeElement?.tagName === "SELECT") return scheduleRender();
    render();
  }, 250);
}

$("capture-open").addEventListener("click", () => openCapture());
$("project").addEventListener("change", (e) => {
  state.project = e.target.value;
  state.inc = null;
  state.release = null;
  if (viewName() === "roadmap" && location.hash.includes("/")) location.hash = "roadmap";
  if (viewName() === "triage" && location.hash.includes("/")) location.hash = "triage";
  render();
});
window.addEventListener("hashchange", () => {
  holdRender = false;
  render();
  window.scrollTo(0, 0);
});
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => {
  if (Math.abs(window.innerWidth - lastWidth) < 20) return;
  lastWidth = window.innerWidth;
  scheduleRender();
});

// Durations tick without a re-render.
setInterval(() => {
  for (const el of document.querySelectorAll("[data-ago]")) el.textContent = since(el.dataset.ago);
}, 1000);

// ---------- Socket ----------

function setConn(st) {
  $("conn").dataset.state = st;
  $("conn").textContent = st === "live" ? "live" : st === "down" ? "reconnecting" : "connecting";
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
          const b = sentActions.get(f.rid);
          sentActions.delete(f.rid);
          if (b) b.disabled = false;
          toast(f.message, false);
        }
        break;
      case "action_result":
        toast(f.message, f.ok);
        break;
      case "ok":
        if (sentOps.has(f.rid)) {
          sentOps.get(f.rid).resolve(f.result);
          sentOps.delete(f.rid);
          break;
        }
        if (sentActions.has(f.rid)) {
          sentActions.delete(f.rid);
          toast("Sent; waiting for the supervisor…");
          break;
        }
        if (f.rid === dashboardRid) {
          state.peers = f.result.peers;
          state.laptops = new Map(f.result.laptops.map((l) => [l.laptop, l]));
          state.boards = new Map((f.result.boards ?? []).map((b) => [`${b.laptop}|${b.board.project}`, b]));
          state.updates = f.result.updates;
          state.traffic = f.result.traffic;
          render();
          setConn("live");
        }
        break;
      case "presence": {
        const i = state.peers.findIndex((p) => p.address === f.peer.address);
        const prev = i === -1 ? { stats: { sent_24h: 0, received_24h: 0, inbox: 0 }, connected_at: null } : state.peers[i];
        const next = { ...prev, ...f.peer, connected_at: f.event === "joined" ? new Date().toISOString() : f.peer.online ? prev.connected_at : null };
        if (i === -1) state.peers.push(next);
        else state.peers[i] = next;
        if (viewName() === "sessions") scheduleRender();
        break;
      }
      case "report":
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
        }
        if (ov.rows) loadOverview();
        break;
      case "update":
        state.updates = [f.item, ...state.updates].slice(0, UPDATES_MAX);
        if (viewName() === "sessions") scheduleRender();
        break;
      case "traffic":
        state.traffic = [f.item, ...state.traffic].slice(0, 50);
        if (viewName() === "sessions") scheduleRender();
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

render();
connect();
// Keepalive, and a full refresh every minute for the 24-hour counts.
setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 30_000);
setInterval(() => ws?.readyState === WebSocket.OPEN && (dashboardRid = request("dashboard")), 60_000);
