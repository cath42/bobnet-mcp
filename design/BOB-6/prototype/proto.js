// BOB-6 prototype: Start a session from the feature page (design/BOB-6/spec.md). Static sample (data.js); works
// from file:// and from any static host. Everything is reached by tapping: the bar at the top picks a scenario,
// says whether the supervisor is online, and plays its answer to a pending request. "Reset" puts it all back.
"use strict";

const S = window.SAMPLE;
const KEY = "bobnet.bob6.proto";
const CAP = 16384;
const fresh = () => ({ sc: "offered", sup: "online", reqs: {}, drafts: {}, refused: {}, toast: null });
const load = () => { try { return { ...fresh(), ...JSON.parse(sessionStorage.getItem(KEY) ?? "{}") }; } catch { return fresh(); } };
let st = load();
const save = () => sessionStorage.setItem(KEY, JSON.stringify(st));

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c);
  return el;
}
const $ = (id) => document.getElementById(id);
const sc = () => S.scenarios.find((x) => x.id === st.sc);
const proj = () => S.projects[sc().project];
const sup = () => proj().supervisor;
const req = () => st.reqs[st.sc] ?? null;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const n = (x) => x.toLocaleString("en-GB");
const online = () => st.sup === "online";
/** start_options' supervisor is null: nothing is offered, and the one reason is the service's. */
const noSup = () => st.sup === "none";
const okKinds = () => (noSup() ? [] : sc().kinds.filter((k) => k.ok));
const refusedKinds = () => (noSup() ? [{ kind: "any", ok: false, code: "supervisor", reason: `no supervisor runs ${sc().project}` }] : sc().kinds.filter((k) => !k.ok));
const kindOf = (k) => sc().kinds.find((x) => x.kind === k);
const route = () => { const m = location.hash.match(/^#start\/(\w+)$/); return m && okKinds().some((k) => k.kind === m[1]) ? m[1] : null; };

/** The supervisor's address, the laptop always shown: it is where the request goes (BOB-44's mark, muted). */
const supName = (dot = true) => h("span", { class: "sup" }, dot ? h("i", { class: `dot ${online() ? "on" : ""}`, "aria-hidden": "true" }) : null,
  h("b", null, sup().name), h("span", { class: `lap${online() ? "" : " stale"}`, title: `Runs on ${sup().laptop}` }, `@${sup().laptop}`));
const supText = () => `${sup().name}@${sup().laptop}`;

function toast(text, ok = true, undo = null) { st.toast = { text, ok, undo: undo ? true : null }; undoFn = undo; save(); render(); }
let undoFn = null;
function toastEl() {
  if (!st.toast) return null;
  const t = st.toast;
  return h("div", { class: "toast", "data-ok": String(t.ok), role: "status" }, h("span", null, t.text),
    t.undo && undoFn ? h("button", { type: "button", class: "undo", onclick: () => { const f = undoFn; undoFn = null; st.toast = null; f(); } }, "Undo") : null,
    h("button", { type: "button", class: "close-t", "aria-label": "Dismiss", onclick: () => { st.toast = null; save(); render(); } }, "×"));
}

/** The primary kind: the one the Next line names, if it may start; else the first that may. */
function primary() {
  const ok = okKinds();
  return ok.find((k) => k.kind === sc().nextKind) ?? ok[0] ?? null;
}
function openEditor(kind) {
  const r = req();
  // After a decline or a withdrawal, the editor opens on what he sent, not BobNet's brief again.
  const d = draftOf(kind);
  if (!d.touched && r && (r.status === "declined" || r.status === "withdrawn") && r.kind === kind) Object.assign(d, { text: r.brief, edited: r.edited, from: r.status, touched: true });
  st.toast = null;
  save();
  location.hash = `#start/${kind}`;
}
function draftOf(kind) {
  const key = `${st.sc}/${kind}`;
  if (!st.drafts[key]) { const k = kindOf(kind); st.drafts[key] = { label: k.label, text: sc().brief(kind, k.label), edited: false, from: null, touched: false }; }
  return st.drafts[key];
}
const reasonText = (k) => {
  if (!k.link) return k.reason;
  const i = k.reason.indexOf(k.link);
  return [k.reason.slice(0, i), h("a", { href: "#", onclick: (e) => { e.preventDefault(); toast(`On the dashboard this opens ${k.link}.`); } }, k.link), k.reason.slice(i + k.link.length)];
};

// ---------- The prototype's bar (not the design) ----------

function protoBar() {
  const r = req();
  const pending = r?.status === "pending";
  return h("div", { class: "proto-bar", "aria-label": "Prototype controls" },
    h("b", null, "Prototype"),
    h("span", { class: "pb-g" }, h("span", null, "Scenario"), h("span", { class: "seg filters" }, S.scenarios.map((x) =>
      h("button", { type: "button", "aria-pressed": String(x.id === st.sc), onclick: () => { st.sc = x.id; st.toast = null; save(); location.hash = ""; render(); } }, x.tab)))),
    h("span", { class: "pb-g" }, h("span", null, "Supervisor"), h("span", { class: "seg" },
      [["online", `${sup().name}@${sup().laptop} online`], ["offline", "offline"], ["none", "none runs it"]].map(([v, t]) =>
        h("button", { type: "button", "aria-pressed": String(st.sup === v), disabled: v === "none" && pending || null, onclick: () => { st.sup = v; save(); render(); } }, t)))),
    h("span", { class: "pb-g" }, h("span", null, `Then ${sup().name}`),
      h("button", { type: "button", disabled: !pending || !online() || null, onclick: started }, "starts it"),
      h("button", { type: "button", disabled: !pending || !online() || null, onclick: declined }, "declines it")),
    h("button", { type: "button", class: "more-t", onclick: () => { sessionStorage.removeItem(KEY); st = fresh(); location.hash = ""; render(); } }, "Reset"));
}

function started() {
  const r = req();
  r.status = "started"; r.startedAt = "10:24";
  toast(`${sup().name} started ${sc().feature.ref} ${r.kind} ${r.label}.`);
}
function declined() {
  const r = req();
  r.status = "declined"; r.reason = S.declineReason; r.at = "10:31";
  toast(`${supText()} declined ${r.kind} ${r.label}: “${S.declineReason}”`, "idle");
}

// ---------- Header ----------

function header() {
  const tabs = ["Overview", "Waits on you", "Status", "Roadmap", "Feature", "Triage", "Usage", "Sessions"];
  return h("header", null, h("h1", null, "BobNet"),
    h("nav", { id: "tabs" }, tabs.map((t) => h("a", { href: "#", "aria-current": t === "Feature" ? "page" : null,
      onclick: (e) => { e.preventDefault(); if (t !== "Feature") toast(`Only the feature page is in this prototype; ${t} is as it is today.`); } }, t))),
    h("button", { type: "button", class: "capture-btn", onclick: () => toast("Capture is as it is today.") }, "+ Capture"),
    h("span", { class: "conn", "data-state": "live" }, "live"));
}

// ---------- The feature page ----------

function featurePage() {
  const s = sc(), f = s.feature, r = req();
  const sessions = [...s.sessions];
  if (r?.status === "started") sessions.push({ kind: r.kind, label: r.label, when: `Sun ${r.startedAt} →`, state: "running", fromReq: r, agents: [S.startedBy] });
  const running = sessions.find((x) => x.state === "running");
  const out = [
    h("div", { class: "bar-row" }, h("label", { for: "feat-pick", class: "muted" }, "Feature"),
      h("select", { id: "feat-pick", onchange: (e) => { st.sc = e.target.value; st.toast = null; save(); render(); } },
        S.scenarios.map((x) => h("option", { value: x.id, selected: x.id === st.sc || null }, `${x.feature.ref} · ${x.feature.title}`)))),
  ];
  const head = h("div", { class: `card feature-head${f.state === "open" || r?.status === "started" ? " is-open" : ""}` },
    h("div", { class: "fh-top" }, h("span", { class: "id" }, f.ref), h("span", { class: "muted" }, `${proj().name} · ${f.release}`),
      h("span", { class: "badge", "data-state": f.state === "open" || r?.status === "started" ? "open" : "ready" }, f.state === "open" || r?.status === "started" ? "open" : "ready")),
    h("h2", null, f.title),
    h("div", { class: "fh-m" }, h("span", null, `${f.criteria[0]} of ${f.criteria[1]} criteria`), h("span", { class: "muted" }, "no tasks"),
      h("span", null, `${sessions.length} session${sessions.length === 1 ? "" : "s"}`),
      running ? h("span", { class: "now" }, "● ", S.startedBy.name, " on it now") : h("span", { class: "muted" }, "nobody on it now")));
  const steps = sessions.map(stepItem);
  out.push(h("div", { class: "feat" }, head, banner(), running ? onNow() : null,
    h("div", { class: "two" },
      h("section", { class: "chain" }, h("h2", null, "Sessions, in the order they ran"),
        h("ol", { class: "steps" }, steps, r?.status === "pending" ? requestedItem() : nextItem())),
      h("aside", null, h("h2", null, "Tasks"), h("div", { class: "empty-card" }, "No tasks on this feature.")))));
  out.push(h("p", { class: "note" }, "Start sends a request to the supervisor that runs the project; it decides who runs the session and declares it, as with any spawn. Release scope, release order and board status stay where they are today."));
  return out;
}

function banner() {
  const s = sc(), r = req(), p = primary();
  const go = (e) => { e.preventDefault(); $("next")?.scrollIntoView({ block: "center", behavior: "smooth" }); };
  if (r?.status === "pending")
    return h("div", { class: "banner next-banner req-banner" }, h("b", null, "Requested"),
      h("a", { href: "#", onclick: go }, `${r.kind} ${r.label} · `, online() ? ["waiting for ", supText(), " to start it"] : h("span", { class: "off-t" }, `${supText()} is offline; it gets it when it is back`)));
  if (s.wait)
    return h("a", { href: "#", class: "banner next-banner you", onclick: go }, h("b", null, "Next: waits on you"), h("span", null, `${s.wait.ref} · ${s.wait.text}`));
  if (r?.status === "started")
    return h("a", { href: "#", class: "banner next-banner", onclick: go }, h("b", null, "Next"), h("span", null, "a review session", h("span", { class: "muted" }, `, once ${r.kind} ${r.label} closes`)));
  const declinedNow = r?.status === "declined";
  return h("div", { class: `banner next-banner start-banner${declinedNow ? " declined" : ""}` },
    declinedNow ? [h("b", null, "Declined"), h("a", { href: "#", onclick: go }, `${r.kind} ${r.label} · ${sup().name}: “${r.reason}”`)]
      : [h("b", null, "Next"), h("a", { href: "#", onclick: go }, s.next)],
    p ? h("button", { type: "button", class: "primary start-btn", onclick: () => openEditor(p.kind) }, `Start ${p.kind} ${p.label}`)
      : h("span", { class: "muted cant-t" }, "can't start: ", nextReason() ? reasonText(nextReason()) : "see why below"));
}

/** Nothing may start: the banner gives the reason for the kind the Next line names (or the only one). */
function nextReason() {
  const no = refusedKinds();
  return no.find((k) => k.kind === sc().nextKind) ?? no[0] ?? null;
}

function onNow() {
  const w = S.startedBy;
  return h("section", { class: "card on-now" }, h("h2", { style: "margin:0" }, "On it now"),
    h("ul", { class: "lines" }, h("li", null, h("span", { class: "l-who" }, h("i", { class: "dot on", "aria-hidden": "true" }), h("b", null, w.name), h("span", { class: "muted" }, ` ${w.role} · `), h("span", { style: "color:var(--ok)" }, "running"), h("span", { class: "muted" }, ` · ${w.tokens} tokens`)),
      h("span", { class: "l-m" }, `${req().kind} ${req().label} › ${w.note}`))));
}

function stepItem(ss) {
  const r = ss.fromReq;
  return h("li", { class: "step", dataset: { kind: ss.kind, state: ss.state } }, h("span", { class: "dot2", "aria-hidden": "true" }),
    h("div", { class: "card" },
      h("div", { class: "top" }, h("span", { class: "kind" }, ss.kind), h("b", null, ss.label), h("span", { class: "when" }, ss.when), h("span", { class: "badge", "data-state": ss.state }, ss.state)),
      ss.state === "closed" ? h("div", { class: "outcome" }, h("span", { class: "need", "data-need": ss.need }, `need: ${ss.need}`),
        h("span", null, `${ss.blockers} blockers · ${ss.majors} majors`), h("span", null, `moved ${ss.moved} tasks`), h("span", { class: "muted" }, `${ss.tokens} tokens`)) : null,
      ss.agents?.length ? h("ul", { class: "lines s-agents" }, ss.agents.map((w) => h("li", null, h("span", { class: "l-who" }, h("i", { class: "dot on", "aria-hidden": "true" }), h("b", null, w.name), h("span", { class: "muted" }, ` ${w.role} · `), h("span", { style: "color:var(--ok)" }, "running"), h("span", { class: "muted" }, ` · ${w.tokens} tokens`))))) : null,
      r ? h("div", { class: "from-req" }, h("span", null, `From your request ${r.ref}: sent `, r.at0, ", started ", r.startedAt, " by ", supName(false), ".",
        r.edited ? " Brief edited by you." : ""),
        h("details", { class: "sent" }, h("summary", null, "The brief you sent"), h("pre", { class: "handoff" }, r.brief))) : null,
      ss.summary ? h("div", { class: "sub" }, ss.summary) : null,
      ss.state === "closed" ? h("div", { class: "links" }, h("button", { type: "button", class: "ctx-btn", onclick: () => toast("Handoff opens as it does today.") }, "Handoff"), h("span", null, `Close ${ss.commit}`)) : null));
}

/** The Next step, with Start in it: the kinds that may start, and why the others can't (spec: Next card). */
function nextItem() {
  const s = sc(), r = req(), p = primary(), ok = okKinds();
  if (r?.status === "started") return h("li", { class: "step next", id: "next" }, h("span", { class: "dot2", "aria-hidden": "true" }),
    h("div", { class: "card" }, h("div", { class: "top" }, h("span", { class: "kind" }, "Next"), h("b", null, "a review session")), h("div", { class: "sub muted" }, `Once ${r.kind} ${r.label} closes`)));
  // The Next kind's reason first; each sentence once.
  const no = refusedKinds().sort((a, b) => (b.kind === s.nextKind) - (a.kind === s.nextKind));
  const reasons = [...new Map(no.map((k) => [k.reason, k])).values()];
  return h("li", { class: `step next${s.wait ? " you" : ""}`, id: "next" }, h("span", { class: "dot2", "aria-hidden": "true" }),
    h("div", { class: "card" },
      h("div", { class: "top" }, h("span", { class: "kind" }, "Next"), h("b", null, s.wait ? "Waits on you" : s.next)),
      s.wait ? h("div", null, h("span", { class: "id" }, s.wait.ref), " ", h("b", null, s.wait.text)) : null,
      r?.status === "declined" ? h("div", { class: "req-note declined" }, h("b", null, `${supText()} declined ${r.kind} ${r.label}`), ` (${r.ref}) at ${r.at}: `, h("q", null, r.reason)) : null,
      r?.status === "withdrawn" ? h("div", { class: "req-note" }, `You withdrew ${r.kind} ${r.label} (${r.ref}) at ${r.at}; ${sup().name} was told.`) : null,
      ok.length
        ? h("div", { class: "start" },
            h("div", { class: "start-row" }, h("button", { type: "button", class: "primary", onclick: () => openEditor(p.kind) }, `Start ${p.kind} ${p.label}`),
              ok.filter((k) => k !== p).map((k) => h("button", { type: "button", onclick: () => openEditor(k.kind) }, `Start ${k.kind} ${k.label}`))),
            h("p", { class: "start-to" }, "Goes to ", supName(), online() ? ", who decides who runs it." : h("span", { class: "off-t" }, ", offline now: it gets the request when it is back.")),
            reasons.length ? h("div", { class: "not-now" }, h("span", null, "Not now"), h("ul", null, reasons.map((k) => h("li", null, reasonText(k))))) : null)
        : h("div", { class: "start cant" }, h("b", null, "Can't start a session now"),
            reasons.length === 1 ? h("div", null, reasonText(reasons[0])) : h("ul", null, reasons.map((k) => h("li", null, reasonText(k)))))));
}

/** The pending request, in place of Next, until a session starts or the supervisor declines it (AC4). */
function requestedItem() {
  const r = req();
  return h("li", { class: "step next requested", id: "next", dataset: { kind: r.kind } }, h("span", { class: "dot2", "aria-hidden": "true" }),
    h("div", { class: "card" },
      h("div", { class: "top" }, h("span", { class: "kind" }, "Requested"), h("b", null, `${r.kind} ${r.label}`), h("span", { class: "id" }, r.ref), h("span", { class: "when" }, `sent ${r.at0}`),
        h("span", { class: "badge", "data-state": online() ? "in progress" : "waiting" }, online() ? "requested" : "supervisor offline")),
      online()
        ? h("div", { class: "req-wait" }, "Waiting for ", supName(), " to start it. It decides who runs it.")
        : h("div", { class: "req-wait off" }, supName(), ` is offline: no report since ${sup().lastReport}. It gets your request when it is back; nothing is lost.`),
      h("div", { class: "sub muted" }, `Sent by you at ${r.at0}${r.edited ? " · brief edited by you" : " · BobNet's brief"} · ${n(r.brief.length)} characters`),
      h("details", { class: "sent" }, h("summary", null, "The brief you sent"), h("pre", { class: "handoff" }, r.brief)),
      h("div", { class: "start-row" }, h("button", { type: "button", onclick: withdrawAsk }, "Withdraw request")),
      h("p", { class: "start-to" }, "One request at a time on a feature: withdraw this one to ask for another kind.")));
}

// ---------- The brief editor ----------

function editorPage(kind) {
  const s = sc(), f = s.feature, d = draftOf(kind), k = kindOf(kind);
  const taken = (s.taken?.[kind] ?? []).map((x) => x.toLowerCase());
  const lab = d.label.trim();
  const labErr = !lab ? "A label is 1 to 40 characters." : taken.includes(lab.toLowerCase()) ? `${f.ref} ${kind} ${lab} already ran. Pick another label.` : null;
  const over = d.text.length > CAP, empty = !d.text.trim();
  const refused = st.refused[st.sc];
  const canSend = !labErr && !over && !empty;
  const back = (e) => { e?.preventDefault(); location.hash = ""; };
  const setText = (v) => { d.text = v; d.edited = true; d.touched = true; save(); };
  const ta = h("textarea", { id: "brief", rows: 18, spellcheck: "true", "aria-describedby": "brief-st", oninput: (e) => { setText(e.target.value); grow(e.target); paintStatus(); } });
  ta.value = d.text;
  const status = h("div", { class: "brief-st", id: "brief-st" });
  function paintStatus() {
    status.replaceChildren(
      d.edited ? h("span", { class: "ed" }, d.from === "declined" ? "Your brief from the declined request" : d.from === "withdrawn" ? "Your brief from the withdrawn request" : "Edited by you") : h("span", { class: "muted" }, "BobNet's brief"),
      d.edited ? h("button", { type: "button", class: "more-t", onclick: resetBrief }, "Use BobNet's brief") : null,
      h("span", { class: `cnt${d.text.length > CAP ? " over" : ""}` }, d.text.length > CAP ? `${n(d.text.length - CAP)} characters over the ${n(CAP)} limit` : `${n(d.text.length)} of ${n(CAP)} characters`));
    const send = $("send-btn"); if (send) send.disabled = !!labErr || d.text.length > CAP || !d.text.trim();
  }
  function resetBrief() {
    const before = { text: d.text, edited: d.edited, from: d.from };
    Object.assign(d, { text: s.brief(kind, d.label.trim() || k.label), edited: false, from: null });
    toast("BobNet's brief is back.", true, () => { Object.assign(d, before); save(); render(); });
  }
  paintStatus();
  return [
    h("div", { class: "bar-row" }, h("a", { href: "#", class: "back", onclick: back }, `‹ ${f.ref}`), h("span", { class: "muted" }, f.title)),
    h("form", { class: "se", onsubmit: (e) => { e.preventDefault(); if (canSend) confirmAsk(kind); } },
      h("div", { class: "se-head" }, h("h2", null, "Start a session"), h("div", { class: "se-name" }, h("span", { class: "id" }, f.ref), h("b", null, `${kind} ${lab || "…"}`), h("span", { class: "muted" }, `${proj().name}`))),
      refused ? h("div", { class: "banner down", role: "alert" }, h("b", null, "Not sent"), h("span", null, refused, ". Nothing was asked; your brief is still here."),
        h("button", { type: "button", class: "more-t", onclick: () => { navigator.clipboard?.writeText(d.text); toast("Your brief is copied."); } }, "Copy your brief")) : null,
      h("div", { class: "se-grid" },
        h("div", { class: "se-side" },
          h("div", { class: "fld" }, h("span", { class: "fl" }, "Session"), okKinds().length > 1 ? h("span", { class: "seg kinds" }, okKinds().map((x) =>
            h("button", { type: "button", "aria-pressed": String(x.kind === kind), onclick: () => { location.hash = `#start/${x.kind}`; } }, cap(x.kind)))) : h("b", null, cap(kind))),
          h("label", { class: "fld" }, h("span", { class: "fl" }, "Label"),
            h("input", { id: "label", type: "text", maxlength: 40, value: d.label, autocomplete: "off", "aria-invalid": labErr ? "true" : null, "aria-describedby": "label-h",
              onchange: (e) => { d.label = e.target.value; d.touched = true; if (!d.edited) d.text = s.brief(kind, d.label.trim() || k.label); save(); render(); } }),
            h("span", { id: "label-h", class: `fh${labErr ? " err" : ""}` }, labErr ?? `${f.ref} ${kind} ${lab}. BobNet proposed ${k.label}.`)),
          h("div", { class: "fld" }, h("span", { class: "fl" }, "Goes to"), h("span", null, supName(), online() ? h("span", { class: "muted" }, " · online") : h("span", { class: "off-t" }, ` · offline since ${sup().lastReport}; it gets it when it is back`))),
          h("p", { class: "note se-note" }, `Nothing starts until ${sup().name} starts it. ${sup().name} decides who runs it and declares the session and its tasks, as with any spawn.`)),
        h("div", { class: "se-main" },
          h("label", { class: "fl", for: "brief" }, "Brief"),
          ta, status)),
      h("div", { class: "se-foot" },
        h("button", { type: "button", onclick: back }, "Cancel"),
        h("button", { type: "submit", class: "primary", id: "send-btn", disabled: !canSend || null }, `Send to ${sup().name}…`))),
  ];
}
function grow(ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; }

// ---------- Dialogs ----------

function dialog(title, body, cancel, go, goCls, onGo) {
  const dlg = h("dialog", { id: "dlg", "aria-labelledby": "dlg-t" },
    h("form", { method: "dialog" }, h("h2", { id: "dlg-t" }, title), body,
      h("div", { class: "foot" }, h("button", { value: "cancel" }, cancel), h("button", { value: "go", class: goCls }, go))));
  dlg.addEventListener("close", () => { const v = dlg.returnValue; dlg.remove(); if (v === "go") onGo(); });
  document.body.append(dlg);
  dlg.showModal();
}

function confirmAsk(kind) {
  const s = sc(), d = draftOf(kind), lab = d.label.trim();
  dialog(`Ask ${sup().name} to start ${s.feature.ref} ${kind} ${lab}?`,
    [h("p", null, `${supText()} gets this brief as you wrote it and decides who runs it. Nothing starts until it does, and you can withdraw the request until then.`),
      !online() ? h("p", { class: "off-t" }, `${supText()} is offline now. The request waits for it; nothing is lost.`) : null,
      h("p", { class: "note" }, `Sent as ${S.me} · ${d.edited ? "brief edited by you" : "BobNet's brief"} · ${n(d.text.length)} characters`)],
    "Back to the brief", `Ask ${sup().name}`, "primary", () => {
      if (s.refuseOnSend) { st.refused[st.sc] = s.refuseOnSend; save(); render(); window.scrollTo(0, 0); return; }
      st.reqs[st.sc] = { ref: s.req, kind, label: lab, brief: d.text, edited: d.edited, at0: S.now, status: "pending" };
      delete st.drafts[`${st.sc}/${kind}`];
      save();
      location.hash = "";
      toast(online() ? `Asked: ${s.req}, sent to ${supText()}. It starts ${kind} ${lab} or says why not.` : `Asked: ${s.req}, saved; waiting for ${supText()} to come online.`);
    });
}

function withdrawAsk() {
  const r = req();
  dialog(`Withdraw the request for ${r.kind} ${r.label}?`,
    [h("p", null, `${sup().name} is told, and won't start it. You can ask again later; the brief you sent comes back in the editor.`)],
    "Keep it", "Withdraw", "danger", () => {
      Object.assign(r, { status: "withdrawn", at: S.now });
      toast(online() ? `Withdrawn: ${r.ref}. ${supText()} is told.` : `Withdrawn: ${r.ref}. Waiting for ${supText()} to come online to tell it.`);
    });
}

// ---------- Render ----------

function render() {
  const kind = route();
  document.body.replaceChildren(header(), h("div", { id: "toast-slot" }, toastEl()),
    h("main", { id: "view", class: kind ? "wide" : null }, protoBar(), kind ? editorPage(kind) : featurePage()));
  const ta = $("brief"); if (ta) grow(ta);
}
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
window.addEventListener("resize", () => { const ta = $("brief"); if (ta) grow(ta); });
document.addEventListener("DOMContentLoaded", render);
