# BOB-111 build brief (for Luigi)

**Design:** ADR 0009 (`architecture/decisions/0009-answer-notices.md`); the § numbers below are its
sections. **Criteria:** BOB-111 AC1-4 and the DoD. Line numbers are at 5610fad.

**Cut:** one build session works. If Mario wants two:

- **A** is tasks 1-4 and 6: the broker, the protocol and the dashboard, which go live with a deploy.
- **B** is task 5 and the live checks in task 7: the supervisor, which goes live with a release and
  a restart.

A is safe to deploy on its own: until B is running, an rc.48 supervisor drops the event (§3).

## Tasks

1. **Protocol** (`packages/protocol/src/remote.ts`, `board.ts`)
   - Add `BoardAnswerEvent`, a loose object shaped as in §3, with `event: z.literal("answer")` and
     `state: answered | done | withdrawn`. Put it next to `RemoteUpgrade`, and add a parse test.
   - Add optional `waiting: string[]` to the results of `record_answer`, `answer_question`,
     `mark_done` and `undo` (`board.ts:869-873`).
   - Then `BoardMessage` (`board.ts:896`) has no writer. Remove it, along with the `messages` field
     of `BoardReply` (`:904`), or leave both empty. Your choice: note which in the handoff.

2. **Board: notice rows** (`packages/broker/src/board/schema.ts`, `store.ts`, `board.ts`)
   - Add `BOARD_MIGRATIONS[5]`, which is migration 6: the table `notices`, as in §1. Keep it out of
     `export.ts`.
   - Rewrite `notify` (`store.ts:2139`) to insert a row instead of `tx.messages.push`. It keeps
     today's recipients and `except` rule.
   - The text gains `Holds:` and `Still held by:` (§3). The JSON is the §3 object, with `by: "owner"`
     for an owner caller and never his email.
   - `still_held` means other *open* questions in `question_holds` that share an item or session
     with this one.
   - Add the RPCs `notices()` and `noticesTaken(seqs)` on the `Board` DO (`board.ts:15`), with the
     30-day prune in `noticesTaken`.
   - Tests:
     - each of the four ops writes exactly one row;
     - `edit_question` writes none;
     - a refused write writes none;
     - `record_answer` leaves out the recorder;
     - an `undo` row has `state: withdrawn`;
     - a §12 key replay writes no second row.

3. **Broker: the drain** (`packages/broker/src/broker.ts`)
   - Write `drainNotices()`. It stores `m_board_<seq>` (the text, to `to_json` minus `except`) and
     `m_board_<seq>_s` (the JSON, to the project's supervisor) through `store` + `fanOut` + traffic +
     audit, as `boardMessage` does at `:396`, then marks the rows taken.
   - It skips the store when `messageExists("m_board_<seq>")`. `store` needs to take the id instead
     of making one.
   - Supervisor resolution (§2) reads from `laptop_supervisors.projects`:
     - one candidate: that one;
     - several: the one on the `lead`'s laptop, else the one on `asked_by`'s laptop, else nobody,
       with an audit of `notice:no_supervisor`.
     The project's `lead` and `asked_by` need to be in the row, or in the JSON, for this.
   - Call it from three places:
     - in `boardOp` after a successful write, replacing the `reply.messages` loop at `:380`;
     - on a supervisor's register (`:259`);
     - in `alarm()` (`:744`). A drain that throws sets the alarm to now+60 s if that is sooner.
   - For the write's own notice (its seq is `reply.result.seq`), overwrite `result.told` with every
     address sent to, and set `result.waiting` to those `fanOut` didn't reach.

4. **Broker tests** (`packages/broker/test/`): AC1 and AC3.
   - A dashboard answer reaches the asker with project, ref, key, words and holds.
   - An offline asker gets it on register.
   - The supervisor gets the JSON.
   - `board_ask answer` (`record_answer`) is delivered the same way, and not to its recorder.
   - Exactly-once:
     - a reconnect delivers the same id;
     - a drain run twice, or a drain after a crash before `noticesTaken`, stores once;
     - an undo sends a withdrawn notice and not the answer again;
     - an edit sends nothing.
   - The answer survives a drain that throws: the row stays untaken, and the next drain sends it.
   - Several supervisors serve a project: only the lead's laptop's one is told.
   - No supervisor: `told` lacks one.

5. **Supervisor: forward to the orchestrator** (`packages/supervisor/src/supervisor.ts`, `store.ts`)
   - In `onRemoteAnswer` (`:1344`), before the schema pick at `:1352`, branch on
     `msg.from` = `BOARD_SENDER` and `event: "answer"`, into a new `onBoardAnswer`, as §4 says:
     - parse it;
     - drop a project this supervisor doesn't serve;
     - record the message id first (a small table, or reuse the remote-request store's pattern), so
       a redelivery isn't forwarded twice;
     - skip it when `by` is the orchestrator's own address;
     - send the orchestrator a plain text message as the supervisor's name. The orchestrator is
       `project.orchestrator ?? file.orchestrator` (`config.ts:124`, `:191`).
   - The text says what was answered, what it held, what still holds it, and "it can start" only
     when nothing else does. A withdrawal says the answer was withdrawn.
   - No spawn and no board write.
   - Tests:
     - it forwards once;
     - a redelivery is ignored;
     - a project it doesn't serve is dropped;
     - a `by` that is the orchestrator is skipped;
     - a body that doesn't parse is dropped;
     - an `event: "answer"` from any sender other than `BobNet@board` is not forwarded.

6. **Dashboard and tool output** (`packages/broker/public/app.js`; `packages/client/src/board-tools.ts`
   if it formats results)
   - Add `; waiting for X to come online` after `sentTo` in the toasts at `app.js:1490` and `:1523`,
     using `shortName`.
   - Add `; no supervisor runs <project>` when `told` has no supervisor. To know that, the broker
     can add `supervisor: string | null` to the result next to `waiting`; your call.
   - No new layout, so there is no Daisy spec (§5).
   - Test: a dashboard test of the toast text.
   - AC4 evidence: screenshots on phone and desktop.

7. **Evidence and live checks**
   - `pnpm -r typecheck`, `pnpm -r test`, then land.
   - After the broker deploy (Casper or poe asks, as usual), the dashboard check for AC1 and AC4:
     a real question holding a session, answered on the dashboard; the asker and supervisor
     messages are seen, and the toast is screenshotted.
   - After the release and a restart of mbp-1's supervisor (and ubu1's), the AC2 check with both
     ends real: an answered question that holds a session wakes poe@mbp-1 with the forwarded text.
   - Say in the handoff which step made which criterion live.

## Not here

- BOB-127 is ubu1's `supervisor.yaml` (helix lacks `rebase:`). See ADR 0009, "Not in this
  decision". It is Casper's config: no code.
- A lasting "who was told" on the Waits list (§5).
