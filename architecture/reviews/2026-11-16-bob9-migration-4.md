# Review: 8b0a842, board migration 4 (BOB-9) — signed off

Broker deploy can go. ADR 0006 records it.

- Runner (`src/schema.ts` migrate, called in `transactionSync` at `board/board.ts:22`): the
  migration's three statements and the schema_version bump commit together or not at all; runs once.
- Same guard in all three, evaluated before the UPDATE, so the event, its change row and the update
  agree: guard false → none writes (the second INSERT selects no row, so a stale
  `last_insert_rowid()` is never used). `key` is unique, so one row at most.
- `last_insert_rowid()` is the events row just inserted (`seq` AUTOINCREMENT rowid); the
  events triggers are BEFORE UPDATE/DELETE only, nothing intervenes.
- Guard via `item_refs` covers primary ids and aliases. Tests cover both paths.
