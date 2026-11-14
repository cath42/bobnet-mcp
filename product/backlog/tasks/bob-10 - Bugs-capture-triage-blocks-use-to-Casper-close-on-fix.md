---
id: BOB-10
title: 'Bugs: capture, triage, ''blocks use'' to Casper, close on fix'
status: Ready
assignee: []
created_date: '2026-11-14 04:36'
updated_date: '2026-11-14 15:05'
labels: []
milestone: m-0
dependencies:
  - BOB-2
  - BOB-8
references:
  - product/requirements/bugs.md
type: increment
ordinal: 2800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 8, product/requirements/bugs.md (agreed by Casper 2026-11-13, in release 1: C9), as the approved prototype shows it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A bug is captured in one MCP call or one field on the dashboard (Bug toggle after the text, then where: staging or production, and blocks use), optionally with the feature it was found in. Evidence: MCP test; screenshot on phone (bugs.md 1, prototype notes 27)
- [ ] #2 It waits in the project's triage list with the other backlog items, marked as a bug, bugs first. Evidence: test (bugs.md 2)
- [ ] #3 A bug marked blocks use also shows on the waits-on-Casper list as 'bug · blocks use' until it is slotted or closed. Evidence: test (bugs.md 3)
- [ ] #4 A bug closes only when its fix has landed and its criterion 'it no longer happens' is checked with evidence; closing without a fix needs a reason. Evidence: test (bugs.md 4)
- [ ] #5 A bug is delivered behaviour that breaks an accepted criterion, found after Done; a review blocker or major is a task of the feature under review, other findings are backlog items (Picard, 2026-11-14, Helix ADR 0066). Evidence: the kinds' definitions in the MCP tools' descriptions
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Needs BOB-2 and BOB-8. Release 1.
<!-- SECTION:PLAN:END -->
