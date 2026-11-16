# Review: BOB-30, the nightly board backup pushes (6c523c5, c269cef)

Toad, 2026-11-15, for Mario. Read: both diffs, `packages/supervisor/src/board-backup.ts` at
c269cef, `test/board-backup.test.ts`, its wiring in `bin.ts:102-103`, and the export's schema
(`packages/protocol/src/board-export.ts`, to check what leaves the laptop). Checked against ADR 0001
§11 and BOB-30's two criteria. Ran `test/board-backup.test.ts` at c269cef: 8 pass.

## Verdict

**Signed off for rc.36.** No blocker, no major. Supervisor-only: no protocol change, no store
change, no broker deploy. Both criteria are met by tests that use a real local bare remote. The push
changes what §11 says, so I amended it (below). One minor and two nits, none of which needs to go in
before rc.36.

## Against the criteria

- **#1, each commit is pushed:** `run()` calls `push()` after the commit (`board-backup.ts`
  `run`). Test "pushes each commit to the repo's remote": the remote's HEAD is the commit's sha.
- **#2, a failed push is logged, the backup carries on, the next night pushes again:** `push()`
  catches the error and warns with git's stderr ("push failed, the commit is kept"). The run still
  returns the sha. Tests: an unreachable remote (moved away, then back: the next night's push carries
  both commits) and a repo with no remote at all.
- **c269cef's follow-up is right.** Without it, a commit whose push failed would wait until the
  board next changed, which could be days on a quiet project. Now an unchanged night runs only
  `git push` (the test asserts that exact single call), which is a no-op when the remote is already
  up to date. That costs one network round trip a night, which is cheap.

## What changes in §11 (amended)

§11 said the backup "writes `board.json` and commits it". It now also says:

- the backup pushes to the branch's upstream, and the supervisor never configures a remote;
- that remote must be private, because the export carries every project's text (but no
  credentials: I checked the schema). BobNet's is `cath42/bobnet-board-backup`;
- a failed push is a warning and never a failed backup. Every night pushes, unchanged nights
  included. A night whose fetch fails pushes nothing.

## Findings

1. **Minor (pre-existing, not BOB-30's): a write whose commit failed is never committed until the
   board changes again.** `run()` writes `board.json` before it commits, and `sameBoard` compares
   the export with the working-tree file, not with `HEAD`. Say the commit fails (an index lock, a
   full disk). On the next night the file already holds the board, so the run logs "unchanged" and
   commits nothing, and the remote's copy stays one change behind until the board moves. To fix it,
   compare against `git show HEAD:board.json` (when that fails, nothing has been committed yet), or
   `git add` and commit whenever `git status --porcelain board.json` isn't empty. This is rare, it
   corrects itself, and it doesn't block rc.36. It is backlog for Luigi.
2. **Nit: the remote needs an upstream.** A bare `git push` uses the branch's upstream (with the
   default `push.default=simple`). Suppose the repo on mbp-1 was made with `git init` and
   `git remote add` and never pushed with `-u`. Then every push fails with "has no upstream branch",
   and the warning says so every night. The ADR now states the setup, and whoever sets up mbp-1's
   repo should clone it from `cath42/bobnet-board-backup`, or push once with `-u`. The supervisor
   shouldn't add `-u` or a remote name itself. The repo's git config is the owner's.
3. **Nit: a push that waits for credentials.** Under launchd there is no TTY, so git's prompts fail
   fast rather than hang, and `GIT_TIMEOUT_MS` (30 s) bounds anything else. Setting
   `GIT_TERMINAL_PROMPT=0` in the env would make that explicit. It is optional.

## Outside this review

Whether mbp-1's backup repo has its remote and upstream set up is Casper's config, not code. Mario
might confirm after the rc.36 restart that the first night's log has no "push failed" warning.
