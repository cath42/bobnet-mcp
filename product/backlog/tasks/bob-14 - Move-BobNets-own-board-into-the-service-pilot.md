---
id: BOB-14
title: Move BobNet's own board into the service (pilot)
status: Ready
assignee: []
created_date: '2026-11-14 16:33'
updated_date: '2026-11-14 16:33'
labels: []
milestone: m-0
dependencies:
  - BOB-2
references:
  - product/requirements/migration.md
  - architecture/decisions/0001-board-service.md
  - lead/2026-11-14-board-adr-and-review-decisions.md
type: increment
ordinal: 2600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Casper, 2026-11-14 (\"2. Yes\"): BobNet's own board moves first, as the pilot, through the same import path Helix will use (ADR 0001 build step 3), then Helix (BOB-9). BobNet's board stays on Backlog.md until this cut-over. I am the PO and the only writer, so the cut-over moment is mine and Mario's. Needs BOB-2 (import and export). Release 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 BobNet's whole board imports through the one-off import at a named commit: its releases, features, tasks, drafts, archived items, with ids, statuses, parents, releases, labels, dependencies, acceptance criteria and their checked state, descriptions, notes and plan unchanged. Evidence: count-and-sample check against the board at that commit
- [ ] #2 Every defect the import shows on this small board is fixed or written on BOB-9 before Helix's import runs. Evidence: the list in this task's notes
- [ ] #3 One cut-over, agreed by Peach and Mario; nothing is written to both. After it, product/backlog and backlog.config.yml are removed from the repo with a pointer to the service, and CLAUDE.md files and role instructions point to the MCP tools the same day. Evidence: the cut-over commits
- [ ] #4 Peach reads and writes BobNet's board through the MCP tools only, and a builder's status write is refused with its reason. Evidence: a session's tool calls and the refusal
- [ ] #5 Items' history before the move stays in git; the service's starts at the move. Evidence: dashboard check
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
