# The board export, version 1

The whole board as one JSON document (ADR 0001 §11). `GET /v1/board/export` returns it, the nightly
backup commits it as `board.json`, and `POST /v1/board/import` takes it. The Backlog.md import writes
it too. The zod schema is `BoardExportV1` in `packages/protocol/src/board-export.ts`; this page says
what the fields mean. A changed shape is a new version number, and the importer reads every version
it knows (`BoardExport`).

**Who gets what.** The owner's export has every project. A laptop's has the projects that a read rule
covers for any agent on that laptop (a rule's laptop is `*` or that laptop), since a laptop speaks for
every name it hosts. A read rule for every project covers them all. The rules for every project and
their history go out only with at least one project. The nightly backup is therefore as complete as
its laptop's read rules: for all of the board, that laptop needs a `*` read rule.

## The document

```json
{
  "format": "bobnet-board",
  "version": 1,
  "exported_at": "2026-11-14T03:00:00.000Z",
  "source": "BobNet's board",
  "last_event_seq": 4182,
  "grants": [],
  "events": [],
  "projects": []
}
```

- `source` says where it came from, for the import's event: `"BobNet's board"`, or
  `"Backlog.md at helix 922d533a8"` from the Backlog.md import. At most 300 characters, or null.
- `last_event_seq` is the last event in the exporting board, 0 for a document made from elsewhere.
- `grants` and `events` are the rules for every project (`project` null in the board) and their
  history. A project's own rules and history are in the project.

Every timestamp is ISO 8601 with an offset. Optional values are `null`, never left out.

## Records name each other by ref

The board's `pk`s don't leave it. Records point at each other by the ids people use:

| Record | Named by | Example |
|---|---|---|
| project | `key` | `bobnet` |
| release | `ref` | `R2` |
| item | `ref` (its primary id) | `BOB-14` |
| session | `{feature, kind, label}`; in an event, `"<feature> <kind> <label>"` | `BOB-2 build 3` |
| question, action | `ref` | `Q-12`, `A-3` |
| run | `id` (its worker id) | `w_91745032` |
| push | `"<repo>@<sha>"` | `bobnet@9afe830` |
| CI run | `"<source>:<external_id>"` | `gh:1234567` |
| rule | `"<agent>@<laptop>"`, any case | `Picard@mbp-1` |

## A project

| Field | |
|---|---|
| `key`, `name`, `prefix`, `draft_prefix`, `lead`, `po` | As on the board. `Q` and `A` are never a prefix. |
| `repos` | The project's repos, sorted. |
| `next` | `{item, release, question, action}`: the next number each counter gives. An import starts each one past every id the project brings, aliases included, whatever this says. |
| `created_at` | |
| `releases` | In the order they were made. |
| `items` | Features, tasks and backlog items, in the order they were made. |
| `sessions`, `questions`, `runs`, `pushes`, `ci_runs` | In the order they were made. |
| `grants` | The project's rules, by agent then laptop. |
| `events` | The project's history, by `seq`. |

### An item

Every column of `items`, plus what hangs off it:

- `aliases`: every other id it has had, sorted. Each still finds it. Backlog.md's dotted ids
  (`LAND-1.3`) are kept here.
- `parent`, `parent_hint`, `found_in`: item refs; `release`: a release ref; `captured_session`: a
  session.
- `labels` (sorted), `deps` (item refs, sorted) and `criteria` (by section, then `n`, each with its
  state and who checked it).
- `blocks_use` is a boolean.

The schema's rules hold: a feature is the only `increment`, a task has a parent and no release, a
backlog item has no parent, and so on (ADR 0001 §2). An import that breaks one is refused whole.

### A session

`feature`, `kind`, `label`, its times, `imported` (a session the import opened so `open_since` holds),
and its close: `need`, `minors_fixed`, `summary`, `handoff_path`, `handoff_text`, `commit_sha`,
`closed_by`, `tasks` (`{item, role}` with role `blocker`, `major` or `sent_back`) and `waits_on`
(question refs).

### A question or action

Its text and context, who asked it and in which session, `needed_before` (`{item}`, `{release}` or
`{text}`), its state and answer, `options` in their order, and `holds` (`{item}` or `{session}`).

### A run

Its worker `id`, session, agent, role, laptop, model and effort, its times, `resumed`, its tokens
(`input`, `output`, `cache_read`, `cache_write`) and `calls`. `ctx` is the context per call as a
number array (the board keeps it as little-endian uint32s), or null. `tasks` are item refs.

### Pushes and CI runs

A push: `repo`, `branch`, `sha`, `worker`, `run` (a run id) and `at`. A CI run: `source`,
`external_id`, its name, URL, repo, branch, sha and laptop, its `status` and times, the worker and
session it ran for, and `tasks`.

### A rule

`agent`, `laptop`, `role`, `read`, `items`, `fields` (sorted), `sessions`, `questions`, `admin`
(ADR 0001 §5).

### An event

| Field | |
|---|---|
| `seq` | Its number in the exporting board. An import numbers events anew; `undo_of` points at a `seq` earlier in the same document. |
| `at`, `op`, `reason` | |
| `actor` | `{kind, who, role, worker, session}`; `kind` is `owner`, `agent`, `ci` or `board`. |
| `table` | `projects`, `releases`, `items`, `sessions`, `questions`, `runs`, `pushes`, `ci_runs` or `grants`. |
| `record` | The record's name now (the table above), or null when it is gone, such as a revoked rule. |
| `ref` | The record's label when the event was made. |
| `changes` | `{field, old, new}` in the order they were written, values as text. |

## Stable order

Keys come in the schema's order and rows in the order above, so two exports of an unchanged board
differ only in `exported_at`, and the nightly diff shows what changed.

## Import

`POST /v1/board/import` with the document as the body, from a laptop or from the dashboard's own
origin. No other identity may export or import (`403`). It is all or nothing:

- It brings new projects only. A project whose key or prefix the board has is refused (`409`); it
  never merges.
- Rules for every project come in only to a board that has none. From a laptop, they come in only
  to an empty board (no projects, rules or history), which is the rebuild; otherwise `403`. Only the
  owner makes rules for every project.
- Every link must be to a record in the document, every id appears once (primary or alias), and
  every primary id is under the project's prefix or draft prefix (`400`).
- The history is kept as it was, renumbered, plus one event per project: `import` on the project,
  by the owner or `import@<laptop>`, with the reason `imported from <source> (…)`.
- The answer is `{ok: true, projects: [{key, items, events, next_item}]}`, or
  `{ok: false, code, message}`.

## Making one from Backlog.md

The one-off move of a project's board (BOB-9, BOB-14) writes this shape from its Backlog.md at a
named commit, read through git and never from a worktree:

```sh
node packages/supervisor/src/bin.ts import-backlog --repo ~/Code/helix --ref <commit> \
  --project helix --name Helix --prefix LAND --draft-prefix DRAFT --questions lead/questions.md \
  --lead Picard@mbp-1 --po Picard@mbp-1 --grants helix-grants.json \
  --out helix-board.json --report helix-import.md
```

`--lead` and `--po` are where answers go (ADR 0001 §7), as `name@laptop`; without them they stay
null and Casper's answers tell no one. `--grants` is a JSON array of the rules to seed (ADR 0001 §5),
the PO's rows: each is a `grants` row of this document plus `project`, the project's key or `"*"`:

```json
[
  { "project": "bobnet", "agent": "Peach", "laptop": "mbp-1", "role": "PO", "read": true, "items": "all",
    "fields": ["status", "order", "content", "criteria", "triage", "create"], "sessions": false, "questions": true, "admin": false },
  { "project": "*", "agent": "Mario", "laptop": "mbp-1", "role": "backup", "read": true, "items": "none",
    "fields": [], "sessions": false, "questions": false, "admin": false }
]
```

A row for the project goes in the project's `grants`, a `"*"` row in the document's. Without any,
only the owner can write the project after the import. The broker takes a `"*"` row from a laptop
only into an empty board (no projects, rules or events); on a board in use it answers `403` and
imports nothing, and the command says so before posting. Then post without the `"*"` row, and
Casper adds it as the owner.

It is a dry run: it posts nothing unless `--post` is given, and even then not while anything in its
report is unmapped. It exits 0 only when the broker took the import; otherwise it prints the broker's
status, `code` and `message`, and exits 1. It reads tasks, completed items, drafts and milestones, archived ones too, and the
project's `lead/questions.md`. The mapping rules:

- An id under the prefix keeps its number. A dotted id (`LAND-49.19`) gets the next number past
  every id there is, in numeric order by segment, and keeps the old id as an alias. Drafts keep
  `DRAFT-n`. Every link is mapped to the new refs, and free text stays as written.
- `Was LAND-n.m` at the start of a line in a description or notes makes the old id an alias of the
  item. When the old item is archived, it is absorbed. When it is still on the board, both are kept
  and the report says so.
- An increment is a feature, and so is a top-level item that holds tasks. A task under a task goes
  under its feature. A draft, or an item with no feature over it, is a backlog item. A draft's
  parent becomes its `parent_hint`.
- A milestone is a release, numbered from its title (`R2 Edit and audit`). An archived release is
  `closed`, the first one not archived is `open`, and the rest are `planned`.
- A feature In Progress is open, with a build session `imported`.
- An item's final summary and its references, which have no field, are appended to its notes:
  `Final summary:` and its text, then `References:` with one path or URL per line. Assignee and
  priority are dropped (counted in the report).
- Open questions and actions come from `lead/questions.md`'s tables. Answered questions come from its
  running paragraph (`Q-258 (Casper, 2026-11-13, …)`), with the answer verbatim. The next ids come
  from `The next ID is **Q-267**`.
- A prefix `Q` or `A` is refused.

The report lists the rules it seeds, counts, what couldn't map, every renumbered id (old → new), and what was done by
rule, so the project's PO can check them before the cut-over.
