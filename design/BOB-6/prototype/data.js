// BOB-6 prototype: sample data only. Refs, names, commits and paths are made up for the prototype;
// no real tokens, secrets or message ids. "Now" is Sun 22 Nov 10:20.
"use strict";

const BRIEF_BOB6 = (kind, label) => `BOB-6 ${kind} ${label}, bobnet
Start a session from the UI, as a request to poe
Criteria: board_get BOB-6 (AC1 to AC4, DoD 1 to 5)

Skill: lead/skills/${kind}.md

Last session: BOB-6 design A, closed Sun 22 Nov 09:58, need: none
Summary: the Start button and the brief editor designed (design/BOB-6/); ADR 0010 for the gates and the start request. 0 blockers, 0 majors.
Commit: 3f2a9c1
Handoff: read it with board_get session {BOB-6, design, A}

Casper's answers on this feature:
- Q-131 "Where does Start live?"
  Chosen: on the feature page.
  His words: "On the feature page. I open the feature on my phone anyway, that's where I want the button."
- Q-133 "May you withdraw a request before it starts?"
  Chosen: yes, until it starts.
  His words: "Yes. And tell poe when I do."`;

const BRIEF_LAND57 = `LAND-57 design A, helix
Retry a failed land from the queue
Criteria: board_get LAND-57 (AC1 to AC3)

Skill: .claude/skills/helix-design

Last session: none on this feature yet.

Casper's answers on this feature:
- Q-290 "Retry from the same commit, or rebase first?"
  Chosen: rebase first.
  His words: "Rebase first, always. A retry on a stale base is how we got the red main last week."`;

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
          summary: "The Start button and the brief editor designed (design/BOB-6/); ADR 0010 for the gates and the start request.", commit: "3f2a9c1",
          agents: [] },
      ],
      next: "a build session", nextKind: "build",
      kinds: [
        { kind: "design", ok: true, label: "B" },
        { kind: "build", ok: true, label: "A" },
        { kind: "review", ok: false, code: "after", reason: "review needs a closed build session" },
        { kind: "retro", ok: false, code: "after", reason: "retro comes after the feature's review" },
      ],
      taken: { design: ["A"] },
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
        { kind: "build", ok: false, code: "limit", reason: "helix allows one open feature at a time: LAND-56 is open", link: "LAND-56" },
        { kind: "review", ok: false, code: "limit", reason: "helix allows one open feature at a time: LAND-56 is open", link: "LAND-56" },
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
        { kind: "design", ok: false, code: "held", reason: "Q-140 holds BOB-19 design A until you answer it", link: "Q-140" },
        { kind: "build", ok: false, code: "status", reason: "build needs a closed design session" },
        { kind: "review", ok: false, code: "after", reason: "review needs a closed build session" },
        { kind: "retro", ok: false, code: "after", reason: "retro comes after the feature's review" },
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
        { kind: "build", ok: false, code: "status", reason: "build needs a closed design session" },
        { kind: "review", ok: false, code: "after", reason: "review needs a closed build session" },
      ],
      taken: {},
      brief: () => BRIEF_LAND57,
      refuseOnSend: "helix allows one open feature at a time: LAND-56 opened at 10:18",
      tasks: [],
    },
  ],
  declineReason: "Luigi is on BOB-44 until rc.51 ships, about an hour. Ask again after that.",
  startedBy: { name: "Luigi", role: "engineer", tokens: "48k", note: "reading the handoff" },
};
