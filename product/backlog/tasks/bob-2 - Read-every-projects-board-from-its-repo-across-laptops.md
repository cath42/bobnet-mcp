---
id: BOB-2
title: 'The board service: a database with API and MCP tools'
status: Draft
assignee: []
created_date: '2026-11-14 03:59'
updated_date: '2026-11-14 15:05'
labels: []
milestone: m-0
dependencies:
  - BOB-1
references:
  - product/requirements/board-service.md
  - design/BOB-1/notes.md
type: increment
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 1, product/requirements/board-service.md: every project's board as typed records in the broker's database (Casper 2026-11-13, C5), read and written by agents through MCP tools on the BobNet channel. The foundation of the other release 1 features. Schema and tools are Toad's ADR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every item kind (project, release, feature, task, backlog item, bug, session, question, action) is a typed record in the broker's database; status, type and other closed lists are constrained, links are enforced references, acceptance criteria are records with text, evidence and state. An invalid status or a dangling link is refused. Evidence: test, and Toad's ADR (board-service.md 0, 4, 8)
- [ ] #2 Ids are per project with its prefix, never reused; moving an item to another feature or release keeps its id; order of features in a release, releases in a project and backlog items in triage is explicit and kept. Evidence: test (board-service.md 5, 6)
- [ ] #3 An agent navigates the board through MCP tools on the BobNet channel: a project's releases, a release's features, a feature's tasks and sessions, backlog items, one item in full; searches by text, status, label. Evidence: MCP test (board-service.md 2)
- [ ] #4 An agent creates and changes items through MCP and the API as far as its role may (the rules are BOB-7). Evidence: MCP test (board-service.md 3)
- [ ] #5 Progress is acceptance criteria checked of total, always the real count, per task and per feature across its tasks. Evidence: test (board-service.md 4)
- [ ] #6 Every change is an event: who (role, project, session), when, what, from what to what; an item's history is readable through MCP and on the dashboard. Evidence: test (board-service.md 7)
- [ ] #7 A project's agents never see or change another project's board, unless the role is given more (Casper, Mario). Evidence: test (board-service.md 9)
- [ ] #8 A session's close is a structured record the supervisor keeps from what the session declares: need (none, answer, casper), blockers and majors, tasks moved with the status left, link to its handoff, tokens. Never parsed from handoff files. Evidence: test with a real close (steps-view.md 2, Toad's ADR)
- [ ] #9 The service keeps which feature is open: set when a session on it starts, cleared when its last session closes, never by hand. Evidence: test (board-writes.md, roadmap-view.md 9)
- [ ] #10 A Helix-sized board (~700 tasks, ~29 features) lists fast: lists carry counts, an opened feature loads its tasks. Evidence: test with a Helix-sized board (board-service.md 10)
- [ ] #11 The whole board exports as JSON in a documented, versioned shape, nightly, by the supervisor on mbp-1 into a git repo there; the export imports into an empty service. Evidence: test of export then import; the repo's commits (board-service.md 11)
- [ ] #12 When the broker is down, board reads and writes wait for it and agents wait; capture is the exception (BOB-8). Evidence: test (README C4)
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
Needs Toad's ADR first (schema, MCP tools, event log, structured session close, export format). Peach decides kinds, fields, workflow; Toad the rest. Not Ready until Toad has seen these criteria.

Release 1. Live only after a release and a restart of the broker (a deploy, on Casper's ask).
<!-- SECTION:PLAN:END -->
