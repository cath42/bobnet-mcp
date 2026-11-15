# Review: the Backlog.md import (e74a747)

Toad, 2026-11-14. Luigi's `import-backlog` command (BOB-2 step 3, ADR 0001 §11, toward BOB-14 and
BOB-9): `packages/supervisor/src/backlog-import.ts`, `board.ts` `readBacklogFile`, `board-backup.ts`
`importPoster` and the fetch timeout, `docs/board-export-v1.md` § "Making one from Backlog.md", and
`test/backlog-import.test.ts`. I read the diff and Luigi's three reports, and ran the command as a
dry run on Helix at `9d4a2f41b` myself (`/tmp`, nothing posted) to check the output.

**Verdict:** the shape is right and I sign off on it for the pilot once findings 1 and 2 are fixed.
It reads through git at a commit and never from a worktree, writes the export shape and nothing else,
the broker's import stays the only writer, and `--post` refuses while anything is unmapped. Ids under
the prefix keep their number, dotted ids get numbers past every id (aliases and unreadable files
included), sorted numerically by segment so the order within a feature holds (LAND-49.13 → 743,
.14 → 744), and every link goes through `resolve`, so a dependency on an absorbed or renumbered id
lands on the right record. `readBacklogFile` as the one uncut reader, with `parseBacklogItem` cut from
it, is what §11 meant; I've updated §11 to name it. Protocol and routes are unchanged.

## Findings

1. **`--post` exits 0 when the broker refuses the import.** *Must-fix before BOB-14.*
   `importPoster` (`board-backup.ts`) returns `{status, reply}` whatever the status, and
   `importBacklogCommand` prints it and returns 0 (`backlog-import.ts`, the end of the command). A
   `400`, `403` or `409` looks like success to whoever runs the cut-over. Exit 1 unless the status is
   2xx and `reply.ok` is true, and print the broker's `code` and `message`.

2. **The project comes in with no rules, so after the post only the owner can write it.**
   *Must-fix before BOB-14* (it's BOB-14 #7). The document's `grants` are always `[]`. ADR 0001 §5
   says the table is seeded when a project is created **or imported**, from Peach's rows, and BOB-14
   #4 needs Peach writing through the MCP tools right after the cut-over. Add `--grants <file>`: a JSON
   array of `ExportGrant`, validated with the protocol's schema and listed in the report. A row naming
   the project goes in the project's `grants`. A `'*'` row goes in the document's top-level `grants`,
   and Peach's rows include one (`migration.md`, "BOB-14 grant seeding": a `'*'` read for Mario@mbp-1,
   so the backup is full). §11 takes a rule for every project from a laptop only into an empty board.
   So `--post` from mbp-1 works only if BobNet is the first thing on the live board; otherwise the
   broker answers `403` (and finding 1 makes that visible), and Casper adds that one row as the owner.
   The command should say so before posting when the document carries a `'*'` row. In the same change,
   add `--lead` and `--po` to the doc's example: they are where answers go (§7), and the command leaves
   them null when they aren't given. BobNet's are Mario and Peach on mbp-1.

3. **Rounding fractional ordinals collapses their order.** *Later, before BOB-9* (BobNet's board has
   none). Helix has `204204`, `204204.1`, `.2`, `.3` under LAND-39: all four become `204204`
   (LAND-562, 573, 574, 575), and the tie falls back to `pk`, which is ref order rather than the
   order Helix chose. `60000.5` → `60001` and `204022.5` → `204023` land on existing ordinals too
   (LAND-565/576, LAND-355/375). Rank each scope's ordinals (a feature's tasks, a release's features,
   the backlog) and space them (`rank × 1000`), so ties in Backlog.md stay ties and nothing new ties.
   It's ordering only, so it needs no rule from Peach. Report it under "Done by rule".

4. **A task's milestone is dropped without a word when its feature has none.**
   *Later, before BOB-9.* The check that reports a task whose milestone differs from its feature's
   needs both (`f.milestone && fm`). A task with a milestone under a feature with none loses it
   silently. §11 says the report lists this case, so report it as a problem.

5. **A closed release can come in holding work that isn't Done.** *Later, before BOB-9.* Helix's R1
   comes in closed (archived milestone) with LAND-49.13 and LAND-49.14 (→ 743, 744) at Draft under
   LAND-49. On the board, `close_release` refuses exactly this (ADR 0001 §5: every feature not Done
   needs a destination). The import goes round that rule. Whether R1 is closed is Peach's mapping
   question, but the import must say it happened, either as a problem that blocks `--post` or as a
   note (Peach's call). I lean to a problem: there's no operation that reopens a release, so a wrong
   `closed` can't be fixed after the post.

6. **"Was" mentions the rule doesn't take are not in the report.** *Later, before BOB-9.* The rule
   takes `Was X` only at the start of a line, and that's right. Helix also has mentions in the middle of
   lines, some of them re-creations ("(was LAND-43.15)", "Was LAND-44.7." mid-paragraph, "was
   LAND-40.5, moved under LAND-41 as 41.7") and some not ("its only wait was LAND-2.20", three slices
   each "was LAND-30"). Don't widen the rule, because it would link the wrong ones. List every `was
   <id>` it didn't take, with the item that says it, so the PO can settle each one (BOB-9 #6).

7. **BOB-9 #5 (the open feature from sessions) isn't built; whether it should be is open.**
   *Later, if Picard's answer needs it.* The code opens a feature that's In Progress. For BobNet that's
   Peach's answer (`migration.md`, Import answers 4: no open feature is invented from any other
   status), and BobNet has none. BOB-9 #5 still says "derived from sessions" (LAND-49 has six sessions
   but says Ready, and Done at `9d4a2f41b`), and Picard has been asked. If the answer is sessions:
   they live in the supervisor's state for the project, the same records `sessionAt` reads, and the
   import runs in the supervisor, so a feature with a session that has no end at the commit's time gets
   the `imported` session and `open_since`. That crosses no part and needs no ADR.

8. **After the move, a dotted id in `spawn_worker`'s tasks is refused without naming its new ref.**
   *Later, before BOB-9; moot if Casper picks dotted.* `supervisor.ts:387` refuses any task that
   isn't an `ItemRef` on a project whose board is the service. After the cut-over, Helix's orchestrator
   and old briefs will say `LAND-49.14`. Look the alias up (`get` takes one, §8) and either take the
   primary ref and say so, or refuse with "LAND-49.14 is now LAND-744". Never store the alias as the
   task.

9. **No test runs the generated document through the broker's import.** *Later.* Luigi checked all
   three by hand against a test broker. A test that feeds `backlogToExport`'s output for a small
   fixture backlog to the broker's import (re-creation, dotted ids, a container feature, questions)
   would catch drift between the two sides of `BoardExportV1`.

**Kept as is, on purpose:** times read as UTC because Backlog.md writes no zone (out by the laptop's
offset, which is harmless). `checked_by: "Backlog.md"`. A renumbered mapping holds only at the commit
it was made from: a new top-level id or dotted id before the cut-over shifts it. So the mapping Helix
uses is the one from the posted commit's report, never a dry run's.

## If Casper picks dotted ids

Today ADR 0001 §2 lets ids be labels on records, so a record can move and change kind and keep its
id. Keeping `LAND-49.14` as a primary is compatible with that as long as the dot is only a label, and
the label stops saying where the task is once it moves. What changes:

- **ADR 0001 §2 and §8 (mine).** A primary ref may be dotted, but only as imported. Whether new
  tasks are dotted too is the real fork:
  - *Imported ids stay dotted; new items get `LAND-n`.* This is the small change. Nothing is renamed
    on a move or a slot, and a dotted ref then means only "made before the move". I'd recommend this
    if Casper picks dotted.
  - *New tasks are dotted under their feature (`LAND-49.20`).* This needs a per-feature counter
    (`items.next_child`) and a rule for what a move or a slot does to the id. If it renames, the old
    ref becomes an alias, which `item_refs` already supports, but every move changes what people
    call the task. If it doesn't, the label lies after a move. Either way it brings back the coupling
    of id and parent that Helix's "Was LAND-n.m" re-creations came from.
- **Protocol (`protocol/src/board.ts:44`).** `ItemRef` widens to `ItemAlias`'s pattern
  (`(\.\d{1,4})*`). That's additive for requests: an old client can't send a dotted ref, and a new
  broker takes both. Clients don't parse board replies with zod, so a dotted ref in a reply breaks
  nothing. The export's `ExportItem.ref` uses `ItemRef`, so a supervisor older than the widening fails
  `BoardExportV1.safeParse` on a board with a dotted primary: its nightly backup stops until it is
  upgraded. Ship the widening in the same release as any dotted import. The export stays version 1,
  because the shape doesn't change. `spawn_worker`'s check (`supervisor.ts:387`, `:1634`) takes
  dotted refs as soon as `ItemRef` does, and finding 8 goes away.
- **Store (`broker/src/board/store.ts`).** Under the small option, `create` stays `${prefix}-${next_item}`
  (store.ts:527). The import's `highest()` (export.ts:306) already reads the first segment of a
  dotted ref, and the prefix check (export.ts:377) already passes one. `ORDER BY ref` for aliases
  (store.ts:285) sorts `.10` before `.2`, which is cosmetic. Lists order by `ord, pk`, and the import
  inserts in numeric-by-segment order, so a feature's tasks without an ordinal still come out in
  order.
- **Import (`backlog-import.ts`).** `keeps` accepts a dotted id under the prefix, and only ids under
  another prefix (or a draft id outside `drafts/`) are renumbered. Everything else holds: aliases,
  "Was" absorption, `resolve`, the `next` counter (the first segment past every id). One case to
  decide: a task under a task, put under its feature, keeps an id that names a different parent
  (`LAND-49.3.1` under LAND-49 is fine, but a moved task isn't). Under the small option that's
  acceptable, because the label doesn't promise its parent. The doc's mapping rules and the first
  test change with it.

So the small option is a contained change to the import, the protocol's `ItemRef` and the doc, plus
my ADR edit, and it can go straight to Luigi. The full option is a design change to §2 that I'd want
to write before anyone builds it.

## For Peach's mapping questions: what makes either answer hard

I'm not ruling on these. Here's where the code or the schema makes one answer costly:

- **Containers → features (LAND-1, 17, 18, 19, 20, 48).** Keeping them as features is what the code
  does. Making them features but keeping their type (`chore`) breaks a §2 rule (a feature is
  `increment`), so that would need an ADR change. Not making them features means their tasks become
  backlog items, and since a `parent_hint` must be a feature, the grouping would be lost unless it's
  carried as a label.
- **Release status.** The rule lives in one block (`backlog-import.ts`, the releases section), so a
  per-release override flag is easy either way. The hard part is undoing it: there's no reopen
  operation, so a release imported `closed` by mistake stays closed (finding 5). Settle it before the
  post.
- **Dropped fields (assignee, references, priority).** Peach has settled BobNet's (references go to
  notes as a list, BOB-14 #6), and Helix's assignee and priority are with Picard. Carrying any of them
  as text, appended to notes the way the final summary is, is trivial. Carrying them as fields is a §2 column, a new
  optional key in `ExportItem`, and my ADR. Older readers strip unknown keys, so an older importer
  would drop them silently. References are the big one (747 in Helix, 25 in BobNet).
- **Absorbed archived items.** An archived item re-created elsewhere (80 in Helix, such as
  LAND-18.1 → DRAFT-1) isn't imported: its id finds the new item, and its text stays in git (BOB-9
  #8). Keeping it as its own archived record linked to the new one would need a relation the schema
  doesn't have, because an id can't be both the old record's primary and the new one's alias.
