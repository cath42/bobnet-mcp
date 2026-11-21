# BOB-44 review B (Mario, w_1dabfe34, 2026-11-21)

Session `BOB-44 review B`. Reviewed v2 b289bfe^..b2bc9af (BOB-66..71, 75), released as rc.43 (757058e). mbp-1 runs
rc.43 since 14:47:24Z (poe's hand install); ubu1 is on rc.41 until Casper's A-2.

Two reviewers:
- Toad, protocol, store and the broker sign-off: `architecture/reviews/2026-11-21-bob44-build-b.md` (299e89b), and
  ADR 0007 §14 "As built, build B". 0 blockers, 1 major, 7 minors. Every departure I flagged is accepted.
- An independent reviewer (Mario's subagent, fresh context, read-only): `review-b-independent.md`. 0 blockers,
  1 major, 9 minors; three verified with both supervisors real. typecheck clean; supervisor 482, protocol 135.

**Result: 1 code major (stale request copies, found by both), so the fix loop (session `BOB-44 build B-fixes`,
BOB-96 already in it) runs next. The independent major is fixed without code here (rc.43's rollback order).
Broker deploy: Toad's go, held on A-2.** Nothing is unsafe on rc.43 meanwhile: no cross-laptop v: 2 request can
happen until ubu1 runs rc.43, and that is A-2.

## Majors

- **Stale request copies** (Toad M1 = independent m2, verified): a copy that missed its `settled` (the requester away
  over a day, a withheld `settled`, a target rolled back) stays open in `pending_requests` for good. Fix: F1.
- **An older requester leaves v: 2 requests with no answerer** (independent M1 = Toad m6). The rc.43 order rule
  (requester first) covers the install, but the notes' rollback line rolled mbp-1 back alone. **Fixed here:**
  rc43-notes.md now says roll back the target first. The code guard (the target routes to its spawner only if the
  spawner runs rc.43 or later) is Toad's m6: backlog, by his ruling.

## The fix loop (Luigi, session `BOB-44 build B-fixes`, one commit per task, in this order)

| # | Findings | Side | Severity |
|---|---|---|---|
| F1 BOB-97 | A full `list` whose worker view carries a `requests` array finalises the open/orphaned copies it omits (state `gone`, rank 2; no key = no change); `pending_requests` leaves out an open/orphaned copy over a day old; final copies pruned after a day; the `answer` reply's `state` updates the copy; `copyView` strips `requests` before storing (no stale list in `list_workers`/`worker_status`). Tests as Toad's M1, plus the independent probe's case. | requester | major (Toad M1, independent m2, m3) |
| F2 BOB-98 | The `answer` op refuses a non-`isV2` worker's request ("its requests are answered on <laptop>"); the target refuses a v: 2 spawn whose `by` fails `isValidSegment`. | target | minor (Toad m1 = ind. m7; Toad m2 = ind. m1) |
| F3 BOB-99 | `fitRequest` cuts `answers` and checks the result fits (else `input` a stub, `truncated`); a withheld `request`/`answer` reply's text gives the right advice (Toad m5); the `answer` op audits what happened: `remote:answer` when the answer applied even if the reply is withheld, and a resume `spawn()` failure caught apart (answered, not resumed, said so). | target | minor (Toad m4 = ind. m6; Toad m5; ind. m5) |
| F4 BOB-100 | "Spawned after all" only when no other copy has that `spawn_req` (Toad m3); a stop that races a shutdown settles the request (stop intent per worker, not only `closing`) (ind. m4). | both | minor |
| F5 BOB-101 | Tests with both ends real: `answer_request` with `resume` on an orphaned remote request through the requester's tool (the reply's `resumed`, the `resumed` event's new copy); a question answered through the requester's tool (`answers`). | tests | minor (Toad m7) |

BOB-96 (Daisy's F1) is in the loop already: landed 511a1ce.

## Backlog
- BOB-102: Toad m6 = independent M1's code guard: the target refuses (or routes locally) a v: 2 spawn from a requester below
  rc.43, read from the peer list.
- BOB-103 (spike, Toad): independent m8: a spawn whose worker ends before adoption is never adopted (the ADR leaves it); for Toad to keep
  or rule.
- Independent m9: request copies without a worker copy show project "?"; `remote_asks` rows never deleted (joined to
  BOB-76, the pruning item).

## Broker deploy (BOB-71 AC 4, BOB-80)
Toad: go, from 757058e or a later v2 whose broker/protocol-src diff to it holds only reviewed fixes (BOB-96 is one;
none of F1-F5 touches the broker). Condition: both laptops on rc.42 or later (BOB-80's `findSecret`). ubu1 is on
rc.41, so the deploy waits on A-2; per Casper's brief, BOB-71 AC 4 stays open until both run rc.43.

## Log

- 14:48Z Toad w_232c69a8 (protocol, store, broker sign-off for BOB-71 AC 4); an independent reviewer (Mario's
  subagent, fresh context, read-only). Peach w_6e81af02: BOB-96 Draft -> Ready.
- 14:49Z Luigi w_457fae46 on BOB-96 (session `BOB-44 build B-fixes`), the fix loop's first task.
- 14:52Z BOB-96 landed 511a1ce (Luigi w_457fae46): Daisy's rule plus `.l-who * { text-indent: 0 }` (the mark's
  "@" was cut without it). Read: 390 shot lines the wrapped role up with the name; 1440 shots byte-identical. For
  Peach with the findings (AC 1). Not deployed.
- ~15:2xZ Toad's review landed 299e89b (architecture/reviews/2026-11-21-bob44-build-b.md): 0 blockers, 1 major (M1:
  a request copy that missed its `settled` stays open on the requester for good), 7 minors; every flagged departure
  accepted; ADR 0007 §14 "As built, build B" (requester first; "either order" struck for rc.43). Broker deploy: GO
  from 757058e or a later v2 with only reviewed broker fixes, once both laptops run rc.42 or later (BOB-80 rides it).
- 15:0xZ Disposition landed ff1397e. Peach w_fd94b69d: F1-F5 are BOB-97..101 (Ready, build-B-fixes); BOB-96 AC 1
  checked; backlog BOB-102, BOB-103; m9 joined to BOB-76. Session closed.

## Waiting on A-2 (Casper), not worked around
- BOB-69 AC 6: the real-broker §4 check needs ubu1 on rc.43 and the `bob44-probe` rule.
- BOB-71 AC 4: the laptop-mark deploy needs both laptops on rc.43 (Toad signed off; BOB-96 landed 511a1ce).
