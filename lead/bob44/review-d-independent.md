# BOB-44 review D: independent code review of BOB-105 (2026-11-21)

Reviewer: a fresh reviewer outside the team (Mario's subagent, no prior context), read-only, on
`git diff 5c8a6c1 a0cfe42` (store.ts, upgrade.ts, upgrade.test.ts). `pnpm -r typecheck` clean; supervisor 526/526
(23 files). The three new tests were run against the old upgrade.ts and store.ts (5c8a6c1) in a scratch copy: all
three fail there (the startup ask resolves; moveUpgrade returns undefined; the ended row is reopened), so they test
the fix. **0 blockers, 0 majors, 2 minors.** Lines are v2 at a0cfe42.

## Checked, no fault
- resume() always runs once start() returns: no early return before `upgrades.resume()` (supervisor.ts:634);
  registerWithRetry (:3304) throws after REGISTER_GIVE_UP_MS and bin.ts's catch exits(1). A live process has resumed,
  so ask() never refuses for ever.
- Asks: remote ones (onPush, onRemote, remoteDoV2, upgradeAsk, supervisor.ts:2054) can land during start() and the
  gate covers them; the local `upgrade_supervisor` (:2158) is served over MCP only after start().
- `resumed = true` (upgrade.ts:425) and the loop over upgradesOpen() are one synchronous step; ask()'s check (:389)
  is before its first await. No ask slips between.
- A row ended under run() can't switch or exit: with ask() gated, only resume() (once, before any ask) and supersede
  (a `waiting` row; it clears `current`, and poke() acts only on `current`) end a row; after
  moveUpgrade(..., "restarting") (:489) nothing ends it. The store guards are defence in depth; run() (:477, :480),
  switchAndExit() (:489) and fail() (:455) stop on false, dropped() clears `current`.
- run() moving the row before emitting `installed` (:480-483) is synchronous: no visible order change.

## Minors
1. **addUpgrade can still reopen an ended row** (store.ts:647): `INSERT OR REPLACE ... 'installing'` has no stage
   guard. Not reachable today (remote req is the message id, deduplicated by store.remoteRequest; local req is
   `local_<uuid8>`). Fix: plain INSERT or `ON CONFLICT(req) DO NOTHING`, checked in run() (upgrade.ts:468), so the
   rule holds by construction.
2. **The new tests assert absences after a fixed `tick(20)`** (the start() test and the "ended under it" test): a
   late run() on a slow machine would land after the assertions and the tests would pass wrongly. Wait on a positive
   signal first (the build gate reached, the reply arrived), then assert.

## Note
An ask in the start window is refused ("this supervisor is starting; ask again once it is ready") and not retried:
fine for poe's `upgrade_supervisor`, but poe should know that refusal is transient when rolling a laptop that has
just restarted.
