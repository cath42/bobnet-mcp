# BOB-119: board questions editable while open (Mario)

Casper, 2026-11-21 21:37, via Bob and poe: "File a request to poe that bobnet should allow board questions to be edited".
Case: helix A-24 was asked with only needed_before and no holds, so it didn't show as blocking, and fixing that took
a second question.

## Design (advisory: Toad c_fdd797dd, Daisy c_e25d0fd7)

- **Protocol**: a new board op `edit_question {project, ref, set: {text?, context?, options?, holds?, holds_sessions?,
  needed_before?}, reason?}` in `packages/protocol/src/board.ts`. It's additive and doesn't go through board_write.
- **Broker store**: the op is allowed if the caller is the question's asker or has admin on the project; anyone else
  gets `forbidden`. The open check is part of the UPDATE (`WHERE` open, as in BOB-105). An answer that lands
  mid-edit wins, and the edit gets `not_open`. Changed holds, holds_sessions or needed_before re-run the ask-time
  validation and re-derive Waits-on in the same transaction. A `question_edited` event carries before/after of the
  changed fields only, plus the actor and reason, written in the same transaction as the update. Option keys stay
  stable: an edit may change labels and add options; removing or renaming a key is `invalid`. If the events kind
  is a closed CHECK, that's a migration and needs a line from Toad.
- **Client**: board_ask takes exactly one of ask, answer or edit. On an old broker the unknown op comes back as
  "this broker can't edit yet". No fallback. The MCP tool changes, so a supervisor rc follows.
- **Dashboard** (one render function, used on Waits on you and the item page): "edited ×n" is muted text, nowrap,
  on the meta row. It isn't a badge. A `<details>` with that summary (tap target ≥ 44px) lists the edits newest
  first: "<time> · <who> · <fields>", the reason on its own line, and the old text in `<del>` muted. It's closed
  by default; on the item page it opens by default when n ≤ 2. If the question changes while Casper has its
  answer form open with a draft, the draft is kept and a note in var(--warn) says "Question edited since you
  opened this", with the details open. An untouched form just re-renders. The answer is still accepted, since
  option keys are stable.

## Order
1. Peach: promote BOB-119, criteria, Ready.
2. Luigi: build (one session), land.
3. Mario: review the diff on origin/v2. Deploy the broker (lead's standing go, window from poe). Cut rc.47 and
   push the tag. poe rolls the laptops.
4. Peach: accept against the criteria.
