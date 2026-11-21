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
