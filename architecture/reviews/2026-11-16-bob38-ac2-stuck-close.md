# Review: BOB-38 AC 2, a stuck run settles when its session closes (63d1c5b)

Toad, 2026-11-16, against ADR 0005 §2 as amended in fed5d39.

**Signed off. The broker deploy can go.**

- `statusOf` (`packages/broker/src/board/store.ts` ~677): settles at `min(later run start,
  max(sessions.ended_at, runs.ended_at))`, which is the §2 rule. A run whose session closed at or
  before its end is skipped (`at === ended_at && at === closedAt`), so a stop-on-close is listed
  nowhere, as §2 says. A run with no session keeps the old agent rule.
- Tests (`board-status.test.ts`): the four cases §2 names (closed after the end, closed before it,
  open with no later run, open with a later run), with the settled times checked. Matches.
- No protocol change, no migration.

Minor, no action: one `SELECT` on `sessions` per failed run in the span. Bounded by failed runs,
fine at today's size; fold it into the runs query with a join if the span grows.
