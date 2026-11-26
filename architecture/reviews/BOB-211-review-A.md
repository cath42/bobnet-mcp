# BOB-211 build A — architecture review (Toad, 2026-11-26)

Diff: `git diff 019cb8b a818b81` (app.js, style.css, UI tests, shots). Light review for the broker deploy.

**Deploy-safe: yes.** 0 blockers, 0 majors, 2 minors.

## Checks
- **Protocol / store drift: none.** No change under `packages/protocol`, the broker's worker code or schema; page only.
- **Reads:** the session panel uses `loadFeature` as the feature page does (one `get` by ref, then a `get` with
  `session` per session of that feature — ops the broker already serves, ADR 0014 §get-with-session).
  Read only when a panel opens, cached per feature in `feats`, re-read on `board_changed`. No read per bar or
  per day: bars and tips come from the usage reply's `top` already in hand.
- **Tokens only:** no `$`, cost, price or USD in the added page code or CSS.
- **BOB-172 test change is right.** ADR 0014 ("Running workers are added by the dashboard") has the page add
  each running worker to today's point by its declared model; BOB-211 §3 additionally names its declared
  session in today's `top`, marked `live`. The expected `top` now holding `BOB-1 build 2` with the worker's
  raw/weighted is exactly that; a worker with no declared session stays in the rest; an ended worker is the
  board's (no double count) — unchanged.

## Minors
1. The per-session `get`s in `loadFeature` are N per feature (one per session), inherited from the feature
   page. Fine at today's sizes; if a feature grows many sessions, the panel could fetch just the opened
   session. Not for this deploy.
2. "Whole session" in the tip before the feature is read sums the period's `top` entries, which can undercount a
   session that fell out of a day's top six (Luigi notes it). Acceptable as a pre-read figure; it is replaced
   by the runs' sum once read.
