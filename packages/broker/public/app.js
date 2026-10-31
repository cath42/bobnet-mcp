// BobNet dashboard: one owner WebSocket, a full snapshot on connect, then
// live frames. Agent-supplied text is only ever set as textContent.

const state = { peers: [], laptops: new Map(), updates: [], traffic: [], taskFilter: null };
/** Updates kept in the page: the broker's snapshot plus what arrives live. */
const UPDATES_MAX = 200;
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
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
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
  b.addEventListener("click", () => onClick(b));
  return b;
}

// ---------- Formatting ----------

const fmtInt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : fmtInt.format(n));
const fmtCost = (n) => `$${n < 10 ? n.toFixed(2) : fmtInt.format(n)}`;
const totalTokens = (t) => t.input + t.output + t.cache_read + t.cache_write;

function duration(ms) {
  if (ms < 0 || !Number.isFinite(ms)) return "–";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const hr = Math.floor(m / 60);
  if (hr < 48) return `${hr}h ${m % 60}m`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}
const since = (iso) => (iso ? duration(Date.now() - Date.parse(iso)) : "–");
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// ---------- Rendering ----------

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
const shortName = (address) => address.split("@")[0];

/** What an update says about its task: done, landed, failed, or still going. */
function phase(text) {
  if (/^(landed|done)\b/.test(text)) return "done";
  if (/^(failed|stopped|could not land)\b/.test(text)) return "failed";
  if (/^held\b/.test(text)) return "waiting";
  return "running";
}

function taskChip(task) {
  const b = h("button", { type: "button", class: `chip${state.taskFilter === task ? " on" : ""}`, title: `Show only ${task}` });
  b.textContent = task;
  b.addEventListener("click", () => {
    state.taskFilter = state.taskFilter === task ? null : task;
    renderFeeds();
  });
  return b;
}

function workerCard(w) {
  const running = !w.ended_at && w.started_at;
  const controls = !w.ended_at
    ? h(
        "div",
        { class: "actions" },
        button("Stop", "danger", (b) => act(w.laptop, { kind: "stop", worker: w.id }, b, `Stop ${w.name} (${w.id})? It is interrupted, then ended.`)),
        button("Reset", "", (b) => act(w.laptop, { kind: "reset", worker: w.id }, b, `Reset ${w.name} (${w.id})? It is stopped and a fresh worker starts the same task with no prior context.`)),
      )
    : null;
  return h(
    "div",
    { class: "card" },
    h("div", { class: "top" }, h("span", { class: "name" }, w.name), h("span", { class: "badge", dataset: { state: w.state } }, w.state)),
    h("div", { class: "sub" }, `${w.project} / ${w.role} · ${w.id}`),
    h("div", { class: "task" }, w.task),
    w.checkpoint ? h("div", { class: "checkpoint" }, w.checkpoint) : null,
    h(
      "div",
      { class: "meta" },
      h("span", { "data-tick": running ? w.started_at : null }, running ? `up ${since(w.started_at)}` : w.started_at && w.ended_at ? `ran ${duration(Date.parse(w.ended_at) - Date.parse(w.started_at))}` : "not started"),
      w.last_event_at && running ? h("span", { "data-ago": w.last_event_at }, `active ${since(w.last_event_at)} ago`) : null,
      h("span", null, `${fmtTokens(totalTokens(w.tokens))} tokens`),
      h("span", null, fmtCost(w.cost_usd)),
    ),
    controls,
  );
}

function renderWorkers() {
  const all = [...state.laptops.values()].flatMap((l) => l.snapshot.workers.map((w) => ({ ...w, laptop: l.laptop })));
  const active = all.filter((w) => !w.ended_at);
  const ended = all.filter((w) => w.ended_at).sort((a, b) => b.ended_at.localeCompare(a.ended_at));
  $("workers").replaceChildren(...(active.length ? active.map(workerCard) : [h("div", { class: "empty" }, "No workers running.")]));
  $("workers-count").textContent = active.length ? String(active.length) : "";
  $("ended-wrap").hidden = ended.length === 0;
  $("ended").replaceChildren(...ended.map(workerCard));
  $("ended-count").textContent = String(ended.length);

  const pending = [...state.laptops.values()].flatMap((l) => l.snapshot.pending.map((p) => ({ ...p, laptop: l.laptop })));
  $("needs").hidden = pending.length === 0;
  $("needs-count").textContent = String(pending.length);
  $("needs-list").replaceChildren(
    ...pending.map((p) =>
      h(
        "li",
        { dataset: { tier: p.tier } },
        h("b", null, p.name),
        p.kind === "question" ? " asks a question" : ` wants ${p.tool}`,
        h("div", { class: "muted" }, `${p.tier === "human" ? "needs you" : "orchestrator decides"} · ${p.id} · ${p.laptop} · waiting `, h("span", { "data-ago": p.created_at }, since(p.created_at))),
        h("div", { class: "preview" }, p.preview),
        p.kind === "question"
          ? h(
              "div",
              { class: "actions" },
              h("span", { class: "muted" }, "Answer it through the orchestrator, or "),
              button("Deny", "danger", (b) => act(p.laptop, { kind: "answer", request: p.id, decision: "deny" }, b)),
            )
          : h(
              "div",
              { class: "actions" },
              button("Allow", "primary", (b) =>
                act(p.laptop, { kind: "answer", request: p.id, decision: "allow" }, b, p.tier === "human" ? `Allow ${p.name} to run ${p.tool}?\n\n${p.preview}` : null),
              ),
              button("Deny", "danger", (b) => act(p.laptop, { kind: "answer", request: p.id, decision: "deny" }, b)),
            ),
      ),
    ),
  );
}

function renderAgents() {
  const rows = [...state.peers].sort((a, b) => Number(b.online) - Number(a.online) || a.address.localeCompare(b.address));
  $("agents-count").textContent = `${rows.filter((p) => p.online).length} online of ${rows.length}`;
  $("agents-nav-count").textContent = String(rows.filter((p) => p.online).length);
  $("agents").tBodies[0].replaceChildren(
    ...rows.map((p) =>
      h(
        "tr",
        null,
        h("td", null, h("span", { class: `dot${p.online ? " on" : ""}` }), h("span", { class: "addr" }, p.address), p.team ? h("div", { class: "team" }, p.team) : null),
        h("td", null, p.status ?? (p.online ? "" : `last seen ${since(p.last_seen)} ago`)),
        h("td", { class: "num" }, p.online && p.connected_at ? h("span", { "data-ago": p.connected_at }, since(p.connected_at)) : "–"),
        h("td", { class: "num" }, `${p.stats.received_24h} / ${p.stats.sent_24h}`),
        h("td", { class: "num" }, p.stats.inbox ? String(p.stats.inbox) : "–"),
      ),
    ),
  );
}

function renderUsage() {
  const cutoff = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const byRole = new Map();
  let todayCost = 0;
  let weekCost = 0;
  let weekTokens = 0;
  for (const l of state.laptops.values()) {
    for (const u of l.snapshot.usage) {
      if (u.day < cutoff) continue;
      const key = `${u.project} / ${u.role}`;
      const r = byRole.get(key) ?? { workers: 0, tokens: 0, cost: 0 };
      r.workers += u.workers;
      r.tokens += totalTokens(u.tokens);
      r.cost += u.cost_usd;
      byRole.set(key, r);
      weekCost += u.cost_usd;
      weekTokens += totalTokens(u.tokens);
      if (u.day === today) todayCost += u.cost_usd;
    }
  }
  $("usage-totals").replaceChildren(
    h("div", null, h("b", null, fmtCost(todayCost)), h("span", null, "today")),
    h("div", null, h("b", null, fmtCost(weekCost)), h("span", null, "7 days")),
    h("div", null, h("b", null, fmtTokens(weekTokens)), h("span", null, "tokens, 7 days")),
  );
  const rows = [...byRole.entries()].sort((a, b) => b[1].cost - a[1].cost);
  $("usage").tBodies[0].replaceChildren(
    ...(rows.length
      ? rows.map(([role, r]) => h("tr", null, h("td", null, role), h("td", { class: "num" }, String(r.workers)), h("td", { class: "num" }, fmtTokens(r.tokens)), h("td", { class: "num" }, fmtCost(r.cost))))
      : [h("tr", null, h("td", { colspan: "4", class: "muted" }, "No supervised work yet."))]),
  );
}

function renderFeeds() {
  const items = state.updates.map((u) => ({ ...u, task: taskRef(u.text) }));

  // Progress: each task's latest word, newest first, for tasks heard from in the last 24 hours.
  const latest = new Map();
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  for (const u of items) if (u.task && u.at >= dayAgo && !latest.has(u.task)) latest.set(u.task, { ...u, count: items.filter((x) => x.task === u.task).length });
  $("progress").replaceChildren(
    ...(latest.size
      ? [...latest.values()].map((u) => {
          const text = withoutTask(u.text, u.task);
          const p = phase(text);
          return h(
            "div",
            { class: "card task-card", dataset: { phase: p } },
            h("div", { class: "top" }, taskChip(u.task), h("span", { class: "badge", dataset: { state: p } }, p === "waiting" ? "held" : p)),
            h("div", { class: "checkpoint" }, text),
            h("div", { class: "meta" }, h("span", null, shortName(u.from)), h("span", null, h("span", { "data-ago": u.at }, since(u.at)), " ago"), h("span", null, `${u.count} update${u.count === 1 ? "" : "s"}`)),
          );
        })
      : [h("div", { class: "empty" }, "No task has reported progress in the last 24 hours.")]),
  );

  const shown = state.taskFilter ? items.filter((u) => u.task === state.taskFilter) : items;
  const filter = $("updates-filter");
  filter.replaceChildren(...(state.taskFilter ? [`${state.taskFilter} only · `, taskChip(state.taskFilter)] : []));
  $("updates").replaceChildren(
    ...(shown.length
      ? shown.map((u) =>
          h(
            "li",
            null,
            h("time", { datetime: u.at, title: u.at }, clock(u.at)),
            h("span", null, u.task ? taskChip(u.task) : null, h("b", null, shortName(u.from)), " ", withoutTask(u.text, u.task)),
          ),
        )
      : [h("li", { class: "empty" }, "No updates yet.")]),
  );
  $("traffic").replaceChildren(
    ...(state.traffic.length
      ? state.traffic.map((t) =>
          h("li", null, h("time", { datetime: t.at, title: t.at }, clock(t.at)), h("span", null, t.from, t.type === "broadcast" ? ` broadcast to ${t.to.length}` : ` → ${t.to.join(", ")}`, t.urgent ? " (urgent)" : "")),
        )
      : [h("li", { class: "empty" }, "No messages in the last 24 hours.")]),
  );
}

function renderLaptops() {
  const cards = [...state.laptops.values()].map((l) => {
    const s = l.snapshot.supervisor;
    const stale = Date.now() - Date.parse(l.at) > 3 * 60_000;
    return h(
      "div",
      { class: "card" },
      h("div", { class: "top" }, h("span", { class: "name" }, l.laptop), h("span", { class: "badge", dataset: { state: stale ? "stopped" : "running" } }, stale ? "no recent report" : "supervisor up")),
      h(
        "div",
        { class: "meta" },
        h("span", null, `${s.active} of ${s.concurrency} slots busy`),
        h("span", null, `${s.queued} queued`),
        h("span", null, "up ", h("span", { "data-ago": s.started_at }, since(s.started_at))),
        h("span", null, "reported ", h("span", { "data-ago": l.at }, since(l.at)), " ago"),
      ),
    );
  });
  $("laptops").replaceChildren(...(cards.length ? cards : [h("div", { class: "empty" }, "No supervisor has reported yet.")]));
}

function renderAll() {
  renderWorkers();
  renderAgents();
  renderUsage();
  renderFeeds();
  renderLaptops();
}

// Durations tick without a re-render.
setInterval(() => {
  for (const el of document.querySelectorAll("[data-ago]")) el.textContent = since(el.dataset.ago);
  for (const el of document.querySelectorAll("[data-tick]")) el.textContent = `up ${since(el.dataset.tick)}`;
}, 1000);

// ---------- Views ----------

/** Activity is the page; the agents list is a secondary view at #agents. */
function showView() {
  const view = location.hash === "#agents" ? "agents" : "activity";
  $("activity").hidden = view !== "activity";
  $("agents-view").hidden = view !== "agents";
  for (const a of document.querySelectorAll("nav a")) a.toggleAttribute("aria-current", a.dataset.view === view);
}
window.addEventListener("hashchange", showView);
showView();

// ---------- Socket ----------

function setConn(s) {
  $("conn").dataset.state = s;
  $("conn").textContent = s === "live" ? "live" : s === "down" ? "reconnecting" : "connecting";
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
          state.updates = f.result.updates;
          state.traffic = f.result.traffic;
          renderAll();
          setConn("live");
        }
        break;
      case "presence": {
        const i = state.peers.findIndex((p) => p.address === f.peer.address);
        const prev = i === -1 ? { stats: { sent_24h: 0, received_24h: 0, inbox: 0 }, connected_at: null } : state.peers[i];
        const next = { ...prev, ...f.peer, connected_at: f.event === "joined" ? new Date().toISOString() : f.peer.online ? prev.connected_at : null };
        if (i === -1) state.peers.push(next);
        else state.peers[i] = next;
        renderAgents();
        break;
      }
      case "report":
        state.laptops.set(f.laptop, { laptop: f.laptop, at: f.at, snapshot: f.snapshot });
        renderWorkers();
        renderUsage();
        renderLaptops();
        break;
      case "update":
        state.updates = [f.item, ...state.updates].slice(0, UPDATES_MAX);
        renderFeeds();
        break;
      case "traffic":
        state.traffic = [f.item, ...state.traffic].slice(0, 50);
        renderFeeds();
        break;
    }
  });
  ws.addEventListener("close", () => {
    setConn("down");
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  });
}

connect();
// Keepalive, and a full refresh every minute for the 24-hour counts.
setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 30_000);
setInterval(() => ws?.readyState === WebSocket.OPEN && (dashboardRid = request("dashboard")), 60_000);
