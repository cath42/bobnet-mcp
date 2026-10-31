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
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
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

function toast(text, ok = true) {
  const el = $("toast");
  el.textContent = text;
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

function backlogModel(b) {
  const items = b.backlog?.items ?? [];
  const byId = new Map(items.map((x) => [x.id, x]));
  const kids = (pid) => items.filter((x) => x.parent === pid);
  const settled = (st) => st === "In Review" || st === "Done";
  const live = running().filter((w) => w.project === b.project);
  const workerOn = (id) => live.filter((w) => w.task_ref === id);
  const runningOnInc = (id) => live.filter((w) => w.task_ref === id || byId.get(w.task_ref)?.parent === id);
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
    for (const r of sessionRuns(b, ss.name)) if (r.task_ref && ks.some((k) => k.id === r.task_ref) && !ks.find((k) => k.id === r.task_ref).labels.some((v) => v.startsWith("build:"))) place.set(r.task_ref, key);
  }
  const order = (k) => (k === "design" ? -1 : Number(k.split(" ")[1]) || 0);
  const keys = [...new Set(place.values())].sort((a, c) => order(a) - order(c));
  const lanes = keys.map((key) => {
    const ids = ks.filter((k) => place.get(k.id) === key).map((k) => k.id);
    const ss = sessions.find((x) => x.name === `${prefix}${key}`);
    const now = !!ss && m.cur?.name === ss.name;
    return { title: key[0].toUpperCase() + key.slice(1), ids, now, closed: !now && ids.every((id) => m.settled(m.byId.get(id).status)) };
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
            const x = w.task_ref ? boardOf(w)?.backlog?.items.find((i) => i.id === w.task_ref) : null;
            const head = headlineOf(w.task);
            return h("tr", { class: "pick", tabindex: "0", title: "Show its context per call", onclick: () => showRun(w), onkeydown: (e) => e.key === "Enter" && showRun(w) },
              h("td", null, h("b", null, w.name), h("div", { class: "cp" }, w.session ?? w.project), w.state !== "running" ? h("div", null, h("span", { class: "badge", dataset: { state: w.state } }, w.state)) : null),
              h("td", { class: "wide" },
                head ? [h("span", { class: "title" }, head), x ? h("div", { class: "cp" }, "about ", chip(x.id), x.title) : null]
                  : x ? [chip(x.id), " ", h("span", { class: "title" }, x.title)] : h("span", { class: "title" }, w.task),
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

function agentTag(w, showTask, m) {
  const x = w.task_ref ? m.byId.get(w.task_ref) : null;
  const head = headlineOf(w.task);
  return h("div", { class: "agent", role: "button", tabindex: "0", title: "Show its context per call", style: "cursor:pointer", onclick: (e) => (e.stopPropagation(), showRun(w)), onkeydown: (e) => e.key === "Enter" && (e.stopPropagation(), showRun(w)) },
    h("b", null, w.name),
    showTask ? h("span", { class: "d" }, head ? `${head}${x ? ` · ${x.id}` : ""}` : `${w.task_ref ?? ""} · ${x ? x.title.slice(0, 60) : w.task.slice(0, 60)}`)
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
  const ws = m.runningOnInc(inc.id);
  return [
    h("div", { class: "bar-row" },
      h("label", { for: "inc-pick", class: "muted" }, "Feature"),
      h("select", { id: "inc-pick", onchange: (e) => { state.inc = e.target.value; render(); } }, (open.includes(inc) ? open : [inc, ...open]).map((x) => h("option", { value: x.id, selected: x.id === inc.id || null }, `${x.id} · ${x.title.slice(0, 70)}`))),
      h("span", { class: "muted" }, `${inc.milestone ? m.milestone(inc.milestone) : "no release"} · ${ks.filter((k) => m.settled(k.status)).length} of ${ks.length} built · ${ws.length ? `${ws.length} agent${ws.length > 1 ? "s" : ""} on it now` : "nobody on it now"}`)),
    details("feature-desc", { class: "card" }, h("summary", { style: "margin:0;color:var(--text);font-weight:600" }, inc.title),
      inc.desc ? h("div", { class: "sub" }, inc.desc.replace(/^## What\s*/, "")) : null,
      inc.ac.length ? h("ol", { class: "ac", style: "font-size:13px" }, inc.ac.map(([on, t]) => h("li", null, on ? "✓ " : "", t))) : null),
    board(cols, lanes),
    h("p", { class: "note" }, "Click a task to open it. Tasks with an agent on them stay open, and the agent links to its context per call. A task's build:<n> label puts it in a build; without one, the build whose workers had it as their task."),
  ];
}

/** A <details> that stays open or closed across re-renders. */
function details(key, attrs, ...children) {
  const d = h("details", { ...attrs, open: state.open.has(key) || null }, ...children);
  d.addEventListener("toggle", () => (d.open ? state.open.add(key) : state.open.delete(key)));
  return d;
}

function viewRoadmap() {
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
  const xs = b.sessions.slice(-state.last);
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
      tip.replaceChildren(h("b", null, ss.name), ...[["tokens", fmtTokens(v)], ["output", fmtTokens(ss.tokens.output)], ["workers", ss.workers], ["calls", ss.calls], ["started", `${ss.started_at.slice(5, 10)} ${clock(ss.started_at)}`]].map(([k, val]) => h("div", { class: "row" }, h("span", null, k), h("span", null, String(val)))));
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
  const kinds = new Set(b.sessions.map((x) => x.kind));
  const pick = (n) => h("button", { type: "button", "aria-pressed": String(state.last === n), onclick: () => { state.last = n; render(); } }, `Last ${n}`);
  wrap.append(h("div", { class: "bar-row", style: "margin:0" }, h("span", { class: "seg" }, pick(10), pick(20), pick(50)), h("span", { class: "muted" }, `${b.sessions.length} sessions on record`)),
    svg,
    h("div", { class: "key" }, ["build", "design", "review", "retro", "other"].map((k) => h("span", { style: kinds.has(k) ? "" : "opacity:.55" }, h("i", { class: "band", style: `--k:${KIND[k]};opacity:1;width:10px;height:10px;border-radius:2px` }), k === "other" ? "other work" : k))),
    h("div", { class: "note", style: "margin:0" }, "Each session's tokens, cache reads included. A worker belongs to the session its brief names, else to the one running when it started."), tip);
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
      h("p", { class: "note" }, "Click a role to see its context per call above. Tokens count everything a run read and wrote, cache reads included.")),
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
          h("td", null, h("span", { class: `dot${p.online ? " on" : ""}` }), h("span", { class: "addr" }, p.address), p.team ? h("div", { class: "team" }, p.team) : null),
          h("td", null, p.status ?? (p.online ? "" : `last seen ${since(p.last_seen)} ago`)),
          h("td", { class: "num" }, p.online && p.connected_at ? ago(p.connected_at) : "–"),
          h("td", { class: "num" }, `${p.stats.received_24h} / ${p.stats.sent_24h}`),
          h("td", { class: "num" }, p.stats.inbox ? String(p.stats.inbox) : "–"))))))),
  ];
}

// ---------- Views ----------

const VIEWS = { now: viewNow, feature: viewFeature, roadmap: viewRoadmap, usage: viewUsage, sessions: viewSessions };
const viewName = () => (VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "now");

function render() {
  const v = viewName();
  for (const a of $("tabs").querySelectorAll("a")) a.toggleAttribute("aria-current", a.getAttribute("href") === `#${v}`);
  $("now-count").textContent = running().length ? String(running().length) : "";
  const all = projects();
  const pick = $("project");
  pick.hidden = all.length < 2;
  pick.replaceChildren(...all.map((e) => h("option", { value: e.board.project, selected: e.board.project === current()?.project || null }, e.board.project)));
  $("view").classList.toggle("wide", v === "feature" || v === "roadmap");
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

$("project").addEventListener("change", (e) => {
  state.project = e.target.value;
  state.inc = null;
  state.release = null;
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
        break;
      case "error":
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
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  });
}

render();
connect();
// Keepalive, and a full refresh every minute for the 24-hour counts.
setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 30_000);
setInterval(() => ws?.readyState === WebSocket.OPEN && (dashboardRid = request("dashboard")), 60_000);
