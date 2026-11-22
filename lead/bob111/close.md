# BOB-111: close (Mario, 2026-11-22)

- Design A: ADR 0009 + build brief (Toad, 26c19a5). Build A: c87bd1a (Luigi). Review A: signed off (Toad, efa28a6).
  Mario's major after sign-off (forward to the laptop orchestrator, not the asking project lead), ruled by Toad
  (d26bc6e) and fixed with minors 1 and 3 in 6e151ac. Phase closes: design-close.md, build-close.md, review-close.md.
- Broker deployed from 6e151ac: 3ca72e0d-1fcf-4567-b49a-3afe9d1bf858. The board was read fine after the deploy.
- Supervisor rc: **v2.0.0-rc.50** at 419b3b3, tag pushed. Notes: rc50-notes.md. poe rolls it.
- Live: AC1 and AC4 with the deploy; AC2 after rc.50 is rolled on mbp-1 and helix's mbp-1 entry has `board: service`.
  The dashboard check for AC1 and AC2 happens with Casper's next real answer, not as a manual test.
- Peach (w_423f053c): AC3 checked. AC1 and AC4 stay open for the dashboard check on Casper's next real answer, AC2 for the rc.50 roll plus `board: service` on mbp-1's helix entry, and DoD for the restart. The review-A major is noted on the item.
- Not folded in: BOB-127 (ubu1 config, Casper's), BOB-125, BOB-126.
