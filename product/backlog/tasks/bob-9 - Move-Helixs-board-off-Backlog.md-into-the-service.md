---
id: BOB-9
title: Move Helix's board off Backlog.md into the service
status: Draft
assignee: []
created_date: '2026-11-14 04:24'
labels: []
milestone: m-0
dependencies:
  - BOB-2
references:
  - product/requirements/migration.md
type: increment
ordinal: 2900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 9, product/requirements/migration.md: a one-off import of Helix's whole board, one cut-over agreed with Picard and Helix's orchestrator. Acceptance criteria to be written after BOB-1 is accepted.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
