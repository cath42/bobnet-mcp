# BOB-44 build D (Mario, w_56997923, 2026-11-21)

Session `BOB-44 build D` (a-fixes-6). Input: review-c.md (M1) and its close (w_d95500c4.md), v2 5c8a6c1.
mbp-1 runs rc.44; ubu1 is on rc.41 until Casper's A-2 (parked; the broker deploy, BOB-69 AC 6 and BOB-71 AC 4 wait
on it, not worked around).

## Scope
- BOB-105 (review C M1): an upgrade asked during startup is failed by resume() and its partial discarded, then
  restarts anyway. Fix and test lines in review-c.md M1 and the item's four ACs.
- BOB-93 stays In Review until BOB-105 lands; closed out with it.

## Order
| Worker | Tasks | Where |
|---|---|---|
| L1 | BOB-105 | supervisor.ts start(), upgrade.ts resume()/ask(), store.ts moveUpgrade/endUpgrade |

Supervisor-only: no wire, no config schema (AC 4). After: review D, then rc.45 (tag + push; poe hand-installs on
mbp-1). No rc in this session.

## Log
- 16:43Z L1 Luigi w_4bf0bc47 on BOB-105.
- 16:5xZ BOB-105 landed a0cfe42 (Luigi w_4bf0bc47; supervisor 526). Read:
  - Choice: ask() refuses until resume() has run ("this supervisor is starting; ask again once it is ready"), not
    resume() before registration. Why: this.laptop is set only by the supervisor's own registration (the notices
    would say "this laptop"), and sendRemote() flushes the outbox without checking `registered`. Mario checked
    start(): resume() runs unconditionally after the roles' registration (supervisor.ts:634), so the gate always
    opens; ask() checks releases.missing() first, so a laptop with no `upgrade:` section is unchanged.
  - store.moveUpgrade/endUpgrade: `AND stage IN (installing, waiting, restarting)`, return whether the row changed;
    the first end stands.
  - run(), switchAndExit(), fail() stop on a row ended under them (dropped(): warn, no event, no switch).
  - For review D: an ask in the start window is refused, not run (a broker-queued ask from the restart is lost,
    the requester asks again); run() now moves the row to `waiting` before emitting `installed` (same synchronous
    step); a dropped upgrade says nothing more (whoever ended the row told the requester).
  - Tests: upgrade.test.ts "an upgrade asked during start(), before resume(), is refused ..." (AC 1, 3), "moveUpgrade
    and endUpgrade touch only open rows ..." (AC 2), "an upgrade whose row was ended under it stops ...". Diff:
    store.ts, upgrade.ts, upgrade.test.ts only (AC 4).
- 16:5xZ Peach w_889b0222: BOB-105 ACs 1-4 checked (a0cfe42), In Review (review D accepts it). BOB-93 Done
  (review C evidence + a0cfe42).

## Close
- Build D is all on v2 (5c8a6c1..a0cfe42). No rc in this session.
- Next: review D of a0cfe42 (BOB-105; Toad, small fix, an independent read optional; the points for the reviewer
  are in the Log). Then rc.45: tag + push; poe hand-installs on mbp-1. ubu1 stays on rc.41 until Casper's A-2.
- 17:0xZ First land of the close (docs only) failed on a broker test timeout under load (board-status.test.ts "cuts a
  list at 100 ...", 5000 ms; Bill's LAND-56 build was running). Unrelated to the change.
- 17:0xZ A-2: Casper said "go" (to poe, 10:53 CST: "A-2 doesnt look like a question, just an approval to go? go")
  and marked A-2 done on the dashboard (so the answer can't be written again). poe added mbp-1's `upgrade:`
  section (live at the rc.45 install). For ubu1, rc42-ubu1-install.md rewritten as a self-contained runbook for
  one Claude Code session on ubu1: TAG=v2.0.0-rc.44; step 6 grants `upgrade: true` and `athletic: [reviewer]` on
  `supervisor@mbp-1` (the sender of everything poe's supervisor tools send, BOB-82), `poe@mbp-1` left as is;
  step 7 the bob44-probe rule (ADR 0007 §4); one restart for both.
