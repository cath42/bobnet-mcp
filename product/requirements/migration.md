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

## Import answers (Peach, 2026-11-14)

Settling Luigi's questions from the dry-run reports (`~/.local/state/bobnet/handoffs/bobnet/w_fb457dcd-*-import.md`).
BobNet's board is settled here; Helix's is Picard's call (asked, answers not yet in).

**BobNet's board (settled):**

1. **A container that holds tasks becomes a feature (type `increment`).** Right. A `chore` or `task` with
   children is a feature in practice. BOB-1.1 → BOB-26 as a flat id is fine; numbering is Casper's.
2. **Release status from the archived rule: right for BobNet.** An archived milestone is closed, the first
   one not archived is open, the rest planned. BobNet has none archived: R1 open, R2 planned, as the
   report says. (Helix's R1 closing is Picard's to confirm: see below.)
3. **Fields.** *Assignee:* dropped, correct: who works on what is Mario's and comes from sessions, never
   from a card. *Priority:* dropped, correct: the order inside a release (ordinal) is the priority; the
   4 priorities are not worth a field. *References:* **do not drop them.** The 25 are the trace from a
   card to its requirement and ADR, which a reviewer needs. No new field: **the import appends them to
   the item's notes as a `References:` list, one path or URL per line**, as it does for a final summary.
   That is a code change (Luigi), small, and it applies to Helix's too (747 of them).
4. **The open feature at import (BOB-9 #5): BobNet has none.** No BobNet item is `In Progress` (checked
   2026-11-14), so no `imported` session is needed at the BOB-14 import. If one is `In Progress` at the
   cut-over, it gets the `imported` session as ADR 0001 §11 says. The import must not invent an open
   feature from a status other than `In Progress`.

**BOB-14 grant seeding (Mario's message m_9597e3c1, Toad's m_d4aaa682):** the nightly backup on mbp-1
exports only what mbp-1's read grants cover. At the BobNet import the project's grants are seeded from
my rows: Mario@mbp-1 gets a `*` read row (cross-project read, ADR 0001 §5), which makes the backup full.
Mario@* is not seeded: it would cover Mario on any laptop, wider than the backup needs. Casper's `*`
read is his own owner row.

The file is `product/bobnet-grants.json` (BOB-14 #7), passed as `--grants`: Peach writes everything and
asks Casper; Mario reads and asks Casper; Daisy, Toad and Luigi read only; nobody has `admin` (the owner
changes rules); no `sessions` (the supervisor joins sessions itself). All on mbp-1.

**Helix's board (asked Picard, open):** (a) containers → features, same as BobNet; (b) R1 "Partner
demo" came out closed because it is archived: right?; (c) assignee/priority/references: references go
to notes; is dropping assignee (590) and priority (130) acceptable?; (d) which feature is open at the
import: origin/main has no `In Progress` feature in the report; `main`'s LAND-2 is In Progress;
(e) land-23.7 has invalid YAML: Picard fixes or drops it.
