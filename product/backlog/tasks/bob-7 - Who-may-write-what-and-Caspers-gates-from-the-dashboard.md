---
id: BOB-7
title: 'Who may write what, and Casper''s gates from the dashboard'
status: Draft
assignee: []
created_date: '2026-11-14 04:24'
updated_date: '2026-11-14 15:05'
labels: []
milestone: m-0
dependencies:
  - BOB-2
references:
  - product/requirements/board-writes.md
type: increment
ordinal: 2500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 6, product/requirements/board-writes.md, as the approved prototype shows Casper's gates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each role's write access is set per project: which items (all, the open feature's, none) and which fields (status, order, release). A write outside it is refused with the reason. Evidence: test (board-writes.md 1)
- [ ] #2 Helix's rule can be expressed: the open feature's items by its session PO, the rest by the backlog PO, Casper's gates by Casper. Builders read but don't move status. Evidence: test with Helix's roles (board-writes.md 2, 3)
- [ ] #3 Casper's gates on the dashboard: move a feature or backlog item into or out of a release, reorder releases, close a release. Behind 'Edit your gates', each change saves at once with Undo; a moved feature goes last in its new release. Other edits are requests to the PO. Evidence: test; screenshots on phone and desktop (board-writes.md 4, prototype notes 18, 19)
- [ ] #4 Closing a release with features not Done opens a dialog naming each, with where it goes (default the next open release); nothing is closed with work silently left. A closed release stays on the roadmap, folded, and takes no features. Evidence: test; screenshot (board-writes.md 5, prototype notes 20, 21)
- [ ] #5 Casper's answer to a question and allow/deny of a permission are his own writes; another role is refused. Evidence: test (BOB-5)
- [ ] #6 Every write carries who made it, in the item's history. Evidence: test (board-writes.md 6)
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
Needs BOB-2 and Toad's ADR (authorisation table in the broker, from role, project and the cards a spawn declared). Release 1.
<!-- SECTION:PLAN:END -->
