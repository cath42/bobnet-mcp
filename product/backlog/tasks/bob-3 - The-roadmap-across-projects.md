---
id: BOB-3
title: The roadmap across projects
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
  - product/requirements/roadmap-view.md
type: increment
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 2, product/requirements/roadmap-view.md, and the Overview, as the approved prototype shows it (design/BOB-1/; Casper 2026-11-14: approved).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Roadmap tab shows every connected project, on every laptop, with its releases numbered in order, as design/BOB-1 shows it. Evidence: dashboard check with two projects; screenshots on phone and desktop (roadmap-view.md 1, 8)
- [ ] #2 A release lists its features in the board's order with state (Draft, Ready, open, in review, done), numbered explicitly; a feature with no order follows the ordered ones by id, in italic. Evidence: test; screenshot (roadmap-view.md 2, 3)
- [ ] #3 Each feature shows its real criteria count; a Done feature with unticked criteria shows Done, its count and a muted 'Done, criteria not ticked'. Evidence: test with a feature at 3 of 138 (roadmap-view.md 4)
- [ ] #4 The open feature has a green edge and the agents on it from their spawn's declared session, or 'nobody on it now'. Evidence: test (roadmap-view.md 5, 9)
- [ ] #5 On a phone, rows become cards and more than three Done features in a release fold into one row naming their numbers; Done rows show number, id, title. Evidence: screenshot on phone (prototype notes 10, 11)
- [ ] #6 Per release and project, backlog items, open bugs and the oldest age, linking to the triage list. Evidence: test (roadmap-view.md 7)
- [ ] #7 The Overview answers, in order, Needs you, Working now, Projects, as the redone prototype shows; the Needs you count matches the Waits tab; Projects rows have the five cells (project, Release, Open now, Next, Backlog); agents with no session show as Other work. Evidence: screenshots on phone, tablet, desktop (prototype notes 31 to 34)
- [ ] #8 A Helix-sized board stays fast on a phone. Evidence: dashboard check on Helix's board
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
Needs BOB-2 and the matching design (design/BOB-1/spec.md). Release 1. Live after a release and a restart.
<!-- SECTION:PLAN:END -->
