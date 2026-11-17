# BOB-47 acceptance: Athletic's board moved into the service

Peach, 2026-11-16 (UTC 2026-11-17). Against BOB-47's criteria; same method as `bob9-acceptance.md`.

Import: athletic `83caaa3ef1b2`, posted 2026-11-17 03:31:18Z by Mario with 9 grants
(`lead/athletic/athletic-grants.json`): `{"ok":true,"projects":[{"key":"athletic","items":92,"events":0,"next_item":23}]}`.
No code, no release, no Toad (no protocol, store or code change).

## What changed from the plan, and why

The plan froze athletic at `81283fc` with ENV-1 In Progress. Ledecky OKed the import on one condition: ENV-1
is settled first. ENV-1's three criteria were met on main by #768 (9a7e443, 2026-11-07); the item was never moved
off In Progress. PR #888 (merged by Phelps, 2026-11-17 03:30:57Z) sets ENV-1 Done. The frozen commit became
`83caaa3ef1b2`. So AC 1 names the new commit, and AC 2 and AC 3 are edited (board_write criteria, reason recorded
on each) from "ENV-1 is really open, imported as the open feature with a session" to what happened: ENV-1 Done,
no feature open, no session invented. This is a design consequence of Ledecky's condition, not a missed criterion.

## How I checked, and what I could not

- Source: the files at `83caaa3` (`git archive` into `/tmp/bob47/src`, from the read-only clone `/tmp/athletic-ro`;
  nothing written to athletic). 92 files in `requirements/board/tasks/`.
- Imported: `/tmp/athletic-import/board-83caaa3.json`, the document Mario posted.
- **I cannot read Athletic's live board**: `board_list` and `board_grants` for project athletic answer "forbidden:
  Peach may not read athletic's board" (the 9 rules give Peach nothing; Ledecky is its PO). So AC 1 and AC 5 are the
  posted document against the files and the grants file, plus the live reads Mario relays (below). Ledecky can co-sign.
- **I cannot read `env-board-ok.md` or Ledecky's handoff**: they are on ubu1 (`~/.local/state/bobnet/handoffs/athletic/`
  here holds only `dry-run-81283fc.md`). For AC 2 I rely on PR #888 and ENV-1's notes (written by Ledecky: "Closed
  2026-11-16 by Ledecky, settling the board for the BobNet board-service import"), and Mario's relay of the OK.
- Script: `/tmp/bob47/tools/cmp.py` (the BOB-9 script, pointed at these paths: status, title, labels, dependencies,
  acceptance criteria numbers and checked state, per file).

## AC 1: count and sample

| What | Files at 83caaa3 | Imported | Match |
|---|---|---|---|
| Items | 92 task files | 92 | yes |
| Features / tasks | 22 / 70 | 22 / 70 (parents set on all 70) | yes |
| Status | | task Done 66, Ready 4; feature Done 8, Ready 1, Draft 13 | script: 0 mismatches |
| Releases, drafts, questions, sessions | none | 0 releases (all `release` null), 0 drafts, 0 questions, 0 sessions | yes (report: no releases, no drafts, no questions file) |
| Next numbers | | next item 23 | yes (ENV-22 is the highest feature) |
| Renumbered, "was" links, unmapped | | 0, 0, 0 (report-83caaa3.md) | yes |
| References / assignee / priority | 92 / 70 / 1 | 92 appended to notes; 70 and 1 dropped (report counts) | yes |

Script over all 92 items: **0 mismatches** in status, title, labels, dependencies, and criteria numbers with
checked state. Description and notes are the files' text plus the appended references (report: 0 unmapped).

| Item | What it shows | Checked against its file | Result |
|---|---|---|---|
| ENV-1 | the settled item | file status Done (as of #888); imported Done, no release, `open_since` null; 3 criteria, 3 checked (file: 3 ticked); notes carry Ledecky's closing note and 2 appended references (file: 2 references) | ok |
| ENV-16 | Ready feature, 1 of 5 tasks done | Ready, ord 8000, 10 criteria 0 checked, 5 tasks: ENV-16.1 Done, .2 .4 .5 .6 Ready (no ENV-16.3 in the files); references appended to notes | ok |
| ENV-17 | Done feature with tasks | Done, ord 2000, dep ENV-15, 29 tasks all Done, no criteria in the file (0) | ok |
| ENV-2.2 | task with deps | Done, parent ENV-2, dep ENV-2.1, 17 criteria 17 checked (file: 17 ticked), assignee `@Dressel` dropped | ok |
| ENV-6 | Draft feature without criteria | Draft, dep ENV-5, 0 criteria, no tasks, ord null (13 Draft features; ENV-6 to 14, 18, 19, 20 have no criteria) | ok |
| ENV-15 | Done feature with tasks | Done, 12 tasks | ok |

**AC 1: checked** (against the posted document; Ledecky's `board_list` read of 22 features on ubu1 agrees on the feature count).

## AC 2: Ledecky's OK

Condition: ENV-1 settled before the post. PR #888 `cath42/athletic` merged 03:30:57Z (commit `83caaa3`), the post
followed at 03:31:18Z, on that commit. ENV-1's notes record Ledecky's settlement; the import carries no release and
drops assignee and priority, as the plan said. The OK file itself is on ubu1 and I could not open it (above).
**AC 2: checked** on the PR, ENV-1's own notes and Mario's relay; the file text is Mario's to hold.

## AC 3: ENV-1 Done, nothing opened

In the posted document no item has `open_since` (0 of 92), `sessions` is empty, ENV-1 is Done. No session invented.
**AC 3: checked** (edited as above). Live state: Ledecky's read shows 22 features; no feature was opened by any later write
that I can see from here.

## AC 4: Roadmap and item pages on phone and desktop

A dashboard look: Casper's. Casper looked at Athletic on the dashboard and said "Looks good" (verbatim; poe@ubu1
to Mario, message m_e9b82f95, 2026-11-17 ~13:30Z; recorded on board action A-1). **AC 4: checked** on his words.

## AC 5: grants

The 9 rules in the posted document equal `lead/athletic/athletic-grants.json` field for field (script compare:
agent, laptop, role, items, fields, sessions, questions all equal): Ledecky PO (items all; status, order, content,
criteria, triage, create; sessions, questions), Phelps lead (sessions, questions), and Dressel, Franklin, Peaty,
Popov, Reviewer, Spitz, Thorpe read, all on ubu1. `board_grants project athletic` is forbidden to Peach, so the live
rows are not read by me. **AC 5: checked** on the posted rules against the grants file; a live `board_grants` read
by Ledecky or Mario would confirm.

## AC 6: one cut-over

`cath42/athletic`, read through `gh api`:

| Step | When (UTC) | What |
|---|---|---|
| #888 `83caaa3ef1b2` | 03:30:57Z | ENV-1 Done; the frozen commit |
| post | 03:31:18Z | board in the service |
| ubu1 config `board: service` | 03:45Z | applied by poe@ubu1 with Casper's OK |
| #889 `374ed07906b2` | 04:15:11Z | `requirements/board/` task files removed (92); README.md kept as the pointer |
| #890 `7150eb028951` | 05:29:31Z | CLAUDE.md, requirements/CLAUDE.md, requirements/backlog.md, backlog.config.yml (removed), .mcp.json (`mcpServers` emptied), skills feature-build, feature-design, feature-review |

Nothing written to both: the only commits touching `requirements/board` after the post are #889 itself; none
edits a task file between `83caaa3` and its removal. **AC 6: checked.** Caveat: the plan said one moment; the
repo cut-over (#889, #890) came 44 and 118 minutes after the post, with the board in the service already; that is
the same cut-over in two commits, with no write to the old files in between.

## AC 7: the service answers, ubu1's supervisor is clean

- poe@ubu1 (relayed by Mario) read ubu1's `supervisor.log` since the restart: 03:45:24.054Z `supervisor ready
  projects ["athletic","helix"]`; no "board report", "could not report" or "dropped" lines for any project; one 1.8 s
  broker reconnect at 05:12Z. The log prints no success line, so this is absence of errors.
- Ledecky (w_ac56729f) read `board_list project athletic` = 22 features on ubu1
  (`board-cutover/ledecky.md` § Result, on ubu1).
- My own `board_list project athletic`: **forbidden** (Peach has no read), so I cannot give the live answer myself.

**AC 7: checked** on poe's log read and Ledecky's board_list, both relayed; my own read is refused by the rules.

## Definition of done

1. Landed: this file; `pnpm -r typecheck` and `pnpm -r test` run by land.
2. Acceptance criteria: AC 1 to 7 all checked with the evidence above (AC 4 on Casper's "Looks good"). BOB-47 Done.
3. Architect sign-off: not applicable (no protocol, store or code change).
4. No release. ubu1's config got `board: service` and a supervisor restart (03:45:24Z, poe@ubu1).

## Open

- Co-sign: Ledecky for the live read (Peach may not read athletic's board). Not a criterion.
