---
id: BOB-12
title: 'Owner JWT: pin the laptop reporter, check iat, correct the README claim'
status: Ready
assignee: []
created_date: '2026-11-14 16:31'
labels: []
dependencies: []
references:
  - architecture/reviews/2026-11-14-system-review.md
  - lead/2026-11-14-board-adr-and-review-decisions.md
priority: high
type: chore
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review finding 2 (chores 2, 3 and the README line 47 part of 4). Casper decided 2026-11-14 that findings 1-3 are fixed before the board build. Packages: broker, supervisor, README. Size S. The worker-isolation claim at README.md:111 goes with the Keychain guard chore, not here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 laptop_reports.reporter is pinned to the supervisor's configured name; a report from any other peer is ignored. Evidence: a broker test
- [ ] #2 The supervisor checks the owner JWT's iat is within a few minutes and refuses an older one. Evidence: a supervisor test with an old and a fresh token
- [ ] #3 README.md:47 ('The broker alone can't act as you') says what holds with and without the owner JWT as it now stands. Evidence: the diff, read by Toad
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
