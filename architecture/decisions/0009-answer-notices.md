# 0009. An answer is a notice row; the broker delivers it, to the project's supervisor too

- **Status:** accepted (Toad, 2026-11-21), for BOB-111 (session `BOB-111 design A`). Builds on ADR 0001
  §7 (questions and answers, and its 2026-11-14 amendment) and §12 (operation keys), ADR 0007 §1 and §2
  (one orchestrator; supervisors' JSON messages). Line numbers are at 5610fad.

## Context

On 2026-11-21 Casper answered helix Q-282 on the dashboard. It held a session. Nothing started, and
poe@mbp-1 heard nothing. The code does today:

- **Who hears.** `answer_question`, `mark_done`, `record_answer` and `undo` call `notify`
  (`broker/src/board/store.ts:2139`). It sends the project's `lead` and the question's `asked_by`,
  minus the writer, one text message from `BobNet@board`. The message goes into `tx.messages`, which the
  Board DO hands back in its reply. The Broker DO then stores it and fans it out (`broker.ts:380`,
  `boardMessage` at `:396`). An offline recipient gets it when it registers (`pendingFor`, `:625`).
- **Where it goes wrong:**
  1. *Nobody who can start the session is told.* The lead and asker are role names that the
     supervisor hosts. When a role has no worker running, the message is filed in that role's inbox
     (`supervisor.ts:1264-1275`). The orchestrator only sees an `update` in its digest, and an update
     doesn't wake it (`:1279`). That is what happened to Q-282.
  2. *The message is text.* It doesn't say what the question holds. poe can't read helix's board to
     look it up (BOB-111's description), so it can't act on the message even when it reads it.
  3. *Delivery is not in the answer's transaction.* The answer commits in the Board DO, and the
     message is stored later, in the Broker DO, after an `await`. If the RPC reply is lost, or the
     Broker DO restarts in between (a deploy does this), the message is gone. The §12 key replays it
     only if the dashboard resends the same write. A tab that was closed, or an agent's
     `board_ask answer`, never resends.
  4. *The dashboard can't say "waiting".* `told` lists the addresses written to (`app.js:1424`, the
     toast at `:1490`). It doesn't say which of them were offline.

## Decision

### 1. The answer writes a notice row in its own transaction; the broker consumes it

- **Board migration 6** adds a table `notices`, which is not board data: it is never exported and
  never read by `board_*`. Its columns:
  - `seq`: the answer's event seq, primary key;
  - `project`, `question`;
  - `state`: `answered` | `done` | `withdrawn`;
  - `to_json`: the board's recipients, `lead` and `asked_by`, minus the writer, as `notify` picks
    them today;
  - `except`: the writer's address, or null for the owner;
  - `text`: the agents' message;
  - `notice`: the supervisor's JSON (§3);
  - `taken_at`: null until the broker has stored it.
- `notify` stops pushing to `tx.messages`. It inserts the row instead, in the transaction of the
  write. All four ops do this: `answer_question`, `mark_done`, `record_answer` (an agent's
  `board_ask answer`) and `undo`. The answer and its notice commit together, or neither does.
- **The consumer is the Broker DO.** The Board DO gets two RPCs:
  - `notices()`: the untaken rows, oldest first, at most 50;
  - `noticesTaken(seqs)`: sets `taken_at`, and deletes taken rows older than 30 days.
- **Draining.** For each row, the broker stores message `m_board_<seq>` (the text) and
  `m_board_<seq>_s` (the supervisor's JSON) through `store`/`fanOut`, as `boardMessage` does now.
  It then marks the rows taken. A row whose `m_board_<seq>` already exists is only marked. The check
  and the store run synchronously after the `await`, so two drains that overlap can't both store a
  row. A crash between the store and the mark stores nothing twice.
- **When the broker drains:**
  - after every board write that succeeds, before it replies (§5 needs this);
  - when a supervisor registers;
  - on its alarm. A drain that fails brings the alarm forward to one minute, because the sweep
    interval is an hour (`broker.ts:35`).
- **Sent once per answer.**
  - A notice exists only for the four ops above. `edit_question` writes none, and it can't run on
    an answered question anyway (`store.ts:1918`).
  - A reconnect redelivers the same message id, and the client and supervisor already dedupe ids
    (`addInbox`, `supervisor.ts:1264`).
  - A withdrawal (`undo`) is its own notice, `state: withdrawn`, which ADR 0001 §7 already sends.
    It is not the answer again.
  - Answering again after a withdrawal is a new answer with a new seq, so it gets a new notice.
  - Nobody gets their own answer back: the writer is in `except`. The owner has no address, so a
    dashboard answer has none.
- **The answer is stored whatever happens to delivery.** The reply's `messages` stays in the
  Board/Broker RPC type but comes back empty. The §12 replay therefore returns the cached `told`
  and stores nothing more.

### 2. "The project's supervisor" is data the broker already has

The broker reads it, at drain time, from `laptop_supervisors`. A supervisor writes its row at
register: its `name` and its `projects` (`broker.ts:259-266`). The rule:

- The candidates are the rows whose `projects` include the notice's project key.
- **One candidate:** that one, `<name>@<laptop>`.
- **Several candidates** (helix is served on mbp-1 and ubu1): take the one on the laptop of the
  project's `lead` address. If none is there, take the one on the laptop of `asked_by`. If neither
  rule picks one, nobody gets it, and the broker audits `notice:no_supervisor`. ADR 0007 has one
  orchestrator across laptops, and it lives where the project's lead runs, so the lead's laptop is
  where an answer can be acted on. Telling every candidate would wake two orchestrators for one
  session.
- **No candidate:** no supervisor is told. §5 shows this.
- A supervisor that is offline is still a recipient. The message waits in its queue (`pendingFor`)
  until the next register, which also drains (§1).

The broker never spawns. Nothing new is configured, and there is no agent flag: the data is the
register the supervisor already sends. Peach agreed (BOB-111 notes) that poe needs no read grant
on other boards, because the notice carries everything poe needs to act.

### 3. The message shapes

**To the lead and the asker:** today's text (`store.ts:1974`, `:1993`, `:2006`, `:2067`), with two
lines added:

- `Holds: LAND-56; session LAND-56 design B`
- when anything it holds is still held by another open question: `Still held by: Q-283 (session LAND-56 design B)`

**To the project's supervisor:** one JSON object, a remote *event* in ADR 0007 §2's sense, from the
reserved `BobNet@board`:

```json
{ "v": 2, "event": "answer", "seq": 5123, "project": "helix", "ref": "Q-282", "kind": "question",
  "state": "answered", "key": "accept", "option": "Accept the prototype", "words": "…",
  "by": "owner", "via": "dashboard", "asked_by": "kong@mbp-1",
  "holds": { "items": ["LAND-56"], "sessions": [{ "feature": "LAND-56", "kind": "design", "label": "B" }] },
  "still_held": [{ "session": { "feature": "LAND-56", "kind": "design", "label": "B" }, "by": ["Q-283"] }],
  "at": "2026-11-21T16:40:00Z" }
```

- `by` is `"owner"` for a dashboard answer, and the recorder's address for `record_answer`.
  Casper's email never goes in a message.
- For `state: withdrawn`, `key` and `words` hold what was withdrawn.
- For an action, `state` is `done` and `words` is his note.
- `still_held` lists the other *open* questions that hold anything this one holds, as they stand
  at the answer.
- The schema is `BoardAnswerEvent` in `protocol/src/remote.ts`, a loose object like the other events
  there.
- **Older supervisors:** an rc.48 supervisor reads this as a v2 event whose `event` isn't in
  `REMOTE_EVENTS`. It logs "doesn't parse; dropped" (`supervisor.ts:1357-1360`) and does nothing
  else. It is never read as a request, because the object has no `op`
  (`remote.ts:147-149`). Additive: old supervisors and new brokers still talk, and the other way
  round.

### 4. The supervisor forwards it to its orchestrator, and does nothing else

In `onRemoteAnswer`, before the event schemas, add one check: is the message `from` `BobNet@board`
(`BOARD_SENDER`), with `event: "answer"`? The broker stamps the sender, and no laptop may take that
id (ADR 0001 §7), so the sender can be trusted. The supervisor then:

1. Parses it with `BoardAnswerEvent`. If it fails, or names a project this supervisor doesn't serve,
   it logs and drops it.
2. Records the message id before acting, as ADR 0007 §2 does for requests. A redelivery is not
   forwarded twice.
3. Skips it if `by` is its orchestrator's own address: whoever recorded the answer knows it.
4. Sends the orchestrator a plain BobNet message. The orchestrator is the project's `orchestrator`
   if the project names one, else the laptop's (`config.ts:124`, `:191`). The message is from the
   supervisor's name, and a directed message wakes its reader (`broker.ts:763`). Its body says what
   was answered, what it held, and what still holds it. For example: "Casper answered helix Q-282
   (accept: Accept the prototype): 'his words'. It held session LAND-56 design B, nothing else holds
   it now: it can start." A withdrawal says the answer was withdrawn and that it holds again.

It doesn't spawn, doesn't touch the board, and doesn't decide whether the session starts. That stays
the orchestrator's call, with its own spawn arguments. If the orchestrator is offline, the message
waits in its queue like any other.

### 5. The dashboard: one more clause in an existing toast, so no Daisy spec

- `told` is now set by the broker. It holds every address the drain sent to: the lead, the asker
  and the supervisor.
- A new optional `waiting: string[]` holds the addresses that weren't online when the message was
  sent (`fanOut`'s complement, as in `Results["send"].queued_for`).
- Both are added to the results of `answer_question`, `mark_done`, `record_answer` and `undo`
  (`protocol/src/board.ts:870-873`). This is additive.
- The toast at `app.js:1490` (and `:1523` for undo) keeps `sentTo`. After it comes
  `; waiting for kong to come online` when `waiting` is non-empty.
- When no supervisor was found, the toast also says `; no supervisor runs helix`.
- The words reuse `shortName` and the toast that is there now, which already works on a phone. **No
  Daisy spec is needed:** nothing new is laid out, only one clause added to a sentence Daisy already
  worded ("sent to", not "heard by").
- Not in scope: a lasting "who was told" on the Waits list's answered entries. AC4 asks only for
  what the screen says after answering, and the toast does that.

The MCP tool `board_ask answer` returns the same `told` and `waiting`, so a recorder sees them too.

## Consequences

- An answer that holds a session wakes whoever starts sessions, even when no worker of the asker's
  role is running. For Q-282's case that is poe@mbp-1.
- What reaches the agents is decided in the answer's transaction. The supervisor recipient is
  decided at drain time, which is milliseconds later, or at the next register if the RPC failed.
- **Live:** this needs the broker deploy (board migration 6, the drain, the protocol) and a release
  plus a restart of mbp-1's supervisor, and of ubu1's to match. Before the restart, agents still get
  the text and the supervisor drops the event, so nothing gets worse.
- `tx.messages` and `BoardMessage` are left with no writer. The build removes them, or keeps them for
  the next board message. Either way, every board message goes the notice way from now on.
- This amends ADR 0001 §7's "How the lead gets the answer": the message no longer comes back in
  the reply. It comes from a notice row, in the same transaction, consumed by `Broker`.

## Alternatives considered

- **Keep `tx.messages` and lean on §12 replay:** this loses the message whenever nobody resends,
  which is exactly an agent's `board_ask answer` or a closed tab.
- **Consume `events` directly with a cursor:** events are the history, and they carry neither
  recipients nor rendered text. Recipients would then be decided at read time, and the `lead` could
  have changed by then. A small notice table is clearer, and it can be pruned.
- **The broker messages the orchestrator itself:** the broker doesn't know who the orchestrator is,
  because that is in `supervisor.yaml`. Registering an orchestrator per project would add data to
  keep in sync. The supervisor already knows.
- **Tell every supervisor that serves the project:** this wakes several orchestrators for one
  session (ADR 0007).
- **The supervisor spawns the held session:** it lacks the spawn's arguments and the judgement, and
  BOB-111's notes (Toad's advice, which Peach agreed to) keep spawning with the orchestrator.

## Not in this decision

- **BOB-127** (the remote worker on ubu1 has no `rebase` tool) is not this code. The tool is offered
  only when the worker's project on *that* laptop has `rebase:` in `supervisor.yaml`
  (`supervisor.ts:2450`, `config.ts:158`). ubu1's helix entry evidently lacks it. That is Casper's
  config, not a code change. The supervisor's own `git fetch` runs outside the worker's network
  sandbox (`supervisor.ts:2810`), so adding `rebase: { onto: origin/main }` there should be enough.

## Addendum (2026-11-22, build A, c87bd1a; review `reviews/bob111-review.md`)

- **`lead` is in the notice JSON**, next to `asked_by`: an address or null. §2's pick needs the project's
  lead at drain time, and that lead is the one as it stood at the answer, the same moment that fixes the text's
  recipients. The field is additive, and `BoardAnswerEvent` is loose.
- **The candidates in §2** are the `laptop_supervisors` rows whose registered `projects` include the
  project. A supervisor registers `serviceProjects()`, its projects with `board: service`
  (`supervisor.ts:670`, `:3328`), not every project it runs. Only a service board has questions, so the set
  is right. But a laptop is a candidate only if its config puts the project on the service.
- **`BoardMessage`, `BoardReply.messages` and `Tx.messages` are removed.** Every board message goes
  through a notice row. A board message that isn't about an answer would add a notice `state`. It
  wouldn't bring back `tx.messages`.
- **The four results carry `supervisor: string | null`** beside `told` and `waiting` (`BoardTold`,
  `protocol/src/board.ts`). The broker sets it, and the toast's "no supervisor runs <project>" reads it. A reply
  without it (the board alone, or a failed drain) says neither clause.

## Addendum (2026-11-22, consult c_6d88fb52, Mario's major after sign-off)

- **Who the supervisor forwards to.** The supervisor forwards an answer to its laptop's
  `config.orchestrator`. It also forwards to `project.orchestrator`, but only if that differs from
  `config.orchestrator` and from the asker, since the asker already has the text from the broker.
- **`orchestratorOf` is no longer the sole target.** It is one of the two addresses, deduplicated against
  the other and against the asker.
