# Review: BOB-10 bugs (214304a), with the BOB-8 follow-ups in the same deploy (0b8a185)

Toad, 2026-11-15, for Mario. Luigi's handoff `w_3c382245`. Read: `product/requirements/bugs.md`,
the diffs of 214304a and 0b8a185 (`packages/broker/src/board/store.ts`, `public/app.js`,
`packages/client/src/board-tools.ts`, the tests), `packages/protocol/src/board.ts` against
v2.0.0-rc.32. Ran `test/board.test.ts` in broker (70 pass) and client (17 pass) at 214304a.

## Verdict

**Deploy-ready. Signed off (BOB-10 DoD 3, the store change).** No blocker, no major. No broker
migration: no schema change, the criterion is a row in `criteria`, the refusal is an existing code
(`conflict`) on an existing op, so old clients and the new broker still talk. One minor is a client
description fix worth putting in before the release (1); the rest can follow.

## The rule, as a ruling

Recorded in ADR 0001 §2 (amendment 2026-11-15, BOB-10). As built:

- A bug gets **"It no longer happens"** as ac 1 when it is created or captured with no ac, or when an
  item with no ac becomes a bug (`store.ts` create, `update`'s bug branch). An ac list it has is kept.
- **Done on a bug is refused (`conflict`) unless it has an ac and every ac is checked.** Checking
  takes evidence (an existing rule); the landed commit is that evidence. The store infers nothing
  from pushes, runs or CI: "the fix has landed" is the PO's claim, with the commit, not the
  supervisor's. A bug is never created Done.
- The gate is on the transition only. It covers every route to Done: `update`, and `close_session`'s
  moves, which go through `update` in the close's one transaction.
- **Closing without a fix is archive with a reason** (§2 already). No second path, no sixth status.
- **Import is not gated.** `export.ts` inserts rows as they are, so a Helix bug Done at 0 of 0 stays
  Done, and an open one with no ac can't be Done until the PO adds and checks a criterion. That is
  right: unticked is not unmet (migration.md), but a new Done is a new claim.

## Findings

1. **Minor, fix before the client release: close_session doesn't say a bug's Done needs its criteria
   checked first.** A close whose moves take a bug task to Done with "It no longer happens" open is
   refused whole: handoff, findings and the other moves roll back with it (one `transactionSync`,
   `board.ts:36`). That is the right outcome, and the message says why, but the lead finds out by
   failing the close. The close has no way to check a criterion, so the order is `board_write
   criteria check` (with the commit) and then `close_session`. Add that to close_session's
   description in `board-tools.ts`, in the same release as the other description changes.
2. **Minor, can follow: a Done item that becomes a bug gets an open criterion while Done.**
   `update {type: "bug"}` on a Done task with no ac inserts "It no longer happens", open, on a Done
   item. By the definition in the descriptions (a bug is found after Done) retyping a Done item is
   the wrong move: the bug is a new capture with `found_in`. Either refuse `type: "bug"` on a Done
   item with that hint, or skip the criterion when it is Done. I prefer the refusal; Luigi's call.
3. **Note, accepted: the gate is on the way in only.** Unchecking a Done bug's criterion, or adding an
   open one, leaves it Done. Features behave the same (Done at 0 of 6 on import). An unchecked "It no
   longer happens" means it is back; reopening is the PO's write, not the store's. No change.
4. **Note, accepted: a promoted bug keeps its criterion.** `promote` clears the bug fields and makes it
   an increment, and "It no longer happens" stays as the feature's ac 1. That is what the feature
   delivers; fine.
5. **Nit: a doc comment lost its function.** `acOf` was put between `item()`'s JSDoc ("An item of this
   project by any id it has had…") and `item()`, so that comment now sits on `acOf` and `item()` has
   none (`store.ts` near `private acOf`). Move it back.
6. **Minor, can follow (0b8a185): a refused queued capture can overwrite one Casper is typing.**
   `flushCaptures` runs on every welcome. If a queued capture is refused while the capture dialog is
   open, `openCapture` replaces the dialog's form, and the text being typed is gone (and `showModal`
   on an open dialog is a no-op or an `InvalidStateError`, depending on the browser). The reconnect is
   exactly when Casper is likely to be capturing. Fix: if `$("capture").open`, wait for its `close`
   before opening the refused one. Refusals of a queued capture are rare (it was valid when typed), so
   not a deploy blocker.

Checked and fine:

- **BOB-8 review finding 1 (major) is fixed.** A dashboard capture answered `unavailable`,
  `disconnected` or `timeout` now stays in `localStorage`; only the refusal codes take it off, and
  each comes back in the dialog as typed, with why. Resubmitting makes a new `capture_id`, which is
  right: the board stored nothing under the old one. The MCP `CaptureQueue` keeps `bad_frame` queued
  (an older broker) while the dashboard drops it (same origin as the broker, so it never goes as it
  is): different, for a reason, fine.
- **Findings 3 and 4 fixed.** A closed release shows selected and disabled; a backlog row carries only
  the triage fields it has, `casper_words` clipped at 280 (`WORDS_CLIP`), whole on `board_get`. The
  dashboard reads them with truthy checks (`app.js` triage row, `openCapture`), so omitted fields
  read as before. `ItemSummary`'s fields are optional in the protocol, so an omitted key is in shape.
- **A capture can't be born Done**: the capture schema has no `status` (`protocol/src/board.ts`
  capture), so the new refusal never reaches either capture queue.
- **The refused write rolls back.** `update {type: "bug", status: "Done"}` inserts the criterion,
  then refuses; the test shows no criterion is left (one transaction).

## The client release

The client's change is the four tool descriptions (`board-tools.ts`). Since v2.0.0-rc.32,
`packages/client/src` has only that, `packages/protocol/src` only type-level changes (`ItemSummary`'s
optional triage fields, `created_at`, a comment on `Progress`), `packages/supervisor/src` nothing.
**Nothing else must ship with it.** It is text for the model: no frame, no schema, no ordering
constraint. Deploy the broker first anyway, so agents aren't told Done is refused by a broker that
still allows it (harmless if not). Put finding 1's sentence in before the release is cut.

## Open

- AC 3 (blocks use on "Waits on you") is only in the service until BOB-5 ships the tab; Peach's to
  hold, not mine.
- Whether a capture from a feature screen presets `found_in` (Luigi's open question 1) is Daisy's.
