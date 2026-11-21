# BOB-44 build C (Mario, w_fff6e03a, 2026-11-21)

Session `BOB-44 build C` (a-fixes-5). Input: review-a-fixes-4.md (M1 and minors 2, 3, 4, 6), Toad's
`architecture/reviews/2026-11-21-bob44-a-fixes-4.md` (M1, m2, m3 carry his fixes), ADR 0008 "Rulings, BOB-83
build" (ruling 5), the review B-fixes close (w_885a225e.md). mbp-1 runs rc.44 (since 15:45Z); ubu1 is on rc.41
until Casper's A-2 (parked; the broker deploy, BOB-69 AC 6 and BOB-71 AC 4 wait on it, not worked around).

## Order (one Luigi worktree, sequential; one commit per task)

| Worker | Tasks | Where | Why together |
|---|---|---|---|
| L1 | BOB-91, BOB-94 | policy.ts, bin.ts, upgrade.ts (archive pin) | the major; BOB-94 reworks the same guard, and its AC names upgrade.repo |
| L2 | BOB-92, BOB-93 | upgrade.ts | Toad's m2 and m3: the run's state machine (the waiting check, the `installing` row) |
| L3 | BOB-95 | upgrade.ts, supervisor drain | three robustness points (stderr, verify's deadline, the drain) |

All supervisor-only: no wire, no config schema (each item's last AC). After: review C (Toad), then rc.45 if the
fixes should be live (tag + push; poe hand-installs on mbp-1).

## Log

- 15:46Z L1 Luigi w_4b10ac3e on BOB-91, BOB-94.
- 15:5xZ poe m_c8cbbbfa: Casper's ruling, no feature-level manual tests (accept on review evidence); added to lead/CLAUDE.md step 6. No effect on build C: A-2 is a hand install, not a test.
- 15:5xZ poe m_daf73609 (Casper asks why an agent can't do A-2): answered m_aedb107a with the rc.41 facts. The rc.41
  guard covers the config folder (step 4 sources supervisor.env). Writes are limited to writeRoots and the sandbox.
  Escalations have nobody to answer them (rc.41 remote: no answers). The restart kills the worker in the unit's
  cgroup, so nothing can check or roll back. Recommended: Casper starts one Claude Code session on ubu1 outside the
  supervisor, TAG=v2.0.0-rc.44. rc42-ubu1-install.md no longer names poe@ubu1 (retired).
- 15:57Z BOB-91 landed fd534aa, BOB-94 3560b95 (Luigi w_4b10ac3e; supervisor 516). Read:
  - guardedFolders(config) = default <root>, upgrade.root and upgrade.repo.
  - verify: rev-parse refs/tags/<tag>^{commit} once, checked as a full SHA; merge-base, show and archive all on
    that SHA (the `verified` map). build refuses an unverified tag.
  - The guard: canonical() (realpath as far as the path exists, then lowercased); `named` is a whole-path regex on
    the expanded command (quotes dropped, ~/$HOME/${HOME}, // and /./ collapsed); words are resolved from cwd and
    cd/pushd, capped at 256.
  - For Toad: case folding always (also on ubu1's case-sensitive disk); a same-prefix sibling now passes (the old
    substring denied it); relative words resolved from the cwd even without a cd; globs, other variables, eval
    and $(…) not covered (the sandbox enforces).
- 15:57Z L2 Luigi w_e101d787 on BOB-92, BOB-93.
- 16:07Z BOB-92 landed d3ce4ac, BOB-93 b860909 (Luigi w_e101d787; supervisor 520). Read:
  - ask() refuses after the verify when `current` is no longer waiting (Toad's m2 as written).
  - The upgrades row now starts at `installing` (in run(), before any build), then goes waiting, then restarting
    (switchAndExit moves it, no longer inserts it), and ends ready, failed or installed (restart: no).
  - fail() ends the row for every failure, superseded included.
  - resume() reads every open row: installing -> failed "restarted while installing" plus discard(tag); waiting ->
    failed step wait ("stays installed, ask again"); restarting as before.
  - No migration: stage is TEXT.
  - For Toad:
    - the `waiting` stage goes beyond m3;
    - onExit no longer pokes while closing, so a shutdown never completes a waiting upgrade's switch (the next
      process fails the row);
    - rollback to rc.44 leaves installing/waiting rows unread (rc.44's resume reads only `restarting`), which is
      harmless.
- 16:07Z L3 Luigi w_e402f419 on BOB-95.
