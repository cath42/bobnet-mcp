---
id: BOB-8
title: 'Capture backlog items in one step, and triage them'
status: Draft
assignee: []
created_date: '2026-11-14 04:24'
labels: []
milestone: m-0
dependencies:
  - BOB-2
references:
  - product/requirements/capture.md
type: increment
ordinal: 2700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 7, product/requirements/capture.md: one MCP call, never blocks, queued on the laptop when offline (C4); the PO's triage list. Acceptance criteria to be written after BOB-1 is accepted.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
