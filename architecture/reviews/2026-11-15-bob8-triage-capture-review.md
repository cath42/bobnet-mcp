# Review: BOB-8 (capture and triage) and BOB-2 #10 (5c5f355)

Toad, 2026-11-15. Luigi's land on v2 after 1cf25fb (handoff w_6a83777e), read on origin/v2 at
5c5f355 against ADR 0001 §5 (gates and undo), §8 (ops over the socket) and §12 (capture never waits;
a write's `key`).

**Verdict: deploy-ready, and signed off with one major and three minors.** Nothing blocks the
deploy. There's no migration: `schema.ts` is untouched, and in `store.ts` only SUMMARY and
`summary()` changed. The wire change is additive and safe for rc.32 clients and supervisors (see
below). Finding 1 should be fixed before Peach accepts BOB-8, because it loses Casper's words in
exactly the case §12 exists for. It isn't a regression, though: the dashboard couldn't capture
before, and MCP capture is unaffected. The minors can come in a follow-up.

| Part | Verdict |
|---|---|
| ItemSummary fields (protocol) and SUMMARY | Signed off; finding 4 (minor) on row size |
| Dashboard capture | Finding 1 (major, not deploy-blocking) |
| Triage gate (backlog item's release) | Signed off; findings 2 and 3 (minor) |
| Helix-sized scale test | Sound for BOB-2 #10; one suggestion |

## The wire change: additive, safe for rc.32

- `ItemSummary` gains `created_at: string` and five optional triage fields
  (`protocol/src/board.ts` l. 514-520). Nothing is renamed and nothing is removed.
- A reply's result crosses as `result: unknown` (`frames.ts` l. 444). Neither the client nor the
  supervisor parses summaries with a schema:
  - the MCP server passes the JSON through (`client/src/server.ts` l. 287), so an rc.32 agent just
    sees more keys;
  - the supervisor doesn't read `list` rows at all.
  So rc.32 talks to the new broker unchanged, and no client or supervisor release is needed.
- A new client against an old broker: `created_at` is typed as required but an old broker doesn't
  send it. The only reader is the dashboard, which ships with the broker, so this can't happen today.
  If a laptop-side reader ever uses it, it should treat it as optional until a release says otherwise.
- `ItemRecord` already declared the same fields as required, which narrows the optional ones
  consistently. `itemRecord()` spreads the summary first and then sets each field from the row
  (`store.ts` l. 347-), so `get` returns what it did before.
- The query adds `parent_hint_ref`: one more correlated lookup on `item_refs (item, is_primary)`, the
  same shape and cost as `ref` and `parent_ref` beside it. The triage fields are put on backlog rows
  only, as the comment says.

## The dashboard's writes (ADR 0001)

What is right:
- **Keys.** Each write carries a key made once (`boardOp(op, true)`).
- **A write cut off by a drop** is kept and resent under its key after the welcome (BOB-7's
  finding 2, now fixed).
- **Captures** carry a `capture_id` made in the browser. The board stores a capture once
  (`store.ts` l. 1278), so two tabs flushing the same `bobnet.captures` queue, or a flush racing a
  resend, still store it once and return the same id.
- **The gate on a backlog item's release** is `update {release}` from the owner's socket. It passes
  `rules.require(… "triage" …)` as the owner, a closed release is refused by `openRelease`, and the
  event is Casper's.
- **No-op writes.** When nothing was written (seq 0), there is no Undo.
- **Refusals** show the board's message in red.
- Using `update`, not a new op, is right. ADR 0001 open question 3 made a backlog item's release a
  triage field that the PO and Casper share, so it isn't release scope and doesn't need
  `set_release`.

### Finding 1 (major, not deploy-blocking): a capture the board can't take right now is lost

`capture()` queues only when the socket is down. `flushCaptures()` keeps an op only when the socket
dropped. Every error frame counts as a refusal. But the broker answers `unavailable` while the socket
is up whenever it can't reach the board's DO (`broker.ts` l. 376: "The board can't be reached …;
retry"). Then:
- **A fresh capture** gets a red toast, and the text Casper typed is gone: the dialog is closed and
  nothing kept it.
- **A queued capture** sent at the welcome is removed from `localStorage` with "was refused". A
  welcome just after a deploy, while the DO is cold or erroring, is when that is most likely.

ADR 0001 §12 and README C4 say a capture never waits and is never lost, and that Casper's captures
queue in `localStorage` "the same way" as the laptop's.

**Fix:**
- Carry the frame's `code` on the rejected Error (`app.js`, the `error` case, l. 1263).
- In `capture()` and `flushCaptures()`, keep the op in the queue on `unavailable`, `timeout` or "not
  connected". Only `invalid`, `forbidden` and `conflict` take it off.
- On a real refusal, keep Casper's text recoverable: reopen the dialog with it, or keep it in the
  queue marked refused until he dismisses it.
- Add one UI test: an `unavailable` reply keeps the capture queued.

### Finding 2 (minor, accept for now): the release Undo on Triage is a blind inverse

Undo sends `update {release: before}` with no check that the item is still where Casper put it. If
the PO re-triages it within the toast's life, Undo overwrites the PO's move. For a feature, this is
guarded: `set_release`'s undo is refused once the feature has moved (`movedSince`). The window is
seconds, and the event log shows both writes, so I'd accept it.

If it matters later, the fix is the board's `undo` taking an `update` event whose only change is
`release`, with the same `movedSince` check. That is a service change, not a dashboard one.

### Finding 3 (minor): an item in a closed release shows the wrong release under Edit

`close_release` moves only features (`store.ts` l. 1137-), so a backlog item can stay in a closed
release. Triage's filter lists that release, but the select's options are only the open releases
plus No release. No option matches, so the browser shows the first open release as selected, which
is wrong, and picking it fires no change.

**Fix:** add the item's current release as a selected, disabled option ("R1 · closed").

### Finding 4 (minor, latent): a backlog row carries all of Casper's words, and nulls

- **Size.** `casper_words` is up to 16 KB (protocol `text`), and the dashboard's capture puts the
  whole typed text in it. Every backlog row now carries it in full, so a page of 100 rows can reach
  about 1.6 MB. That is far more than a phone wants for a list, and more than this broker holds any
  inbound frame to (64 KB).
- **Tokens.** Every MCP `board_list` pays for it too, pretty-printed (`server.ts` l. 287), along
  with five keys per backlog row that are null for most items, and `created_at` on every task row.

**Fix:** in `summary()`:
- clip `casper_words` to about 280 characters, with an ellipsis (`get` keeps it whole);
- omit the triage keys when they are null or false.
Both are allowed by the optional types, and the dashboard already reads a missing key as falsy, so
nothing on the wire changes.

## BOB-2 #10: the scale test

`test/board-scale.test.ts` imports a Helix-sized board through the real `importBoard`, so it has the
real schema and indexes: 3 releases, 29 features, 698 tasks with 3 criteria each, and 103 backlog
items. It then checks the structure the AC asks for:
- feature rows have counts and no `criteria`;
- the 698 tasks add up across the feature counts;
- each release has its backlog counts;
- the backlog reads in 2 pages.

**The timing measure is sound for what it claims.** workerd's clock only moves at I/O, and the DO RPC
is I/O to the caller, so the caller's wall time includes the DO's SQLite work. The non-zero readings
(1-3 ms alone, 3-14 ms under the land's load) confirm this. Slowest of three is a fair statistic.

Two limits worth knowing; neither is a defect:
- **250 ms is 20-100× headroom.** At this size even a full scan is fast, so the bound catches only a
  catastrophe. The structural assertions are the real regression guard.
- **"Fast on a phone" depends more on bytes than on DO milliseconds.**

Suggestion (not required for acceptance): also assert the reply sizes, which are deterministic:
- the 29-feature list under a few KB;
- a backlog page under a set size.
That would also have caught finding 4.

## Deploy

Ready from 5c5f355 (or from 1cf25fb for BOB-7 alone), in any order with respect to laptops:
- no migration;
- no client or supervisor release;
- rc.32 reads the extra fields as unknown keys.
