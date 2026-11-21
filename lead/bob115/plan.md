# BOB-115: Vitals onto the board service; alexa's leftovers off the broker (Mario)

Casper, 2026-11-21 ~13:35 CST, to poe, word for word: "did we ever merge vitals, alexa-mcp to the same project
(and possibly repo) and get them on bobnet as a real project? I still see them empty and separate. Call it Vitals
still, i want to start doing more experimentation on it with the alexa echo."

Already true: alexa-mcp was archived and its Worker deleted on 2026-11-16. Its one idea worth keeping (HAC grades)
went into Vitals as a draft (vitals PR #29, Vita, written 2026-11-16, waiting on Casper's merge). Vitals
(`cath42/vitals`, `~/Code/health` on mbp-1, project key `vitals`, lead Vita, mbp-1 only) has no `board:` entry,
so its backlog lives only in `requirements/backlog.md`, and the dashboard shows it empty.

## 1. Vitals' backlog onto the board (same path as BOB-9 and BOB-47)

Vitals isn't Backlog.md. Its backlog is the release table in `requirements/backlog.md` (one row per increment
R1.0 to R2.3, status ☑/◐/☐) plus a `## Drafts` section; each increment's spec is `requirements/releases/R<x.y>.md`.
`vitals-to-backlog.mjs` (here) reads those through git at a commit and writes them as a Backlog.md tree in a
throwaway repo. Then the import runs unchanged (`bobnet-supervisor import-backlog`), with no code change.

Mapping (what Vita OKs):
- Each increment becomes one feature `VIT-n`, in table order (VIT-1 = R1.0 to VIT-15 = R2.3), titled `R<x.y> <title>`.
  Description: "What it makes true" plus the release file's path as the spec. Notes: the status cell as it was.
  ☑ maps to Done, ◐ to In Progress, ☐ to Ready. Dates come from the release file's git history; Done uses the done date.
- The release files stay in the repo as the contracts. Their Definition-of-done boxes are **not** imported as
  criteria: they were never ticked (status lived in backlog.md), so on Done features they would read as open.
- Board releases: R1 "R1 — a working Vitals (R1.0 to R1.9)", closed (all Done); R2 "R2 — written against use
  (R2.0 on)", open. New work is a feature in R2 or a later release Casper scopes. "Build release 2.4" keeps its
  meaning: R2.4 is a feature title, its spec a release file.
- Each `### ` under `## Drafts` becomes a backlog item of type task, status Draft (HAC grades: VIT-16).
- VIT-13 (R2.1) is ◐ in backlog.md, but PR #24 (its build) merged 2026-08-31. Imported as is, it opens with a
  build session "imported". Vita settles it on the board after the post (Done, or close the session).
- Project: key `vitals`, name Vitals, prefix VIT, lead and PO `Vita@mbp-1` (Casper's answers go to Vita).
- Grants (`vitals-grants.json`): Vita@mbp-1 writes everything (all items, all fields, sessions, questions), no
  admin. Mario@mbp-1's `*` read row is already on the board.
- Open questions: none (backlog.md § Open questions; the settled ones stay in `docs/design/open-questions.html`).

### Dry runs, 2026-11-21 (nothing posted)
`node vitals-to-backlog.mjs ~/Code/health <ref> /tmp/vitals-bl-<x>`, then from `packages/supervisor`:
`node src/bin.ts import-backlog --repo /tmp/vitals-bl-<x> --ref HEAD --dir requirements/board --project vitals
--name Vitals --prefix VIT --lead Vita@mbp-1 --po Vita@mbp-1 --grants <here>/vitals-grants.json --out
/tmp/vitals-import-<x>/board.json --report /tmp/vitals-import-<x>/report.md`
- origin/main b2797afa37ca: 15 features (14 Done, 1 In Progress), 0 problems, 0 renumbered, 1 rule.
- PR #29's head 84b9b5924061: the same plus VIT-16 "HAC grades, beside Canvas" (backlog, Draft). 0 problems.
(The report's "at vitals <sha>" names the throwaway repo's commit; each item's notes name the vitals commit.)

### Order
1. Freeze (Vita): no edits to requirements/backlog.md or the release files' status from PR #29's merge on.
   The merge commit on origin/main is the frozen commit.
2. Mario: final dry run at that commit, 0 problems; Vita OKs the mapping above; then `--post`.
   Expect `{"ok":true,"projects":[{"key":"vitals",...}]}`; then `board_list of releases project vitals`.
3. Config (Casper's ask approves it; poe stages and applies it at a restart; Mario's guard can't read
   `~/.config/bobnet`): in mbp-1's `supervisor.yaml`, the `vitals` project entry gets `board: service`, and loses
   its `backlog:` block if it has one (the loader refuses both). Back up first. Validate with the rc.45 loader:
   `BOBNET_CONFIG_DIR=<a copy of ~/.config/bobnet with the edited supervisor.yaml> node
   ~/.local/share/bobnet/v2.0.0-rc.45/packages/supervisor/src/bin.ts check` should print `ok: 2.0.0-rc.45 ...`.
   No release needed (rc.45 has board: service). Vitals has roles on mbp-1 only, so ubu1 needs no change.
   Post first, then the restart: a supervisor on board: service reports to a project the board must have.
4. Repo cut-over (Vita, after Mario says live): `requirements/backlog.md` becomes a pointer to the board
   (project vitals on BobNet, the board_* MCP tools); CLAUDE.md's "Status lives there and nowhere else" and
   "Build release" sections say status lives on the board and the spec in the release file; the release files stay.
5. Checks: `board_list` answers for vitals (Mario); Vita samples it against the frozen commit; the dashboard shows
   Vitals with R1/R2 (Casper's look, release-level, no ask).

## 2. alexa's leftovers (Canva@ubu1, Dot@ubu1, team alexa)

There is no alexa board project. ubu1's config has no alexa project either: Canva and Dot last registered on
2026-11-17 at rc.37, and ubu1 has restarted since at rc.44 without registering them (poe@ubu1 can confirm).
What's left are the two broker peer rows. The supervisor never deregisters a role
that leaves its config, and the broker lets only a connection hosting a peer, from that peer's laptop,
deregister it. Left alone, the sweep drops them 30 days after last seen (about 2026-12-17). Team alexa is just
their team field: it goes with them.

**Needs ubu1** (rc.44 there, either tag works): `forget-alexa-peers.ts` (here). Run it on ubu1 with the
supervisor's credentials (same env as its unit):
`node forget-alexa-peers.ts ~/.local/share/bobnet/<installed tag>`, which prints `removed Canva@ubu1` and `removed Dot@ubu1`.
That's poe@ubu1's (or Casper's) to run; no broker deploy, no code change. Check: `list_peers` shows neither.
