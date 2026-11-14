---
id: BOB-17
title: 'Broker: boards after the dashboard reply; sweep old reports'
status: Ready
assignee: []
created_date: '2026-11-14 16:33'
labels: []
dependencies: []
references:
  - architecture/reviews/2026-11-14-system-review.md
type: chore
ordinal: 6100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review chore 7 [finding 5]. Package: broker. Size S. After BOB-2: the board service moves boards out of laptop reports, so check this still applies then.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Boards are sent after the `dashboard` reply, not inside it. Evidence: a broker test of the frame order
- [ ] #2 `laptop_reports` and `project_boards` rows older than 30 days are swept. Evidence: a test with an old and a fresh row
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
