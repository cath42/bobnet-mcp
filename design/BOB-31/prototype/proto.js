// BOB-31 prototype: a cut question opens in place (spec.md). Static sample; reload resets, except what
// is open, which is kept in sessionStorage as the build keeps it. Works from file://.
"use strict";

const OPEN = "bobnet.open"; // Needs you lines shown whole, and Waits items with their context open: ids
const load = () => { try { return new Set(JSON.parse(sessionStorage.getItem(OPEN) ?? "[]")); } catch { return new Set(); } };
const state = { open: load(), answering: null };
const save = () => sessionStorage.setItem(OPEN, JSON.stringify([...state.open]));

// The sample: BobNet's Q-1 as it was asked, with a context; a short question; a permission; a review gate; an action.
const waits = [
  {
    id: "bobnet/Q-1", kind: "question", ref: "Q-1", project: "BobNet", feature: "BOB-3", blocking: true, holds: "Luigi (build 2)", from: "Mario", age: "2h",
    text: "BOB-3 AC 8 says a Helix-sized board stays fast on a phone, checked on Helix's board. Helix's board isn't in the service until BOB-9 (at Picard's date). Accept the broker's Helix-sized scale test (reads 3-14 ms) plus a phone shot on a Helix-sized fixture now, or hold AC 8 (and so BOB-3) until BOB-9?",
    recommended: "Accept the scale test + a phone shot on a Helix-sized fixture now; BOB-3 can close",
    options: [["fixture", "Accept the scale test + a phone shot on a Helix-sized fixture now; BOB-3 can close", true], ["hold", "Hold AC 8 until Helix's real board is in the service (BOB-9)", false]],
    context: "The scale test seeds 700 tasks, 30 features and 3 releases (Helix's size at 282cca2fe) and reads the roadmap, a feature and triage 50 times each: 3-14 ms per read on the broker.\nThe phone shot would be the roadmap at 390 px on that fixture, unfolded.\nBOB-9 moves Helix's board in at Picard's date, which isn't set.",
  },
  {
    id: "bobnet/Q-7", kind: "question", ref: "Q-7", project: "BobNet", feature: "BOB-29", blocking: true, holds: "BOB-29", from: "Peach", age: "40m",
    text: "Ship BOB-29 before BOB-30?", recommended: "Yes, BOB-29 first", options: [["yes", "Yes, BOB-29 first", true], ["no", "No, BOB-30 first", false]], context: null,
  },
  {
    id: "perm/mbp-1/r-412", kind: "permission", project: "Helix", feature: "LAND-49", blocking: true, holds: "Howard (Fixes)", age: "6m",
    text: "Howard asks: The e2e run on staging fails on the map tiles because the tile server's key rotated last night. Should I point the e2e config at the new key from the team vault, or skip the map step in e2e until Picard has checked the rotation with the ops channel?",
  },
  { id: "bobnet/BOB-5", kind: "review_gate", ref: "BOB-5", project: "BobNet", feature: "BOB-5", blocking: true, holds: "BOB-5", age: "1d", text: "Overview: Now leaves the tabs" },
  {
    id: "helix/A-12", kind: "action", ref: "A-12", project: "Helix", feature: "LAND-52", blocking: false, from: "Picard", age: "3d", before: "release 2",
    text: "Sign the Mapbox terms for the commercial plan on the company account, so the tiles keep working once Helix leaves the free tier.\nThe link is in Helix's lead/questions.md under A-12.",
    context: "Free tier: 50,000 map loads a month. Helix used 41,200 in October.",
  },
];
const KIND = { question: ["question", "question"], action: ["action", "action"], review_gate: ["review", "review gate"], permission: ["permission", "permission"] };
const VERB = { question: "Answer", action: "Mark done", permission: "Allow or deny" };

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

function toggle(id) {
  state.open.has(id) ? state.open.delete(id) : state.open.add(id);
  save();
  render();
}

/** Show all / Show less: hidden until the text is measured as cut (measure()); shown while the line is open. */
const moreBtn = (w, open) => h("button", { type: "button", class: "more-t", "aria-expanded": String(open), "aria-controls": `t-${w.id}`, hidden: !open || null,
  "aria-label": `${open ? "Show less of" : "Show all of"} ${w.ref ?? "the request"}`, onclick: () => toggle(w.id) }, open ? "Show less" : "Show all");

function answerBtn(w) {
  const open = state.answering?.id === w.id;
  return h("button", { type: "button", class: "answer-btn", "aria-expanded": String(open), onclick: () => {
    state.answering = open ? null : { id: w.id, words: "", pick: null };
    // Opening the form opens the question whole: he answers what he has read.
    if (!open) { state.open.add(w.id); save(); }
    render();
    if (!open) document.querySelector("form.answer textarea")?.focus();
  } }, open ? "Close" : VERB[w.kind]);
}

function form(w) {
  const a = state.answering;
  const words = h("textarea", { rows: 2, placeholder: "Write what you want them to read.", oninput: (e) => (a.words = e.target.value) });
  words.value = a.words;
  return h("form", { class: "answer", onsubmit: (e) => e.preventDefault() },
    w.options ? h("fieldset", null, h("legend", null, "Pick one"), w.options.map(([k, t, rec]) => h("label", { class: "opt-row" },
      h("input", { type: "radio", name: `o-${w.id}`, checked: a.pick === k || null, onchange: () => (a.pick = k) }), h("span", null, t, rec ? h("span", { class: "rec-tag" }, "recommended") : null)))) : null,
    h("label", { class: "words" }, h("span", null, w.options ? "Your words (optional with an option; enough on their own)" : "Your answer"), words),
    h("div", { class: "foot" }, h("span", { class: "who-gets" }, `Recorded on ${w.ref} as yours, word for word; Mario, BobNet's lead, gets a message.`),
      h("button", { type: "button", onclick: () => { state.answering = null; render(); } }, "Cancel"), h("button", { type: "submit", class: "primary" }, "Send answer")));
}

function needsLine(w) {
  const open = state.open.has(w.id);
  const [st, label] = KIND[w.kind];
  return h("li", { class: `hold${open ? " open" : ""}`, dataset: { id: w.id } }, badge(st, label),
    h("span", { class: "l-t", id: `t-${w.id}`, title: open ? null : w.text, onclick: (e) => {
      // The cut text opens it too, but never while he is selecting it.
      if (!e.currentTarget.hasAttribute("data-cut") && !open) return;
      if (String(getSelection())) return;
      toggle(w.id);
    } }, w.text),
    open && (w.recommended || w.context) ? h("div", { class: "whole" },
      w.recommended ? h("div", { class: "rec" }, h("b", null, "Recommended "), w.recommended) : null,
      w.context ? h("a", { href: "#waits", class: "more-t", onclick: () => { state.open.add(`ctx:${w.id}`); save(); } }, "Its context, on Waits on you →") : null) : null,
    h("span", { class: "l-m" }, `${w.project} · ${w.feature} · holds up ${w.holds}`),
    h("span", { class: "acts" }, moreBtn(w, open), VERB[w.kind] ? answerBtn(w) : null),
    state.answering?.id === w.id ? form(w) : null);
}

function waitItem(w) {
  const [st, label] = KIND[w.kind];
  const ctxOpen = state.open.has(`ctx:${w.id}`), answering = state.answering?.id === w.id;
  return h("li", { dataset: { blocking: String(w.blocking), kind: w.kind } },
    h("div", { class: "top" }, badge(st, label), w.ref ? h("span", { class: "id" }, w.ref) : null, h("span", { class: "muted" }, `${w.project} · `, h("a", { href: "#" }, w.feature)), h("span", { class: "age" }, w.age)),
    h("div", { class: "q" }, w.text),
    w.recommended ? h("div", { class: "rec" }, "Recommended: ", w.recommended) : null,
    w.context ? h("div", { class: "ctx-row" },
      h("button", { type: "button", class: "more-t", "aria-expanded": String(ctxOpen), "aria-controls": `c-${w.id}`, onclick: () => toggle(`ctx:${w.id}`) }, ctxOpen ? "Hide context" : "Show context"),
      ctxOpen ? h("div", { class: "ctx", id: `c-${w.id}` }, w.context) : null) : null,
    h("div", { class: "meta" },
      w.blocking ? h("span", { class: "holds" }, `Holds up ${w.holds}`) : h("span", { class: "before" }, "Needed before ", h("a", { href: "#" }, w.before)),
      w.from ? h("span", null, `from ${w.from}`) : null,
      VERB[w.kind] && !answering ? answerBtn(w) : null),
    answering ? form(w) : null);
}

function viewOverview() {
  const holding = waits.filter((w) => w.blocking);
  return h("div", { class: "ov" },
    h("section", { class: "ov-needs" }, h("h2", null, "Needs you ", h("span", { class: "count" }, waits.length)),
      h("div", { class: "card" }, h("ul", { class: "lines", id: "needs" }, holding.map(needsLine)),
        h("a", { class: "more", href: "#waits" }, `${holding.length} hold work up · ${waits.length - holding.length} more when you have time →`))),
    h("section", { class: "ov-now" }, h("h2", null, "Working now ", h("span", { class: "count" }, "2")),
      h("div", { class: "card" }, h("ul", { class: "lines now-list" },
        h("li", null, h("span", null, h("span", { class: "dot on" }), h("b", null, "Luigi"), " ", h("span", { class: "muted" }, "engineer · 412k tokens"))),
        h("li", null, h("span", null, h("span", { class: "dot warn" }), h("b", null, "Howard"), " ", h("span", { class: "muted" }, "Fixes · waiting on you · 96k tokens")))))));
}

function viewWaits() {
  const blocking = waits.filter((w) => w.blocking), rest = waits.filter((w) => !w.blocking);
  return [
    h("section", null, h("h2", null, "Holds work up ", h("span", { class: "count" }, blocking.length)), h("ul", { class: "list waits" }, blocking.map(waitItem))),
    h("section", null, h("h2", null, "When you have time ", h("span", { class: "count" }, rest.length)), h("ul", { class: "list waits" }, rest.map(waitItem))),
  ];
}

/** After each draw and on resize: a line whose text overflows its one line (two on a phone) is cut, and gets Show all. */
function measure() {
  for (const li of document.querySelectorAll("#needs > li")) {
    if (li.classList.contains("open")) continue;
    const t = li.querySelector(".l-t");
    const cut = t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1;
    t.toggleAttribute("data-cut", cut);
    li.querySelector(".more-t").hidden = !cut;
  }
}

function render() {
  const v = location.hash.slice(1) || "overview";
  const view = document.getElementById("view");
  // Keep the caret in the answer box across a draw, as the build does.
  const box = document.activeElement?.closest?.("form.answer") ? document.activeElement : null;
  const at = box?.selectionStart;
  view.classList.toggle("wide", v === "overview");
  view.replaceChildren(...[v === "waits" ? viewWaits() : viewOverview()].flat());
  for (const a of document.querySelectorAll("#tabs a")) a.toggleAttribute("aria-current", a.getAttribute("href") === `#${v}`);
  document.getElementById("waits-count").textContent = waits.length;
  measure();
  if (box) { const b = view.querySelector("form.answer textarea"); b?.focus(); if (at !== undefined) b?.setSelectionRange(at, at); }
}

addEventListener("hashchange", render);
addEventListener("resize", measure);
render();
// The page draws again every few seconds, as the live dashboard does: what is open stays open.
setInterval(render, 5000);
