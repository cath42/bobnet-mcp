# BobNet roadmap: the cut (Peach, 2026-11-16)

Casper (via poe, 2026-11-16): scope the roadmap into small features like Helix, then work through the
backlog. One feature per session kind (design, build, review as it needs); poe starts each from the
board's order. The board is the source (`board_list features`, no release); this file records the cut
and why. Release scope is Casper's: nothing below is in a release yet except BOB-9 (R1) and BOB-6 (R2).
**Proposal for Casper:** put BOB-47 in R1 (same capability as BOB-9) and the rest in a new R3
"Run BobNet's own team reliably", after R2. I did not create or reorder releases.

Sizing rule: one concern per feature, 2 to 4 backlog items that touch the same part, one build session
and one review. Design only for visible changes (Daisy) or a wire/store/rule decision (Toad). Toad
reviews protocol, store and cross-part changes. Bugs and what hurts daily use first.

| # | Ref | Feature | Sessions | Size | Why here |
|---|---|---|---|---|---|
| 1 | BOB-47 | Move Athletic's board into the service | build (import, cut-over), review (acceptance) | small | Casper asked, tool and plan ready, no code; follows BOB-9 |
| 2 | BOB-44 | One orchestrator across laptops | design (ADR 0007), build, review | large | Casper asked (11-16 ~22:45) to prioritize it; criteria Ready; release placement is his gate (Q-8) |
| 3 | BOB-48 | Dead permission requests and quiet laptops clear or show (BOB-26 bug, 17, 28, 23) | design, build, review | medium | Production bug: Casper sees a "crapton" of dead requests; BOB-27 hid for 11 h |
| 4 | BOB-49 | Waits on you is never stale, a lead's question shows (BOB-34, 45) | design, build, review | medium | Casper: "that's important"; shares the Waits list with 2 |
| 5 | BOB-33 | Status tab (in flight, 11 of 14 criteria) | finish its build, review | small left | Already open; finish before starting more Status work |
| 6 | BOB-50 | Land and inbound messages don't lose work (BOB-11, 13) | build, review | small | Reliability of the team's own tools |
| 7 | BOB-51 | Permission question whole, note with Allow delivered (BOB-32, 29) | design, build, review | medium | Protocol change (Toad); visible (Daisy) |
| 8 | BOB-53 | Trust claims match the code (BOB-12, 15) | build, review | small | Security docs that overclaim |
| 9 | BOB-54 | Message store migrations and retention (BOB-20) | build, review | small | Store hygiene; before the store grows |
| 10 | BOB-52 | Status shows deploys, scale test covers questions (BOB-41, 43) | build, review | small | Follows BOB-33 |
| 11 | BOB-35 | Status: recurring problems and theme tags | design, build, review | medium | Draft, Status follow-on (Picard input) |
| 12 | BOB-36 | Status: the lead's note | design, build, review | small | Draft, Status follow-on |
| 13 | BOB-55 | Protocol: client version on register (BOB-16) | design, build, review | small | Toad's wire change, better before more clients |
| 14 | BOB-56 | Tests: typed app.js, quiet board tests, one end-to-end (BOB-19, 22) | build, review | medium | Safety net before the split |
| 15 | BOB-57 | Tokens only, no Helix strings in code (BOB-21, 24) | build, review | small | Cleanup, no user-visible change |
| 16 | BOB-58 | Split the Supervisor class (BOB-18) | build, review (maybe 2 builds) | medium | Last: it conflicts with every supervisor feature before it |
| 17 | BOB-25 | Device keys and signed dashboard actions | build, review (Ready, 9 criteria) | large | Needs Casper's say on timing; not hurting use today |
| - | BOB-6 | Start a session from the UI | (R2, Draft) | large | Casper's R2; order stays his |

Done in this cut: BOB-46 (Usage current session) closed, fix e5932c8, Casper's look on rc.38.
Backlog is empty after it except Done items (BOB-27, 30).
