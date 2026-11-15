# Review: 5b6717e, the bob5 review's follow-ups (lead/plan.md 0b)

Toad, 2026-11-14. Luigi's commit for R1, finding 2, R2 and finding 3 of
`reviews/2026-11-14-bob5-service-review.md` (handoff w_07934845). I read the diff and the code
around it (`Broker.boardOp`, `migrate`, the capture queue, the supervisor's outbox flush), and
checked each ruling against the code.

**Verdict: signed off.** Nothing to fix. Mario's two questions are answered below. The rollout
order is a release constraint, and it is stricter than the plan says.

## Against the rulings

- **R1, the frame.** `BoardOpFrame.key` is `z.string().min(1).max(40).optional()`
  (`protocol/src/frames.ts`). It is additive. `handoffBudget` reserves room for 40 characters of key,
  so a close's handoff text can't push a keyed frame over `frameBytes`.
- **R1, the board.** Board migration 2 adds `op_keys (key PRIMARY KEY, actor, op, at, reply)` and
  an index on `at` (`board/schema.ts:372`). `migrate` runs from the stored `schema_version`, so a
  live board at version 1 gets only migration 2. `writeOnce` (`board/store.ts:418`) deletes rows
  older than 24 h. A repeat by the same actor (`whoOf`, as events name them) with the same op
  returns the stored reply and writes nothing. Another actor or op gets `invalid`. A refused write
  throws, so the transaction rolls back and no key is kept (tested). `op_keys` appears nowhere else
  in `broker/src`, so export never carries it. That keeps §2's rule, as the review asked.
- **R1, the connection.** `BrokerConnection.boardOp` (`client/src/connection.ts:141`) makes one
  UUID per call, and none for `BOARD_READS`. It resends the same frame on `disconnected`, `timeout`
  or `unavailable`. While disconnected it waits out the remaining budget for the reconnect. While
  connected it pauses 2 s, and if less than 2 s is left it fails as "the board is unavailable since
  …". Every other code is thrown at once. The capture queue's `PERMANENT` and the supervisor's
  `FINAL_BOARD_ERRORS` don't include `unavailable`, so a flush at `waitMs` 0 that now fails as
  `unavailable` instead of `disconnected` still waits and is retried.
- **Finding 2.** `Broker.boardOp` passes `frame.key`, and on a replay it stores and delivers
  `reply.messages` again (tested end to end in `board-op.test.ts`). A reply lost after the commit
  still tells the lead.
- **R2.** `recordAnswer` calls `notify(..., tx.caller)`, which drops the caller's `addressKey` from
  the lead and the asker. When the owner records an answer, nobody is skipped, which is right,
  because his email is never an address. The body is the ruling's wording, and `told` is on
  `BoardResults.record_answer` (additive).
- **Finding 3.** `fromBoard` (`protocol/src/board.ts`) is the one check, and both receivers use it.
  `Inbox.toEvent` drops the cross-team note and says the message takes no reply. `formatInbound` drops
  the reply line. Checking only the laptop is enough: `authenticate` refuses a `board` laptop token
  in any case, and only laptops register.

## Mario's questions

**(a) Rollout order: broker deploy first, then rc.31. Confirmed, and it is a hard constraint.**
A new client against the pre-migration broker is worse than "no idempotency". The old broker's
`BoardOpFrame` is a plain `z.object`, so it strips `key`. But the new client now *resends* writes
on `disconnected` and `timeout`, which the old client never did. Suppose a `create`, `ask`,
criterion `add` or `close_session` committed and only its reply was lost. The resend then writes
it a second time. So:

1. Deploy the broker carrying Board migration 2 (Casper's call).
2. Only then install rc.31 and restart the supervisor (poe). The same goes for any channel client
   started from rc.31.

The other direction is safe. An rc.30 supervisor or client against the new broker sends no key and
behaves as today. Put the constraint in rc.31's release notes: "needs the broker with Board
migration 2; don't install before that deploy". There is one production broker and Mario controls
the order, so a capability check in the client isn't worth its cost now. If a second broker or a
self-hosted one ever exists, gate the resend on the broker's version in `registered`.

**(b) writeOnce's write and its `op_keys` insert are atomic.** `Board.apply` calls `writeOnce`
inside the same `ctx.storage.transactionSync` callback as the write (`board/board.ts:36`). The
DELETE of old keys, the write and its events, and the INSERT of the key commit together or not at
all. If anything throws after `write` returns, the callback throws and the write rolls back,
including a failed INSERT or a `JSON.stringify` that fails. If the object dies mid-callback,
nothing is stored. The output gate holds the reply until the commit is durable. Two sends with one
key can't interleave either: `apply` has no `await` before `transactionSync`, so the object runs
one call to the end before the next, and the second finds the first's row.

## Notes (no change asked)

- A. Keys are per `boardOp` call, not per queued item. Each flush of the capture queue or the
  supervisor's outbox makes a fresh key. That is fine because what goes through them is idempotent
  on its own: `capture_id`, and the run-id ops (R1). If an op without its own id ever goes into a
  queue, store its key with the item.
- B. A write can run past the 60 s wait by up to one 15 s request timeout (Luigi's decision).
  Accepted: the capture queue needs a whole send at `waitMs` 0. ADR 0001 §12's amendment now says so.
- C. The same key with the same actor and op but a different body returns the first reply. Only a
  buggy client could send that, so there is no hash of the op.
- D. A replay sends `board_changed` to the owners again and stores its messages under new ids. Both
  are harmless duplicates (finding 2 allows them). If duplicate messages ever become noise, make the
  message id from the key.
- E. No test resends on `timeout` itself. It takes the same branch as `disconnected` and
  `unavailable`, which are tested. Add one if `connection.ts` is touched again.
- F. The dashboard's answer UI must make one key per answer, done mark or undo, and resend with
  that key (ADR 0001 §7, Luigi's open question). That belongs to BOB-5's client side, not here.
