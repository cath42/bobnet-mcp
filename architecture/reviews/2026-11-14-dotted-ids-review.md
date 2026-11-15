# Review: dotted ids and the import's findings (a720d5f, plan item 0c)

- **Reviewer:** Toad, 2026-11-15, for Mario.
- **Against:** ADR 0001 "Dotted ids: what Luigi changes" (points 1-4), the fold review's notes 1
  and 2 (`2026-11-14-import-fixes-and-fold-review.md`), and the import review's findings 3, 4, 5, 6
  and 9 (`2026-11-14-backlog-import-review.md`). Luigi's handoff is w_7735afa0.
- **Verdict: signed off. Nothing to fix.** 0b (5b6717e) and 0c (a720d5f) together are ready for the
  broker deploy, then rc.31.
- **Ran:** protocol 29 tests, supervisor 212, broker 6 + 1 files, all passing at a720d5f. I also ran a
  dry run of BobNet's own board at a720d5f (below).

## The amendment, points 1-4

1. **Protocol.** `ItemRef` has `ItemAlias`'s pattern (`board.ts:45`), both doc comments now say what
   §8 says, and `BoardExportV1` is still version 1. The test takes `LAND-49`, `LAND-49.14` and
   `LAND-49.3.1`, and refuses `LAND-49.`, `land-49`, `LAND-` and `LAND-49..1`. The change is
   additive on the wire. Replies are cast, not parsed (`client/src/connection.ts:229`), so an old
   client reads a dotted ref in a reply without trouble. Only an old client's *input* check refuses
   one (see note B).
2. **Import.** `keeps` no longer tests for a dot (`backlog-import.ts:264`). `next`, aliases, "Was"
   and `resolve` are unchanged. The header comment, the "Renumbered" heading, both doc sections and
   the tests all match. The test pins the order `LAND-49.2` before `LAND-49.19`.
3. **Supervisor.** `spawn_worker`'s task check (`supervisor.ts:388`) and `boardCtx` (`:1637`) take
   dotted tasks through `ItemRef`. On a service project the session's feature check (`:399`) takes an
   `ItemRef`, and Backlog.md projects keep `FEATURE_ID`. Because `declared` upper-cases the feature,
   `bob-1.1` is stored as `BOB-1.1`. The test was flipped as the amendment asked: `BOB-1234567` and
   `BOB-2.` are refused, and a dotted task and session feature are taken.
4. **Store.** There is no code change, as the amendment said. The broker test covers what it listed:
   a dotted primary is imported, `get` and `update` work by its ref, deps point at it, `create` mints
   `BOB-2`, and the round trip keeps the ref and the order (`BOB-1.2` before `BOB-1.10` by `pk`).

## Fold review notes

- **Note 1.** The `--post` fetch is now caught (`backlog-import.ts:723`). It prints the wording I
  asked for and exits 1, and the timeout case is tested.
- **Note 2.** `SEGMENT` is exported (`address.ts:6`), and `name`, `laptop` and `PeerAddress` are
  built from it (`board.ts:53-59`). They stay regexes, so the MCP tools' JSON schemas keep their
  patterns. Exporting a constant is additive. `SEGMENT` has no `g` flag, so sharing it carries no
  `lastIndex` state.

## Import review findings

- **3 (ordinals).** Ordinals are ranked per scope and spaced by 1000 (`:441-454`), which is the
  board's `ORD_STEP` (`store.ts:34`). The scopes are the ones the board's `order` uses: tasks by
  parent, features by release with `null` as its own scope, and the backlog (`store.ts:841-852`).
  Ties stay ties because ranks are distinct values. The note goes under "Done by rule". Archived
  items are ranked along with the rest, although the board's `order` leaves them out. That's
  harmless: the order is still consistent. Leave it.
- **4 (milestone).** A task whose milestone its feature lacks is now a problem (`:354`), so it blocks
  the post, as §11 asks.
- **5 (closed release).** Built as a problem that blocks `--post`, which was my lean. Archived work
  is left out of the check, which is right, because the board's own counts leave it out
  (`store.ts:334`). The check is stricter than §5's wording: it counts a closed release's tasks and
  backlog items, not only its features. Stricter is fine for a report the PO settles before a
  one-way post. **Peach still has to confirm problem versus note.** Until she does, this is built as
  a problem, and it costs nothing on BobNet's board, which has no closed release.
- **6 (mentions).** Every `was <id>` that `WAS` doesn't take is listed in its own report section with
  the item and the line. The section doesn't block the post, which is right, because these are for
  the PO to read, not to settle before posting. The skip test is exactly what `WAS` takes: `Was ` at
  index 0 or after `\n`. A line indented before `Was` is therefore listed and not linked, and both
  sides agree on that.
- **9 (fixture).** The supervisor's test writes `backlogToExport`'s output for a small backlog and
  checks it against `packages/broker/test/fixtures/backlog-import.json` (`UPDATE_FIXTURES=1`
  regenerates it). The broker's test imports that fixture. Drift on either side fails a test. A
  fixture was the right choice over a direct import, because the workers pool can't load
  `node:child_process`.

## BobNet's own board, dry run at a720d5f

I ran `importBacklogCommand` without `--post` (`--project bobnet --prefix BOB --lead Mario@mbp-1 --po
Peach@mbp-1`). The result: 12 features, 13 backlog items and 1 task. **`BOB-1.1` is kept as its own
ref, a task under `BOB-1`.** There are 0 problems, 0 renumbered, 0 mentions and 0 rules.

- "Rules: none" means only the owner can write after the post. Peach's `--grants` file (BOB-14 #7)
  has to be on the real post.
- `--questions lead/questions.md` isn't in the repo ("No lead/questions.md at a720d5f55968"). The
  post should point at wherever BobNet's questions file lives, or leave the flag out. That's Peach's
  and Mario's call.

## Notes (none blocks)

- **A. Rollout, 0c's half.** A post carrying `BOB-1.1` needs both the deployed broker
  (`export.ts:323` parses with the protocol's schema) and an rc.31 supervisor. An old broker answers
  `invalid` for a dotted ref, so nothing is written twice. 0b's ordering is the stricter one (see
  below).
- **B. Clients older than rc.31** check tool input with the old `ItemRef`
  (`client/src/board-tools.ts:40`). After BOB-14 posts, such a client can't write `BOB-1.1` by its
  ref, and gets a local "invalid". That does no damage, and it only matters for laggards (poe's
  channel clients run rc.19). rc.31's notes should say "dotted refs need rc.31 clients".

## Deploy-ready: yes

`git diff e12cdc8 a720d5f -- packages/broker/src packages/protocol/src` (e12cdc8 is the live broker)
is 0b and 0c and nothing else. That's Board migration 2 (`op_keys`, one table and one index, append
only), the op key, `record_answer`'s `told`, and the widened `ItemRef`. There are no `Broker`
migrations and no new Durable Object class (`wrangler.jsonc` migrations are unchanged).

**Order:** (1) the broker deploy, when Casper asks for it. (2) rc.31: both supervisors and any rc.31
channel client. Never rc.31 against the old broker: it resends writes without a key, so a lost reply
writes twice, and dotted refs are refused. rc.30 against the new broker is safe. (3) BOB-14: a dry
run at the commit to be posted, to check that `BOB-1.1` is kept and there are 0 problems, then
`--post` with the grants.

**What Casper should check right after the deploy:**

1. **Everyone reconnects.** The deploy drops every connection. On the dashboard, every supervisor
   peer on mbp-1 and ubu1 should be back within a minute or so, and the supervisors' logs should show
   no "could not report" after the reconnect. Peers that reconnect within seconds may land on the old
   code (rc.29's lesson), so check again a couple of minutes later.
2. **The board answers.** As the owner, `GET /v1/board/export` should answer 200 with `version: 1`.
   The first request to `Board` runs migration 2, so a failed migration would show up here as an
   error and not later in a write. The nightly backup's next run is the same check.
3. **Record the version id** from `wrangler deploy` in the plan, so it's clear which code served
   which reconnect.

Before rc.31 nothing else on the board should change, and BOB-14 does not post on rc.30.

## Also in this commit

Luigi's consult on `close_release` and `undo` (BOB-2 piece a) is answered and recorded in ADR 0001 §5
("Close and undo"). It needs no migration.
