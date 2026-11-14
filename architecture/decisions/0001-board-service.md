# 0001. The board service: records, operations, who writes, events, runs and CI

- **Status:** accepted (Casper, 2026-11-14: `lead/2026-11-14-board-adr-and-review-decisions.md`, "1. Yes,
  2. Yes"). Proposed by Toad the same day; amended on acceptance with the four points from the system
  review (`architecture/reviews/2026-11-14-system-review.md`, "How ADR 0001 fits") and the migration
  order. Before the build starts, Luigi fixes the review's findings 1-3 (decision 3).
  **Amended 2026-11-14** (Toad, cleared by Mario; narrows the accepted decision): the supervisor's
  own operations and `ctx` are authorized by the supervisor's connection (§4, §6), and
  `not_open_feature` is worded as built (§5). From the BOB-2 step 1 review.
- **For:** BOB-2 (the service) and BOB-7 (who writes); BOB-3, 4, 5, 8, 9 and 10 build on it.
- **Reads:** product/requirements/ (all), product/backlog/tasks/bob-2..10, design/BOB-1/notes.md and
  spec.md, lead/BOB-1-casper-feedback.md, Peach's message on criterion 0 (2026-11-14).

## Context

Casper's frame (2026-11-13): the board is a BobNet service, an actual database, and Backlog.md is
retired by it (board-service.md 0, C5). Today the board is a cache: each supervisor reads Backlog.md
from git and pushes a whole `ProjectBoard` of up to 900 KB when it changes
(`packages/supervisor/src/board.ts`, `packages/protocol/src/frames.ts` `ProjectBoard`, stored as a
JSON blob in `project_boards`, `packages/broker/src/schema.ts` migration 5). Sessions are grouped
from workers' declared sessions (`spawn_worker` `session`, `tasks`; `board.ts` `assignSessions`),
context per call lives in the supervisor's store and only the latest four sessions' runs reach the
dashboard (`SESSIONS_WITH_RUNS`), CI is `gh run list` on the laptop (`board.ts` `ciRuns`), and
permission requests are already answerable from the dashboard: an `action` frame carrying Casper's
Access JWT, which the supervisor verifies itself (`packages/supervisor/src/owner.ts`).

The broker is one Durable Object, `Broker`, named `network` (`packages/broker/src/index.ts`), with
SQLite migrations in `schema.ts`. Laptops authenticate with Access service tokens mapped to a laptop
id, the owner with an Access user JWT (`auth.ts`). A supervisor registers every role it runs as a peer
and speaks for its workers over its one connection (`worker-tools.ts`: "a worker can't speak as
anyone else"); interactive agents register through the channel client (`packages/client/src/server.ts`).

## Decision

### 1. Where: a second Durable Object class, `Board`, in the broker's Worker

One instance, `BOARD.getByName("board")`, holds every project's board in its own SQLite, with its own
migration list (`packages/broker/src/board/schema.ts`, same append-only rule as `schema.ts`). It is
the broker's database (C5) and ships with the broker, but it is not the `Broker` object:

- **Recovery is per object.** Cloudflare's point-in-time recovery (C6) restores one Durable Object.
  Rolling the board back to last night must not resurrect delivered messages or the roster, and
  restoring messages must not undo Casper's gates.
- **Big reads don't queue messages.** A Durable Object runs one request at a time; Helix-sized lists
  run in `Board`, not in front of message routing.

Agents and the dashboard reach it only through `Broker`, which owns sockets and knows who is calling;
it calls `Board` over RPC with the caller (§4) and the operation. `Board` returns the result and its
effects (messages to send, what changed); `Broker` sends them (§8). HTTP routes for export, import
and CI (§10, §11) go from the Worker to `Board` directly, with the identity the Worker verified.
Wrangler gets a `BOARD` binding and migration tag `v2` with `new_sqlite_classes: ["Board"]`
(additive). Every write is one `transactionSync`: the state change and its event commit together.

**Frame handling stops running to completion.** Today `Broker.dispatch` makes no awaits, so each frame
is handled whole before the next starts (`broker.ts:157-187`). A `board_op` awaits `Board` over RPC,
and the input gate doesn't hold other frames during an outbound call: a register, a takeover or a
disconnect can run in that gap. So a `board_op` handler:

- reads the caller and its `ctx` before the call and passes them to `Board` as values;
- holds no roster row, `Conn` field or socket across the await, and after it re-reads from `Broker`
  storage anything it needs (the caller's socket for the reply, the owner sockets for
  `board_changed`, the recipients of returned messages);
- if the caller's socket closed meanwhile, drops the reply. It still stores and delivers the
  returned messages and pushes `board_changed`, because `Board` has committed.

Every other frame keeps running to completion. A test interleaves a `board_op` with a takeover of
the same name.

### 2. Records and schema

Typed columns, `CHECK` lists, foreign keys. `Board` runs `PRAGMA foreign_keys = ON` at start, and the
operation layer checks links first so a refusal names the reason; the constraint is the backstop. No
column holds Markdown, YAML or JSON as structure. Free text is free text, never parsed: description,
notes, titles, criterion text and evidence, a question's text and options, answers, Casper's words,
reasons, a close's summary.

Every table has an integer `pk`; links are foreign keys to `pk`. The ids people use (`LAND-49`,
`Q-258`) are labels on records, so a record can move and change kind and keep its id.

| Table | What it holds |
|---|---|
| `projects` | `key` (helix), `name`, `prefix` (LAND), `draft_prefix` (DRAFT), `lead` and `po` (BobNet addresses: who gets answers), `repos` (one row each in `project_repos`), counters for the next ids. |
| `releases` | `project`, `ref` (R1), `title`, `goal` (free text), `status` CHECK (`planned`, `open`, `closed`), `ord`, `spec_url` (the release's document, which may stay in the repo, linked: Peach's proposal, agreed), `closed_at`, `closed_by`. |
| `items` | Features, tasks and backlog items, one table (see below). |
| `item_refs` | Every id an item has ever had: `project`, `ref` UNIQUE per project, `item`, `primary`. Ids are never reused because a ref is never deleted. "Was LAND-n.m" becomes an alias row on the new item (migration 4). |
| `item_labels`, `item_deps` | One row per label; one per dependency, both ends foreign keys, same project. |
| `criteria` | `item`, `ord`, `section` CHECK (`ac`, `dod`), `text`, `evidence`, `state` CHECK (`open`, `checked`), `checked_by`, `checked_at`, `casper_gate` (only Casper's acceptance checks it: BOB-1 #6 is one). Progress counts `ac` only. |
| `sessions` | `project`, `feature` (an item of kind feature), `kind` CHECK (`design`, `build`, `review`, `retro`), `label`, UNIQUE (feature, kind, label); `started_at`, `ended_at`, and the close (§6). "Other work" is not a kind: it is a run with no session (§9). |
| `session_waits_on` | A closed session's `need: casper` questions. |
| `questions` | Questions and actions only Casper can answer or do (C8): `project`, `ref` (Q-258, A-17), `kind` CHECK (`question`, `action`), `text`, `context`, `asked_by`, `session`, `needed_before` (an item or release, or a short text when it is neither: "the demo"), `state` CHECK (`open`, `answered`, `done`, `withdrawn`), the answer (§7). |
| `question_options` | `question`, `ord`, `key`, `text`, `recommended`. |
| `question_holds` | What a question holds up: an item or a session. "Holds up" shows only when it has rows (notes 35). |
| `runs`, `ci_runs`, `pushes` | BobNet's records of agents' runs and of CI and run-slot runs (§9, §10). |
| `grants` | Who may write what (§5). |
| `events`, `event_changes` | The history (§3). |

**`items`** has `project`, `kind` CHECK (`feature`, `task`, `backlog`), `type` CHECK (`increment`,
`task`, `spike`, `bug`, `chore`), `status` CHECK (`Draft`, `Ready`, `In Progress`, `In Review`,
`Done`), `title`, `description`, `notes`, `parent` (a feature), `release`, `ord`, `open_since`,
`archived_at` and `archive_reason`; capture's `captured_by`, `captured_session`, `casper_words`,
`capture_id` (UNIQUE: the offline queue's dedupe, §12); a backlog item's `parent_hint` (a feature) and
its release kept as a field (BOB-8 #7); a bug's `bug_where` CHECK (`staging`, `production`),
`blocks_use`, `found_in` (a feature). Rules the store enforces, by CHECK where a row can say it and
by the operation layer where it takes a join:

- A feature is type `increment`, has no parent, may have a release.
- A task has a feature as parent and no release of its own: its release is its feature's.
- A backlog item has no parent (a hint at most) and may have a release.
- Links stay in one project.

One table, not one per kind, because an item changes kind and keeps its id (capture.md 5: a backlog
item slotted becomes a task, or becomes a feature) and every kind shares the same fields, criteria,
labels, dependencies and history. Each item is still its own typed record (criterion 0). A **bug** is
an item of type `bug` with the bug fields, a backlog item until triage slots it; it is not a fourth
kind (bugs.md: "captured like any backlog item, with type bug").

**Dropped and archived** items keep their record and id: `archived_at` and `archive_reason`, not a
sixth status (the five are Helix's, board-service 8). Dropping at triage, closing a bug without a fix
(bugs.md 4) and Helix's archive folder all map to it.

**Order** is `ord`, an integer per scope (features in a release, releases in a project, backlog items
in triage), sparse like Backlog.md's ordinal. `NULL` sorts after the ordered ones, by id
(roadmap-view 3). Casper's move puts a feature last in its new release (notes 19).

**The open feature** (board-writes, BOB-2 #9) is `open_since` on the feature. Only the session
operations write it, in the same transaction: set when a session on the feature starts, cleared when
its last open session closes. No operation lets anyone set it by hand.

**Sizes** at Helix's scale (about 900 items, 5000 criteria) are small for SQLite. Lists are queries
with aggregates (criteria checked of total, tasks done of total), so a Done feature's tasks are
counted, not loaded, until it is opened (board-service 10). Text search is `LIKE` over title and
description; FTS5 only if that proves slow.

### 3. Every change is an event

`events`: `seq`, `at`, `project`, the actor (§4: kind, address or email, role, worker, session), `op`,
the record (`table`, `pk`, `ref`), `reason`, `undo_of`. `event_changes`: one row per field: `field`,
`old`, `new`. Both are written in the same transaction as the change, and are never updated or
deleted.

The state tables are the truth and the events are their complete history, written alongside. That
departs from my earlier advice (README T3, "the board is built from that log"): replaying a log to
build state adds a projection layer and makes the store's constraints secondary. What the criteria
need (who, when, what, from what to what: board-service 7; tasks a session moved: §6) the log gives
either way. An item's history is `board_get` with `history` (§8) and the dashboard reads the same.

### 4. Who is calling

| Caller | How the broker knows | Trust |
|---|---|---|
| Casper (owner) | Access user JWT, as today | The dashboard's owner socket. |
| An agent | A peer hosted by the calling laptop's connection: `name@laptop` | The laptop's service token. |
| A supervisor's worker | The supervisor sends its board operations `as` the role's peer (registered at start, `supervisor.ts` `start`) with `ctx`: worker id, role key, project, declared session, tasks | The laptop vouches, as it does for that worker's messages. |
| A CI system | A new Access service token, mapped by secrets `CI_TOKENS` / `CI_TOKENS_<x>` (like `LAPTOP_TOKENS`) to a source name: `Identity` kind `ci` | Writes CI runs only. |

The threat this guards against is mistakes and agents overstepping their role, not a hostile laptop:
anything holding a laptop's token can claim any role on that laptop, as it can claim any name for
messages today. Agents get board access only through tools that stamp who they are; they never see
a token. Unlike dashboard actions, which a supervisor verifies against Casper's own JWT, Casper's
board writes are trusted to the broker that holds the board.

**Amendment, 2026-11-14: the supervisor's connection.** `Broker` passes `supervisor: true` in an
agent's `BoardCaller` when the frame comes on the connection that hosts the laptop's supervisor peer
(registered with `supervisor: true`, pinned as the laptop's reporter by BOB-12). Only then does
`Board` take `ctx`. On any other connection the broker drops it to null, so the operation is the
peer's own with no session. The supervisor's own operations (`session_join`, `run_start`, `run_end`,
`push`, `slot_run`, §8) are authorized by that connection, not by a grant. They need `supervisor`,
a `ctx`, and `ctx.project` equal to the operation's project. They are made `as` the worker's role
peer, which the supervisor registers at start, and the owner may not make them.

### 5. Who may write what (BOB-7)

**The rule table is board data**, one row per project and agent:

`grants`: `project` (or `*`), `agent` (a BobNet name), `laptop` (or `*`), `role` (a label for the
history), `read`, `items` CHECK (`all`, `open_feature`, `not_open_feature`, `none`), `fields` (rows
in `grant_fields`: `status`, `order`, `content` (title, description, notes, labels, dependencies,
parent), `criteria`, `triage` (slot, make a feature, drop), `create`), `sessions` (may start and
close sessions), `questions` (may ask Casper and record his answers given in conversation), `admin`
(may change this table).

- `open_feature` means items under a feature that is open **and** that the caller's declared session
  is on (supervisor `ctx`). `not_open_feature` covers items whose feature isn't open, and items under
  no feature (backlog items, releases). It never covers an open feature, whoever's session is on it
  (amended 2026-11-14; "everything else" would have let Picard write the open feature). Helix's rule
  is two rows: the session PO with `open_feature`, Picard with `not_open_feature` (board-writes 2).
  So slotting into an open feature is the session PO's. Builders have `read` and nothing else
  (board-writes 3).
- **Fixed rules that no grant changes:**
  - **Anyone may capture**, into any project (README T2).
  - **Casper's gates are the owner's alone:** a feature's release, the order of releases, closing a
    release, answering a question, marking an action done (board-writes 4, 5; waiting-on-casper 4).
  - **Projects:** an agent with `read` on no project sees nothing; Mario's and Casper's cross-project
    reads are `*` rows (board-service 9).
- A refused write returns `forbidden` with the reason and who may make it ("Luigi may not change
  status on helix; Picard does, or the session PO on the open feature").
- The table is seeded when a project is created or imported, from Peach's rows for it (Peach decides
  who may write what; I keep the mechanism). It is changed by the owner or an `admin` grant, and
  every change is an event.

**Gates from the dashboard** (BOB-7 #3, #4) are owner operations: `set_release`,
`order_releases`, `close_release` with a destination for every feature not Done (refused if one is
missing, so nothing is closed with work silently left), and `undo` of the owner's own event, applied
as a new event (`undo_of`). A closed release refuses features.

### 6. The structured session close (BOB-2 #8, BOB-4 #2)

Sessions start from spawns. When `spawn_worker` declares `session: {feature, kind, label}` for a
project on the service, the supervisor calls `session_join` before the worker starts: it creates the
session if it doesn't exist, sets the feature's `open_since`, and is refused if the feature isn't a
feature of that project or the session is closed (name another label). Spawn waits for that answer
(§12). The worker's run is recorded against the session (§9).

**Amendment, 2026-11-14:** the supervisor sends `session_join` `as` the spawned worker's role, with
that worker's `ctx`, and `ctx.session` equals the operation's session. It is authorized by the
supervisor's connection (§4), not by the `sessions` grant. A builder spawned into a build session
holds no grants, and its spawn must work. Who may spawn into a session is decided where the spawn
is made: the orchestrator's `spawn_worker` and the `remote` allowlist. The `sessions` grant gates
`close_session`.

A session ends with **`close_session`**, an MCP tool for an agent holding `sessions` (the lead or the
session PO):

```
close_session {
  session: { feature, kind, label },
  need: "none" | "answer" | "casper",
  waits_on: [question refs]        // required and non-empty when need is casper
  blockers: [task refs], majors: [task refs],   // review findings are tasks of the feature (bugs.md 4)
  minors_fixed: int, sent_back: [task refs],
  moves: [{ task, status }],       // status moves made at this boundary, applied by the close
  summary: string (≤ 300),
  handoff: path, commit?: sha
}
```

The close is the session boundary, so it **applies** its `moves` as status writes, checked against the
caller's grant and tagged with the session. **Tasks moved** is then read from the log: every status
event tagged with this session, during it or at its close, with the last status each task was left
in. Nothing is copied twice and nothing is taken from a handoff. The tool reads the handoff file at
`handoff` on the laptop and stores its text (64 KB at most, never parsed) with its path, so a phone
can read it (steps-view 6). **Tokens** are summed from the session's runs (§9), never declared.
Closing the feature's last open session clears `open_since`.

A session with no close shows "running" while a worker in it runs, else "no close recorded". The
steps view's "waiting" is derived: closed with `need: casper` and a question still open.

### 7. Questions, actions and answers (BOB-5)

- **Asking:** an agent holding `questions` (`board_ask`) creates a question or action with its
  options, what it holds up and what it is needed before.
- **Answering from the dashboard** is the owner's `answer_question` (the option's key and/or his
  words, stored verbatim) or `mark_done` (with an optional note). It is write-once. Any other role is
  refused.
- **Answers given in conversation** (waiting-on-casper, Must not break) are recorded with
  `record_answer` by an agent holding `questions`, with Casper's words verbatim and `via:
  conversation`. The record shows it was answered either way, and by which route. It is also
  write-once.
- **Undo:** Casper may withdraw his own dashboard answer within two minutes (the toast's Undo,
  notes 43). The question reopens, the withdrawn answer stays in the history, and the lead gets a
  second message saying so.
- **How the lead gets the answer:** in the same transaction, `Board` returns a message for
  `Broker` to store and deliver as any message is, to the project's `lead` and to `asked_by` if that
  is someone else. It comes from the reserved sender `BobNet@board`, which no laptop may take as its
  id. The body names the question, the option, and his words verbatim. A supervisor wakes the lead
  or keeps it in its inbox, as today.
- **Helix before BOB-9:** I agree with Peach. The dashboard answers only questions that are records
  in the service. BobNet never writes Helix's `lead/questions.md`, and Helix's `Q-n` are answered
  in conversation until the cut-over imports them (BOB-9 #4). A question links to the items it
  holds up, so it can't move before its board does. Until then the Waits list shows only the
  projects on the service plus permission requests from every laptop.
- **Permission requests** are not board records. They are the supervisor's requests, live in its
  snapshot (`LaptopSnapshot.pending`), and allow/deny stays today's `action` frame, verified by the
  supervisor against Casper's JWT. The one change: `Action` `answer` gains an optional `message`, the
  note to the agent, which the supervisor already supports.
- **The Waits list** is a query, never a store (waiting-on-casper 2):
  - open questions and actions, with `session_waits_on` folded onto them (notes 23);
  - items In Review with an unchecked `casper_gate` criterion;
  - backlog bugs with `blocks_use` that aren't archived;
  - pending human-tier permissions from the snapshots.

### 8. Operations, the protocol and the MCP tools

`packages/protocol/src/board.ts` defines every operation once, as a zod discriminated union
`BoardOp`, with its result types. Two transports carry it:

- **The socket:** a new client frame `{ t: "board_op", rid, as, ctx?, op }`, answered by `ok` or
  `error`. Frames stay at 64 KB. New error codes, all additive: `invalid`, `conflict`, `unavailable`;
  `forbidden` is reused.
- **HTTP:** only for what doesn't fit a socket frame or a socket holder: export, import, CI.

To owner sockets, `Broker` pushes `{ t: "board_changed", project, seq, refs }` after each write, and
the dashboard refetches what it shows. Nothing pushes whole boards.

Agents get **seven tools**, few on purpose because every tool's schema costs context on every call.
They are served by the supervisor in-process for workers (`worker-tools.ts`) and by the channel
client for interactive agents (`client/src/server.ts`):

| Tool | Does |
|---|---|
| `board_list` | Lists: a project's releases; a release's features; a feature's tasks and sessions; backlog items (the triage list). Filters: status, type, label, text. Summaries with counts, a cursor past 100. |
| `board_get` | One record in full by ref: item with criteria, links and sessions; release; session with its close; question. `history: true` adds its events. |
| `board_capture` | Title and a sentence, project (defaults to the caller's only project); optional type, release, `casper_words`, bug fields. Never asks back (§12). |
| `board_write` | `create`, `update` (fields), `criteria` (add, edit, check, uncheck with evidence), `slot` (backlog item into a feature, becomes a task), `promote` (becomes a feature), `archive` (with reason), `restore`, `order`. Checked per field against §5. |
| `board_ask` | Ask Casper a question or an action; `record_answer` from conversation. |
| `close_session` | §6. |
| `board_grants` | Read the project's rules; change them with `admin`. |

Owner-only operations (§5, §7) are in `BoardOp` but no MCP tool offers them. The supervisor's own
operations are `session_join`, `run_start`, `run_end`, `push` and `slot_run` (§9, §10).

The existing `board` frame and `ProjectBoard` stay for projects still on Backlog.md, and are removed
once the last one has moved (a later release says so). A project is on the service when the
supervisor's config says `board: service` instead of `backlog:` (Casper's config; Luigi adds the
option).

### 9. Runs, tokens and context per call (steps-view 7, 10; notes 36-38)

`runs`: one row per worker run: `id` (worker id and run number), `project`, `session` (NULL is Other
work), `agent`, `role`, `laptop`, `model`, `effort`, `started_at`, `ended_at`, `resumed`, tokens
(`input`, `output`, `cache_read`, `cache_write`), `calls`, `ctx` (context per call: a BLOB of
little-endian uint32s, up to 2000 points, downsampled to 400 on read), `remote_url`. No money column:
usage is tokens. `run_start` and `run_end` carry no `cost_usd`, `Board` computes none, and no board
view shows one; the protocol's `cost_usd` on `WorkerSnapshot` and usage rows goes optional now and is
removed with the legacy board (review finding 10).

**Session kinds.** `packages/protocol/src/board.ts` defines its own `SessionKind` as `design`,
`build`, `review`, `retro`. "Other work" is a run whose `session` is NULL, a bucket the views make,
never a kind a record holds. The legacy `SessionKind` in `frames.ts:157`, which includes `other`,
stays only as long as `ProjectBoard` does.

**Which side holds the truth for a run:**

- **While the run is live**, the supervisor holds it: its SQLite `workers` row, and the snapshot's
  tokens and `ctx`. `Board.runs` holds the `run_start` row with `ended_at` NULL, and the views take the
  live numbers from the snapshot.
- **From `run_end` on**, `Board.runs` holds it, and the dashboard reads only that. The supervisor's
  row is local bookkeeping: it may be swept by the supervisor's retention, and no view reads it for a
  project on the service.
- **A run whose `run_end` hasn't arrived** after its laptop's snapshot stops listing it shows
  "ending" while the laptop reports, and "unknown end" once the laptop's report is stale. The board
  never guesses tokens for it.

**When the broker is down at `run_end`:** the supervisor's own board operations (`run_start`,
`run_end`, `push`, `slot_run`, the orchestrator's run upserts) go through its outbox
(`store.ts:273-285`), not straight to the socket. The outbox gains a `kind` column (`message` for
today's rows, `board_op` for these) by an additive store migration. It is flushed in order on
connect, as today's rows are (`supervisor.ts:1392` `flushOutbox`), and a row is deleted only after the broker's
`ok`. Each operation is idempotent by key: `run_start` and `run_end` by run id (a second `run_end`
for an ended run is `ok` and changes nothing), `push` by (`repo`, `sha`), `slot_run` by its
`external_id`. A replay after a lost `ok` does no harm. `session_join` is not queued: spawn waits for
it (§12). §12's capture queue stays separate because captures come from every client, not only
supervisors.

- The supervisor sends `run_start` when a worker starts and `run_end` with tokens and `ctx` when it
  ends. A running worker's live context stays in the snapshot (`WorkerSnapshot.ctx`), as today.
- The orchestrator's share of a session (today `orchestrator` on `ProjectBoard` sessions) is a run
  of role `orchestrator`, upserted by the supervisor while the session runs.
- `board_get` on a session returns its runs with `ctx`, the feature's previous session of the same
  kind for the dashed line, and per role the p25/p50/p75 of earlier runs on the feature for the grey
  band. That moves `baseline` from the supervisor to a query.
- A closed session's tokens, a running agent's and the chart come from the same rows (notes 38).
  Every past session keeps its runs, not only the latest four.

The live layer stays in the laptop snapshot: who runs, state, tokens so far, pending requests.
`WorkerSnapshot` gains `declared: {feature, kind, label} | null` beside `session` (additive), so the
views join live agents to sessions and tasks by what the spawn declared, never by a brief (BOB-4 #4).

### 10. CI and run-slot runs, from anywhere (steps-view 11, BOB-4 #6)

`ci_runs` holds both kinds of run:

- **Fields:** `source` (`github-actions`, `buildkite`, …, or `slot`), `external_id` (UNIQUE with
  source), `project`, `name` (workflow and job, or the slot's label: `land`, `e2e`), `url`, `repo`,
  `branch`, `sha`, `laptop` (slot runs), `status` CHECK (`queued`, `running`, `passed`, `failed`,
  `cancelled`), `started_at`, `ended_at`.
- **Tie:** `worker`, `session` and `tasks`, resolved when the run is reported, never parsed.

**How runs report in:**

- **Any CI, anywhere** (Casper, round 3): `POST /v1/runs` with a CI service token, one JSON body per
  start and per end (the fields above). It is a two-line step at the start and end of any pipeline;
  `docs/ci-reporting.md` gives the curl and a GitHub Actions example.
- **GitHub Actions without a secret in GitHub:** the supervisor's existing `gh run list` poll
  (`board.ts` `ciRuns`) becomes an adapter that reports the same records, as source `github-actions`.
- **Local runs:** the supervisor reports each run-slot grant and release (`slots.ts` `onGrant`,
  release) as `slot_run`, with source `slot`. The holder is a worker id, so the tie is direct. Who
  is queued for a slot is live state: the snapshot gains `slots: {holders, queue}`.

**The tie without parsing:** the supervisor knows what it pushes. After a successful `land` it reads
the pushed commit and sends `push {repo, branch, sha, worker}`. `Board` matches a CI run's (`repo`,
`sha`) to a push, which names the worker and so its session and tasks. A run with no matching push
(an interactive agent pushed it, or a schedule did) ties to its project and branch only, and shows on
the project, not on an agent.

**"Usually about N min"** is the median duration of the last 20 finished runs of the same (`project`,
`source`, `name`), or (`laptop`, `name`) for slot runs, that passed. It is shown once there are three.
**Running long** is past 1.5× that (notes 47). An agent shows "waiting on CI" while a run tied to it
is `running` or `queued`. This is derived, not a worker state.

### 11. Export, backup and import (board-service 11, BOB-2 #11)

- **`GET /v1/board/export`** (a laptop's identity) returns the whole board as one JSON document,
  `{ format: "bobnet-board", version: 1, exported_at, last_event_seq, projects: [...] }`. Each project
  carries every table of §2 as arrays of its rows, with refs instead of `pk`s and `ctx` as a number
  array. Keys and rows are in a stable order, so the nightly git diff shows only what changed. The
  shape is a zod schema in `packages/protocol/src/board-export.ts`, and Luigi documents it at
  `docs/board-export-v1.md`. A new version is a new number, and the importer reads every version
  it knows.
- **Nightly backup:** the supervisor on mbp-1, with `board_backup: {repo, at}` in its config, fetches
  the export, writes `board.json` and commits it. It is a backup and an exit route, never a second
  store: nothing reads it back except an import.
- **`POST /v1/board/import`** takes the same shape and imports into projects that don't exist yet. It
  refuses a project that does exist, so it can rebuild an empty service and it can bring a project
  in, never merge. The history it brings is kept, plus one event: "imported from …".
- **The Backlog.md import (BOB-9)** is a supervisor command that reads a project's Backlog.md at a
  named commit with today's reader (`board.ts` `parseBacklogItem`, the only Markdown reader that
  survives), plus Helix's `lead/questions.md` for `Q-n` and `A-n`. It writes that same export shape
  and posts it to the import. It is the one place Markdown is read, and it runs once per project.
  Its report lists what it couldn't map (a task whose milestone differs from its feature's, a
  dependency on a missing id), for the PO to settle before the cut-over. A feature in flight at the
  cut-over gets an open session marked `imported`, so `open_since` holds (BOB-9 #5).

### 12. When the broker can't be reached (C4, BOB-2 #12, BOB-8 #2)

- **Reads and writes wait.** A board tool waits up to 60 seconds for the connection, then fails with
  "the board is unavailable since …; wait and retry". It doesn't hang a worker into the stall
  detector. `session_join` at spawn waits the same way, so a spawn into a session fails clearly
  rather than starting outside it.
- **Capture never waits.** `board_capture` writes the capture to a queue on the laptop, a file per
  capture under `~/.local/state/bobnet/capture-queue/`, with a `capture_id` (UUID) made on the laptop.
  It sends the capture, and returns its id if the broker answers within two seconds, else "queued;
  it gets its id when the board is back". The supervisor and every channel client flush the folder
  on connect. `capture_id` is UNIQUE in `items`, so a capture sent twice from two processes is
  stored once and the second send returns the same id. The queue is a small module in
  `packages/client`, which the supervisor already imports.
- **The dashboard** shows the board unavailable (`#states`), and Casper's captures queue in the
  browser's `localStorage` the same way, with the same `capture_id`.

## What Luigi builds first

1. **BOB-2's core, no UI, in this order:**
   - `packages/protocol/src/board.ts` (`BoardOp`, records, results);
   - the `Board` Durable Object with the §2 schema as migration 1, and the `BOARD` binding;
   - the operation layer with events (§3) and grants (§5, the rule check is in from the first write,
     so BOB-7's mechanism lands with it);
   - `board_op` routing in `Broker` with the caller and `ctx` (§4, §8).

   Tests first: an invalid status, a dangling parent and a cross-project link are refused (criterion
   0); ids survive a move and are never reused; every write has its event; a builder's status write
   is refused with its reason; Helix's two PO rows behave.
2. **The tools** (§8) in `worker-tools.ts` and the channel client, `session_join` and the run reports
   (§9) in the supervisor, the capture queue (§12), and `close_session` (§6).
3. **Export and import** (§11), then **BobNet's own board** imported through it as the pilot (it is
   ours, small, and on Backlog.md since 2026-11-13), then Helix (BOB-9) at Picard's date. Casper
   decided this order on 2026-11-14 (decision 2 in the lead file). Dashboard answers to Helix's
   questions come with BOB-9, after the pilot (§7).
4. **The views** (BOB-3, 4, 5, 8, 10) on `board_op` reads, the gates (BOB-7 #3, #4), and CI (§10).

Before step 1, Luigi fixes the review's findings 1-3: the stale-tip land, the owner JWT as a bearer
token to laptops, and the supervisor's ack before a message is consumed (decision 3). Nothing goes
live without a release and a broker deploy, which runs only when Casper asks for it.

## Consequences

- The board is one more Durable Object in the same deploy, with its own SQLite and its own recovery.
  Deploying a change to it drops every agent's connection, as any broker deploy does (C7).
- Agents need the broker for board work, as they do for messages (C4). Capture alone queues.
- Authorisation is data. A project's rules change without a deploy, and every change is in the
  history.
- The supervisor stops computing sessions, baselines and boards for projects on the service. It
  reports runs, pushes, slot runs and session joins instead. `board.ts` keeps only the Backlog.md
  reader for the import and for projects not yet moved.
- The protocol grows additively: a new frame, a new server frame, new error codes, new optional
  fields on `WorkerSnapshot`, `LaptopSnapshot` and `Action`, and a new `Identity` kind on the HTTP
  routes. Old clients ignore what they don't know; an old supervisor keeps sending `board` frames,
  which still work.
- Release 2's question of how a project declares its gates and session kinds (start-session.md) gets
  a home: project rules beside `grants`. It is a separate ADR, then.

## Alternatives considered

- **Tables in the `Broker` object** (my advice T1): simpler, with no RPC, and frame handling would keep
  running to completion. Rejected because point-in-time recovery would tie the board's mistakes to
  the message store's (§1). The cost is the await rule in §1.
- **Run ends sent straight to the socket, lost when the broker is down:** rejected. A run's tokens
  would vanish from the board's record. They go through the outbox (§9).
- **One Durable Object per project:** isolation. Rejected because Overview and Waits read across
  every project, and cross-object reads for one screen cost more than the isolation is worth at five
  projects.
- **D1:** a separate service and binding, for a load one object handles. Rejected.
- **An event-sourced store, with state rebuilt from the log:** rejected (§3).
- **A table per kind:** rejected because ids would have to move between tables when a backlog item
  becomes a task or a feature (§2).
- **A second MCP server for the board:** rejected. Agents already have the BobNet server, with
  identity stamped (README T1).
- **CI only via `gh` on the laptop:** it covers GitHub only, and only repos checked out on a laptop.
  Kept as an adapter beside the HTTP route (§10).
- **Tying CI runs to agents through checkpoints or briefs:** that is parsing. Rejected for the push
  record (§10).
- **Writing Casper's answers into Helix's `lead/questions.md`:** BobNet would become a writer of a
  project's files. Rejected (§7).

## Where I differ from the criteria, or sharpen them (for Peach)

1. **Bug as a kind** (board-service 0, BOB-2 #1): a bug is an item of type `bug` with bug fields, not a
   kind of its own (§2). Kinds are feature, task, backlog item; bugs.md already says it is captured
   like any backlog item.
2. **"Only description and notes are free text"** (criterion 0) is too narrow as worded. Titles,
   criterion text and evidence, question text, answers, Casper's words, reasons and a close's summary
   are free text too; none of them holds structure. Suggest: "no field holds structure as text". Also:
   Backlog.md's Implementation Plan section. Is it a field `plan`, or does it go into `notes` at
   import? Peach decides.
3. **A feature's release vs. triage** (conflict): capture.md 5 and BOB-8 #6 let the PO put an item in a
   release or take it out. board-writes 4 and BOB-7 #3 make that Casper's gate, and board-service says
   release scope is Casper's. Recommendation: **a feature's release is Casper's alone. A backlog item's
   release is the PO's and Casper's** (a triage field, not scope). Promoting a backlog item to a feature
   puts the feature in no release, and Casper's gate puts it in one. Peach to rule.
4. **Answers given in conversation** (waiting-on-casper 4, BOB-5 #4, BOB-7 #5): "anyone else is
   refused" holds for the dashboard answer. The project's lead or PO records an answer Casper gave in
   conversation, marked as such (§7). Casper may withdraw his own answer within two minutes (Undo).
5. **Review gates** (BOB-5 #1) need a record: I propose `casper_gate` on a criterion (§2). Peach to
   confirm. Then "review-gated items" are items In Review with such a criterion unchecked.
6. **"Needed before"** (BOB-5 #2) is a field: a link to an item or release, or a short text. Peach to
   confirm the field.
7. **The close's tasks moved and tokens** (BOB-2 #8): the close *applies* its status moves, and the
   tasks moved are read from the log, tagged with the session. Tokens come from run records, not from
   what the session declares. Suggested wording: "tokens from BobNet's run records".
8. **Broker down** (BOB-2 #12): "agents wait" means a call waits up to 60 s and then fails with a
   clear reason for the agent to retry. It doesn't block forever.
9. **CI** (BOB-4 #6): a CI run ties to an agent only through a push the supervisor made (`land`). A
   run from anything else shows on its project and branch, not on an agent. "Usually" appears once a
   name has three passing runs. Peach to accept that as the criterion's meaning.
10. **Dropped items** are archived with a reason, not given a sixth status (board-service 8 holds).
11. **Migration order** (migration.md): BobNet's own board first, as the pilot through the same import
    path, then Helix. Casper decided it on 2026-11-14.
12. **BOB-3 #8 and BOB-2 #10** (Helix-sized fast): agreed. Lists are aggregate queries (§2).
13. **BOB-9 #7**, "removed from its repo": agreed. Markdown is read only by the one-off import.

BOB-6 (release 2) I have read. It gets its own ADR when it is next.
