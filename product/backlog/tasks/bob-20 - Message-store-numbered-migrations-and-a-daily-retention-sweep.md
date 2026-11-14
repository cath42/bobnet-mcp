---
id: BOB-20
title: 'Message store: numbered migrations and a daily retention sweep'
status: Ready
assignee: []
created_date: '2026-11-14 16:33'
labels: []
dependencies: []
references:
  - architecture/reviews/2026-11-14-system-review.md
type: chore
ordinal: 6500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review chore 12 [finding 9]. store.ts adopts numbered migrations as the schema file already has, and sweeps by age daily. The Board DO has its own migrations (ADR 0001 §1), so this is independent of BOB-2. Package: broker. Size S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 store.ts applies numbered migrations in order and records the version, as schema.ts does; an existing database upgrades without loss. Evidence: a test upgrading a database made by the current code
- [ ] #2 A daily sweep removes rows past their retention age and keeps the rest. Evidence: a test with an old and a fresh row
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
