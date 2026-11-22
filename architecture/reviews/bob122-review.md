# Review: BOB-122 build A (b1ba363), a feature's release is a grant

- **Reviewer:** Toad, 2026-11-21. **Against:** advice c_0201d124 (BOB-122 notes), ADR 0001 §5, ADR 0003.
- **Diff:** `git diff a32457c b1ba363` (protocol, broker schema/rules/store, client board_write, grants file, tests). Line numbers are at b1ba363.
- **Verdict: signed off.** 0 blockers, 0 majors, 2 minors (neither needs a fix before deploy). One rollout
  condition, below, which the plan's "live after a broker deploy" misses.

## Against the advice

- `release` is a `GrantField` (`packages/protocol/src/board.ts:37`), so grant ops, the grants read and the
  export carry it. Holds.
- The owner holds every grant: `Rules.require` returns for `caller.kind === "owner"` before any row
  (`packages/broker/src/board/rules.ts:97`). No special case added. Holds.
- `setRelease` checks the grant, not a name: `rules.require(tx.caller, p, "release", this.scope(row), ref)`
  (`store.ts:1534`); create-a-feature-in-a-release likewise with null scope (`store.ts:1209`). Holds.
- `orderReleases`, `closeRelease`, `undo` stay `ownerOnly`; AC3's test refuses a `release` holder both.
  Undo still takes back only the owner's own events, so Casper can't Undo a PO's move; he moves it back.
  That is the advice's intent (Undo is of his own act). Holds.

## Migration 5 on a live DO SQLite

`schema.ts:407-418`: create `grant_fields_new` (same columns, FK to `grants (pk) ON DELETE CASCADE`, PK,
CHECK with `release`), copy, `DROP TABLE grant_fields`, rename. Checked:

- Runs inside `transactionSync(() => migrate(...))` (`board/board.ts:22`), so a failure leaves the old table
  and the migration unrecorded; it reruns on the next touch.
- `PRAGMA foreign_keys = ON` (`board.ts:21`). Dropping is safe: `grant_fields` is only a child; no table
  has `REFERENCES grant_fields`, so the drop's implicit delete checks nothing. The new table's FK points at
  `grants`, which every copied `grant_pk` already satisfied (the old table had the same FK).
- No trigger, view or extra index names `grant_fields` (`schema.ts`: only the CREATE at :331 and the
  migration), so the rename has nothing to rewrite and loses nothing; the PK's autoindex comes with the
  new table. Revoke's cascade still works on the renamed table (export test, last assertion).
- The test (`broker/test/board-export.test.ts`, "board migration 5") rebuilds the pre-5 table with rows in
  workerd's DO SQLite with FKs on, proves the old CHECK refuses `release`, runs `BOARD_MIGRATIONS[4]`, and
  reads the rows back. That is the engine production runs. Good enough; no dry run on prod needed.
- Size: one row per grant field, tens of rows. No time concern.

## Old client and old supervisor

- **Old client, new broker:** works as today. Its `board_write` has no `set_release` (MCP enum), and its
  `board_grants change` is parsed against its own `GrantField` (`client/src/board-tools.ts:39-45, 192`),
  so an old client can neither move a feature nor grant `release`: refused locally with `bad_arguments`,
  nothing sent. Reading grants that contain `release` is safe: the client passes the reply through
  unparsed.
- **Old supervisor, new broker:** the outbox re-checks reported ops with its `BoardOp` (`supervisor.ts:3199`);
  `set_release` was already in the protocol, so a role's set_release passes; a `grant` with `release` from
  an old process would be `bad_row` (final, not stuck). No other path parses grants.
- **New client, old broker:** `set_release` reaches `ownerOnly` and is refused with its reason; a grant
  with `release` fails the old broker's frame check (`bad_frame`/invalid). Refused, nothing written.
- **Export:** an export from the new broker that holds a `release` field doesn't import into an old broker
  (`Grant.fields` is an enum). Only the broker imports exports, and imports go forward. Minor 2.

## Rollout condition (not a finding in the code; Mario's plan)

"Live after a broker deploy" is half of it. Peach's MCP client is the installed release's: until a release
carrying b1ba363 is installed and Peach's process restarted, her `board_write` has no `set_release`, and
an agent applying the grant through an old client is refused locally (above). So:

1. Deploy the broker (migration 5 runs on the board DO's first touch).
2. Apply Peach's `release` field: Casper via the dashboard, or an admin/owner session on a client built from
   b1ba363 or later. Not from an rc.48 client.
3. Release (rc.49 or later) and restart for Peach to use `set_release` from MCP. AC1's MCP half and AC4's
   `board_grants` read are evidence only after 1-3. The DoD's "say which" should name both the deploy and the rc.

## Findings

- **Minor 1, scope of the grant on an open feature** (`store.ts:1534`). `setRelease` passes the feature's
  scope, so a `not_open_feature` rule with `release` (Helix's Picard, if AC4 gives it) can't move an open
  feature, and an `open_feature` rule can move only the feature its session is on. That is consistent with
  every other feature write and I'd keep it, but AC4's list for Helix/Athletic/Vitals should say so to
  Casper: the main PO slots features that aren't open; moving an open one is the session PO's or Casper's.
  No code change.
- **Minor 2, export forward-only** (`protocol/src/board-export.ts:178`). See above. Write it into the
  release notes ("board exports after this deploy import only into this broker or later"). No code change.

## Also checked, fine

- Refusal names the field and who may (`rules.ts:36`, AC2's test matches "the 'release' field").
- Event actor is the caller; feature goes last in the new release (`store.ts:1538-1540`), as before.
- `update set.release` on a feature still refused, now pointing at `set_release` (`store.ts:1363`): one op,
  one rule. Agreed with Luigi's choice.
- An `admin` rule can now hand out `release`, which no grant could before. That is the ruling (Casper,
  2026-11-21: slotting is the PO's), and admin is already trusted with every other field. Recorded in the
  ADR 0003 addendum.
