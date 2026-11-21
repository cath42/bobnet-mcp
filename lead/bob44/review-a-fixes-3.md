# BOB-44 review A-fixes-3 (2026-11-20)

Reviewed v2 bb51add (BOB-84, BOB-85, BOB-86: `protocol/src/secrets.ts`) and 5963584 (BOB-87: supervisor minors).
Two reviewers, as before:
- Toad, protocol and store: `architecture/reviews/2026-11-20-bob44-a-fixes-3.md` (0ed8210). Not signed off: 0 blockers,
  1 major, 3 minors. Both of Luigi's departures accepted and recorded in ADR 0007 §14 "As built, A-fixes-3".
- An independent reviewer (Mario's subagent, fresh context, read-only): 4.0M fuzzed inputs, 53 adversarial 200 KB
  timings, protocol tests 117/117.
- Mario: a lead read of 5963584 (clean); reproduced the major and minor 2 with node.

**Result: 1 major (both reviewers found it on their own), no leak, no broker-refusable output. rc.42 waits for its fix
(A-fixes-4). BOB-80's broker deploy: Toad's go stands for the release carrying bb51add plus the fix; the fix doesn't
touch `findSecret`.**

## Major

### M1. BOB-84's word edge is quadratic (`secrets.ts:152-156`)
- After merging, each span that ends inside a word walks right through the token run after it. `slack_token` stops at
  `_` and a following `-xoxb-` starts the next span, so every span walks to the end of the same run.
- `"xoxb-aaaaaaaaaa_-".repeat(n)`: 50 KB 963 ms, 100 KB 4.2 s, 200 KB 16-17 s (Toad 16.3 s, independent 17.1 s).
  Output correct (residual null). `findSecret` 0.2 ms: the broker is unaffected.
- Hits the supervisor: `withHandoff` redacts the whole handoff before the cut; its loop blocks. Breaks BOB-84 AC 4
  ("linear"). The timing test missed it: `"xoxb-aaaaaaaaaa_"` (no `-`) gives one span.
- Fix (both tested, output identical over 300k fuzzed texts): Toad's cursor (`if (e < scanned) e = scanned; … scanned = e`,
  200 KB in 6.5 ms) or bound each walk by its neighbours. Toad's is the ruling's owner's; take it. Add the `_-` chain
  to the 200 KB timing inputs (`protocol.test.ts:353`).

## Minors
1. **Overlapping token matches leave a tail** (Toad m1, independent 3; older than this build, rc.41 too):
   `Bearer AAAA….Bearer BBBB…` → `[mark] BBBB…`; a 4-segment jwt keeps its last segment(s). `findSecret(out)` is null,
   so it goes out. Unlikely shapes. Backlog task, not rc.42 (Toad): widen §14 point 1's property to every pattern.
2. **RangeError on very large texts** (independent): `found.push(...spans)` (`secrets.ts:144-145`) passes every match as
   an argument; ~125k matches overflow the stack (`"xoxb-aaaaaaaaaa ".repeat(130000)`, 2 MB, reproduced).
   `handoffText` is unbounded, so `exitEvent` would throw. Fix: push in a loop. Same function as M1: folds into
   A-fixes-4.
3. **The stand-in audit is wider than BOB-87 AC 2** (Toad m3): any reply sent as the stand-in is audited
   `remote:withheld`. Right, local audit only; noted for acceptance.
4. Toad's own sketch claimed 0 residual matches wrongly (Toad m2); Luigi's word edge fixed it. Nothing to do.

## Over-redaction (accepted, no defect)
- A token run glued after a span goes with it (`-----END PRIVATE KEY-----Thanks-for-reading` → one mark).
- `DB_PASSWORD=;API_KEY='Hunter2hunter2'` → `DB_[mark]'`. Nothing eats a whole message for one keyword.

## Checked and fine
- M1-M3 of A-fixes-2 fixed as ruled: every span on the original text, unioned, one mark each; each BEGIN through the
  first END after it (unioned with the stack pairs); jwt lookbehind; `_detected` guard on `secret` only.
- Fuzz: Toad ~760k (glued fragments; every match at every start inside one span; build ⊇ sketch), independent 4.0M
  (incl. NBSP, U+2028, lone surrogates): `findSecret(redactSecrets(x))` null and idempotence, 0 failures.
- Every pattern but M1's: 200 KB adversarial ≤ 4.8 ms.
- 5963584: no wire or store change; the withheld summary stand-in goes without `ok` and is re-checked; reconcile's
  `finally` reports withheld batches on every exit; `state_withheld` resets on a passing view or event.
- Tests: protocol 117, supervisor 373, green.

## Next
- Peach: A-fixes-4 task of BOB-44 for M1 + minor 2 (one function, one build); backlog task for minor 1.
- Luigi builds A-fixes-4; a short review (Toad; the cursor is his sketch). It can run alongside BOB-83's build
  (no shared code: secrets.ts vs supervisor upgrade).
- rc.42 carries A-fixes-3, A-fixes-4 and BOB-83. Before BOB-80's broker deploy, Toad's checks: the protocol diff
  from bb51add is additive (RemoteUpgrade) plus secrets.ts's A-fixes-4, the broker diff empty.
