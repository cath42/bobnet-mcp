# Review: the rest of BOB-2 (d824e95, cd8c98c, c0dbd0d, 8d7c1c5)

Toad, 2026-11-15. These are Luigi's four lands on v2 (handoff w_2bb286e8). I checked each against
the consult I answered for it: c_ef62b5e6, c_07660cc7, c_27511d4c and c_f3e94196 (option i). I read
the diffs on origin/v2 at 8d7c1c5 and `docs/ci-reporting.md`. The rulings are now in ADR 0001: §5
(close and undo), §8 (the view reads), §10 (CI, as built). §6 also records Luigi's later consult
c_81cf334e: a release opens on its first `session_join` (board-writes 6 and 7, 6de7894).

**Verdict: all four signed off, and they are deploy-ready together in one broker deploy, then rc.32.**
Nothing has to be fixed before the deploy. Finding 1 fixes docs that no deploy ships. Findings 2–4
are small and can come later.

| Commit | What | Verdict |
|---|---|---|
| d824e95 | `close_release` and undo of set_release and close (§5) | Signed off, nothing to fix |
| cd8c98c | The `waits` and `overview` reads; `ReleaseRecord.backlog` (§8) | Signed off, nothing to fix |
| c0dbd0d | POST /v1/runs, `CI_TOKENS`, Identity kind `ci`, `reportCi` and the tie (§4, §10) | Signed off; finding 1 (docs), finding 2 (low) |
| 8d7c1c5 | The gh adapter; `register.projects`; **broker migration 8** (§10) | Signed off; findings 3, 4 (low) |

## d824e95: close_release and undo

This is the ruling as given:
- **Moves.** Every feature in the release that is neither Done nor archived needs one move, and
  every one that is missing is named. `feature()` refuses archived features, and a feature can't be
  moved twice or into the release being closed. `openRelease(to)` refuses a closed destination.
- **Order of events.** The move events come first and the release's event last, and the reply's
  seq is the release's.
- **Undo** finds the group as the contiguous `close_release` item events with the same `at` and
  actor. This can't swallow an earlier close, because a close ends with an event on `releases`, and
  that breaks the run. LIMIT 201 covers the 200-move cap.
- **Status.** Undo restores the release's recorded status, so a planned release comes back
  planned. It reopens the release before the moves, so `moveBack` may put features into it, and any
  refusal rolls the whole undo back.
- **The checks:** "undone already" (by `undo_of`), the two minutes, `closed_at === e.at`, "moved
  since", and "destination closed since". Each feature's undo names its own move's seq.
- **Edge.** "Moved since" compares where the feature is now with where the event put it. So A→B,
  B→C, C→B, then undo of the first move goes back to A. That matches §5's wording ("a record no
  longer holds the event's new value"), it is inside two minutes, and it is Casper's own sequence.
  No change.

## cd8c98c: the view reads

The shapes are as recorded in §8. Luigi's five choices beyond my answer are all right, and I took
them into the ADR:
1. A review gate counts as blocking.
2. The order in which a wait's feature is found.
3. `release_number`. It counts closed releases, as roadmap-view numbers them ("numbered in their
   order").
4. `next_ready` skips closed releases.
5. `answered` holds dashboard answers only, 50 at most.

- `answered` drops an undone answer, because undo clears `answered_at`/`answered_via` (store.ts
  `UPDATE questions SET state = 'open', …`).
- A bug that is Done no longer waits. That is a sensible tightening of §7, and it is recorded.
- `waitsOf` costs one query per question, and the overview runs it per project. That is fine at
  BobNet's sizes, and it is the one definition, which matters more.
- Both reads are additive. Only the dashboard calls them, and it comes from the same deploy.
  `ReleaseRecord.backlog` is optional.

Luigi's open question 1 (no op opens a release) is settled since. Peach's board-writes 6 says a
release opens on its first session, and Luigi builds it per c_81cf334e (ADR §6). Until that lands,
the overview's `release` is null for a project whose releases are all `planned`.

## c0dbd0d: POST /v1/runs

- **Auth.** `ciTokens` merges `CI_TOKENS` and `CI_TOKENS_<x>` like the laptop maps, and a laptop
  mapping wins. The source always comes from the token: a body naming another source is 403, and
  `op` in the body is stripped. `ci` is kept off `/v1/ws`, export and import, and off the
  dashboard's 404 path. `Reader` excludes `ci` at the type level, which is good.
- **Upsert.** It keys on (`source`, `external_id`), the project is fixed at the first post, and an
  ended status is final while missing fields still fill. Each post writes one event with
  `actor_kind` `ci`. The tie runs both ways (a run after its push, and a push after its runs), with
  `source != 'slot'` kept out of the push's sweep. `ci_run_tasks` uses INSERT OR IGNORE.
- **The Identity union** gains `ci`. A CI identity never gets a socket, so no client ever sees it
  in `welcome`.

**Finding 1 (docs, before anyone wires a pipeline; not deploy-blocking).** `docs/ci-reporting.md`
needs three fixes:
- **The example collides across jobs.** Its GitHub Actions example puts the two steps in a job but
  uses `external_id` `${{ github.run_id }}-${{ github.run_attempt }}`, which identifies the
  workflow run. A workflow with two jobs posts the same id twice: the first job to end makes the run
  final, and the second job's failure is dropped. Make it
  `${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}`, with `-${{ strategy.job-index }}`
  for a matrix.
- **One source per repo.** Say that a repo the gh adapter already reads shouldn't also post with a
  token mapped to `github-actions`: the adapter's rows are per workflow run, the token's per job,
  and they would double-count. The doc's last paragraph says the adapter makes it unnecessary, but
  it should say "don't do both".
- **Access.** The token must also be added to the broker's Access application (README step 1, as
  for a laptop), or Access refuses the request before the Worker sees it. The doc only names the
  secret.

**Finding 2 (low, later).** `auth.ts` should refuse a CI token whose source is `slot`, as it
refuses a laptop token mapped to `Board`. A CI mapped to `slot` would write into the run slots'
namespace: `slot_run` upserts by (`slot`, `external_id`). It is Casper's config, so it's a guard
against a typo, not a threat.

## 8d7c1c5: the gh adapter and broker migration 8

This is option (i) as ruled:
- **Register.** `register.projects` is sent on every register, and the upsert replaces the list.
- **`serves`.** `boardCaller` reads it only for the pinned supervisor connection, and every other
  caller gets `ctx: null` as before.
- **`ghRun`.** It needs `supervisor`, a named project and `serves` membership, and it forces
  source `github-actions`. It is checked before `ciRun`, which shares `reportCi` with the HTTP path,
  so both transports apply the same rules.
- **Supervisor side.** `flushBoardReports` accepts the supervisor's own name as `to_name`, with
  `ctx` null.
- **`ci-poll.ts`.** It maps statuses as ruled, takes `external_id` `<databaseId>-<attempt>`,
  reports each status change once, and treats a project without gh or a GitHub remote as reporting
  nothing (debug log only).
- **Migration 8.** It is `ALTER TABLE laptop_supervisors ADD COLUMN projects TEXT`: additive, and
  it runs on the Broker DO's first start after the deploy.
- **Skew.** `RegisterFrame` is a plain `z.object`, so an rc.31 broker strips `projects`, and an
  rc.32 supervisor still registers. Its `ci_run` is then refused as an unknown op, and the
  supervisor drops it as final and logs it. Older supervisors on the new broker store `[]` and
  report nothing.

**Finding 3 (low).** The migration's comment and the commit say NULL for older supervisors, but
`register` writes `JSON.stringify(frame.projects ?? [])`, which is `[]`. Both mean "serves nothing",
so the only fix is the comment, in any later land.

**Finding 4 (low, later).** An adapter run's events have actor `github-actions` (`whoOf` of the
`CiCaller`), so the history doesn't say which laptop's supervisor reported it. If two laptops serve
one project, both report the same runs, harmlessly. If the history should say who reported, make
the actor `github-actions via <supervisor>@<laptop>` and keep `actor_kind` `ci`. It's not needed
for release 1.

Also: `GhCiPoll.sent` is in memory. A restart re-reads the last 20 runs and re-posts them, which
are no-op upserts. A report dropped before migration 8 isn't re-sent until its status changes, so
rc.32 goes out after the deploy (below).

## Deploy and release order

All four are broker and supervisor changes in one tree, so there is **one broker deploy** at v2
≥ 8d7c1c5 (the tip, which also carries this review), then **rc.32**:

1. **Broker deploy** (`pnpm run deploy` in `packages/broker`), only when Casper asks for it. It
   drops every connection, as always. Broker migration 8 runs by itself on the DO's start. There is
   no Board migration in these four, and Board migration 2 is already live since 03:18Z.
2. **`CI_TOKENS` is not needed for rc.32**, or for anything in release 1 today. The gh adapter
   reports GitHub Actions without a secret, and without the secret `/v1/runs` simply refuses
   everyone. Add it when a pipeline should post: an Access service token added to the Access app,
   then `wrangler secret put CI_TOKENS_<NAME>`. A secret put deploys a new version and drops
   connections like a deploy, so it is Casper's call. Either do it in the same window as step 1,
   or later on its own.
3. **rc.32** (Mario), cut from the same tree, installed after the deploy. poe restarts each
   supervisor. Before the deploy, an rc.32 supervisor works, but it logs a dropped `ci_run` on every
   run status change.

## Casper's checks after the deploy (and rc.32's restarts)

1. **Reconnects.** Every agent shows connected again on the dashboard within a minute or two, as
   after the 03:18Z deploy. This is the only check before rc.32.
2. **Export still version 1.** `GET /v1/board/export` (or the nightly backup) still parses, with
   `version: 1`. The four lands change no export shape. `ci_runs` rows were already in it.
3. **The adapter is quiet** (after poe restarts mbp-1's supervisor on rc.32). The supervisor's log
   shows no "a board report can't be made; dropped" for `ci_run`, and a land still pushes and
   reports. No live CI row can be checked yet. bobnet's repo has no GitHub Actions workflows
   (`.github/workflows` doesn't exist), and Helix, which has them, moves onto the service only at
   BOB-9. So the adapter finds nothing to report, and `ci-runs.test.ts` and `ci-poll.test.ts` are
   the evidence. The first real check is at BOB-9: a Helix land should give a `ci_runs` row in the
   export, source `github-actions`, `worker` set, within about 2 minutes.
4. **Nothing on the dashboard changes yet.** close_release, Undo, Waits and Overview have no UI
   until the views (BOB-3/5/7/8). So no check is possible there, and none is missed.
