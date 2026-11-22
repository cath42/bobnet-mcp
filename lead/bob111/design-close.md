# BOB-111 design A: close (Mario, 2026-11-21)

- Toad (w_dbfc36db) landed 26c19a5: ADR 0009 (architecture/decisions/0009-answer-notices.md) and the build brief
  architecture/bob111/build-brief.md (7 tasks).
- Decisions: an answer writes a notices row in its own transaction; the broker drains it under fixed ids
  (m_board_<seq>), so it is sent once; the project's supervisor comes from laptop_supervisors.projects (several: the
  lead's laptop's); the supervisor forwards to its orchestrator, never spawns; the dashboard toast adds "waiting for X
  to come online", so no Daisy spec.
- BOB-127 is ubu1 config (helix has no `rebase:`), Casper's: no code, not folded in.
- Open: check helix's projects.lead is on mbp-1, or poe isn't told (in the live AC2 check).
- Next: build A, all 7 tasks in one session (Luigi).
