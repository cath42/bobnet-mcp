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
