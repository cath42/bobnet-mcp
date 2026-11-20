# BOB-44 review A: independent code review of build A (2026-11-20)

Reviewer: a fresh reviewer outside the team (Mario's subagent, no prior context), read-only, on
`git diff 517ec3a^..28f4cc0` (BOB-59..65 and the state_dir fix, released as rc.40) against ADR 0007 §1-§9
and §14. It left out §14's two open items (the v-less exit/remote_control drop, the lost spawn ack).
Mario re-checked both majors (1 with node: the raw text doesn't match `password_assignment`, the
serialised body does; 2 read in `secrets.ts`).

No message loop between supervisors, no forged sender accepted, old callers unchanged. **2 majors, 8 minors.**

## Majors

1. **The target's per-field secret check misses what the broker's whole-body check catches; the end and
   handoff are then never delivered.** `supervisor.ts:166` (`withholdSecrets`), `:235` (`withHandoff`),
   `:1076-1103` (`onRemoteEvent`). JSON turns a newline into `\n`, which isn't whitespace to the regex, so
   `password_assignment` can match the serialised body when no field matches (e.g. a handoff line ending
   "api_key:" then a blank line and a word). The broker refuses `secret_detected`, the outbox sends
   `withheld`, `onRemoteEvent` ignores it, the copy stays running; reconcile's `summary` reply is
   withheld too and `copyFromReply` returns early: poe is never told and never gets the handoff, and each
   reconnect asks again. Fix: on the target, check `findSecret` on the final serialised body (and redact
   per field in serialised form) before queueing; on the requester, a `withheld` exit or `summary` for a
   known copy marks it ended, tells poe "ended; handoff withheld, ask on <laptop>", and stops asking.
2. **Withholding a private key keeps the key.** `protocol/src/secrets.ts:5`, `:23` (`redactSecrets`).
   `private_key` matches only the BEGIN line, so redaction replaces that line and sends the base64 body and
   the END line, which then passes the broker's check and is stored there for a day. Before build A the
   broker refused the whole body. Fix: redaction covers BEGIN through END (or end of text), or a
   `private_key` match withholds the whole field. Test with a PEM block.

## Minors

3. `remote_sent` rows stay `sending`/`sent` across a requester restart; `deadline` is written, never read
   (`store.ts:423`, `:454`; `supervisor.ts:1189`). A spawn whose tool died with the restart never gets
   "spawned after all" (`copyMade` needs `unanswered`). Fix: at start, past-deadline `sent` -> `unanswered`,
   `sending` -> `failed`.
4. Resume of an orphaned request and `reset` on the target drop `spawn_req` and `remote_by`
   (`supervisor.ts:808-818`, `:716`): the new worker's events are v-less and dropped, reconcile never asks.
   Reachable after a target restart (poe@ubu1 is told "answering resumes the worker"). §4 says resume copies
   `remote_by`. Fix: carry both; or build B (B1 owns resume).
5. A malformed reply from the target crashes the requester (`supervisor.ts:1113` -> `copyView`, `:958`):
   `w.id` unchecked, `remoteCopy(laptop, undefined)` throws in node:sqlite, `void this.onRemote(msg).finally(ack)`
   has no catch, no `unhandledRejection` handler. Only an authenticated target can send it. Fix: check
   `typeof w.id === "string"`; `.catch(log)` on `onRemote`.
6. The exit's `lands` list has no count limit (`supervisor.ts:2345`, `withHandoff` `:235`): ~50 lands put the
   base over 16 KiB, `withHandoff` returns `at(0)`, still too long, dropped `too_long`; reconcile recovers the
   end, the lands are lost. Fix: keep the last N, or fit them before the handoff.
7. Nothing prunes `remote_sent` or `remote_requests`; an `unknown` copy adds 288 `list` rows a day for good.
   Fix: prune finished rows older than a day.
8. `remoteAsk`'s sleep timer is never cleared (`supervisor.ts:1340`); unref'd, harmless, piles up.
9. `list_workers laptop:"*"` reconciles one laptop at a time; a half-open target makes it take minutes.
   Fix: in parallel, or cap the wait for list views.
10. Tests: negative assertions after a fixed `tick(30)` (`copies.test.ts:343`, `:284-300`) would pass if the
    event was never processed; no test for 1, 2 or a withheld exit reaching the requester. Fix: wait on a
    positive signal (ack or audit) first.
