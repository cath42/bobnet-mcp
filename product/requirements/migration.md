# 9. Moving boards off Backlog.md

**Who needs it:** Helix first (the main stakeholder and the largest board), then BobNet's own board,
then any other project that joins. Casper, for whom retiring Backlog.md is a goal (2026-11-13).

**What it is:** each project's Backlog.md board is moved into the service once, after which Backlog.md
is no longer used for it.

## Criteria

1. Helix's whole board moves: ~700 tasks, ~29 features, 3 releases with their order and status, ~103
   drafts, archived items. Ids, statuses, parents, releases, labels, dependencies, acceptance
   criteria with their checked state, descriptions and notes come over unchanged. *Evidence: a
   count-and-sample check against the board at a named commit.*
2. Helix's drafts become backlog items ([capture.md](capture.md)). A task with status `Draft` stays a
   task with status Draft. The two are not mixed. *Evidence: test.* (Picard input)
3. "Was LAND-n.m" re-creations are linked, so the old and new item show as one, with the old id
   findable. *Evidence: test.* (Picard input)
4. The move is one cut-over per project, at a moment the project's PO and orchestrator agree. Nothing
   is written to both. After it, the project's Backlog.md folder is removed from its repo by its PO,
   with a pointer to the service. *Evidence: the cut-over commit.*
5. The project's agents' instructions (CLAUDE.md, skills) point to the MCP tools instead of the
   Backlog.md tools, the same day. *Evidence: the changed files.*
6. Items' history before the move stays readable in the repo's git history. The service's history
   starts at the move. *Evidence: dashboard check.*

## Must not break

- No project is left without a board it can write during the move.
- Helix's work in flight: the cut-over waits for no feature to be open, or carries the open feature's
  session state over. Picard and Helix's orchestrator agree the moment.

## Open questions

- Order of projects: Helix first, then BobNet's own board? **For Casper (C1).**
- Does BobNet's own board (`product/backlog`, set up 2026-11-13 on Backlog.md) stay on Backlog.md
  until the service exists? Peach's view: yes, then it moves like Helix's.
