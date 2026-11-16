// BOB-33 prototype: the Status tab (notes.md). Static sample (data.js); works from file://.
// The device's last visit is kept in sessionStorage here so a reload of a new tab resets it; the build keeps it
// in localStorage, per device. "Reset the prototype" in the bar at the top puts everything back.
"use strict";

const S = window.SAMPLE;
const KEY = "bobnet.status.proto";
const START = { anchor: S.lastVisit, span: "visit", device: "returning", broker: "live", ships: "all", open: {}, toast: null };
const load = () => { try { return { ...START, ...JSON.parse(sessionStorage.getItem(KEY) ?? "{}") }; } catch { return { ...START }; } };
const state = load();
const save = () => sessionStorage.setItem(KEY, JSON.stringify(state));

const WEEK = 7 * 1440, DAY = 1440, MONTH = 30 * DAY;
const DAYS = ["Mon", "Sun", "Sat", "Fri", "Thu", "Wed", "Tue", "Mon"];
const DATES = [16, 15, 14, 13, 12, 11, 10, 9];

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

/* Time: everything is minutes before Mon 16 Nov 06:12. */
const pad = (n) => String(n).padStart(2, "0");
function clock(a) {
  const t = S.now.min - a;
  const back = Math.max(0, Math.ceil(-t / DAY));
  const m = ((t % DAY) + DAY) % DAY;
  const hm = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  if (back === 0) return hm;
  if (back === 1) return `Sun ${hm}`;
  if (back < 7) return `${DAYS[back]} ${hm}`;
  return `${DAYS[back]} ${DATES[back]} Nov`;
}
function age(a) {
  if (a < 1) return "just now";
  if (a < 60) return `${a}\u00a0min`;
  if (a < DAY) { const hrs = Math.floor(a / 60), mins = a % 60; return hrs < 3 && mins >= 10 ? `${hrs}\u00a0h ${mins}\u00a0min` : `${hrs}\u00a0h`; }
  return `${Math.floor(a / DAY)}\u00a0d`;
}
const ago = (a) => (a < 1 ? "just now" : `${age(a)} ago`);
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? one + "s"}`;
const proj = (k) => S.projects.find((p) => p.key === k);
// The prototype's "ships" switch: BOB-33 ships first; the lead's note (BOB-36) and themes (BOB-35) come later.
const hasNotes = () => state.ships === "all";
const hasThemes = () => state.ships === "all";
const noteOf = (k) => (hasNotes() ? S.notes[k] : null);

/* The span. */
const firstVisit = () => state.device === "first" && state.anchor == null;
function spanAgo() {
  if (state.span === "24h" || (state.span === "visit" && state.anchor == null)) return DAY;
  if (state.span === "week") return WEEK;
  return state.anchor;
}
const inSpan = (a) => a <= spanAgo();
const since = () => clock(spanAgo());
function spanWords() {
  if (state.span === "24h") return ["The last 24 hours", `since ${clock(DAY)}`];
  if (state.span === "week") return ["The last week", `since ${clock(WEEK)}`];
  if (state.anchor == null) return ["The last 24 hours", `since ${clock(DAY)}`];
  return ["Since your last visit", state.anchor < 1 ? `${clock(0)}, just now` : `${clock(state.anchor)}, ${ago(state.anchor)}`];
}

/* What the page computes, per project (or all). */
const of = (list, ps) => list.filter((x) => ps.includes(x.p));
const needsOf = (ps) => of(S.needs, ps).sort((a, b) => b.ago - a.ago);
const stuckOf = (ps) => of(S.stuck, ps).sort((a, b) => (a.sev === b.sev ? a.ago - b.ago : a.sev === "bad" ? -1 : 1));
const settledOf = (ps) => of(S.settled, ps).filter((x) => inSpan(x.ago));
function doneOf(ps) {
  const sessions = of(S.sessions, ps).filter((s) => inSpan(s.ago) && s.summary).sort((a, b) => a.ago - b.ago);
  const features = of(S.done, ps).filter((d) => inSpan(d.ago)).sort((a, b) => a.ago - b.ago);
  // Lands are a count only (ADR 0005 §2); deploys aren't recorded (§7).
  const lands = sessions.filter((s) => s.commit).length + of(S.lands, ps).filter((l) => inSpan(l.ago)).length;
  const releases = of(S.releases, ps).filter((r) => inSpan(r.ago));
  return { sessions, features, lands, releases };
}
// ADR 0005 §4: findings of closes in the span, grouped by theme (one of sixteen) or "untagged"; a theme "came back"
// when it is in 2 or more sessions over the last 30 days, one of them in the span. Sent back: 2 or more closes in 30 days.
function recurringOf(ps) {
  if (!hasThemes()) return null;
  const closes = of(S.sessions, ps).filter((s) => s.findings && s.ago <= MONTH);
  const groups = new Map();
  for (const s of closes.filter((s) => inSpan(s.ago))) for (const f of s.findings) {
    const t = f.theme ?? "untagged";
    if (!groups.has(t)) groups.set(t, { theme: t, hits: [], sessions: new Set() });
    groups.get(t).hits.push({ ...f, s });
    groups.get(t).sessions.add(s);
  }
  const in30 = (t) => new Set(closes.filter((s) => s.findings.some((f) => f.theme === t)).map((s) => `${s.p}/${s.f}/${s.label}`)).size;
  const themes = [...groups.values()].map((g) => ({ ...g, back: g.theme !== "untagged" && in30(g.theme) > 1, in30: in30(g.theme) }))
    .sort((x, y) => (x.theme === "untagged") - (y.theme === "untagged") || y.back - x.back || y.hits.length - x.hits.length);
  const sentBack = of(S.sentBack, ps).map((x) => ({ ...x, times: x.times.filter((t) => t[1] <= MONTH) }))
    .filter((x) => x.times.length > 1 && x.times.some((t) => inSpan(t[1])));
  const tagged = themes.filter((t) => t.theme !== "untagged");
  const untagged = themes.find((t) => t.theme === "untagged");
  const back = tagged.filter((t) => t.back).length + sentBack.length;
  return { themes, tagged, untagged, sentBack, back, findings: themes.reduce((n, t) => n + t.hits.length, 0) };
}
// ADR 0005 §2: tokens of runs that ended in the span, each run once and whole. A lost run's tokens are unknown,
// counted apart, never as zero. Running now comes from the laptops' snapshots and isn't in the total.
function usageOf(ps) {
  const by = new Map();
  const row = (who, p) => { const k = `${p}/${who}`; if (!by.has(k)) by.set(k, { who, p, n: 0, lost: 0 }); return by.get(k); };
  for (const s of of(S.sessions, ps)) if (inSpan(s.ago)) row(s.who, s.p).n += s.tokens;
  const running = [];
  for (const [who, p, ended, n, outcome] of S.runs) {
    if (!ps.includes(p)) continue;
    if (ended == null) running.push({ who, p, n });
    else if (inSpan(ended)) { if (outcome === "lost") row(who, p).lost++; else row(who, p).n += n; }
  }
  const agents = [...by.values()].sort((a, b) => b.n - a.n);
  const heavy = of(S.sessions, ps).filter((s) => inSpan(s.ago) && s.tokens > 2 * S.usual[s.kind])
    .map((s) => ({ ...s, x: s.tokens / S.usual[s.kind] }));
  return { total: agents.reduce((t, a) => t + a.n, 0), lost: agents.reduce((t, a) => t + a.lost, 0), agents, heavy,
    running: running.sort((a, b) => b.n - a.n) };
}
const unknown = (n) => `${plural(n, "run")}' tokens unknown`.replace("1 run'", "1 run's");
function backlogOf(p) {
  const b = S.backlog[p];
  const thin = b.ready.length < 2 && b.release.left > 0;
  return { ...b, thin };
}
function verdict(ps) {
  const stuck = stuckOf(ps), done = doneOf(ps).sessions.length;
  const red = stuck.filter((x) => x.sev === "bad");
  const ci = stuck.filter((x) => x.kind === "ci").map((x) => proj(x.p).name);
  const tone = red.length ? "bad" : stuck.length ? "warn" : "ok";
  const word = { bad: "Needs a look", warn: "Mostly OK", ok: "Going OK" }[tone];
  const parts = [];
  if (ci.length) parts.push(`CI red${ps.length > 1 ? ` on ${ci.join(", ")}` : ""}`);
  if (stuck.length) parts.push(`${stuck.length} stuck`);
  parts.push(`${done} done`);
  return { tone, word, sub: parts.join(" · "), done, stuck: stuck.length, ci: ci.length > 0 };
}
/* A lead's note is old when newer facts follow it (ADR 0005 §5 `newer`): sessions closed, features Done, releases closed. */
function newerThanNote(p) {
  const n = noteOf(p);
  if (!n) return { n: 0, words: "" };
  const after = (a) => a < n.ago;
  const c = [of(S.sessions, [p]).filter((s) => after(s.ago)).length, of(S.done, [p]).filter((d) => after(d.ago)).length,
    of(S.releases, [p]).filter((r) => after(r.ago)).length];
  const words = [c[0] && plural(c[0], "session") + " closed", c[1] && plural(c[1], "feature") + " Done", c[2] && plural(c[2], "release") + " closed"].filter(Boolean).join(", ");
  return { n: c[0] + c[1] + c[2], words };
}

/* Small parts. */
const badge = (st, text) => h("span", { class: "badge", dataset: { state: st } }, text);
const KIND = { question: ["question", "question"], action: ["action", "action"], review: ["review", "review gate"], permission: ["permission", "permission"] };
function rec(ref, label) {
  // Every item links to its record. In the prototype a link says where it would go.
  return h("a", { class: "id", href: "#", onclick: (e) => { e.preventDefault(); toast(`In the build, this opens ${ref} on its own page.`); } }, label ?? ref);
}
function toast(text, undo) {
  state.toast = { text, undo: undo ?? null };
  save();
  paintToast();
}
function paintToast() {
  const slot = document.getElementById("toast-slot");
  slot.replaceChildren();
  if (!state.toast) return;
  const t = state.toast;
  slot.append(h("div", { class: "toast st-toast", role: "status" }, t.text,
    t.undo != null ? h("button", { type: "button", class: "undo", onclick: () => { state.anchor = t.undo.anchor; state.span = t.undo.span; state.device = t.undo.device; state.toast = null; save(); render(); } }, "Undo") : null,
    h("button", { type: "button", class: "close-t", "aria-label": "Close", onclick: () => { state.toast = null; save(); paintToast(); } }, "×")));
}

function caughtUp() {
  const undo = { anchor: state.anchor, span: state.span, device: state.device };
  state.anchor = 0; state.span = "visit"; state.device = "returning";
  toast(`Caught up at ${clock(0)}. This device's next visit starts from here.`, undo);
  render();
  scrollTo(0, 0);
}

/* The span bar: what the page looks back over, the chips to widen it, and I'm caught up. */
function spanBar({ caught }) {
  const [head, sub] = spanWords();
  const chip = (key, text) => h("button", { type: "button", "aria-pressed": String(state.span === key || (key === "24h" && state.span === "visit" && state.anchor == null)),
    onclick: () => { state.span = key; save(); render(); } }, text);
  return h("div", { class: "span-bar" },
    h("div", { class: "when" }, h("b", null, head), h("span", null, sub)),
    h("div", { class: "seg span-chips", role: "group", "aria-label": "Look back over" },
      state.anchor != null ? chip("visit", state.anchor < 1 ? "Since now" : `Since ${clock(state.anchor)}`) : null, chip("24h", "24 h"), chip("week", "A week")),
    caught ? h("button", { type: "button", class: "primary caught", onclick: caughtUp }, "I'm caught up") : null,
    firstVisit() ? h("p", { class: "span-note" }, "First visit on this device, so the last 24 hours. From now on it starts at your last “I'm caught up”.")
      : state.span !== "visit" && state.anchor != null ? h("p", { class: "span-note" }, `Widened. Your last visit stays at ${clock(state.anchor)}.`)
      : caught ? h("p", { class: "span-note" }, "Opening this page doesn't move it; only I'm caught up does.") : null);
}

/* The two answers: do I need to do anything, and is it going OK? */
function answers(ps, needsHref) {
  const n = needsOf(ps), blocking = n.filter((x) => x.blocking).length, v = verdict(ps);
  const ntone = blocking ? "bad" : n.length ? "warn" : "ok";
  return h("div", { class: "answers" },
    h("a", { class: "ans", href: needsHref, dataset: { tone: ntone } },
      h("span", { class: "lab" }, "Needs you"),
      h("b", null, n.length ? String(n.length) : "Nothing"),
      h("span", { class: "sub" }, n.length ? `${blocking} hold work up · oldest ${age(n[0].ago)}` : "Nothing waits on you")),
    h("a", { class: "ans", href: ps.length > 1 ? "#status/helix" : `#status/${ps[0]}/stuck`, dataset: { tone: v.tone },
      onclick: ps.length > 1 ? (e) => { e.preventDefault(); document.querySelector(".pcards")?.scrollIntoView({ behavior: "smooth" }); } : null },
      h("span", { class: "lab" }, "Is it going OK?"),
      h("b", null, v.word),
      h("span", { class: "sub" }, v.sub)));
}

/* A Needs you line, as on the Overview: it opens the item on Waits on you, where he answers. */
function needLine(w, showProject) {
  const [st, label] = KIND[w.kind];
  const before = !inSpan(w.ago);
  return h("li", { class: "hold need", dataset: { blocking: String(w.blocking) } },
    badge(st, label),
    h("a", { class: "l-t", href: "#waits", onclick: () => toast(`On Waits on you, at ${w.ref ?? "the permission"}. Answering happens there.`) }, w.text),
    h("span", { class: "l-m" },
      [showProject ? proj(w.p).name : null, w.feature, w.blocking ? `holds up ${w.holds}` : `when you have time${w.before ? `, before ${w.before}` : ""}`].filter(Boolean).join(" · "),
      " · ", h("span", { class: "age" }, age(w.ago)),
      before ? h("span", { class: "before" }, `from before ${since()}`) : null));
}

/* All projects: the digest. */
function digest() {
  const ps = S.projects.map((p) => p.key);
  const n = needsOf(ps);
  return h("div", { class: "st" },
    spanBar({ caught: true }),
    answers(ps, "#status/needs"),
    h("section", null, h("h2", null, "Projects ", h("span", { class: "count" }, String(ps.length))),
      h("div", { class: "pcards" }, S.projects.map(pcard))),
    h("section", { id: "needs" }, h("h2", null, "Needs you ", h("span", { class: "count" }, String(n.length))),
      n.length ? h("div", { class: "card st-card" }, h("ul", { class: "lines ov-needs st-needs" }, n.map((w) => needLine(w, true))),
        h("a", { class: "more-t sec-link", href: "#waits" }, "Answer them on Waits on you →"))
        : h("div", { class: "empty-card" }, "Nothing waits on you.")),
    h("div", { class: "caught-foot" },
      h("button", { type: "button", class: "primary", onclick: caughtUp }, "I'm caught up"),
      h("span", null, `Next time, this page starts at ${clock(0)}.`)));
}

function pcard(p) {
  const k = p.key, v = verdict([k]), n = needsOf([k]), d = doneOf([k]), rc = recurringOf([k]), bl = backlogOf(k), u = usageOf([k]);
  const note = noteOf(k), old = newerThanNote(k).n;
  const stuck = stuckOf([k]);
  return h("a", { class: "pcard card", href: `#status/${k}`, dataset: { tone: v.tone } },
    h("div", { class: "top" }, h("span", { class: "name" }, p.name), badge(v.tone === "ok" ? "running" : v.tone === "warn" ? "waiting" : "failed", v.word), h("span", { class: "chev", "aria-hidden": "true" }, "›")),
    note ? h("p", { class: "pnote", dataset: { old: String(old > 0) } }, h("b", null, `${note.by}, ${clock(note.ago)}: `), note.text) : null,
    h("div", { class: "pstats" },
      stat("Needs you", n.length, n.some((x) => x.blocking) ? "bad" : n.length ? "warn" : null),
      stat("Done", d.sessions.length, null, d.features.length ? `${plural(d.features.length, "feature")}` : null),
      stat("Stuck", stuck.length, stuck.some((x) => x.sev === "bad") ? "bad" : stuck.length ? "warn" : null),
      stat("Tokens", tok(u.total), null, u.lost ? `+ ${u.lost} unknown` : null)),
    h("div", { class: "pflags" },
      stuck.filter((x) => x.sev === "bad").map((x) => badge("failed", x.label)),
      rc?.back ? badge("waiting", `${rc.back} came back`) : null,
      bl.thin ? badge("waiting", "backlog thin") : null,
      bl.nextEmpty ? badge("ready", `${bl.nextEmpty.ref} has nothing Ready`) : null));
}
const stat = (lab, v, tone, sub) => h("div", { class: "pstat", dataset: { tone } }, h("span", { class: "lab" }, lab), h("b", null, String(v)), sub ? h("span", { class: "s" }, sub) : null);

/* One project's page. */
const SECS = ["needs", "done", "stuck", "recurring", "backlog", "usage"];
function projectPage(k, focus) {
  const p = proj(k);
  if (!p) return h("p", null, "No such project.");
  const note = noteOf(k);
  const wide = matchMedia("(min-width: 700px)").matches;
  const isOpen = (sec) => state.open[`${k}/${sec}`] ?? (focus === sec || wide);
  return h("div", { class: "st" },
    h("div", { class: "p-head" },
      h("a", { class: "back", href: "#status" }, "‹ All projects"),
      h("h2", { class: "p-name" }, p.name, " ", h("span", { class: "muted" }, `lead ${p.lead} · PO ${p.po}`))),
    spanBar({ caught: false }),
    note ? leadNote(k, note) : null,
    answers([k], `#status/${k}/needs`),
    h("div", { class: "secs" }, SECS.map((sec) => section(k, sec, isOpen(sec)))),
    h("p", { class: "note foot-note" }, "I'm caught up is on ", h("a", { href: "#status" }, "All projects"), ": this device keeps one last visit for every project."));
}

function leadNote(k, n) {
  const old = newerThanNote(k);
  return h("div", { class: "lead-note card", dataset: { old: String(old.n > 0) } },
    h("div", { class: "ln-h" }, h("b", null, `${n.by}'s note`), h("span", null, `${S.roles[n.by]} · ${clock(n.ago)}, ${ago(n.ago)}`),
      old.n ? h("span", { class: "old", title: old.words }, `${plural(old.n, "thing")} since: ${old.words}`) : null),
    h("p", { class: "ln-t" }, n.text),
    // Up to 600 characters: on a phone a long note folds to five lines.
    n.text.length > 280 ? h("button", { type: "button", class: "more-t ln-more", onclick: (e) => { const c = e.target.closest(".lead-note"); c.classList.toggle("full"); e.target.textContent = c.classList.contains("full") ? "Show less" : "Show all"; } }, "Show all") : null);
}

function section(k, sec, open) {
  const body = BODY[sec](k);
  const d = h("details", { class: "sec card", id: `sec-${sec}`, open: open || null, dataset: { sec, tone: body.tone ?? null } },
    h("summary", { class: "sec-h" },
      h("span", { class: "t" }, body.title),
      h("span", { class: "n", dataset: { tone: body.tone ?? null } }, body.count),
      h("span", { class: "scope" }, body.scope),
      h("span", { class: "hl" }, body.headline)),
    h("div", { class: "sec-b" }, body.el));
  d.addEventListener("toggle", () => { state.open[`${k}/${sec}`] = d.open; save(); });
  return d;
}

const empty = (text, ok) => h("p", { class: `st-empty${ok ? " ok" : ""}` }, text);
const scopeSpan = () => `since ${since()}`;
const more = (list, n, render, label) => {
  if (list.length <= n) return list.map(render);
  const rest = h("div", { class: "rest", hidden: true }, list.slice(n).map(render));
  const btn = h("button", { type: "button", class: "more-t", onclick: () => { rest.hidden = !rest.hidden; btn.textContent = rest.hidden ? `Show all ${list.length} ${label}` : "Show fewer"; } }, `Show all ${list.length} ${label}`);
  return [...list.slice(0, n).map(render), rest, btn];
};

const BODY = {
  needs(k) {
    const n = needsOf([k]), blocking = n.filter((x) => x.blocking).length;
    return {
      title: "Needs you", count: String(n.length), scope: "open now", tone: blocking ? "bad" : n.length ? "warn" : "ok",
      headline: n.length ? `${blocking} hold work up · oldest ${age(n[0].ago)}` : "Nothing waits on you",
      el: n.length ? [h("ul", { class: "lines ov-needs st-needs" }, n.map((w) => needLine(w, false))), h("a", { class: "more-t sec-link", href: "#waits" }, "Answer on Waits on you →")]
        : empty("Nothing waits on you.", true),
    };
  },
  done(k) {
    const d = doneOf([k]);
    const parts = [d.features.length && plural(d.features.length, "feature") + " Done", plural(d.sessions.length, "session") + " closed", plural(d.lands, "land"),
      d.releases.length && plural(d.releases.length, "release") + " closed"].filter(Boolean);
    const nothing = !d.sessions.length && !d.lands && !d.features.length;
    return {
      title: "What got done", count: String(d.sessions.length), scope: scopeSpan(), tone: null,
      headline: nothing ? `Nothing closed since ${since()}` : parts.join(" · "),
      el: nothing ? empty(`Nothing closed or landed since ${since()}.`) : [
        d.features.length || d.releases.length ? h("div", { class: "grp" }, h("h3", null, "Moved to Done"),
          h("ul", { class: "rows" }, d.releases.map((r) => h("li", null, badge("done", "release"), h("span", null, rec(r.ref), r.title.replace(/^R\d+ /, "")), h("time", null, clock(r.ago)))),
            d.features.map((f) => h("li", null, badge(f.bug ? "bug" : "done", f.bug ? "bug fixed" : "Done"), h("span", null, rec(f.ref), f.title), h("time", null, clock(f.ago)))))) : null,
        d.sessions.length ? h("div", { class: "grp" }, h("h3", null, "Sessions closed"),
          h("ul", { class: "rows sess" }, more(d.sessions, 5, sessionRow, "sessions"))) : null,
      ],
    };
  },
  stuck(k) {
    const s = stuckOf([k]), settled = settledOf([k]);
    const bad = s.filter((x) => x.sev === "bad");
    return {
      title: "What's stuck", count: String(s.length), scope: "open now", tone: bad.length ? "bad" : s.length ? "warn" : "ok",
      headline: s.length ? s.map((x) => x.label).join(" · ") : "Nothing stuck",
      el: [
        s.length ? h("ul", { class: "rows stuck" }, s.map((x) => h("li", { dataset: { sev: x.sev } },
          badge(x.sev === "bad" ? "failed" : "waiting", x.label),
          h("span", { class: "what" }, h("span", null, rec(x.ref), x.text), h("span", { class: "m" }, x.meta)),
          h("time", null, `since ${clock(x.ago)}`, inSpan(x.ago) ? null : h("span", { class: "before" }, `before ${since()}`))))) : empty("Nothing stuck.", true),
        settled.length ? h("details", { class: "settled" }, h("summary", null, `Settled since ${since()}: ${settled.length}`),
          h("ul", { class: "rows" }, settled.map((x) => h("li", null, badge("done", "settled"), h("span", null, x.text), h("time", null, clock(x.ago)))))) : null,
      ],
    };
  },
  recurring(k) {
    const r = recurringOf([k]);
    if (!r) return { title: "Recurring problems", count: "–", scope: "", tone: null, headline: "Comes with theme tags (BOB-35)",
      el: empty("Review findings get a theme when their session closes, from BOB-35 on. Until then this section has nothing to group.") };
    const sess = (s) => [rec(s.f), ` ${s.label}`];
    const sev = { blocker: "blocker", major: "major", finding: "retro" };
    const group = (t) => h("li", { dataset: { untagged: String(t.theme === "untagged") } },
      h("span", { class: "theme" }, t.theme),
      h("span", { class: "what" },
        h("span", null, `${plural(t.hits.length, "finding")} in ${plural(t.sessions.size, "session")} `,
          t.back ? h("span", { class: "back-tag" }, `came back: ${t.in30} sessions in 30 days`) : null,
          t.theme === "untagged" ? h("span", { class: "m" }, " Closed without a theme; never guessed.") : null),
        h("ul", { class: "hits" }, t.hits.sort((a, b) => a.s.ago - b.s.ago).map((x) => h("li", null, sess(x.s), `, ${sev[x.sev]}: ${x.text}`, h("span", { class: "m" }, ` · ${age(x.s.ago)}`))))));
    return {
      title: "Recurring problems", count: String(r.back), scope: `since ${since()} · repeats: 30 days`, tone: r.back ? "warn" : null,
      headline: r.findings || r.sentBack.length
        ? [r.back ? `${r.back} came back` : "Nothing came back", plural(r.findings, "finding"), r.tagged.length && plural(r.tagged.length, "theme"), r.untagged && `${r.untagged.hits.length} untagged`].filter(Boolean).join(" · ")
        : `No findings since ${since()}`,
      el: [
        h("div", { class: "grp" }, h("h3", null, "Blockers, majors and retro findings, by theme"),
          r.themes.length ? h("ul", { class: "rows rec" }, r.themes.map(group)) : empty(`None since ${since()}.`)),
        h("div", { class: "grp" }, h("h3", null, "Sent back twice or more"),
          r.sentBack.length ? h("ul", { class: "rows rec" }, r.sentBack.map((x) => h("li", null,
            h("span", { class: "times" }, `${x.times.length}×`),
            h("span", { class: "what" }, h("span", null, rec(x.ref), x.title),
              h("span", { class: "m" }, x.times.map(([s, a]) => `${s} (${age(a)})`).join(" · ")))))) : empty("None.")),
        h("p", { class: "note" }, "Each finding's theme is one of sixteen, picked by whoever closes the review or retro."),
      ],
    };
  },
  backlog(k) {
    const b = backlogOf(k);
    return {
      title: "Backlog health", count: b.thin ? "thin" : "OK", scope: "now", tone: b.thin ? "warn" : "ok",
      headline: `${plural(b.ready.length, "Ready feature")} with criteria, about ${plural(b.sessions, "session")} · ${b.triage.items} in triage`,
      el: [
        b.thin ? h("p", { class: "thin" }, `Thin: fewer than 2 Ready features with criteria, and ${b.release.ref} has ${b.release.left} more to do.`) : null,
        h("ul", { class: "rows health" },
          h("li", null, h("span", { class: "k" }, "Ready, with criteria"), h("span", null, `${plural(b.ready.length, "feature")}, about ${plural(b.sessions, "session")} of work`,
            h("span", { class: "m" }, b.ready.map(([r, n], i) => [i ? ", " : "", rec(r), `${n} criteria`])))),
          h("li", { dataset: { warn: String(b.noCriteria.some((x) => x[1] === "Ready")) } }, h("span", { class: "k" }, "No criteria yet"),
            b.noCriteria.length ? h("span", null, plural(b.noCriteria.length, "feature"), h("span", { class: "m" }, b.noCriteria.map(([r, st, t], i) => [i ? " · " : "", rec(r), `${t} (${st})`]))) : h("span", null, "None")),
          h("li", null, h("span", { class: "k" }, "In triage"), h("span", null, `${b.triage.items} items, ${plural(b.triage.bugs, "bug")}, the oldest ${b.triage.oldest} `, rec(b.triage.oldestRef))),
          h("li", null, h("span", { class: "k" }, "Open release"), h("span", null, rec(b.release.ref), `${b.release.title.replace(/^R\d+ /, "")}: ${b.release.left} features to do`)),
          b.nextEmpty ? h("li", { dataset: { warn: "true" } }, h("span", { class: "k" }, "Next release"), h("span", null, rec(b.nextEmpty.ref), `${b.nextEmpty.title.replace(/^R\d+ /, "")}: nothing Ready`)) : null),
      ],
    };
  },
  usage(k) {
    const u = usageOf([k]);
    const max = u.agents[0]?.n || 1;
    return {
      title: "Usage", count: tok(u.total), scope: scopeSpan(), tone: u.heavy.length ? "warn" : null,
      headline: [`${tok(u.total)} tokens`, u.lost && unknown(u.lost), u.heavy.length && plural(u.heavy.length, "heavy session")].filter(Boolean).join(" · "),
      el: [
        u.agents.length ? h("ul", { class: "rows usage" }, u.agents.map((a) => h("li", null,
          h("span", { class: "who-u" }, h("b", null, a.who), h("span", { class: "m" }, S.roles[a.who])),
          h("span", { class: "meter" }, a.n ? h("i", { style: `width:${Math.max(2, (a.n / max) * 100)}%` }) : null),
          h("span", { class: "num" }, a.n ? tok(a.n) : null, a.lost ? h("span", { class: "unk" }, `${a.n ? "+ " : ""}${plural(a.lost, "run")} unknown`) : null)))) : empty(`No runs ended since ${since()}.`),
        u.lost ? h("p", { class: "note" }, `${unknown(u.lost)}: ${u.lost === 1 ? "it was" : "they were"} running when the supervisor restarted, so ${u.lost === 1 ? "its" : "their"} use was never reported. Not counted as zero.`) : null,
        u.heavy.length ? h("div", { class: "grp" }, h("h3", null, "Heavier than usual"),
          h("ul", { class: "rows" }, u.heavy.map((s) => h("li", { dataset: { sev: "warn" } }, badge("waiting", `${s.x.toFixed(1)}×`),
            h("span", null, rec(s.f), `${s.label} · ${s.who}: ${tok(s.tokens)} tokens, a ${s.kind}'s usual is ${tok(S.usual[s.kind])}`), h("time", null, clock(s.ago)))))) : null,
        u.running.length ? h("div", { class: "grp" }, h("h3", null, "Running now"), h("p", { class: "note" }, "From the laptops. Counted above when each run ends."),
          h("ul", { class: "rows running" }, u.running.map((r) => h("li", null, h("span", { class: "dot on" }), h("span", null, h("b", null, r.who), ` ${S.roles[r.who]}`), h("span", { class: "num" }, `${tok(r.n)} so far`))))) : null,
      ],
    };
  },
};

function sessionRow(s) {
  const finds = [s.blockers && plural(s.blockers, "blocker"), s.majors && plural(s.majors, "major"), s.sentBack && `${s.sentBack} sent back`, s.minors && `${plural(s.minors, "minor")} fixed`].filter(Boolean);
  const heavy = s.tokens > 2 * S.usual[s.kind];
  return h("li", { class: "srow", style: `--k: var(--k-${s.kind})` },
    h("span", { class: "kind" }, s.kind),
    h("span", { class: "what" },
      h("span", null, rec(s.f), h("b", null, s.label), ` · ${s.who}`),
      h("span", { class: "outcome" }, h("span", { class: "need", dataset: { need: s.need } }, s.need === "casper" ? "needs you" : s.need === "answer" ? "waited on an answer" : "need none"),
        finds.length ? h("span", null, finds.join(", ")) : null,
        h("span", { class: `tk${heavy ? " heavy" : ""}` }, `${tok(s.tokens)} tokens`)),
      h("span", { class: "sum" }, s.summary)),
    h("time", null, clock(s.ago)));
}

/* The Overview, as it is, with the one line that links here (Q-2). */
function overview() {
  const ps = S.projects.map((p) => p.key);
  const v = verdict(ps), n = needsOf(ps);
  const d = doneOf(ps);
  const [, sub] = spanWords();
  return h("div", { class: "ov" },
    h("a", { class: "st-line banner", href: "#status", dataset: { tone: v.tone } },
      h("span", null, h("b", null, state.span === "visit" && state.anchor != null ? `Since ${clock(state.anchor)}` : `Since ${since()}`), state.anchor ? ` (${age(state.anchor)} ago)` : "", ": ",
        `${d.sessions.length} done, ${verdict(ps).stuck} stuck`, v.ci ? ", CI red on Helix" : ""),
      h("span", { class: "go" }, "Status ›")),
    h("section", { class: "ov-needs" }, h("h2", null, "Needs you ", h("span", { class: "count" }, String(n.length))),
      h("div", { class: "card" }, h("ul", { class: "lines st-needs" }, n.slice(0, 3).map((w) => needLine(w, true))),
        h("p", { class: "more" }, `${n.filter((x) => x.blocking).length} hold work up · ${n.filter((x) => !x.blocking).length} when you have time →`))),
    h("section", null, h("h2", null, "Working now ", h("span", { class: "count" }, "4")),
      h("div", { class: "card" }, h("ul", { class: "lines" },
        [["Howard", "engineer", "waiting on you", "Helix · LAND-49 Fixes 3", "warn"], ["Marvin", "tester", "working", "Helix · LAND-49.21 land", "on"],
          ["Daisy", "designer", "working", "BobNet · BOB-33 Prototype", "on"], ["Mario", "lead", "working", "BobNet", "on"]].map(([who, role, st, where, dot]) =>
          h("li", null, h("span", null, h("span", { class: `dot ${dot}` }), h("b", null, who), ` ${role} · ${st}`), h("span", { class: "l-m" }, where)))))),
    h("p", { class: "note proto-only" }, "The Overview is unchanged (BOB-1, BOB-31) except the line at the top. ", sub));
}

function stub(name) {
  return h("div", { class: "empty-card" }, `${name}: not part of this prototype. `, h("a", { href: "#status" }, "Back to Status"));
}

/* The prototype's own bar: which device, broker up or down, reset. Not part of the design. */
function protoBar() {
  const seg = (label, key, opts) => h("span", { class: "pb-g" }, label, h("span", { class: "seg" }, opts.map(([v, t]) => h("button", { type: "button", "aria-pressed": String(state[key] === v),
    onclick: () => { state[key] = v; if (key === "device") { state.anchor = v === "first" ? null : S.lastVisit; state.span = v === "first" ? "24h" : "visit"; } save(); render(); } }, t))));
  return h("div", { class: "proto-bar" },
    h("span", null, h("b", null, "Prototype BOB-33"), " · sample shaped like BobNet's and Helix's boards, Mon 16 Nov 06:12"),
    seg("Device", "device", [["returning", "last visit 23:10"], ["first", "first visit"]]),
    seg("Broker", "broker", [["live", "live"], ["down", "down"]]),
    seg("Ships", "ships", [["all", "with BOB-35, 36"], ["33", "BOB-33 only"]]),
    h("button", { type: "button", class: "more-t", onclick: () => { sessionStorage.removeItem(KEY); Object.assign(state, structuredClone(START)); render(); } }, "Reset the prototype"));
}

function render() {
  const route = location.hash.slice(1) || "status";
  const [tab, k, sec] = route.split("/");
  for (const a of document.querySelectorAll("#tabs a")) a.toggleAttribute("aria-current", a.getAttribute("href") === `#${tab}`);
  document.getElementById("waits-count").textContent = String(S.needs.length);
  const st = document.querySelector('#tabs a[href="#status"]');
  const newCount = doneOf(S.projects.map((p) => p.key)).sessions.length + S.stuck.filter((x) => inSpan(x.ago)).length;
  st.dataset.new = String(state.span === "visit" && newCount > 0);
  const down = state.broker === "down";
  const conn = document.getElementById("conn");
  conn.dataset.state = down ? "down" : "live"; conn.textContent = down ? "offline" : "live";
  const main = document.getElementById("view");
  main.classList.toggle("wide", tab === "status");
  let view;
  if (tab === "status") view = !k || k === "needs" ? digest() : projectPage(k, sec);
  else if (tab === "overview") view = overview();
  else view = stub(document.querySelector(`#tabs a[href="#${tab}"]`)?.firstChild?.textContent?.trim() ?? tab);
  main.replaceChildren(...[protoBar(),
    down ? h("div", { class: "banner down" }, "Can't reach the broker since 06:04. This is what this device read then; I'm caught up still works.") : null,
    view].filter(Boolean));
  paintToast();
  if (k === "needs") document.getElementById("needs")?.scrollIntoView();
  if (sec) document.getElementById(`sec-${sec}`)?.scrollIntoView();
}

addEventListener("hashchange", render);
addEventListener("DOMContentLoaded", render);
