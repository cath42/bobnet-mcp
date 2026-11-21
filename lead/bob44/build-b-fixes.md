# BOB-44 build B-fixes (Mario, w_61a35103, 2026-11-21)

Session `BOB-44 build B-fixes`. Input: review-b.md (the fix-loop table F1-F5), the review B close (w_1dabfe34.md).
mbp-1 runs rc.43; ubu1 is on rc.41 until Casper's A-2 (parked in casper.md, not worked around: the broker deploy,
BOB-69 AC 6 and BOB-71 AC 4 wait on it).

## Order (one Luigi worktree, sequential; one commit per task)

| Worker | Tasks | Side | Why together |
|---|---|---|---|
| — | BOB-96 | dashboard | landed 511a1ce in review B; AC 1 checked |
| L1 | BOB-97 (F1) | requester | the major, alone |
| L2 | BOB-98, BOB-99 (F2, F3) | target | the `answer`/`request` ops and `fitRequest`: one auth/reply path |
| L3 | BOB-100, BOB-101 (F4, F5) | both, tests | F5's both-ends-real tests run over F1-F4 |

After: review B-fixes (Toad), then rc.44 (tag + push from rc.42 on; poe hand-installs on mbp-1 until `upgrade:`).
Rollback rule (rc43-notes.md): roll the target (ubu1) back first, never mbp-1 alone while ubu1 runs rc.43.

## Log

- 15:06Z L1 Luigi w_3163fee6 on BOB-97.
- 15:10Z BOB-97 landed aeb897b (Luigi w_3163fee6; supervisor 493). Read the diff: a full list finalises omitted
  open/orphaned copies `gone`; `pending_requests` bounded to a day; final copies pruned in reconcile; the `answer`
  reply into the copy; `copyView` drops `requests`. For Toad in review B-fixes, the departures (w_3163fee6.md):
  the race guard (only copies with `as_of` <= the list's `sent_at`, both requester clock, so no skew); the target's
  answered/expired still replaces `gone`; `decided_by` derived from the `user_decided` sent; the BOB-69 AC 2 test
  changed (it asserted open-until-settled).
- 15:13Z L2 Luigi w_d1b6c57d on BOB-98, BOB-99 (queued behind w_3163fee6 ending).
- 15:20Z BOB-98 landed 9bbf292, BOB-99 8261176 (Luigi w_d1b6c57d; supervisor 502). Read: the answer op refuses a
  non-v2 worker's request after the ownership and entry checks (no leak); a v: 2 spawn's `by` must be a BobNet name
  (after the grant check); fitRequest cuts answers, then stubs input; withheld advice by op; the answer op audits a
  withheld-but-applied answer and catches a resume failure after the answer applied (rethrows unless the orphan is
  now answered). For Toad: `resume_error` is an additive field on an ok reply (the requester shows `not_resumed`);
  fitRequest never cuts `tool`/`rule` (config-bounded). Backlog BOB-104 (captured): the local answer_request path
  still throws the bare error on the same resume failure.
- 15:22Z L3 Luigi w_8fe79e5e on BOB-100, BOB-101.
- 15:29Z BOB-100 landed 8bd1407, BOB-101 c334cd9 (Luigi w_8fe79e5e; supervisor 508). Read BOB-100: copyMade stays
  quiet when another copy has the spawn_req; `stop()` marks the worker stopping (cleared on exit) and the router
  settles an aborted request when not closing or that worker is stopping. For Toad: stop intent is set only by
  `Supervisor.stop()` (orchestrator, remote stop/kill, dashboard, reset), not the consult-answered path (no
  requests); "another copy" counts ended copies too. BOB-101: tests only, both ends real, incl. BOB-99's
  not_resumed path. **Build B-fixes is all on v2.**
- 15:31Z Peach w_fdda7d4d: BOB-96..101 moves and acceptance, BOB-104 triage (my earlier messages to Peach found no
  worker running).

## Close
- No rc in this session: review B-fixes (Toad) first, then rc.44 (the handoff's order). Nothing in the field needs
  the fixes before then: no cross-laptop v: 2 request can happen while ubu1 runs rc.41 (A-2). rc.44 vs rc.43 is
  compatible both ways (`gone` is requester-local; `resume_error` is additive; the `by` check refuses only names the
  snapshot couldn't carry), so the requester-first rule of rc.43 is the only order rule, and the rollback rule
  (the target first) stands.
- Next: review B-fixes, v2 aeb897b^..c334cd9 (Toad; departures in the log above), then rc.44, then build C
  (BOB-91..95).
