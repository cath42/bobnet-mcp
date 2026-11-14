# 9. Moving boards off Backlog.md

**Who needs it:** BobNet's own board first, as the pilot (Casper, 2026-11-14), then Helix (the main stakeholder and the largest board),
then any other project that joins. Casper, for whom retiring Backlog.md is a goal (2026-11-13).

**What it is:** each project's Backlog.md board is imported into the service's database once, after
which Backlog.md is no longer used for it. Reading Markdown is the one-off import's job only. Nothing
in the service reads or writes Markdown after it.

## Criteria

1. Helix's whole board moves: ~700 tasks, ~29 features, 3 releases with their order and status, ~103
   drafts, archived items. Ids, statuses, parents, releases, labels, dependencies, acceptance
   criteria with their checked state, descriptions and notes come over unchanged. *Evidence: a
   count-and-sample check against the board at a named commit.*
2. Helix's drafts become backlog items ([capture.md](capture.md)). A task with status `Draft` stays a
   task with status Draft. The two are not mixed. *Evidence: test.* (Picard input)
3. Features without an ordinal (in Helix's R1: LAND-39 to 44 and 49) are imported after the ordered
   ones in their release, by id, for the PO to reorder. Helix's `A-n` actions move over with its
   `Q-n` questions. Unticked criteria are imported as they are, unticked, with the "Done, criteria not ticked" note on Done features (Picard, 2026-11-14: the rule was to tick on closing in review, in practice it lapsed; LAND-42 is Done at 0 of 6 though Marvin's staging run records 1 to 5 passing; unticked is not unmet). *Evidence: test.*
4. "Was LAND-n.m" re-creations are linked, so the old and new item show as one, with the old id
   findable. *Evidence: test.* (Picard input)
5. The move is one cut-over per project, at a moment the project's PO and orchestrator agree. Nothing
   is written to both. After it, the project's Backlog.md folder is removed from its repo by its PO,
   with a pointer to the service. *Evidence: the cut-over commit.*
6. The project's agents' instructions (CLAUDE.md, skills) point to the MCP tools instead of the
   Backlog.md tools, the same day. *Evidence: the changed files.*
7. Items' history before the move stays readable in the repo's git history. The service's history
   starts at the move. *Evidence: dashboard check.*

## Must not break

- No project is left without a board it can write during the move.
- Helix's work in flight: the cut-over waits for no feature to be open, or carries the open feature's
  session state over. Picard and Helix's orchestrator agree the moment.

## Open questions

- *Settled (Casper, 2026-11-14, "2. Yes"):* BobNet's own board moves first, as the pilot, through the same
  import path, then Helix (BOB-9). BobNet's board stays on Backlog.md until then.
