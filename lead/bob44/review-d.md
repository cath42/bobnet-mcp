# BOB-44 review D (Mario, w_bc85531b, 2026-11-21)

Session `BOB-44 review D`. Reviews BOB-105 (a0cfe42; review C's M1; store.ts, upgrade.ts, upgrade.test.ts, supervisor
only). Input: build-d.md and its close (w_56997923.md).

Reviewers, as in review C:
- Toad (w_a5b156ae): `architecture/reviews/2026-11-21-bob44-build-d.md` (1acdcb7), ADR 0008 "As built, build D".
  0 blockers, 0 majors, 0 minors. M1 closed. All four departures in build-d.md's Log accepted: the ask() gate rather
  than resume() before registration; a start-window ask (a broker-queued one included) refused, not run; `waiting`
  before `installed`; a dropped upgrade says nothing more (dropped() is a backstop the gate makes unreachable).
  rc.45: go, no order rule beyond rc44-notes.md.
- Independent (Mario's subagent, fresh context, read-only): `review-d-independent.md`. 0 blockers, 0 majors,
  2 minors. The three new tests fail on the old code. Typecheck clean; supervisor 526/526.

**Result: no blockers, no majors. rc.45 tagged in this session (rc45-notes.md).**

## Minors (backlog, Peach)
1. BOB-113 (independent m1): addUpgrade's `INSERT OR REPLACE` is the one upgrades write that could reopen an ended
   row; unreachable today (req unique). Plain INSERT / ON CONFLICT DO NOTHING checked in run().
2. BOB-114 (independent m2): the new tests assert absences after a fixed tick(20); wait on a positive signal first.

## Note for poe
An `upgrade_supervisor` to a laptop that has just restarted can be refused "this supervisor is starting; ask again
once it is ready": transient, ask again.

## Board
BOB-105 is In Review with its ACs checked (Peach, build D); review D accepts it: Peach moves it Done.
