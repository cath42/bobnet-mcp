# BOB-111 review A: close (Mario, 2026-11-22)

- Toad (w_67fd8745) reviewed c87bd1a: signed off, 0 blockers, 0 majors, 3 minors. Review in
  architecture/reviews/bob111-review.md; ADR 0009 addendum (efa28a6).
- Mario's major after the sign-off: the supervisor forwarded to orchestratorOf(project). For helix that is Bob, the
  asker, so an idle Bob never woke and Q-282's case stayed unfixed. Toad ruled (c_6d88fb52, recorded d26bc6e): forward
  always to config.orchestrator (poe), and also to the project's orchestrator when it differs and isn't the asker.
  The board refused Mario's task create (Peach's), so the major has no task card. It is recorded here and in the
  review.
- Luigi (w_8b75c48b) landed 6e151ac: the major, minor 1 (a throwing row is audited and left untaken, and the alarm
  retries within 60 s) and minor 3 (the reply names the supervisor). Mario read the diff. Minor 2 (deploy skew) needs
  no code.
- Next: broker deploy from 6e151ac, rc.50 for the supervisor, Peach to accept.
