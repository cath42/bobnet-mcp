# 0010. Starting a session from the UI: declared gates, a start request, the supervisor decides

- **Status:** accepted (Toad, 2026-11-22), for BOB-6 (session `BOB-6 design A`). Builds on ADR 0001 §2,
  §5 and §6 (records, rules, sessions), ADR 0003 §1 (which owner authority), ADR 0007 (one orchestrator)
  and ADR 0009 (notice rows, the project's supervisor). Line numbers are at d26bc6e. The build brief
  is `architecture/bob6/build-brief.md`. Daisy designs the screens (`design/BOB-6/`). My answers to
  her consult c_6a8417f4 are what this ADR rules.

## Context

Casper wants to start a feature's next session from his phone (`product/requirements/start-session.md`,
BOB-6). Today poe writes each spawn's brief by hand. The board lives in the service (C5), so the
rules that say when a session may start can be the project's data too. Nothing like that exists yet:

- **Sessions start only from spawns.** `spawn_worker`'s `session` (`supervisor/src/mcp.ts:100`) makes the
  supervisor call `session_join` (`supervisor.ts:856`). That creates the session and sets the feature's
  `open_since` (`board/store.ts:1673-1711`). `session_join` checks only that the feature exists, isn't
  archived, and isn't in a closed release. It knows no gates.
- **No gates are declared anywhere.** "Helix allows one open feature at a time" and "review only once it is
  built" live in prompts and in poe's judgement. The tables (`board/schema.ts`) have `projects`,
  `grants` and `grant_fields`, and nothing about session kinds. `sessions.kind` is CHECK'd to the four
  kinds (`schema.ts:141`).
- **There is a delivery path.** ADR 0009 writes a `notices` row in the write's transaction
  (`schema.ts:422`). The broker drains it (`broker.ts:411`) to the project's supervisor, which it picks
  from `laptop_supervisors` (`broker.ts:501`). That supervisor forwards it to its orchestrator
  (`supervisor.ts:1386`). This works when the supervisor is on another laptop, or offline, because the
  message waits in its queue.

## Decision

### 1. A project declares its session kinds and limits, as board data next to its rules

**Board migration 7** adds the following:

```sql
CREATE TABLE session_kinds (                -- the kinds Start offers, one row each; none: Start is never offered
  project INTEGER NOT NULL REFERENCES projects (pk),
  kind    TEXT NOT NULL CHECK (kind IN ('design', 'build', 'review', 'retro')),
  after   TEXT CHECK (after IN ('design', 'build', 'review', 'retro')),   -- needs a closed session of this kind
  skill   TEXT CHECK (length(skill) <= 300),  -- the project's skill for it: a name or a repo path, shown as is
  PRIMARY KEY (project, kind)
);
CREATE TABLE session_kind_statuses (        -- the feature statuses a kind starts on
  project INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  status  TEXT NOT NULL CHECK (status IN ('Draft', 'Ready', 'In Progress', 'In Review', 'Done')),
  PRIMARY KEY (project, kind, status),
  FOREIGN KEY (project, kind) REFERENCES session_kinds (project, kind) ON DELETE CASCADE
);
ALTER TABLE projects ADD COLUMN open_features_max INTEGER CHECK (open_features_max > 0); -- null: no limit
ALTER TABLE projects ADD COLUMN next_start INTEGER NOT NULL DEFAULT 1 CHECK (next_start > 0);
ALTER TABLE grants ADD COLUMN gates INTEGER NOT NULL DEFAULT 0 CHECK (gates IN (0, 1));
```

Rows, not JSON, as ADR 0001 §2 requires. The four kinds stay fixed. A project chooses which of them it
offers, with what gate and which skill. It can't invent a fifth kind, because `sessions.kind` couldn't hold it.

**The declaration is written whole** with a new op, `set_gates`, and read with `gates`:

```
set_gates { project, kinds: [{ kind, statuses: Status[] (≥ 1), after: Kind | null, skill: string | null }],
            open_features_max: int | null, reason? }
```

- `set_gates` replaces the project's rows. Any kind it doesn't list is not offered. Each change is an
  event on `projects` / `session_kinds`, as for any write (ADR 0001 §3).
- **Who may write it: a new grant flag, `gates`**, next to `sessions`, `questions` and `admin`
  (`rules.ts:39`). The owner holds it, as he holds every flag (`rules.ts:118`). Peach decides who holds it
  (ADR 0001 §5), and that is the project's PO under C1 and C2: Peach on bobnet, Helix's PO on helix. An
  admin applies the grant. A refusal names the holders (`requireFlag`, `rules.ts:121`).
- The `grant` op gains `gates?: boolean`. **If it is absent, the row keeps its current value.** An old
  client re-granting a PO therefore doesn't take the flag away.
- `board_grants` shows the declaration with the rules ("next to its rules"). `board_write` gets `set_gates`.
- **Until a PO writes a declaration, Start is offered nowhere.** No rows are seeded and nothing is
  hard-coded for Helix. The rollout depends on this (§7).

What the POs would write. This is their call; I propose it to them:

| | design | build | review | retro | open features |
|---|---|---|---|---|---|
| **helix** | Ready | Ready, In Progress; after design | In Progress, In Review; after build | In Review, Done; after review | 1 |
| **bobnet** | Ready | Ready, In Progress | In Progress, In Review; after build | In Review, Done; after review | none |

### 2. The service evaluates the gates, the same way for the offer and for the request

There is one function in the store, `startCheck(project, feature, kind, label?)`. It returns ok, or the
**first** failing gate as a `code` and a `reason`. The reason is a sentence the service writes, and the
dashboard shows it verbatim:

| code | refused when | reason, e.g. |
|---|---|---|
| `kind` | the project doesn't offer the kind (on a request only; `start_options` leaves it out) | "helix doesn't start retro sessions from the dashboard" |
| `status` | the feature's status isn't one of the kind's | "LAND-56 is Draft; helix starts build on Ready or In Progress" |
| `after` | the kind has `after` and the feature has no closed session of that kind | "LAND-56 has no closed build session; helix starts review after build" |
| `closed` | the feature is archived, or in a closed release | "LAND-56 is in R3, which is closed" |
| `held` | an open question holds the feature or a session of it of this kind, or the last closed session has `need: casper` with a `waits_on` still open | "LAND-56 is held by Q-283" |
| `running` | a session of this feature and kind is open | "LAND-56 build A is running" |
| `pending` | the feature already has a pending start request | "S-4 already asks to start LAND-56 design" |
| `limit` | `open_features_max` is set and the open features (`open_since` set) plus the features with a pending request, other than this one, reach it | "helix allows one open feature at a time: LAND-55 is open" |
| `label` | on a request: a session with that feature, kind and label exists | "LAND-56 build A exists; name another label" |

- A second session on a feature that is *already* open doesn't count against the limit. Helix's review of
  its one open feature is allowed.
- A pending request counts as open for the limit. Two quick Starts on Helix can't both pass.
- **The gates bind Casper's Start, not spawns.** `session_join` stays as it is, and poe's own spawns are
  its call, as today (alternatives).
- Nothing here moves status. Starting sets `open_since` only through `session_join`, as now. Status moves
  stay the PO's, at session boundaries.

**`start_options { project, ref }`** is a read. It returns, for the feature:

```
{ kinds: [{ kind, ok, code?, reason?, label, brief }], pending: StartRequest | null, supervisor: string | null,
  requests: StartRequest[] /* the last 5 */ }
```

- `label` is the proposal: the first of A, B, C, … that no session of that feature and kind has.
- `brief` is §3's text.
- `supervisor` is added by the broker on its way back: the pick of §4 for this project, or null. The
  dashboard then knows up front that "no supervisor runs helix".
- `get` of a feature also carries `requests`, so `board_get` and the page show them.

### 3. The brief BobNet fills in

The store assembles one plain text per kind. The dashboard shows it in an editor. Casper may change
anything, and what he confirms is stored **verbatim**, with `edited: true` if it differs from what was
offered. The cap is 16,384 characters.

```
Start LAND-56 build A (helix): <title>.
Casper asked for it from the dashboard: start request S-4.

Session: { feature: "LAND-56", kind: "build", label: "A" }
Skill: <session_kinds.skill, or "none declared">

Last session: LAND-56 design B, closed 2026-11-21, need none, commit 1a2b3c4.
Summary: <its close's summary>
Handoff: <its handoff_path>; the text is in board_get session { feature: "LAND-56", kind: "design", label: "B" }

Casper's answers on LAND-56:
- Q-282, answered 2026-11-21 on the dashboard: <the question's text>
  Option: accept: Accept the prototype
  His words: <answer_words, verbatim>

Read the feature first: board_get LAND-56.
```

- **The last session's close** is the feature's most recently closed session, of any kind: its name,
  `summary`, `need`, `commit_sha` and `handoff_path` (`schema.ts:146-153`). The handoff *text* (up to
  64 KB, which ADR 0001 §6 stores) is named, not copied: on a phone it can't be edited, and the worker
  reads it with `board_get session`. "None yet" if there is no closed session.
- **The skill** is `session_kinds.skill`. It is the project's data, set by its PO, and is never read from the repo.
- **Casper's answers** are the project's questions and actions in state `answered` or `done` that hold the
  feature or one of its sessions (`question_holds`), or that are `needed_before_item` the feature. The
  newest come first. For each: the ref, the text, the option's key and text, and his words verbatim. If the
  list would pass the cap, the oldest are cut and a last line says "and N older answers: board_get
  LAND-56". His words are never cut inside an answer.
- The service assembles it, not the dashboard, so the test, the phone and the supervisor see the same text.

### 4. The start request: Casper's, broker-held, sent to the project's supervisor over ADR 0009's path

**`start_requests`** (migration 7) is board data, with the history as events:

```sql
CREATE TABLE start_requests (
  pk           INTEGER PRIMARY KEY,
  project      INTEGER NOT NULL REFERENCES projects (pk),
  ref          TEXT NOT NULL,                -- S-4, from projects.next_start
  feature      INTEGER NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('design', 'build', 'review', 'retro')),
  label        TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  brief        TEXT NOT NULL CHECK (length(brief) BETWEEN 1 AND 16384),
  edited       INTEGER NOT NULL CHECK (edited IN (0, 1)),
  state        TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'started', 'declined', 'withdrawn')),
  requested_at TEXT NOT NULL,
  seq          INTEGER NOT NULL,             -- the request's event, which is its notice's seq
  supervisor   TEXT,                         -- name@laptop the notice went to, set at the drain
  resolved_at  TEXT,
  resolved_by  TEXT,                         -- the supervisor's address, 'owner', or 'BobNet@board'
  reason       TEXT CHECK (length(reason) <= 300),   -- a decline's
  session      INTEGER,                      -- the session that started it
  UNIQUE (project, ref),
  FOREIGN KEY (project, feature) REFERENCES items (project, pk),
  FOREIGN KEY (project, session) REFERENCES sessions (project, pk),
  CHECK ((state = 'pending') = (resolved_at IS NULL)),
  CHECK ((state = 'started') = (session IS NOT NULL)),
  CHECK ((state = 'declined') = (reason IS NOT NULL))
);
CREATE UNIQUE INDEX start_requests_pending ON start_requests (feature) WHERE state = 'pending';
```

**`start_request { project, ref, kind, label, brief }`** is an **owner-only** op (`forbidden` for anyone
else):

- In one transaction it runs `startCheck` again (§2). A refusal is `conflict` with the same reason, so a
  gate that changed since the page loaded is caught. It then inserts the row and writes a notice (below).
- It is sent with ADR 0001 §12's `key`, so a confirm that is resent doesn't ask twice.
- **"His identity" is the owner's socket.** The Worker takes it from Access (ADR 0003 §1). The event's actor
  is the owner, and the notice says `by: "owner"`, as an answer's does. His email is never put in a message
  (ADR 0009 §3).
- This is **broker-held** by ADR 0003 §1's rule. The request writes broker data and changes nothing on a
  laptop by itself. The orchestrator decides, exactly as for an answer that releases a held session
  (ADR 0009), which is broker-held too. See alternatives for a device-key signature.

**`withdraw_start { project, ref }`** is also owner-only and works only on a pending request. It sets
`withdrawn` and writes a notice, so the supervisor learns not to start it.

**The notice.** Migration 7 remakes `notices` (SQLite can't change a CHECK in place, as migration 5 showed)
with:

- `kind` CHECK (`answer`, `start`);
- `question` renamed to `subject` (a Q-, A- or S- ref);
- `state` gaining `requested`.

The existing rows are copied in as `kind = 'answer'`. A start notice has `to_json = []`: there is no text to
agents. The only recipient is the supervisor, and its JSON is a new remote event, `BoardStartEvent` in
`protocol/src/remote.ts`, loose like `BoardAnswerEvent`:

```json
{ "v": 2, "event": "start", "seq": 6012, "project": "helix", "ref": "S-4", "state": "requested",
  "session": { "feature": "LAND-56", "kind": "build", "label": "A" }, "title": "…",
  "brief": "…", "edited": true, "skill": "/helix-build", "by": "owner", "via": "dashboard",
  "lead": "kong@mbp-1", "at": "2026-11-22T09:00:00Z" }
```

`state: "withdrawn"` has the same fields.

**The drain** is ADR 0009 §1's, with no new path:

- Message id `m_board_<seq>_s`.
- The supervisor pick of §2 (`noticeSupervisor`, `broker.ts:501`): one candidate is that one; of several,
  the one on the lead's laptop. There is no asker fallback, because the owner has no address. If none is
  picked, nobody gets it.
- The same exactly-once check before the store.
- The pick becomes a function of `(project, lead)` so that `start_options` can show it (§2).
- **`noticesTaken` takes `[{ seq, supervisor }]`.** In the mark's own Board transaction it records
  `start_requests.supervisor`. When the supervisor is null, it **declines the request** with
  `resolved_by: 'BobNet@board'` and the reason "no supervisor runs helix". A request therefore never waits on
  nobody. A row that an earlier drain stored takes its supervisor from `toldBefore` (`broker.ts:468`).
- `start_request` and `withdraw_start` join `NOTICE_OPS` (`broker.ts:50`), so the confirm's reply carries
  `told`, `waiting` and `supervisor` (ADR 0009 §5).
- A drain that changed a request sends the owners `board_changed`.

**The supervisor** adds a branch next to `onBoardAnswer` (`supervisor.ts:1349`): `fromBoard(msg)` and
`event: "start"` lead to `onBoardStart`. It does the following:

- It parses the event, drops one for a project not run here, and records the message id first
  (`beginBoardNotice`).
- It forwards a plain message to the same orchestrators an answer goes to (ADR 0009, addendum c_6d88fb52:
  `config.orchestrator`, and `project.orchestrator` if that differs). The message carries the request, how to
  start it, how to decline it, and the brief verbatim (§6).
- It doesn't spawn, and it writes nothing to the board.

An rc.49 supervisor fails `RemoteEvent` on it and drops it with a log (`supervisor.ts:1357-1360`). That is
harmless, and §7 keeps it from happening.

### 5. Its life on the feature's page: pending until started, declined or withdrawn

- **Started** is matched by the board, in `session_join`'s transaction (`store.ts:1673`). A join (new or
  rejoin) on a feature and kind that has a pending request sets it to `started`, with `session` the joined
  session, `resolved_by` the joining role, and an event.
  - The label need not match. poe may pick another one (e.g. the proposed one was taken), and the record
    shows the real session.
  - A spawn that was queued first matches when it joins its session.
  - A spawn that carries a session (`carrySession`, which skips the join: `supervisor.ts:852`) doesn't match.
    poe declines or spawns fresh.
  - No spawn argument names the request. The session is the link, and the spawner declares session and tasks
    as with any spawn.
- **Declined** goes through the new op **`decline_start { project, ref, reason }`** (reason 1 to 300
  characters). It is a supervisor's op, authorized like ADR 0001 §10's: the caller is on the supervisor
  connection (`supervisor: true`) and `caller.serves` includes the project (`broker.ts:533`). It is made `as`
  the supervisor's own name, works only on a pending request, and writes no notice: Casper sees it on the page.
  - **poe's tool is `decline_start { project, request, reason }`**, a new supervisor tool in `mcp.ts`
    `TOOLS`, for orchestrators. Its supervisor sends the op. It is refused (with that reason) if this laptop
    doesn't run the project on the service. Then poe asks Casper to withdraw, or declines from a laptop that runs it.
- **Withdrawn**: Casper's `withdraw_start` (§4).
- There is no expiry and no "delivered" state: nothing acknowledges. The page shows the request's
  supervisor, and whether it is online from the presence it already has. ADR 0009's `waiting` says the
  same at confirm.
- At most one pending request per feature (the partial unique index, and §2's `pending`).

### 6. What the receiving orchestrator (poe) does: the section to pass on

> **A start request from Casper.** A message from your supervisor that begins "Casper asks to start
> `<project>` `<feature>` `<kind>` `<label>` (start request S-n)" is Casper's confirmed request, made on the
> dashboard. Below the line is his brief, verbatim (he may have edited it).
>
> 1. **Start it**, unless one of the reasons in 3 applies. Use `spawn_worker` with:
>    - `project`;
>    - the role that runs that kind on that project;
>    - `session: { feature, kind, label }` exactly as the message gives it;
>    - `tasks`: the items the session works on, your choice as for any spawn;
>    - `task`: his brief verbatim. You may add lines *after* it (handoff path, power), never change his text.
>
>    Queue it if the laptop is full. That is fine: the request stays pending until the worker joins its
>    session, and then it shows as started by itself. Don't reply to `BobNet@board`, and don't write the board.
> 2. If the label is taken (the spawn says the session is closed), use the next free label. The request
>    still matches any session of that feature and kind.
> 3. **Decline it** with `decline_start { project, request: "S-n", reason }` when:
>    - it would break the project's rules as you know them now (they may have changed since he asked);
>    - the role it needs is busy and you won't queue it;
>    - the feature isn't what the brief says;
>    - or this laptop doesn't run the project.
>
>    The reason is one sentence he reads on his phone: why, and what to do ("LAND-55's review is still
>    running; ask again when it closes"). Never leave a request pending without either starting it or
>    declining it.
> 4. "Casper withdrew start request S-n": if you haven't spawned it, don't. (A withdrawal comes only while
>    the request is pending, so nothing has joined.) If you queued it, `stop_worker` the queued worker.
> 5. Nothing else changes. You still decide who works on what. The request doesn't move status or open a
>    release, and it doesn't let you start sessions he didn't ask for.

### 7. Live, and in what order

- **Broker deploy:** migration 7, the ops, the drain, `start_options`'s `supervisor`, and the dashboard
  (`public/` ships with the Worker).
- **A release and a restart** of every supervisor that serves a project with a declaration (mbp-1, and ubu1
  to match): `onBoardStart`, `decline_start`, and the client's `set_gates` and `board_grants`.
- **Order:** deploy, then release, then restart, *then* the POs write their declarations. Until a declaration
  exists, Start is offered nowhere (§1), so an old supervisor never gets a start event it would drop.
  Additive both ways:
  - a new broker with an old client: no `set_gates`, and `grant` keeps `gates`;
  - an old broker with a new client: `set_gates` is refused as an unknown op.
- **Export** carries `session_kinds` and their statuses, `open_features_max`, grants' `gates` and
  `start_requests`. These are optional fields, so an older broker can't import an export that holds them
  (as ADR 0003's addendum says of `release`).

## Consequences

- Casper can ask for any declared session from his phone. The project's rules, not Helix's code, decide what
  is offered and refuse what isn't, with a reason.
- poe gets a ready brief and a session to declare, and stays the one who spawns. A request ends visibly:
  started, declined with a reason, or withdrawn.
- The PO gains a board-level declaration to keep up. A stale one shows as offers that poe declines.
- `notices` now carries two kinds. Every board-originated message still goes the notice way (ADR 0009's
  addendum).

## Alternatives considered

- **Gates as a JSON column on `projects`:** this is shorter, but ADR 0001 §2 keeps structure out of JSON,
  and a CHECK can't guard it.
- **Gates enforced in `session_join` too:** every spawn would obey the declaration, but poe's fix-loops,
  carried sessions and Casper's in-conversation asks would start failing on a declaration the PO wrote for
  the button. That can be added later as a declared flag, if Casper wants the board to bind poe as well.
- **Writing the declaration as `admin`:** an admin is whoever changes the rules, often not the PO. A flag of
  its own lets the PO keep the gates without rewriting the rules (C1, C2).
- **The dashboard assembles the brief:** then the test, the phone and any other client could disagree. The
  store has every source.
- **Copying the handoff text into the brief:** up to 64 KB, which can't be edited on a phone. It is one
  `board_get` away.
- **A device-key signature on the request (ADR 0003 §2), verified by the supervisor:** this would protect
  against a broker that forges a request. But a forged request still only asks poe, who judges it, and an
  answer that releases a held session is already broker-held. It can be added later as an optional `signed`
  field on the event. That is Casper's call (the build brief lists it).
- **A message straight to the orchestrator:** the broker doesn't know the orchestrator (ADR 0009,
  alternatives). The supervisor does.
- **A spawn argument naming the request:** this would be explicit, but it is a new field on every spawn path
  (local, remote, queued). Matching on the session is exact enough, because one request is pending per feature.
