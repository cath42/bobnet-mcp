---
id: BOB-6
title: 'Start a session from the UI, as a request to poe'
status: Draft
assignee: []
created_date: '2026-11-14 03:59'
labels: []
milestone: m-1
dependencies: []
references:
  - product/requirements/start-session.md
type: increment
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 5, product/requirements/start-session.md. Release 2. The gate conflict with Toad's advice is open there.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
