---
id: DRAFT-1
title: Replace Helix's ADR citations and Helix-specific strings in code
status: Draft
assignee: []
created_date: '2026-11-14 16:33'
labels: []
dependencies: []
references:
  - architecture/reviews/2026-11-14-system-review.md
type: chore
ordinal: 6200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review chore 8 [finding 6]. Blocked: needs Toad's ADRs P5 (landing) and P6 to exist, which the citations are replaced with. Ready when they do. Packages: supervisor, broker, tests. Size S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Citations of Helix's ADR 0060, 0090, 0093 and 0094 in code and tests point to BobNet's own ADRs. Evidence: grep finds none
- [ ] #2 `Bob's brief`, `svc:`/`layer:` and 'the Postgres environment' are config, not strings in code. Evidence: grep, and a test with a differently-configured project
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
