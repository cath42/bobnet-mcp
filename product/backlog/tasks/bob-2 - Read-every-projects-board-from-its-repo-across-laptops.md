---
id: BOB-2
title: 'The board service: a database with API and MCP tools'
status: Draft
assignee: []
created_date: '2026-11-14 03:59'
updated_date: '2026-11-14 04:24'
labels: []
milestone: m-0
dependencies:
  - BOB-1
references:
  - product/requirements/board-sources.md
type: increment
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 1, product/requirements/board-service.md: every project's board as typed records in the broker's database (Casper 2026-11-13, C5), read and written by agents through MCP tools on the BobNet channel. Schema and tools are Toad's ADR. Acceptance criteria to be written after BOB-1 is accepted.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
