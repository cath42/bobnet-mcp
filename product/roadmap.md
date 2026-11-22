# BobNet roadmap (Peach, 2026-11-21, with Casper)

The board is the source (`board_list releases`, `features`); this file records the shape and why.
Supersedes the cut of 2026-11-16 (git history).

Casper, 2026-11-21: "Looks good, yes let's close out R1 but let's get those loose ends in there to
close out R1 first, R2 looks good". Routine upkeep and a UI revamp are new (his words in BOB-120, BOB-121).
And: "You are the primary PO … Moving a feature in to a release is your responsibility"
(board-writes.md criterion 4 amended; the broker change is BOB-122).

| Release | Goal | Features, in order |
|---|---|---|
| R1 Central backlog view | close it | 10 Done; loose ends BOB-115 (Vitals leftovers), BOB-118 (global admin), BOB-119 (editable questions: release + deploy), BOB-77 and BOB-82 (fold into BOB-118 or archive) |
| R2 Run the team from your phone | answers wake agents, Waits and permissions never stale or cut | BOB-122 (PO slots releases), BOB-44 (accept and close), BOB-111 (an answer wakes), BOB-49, BOB-48, BOB-51, BOB-6 (start a session) |
| R3 Routine upkeep | every project tuned weekly/monthly | BOB-120: discovery with each orchestrator and its team first. BOB-123 (disk cleanup, Ready) is built early, after BOB-119, as its first concrete part |
| R4 Catch up after hours away | Status | BOB-33, BOB-52, BOB-35, BOB-36 |
| R5 Dashboard revamp | the UI looked at whole | BOB-121, after Status so it covers it |
| R6 Harden what we built | | BOB-50, 53, 54, 55, 56, 57, review leftovers (BOB-102-110, 113, 114), flaky tests (BOB-88, 112), BOB-58 last |
| R7 Device keys | | BOB-25 |

R2 refinement (2026-11-21): BOB-122, 111 new criteria; BOB-48, 49, 51 re-checked against BOB-44
(Toad's advice c_0201d124); BOB-6 criteria from start-session.md. All Ready.

Casper, 2026-11-21 ~22:4x: "Yes to your questions": R3-R7 in this order. Releases R3-R7 are created
on the dashboard (creating a release isn't a PO write); once BOB-122 lands Peach slots features.
