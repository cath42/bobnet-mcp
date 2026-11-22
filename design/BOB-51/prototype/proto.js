// BOB-51 prototype: a permission shown whole, decided permissions on Waits, a note sent with Allow (spec.md).
// Static sample; reload resets, except what is open (sessionStorage, as the build keeps state.whole). Works from file://.
"use strict";

const WHOLE = "bobnet.whole";
const load = () => { try { return new Set(JSON.parse(sessionStorage.getItem(WHOLE) ?? "[]")); } catch { return new Set(); } };
const state = { whole: load(), agentOpen: "w-riker", answering: null, words: "" };
const save = () => sessionStorage.setItem(WHOLE, JSON.stringify([...state.whole]));

const CMD = `cd ~/Code/helix-howard && pnpm --filter @helix/land exec playwright test e2e/map.spec.ts \\
  --project=chromium --retries=0 --reporter=line \\
  --grep "tiles render after key rotation" 2>&1 | tee /tmp/land-49-e2e.log
# then clear the stale tile cache the old key left behind
rm -rf apps/land/.cache/tiles/* apps/land/.cache/mapbox-sprites
git -C ~/Code/helix-howard stash push -u -m "land-49-before-e2e" -- apps/land/.env.e2e
sed -i '' 's/^MAPBOX_TOKEN=.*/MAPBOX_TOKEN=\${MAPBOX_TOKEN_2026_11}/' apps/land/.env.e2e
pnpm --filter @helix/land exec playwright test e2e/map.spec.ts --project=webkit --retries=0`;

// Pending requests as the snapshot will carry them: preview (≤400) kept, ask added (Toad, BOB-51).
const pending = [
  {
    id: "r-412", worker_id: "w-howard", name: "Howard", laptop: "mbp-1", project: "Helix", feature: "LAND-49", step: "build A",
    kind: "approval", tool: "Bash", tier: "human", age: "6m",
    preview: CMD.slice(0, 399) + "…",
    ask: { text: CMD, cut: false, questions: [] },
  },
  {
    id: "r-418", worker_id: "w-riker", name: "Riker", laptop: "ubu1", project: "Helix", feature: "LAND-52", step: "design A",
    kind: "question", tool: "AskUserQuestion", tier: "orchestrator", age: "3m",
    preview: "The map tiles on the plan page load the free-tier style. Before I spec the commercial plan's map, which style should the plan page use, and should the satellite toggle stay?",
    ask: {
      cut: false,
      text: "The map tiles on the plan page load the free-tier style. Before I spec the commercial plan's map, which style should the plan page use, and should the satellite toggle stay?",
      questions: [
        {
          header: "Map style", multi: false,
          question: "The map tiles on the plan page load the free-tier style. Before I spec the commercial plan's map, which style should the plan page use, and should the satellite toggle stay?",
          options: [
            { label: "Helix Light (custom)", description: "Our own style from the brand kit: muted roads, parcels outlined in the accent colour. Needs the commercial plan's style hosting." },
            { label: "Mapbox Streets", description: "The default. Busy at parcel zoom; labels fight the parcel outlines." },
            { label: "Mapbox Outdoors", description: "Shows terrain, which buyers of rural plots ask for. Heavier tiles on a phone." },
          ],
        },
        {
          header: "Satellite", multi: true,
          question: "Where should the satellite toggle show?",
          options: [
            { label: "Plan page", description: "Next to the zoom buttons, as today." },
            { label: "Parcel detail", description: "Only once a parcel is picked." },
          ],
        },
      ],
    },
  },
];
const workers = [
  { id: "w-howard", name: "Howard", role: "engineer", project: "Helix", feature: "LAND-49", step: "build A", task: "LAND-61", title: "Map tiles after key rotation", state: "waiting", tokens: "1.4M", laptop: "mbp-1", model: "Opus 5.5", worked: "48m" },
  { id: "w-riker", name: "Riker", role: "designer", project: "Helix", feature: "LAND-52", step: "design A", task: "LAND-52", title: "Commercial map plan", state: "waiting", tokens: "612k", laptop: "ubu1", model: "Opus 5.5", worked: "21m" },
  { id: "w-luigi", name: "Luigi", role: "engineer", project: "BobNet", feature: "BOB-51", step: "build A", task: "BOB-32", title: "Permission shown whole", state: "working", tokens: "2.1M", laptop: "mbp-1", model: "Opus 5.5", worked: "1h 12m" },
];
const waits = [
  { id: "bobnet/Q-7", ref: "Q-7", project: "BobNet", feature: "BOB-29", holds: "Luigi (build A)", age: "40m", text: "Ship BOB-29 before BOB-30?" },
];
// Today's answers from here: the board's, and the laptops' decided (newest first).
const answered = [
  { perm: true, decision: "allow", name: "Howard", tool: "Bash", project: "Helix", laptop: "mbp-1", at: "14:02", preview: "pnpm --filter @helix/land test -- --run map", note: "Fine. Run only the map suite; the full e2e is Data's next session." },
  { perm: false, ref: "Q-5", project: "BobNet", at: "11:40", text: "Keep the stale banner on Waits too?", option: "Yes, on Overview and Waits", words: null, lead: "Mario" },
  { perm: true, decision: "deny", name: "Data", tool: "WebFetch", project: "Helix", laptop: "ubu1", at: "09:15", preview: "https://api.mapbox.com/tokens/v2?access_token=[hidden]", note: null },
];

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
const badge = (st, text) => h("span", { class: "badge", dataset: { state: st } }, text);
const permId = (p) => `perm/${p.laptop}/${p.id}`;
const toggleWhole = (id) => { state.whole.has(id) ? state.whole.delete(id) : state.whole.add(id); save(); render(); };
let toastTimer;
function toast(text, ok = true) {
  const t = document.getElementById("toast");
  t.replaceChildren(h("div", { class: "toast", dataset: { ok: String(ok) } }, text));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.replaceChildren(), 6000);
}

/**
 * The ask block (spec 1): an approval's whole command, or every question with its header, Pick one/any and
 * options. Folded: the first question, or the command, clamped; no options. No ask: the preview, as today.
 */
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
  return h("div", { class: `ask${open ? "" : " folded"}`, id: `ask-${permId(p)}` }, body,
    a.cut ? h("span", { class: "cutnote" }, "Cut at the laptop: too long to send whole.") : null);
}
/** Show all under an ask block: always for a question with options; for a command only when measured as cut. */
const askMore = (p, open, extra = "") => h("button", { type: "button", class: `more-t ask-more${extra}`, "aria-expanded": String(open), "aria-controls": `ask-${permId(p)}`,
  hidden: !open && !p.ask?.questions.length ? true : null, dataset: !open && !p.ask?.questions.length ? { measure: "1" } : null,
  "aria-label": `${open ? "Show less" : "Show all"} of ${p.name}'s ${p.kind === "question" ? "question" : "request"}`,
  onclick: (e) => { e.stopPropagation(); toggleWhole(permId(p)); } }, open ? "Show less" : "Show all");

// ---------- Overview ----------

function permissionLine(p) {
  const id = permId(p), open = state.whole.has(id);
  const text = p.kind === "question" ? `${p.name} asks: ${p.ask?.questions[0]?.question ?? p.preview}` : [`${p.name} wants ${p.tool}: `, h("code", null, p.ask?.text ?? p.preview)];
  return h("li", { class: `hold${open ? " open" : ""}`, dataset: { id } }, badge("permission", "permission"),
    h("span", { class: "l-t", id: `t-${id}`, onclick: (e) => { if (!open && e.currentTarget.hasAttribute("data-cut")) toggleWhole(id); } }, text),
    open && p.ask?.cut ? h("div", { class: "whole" }, h("span", { class: "cutnote muted" }, "Cut at the laptop: too long to send whole.")) : null,
    h("span", { class: "l-m" }, `${p.project} · ${p.feature} · holds up ${p.name} (${p.step})`),
    h("span", { class: "acts" },
      h("button", { type: "button", class: "more-t", hidden: !open || null, "aria-expanded": String(open), "aria-controls": `t-${id}`, onclick: () => toggleWhole(id) }, open ? "Show less" : "Show all"),
      h("button", { type: "button", class: "answer-btn", onclick: () => { location.hash = "#waits"; state.answering = id; render(); } }, "Allow or deny")));
}
function waitLine(w) {
  return h("li", { class: "hold", dataset: { id: w.id } }, badge("waiting", "question"),
    h("span", { class: "l-t", id: `t-${w.id}` }, w.text),
    h("span", { class: "l-m" }, `${w.project} · ${w.feature} · holds up ${w.holds}`),
    h("span", { class: "acts" }, h("button", { type: "button", class: "more-t", hidden: true }, "Show all"), h("button", { type: "button", class: "answer-btn" }, "Answer")));
}

function agentDetail(w) {
  const p = pending.find((x) => x.worker_id === w.id && x.tier !== "human");
  const open = p && state.whole.has(permId(p));
  return h("div", { class: "a-detail" },
    h("span", { class: "muted" }, `${w.model} · ${w.laptop} · worked ${w.worked} · context 84k · 61 calls`),
    p ? [h("div", { class: "ask-h" }, h("b", null, p.kind === "question" ? `${w.name} asks` : `${w.name} wants ${p.tool}`),
        h("span", { class: "muted" }, ` · ${p.age} · the orchestrator answers`)),
      askBlock(p, open), askMore(p, open)] : null,
    h("div", { class: "actions groups" },
      p ? h("span", { class: "grp" }, h("button", { type: "button", class: "primary" }, "Allow"), h("button", { type: "button", class: "danger" }, "Deny")) : null,
      h("span", { class: "grp" }, h("button", { type: "button", class: "danger" }, "Stop"), h("button", { type: "button" }, "Reset"))));
}
function nowLine(w) {
  const open = state.agentOpen === w.id;
  const toggle = () => { state.agentOpen = open ? null : w.id; render(); };
  const st = w.state === "waiting" ? h("span", { class: "a-st warn" }, "waiting") : null;
  return h("li", { class: `a-line${open ? " open" : ""}`, dataset: { worker: w.id } },
    h("div", { class: "a-btn", role: "button", tabindex: "0", "aria-expanded": String(open), onclick: toggle },
      h("span", { class: "l-who" }, h("i", { class: `dot ${st ? "warn" : "on"}`, "aria-hidden": "true" }), w.name, h("span", { class: "muted" }, ` ${w.role}`)),
      h("span", { class: "l-path" }, h("span", { class: "muted" }, `${w.project} › `), h("a", { class: "id" }, w.feature), h("span", { class: "muted" }, `${w.step} › `),
        h("a", { class: "l-task" }, h("span", { class: "id" }, w.task), w.title)),
      h("span", { class: "l-m" }, st ? [st, " · "] : null, `${w.tokens} tokens`)),
    open ? agentDetail(w) : null);
}

function viewOverview() {
  const perms = pending.filter((p) => p.tier === "human");
  return h("div", { class: "ov" },
    h("section", { class: "ov-needs" }, h("h2", null, "Needs you ", h("span", { class: "count" }, perms.length + waits.length)),
      h("div", { class: "card" }, h("ul", { class: "lines", id: "needs" }, perms.map(permissionLine), waits.map(waitLine)),
        h("a", { class: "more", href: "#waits" }, "Waits on you →"))),
    h("section", { class: "ov-now" }, h("h2", null, "Working now ", h("span", { class: "count" }, workers.length)),
      h("div", { class: "card" }, h("ul", { class: "lines now-list", id: "working" }, workers.map(nowLine)))));
}

// ---------- Waits on you ----------

function permissionForm(p) {
  const close = () => { state.answering = null; state.words = ""; render(); };
  const what = `${p.name}'s ${p.kind === "question" ? "question" : p.tool}`;
  const decide = (decision) => {
    const note = state.words.trim();
    if (decision === "allow" && !confirm(`Allow ${p.name} to run ${p.tool}?\n\n${p.preview}${note ? "\n\nYour note goes with it." : ""}`)) return;
    toast(decision === "allow" ? `Allowed ${what}${note ? `; your note went to ${p.name}` : ""}.` : `Denied ${what}${note ? `; your note went to ${p.name}` : ""}.`);
    close();
  };
  return h("form", { class: "answer", onsubmit: (e) => e.preventDefault() },
    h("label", { class: "words" }, h("span", null, `Note to ${p.name} (optional)`),
      h("textarea", { rows: 2, placeholder: "e.g. fine, but use the pool's stop script next time", oninput: (e) => (state.words = e.target.value) }, state.words)),
    h("div", { class: "foot" },
      h("span", { class: "who-gets" }, p.kind === "question" ? `Answer it through the orchestrator, or deny it here; ${p.name} gets your note. It can't be taken back.`
        : `${p.name} gets your decision, and your note as its next message. It can't be taken back.`),
      h("button", { type: "button", onclick: close }, "Cancel"),
      h("button", { type: "button", class: "danger", onclick: () => decide("deny") }, "Deny"),
      p.kind === "question" ? null : h("button", { type: "button", class: "primary", onclick: () => decide("allow") }, "Allow")));
}
function permItem(p) {
  const id = permId(p), answering = state.answering === id, open = state.whole.has(id);
  return h("li", { id: `w-${id}`, dataset: { blocking: "true", kind: "permission" } },
    h("div", { class: "top" }, badge("permission", "permission"), h("span", { class: "muted" }, `${p.project} · `, h("a", null, p.feature)), h("span", { class: "age" }, p.age)),
    h("div", { class: "q" }, p.kind === "question" ? `${p.name} asks` : `${p.name} wants ${p.tool}`),
    askBlock(p, open || p.kind === "question"), askMore(p, open),
    h("div", { class: "meta" }, h("span", { class: "holds" }, `Holds up ${p.name} (${p.step})`), h("span", null, `on ${p.laptop}`),
      answering ? null : h("button", { type: "button", class: "answer-btn", onclick: () => { state.answering = id; render(); } }, "Allow or deny")),
    answering ? permissionForm(p) : null);
}
function waitItem(w) {
  return h("li", { dataset: { blocking: "true", kind: "question" } },
    h("div", { class: "top" }, badge("waiting", "question"), h("span", { class: "id" }, w.ref), h("span", { class: "muted" }, w.project), h("span", { class: "age" }, w.age)),
    h("div", { class: "q" }, w.text),
    h("div", { class: "meta" }, h("span", { class: "holds" }, `Holds up ${w.holds}`), h("button", { type: "button", class: "answer-btn" }, "Answer")));
}
/** A row of Answered from here today: a board answer, or a permission decided from here (spec 2; no Undo). */
function answeredItem(x) {
  if (!x.perm) return h("li", { class: "answered" },
    h("div", { class: "top" }, badge("done", "answered"), h("span", { class: "id" }, x.ref), h("span", { class: "muted" }, x.project), h("span", { class: "age" }, `today ${x.at}`)),
    h("div", { class: "q" }, x.text),
    h("div", { class: "said" }, h("div", null, h("span", { class: "muted" }, "You picked "), x.option)),
    h("div", { class: "meta" }, h("span", null, `${x.lead} got a message`), h("span", null, "from the dashboard")));
  const allow = x.decision === "allow";
  return h("li", { class: "answered", dataset: { decision: x.decision } },
    h("div", { class: "top" }, badge(allow ? "done" : "failed", allow ? "allowed" : "denied"), h("span", { class: "id" }, x.tool), h("span", { class: "muted" }, x.project), h("span", { class: "age" }, `today ${x.at}`)),
    h("div", { class: "q" }, `${x.name} wanted ${x.tool}: ${x.preview}`),
    h("div", { class: "said" }, h("div", null, allow ? "You allowed it" : "You denied it"), x.note ? h("blockquote", null, `“${x.note}”`) : null),
    h("div", { class: "meta" }, h("span", null, x.note ? (allow ? `${x.name} got your note as its next message` : `${x.name} got your decision and note`) : `${x.name} got your decision`), h("span", null, `on ${x.laptop}`)));
}
function viewWaits() {
  const perms = pending.filter((p) => p.tier === "human");
  return [
    h("section", { id: "waits-holding" }, h("h2", null, "Holds work up ", h("span", { class: "count" }, perms.length + waits.length)),
      h("ul", { class: "list waits" }, perms.map(permItem), waits.map(waitItem))),
    h("section", { id: "waits-answered" }, h("h2", null, "Answered from here today ", h("span", { class: "count" }, answered.length)),
      h("ul", { class: "list waits" }, answered.map(answeredItem))),
  ];
}

// ---------- Draw ----------

/** Folded text measured as cut gets its Show all (BOB-31's measureNeeds, and the same for a clamped command). */
function measure() {
  for (const li of document.querySelectorAll("#needs > li:not(.open)")) {
    const t = li.querySelector(".l-t");
    const cut = t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1;
    t.toggleAttribute("data-cut", cut);
    li.querySelector(".acts .more-t").hidden = !cut;
  }
  for (const b of document.querySelectorAll("button.ask-more[data-measure]")) {
    const c = document.getElementById(b.getAttribute("aria-controls"))?.querySelector(".preview, .qt");
    b.hidden = !(c && c.scrollHeight > c.clientHeight + 1);
  }
}
function render() {
  const tab = location.hash === "#waits" ? "waits" : "overview";
  for (const a of document.querySelectorAll("#tabs a")) a.toggleAttribute("aria-current", a.getAttribute("href") === `#${tab}`);
  document.getElementById("waits-count").textContent = String(pending.filter((p) => p.tier === "human").length + waits.length);
  const ta = document.activeElement?.tagName === "TEXTAREA" ? document.activeElement : null;
  const caret = ta ? [ta.selectionStart, ta.selectionEnd] : null;
  document.getElementById("view").replaceChildren(...[tab === "waits" ? viewWaits() : viewOverview()].flat());
  if (caret) { const t = document.querySelector("form.answer textarea"); t?.focus(); t?.setSelectionRange(...caret); }
  measure();
}
addEventListener("hashchange", render);
addEventListener("resize", measure);
render();
setInterval(render, 5000); // the live dashboard draws again on every report
