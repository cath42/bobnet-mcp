# rc.47 (v2.0.0-rc.47): BOB-119 board questions editable while open

## What's in it (since rc.46)
- BOB-119 3deb1e6: board_ask takes exactly one of ask, answer or edit. `edit {ref, set: {text?, context?, options?,
  holds?, holds_sessions?, needed_before?}, reason?}` edits an open question or action, by its asker or an admin.
  Option keys stay. An answered or closed one is refused. Each edit is a `question_edited` event. The broker side
  (op edit_question, dashboard "edited ×n") is deployed separately, from the same commit. On a broker without it,
  the client says "this broker can't edit yet".
- No protocol break: the op is additive. No schema migration.

## How each laptop gets it
- poe rolls it with `upgrade_supervisor {tag: "v2.0.0-rc.47"}` on mbp-1 and ubu1 (Mario stops at the tag and push).
- **Check**: `supervisor@<laptop>` reports 2.0.0-rc.47 in `list_peers`. A worker's board_ask schema shows `edit`.
