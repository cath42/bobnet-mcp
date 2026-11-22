# Review: BOB-111 build A (c87bd1a), an answer is a notice row

- **Reviewer:** Toad, 2026-11-22. **Against:** ADR 0009, the build brief (`architecture/bob111/build-brief.md`),
  BOB-111 AC1-4. Luigi's handoff: `~/.local/state/bobnet/handoffs/bobnet/w_371a34f2.md`.
- **Diff:** `git diff 26c19a5 c87bd1a`. Line numbers are at c87bd1a.
- **Verdict: signed off.** 0 blockers, 0 majors, 3 minors. None needs a fix before the deploy. The ADR
  gets an addendum (below) for three things the build settled.

## Exactly-once

- **In the answer's transaction.** `notify` (`board/store.ts:2149`) inserts the `notices` row in the write's
  `Tx`, inside `transactionSync` (`board/board.ts:37`). A refused write rolls back answer and row together.
  `tx.messages` is gone, so nothing else carries a board message.
- **Drain** (`broker.ts:411`). `notices()` is awaited. The loop over the rows does no await, and it runs
  `sendNotice`: check `m_board_<seq>` / `_s`, then store and fan out. Only after that comes
  `await noticesTaken`. Two overlapping drains can't both store a row: the second one sees the message
  and only marks it (`UPDATE … AND taken_at IS NULL`).
- **Crash before the mark.** The DO output gate holds the outgoing `noticesTaken` RPC until the Broker's
  `messages` insert is durable. So the order is store first, mark second. There is no window where the
  row is marked but the message is lost. A crash in between leaves the row untaken, and the next drain
  only marks it. `messageExists` stays true until the message's TTL: deliveries are deleted on ack, but
  messages only on expiry (`broker.ts:747-748`). The next drain comes much sooner than that: the next
  write, a supervisor's register, or the alarm (an hour at most, a minute after a caught failure). Test:
  "stores a notice once when a drain ends before marking it taken" (a trigger makes the mark fail; the
  register and the alarm both drain; the message is stored once and not delivered again).
- **Replay (§12).** `writeOnce` returns the cached reply with its `changed`, so the broker drains (nothing
  new) and `toldBefore(seq)` rebuilds `told`, `waiting` and `supervisor` from the stored messages. No second
  row, no second message. A key cached before the deploy still carries `messages`: the broker ignores it.
  The answer went out the old way then, and nothing is resent. Test: "answers a keyed answer's resend
  with the same reply, and stores nothing more".
- **Seq as the id.** One `Board` DO holds every project (`BOARD = "board"`), and `events.seq` is
  `AUTOINCREMENT` (`board/schema.ts:339`). Import inserts new events, so seqs never repeat across projects
  or after an import. `m_board_<seq>` is unique.
- **Withdraw, edit, reconnect, recorder:** all as ADR §1 says, and each has a test (`answer-notices.test.ts:131-172`,
  `:78`).
- **Draining after every changed write** (handoff question): this is what ADR §1 says. It costs one
  `notices()` RPC per write, and an empty result returns without the mark. Keep it.

## Migration 6 on DO SQLite

`board/schema.ts:422`: one `CREATE TABLE notices` and one partial index. It is purely additive: no rebuild,
no FK, and nothing refers to the table. `"except"` is quoted, since it is a keyword. Partial indexes and
`CHECK` are plain SQLite. `migrate` runs inside `transactionSync` (`board/board.ts:22`), so the table and
`schema_version = 6` commit together, or neither does. `export.ts` doesn't read `notices`. Safe.

## The supervisor pick (helix: mbp-1 and ubu1, lead Bob@mbp-1)

`noticeSupervisor` (`broker.ts:501`) collects the `laptop_supervisors` rows whose `projects` include
`helix`. With two, it takes the row whose laptop is the lead's (the `lead` field of the JSON, here
`mbp-1`), matched case-insensitively. That is poe@mbp-1. ubu1 isn't told. Test: "tells only the supervisor
on the lead's laptop when several serve…" covers the same shape with the lead on mbp-2, and the fallbacks
to the asker and to nobody (audited).

One precision for the ADR. `laptop_supervisors.projects` is what the supervisor registers. That is
`serviceProjects()`, the projects with `board: service` (`supervisor.ts:670`, `:3328`), not every project
it runs. That is the right set: only a project whose board is the service has questions to answer. But
**mbp-1's helix entry must say `board: service`** for poe to be a candidate. If only ubu1's did, ubu1
would be the one candidate and would get the notice. Mario's AC2 live check should confirm that mbp-1
registers helix: the `laptop_supervisors` row, or the notice's `supervisor` in the toast.

## The owner's email

- `by` is `"owner"` for an owner caller (`store.ts:2195`), never `tx.who`.
- `asked_by` and `lead` go through `address()`, which needs `parseRecipient`. `SEGMENT`
  (`protocol/src/address.ts:6`) refuses a dot, so an email's domain always fails, and the owner's
  `asked_by` becomes null.
- `except` is null for the owner. The text says "Casper", and the audit actor is `board`.
- The AC1 test checks that the JSON has no email. Holds.

## BoardMessage's removal and rc.48/49

- `BoardMessage` and `BoardReply.messages` were types between the Board DO and the Broker DO, both in the
  broker worker. `grep` finds no use in `packages/client` or `packages/supervisor`. The four results gain
  the optional `waiting` and `supervisor` and keep `told`, so an rc.48/49 client reads them as before.
- An rc.48/49 supervisor gets `m_board_<seq>_s`. In its `onRemote`, `readRemoteRequest` returns null (no
  `op`), and so does `classifyRemote` → `event`. `RemoteEvent`'s `z.enum(REMOTE_EVENTS)` at 26c19a5 lacks
  `answer`, so the event is logged "doesn't parse; dropped" and nothing else happens. I checked this at
  26c19a5. Agents still get the text. This is ADR §3, as designed.
- The new supervisor branches on `fromBoard(msg) && event === "answer"` before the schema pick
  (`supervisor.ts:1349`). It records the id before it forwards, skips the orchestrator's own answers,
  and doesn't spawn. Its own `board_notices` table, instead of `remote_requests`, is right: start-up
  replays unfinished `remote_requests` rows as requests.

## AC map

AC1, AC3: broker tests as Luigi lists them. They hold. AC2: broker side tested. The supervisor side
is tested with its broker faked, and the "both ends real" evidence is Mario's live check after the release
and restart. AC4: dashboard test and the shots. I looked at `bob111-answer-toast-390.png`: "sent to
Picard, kong and poe; waiting for kong to come online", in the existing toast, readable on a phone.

## Findings

**Blockers:** none. **Majors:** none.

**Minors** (Luigi's call when; none blocks the deploy):

1. **One bad row stops the queue.** If `sendNotice` throws for one row, `drainNotices` throws for the whole
   batch. Rows before it are stored and later only marked, but every row after it waits behind it on
   every retry. I found no input that throws today: `store` doesn't validate, and the JSON comes from the
   board. Catch per row, audit `notice:send_failed` with the seq, and leave that row untaken (or mark it,
   once it has failed N times), so the rest still go.
2. **Deploy skew.** For the seconds while an old Broker instance talks to a new Board, the old
   `for (const m of reply.messages)` throws on `undefined`. The answer is committed and its row waits for
   the new broker's drain, so nothing is lost. The caller may see an error for a write that landed. Tell
   Mario so he isn't surprised. No code needed.
3. **`supervisor: null` when the supervisor is the writer.** If the supervisor's own name records an
   answer, `sendNotice` drops it as `except`, and the reply then says `supervisor: null`, which reads as
   "no supervisor runs it". Only an MCP reply shows it, never the dashboard toast (the owner has no
   `except`). Cosmetic.

## ADR 0009 addendum

Recorded in `decisions/0009-answer-notices.md`, "Addendum (2026-11-22, build A)": `lead` in the JSON, the
candidate set being the projects with `board: service`, `BoardMessage` removed, and `supervisor` in the
result.

## Rollout (for Mario)

1. Broker deploy (poe gives the window). Migration 6 runs on the Board DO's first touch. AC1, AC3 and AC4
   go live. Check: a real question holding a session answered on the dashboard; the asker gets the text with
   `Holds:`; screenshot the toast.
2. Release and restart of mbp-1's supervisor (and ubu1's). AC2 goes live. First confirm that mbp-1
   registers helix (`board: service`). Check: poe@mbp-1's orchestrator gets the forwarded text.

## After sign-off (2026-11-22)

Mario raised, as a major after sign-off, that the supervisor forwarded only to `orchestratorOf`. Ruling
(consult c_6d88fb52) is in ADR 0009's second addendum: forward to `config.orchestrator`, and also to
`project.orchestrator` if it differs from `config.orchestrator` and from the asker.
