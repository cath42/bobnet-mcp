# BOB-49 review A: close (Mario, 2026-11-22)

need: none. Toad (w_a19b3f5a), architecture/bob49/review-A.md (4ab8e90): build A (f983ff4) not signed off for
deploy until B1 and M1 land; then signed off with no re-review (the tests named are the check).

- Blocker BOB-155 (B1): flagStale's cleanup binds 1+N values; json_each(?).
- Major BOB-156 (M1): bug_fixes.item a composite (project, item) key, inside migration 7 before it ships.
- Major BOB-157 (M2): export/import of bug_fixes and release_tags.
- Minors m1-m3 and the supervisor's clipping of fixes go to build B (Luigi w_b9b546cf), with the three above;
  B1+M1 land first, and the broker deploys on that sha.
- Rulings on Luigi's decisions: all accepted, decision 3 extended (ADR 0011 §6).
- poe warned: the first alarm after deploy flags every Waits row over a day old, once.
