---
id: BOB-9
title: Move Helix's board off Backlog.md into the service
status: Ready
assignee: []
created_date: '2026-11-14 04:24'
updated_date: '2026-11-14 15:05'
labels: []
milestone: m-0
dependencies:
  - BOB-2
  - BOB-14
references:
  - product/requirements/migration.md
type: increment
ordinal: 2900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 9, product/requirements/migration.md: a one-off import of Helix's whole board, one cut-over agreed with Picard and Helix's orchestrator.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Helix's whole board imports at a named commit: ~700 tasks, ~29 features, 3 releases with order and status, ~103 drafts, archived items, with ids, statuses, parents, releases, labels, dependencies, acceptance criteria and their checked state, descriptions and notes unchanged. Evidence: count-and-sample check against the board at that commit (migration.md 1)
- [ ] #2 Drafts become backlog items, keeping a parent hint (DRAFT-46: LAND-43) or milestone as fields; a task with status Draft stays a task. Evidence: test (migration.md 2; Picard, 2026-11-14)
- [ ] #3 Features without an ordinal (R1: LAND-39 to 44 and 49) follow the ordered ones by id. Criteria are imported as they are: Done features with unticked criteria keep them unticked (LAND-42: 0 of 6 although its staging run passed 1 to 5), shown with 'Done, criteria not ticked'. Evidence: test (migration.md 3)
- [ ] #4 Helix's Q-n and A-n move over as question and action records, answered ones with their answers verbatim; open ones show on the waits list. Evidence: test with Q-258 and A-17 (migration.md 3)
- [ ] #5 The feature open is derived from sessions at import (LAND-49 has six sessions though its file says Ready). Evidence: test (board-writes.md)
- [ ] #6 'Was LAND-n.m' re-creations are linked so old and new show as one and the old id is findable. Evidence: test (migration.md 4)
- [ ] #7 One cut-over, at a moment Picard and Helix's orchestrator agree; nothing is written to both. After it, Helix's Backlog.md folder is removed from its repo by its PO with a pointer to the service, and its CLAUDE.md and skills point to the MCP tools the same day. Evidence: the cut-over commits (migration.md 5, 6)
- [ ] #8 Items' history before the move stays in git; the service's starts at the move. Evidence: dashboard check (migration.md 7)
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
Needs BOB-2, BOB-7 and BOB-8 in the broker, BOB-14 (BobNet's own board moves first as the pilot, Casper 2026-11-14), and Picard's date. Picard's answers (2026-11-14) are in migration.md. Release 1.
<!-- SECTION:PLAN:END -->
