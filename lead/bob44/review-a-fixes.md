# BOB-44 review A-fixes (2026-11-20)

Reviewed build A-fixes as released in rc.41: v2 7d9e1d4..bf2203f (BOB-72 b2c8a96, BOB-73 c985339, BOB-74
bf2203f). Two reviewers:
- Toad, protocol and store: `architecture/reviews/2026-11-20-bob44-a-fixes.md` (bcaf88e). Signed off, 0 blockers,
  0 majors, 2 minors.
- An independent reviewer (Mario's subagent, fresh context, read-only) on the two secrets fixes. It ran node
  snippets against the source, a 300k-body fuzz, a backtracking check, and one end-to-end case in the real
  `FakeNetwork` two-supervisor harness. Its findings are below.

**Result: 0 blockers, 1 major (F1), minors as listed. No secret leaks.** BOB-73 is correct. BOB-74 is signed off.

## F1 (major): until the broker carries the narrowed detector, a copy can stay "running" with nobody told

Both reviewers found this. Toad rated it minor 1, the independent reviewer major 1. Mario rates it **major**.
Toad's minor assumed the broker deploy would come "soon after rc.41". As planned, though, that deploy is B6
(BOB-71), the last task of build B, so the window lasts all of build B.

- **How it happens.**
  1. A worker's `checkpoint` or `error` matches the broker's old `password_assignment` only once serialised.
     Example: `"the api_key:\n\nthen goes on"`.
  2. The target's narrowed detector passes it. The broker refuses the `exit`, and the requester asks `status`
     (`supervisor.ts:1170`).
  3. `remoteView` carries the same text, so `status` is refused too, and a withheld `status` reply does nothing
     (`:1190`).
  4. The copy stays `running 0`, and poe is never told.
  5. Each reconcile's `list` is refused as well. `reconcileNow` returns at the first withheld `list` (`:1357`),
     so the other copies in that batch and in every later batch get no updates.
- **Verified:** the independent reviewer ran it in the harness and saw `list` refused three more times. Toad
  checked the pattern with node. Mario read `:1160-1200` and `:1340-1365`.
- **It heals** once the broker runs the narrowed `findSecret`.
- **The fix: Toad's advisory (c), consult c_8eed3623.** Toad records it in ADR 0007 §14.
  - (a) **Bring the narrowed `findSecret` to the broker now**, ahead of build B, with a deploy in poe's window.
    - The broker's source (`packages/broker/src`) has no changes from the last deploy on record (f0e7f8f,
      migration 4, 2026-11-17) to 8b0fe3f. Only tests and `package.json` versions changed.
    - The broker uses only `findSecret` from `secrets.ts` (`broker.ts:636`). So a deploy from the 8b0fe3f tree
      changes only the narrowed `password_assignment` and the version.
    - This answers Toad's worry about unreviewed store, migration and UI commits: they all landed before f0e7f8f
      and are already live.
    - Toad has ruled that the deploy can go in any order against the laptops (his review, "what the broker has
      to carry").
    - The deploy depends on Casper's policy answer Q1 below.
  - (b) **Requester side, a code fix (Luigi)** that stays useful after the deploy:
    - A withheld `list` goes on to the next batch and reports the withheld one at the end (Toad 1b).
    - A withheld `status` reply for a copy whose event was withheld tells poe once: "<name> on <laptop>: state
      withheld, ask there".
  - **Rejected:** the union detector on the target (the old and new patterns together). It leaves a second
    pattern to clean up, and after the deploy it would withhold more than the broker refuses.
- The known limit in `a-fixes.md` is wider than it says. That note's "the exit's state arrives by `status`" holds
  only when the match is in the handoff.

## Minors (to the backlog; none blocks build B)

1. **Toad 2: `store.ts:217-220`.** The rebuild's `ROLLBACK` can throw "no transaction is active" after SQLite has
   rolled back by itself, which hides the real error. Guard it with `isTransaction` and rethrow `err`.
2. **Independent 1: a withheld `summary` always blames the handoff** (`:1190`, `:1251`). Under the old broker,
   `result` or `last_message` can be what was refused. If the copy had already ended through `status`, the real
   handoff that follows is ignored. F1(a) removes this case.
3. **Independent 2: `withholdBody` never re-checks after `withholdWhole`** (`:197-202`). Object keys and matches
   that span fields aren't covered: `{x:["note password=",[12345678]]}` still matches, and so would a `tool_calls`
   key such as `AKIA…`. No current reply has those shapes, and the broker refuses rather than leaks. Fix: re-check
   the result, and send a withheld stand-in from the target if it still matches.
4. **Independent 3: a nested PEM leaves the outer key's tail** (`secrets.ts:30`). It's cosmetic: real PEMs don't
   nest. Fix: loop until no BEGIN is left.
5. **Independent 4: redaction can double the mark.** `api_key = sk-ant-…` gives "[withheld: …] looks like a
   credential]". It's cosmetic. Fix: redact `password_assignment` first, or skip a value that starts with the
   mark.

Noted, no fix: Toad's two notes on the `:315` comment and the mark's length after a cut.

## Policy questions (what counts as a secret): Casper's

Asked in Mario's session. His answers are recorded below as given.

- Q1. After the deploy, a `password=`/`secret=`/`api_key=` value with a `\` in its first 8 characters isn't
  caught. Examples: `password=Pa\ssw0rd!!`, a Windows path.
- Q2. A BEGIN line with no END withholds the rest of the field, for example the rest of a handoff that quotes a
  BEGIN line in prose.
- Q3. Never detected, and older than these fixes:
  - PGP private key blocks
  - lowercase PEM headers
  - PuTTY `.ppk` keys
  - `DB_PASSWORD=…` and other `X_PASSWORD` names (`_` defeats `\b`)

## Checked and fine (independent reviewer)

- **PEM redaction (ran):**
  - two keys
  - missing END
  - CRLF
  - an END of another type
  - an END for a certificate
  - END before BEGIN
  - Proc-Type and DEK-Info headers
  - a JSON-escaped PEM
- **Cutting:** redaction runs before the cut, and the mark's growth fits within the 1024-character margin.
- **The new detector across JSON escapes:** the serialised body matches only where a field does (fuzzed, 0 gaps).
  Nothing that redaction outputs still matches.
- **Backtracking:** none; 200 KB adversarial inputs take 1-2 ms.
- **Requester behaviour:**
  - no loops
  - `told` prevents a second notice
  - an ended copy never goes back to "not ended"
  - reconcile stops asking once the handoff is marked withheld
