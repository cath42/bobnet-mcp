---
id: BOB-11
title: Land refuses a stale tip before the check
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
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review finding 1 (architecture/reviews/2026-11-14-system-review.md, chore 1). Casper decided 2026-11-14 (lead/2026-11-14-board-adr-and-review-decisions.md) that findings 1-3 are fixed before the board build starts. Package: supervisor (land). Size S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Land fetches the target branch inside the run slot and refuses a stale tip before running the check. Evidence: a test
- [ ] #2 A remote's non-fast-forward rejection is reported as 'stale', and no refused HEAD is recorded as landed. Evidence: a test
- [ ] #3 A stale-tip test exists and fails without the fix. Evidence: the test in pnpm -r test
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
