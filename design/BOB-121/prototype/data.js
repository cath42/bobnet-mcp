// BOB-121 prototype: the sample both projects are drawn from. Made up in the board's and the laptop reports' shapes
// (ADR 0014 §3 for the project and usage reads), shaped like BobNet's and Helix's real boards on 2026-11-22.
// Times are minutes before the page loaded, so ages read the same whenever it is opened.
"use strict";

const NOW = Date.now();
const H = 60, D = 1440;
const at = (min) => new Date(NOW - min * 60_000).toISOString();

const PROJECTS = [
  { key: "bobnet", name: "BobNet", prefix: "BOB", lead: "Mario", po: "Peach", laptops: ["mbp-1", "ubu1"], repo: "cath42/bobnet-mcp", branch: "v2" },
  { key: "helix", name: "Helix", prefix: "LAND", lead: "Picard", po: "Picard", laptops: ["mbp-1"], repo: "cath42/helix-navigator", branch: "main" },
];

// ---------- Laptops: the supervisors' reports ----------

const LAPTOPS = [
  { laptop: "mbp-1", at: 0.3, up: 10 * H + 12, slots: 4, busy: 3, queued: 0, version: "2.0.0-rc.53", outbox: null,
    cleanup: { at: 95, trigger: "disk low", freed: "7.9 GB", rows: [["helix", "6.4 GB", null], ["bobnet", "1.2 GB", "runner skipped: a runner job is running"], ["supervisor logs", "300 MB", null]] } },
  { laptop: "ubu1", at: 0.6, up: 5 * H, slots: 3, busy: 0, queued: 0, version: "2.0.0-rc.53", outbox: null, cleanup: null },
];

// ---------- Who is running (laptop reports) ----------

const WORKERS = [
  { id: "w-picard", name: "Picard", role: "lead", project: "helix", laptop: "mbp-1", feature: "LAND-50", session: "Fixes", tasks: [],
    state: "working", model: "opus", effort: "high", tokens: 3_900_000, started: 5 * H, calls: 84, context: "92k",
    checkpoint: "LAND-50 Fixes: Howard on 50.14, Marvin re-running C7 and C9" },
  { id: "w-howard", name: "Howard", role: "builder", project: "helix", laptop: "mbp-1", feature: "LAND-50", session: "Fixes", tasks: [["LAND-50.14", "An edit to a tract under review replaces the proposal"]],
    state: "waiting on you", model: "opus", effort: "high", tokens: 1_400_000, started: 48, calls: 31, context: "61k",
    checkpoint: "50.14 built; the e2e needs a fresh tile cache, asked to clear it" },
  { id: "w-marvin", name: "Marvin", role: "qa", project: "helix", laptop: "mbp-1", feature: "LAND-50", session: "Fixes", tasks: [["LAND-50.19", "QA: C7 and C9 against staging"]],
    state: "waiting on Picard", model: "sonnet", effort: "medium", tokens: 2_200_000, started: 70, calls: 44, context: "54k",
    checkpoint: "C7 passes; C9 asks which account to edit with" },
];
const QUEUED = [];

// Pending requests (laptop reports, ADR 0013): preview kept, ask whole.
const CMD = `cd ~/Code/helix-howard && pnpm --filter @helix/land exec playwright test e2e/tract-edit.spec.ts \\
  --project=chromium --retries=0 --reporter=line \\
  --grep "an edit under review replaces the proposal" 2>&1 | tee /tmp/land-50-e2e.log
# then clear the stale tile cache the old style left behind
rm -rf apps/land/.cache/tiles/* apps/land/.cache/mapbox-sprites
git -C ~/Code/helix-howard stash push -u -m "land-50-before-e2e" -- apps/land/.env.e2e
pnpm --filter @helix/land exec playwright test e2e/tract-edit.spec.ts --project=webkit --retries=0`;

const PENDING = [
  { id: "r-412", worker_id: "w-howard", name: "Howard", laptop: "mbp-1", project: "helix", feature: "LAND-50", step: "Fixes",
    kind: "approval", tool: "Bash", tier: "human", created: 14, preview: CMD.slice(0, 399) + "…", ask: { text: CMD, cut: false, questions: [] } },
  { id: "r-418", worker_id: "w-marvin", name: "Marvin", laptop: "mbp-1", project: "helix", feature: "LAND-50", step: "Fixes",
    kind: "question", tool: "AskUserQuestion", tier: "orchestrator", created: 6,
    preview: "C9 edits a tract that is under review. Which account should I run it with on staging?",
    ask: { cut: false, text: "C9 edits a tract that is under review. Which account should I run it with on staging?", questions: [
      { header: "Account", multi: false, question: "C9 edits a tract that is under review. Which account should I run it with on staging?",
        options: [
          { label: "The demo account", description: "Has tracts under review already. Its reviewers get the notices C9 sends." },
          { label: "A fresh account per run", description: "Clean every time; the review has to be set up first, about 2 minutes more per run." },
          { label: "Casper's own account", description: "Real data. Only if you're fine with test edits showing in its history." } ] },
      { header: "Reviewer", multi: false, question: "Who approves the edit in C9?",
        options: [
          { label: "A second person in the account", description: "As the criterion reads: a person approves." },
          { label: "The same person", description: "Shorter, but the audit shows proposer and approver as one." } ] },
      { header: "Evidence", multi: true, question: "What should C9's evidence include?",
        options: [
          { label: "Screenshots", description: "The tract page before and after, on a phone and a desktop." },
          { label: "The audit row", description: "Who changed what, when and why, as the record shows it." },
          { label: "The change set's id", description: "So the review can find it." } ] },
      { header: "Re-run", multi: false, question: "C7 passed after the fix. Re-run it with C9, or leave it?",
        options: [
          { label: "Re-run C7 too", description: "About 6 minutes. Both pass on the same build." },
          { label: "Leave C7", description: "It passed on this build an hour ago." } ] },
    ] } },
];

// ---------- Needs you: the board's waits on Casper (both projects) ----------

const WAITS = [
  { ref: "Q-261", kind: "question", project: "helix", feature: "LAND-50", blocking: true, since: 3 * H + 10, from: "Picard",
    holds: [["Howard", "w-howard"], ["Marvin", "w-marvin"]], session: "Fixes",
    text: "An edit to a tract that is under review: should it wait for the review, or replace the proposal under review?",
    recommended: "(b) replace it: the reviewer sees the newer edit, and the audit keeps both",
    options: ["(a) Wait for the review to finish", "(b) Replace the proposal under review", "(c) Refuse the edit and say why"] },
  { ref: "Q-14", kind: "question", project: "bobnet", feature: "BOB-6", blocking: true, since: 5 * H, from: "Peach",
    holds: [["BOB-6", null]], session: null,
    text: "Start a session from the UI: should a session you start wait for your Allow before its first worker runs, or start at once?",
    recommended: "Start at once: you pressed Start, which is the Allow",
    options: ["Start at once", "Wait for my Allow"] },
  { ref: "DRAFT-118", kind: "bug", project: "helix", feature: "LAND-50", blocking: true, since: 20 * H, from: "you",
    holds: [], session: null, blocksUse: true,
    text: "Saving an edit on a phone loses the reason I typed when the keyboard closes" },
  { ref: "A-20", kind: "action", project: "helix", feature: "LAND-48", blocking: false, since: 4 * D, from: "Bender",
    text: "Decide whether the CI token helix-v2-ci keeps DNS: Edit" },
  { ref: "Q-259", kind: "question", project: "helix", feature: "LAND-50", blocking: false, since: 2 * D, from: "Marvin", needed: "rehearsal 3 (LAND-55)",
    text: "Is the account mark the account's initials? Will you re-save the demo home view with Status?",
    recommended: "(1) yes, as built; (2) re-save with Status before rehearsal 3", options: ["(1) and (2) as recommended", "Something else"] },
  { ref: "A-1", kind: "action", project: "bobnet", feature: null, blocking: false, since: 26 * H, from: "Mario", needed: "R2",
    text: "Add the CI token to the broker's secrets" },
  { ref: "Q-216", kind: "question", project: "helix", feature: "LAND-46", blocking: false, since: 6 * D, from: "Bill",
    text: "Should the root CLAUDE.md's hard rules become one-liners (the rule, then its ADR)?",
    recommended: "(a) now, plus (b) for rules whose ADR names the whole rule", options: ["(a) and (b)", "(a) only", "Leave them"] },
];

// Answered from here today: the board's answers and the laptops' decided permissions (ADR 0013), newest first.
const ANSWERED = [
  { perm: true, decision: "allow", name: "Bender", tool: "Bash", project: "helix", laptop: "mbp-1", at: 2 * H + 4,
    preview: "pnpm --filter @helix/land test -- --run tract-edit", note: "Fine. Only the tract-edit suite; the full e2e is Marvin's." },
  { perm: false, ref: "Q-257", project: "helix", feature: "LAND-50", at: 4 * H, text: "Does the wide map read before its text, on staging?", option: "Yes", words: null, lead: "Picard" },
  { perm: true, decision: "deny", name: "Calvin", tool: "WebFetch", project: "helix", laptop: "mbp-1", at: 5 * H + 20,
    preview: "https://api.mapbox.com/tokens/v2?access_token=[hidden]", note: null },
];

// ---------- CI: each project's workflows, newest run first (laptop board reports) ----------

const CI = {
  bobnet: [
    { name: "test", branch: "v2", runs: [
      { status: "failed", sha: "26d1d99a", at: 2 * H + 5, took: 6, by: "Toad's land", why: "packages/broker: 2 tests failed (board-usage.test.ts)" },
      { status: "passed", sha: "89c5f588", at: 7 * H, took: 6 }, { status: "passed", sha: "03a43a9e", at: 9 * H, took: 5 },
      { status: "passed", sha: "0d2071e1", at: 11 * H, took: 6 }, { status: "passed", sha: "56fe63d0", at: 13 * H, took: 6 } ] },
    { name: "release", branch: "v2", runs: [
      { status: "passed", sha: "0d2071e1", at: 11 * H, took: 3 }, { status: "passed", sha: "a51c22e0", at: 2 * D, took: 3 } ] },
  ],
  helix: [
    { name: "ci", branch: "main", runs: [
      { status: "running", sha: "7c1e2a9f", at: 4, usually: 9, by: "Howard's land" },
      { status: "passed", sha: "e1b04c7d", at: 62, took: 9 }, { status: "passed", sha: "9a2f1e33", at: 3 * H, took: 10 },
      { status: "failed", sha: "41dd0a2b", at: 5 * H, took: 8 }, { status: "passed", sha: "c0ffee12", at: 8 * H, took: 9 } ] },
    { name: "deploy-staging", branch: "main", runs: [
      { status: "passed", sha: "e1b04c7d", at: 52, took: 4 }, { status: "passed", sha: "9a2f1e33", at: 2 * H + 50, took: 4 } ] },
  ],
};

// ---------- The boards: releases and features ----------

const f = (ref, title, status, release, over = {}) => ({ ref, title, status, release, crit: [0, 0], tasks: [0, 0], done: null, open: null, unticked: [], ...over });
const HELIX_R1 = [["LAND-22","Tracts through the write path: an agent proposes, a person approves, the tract has a page"],["LAND-23","A shared kit from the reference service, so the generator emits a domain service that proposes and applies"],["LAND-24","The front page map: the account's tracts on the basemap"],["LAND-33","Getting around: the app's navigation, change-set history, tract list and search, and the record page"],["LAND-25","Leases and lessors from a workbook, on the map and on their pages"],["LAND-26","Lease clauses: Pugh, continuous development and the rest, each cited to its page"],["LAND-34","A workbook loads into a new area the agent proposes with it"],["LAND-27","Wells on the map: locations and laterals, with a page per well"],["LAND-28","Units on the map: pooled and regulatory units, their members and participation"],["LAND-29","A whole workbook as one change set, previewed on the map before approval"],["LAND-31","Demo-ready: the synthetic dataset, the script and a fresh demo account per run"],["LAND-32","Companies and areas: an owner creates them, and every land record is filed under one"],["LAND-35","The map as an exhibit: color tracts by any variable with their own bands, label them, filter by the same variables"],["LAND-36","Saved views shared in the account, the home view, and export as PNG or PDF"],["LAND-37","The map anywhere in the lower 48, search and fly-to, counts beside the map, the phone"],["LAND-46","Tests that catch real bugs and stop crying wolf: flake lint, a whole-flow test per feature, tier-4 evidence"],["LAND-39","Large change sets record and review fast"],["LAND-40","Build and CI: cheaper and safer, and how we work"],["LAND-41","An agent proposes changes to recorded records, and the record shows what changed"],["LAND-42","Demo polish: what the demo shows reads right"],["LAND-43","Switch to a company or area; an agent switches account"],["LAND-44","Pick-up: what Casper's walk-through finds before the demo"],["LAND-49","Rehearsal 1 pick-up: what Casper found rehearsing the demo, and the second rehearsal"]];

const BOARDS = {
  bobnet: {
    releases: [
      { ref: "R1", title: "R1 Central backlog view", status: "open" },
      { ref: "R2", title: "R2 Start a session from the UI", status: "open" },
    ],
    features: [
      f("BOB-1", "Prototype the central backlog view, for Casper to accept before building", "Done", "R1", { crit: [2, 2], tasks: [1, 1], done: 9 * D }),
      f("BOB-2", "The board service: a database with API and MCP tools", "Done", "R1", { crit: [12, 12], tasks: [9, 9], done: 8 * D }),
      f("BOB-7", "Who may write what, and Casper's gates from the dashboard", "Done", "R1", { crit: [6, 6], tasks: [4, 4], done: 8 * D }),
      f("BOB-14", "Move BobNet's own board into the service (pilot)", "Done", "R1", { crit: [7, 7], tasks: [3, 3], done: 7 * D }),
      f("BOB-8", "Capture backlog items in one step, and triage them", "Done", "R1", { crit: [6, 6], tasks: [5, 5], done: 7 * D }),
      f("BOB-10", "Bugs: capture, triage, 'blocks use' to Casper, close on fix", "Done", "R1", { crit: [4, 4], tasks: [3, 3], done: 6 * D }),
      f("BOB-9", "Move Helix's board off Backlog.md into the service", "Done", "R1", { crit: [6, 6], tasks: [4, 4], done: 4 * D }),
      f("BOB-3", "The roadmap across projects", "Done", "R1", { crit: [9, 9], tasks: [6, 6], done: 6 * D }),
      f("BOB-4", "A feature's sessions, outcomes and tasks", "Done", "R1", { crit: [7, 9], tasks: [7, 7], done: 5 * D,
        unticked: [["AC 6", "A session's context per call compares with the project's baseline"], ["DoD 3", "Casper has seen it live and accepted, in his words on the board"]] }),
      f("BOB-5", "What waits on Casper, across projects", "Done", "R1", { crit: [6, 6], tasks: [5, 5], done: 5 * D }),
      f("BOB-6", "Start a session from the UI, as a request to poe", "Draft", "R2", { waits: "Q-14" }),
      f("BOB-121", "Dashboard redesign, use case first: a full prototype of every view for Casper, then the build", "In Progress", null, { crit: [0, 20], tasks: [0, 2], open: 2 * H }),
      f("BOB-52", "Stop or reset a session from its feature page", "Ready", null, { crit: [0, 5] }),
      f("BOB-33", "Status: catch up after hours away", "Draft", null, { crit: [6, 11], tasks: [4, 4], note: "built; its open criteria are checked under BOB-121" }),
      f("BOB-35", "Status: a lead's note on each project", "Draft", null, { crit: [0, 4] }),
      f("BOB-36", "Status: recurring problems, grouped by theme", "Draft", null, { crit: [0, 3] }),
      f("BOB-51", "A permission shown whole, today's decided permissions, a note sent with Allow", "Done", null, { crit: [13, 16], tasks: [6, 7], done: 7 * H,
        unticked: [["AC 1", "The dashboard half: a worker's AskUserQuestion shown whole. Moved to BOB-121 criterion 14"], ["AC 2", "The dashboard half: Answered from here today. Moved to BOB-121 criterion 15"], ["AC 3", "The dashboard half: the note's label. Moved to BOB-121 criterion 16"]] }),
      f("BOB-49", "Needs you on the Overview: what holds work up, first", "Done", null, { crit: [6, 6], tasks: [3, 3], done: 2 * D }),
      f("BOB-48", "A laptop that stops reporting shows on Overview and Waits", "Done", null, { crit: [5, 5], tasks: [3, 3], done: 2 * D }),
      f("BOB-44", "Who is on what, per laptop", "Done", null, { crit: [4, 6], tasks: [2, 2], done: 3 * D,
        unticked: [["AC 4", "The laptop mark on a session card (no session card had one to show)"], ["DoD 2", "Reviewed on a tablet (reviewed on phone and desktop)"]] }),
    ],
    backlog: [
      ["BOB-161", "Answer a worker's AskUserQuestion by picking an option, from the dashboard", "task", 6 * H, null],
      ["BOB-163", "Projects at a glance shows Helix on R1, 4 of 4 done; it is on R2", "bug", 9 * H, null, "folded into BOB-121"],
      ["BOB-162", "askOf checks each field for a credential before clipping it", "task", 7 * H, null, "folded into BOB-121"],
      ["BOB-11", "Land refuses a stale tip before the check", "chore", 8 * D, "R1"],
      ["BOB-12", "Owner JWT: pin the laptop reporter, correct the README claim", "chore", 8 * D, "R1"],
      ["BOB-13", "Supervisor stores an inbound message before acking it", "chore", 8 * D, "R1"],
      ["BOB-15", "Guard Keychain reads and correct the worker-isolation claim", "chore", 7 * D, "R1"],
      ["BOB-19", "Type-check the dashboard's app.js", "chore", 6 * D, null],
      ["BOB-20", "Message store: numbered migrations and a daily retention sweep", "chore", 6 * D, null],
      ["BOB-24", "Replace Helix's ADR citations and Helix-specific strings in code", "chore", 5 * D, null],
    ],
  },
  helix: {
    releases: [
      { ref: "R0", title: "R0 Sign in and connect", status: "closed", closed: 30 * D },
      { ref: "R1", title: "R1 Partner demo", status: "closed", closed: 2 * D },
      { ref: "R2", title: "R2 Edit and audit", status: "open" },
      { ref: "R3", title: "R3 Production", status: "planned" },
    ],
    features: [
      f("LAND-2", "Sign in and see only what's yours", "Done", "R0", { crit: [231, 231], tasks: [48, 48], done: 34 * D }),
      f("LAND-3", "Your agent connects and sees the same", "Done", "R0", { crit: [80, 153], tasks: [57, 57], done: 32 * D }),
      ...HELIX_R1.map(([ref, title], i) => f(ref, title, "Done", "R1", { crit: [40 + i, 44 + i + (i % 3) * 2], tasks: [12, 12], done: (3 + (23 - i) * 0.6) * D,
        unticked: i % 3 ? [["DoD 2", "Tier-4 evidence on the phone (taken on desktop only)"], ["task criteria", `${(i % 3) * 2 + 4} of the tasks' criteria, closed with their tasks`]] : [] })),
      f("LAND-45", "Build and CI in R2: cheaper and safer, and how we work", "Done", "R2", { crit: [4, 4], tasks: [6, 6], done: 1 * D }),
      f("LAND-50", "A person edits a recorded tract: the edit is proposed, approved and audited", "In Progress", "R2", { crit: [5, 11], tasks: [9, 14], open: 2 * D }),
      f("LAND-38", "auth.md: agents self-register an account; a human claims it later", "Ready", "R2", { crit: [0, 6] }),
      f("LAND-51", "An audit trail on every record: who changed what, when, and why", "Ready", "R2", { crit: [0, 8] }),
      f("LAND-53", "Undo a change within a day", "Draft", "R2"),
      f("LAND-55", "Rehearsal 3 pick-up: what Casper finds rehearsing the edit flow", "Draft", "R2"),
      f("LAND-21", "Ready for production: what the first production deploy needs", "Draft", "R3"),
      f("LAND-4", "Invitations and the new-account notice arrive by email", "Draft", "R3"),
      f("LAND-56", "Map tiles on the commercial plan", "Draft", null),
    ],
    backlog: [
      ["DRAFT-118", "Saving an edit on a phone loses the reason I typed when the keyboard closes", "bug", 20 * H, "R2", null, true],
      ["DRAFT-110", "Switching to a just-created account with no areas reverts", "bug", 9 * D, null],
      ["DRAFT-97", "The tract list's search ignores accents (Peñasco)", "bug", 14 * D, null],
      ["DRAFT-104", "Web app: the Copy button keeps its width when it reads Copied", "chore", 12 * D, null],
      ["DRAFT-108", "QA: AG-07 with two clients, each seeing only its own account", "task", 10 * D, "R2"],
      ["DRAFT-111", "mcp-hub: /manifest serves the kit's meta-tool manifest", "task", 8 * D, null],
      ["DRAFT-113", "Prototype, then web app: a Settings section that fails to load says what didn't load", "task", 6 * D, null],
      ["DRAFT-115", "platform-testing: fakes refuse what the callee would", "chore", 4 * D, null],
      ["DRAFT-117", "Change-set history: show the approver beside the proposer", "task", 2 * D, "R2"],
    ],
  },
};

// ---------- Sessions: who ran, from the board (ADR 0014 §3, ProjectPage.sessions) ----------

// A run: [agent, role, laptop, model, effort, startedMinAgo, endedMinAgo|null, rawTokens|null, calls, outcome, reason]
const run = (agent, role, laptop, model, effort, s, e, tokens, calls, outcome = "done", reason = null) => ({ agent, role, laptop, model, effort, s, e, tokens, calls, outcome, reason });
const SESSIONS = {
  bobnet: [
    { feature: "BOB-121", kind: "design", label: "A", s: 2 * H, e: null, close: null, runs: [
      run("Toad", "architect", "mbp-1", "opus", "high", 2 * H, 50, 2_600_000, 64), run("Daisy", "designer", "mbp-1", "opus", "high", 2 * H, 10, 6_100_000, 140) ] },
    { feature: "BOB-51", kind: "review", label: "A", s: 9 * H, e: 7 * H, close: { need: "none", summary: "Build A signed off for the deploy and an rc; minor 1 (BOB-162) to the backlog.", blockers: 0, majors: 0, sent_back: 0, minors: 2 }, runs: [
      run("Toad", "architect", "mbp-1", "opus", "high", 9 * H, 7 * H + 20, 3_100_000, 70), run("Daisy", "designer", "ubu1", "opus", "high", 9 * H, 7 * H + 40, 2_400_000, 52) ] },
    { feature: "BOB-51", kind: "build", label: "A", s: 20 * H, e: 11 * H, close: { need: "none", summary: "Protocol, supervisor and broker: a request's whole ask, today's decided list, a note delivered.", blockers: 0, majors: 0, sent_back: 0, minors: 0 }, runs: [
      run("Luigi", "engineer", "mbp-1", "opus", "high", 20 * H, 11 * H + 10, 27_000_000, 210), run("Toad", "architect", "mbp-1", null, null, 15 * H, 14 * H + 30, 900_000, 18) ] },
    { feature: "BOB-51", kind: "design", label: "A", s: 30 * H, e: 26 * H, close: { need: "casper", summary: "Prototype for Casper's verdict (Q-12): rejected, redesign as BOB-121.", blockers: 0, majors: 0, sent_back: 0, minors: 0 }, runs: [
      run("Daisy", "designer", "mbp-1", "opus", "high", 30 * H, 26 * H + 30, 4_000_000, 96), run("Toad", "architect", "mbp-1", "opus", "high", 30 * H, 28 * H, 2_200_000, 40) ] },
    { feature: "BOB-48", kind: "review", label: "A", s: 2 * D + 5 * H, e: 2 * D + 3 * H, close: { need: "none", summary: "Quiet-laptop banners reviewed on phone and desktop; no findings.", blockers: 0, majors: 0, sent_back: 0, minors: 1 }, runs: [
      run("Daisy", "designer", "mbp-1", "opus", "high", 2 * D + 5 * H, 2 * D + 4 * H, 1_800_000, 38), run("Toad", "architect", "ubu1", "opus", "high", 2 * D + 5 * H, null, null, 0, "lost", "ubu1 restarted mid-run") ] },
    { feature: "BOB-48", kind: "build", label: "A", s: 2 * D + 12 * H, e: 2 * D + 6 * H, close: { need: "none", summary: "Banners on Overview and Waits; the laptop card on Sessions.", blockers: 0, majors: 0, sent_back: 0, minors: 0 }, runs: [
      run("Luigi", "engineer", "mbp-1", "opus", "high", 2 * D + 12 * H, 2 * D + 6 * H, 12_400_000, 150) ] },
  ],
  helix: [
    { feature: "LAND-50", kind: "build", label: "Fixes", s: 5 * H, e: null, close: null, runs: [
      run("Picard", "lead", "mbp-1", "opus", "high", 5 * H, null, 3_900_000, 84, null), run("Howard", "builder", "mbp-1", "opus", "high", 48, null, 1_400_000, 31, null),
      run("Marvin", "qa", "mbp-1", "sonnet", "medium", 70, null, 2_200_000, 44, null), run("Howard", "builder", "mbp-1", "opus", "high", 4 * H + 30, 2 * H, 8_300_000, 120) ] },
    { feature: "LAND-50", kind: "review", label: "1", s: 7 * H, e: 5 * H + 10, close: { need: "answer", summary: "Two majors: an edit under review is lost; the audit row misses the reason. Sent back to a Fixes build.", blockers: 0, majors: 2, sent_back: 2, minors: 1 }, runs: [
      run("Bill", "reviewer", "mbp-1", "sonnet", "high", 7 * H, 5 * H + 20, 3_300_000, 66), run("Calvin", "qa", "mbp-1", "sonnet", "medium", 7 * H, 5 * H + 30, 2_100_000, 48) ] },
    { feature: "LAND-50", kind: "build", label: "2", s: 16 * H, e: 7 * H + 20, close: { need: "none", summary: "The approve step, the audit row and the tract page's history.", blockers: 0, majors: 0, sent_back: 0, minors: 0 }, runs: [
      run("Howard", "builder", "mbp-1", "opus", "high", 16 * H, 8 * H, 18_200_000, 260), run("Marvin", "qa", "mbp-1", "sonnet", "medium", 10 * H, 7 * H + 30, 6_000_000, 110),
      run("Bender", "devops", "mbp-1", "haiku", "low", 9 * H, 8 * H + 40, 400_000, 22) ] },
    { feature: "LAND-50", kind: "build", label: "1", s: D + 10 * H, e: D + 2 * H, close: { need: "none", summary: "Propose an edit; the change set holds it.", blockers: 0, majors: 0, sent_back: 0, minors: 0 }, runs: [
      run("Howard", "builder", "mbp-1", "opus", "high", D + 10 * H, D + 2 * H, 21_500_000, 280), run("Bender", "devops", "mbp-1", "haiku", "low", D + 4 * H, D + 3 * H, 300_000, 15, "failed", "land refused: CI red on main") ] },
    { feature: "LAND-50", kind: "design", label: "A", s: 2 * D + 6 * H, e: 2 * D, close: { need: "casper", summary: "Spec and prototype of the edit flow; Casper accepted it (Q-255).", blockers: 0, majors: 0, sent_back: 0, minors: 0 }, runs: [
      run("Riker", "designer", "mbp-1", "opus", "high", 2 * D + 6 * H, 2 * D + 1 * H, 5_200_000, 120), run("Data", "architect", "mbp-1", "fable", "high", 2 * D + 6 * H, 2 * D + 2 * H, 9_800_000, 140) ] },
    { feature: "LAND-45", kind: "build", label: "1", s: 3 * D + 8 * H, e: 3 * D, close: { need: "none", summary: "Cached installs and one test job; CI time from 14 to 9 minutes.", blockers: 0, majors: 0, sent_back: 0, minors: 0 }, runs: [
      run("Bender", "devops", "mbp-1", "sonnet", "high", 3 * D + 8 * H, 3 * D, 7_400_000, 130) ] },
  ],
};

// ---------- Usage: tokens per day per project, by model (ADR 0014 §3 usage read) ----------

// Factors per model alias (ADR 0014 §1; the read sends the whole table, this is its current-model rows).
const WEIGHTS = {
  read_at: "2026-11-22",
  rows: [
    { model: "Sonnet 5.5", alias: "sonnet", input: 1, output: 1, cache_write: 1, cache_read: 1 },
    { model: "Opus 5.5", alias: "opus", input: 2, output: 2, cache_write: 2, cache_read: 2 },
    { model: "Haiku 5.5", alias: "haiku", input: 0.05, output: 0.05, cache_write: 0.05, cache_read: 0.1 },
    { model: "Fable 5.1", alias: "fable", input: 5, output: 5, cache_write: 5, cache_read: 2.5 },
    { model: "Fable 5.2", alias: null, input: 4, output: 4, cache_write: 4, cache_read: 2 },
  ],
};
// Most of a run's tokens are cache reads, so a model's blended factor sits near its cache-read ratio.
const BLEND = { sonnet: 1, opus: 2, haiku: 0.095, fable: 2.75, unknown: 1 };

/** 30 days, oldest first: each day's raw tokens per model, in millions. A seeded wobble, then the days that happened. */
function usageOf(key) {
  const days = 30, out = [];
  let seed = key === "helix" ? 7 : 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < days; i++) {
    const ago = days - 1 - i;
    const wk = new Date(NOW - ago * 86_400_000).getDay();
    const quiet = wk === 0 || wk === 6 ? 0.45 : 1;
    const m = key === "helix"
      ? { opus: (22 + rnd() * 16) * quiet, sonnet: (8 + rnd() * 7) * quiet, haiku: (0.6 + rnd()) * quiet, fable: 0, unknown: 0 }
      : { opus: (8 + rnd() * 10) * quiet, sonnet: (1 + rnd() * 2) * quiet, haiku: 0, fable: 0, unknown: (2 + rnd() * 3) * quiet };
    out.push(m);
  }
  const day = (ago) => out[days - 1 - ago];
  if (key === "helix") {
    Object.assign(day(2), { fable: 9.8, opus: 30, sonnet: 9 });     // LAND-50 design A: Data on Fable
    Object.assign(day(1), { opus: 34, sonnet: 6 });
    Object.assign(day(0), { opus: 13.6, sonnet: 13.6, haiku: 0.4 }); // today so far
    Object.assign(day(9), { opus: 64, sonnet: 11 });                 // LAND-49 rehearsal 2 build
  } else {
    Object.assign(day(0), { opus: 11.8, sonnet: 0, unknown: 0.2 });
    Object.assign(day(1), { opus: 41, sonnet: 1.4, unknown: 0.9 });  // BOB-51 build A
    Object.assign(day(2), { opus: 18, unknown: 3 });
    Object.assign(day(12), { opus: 9, unknown: 21 });                // BOB-14 move: consults on no model
  }
  return out.map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 1e6)])));
}
const USAGE = { bobnet: usageOf("bobnet"), helix: usageOf("helix") };
// What made a day big: its largest sessions (the tooltip and the day's detail under a graph).
const USAGE_DAYS = {
  helix: { 0: [["LAND-50 Fixes", "so far", 27_600_000]], 2: [["LAND-50 design A", "Data on fable", 15_000_000], ["LAND-50 build 1", "", 21_800_000]], 9: [["LAND-49 build 2", "", 52_000_000], ["LAND-49 review 1", "", 14_000_000]] },
  bobnet: { 0: [["BOB-121 design A", "", 8_700_000]], 1: [["BOB-51 build A", "", 27_900_000], ["BOB-51 design A", "", 6_200_000], ["BOB-51 review A", "", 5_500_000]], 12: [["BOB-14 build A", "consults on no model", 24_000_000]] },
};

// ---------- Status (BOB-33's read, as it is) ----------

const STATUS = {
  lastVisit: 7 * H,
  bobnet: { tone: "warn", verdict: "Mostly OK", needs: 2, done: [3, "1 feature"], stuck: 1, tokens: 36_800_000, flags: [["warn", "R1 all done: close it"], ["bad", "CI red"]],
    doneList: [["BOB-51", "Done: a permission shown whole", "build A and review A closed"], ["BOB-51", "review A", "need: none"], ["BOB-48", "review A", "need: none"]],
    stuckList: [["bad", "CI failed", "test on v2 failed 2 h ago; nobody has picked it up"]] },
  helix: { tone: "bad", verdict: "Needs a look", needs: 5, done: [6, "LAND-45 Done"], stuck: 2, tokens: 61_200_000, flags: [["bad", "Review sent back 2"], ["warn", "backlog thin"]],
    doneList: [["LAND-45", "Done: Build and CI in R2", "CI 14 → 9 min"], ["LAND-50", "build 2", "need: none"], ["LAND-50", "review 1", "2 majors, sent back"]],
    stuckList: [["warn", "Waiting on you 3 h", "Q-261 holds Howard and Marvin"], ["warn", "A run failed", "Bender's land refused: CI red on main"]] },
};

// ---------- Laptops page: agents online and the rules for every project ----------

const PEERS = [
  ["Picard@mbp-1", true, "helix", "supervisor 2.0.0-rc.53", "LAND-50 Fixes", 4 * H, "14 / 9", 0],
  ["Howard@mbp-1", true, "helix", "supervisor 2.0.0-rc.53", "LAND-50.14", 48, "3 / 4", 0],
  ["Marvin@mbp-1", true, "helix", "supervisor 2.0.0-rc.53", "LAND-50.19", 70, "2 / 3", 0],
  ["poe@mbp-1", true, "ops", "client 2.0.0-rc.53", "watching mbp-1 and ubu1", 10 * H, "22 / 18", 0],
  ["Mario@mbp-1", false, "bobnet", "supervisor 2.0.0-rc.53", null, 50, "31 / 27", 0],
  ["Daisy@mbp-1", false, "bobnet", "supervisor 2.0.0-rc.53", null, 10, "4 / 2", 0],
  ["Toad@mbp-1", false, "bobnet", "supervisor 2.0.0-rc.53", null, 50, "6 / 5", 1],
  ["Luigi@mbp-1", false, "bobnet", "supervisor 2.0.0-rc.53", null, 11 * H, "8 / 9", 0],
];
const RULES = [["poe@mbp-1", true], ["Mario@mbp-1", false]];
