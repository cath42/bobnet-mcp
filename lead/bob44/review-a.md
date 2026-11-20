# BOB-44 review A: disposition (Mario, 2026-11-20)

Build A (BOB-59..65, 517ec3a..6883060, plus 28f4cc0), released as rc.40 and accepted on the real broker
(`ac10-evidence.md`). Two reviews:

- Toad, protocol and store: `architecture/reviews/2026-11-20-bob44-build-a.md` (74388d7, e2b9e7e). 0 blockers,
  0 majors, 4 minors of his own; his finding 1 raised into the independent major 1.
- Independent (a fresh reviewer outside the team), the supervisor and tools: `review-a-independent.md`.
  2 majors (both re-checked by Mario), 8 minors.

**Result: 2 majors, so a fixes build comes next (session `BOB-44 build A-fixes`), then review, then build B.**
No blocker. Nothing in A is unsafe to leave running on rc.40 meanwhile: in A, poe@ubu1 still answers ubu1's
requests and sees every worker, so a stranded copy (major 1) costs poe@mbp-1 a notice, not a lost worker.
Major 2 (a PEM body sent to the broker) needs a key in a handoff, tail or error of a worker spawned across
laptops; none runs today except by poe for a test.

## The fixes build (Luigi), in this order

| # | Finding | Where | Severity |
|---|---|---|---|
| F1 | The secret check on the serialised body: the target runs `findSecret` on the body after per-field redaction and withholds the matching field whole (`handoff_text: null, handoff_withheld: true`); the requester ends a copy whose `summary` (or `exit`) comes back withheld and tells poe "handoff withheld: ask <role> on <laptop>", and stops asking. In `protocol`, `password_assignment`'s value class drops the backslash (`[^\s"'\\]{8,}`); that narrows the broker's detector and rides B6's broker deploy (via poe), the target's body check guards until then. Tests: a multi-line handoff against the fake's detector; a FakeNetwork whose broker refuses what the target doesn't. | independent M1, Toad 1 | major |
| F2 | PEM redaction: `private_key` redacts BEGIN..END (or end of text); `findSecret` unchanged (no deploy). Test: a PEM block in a handoff; after redaction `findSecret` is null and no base64 line is left. | independent M2 | major |
| F3 | The quick minors, one task: reply and event schemas applied on read (`RemoteWithheld`, an `exit` state enum, `worker.id`/`workers[].id` strings) and `.catch(log)` on `onRemote` (Toad 2, independent 5); the `remote_requests` rebuild in `BEGIN IMMEDIATE`..`COMMIT` (Toad 3); a start check refusing when `state_dir` is unset and `<cwd>/~/.local/state/bobnet/supervisor.db` exists, naming both paths, no auto-move (Toad 4); `redactSecrets` flags without a double `g` (Toad 5); the exit's `lands` capped to fit (independent 6); `remoteAsk`'s sleep timer cleared (independent 8); `list_workers laptop:"*"` asks laptops in parallel (independent 9); `copies.test.ts` negative assertions wait on a positive signal first (independent 10). | Toad 2-5, independent 5, 6, 8, 9, 10 | minor |

The quick minors ride the fixes build rather than a Luigi spawn in this review: the fixes build is next
anyway and touches the same code (one load of context, not two).

## Elsewhere

- **Build B:** independent 3 (`remote_sent` left `sending`/`sent` across a restart) goes with §14's lost-ack
  task (`sent` past deadline -> `unanswered`; `sending` -> `unacked` once that task lands). Independent 4
  (resume and `reset` drop `spawn_req`/`remote_by`) is B1 (BOB-66), as §4 says.
- **Backlog:** independent 7, pruning `remote_sent` and `remote_requests` (keep every spawn row a copy names).
- **§9 `v`-less events:** Toad ruled no fix in A or B; §9's sentence struck (§14 points to the review).
- **Release note (Mario, rc.41):** rc.40 moved the db and pid file of a laptop without `state_dir` to the real
  `~/.local/state/bobnet` (Toad 4); mbp-1 sets it, ubu1 was moved by hand. Goes in the release commit and the
  note to poe.

## Items

No finding contradicts BOB-59, 60, 62 or 63. Majors touch BOB-61 (`findSecret` before enqueue), BOB-64 (the
exit's handoff) and BOB-65 (copies, the end notice). Peach accepts or reopens each against its criteria, and
puts F1-F3 on the board under BOB-44 (and the lost-ack task for B, and the pruning item, if not there).
