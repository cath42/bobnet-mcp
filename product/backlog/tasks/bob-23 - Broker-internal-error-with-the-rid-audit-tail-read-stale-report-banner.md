---
id: BOB-23
title: 'Broker: internal error with the rid, audit tail read, stale-report banner'
status: Ready
assignee: []
created_date: '2026-11-14 16:33'
labels: []
dependencies: []
references:
  - architecture/reviews/2026-11-14-system-review.md
type: chore
ordinal: 6600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review chore 15 [finding 12]. Packages: broker, dashboard. Size S. The banner needs a screenshot on phone and desktop, in BobNet's own look.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An unexpected error answers `internal` with the request's rid, not silence. Evidence: a broker test
- [ ] #2 An owner-only read returns the audit tail; any other identity is refused. Evidence: a broker test
- [ ] #3 A laptop whose report is stale shows a banner on the dashboard. Evidence: a dashboard test; screenshots on phone and desktop
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
