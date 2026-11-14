---
id: BOB-13
title: Supervisor stores an inbound message before acking it
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
ordinal: 300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review finding 3 (chore 6): the supervisor acks a role message before it is consumed, so a crash or a worker ending loses it. Casper decided 2026-11-14 that findings 1-3 are fixed before the board build. Package: supervisor. Size S-M.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every inbound role message is stored in the inbox before it is acked. Evidence: a test that kills the supervisor between receipt and delivery and finds the message on restart
- [ ] #2 Injects dedupe by message id: a redelivered message is injected once. Evidence: a test
- [ ] #3 Unread input is returned to the inbox when a worker ends. Evidence: a test
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
