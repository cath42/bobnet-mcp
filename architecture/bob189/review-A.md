# BOB-189 review A (Toad): a PO organizes releases, plus BOB-168's B1

**Against:** `architecture/bob189/build-brief.md` and ADR 0003's addendum (2026-11-22). **On:** `origin/v2` at
`b7ec467`. Line numbers are at `b7ec467`.

| Task | Commit | Verdict |
|---|---|---|
| D9 (BOB-168), carried | 56f1e94 | its patch is identical to the `f7423a8` I reviewed (BOB-121 review A) |
| R1 protocol | a8cd0ce | pass |
| R2 + R3 broker | 3ba1606 | pass |
| B1 (BOB-121 review A) | 71c2ea0 | **closed** |
| R4 AC4 end to end | 1bc6c17 | pass |
| R5 client (the rc) | a4c0cc9 | pass |
| R6 dashboard | b7ec467 | pass (the code). Daisy reviews the screens. |

**Nothing else on v2 since `72275ec`.** The seven commits above are all of `72275ec..b7ec467`.

## Deploy-safe? Yes

`b7ec467` on the live broker, while the installed clients are older:

- **Wire.** R1 only adds two members to `BoardOp`. An old client never sends them. `BoardWritten` and the
  read results are unchanged. History can now carry events with op `update_release` and `reopen_release`.
  `BoardEvent.op` is a `string` (`protocol/src/board.ts:782`), and no client or supervisor code switches
  on a release op (git grep). An old client passes them through.
- **No migration.** `releases` already has every column (`schema.ts:32-46`). `events.op` has no CHECK.
- **Rights.** These changed:
  - `create_release` moves from `create` to `release`;
  - `order_releases` and `close_release` move from `ownerOnly` to `release`.

  An old client's `WRITES` has none of these three ops, so no installed agent loses a write. The
  dashboard is the owner, and the owner holds every grant (`rules.ts:97`). Nothing outside the store
  sends `create_release` except the dashboard. The supervisor's import writes releases on its own path.
- **D9 with B1 fixed:** deploy-safe, as review A said it would be once B1 was closed.

## rc-safe on a deployed broker? Yes

- R5 is the only client change since `72275ec` (`client/src/board-tools.ts:33-50, 147-148`). Each op is
  parsed against the protocol before it is sent, and the deployed broker has all five.
- **Order matters:** an rc on a broker that hasn't been deployed gets the new ops refused as `invalid`.
  Deploy first, then the rc (ADR 0003 addendum, Consequences).
- This review covers what changed since `72275ec`. Client and supervisor changes between the installed
  rc and `72275ec` were covered by earlier reviews, not this one.

## B1: closed

- `CI_HISTORY_SQL` (`store.ts:94-99`) is the rewrite review A asked for, as written there:
  1. it ranks per workflow in `h`;
  2. it filters `h.n <= 6`;
  3. only then does it join `pushes` and `runs`.
- The join still scans `pushes` for each kept run, because `lower(repo)` gets no index. That is 6 ×
  workflows × pushes: linear, not runs × pushes. Review A judged that enough without the migration for
  an index.
- The test (`board-project.test.ts:188-218`) has 400 runs and 400 pushes in 2 workflows. It checks 6
  per workflow, newest first, and `rowsRead < 9600`. The old query read 161615 rows. The new one reads
  about 400 ranked + 12 × 400 joined.

## Findings

### Blocker

None.

### Major

None.

### Minor

1. **Q-14: what a "no" changes.** The broker change is the one line Luigi names, but more than one
   test and two dashboard lines go with it.
   - **Broker:** `store.ts:1868`, `rules.require(...)` → `ownerOnly(tx.caller, "Ordering releases")`.
   - **Tests that break:**
     - "AC1, AC2" (`board.test.ts:578`, its `order_releases` at `:588-590`);
     - "refuses every release write…" (`:672`): `order_releases` at `:678` would get "Casper's gate", not
       the "may not organize releases" message the test matches;
     - AC4 (`1bc6c17`), where Picard's `order_releases` comes right after Later is created.
   - **Dashboard:**
     - the footnote, `app.js:1025` (Luigi named it);
     - the banner, `app.js:1019` ("change the order of releases, … yours, and PO's"), which Luigi didn't
       name.
   - **What a "no" needs:** a broker deploy only, not an rc. The client would still offer
     `order_releases`, and the broker refuses it with a clear message. Drop it from `WRITES` and the
     description in the next rc after that.
2. **The banner promises Undo that Reopen doesn't have.** `app.js:1019` says "Changes save as you make
   them, each with Undo". Reopen deliberately has none (`app.js:1146`, passed `null`; Daisy's call). The
   words are Daisy's to settle.
3. **A stale comment in the import.** `supervisor/src/backlog-import.ts:457`: "no operation reopens a
   release" is no longer true. The import's refusal of a closed release with work not Done still stands
   on the first half (`close_release` refuses it), so this is only the comment.

## Checked and right

- **R1:**
  - `update_release.set` is partial, strict and refined to at least one field;
  - `title` is not nullable, matching `releases.title NOT NULL`;
  - `goal` and `spec_url` are nullable, as in `create_release`;
  - `reopen_release` takes `{ref, reason?}`, and both are in `BoardResults` (`protocol/src/board.ts:289-305`).
- **R2:** every release write requires `release` with scope null (`store.ts:1482, 1868, 1894, 1932, 1952`).
  - Under `rules.may` (`rules.ts:105-113`), a null scope is covered by `all` and `not_open_feature`, and
    not by `open_feature`. So a worker on an open feature can't write releases, as ADR 0001 §5 has it
    for backlog items.
  - `closeRelease` also requires `release` on each moved feature's scope (`store.ts:1907`). That check
    runs before any write, so a refusal writes nothing.
  - Undo stays `ownerOnly` and takes only owner events (`store.ts:2431-2437`). `SAYS.release` is changed.
- **R3:**
  - `updateRelease` writes one event, with old and new for each field that changed (`store.ts:1930-1943`).
  - `reopenRelease` reads the last `close_release` on the release (`store.ts:1955-1958`). It returns `open`
    only if the close's old status was `open`, and `planned` otherwise, including for an imported release
    with no close event.
  - It clears `closed_at` and `closed_by`, which the schema's CHECK requires (`schema.ts:45`). The event
    keeps their old values. The moves stay.
  - **Interplay with the owner's Undo is safe.** `undoClose` refuses unless the release is still closed
    by that very event (`store.ts:2488`, `closed_at !== e.at`). An owner's Undo of an old close after a
    PO's reopen, or after a reopen and a second close, is a conflict, not a double reopen.
  - **Deviation from the brief, accepted:** a no-op `update_release` reports the last seq, as every no-op
    does, not `0`. The dashboard never sends `update_release`, so its "seq 0, no Undo" rule isn't
    involved.
- **R4:** the sequence is the brief's.
  - It creates R3 and Later, edits one and orders all of them.
  - It promotes an item, then moves it into R3, to Later, out of any release and back.
  - It orders R3's features.
  - It closes R0 with moves, reopens it and closes it again.
  - The end state is checked in `list releases`, `list features` and R0's history, by Picard.
  - Not verified by me: that the rule is Picard's exactly as `board_grants` shows it. I may not read
    helix's board. The fields match AC4's.
- **R5:**
  - all five ops are in `WRITES` with one clause each;
  - the test sends each through `checked` and checks that the project is filled in;
  - a `close_release` without `ref` fails with `bad_arguments` before it is sent.
- **R6:** `relState` falls through to `r.status`, so a planned release gets its badge (`app.js:1044`).
  The other R6 changes:
  - the goal line (`:1057`) reads `ReleaseRecord.goal` (`protocol/src/board.ts:556`);
  - a closed release gets Reopen where Close was;
  - `gate` gives no Undo when `undoOp` is null (`:1110`).
