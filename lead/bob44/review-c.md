# BOB-44 review C (Mario, w_d95500c4, 2026-11-21)

Session `BOB-44 review C`. Reviews v2 47b422c..ec3fb35 (build C: BOB-91 fd534aa, BOB-94 3560b95, BOB-92 d3ce4ac,
BOB-93 b860909, BOB-95 ec3fb35; supervisor-only). Input: build-c.md and its close (w_fff6e03a.md).

Reviewers:
- Toad (w_8b57427a): the departures in build-c.md's Log, ADR 0008, the rc.45 order.
- An independent reviewer (Mario's subagent, fresh context, read-only): the guard (BOB-94/91) and the upgrade code is
  security-relevant (it decides what the supervisor runs and what workers may write), so it gets a second read.

**Result: 1 major (independent M1, confirmed by Mario), so no rc.45 in this session.** Its fix is a task of BOB-44
(build D); rc.45 follows its review. Toad: 0 blockers, 0 majors, 2 minors, every departure accepted, rc.45 adds no
order rule. ubu1 stays on rc.41 until Casper's A-2; the broker deploy, BOB-69 AC 6 and BOB-71 AC 4 wait on it.

## Findings, merged
- Toad: `architecture/reviews/2026-11-21-bob44-build-c.md` (a207ce4), and ADR 0008 "As built, build C" (the drain
  hold; a board join with no worker behind it is accepted and recorded, which also rules the independent m5).
- Independent: `review-c-independent.md`.

### Major (task of BOB-44, build D)
- **M1 (independent): an upgrade asked during startup is failed by resume(), then restarts anyway.** start() awaits
  every role's registration (supervisor.ts:615-631) before upgrades.resume() (:634); onPush isn't gated on
  `registered`. resume() takes the new ask's `installing` row for the dead process's: fails it, discards the live
  `.<tag>.partial`; run() goes on and moveUpgrade/endUpgrade (store.ts:650, :668, no stage guard) reopen the ended
  row to waiting, restarting, and the process switches and exits. The requester is told `failed` while the laptop
  restarts: the false report BOB-93 was meant to end.
  Fix: resume() before the first registration (its emits queue in the outbox until `registered`), or ask() refuses
  until resumed; moveUpgrade/endUpgrade touch only open rows. Test: an ask during start() is neither failed nor
  discarded; an ended row isn't reopened.
  Why major, against Toad's go: it is a defect in BOB-93 itself, small to fix, and nothing in the field needs rc.45
  first (no laptop has an `upgrade:` section). Fix it in the release that would first run with upgrades enabled.

### Minors (backlog, Peach)
1. Toad m1: the shutdown no-poke guard is only on a worker's exit; a slot release (supervisor.ts:3294) or a request
   finishing (:1275) can still switch during a shutdown. One guard in poke()/pokeUpgrade().
2. Toad m2 = independent m6: exec's timeout SIGKILLs only the child (ssh, pnpm scripts outlive it: a ref lock, files
   in `.partial`). A detached process group, kill(-pid); SIGTERM then SIGKILL.
3. Independent m1-m3, the Bash guard: a redirection glued to a relative path (`>bobnet/x`); cd/pushd take an option
   (`cd -P`, `cd --`) as the target; fails open past 256 words. One task, policy.ts.
4. Independent m4 + m7, the guard's documented limits and false denials: say globs, escapes, `~user`, variables are
   out of scope (the sandbox enforces); consider exempting single-quoted text and quoted heredoc bodies from the
   whole-text check.
5. Independent (checked-and-fine note): cheap hardening of the upgrade's git calls, `GIT_NO_REPLACE_OBJECTS=1` and
   `-c core.hooksPath=/dev/null`.
- Independent m5 (a join with no worker): ruled by Toad, accepted and recorded in ADR 0008. No item.

## Board
- BOB-91, BOB-92, BOB-94, BOB-95: accepted on review evidence, to Done.
- BOB-93: stays In Review until the M1 fix lands and is reviewed.

## Log
- 16:28Z Toad w_8b57427a and the independent reviewer started.
- 16:35Z Independent reviewer done (review-c-independent.md): 0 blockers, **1 major** (M1: an ask during startup is
  failed by resume() and its partial discarded, then restarts anyway), 7 minors. Mario confirmed M1 in the code
  (supervisor.ts:615-635, store.ts:650/668). So rc.45 waits for its fix.
- 16:4xZ Toad done (a207ce4): 0/0/2, rc.45 go, no order rule. Merged above; M1 holds rc.45.
