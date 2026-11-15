# Review: 8a2fba3, `run_remote` (BOB-4 AC 7)

Toad, 2026-11-15, for Mario. Luigi's handoff: `w_d1122105.md`. This builds option (b) from consult
c_af36fbd6. ADR 0001 §9 now has the matching amendment.

## Verdict: signed off, with one minor and two nits. Nothing blocks.

**Rollout: deploy the broker first, then rc.35.** It's a new supervisor op, and the §9 (BOB-27) rule
is that the broker that takes a new op deploys before the supervisor that sends it. If rc.35 goes
first, nothing gets stuck: each `run_remote` is dropped, and those runs keep a null link. AC 7 can
only be checked on a run that starts after both steps.

## Against the consult's constraints

| Constraint | Where | OK |
|---|---|---|
| A supervisor-only op, in `SUPERVISOR_OPS`, made through `supervisorOp` | `board.ts:421`, `store.ts:1721` | yes (test: the owner is `forbidden`) |
| Only for the ctx's own worker | `store.ts:1722` | yes (test: `w_other` is `forbidden`) |
| Sets the link once, never overwrites it, never makes a run | `store.ts:1724`, `UPDATE … AND remote_url IS NULL RETURNING pk` | yes (test: no row before `run_start`; a second link is ignored) |
| An event only when the link changes | `store.ts:1726-1727` | yes, `run_remote` with `remote_url: null → url` |
| A safe URL | `board.ts:364`, `url().startsWith("https://").max(500)` | yes (test: http, `javascript:` and null are refused) |
| Additive: an old client and the new broker still work together | new union member; `run_start.remote_url` stays optional | yes |
| Can't be undone from the dashboard | `undo` takes only questions, `set_release` and `close_release` (`store.ts:1555`) | yes |
| Survives export and import | `runs.remote_url` is exported (`export.ts:259, 598`); the event is a plain event row | yes |

## The three checks Mario asked for

**(1) A no-op answer `{seq: 0}` counts as delivered.** `runRemote` returns `seq: 0` and records no
event. The transaction wrapper then answers `ok` with `seq: lastSeq()` (`store.ts:645`), so the
reply is a normal `ok` with no error. `flushBoardReports` removes the row after any `ok`
(`supervisor.ts:1681, 1694`). Nothing looks at `seq`. So a replay, a second link, or a link for a run
that was never made is delivered once and never retried.

**(2) Today's broker (no `run_remote`) answers as final, and the row is dropped.** rc.35's own
`BoardOp` accepts the op, so the local `bad_row` check passes and the row is sent. On the old broker,
`board_op` is a known frame type, but `ClientFrame.safeParse` fails on the unknown discriminator.
The old broker reads the `rid` before it parses (`broker.ts:133`) and answers
`{t:"error", rid, code:"bad_frame"}` (`broker.ts:145, 150`). `bad_frame` is in
`FINAL_BOARD_ERRORS` (`supervisor.ts:113`), so the row is logged, audited as `board:refused` and
removed. Nothing waits behind it. That's the BOB-27 rule working as it should. The cost is one
`board:refused` line per worker spawned with Remote Control until the deploy, plus a null link on
those runs.

**(3) Order and replay.** `boardReport(run_start)` is queued at `supervisor.ts:992`, before
`run.start()`. `onRemoteControl` can only fire once the run has started, so `run_remote` always
comes after its `run_start` in the same `board_op` outbox. `flushOutbox` runs one flush at a time
(`flushing`/`flushAgain`, `supervisor.ts:1627-1647`). Each flush sends rows in order and waits for
each `ok`, so the broker never sees `run_remote` before the `run_start` ahead of it. The edge cases:
- `run_start` is dropped as final (for example, its session is gone): `run_remote` is then a no-op
  `ok`. The link is lost, but there's no run row to put it on anyway.
- `run_start` waits on `unavailable`: `run_remote` waits behind it.
- Replay after a restart: rows are kept in SQLite and deleted only after an `ok`. Sending both
  again does no harm, because `run_start` is idempotent by run id and `run_remote` by
  (`project`, `id`) with set-once.
- A resume is a new worker id, so it gets its own `run_start` and link.

The tests cover this order with the board away and then back
(`board-service.test.ts`: `session_join, run_start, run_remote, run_end`).

## Findings

**Minor 1 (from before this commit, and I missed it in the BOB-4 review): `run_start`'s optional
`remote_url` accepts `javascript:`.** `board.ts:354` is `z.string().url()`, and zod's `url()`
accepts `javascript:alert(1)` (I checked). The dashboard puts a run's `remote_url` straight into
`href` (`app.js:625`, the session card's "Open in Claude" link). Only a pinned supervisor can send
it, and no supervisor sends it now (the test checks that `run_start` has no `remote_url`). Still,
the dashboard holds the owner's token, so the broker should never store a link it wouldn't render.
In my BOB-4 review I called `url()` enough; it isn't. **Fix:** give `run_start.remote_url` the same
`.startsWith("https://")` check. It's compatible with every supervisor in the field, because none
sends the field. Luigi, next time the protocol is touched. It needs no ordering.

**Nit 1: two different checks on the same link.** The snapshot checks
`remote_url: url().startsWith("https://claude.ai/").max(200)` (`frames.ts:122`), and `run_remote`
checks `https://` and max 500. Remote Control links are claude.ai links, so the board could use the
snapshot's prefix. `https://` is where the safety line is, so I'm not asking for the change now. If
the check is ever tightened, an old supervisor's rows would come back `invalid` and be dropped as
final, and nothing would get stuck.

**Nit 2:** `onRemoteControl` calls `this.worker(w.id)`, which throws if the row is gone, and that
would skip `this.report()`. The row can't be swept seconds after its start, so this is theoretical.
Use `this.store.worker(w.id)` and return early if it's missing, if that code is touched again.

## Luigi's open question

He asked whether the ADR's wording differs from what he built. It doesn't: https only, idempotent by
(`project`, `id`), set once. The `claude.ai/` prefix is nit 1 and isn't required.
