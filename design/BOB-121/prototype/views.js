// BOB-121 prototype: every view of the dashboard (spec.md §2), and the router.
"use strict";

// ---------- Projects: the release rule (ADR 0014 §4) and a project's row ----------

/** The current release: the first not closed with a feature not Done; else the last not closed. And the done ones not closed. */
function currentRelease(key) {
  const b = board(key), open = b.releases.filter((r) => r.status !== "closed");
  const feats = (r) => b.features.filter((x) => x.release === r.ref);
  const cur = open.find((r) => feats(r).some((x) => x.status !== "Done")) ?? open.at(-1) ?? null;
  const number = cur ? b.releases.indexOf(cur) + 1 : null;
  const doneUnclosed = open.filter((r) => r !== cur && b.releases.indexOf(r) < number - 1 && feats(r).every((x) => x.status === "Done"));
  return cur && { ...cur, number, done: feats(cur).filter((x) => x.status === "Done").length, total: feats(cur).length, doneUnclosed };
}
const openFeatures = (key) => board(key).features.filter((x) => x.open);
const nextReady = (key) => board(key).features.find((x) => x.status === "Ready");
const cell = (label, ...kids) => h("div", { class: "pc" }, h("span", { class: "lab" }, label), ...kids);
const ciTone = (key) => { const st = CI[key].map((wf) => wf.runs[0].status); return st.includes("failed") ? "failed" : st.includes("running") ? "running" : "passed"; };

function projectRow(key) {
  const p = proj(key), r = currentRelease(key), open = openFeatures(key), next = nextReady(key);
  const ws = workers().filter((w) => w.project === key);
  const bl = board(key).backlog, bugs = bl.filter((x) => x[2] === "bug").length;
  const myWaits = waits().filter((w) => w.project === key);
  const go = (e) => { if (!e.target.closest("a, button")) location.hash = `#project/${key}`; };
  return h("div", { class: "card prow link-card", dataset: { project: key }, onclick: go },
    h("div", { class: "pc pname" }, h("a", { href: `#project/${key}` }, p.name, h("span", { class: "chev", "aria-hidden": "true" }, " ›")),
      h("span", { class: "muted" }, [p.laptops.join(" · "), `lead ${p.lead}`, `PO ${p.po}`].join(" · ")),
      h("span", { class: "pmini" }, h("span", { class: `ci-pill ${ciTone(key)}` }, `CI ${ciTone(key)}`),
        h("span", { class: "muted" }, ws.length ? `${ws.length} running` : "nobody running"))),
    cell("Release", r ? [h("span", { class: "v" }, h("b", null, r.ref), " ", r.title.replace(/^R\d+ /, "")), meterOf(r.done, r.total), h("span", { class: "muted" }, `${r.done} of ${plural(r.total, "feature")} done`),
      r.doneUnclosed.map((u) => h("a", { class: "warn-t", href: `#roadmap/${key}` }, `${u.ref} all done: waiting for your close`))] : h("span", { class: "muted" }, "no open release")),
    cell("Open now", open.length ? [h("a", { href: featHref(key, open[0].ref), class: "v clamp" }, h("span", { class: "id" }, open[0].ref), " ", open[0].title),
      h("span", { class: "muted" }, ws.some((w) => w.feature === open[0].ref) ? h("span", { class: "on-t" }, `${ws.filter((w) => w.feature === open[0].ref).map((w) => w.name).join(", ")} on it`) : "nobody on it now")]
      : h("span", { class: "muted" }, "no feature open")),
    cell("Next", myWaits.some((w) => w.blocking) ? h("a", { class: "v warn-t", href: "#needs" }, `Waits on you: ${myWaits.filter((w) => w.blocking).map((w) => w.ref).join(", ")}`) : null,
      next ? h("span", { class: "muted clamp" }, "Ready: ", idLink(key, next.ref), " ", next.title) : h("span", { class: "muted" }, "none Ready")),
    cell("Backlog", h("a", { href: `#triage/${key}`, class: "v" }, plural(bl.length, "item")), h("span", { class: "muted" }, `${plural(bugs, "bug")} · oldest ${age(Math.max(...bl.map((x) => x[3])))}`)));
}

// ---------- Overview (spec 2.1) ----------

function viewOverview() {
  const perms = humanPerms(), ws = waits();
  const blocked = [...perms.map((p) => ({ ...p, sortAt: p.created })), ...ws.filter((w) => w.blocking).map((w) => ({ ...w, sortAt: w.since }))].sort((a, b) => b.sortAt - a.sortAt);
  const later = ws.filter((w) => !w.blocking).sort((a, b) => b.since - a.since);
  const running = workers();
  return [
    quietBanners(),
    h("a", { class: "st-line", href: "#status" }, h("b", null, "Since your last visit"), h("span", { class: "muted" }, ` (${since(STATUS.lastVisit)} ago): 9 done, 3 stuck, CI red on BobNet`), " →"),
    h("div", { class: "ov" },
      h("section", { class: "ov-needs" }, h("h2", null, "Needs you ", h("span", { class: "count" }, needsCount() || "")),
        h("div", { class: "card" }, needsBody(blocked, later, true))),
      h("div", { class: "ov-side" },
        h("section", { class: "ov-now" }, h("h2", null, "Working now ", h("span", { class: "count" }, running.length || "")),
          h("div", { class: "card" }, PROJECTS.map((p) => h("div", { class: "now-p" }, h("div", { class: "grp-h" }, h("a", { href: `#project/${p.key}` }, p.name),
            h("span", { class: "muted" }, workers().some((w) => w.project === p.key) ? p.laptops.filter((l) => workers().some((w) => w.project === p.key && w.laptop === l)).join(", ") : "")),
            runningOf(p.key, "ov"))), QUEUED.length ? h("p", { class: "more queued" }, `${QUEUED.length} queued`) : null)),
        h("section", { class: "ov-ci" }, h("h2", null, "CI"),
          h("div", { class: "card" }, h("ul", { class: "ci-list" }, PROJECTS.flatMap((p) => CI[p.key].map((wf, i) => ciRow(p.key, wf, i === 0 || "blank"))))))),
      h("section", { class: "ov-proj" }, h("h2", null, "Projects"), h("div", { class: "plist" }, PROJECTS.map((p) => projectRow(p.key))))),
    sampleStates(),
  ];
}

/** Needs you's two groups (spec 2.2). On the Overview: the blocked whole, the rest as one compact line each, three at most. */
function needsBody(blocked, later, overview) {
  if (!blocked.length && !later.length) return h("p", { class: "st-empty ok" }, "Nothing needs you. Anything new shows here within a minute.");
  const shown = overview ? later.slice(0, 3) : later;
  return [
    h("div", { class: "ngrp", dataset: { tone: "bad" } }, h("h3", null, "Holds work up ", h("span", { class: "count" }, blocked.length)),
      blocked.length ? h("ul", { class: "lines needs" }, blocked.map((w) => needsLine(w))) : h("p", { class: "st-empty ok" }, "Nothing is held up by you.")),
    h("div", { class: "ngrp" }, h("h3", null, "When you have time ", h("span", { class: "count" }, later.length)),
      later.length ? h("ul", { class: "lines needs" }, shown.map((w) => needsLine(w, overview))) : h("p", { class: "st-empty" }, "Nothing else.")),
    overview ? h("a", { class: "more", href: "#needs" }, later.length > 3 ? `${later.length - 3} more when you have time, and today's answers, on Needs you →` : "Needs you, with today's answers →") : null,
    h("p", { class: "fresh" }, `Up to date: ${laptops().filter((l) => l.at <= 3).map((l) => `${l.laptop} reported ${since(l.at)} ago`).join(", ")}. An item leaves when it's answered or its worker stops.`),
  ];
}

// ---------- Needs you, the page (spec 2.2; was Waits on you) ----------

function viewNeeds() {
  const pick = state.needsProject;
  const inP = (x) => pick === "all" || x.project === pick;
  const perms = humanPerms().filter(inP), ws = waits().filter(inP);
  const blocked = [...perms.map((p) => ({ ...p, sortAt: p.created })), ...ws.filter((w) => w.blocking).map((w) => ({ ...w, sortAt: w.since }))].sort((a, b) => b.sortAt - a.sortAt);
  const later = ws.filter((w) => !w.blocking).sort((a, b) => b.since - a.since);
  const today = ANSWERED.filter(inP).filter((a) => !(a.perm && state.older && a.laptop === "mbp-1"));
  const count = (k) => humanPerms().filter((x) => k === "all" || x.project === k).length + waits().filter((x) => k === "all" || x.project === k).length;
  return [
    quietBanners(),
    h("div", { class: "bar-row" }, h("span", { class: "seg" }, [["all", "All projects"], ...PROJECTS.map((p) => [p.key, p.name])].map(([k, label]) =>
      btn([label, " ", h("span", { class: "count" }, count(k))], "", () => { state.needsProject = k; render(); }, { "aria-pressed": String(pick === k) })))),
    h("section", { class: "needs-page card" }, needsBody(blocked, later, false)),
    today.length ? h("section", null, h("h2", null, "Answered from here today ", h("span", { class: "count" }, today.length)),
      h("ul", { class: "list waits" }, today.map(answeredItem))) : null,
    h("p", { class: "note" }, "Oldest first in each group. Answer here or in the project's conversation; your words are kept on the item and its lead gets a message. A permission request shows for a day at most, and only while its worker runs; a quiet laptop's requests wait under its banner."),
    sampleStates(),
  ];
}
function answeredItem(x) {
  if (x.perm) return h("li", { class: "answered", dataset: { decision: x.decision } },
    h("div", { class: "top" }, badge(x.decision === "allow" ? "done" : "failed", x.decision === "allow" ? "allowed" : "denied"), h("span", { class: "id" }, x.tool),
      h("span", { class: "muted" }, pname(x.project)), h("span", { class: "age" }, stamp(x.at))),
    h("div", { class: "q" }, `${x.name} wanted ${x.tool}: `, h("code", null, x.preview)),
    h("div", { class: "said" }, `You ${x.decision === "allow" ? "allowed" : "denied"} it`, x.note ? h("blockquote", null, x.note) : null),
    h("div", { class: "meta" }, x.note ? `${x.name} got your note as its next message` : `${x.name} got your decision`, h("span", null, `on ${x.laptop}`)));
  return h("li", { class: "answered" },
    h("div", { class: "top" }, badge("question"), h("span", { class: "id" }, x.ref), h("span", { class: "muted" }, [pname(x.project), " · "], idLink(x.project, x.feature)), h("span", { class: "age" }, stamp(x.at))),
    h("div", { class: "q" }, x.text),
    h("div", { class: "said" }, h("span", null, "You answered: ", h("b", null, x.option)), x.words ? h("blockquote", null, x.words) : null),
    h("div", { class: "meta" }, `${x.lead}, ${pname(x.project)}'s lead, got a message`, btn("Undo", "answer-btn", () => toast(`${x.ref} is open again; ${x.lead} got a message.`))));
}

// ---------- A project's page (spec 2.3) ----------

function viewProject(key) {
  const p = proj(key);
  if (!p) return [h("div", { class: "empty-card" }, "No such project.")];
  const r = currentRelease(key), b = board(key);
  const feats = r ? b.features.filter((x) => x.release === r.ref) : [];
  const ws = waits().filter((w) => w.project === key), perms = humanPerms().filter((x) => x.project === key);
  const blocked = [...perms, ...ws.filter((w) => w.blocking)], later = ws.filter((w) => !w.blocking);
  const pts = series(key, 14), total = pts.reduce((n, pt) => n + valOf(pt), 0);
  const bl = b.backlog;
  return [
    quietBanners(),
    h("div", { class: "p-top" },
      h("div", { class: "p-title" }, h("a", { class: "back", href: "#overview" }, "‹ Overview"), h("h2", { class: "p-h" }, p.name),
        h("span", { class: "muted" }, [`lead ${p.lead}`, `PO ${p.po}`, p.laptops.join(", "), p.repo].join(" · "))),
      h("span", { class: "seg" }, PROJECTS.map((q) => btn(q.name, "", () => (location.hash = `#project/${q.key}`), { "aria-pressed": String(q.key === key) })))),
    h("div", { class: "pgrid" },
      h("div", { class: "pmain" },
        h("section", { class: "card prel" }, h("h3", null, "Current release"),
          r ? [h("div", { class: "rel-line" }, h("b", null, r.title), h("span", { class: "muted" }, `${r.done} of ${plural(r.total, "feature")} done`)), meterOf(r.done, r.total),
            r.doneUnclosed.map((u) => h("p", { class: "warn-t" }, `${u.title}: all done, waiting for your close. `, h("a", { href: `#roadmap/${key}` }, "Close it on the Roadmap →"))),
            h("ul", { class: "flist" }, feats.map((x) => featLi(key, x)))] : h("p", { class: "muted" }, "No open release."),
          h("div", { class: "links" }, h("a", { href: `#roadmap/${key}` }, "Roadmap"), h("a", { href: `#features/${key}` }, "All features"), h("a", { href: `#triage/${key}` }, "Triage"))),
        h("section", { class: "card" }, h("h3", null, "Running now ", h("span", { class: "count" }, workers().filter((w) => w.project === key).length || "")), runningOf(key, "pp")),
        h("section", { class: "card" }, h("h3", null, "Who ran lately ", h("span", { class: "count" }, "last 14 days")), lately(key))),
      h("aside", { class: "pside" },
        h("section", { class: "card" }, h("h3", null, "Waits on you ", h("span", { class: "count" }, blocked.length + later.length || "")),
          blocked.length || later.length ? h("ul", { class: "lines needs" }, [...blocked, ...later].map((w) => needsLine(w, true))) : h("p", { class: "st-empty ok" }, "Nothing waits on you."),
          blocked.length || later.length ? h("a", { class: "more", href: "#needs", onclick: () => (state.needsProject = key) }, "Answer them on Needs you →") : null),
        h("section", { class: "card" }, h("h3", null, "CI"), h("ul", { class: "ci-list" }, CI[key].map((wf) => ciRow(key, wf, false)))),
        h("section", { class: "card" }, h("h3", null, "Usage ", h("span", { class: "count" }, `${fmtTokens(total)} ${state.weigh ? "Sonnet-equivalent " : ""}tokens, 14 days`)),
          usageGraph(key, { days: 14, small: true }), usageDayLine(key), h("div", { class: "links" }, weighToggle(), h("a", { href: "#usage" }, "Usage, every project →"))),
        h("section", { class: "card" }, h("h3", null, "Backlog health"),
          h("dl", { class: "health" },
            h("dt", null, "Ready to start"), h("dd", null, plural(b.features.filter((x) => x.status === "Ready").length, "feature")),
            h("dt", null, "Without criteria"), h("dd", null, plural(b.features.filter((x) => x.status === "Draft" && !x.crit[1]).length, "draft")),
            h("dt", null, "To triage"), h("dd", null, h("a", { href: `#triage/${key}` }, plural(bl.length, "item")), h("span", { class: "muted" }, ` · oldest ${age(Math.max(...bl.map((x) => x[3])))}`)),
            h("dt", null, "Open bugs"), h("dd", null, plural(bl.filter((x) => x[2] === "bug").length, "bug"))),
          r && feats.filter((x) => x.status === "Ready").length === 0 && feats.some((x) => x.status !== "Done") ? h("p", { class: "warn-t" }, `${r.ref} has nothing Ready: its next feature needs criteria.`) : null))),
    sampleStates(),
  ];
}
function featLi(key, x) {
  const on = workers().filter((w) => w.project === key && w.feature === x.ref);
  return h("li", { class: x.status === "Done" ? "done" : x.open ? "is-open" : null },
    idLink(key, x.ref), h("span", { class: "ft" }, x.title), h("span", { class: "fs" }, stateWords(x), on.length ? h("span", { class: "on-t" }, ` · ${on.map((w) => w.name).join(", ")} on it`) : null));
}
/** What a feature's state means in words (spec 2.6): Done says when; open says what's left; Draft says what's missing. */
function stateWords(x) {
  if (x.status === "Done") return h("span", { class: "muted" }, `done ${day(x.done)}`);
  const leftC = x.crit[1] - x.crit[0], leftT = x.tasks[1] - x.tasks[0];
  const left = () => h("span", { class: "left" }, `${leftC} of ${x.crit[1]} criteria${x.tasks[1] ? ` and ${leftT} of ${plural(x.tasks[1], "task")}` : ""} left`);
  if (x.crit[0] > 0 || x.open) return [x.status === "Draft" ? h("span", { class: "muted" }, "draft · ") : null, left()];
  if (x.status === "Draft") return h("span", { class: "muted" }, x.crit[1] ? `draft · ${plural(x.crit[1], "criterion", "criteria")} written` : "draft · no criteria yet");
  return h("span", { class: "muted" }, `ready · ${plural(x.crit[1], "criterion", "criteria")} to meet`);
}

/** Who ran lately (spec 2.3; ADR 0014 ProjectPage.sessions): a session per row, its runs under it. */
function lately(key) {
  const rows = SESSIONS[key];
  const tok = (r) => (r.tokens == null ? h("span", { class: "warn-t" }, "tokens unknown") : fmtTokens(state.weigh ? r.tokens * BLEND[r.model ?? "unknown"] : r.tokens));
  const sumOf = (ss) => ss.runs.reduce((n, r) => n + (r.tokens == null ? 0 : state.weigh ? r.tokens * BLEND[r.model ?? "unknown"] : r.tokens), 0);
  return h("ul", { class: "lately" }, rows.map((ss) => h("li", { class: ss.e === null ? "is-open" : null },
    h("div", { class: "lt-h" }, h("span", { class: "kind", dataset: { kind: ss.kind } }, ss.kind), h("b", null, ss.label), idLink(key, ss.feature), h("span", { class: "ft-t" }, feature(key, ss.feature)?.title ?? ""),
      h("span", { class: "muted" }, ss.e === null ? `open since ${since(ss.s)} ago` : `${stamp(ss.s)} – ${clock(ss.e)} · ${since(ss.s - ss.e)}`),
      h("span", { class: "lt-tok" }, `${fmtTokens(sumOf(ss))}${ss.e === null ? " so far" : ""}`)),
    ss.close ? h("div", { class: "outcome" }, h("span", { class: "need", dataset: { need: ss.close.need } }, `need: ${ss.close.need}`),
      h("span", { class: "muted" }, [ss.close.blockers ? `${plural(ss.close.blockers, "blocker")}` : null, ss.close.majors ? `${plural(ss.close.majors, "major")}` : null,
        ss.close.sent_back ? `${ss.close.sent_back} sent back` : null].filter(Boolean).join(" · ") || "no findings"), h("span", { class: "sum" }, ss.close.summary)) : null,
    h("ul", { class: "runs" }, ss.runs.map((r) => h("li", { dataset: { outcome: r.outcome ?? "running" } },
      h("b", null, r.agent), h("span", { class: "muted" }, ` ${r.role} · ${r.model ?? "default model"}${r.effort ? ` · ${r.effort}` : ""}`),
      h("span", { class: "r-out" }, r.outcome === null ? h("span", { class: "on-t" }, "running") : r.outcome === "done" ? "done" : h("span", { class: "bad-t" }, `${r.outcome}${r.reason ? `: ${r.reason}` : ""}`)),
      h("span", { class: "r-tok" }, tok(r))))))));
}

// ---------- Status (BOB-33, as designed; it must work: spec 2.5) ----------

function viewStatus(key) {
  if (key) return statusProject(key);
  const all = PROJECTS.map((p) => [p.key, STATUS[p.key]]);
  return [
    h("div", { class: "card span-bar" }, h("div", { class: "when" }, h("b", null, "Since your last visit"), h("span", { class: "muted" }, `${clock(STATUS.lastVisit)}, ${since(STATUS.lastVisit)} ago`)),
      h("span", { class: "seg" }, [["visit", `Since ${clock(STATUS.lastVisit)}`], ["24h", "24 h"], ["week", "A week"]].map(([k, l]) => btn(l, "", () => { state.stSpan = k; render(); }, { "aria-pressed": String(state.stSpan === k) }))),
      btn("I'm caught up", "primary caught", () => toast("Marked: Status starts from now on this device. Opening the page never moves it.")),
      h("p", { class: "span-note muted" }, "Opening this page doesn't move it; only I'm caught up does.")),
    h("div", { class: "answers" },
      h("a", { class: "ans", dataset: { tone: "bad" }, href: "#needs" }, h("span", { class: "lab" }, "Needs you"), h("b", null, String(needsCount())), h("span", { class: "sub" }, `${humanPerms().length + waits().filter((w) => w.blocking).length} hold work up`)),
      h("a", { class: "ans", dataset: { tone: "bad" }, href: "#status/helix" }, h("span", { class: "lab" }, "Is it going OK?"), h("b", null, "Needs a look"), h("span", { class: "sub" }, "CI red on BobNet · review sent back on Helix · 9 done"))),
    h("section", null, h("h2", null, "Projects ", h("span", { class: "count" }, all.length)),
      h("div", { class: "pcards" }, all.map(([k, st]) => h("a", { class: "pcard card", dataset: { tone: st.tone }, href: `#status/${k}` },
        h("div", { class: "top" }, h("span", { class: "name" }, pname(k)), badge(st.tone === "bad" ? "failed" : "waiting", st.verdict), h("span", { class: "chev" }, "›")),
        h("div", { class: "pstats" }, [["Needs you", st.needs, "bad"], ["Done", st.done[0], null, st.done[1]], ["Stuck", st.stuck, "warn"], ["Tokens", fmtTokens(st.tokens)]].map(([l, v, tone, sub]) =>
          h("div", { class: "pstat", dataset: tone && v ? { tone } : {} }, h("span", { class: "lab" }, l), h("b", null, String(v)), sub ? h("span", { class: "s" }, sub) : null))),
        h("div", { class: "pflags" }, st.flags.map(([tone, t]) => h("span", { class: "badge", dataset: { state: tone === "bad" ? "failed" : "waiting" } }, t))))))),
    h("section", null, h("h2", null, "Needs you ", h("span", { class: "count" }, needsCount())),
      h("div", { class: "card st-needs" }, h("ul", { class: "lines needs" }, [...humanPerms(), ...waits()].map((w) => needsLine(w, true))),
        h("a", { class: "more", href: "#needs" }, "Answer them on Needs you →"))),
    sampleStates(),
  ];
}
function statusProject(key) {
  const st = STATUS[key];
  const sec = (id, title, n, tone, body) => h("details", { class: "sec card", dataset: { tone }, open: state.folds.has(`st-${key}-${id}`) || id === "needs" ? true : null, ontoggle: (e) => { e.target.open ? state.folds.add(`st-${key}-${id}`) : state.folds.delete(`st-${key}-${id}`); save(); } },
    h("summary", { class: "sec-h" }, h("span", { class: "t" }, title), h("span", { class: "n", dataset: { tone } }, String(n))), h("div", { class: "sec-b" }, body));
  const ws = waits().filter((w) => w.project === key);
  return [
    h("div", { class: "p-top" }, h("div", { class: "p-title" }, h("a", { class: "back", href: "#status" }, "‹ Status"), h("h2", { class: "p-h" }, pname(key)),
      h("span", { class: "muted" }, `since your last visit, ${since(STATUS.lastVisit)} ago · `, h("a", { href: `#project/${key}` }, `${pname(key)}'s page →`)))),
    h("div", { class: "secs" },
      sec("needs", "Needs you", ws.length, "bad", ws.length ? h("ul", { class: "lines needs" }, ws.map((w) => needsLine(w, true))) : h("p", { class: "st-empty ok" }, "Nothing.")),
      sec("done", "Done", st.done[0], "ok", h("ul", { class: "rows" }, st.doneList.map(([ref, t, m]) => h("li", null, idLink(key, ref), ` ${t} `, h("span", { class: "muted" }, m))))),
      sec("stuck", "Stuck", st.stuck, "warn", h("ul", { class: "rows" }, st.stuckList.map(([tone, t, m]) => h("li", null, h("b", { class: tone === "bad" ? "bad-t" : "warn-t" }, t), ` ${m}`)))),
      sec("recurring", "Recurring", 0, null, h("p", { class: "st-empty ok" }, "Nothing came back twice this week.")),
      sec("backlog", "Backlog", board(key).backlog.length, null, h("p", null, `${plural(board(key).backlog.length, "item")} to triage; `, h("a", { href: `#triage/${key}` }, "Triage →"))),
      sec("usage", "Usage", fmtTokens(st.tokens), null, [usageGraph(key, { days: 7, small: true }), h("a", { href: "#usage" }, "Usage →")])),
  ];
}

// ---------- Roadmap (spec 2.6): as today, a Done feature with no count ----------

function viewRoadmap(key = "bobnet") {
  const b = board(key), cur = currentRelease(key);
  const rels = [...b.releases, { ref: null, title: "Not in a release" }];
  return [
    h("div", { class: "bar-row" }, h("span", { class: "seg" }, PROJECTS.map((q) => btn(q.name, "", () => (location.hash = `#roadmap/${q.key}`), { "aria-pressed": String(q.key === key) }))),
      h("span", { class: "muted" }, `${plural(b.releases.length, "release")} · ${plural(b.features.length, "feature")}`), btn("Edit your gates", "gates-btn", () => toast("Edit your gates opens as today: release scope, order and close."))),
    rels.map((r, i) => {
      const fs = b.features.filter((x) => x.release === r.ref);
      if (!fs.length && r.ref === null) return null;
      const done = fs.filter((x) => x.status === "Done"), closed = r.status === "closed";
      const foldId = `rm-${key}-${r.ref}`, showDone = state.folds.has(foldId);
      const allDone = fs.length && done.length === fs.length;
      return h("section", { class: "release", id: `rel-${r.ref}` },
        h("div", { class: "rel-h" }, r.ref ? h("span", { class: "n" }, String(i + 1)) : null, h("b", null, r.title), r.ref ? badge(closed ? "closed" : r.status) : null,
          h("span", { class: "muted" }, closed ? `${plural(fs.length, "feature")}, all done · closed ${day(r.closed)}` : `${done.length} of ${plural(fs.length, "feature")} done`),
          cur && cur.ref === r.ref ? h("span", { class: "cur-tag" }, "current") : null,
          allDone && !closed && r.ref ? h("span", { class: "gate" }, h("span", { class: "warn-t" }, "All done: waiting for your close"), btn(`Close ${r.ref}`, "primary", () => toast(`Asks you to confirm closing ${r.ref}, as today.`))) : null),
        h("div", { class: "table-wrap" }, h("table", { class: "stack rm" },
          h("thead", null, h("tr", null, h("th", null, "# Feature"), h("th", null, "State"), h("th", null, "Where it stands"))),
          h("tbody", null,
            done.length && !showDone ? h("tr", { class: "fold" }, h("td", { colspan: "3" }, btn(`${done.length} done: show them`, "", () => toggleSet(state.folds, foldId)))) : null,
            fs.filter((x) => showDone || x.status !== "Done").map((x, n) => h("tr", { class: x.status === "Done" ? "done" : x.open ? "is-open" : null },
              h("td", { class: "wide keep" }, h("span", { class: "ord" }, r.ref ? `${fs.indexOf(x) + 1}` : "·"), " ", idLink(key, x.ref), " ", h("span", { class: "title" }, x.title),
                x.open ? h("div", { class: "sub" }, `open · `, workers().some((w) => w.feature === x.ref) ? h("span", { class: "on-t" }, `${workers().filter((w) => w.feature === x.ref).map((w) => w.name).join(", ")} on it now`) : "nobody on it now") : null),
              h("td", { "data-label": "State" }, badge(x.status === "Done" ? "done" : x.open ? "open" : x.status.toLowerCase())),
              h("td", { "data-label": "Where it stands" }, stateWords(x), x.status !== "Done" && x.crit[1] && x.crit[0] ? meterOf(x.crit[0], x.crit[1]) : null))),
            done.length && showDone ? h("tr", { class: "fold" }, h("td", { colspan: "3" }, btn("Fold the done ones", "", () => toggleSet(state.folds, foldId)))) : null))));
    }),
    h("p", { class: "note" }, `Order inside a release is ${proj(key).po}'s; the order of releases is yours. Where it stands: a feature not done says how many of its own criteria and tasks are left; a done one says when it was done. The feature's page lists any criteria it closed without.`),
  ];
}

// ---------- Features (spec 2.7): the board's features, never "no backlog configured" ----------

const rank = (x) => (x.open ? 0 : { "In Progress": 1, "In Review": 1, Ready: 2, Draft: 3, Done: 4 }[x.status]);
const FILTERS = [["all", "All"], ["open", "Open now"], ["ready", "Ready"], ["draft", "Draft"], ["done", "Done"]];
function viewFeatures(key = "bobnet") {
  const b = board(key);
  const match = (x) => ({ open: !!x.open, ready: x.status === "Ready", draft: x.status === "Draft", done: x.status === "Done", all: true })[state.featFilter];
  const text = state.featText.toLowerCase();
  const fs = b.features.filter(match).filter((x) => !text || `${x.ref} ${x.title}`.toLowerCase().includes(text))
    .sort((a, c) => rank(a) - rank(c) || (a.status === "Done" ? a.done - c.done : 0));
  const n = (k) => b.features.filter((x) => ({ open: !!x.open, ready: x.status === "Ready", draft: x.status === "Draft", done: x.status === "Done", all: true })[k]).length;
  const relTitle = (ref) => b.releases.find((r) => r.ref === ref)?.title ?? "Not in a release";
  return [
    h("div", { class: "bar-row" }, h("span", { class: "seg" }, PROJECTS.map((q) => btn(q.name, "", () => (location.hash = `#features/${q.key}`), { "aria-pressed": String(q.key === key) }))),
      h("input", { type: "search", class: "find", placeholder: "Find a feature: id or words", value: state.featText, oninput: (e) => { state.featText = e.target.value; render(); $("find")?.focus(); }, id: "find" })),
    h("div", { class: "bar-row" }, h("span", { class: "seg filters" }, FILTERS.map(([k, l]) => btn([l, " ", h("span", { class: "count" }, n(k))], "", () => { state.featFilter = k; render(); }, { "aria-pressed": String(state.featFilter === k) })))),
    fs.length ? h("ul", { class: "flist big card" }, fs.map((x) => h("li", { class: x.status === "Done" ? "done" : x.open ? "is-open" : null },
      idLink(key, x.ref), h("a", { class: "ft", href: featHref(key, x.ref) }, x.title),
      h("span", { class: "fs" }, badge(x.status === "Done" ? "done" : x.open ? "open" : x.status.toLowerCase()), " ", stateWords(x),
        workers().some((w) => w.feature === x.ref) ? h("span", { class: "on-t" }, ` · ${workers().filter((w) => w.feature === x.ref).map((w) => w.name).join(", ")} on it`) : null,
        h("span", { class: "muted" }, ` · ${relTitle(x.release)}`), x.note ? h("span", { class: "muted" }, ` · ${x.note}`) : null))))
      : h("div", { class: "empty-card" }, text ? `No feature of ${pname(key)}'s matches “${state.featText}”.` : `${pname(key)} has no ${FILTERS.find(([k]) => k === state.featFilter)[1].toLowerCase()} feature.`, " ",
        btn("Show all", "more-t", () => { state.featFilter = "all"; state.featText = ""; render(); })),
    h("p", { class: "note" }, `Every feature on ${pname(key)}'s board, archived ones left out. The Roadmap shows them by release, in order.`),
  ];
}

// ---------- A feature's page (spec 2.8) ----------

function viewFeature(key, ref) {
  const x = feature(key, ref);
  if (!x) return [h("div", { class: "empty-card" }, `${ref} isn't on ${pname(key)}'s board.`)];
  const ss = SESSIONS[key].filter((s2) => s2.feature === ref).reverse();
  const on = workers().filter((w) => w.project === key && w.feature === ref);
  const rel = board(key).releases.find((r) => r.ref === x.release);
  const tok = (r) => (r.tokens == null ? null : state.weigh ? r.tokens * BLEND[r.model ?? "unknown"] : r.tokens);
  return [
    h("div", { class: `card feature-head${x.open ? " is-open" : ""}` },
      h("div", { class: "fh-top" }, h("span", { class: "id" }, x.ref), h("a", { href: `#project/${key}` }, pname(key)), h("span", { class: "muted" }, rel ? rel.title : "Not in a release"),
        badge(x.status === "Done" ? "done" : x.open ? "open" : x.status.toLowerCase())),
      h("h2", null, x.title),
      h("div", { class: "fh-m" }, stateWords(x), x.status === "Done" && x.tasks[1] ? h("span", null, `${x.tasks[0]} of ${plural(x.tasks[1], "task")} done`) : null, h("span", null, plural(ss.length, "session")),
        on.length ? h("span", { class: "on-t" }, `${on.map((w) => w.name).join(", ")} on it now`) : null)),
    x.status === "Done" && x.unticked.length ? h("details", { class: "card unticked" }, h("summary", null, `Done ${day(x.done)}, with ${plural(x.unticked.length, "criterion", "criteria")} not ticked`),
      h("ul", null, x.unticked.map(([n, t]) => h("li", null, h("b", null, n), ` ${t}`))), h("p", { class: "note" }, `${pname(key)}'s PO closed it with these open; the board keeps them as they were.`)) : null,
    x.waits ? h("a", { class: "banner next-banner you", href: "#needs" }, h("b", null, "Next"), h("span", null, `waits on you: ${x.waits}`)) : null,
    x.open && !on.length ? h("div", { class: "banner next-banner" }, h("b", null, "Next"), h("span", null, "the design session's close; nobody is on it now")) : null,
    on.length ? h("section", { class: "card on-now" }, h("h2", null, "On it now"), h("ul", { class: "lines now-list" }, on.map((w) => agentLine(w, "fp")))) : null,
    h("div", { class: "two" },
      h("section", null, h("h2", null, "Sessions, in the order they ran"),
        ss.length ? h("ol", { class: "steps" }, ss.map((s2) => h("li", { class: "step", dataset: { kind: s2.kind, state: s2.e === null ? "running" : "closed" } }, h("i", { class: "dot2" }),
          h("div", { class: "card" },
            h("div", { class: "top" }, h("span", { class: "kind" }, s2.kind), h("b", null, s2.label), h("span", { class: "when muted" }, s2.e === null ? `since ${stamp(s2.s)} · ${since(s2.s)}` : `${stamp(s2.s)} – ${stamp(s2.e)} · ${since(s2.s - s2.e)}`),
              badge(s2.e === null ? "running" : "closed", s2.e === null ? "open" : "closed")),
            s2.close ? h("div", { class: "outcome" }, h("span", { class: "need", dataset: { need: s2.close.need } }, `need: ${s2.close.need}`),
              h("span", null, `${s2.close.blockers} blockers · ${s2.close.majors} majors`), s2.close.sent_back ? h("span", null, `${s2.close.sent_back} sent back`) : null, s2.close.minors ? h("span", null, `${s2.close.minors} minors fixed`) : null) : null,
            s2.close ? h("p", { class: "sum" }, s2.close.summary) : null,
            h("table", { class: "runs-t" }, h("tbody", null, s2.runs.map((r) => h("tr", null,
              h("td", null, h("b", null, r.agent), h("span", { class: "muted" }, ` ${r.role}`)), h("td", { class: "muted" }, `${r.model ?? "default"}${r.effort ? ` · ${r.effort}` : ""}`),
              h("td", null, r.outcome === null ? h("span", { class: "on-t" }, "running") : r.outcome === "done" ? "done" : h("span", { class: "bad-t" }, r.outcome)),
              h("td", { class: "num" }, tok(r) == null ? h("span", { class: "warn-t" }, "unknown") : fmtTokens(tok(r))))))),
            h("div", { class: "links" }, h("a", { href: "#", onclick: (e) => (e.preventDefault(), toast("Opens the session's handoff, as today.")) }, "Handoff"),
              h("a", { href: "#", onclick: (e) => (e.preventDefault(), toast("Context per call opens under the card, as today (it moves here from Usage).")) }, `Context per call · ${s2.runs.reduce((n, r) => n + r.calls, 0)} calls`),
              s2.kind === "review" ? h("a", { href: "#", onclick: (e) => (e.preventDefault(), toast("The review's evidence: its findings and shots, from the close.")) }, "Review evidence") : null)))))
          : h("p", { class: "st-empty" }, x.status === "Done" ? "Its sessions ran before the board kept them." : "No session yet.")),
      h("aside", null, h("h2", null, "Criteria"), h("div", { class: "card crit-list" },
        h("p", { class: "muted" }, x.crit[1] ? `${x.crit[0]} of ${plural(x.crit[1], "criterion", "criteria")} met` : "No criteria yet."),
        x.ref === "LAND-50" ? h("ul", null, ["An agent proposes an edit; the change set holds it (e2e)", "A person approves or refuses it", "The tract page shows the edit and who approved it", "An edit to a tract under review replaces the proposal", "The audit row has who, when and why"].map((t, i) => h("li", { dataset: { done: String(i < 3) } }, h("span", { "aria-hidden": "true" }, i < 3 ? "✓ " : "○ "), t))) : null),
        h("a", { class: "more-t", href: "#", onclick: (e) => (e.preventDefault(), toast("History opens as today: every change to the feature and its tasks.")) }, "History →"))),
  ];
}

// ---------- Triage (as today: spec 2.10) ----------

function viewTriage(key = "bobnet") {
  const items = board(key).backlog.slice().sort((a, c) => (c[2] === "bug") - (a[2] === "bug") || c[3] - a[3]);
  const filt = { all: () => true, bugs: (x) => x[2] === "bug", none: (x) => !x[4] };
  const shown = items.filter(filt[state.triage] ?? ((x) => x[4] === state.triage));
  const rels = board(key).releases.filter((r) => r.status !== "closed");
  const ages = items.map((x) => x[3]).sort((a, c) => a - c);
  return [
    h("div", { class: "bar-row" }, h("span", { class: "seg" }, PROJECTS.map((q) => btn(q.name, "", () => (location.hash = `#triage/${q.key}`), { "aria-pressed": String(q.key === key) }))),
      h("span", { class: "seg filters" }, [["all", "All", items.length], ["bugs", "Bugs", items.filter(filt.bugs).length], ...rels.map((r) => [r.ref, r.ref, items.filter((x) => x[4] === r.ref).length]), ["none", "No release", items.filter(filt.none).length]]
        .map(([k, l, n]) => btn([l, " ", h("span", { class: "count" }, n)], "", () => { state.triage = k; render(); }, { "aria-pressed": String(state.triage === k) }))),
      btn("Edit your gates", "gates-btn", () => toast("Edit your gates, as today."))),
    h("div", { class: "totals" }, [[items.length, "backlog items"], [items.filter(filt.bugs).length, "open bugs", items.some(filt.bugs)], [age(ages.at(-1)), "oldest"], [age(ages[Math.floor(ages.length / 2)]), "median age"], [items.filter((x) => x[3] < 7 * D).length, "captured this week"]]
      .map(([v, l, hot]) => h("div", { class: hot ? "hot" : null }, h("b", null, String(v)), h("span", null, l)))),
    h("div", { class: "table-wrap" }, h("table", { class: "stack triage" },
      h("thead", null, h("tr", null, h("th", null, "Item"), h("th", null, "Type"), h("th", null, "Release"), h("th", null, "Age"))),
      h("tbody", null, shown.map(([ref, title, type, a, rel, hint, blocks]) => h("tr", null,
        h("td", { class: "wide" }, h("span", { class: "id" }, ref), " ", h("span", { class: "title" }, title), hint ? h("div", { class: "cp" }, hint) : null),
        h("td", { "data-label": "Type" }, type === "bug" ? badge("bug", blocks ? "bug · blocks use" : "bug") : h("span", { class: "muted" }, type)),
        h("td", { "data-label": "Release" }, h("span", { class: "muted" }, rel ?? "none")),
        h("td", { class: "age", "data-label": "Age" }, age(a))))))),
    h("p", { class: "note" }, `Bugs first, then oldest first. Triage is ${proj(key).po}'s, with the board tools: slot into a feature, make it a feature, put it in a release or take it out, drop it with a reason; each keeps its id. Putting one in a release is also yours, under Edit your gates.`),
  ];
}

// ---------- Usage (spec 2.9): a graph per project, all at once ----------

function viewUsage() {
  const sum = (key) => series(key).reduce((n, pt) => n + valOf(pt), 0);
  const unknown = (key) => series(key).reduce((n, pt) => n + pt.unknown, 0);
  const lost = { bobnet: 1, helix: 0 };
  return [
    h("div", { class: "bar-row u-bar" }, h("span", { class: "u-lab" }, "Weigh by model"), weighToggle(),
      h("span", { class: "seg" }, [[14, "14 days"], [30, "30 days"]].map(([n, l]) => btn(l, "", () => { state.span = n; save(); render(); }, { "aria-pressed": String(state.span === n) })))),
    h("p", { class: "u-says" }, state.weigh ? WEIGH_ON : WEIGH_OFF, " ",
      h("details", { class: "factored" }, h("summary", null, "What's factored"),
        h("div", { class: "table-wrap" }, h("table", null, h("thead", null, h("tr", null, ["Model", "Input", "Output", "Cache write", "Cache read"].map((t) => h("th", { class: t === "Model" ? null : "num" }, t)))),
          h("tbody", null, WEIGHTS.rows.map((r) => h("tr", null, h("td", null, r.model, r.alias ? h("span", { class: "muted" }, ` (${r.alias})`) : null), [r.input, r.output, r.cache_write, r.cache_read].map((v) => h("td", { class: "num" }, `×${v}`))))))),
        h("p", { class: "note" }, `Ratios of each model's list price to Sonnet 5.5's, per kind of token, read ${WEIGHTS.read_at}. Effort is ×1 at every level. A model not in the table counts ×1 and is named under its graph.`))),
    h("div", { class: "ugrid" }, PROJECTS.map((p) => {
      const pts = series(p.key), today = pts.at(-1);
      const vals = pts.map(valOf), med = [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)];
      const spikes = pts.filter((pt, i) => vals[i] > med * 2 && vals[i] > 4e6);
      return h("section", { class: "card ucard" },
        h("div", { class: "u-h" }, h("a", { class: "u-name", href: `#project/${p.key}` }, p.name),
          h("span", { class: "u-tot" }, h("b", null, fmtTokens(sum(p.key))), h("span", { class: "muted" }, ` ${state.weigh ? "Sonnet-equivalent " : ""}tokens, ${state.span} days`)),
          h("span", { class: "muted u-today" }, `today so far ${fmtTokens(valOf(today))} · median day ${fmtTokens(med)}`)),
        usageGraph(p.key), usageDayLine(p.key),
        spikes.length && state.usageDay[p.key] === undefined ? h("p", { class: "u-spike" }, h("b", null, `${plural(spikes.length, "spike")}`), ` over twice the median day: `,
          spikes.map((pt, i) => [i ? ", " : null, h("button", { type: "button", class: "more-t", onclick: () => { state.usageDay[p.key] = pt.ago; render(); } }, `${day(pt.ago * D)} ${fmtTokens(valOf(pt))}`)])) : null,
        unknown(p.key) ? h("p", { class: "muted u-unk" }, `${fmtTokens(unknown(p.key))} tokens on an unnamed model, counted at ×1`) : null,
        lost[p.key] ? h("p", { class: "muted u-unk" }, `${plural(lost[p.key], "run")} lost, tokens unknown: not counted`) : null);
    })),
    h("p", { class: "note" }, "Tap a day for what made it. A run's tokens are spread over the days it ran; today's include the workers running now, so far. A context-per-call chart is on each session's card, on the feature's page."),
  ];
}

// ---------- Laptops: what was on Sessions and isn't a project's (spec 2.11) ----------

function viewLaptops() {
  return [
    quietBanners(),
    h("p", { class: "note", style: "margin:0" }, "The laptops' supervisors, the agents on BobNet, and the rules for every project. Who ran what is on each project's page."),
    h("section", null, h("h2", null, "Laptops"), h("div", { class: "cards", id: "laptops" }, laptops().map((l) => h("div", { class: "card" },
      h("div", { class: "top" }, h("span", { class: "name" }, l.laptop), badge(l.at > 3 ? "stopped" : "running", l.at > 3 ? "no recent report" : "supervisor up")),
      h("div", { class: "meta" }, h("span", null, `${l.busy} of ${l.slots} slots busy`), h("span", null, `${l.queued} queued`), h("span", null, `up ${since(l.up)}`), h("span", null, `reported ${since(l.at)} ago`), h("span", null, `supervisor ${l.version}`)),
      l.cleanup ? h("div", { class: "cleanup" }, h("span", null, h("b", null, "Last cleanup"), ` ${since(l.cleanup.at)} ago · ${l.cleanup.trigger} · freed `, h("span", { class: "num" }, l.cleanup.freed)),
        h("ul", null, l.cleanup.rows.map(([k, v, why]) => h("li", null, h("span", null, `${k} `, h("span", { class: "num" }, v)), why ? h("span", { class: "skip" }, why) : null)))) : h("div", { class: "muted" }, "No cleanup yet"))))),
    h("section", null, h("h2", null, "Agents ", h("span", { class: "count" }, `${PEERS.filter((p) => p[1]).length} online of ${PEERS.length}`)),
      h("div", { class: "table-wrap" }, h("table", { class: "stack" },
        h("thead", null, h("tr", null, h("th", null, "Agent"), h("th", null, "Status"), h("th", { class: "num" }, "In / out 24h"), h("th", { class: "num" }, "Inbox"))),
        h("tbody", null, PEERS.map(([addr, on, team, client, status, seen, io, inbox]) => h("tr", null,
          h("td", { class: "wide" }, h("span", { class: `dot${on ? " on" : ""}` }), " ", h("span", { class: "addr" }, addr), h("div", { class: "team" }, team), h("div", { class: "client" }, client)),
          h("td", { "data-label": "Status" }, on ? status : h("span", { class: "muted" }, `last seen ${since(seen)} ago`)),
          h("td", { class: "num", "data-label": "In / out 24h" }, io), h("td", { class: "num", "data-label": "Inbox" }, inbox ? String(inbox) : "–"))))))),
    h("section", null, h("h2", null, "Rules for every project"), h("div", { class: "card" },
      h("ul", { class: "lines" }, RULES.map(([who, admin]) => h("li", { class: "rule" }, h("span", null, h("b", null, who), h("span", { class: "muted" }, admin ? " · global admin: may write every project's board" : " · reads every project")),
        btn(admin ? "Remove admin" : "Make admin", admin ? "danger" : "", () => toast(`Asks you to confirm, as today (BOB-118).`))))))),
    h("details", { class: "card msgs" }, h("summary", null, "Messages in the last 24 hours ", h("span", { class: "count" }, "112")),
      h("ul", { class: "feed" }, [[4, "Picard@mbp-1 → Howard@mbp-1"], [6, "Marvin@mbp-1 → Picard@mbp-1"], [11, "poe@mbp-1 → Mario@mbp-1"], [14, "Toad@mbp-1 → Daisy@mbp-1"]].map(([m, t]) => h("li", null, h("time", null, clock(m)), h("span", null, t)))),
      h("p", { class: "note" }, "Who messaged whom, never what was said. Kept for debugging; Casper decides whether it stays.")),
    sampleStates(),
  ];
}

// ---------- Router ----------

const VIEWS = {
  overview: () => viewOverview(), needs: () => viewNeeds(), project: (a) => viewProject(a ?? "helix"), status: (a) => viewStatus(a),
  roadmap: (a) => viewRoadmap(a), features: (a) => viewFeatures(a), feature: (a, b) => viewFeature(a, b), triage: (a) => viewTriage(a),
  usage: () => viewUsage(), laptops: () => viewLaptops(),
};
function render() {
  let [v, a, b] = location.hash.slice(1).split("/");
  // Old links land where their parts went (spec 2.11): Waits on you is Needs you; Sessions went to the project pages and Laptops.
  if (v === "waits") return void location.replace("#needs");
  if (v === "sessions") { toast("Sessions moved: who ran is on each project's page; laptops and agents are under Laptops."); return void location.replace("#project/bobnet"); }
  if (v === "feature" && a && !b) return void location.replace(`#feature/${projectOfRef(a)}/${a}`);
  if (v === "feature" && !a) return void location.replace("#features");
  if (!VIEWS[v]) v = "overview";
  header(v);
  const y = window.scrollY, same = render.last === location.hash;
  $("view").className = v === "overview" || v === "project" || v === "usage" || v === "roadmap" || v === "feature" ? "wide" : "";
  $("view").replaceChildren(...[VIEWS[v](a, b)].flat(Infinity).filter(Boolean));
  document.title = `BobNet · ${TABS.find(([k]) => k === v)?.[1] ?? (v === "project" ? pname(a ?? "helix") : v === "feature" ? b : "Laptops")} (BOB-121 prototype)`;
  if (same) window.scrollTo(0, y); else window.scrollTo(0, 0);
  render.last = location.hash;
}
window.addEventListener("hashchange", render);
render();
