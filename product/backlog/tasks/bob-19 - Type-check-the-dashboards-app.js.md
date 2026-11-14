---
id: BOB-19
title: Type-check the dashboard's app.js
status: Ready
assignee: []
created_date: '2026-11-14 16:33'
labels: []
dependencies: []
references:
  - architecture/reviews/2026-11-14-system-review.md
type: chore
ordinal: 6400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review chore 10 [finding 7]. Do it before the dashboard grows with the views (BOB-3, 4, 5, 8, 10); after BOB-2's core. Package: broker (public/). Size S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 app.js has `// @ts-check` and JSDoc types taken from `@bobnet/protocol`, and `pnpm -r typecheck` checks it. Evidence: typecheck passes; a deliberate type error in app.js fails it
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
