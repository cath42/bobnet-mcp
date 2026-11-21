# BOB-44 review A-fixes-2 (2026-11-20)

Reviewed v2 63c29b5..dd9279e: BOB-79 be04f99, BOB-81 ae52e84, BOB-78 8eb7c5e, BOB-80 dd9279e. Two reviewers:
- Toad, protocol and store: `architecture/reviews/2026-11-20-bob44-a-fixes-2.md` (pending at this writing).
- An independent reviewer (Mario's subagent, fresh context, read-only): node snippets against the source, a 2M-input
  redaction fuzzer, a 300k-body `withholdBody` fuzz, timings on 200 KB adversarial inputs. Its findings are below.

**Result (independent + Mario): 3 majors. rc.42 and BOB-80's broker deploy wait for the fixes.** Mario reproduced
all three with node (`password=x;password="RealSecret123"` → `[W]"RealSecret123"`; the nested case below; jwt
`"eyJ-".repeat(4000)` 372 ms in `findSecret`).

## Majors

### M1. An assignment's value swallows a second assignment: the real secret goes in clear
`secrets.ts:103` (`redactSecrets`, last replace; the same at 63c29b5, so older than this build).
- `[^\s"'\\]{8,}` takes `x;password=`, the match stops at the quote, the quoted secret after it stays.
  `findSecret` of the result is null, so `withholdBody` sends it and the broker passes it.
- `password=x;password="RealSecret123"` → `[withheld…]"RealSecret123"`; `{api_key:x,password:"Hunter2hunter2"}`;
  `DB_PASSWORD=;API_KEY='Hunter2hunter2'`. Verified end to end through `withholdBody` and the broker check.
- Fix (reviewer): redact the union of the matches at every keyword position, linear by precomputing where each value
  run ends; weaker: after redacting, a quoted value right after the mark goes too. Toad picks.

### M2. An unclosed outer BEGIN keeps its key body although an END follows (departs from §14 "Ruling, BOB-80" 4)
`secrets.ts:58-73` (`blockSpans`).
- The ruling: a BEGIN redacts through the first END of its kind after it; only with no END after it, its own line.
- The stack lets an END close only the latest BEGIN, so the outer BEGIN, left open, shrinks to its line:
  `BEGIN\nOUTERKEYDATA\nBEGIN\nINNER\nEND\ntail` → `[W]\nOUTERKEYDATA\n[W]\ntail`. Leaks through `withholdBody`.
- Fix: after the stack pass, an open BEGIN with any END after it spans to the next END after its start (a pointer
  walk, linear); only a BEGIN with no END after it gets its line.

### M3. The jwt pattern is quadratic (live on the broker since e09d671)
`secrets.ts:34`. Every `-eyJ` is a `\b` start, each scans the whole `[A-Za-z0-9_-]` run.
- `"eyJ-".repeat(n)`: 16 KB 372-578 ms, 50 KB 4.4 s, 200 KB 31.7 s (`redactSecrets` 76 s). §14's "under 5 ms" fails.
- Broker CPU per send, and the supervisor's event loop (`withHandoff` redacts the whole handoff before the cut).
- Fix: `(?<![A-Za-z0-9_-])eyJ…` in place of `\b` (200 KB in 4 ms; still matches a real JWT). It changes
  `findSecret`, so it rides BOB-80's broker deploy.

## Minors

1. **Redacted output can still match** (`secrets.ts:103`): `api_key=secret:"abcdefgh"` → `api_key=[withheld:…` matches
   again; no leak, the field goes whole. The M1 fix covers it.
2. **`state_withheld` never resets** (`supervisor.ts:1178`, `:1252`; also in the build close's lead read). At 2, a later
   withheld `exit` asks no status; the copy waits for reconcile's list, forever while that is withheld too, and poe
   isn't told it ended. At 1 after a passing status, a later withheld status poe asked for itself notifies.
   Fix: `state_withheld: 0` in `copyView` when a view passes.
3. **Reconcile drops the withheld report when a later batch gets no reply** (`supervisor.ts:1385`). Report before
   the early return.
4. **Flaky land gate** (`protocol.test.ts:131`): the wall-clock `< 50 ms` failed 1 run in 4 (53 ms, cold JIT). Compare
   n against 2n, or warm up.

## Notes (match the ruling)
- An unclosed BEGIN, or a PuTTY header with no Private-MAC, leaves the body in clear (Casper's Q2).
- The PuTTY span ends at the MAC's hex, not its line's end as §14 says; harmless.
- Not detected: `PGPASSWORD=`, `secret-key:`, `"password": "…"`, 5+ segments, `password_detected=` (the
  `(?!_detected\b)` exclusion applies to every keyword, not only `secret`).
- Now withheld (AC 7 accepts): `secret_key: src/config/keys.ts`, `the api_key: config.apiKey()`, `password_hash: bcrypt(...)`.

## Checked and fine (independent)
- `findSecret(JSON.stringify(withholdBody(x))) === null`: 300k random bodies plus keys, cross-field arrays, nested keys;
  every stand-in passes the broker.
- CRLF, mixed-case PEM, PGP BLOCK, ENCRYPTED/OPENSSH labels, a 41-char label (not detected, consistently), PuTTY v3.
- The ruling's must-match and must-not-match lists all pass.
- Every pattern but jwt: 200 KB adversarial under 13 ms.
- BOB-78: the withheld `list` stand-in carries `re`/`req`; concurrent withheld statuses notify once.
- BOB-81: `isTransaction` on `node:sqlite` (engines >=24); the `state_withheld` migration is idempotent.
- Tests: supervisor copies/exit/delivery 80 passed; protocol 108 passed (minor 4 aside).

## Next
Toad rules the fixes (M1's approach, M2 against his ruling, M3's pattern) in ADR 0007 §14; Peach makes M1-M3 tasks of
BOB-44 and the minors backlog or same-build tasks; Luigi builds A-fixes-3; then rc.42, laptops first, then the broker
deploy (BOB-80 AC8, with M3 riding it).
