// BOB-6 prototype: sample data only. Refs, names, commits and paths are made up for the prototype;
// no real tokens, secrets or message ids. "Now" is Sun 22 Nov 10:20.
"use strict";

// The brief's shape is ADR 0010 §3's: the service assembles it, the dashboard only shows it.
const BRIEF_BOB6 = (kind, label) => `Start BOB-6 ${kind} ${label} (bobnet): Start a session from the UI, as a request to poe.
Casper asked for it from the dashboard: start request S-7.

Session: { feature: "BOB-6", kind: "${kind}", label: "${label}" }
Skill: lead/skills/${kind}.md

Last session: BOB-6 design A, closed 2026-11-22, need none, commit 3f2a9c1.
Summary: the Start button and the brief editor designed (design/BOB-6/); ADR 0010 for the start rules and the start request.
Handoff: ~/.local/state/bobnet/handoffs/bobnet/w_sample01.md; the text is in board_get session { feature: "BOB-6", kind: "design", label: "A" }

Casper's answers on BOB-6:
- Q-133, answered 2026-11-22 on the dashboard: May you withdraw a request before it starts?
  Option: yes: Yes, until it starts
  His words: "Yes. And tell poe when I do."
- Q-131, answered 2026-11-21 on the dashboard: Where does Start live?
  Option: feature: On the feature page
  His words: "On the feature page. I open the feature on my phone anyway, that's where I want the button."

Read the feature first: board_get BOB-6.`;

const BRIEF_LAND57 = `Start LAND-57 design A (helix): Retry a failed land from the queue.
Casper asked for it from the dashboard: start request S-12.

Session: { feature: "LAND-57", kind: "design", label: "A" }
Skill: .claude/skills/helix-design

Last session: none yet.

Casper's answers on LAND-57:
- Q-290, answered 2026-11-20 on the dashboard: Retry from the same commit, or rebase first?
  Option: rebase: Rebase first
  His words: "Rebase first, always. A retry on a stale base is how we got the red main last week."

Read the feature first: board_get LAND-57.`;

window.SAMPLE = {
  now: "10:20",
  me: "Casper",
  projects: {
    bobnet: { name: "BobNet", po: "Peach", supervisor: { name: "poe", laptop: "mbp-1", lastReport: "09:12" } },
    helix: { name: "Helix", po: "Kong", supervisor: { name: "poe", laptop: "mbp-1", lastReport: "09:12" } },
  },
  // Each scenario is one feature as the dashboard would read it, with what start_options returns for it.
  scenarios: [
    {
      id: "offered", tab: "Start offered", project: "bobnet",
      feature: { ref: "BOB-6", title: "Start a session from the UI, as a request to poe", release: "Release 2 · number 1", state: "open", criteria: [0, 4], tasks: null },
      sessions: [
        { kind: "design", label: "A", when: "Sun 06:26 → 09:58", state: "closed", need: "none", blockers: 0, majors: 0, moved: 0, tokens: "1.9M",
          summary: "The Start button and the brief editor designed (design/BOB-6/); ADR 0010 for the start rules and the start request.", commit: "3f2a9c1",
          agents: [] },
      ],
      next: "a build session", nextKind: "build",
      kinds: [
        { kind: "design", ok: true, label: "B" },
        { kind: "build", ok: true, label: "A" },
        { kind: "review", ok: false, code: "after", reason: "BOB-6 has no closed build session; bobnet starts review after build" },
        { kind: "retro", ok: false, code: "after", reason: "BOB-6 has no closed review session; bobnet starts retro after review" },
      ],
      taken: { design: ["A"] }, req: "S-7",
      brief: BRIEF_BOB6,
      tasks: [],
    },
    {
      id: "limit", tab: "Helix: one open feature", project: "helix",
      feature: { ref: "LAND-58", title: "Land from the queue in bulk", release: "Release 4 · number 2", state: "ready", criteria: [0, 3], tasks: null },
      sessions: [],
      next: "a design session", nextKind: "design",
      kinds: [
        { kind: "design", ok: false, code: "limit", reason: "helix allows one open feature at a time: LAND-56 is open", link: "LAND-56" },
        { kind: "build", ok: false, code: "after", reason: "LAND-58 has no closed design session; helix starts build after design" },
        { kind: "review", ok: false, code: "after", reason: "LAND-58 has no closed build session; helix starts review after build" },
      ],
      tasks: [],
    },
    {
      id: "held", tab: "Held by your question", project: "bobnet",
      feature: { ref: "BOB-19", title: "Search the board from the dashboard", release: "Release 2 · number 4", state: "ready", criteria: [0, 3], tasks: null },
      sessions: [],
      wait: { ref: "Q-140", text: "Search titles only, or descriptions and notes too?" },
      next: "a design session", nextKind: "design",
      kinds: [
        { kind: "design", ok: false, code: "held", reason: "BOB-19 is held by Q-140", link: "Q-140" },
        { kind: "build", ok: false, code: "after", reason: "BOB-19 has no closed design session; bobnet starts build after design" },
        { kind: "review", ok: false, code: "after", reason: "BOB-19 has no closed build session; bobnet starts review after build" },
        { kind: "retro", ok: false, code: "after", reason: "BOB-19 has no closed review session; bobnet starts retro after review" },
      ],
      tasks: [],
    },
    {
      id: "conflict", tab: "Refused on send", project: "helix",
      feature: { ref: "LAND-57", title: "Retry a failed land from the queue", release: "Release 4 · number 1", state: "ready", criteria: [0, 3], tasks: null },
      sessions: [],
      next: "a design session", nextKind: "design",
      kinds: [
        { kind: "design", ok: true, label: "A" },
        { kind: "build", ok: false, code: "after", reason: "LAND-57 has no closed design session; helix starts build after design" },
        { kind: "review", ok: false, code: "after", reason: "LAND-57 has no closed build session; helix starts review after build" },
      ],
      taken: {}, req: "S-12",
      brief: () => BRIEF_LAND57,
      refuseOnSend: "helix allows one open feature at a time: LAND-56 opened at 10:18",
      tasks: [],
    },
  ],
  declineReason: "Luigi is on BOB-44 until rc.51 ships, about an hour. Ask again after that.",
  startedBy: { name: "Luigi", role: "engineer", tokens: "48k", note: "reading the handoff" },
};
