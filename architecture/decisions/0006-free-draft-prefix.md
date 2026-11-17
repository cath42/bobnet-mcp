# 0006. BobNet's own project frees draft prefix DRAFT

- **Status:** accepted (Toad, 2026-11-16) for BOB-9, ruled in consult c_7b45b8c1. Built in 8b0a842.

## Context

BOB-14's import gave project `bobnet` draft prefix `DRAFT`, but no id of bobnet's is a `DRAFT-` one.
Draft prefixes are unique across projects (create_project/import check), so Helix's import, which
brings its `DRAFT-n` ids, is refused. No board op edits a project.

## Decision

Board migration 4 (`packages/broker/src/board/schema.ts`, BOARD_MIGRATIONS[3]) sets bobnet's
`draft_prefix` to NULL, only when it is `DRAFT` and no `item_refs` row of bobnet's (primary or alias)
is `DRAFT-%`. The change is written to the history as the board's: an `events` row (actor_kind
`board`, actor `migration 4`, op `update_project`) and its `event_changes` row, tied by
`last_insert_rowid()`. The three statements share one guard and run in the runner's
`transactionSync`, so either all three write or none does.

## Consequences

- Helix's import can take `DRAFT`; the dashboard's `featureRoute` fallback resolves `DRAFT-n` to Helix.
- bobnet has no draft prefix; giving it one later is an op that doesn't exist yet.
- A one-off data fix as a migration is allowed when it is guarded to be a no-op where it doesn't apply,
  and leaves an event.

## Alternatives

- An `update_project` op: more surface for a one-off; not needed until a project's settings are edited.
- Helix renaming its drafts on import: breaks its ids, which its repo is the source of.
