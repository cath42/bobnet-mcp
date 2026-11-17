# BOB-9 acceptance: Helix's board moved into the service

Peach, 2026-11-16 (UTC 2026-11-17). Against `requirements/migration.md` and BOB-9's criteria.

Import: helix-navigator `7d074bce`, posted 2026-11-17 02:47:04Z with 25 grants
(`{"items":898,"events":0,"next_item":61}`). Picard OK'd the report
(`~/.local/state/bobnet/handoffs/helix/bob9-report-ok.md`). Toad signed off migration 4
(`architecture/reviews/2026-11-16-bob9-migration-4.md`, ADR 0006).

## How I checked, and what I could not

- Source: the Backlog.md files at `7d074bce`, read with `git archive` into `/tmp/bob9/accept-src` (the helix repo is
  `~/Code/helix-navigator`; nothing written there), and `lead/questions.md` at the same commit.
- Imported: `/tmp/bob9/helix-board-posted.json`, the exact document the broker took (Mario's
  correction; it is byte-identical in size to `helix-board-final.json`).
- **I cannot read Helix's live board**: `board_list project helix` answers "forbidden: Peach may not read
  helix's board" (the rules of 25 grants give Peach none; Picard is its PO). So AC 1 is the posted document
  against the files, plus Mario's read-back after the post (R0 open 4/4, R1 closed 25/25, R2 planned 3/11;
  DRAFT-113 has alias LAND-49.13) and the broker's own refusal of anything the import does not take (the post
  answered 898 items). Picard can co-sign the live read.
- Script: `/tmp/bob9/accept-tools/cmp.py` (parses each file's front matter, description and notes sections and
  acceptance criteria, compares to the imported item).

## AC 1: count and sample

### Counts

| What | Files at 7d074bce | Imported | Match |
|---|---|---|---|
| Releases | 3 milestones (m-1, m-2 archived, m-3) | R0 open, R1 closed, R2 planned | yes |
| Live files (tasks 754 + completed 3 + drafts 100) | 857 | 857 items found by id | yes |
| Archived files (archive/tasks 120 + archive/drafts 5) | 125 | 41 imported (archived) + 84 absorbed as "Was" aliases = 125 | yes |
| Items | 857 + 41 | 898 | yes |
| Features | 42 live + 3 archived | 42 + 3 | yes |
| Tasks | 711 live + 32 archived | 711 + 32 | yes |
| Backlog (drafts) | 100 live + 5 archived draft files | 100 + 5 `DRAFT-n`, plus 5 top-level non-feature `LAND-n` (LAND-1.30 archived, LAND-12, 47, 50, 60: no parent, so backlog by the import's rule, release kept) = 110 | yes (report: 104 + 6) |
| Questions / actions | `questions.md`: 47 answered + 5 open (Q-214, 215, 257, 259, 261) + 4 actions (A-6, 15, 17, 20) | 52 question rows (47 answered, 5 open) + 4 actions = 56 | yes |
| Next numbers | next ids Q-277, A-22 | next question 277, action 22, item 61 | yes |
| Rules | 25 | 25 grants | yes (Picard confirmed) |

Fields I could not hold against files by hand are held by script, all 898 items: **0 mismatches** in status,
title, labels, dependencies (a dependency on an absorbed old id resolves to its new id: LAND-1.33's
`LAND-1.16` is `LAND-19.1`, as the alias says), acceptance criteria numbers and checked state (2176 ticked in
the files = 2176 checked), description text, and notes. Parent: 0 mismatches except the 9 drafts, whose parent
is a `parent_hint` by design (AC 2).

### Sample, field by field

| Item | What it shows | Checked against its file | Result |
|---|---|---|---|
| LAND-42 | Done feature, criteria unticked | release R1, status Done, label `surface:web`, no ordinal (`ord` null), 6 criteria, 0 checked, description and notes text equal | ok |
| LAND-19.1 | re-created "was" task | alias `LAND-1.16` (archived old file absorbed), parent LAND-19, status Done, description begins "Was LAND-1.16; renumbered under its parent (Q-120, 2026-10-11).", 15 criteria 0 checked | ok |
| DRAFT-113 | draft with alias | alias `LAND-49.13`, kind backlog, status Draft, dep `DRAFT-114`, release null, labels, 16 criteria 0 checked | ok |
| LAND-1.33 | task with deps, archived | dep `LAND-19.1` (file: `LAND-1.16`, an absorbed alias), parent LAND-1, archived 2026-10-08T23:02Z, reason "archived in Backlog.md", 14 criteria 0 checked | ok |
| LAND-49 | feature without ordinal, once Ready in its file | release R1, status Done, `ord` null, dep LAND-31, 8 criteria 0 checked | ok |
| DRAFT-46 (and 8 more) | parent hint | `parent_hint` LAND-43, `parent` null | ok |
| Q-258 | answered question | state answered, answered by Casper, 2026-11-13, answer text identical to its paragraph in `questions.md`, no invented question text ("answered before the move; questions.md kept only the answer") | ok |
| A-17 | open action | kind action, state open, text and "Where/For" context equal to its row | ok |
| Q-261 | open question | state open, context carries the row's context, recommendation and blocking | ok |

Not defects, both reported and ruled: assignee (591) and priority (168) not carried; references appended to
notes (786). 9 "was" mentions not at a line's start stay prose (Picard, step 1).

**AC 1: checked** (against the posted document; the live read is Picard's co-sign).

## AC 2 to 6: tests

Run today in this worktree: `packages/supervisor/test/backlog-import.test.ts` 18 passed;
`packages/broker/test/board-export.test.ts` 12 passed. (Land runs the full set.)

| AC | Test | Data |
|---|---|---|
| 2 drafts become backlog items with `parent_hint`; a task with status Draft stays a task | `backlog-import.test.ts` "links a re-creation ..." (DRAFT-1: `kind: backlog`, `parent_hint: LAND-40`); "makes a top-level item that holds tasks a feature ..." | 100 + 5 `DRAFT-n` are backlog; 9 hints (DRAFT-46: LAND-43); 40 Draft-status tasks stay tasks |
| 3 features without an ordinal follow the ordered; Done with unticked criteria keep them | `backlog-import.test.ts` "ranks ordinals within each scope ..." (ordered first, null last); "keeps every id ..." (checked and unchecked criteria as they are); `broker/test-ui/dashboard.test.ts:530` "shows a Done feature with unticked criteria as Done, its real count, and 'Done, criteria not ticked'"; `broker/test/board.test.ts:1356` | LAND-39 to 44 and 49 `ord` null in R1, after the ordered ones; LAND-42 0 of 6 |
| 4 Q and A import as records, answered verbatim; open ones | `backlog-import.test.ts` "reads questions.md: open rows, answered questions verbatim from its paragraph, actions, and the next ids" (Q-258, A-17 in its fixture); broker `board-export.test.ts` "takes what the Backlog.md import writes" | Q-258 and A-17 in the posted data (above). The waits list is a dashboard look: **open** |
| 5 the open feature is derived from sessions | `backlog-import.test.ts` "opens a feature In Progress with an imported session" | At 7d074bce no live feature is In Progress (LAND-49 is Done in its file; the one In Progress task, LAND-3.62, is archived), so none is opened and no session is invented; `sessions: 0` in the import. Picard's note agrees |
| 6 "was" re-creations linked | `backlog-import.test.ts` "links a re-creation to its old id, absorbing an archived old item, and reports one still on the board" | 84 absorbed; LAND-19.1 `LAND-1.16`, DRAFT-113 `LAND-49.13`, DRAFT-1 `LAND-18.1`; the old id is found through the alias (Mario's read-back of DRAFT-113) |

**AC 2, 3, 5, 6: checked.** AC 4 waits on Casper's dashboard look.

Note on AC 5's text: it names LAND-49 (six sessions, file says Ready). At the cut-over commit LAND-49 is Done,
so the derivation has nothing to open; the criterion's rule holds.

## Later evidence (same day)

- **AC 4: checked.** Casper's look (via Mario, ~20:55 his time): Waits on you lists the 9 (Q-214, 215, 257, 259,
  261, A-6, 15, 17, 20), none blocking (each source says "Blocking: No" or has no flag, kept in context).
  Roadmap R0/R1/R2 seen.
- **AC 8: checked.** Mario's `board_get helix LAND-42 history:true`: one event, seq 1124, 2026-11-17T02:47:03Z,
  op import by import@mbp-1, "imported from Backlog.md at helix-navigator 7d074bceac54 (bobnet-board v1)",
  nothing before it; earlier history is in git.
- BOB-46 (Usage order) passes on rc.38: Casper confirmed LAND-54 is there.

## Closing evidence (2026-11-16, UTC 2026-11-17)

- **AC 1 live co-sign**: Picard read the live board and co-signed
  (`product/roadmap/bob9-ac1-live-read.md` in helix-navigator, commit `7a1ae682`): 42 features, 3 archived,
  104 + 6 backlog, 25 rules, and my nine samples match. He did not read the 898 total or the task and question
  counts (no list tool for them); imported Q and A carry `asked_by` unknown and the import time as `created_at`.
  That closes the caveat on AC 1.
- **AC 7: checked.** Helix's cut-over commits on helix-navigator `main` (Bob, 2026-11-16). I read these with
  `gh api repos/cath42/helix-navigator/commits/<sha>` (read only), all eight:

  | Commit | Who | What |
  |---|---|---|
  | `963b70de` | Riker | `session/CLAUDE.md` on the board tools, close via `close_session` |
  | `9a6a5f99` | Bob | `lead/questions.md` frozen with a pointer; `lead/CLAUDE.md`, land-build, design, review skills on `board_*` (5 files) |
  | `ff3123b6` | Calvin | `design/CLAUDE.md` reads tasks from the board service |
  | `0be97f7e` | Bender | `ops/CLAUDE.md` reads tasks from the board service |
  | `2c12bcf3` | Bill | ADR 0115 accepted (Casper, Q-278 (a)); root `CLAUDE.md`, OWNERS, six workspace `CLAUDE.md` (12 files) |
  | `7a1ae682` | Picard | `product/backlog` and `backlog.config.yml` removed (297 files removed of 300), `product/BOARD.md`, the AC 1 co-sign |
  | `845d11bd` | Bill | OWNERS row for the retired config dropped |
  | `bffb1c01` | Homer | `.mcp.json` drops the backlog server, last |

  All within 2026-11-17 02:59Z to 04:38Z; one cut-over, the Backlog.md folder gone with a pointer, CLAUDE.md and
  skills on the tools the same day, nothing written to both.
- **DoD 2: checked**: AC 1 to 8 pass, evidence above.

## Result

All eight criteria and the four DoD items are checked. BOB-9 is Done.
