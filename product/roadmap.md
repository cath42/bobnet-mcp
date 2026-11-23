# BobNet roadmap (Peach, 2026-11-23, approved by Casper)

The board is the source (`board_list releases`, `features`); this file records the shape and why.
Casper approved it on 2026-11-23 ("1. Approved", Q-15, no swap of R3 and R4):
[release-proposal-2026-11-23.md](release-proposal-2026-11-23.md) has the reasons. It supersedes the
cut of 2026-11-21 (git history), whose order was upkeep, Status, revamp.

**One feature at a time** (Casper): the next one starts when the one before is Done.

| Release | Goal | Features, in order |
|---|---|---|
| R1 Central backlog view | one board for every project | **closed 2026-11-23** (13 Done, and BOB-118) |
| R2 Run the team from your phone | answers wake agents; Waits and permissions never stale or cut | BOB-189, 122, 44, 48, 51 Done; **BOB-111, BOB-49 wait on live evidence only** (below) |
| R3 Dashboard revamp | the dashboard, use case first | BOB-121 (builds B to E, [bob121-waves.md](bob121-waves.md)); BOB-33 closes against BOB-183 |
| R4 Runs without you | work goes on at night, lands don't fail on a busy laptop | BOB-188, BOB-190 (with the flakes BOB-165, 112, 124, 88, 114, 160), BOB-158 (with BOB-77, BOB-127) |
| R5 Routine upkeep | every project tuned weekly and monthly | BOB-123 (Done), BOB-120 (with BOB-126, 125, 159; discovery waits on Bob's and Vita's views) |
| R6 Start a session from the UI | start a session from the phone | BOB-6, BOB-161 |
| R7 Harden what we built | correct under failure | BOB-50, 53, 55, 54 (with BOB-76), 56, 57, 191 (BOB-44 review leftovers), 58 |
| R8 Device keys | signed dashboard actions | BOB-25 |
| Later (no release) | | BOB-52, BOB-35, BOB-36 (looked at again once Status is rebuilt); BOB-115 until the broker's sweep (~2026-12-17) |

R3 to R8 are planned; each opens with the first session on one of its features. POs reorder releases
too (Q-14, yes); the order itself is Casper's.

**R2 closes** once these are in, or on 2026-11-30 with BOB-154 moved to R7 (as the proposal says):

- BOB-111: AC4, what the dashboard said after an answer (who was told): a line from Casper or poe.
  AC1 is checked (Q-14, m_board_8849).
- BOB-49: AC3 and DoD 2, through BOB-154: the Helix, Athletic and Vitals leads' `board_ask` and `Fixes:`
  lines with each lead's `questions` grant (poe), and a real lead `board_ask` with `holds_sessions` seen
  on Needs you, with a screenshot (any lead asks; Casper or poe looks).
