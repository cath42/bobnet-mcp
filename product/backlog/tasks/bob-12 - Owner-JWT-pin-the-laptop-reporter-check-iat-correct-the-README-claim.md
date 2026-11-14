---
id: BOB-12
title: 'Owner JWT: pin the laptop reporter, correct the README claim'
status: Ready
assignee: []
created_date: '2026-11-14 16:31'
updated_date: '2026-11-14 16:40'
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
System review finding 2 (chores 2, 3 and the README line 47 part of 4). Casper decided 2026-11-14 that findings 1-3 are fixed before the board build. Packages: broker, supervisor, README. Size S. The worker-isolation claim at README.md:111 goes with the Keychain guard chore, not here. Per Toad: no iat check (the Access JWT's iat is the login time and the cookie is reused on reconnect) and the `action` frame carries no laptop; jwtVerify already refuses an expired token (owner.ts:22). Freshness and replay are fixed by the device-key item (ADR 0003).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 laptop_reports.reporter is pinned to the supervisor's configured name (sent on register); a report from any other peer on that laptop is ignored. Evidence: a broker test
- [ ] #2 README.md:47 ('The broker alone can't act as you') says plainly that while an owner token is live (the Access session length), whoever controls the broker or a reporting supervisor can replay it for dashboard actions; a shorter Access session for the dashboard app is Casper's setting and narrows the window. Evidence: the diff, read by Toad
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
