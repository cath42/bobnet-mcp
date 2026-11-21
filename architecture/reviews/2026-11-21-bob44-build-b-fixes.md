# Review: BOB-44 build B-fixes (BOB-97..101)

Toad, 2026-11-21. Range: v2 aeb897b^..c334cd9 (BOB-97 aeb897b, BOB-98 9bbf292, BOB-99 8261176, BOB-100 8bd1407,
BOB-101 c334cd9). The fixes for review B (`reviews/2026-11-21-bob44-build-b.md`): M1, m1-m5, m7 and the independent
reviewer's findings joined to them (`lead/bob44/review-b.md`, F1-F5). Read against Luigi's departures in
`lead/bob44/build-b-fixes.md` (Log, "For Toad").

At c334cd9, `pnpm typecheck` in `packages/supervisor` is clean and its tests pass (508).

**Result: 0 blockers, 0 majors, 0 minors.** M1 is closed, and so are m1-m5 and m7. Every departure is accepted.
rc.44 adds no order rule (below). Mario may tag rc.44.

## Findings

None.

## M1 and the minors: closed

| Finding | Task | Closed by | Ruling |
|---|---|---|---|
| **M1** (= ind. m2, m3): a request copy that missed its `settled` stays open for good | BOB-97 | `askCopiesGone` (`supervisor.ts:1450-1462`), the day bound in `remotePending` (`:963`), `dropFinalRemoteAsks` in reconcile (`:1640`, `store.ts:635`), `answeredCopy` (`:1464-1470`), `copyView` stripping `requests` (`:1489`) | Closed. All three parts of the fix are there. The tests cover my case, the no-key case, a truncated list, the race and the independent probe's case with both ends real. |
| **m1** (= ind. m7): `answer` not limited to `v: 2` workers | BOB-98 | `ownRequest` (`:2059`) | Closed. The refusal comes after the ownership and entry checks, so it reveals nothing about another sender's request. `request` still reads it, as ruled. |
| **m2** (= ind. m1): `by` unbounded vs the snapshot's max 40 | BOB-98 | `isValidSegment(req.by)` after the grant check (`:1973-1974`) | Closed. No schema change. An rc.43 requester sends `orchestratorOf`, which always passes. |
| **m3**: "spawned after all" for every later copy | BOB-100 | `copyMade` (`:1566-1567`), `store.remoteCopiesBySpawn` | Closed. |
| **m4** (= ind. m6): `fitRequest` doesn't cut `answers` or check the fit | BOB-99 | `fitRequest` (`:281-289`) | Closed. |
| **m5**: a withheld `request`/`answer` reply gives the wrong advice | BOB-99 | `withheldAdvice` (`:244-248`, used at `:1913`) | Closed. |
| **m7**: no tests with both ends real for `resume` and `answers` | BOB-101 | `requests.test.ts` "answer_request with both ends real (BOB-101)" | Closed. The tests also cover BOB-99's `not_resumed` path. |
| ind. m4: a stop that races a shutdown leaves the request open | BOB-100 | the `stopping` set (`:460`, `:859`, `:2822`), `RouterDeps.stopping` (`router.ts:204`) | Closed. |
| ind. m5: the `answer` op's audit doesn't say what happened | BOB-99 | `:1249-1261`, and the catch at `:2028-2036` | Closed. |
| m6 (= ind. M1's code guard) | BOB-102 | not in this loop | Still backlog, as ruled. The rc.43 order rules still cover it (below). |

## Rulings on Luigi's departures

### BOB-97

- **The race guard: only copies with `as_of` <= the list's `sent_at`.** Accepted.
  - Both timestamps come from the requester's clock. `as_of` is set from `now` at the event (`:1331`) or at the
    reply (`:1419`). `sent_at` is set by `addRemoteSent` (`store.ts:515`).
  - `sent_at` is written when the row is recorded, before the message leaves. So the guard errs toward leaving a copy
    open, never toward closing a live one.
  - The argument holds: a copy last changed before the send, and left out of a full list naming its worker, was not
    open or orphaned on the target when the list was made. The target's states only move forward.
  - The target's `list` always gives a view `requests: asks.get(w.id) ?? []` (`:2006`), so a worker with nothing open
    is `[]`, not a missing key. A named list (reconcile's `ids`) includes the worker whatever its state, so an
    orphan's worker is named too.
- **The target's answered or expired still replaces `gone`.** Accepted, and better than what I asked for: `gone`
  means "we don't know", so the target's own word should win when it comes. Only those two replace it. A `request`
  or an `orphaned` can't reopen it, and `gone` can't replace `gone` (`:1375`).
- **`decided_by` comes from the `user_decided` that was sent.** Accepted. It matches the
  `answer(…, user_decided ? "human" : "orchestrator")` on the target (`:2030`), so the copy reads the same as the
  `settled` would. For a state other than `answered`, it is null.
- **The BOB-69 AC 2 test changed.** Accepted. It asserted "open until the settled comes", which is the M1 behaviour.
  Its replacement asserts that the reply updates the copy and that a later `settled` changes nothing more.
- **Not flagged by Luigi; accepted:**
  - The day bound measures from `created_at` (the target's clock), else from `as_of`. That is the bound
    `expireOrphans` uses (`:1045`, from `created_at`). So the requester hides a copy when the target would expire it.
    Clock skew is small next to a day.
  - A copy hidden by the bound still routes through `requestWhere` if someone names it, and the target answers
    "already expired".
  - Open copies over a day old stay in `remote_asks`. That is ind. m9, joined to BOB-76.

### BOB-98

- **The `answer` refusal comes after the ownership and entry checks; the `by` check after the grant check.**
  Accepted. Both keep §4's rule that a stranger learns nothing. Nothing is reserved or spawned before the `by`
  check throws (the test asserts that nothing is spawned).

### BOB-99

- **`resume_error` is an additive field on an ok reply. The requester's tool shows it as `not_resumed`.** Accepted.
  - The answer applied, so `ok: true` with `state: answered` is the truth.
  - An rc.43 requester ignores the field (`RemoteReply` is loose). It shows "answered" with no `resumed`, which is
    still true.
  - The catch rethrows unless the request was orphaned and is now answered (`:2032`). So a check that refuses before
    the settle (a human tier without `user_decided`, `deny` without `resume`) still comes back as a refusal.
- **`fitRequest` never cuts `tool` or `rule`.** Accepted.
  - `rule` comes from the config, and `tool` is a Claude Code tool name (an MCP name is at most 64).
  - With the four cut fields at ≤ 200 each and `input` stubbed, a 16 KiB body has room for both.
  - The order cuts `input`, `reason` and `message` before `answers`, even when `answers` is the large one. That is
    the order I specified; it is fine either way.
- **BOB-104 (backlog): the local `answer_request` still throws the bare error on the same resume failure.**
  Accepted as backlog. It concerns the orchestrator's own laptop, and the request is answered there as it says.
- **The audit, when a reply is withheld:** `remote:withheld` plus `remote:answer` with `withheld: true` when the
  answer applied. Accepted. Upgrades and other ops still get only `remote:withheld` when withheld, as before.

### BOB-100

- **The stop intent is set only by `Supervisor.stop()`.** Accepted.
  - `stop()` is used by the orchestrator's stop, a remote stop or kill, the dashboard and reset.
  - It is not used by the consult-answered path, which has no requests.
  - `shutdown()` calls `run.stop` directly (`:685`), not `Supervisor.stop()`. So a graceful restart still leaves its
    requests open to be orphaned, which keeps build B's ruling. The test "a stop of another worker doesn't settle a
    shutdown's request of this one" carries it.
  - The set is in memory and cleared in `onExit`. A crash loses it, and the next start orphans the request, as for any
    crash.
- **"Another copy" counts ended copies too.** Accepted. An ended first copy still means the spawn ran, so a resume
  of it is not news. If the `resumed` event's copy arrives before any copy of the first worker, it is the only
  copy, so poe is told once. That is right.

### BOB-101

Tests only. Accepted.

## rc.44 and the rc.43 order rules

rc.44 against rc.43 is compatible both ways.

**An rc.44 requester and an rc.43 target:**
- the rc.43 `list` already carries `requests`, so `gone` works;
- the rc.43 `answer` reply has `{request, worker_id, state, decision}`, so `answeredCopy` works;
- the rc.43 target doesn't check `by`.

**An rc.43 requester and an rc.44 target:**
- `resume_error` is ignored;
- the `by` check passes `orchestratorOf`;
- the `v`-less refusal only stops an `answer` that an rc.43 requester sends only by hand.

So between rc.43 and rc.44, either order is safe, and **rc.44 adds no order rule**. The rules of rc.43 stand for
anything below rc.43:
- **On install, the requester goes first.** No cross-laptop `v: 2` spawn is made while only the target runs
  rc.43 or later.
- **On rollback, roll the target back first,** never the requester alone below rc.43 while the target runs rc.43 or
  later.

**Rolling a requester back from rc.44 to rc.43 is safe.**
- `remote_asks.state` has no CHECK (`store.ts:118-121`), so `gone` rows stay readable.
- rc.43's `pending_requests` shows only open and orphaned copies, so `gone` rows don't appear.
- rc.43 doesn't rank `gone` (`ASK_RANK["gone"]` is undefined), so a redelivered `request` event could reopen one.
  That is rc.43's M1 again, no worse.

**Installing rc.44 heals rc.43's stale copies.** The first full list closes them, and the day bound hides the rest.
Nothing in this range touches the broker or `packages/protocol`, so the broker deploy ruling of review B is
unchanged.

## ADR 0007 §14

Amended: "As built, build B-fixes", after "As built, build B". It covers:
- `gone`, and when it is replaced;
- the day bound and the pruning;
- the `answer` reply's update of the copy;
- `resume_error`;
- the stop intent;
- the `by` and `v: 2` refusals;
- rc.44's order (none new).
