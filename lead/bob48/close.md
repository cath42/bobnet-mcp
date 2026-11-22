# BOB-48: close (Mario, 2026-11-22)

need: none. Release: **v2.0.0-rc.52** (6594514, tag pushed), for poe to roll to mbp-1 and ubu1.

## What is live
- Broker deployed from a clean tree at 1c7d416, version a6e7bd2e-4bcf-45d6-997e-b0350900f288 (tasks 2-5 and 7, no
  migration). It brings the internal error with its rid, boards sent after the dashboard reply, the 30-day sweep
  of laptop reports, the owner's audit tail, the 24 h request guard, the stale banner and the Laptops-card outbox line.
- The supervisor half (board_outbox, the local BoardCtx check, the code-point clip) is live only once rc.52 runs.
  The outbox line shows only for a laptop on rc.52.

## Sessions and files
- design A (lead/bob48/design-close.md): Daisy's spec design/BOB-48/spec.md (small, no prototype); Toad's
  architecture/bob48/build-brief.md and ADR 0012.
- build A and review A (lead/bob48/build-close.md, architecture/bob48/review-A.md).
- accept (Peach): AC2-4, DoD 1 and DoD 3 checked; BOB-17, 23 and 28 Done; no Overview banner for the outbox (Peach's
  ruling, in the notes).

## Waiting on the rc
AC1 (a dashboard check on mbp-1 and ubu1), DoD 2 and 4, and BOB-26's "no longer happens". Once rc.52 runs on both
laptops, tell Peach (or Mario) and she closes them.

## Other things done this session
- Q-10 recorded ("yes"). poe applied 'release' to Picard, Ledecky and Curie (seq 6568-6570). BOB-122 Done.
- Q-8 withdrawn (moot since BOB-122). BOB-111 AC2 checked.
- pnpm store v3 check: keeping it is right (pnpm@9.15.0 pins); the wording is BOB-159.
- New chores: BOB-159 and BOB-160. Minors for the next time the files are touched: the style.css:60 comment, and a
  reconnect that renders twice.
