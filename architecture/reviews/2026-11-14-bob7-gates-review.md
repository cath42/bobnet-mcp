# Review: BOB-7, Casper's gates on the dashboard (5c3086c, 01cddfd)

Toad, 2026-11-14. Luigi's two lands on v2, 461a875..01cddfd (handoff w_9ff16006), read on origin/v2
against ADR 0001 §5 (the gates and undo), §8 (operations over the socket) and §12 (a write's `key`).

**Verdict: signed off, and deploy-ready.** There's no broker or board migration (`schema.ts` is
untouched) and no wire change: `packages/protocol` changed only a comment, and the frames and op
shapes are the same as before. The dashboard uses only frames and ops the broker already has. Two
minor findings and three notes. None of them blocks the deploy, and both minors can come in a
follow-up.

| Commit | What | Verdict |
|---|---|---|
| 5c3086c | SUMMARY's progress: a feature's own `ac` plus its tasks' `ac`; the gates' write-rule tests | Signed off, nothing to fix |
| 01cddfd | Dashboard: the service roadmap, gate writes with keys, Undo | Signed off; findings 1, 2 (minor) |

## 5c3086c: the progress query

`store.ts` SUMMARY. `ac_total` and `ac_checked` are now the item's own `ac` count for every kind,
plus the `ac` of its non-archived tasks when the item is a feature. Each of the two counts is one
indexed subquery: `criteria (item, section, ord)` is UNIQUE, and `items_parent` covers the task
join. `dod` is still left out. Every reader goes through SUMMARY: `list` (l. 320), `get` (l. 345)
and `overview` (l. 541, 545). So the list, the record and the overview can't disagree about a
feature's progress. `Progress` keeps its shape and only its values change, so an older client reads
it the same way. The MCP `board_list` counts for BobNet's features stop showing 0/0. The new test
covers a feature with tasks and its own criteria, a feature with no tasks, and that `dod` isn't
counted, through both `list` and `get`.

The write-rule tests are ones I'd have asked for:
- every gate is recorded as the owner's;
- `undo` refuses `order_releases` and the inverse order puts it back (ADR 0001 §5, as built);
- the PO's `update` of a feature's release is refused and pointed at `set_release`;
- a promoted feature is in no release;
- `close_release` is the owner's only;
- `record_answer` is refused to a builder.

## 01cddfd: the dashboard

**Reads over the owner's socket (§8).** The dashboard sends `board_op` with no `as` and no `ctx`, as
`boardCaller` requires for the owner. Replies are matched by `rid` in `sentOps`. `ok` resolves with
`f.result` and `error` rejects with the board's message. A frame the broker refuses before it gets
to the board still comes back with its rid (`broker.ts` l. 132), so no promise is left hanging.
When the socket closes, every pending op is rejected. `listAll` follows `cursor` for both
`of: "releases"` and `of: "features"`. A features list without `release` returns every feature not
archived (`list` adds a release filter only when `release` is given), which is what the "Not in a release" section needs. The releases come back in
`ord IS NULL, ord, pk` order, the same order `order_releases` writes.

**Refetch on board_changed.** A `board_changed` for a project the dashboard doesn't know reloads
`projects`, and that reloads every roadmap already read. A change to a known project reloads that
project if it has been read. `loading`/`again` merge the changes that arrive during a read into one
more read, so a burst of writes costs at most two reads per project. On `welcome`, `loadProjects`
reads everything again, which covers any `board_changed` missed while the socket was down. That's
correct.

**Gate writes and their Undo (§5).**
- Feature → release: `set_release`. Its Undo is `undo` with the reply's `seq`, which the store
  takes back unless the feature has moved since (`movedSince`).
- Close release: `close_release` with one move per feature not Done. The client's list excludes
  archived features, as the store does, so the `left` check passes. Its Undo is `undo` with the
  reply's seq, which is the release event's: the one `undoClose` expects.
- Release Earlier/Later: `order_releases` with every release, closed ones included, as
  `orderReleases` requires. Its Undo is the order from before, sent again as `order_releases`.
  `undo` would refuse it, and the store's comment and the new test say so. This matches §5 as built.
- Every write and every Undo carries its own `crypto.randomUUID()` key, 36 characters against a
  40-character limit. An Undo is a separate write, so it gets a separate key, which is right.
- `ownerOnly` enforces each gate in the store. The dashboard only offers them.

### Finding 1 (minor): a `set_release` that writes nothing still offers Undo, and its Undo fails

`setRelease` returns `seq: 0` when the feature is already in that release (`store.ts`, "return
{ ref, seq: 0 }"). `moveFeature` toasts "Moved …" anyway, with an Undo that sends
`{ op: "undo", seq: 0 }`. Zod refuses that frame (`seq` must be positive), so Casper gets a schema
message in red. `onchange` never sends the release a feature is already in, so this happens only
when the view is stale: another tab, or the retry in finding 2. **Fix:** in `gate`, when
`res.seq === 0`, toast without Undo, for example "F-12 is in R3 already". `order_releases` can also
return `seq: 0` (nothing changed), but its Undo doesn't use the seq.

### Finding 2 (minor): the key doesn't yet make a dashboard write "sent once"

ADR 0001 §12's amendment says the dashboard makes a key once per write. That holds, but the point
of the key is that a write is resent with the same key after a drop. Here, a write still in flight
when the socket closes is rejected with "The connection dropped; try again in a moment", and
Casper's retry is a new click with a new key. If the first send had committed, the retry is a
second write:
- `order_releases`: does nothing, since the order is the same.
- `set_release`: returns `seq: 0`, which leads to finding 1.
- `close_release`: refused, "R3 is closed already", in red, though his close went through.
- `undo`: refused, "undone already".

Nothing is written twice. But two of these show Casper a refusal for a change that worked. The
reconnect refetch (`welcome` → `loadProjects`) does show where things stand. **Fix**, either of:
(a) keep each pending write's `{op, key}` and resend it with the same key after `welcome`, which is
what the ADR means, and which works because `op_keys` keeps a key 24 hours; or (b) at least change
the drop message to "it may have gone through; the roadmap shows where it stands". (a) is the
better fix and is small, about ten lines in `boardOp` and the `close` handler.

### Notes (no change needed)

1. **Undo of a release move is optimistic.** It sends the order the view had. If a release was
   created after that, `orderReleases` refuses ("An order names every release once: …") and the
   reason shows in red, which is fine. Releases with no `ord` get one from any order write,
   including the Undo. The order shown doesn't change.
2. **Two reads after each of Casper's own writes.** `gate` calls `loadRoadmap`, and the
   `board_changed` that follows queues a second read through `again`. This is cheap at
   BobNet's and Helix's size. If it ever matters, `gate` can skip its own read and wait for
   `board_changed`.
3. **The dashboard writes through the owner's identity alone** (Cloudflare Access → `kind: "owner"`).
   That's the only identity `ownerOnly` accepts, so a laptop or an agent can't send any of these
   writes. The broker.test addition checks this for the allow/deny action.

## Deploy

One broker deploy, on Casper's go. It needs no migration, no protocol release and no client or
supervisor release, because nothing outside `packages/broker` changed except a comment. An old
dashboard tab keeps working: it ignores the `board_changed` frames, which were already being sent.
