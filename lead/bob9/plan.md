# BOB-9: Helix's board moves to the board service (Mario's cut-over plan)

Casper, 2026-11-16 ~11:40 (to poe, word for word): "I want us to stop Helix after current session and migrate
the board over to the new Bobnet version before we move any further". The LAND-54 design session (Bob,
w_6d3ee83c) runs to its close; poe starts no further Helix session; Helix resumes only once the migration is
checked. Same path as BOB-14 (bobnet's pilot). The import tool is `bobnet-supervisor import-backlog`
(packages/supervisor/src/backlog-import.ts): dotted ids, questions.md, "Was" links and grants are all in.

## Dry run, 2026-11-16 (helix-navigator origin/main c402b87c8, nothing posted)
`node src/bin.ts import-backlog --repo ~/Code/helix-navigator --ref origin/main --project helix --name "Helix Navigator"
--prefix LAND --draft-prefix DRAFT --questions lead/questions.md` → /tmp/bob9/helix-report.md.
- 42 features (+3 archived), 711 tasks (+34 archived), 102 backlog (+6 archived), 46 answered questions, 5 open, 4
  open actions; releases R0 open, R1 closed, R2 planned; 0 renumbered (every id keeps its form); 786 references
  to notes; 80 archived "Was" items absorbed. No feature In Progress, so no imported session.
- land-23.7's bad YAML (from 2026-11-14) is fixed.
- **Blocks the post:** R1 "Partner demo" is closed (archived) but holds LAND-49.13 and LAND-49.14 at Draft.
- To settle: LAND-4.1 and LAND-4.2 have milestone m-1 but LAND-4 has none (they follow LAND-4, so no release).
- 11 "was <id>" mentions aren't linked (only "Was <id>" at a line's start links): Picard accepts or rewrites each.

## Who does what, in order
1. **Picard (now, during LAND-54 design; helix repo, product/backlog only):** answer migration.md's open Helix
   questions: (a) a container becomes a feature; (b) R1 closed: settle LAND-49.13/.14 (finish, drop, or move them
   out of R1), or un-archive R1; (c) assignee (591) and priority (168) are dropped and references go to notes: OK?;
   (d) no feature open at the import: OK? Also LAND-4.1/.2's milestone and the 11 mentions. Confirm or correct
   the grants draft, `helix-grants.json` (here): Picard writes not_open_feature (all fields, questions); Riker
   writes open_feature (status, content, criteria, create; sessions; questions) on mbp-1 and ubu1; Bob has
   sessions and questions; everyone else reads; no admin. Mario@mbp-1's `*` read row (backup) is already on the board.
   Answers go in a commit on helix main; Picard sends Mario the hash.
2. **Window (poe, at the LAND-54 design close):** Mario deploys the stuck-close fix (63d1c5b, signed off 694fb9e).
   poe starts no Helix session. From here nothing writes helix's product/backlog or lead/questions.md.
3. **Post (Mario):** a dry run at the frozen helix main commit; the report has 0 problems that block; Picard OKs it;
   then `--post --grants helix-grants.json`. Expect `{"ok":true,"projects":[{"key":"helix",...}]}`.
4. **Config (poe stages, Casper's config):** in the `helix` project's entry, on **mbp-1 and ubu1** (helix has roles
   on both: Riker, Calvin, Howard, Bill on ubu1): remove its `backlog:` block and add `board: service`. Nothing else.
   No release: both laptops already run a supervisor with `board: service` (mbp-1 rc.37, ubu1 rc.36).
   Restart both (poe's timing). The mbp-1 restart ends Mario: handoff first.
5. **Helix repo cut-over, the same day (Picard and Bob):** remove product/backlog with a pointer to the service
   (as bobnet did: product/BOARD.md); lead/questions.md frozen with a pointer (Q-n/A-n are on the board now); the
   CLAUDE.md files and skills that read or write Backlog.md point to the board_* MCP tools. Commits go to BOB-9 AC 7.
6. **Checks (after the restarts):**
   1. supervisor.log on both laptops: `supervisor ready` lists helix; no config error.
   2. No "board report can't be made; dropped" and no "could not report" for helix since.
   3. Mario: `board_list of: features, project: helix` answers; Picard's first board read answers.
   4. BOB-9 AC 1 count and sample (Peach, with Picard): counts match the report; 10 sampled items match their
      files at the commit (ids, status, parent, release, criteria, notes).
   5. The dashboard: Helix's Roadmap shows R0/R1/R2; its 5 open questions and 4 actions are on Waits on you (AC 4).
      Bob's next question to Casper is a board_ask (BOB-45).
   Then Peach accepts BOB-9, poe resumes Helix.
