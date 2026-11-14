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

// ---------- Overview: every project, what's open, what's next, what waits on Casper ----------

function overview() {
  const blocking = state.waits.filter((w) => w.blocking);
  const working = Object.values(R.sessions).flat().filter((s) => s.state === "running").flatMap((s) => s.agents ?? []);
  const backlog = R.projects.reduce((n, p) => n + items(p.key).length, 0);
  return [
    h("div", { class: "totals" },
      h("a", { href: "#waits", class: "tot" }, h("div", { class: blocking.length ? "hot" : "" }, h("b", null, waitCount()), h("span", null, `wait on you · ${blocking.length} hold work up`))),
      h("div", null, h("b", null, working.length), h("span", null, "agents working")),
      h("div", null, h("b", null, R.projects.length), h("span", null, "projects, 1 laptop")),
      h("div", null, h("b", null, backlog), h("span", null, "backlog items to triage"))),
    h("section", null, h("h2", null, "Projects"),
      h("div", { class: "cards" }, R.projects.map(projectCard))),
    h("section", null, h("h2", null, "Holds work up ", h("span", { class: "count" }, blocking.length)),
      h("ul", { class: "list waits" }, blocking.slice(0, 3).map(waitItem)),
      h("p", { class: "note" }, h("a", { href: "#waits" }, `All ${waitCount()} that wait on you`))),
  ];
}

function projectCard(p) {
  const fs = allFeatures(p.key);
  const open = fs.find(isOpen), ready = fs.find((f) => f.status === "Ready" && !isOpen(f));
  const rel = open?.rel ?? releases(p.key)[0];
  const relFs = rel.features, relDone = relFs.filter((f) => f.status === "Done").length;
  const ws = state.waits.filter((w) => w.project === p.key), wb = ws.filter((w) => w.blocking).length;
  const its = items(p.key), bugs = its.filter(isBug).length, oldest = its.length ? Math.max(...its.map((d) => days(d.created))) : 0;
  const nx = open && R.next[open.id];
  const agents = open ? (R.sessions[open.id] ?? []).filter((s) => s.state === "running").flatMap((s) => s.agents) : [];
  return h("div", { class: "card proj" },
    h("div", { class: "top" }, h("a", { href: `#roadmap/${p.key}`, class: "name", style: "color:inherit;text-decoration:none;font-size:16px" }, p.name),
      h("span", { class: "sub" }, `${p.laptop} · lead ${p.lead} · PO ${p.po}`)),
    h("div", { class: "row" }, h("span", null, "Release"), h("span", null, `${rel.title.split(" ")[0]} ${rel.title.split(" ").slice(1).join(" ")} · ${relDone} of ${relFs.length} features done`)),
    h("div", { class: "row" }, h("span", null, "Open"), open
      ? h("span", { class: "t" }, h("a", { class: "id", href: `#feature/${open.id}` }, open.id), open.title,
        h("div", { class: "muted" }, `${open.ac[0]} of ${open.ac[1]} criteria · ${agents.length ? `${plural(agents.length, "agent")} on it now` : "nobody on it now"}`),
        nx ? h("div", { class: "muted", style: "color:var(--warn)" }, `Next: waits on you, ${nx.item.replace("#", " #")}`) : null)
      : h("span", { class: "muted" }, "no feature open")),
    h("div", { class: "row" }, h("span", null, "Next ready"), ready
      ? h("span", { class: "t" }, h("a", { class: "id", href: `#roadmap/${p.key}` }, ready.id), ready.title)
      : h("span", { class: "muted" }, "none Ready yet")),
    h("div", { class: "row" }, h("span", null, "Waits on you"), h("span", null, h("a", { href: "#waits" }, ws.length), wb ? h("span", { style: "color:var(--bad)" }, ` · ${wb} hold work up`) : "")),
    h("div", { class: "row" }, h("span", null, "Backlog"), its.length
      ? h("span", null, h("a", { href: `#triage/${p.key}` }, `${its.length} items`), ` · ${plural(bugs, "bug")} · oldest ${oldest} days`)
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
  const tasks = b.feature === id ? b.tasks : [];
  const byShort = new Map(tasks.map((t) => [short(t.id), t]));
  const inSession = new Set(ss.flatMap((s) => s.moved.map((m) => m[0])));
  const loose = tasks.filter((t) => !inSession.has(short(t.id)));
  const agents = ss.filter((s) => s.state === "running").flatMap((s) => s.agents);
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
      wait ? h("a", { href: "#next", class: "banner", style: "text-decoration:none;color:inherit" }, h("b", { style: "color:var(--warn)" }, "Next: waits on you"), h("span", null, `${wait.id.replace("#", " #")} · ${wait.text}`)) : null,
      h("div", { class: "two" },
        h("section", null, h("h2", null, "Sessions, in the order they ran"),
          ss.length ? h("ol", { class: "steps" }, ss.map((s, i) => stepItem(p, s, byShort, i === ss.length - 1)), nextItem(nx, wait))
            : h("div", { class: "empty-card" }, "No session has run on this feature yet. Next: a design session, once it is Ready.")),
        h("aside", null, h("h2", null, "Tasks ", h("span", { class: "count" }, tasks.length)),
          loose.length ? h("div", { class: "card", style: "margin-bottom:10px" }, h("div", { class: "muted" }, "In no session yet"), h("ul", { class: "tasks" }, loose.map((t) => taskLi(t, t.status)))) : null,
          h("details", { class: "card", open: innerWidth >= 1100 || null }, h("summary", { style: "margin:0" }, `All ${tasks.length}, as the board has them now`), h("ul", { class: "tasks" }, tasks.map((t) => taskLi(t, t.status))))))),
  ];
}

function taskLi(t, st) {
  return h("li", null, h("span", { class: "id" }, short(t.id)), h("span", { class: "tt", title: t.title }, t.title),
    badge(st === "In Review" ? "in review" : st.toLowerCase(), st), h("span", { class: "ac" }, t.ac[1] ? `${t.ac[0]}/${t.ac[1]}` : "–"));
}

function stepItem(p, s, byShort, last) {
  const helix = p.key === "helix";
  const moved = s.moved.map(([n, st]) => { const t = byShort.get(n); return t ? taskLi(t, st) : null; });
  const closedN = s.moved.filter((m) => m[1] === "Done").length;
  return h("li", { class: "step", dataset: { kind: s.kind, state: s.state } }, h("span", { class: "dot2", "aria-hidden": "true" }),
    h("div", { class: "card" },
      h("div", { class: "top" }, h("span", { class: "kind" }, s.kind), h("b", null, s.label), h("span", { class: "when" }, span(s.start, s.end)), badge(s.state)),
      s.state === "closed" ? h("div", { class: "outcome" },
        h("span", { class: "need", dataset: { need: s.need } }, `need: ${s.need}`, s.needs.length ? ` (${s.needs.join(", ")})` : ""),
        h("span", null, `${plural(s.blockers, "blocker")} · ${plural(s.majors, "major")}`),
        s.minors ? h("span", null, `${s.minors} minors, fixed`) : null, s.back ? h("span", null, `${s.back} sent back`) : null,
        h("span", null, closedN ? `closed ${plural(closedN, "task")}` : `moved ${plural(s.moved.length, "task")}`),
        s.tokens ? h("span", { class: "muted" }, `${tok(s.tokens)} tokens`, " ", ex(s.tokensExample)) : null) : null,
      (s.agents ?? []).map((a) => h("div", { class: "agent" }, h("b", null, a.name, " ", ex(a.example)), h("span", { class: "d" }, a.checkpoint),
        h("span", { class: "d" }, `${a.model} · ${a.laptop} · ${dur(s.start, R.now.slice(0, 16))} · ${tok(a.tokens)} tokens · context ${tok(a.ctx)}`))),
      h("div", { class: "sub" }, s.summary),
      h("div", { class: "links" },
        s.handoff ? h("a", { href: "#source", title: helix ? `~/.local/state/bobnet/handoffs/helix/${s.handoff}` : s.handoff }, "Handoff") : h("span", { class: "off" }, "No handoff file"),
        s.commit ? h("a", { href: "#source", title: `helix-navigator-picard ${s.commit}` }, `Close ${s.commit.slice(0, 7)}`) : null,
        s.rc ? h("a", { href: "#source" }, "Remote Control") : h("span", { class: "off" }, s.state === "running" ? "No Remote Control" : "")),
      moved.length ? h("details", { open: last || null }, h("summary", null, `Tasks it moved (${moved.length})`), h("ul", { class: "tasks" }, moved)) : null));
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
      h("span", null, `from ${w.from}`),
      w.session ? h("span", null, w.session) : null,
      h("a", { href: "#source" }, w.kind === "question" || w.kind === "action" ? "Open in lead/questions.md" : w.kind === "permission" ? "Open in the supervisor" : "Open")));
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
    h("p", { class: "note" }, "You answer where you do today: in the project's conversation or its files. An item leaves this list when its source says it is answered; the list keeps nothing of its own. A session that closed with need: casper shows on the question it waits for."),
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
        row("Examples", "Marked example: a bug that blocks use, a pending permission, and every session's tokens. No sampled record has them."),
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
    h("section", { class: "state-demo" }, h("h2", null, "A capture while the board is down"), h("div", { class: "toast", style: "position:static;margin:0" }, "Captured. It waits on this device and goes to Helix's triage list when the board is back.")),
  ];
}

// ---------- Routing ----------

function go(hash) { location.hash = hash; }
function render() {
  const [route = "overview", a, b] = location.hash.slice(1).split("/");
  const views = { overview: () => overview(), roadmap: () => roadmap(a ?? "helix", b === "edit"), feature: () => feature(a ?? "LAND-49"), waits: () => waits(), triage: () => triage(a ?? "helix", b === "edit"), source: () => source(), states: () => states() };
  const v = views[route] ?? views.overview;
  $("view").className = route === "feature" || route === "roadmap" ? "wide" : "";
  $("view").replaceChildren(...v().filter(Boolean));
  for (const el of document.querySelectorAll("#tabs a")) el.toggleAttribute("aria-current", el.getAttribute("href").slice(1).split("/")[0] === route);
  $("wait-count").textContent = waitCount() || "";
}
$("proto").replaceChildren("Prototype of release 1 · data: a sample of Helix's real board (", S.helix.source.repo, " at ", S.helix.source.commit, ", ", S.helix.counts.tasks, " tasks) and BobNet's own · ",
  h("a", { href: "#source" }, "source"), " · ", h("a", { href: "#states" }, "states"));
$("capture-open").addEventListener("click", openCapture);
addEventListener("hashchange", () => { $("toast").hidden = true; render(); scrollTo(0, 0); });
render();
