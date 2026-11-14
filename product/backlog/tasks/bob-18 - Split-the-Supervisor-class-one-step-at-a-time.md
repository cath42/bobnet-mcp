---
id: BOB-18
title: 'Split the Supervisor class, one step at a time'
status: Ready
assignee: []
created_date: '2026-11-14 16:33'
labels: []
dependencies: []
references:
  - architecture/reviews/2026-11-14-system-review.md
type: chore
ordinal: 6300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review chore 9 [finding 7]. After BOB-2's supervisor changes, to avoid conflicts. No behaviour change; each step lands alone. Package: supervisor. Size M.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `Landing` is split out of `Supervisor`, with no behaviour change. Evidence: the existing tests pass unchanged
- [ ] #2 Then `Consults`, then `Reporter`, then `BrokerInbound`, each its own landed commit with no behaviour change. Evidence: the tests pass unchanged at each commit
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
