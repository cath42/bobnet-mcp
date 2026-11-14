---
id: DRAFT-2
title: 'Device-key enrolment and signed dashboard actions (ADR 0003, owner authority)'
status: Draft
assignee: []
created_date: '2026-11-14 16:40'
labels: []
dependencies: []
references:
  - architecture/decisions/0003-owner-authority.md
priority: medium
type: increment
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Draft until ADR 0003 is accepted. Size M. Each browser enrols a device key once (enrolment uses a freshly issued Access JWT); after that every dashboard action is signed by the device key with a timestamp and nonce, so the owner JWT stops travelling to laptops. Closes the replay window noted in README:47 (BOB-12). Criteria to be written once the ADR is accepted.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
