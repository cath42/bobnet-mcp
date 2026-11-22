# BOB-48 design A: close (Mario, 2026-11-22)

need: none. Daisy's change is small (a banner and a line on an existing card), so there is no prototype and no Casper verdict.

## What landed
- Daisy (w_006f76ec), 457e00e: `design/BOB-48/spec.md`. Open question for Peach: should a stuck outbox also raise an
  Overview banner? The build follows AC3 as written (Laptops card only), and Peach decides on it at acceptance.
- Toad (w_0f12e210), f48444e: `architecture/bob48/build-brief.md` and ADR 0012 (`architecture/decisions/0012-laptop-reports-age-out.md`).
  One build of 7 tasks across BOB-26, 17, 23 and 28. It needs a broker deploy (tasks 2-5 and 7) and an rc with a restart (task 6).
- Already done on v2: orphan expiry at 24 h and stale marking at 3 min (6d4ef04, rc.34), and the broker's ctx check
  (frames.ts:431). None of AC4's three parts is done.
- For Peach: AC3 should name the supervisor's BoardCtx check, not the broker's.
- pnpm side check (BOB-126/123): keeping ~/Library/pnpm/store/v3 is right. health and choreography pin pnpm@9.15.0,
  whose store is v3. The unclear wording is captured as BOB-159.

## Next
Build A (Luigi), then Toad's review, the broker deploy, an rc for poe, and Peach's acceptance.
