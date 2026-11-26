// BOB-211 prototype data: BobNet's sessions from 13 to 26 Nov 2026, in Casper's day (America/Chicago), and Helix's beside them.
//
// Real, from the board (board_get, 2026-11-26): BOB-121 build E (Luigi, one run, 50 calls, 16,340,236 tokens, 32,677,256
// Sonnet-equivalent) and BOB-121 review E (Toad twice, Daisy twice, Mario once; 15,932,062 tokens, 31,847,042 Sonnet-equivalent).
// Review E's runs fall on 23, 25 and 26 Nov; Mario's run crosses midnight and is split by wall time, as the usage read splits it.
// BobNet was paused from 23 Nov 20:18 to 25 Nov 22:00, so 24 Nov has no tokens.
// Shaped like them: every other session's agents, tokens and calls. Context per call isn't in the reads I can make (the feature
// `get` with `ctx` is the dashboard's), so each run's curve is drawn so that its calls add up to the run's own context tokens.
"use strict";

const TODAY = "2026-11-26";
const RATE = { opus: 2.0, sonnet: 1.0, haiku: 0.05 };

const TITLES = {
  "BOB-1": "Prototype the central backlog view, for Casper to accept before building",
  "BOB-2": "The board service: a database with API and MCP tools",
  "BOB-7": "Who may write what, and Casper's gates from the dashboard",
  "BOB-8": "Capture backlog items in one step, and triage them",
  "BOB-9": "Move Helix's board off Backlog.md into the service",
  "BOB-14": "Move BobNet's own board into the service (pilot)",
  "BOB-31": "Questions on the dashboard: expand a truncated question to read it whole",
  "BOB-33": "Status tab: catch up after hours away",
  "BOB-44": "One orchestrator across laptops: spawn, follow, answer and stop workers on another laptop's supervisor",
  "BOB-47": "Move Athletic's board off Backlog.md into the service",
  "BOB-48": "Dead permission requests and quiet laptops clear or show",
  "BOB-49": "Waits on you is never stale, and a lead's question shows",
  "BOB-51": "A permission question reaches the dashboard whole, and a note sent with Allow is delivered",
  "BOB-111": "An answer to a board question wakes whoever it holds up",
  "BOB-121": "Dashboard redesign, use case first: a full prototype of every view for Casper, then the build",
  "BOB-122": "The PO moves a feature into or out of a release (no longer Casper's gate)",
  "BOB-189": "Roadmap POs organize releases: create, edit, close and reopen them, and move features between them",
  "BOB-211": "Usage: from a session's bar to its agents, spend per agent, and each agent's context/call graph",
  "LAND-2": "Sign in and see only what's yours",
  "LAND-38": "auth.md: agents self-register an account; a human claims it later",
  "LAND-45": "Build and CI in R2: cheaper and safer, and how we work",
  "LAND-50": "A person edits a recorded tract: the edit is proposed, approved and audited",
};

// Average context per call by role, for the shaped runs: a builder reads much more per call than a reviewer.
const AVG = { luigi: 300e3, toad: 100e3, daisy: 85e3, mario: 95e3, peach: 60e3, builder: 240e3, qa: 90e3, lead: 80e3 };

/** A run: who, model and effort, tokens, calls, the day(s) it fell on, how it ended. `raw` and `w` are tokens and Sonnet-equivalent. */
function R(agent, model, raw, on, more = {}) {
  const role = more.role ?? agent.toLowerCase();
  const calls = more.calls ?? Math.max(6, Math.round((raw * 0.99) / (AVG[role] ?? 100e3)));
  return { agent, role, model, effort: more.effort ?? "medium", raw: Math.round(raw), w: Math.round(more.w ?? raw * RATE[model]), calls,
    on: typeof on === "string" ? { [on]: 1 } : on, outcome: more.outcome ?? "done", reason: more.reason ?? null,
    out: more.out ?? Math.round(raw * 0.007), start: more.start ?? null, end: more.end ?? null, live: !!more.live, seed: more.seed ?? 0 };
}
const M = 1e6;
/** A session: feature, kind, label, when (Casper's clock), its runs. */
const S = (project, feature, kind, label, when, runs, more = {}) => ({ project, feature, kind, label, when, runs, open: !!more.open, title: TITLES[feature] ?? "" });

const SESSIONS = [
  // 13-14 Nov: the board's first days
  S("bobnet", "BOB-1", "design", "A", ["Fri 13 Nov 09:40", "Fri 13 Nov 17:05"], [R("Daisy", "opus", 6.2 * M, "2026-11-13"), R("Peach", "sonnet", 2.1 * M, "2026-11-13")]),
  S("bobnet", "BOB-1", "review", "A", ["Sat 14 Nov 08:10", "Sat 14 Nov 09:02"], [R("Toad", "opus", 3.1 * M, "2026-11-14"), R("Daisy", "opus", 2.8 * M, "2026-11-14")]),
  S("bobnet", "BOB-2", "build", "A", ["Sat 14 Nov 10:30", "Sat 14 Nov 16:44"], [R("Luigi", "opus", 14.8 * M, "2026-11-14", { effort: "high" })]),
  S("bobnet", "BOB-14", "design", "A", ["Sat 14 Nov 18:20", "Sat 14 Nov 19:31"], [R("Toad", "opus", 4.4 * M, "2026-11-14", { effort: "high" })]),
  S("bobnet", "BOB-2", "build", "B", ["Sun 15 Nov 07:55", "Sun 15 Nov 13:12"], [R("Luigi", "opus", 17.2 * M, "2026-11-15", { effort: "high" })]),
  S("bobnet", "BOB-7", "build", "A", ["Sun 15 Nov 13:40", "Sun 15 Nov 15:02"], [R("Luigi", "opus", 6.5 * M, "2026-11-15")]),
  S("bobnet", "BOB-8", "build", "A", ["Sun 15 Nov 15:20", "Sun 15 Nov 16:38"], [R("Luigi", "opus", 5.9 * M, "2026-11-15")]),
  S("bobnet", "BOB-14", "build", "A", ["Sun 15 Nov 17:10", "Sun 15 Nov 20:26"], [R("Luigi", "opus", 9.1 * M, "2026-11-15")]),
  S("bobnet", "BOB-14", "review", "A", ["Mon 16 Nov 08:30", "Mon 16 Nov 10:14"], [R("Toad", "opus", 3.0 * M, "2026-11-16"), R("Daisy", "opus", 2.2 * M, "2026-11-16"), R("Peach", "sonnet", 1.1 * M, "2026-11-16")]),
  S("bobnet", "BOB-31", "build", "A", ["Mon 16 Nov 10:40", "Mon 16 Nov 11:52"], [R("Luigi", "opus", 4.2 * M, "2026-11-16")]),
  S("bobnet", "BOB-33", "design", "A", ["Mon 16 Nov 13:05", "Mon 16 Nov 16:20"], [R("Daisy", "opus", 5.5 * M, "2026-11-16"), R("Peach", "sonnet", 1.6 * M, "2026-11-16")]),
  S("bobnet", "BOB-44", "design", "A", ["Mon 16 Nov 17:00", "Mon 16 Nov 19:48"], [R("Toad", "opus", 7.9 * M, "2026-11-16", { effort: "high" })]),
  // 17-21 Nov: R2
  S("bobnet", "BOB-44", "build", "A", ["Tue 17 Nov 07:30", "Tue 17 Nov 14:10"], [R("Luigi", "opus", 18.4 * M, "2026-11-17", { effort: "high" })]),
  S("bobnet", "BOB-9", "build", "A", ["Tue 17 Nov 14:30", "Tue 17 Nov 16:55"], [R("Luigi", "opus", 7.7 * M, "2026-11-17")]),
  S("bobnet", "BOB-47", "build", "A", ["Tue 17 Nov 17:05", "Tue 17 Nov 18:12"], [R("Luigi", "opus", 3.9 * M, "2026-11-17")]),
  S("bobnet", "BOB-48", "design", "A", ["Tue 17 Nov 19:00", "Tue 17 Nov 20:31"], [R("Toad", "opus", 2.4 * M, "2026-11-17"), R("Daisy", "opus", 3.1 * M, "2026-11-17")]),
  S("bobnet", "BOB-44", "build", "B", ["Wed 18 Nov 07:45", "Wed 18 Nov 13:20"], [R("Luigi", "opus", 16.1 * M, "2026-11-18", { effort: "high" })]),
  S("bobnet", "BOB-44", "review", "A", ["Wed 18 Nov 13:40", "Wed 18 Nov 15:18"], [R("Toad", "opus", 4.0 * M, "2026-11-18"), R("Daisy", "opus", 3.5 * M, "2026-11-18")]),
  S("bobnet", "BOB-49", "build", "A", ["Wed 18 Nov 16:00", "Wed 18 Nov 18:40"], [R("Luigi", "opus", 6.6 * M, "2026-11-18")]),
  S("bobnet", "BOB-44", "build", "C", ["Thu 19 Nov 08:05", "Thu 19 Nov 12:50"], [R("Luigi", "opus", 13.0 * M, "2026-11-19", { effort: "high" })]),
  S("bobnet", "BOB-48", "build", "A", ["Thu 19 Nov 13:10", "Thu 19 Nov 15:44"], [R("Luigi", "opus", 7.4 * M, "2026-11-19")]),
  S("bobnet", "BOB-51", "design", "A", ["Thu 19 Nov 16:00", "Thu 19 Nov 18:15"], [R("Daisy", "opus", 4.8 * M, "2026-11-19"), R("Toad", "opus", 2.6 * M, "2026-11-19")]),
  S("bobnet", "BOB-44", "review", "B", ["Fri 20 Nov 08:20", "Fri 20 Nov 10:35"], [R("Toad", "opus", 5.2 * M, "2026-11-20"), R("Daisy", "opus", 4.1 * M, "2026-11-20")]),
  S("bobnet", "BOB-51", "build", "A", ["Fri 20 Nov 10:50", "Fri 20 Nov 14:02"], [R("Luigi", "opus", 8.8 * M, "2026-11-20")]),
  S("bobnet", "BOB-49", "build", "B", ["Fri 20 Nov 14:30", "Fri 20 Nov 18:06"], [R("Luigi", "opus", 9.3 * M, "2026-11-20")]),
  S("bobnet", "BOB-111", "design", "A", ["Sat 21 Nov 09:00", "Sat 21 Nov 11:12"], [R("Toad", "opus", 6.0 * M, "2026-11-21", { effort: "high" })]),
  S("bobnet", "BOB-111", "build", "A", ["Sat 21 Nov 11:40", "Sat 21 Nov 15:55"], [R("Luigi", "opus", 11.4 * M, "2026-11-21")]),
  S("bobnet", "BOB-48", "review", "A", ["Sat 21 Nov 16:10", "Sat 21 Nov 17:02"], [R("Toad", "opus", 2.3 * M, "2026-11-21"), R("Daisy", "opus", 2.0 * M, "2026-11-21")]),
  // 22 Nov: BOB-121's design, BOB-189
  S("bobnet", "BOB-121", "design", "A", ["Sun 22 Nov 07:50", "Sun 22 Nov 15:30"], [R("Daisy", "opus", 21.3 * M, "2026-11-22", { effort: "high" }), R("Toad", "opus", 6.8 * M, "2026-11-22", { effort: "high" }), R("Peach", "sonnet", 2.4 * M, "2026-11-22")]),
  S("bobnet", "BOB-122", "build", "A", ["Sun 22 Nov 08:10", "Sun 22 Nov 09:44"], [R("Luigi", "opus", 4.9 * M, "2026-11-22")]),
  S("bobnet", "BOB-189", "design", "A", ["Sun 22 Nov 19:40", "Sun 22 Nov 21:05"], [R("Toad", "opus", 5.6 * M, "2026-11-22", { effort: "high" })]),
  S("bobnet", "BOB-121", "build", "A", ["Sun 22 Nov 16:00", "Sun 22 Nov 19:20"], [R("Luigi", "opus", 12.7 * M, "2026-11-22", { effort: "high" }), R("Mario", "opus", 3.1 * M, "2026-11-22")]),
  // 23 Nov: builds B-E and their reviews, the day's spike
  S("bobnet", "BOB-189", "review", "A", ["Mon 23 Nov 00:15", "Mon 23 Nov 01:40"], [R("Toad", "opus", 4.1 * M, "2026-11-23", { effort: "high" }), R("Daisy", "opus", 3.3 * M, "2026-11-23")]),
  S("bobnet", "BOB-121", "build", "B", ["Mon 23 Nov 10:05", "Mon 23 Nov 12:40"], [R("Luigi", "opus", 13.9 * M, "2026-11-23", { effort: "high" }), R("Mario", "opus", 1.9 * M, "2026-11-23")]),
  S("bobnet", "BOB-121", "review", "B", ["Mon 23 Nov 12:45", "Mon 23 Nov 13:58"], [R("Toad", "opus", 5.1 * M, "2026-11-23", { effort: "high" }), R("Daisy", "opus", 4.7 * M, "2026-11-23")]),
  S("bobnet", "BOB-121", "build", "C", ["Mon 23 Nov 14:00", "Mon 23 Nov 16:10"], [R("Luigi", "opus", 19.6 * M, "2026-11-23", { effort: "high" }), R("Mario", "opus", 2.0 * M, "2026-11-23")]),
  S("bobnet", "BOB-121", "review", "C", ["Mon 23 Nov 16:15", "Mon 23 Nov 17:20"], [R("Toad", "opus", 5.3 * M, "2026-11-23", { effort: "high" }), R("Daisy", "opus", 6.0 * M, "2026-11-23", { effort: "high" })]),
  S("bobnet", "BOB-121", "build", "D", ["Mon 23 Nov 17:25", "Mon 23 Nov 18:30"], [R("Luigi", "opus", 18.1 * M, "2026-11-23", { effort: "high" })]),
  S("bobnet", "BOB-121", "review", "D", ["Mon 23 Nov 18:32", "Mon 23 Nov 19:10"], [R("Toad", "opus", 4.9 * M, "2026-11-23"), R("Daisy", "opus", 5.5 * M, "2026-11-23")]),
  S("bobnet", "BOB-121", "build", "E", ["Mon 23 Nov 19:14", "Mon 23 Nov 20:13"], [
    R("Luigi", "opus", 16340236, "2026-11-23", { w: 32677256, calls: 50, out: 114132, start: "19:14", end: "20:13", seed: 7 }),
  ]),
  S("bobnet", "BOB-121", "review", "E", ["Mon 23 Nov 20:13", "Thu 26 Nov 02:51"], [
    R("Toad", "opus", 1394170, "2026-11-23", { w: 2785123, calls: 13, out: 18487, outcome: "stopped", reason: "stopped by the orchestrator", start: "Mon 20:13", end: "20:16", seed: 3 }),
    R("Daisy", "opus", 1301991, "2026-11-23", { w: 2600850, calls: 13, out: 15506, outcome: "stopped", reason: "stopped by the orchestrator", start: "Mon 20:13", end: "20:16", seed: 4 }),
    R("Mario", "opus", 6279371, { "2026-11-25": 0.3979, "2026-11-26": 0.6021 }, { w: 12554598, calls: 67, out: 27356, outcome: "stopped", reason: "supervisor shutting down", start: "Wed 22:07", end: "Thu 02:51", seed: 5 }),
    R("Toad", "opus", 1071703, "2026-11-25", { w: 2140380, calls: 22, out: 9850, start: "Wed 22:08", end: "22:16", seed: 6 }),
    R("Daisy", "opus", 5884827, "2026-11-25", { w: 11766091, calls: 70, out: 29608, start: "Wed 22:08", end: "22:30", seed: 8 }),
  ]),
  // 26 Nov, today: BOB-211's design runs now
  S("bobnet", "BOB-211", "design", "A", ["Thu 26 Nov 10:08", null], [R("Daisy", "opus", 4.1 * M, "2026-11-26", { calls: 41, live: true, start: "10:08" })], { open: true }),

  // Helix
  S("helix", "LAND-38", "design", "1", ["Sat 14 Nov 09:00", "Sat 14 Nov 12:10"], [R("Picard", "opus", 9.8 * M, "2026-11-14", { role: "lead" })]),
  S("helix", "LAND-2", "build", "1", ["Sun 15 Nov 08:00", "Sun 15 Nov 15:30"], [R("Howard", "opus", 24.1 * M, "2026-11-15", { role: "builder" }), R("Picard", "opus", 4.0 * M, "2026-11-15", { role: "lead" })]),
  S("helix", "LAND-2", "review", "1", ["Mon 16 Nov 09:00", "Mon 16 Nov 11:40"], [R("Marvin", "sonnet", 8.2 * M, "2026-11-16", { role: "qa" }), R("Picard", "opus", 2.2 * M, "2026-11-16", { role: "lead" })]),
  S("helix", "LAND-45", "build", "1", ["Tue 17 Nov 08:30", "Tue 17 Nov 17:00"], [R("Howard", "opus", 31.0 * M, "2026-11-17", { role: "builder" }), R("Picard", "opus", 5.1 * M, "2026-11-17", { role: "lead" })]),
  S("helix", "LAND-45", "review", "1", ["Wed 18 Nov 09:10", "Wed 18 Nov 12:00"], [R("Marvin", "sonnet", 9.4 * M, "2026-11-18", { role: "qa" })]),
  S("helix", "LAND-50", "design", "1", ["Thu 19 Nov 09:00", "Thu 19 Nov 13:00"], [R("Picard", "opus", 12.3 * M, "2026-11-19", { role: "lead" })]),
  S("helix", "LAND-50", "build", "1", ["Fri 20 Nov 07:30", "Fri 20 Nov 18:10"], [R("Howard", "opus", 38.5 * M, "2026-11-20", { role: "builder" }), R("Picard", "opus", 6.2 * M, "2026-11-20", { role: "lead" })]),
  S("helix", "LAND-50", "review", "1", ["Sat 21 Nov 08:30", "Sat 21 Nov 12:20"], [R("Marvin", "sonnet", 11.0 * M, "2026-11-21", { role: "qa" }), R("Picard", "opus", 3.3 * M, "2026-11-21", { role: "lead" })]),
  S("helix", "LAND-50", "build", "2", ["Sun 22 Nov 07:40", "Mon 23 Nov 01:10"], [R("Howard", "opus", 52.0 * M, { "2026-11-22": 0.86, "2026-11-23": 0.14 }, { role: "builder", effort: "high" }), R("Picard", "opus", 8.4 * M, "2026-11-22", { role: "lead" })]),
  S("helix", "LAND-50", "build", "Fixes", ["Wed 25 Nov 08:00", null], [R("Howard", "opus", 21.5 * M, { "2026-11-25": 0.55, "2026-11-26": 0.45 }, { role: "builder", live: true }), R("Marvin", "sonnet", 6.3 * M, "2026-11-26", { role: "qa", live: true }), R("Picard", "opus", 3.9 * M, "2026-11-26", { role: "lead", live: true })], { open: true }),
];

// Work outside any session, by day: fix passes run with session null, Peach's board moves, consults.
const LOOSE = {
  bobnet: { "2026-11-13": 1.4, "2026-11-14": 2.0, "2026-11-15": 1.8, "2026-11-17": 2.2, "2026-11-18": 1.5, "2026-11-19": 2.9, "2026-11-20": 1.1, "2026-11-21": 2.6, "2026-11-22": 3.4, "2026-11-23": 11.0, "2026-11-25": 1.9, "2026-11-26": 10.6 },
  helix: { "2026-11-14": 3.0, "2026-11-15": 2.1, "2026-11-16": 4.4, "2026-11-17": 1.2, "2026-11-18": 6.3, "2026-11-19": 2.2, "2026-11-20": 1.0, "2026-11-21": 5.5, "2026-11-22": 1.4, "2026-11-23": 7.8, "2026-11-24": 9.1, "2026-11-25": 2.6, "2026-11-26": 1.9 },
};
const PROJECTS = [{ project: "bobnet", name: "BobNet", lost: 1 }, { project: "helix", name: "Helix", lost: 0 }];
