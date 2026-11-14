// Release 1 prototype: the roadmap, a feature's sessions, what waits on Casper, triage and capture.
// Static: it reads the sample in ../sample and keeps edits in memory only (a reload resets them).
"use strict";

const S = window.SAMPLES, R = S.records, NOW = new Date(R.now);
// Backlog.md writes created_date in UTC ("2026-11-14 02:43"); a bare date is a day in Casper's time (Central).
const when = (s) => new Date(s.length === 10 ? `${s}T00:00-06:00` : /[Z+]|-\d\d:\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`);
const $ = (id) => document.getElementById(id);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// ---------- The model: a mutable copy, so Casper's gates and captures can be tried ----------

const proj = (key) => R.projects.find((p) => p.key === key);
const state = {
  rel: {}, captured: { helix: [], bobnet: [] }, waits: [...R.waits], expanded: new Set(), undo: null,
  triageFilter: "all", triageAll: false, waitsProj: "all",
  answered: [], answering: null, ctx: new Map(),
};
for (const p of R.projects) {
  state.rel[p.key] = [
    ...S[p.key].releases.map((r) => ({ id: r.id, title: r.title.replace(/^"|"$/g, ""), closed: false, features: r.features.map((f) => ({ ...f })) })),
    { id: "none", title: "Not in a release", none: true, closed: false, features: S[p.key].noRelease.map((f) => ({ ...f, ac: [0, 0], tasks: 0, tasksDone: 0, ordinal: null })) },
  ];
}
const releases = (key) => state.rel[key].filter((r) => !r.none);
const allFeatures = (key) => state.rel[key].flatMap((r) => r.features.map((f, i) => ({ ...f, rel: r, n: i + 1 })));
const findFeature = (id) => { for (const p of R.projects) { const f = allFeatures(p.key).find((x) => x.id === id); if (f) return { p, f }; } return null; };
const isOpen = (f) => !!R.sessions[f.id] && f.status !== "Done";
const fstate = (f) => (f.status === "Done" ? "done" : isOpen(f) ? "open" : f.status.toLowerCase());
const short = (id) => id.replace(/^[A-Z]+-/, "");
const items = (key) => [...state.captured[key], ...S[key].drafts];
const isBug = (d) => d.type === "bug";

// ---------- Formatting ----------

const days = (iso) => Math.max(0, Math.floor((NOW - when(iso)) / 864e5));
const age = (iso) => { const d = days(iso); return d === 0 ? "today" : d === 1 ? "1 day" : `${d} days`; };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const hm = (iso) => iso.slice(11, 16);
function span(a, b) {
  if (!b) return `${day(a)} ${hm(a)}, running ${dur(a, R.now.slice(0, 16))}`;
  return `${day(a)} ${hm(a)} – ${day(a) === day(b) ? "" : `${day(b)} `}${hm(b)} · ${dur(a, b)}`;
}
function dur(a, b) { const m = Math.round((new Date(b) - new Date(a)) / 6e4); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`; }
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2).replace(/0$/, "")}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function ranges(ns) {
  const out = []; let a = null, b = null;
  for (const n of ns) { if (a !== null && n === b + 1) b = n; else { if (a !== null) out.push(a === b ? `${a}` : `${a}–${b}`); a = b = n; } }
  if (a !== null) out.push(a === b ? `${a}` : `${a}–${b}`);
  return out.join(", ");
}

const badge = (st, text = st) => h("span", { class: "badge", dataset: { state: st } }, text);
const meter = (done, total, cls = "ok") => h("div", { class: "meter", role: "img", "aria-label": `${done} of ${total}` }, h("i", { class: cls, style: `width:${total ? (done / total) * 100 : 0}%` }));
const ex = (on) => (on ? h("span", { class: "example", title: "Not on any board: shows a state the sample has no record of" }, "example") : null);

function toast(text, undo) {
  const t = $("toast");
  t.replaceChildren(...[text, undo ? h("button", { type: "button", style: "margin-left:10px;min-height:28px;padding:2px 10px", onclick: () => { undo(); t.hidden = true; render(); } }, "Undo") : null].filter(Boolean));
  t.hidden = false; t.dataset.ok = "true";
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 8000);
}

const waitCount = () => state.waits.length;

// ---------- Waiting on a run: any CI running anywhere (GitHub Actions in the sample) or the laptop's run slot (land, e2e) ----------

const mins = (iso) => Math.round((new Date(R.now.slice(0, 16)) - new Date(iso)) / 6e4);
const runFor = (iso) => dur(iso, R.now.slice(0, 16));
// Running long: half again its usual time (the median of the last runs of that workflow or slot label).
const isLong = (w) => mins(w.since) > w.usual * 1.5;
const waitShort = (w) => `${w.kind === "ci" ? "waiting on CI" : `waiting on a run (${w.label})`} · ${runFor(w.since)}`;
const runLink = (w) => (w.kind === "ci"
  ? h("a", { href: "#source", class: "run-link", title: `${w.source}: ${w.repo}, ${w.branch}. Opens the run on GitHub.` }, `${w.workflow} › ${w.job} #${w.run} ↗`)
  : h("span", { class: "run-link" }, `run slot on ${w.laptop}: `, h("b", null, w.label)));
function runLine(w, ex0) {
  return h("div", { class: `runw${isLong(w) ? " long" : ""}` }, h("i", { class: "ring", "aria-hidden": "true" }),
    h("span", null, h("b", null, w.kind === "ci" ? "Waiting on CI" : "Waiting on a run"), ` · ${runFor(w.since)} · `, runLink(w),
      h("span", { class: "muted" }, w.kind === "ci" ? ` · ${w.source}, ${w.repo} ${w.branch}` : ` · held by ${w.holder}: ${w.what}`),
      h("span", { class: "muted" }, ` · ${isLong(w) ? "running long, " : ""}usually about ${w.usual} min`), " ", ex(ex0)));
}

// Who works on what right now. A worker declares its session {feature, kind, label} and its tasks at spawn,
// so agent -> session -> tasks is known. Leads and consults declare no session: "Other work".
function working() {
  const out = [];
  for (const p of R.projects) for (const f of allFeatures(p.key)) for (const s of R.sessions[f.id] ?? [])
    if (s.state === "running") for (const a of s.agents ?? []) out.push({ ...a, tokens: agentTokens(f, s, a.name), p, f, s });
  for (const a of R.other ?? []) out.push({ ...a, p: proj(a.project), f: null, s: null, tasks: [] });
  return out;
}
const onTask = (fid, n) => working().filter((a) => a.f?.id === fid && a.tasks.includes(n));
const taskTitle = (fid, n) => { const b = R.projects.map((p) => S[p.key]).find((b) => b.feature === fid); return b?.tasks.find((t) => short(t.id) === n)?.title; };
const STATE_DOT = { working: "on", "waiting on you": "warn", "waiting on CI": "run", "waiting on a run": "run", idle: "" };
const stateText = (a) => (a.waitsOn ? waitShort(a.waitsOn) : a.state);
const agentChip = (a, withSession) => h("span", { class: "who", dataset: { state: a.state } },
  h("i", { class: `dot ${STATE_DOT[a.state] ?? ""}`, "aria-hidden": "true" }), h("b", null, a.name), ` ${a.role} · ${stateText(a)} · ${tok(a.tokens)} tokens`,
  withSession && a.s ? ` · ${a.s.label}` : "", " ", ex(a.example));

// ---------- Overview: what needs Casper, who is working on what, where each project stands ----------

function overview() {
  const ws = [...state.waits].sort((a, b) => a.since.localeCompare(b.since));
  const blocking = ws.filter((w) => w.blocking), rest = ws.length - blocking.length;
  const now = working();
  return [
    h("div", { class: "ov" },
      h("section", { class: "ov-needs" }, h("h2", null, "Needs you ", h("span", { class: "count" }, ws.length)),
        h("div", { class: "card" },
          blocking.length ? h("ul", { class: "lines" }, blocking.map((w) => h("li", { class: `hold${answerable(w) ? " can" : ""}` },
            badge(w.kind === "bug" ? "bug" : w.kind, KIND[w.kind]),
            h("a", { href: "#waits", class: "l-t" }, w.text),
            answerable(w) ? answerToggle(w, true) : null,
            h("span", { class: "l-m" }, `${proj(w.project).name}${w.feature ? ` · ${w.feature}` : ""} · holds up ${w.holds}`, " ", ex(w.example)),
            state.answering === w.id ? answerBox(w) : null)))
            : h("p", { class: "muted", style: "margin:0" }, "Nothing is held up by you."),
          h("a", { href: "#waits", class: "more" }, rest ? `${plural(blocking.length, "holds", "hold")} work up · ${rest} more when you have time →` : "Waits on you →"))),
      h("section", { class: "ov-now" }, h("h2", null, "Working now ", h("span", { class: "count" }, now.length)),
        now.length ? h("div", { class: "card" }, h("ul", { class: "lines now-list" }, now.map(nowLine)))
          : h("div", { class: "empty-card" }, "No agent is working.")),
      h("section", { class: "ov-proj" }, h("h2", null, "Projects"),
        h("div", { class: "plist" }, R.projects.map(projectRow)))),
  ];
}

function nowLine(a) {
  const n = a.tasks[0];
  return h("li", { dataset: { state: a.state } },
    h("span", { class: "l-who" }, h("i", { class: `dot ${STATE_DOT[a.state] ?? ""}`, "aria-hidden": "true" }), h("b", null, a.name), h("span", { class: "muted" }, ` ${a.role}`)),
    h("span", { class: "l-path" },
      h("span", { class: "muted" }, a.p.name, " › "),
      a.f ? [h("a", { class: "id", href: `#feature/${a.f.id}` }, a.f.id), h("span", { class: "muted" }, `${a.s.label} › `),
        a.tasks.map((t) => h("a", { href: `#feature/${a.f.id}`, class: "l-task", title: taskTitle(a.f.id, t) ?? "" }, h("span", { class: "id" }, t), taskTitle(a.f.id, t)?.replace(/^[^:]{0,40}:\s*/, "") ?? ""))]
        : h("span", { class: "muted", style: "font-style:italic" }, "Other work (no session)")),
    h("span", { class: "l-m" }, a.waitsOn ? h("span", { class: `l-run${isLong(a.waitsOn) ? " long" : ""}` }, `${waitShort(a.waitsOn)} · `)
      : a.state === "working" ? null : h("span", { style: "color:var(--warn)" }, `${a.state} · `), `${tok(a.tokens)} tokens`, " ", ex(a.example)),
    a.waitsOn ? h("span", { class: "l-runname" }, h("i", { class: "ring", "aria-hidden": "true" }), runLink(a.waitsOn)) : null);
}

function projectRow(p) {
  const fs = allFeatures(p.key);
  const open = fs.find(isOpen), ready = fs.find((f) => f.status === "Ready" && !isOpen(f));
  const rel = open?.rel ?? releases(p.key)[0];
  const relFs = rel.features, relDone = relFs.filter((f) => f.status === "Done").length;
  const its = items(p.key), bugs = its.filter(isBug).length, oldest = its.length ? Math.max(...its.map((d) => days(d.created))) : 0;
  const nx = open && R.next[open.id];
  const agents = open ? working().filter((a) => a.f?.id === open.id) : [];
  const cell = (label, ...kids) => h("div", { class: "pc" }, h("span", { class: "lab" }, label), ...kids);
  return h("div", { class: "card prow" },
    h("div", { class: "pc pname" }, h("a", { href: `#roadmap/${p.key}` }, p.name), h("span", { class: "muted" }, `${p.laptop} · lead ${p.lead} · PO ${p.po}`)),
    cell("Release", h("span", { class: "v" }, h("b", null, rel.title.split(" ")[0]), " ", rel.title.split(" ").slice(1).join(" ")),
      meter(relDone, relFs.length), h("span", { class: "muted" }, `${relDone} of ${relFs.length} features done`)),
    cell("Open now", open
      ? [h("a", { href: `#feature/${open.id}`, class: "v clamp" }, h("span", { class: "id" }, open.id), open.title),
         h("span", { class: "muted" }, `${open.ac[0]} of ${open.ac[1]} criteria · `,
           agents.length ? h("span", { style: "color:var(--ok)" }, `${agents.map((a) => a.name).join(", ")} on it`) : "nobody on it")]
      : h("span", { class: "muted" }, "no feature open")),
    cell("Next", nx ? h("a", { href: "#waits", class: "v", style: "color:var(--warn)" }, `Waits on you: ${nx.item.replace("#", " #")}`) : null,
      ready ? h("span", { class: "muted clamp" }, "Then Ready: ", h("span", { class: "id" }, ready.id), ready.title) : h("span", { class: "muted" }, "none Ready yet")),
    cell("Backlog", its.length ? [h("a", { href: `#triage/${p.key}`, class: "v" }, `${its.length} items`), h("span", { class: "muted" }, `${plural(bugs, "bug")} · oldest ${oldest} days`)]
      : h("span", { class: "muted" }, "nothing to triage")));
}

// ---------- Roadmap: one project's releases in order, each with its features in order ----------

function roadmap(key, edit) {
  const p = proj(key);
  const its = items(key);
  const rels = state.rel[key];
  return [
    h("div", { class: "bar-row" },
      h("span", { class: "seg" }, R.projects.map((q) => h("button", { type: "button", "aria-pressed": String(q.key === key), onclick: () => go(`roadmap/${q.key}${edit ? "/edit" : ""}`) }, q.name))),
      h("span", { class: "muted" }, `${p.laptop} · ${releases(key).length} releases · ${allFeatures(key).length} features`),
      h("button", { type: "button", class: edit ? "primary" : "", style: "margin-left:auto", onclick: () => go(`roadmap/${key}${edit ? "" : "/edit"}`) }, edit ? "Done" : "Edit your gates")),
    edit ? h("div", { class: "banner editing" }, h("b", null, "Your gates"), h("span", null, "Move a feature or backlog item into or out of a release, change the order of releases, close a release. Changes save as you make them, each with Undo, and go in the board's history as yours. Anything else is a request to ", p.po, ".")) : null,
    ...rels.filter((r) => !r.none || r.features.length).map((r, i) => releaseSection(key, r, i, edit, its)),
    h("p", { class: "note" }, `Order inside a release is ${p.po}'s; the order of releases is yours. A number in italics: the board has no order for it, so it follows the ordered ones by id. Criteria: acceptance criteria ticked, across the feature's tasks.`),
  ];
}

function releaseSection(key, r, i, edit, its) {
  const rels = releases(key);
  const fs = r.features, done = fs.filter((f) => f.status === "Done");
  const inRel = its.filter((d) => (r.none ? !d.milestone : d.milestone === r.id));
  const bugs = inRel.filter(isBug).length;
  const folded = done.length > 3 && !state.expanded.has(`${key}:${r.id}`);
  const rows = [];
  if (folded) rows.push(h("tr", { class: "fold" }, h("td", { colspan: edit ? 5 : 4, class: "full" },
    h("button", { type: "button", onclick: () => { state.expanded.add(`${key}:${r.id}`); render(); } }, `${done.length} done (${ranges(fs.flatMap((f, j) => (f.status === "Done" ? [j + 1] : [])))}): show them`))));
  fs.forEach((f, j) => { if (!(folded && f.status === "Done")) rows.push(featureRow(key, r, f, j + 1, edit)); });
  const relState = r.closed ? "closed" : fs.length && done.length === fs.length ? "all done" : fs.some(isOpen) ? "open" : "";
  return h("section", { class: "release", id: `rel-${r.id}` },
    h("div", { class: "rel-h" },
      r.none ? null : h("span", { class: "n" }, i + 1),
      h("b", null, r.title),
      relState ? badge(relState === "all done" ? "done" : relState, relState) : null,
      h("span", { class: "muted" }, r.none ? plural(fs.length, "feature") : `${done.length} of ${plural(fs.length, "feature")} done`),
      edit && !r.none ? h("span", { class: "gate" },
        h("button", { type: "button", disabled: i === 0 || null, "aria-label": `Move ${r.title} earlier`, onclick: () => moveRelease(key, r, -1) }, "↑ Earlier"),
        h("button", { type: "button", disabled: i === rels.length - 1 || null, "aria-label": `Move ${r.title} later`, onclick: () => moveRelease(key, r, 1) }, "↓ Later"),
        h("button", { type: "button", class: "danger", disabled: r.closed || null, onclick: () => closeRelease(key, r) }, "Close release")) : null),
    h("div", { class: "counts-line" },
      h("a", { href: `#triage/${key}` }, `${plural(inRel.length, "backlog item")}`),
      h("span", null, plural(bugs, "open bug")),
      inRel.length ? h("span", null, `oldest ${Math.max(...inRel.map((d) => days(d.created)))} days`) : null),
    fs.length ? h("div", { class: "table-wrap" }, h("table", { class: "stack" },
      h("thead", null, h("tr", null, h("th", null, "#  Feature"), h("th", null, "State"), h("th", null, "Criteria"), h("th", null, "Tasks"), edit ? h("th", null, "Release") : null)),
      h("tbody", null, rows))) : h("div", { class: "empty-card" }, "No features in this release yet."));
}

function featureRow(key, r, f, n, edit) {
  const st = fstate(f);
  const agents = (R.sessions[f.id] ?? []).filter((s) => s.state === "running").flatMap((s) => s.agents);
  const unticked = f.status === "Done" && f.ac[1] && f.ac[0] < f.ac[1];
  return h("tr", { class: `${st === "done" ? "done" : ""}${st === "open" ? " is-open" : ""}` },
    h("td", { class: "wide keep", "data-label": "" },
      h("span", { class: `ord${f.ordinal == null ? " unset" : ""}`, title: f.ordinal == null ? "No order on the board: after the ordered ones, by id" : `Order ${n}` }, r.none ? "·" : n),
      h("a", { class: "id", href: `#feature/${f.id}` }, f.id), h("span", { class: "title" }, f.title),
      agents.length ? h("div", { class: "now" }, `● ${agents.map((a) => a.name).join(", ")} on it now`) : null,
      st === "open" && !agents.length ? h("div", { class: "now", style: "color:var(--muted)" }, "open · nobody on it now") : null),
    h("td", { "data-label": "State" }, badge(st), unticked ? h("div", { class: "sub-note" }, "Done, criteria not ticked") : null),
    h("td", { "data-label": "Criteria" }, f.ac[1] ? h("div", { class: "crit" }, meter(f.ac[0], f.ac[1], st === "done" ? "idle" : "ok"), h("span", { class: "m" }, `${f.ac[0]} of ${f.ac[1]}`)) : h("span", { class: "muted" }, "none yet")),
    h("td", { "data-label": "Tasks", class: "num", style: "text-align:left" }, f.tasks ? `${f.tasksDone} of ${f.tasks} done` : h("span", { class: "muted" }, "none yet")),
    edit ? h("td", { "data-label": "Release" }, h("select", { class: "move", "aria-label": `Release of ${f.id}`, onchange: (e) => moveFeature(key, f.id, e.target.value) },
      state.rel[key].filter((x) => !x.closed || x.id === r.id).map((x) => h("option", { value: x.id, selected: x.id === r.id || null }, x.none ? "No release" : x.title)))) : null);
}

// ---------- Casper's gates ----------

const snapshot = (key) => JSON.parse(JSON.stringify(state.rel[key]));
function moveFeature(key, id, to) {
  const before = snapshot(key);
  const from = state.rel[key].find((r) => r.features.some((f) => f.id === id));
  const f = from.features.find((x) => x.id === id);
  from.features = from.features.filter((x) => x.id !== id);
  const dest = state.rel[key].find((r) => r.id === to);
  dest.features.push(f);
  render();
  toast(`Moved ${id} to ${dest.none ? "no release" : dest.title}, last in its order (${proj(key).po} orders it). Recorded as yours.`, () => (state.rel[key] = before));
}
function moveRelease(key, r, d) {
  const before = snapshot(key);
  const list = state.rel[key], i = list.indexOf(r);
  [list[i], list[i + d]] = [list[i + d], list[i]];
  render();
  toast(`${r.title} is now release ${i + d + 1}.`, () => (state.rel[key] = before));
}
function closeRelease(key, r) {
  const open = r.features.filter((f) => f.status !== "Done");
  const others = state.rel[key].filter((x) => x !== r && !x.closed);
  const later = releases(key).slice(releases(key).indexOf(r) + 1).find((x) => !x.closed);
  const dlg = $("confirm");
  const finish = () => {
    const before = snapshot(key);
    for (const f of open) {
      const to = dlg.querySelector(`select[data-id="${f.id}"]`).value;
      r.features = r.features.filter((x) => x.id !== f.id);
      state.rel[key].find((x) => x.id === to).features.push(f);
    }
    r.closed = true;
    dlg.close(); render();
    toast(`Closed ${r.title}${open.length ? `; ${plural(open.length, "open feature")} moved` : ""}.`, () => (state.rel[key] = before));
  };
  dlg.replaceChildren(h("form", { method: "dialog", onsubmit: (e) => { e.preventDefault(); finish(); } },
    h("h2", { id: "confirm-h" }, `Close ${r.title}?`),
    open.length
      ? [h("p", { style: "margin:0;font-size:14px" }, `${plural(open.length, "feature")} in it ${open.length === 1 ? "isn't" : "aren't"} done. Each goes where you pick:`),
         h("ul", { class: "dest" }, open.map((f) => h("li", null,
           h("span", null, h("span", { class: "id" }, f.id), f.title.length > 60 ? `${f.title.slice(0, 60)}…` : f.title, " ", badge(fstate(f))),
           h("select", { "data-id": f.id, "aria-label": `Where ${f.id} goes` }, others.map((x) => h("option", { value: x.id, selected: x === (later ?? state.rel[key].at(-1)) || null }, x.none ? "Out of any release" : `To ${x.title}`))))))]
      : h("p", { style: "margin:0;font-size:14px" }, `Every feature in it is done. Closing it records that ${r.title} is finished; it stays on the roadmap, folded.`),
    h("div", { class: "foot" }, h("button", { type: "button", onclick: () => dlg.close() }, "Cancel"), h("button", { type: "submit", class: "danger" }, `Close ${r.title.split(" ")[0]}`))));
  dlg.showModal();
}

// ---------- Steps view: a feature opened ----------

function feature(id) {
  const hit = findFeature(id);
  if (!hit) return [h("div", { class: "empty-card" }, `No feature ${id}.`)];
  const { p, f } = hit;
  const b = S[p.key], ss = R.sessions[id] ?? [], nx = R.next[id];
  const live = ss.filter((s) => s.state === "running");
  const liveSt = new Map(live.flatMap((s) => s.moved));
  // A task an agent is on shows In Progress (the sample's board predates the example session).
  const tasks = (b.feature === id ? b.tasks : []).map((t) => (liveSt.has(short(t.id)) ? { ...t, status: liveSt.get(short(t.id)) } : t));
  const byShort = new Map(tasks.map((t) => [short(t.id), t]));
  const inSession = new Set(ss.flatMap((s) => s.moved.map((m) => m[0])));
  const loose = tasks.filter((t) => !inSession.has(short(t.id)));
  const agents = working().filter((a) => a.f?.id === id);
  const pickable = R.projects.flatMap((q) => allFeatures(q.key).filter((x) => x.status !== "Done" && (R.sessions[x.id] || x.status === "Ready")));
  const wait = nx && state.waits.find((w) => w.id === nx.item);
  return [
    h("div", { class: "bar-row" },
      h("label", { for: "feat-pick", class: "muted" }, "Feature"),
      h("select", { id: "feat-pick", onchange: (e) => go(`feature/${e.target.value}`) }, pickable.map((x) => h("option", { value: x.id, selected: x.id === id || null }, `${x.id} · ${x.title.slice(0, 60)}`)))),
    h("div", { class: "feat" },
      h("div", { class: "card feat-h" },
        h("div", { class: "facts" }, h("span", { class: "id" }, f.id), h("span", null, `${p.name} · ${f.rel.title} · #${f.n}`), badge(fstate(f))),
        h("div", { class: "title" }, f.title),
        h("div", { class: "facts" }, meter(f.ac[0], f.ac[1]), h("span", null, `${f.ac[0]} of ${f.ac[1]} criteria`), h("span", null, `${f.tasksDone} of ${f.tasks} tasks done`),
          h("span", null, `${plural(ss.length, "session")}`), h("span", { style: agents.length ? "color:var(--ok)" : "" }, agents.length ? `${plural(agents.length, "agent")} on it now` : "nobody on it now"))),
      agents.length ? h("section", { class: "card on-now" }, h("h2", { style: "margin:0" }, "On it now"),
        h("ul", { class: "lines" }, agents.map((a) => h("li", null, agentChip(a, false), h("span", { class: "l-m" }, `${a.s.label} › `,
          a.tasks.map((n) => [h("span", { class: "id" }, n), taskTitle(id, n) ?? ""])), a.waitsOn ? runLine(a.waitsOn) : null)))) : null,
      wait ? h("a", { href: "#next", class: "banner", style: "text-decoration:none;color:inherit" }, h("b", { style: "color:var(--warn)" }, "Next: waits on you"), h("span", null, `${wait.id.replace("#", " #")} · ${wait.text}`)) : null,
      h("div", { class: "two" },
        h("section", null, h("h2", null, "Sessions, in the order they ran"),
          ss.length ? h("ol", { class: "steps" }, ss.map((s, i) => stepItem(p, f, s, ss, byShort, i === ss.length - 1)), nextItem(nx, wait))
            : h("div", { class: "empty-card" }, "No session has run on this feature yet. Next: a design session, once it is Ready.")),
        h("aside", null, h("h2", null, "Tasks ", h("span", { class: "count" }, tasks.length)),
          loose.length ? h("div", { class: "card", style: "margin-bottom:10px" }, h("div", { class: "muted" }, "In no session yet"), h("ul", { class: "tasks" }, loose.map((t) => taskLi(t, t.status, onTask(id, short(t.id)), true)))) : null,
          h("details", { class: "card", open: innerWidth >= 1100 || null }, h("summary", { style: "margin:0" }, `All ${tasks.length}, as the board has them now`), h("ul", { class: "tasks" }, tasks.map((t) => taskLi(t, t.status, onTask(id, short(t.id)), true))))))),
  ];
}

function taskLi(t, st, on = [], withSession = false) {
  return h("li", { class: on.length ? "on" : null }, h("span", { class: "id" }, short(t.id)), h("span", { class: "tt", title: t.title }, t.title),
    badge(st === "In Review" ? "in review" : st === "In Progress" ? "running" : st.toLowerCase(), st), h("span", { class: "ac" }, t.ac[1] ? `${t.ac[0]}/${t.ac[1]}` : "–"),
    on.length ? h("span", { class: "on-it" }, on.map((a) => agentChip(a, withSession))) : null);
}

function stepItem(p, f, s, ss, byShort, last) {
  const helix = p.key === "helix";
  const live = s.state === "running";
  const moved = s.moved.map(([n, st]) => { const t = byShort.get(n); return t ? taskLi(t, st, live ? (s.agents ?? []).filter((a) => a.tasks.includes(n)).map((a) => ({ ...a, tokens: agentTokens(f, s, a.name), s })) : []) : null; });
  const closedN = s.moved.filter((m) => m[1] === "Done").length;
  return h("li", { class: "step", dataset: { kind: s.kind, state: s.state } }, h("span", { class: "dot2", "aria-hidden": "true" }),
    h("div", { class: "card" },
      h("div", { class: "top" }, h("span", { class: "kind" }, s.kind), h("b", null, s.label), h("span", { class: "when" }, span(s.start, s.end)), ex(s.example), badge(s.state)),
      s.state === "closed" ? h("div", { class: "outcome" },
        h("span", { class: "need", dataset: { need: s.need } }, `need: ${s.need}`, s.needs.length ? ` (${s.needs.join(", ")})` : ""),
        h("span", null, `${plural(s.blockers, "blocker")} · ${plural(s.majors, "major")}`),
        s.minors ? h("span", null, `${s.minors} minors, fixed`) : null, s.back ? h("span", null, `${s.back} sent back`) : null,
        h("span", null, closedN ? `closed ${plural(closedN, "task")}` : `moved ${plural(s.moved.length, "task")}`),
        h("span", { class: "muted" }, `${tok(sessionTokens(f, s))} tokens`, " ", ex(true))) : null,
      (s.agents ?? []).map((a) => h("div", { class: "agent", dataset: { state: a.state } }, h("b", null, a.name, " ", h("span", { class: "muted" }, `${a.role} · ${a.waitsOn ? (a.waitsOn.kind === "ci" ? "waiting on CI" : "waiting on a run") : a.state}${a.tasks?.length ? ` · on ${a.tasks.join(", ")}` : ""}`), " ", ex(a.example)),
        a.waitsOn ? runLine(a.waitsOn) : null, h("span", { class: "d" }, a.checkpoint),
        h("span", { class: "d" }, `${a.model} · ${a.laptop} · ${dur(s.start, R.now.slice(0, 16))} · ${tok(agentTokens(f, s, a.name))} tokens · context ${tok(a.ctx)}`))),
      h("div", { class: "sub" }, s.summary),
      h("div", { class: "links" },
        s.handoff ? h("a", { href: "#source", title: helix ? `~/.local/state/bobnet/handoffs/helix/${s.handoff}` : s.handoff }, "Handoff") : h("span", { class: "off" }, "No handoff file"),
        s.commit ? h("a", { href: "#source", title: `helix-navigator-picard ${s.commit}` }, `Close ${s.commit.slice(0, 7)}`) : null,
        s.rc ? h("a", { href: "#source" }, "Remote Control") : h("span", { class: "off" }, s.state === "running" ? "No Remote Control" : ""),
        ctxToggle(f, s)),
      state.ctx.has(ctxKey(f, s)) ? ctxPanel(f, s, ss) : null,
      moved.length ? h("details", { open: last || null }, h("summary", null, live ? `Tasks it is on (${moved.length})` : `Tasks it moved (${moved.length})`), h("ul", { class: "tasks" }, moved)) : null));
}

function nextItem(nx, wait) {
  if (!nx) return null;
  return h("li", { class: "step next", id: "next" }, h("span", { class: "dot2", "aria-hidden": "true" }),
    h("div", { class: "card" },
      h("div", { class: "top" }, h("span", { class: "kind", style: "color:var(--warn)" }, "Next"), h("b", null, "Waits on you")),
      wait ? h("div", null, h("a", { class: "id", href: "#waits" }, wait.id.replace("#", " #")), h("b", null, wait.text)) : null,
      wait?.rec ? h("div", { class: "sub" }, "Recommended: ", wait.rec) : null,
      h("div", { class: "sub" }, "Then: ", nx.then)));
}

// ---------- Context per call, inside a session (today's Usage chart, moved onto each session card) ----------
// No usage record was sampled: every run below is example data, made up from a seed so it is the same on each load.
// In the service a session's runs are the workers that declared it at spawn, each with its calls' context sizes.

function rng(seed) {
  let a = [...seed].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 2654435761) >>> 0, 7);
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function genCtx(seed, n, end) {
  const r = rng(`${seed}:ctx`), pts = [];
  let v = 14000 + r() * 8000;
  for (let i = 0; i < n; i++) { v += 250 + r() * 2000 + (r() < 0.06 ? 5000 + r() * 12000 : 0); pts.push(Math.round(Math.min(v, 165000))); }
  return end ? pts.map((x) => Math.round((x * end) / pts.at(-1))) : pts;
}
const CREW = {
  design: [["Calvin", "designer", 2], ["Riker", "architect", 1]],
  build: [["Howard", "engineer", 3], ["Homer", "engineer", 2], ["Marvin", "tester", 2]],
  review: [["Luke", "reviewer", 2], ["Calvin", "designer", 1], ["Marvin", "tester", 1]],
};
const ctxKey = (f, s) => `${f.id}:${s.label}`;
const runsCache = new Map();
function sessionRuns(f, s) {
  const key = ctxKey(f, s);
  if (runsCache.has(key)) return runsCache.get(key);
  const small = /^Fixes/.test(s.label) ? 0.5 : 1;
  const crew = s.agents ? s.agents.map((a) => [a.name, a.role, a.name === "Marvin" ? 2 : 1, a]) : CREW[s.kind] ?? [];
  const out = [];
  crew.forEach(([name, role, nRuns, live], ci) => {
    for (let k = 0; k < nRuns; k++) {
      const seed = `${key}:${name}:${k}`, r = rng(seed), now = live && k === nRuns - 1;
      const n = now ? Math.round(32 + r() * 22) : Math.round((50 + r() * 110) * small);
      out.push({ id: seed, name, role, model: live?.model ?? "Opus 5.5", laptop: live?.laptop ?? "mbp-1", ctx: genCtx(seed, n, now ? live.ctx : null), order: k * 10 + ci });
    }
  });
  out.sort((a, b) => a.order - b.order);
  runsCache.set(key, out);
  return out;
}
// A run's tokens: every call reads its context (cache reads included), plus what it writes.
const runTokens = (r) => r.ctx.reduce((n, v) => n + v, 0) + r.ctx.length * 700;
const agentTokens = (f, s, name) => sessionRuns(f, s).filter((r) => r.name === name).reduce((n, r) => n + runTokens(r), 0);
const sessionTokens = (f, s) => sessionRuns(f, s).reduce((n, r) => n + runTokens(r), 0);

/** One agent's runs as one line: the call count carries on, and each new worker starts from a small context again. */
function roleLine(runs) {
  const pts = [], resets = [];
  for (const r of runs) { if (pts.length) resets.push({ at: pts.length + 1 }); pts.push(...r.ctx); }
  return { pts, resets };
}
const quantile = (xs, q) => { const v = [...xs].sort((a, c) => a - c); const i = (v.length - 1) * q; return v[Math.floor(i)] + (v[Math.ceil(i)] - v[Math.floor(i)]) * (i % 1); };
/** The middle half and median of earlier runs at each call, while at least three runs reach it. */
function bandOf(runs) {
  const out = [];
  for (let i = 0; ; i++) { const xs = runs.filter((c) => c.length > i).map((c) => c[i]); if (xs.length < 3) break; out.push([quantile(xs, 0.25), quantile(xs, 0.5), quantile(xs, 0.75)]); }
  return out.length ? out : null;
}
function niceStep(max, n = 4) { const step0 = max / n, mag = 10 ** Math.floor(Math.log10(step0 || 1)); return [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= step0); }
const sv = (tag, attrs, ...kids) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
};
// Charts are drawn once their box is on the page, at its width, so their text stays at its set size.
const later = [];

function ctxToggle(f, s) {
  const open = state.ctx.has(ctxKey(f, s));
  const calls = sessionRuns(f, s).reduce((n, r) => n + r.ctx.length, 0);
  return h("button", { type: "button", class: "ctx-btn", "aria-expanded": String(open), onclick: () => { open ? state.ctx.delete(ctxKey(f, s)) : state.ctx.set(ctxKey(f, s), {}); render(); } },
    `Context per call · ${calls} calls`, h("span", { class: "chev", "aria-hidden": "true" }, open ? "▴" : "▾"));
}

function ctxSeries(f, s, ss, agent) {
  const runs = sessionRuns(f, s);
  const prev = ss.slice(0, ss.indexOf(s)).reverse().find((x) => x.kind === s.kind);
  const prevRuns = prev ? sessionRuns(f, prev) : [];
  const live = s.state === "running";
  if (!agent) {
    const cum = (rs) => { let t = 0; return rs.flatMap((r) => r.ctx).map((v) => (t += v)); };
    return {
      series: [{ name: `${s.label}${live ? " so far" : ""}`, pts: cum(runs), color: "var(--accent)", style: "solid", w: 2.5 },
        prev ? { name: prev.label, pts: cum(prevRuns), color: "var(--muted)", style: "dash", w: 2 } : null].filter(Boolean),
      band: null, cum: true,
      note: `Every call in the session, in order, across all its agents, with its context summed: where the line ends is the session's tokens read. A steeper line means each call carries more context.${prev ? ` Dashed: ${prev.label}, ${f.id}'s ${s.kind} before it.` : ""}`,
    };
  }
  const mine = runs.filter((r) => r.name === agent), role = mine[0]?.role;
  const now = roleLine(mine), pr = roleLine(prevRuns.filter((r) => r.role === role));
  const earlier = ss.filter((x) => x !== s && x.state === "closed").flatMap((x) => sessionRuns(f, x)).filter((r) => r.role === role);
  const band = bandOf(earlier.map((r) => r.ctx));
  return {
    series: [{ name: `${agent}${live ? ", now" : ""}`, pts: now.pts, resets: now.resets, color: "var(--accent)", style: "solid", w: 2.5 },
      pr.pts.length ? { name: `${role}s, ${prev.label}`, pts: pr.pts, resets: pr.resets, color: "var(--muted)", style: "dash", w: 2 } : null].filter(Boolean),
    band,
    note: `${agent}'s runs in ${s.label}, one after another. The count of calls carries on; a new worker starts again from a small context, so the line drops there (dotted).${band ? ` The grey band is the middle half of ${earlier.length} earlier ${role} runs on ${f.id} at the same call, the line in it their median.` : ""}`,
  };
}

function drawCtx(wrap, holder, { series, band }, W) {
  const H = W < 500 ? 220 : 250, L = 46, R = W < 500 ? 12 : 120, T = 14, B = 28;
  const xMax = Math.max(10, ...series.map((x) => x.pts.length), band?.length ?? 0);
  const yMax0 = Math.max(1, ...series.flatMap((x) => x.pts), ...(band ?? []).map((x) => x[2]));
  const step = niceStep(yMax0), yMax = Math.ceil(yMax0 / step) * step;
  const yt = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const xs = niceStep(xMax, W < 500 ? 4 : 6), xt = Array.from({ length: Math.floor(xMax / xs) + 1 }, (_, i) => i * xs);
  const x = (i) => L + (i / xMax) * (W - L - R), y = (v) => T + (1 - v / yMax) * (H - T - B);
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Context size per call" });
  svg.append(sv("g", { class: "grid" }, yt.map((v) => sv("line", { x1: L, x2: W - R, y1: y(v), y2: y(v) }))));
  svg.append(sv("g", { class: "axis" }, yt.map((v) => sv("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, tok(v))), xt.map((v) => sv("text", { x: x(v), y: H - 8, "text-anchor": "middle" }, String(v))), sv("text", { x: W - R, y: H - 8, dx: R > 40 ? 6 : -2, "text-anchor": R > 40 ? "start" : "end" }, R > 40 ? "calls" : "")));
  if (band) {
    svg.append(sv("polygon", { points: [...band.map((q, i) => `${x(i + 1)},${y(q[2])}`), ...band.map((q, i) => `${x(i + 1)},${y(q[0])}`).reverse()].join(" "), fill: "var(--idle)", "fill-opacity": 0.18 }));
    svg.append(sv("polyline", { points: band.map((q, i) => `${x(i + 1)},${y(q[1])}`).join(" "), fill: "none", stroke: "var(--idle)", "stroke-width": 1.5 }));
  }
  const dash = { solid: null, dash: "6 4", dot: "1.5 4" }, labels = [];
  for (const sr of series) {
    if (!sr.pts.length) continue;
    // An agent's line breaks at each new worker, so the drop reads as a restart, not a fall.
    const cuts = [0, ...(sr.resets ?? []).map((r) => r.at - 1), sr.pts.length];
    for (let k = 0; k < cuts.length - 1; k++) svg.append(sv("polyline", { points: sr.pts.slice(cuts[k], cuts[k + 1]).map((v, j) => `${x(cuts[k] + j + 1)},${y(v)}`).join(" "), fill: "none", stroke: sr.color, "stroke-width": sr.w, "stroke-dasharray": dash[sr.style], "stroke-linejoin": "round", "stroke-linecap": "round" }));
    for (const r of sr.resets ?? []) svg.append(sv("line", { x1: x(r.at - 0.5), x2: x(r.at - 0.5), y1: T, y2: H - B, stroke: sr.color, "stroke-width": 1, "stroke-dasharray": "2 3", "stroke-opacity": 0.6 }));
    labels.push({ y: y(sr.pts.at(-1)), x: x(sr.pts.length), text: sr.name, m: sr.style !== "solid" });
  }
  // Direct labels at line ends on a wide chart; on a phone the key carries them.
  if (R > 60) {
    labels.sort((a, c) => a.y - c.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    for (const l of labels) svg.append(sv("text", { class: `lab${l.m ? " m" : ""}`, x: l.x + 6, y: l.y + 4 }, l.text));
  }
  const cross = sv("line", { y1: T, y2: H - B, stroke: "var(--muted)", "stroke-width": 1, visibility: "hidden" });
  const hit = sv("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" });
  svg.append(cross, hit);
  const tip = wrap.querySelector(".tip");
  const leave = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
  const move = (ev) => {
    const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * xMax);
    if (i < 1 || i > xMax) return leave();
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    const rows = series.filter((sr) => sr.pts.length >= i).map((sr) => [sr, sr.pts[i - 1]]).sort((a, c) => c[1] - a[1]);
    tip.replaceChildren(h("b", null, `Call ${i}`), ...rows.map(([sr, v]) => h("div", { class: "row" }, h("span", null, h("i", { class: sr.style === "solid" ? "" : "dash", style: `--k:${sr.color}` }), sr.name), h("span", null, tok(v)))),
      band?.[i - 1] ? h("div", { class: "row muted" }, h("span", null, "earlier runs, median"), h("span", null, tok(band[i - 1][1]))) : null);
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    tip.style.left = `${Math.max(4, Math.min(ev.clientX - wr.left + 14, wr.width - 200))}px`;
    tip.style.top = `${ev.clientY - wr.top + 10}px`;
  };
  hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move); hit.addEventListener("pointerleave", leave);
  holder.replaceChildren(svg);
}

function ctxPanel(f, s, ss) {
  const key = ctxKey(f, s), view = state.ctx.get(key);
  const runs = sessionRuns(f, s), names = [...new Set(runs.map((r) => r.name))];
  const data = ctxSeries(f, s, ss, view.agent);
  const set = (agent) => { state.ctx.set(key, { agent }); render(); };
  const sum = (rs, fn) => rs.reduce((n, r) => n + fn(r), 0);
  const rows = names.map((n) => [n, runs.filter((r) => r.name === n)]).sort((a, c) => sum(c[1], runTokens) - sum(a[1], runTokens));
  const rmax = sum(rows[0][1], runTokens);
  const holder = h("div", { class: "plot" });
  const wrap = h("div", { class: "chart" },
    h("div", { class: "bar-row", style: "margin:0" },
      h("span", { class: "seg" }, h("button", { type: "button", "aria-pressed": String(!view.agent), onclick: () => set(null) }, "Whole session"),
        names.map((n) => h("button", { type: "button", "aria-pressed": String(view.agent === n), onclick: () => set(n) }, n))),
      ex(true)),
    holder,
    h("div", { class: "key" }, data.series.map((sr) => h("span", null, h("i", { class: sr.style === "solid" ? "" : sr.style, style: `--k:${sr.color}` }), `${sr.name} · ${sr.pts.length} calls${data.cum ? ` · ${tok(sr.pts.at(-1))}` : ""}`)),
      data.band ? h("span", null, h("i", { class: "band", style: "--k:var(--idle)" }), "earlier runs, middle half and median") : null,
      data.series.some((sr) => sr.resets?.length) ? h("span", null, h("i", { class: "dot", style: "--k:var(--muted)" }), "a new worker starts") : null),
    h("div", { class: "note", style: "margin:0" }, data.note),
    h("div", { class: "tip", hidden: true }));
  later.push(() => drawCtx(wrap, holder, data, Math.max(260, Math.min(760, holder.clientWidth))));
  return h("div", { class: "ctxp" }, wrap,
    h("div", { class: "table-wrap" }, h("table", { class: "stack ctx-agents" },
      h("thead", null, h("tr", null, h("th", null, "Agent"), h("th", null, "Model"), h("th", { class: "num" }, "Runs"), h("th", { class: "num" }, "Calls"), h("th", { class: "num" }, "Peak context"), h("th", null, ""), h("th", { class: "num" }, "Tokens"))),
      h("tbody", null, rows.map(([n, rs]) => h("tr", { class: "pick", tabindex: "0", "aria-selected": String(view.agent === n), title: "Show its context per call", onclick: () => set(n), onkeydown: (e) => e.key === "Enter" && set(n) },
        h("td", null, h("b", null, n), h("div", { class: "cp" }, `${rs[0].role} · ${rs[0].laptop}`)),
        h("td", { "data-label": "Model" }, rs[0].model),
        h("td", { class: "num", "data-label": "Runs" }, rs.length),
        h("td", { class: "num", "data-label": "Calls" }, sum(rs, (r) => r.ctx.length)),
        h("td", { class: "num", "data-label": "Peak context" }, tok(Math.max(...rs.flatMap((r) => r.ctx)))),
        h("td", { class: "full bar" }, h("div", { class: "meter" }, h("i", { style: `width:${(sum(rs, runTokens) / rmax) * 100}%` }))),
        h("td", { class: "num", "data-label": "Tokens" }, tok(sum(rs, runTokens))))),
        h("tr", { class: "total" }, h("td", null, h("b", null, "Session")), h("td", { "data-label": "" }), h("td", { class: "num", "data-label": "Runs" }, runs.length),
          h("td", { class: "num", "data-label": "Calls" }, sum(runs, (r) => r.ctx.length)), h("td", { class: "num", "data-label": "Peak context" }, tok(Math.max(...runs.flatMap((r) => r.ctx)))), h("td", { class: "full bar" }),
          h("td", { class: "num", "data-label": "Tokens" }, h("b", null, tok(sum(runs, runTokens)))))))),
    h("p", { class: "note", style: "margin:0" }, "Pick an agent, above or in the table, to see its own line. Tokens count everything a run read and wrote, cache reads included."));
}

// ---------- What waits on Casper ----------

const KIND = { question: "question", action: "action", review: "review gate", permission: "permission", bug: "bug · blocks use" };
function waitItem(w) {
  const p = proj(w.project);
  return h("li", { "data-tier": w.blocking ? "human" : null, dataset: { blocking: String(w.blocking) } },
    h("div", { class: "top" }, badge(w.kind === "bug" ? "bug" : w.kind, KIND[w.kind]), h("span", { class: "id" }, w.id.replace("#", " #").replace(/^(BUG|PERM)$/, "")),
      h("span", { class: "muted" }, p.name, w.feature ? [" · ", h("a", { href: `#feature/${w.feature}` }, w.feature)] : ""), ex(w.example),
      h("span", { class: "age" }, age(w.since))),
    h("div", { class: "q" }, w.text),
    h("div", { class: "meta" },
      w.rec ? h("span", null, w.kind === "question" ? "Recommended: " : "", w.rec) : null,
      w.holds ? h("span", { style: "color:var(--bad)" }, `Holds up ${w.holds}`) : null,
      w.before ? h("span", null, `Needed before ${w.before}`) : null,
      h("span", null, `from ${w.from}`),
      w.session ? h("span", null, w.session) : null,
      h("a", { href: "#source" }, w.kind === "question" || w.kind === "action" ? "Open in lead/questions.md" : w.kind === "permission" ? "Open in the supervisor" : "Open"),
      answerable(w) && state.answering !== w.id ? answerToggle(w) : null),
    state.answering === w.id ? answerBox(w) : null);
}

// ---------- Answering from the dashboard: a question, an action done, a permission ----------

const answerable = (w) => ["question", "action", "permission"].includes(w.kind);
const ANSWER_VERB = { question: "Answer", action: "Mark done", permission: "Allow or deny" };
const answerToggle = (w, small) => h("button", { type: "button", class: `answer-btn${small ? " small" : ""}`, "aria-expanded": String(state.answering === w.id),
  onclick: () => { state.answering = state.answering === w.id ? null : w.id; render(); $(`ans-${w.id}`)?.querySelector("input, textarea")?.focus(); } },
  state.answering === w.id ? "Close" : ANSWER_VERB[w.kind]);

function answerBox(w) {
  const p = proj(w.project);
  // Who hears of it: a question or action goes to the project's lead; a permission to the agent that asked.
  const to = w.kind === "permission" ? `${w.from}` : `${p.lead}, ${p.name}'s lead`;
  const close = () => { state.answering = null; render(); };
  const form = h("form", { class: "answer", id: `ans-${w.id}`, onsubmit: (e) => { e.preventDefault(); send(e.submitter?.value); } });
  const words = () => form.querySelector("textarea").value.trim();
  const picked = () => { const r = form.querySelector("input[type=radio]:checked"); return r ? w.options.find((o) => o.k === r.value) : null; };
  const sendBtn = () => form.querySelector("button[type=submit]");
  const check = () => { if (w.kind === "question") sendBtn().disabled = !(picked() || words()); };
  function send(verdict) {
    const o = picked(), text = words();
    const answer = w.kind === "question" ? { option: o?.text ?? null, words: text } : w.kind === "action" ? { option: "Done", words: text } : { option: verdict === "deny" ? "Denied" : "Allowed", words: text };
    const before = [...state.waits];
    state.waits = state.waits.filter((x) => x.id !== w.id);
    state.answered.unshift({ ...w, answer, at: R.now, to });
    state.answering = null;
    render();
    toast(`${w.kind === "question" ? "Answered" : w.kind === "action" ? "Marked done:" : answer.option} ${w.id === "PERM" ? `${w.from}'s request` : w.id}. Recorded as your words; ${to} got a message.`,
      () => { state.waits = before; state.answered = state.answered.filter((x) => x.id !== w.id); });
  }
  const foot = (...btns) => h("div", { class: "foot" }, h("span", { class: "who-gets" }, w.kind === "permission" ? `${w.from} gets your decision and note.` : `Recorded on ${w.id} as yours, word for word; ${to} gets a message.`),
    h("button", { type: "button", onclick: close }, "Cancel"), ...btns);
  if (w.kind === "question") {
    form.append(
      h("fieldset", null, h("legend", null, "Pick one"),
        (w.options ?? []).map((o) => h("label", { class: `opt-row${o.rec ? " rec" : ""}` }, h("input", { type: "radio", name: `o-${w.id}`, value: o.k, onchange: check }),
          h("span", null, o.text, o.rec ? h("span", { class: "rec-tag" }, "recommended") : null)))),
      h("label", { class: "words" }, h("span", null, w.options?.length ? "Your words (optional with an option; enough on their own)" : "Your answer"),
        h("textarea", { rows: 2, oninput: check, placeholder: "Write what you want them to read." })),
      foot(h("button", { type: "submit", class: "primary", disabled: true }, "Send answer")));
  } else if (w.kind === "action") {
    form.append(h("label", { class: "words" }, h("span", null, "Note (optional)"), h("textarea", { rows: 2, placeholder: "Anything they should know, e.g. which app worked." })),
      foot(h("button", { type: "submit", class: "primary" }, "Mark done")));
  } else {
    form.append(h("label", { class: "words" }, h("span", null, `Note to ${w.from} (optional)`), h("textarea", { rows: 2, placeholder: "e.g. go ahead, it's idle" })),
      foot(h("button", { type: "submit", class: "danger", value: "deny" }, "Deny"), h("button", { type: "submit", class: "primary", value: "allow" }, "Allow")));
  }
  return form;
}

function answeredItem(w) {
  const a = w.answer;
  return h("li", { class: "answered" },
    h("div", { class: "top" }, badge("done", w.kind === "permission" ? a.option.toLowerCase() : w.kind === "action" ? "done" : "answered"), h("span", { class: "id" }, w.id.replace(/^PERM$/, "")),
      h("span", { class: "muted" }, proj(w.project).name, w.feature ? ` · ${w.feature}` : ""), h("span", { class: "age" }, `today ${hm(w.at)}`)),
    h("div", { class: "q" }, w.text),
    h("div", { class: "said" }, a.option && w.kind === "question" ? h("div", null, h("span", { class: "muted" }, "You picked "), a.option) : null,
      a.words ? h("blockquote", null, `“${a.words}”`) : null),
    h("div", { class: "meta" }, h("span", null, `${w.to} got a message`), h("span", null, "from the dashboard")));
}

function waits() {
  const ws = state.waits.filter((w) => state.waitsProj === "all" || w.project === state.waitsProj)
    .sort((a, b) => a.since.localeCompare(b.since));
  const blocking = ws.filter((w) => w.blocking), rest = ws.filter((w) => !w.blocking);
  const pick = (v, label) => h("button", { type: "button", "aria-pressed": String(state.waitsProj === v), onclick: () => { state.waitsProj = v; render(); } }, label);
  return [
    h("div", { class: "bar-row" }, h("span", { class: "seg" }, pick("all", "All projects"), R.projects.map((p) => pick(p.key, `${p.name} ${state.waits.filter((w) => w.project === p.key).length}`))),
      h("span", { class: "muted" }, `${plural(ws.length, "item")}, oldest first`)),
    h("section", null, h("h2", null, "Holds work up ", h("span", { class: "count" }, blocking.length)),
      blocking.length ? h("ul", { class: "list waits" }, blocking.map(waitItem)) : h("div", { class: "empty-card" }, "Nothing is held up by you.")),
    h("section", null, h("h2", null, "When you have time ", h("span", { class: "count" }, rest.length)),
      rest.length ? h("ul", { class: "list waits" }, rest.map(waitItem)) : h("div", { class: "empty-card" }, "Nothing else waits on you.")),
    state.answered.length ? h("section", null, h("h2", null, "Answered from here today ", h("span", { class: "count" }, state.answered.length)),
      h("ul", { class: "list waits" }, state.answered.map(answeredItem))) : null,
    h("p", { class: "note" }, "Answer a question, mark an action done or allow a permission right here; you can still answer in the project's conversation or its files. Your answer is kept on the item word for word and the project's lead gets a message; the item leaves the list. A session that closed with need: casper shows on the question it waits for."),
  ];
}

// ---------- Triage: a project's backlog items, bugs among them ----------

function triage(key, edit) {
  const p = proj(key), b = S[key];
  const all = items(key);
  const rels = releases(key);
  const f = state.triageFilter;
  const shown = all.filter((d) => f === "all" || (f === "bugs" ? isBug(d) : f === "none" ? !d.milestone : d.milestone === f))
    .sort((a, c) => (isBug(c) - isBug(a)) || days(c.created) - days(a.created));
  const cut = state.triageAll ? shown : shown.slice(0, 25);
  const relName = (id) => rels.find((r) => r.id === id)?.title.split(" ")[0] ?? "";
  const ages = all.map((d) => days(d.created)).sort((a, c) => a - c);
  const pick = (v, label) => h("button", { type: "button", "aria-pressed": String(f === v), onclick: () => { state.triageFilter = v; state.triageAll = false; render(); } }, label);
  return [
    h("div", { class: "bar-row" },
      h("span", { class: "seg" }, R.projects.map((q) => h("button", { type: "button", "aria-pressed": String(q.key === key), onclick: () => go(`triage/${q.key}`) }, q.name))),
      all.length ? h("span", { class: "seg" }, pick("all", `All ${all.length}`), pick("bugs", `Bugs ${all.filter(isBug).length}`),
        rels.map((r) => pick(r.id, `${r.title.split(" ")[0]} ${all.filter((d) => d.milestone === r.id).length}`)), pick("none", `No release ${all.filter((d) => !d.milestone).length}`)) : null,
      all.length ? h("button", { type: "button", class: edit ? "primary" : "", style: "margin-left:auto", onclick: () => go(`triage/${key}${edit ? "" : "/edit"}`) }, edit ? "Done" : "Edit your gates") : null),
    edit ? h("div", { class: "banner editing" }, h("b", null, "Your gates"), h("span", null, `Put an item in a release or take it out. Everything else on an item is ${p.po}'s triage.`)) : null,
    all.length ? h("div", { class: "totals" },
      h("div", null, h("b", null, all.length), h("span", null, "backlog items")),
      h("div", { class: all.some(isBug) ? "hot" : "" }, h("b", null, all.filter(isBug).length), h("span", null, "open bugs")),
      h("div", null, h("b", null, `${ages.at(-1)} d`), h("span", null, "oldest")),
      h("div", null, h("b", null, `${ages[Math.floor(ages.length / 2)]} d`), h("span", null, "median age")),
      h("div", null, h("b", null, all.filter((d) => days(d.created) < 7).length), h("span", null, "captured this week"))) : null,
    all.length ? h("div", { class: "table-wrap" }, h("table", { class: "stack" },
      h("thead", null, h("tr", null, h("th", null, "Item"), h("th", null, "Type"), h("th", null, "Release"), h("th", null, "Age"))),
      h("tbody", null, cut.map((d) => h("tr", null,
        h("td", { class: "wide" }, h("span", { class: "id" }, d.id), d.title, d.words ? h("div", { class: "sub" }, `Casper: “${d.words}”`) : null, d.fresh ? h("div", { class: "now" }, "just captured, from the dashboard") : null),
        h("td", { "data-label": "Type" }, isBug(d) ? badge("bug", d.blocks ? "bug · blocks use" : "bug") : h("span", { class: "muted", style: "white-space:nowrap" }, d.type ?? "not set")),
        h("td", { "data-label": "Release" }, edit
          ? h("select", { class: "move", "aria-label": `Release of ${d.id}`, onchange: (e) => moveItem(key, d, e.target.value) }, [...rels.filter((r) => !r.closed), { id: "", title: "No release" }].map((r) => h("option", { value: r.id, selected: (d.milestone ?? "") === r.id || null }, r.title)))
          : d.milestone ? relName(d.milestone) : h("span", { class: "muted" }, "none")),
        h("td", { "data-label": "Age", class: "num", style: "text-align:left" }, age(d.created)))),
        shown.length > cut.length ? h("tr", { class: "fold" }, h("td", { colspan: 4, class: "full" }, h("button", { type: "button", onclick: () => { state.triageAll = true; render(); } }, `Show all ${shown.length}`))) : null)))
      : h("div", { class: "empty-card" }, `Nothing to triage in ${p.name}. Capture something with + Capture; it lands here.`),
    h("p", { class: "note" }, `Bugs first, then oldest first. Triage is ${p.po}'s: slot into a feature, make it a feature, put it in a release or take it out, drop it with a reason; each keeps its id. Putting one in a release is also yours, under Edit your gates. Source: ${b.source.repo} ${b.source.dir}/drafts.`),
  ];
}

function moveItem(key, d, to) {
  const before = d.milestone;
  d.milestone = to || null;
  render();
  toast(`${d.id} is ${to ? `in ${releases(key).find((r) => r.id === to).title}` : "in no release"}. Recorded as yours.`, () => (d.milestone = before));
}

// ---------- Capture: one field, on any screen ----------

function openCapture() {
  const dlg = $("capture");
  const route = location.hash.slice(1).split("/");
  let key = ["roadmap", "triage"].includes(route[0]) ? route[1] : route[0] === "feature" ? findFeature(route[1])?.p.key ?? "helix" : "helix";
  let bug = false, where = "staging", blocks = false;
  const draw = () => {
    dlg.replaceChildren(h("form", { method: "dialog", onsubmit: (e) => { e.preventDefault(); submit(); } },
      h("h2", { id: "capture-h" }, "Capture"),
      h("textarea", { id: "cap-text", "aria-label": "What to capture", placeholder: "What is it? A title and a sentence is enough.", required: true }),
      h("div", { class: "opt" }, h("span", null, "Project"), h("span", { class: "seg" }, R.projects.map((p) => h("button", { type: "button", "aria-pressed": String(p.key === key), onclick: () => { key = p.key; keep(draw); } }, p.name)))),
      h("div", { class: "opt" }, h("span", null, "Is it a bug?"), h("span", { class: "seg" },
        h("button", { type: "button", "aria-pressed": String(!bug), onclick: () => { bug = false; keep(draw); } }, "No"),
        h("button", { type: "button", "aria-pressed": String(bug), onclick: () => { bug = true; keep(draw); } }, "Bug"))),
      bug ? h("div", { class: "opt" }, h("span", null, "Where"), h("span", { class: "seg" }, ["staging", "production"].map((w) => h("button", { type: "button", "aria-pressed": String(where === w), onclick: () => { where = w; keep(draw); } }, w))),
        h("label", { class: "check" }, h("input", { type: "checkbox", id: "cap-blocks", checked: blocks || null, onchange: (e) => { blocks = e.target.checked; keep(draw); } }), "Blocks use")) : null,
      h("p", { class: "note", style: "margin:0" }, bug && blocks ? "A bug that blocks use also goes on Waits on you until it is slotted or closed." : `It goes to ${proj(key).name}'s triage list, with your words as you typed them. Release and feature are set at triage.`),
      h("div", { class: "foot" }, h("button", { type: "button", onclick: () => dlg.close() }, "Cancel"), h("button", { type: "submit", class: "primary" }, "Capture"))));
  };
  const keep = (fn) => { const v = $("cap-text")?.value ?? ""; fn(); $("cap-text").value = v; $("cap-text").focus(); };
  const submit = () => {
    const text = $("cap-text").value.trim();
    if (!text) return $("cap-text").focus();
    const b = S[key];
    const id = key === "helix" ? `DRAFT-${Math.max(...b.drafts.map((d) => +d.id.split("-")[1]), ...state.captured.helix.map((d) => +d.id.split("-")[1])) + 1}` : `BOB-${b.counts.tasks + state.captured.bobnet.length}`;
    const title = text.split(/(?<=[.!?])\s|\n/)[0].slice(0, 120);
    state.captured[key].unshift({ id, title, type: bug ? "bug" : null, created: R.now, milestone: null, words: text, fresh: true, blocks: bug && blocks, where });
    if (bug && blocks) state.waits.unshift({ id, kind: "bug", project: key, feature: null, holds: `use on ${where}`, blocking: true, since: R.now.slice(0, 10), text: title, rec: `Captured on ${where}; blocks use`, from: "you, from the dashboard" });
    dlg.close(); render();
    toast(`Captured as ${id} in ${proj(key).name}'s triage list${bug && blocks ? ", and on Waits on you" : ""}.`);
  };
  draw();
  dlg.showModal();
  $("cap-text").focus();
}

// ---------- The sample, and the states a screen can be in ----------

function source() {
  const hx = S.helix, bn = S.bobnet;
  const row = (k, v) => h("tr", null, h("th", { style: "width:30%" }, k), h("td", null, v));
  const ctab = (s) => Object.entries(s.counts.byStatus).map(([k, v]) => `${k} ${v}`).join(" · ");
  return [
    h("section", null, h("h2", null, "Where this prototype's data comes from"),
      h("div", { class: "table-wrap" }, h("table", null, h("tbody", null,
        row("Helix's board", [h("b", null, hx.source.repo), ` at ${hx.source.commit} (${hx.source.committed.slice(0, 10)}), ${hx.source.dir}/ and ${hx.source.config}. Read only, nothing written there.`]),
        row("Helix's counts", `${hx.counts.tasks} task files, ${hx.counts.drafts} drafts, ${hx.counts.features} features, ${hx.counts.releases} releases; ${ctab(hx)}; ${hx.counts.openBugs} open bugs`),
        row("LAND-49", `${hx.tasks.length} tasks, from the files; its 6 sessions transcribed from Helix's close handoffs (land-49-build-close.md, land-49-review-close.md) and git log`),
        row("Waits on you", "Helix's lead/questions.md at the same commit: Q-214, Q-215, Q-257 to Q-259, A-6, A-15, A-17, A-20, and BOB-1's acceptance"),
        row("BobNet's board", `This repo, product/backlog at ${bn.source.commit}: ${bn.counts.tasks} tasks, ${bn.counts.features} features, ${bn.counts.releases} releases`),
        row("Examples", "Marked example: a bug that blocks use, a pending permission, every session's tokens and context per call (made from a seed), and the CI and run-slot waits. No sampled record has them."),
        row("Regenerate", "node design/BOB-1/sample/extract.mjs helix ~/Code/helix-navigator-picard LAND-49"))))),
    h("p", { class: "note" }, "Links to handoffs, commits and Remote Control land here in the prototype; in the product they open the file, the commit and the session."),
  ];
}

function states() {
  return [
    h("section", { class: "state-demo" }, h("h2", null, "Board unavailable (C4)"),
      h("div", { class: "banner down" }, h("b", null, "Board unavailable"), h("span", null, "since 21:02 · showing what it said at 21:01 · captures wait on this device and are sent when it is back"))),
    h("section", { class: "state-demo" }, h("h2", null, "Loading"), h("div", { class: "empty-card" }, "Reading the board…")),
    h("section", { class: "state-demo" }, h("h2", null, "Nothing waits on you"), h("div", { class: "empty-card" }, "Nothing waits on you. The count leaves the tab.")),
    h("section", { class: "state-demo" }, h("h2", null, "A project with no releases yet"), h("div", { class: "empty-card" }, "Envision has no releases yet. Its PO makes the first one.")),
    h("section", { class: "state-demo" }, h("h2", null, "Waiting on a run"),
      h("div", { class: "card", style: "gap:10px" },
        runLine({ kind: "ci", source: "GitHub Actions", repo: "helix-navigator", workflow: "CI", job: "e2e (staging)", run: 4812, branch: "main", since: "2026-11-13T21:08", usual: 10 }, true),
        runLine({ kind: "ci", source: "GitHub Actions", repo: "helix-navigator", workflow: "Deploy staging", job: "migrate", run: 4807, branch: "main", since: "2026-11-13T20:39", usual: 12 }, true),
        runLine({ kind: "slot", laptop: "mbp-1", label: "e2e", holder: "Marvin", what: "qa/e2e/c11-rerun.sh against staging", since: "2026-11-13T20:57", usual: 25 }, true),
        h("div", { class: "runw failed" }, h("i", { class: "ring", "aria-hidden": "true" }), h("span", null, h("b", null, "CI failed"), " after 14 min · ", h("a", { href: "#source", class: "run-link" }, "CI › unit #4809 ↗"), h("span", { class: "muted" }, " · Marvin has it; the line goes when he moves on"), " ", ex(true))),
        h("div", { class: "runw queued" }, h("i", { class: "ring", "aria-hidden": "true" }), h("span", null, h("b", null, "Waiting for the run slot"), " · 2 min · ", h("span", { class: "run-link" }, "run slot on mbp-1: ", h("b", null, "land")), h("span", { class: "muted" }, " · Luigi holds it (e2e, 23 min)"), " ", ex(true)))),
      h("p", { class: "note", style: "margin:0" }, "In order: CI running as usual; a run past half again its usual time (amber, \"running long\"); a local run holding the laptop's run slot; a run that failed (red, until the agent moves on); an agent queued behind another's run. A run that passes leaves the line at once.")),
    h("section", { class: "state-demo" }, h("h2", null, "A capture while the board is down"), h("div", { class: "toast", style: "position:static;margin:0" }, "Captured. It waits on this device and goes to Helix's triage list when the board is back.")),
  ];
}

// ---------- Routing ----------

function go(hash) { location.hash = hash; }
function render() {
  const [route = "overview", a, b] = location.hash.slice(1).split("/");
  const views = { overview: () => overview(), roadmap: () => roadmap(a ?? "helix", b === "edit"), feature: () => feature(a ?? "LAND-49"), waits: () => waits(), triage: () => triage(a ?? "helix", b === "edit"), source: () => source(), states: () => states() };
  const v = views[route] ?? views.overview;
  $("view").className = route === "feature" || route === "roadmap" || route === "overview" ? "wide" : "";
  $("view").replaceChildren(...v().filter(Boolean));
  for (const fn of later.splice(0)) fn();
  for (const el of document.querySelectorAll("#tabs a")) el.toggleAttribute("aria-current", el.getAttribute("href").slice(1).split("/")[0] === route);
  $("wait-count").textContent = waitCount() || "";
}
$("proto").replaceChildren("Prototype of release 1 · data: a sample of Helix's real board (", S.helix.source.repo, " at ", S.helix.source.commit, ", ", S.helix.counts.tasks, " tasks) and BobNet's own · ",
  h("a", { href: "#source" }, "source"), " · ", h("a", { href: "#states" }, "states"));
$("capture-open").addEventListener("click", openCapture);
let resized; addEventListener("resize", () => { clearTimeout(resized); resized = setTimeout(render, 150); });
addEventListener("hashchange", () => { $("toast").hidden = true; render(); scrollTo(0, 0); });
render();
