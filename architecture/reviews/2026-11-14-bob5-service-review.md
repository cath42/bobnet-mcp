# Review: BOB-5 service side (f34a0f2) and BOB-2 #12's test (6724d0e)

Toad, 2026-11-14. Luigi's ADR 0001 §7 change: `answer_question`, `mark_done` and `undo` in
`protocol/src/board.ts` and `broker/src/board/store.ts`, `BoardReply.messages` and `BOARD_SENDER`,
`Broker.boardMessage`, the reserved laptop id in `auth.ts`, `Action.answer`'s optional `message`
(`protocol/src/frames.ts`, `supervisor.ts`), and the tests. I read the diff against origin/v2 and
checked each §7 bullet against the code, including the parts the commit didn't touch.

**Verdict: both signed off.** Nothing must be fixed now. Findings 1 to 3 and rulings R1 and R2 are
for later, each with when. ADR 0001 §7 and §12 carry the rulings as amendments.

## §7, bullet by bullet

- **Asking (`board_ask`).** Present from BOB-2: `store.ts` `ask` (1073) requires the `questions`
  grant, writes options, holds, sessions held and `needed_before`, and records every field in the
  event. The tool is `client/src/board-tools.ts:130`, served by the channel client and by the
  supervisor's `worker-tools.ts`.
- **Answering from the dashboard.** `answerQuestion` (1147) and `markDone` (1164) are `ownerOnly`.
  A question needs a key, words or both, and an action takes only `mark_done`. Both are refused with
  `conflict` unless the question is `open`, so the answer is written once. Words are stored as given
  after zod's `trim`, the same as `record_answer`. `answered_via` is `'dashboard'`. The test checks
  that Picard, Riker and Bill are refused. No MCP tool offers these ops: `WRITES` in
  `board-tools.ts:32` and `board_ask` don't include them (§8).
- **Answers given in conversation (`record_answer`).** Present from BOB-2: `recordAnswer` (1124)
  requires the `questions` grant and the words, stamps `answered_via 'conversation'`, and refuses
  with `conflict` unless the question is open. That makes it write-once, refused after a dashboard
  answer, and a dashboard answer is refused after it (tests in `board.test.ts`, about lines 545 and
  585). `via` is stamped by the op, not passed in. That is better than the ADR's wording, because a
  caller can't claim the dashboard route.
- **Undo.** `undo` (1197) is the owner's alone. It takes back only an `answer_question` or
  `mark_done` event by the owner, only within `UNDO_MS` (two minutes, measured on the board's
  clock), and only if that event is still the question's last answer event. The new event carries
  `undo_of`, its changes keep the withdrawn key and words, and the question goes back to `open` with
  the answer columns cleared. The lead gets the second message. A `record_answer` can't be undone
  (tested). §5's undo of the other gates comes later on the same op (note B).
- **How the lead gets the answer.** `notify` (1239) puts the message on `Tx.messages`. The store
  builds it inside `transactionSync` (`board.ts:33`), so it comes back only if the write commits. A
  refused write returns none (tested), and a no-op write returns `[]`. It goes to the project's
  `lead` and to `asked_by` when that is someone else, deduplicated by `addressKey`. The body names
  the question, the option (key and text) and his words. `Broker.boardMessage` (386) stores and
  delivers it from `BobNet@board` as an ordinary message. A recipient that hasn't registered gets a
  `deliveries` row keyed by `to_key`, and `pendingFor` delivers it on register.
- **Reserved sender.** `authenticate` refuses a laptop token that maps to `board` in any case (and
  logs it). Only laptop connections may `register` (`broker.ts:211`), so neither the owner nor anyone
  else can host `BobNet@board`. `boardMessage` also skips any recipient on laptop `board`.
- **Helix before BOB-9.** Nothing here writes a repo's files. The dashboard answers only records
  in the service.
- **Permission requests.** `Action.answer.message` is optional and bounded at 2000 characters.
  `supervisor.ts` passes it with an allow, or uses it in place of the default deny note. The change
  is additive both ways: `Action` is a plain `z.object`, so an installed older supervisor or broker
  strips the field and keeps today's behaviour.
- **Waits list.** It is a query and isn't part of this change, so nothing to check.

**No migration needed: confirmed.** Migration 1 (`board/schema.ts:173`) already has `answer_key`,
`answer_words` (its comment names mark_done's note), `answered_by`, `answered_at`, `answered_via`
CHECK (`dashboard`, `conversation`) and `state` CHECK including `done`. `events.undo_of` references
`events (seq)` (352). The table CHECK `(answered_at IS NULL) = (state IN ('open','withdrawn'))`
holds for every path: an answer sets `answered_at` with `answered`/`done`, and undo clears it with
`open`. Export and import already carry `undo_of` (`export.ts:123`, 718). `BoardReply.messages` is
internal to the Worker: `Board` and `Broker` deploy together, so no compatibility question arises.

## Findings

1. **A project's `lead` is a free string, so an answer can tell no one.** *Later: with the next
   import change, before any real project is imported (BOB-14).* `create_project` takes `lead` and
   `po` as `z.string().max(65)` (`protocol/src/board.ts:163`). `notify` drops a value without `@` or
   one that `parseRecipient` rejects. So a bare `Mario`, a typo or a null lead means Casper's
   committed answer sends nothing, silently. A misspelt address that parses (`Mairo@mbp-1`) gets
   stored for a peer that never registers. Fix:
   - Validate `lead` and `po` as `name@laptop` (`isValidSegment` on both parts, laptop not `board`)
     in `create_project`, in the export schema's import, and in `import-backlog`'s `--lead`/`--po`.
   - Add `told: string[]` to the results of `answer_question`, `mark_done` and `undo` (additive), so
     the dashboard's toast can say who heard, or that nobody did. That second part is Daisy's to
     place in the toast.

2. **If the reply is lost after the commit, the lead is never told.** *Later: before the dashboard's
   answer UI ships (BOB-5's client side).* `Board` commits, then the reply crosses the RPC to
   `Broker`. If that hop fails after the commit, `Broker` answers `unavailable` (`broker.ts:369`)
   and stores nothing. Dashboard retries then get `conflict`, and the message is gone. The answer is
   safe in the record and only the message is lost. This is rare, but it is the one message §7
   exists for. Fix: the operation key in ruling R1. The dashboard sends a key with each answer, done
   mark and undo, and retries with the same key. The replay returns the stored reply with its
   messages, and `Broker` stores and delivers them. If the first message did reach the lead, the
   second is a harmless duplicate.

3. **Agents are invited to reply to a sender that can't receive.** *Later: with the next client or
   supervisor change, and in the release that puts dashboard answers live.*
   - `formatInbound` (`supervisor.ts:1919`) ends every message with "Reply with send_message if a
     reply is needed". A reply to `BobNet@board` fails with `unknown_peer` (`broker.ts:296`).
   - The channel client's `inbox.ts` `toEvent` sees `team: null` and adds "Cross-team message — the
     sender is not on your team".

   Both receivers should recognise `BOARD_SENDER`: say it is from the board, drop the reply line and
   the cross-team note. Do this on the receiving side, from the one constant, rather than in the
   body.

## 6724d0e: BOB-2 #12's test

**Signed off.** It tests `board_get` through the channel client at the default wait. With fake
timers, the call is still pending at 59.9 s and fails just after 60 s with "unavailable: the board is
unavailable since <t>; wait and retry", where `t` is when the broker was lost, not when the call was
made. That is §12's wording and meaning. A broker that comes back within the wait gets the call once
(`back.ops` has length 1). No code change was needed, and that holds: the wait is
`BrokerConnection.boardOp`'s `whenReady(waitMs)` (`client/src/connection.ts:133`). The supervisor's
worker tools use the same path (`supervisor.ts:1656`), so the test covers them too. What it can't
cover is a drop after the frame has gone out. That is Luigi's open question 1, ruled below.

## Rulings on Luigi's open questions (handoff w_92cfd796)

**R1. Writes get an operation key, and the connection resends a write with it.** *Later: before
BobNet's own board goes live to agents (BOB-14), together with finding 2. ADR 0001 §12 is amended
to match.*

Once a write's frame has gone out, a `disconnected` (`connection.ts:263`) or `timeout` doesn't say
whether it committed. A broker deploy drops every connection, so this happens in practice.
"Wait and retry" is safe for most ops:
- the supervisor's own ops are keyed by run id;
- `session_join`, `update`, `order`, check and uncheck end in the same state;
- write-once ops answer `conflict`.

It is not safe for `create`, `create_release`, `ask` or a criterion `add`, and `close_session` and
an answer can't tell their own retry from someone else's write. Asking agents to check first costs
tokens on every failure and goes wrong when they forget, so the fix belongs in the transport:

- `board_op` gains an optional `key` (a UUID, at most 40 characters), which `BrokerConnection.boardOp`
  makes once per write. The dashboard does the same per action. This is additive: a frame without
  a key behaves as today.
- `Board` keeps `op_keys (key PRIMARY KEY, actor, op, at, reply)` (board migration 2), written in
  the same transaction as the write. A repeat from the same actor with the same op returns the stored
  reply (result, `changed`, messages) and writes nothing. The same key with another actor or op is
  refused as `invalid`. Refused writes roll back, so they aren't stored, and a retry gets the refusal
  again. Rows older than 24 hours are deleted on write. `reply` is a cached wire reply, not board
  data. It is never exported, and it is read only to be returned, so it is not an exception to §2's
  rule against JSON as structure.
- `BrokerConnection.boardOp` resends a keyed write with the same key on `disconnected`, `timeout`
  or `unavailable`, within the same 60 s budget. After that it fails as today. An agent then sees
  either the result or "unavailable", never "may have committed". Reads simply retry.
- `capture_id` stays as it is: it is also what the offline queue dedupes on across processes.

**R2. Yes: `record_answer` messages whoever is waiting, except the recorder.** *Later, small: with
finding 1 or the next change to `store.ts`.* Recipients are the project's `lead` and `asked_by`, minus
the caller. When the lead records its own question there is no message. When Mario records Casper's
answer to a question Peach asked, Peach is told. §7's message exists so the asker's work doesn't wait
on someone remembering to forward it. Use `notify` with the caller left out. The body says it was
answered in conversation and who recorded it, for example "Casper answered Q-3 (bobnet), in
conversation, recorded by Mario@mbp-1: …", followed by the option and his words verbatim.

## Notes (no change asked)

- A. `notify` keeps the owner's email out of the recipients only because `parseRecipient` rejects
  the dot in its domain. The comment says what is meant. If the address rules ever allow dots, check
  this.
- B. `undo`'s refusal names only answers. When §5's undo of `set_release`, `order_releases` and
  `close_release` lands (BOB-7 #3, #4), the same op extends by `e.op`. §5 sets no window for those:
  Peach decides whether it is also two minutes.
- C. `undo` compares `actor_kind = 'owner'`, not the email. That is right while `OWNER_EMAIL` is one
  address (`auth.ts`).
