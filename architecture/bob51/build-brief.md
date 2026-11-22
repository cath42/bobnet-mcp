# BOB-51 build brief (for Luigi)

**Design:** ADR 0013 (`architecture/decisions/0013-requests-whole-notes-delivered.md`). The § numbers below
are its sections. **Screens:** Daisy's spec in `design/BOB-51/`: the whole question and options with
Show all, "Answered from here today" for permissions, and the note label. **Criteria:** BOB-51 AC1-3 and
the DoD. Line numbers are at `4dd8cd9` (origin/v2).

**Cut:** one build session, **build A, 7 tasks**, in this order. Tasks 1-6 are the data and can be built
before Daisy's spec lands. Task 7 needs her spec.
- **Supervisor migration:** one column and one index on `requests` (task 3).
- **Broker migration:** none.
- **Broker deploy: yes**, for tasks 1, 6 and 7 (the schema the broker parses, `action_result`'s new field,
  `app.js`).
- **Supervisor rc: yes**, for tasks 2-5. After it, **restart mbp-1 and ubu1**. ubu1 must be on the rc for
  the remote half of AC3.
- Either can go live first (ADR 0013, Compatibility). The ACs are checked live only once all three are done.

## Already true on v2: checked, not to build

- **One path, local and remote (AC1).** A remote worker's request is on the report of the laptop it runs
  on, built by the same `snapshot()` (`supervisor/src/supervisor.ts:3637-3649`). The dashboard acts on
  that laptop directly (`act(p.laptop, …)`, `broker/public/app.js:1577`). Nothing in the spawner's copy
  (`remote_asks.preview`, 160 characters from `oneLine`, `:3211`, `:3755`) reaches the dashboard.
  Leave it as it is.
- **Show all already exists (BOB-31).** `needsLine` (`app.js:1406`) and `measureNeeds` (`:1425`). It shows
  only what arrives. The 400-character cut is `preview()` (`supervisor.ts:3771`) and the schema
  (`protocol/src/frames.ts:185`).
- **The note already travels as far as the router (AC3).**
  - `Action.answer` takes `message` with allow (`frames.ts:419`).
  - `onAction` passes it on (`supervisor.ts:2449`).
  - The `answer` op carries it (`protocol/src/remote.ts:56`, `supervisor.ts:2179`). The requester's
    `answer_request` sends it (`supervisor/src/mcp.ts:405`).
  - It is lost in `toResult` (`router.ts:227-236`) and in `resumeTask` (`supervisor.ts:3905`).
  - **No request-side change is needed** for the remote half.
- **Decided state is already stored (AC2):** `decision`, `decided_by`, `decided_at` (`store.ts:89-93`,
  `settleRequest` `:415`). What's missing is where a decision came from, and the report.
- **A mid-run message already works:** `WorkerRun.inject` (`worker.ts:253`) with priority `next` (`:68`),
  used for inbox messages (`supervisor.ts:1280`).
- **What the screens can't have from BOB-51:**
  - A worker's AskUserQuestion is **orchestrator-tier** (`router.ts:81`). `humanPerms` (`app.js:1437`)
    keeps only tier `human`, so a question shows only in the agent detail row (`app.js:530`), never on
    Waits or Needs you. Daisy decides where its Show all lives.
  - Answering a question's options from the dashboard is out of scope (§1). I'll suggest it to Peach as
    a backlog task.

## Tasks

1. **Protocol** (`protocol/src/frames.ts`). Parent: BOB-32, BOB-29.
   - A new `PendingAsk` as in §1. `pending[]` (`:176-187`) gains `ask: PendingAsk.nullable().optional()`.
     `preview` stays `max(400)`.
   - `LaptopSnapshot` gains `decided: z.array(DecidedRequest).max(50).optional()`, with the row in §2.
     `decision` is `z.enum(["allow","deny"])`, `note` is `max(2000).nullable()`, `preview` is `max(400)`.
   - `ActionResultFrame` (`:429`) and the owner's `action_result` in `ServerFrame` (`:520`) gain
     `note_delivered: z.boolean().optional()`.
   - A comment on the `answer` op (`remote.ts:53`): its reply may carry `note_delivered`. The reply is
     already a `looseObject` (`:87`).

   Done when parse tests show:
   - a snapshot parses with and without `ask` and `decided`;
   - an `ask` field over its maximum fails;
   - `action_result` parses with and without `note_delivered`.
2. **The whole ask** (`supervisor.ts`, beside `preview()` at `:3760`). Parent: BOB-32.
   - `askOf(r): PendingAsk | null` reads `r.input`. For `AskUserQuestion` it fills `questions` from
     `input.questions`, with `multi` from `multiSelect` and no option `preview`. `text` is the first
     question. For anything else, `text` is the command, file path, URL or path, as `preview()` picks it,
     else the raw input. `questions` is `[]`.
   - Clip each field to its maximum by whole code points within the length. Factor `fitRunName`'s loop
     (`:401-410`) into a `clip(s, max)` and use it for both. Set `cut` when anything was clipped.
   - `withholdWhole`-style check: if `findSecret` matches any field's serialised form, the ask is `null`.
   - In `snapshot()` (`:3637`), give the rows their asks: human tier first, then list order, with a
     running total of `JSON.stringify(ask).length` in UTF-8 bytes against `ASK_BUDGET = 128 * 1024`. A
     row past it gets `ask: null`.

   Done when tests show:
   - a 4-question AskUserQuestion arrives whole, with headers, options and `multi`;
   - a 9000-character Bash command arrives as 8000 with `cut: true` and no split surrogate;
   - a credential in an option's description gives `ask: null` and leaves `preview` as it was;
   - the budget leaves the newest orchestrator-tier row `null` before any human-tier row.
3. **Where a decision came from, and `decided`** (`store.ts`, `router.ts`, `supervisor.ts`). Parent: BOB-29 AC2.
   - In `store.ts`, `requests` gains `via TEXT`, added in the migration block (`:279-287`) as
     `ALTER TABLE requests ADD COLUMN via TEXT`, plus `CREATE INDEX IF NOT EXISTS requests_via ON requests
     (via, decided_at)`.
   - `RequestRow` gains `via`. `settleRequest`'s patch takes an optional `via`.
   - A new `store.decidedVia("dashboard", sinceIso, 50)` reads newest first.
   - `Router.answer` (`router.ts:121`) takes an optional `via`. `Supervisor.answer` (`supervisor.ts:1081`)
     passes it through. `onAction` (`:2449`) sends `via: "dashboard"`, and passes a `message` only if
     Casper wrote one: drop the `"denied from the dashboard"` default.
   - `toResult` (`router.ts:227`) takes `decidedBy`. A deny with no message reads "Denied by Casper" when
     it is `human`, and "Denied by the orchestrator" otherwise.
   - `snapshot()` adds `decided`, the §2 rows: `name` and `project` from the worker, `preview` from
     `preview(r)`, `note` from `r.message` withheld as `preview` is. It is `[]` when none.

   Done when tests show:
   - a dashboard allow and a dashboard deny with a note are both in `decided`, newest first, with the
     note verbatim;
   - an `answer_request` allow (orchestrator, and `user_decided`) and a timeout are not;
   - a row decided 25 h ago is gone;
   - the deny result's text with and without a note;
   - an old db file migrates (column and index added).
4. **The note as the next message** (`supervisor.ts`, `mcp.ts`). Parent: BOB-29 AC3.
   - In `Supervisor.answer`, when the decision is `allow` or `answer` and there is a `message`, build the
     §3 line: `Note from <who> with the Allow of request <id> (<tool>): <words>`, or "with the answer to
     request" for an answer.
     - `<who>` is "Casper" for `decidedBy` `human`. Otherwise it is the worker's orchestrator: its
       `remote_by` for a remote spawn, else the project's lead name as the brief's line names it
       (`:3873`).
     - **Live request:** after `router.answer` returns, `this.runs.get(worker_id)?.inject(line)`.
     - **Orphan:** `resumeTask` (`:3905`) appends the line.
     - The result gains `note_delivered`. It is false, and audited `note:undelivered` with `{ request }`,
       when inject returns false, there is no run, or the resume failed.
   - `onAction` puts `note_delivered` on its `action_result` (`:2439`, `reply` gets an optional third
     argument).
   - The `answer` op (`:2176-2190`) puts it on its reply, the `resume_error` branch included (false there).
   - `answer_request` (`mcp.ts:395-422`) returns `note_delivered` locally. Remotely it returns
     `r["note_delivered"] === true`. When a note was sent and the reply has no field, it adds
     `note: "not delivered: <laptop>'s supervisor is older and drops a note sent with allow"`.

   Done when tests with one supervisor show (`requests.test.ts`):
   - an allow with a note reaches the FakeQuery's prompt as the next user message after `canUseTool`
     resolves, and `note_delivered` is true;
   - an answer with a note does the same;
   - an orphan's allow with a note has the line in the resumed task;
   - a note on a run whose input closed gives false and an audit row.
5. **Both ends real** (`supervisor/test/copies.test.ts` pattern, or a new `notes.test.ts` with its
   `boot`, `:52`). Parent: BOB-29 AC3.
   - Two real `Supervisor`s, mbp-1 the requester and ubu1 the target, on one `FakeNetwork`. Each has its
     real `Router`, `WorkerRun` and store. Only the SDK is a FakeQuery that reads its prompt
     (`fakes.ts:32-35`).
   - ubu1 runs a v2 worker spawned from mbp-1. Its Bash escalates.
   - **Remote half:** mbp-1's orchestrator calls `answer_request` with allow and a note. ubu1's FakeQuery
     gets the allowed call, then the note line as its next user message. mbp-1's result has
     `note_delivered: true`. ubu1's audit has `remote:answer`.
   - **Old-target variant:** ubu1's answer handler is stubbed to drop `note_delivered`. mbp-1's result
     says not delivered.
   - **Local half:** a dashboard `action` frame (`{ t: "action", …, action: { kind: "answer", decision:
     "allow", message } }`) is handed to ubu1's `onAction` through its link, with `ownerCheck` stubbed
     true. Its `action_result` has `note_delivered: true`, and the FakeQuery gets the line.

   This is the automated half of "both ends real". The live half is in Evidence.
6. **Broker** (`broker/src/broker.ts`, `broker/test/broker.test.ts`). Parent: BOB-32, BOB-29.
   - `actionResult` (`:725-729`) forwards `note_delivered` when present.
   - Tests:
     - a supervisor's `action_result` with `note_delivered: false` reaches the owner with it, and one
       without it reaches the owner without it;
     - a `report` with `ask` and `decided` is stored and comes back whole in the `dashboard` reply and
       the owner's `report` frame;
     - a worst-case snapshot fits `LIMITS.boardFrameBytes` and is accepted. Worst case means 100 workers
       with 400 ctx, 500 usage rows, 100 pending with asks at budget, and 50 decided with 2000-character
       notes.
7. **Dashboard** (`broker/public/app.js`, `test-ui/dashboard.test.ts`). Parent: BOB-32 AC1, BOB-29 AC2,
   AC3. This follows Daisy's spec in `design/BOB-51/`. The data rules are:
   - **Text:** `permText` (`:1444`) and the form's `code.preview` (`:1582`) use `p.ask?.text ?? p.preview`.
     The questions and options render read-only from `p.ask.questions`. When `ask` is missing or null,
     show the preview exactly as today.
   - **Answered from here today:** each laptop's `snapshot.decided`, filtered to `decided_at ≥ midnight()`
     (`:1187`), is merged with `ov.answered` (`:1792`) by time. There is no Undo. A stale laptop's rows
     still show, because they are history.
   - **Note:** the label is "Note to <agent> (optional)", and it is sent with Allow and with Deny
     (`decide`, `:1574`). Only when the laptop's report has no `decided` field (an older supervisor) does
     the form keep today's label, "sent with Deny".
   - **Toast:** after Allow with a note, the toast reads `action_result.note_delivered`. When it is true,
     say the note went to the agent. When it is false or absent, say it wasn't delivered.

   Done when the UI tests cover:
   - a 900-character question with 4 options shows whole under Show all;
   - a report without `ask` shows the preview;
   - a decided allow from today shows under "Answered from here today", and yesterday's doesn't;
   - the note label with and without `decided`;
   - the toast for true, false and absent.

   Screenshots at 390 and 1440 go in `design/BOB-51/shots-build`.

## Evidence, for the review

- **AC1:** task 2's tests, task 7's UI test, and the screenshots.
  - **Live:** after the deploy, the rc and the restarts, a worker on mbp-1 and one on ubu1 (spawned from
    mbp-1) each make a human-tier Bash call with a command over 400 characters. Both show whole on Waits
    on a phone and on a desktop. The AC's "question" case: an AskUserQuestion's whole text and options in
    the agent detail row, or wherever Daisy's spec puts it.
- **AC2:** task 3's tests, task 7's UI test, and a dashboard check: allow one live request from Waits,
  and it appears under "Answered from here today" with no Undo.
- **AC3:** tasks 4 and 5 (the automated "both ends real"), and task 7's screenshot of the label.
  - **Live:** after the restarts:
    - Casper (or Mario with Casper's go) allows an mbp-1 worker's human-tier request from the dashboard
      with a note. The worker's log (`logs/<project>/<id>.jsonl`) shows the note line as the user turn
      after the tool result. Do the same for a ubu1 worker.
    - poe on mbp-1 answers a ubu1 worker's request with `answer_request` allow and a message. ubu1's log
      shows the line, and the result has `note_delivered: true`.
- **DoD 3:** I review build A against ADR 0013, including old and new supervisors against the new broker.
- **DoD 4:** say "broker deploy (tasks 1, 6, 7), and rc plus restart of mbp-1 and ubu1 (tasks 2-5)".
