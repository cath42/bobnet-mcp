---
id: BOB-4
title: 'A feature''s sessions, outcomes and tasks'
status: Ready
assignee: []
created_date: '2026-11-14 03:59'
updated_date: '2026-11-14 15:05'
labels: []
milestone: m-0
dependencies:
  - BOB-1
  - BOB-2
references:
  - product/requirements/steps-view.md
type: increment
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 3, product/requirements/steps-view.md, as the approved prototype shows it, with Casper's rounds 1 and 2: agents on tasks, context-per-call chart, waiting on CI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A feature opens with its sessions as a vertical chain in the order they ran, each with kind (design, build, review, retro; Fixes is a build label), label, start, end, state; the next step is the last, dashed link and also a banner at the top. Evidence: test; screenshots on phone and desktop (steps-view.md 1, 5)
- [ ] #2 A closed session's outcome is one line: need, blockers and majors, minors fixed or tasks sent back, tasks closed or moved, total tokens last and muted; then a sentence and links. It reads the structured session close (BOB-2), not handoffs. Evidence: test with a real close (steps-view.md 2, 7)
- [ ] #3 Under each session, the tasks it moved with the status it left them in and their criteria; tasks no session touched under 'In no session yet'; the board's current status of every task in a list beside or below the chain. Evidence: test (steps-view.md 4)
- [ ] #4 An 'On it now' card lists each running agent as agent, session, task; the same agent shows live on its task's rows with state (working, waiting on you) and tokens. Source: what spawn_worker declared (session, tasks), never a brief; leads and consults show as Other work. Evidence: test with a running worker on two tasks; screenshots (steps-view.md 3, 8)
- [ ] #5 Inside a session, the chart of context per call, in tokens, for the session and per agent, as today's dashboard has it. Evidence: dashboard check against today's chart on the same session (steps-view.md 10)
- [ ] #6 A feature that waits on a CI run, any CI anywhere, shows it and how long the run has gone (Casper: 'Any CI running anywhere'); a laptop's run shows through the run slot. A CI run ties to an agent only through a push its land made; any other run shows on its project and branch. 'Usually' (the run's usual time) appears once a name has three passing runs. Evidence: test with a running and a finished run; dashboard check (steps-view.md 11)
- [ ] #7 A link to each session's handoff file and to its Remote Control session where there is one. Evidence: dashboard check (steps-view.md 6)
- [ ] #8 Usage shows as tokens, never money. Evidence: test (steps-view.md 7)
- [ ] #9 Phone and tablet in BobNet's own look. Evidence: screenshots on phone and desktop (steps-view.md 9)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Needs BOB-2 (structured session close) and Toad's ADR for how CI runs report in, how runs tie to agents, and usual run times. Release 1. Live after a release and a restart (supervisor too, for the close).
<!-- SECTION:PLAN:END -->
