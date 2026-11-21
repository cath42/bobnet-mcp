# BOB-44 review C: independent code review of build C (2026-11-21)

Reviewer: a fresh reviewer outside the team (Mario's subagent, no prior context), read-only, on
`git diff 47b422c..ec3fb35` (BOB-91, 94, 92, 93, 95; packages/supervisor). `pnpm -r typecheck` clean; supervisor
523/523. Probes in /tmp/rvc/ (probe-policy.ts, probe-resume.ts). **0 blockers, 1 major, 7 minors.** Lines are v2 at
ec3fb35. Mario checked M1 against the code: confirmed (start() awaits every role's registration before resume();
onPush isn't gated on `registered`; moveUpgrade/endUpgrade have no stage guard).

## Major

**M1. An upgrade asked during startup is failed by resume(), then carries on and restarts anyway** (BOB-93;
`supervisor.ts:634`, `upgrade.ts:421-443`, `store.ts:650`, `:668`).
- bin.ts wires onPush before start(); start() registers the supervisor, then awaits registerWithRetry per role, and
  only then calls upgrades.resume(). An ask can land in that window (one the broker queued during the restart, ttl
  30 s; or poe asking again, as the `waiting` failure text invites).
- Its run() writes an `installing` row; resume() takes it for the old process's, ends it failed ("restarted while
  installing") and discard(tag)s, deleting the live `.<tag>.partial` under an in-flight build.
- run() goes on: moveUpgrade (no stage guard) reopens the ended row as waiting, then restarting; the process
  switches and exits. Probe: events failed, installed, restarting; switch, hold and restart all ran.
- New with BOB-93 (before, the row was written only at the switch).
- Fix: resume() before the first registration (its emits queue in the outbox until `registered`), or ask() refuses
  until resumed; and moveUpgrade/endUpgrade touch only open rows (`AND stage IN ('installing','waiting','restarting')`).

## Minors
1. **A redirection glued to a relative path passes the Bash guard** (`policy.ts:253-258`): `cd <root-parent> && echo
   x >bobnet/evil`, `echo hi >lnk/bobnet/x`. With a space after `>` it is denied; absolute and `~` forms are caught
   by the whole-text check. Fix: strip `^\d*[<>&]+` from each word before resolving it.
2. **cd/pushd take an option as the target** (`policy.ts:260-264`): `cd -P <dir> && rm -rf bobnet`, `cd -- <dir>`.
   Fix: skip words starting with `-`.
3. **The guard fails open past 256 words** (`policy.ts:255`): `cd <parent> && <260 words> && rm -rf bobnet` passes.
   Fix: count only path-like words (`/`, leading `.` or `~`), or carry the cd directory into the per-segment pass.
4. **Shapes not read, adversarial only**: globs (`bobne*`, `{bobnet,x}`, `rm -rf *` after a cd), `bob\net`,
   `~user/…`, variables. The sandbox is the backstop; document as out of scope.
5. **A spawn refused after its board join leaves a session joined with no worker** (BOB-95; `supervisor.ts:767-769`).
   Fix: accept and note it, or leave the session on refusal.
6. **A timeout SIGKILLs only the direct child, and exec now resolves at once** (BOB-95; `upgrade.ts:81-87`): a killed
   `git fetch` can leave ref `.lock` files that wedge later fetches in the guarded clone; a timed-out `pnpm install`'s
   grandchildren keep writing into `.partial` while clean() removes it. Fix: SIGTERM, then SIGKILL after a grace, or a
   detached process group.
7. **False denials of text that only mentions a guarded path** (not new, now wider with case folding and `~`
   expansion): a commit message or quoted heredoc naming the releases' path is denied. Consider exempting
   single-quoted text and quoted heredoc bodies.

## Checked and fine
- The archive pin (BOB-91): `rev-parse --verify refs/tags/<tag>^{commit}` peels an annotated tag, refuses a tree or
  blob; the SHA is checked as COMMIT; ancestry, both shows and archive use it; build refuses an unverified tag;
  `verified.delete` after the fetch; a second ask for the tag can't slip between verify and build. Cheap hardening,
  given ruling 5's trust: `GIT_NO_REPLACE_OBJECTS=1`, `-c core.hooksPath=/dev/null`.
- guardedFolders adds upgrade.repo (expanded), used for every worker and the lead.
- The guard: same-prefix siblings pass (Bash and file tools); case variants, `"$HOME"/…`, `${HOME}`, split quotes,
  `//`, `/./`, `..`, cd/pushd chains, subshells, newline chains and worktree symlinks are caught. Case folding on
  Linux only over-denies two folders differing by case: not realistic.
- BOB-92: the re-check refuses a second ask once the first is restarting; `verifying` blocks a third; a failed verify
  leaves a waiting upgrade intact.
- BOB-93 (apart from M1): `installed` clears current; a switch failure fails the row; superseding ends the old row
  first; resume() discards only `.partial`, never `<root>/<tag>`; the `!closing` poke guard is right.
- BOB-95: every verify git call goes through `checked` with the remaining time; show and rev-parse read stdout only;
  in the drain schedule() launches nothing and every start goes through it, spawnNow checks before and after the
  join, consults are refused, pause() blocks every acquire; queued workers survive the exit.
