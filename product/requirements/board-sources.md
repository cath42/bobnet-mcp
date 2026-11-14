# 1. Read each project's board from its repo

**Who needs it:** everything else here. Casper, to trust that what the dashboard shows is what the
board says.

**What it is:** for each project, BobNet reads the board from the project's repo, as committed on the
project's main line, and nothing else. The board stays the only source. BobNet never writes it and
never copies status into its own store.

## Criteria

1. A project's board is read from git at a named ref (default the project's main line), never from a
   worktree. Uncommitted edits never show. *Evidence: test.*
2. Each item shows its id, title, status, type, parent, release (milestone), labels, dependencies and
   acceptance criteria as checked/unchecked counts. *Evidence: test.*
3. Both kinds of "draft" are read and kept apart: a task with status `Draft`, and an item in the
   `drafts/` folder (the triage queue). *Evidence: test.* (Picard input)
4. A re-created item ("Was LAND-n.m" in the new item) shows once, as the new item, with a link to
   the old id. It does not show twice. *Evidence: test with a moved task.* (Picard input)
5. A feature's release is its `milestone` field: the board is the source for membership. Where a
   project keeps a releases index (Helix: `product/releases/README.md`), the index is the source for
   release status and the order of releases, and the view reads it instead of creating a third list.
   When the two disagree, the view shows both and flags the mismatch. *Evidence: test with a
   mismatch.* (Picard, 2026-11-13, citing Helix `method/backlog-structure.md`)
6. Order is shown as the board records it (Backlog.md `ordinal`), and not by id alone. *Evidence: test.*
7. The view says which commit it shows and how old it is. When the repo can't be read, the last good
   board stays, marked stale. *Evidence: test; dashboard check.*
8. Done features keep counts only. Their tasks load when opened, so Helix's board fits the
   dashboard's frame limit. *Evidence: test with a Helix-sized board (~700 tasks).* (Picard input)

## Must not break

- Agents and the Backlog.md CLI and MCP work on the board with BobNet off. BobNet adds nothing the
  board needs.
- One writer per file. BobNet is never a writer (Picard input: "the UI must not become a third writer").
- Status is never copied into BobNet's store or prose. Live state comes from sessions, not from task
  status (Picard input: the board lags live work by design).

## Open questions

- Q1 and Q3 in the [README](README.md).
- Settled with Picard (2026-11-13): milestones vs the releases index, now criterion 5.
- How does a project other than Helix name its releases index, if it has one? Part of Q1.
