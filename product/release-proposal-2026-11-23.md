# BobNet: releases and priorities, a proposal (Peach, 2026-11-23)

**Status: approved as proposed by Casper, 2026-11-23 (Q-15: "1. Approved", through poe's numbered
list; no swap of R3 and R4), and applied to the board the same day.** BOB-82 was archived as moot and BOB-77
is a task of BOB-158 (poe m_17371a58); R7's leftovers are BOB-191; R3's minors task is BOB-192. Below is
the proposal as he approved it. **Until then nothing on the board was to move** (his words,
2026-11-22: "organize the backlog in to proper releases and prioritize the features please? ... i want
to review before we do anything"). The question is on the board (see the end).

Inputs: `roadmap.md` and `roadmap-close-2026-11-21.md` (R3-R7 order Casper agreed on 2026-11-21),
`bob121-waves.md`, the review minors (`architecture/bob121/review-A.md`, `architecture/bob189/review-A.md`,
`design/BOB-189/review-A.md`), the backlog as `board_list` gives it today, and the waiting asks BOB-120,
BOB-188, BOB-190, BOB-187, BOB-165.

## The rules it follows

- **One feature at a time** (Casper). The order inside a release is the build order: the next feature
  starts when the one before is Done.
- **Finish what's started first.** BOB-121 is half built (wave A live since this morning's deploy).
- **Every release has a goal a sentence long**, and every open feature is in one release or in Later.
- Done features that sit in no release go into the release they were built in, so the Roadmap reads true.

## Where the board stands (2026-11-23)

- Only R1 and R2 exist. R3-R7, agreed on 2026-11-21, were never created (creating a release wasn't a PO
  write until BOB-189, Done today).
- R1 has 10 of 10 Done, but four backlog items are still in it, and three Done features (BOB-119, BOB-31,
  BOB-47) are in no release.
- R2 is still titled "Start a session from the UI", holds BOB-189 (Done) and BOB-6, while the features
  actually built in R2 (BOB-122, BOB-44, BOB-48, BOB-51) sit in no release.
- 25 features have no release; the backlog has 35 items, 30 of them not Done.

## The releases, in order

### R1 Central backlog view: close it

Goal: one board for every project, read and written through BobNet. **Done.**

- Slot in, as Done: **BOB-119** (questions editable; Casper put it in R1 on 2026-11-21), **BOB-31** (expand
  a truncated question), **BOB-47** (Athletic's board moved, as BOB-9 did Helix's).
- Take out: **BOB-115** (Vitals) to no release: it waits only on the broker's 30-day sweep (~2026-12-17),
  and closes then. **BOB-77, BOB-82** to R4 with BOB-158, or archived if poe says BOB-44 made them moot
  (they were "fold into BOB-118 or archive" on 2026-11-21).
- Accept **BOB-118** (owner makes an agent global admin): it is built (57e7002, the dashboard's #rules, with
  its test) and live with the deploys since, but its card was never closed. I check it against its
  description and mark it Done in R1.
- Then I close R1.

### R2 Run the team from your phone: close it

Goal: answers wake agents; Waits and permissions are never stale or cut. Casper agreed this title on
2026-11-21; the rename never happened.

| # | Feature | State | Why here |
|---|---|---|---|
| 1 | **BOB-189** POs organize releases | **Done today** | Picard's ask; Helix R3 already created with it |
| 2 | BOB-122 the PO slots features | Done | |
| 3 | BOB-44 one orchestrator across laptops | Done | |
| 4 | BOB-48 dead permission requests clear | Done | |
| 5 | BOB-51 a permission question reaches the dashboard whole | Done | |
| 6 | **BOB-111** an answer wakes whoever it holds | built, live; AC1, AC4 open | acceptance only: the asker's receipt and the dashboard's "who was told" seen once live |
| 7 | **BOB-49** Waits never stale | built, live (rc.51 on); criteria open | acceptance only: BOB-154 needs the first real lead `board_ask` with a held session |

- **BOB-6 (Start a session from the UI) moves out, to R6.** It is 18 tasks of build, and its prototype
  question (Q-11) was withdrawn at your word for this reorganization. R2 closes on acceptance alone, no
  build.
- If BOB-49's live evidence hasn't come within a week, I close R2 anyway and move BOB-154 to R7.

### R3 Dashboard revamp (BOB-121), with Status inside it

Goal: the dashboard looked at whole, use case first, as the prototype you approved with changes (Q-13).

| # | Feature or part | Why in this order |
|---|---|---|
| 1 | **BOB-121**, wave A's rest: BOB-171 (D4, project read), BOB-169 (D10), BOB-172 (D5) | data before views; D4 has a wip patch |
| 2 | BOB-121 review minors (one new task): Toad's bob121 m1 (= Daisy's m4: the current release can land on an empty planned one), m2 (a test for the status read's release), **m3 (fix before the Usage page calls `usage`)**, m5, m6; Toad's bob189 m3 (stale import comment) | m3 must land before wave C's Usage page; the rest are small and in the same file |
| 3 | BOB-121 wave B: BOB-174-178, BOB-173 (D6), BOB-162 (D7, a bug) | header, Laptops, Needs you, CI; the supervisor rc |
| 4 | BOB-121 wave C: BOB-179-186 | the views that read the data |

- **Folded in:** **BOB-187** (an action with options shows only Mark done) goes into BOB-176 (Needs you,
  one item function), Toad and Daisy choosing between refusing options on an action and drawing them;
  **BOB-164** (live check of a note sent with Allow) becomes BOB-176's AC16 live evidence. Daisy's BOB-189
  minors m1-m3 (planned badge dashed, the goal above the gate on a phone, the banner's wording) go into
  BOB-184 (the Roadmap view).
- **BOB-33 (Status) closes against BOB-183**, as the waves already say: no separate Status build.
- **Why it moved ahead of Routine upkeep and Status** (your 2026-11-21 order was R3 upkeep, R4 Status, R5
  revamp): you gave BOB-121 its go on Q-13 and wave A is built and live; finishing it is the one feature
  in flight. Status's base is part of it (BOB-183).

### R4 Runs without you

Goal: work goes on through the night and lands don't fail on a busy laptop; poe changes a laptop's
config without your hands.

| # | Feature | Why in this order |
|---|---|---|
| 1 | **BOB-188** resume by itself after a usage limit resets | your ask (1 am stalls till morning); I placed it right after BOB-121, ahead of upkeep, when poe captured it |
| 2 | **Lands fail only for real**: BOB-190 (run a project's land hook on another laptop, e.g. ubu1) promoted to the feature, with the timing flakes as its tasks: **BOB-165**, BOB-112, BOB-124, BOB-88, BOB-114, BOB-160 | load and wall-clock asserts refused good lands for BobNet (4 for D9) and Helix (LAND-110) |
| 3 | **BOB-158** poe changes another laptop's supervisor.yaml (first use BOB-127) | unblocks BOB-127; uses BOB-44's remote ops |

### R5 Routine upkeep

Goal: every project tuned weekly and monthly, assigned out (your words in BOB-120).

| # | Feature | Why |
|---|---|---|
| 1 | BOB-123 disk cleanup | Done (its first concrete part, as on 2026-11-21) |
| 2 | **BOB-120** routine upkeep | discovery waits on Bob's and Vita's views (`requirements/routine-upkeep.md`); then your AC2; then design |
| 3 | Cleanup follow-ups as BOB-120 tasks: **BOB-126** (old releases kept, 27 GB on mbp-1), BOB-125 (worktree prune drops ignored files), BOB-159 | the upkeep runs them |

Bob's and Vita's views are folded into `routine-upkeep.md` as they arrive (my board work only, no
session); BOB-120's design starts only when R5 is next.

### R6 Start a session from the UI

Goal: you start a session from your phone, as a request to poe.

| # | Feature | Why |
|---|---|---|
| 1 | **BOB-6** start a session | design A done (ADR 0010, prototype, 18 tasks); a fresh prototype question comes when it's next |
| 2 | **BOB-161** answer a worker's AskUserQuestion by picking an option (promoted) | the same "act from your phone" step; BOB-121 shows the question whole but doesn't answer it |

### R7 Harden what we built

Goal: what's built is correct under failure and says what it does.

In order: **BOB-50** (a lead's land and an inbound message don't lose work: it loses work, so first),
BOB-53 (trust claims match the code), BOB-55 (client version on register), BOB-54 (message store
migrations and retention, with BOB-76 as a task), BOB-56 (tests), BOB-57 (tokens only, BobNet's words),
then the review leftovers as one feature, "BOB-44 review leftovers": BOB-104 (Ready), BOB-102, BOB-103 (a
spike for Toad), BOB-106-110, BOB-113, BOB-90; **BOB-58** (split the Supervisor class) last.

### R8 Device keys

Goal: signed dashboard actions (ADR 0003 steps 2, 3). **BOB-25** (Ready).

### Later (no release)

- **BOB-52, BOB-35, BOB-36** (Status: deploys, recurring problems, the lead's note). Status is rebuilt in
  R3 (BOB-183); I'd look again once you've used it, rather than plan extras for a page that is changing.
- **BOB-115** until the sweep closes it (~2026-12-17).

## Cut or archived

- **BOB-77, BOB-82**: archive if poe confirms BOB-44's remote spawn covers them; otherwise R4 with BOB-158.
- Nothing else is cut. The Done backlog items (BOB-27, BOB-30, BOB-46, BOB-116, BOB-117) stay as records.

## Creating the releases once you approve

Since BOB-189, I can create, edit and close releases myself. Once you approve:

| Release | On the board |
|---|---|
| R1 | slot BOB-119, BOB-31, BOB-47; accept BOB-118; move BOB-115, BOB-77, BOB-82 out; **close** |
| R2 | rename to "Run the team from your phone", goal set; slot BOB-122, BOB-44, BOB-48, BOB-51, BOB-111, BOB-49; move BOB-6 to R6; close after BOB-111 and BOB-49 are accepted |
| R3 Dashboard revamp | **create as planned**; it opens with BOB-121's next session |
| R4 Runs without you | **create as planned** |
| R5 Routine upkeep | **create as planned** (BOB-123 Done in it) |
| R6 Start a session from the UI | **create as planned** |
| R7 Harden | **create as planned** |
| R8 Device keys | **create as planned** |
| Later | no release: the unslotted features are Later |

Every planned release gets features, so none is empty: Toad's and Daisy's minor (the current release can
land on an empty planned release) doesn't bite meanwhile, and it's fixed in R3's minors task.

## Not in this proposal

- **Q-14** (may a PO reorder releases) is open on its own. It was built as "yes"; a "no" is a one-line
  broker change. Ordering releases above works either way: if no, you set the order on the Roadmap.
