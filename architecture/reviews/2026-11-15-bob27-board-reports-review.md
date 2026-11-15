# Review: BOB-27, board reports stalled behind a slot run's name (5d4617f)

Toad, 2026-11-15, for Mario. Read: the diff of 5d4617f (`packages/supervisor/src/supervisor.ts`
`fitRunName`, `flushBoardReports`; `test/board-service.test.ts`), the broker's frame path
(`packages/broker/src/broker.ts:119-147`), the six supervisor ops in `board/store.ts`
(`sessionJoin`, `runStart`, `runEnd`, `push`, `slotRun`, `closeSession`, `sessionTokens`), the
client's resend (`packages/client/src/connection.ts:138-165`) and its capture queue
(`capture-queue.ts:35-38`). Ran `test/board-service.test.ts` at 5d4617f: 21 pass.

## Verdict

**Signed off for rc.34.** No blocker, no major. The change is supervisor-only: no protocol change,
no store migration, no broker deploy needed. The 312 rows replaying when rc.34 goes live is fine
(below). Two minors to pick up later and two nits; none needs to go in before rc.34.

## The replay of the 312 rows: acceptable

The rows replay in order, each with the ctx and the times it was queued with. `session_join` isn't
in the outbox (spawn sends it directly and waits, `supervisor.ts:385`), so every session these runs
name is already on the board. Op by op:

- **`run_start` into a session Mario has closed since**: taken. `store.ts` `session()` finds a
  closed session as well as an open one, and `runStart` checks no state. The run is recorded in the
  session it ran in, which is true. **It doesn't reopen anything**: only `session_join` sets
  `open_since`.
- **A closed session's tokens**: `sessionTokens` adds up runs when the record is read
  (`store.ts:1939`), not when it is closed. Those sessions' totals fill in as their runs arrive.
  Only the reply each `close_session` returned to Mario at the time was low.
- **`run_end`, `push`, `slot_run`, `ci_run`**: each one is idempotent by its natural key. They are
  run id, (repo, sha), `external_id` and source plus `external_id`. A run's start is ahead of its
  end in the queue, so `push` and `slot_run` find their run.
- **Briefly wrong on the dashboard**: a replayed run shows as running between its `run_start` and
  its `run_end`, which is seconds apart in the flush.
- **What can be refused**: `forbidden` if a role's grant changed since, and `invalid`/`conflict`
  for a run whose `run_start` was itself dropped (`runEnd`: "No run"). Each is final, logged and
  audited `board:refused`. Each refusal only affects its own run, never the rows after it. I expect
  none or a handful.

## Answers

**Should timeout and unavailable be classified differently? No.** With `waitMs = 0`,
`BrokerConnection.boardOp` turns a 15 s `timeout` into `unavailable` anyway (`RESENT`, then
`left <= 0`). Both mean "the board may come back", so both should wait. A resend after a timeout
that did commit is harmless, because the ops are idempotent by natural key (above). The wait also
has a retry: the stall timer calls `flushOutbox` every minute, so a stall clears without a new
report.

**Should `bad_frame` be final? Yes, now that each row is checked locally first.** Once a row passes
`BoardOp`, a `bad_frame` from the broker means one of two things. Either the ctx failed, or the
broker is older than the supervisor and doesn't know an op kind. Supervisor ops are non-strict
`z.object`s, so an old broker strips a new optional field rather than refusing it. Waiting on a
skewed broker is what caused this stall, so dropping is the right choice. That depends on one
release rule, which ADR 0001 §12 already sets for keys and which I now record in §9 for ops: **a broker
that takes a new supervisor op deploys before the supervisor that sends it.** Note that
`CaptureQueue` (`capture-queue.ts:35`) rules the other way for captures. That is still right:
there, a `bad_frame` means a broker that predates `board_op`, and a capture must never be lost.

## Findings

1. **Minor: a stall can't be seen from the dashboard.** Mario's change logs a wait once per row,
   but this stall lasted 5.5 h with 312 rows queued before anyone read a log. Suggested fix: the
   supervisor's report adds `board_outbox: { count, oldest_at }`, an additive optional field. The
   Laptops card says "N board reports waiting since T" when the oldest is over a few minutes old.
   Daisy's call on the wording. This is for Peach to triage.
2. **Minor: the local check covers the op but not the ctx.** A ctx that `BoardCtx` refuses still
   reaches the broker and is dropped as `bad_frame`. It is no longer stuck, but it is dropped as
   the broker's fault rather than ours. Today's ctx is safe: `boardCtx` filters tasks through
   `ItemRef` and clips them to 50, and the session already passed `session_join`. Suggested fix:
   check `BoardCtx.safeParse(report.ctx)` beside the op check, so a broker `bad_frame` means only
   version skew.
3. **Nit: the clip is by UTF-16 units.** `slice(0, 99)` can split a surrogate pair. That leaves a
   lone surrogate in a name that zod accepts and SQLite may store as U+FFFD. Suggested fix: clip
   by code point (`Array.from(name).slice(0, 99).join("")`), checking the length after the join.
   It is cosmetic. The cleaner place to clip is at the source (`supervisor.ts:667`, `:1778`,
   `e.label`), but clipping at send is what also fixes the rows already queued, so keep it there.
4. **Nit: each attempt gets a new key.** `boardOp` makes a fresh key on every flush attempt, so
   §12's keys do nothing for the outbox: idempotence rests only on the natural keys. That is fine
   for all six ops today. A future outbox op without a natural key would need a stable key per row,
   for example `<laptop>:<seq>`.

## Is anything else in the outbox path to change before rc.34? No.

The order, the drop rule, the once-per-row log and the per-minute retry are right.
