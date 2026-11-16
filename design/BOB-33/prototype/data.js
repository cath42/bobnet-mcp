// BOB-33 prototype sample: shaped like BobNet's board (board_list, 16 Nov) and Helix's (design/BOB-1/sample,
// 282cca2fe), on Monday 16 Nov at 06:12. Every time is minutes before then ("ago"). Refs, titles, agents and
// commits up to 6c523c5 are real; the night's sessions, the later commits and the token counts are made up.
"use strict";

window.SAMPLE = {
  now: { day: 0, min: 6 * 60 + 12 }, // Mon 16 Nov 06:12
  lastVisit: 422, // Sun 23:10
  projects: [
    { key: "bobnet", name: "BobNet", lead: "Mario", po: "Peach" },
    { key: "helix", name: "Helix", lead: "Bob", po: "Picard" },
  ],

  // The lead's note: the latest per project (BOB-36).
  notes: {
    bobnet: { by: "Mario", ago: 292, text: "BOB-30 landed: the nightly backup now pushes board.json to its remote. BOB-31 is in its build; Luigi then Toad's review, so expect its review gate by morning. The broker deploy waits for poe's window at Helix's LAND-52 review close." },
    helix: { by: "Bob", ago: 32, text: "LAND-52 passed review and is Done. LAND-49's Fixes 2 closed 17 of 20 tasks, but Review 3 sent 49.17 back a third time: the e2e map step fails since the tile server's key rotated. Howard is waiting on your permission to use the new key; until then CI stays red." },
  },

  // Needs you: the same open waits as the Overview and Waits on you. Open now; "ago" is when it started waiting.
  needs: [
    { p: "helix", kind: "permission", ref: null, feature: "LAND-49", blocking: true, holds: "Howard (LAND-49 Fixes 3)", ago: 6,
      text: "Howard asks to run: put the rotated tile key from the team vault into the e2e config on staging" },
    { p: "bobnet", kind: "review", ref: "BOB-31", feature: "BOB-31", blocking: true, holds: "BOB-31", ago: 74,
      text: "Accept the build of BOB-31: a cut question opens in place" },
    { p: "helix", kind: "question", ref: "Q-258", feature: "LAND-49", blocking: true, holds: "LAND-49.19 and LAND-49's close", ago: 1460,
      text: "How does staging get an account with two companies for the second rehearsal?" },
    { p: "bobnet", kind: "question", ref: "Q-6", feature: "BOB-9", blocking: false, holds: null, ago: 2900,
      text: "Picard's date for moving Helix's board isn't set. Keep BOB-9 in R1, or move it to R2?" },
    { p: "helix", kind: "action", ref: "A-12", feature: "LAND-52", blocking: false, holds: null, ago: 4320, before: "release 2",
      text: "Sign the Mapbox terms for the commercial plan on the company account" },
  ],

  // Items moved to Done (features, and backlog items closed as bugs or tasks).
  done: [
    { p: "helix", ref: "LAND-52", title: "Rehearsal 2 pick-up: the demo account resets in one step", ago: 298 },
    { p: "bobnet", ref: "BOB-30", title: "Nightly board backup: push board.json to the repo's remote", ago: 307 },
    { p: "bobnet", ref: "BOB-27", title: "Board reports stuck since 04:43Z behind an over-long slot_run name", ago: 1150, bug: true },
    { p: "helix", ref: "LAND-44", title: "Pick-up: what Casper's walk-through finds before the demo", ago: 8800 },
    { p: "bobnet", ref: "BOB-5", title: "What waits on Casper, across projects", ago: 2550 },
    { p: "bobnet", ref: "BOB-3", title: "The roadmap across projects", ago: 4700 },
    { p: "bobnet", ref: "BOB-10", title: "Bugs: capture, triage, 'blocks use' to Casper, close on fix", ago: 5200 },
    { p: "bobnet", ref: "BOB-8", title: "Capture backlog items in one step, and triage them", ago: 5800 },
    { p: "bobnet", ref: "BOB-7", title: "Who may write what, and Casper's gates from the dashboard", ago: 6900 },
    { p: "bobnet", ref: "BOB-1", title: "Prototype the central backlog view, for Casper to accept before building", ago: 9500 },
    { p: "helix", ref: "LAND-43", title: "Switch to a company or area; an agent switches account", ago: 9800 },
  ],
  releases: [
    { p: "helix", ref: "R0", title: "R0 Sign in and connect", ago: 8200 },
  ],
  deploys: [
    { p: "bobnet", what: "Broker deployed, version 44945736: carries run_remote", ago: 205 },
    { p: "bobnet", what: "Broker deployed, version 2be1c07a: the roadmap and gates", ago: 4650 },
  ],

  // Closed sessions. dur: minutes the session ran (for usage in a span). need: none | answer | casper.
  // findings: review blockers and majors, with their theme (BOB-35 records themes at close).
  sessions: [
    { p: "bobnet", f: "BOB-31", kind: "design", label: "Spec", who: "Daisy", ago: 400, dur: 70, need: "none", tokens: 3.1e6, commit: "8864520",
      summary: "Spec and prototype: a cut question opens in place, on the Overview and on Waits on you." },
    { p: "helix", f: "LAND-52", kind: "build", label: "Build 2", who: "Howard", ago: 410, dur: 150, need: "none", tokens: 11.6e6, commit: "4d07b2c",
      summary: "The demo account resets in one step; the rehearsal script reads the reset account's name." },
    { p: "bobnet", f: "BOB-30", kind: "build", label: "Push", who: "Luigi", ago: 352, dur: 60, need: "none", tokens: 5.4e6, commit: "6c523c5",
      summary: "The nightly backup pushes board.json to its repo's remote; a failed push is logged and the next night's carries it." },
    { p: "bobnet", f: "BOB-30", kind: "review", label: "Push", who: "Toad", ago: 318, dur: 30, need: "none", tokens: 1.9e6, minors: 1,
      summary: "Signed off. One minor fixed: the warning names the remote." },
    { p: "helix", f: "LAND-52", kind: "review", label: "Review 1", who: "Bender", ago: 300, dur: 100, need: "none", tokens: 3.4e6, minors: 2,
      summary: "Signed off: the demo account resets cleanly. Deploy window open." },
    { p: "helix", f: "LAND-49", kind: "build", label: "Fixes 2", who: "Howard", ago: 212, dur: 170, need: "none", tokens: 14.2e6, commit: "9e3f1a0",
      summary: "Fixed 17 of Review 2's 20 tasks. 49.17 (tiles on a cold start) and 49.21 are left." },
    { p: "bobnet", f: "BOB-31", kind: "build", label: "Build 1", who: "Luigi", ago: 172, dur: 130, need: "none", tokens: 8.7e6, commit: "b41c9e2",
      summary: "Show all on a cut line; the asker's context opens on Waits on you. Shots at 390, 1024 and 1440." },
    { p: "bobnet", f: "BOB-33", kind: "design", label: "Requirements", who: "Peach", ago: 150, dur: 60, need: "answer", tokens: 4.0e6,
      summary: "Requirements for the Status tab; Q-2 to Q-5 asked and answered." },
    { p: "bobnet", f: "BOB-31", kind: "review", label: "Review 1", who: "Toad", ago: 120, dur: 45, need: "none", tokens: 2.4e6, majors: 1, sentBack: 1,
      findings: [{ sev: "major", theme: "evidence", text: "No phone shot of an open line" }],
      summary: "One major: the open state has no phone shot. Sent BOB-31.2 back." },
    { p: "helix", f: "LAND-49", kind: "review", label: "Review 3", who: "Bill", ago: 95, dur: 110, need: "answer", tokens: 9.8e6, majors: 2, sentBack: 2,
      findings: [{ sev: "major", theme: "flaky e2e", text: "e2e map step fails on a cold start (49.17)" }, { sev: "major", theme: "evidence", text: "49.21 has no screenshot for its criterion" }],
      summary: "Two majors. Sent back 49.17 (third time) and 49.21. Waits on Q-258 for the second company." },
    { p: "bobnet", f: "BOB-31", kind: "build", label: "Fixes", who: "Luigi", ago: 74, dur: 40, need: "casper", tokens: 2.2e6, commit: "c7a10d3",
      summary: "Added the phone shot of an open line. The review gate is Casper's." },
    // Older than last night.
    { p: "bobnet", f: "BOB-4", kind: "build", label: "Fixes", who: "Luigi", ago: 730, dur: 40, need: "none", tokens: 2.0e6, commit: "c443927",
      summary: "The minor and two nits fixed; remote_url is claude.ai only on both ops." },
    { p: "bobnet", f: "BOB-4", kind: "review", label: "remote", who: "Toad", ago: 790, dur: 50, need: "none", tokens: 2.6e6, minors: 0, commit: "c19f613",
      summary: "run_remote signed off, ADR 0001 §9 written. One minor and two nits to fix before the deploy." },
    { p: "bobnet", f: "BOB-4", kind: "build", label: "remote", who: "Luigi", ago: 860, dur: 120, need: "none", tokens: 7.9e6, commit: "8a2fba3",
      summary: "run_remote: a run's Remote Control link, set once, https only." },
    { p: "bobnet", f: "BOB-27", kind: "build", label: "Fix", who: "Luigi", ago: 1180, dur: 50, need: "none", tokens: 4.1e6, commit: "a3f0c11",
      summary: "slot_run names cut to 64 characters; the stuck board reports drain." },
    { p: "helix", f: "LAND-52", kind: "build", label: "Build 1", who: "Howard", ago: 1300, dur: 210, need: "none", tokens: 12.9e6, commit: "71c2e9d",
      summary: "A fresh demo account per rehearsal, with the second company's tracts." },
    { p: "helix", f: "LAND-52", kind: "design", label: "Spec", who: "Picard", ago: 2000, dur: 80, need: "none", tokens: 3.3e6,
      summary: "What rehearsal 1 found, as LAND-52's criteria: reset, script, second company." },
    { p: "bobnet", f: "BOB-5", kind: "retro", label: "Retro", who: "Mario", ago: 2600, dur: 20, need: "none", tokens: 1.1e6,
      retro: ["stale tip"], summary: "Land ran the whole check on a stale tip again and failed after 9 minutes." },
    { p: "bobnet", f: "BOB-5", kind: "review", label: "Review 1", who: "Toad", ago: 4300, dur: 50, need: "none", tokens: 3.0e6, majors: 1, sentBack: 1,
      findings: [{ sev: "major", theme: "evidence", text: "No phone shot of the answered state" }],
      summary: "One major: the answered state has no phone shot." },
    { p: "helix", f: "LAND-49", kind: "review", label: "Review 2", who: "Bill", ago: 2900, dur: 130, need: "none", tokens: 6.1e6, blockers: 1, sentBack: 20,
      findings: [{ sev: "blocker", theme: "flaky e2e", text: "The demo flow's e2e fails one run in three on the map tiles" }],
      summary: "One blocker, twenty tasks back to Fixes 2." },
    { p: "helix", f: "LAND-49", kind: "build", label: "Fixes 1", who: "Howard", ago: 4400, dur: 190, need: "none", tokens: 13.4e6, commit: "e0b4d55",
      summary: "Rehearsal 1's findings fixed but 49.17; staging seeded for the rehearsal." },
    { p: "bobnet", f: "BOB-3", kind: "retro", label: "Retro", who: "Mario", ago: 5000, dur: 20, need: "none", tokens: 0.9e6,
      retro: ["stale tip"], summary: "Two lands failed on a stale tip; each cost a full check." },
    { p: "bobnet", f: "BOB-3", kind: "review", label: "Review 1", who: "Toad", ago: 7100, dur: 60, need: "none", tokens: 3.2e6, majors: 1, sentBack: 1,
      findings: [{ sev: "major", theme: "evidence", text: "Roadmap unfolded: no phone shot" }],
      summary: "One major: no phone shot of the unfolded roadmap." },
    { p: "helix", f: "LAND-43", kind: "retro", label: "Retro", who: "Bob", ago: 9000, dur: 25, need: "none", tokens: 1.2e6,
      retro: ["brief named no tasks"], summary: "The brief didn't name the tasks; Howard picked two that Marvin was on." },
    // Older than a week: in Recurring problems only (it looks back 4 weeks).
    { p: "helix", f: "LAND-49", kind: "review", label: "Review 1", who: "Bill", ago: 13000, dur: 120, need: "none", tokens: 5.8e6, majors: 1, sentBack: 1,
      findings: [{ sev: "major", theme: "flaky e2e", text: "Map tiles time out on a cold start in e2e (49.17)" }], summary: "" },
    { p: "bobnet", f: "BOB-1", kind: "retro", label: "Retro", who: "Mario", ago: 12500, dur: 20, need: "none", tokens: 0.8e6,
      retro: ["stale tip"], summary: "" },
    { p: "helix", f: "LAND-44", kind: "retro", label: "Retro", who: "Bob", ago: 25000, dur: 20, need: "none", tokens: 1.0e6,
      retro: ["brief named no tasks"], summary: "" },
    { p: "helix", f: "LAND-46", kind: "review", label: "Review 1", who: "Bill", ago: 30000, dur: 90, need: "none", tokens: 4.4e6, majors: 1,
      findings: [{ sev: "major", theme: "flaky e2e", text: "The whole-flow test retries hide a real flake" }], summary: "" },
  ],

  // Lands besides the sessions' own commits: the leads' plan and board commits.
  lands: [
    { p: "bobnet", sha: "1be42ad", who: "Mario", what: "plan: deploy window = LAND-52 review close", ago: 330 },
    { p: "bobnet", sha: "6389489", who: "Mario", what: "plan: broker deployed 44945736", ago: 200 },
    { p: "helix", sha: "5d10a77", who: "Bob", what: "plan: LAND-49 Fixes 3 next", ago: 90 },
  ],

  // Sent back twice or more (in 4 weeks).
  sentBack: [
    { p: "helix", ref: "LAND-49.17", title: "Map tiles load on a cold start in e2e", times: [["Review 1", 13000], ["Review 2", 2900], ["Review 3", 95]] },
  ],
  // Retro findings that came back: the backlog item it became, if any.
  retroItems: { "stale tip": { p: "bobnet", ref: "BOB-11", title: "Land refuses a stale tip before the check", status: "Ready", release: null },
                "brief named no tasks": null },

  // What's stuck: open now. Each settles (and leaves) when its source says so.
  stuck: [
    { p: "helix", kind: "ci", label: "CI red", ref: "v2", ago: 134, sev: "bad",
      text: "e2e fails on the map step: tiles answer 403 since the tile server's key rotated", meta: "4 runs failed on v2 · last Marvin's, 05:31" },
    { p: "helix", kind: "land", label: "Land failed", ref: "LAND-49.21", ago: 77, sev: "bad",
      text: "Marvin's land of 49.21 failed typecheck in apps/map", meta: "Marvin is on it again since 05:20" },
    { p: "helix", kind: "noagent", label: "Nobody on it", ref: "LAND-45", ago: 282, sev: "warn",
      text: "LAND-45 Build 1 is open with no agent for 4 h 42 min", meta: "opened by Bob at 01:30; Howard was moved to LAND-49" },
    { p: "bobnet", kind: "idle", label: "No run", ref: "BOB-14", ago: 1532, sev: "warn",
      text: "BOB-14 is In Progress with no open run for 25 h", meta: "Move BobNet's own board into the service (pilot) · 5 of 7 criteria" },
  ],
  settled: [
    { p: "bobnet", text: "Luigi's run on BOB-31 Build 1 stopped at the context limit; restarted at 02:05 and closed", ago: 172 },
    { p: "helix", text: "Q-257 answered at 23:40; LAND-52 Build 2 went on", ago: 392 },
  ],

  // Backlog health: now, not in the span.
  backlog: {
    bobnet: {
      release: { ref: "R1", title: "R1 Central backlog view", left: 4 },
      ready: [["BOB-4", 9], ["BOB-2", 12], ["BOB-9", 8], ["BOB-14", 7]], sessions: 7,
      noCriteria: [],
      triage: { items: 20, bugs: 1, oldest: "2 d", oldestRef: "BOB-11" },
      nextEmpty: { ref: "R2", title: "R2 Start a session from the UI" },
    },
    helix: {
      release: { ref: "R1", title: "R1 Partner demo", left: 2 },
      ready: [["LAND-49", 20]], sessions: 2,
      noCriteria: [["LAND-42", "Ready", "Demo polish: what the demo shows reads right"], ["LAND-45", "Ready", "Build and CI in R2: cheaper and safer"], ["LAND-38", "Draft", "auth.md: agents self-register an account"]],
      triage: { items: 103, bugs: 4, oldest: "19 d", oldestRef: "LAND-58" },
      nextEmpty: null,
    },
  },

  // Usage beyond the sessions above: running agents and leads, as [who, role, project, from ago, to ago, tokens].
  runs: [
    ["Mario", "lead", "bobnet", 10080, 0, 58e6], ["Bob", "lead", "helix", 10080, 0, 74e6],
    ["Daisy", "designer", "bobnet", 25, 0, 1.8e6], ["Howard", "engineer", "helix", 6, 0, 0.6e6],
    ["Marvin", "tester", "helix", 160, 0, 9.4e6], ["Picard", "product owner", "helix", 120, 60, 2.1e6],
    ["Luigi", "engineer", "bobnet", 10080, 1440, 61e6], ["Toad", "architect", "bobnet", 10080, 1440, 14e6],
    ["Peach", "product owner", "bobnet", 10080, 1440, 12e6], ["Daisy", "designer", "bobnet", 10080, 1440, 16e6],
    ["Howard", "engineer", "helix", 10080, 1440, 88e6], ["Marvin", "tester", "helix", 10080, 1440, 41e6],
    ["Bill", "reviewer", "helix", 10080, 1440, 19e6], ["Picard", "product owner", "helix", 10080, 1440, 9e6],
  ],
  roles: { Mario: "lead", Peach: "product owner", Daisy: "designer", Toad: "architect", Luigi: "engineer",
           Bob: "lead", Picard: "product owner", Howard: "engineer", Marvin: "tester", Bill: "reviewer", Bender: "reviewer" },
  usual: { design: 3.5e6, build: 9e6, review: 3.7e6, retro: 1.2e6 },
};
