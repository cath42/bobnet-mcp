# The dashboard, use case first (BOB-121)

**Agreed by Casper, 2026-11-22.** Q-13 (his verdict "changes", recorded as "yes build it with the
changes"): build the prototype of every view, with the changes below. His words are in
`lead/bob121/q13-verdict.md`; the earlier feedback is in `lead/bob51/casper-dashboard-feedback.md`.
The design is `design/BOB-121/spec.md`, the data is ADR 0014 and `architecture/bob121/build-brief.md`,
the build waves are [`../bob121-waves.md`](../bob121-waves.md).

## What he asked for

- Start from what he does on the dashboard: Overview is his start page, with who is running and CI per
  project (running, failed, passed, last run). Needs you stays, with its split between work held up and
  when you have time, and **nothing on it may become stale**.
- Projects at a glance with true data (Helix on R2, not "R1, 4 of 4"), and a project page to click into.
- No unexplained "58 of 62 criteria" on a Roadmap Done feature; Features never says "no backlog
  configured"; Status must work; Usage is one graph per project, with a switch that weighs tokens by
  model; the Sessions tab goes.
- From Q-13: on Usage, tapping a day's bar opens that day's **context per call** and **calls** line
  graphs, **in total and by agent**, with a **baseline**: the median over the chosen period (14 or 30
  days), as a dashed line. The prototype's "show other states" panel is **not built**.

## Settled by Peach

### Needs you never goes stale (BOB-121 AC4; design spec §6 Q1)

Casper's words are "we just cannot allow any of it to become stale". Stale means shown but no longer
true. "Nothing over a day old" in the criterion is how that is checked for what the dashboard cannot
confirm from the board. So:

| What | Shown while | Leaves when |
|---|---|---|
| A live request from a laptop (a permission, a worker's AskUserQuestion) | its laptop's report is under 3 minutes old, the request is under a day old, and its worker is not known to have stopped: listed in the report and not active (BOB-48's rules; absent from the report's 100 is unknown) | any of the three stops being true, or it is answered |
| A human-tier request whose worker a supervisor restart stopped (orphaned), labelled so | the first two above, and no worker of its project and role is queued, active or started since | either stops being true, its role runs again, or it is answered, which starts the worker again |
| A board question or action (Q-n, A-n), a bug that blocks use | it is open, **however old**, with its age shown ("4 days") | it is answered, withdrawn or done |

Daisy's reading is right: a board question open for four days is still true, and hiding it would hide
something that still holds work up. The age shows on every item, so an old one is seen as old, not
dropped. Two things follow, both in the Needs you task:

- A quiet laptop's requests are not offered, and its banner shows.
- The card says what it is up to date with ("mbp-1 reported 18s ago"). When the page's own refresh has
  failed or is over 3 minutes old, the line turns warn and says "Last updated 4m ago": it never claims
  it is up to date when it is not. The counts (tab, Overview, project switch) count exactly what is
  shown.

AC4's wording on the board is amended to say this.

**The orphaned request** (Peach, 2026-11-23, on review C: Toad's gate 5 and Daisy, who agree;
`architecture/bob121/review-C.md`, `design/BOB-121/review-C.md`). It stays. It is true and only
Casper can decide it, and without it the page says "Nothing needs you" over work that waits on
Casper. It doesn't reopen BOB-26: those requests were dead ones that never cleared, up to days old,
and BOB-48's AC1 expires one whose worker *can't* be resumed. This one can, and it goes within a
day or when its role runs again. An orchestrator-tier one is its lead's, as before. Answering
resumes the worker, Deny too; a dismiss that starts nothing is BOB-199. The exact conditions and
words are BOB-176 criteria 14 and 15.

**A worker's question** has Deny only on the agent's row: Allow was always refused
(`router.ts:128`). The row says so in Daisy's words (BOB-177 criterion 3).

### What is not built

- **BOB-161** (answer a worker's AskUserQuestion by picking an option) stays a backlog item for
  Casper's verdict. The agent row only says where it would sit.
- **BOB-35, BOB-36, BOB-52** stay separate.

## What must not break

Triage (behaviour and look), Capture, the answer forms, the gates (release scope, order, close), the
quiet-laptop banner (BOB-48), the feature page's chain, history and context per call. Tokens only,
never dollars, anywhere on the page.

## Evidence

Each task's criteria say theirs. The feature's own evidence, for acceptance: Casper's words on the
board that he has seen it live (DoD 3); Daisy's review against the prototype on phone, tablet and
desktop and Toad's on the data shapes and the weighting (DoD 2); BOB-121 AC1-AC17 each checked against
a task's evidence (BOB-163 is AC5's data, BOB-162 is AC17).
