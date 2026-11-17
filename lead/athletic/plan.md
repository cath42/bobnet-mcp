# Athletic's board moves to the board service (Mario's plan; same path as BOB-9)

Casper, 2026-11-16 ~20:55 (to poe, word for word): "Can we migrate over Athletic while we are at it also?"
poe: the first finite BobNet session after BOB-9 closes. Athletic (repo `cath42/athletic`, project "Envision",
prefix ENV) runs only on ubu1: Phelps lead, Ledecky PO, builders Franklin, Dressel, Thorpe, Spitz, Peaty, Popov.
poe@ubu1 owns its sessions and ubu1's config. Tool: `bobnet-supervisor import-backlog` (packages/supervisor),
no code change needed.

## Dry run, 2026-11-17 (athletic origin/main 81283fcdc15d, shallow clone /tmp/athletic-ro; nothing posted)
`node src/bin.ts import-backlog --repo /tmp/athletic-ro --ref HEAD --dir requirements/board --project athletic
--name Envision --prefix ENV` -> /tmp/athletic-import/report.md, board.json.
(mbp-1's ~/Code/athletic is a stale clone from 2026-09-20 without the board; the dry run reads a fresh clone.)
- 22 features (13 Draft, 7 Done, 1 Ready, 1 In Progress), 70 tasks (66 Done, 4 Ready). 0 problems, 0 renumbered,
  0 "was" mentions. 92 references to notes; assignee (70) and priority (1) not carried.
- No releases (no milestones), no drafts folder, no archive, no questions file: every feature has release null,
  next question Q-1, action A-1. ENV-1 is In Progress, so the import opens it with a build session "imported".

## Ledecky settles and OKs (before the post)
1. ENV-1 ("Records: the board replaces the backlog index") In Progress: really open? If not, set its status in the
   repo before the freeze, or it imports as the open feature with a session.
2. Releases: none on the board. Leave every feature unreleased (the Roadmap shows no release for Athletic), or add
   Backlog.md milestones first (the roadmap file's R2.x numbering is not a board release).
3. Assignee and priority dropped, references to notes: OK?
4. The grants draft `athletic-grants.json` (here): Ledecky writes all items (all fields, sessions, questions);
   Phelps has sessions and questions; the six builders and Reviewer read; all on ubu1; no admin. Names as registered on ubu1 (poe, list_peers 02:48Z).
   Mario@mbp-1's `*` read row (backup) is already on the board.
5. Open questions for Casper that live outside the board (if any): list them, they become Q-n/A-n by hand
   (the import has no questions file for Athletic).
Ledecky writes the OK (or the fixes' commit hash) to `~/.local/state/bobnet/handoffs/athletic/env-board-ok.md`.

## Order
1. Frozen since the ENV-16 build close (20:12, Phelps stopped; poe@ubu1 holds athletic): no session starts and nothing writes
   requirements/board/ (the freeze). poe@ubu1 sends Mario the frozen origin/main commit.
2. Mario: final dry run at that commit, 0 problems; Ledecky OKs; `--post --grants athletic-grants.json` from mbp-1
   (needs only the commit on GitHub; a fresh clone is enough). Expect `{"ok":true,"projects":[{"key":"athletic",...}]}`.
3. Config (poe@ubu1 stages, Casper's config): in ubu1's `athletic` project entry, remove its `backlog:` block if it
   has one and add `board: service`. No release (ubu1 runs a supervisor with board: service). Restart ubu1's
   supervisor (poe@ubu1's timing). mbp-1 needs no change (Athletic has no roles there).
4. Athletic repo cut-over, the same day (Ledecky, Phelps): remove requirements/board/ with a pointer to the
   service; root CLAUDE.md § The board, requirements/CLAUDE.md, backlog.config.yml, .mcp.json's backlog entry
   and the feature-build/design/retro skills point to the board_* MCP tools.
5. Checks: ubu1 supervisor.log lists athletic, no board-report errors; `board_list project athletic` answers
   (Mario); count-and-sample against the commit (Peach with Ledecky); Casper's look at the dashboard.
