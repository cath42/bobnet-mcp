# BOB-44 review B: independent code review of build B (2026-11-21)

Reviewer: a fresh reviewer outside the team (Mario's subagent, no prior context), read-only, on
`git diff b289bfe^..b2bc9af` (BOB-66..71, 75; rc.43) against ADR 0007 §4, §9, §14. `pnpm -r typecheck` clean;
supervisor 482, protocol 135 green. Scratch probes (/tmp/rvb/probe.test.ts, the requests.test.ts harness with both
supervisors real) verified m1, m2, m3. **0 blockers, 1 major, 9 minors.** Line numbers are v2 at b2bc9af.

## Major

**M1. A requester below rc.43 leaves a v: 2 worker's requests with no answerer, and the documented rollback makes
that state.** `supervisor.ts:2927` (`announce` -> `v2Event`), `:1268` (`pending()`), `mcp.ts` `remoteAnswerer`.
An rc.43 target sends a v: 2 worker's requests only to its spawner, hides them from its own `pending_requests` and
refuses them in `answer_request`; an rc.42 requester ignores `request`/`settled`. Only the dashboard or the timeout
reaches them. rc43-notes says requester first, but its rollback line (`upgrade_supervisor` to rc.42 on mbp-1) makes
exactly this state with ubu1 on rc.43. Fix: the target routes to the spawner only when the peer list shows it at
rc.43 or later, else announces locally; at least, the rollback note says the target first.

## Minors

1. **A long `by` blanks the target's dashboard report once BOB-71's broker is deployed** (verified:
   `WorkerSnapshot.safeParse` fails "remote_by <=40"). `by` is `z.string().min(1)` (`protocol/src/remote.ts:46`),
   stored and sent unclipped as `remote_by` (`supervisor.ts:3291`); `frames.ts:125` caps it at 40; a bad
   `ReportFrame` is refused whole (`broker.ts:145`). Fix: `by` follows the segment rule, and/or clip in `snapshot()`.
2. **A lost `settled` is never repaired** (verified: the target's row `answered`, the copy `open` after `reconcile()`
   and `list_workers`; `pending_requests` keeps it). `list` returns only open and orphaned requests (`:1946`);
   `copyFromReply` (`:1405`) never settles a copy missing from it. Fix: settle-unknown the absent ones, or ask the
   `request` op; use the `answer` reply's `state` too.
3. **A copy keeps a stale `requests` list** (verified: after `answer_request`, `copyRow` still shows `open`).
   `copyView` (`:1446`) stores the whole view; `copyRow` spreads it into `list_workers`/`worker_status`. Fix: strip
   `requests` before storing.
4. **A stop racing a shutdown leaves the request resumable** (`router.ts:199`): an abort after `closing` is set leaves
   it open; the next start orphans it and answering resumes a worker that was stopped. Fix: record the stop intent
   per worker.
5. **Audit mislabels in the `answer` op** (`supervisor.ts:1236`): a withheld reply writes `remote:withheld` and no
   `remote:answer`, though the answer was applied (a sender-supplied id can make the error text secret-shaped); an
   orphan's resume `spawn()` throwing after `router.answer` settled gives `ok:false` and `remote:refused`, yet the
   request is answered and nothing resumes. Fix: audit what happened; catch the resume failure apart.
6. **`fitRequest` (`:271`) never cuts `answers`, `tool` or `rule`**: a large answer leaves the reply over 16 KiB,
   dropped `too_long`; `request_detail` times out. Fix: cut `answers`, or drop `input`.
7. **Two answerers for v-less spawns**: `ownRequest` (`:1984`) checks only `spawned_by`. Fix: require `isV2(w)`.
8. **A spawn whose worker ends before adoption is never adopted**: its `exit` is dropped at `:1303`; the tool's "you
   are told when its worker is found" isn't kept. The ADR says this case is left.
9. **Small:** request copies with no copy of their worker show project "?"; nothing deletes `remote_asks` rows.

## Checked and fine
- Auth on `request`/`answer`: `remote` membership, then ownership (unknown and another sender's request get the same
  error and audit: no existence leak), then the entry against the config, then the state. `list` attaches only the
  sender's own workers' requests.
- Human tier enforced on the target by `router.answer`; `user_decided` is the caller's assertion, as the ADR accepts.
- One answerer: a lead's tools refuse remote ids; the target hides v: 2 requests from `pending()` and refuses them in
  `answer_request`; Casper's dashboard answer still settles them and reaches the requester as `settled`.
- Wire: the `answer` reply (`request`, `worker_id`, `state`, `decision`, `resumed`), the `request` reply, `list`'s
  `requests[]`, and the `request`/`settled`/`resumed` events against `RemoteEvent`/`RemoteReply`: no other mismatch.
- Secrets: every new event and reply goes through `withholdBody`; `preview` through `findSecret`.
- Store: `settleRequest`/`markOrphaned` guard on state, the hook fires only on a real change; start events queue until
  registration; the upgrade exit goes through `shutdown()`; migrations additive; `adoptRemoteSent` can't hit the
  `message_id` UNIQUE.
- Unacked spawns: `mayHaveLeft` matches the client's error texts; `reconcileOn` coalesces.
- Dashboard: `h()` builds text nodes and `setAttribute`, no innerHTML; `remote_from` max(65) fits; an old broker strips
  the new fields.
