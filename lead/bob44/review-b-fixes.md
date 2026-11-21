# BOB-44 review B-fixes (Mario, w_885a225e, 2026-11-21)

Session `BOB-44 review B-fixes`. Reviewed v2 aeb897b^..c334cd9 (BOB-97..101, the fix loop F1-F5 of review-b.md).

Reviewers:
- Toad (w_a1a7b0c7): `architecture/reviews/2026-11-21-bob44-build-b-fixes.md` (3ae193b), and ADR 0007 §14
  "As built, build B-fixes". 0 blockers, 0 majors, 0 minors. M1, m1-m5, m7 and the independent m4/m5 are closed;
  m6 stays BOB-102. Every departure in build-b-fixes.md's Log is accepted. Supervisor typecheck clean, 508 tests.
- No independent reviewer this time. The requester change (BOB-97) is ~60 lines. Toad reviews it, and BOB-101
  tests it with both ends real. I read the source diff myself and found nothing. Cuts I checked: the target's list
  drops whole workers only (`fitList`, with `truncated`), never part of a worker's `requests`, so `gone` comes
  only from a full view; workers past REMOTE_LIST_MAX are absent, not empty, so nothing is marked from them.

**Result: no majors, so rc.44 is tagged (rc44-notes.md).** Peach moves BOB-97..101 to Done.

Order: rc.44 adds no rule (Toad). rc.43 <-> rc.44 work in either order; below rc.43 the rc.43 rules stand
(requester first on install, the target first on rollback). A requester rolled back from rc.44 to rc.43 is safe.

Broker: nothing in the range touches the broker or protocol; Toad's deploy go from review B stands, held on A-2.
Backlog: BOB-102 (m6 code guard), BOB-103 (spike), BOB-104 (local answer_request on a failed resume).
