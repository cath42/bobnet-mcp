# 0005. Project status: the status read, run outcomes, theme tags and the lead's note

- **Status:** accepted (Toad, 2026-11-15) for BOB-33 (tasks BOB-37 status read, BOB-38 run outcome),
  BOB-35 (theme tags) and BOB-36 (the lead's note). The rulings, one per item:
  `reviews/2026-11-15-bob33-status-rulings.md`. Amended 2026-11-15 (Toad): §2 gains what Daisy's
  spec draws (consult c_f1c4cbc5, `design/BOB-33/spec.md` "What the read gains"), when the dashboard
  reads, and projects still on Backlog.md; §5's `newer` is split by kind.
- **For:** `product/requirements/project-status.md` (537c7f7), Casper's Q-2 to Q-5. It extends ADR
  0001 (§2 schema, §5 grants, §6 close, §8 reads, §9 runs, §11 export) and doesn't change any of
  its rules.

## Context

Casper comes back after a night or a workday and wants one page that says whether he needs to do
anything and whether it is going OK, over the span since his last visit on that device. Almost all of
it is already on the board (the requirements' table "What exists"): waits, events, sessions and their
closes, pushes, CI and slot runs, runs with tokens, items with criteria. Four things are missing: a
read that puts them together over a span; how a run ended; a theme on review findings and retro
findings; and a lead's short note. The Board object serves reads in one call each (ADR 0001 §8), and
the dashboard reads them; nothing typed in except the note.

## Decision

### 1. The span stays on the device

The last visit is kept in the browser's `localStorage`, per device, as requirement 1 says. I agree:
it is a view preference, not board data, and nobody else reads it. One change: the dashboard stores
the **broker's** time, not the device's. The status reply carries `at` (the Board's now), and
"I'm caught up" stores that reply's `at`. A phone whose clock is a few minutes off then neither
skips nor repeats what happened around the tap. A first visit sends `since` = now − 24 h; the chips
send now − 24 h and now − 7 d and leave the marker alone. If Casper later wants it to follow him
across devices, it is a per-device-key setting (ADR 0003), not a board record.

### 2. The status read (BOB-37)

`status {project?, since}` joins `BOARD_READS` (`protocol/src/board.ts`). Like `waits` and
`overview` (ADR 0001 §8) it is derived on read, stores nothing, and is not an MCP tool. **One call
covers every project the caller reads**, or the one named; a project it can't read is left out. The
Status tab makes one call for the digest and every project page; tapping a project doesn't read
again. `since` is clamped to at most 31 days back, and the reply says what it used. A project still
on Backlog.md (not on the service) has no row: the Board doesn't know it. The dashboard names such
projects from the laptops' snapshots, as the Overview does, and says Status starts when they move.

```
status {project?, since} → {
  at, since,                       // the Board's now; the since it used
  projects: StatusRow[]            // in the overview's project order
}
StatusRow {
  project, name,
  note: LeadNote | null,           // §5; null until BOB-36 ships, and when there is none
  waits: WaitRecord[],             // waitsOf(p), the very list the waits read returns
  done: {
    counts: { features, sessions, lands, releases },
    features: [{ ref, title, type, release, at }],      // moved to Done in the span and still Done
    sessions: [{ session, ended_at, need, summary, closed_by,
                 tokens: TokenTotals, lost,              // all the session's runs; lost: its runs in `lost`
                 counts: { blockers, majors, sent_back } }],
    releases: [{ ref, title, closed_at }],
  },
  stuck: {
    runs: [{ id, agent, role, session, outcome, reason, ended_at }],        // §3
    ci: [{ source, name, branch, sha, url, worker, session, ended_at }],     // failed, not passed since
    idle_sessions: [{ session, since }],               // open, no live run, quiet over 2 h
    idle_features: [{ ref, title, since }],            // In Progress, not open, over 2 h
    answered_holding: [{ ref, answered_at, feature }], // answered over 2 h ago, no run on its work since
    settled: [{ kind, entry, settled_at }],            // stuck and settled, both in the span
  },
  recurring: Recurring | null,     // §4; null until BOB-35 ships
  backlog: {
    ready: [{ ref, title, release, criteria }],        // Ready features with criteria, next_ready's order
    sessions_estimate: number | null,
    no_criteria: [{ ref, title }],                     // features not Done, not archived, no criteria
    triage: { count, oldest: { ref, at } | null },
    release: { ref, todo, ready } | null,              // the open release: its features not Done, and Ready
    thin: boolean,
  },
  usage: {
    tokens: TokenTotals,                               // runs that ended in the span
    by_agent: [{ agent, role, tokens: TokenTotals, runs, lost }],
    heavy: [{ session, kind, tokens: TokenTotals, usual: TokenTotals }],
    lost: number,                                      // runs that ended in the span with tokens unknown (§3)
  },
}
```

Every list is newest first except `waits` (oldest first, as on Waits), capped at 100 with a `more`
count beside it. Each entry carries the ref the dashboard links to. **What each part means**, and
what settles it (requirement 5: when the source says it is settled, it leaves):

- **Needs you** is `waitsOf(p)`, the function behind `waits` and `overview.waits_on_you`, so the
  counts can't disagree. Permission requests are live supervisor state, not board data: the
  dashboard adds them from the laptop snapshots, as the Waits tab does. "Older than the span" is
  the dashboard comparing a wait's `since` with `since`.
- **Done.** A feature counts when its last `status` event to `Done` (an `items` event with an
  `event_changes` row `status → Done`) is in the span and it is still Done; one moved back drops
  out; `type` lets the page say "bug fixed". Sessions: `ended_at` in the span, with `tokens` the
  sum of all the session's runs (all four kinds, the same total `heavy` compares), `lost` how many
  of them ended `lost` and so aren't in `tokens`, and `counts` its close's `session_tasks` rows by
  `role`. The kind is in the `SessionRef`. Lands: `pushes.at` in the span, a count. Releases:
  `closed_at` in the span. **Deploys are not recorded** and the page shows none (§7).
- **Stuck:**
  - *runs*: a run that ended in the span with `outcome` `failed`, `stopped` or `lost` (§3). Settled
    when a later run starts in the same session; a run with no session is settled by a later run of
    the same agent in the project. A run with no outcome (before §3) is never listed.
  - *ci*: a `ci_runs` row (slot runs included) that `failed` in the span, with no later `passed`
    row of the same `source`, `name` and `branch`. Settled by that pass. This is also the top
    screen's "red CI".
  - *idle sessions*: open (`ended_at` null), no run of the session with `ended_at` null, and the
    last of `started_at` and its runs' `ended_at` more than 2 h ago. Settled by a run or the close.
  - *idle features*: status In Progress, `open_since` null, and its last session ended (or, with
    none, its last status event) more than 2 h ago. Settled by a session or a status move.
  - *answered and still holding*: a question `answered` more than 2 h ago, that holds items or
    sessions or that a session waits on, where no run has started on the feature those name since
    `answered_at` and not every held item is Done. Settled by a run on that feature.
  - *settled*: what was stuck in the span and has settled in it, so the page can say what cleared
    while he was away. Three kinds, each with a stored time it turned stuck and a stored time it
    settled: `runs` (the run's `ended_at`; settled at the later run's `started_at`), `ci` (the failed
    row's `ended_at`; the pass's `ended_at`) and `answered_holding` (`answered_at` + 2 h; the run's
    `started_at`, or the last held item's move to Done). Both times are in the span. `kind` names
    the list, `entry` is the entry that list would have shown, newest `settled_at` first. Idle
    sessions and idle features aren't listed: they turn stuck in a gap between records, and finding
    past gaps means walking every session's runs, for what is mostly someone getting back to work.
  - "2 h" is Peach's default and a constant in the store, not a parameter.
- **Backlog health.** `ready` is the overview's `next_ready` with criteria counted, those with at
  least one. `sessions_estimate` is `ready.length` × the median number of sessions per feature over
  the project's last 20 Done features, rounded; null with fewer than 3. `thin` is fewer than 2 Ready
  features with criteria while `release.todo` > 0 (Peach's default). `release.ready` counts the open
  release's features that are Ready with criteria, counted as `ready` is; the page flags "nothing
  Ready" when it is 0 and `todo` > 0. Only the open release is flagged, not the next. `triage.oldest`
  is the backlog item in triage created first, with its `created_at`; null when triage is empty.
- **Usage.** Tokens of runs whose `ended_at` is in the span, so a run counts once, in the span it
  ended. A live run is not on the board yet (ADR 0001 §9: its truth is the snapshot), so the read
  leaves it out; the dashboard may show it from snapshots, labelled as running. `heavy` is a session
  closed in the span whose total tokens (all four kinds) are more than twice the median of the
  project's sessions of its kind closed in the 30 days before, when there are at least 5 to compare;
  `usual` is that median. `by_agent[].runs` counts the agent's runs that ended in the span, `lost`
  how many of those are `lost`, and `tokens` sums the others; an agent with only lost runs is listed
  with zero tokens and its `lost`. `usage.lost` stays the project's total. Tokens only, never money.

**When the dashboard reads.** One call serves the whole tab, so the dashboard reads on
`board_changed` for any project, at most once per 5 s and only while Status or the Overview shows;
otherwise every 60 s, for the dot on the tab. The dot and the Overview's line read with `since` = the
device's marker; while a chip is pressed the tab reads its span as well, so two reads, never more. A
refetch keeps what is on screen until the reply. At most twelve reads a minute per open dashboard,
each under 250 ms on a Helix-sized board, is well within what the Board object serves.

**Cost on a Helix-sized board.** Per project the read runs about a dozen bounded queries; none
walks a whole table that grows without end. Three tables grow with time and get an index on their
time column in the migration of §3: `events (project, at)`, `runs (project, ended_at)` and
`ci_runs (project, ended_at)`. `sessions`, `releases`, `pushes`, `questions` and the items of one
project are small enough to filter per project (Helix: 29 features, ~700 tasks). The scale test goes
next to `board-scale.test.ts`: the Helix-sized board plus a month of work (300 sessions, 1,500 runs,
3,000 CI runs, 20,000 events, a second project), and `status` across every project with a week's span
stays under the file's 250 ms, slowest of three, like the other reads. The reply is well inside the
socket's limits: a week of Helix is about 100 session summaries of at most 300 characters.

### 3. How a run ended (BOB-38)

`run_end` gains `outcome` (`done`, `failed`, `stopped`, `lost`) and `reason` (text, at most 300,
null for `done`), both optional, so additive. They are the supervisor's own exit states
(`supervisor/src/worker.ts:40`): `done` is the requirement's "finished", `failed` carries the
error, `stopped` the stop reason ("stopped by the orchestrator").

- **`lost`** is a run whose end the supervisor didn't see: it was running when the supervisor
  restarted, which today marks the worker `failed: supervisor restarted` (`supervisor.ts:270`) and
  sends no `run_end`, so its board run stays open for good. From this release the startup sweep
  sends a `run_end` for each such worker on a project on the service, through the outbox, with
  `outcome: lost`, `ended_at` the sweep's time, and tokens zero, because the supervisor never
  stored them (it keeps usage only at exit). `lost` tells the reads the zeros are unknown, not
  zero: usage counts these runs in `lost` and never as zero tokens (ADR 0001 §9: the board never
  guesses tokens).
- Schema: `runs` gains `outcome TEXT CHECK (outcome IN ('done', 'failed', 'stopped', 'lost'))` and
  `outcome_reason TEXT CHECK (length(outcome_reason) <= 300)`, both nullable. Old runs keep null and
  read as **unknown**. `RunRecord` gains both as optional; `run_end`'s event records them.
- A run that ended before this release keeps its null; nothing is backfilled from supervisor logs.
  Runs left open by past restarts stay open, so their sessions don't show as idle until they are
  closed; the sweep stops that from happening again.

### 4. Theme tags on findings (BOB-35)

**A closed list, in the protocol**, the same for every project: `Theme` in `protocol/src/board.ts`.
Free labels split one problem into many ("auth", "authz", "rights") and grouping, the reason the tags
exist, stops working. A closed list in the tool's schema is what an agent picks from, so it picks
consistently. Per-project lists would need a table, an admin operation and a dashboard to edit them,
for a vocabulary that is mostly the same across software projects. The list to start:

| Theme | For |
|---|---|
| `criteria` | doesn't meet its acceptance criteria, or does something else |
| `correctness` | wrong result, logic error |
| `tests` | missing or weak tests or evidence |
| `security` | rights, authentication, secrets |
| `data` | schema, migration, loss, consistency |
| `compat` | protocol, rollout, version skew |
| `concurrency` | races, ordering, idempotency |
| `errors` | failure paths, error handling |
| `performance` | slowness, cost at scale |
| `ux` | behaviour and look on screen, phone and tablet |
| `docs` | docs, ADRs, comments out of date |
| `briefs` | unclear or wrong brief, scope, plan |
| `coordination` | handoffs, waits, messages between roles |
| `tooling` | BobNet, CI or the tools got in the way |
| `tokens` | a run or session used far more than it needed |
| `other` | none of these |

Peach may change the list; adding a theme is additive (broker first, §6). Removing or renaming one
isn't: old closes keep the old value, so the read shows it as it is.

**Who sets them and when:** whoever closes the session (the `sessions` grant, ADR 0001 §6), at the
close, and nobody afterwards. The close stays write-once. `close_session` gains two optional fields:

```
themes:   [{ task: ItemRef, theme: Theme }]     // each task one of this close's blockers or majors; one theme each
findings: [{ theme: Theme, text: ≤ 300 }]       // a retro's findings, at most 20; refused on other kinds
```

A theme for a task that isn't in `blockers` or `majors` is `invalid`. A retro finding is a record
now, not only a line in the handoff: retros have no tasks to tag, and requirement 4.4 needs their
themes. The handoff stays free text, never parsed.

**Storage:** `session_tasks` gains `theme TEXT` (null, or 1 to 40 characters); a new table
`session_findings (pk, project, session, ord, theme, text)` with the composite foreign key to
`sessions`. The schema's CHECK guards the length only; the protocol's enum is the list, so adding a
theme needs no table rebuild (as `ci_runs.source`).

**Old closes** keep null themes and have no findings. The read counts their blockers and majors
under **untagged**, never guessed from the summary or the handoff. A retro closed before this has
no findings and adds nothing.

**The read**, `StatusRow.recurring`:

```
Recurring {
  themes: [{ theme | "untagged", findings: [{ session, task?, role: blocker|major|finding, text? }], sessions: n }],
  sent_back: [{ feature, sessions: [SessionRef] }],   // features sent back in 2 or more closes
  repeated: [theme],                                  // themes in 2 or more sessions
}
```

A group covers closes in the span; `sent_back` and `repeated` look back 30 days from now and list
only those with at least one close in the span, so a problem that came back last night shows even if
its first time was last week. Each group lists its sessions, which the page links.

### 5. The lead's note (BOB-36)

- **Record:** `lead_notes (pk, project, text, author, at)`, `text` 1 to 600 characters (about three
  sentences), `author` the caller's address as events name it. Append-only: a new note is a new row,
  the latest by `pk` wins, earlier ones stay as history. Each write is an event (`note`, `lead_notes`).
- **Who writes it:** a new grant flag, `notes`, beside `sessions`, `questions` and `admin` (ADR 0001
  §5): `grants` gains `notes INTEGER NOT NULL DEFAULT 0 CHECK (notes IN (0, 1))`. A grant row is per
  project, so "a lead of that project" is a row with `notes` on it. The owner doesn't write notes;
  another agent is refused `forbidden` ("Luigi may not write bobnet's note; Mario does"). Peach sets
  the flag on the lead's row with `board_grants` (for BobNet: Mario); the `grant` op and the tool's
  description gain `notes?`. Seeding a new project sets it on the row of the project's `lead`.
- **Which tool:** no new MCP tool (every tool costs context on every call, ADR 0001 §8).
  `board_write` gains the operation `note {text}`, a `BoardOp` `note {project, text}`. It is
  idempotent by its operation key, like every write (ADR 0001 §12).
- **How the latest is read:** `StatusRow.note` is `{ text, author, at, newer }` or null. `newer` is
  `{ sessions, features, releases }`, the facts after `at` in that project: sessions closed,
  features moved to Done, releases closed. The page marks the note old when any is above 0 and
  says which ("4 things since: 4 sessions closed"); with no note, nothing.
  `board_get` doesn't return it, and no other read does.

### 6. Rollout

The broker carries the dashboard (`public/`), so the Status tab ships with the broker deploy that
serves its read. Each step needs Casper to ask for that deploy.

1. **BOB-33: broker deploy.** Board migration 3: `runs.outcome`, `runs.outcome_reason`, and the three
   indexes. The `status` read, `run_end`'s optional fields, the Status tab and the Overview line. The
   page works at once; failed runs appear once step 2 is live, and until then runs read as unknown.
2. **BOB-33: supervisor release** (Mario), after step 1: `run_end` sends `outcome` and `reason`, and
   the startup sweep sends `lost`. An old broker would strip the optional fields (supervisor ops
   aren't strict), so the order is for the data, not for safety.
3. **BOB-35: broker deploy**, then the release. Migration 4: `session_tasks.theme`,
   `session_findings`. The broker first: `close_session` isn't strict, so an old broker given
   `themes` would answer `ok` and drop them unseen. Then the release with the new `close_session`
   shape in `client/src/board-tools.ts`, which the supervisor bundles; interactive agents get it with
   the channel client from the same release.
4. **BOB-36: broker deploy**, then the release. Migration 5: `grants.notes`, `lead_notes`. Then Peach
   sets `notes` on Mario's row, then the release with `board_write`'s `note`. An old broker refuses
   `note` (`invalid`), so a client ahead of its broker fails loudly, not silently.

The export (ADR 0001 §11) stays version 1 and gains optional fields: `Run.outcome`,
`Run.outcome_reason`, a session's `tasks[].theme` and `findings`, a project's `notes` and a grant's
`notes`. Import restores them. An old supervisor's backup parses the export and drops what it doesn't
know, so its nightly file lacks them until it is upgraded; the broker's own export has them all along.

### 7. Deploys

Nothing records a broker deploy, and this ADR doesn't add one: the page shows releases closed, as the
requirements allow. When Casper wants deploys on it, the deploy script posts a `ci_run` with source
`deploy` (ADR 0001 §10: any source, upserted by `external_id`), which needs no schema change and
shows under done when it passed and under stuck when it failed. Captured for Peach to triage.

## Consequences

- The Status page is one read and one tab; the needs-you count is the same function as Waits and the
  Overview, so it can't drift.
- Three more indexes cost a little on every event, run end and CI row; they keep the read bounded
  as the board grows.
- A run's end is now on the board, and runs lost to a supervisor restart stop staying open.
- Agents closing a review or retro pick a theme from sixteen. A badly picked theme groups wrongly;
  `other` and `untagged` stay visible so a gap in the list shows.
- One more grant flag and one more `board_write` operation; no new MCP tool.

## Alternatives considered

- **One read per project.** Requirement 7 asks for one read; the digest needs every project anyway,
  and the per-project page is a slice of the same reply.
- **Store the status, or keep counters.** Derived on read is the board's pattern (ADR 0001 §8):
  nothing to keep in step, and a settled item leaves by itself.
- **The last visit on the broker.** It would need a per-device record or the owner's account for a
  view preference. Kept on the device, as requirement 1 says.
- **Free theme labels, or per-project lists.** See §4.
- **Inferring themes for old closes from their text.** The board never parses free text (ADR 0001 §2).
- **The note as a feature's notes field or a session summary.** It belongs to the project and a span
  of work, not to a feature, and its writer is the lead, not whoever holds `content`.
- **A `board_note` tool.** One more tool's schema in every agent's context for one lead's write.
- **Using the `sessions` grant for the note.** Session POs hold it too; requirement 6 says only a
  lead.
