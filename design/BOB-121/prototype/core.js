// BOB-121 prototype: the pieces every view shares (spec.md). Static: nothing is sent anywhere; an action shows the toast
// the build would show. What's open, the toggles and the sample's states are kept in sessionStorage. Works from file://.
"use strict";

// ---------- State ----------

const KEEP = "bobnet.proto121";
const kept = (() => { try { return JSON.parse(sessionStorage.getItem(KEEP) ?? "{}"); } catch { return {}; } })();
const state = {
  whole: new Set(kept.whole ?? []), agentOpen: kept.agentOpen ?? null, answering: null,
  weigh: kept.weigh ?? false, span: kept.span ?? 30, usageDay: {}, quiet: kept.quiet ?? false, empty: kept.empty ?? false,
  older: kept.older ?? false, needsProject: "all", featFilter: "all", featText: "", triage: "all", stSpan: "visit",
  folds: new Set(kept.folds ?? []), answered: new Set(),
};
const save = () => sessionStorage.setItem(KEEP, JSON.stringify({ whole: [...state.whole], agentOpen: state.agentOpen, weigh: state.weigh, span: state.span,
  quiet: state.quiet, empty: state.empty, older: state.older, folds: [...state.folds] }));
const toggleSet = (set, id) => { set.has(id) ? set.delete(id) : set.add(id); save(); render(); };

// ---------- Elements ----------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}
const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null) k.startsWith("on") ? el.addEventListener(k.slice(2), v) : el.setAttribute(k, v);
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}
const $ = (id) => document.getElementById(id);
const badge = (st, text = st) => h("span", { class: "badge", dataset: { state: st } }, text);
const btn = (label, cls, onclick, attrs = {}) => h("button", { type: "button", class: cls || null, onclick, ...attrs }, label);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const meterOf = (done, total, cls = "ok") => h("div", { class: "meter", role: "img", "aria-label": `${done} of ${total}` }, h("i", { class: cls, style: `width:${total ? (done / total) * 100 : 0}%` }));

const fmtTokens = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
/** "14m", "3h 10m", "2d 4h": an age from minutes. */
function since(min) {
  if (min < 1) return `${Math.max(1, Math.round(min * 60))}s`;
  if (min < 60) return `${Math.round(min)}m`;
  if (min < D) return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
  return `${Math.floor(min / D)}d ${Math.floor((min % D) / 60)}h`;
}
/** A board item's age as Waits says it: minutes and hours under a day, then days. */
const age = (min) => (min < D ? since(min) : `${Math.floor(min / D)} day${Math.floor(min / D) === 1 ? "" : "s"}`);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dateOf = (min) => new Date(NOW - min * 60_000);
const day = (min) => { const d = dateOf(min); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const clock = (min) => dateOf(min).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const stamp = (min) => (min < D && dateOf(min).getDate() === new Date(NOW).getDate() ? `today ${clock(min)}` : `${day(min)} ${clock(min)}`);

const proj = (key) => PROJECTS.find((p) => p.key === key);
const pname = (key) => proj(key).name;
const board = (key) => BOARDS[key];
const feature = (key, ref) => board(key).features.find((x) => x.ref === ref);
const projectOfRef = (ref) => PROJECTS.find((p) => ref.startsWith(`${p.prefix}-`))?.key ?? "helix";
const featHref = (key, ref) => `#feature/${key}/${ref}`;
const idLink = (key, ref, label = ref) => h("a", { class: "id", href: featHref(key, ref) }, label);
const sessName = (ss) => (ss.kind === "build" && /^\d+$/.test(ss.label) ? `build ${ss.label}` : ss.label === "Fixes" ? "Fixes" : `${ss.kind} ${ss.label}`);

let toastTimer;
function toast(text, ok = true) {
  const t = $("toast");
  t.hidden = false;
  t.replaceChildren(h("div", { class: "toast", dataset: { ok: String(ok) } }, text));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; t.replaceChildren(); }, 6000);
}

// ---------- The sample's live parts ----------

/** A laptop is quiet when its last report is over 3 minutes old (BOB-48); the sample's toggle makes ubu1 quiet. */
const laptops = () => LAPTOPS.map((l) => (state.quiet && l.laptop === "ubu1" ? { ...l, at: 9, quietFor: 9 } : l));
const quietLaptops = () => laptops().filter((l) => l.at > 3);
const workers = () => WORKERS;
const pending = () => PENDING.filter((p) => !state.answered.has(p.id));
const humanPerms = () => (state.empty ? [] : pending().filter((p) => p.tier === "human"));
const waits = () => (state.empty ? [] : WAITS.filter((w) => !state.answered.has(w.ref)));
const needsCount = () => humanPerms().length + waits().length;
const laptopMark = (w) => (proj(w.project).laptops.length > 1 ? h("span", { class: "lap" }, `@${w.laptop}`) : null);

// ---------- Header ----------

const TABS = [["overview", "Overview"], ["needs", "Needs you"], ["status", "Status"], ["roadmap", "Roadmap"], ["features", "Features"], ["triage", "Triage"], ["usage", "Usage"]];
function header(view) {
  const n = needsCount();
  const tabOf = { project: "overview", feature: "features", laptops: null };
  const cur = tabOf[view] !== undefined ? tabOf[view] : view;
  $("tabs").replaceChildren(...TABS.map(([k, label]) => h("a", { href: `#${k}`, "aria-current": k === cur ? "page" : null },
    label, k === "needs" && n ? [" ", h("span", { class: "count" }, String(n))] : null)));
  const quiet = quietLaptops().length;
  $("conn").replaceChildren(h("a", { href: "#laptops", class: "conn", dataset: { state: quiet ? "quiet" : "live" }, title: "Laptops, agents and rules" },
    quiet ? `${quiet} quiet` : "live", h("span", { class: "muted lap-n" }, ` · ${plural(LAPTOPS.length, "laptop")}`)));
}

// ---------- A quiet laptop's banner (BOB-48, unchanged) ----------

function quietBanners() {
  return quietLaptops().map((l) => h("div", { class: "banner" }, h("b", null, `${l.laptop} stopped reporting`), h("span", null, `last report ${since(l.at)} ago`),
    h("span", { class: "muted" }, "Its requests wait until it reports again; nothing is lost."), h("a", { href: "#laptops" }, "Laptops →")));
}

// ---------- Needs you: one item, on the Overview and on its page ----------

const KIND = { question: ["question", "question"], action: ["action", "action"], bug: ["bug", "bug · blocks use"], review: ["review", "review gate"], permission: ["permission", "permission"] };
const VERB = { question: "Answer", action: "Mark done", bug: "Open in triage", permission: "Allow or deny" };

/** Who an item holds up, each with a live dot: "holds up ● Howard, ● Marvin (Fixes)". */
function holdsUp(w) {
  if (w.kind === "bug") return h("span", { class: "holds" }, "blocks use");
  if (!w.blocking) return h("span", { class: "muted" }, `from ${w.from}`);
  if (!w.holds?.length) return h("span", { class: "holds" }, `holds up ${w.feature ?? pname(w.project)}`);
  return h("span", { class: "holds" }, "holds up ", w.holds.map(([name, id], i) => [i ? ", " : null,
    id ? h("span", { class: "who-live" }, h("i", { class: `dot ${workers().find((x) => x.id === id)?.state === "working" ? "on" : "warn"}`, "aria-hidden": "true" }), name) : name]),
    w.session ? ` (${w.session})` : "");
}

/** The answer form under an item: a question's options and words, an action's done, a permission's Allow / Deny with a note. */
function answerForm(item, perm) {
  const close = () => { state.answering = null; render(); };
  if (perm) {
    const p = item, older = state.older;
    const label = older ? `Note to ${p.name}, sent with Deny (optional)` : `Note to ${p.name} (optional)`;
    const foot = older ? `${p.name} gets your decision; a note goes only with Deny (mbp-1's supervisor is older).` : `${p.name} gets your decision, and your note as its next message. It can't be taken back.`;
    return h("form", { class: "answer", onsubmit: (e) => e.preventDefault() },
      h("label", { class: "words" }, label, h("textarea", { rows: "2", placeholder: "e.g. fine, but use the pool's stop script next time", id: `note-${p.id}` })),
      h("div", { class: "foot" }, h("span", { class: "who-gets" }, foot),
        btn("Cancel", "", close),
        btn("Deny", "danger", () => decide(p, "deny")),
        btn("Allow", "primary", () => decide(p, "allow"))));
  }
  const w = item;
  if (w.kind === "action") return h("form", { class: "answer", onsubmit: (e) => e.preventDefault() },
    h("label", { class: "words" }, "What you did (optional)", h("textarea", { rows: "2" })),
    h("div", { class: "foot" }, h("span", { class: "who-gets" }, `${w.from} and ${pname(w.project)}'s lead get a message.`), btn("Cancel", "", close), btn("Mark done", "primary", () => answered(w))));
  return h("form", { class: "answer", onsubmit: (e) => e.preventDefault() },
    w.options ? h("fieldset", null, h("legend", null, "Pick one, or say it in words"),
      w.options.map((o, i) => h("label", { class: "opt-row" }, h("input", { type: "radio", name: `opt-${w.ref}`, checked: i === 0 && w.recommended ? true : null }),
        h("span", null, o, w.recommended && w.recommended.startsWith(o.slice(0, 3)) ? h("span", { class: "rec-tag" }, "recommended") : null)))) : null,
    h("label", { class: "words" }, "Your words (optional)", h("textarea", { rows: "2" })),
    h("div", { class: "foot" }, h("span", { class: "who-gets" }, `Kept on ${w.ref} word for word; ${w.from} gets a message. You can undo it today.`), btn("Cancel", "", close), btn("Send answer", "primary", () => answered(w))));
}
function answered(w) {
  state.answered.add(w.ref); state.answering = null;
  toast(`${w.ref} answered; sent to ${w.from}. Undo is under Answered from here today.`);
  render();
}
/** Allow / Deny's toast (spec 5.4; ADR 0013): a note is delivered only by a laptop whose supervisor sends decided. */
function decide(p, decision) {
  const note = $(`note-${p.id}`)?.value.trim();
  state.answered.add(p.id); state.answering = null;
  const verb = decision === "allow" ? "Allowed" : "Denied";
  if (!note) toast(`${verb} ${p.name}'s ${p.tool}.`);
  else if (decision === "allow" && state.older) toast(`Allowed ${p.name}'s ${p.tool}, but ${p.laptop}'s supervisor is older and dropped your note.`, false);
  else toast(`${verb} ${p.name}'s ${p.tool}; your note went to ${p.name}.`);
  render();
}

/**
 * An item as the Overview lists it (spec 2.2): badge, the text on one line (two on a phone; it opens whole when tapped),
 * its age at the right; under it where it is and whom it holds up, and the one action.
 */
function needsLine(w, compact = false) {
  const perm = w.tool !== undefined;
  const id = perm ? `perm/${w.id}` : `${w.project}/${w.ref}`;
  const open = state.whole.has(id), answering = state.answering === id;
  const [st, label] = perm ? KIND.permission : KIND[w.kind];
  const text = perm ? [`${w.name} wants ${w.tool}: `, h("code", null, w.ask?.text ?? w.preview)] : w.text;
  const where = [h("a", { href: `#project/${w.project}` }, pname(w.project)), w.feature ? [" › ", idLink(w.project, w.feature)] : null];
  return h("li", { class: `need${open ? " open" : ""}${compact ? " compact" : ""}`, dataset: { id, blocking: String(perm || !!w.blocking) } },
    badge(st, label),
    h("span", { class: "l-t", role: "button", tabindex: "0", "aria-expanded": String(open), title: open ? null : "Show all", onclick: () => toggleSet(state.whole, id) }, text),
    h("span", { class: "age", title: perm ? `asked ${stamp(w.created)}` : `since ${stamp(w.since)}` }, age(perm ? w.created : w.since)),
    open && !perm && w.recommended ? h("div", { class: "whole" }, h("div", { class: "rec" }, h("b", null, "Recommended "), w.recommended)) : null,
    h("span", { class: "l-m" }, where, " · ", perm ? h("span", { class: "holds" }, "holds up ", h("span", { class: "who-live" }, h("i", { class: "dot warn", "aria-hidden": "true" }), w.name), ` (${w.step})`) : holdsUp(w),
      w.needed ? h("span", { class: "muted" }, ` · needed before ${w.needed}`) : null),
    compact ? null : h("span", { class: "acts" }, w.kind === "bug"
      ? h("a", { class: "answer-btn btn-like", href: `#triage/${w.project}` }, VERB.bug)
      : btn(VERB[perm ? "permission" : w.kind], "answer-btn", () => { state.answering = answering ? null : id; render(); }, { "aria-expanded": String(answering) })),
    answering ? answerForm(w, perm) : null);
}

// ---------- The ask block (BOB-51 AC1, folded in as BOB-121 AC14) ----------

/** An approval's whole command, or every question with its header, Pick one/any and options. Folded: the first question, clamped. */
function askBlock(p, open) {
  const a = p.ask;
  if (!a) return h("div", { class: "ask" }, h("code", { class: "preview" }, p.preview));
  const many = a.questions.length > 1;
  const body = !a.questions.length ? [h("code", { class: "preview" }, a.text)]
    : (open ? a.questions : a.questions.slice(0, 1)).map((q, i) => h("div", { class: "aq" },
      q.header ? h("span", { class: "hd" }, many ? `${i + 1} · ${q.header}` : q.header) : null,
      h("div", { class: "qt" }, q.question),
      open ? [h("span", { class: "pick" }, q.multi ? "Pick any" : "Pick one"),
        h("ul", { class: "opts" }, q.options.map((o) => h("li", null, h("span", { class: "lb" }, o.label), o.description ? h("span", { class: "ds" }, o.description) : null)))] : null));
  return h("div", { class: `ask${open ? "" : " folded"}` }, body,
    a.cut ? h("span", { class: "cutnote" }, "Cut at the laptop: too long to send whole.") : null);
}

// ---------- Who is running: an agent's line and its detail row ----------

const STATE_CLS = { working: "", "waiting on you": "warn", "waiting on CI": "run" };
function agentLine(w, place = "") {
  const key = `${place}${w.id}`, open = state.agentOpen === key;
  const st = w.state;
  const toggle = () => { state.agentOpen = open ? null : key; save(); render(); };
  return h("li", { class: `a-line${open ? " open" : ""}` },
    h("div", { class: "a-btn", role: "button", tabindex: "0", "aria-expanded": String(open), onclick: (e) => { if (!e.target.closest("a")) toggle(); }, onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle()) },
      h("span", { class: "l-who" }, h("i", { class: `dot ${st === "working" ? "on" : "warn"}`, "aria-hidden": "true" }), h("b", null, w.name), laptopMark(w), h("span", { class: "muted" }, ` ${w.role}`)),
      h("span", { class: "l-path" }, idLink(w.project, w.feature), h("span", { class: "muted" }, ` ${w.session}`),
        w.tasks.map(([ref, title]) => [h("span", { class: "muted" }, " › "), h("span", { class: "l-task" }, h("span", { class: "id" }, ref), " ", title)])),
      h("span", { class: "l-m" }, st !== "working" ? [h("span", { class: `a-st ${STATE_CLS[st] ?? "muted"}` }, st), " · "] : null, `${fmtTokens(w.tokens)} tokens`)),
    open ? agentDetail(w) : null);
}
function agentDetail(w) {
  const p = pending().find((x) => x.worker_id === w.id && x.tier !== "human");
  const human = pending().find((x) => x.worker_id === w.id && x.tier === "human");
  const id = p ? `ask/${p.id}` : null, whole = id && state.whole.has(id);
  return h("div", { class: "a-detail" },
    h("span", { class: "muted" }, `${w.model} · ${w.effort} · ${w.laptop} · worked ${since(w.started)} · context ${w.context} · ${w.calls} calls`),
    w.checkpoint ? h("div", { class: "checkpoint" }, w.checkpoint) : null,
    p ? [h("div", { class: "ask-h" }, h("b", null, `${w.name} asks`), h("span", { class: "muted" }, ` · ${since(p.created)} · ${pname(w.project)}'s lead, ${proj(w.project).lead}, answers`)),
      askBlock(p, whole),
      btn(whole ? "Show less" : "Show all", "more-t ask-more", (e) => { e.stopPropagation(); toggleSet(state.whole, id); }, { "aria-expanded": String(!!whole) }),
      whole ? h("p", { class: "note later" }, "Picking an option here is BOB-161, in the backlog for your verdict. Today Allow and Deny override the lead.") : null] : null,
    human ? h("div", { class: "ask-h" }, h("b", null, `${w.name} wants ${human.tool}`), h("span", { class: "muted" }, ` · ${since(human.created)} · `), h("a", { href: "#needs" }, "on Needs you →")) : null,
    h("div", { class: "actions groups" },
      h("a", { href: "#", onclick: (e) => (e.preventDefault(), toast("Opens the agent's Claude session (Remote Control).")) }, "Open in Claude ↗"),
      h("a", { href: featHref(w.project, w.feature) }, "Its session →"),
      p ? h("span", { class: "grp" }, btn("Allow", "primary", () => decide(p, "allow")), btn("Deny", "danger", () => decide(p, "deny"))) : null,
      h("span", { class: "grp" }, btn("Stop", "danger", () => toast(`Asks to stop ${w.name}, after a confirm.`)), btn("Reset", "", () => toast(`Asks to reset ${w.name}, after a confirm.`)))));
}

/** Working now for one project: its agents, else who ran last. */
function runningOf(key, place) {
  const ws = workers().filter((w) => w.project === key);
  if (ws.length) return h("ul", { class: "lines now-list" }, ws.map((w) => agentLine(w, place)));
  const last = SESSIONS[key].flatMap((ss) => ss.runs.filter((r) => r.e !== null).map((r) => ({ ...r, ss }))).sort((a, b) => a.e - b.e)[0];
  return h("p", { class: "nobody" }, "Nobody is running.", last ? [" Last: ", h("b", null, last.agent), ` on `, idLink(key, last.ss.feature), ` ${sessName(last.ss)}, ended ${since(last.e)} ago.`] : null);
}

// ---------- CI: a project's workflows (spec 2.4) ----------

const CI_MARK = { running: ["◔", "run"], failed: ["✕", "bad"], passed: ["✓", "ok"] };
function ciRow(key, wf, withProject) {
  const r = wf.runs[0], [mark, tone] = CI_MARK[r.status];
  const text = r.status === "running" ? `running ${since(r.at)}${r.usually ? ` · usually ${r.usually} min` : ""}` : `${r.status} ${since(r.at)} ago`;
  return h("li", { class: "ci-row", dataset: { tone } },
    withProject === true ? h("a", { class: "ci-p", href: `#project/${key}` }, pname(key)) : withProject === "blank" ? h("span", { class: "ci-p" }) : null,
    h("span", { class: "ci-wf" }, h("span", { class: `ci-mark ${r.status === "running" ? "spin" : ""}`, "aria-hidden": "true" }, mark), h("b", null, wf.name), h("span", { class: "muted" }, ` on ${wf.branch}`)),
    h("span", { class: "ci-st" }, h("span", { class: "ci-word" }, text), h("span", { class: "muted" }, ` · ${r.sha.slice(0, 7)}${r.by ? ` · ${r.by}` : ""}`),
      r.why ? h("span", { class: "ci-why" }, r.why) : null),
    h("span", { class: "ci-hist", title: "The last five runs, newest first" }, wf.runs.slice(0, 5).map((x) => h("i", { class: `ci-dot ${CI_MARK[x.status][1]}`, title: `${x.status} · ${x.sha.slice(0, 7)} · ${since(x.at)} ago` }))),
    h("a", { class: "ci-link", href: "#", onclick: (e) => (e.preventDefault(), toast(`Opens the run on GitHub: ${proj(key).repo}, ${wf.name}.`)) }, "Run ↗"));
}

// ---------- Usage: one project's graph (spec 2.9) ----------

const weighOf = (m) => Object.entries(m).reduce((n, [k, v]) => n + v * BLEND[k], 0);
const rawOf = (m) => Object.values(m).reduce((n, v) => n + v, 0);
/** One project's daily series for the span: raw or weighted, and the unknown-model share. */
function series(key, days = state.span) {
  const all = USAGE[key].slice(-days);
  return all.map((m, i) => ({ ago: days - 1 - i, raw: rawOf(m), weighted: weighOf(m), unknown: m.unknown, m }));
}
const valOf = (pt) => (state.weigh ? pt.weighted : pt.raw);
function niceStep(max, n = 4) { const step0 = max / n, mag = 10 ** Math.floor(Math.log10(step0 || 1)); return [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= step0); }

/** Bars per day; a day over twice the span's median is a spike, drawn in warn and labelled; today is "so far". */
function usageGraph(key, opts = {}) {
  const pts = series(key, opts.days ?? state.span);
  const vals = pts.map(valOf);
  const sorted = [...vals].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
  const max = Math.max(...vals) * 1.12, step = niceStep(max), top = Math.ceil(max / step) * step;
  const W = opts.small ? 380 : 600, Hh = opts.small ? 120 : 150, L = 38, B = 20, T = 14, bw = (W - L) / pts.length;
  const y = (v) => T + (Hh - T - B) * (1 - v / top);
  const sel = state.usageDay[key];
  const grid = [];
  for (let v = 0; v <= top + 1; v += step) grid.push(s("g", { class: "grid" }, s("line", { x1: L, x2: W, y1: y(v), y2: y(v) }), s("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, fmtTokens(v))));
  const bars = pts.map((pt, i) => {
    const v = vals[i], spike = v > median * 2 && v > 4e6, today = pt.ago === 0;
    const x = L + i * bw + bw * 0.15, wdt = bw * 0.7;
    const d = dateOf(pt.ago * D);
    return s("g", { class: `bar${spike ? " spike" : ""}${today ? " today" : ""}${sel === pt.ago ? " sel" : ""}`, tabindex: "0", role: "button",
      "aria-label": `${WD[d.getDay()]} ${day(pt.ago * D)}: ${fmtTokens(v)} tokens`, onclick: () => { state.usageDay[key] = sel === pt.ago ? undefined : pt.ago; render(); } },
      s("title", null, `${WD[d.getDay()]} ${day(pt.ago * D)}${today ? " (so far)" : ""}: ${fmtTokens(v)} ${state.weigh ? "Sonnet-equivalent " : ""}tokens`),
      s("rect", { x: L + i * bw, y: T, width: bw, height: Hh - T - B, class: "hit" }),
      s("rect", { x, y: y(v), width: wdt, height: Math.max(1, y(0) - y(v)), rx: 2 }),
      spike && !opts.small ? s("text", { x: x + wdt / 2, y: y(v) - 4, "text-anchor": "middle", class: "spike-lab" }, fmtTokens(v)) : null);
  });
  const ticks = pts.map((pt, i) => (i % Math.ceil(pts.length / 6) === (pts.length - 1) % Math.ceil(pts.length / 6) ? s("text", { x: L + i * bw + bw / 2, y: Hh - 4, "text-anchor": "middle" }, pt.ago === 0 ? "today" : day(pt.ago * D)) : null));
  return h("div", { class: "ugraph" }, s("svg", { viewBox: `0 0 ${W} ${Hh}`, role: "img", "aria-label": `${pname(key)}: tokens per day, last ${pts.length} days` }, grid, bars, s("g", { class: "axis" }, ticks)));
}
/** Under a graph: the picked day's biggest sessions, else nothing. */
function usageDayLine(key) {
  const ago = state.usageDay[key];
  if (ago === undefined) return null;
  const pt = series(key).find((x) => x.ago === ago);
  const top = USAGE_DAYS[key][ago] ?? [];
  const models = Object.entries(pt.m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return h("div", { class: "uday" },
    h("b", null, `${WD[dateOf(ago * D).getDay()]} ${day(ago * D)}${ago === 0 ? ", so far" : ""}: ${fmtTokens(valOf(pt))} ${state.weigh ? "Sonnet-equivalent " : ""}tokens`),
    h("span", { class: "muted" }, models.map(([k, v]) => `${k === "unknown" ? "unnamed model" : k} ${fmtTokens(state.weigh ? v * BLEND[k] : v)}`).join(" · ")),
    top.length ? h("span", null, "Biggest: ", top.map(([name, why, n], i) => [i ? ", " : null, idLink(key, name.split(" ")[0], name), ` ${fmtTokens(n * (state.weigh ? 2 : 1))}`, why ? h("span", { class: "muted" }, ` (${why})`) : null])) : null);
}
function weighToggle() {
  return h("span", { class: "seg weigh", role: "group", "aria-label": "Weigh by model" },
    btn("Raw tokens", "", () => { state.weigh = false; save(); render(); }, { "aria-pressed": String(!state.weigh) }),
    btn("Sonnet-equivalent", "", () => { state.weigh = true; save(); render(); }, { "aria-pressed": String(state.weigh) }));
}
const WEIGH_ON = "Sonnet-equivalent: each model's tokens count at its list-price ratio to Sonnet 5.5 (Opus 5.5 ×2, Haiku 5.5 ×0.05, Fable 5.1 ×5). Effort isn't weighted: higher effort already shows as more tokens. Tokens only, nothing is priced.";
const WEIGH_OFF = "Raw tokens: input, output, cache reads and writes as reported, every model counted the same.";

// ---------- Sample states (not part of the design: a panel to see the states the spec names) ----------

function sampleStates() {
  const box = (key, label) => h("label", null, h("input", { type: "checkbox", checked: state[key] || null, onchange: (e) => { state[key] = e.target.checked; save(); render(); } }), ` ${label}`);
  return h("details", { class: "proto-states" }, h("summary", null, "Prototype: show other states"),
    h("div", null, box("quiet", "ubu1 stopped reporting"), box("empty", "Nothing needs you"), box("older", "mbp-1 runs an older supervisor (no note with Allow)"),
      btn("Reset the sample", "", () => { sessionStorage.removeItem(KEEP); location.reload(); })));
}
