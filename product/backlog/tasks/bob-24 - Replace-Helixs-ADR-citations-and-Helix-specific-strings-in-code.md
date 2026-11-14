---
id: BOB-24
title: Replace Helix's ADR citations and Helix-specific strings in code
status: Ready
assignee: []
created_date: '2026-11-14 17:28'
labels: []
dependencies: []
references:
  - architecture/decisions/0002-landing.md
  - architecture/decisions/0004-system-shape.md
  - architecture/reviews/2026-11-14-system-review.md
type: chore
ordinal: 6200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review chore 8 [finding 6]. ADR 0002 (accepted 2026-11-14) §8 maps each citation to BobNet's own ADR; ADR 0004 §6 takes the billing rule. Packages: supervisor, broker (dashboard), tests. Size S. Needs no release of its own beyond the next.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every citation in ADR 0002 §8's table (supervisor.ts, slots.ts, config.ts, worker.ts) now cites the section that table names (worker.ts:56 cites 0004 §6). Evidence: grep for Helix ADR numbers 0060, 0090, 0093, 0094 in non-test code finds none
- [ ] #2 app.js:109's citation of Helix's 0060 is gone with the Helix strings moved to config. Evidence: grep
- [ ] #3 `Bob's brief`, `svc:`/`layer:` and 'the Postgres environment' are project config, not strings in code. Evidence: grep, plus a test with a differently-configured project
- [ ] #4 Test data that mentions Helix's ADRs as sample text (supervisor.test.ts, cutover.test.ts, broker.test.ts) is left alone (ADR 0002 §8). Evidence: diff touches no such data
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
