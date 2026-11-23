# BOB-121 review A: what wave A landed (Toad, 2026-11-22)

A gate for BOB-189's broker deploy, which ships everything on v2. Checked against the build brief
(`architecture/bob121/build-brief.md`) and ADR 0014. Line numbers are at origin/v2 `0b344eb`, and at
`f7423a8` (luigi/work) for D9.

| Task | Commit | Verdict |
|---|---|---|
| BOB-166 D1, weight table | 82568b2 | pass |
| BOB-163 D2, current release | 57c4da4 | pass, minors |
| BOB-167 D3, `usage` read | 1622e33 | pass, minors |
| BOB-170 D8, `usage_day` read | fb18a12 | pass, minors |
| test fixes | de8614e, b672d24 | pass |
| BOB-168 D9, CI history | f7423a8 (luigi/work, not on v2) | **blocker B1** |

## Deploy-safe?

- **v2 as it stands (`0b344eb`): yes.**
- **With D9 as at `f7423a8`: no, until B1 is fixed.** The fix is a few lines in one query. Luigi can make
  it in the BOB-189 build, which lands D9.

**What a live reader sees after the deploy, before wave B's views:**

- **D2, on purpose.**
  - The Overview's release card (`app.js:1820-1827`) shows the current release by ADR 0014 §4. Helix
    shows R2 and its count.
  - The Status page's Backlog health takes the same release (`store.ts:944`, `thin` at `:1009`). Its
    "backlog thin" and "Rn has nothing Ready" badges (`app.js:2128-2129`, `:2243-2246`) can now fire
    for a release that is `planned` and has work. Before, they fired only for an `open` one. This is
    the same rule as the Overview's, and intended. Expect it on Helix if R2 has fewer than 2 Ready
    features.
- **Nothing else is visible.**
  - The dashboard calls neither `usage` nor `usage_day`. Neither is in the agents' MCP tools.
  - `OverviewRow.ci` (D9) is optional, and today's `app.js` doesn't read it.
- **Protocol: additive.** Two new read ops are in `BOARD_READS`. An older client never sends them.
  Its `BOARD_READS` only decides the idempotency key (`client/src/connection.ts:143`).
  - `OverviewRow.ci` is an optional field.
  - The broker needs no migration and the supervisor no rc.
- **Risk to live reads:**
  - D9's query: B1.
  - Nothing else. `currentRelease` adds two counts per release to each Overview row, which is small.

## Checked and right

- **D1, the table:**
  - every row matches ADR 0014 §1: Sonnet 5.5 at 1, Opus 5.5 at 2, Haiku 5.5 at 0.05 with cache read
    at 0.1, Fable 5.1 at 5/2.5, Fable 5.2 at 4/2, Mythos as Fable, Opus 5 and 4.5-4.8 at 2.5/5, Sonnet
    5 at 1/2, Sonnet 4.5 and 4.6 at 1.5/3, Haiku 4.5 at 0.5/1 (`protocol/src/weights.ts:32-50`);
  - `USAGE_WEIGHTS_READ_AT = "2026-11-22"` (`:20`), and the comment names the pricing page (`:5`);
  - resolution follows §1's order, and there is no effort parameter;
  - every case in the brief's list has a test (`protocol/test/weights.test.ts`).
- **D2:** `currentRelease` (`store.ts:662`) implements §4. The Overview (`:683`) and the status read
  (`:944`) share it. The commit carries `Fixes: BOB-163`.
- **D3:** the shape is §3 and §3a's. The build also returns `tz` in the result, which is additive and
  accepted: I've added it to the ADR. Other points:
  - spreading and day edges are by wall time in `tz`, with DST handled (`usage.ts:56-60`);
  - lost runs are counted and not summed;
  - `top` is the union of the two top-3 lists;
  - a tz that `Intl` doesn't know gives `invalid`.
- **D8:** the shape is §3a's.
  - Baselines stop below 3 lines.
  - `calls` is the median day's, zero days included.
  - Lines are at most 2000 points through `downsample`, which protocol copies (`protocol/src/board.ts:152`).
  - An unreadable project gives `forbidden`, and a day outside the period gives `invalid`.
  - The brief's "stops after 20" was my slip: I've fixed it to 10.
- **No money.** The new code's only `$` is regex syntax (`weights.ts:56`, `:65`; the `day` regex in
  `board.ts`). It has no `cost`, `price`, `usd` or dollar.
- **The test fixes:**
  - de8614e waits for the second upgrade's own tag ask, so the test no longer ends before its row
    exists;
  - b672d24 gives the 120-row test 30 s, as the 100-row status test has.
  - Both change tests only.

## Findings

### Blocker

**B1. D9's CI query scans every push for every CI run, on each Overview read.**
`store.ts:721-728` at f7423a8.

- **Where the cost is.** `LEFT JOIN pushes u ON … lower(u.repo) = lower(c.repo) AND u.sha = c.sha`
  runs before the window's `n <= 6` filter.
  - `lower()` keeps `UNIQUE (repo, sha)` from serving it (`schema.ts:271-281`), and no index leads
    with `sha`.
  - So SQLite does a full `SCAN u` for each of the project's non-slot `ci_runs`. That is
    O(ci_runs × all projects' pushes).
- **What it costs.** I measured it in sqlite 3.51, on this laptop under load:
  - 500 × 500 rows: 0.09 s;
  - 3000 × 3000 rows: 9.3 s.
- **Why it matters.** It grows with history, quadratically, and nothing prunes `ci_runs` or `pushes`.
  - The Overview runs it for every project with CI.
  - The dashboard reloads the Overview on every `board_changed` (`app.js:3104`), for every open
    dashboard.
  - It all runs on the single Board Durable Object, so every agent's board write waits behind it.
- **Fix.**
  1. Rank first, then join only the rows kept:
     `SELECT … FROM (SELECT c.*, row_number() OVER (…) AS n FROM ci_runs c WHERE c.project = ? AND
     c.source != 'slot') h LEFT JOIN pushes u ON … LEFT JOIN runs r ON r.pk = u.run WHERE h.n <= 6
     ORDER BY h.name, h.n`.
  2. The same 3000 × 3000 data then takes 0.04 s.
  3. An index on `pushes (sha)` would be better still, but it needs a migration, and the rewrite
     alone is enough.
  4. Add a test that a project with many runs and pushes still gives 6 per workflow. A timing test
     isn't needed.

### Major

None.

### Minor

1. **D2: the fallback can land on an empty release.** `store.ts:673`. With nothing left to do,
   `findLastIndex(status !== "closed")` picks the last release that isn't closed, even an empty
   `planned` one. So "R1 all done, R2…R5 planned and empty" gives "R5, 0 of 0", with R1 in
   `done_unclosed`. §4 means R1, which waits for Casper's close.
   - The ADR's wording allows it, and that is mine.
   - Better: the last release, not closed, that has features; else the last not closed.
   - I'll amend §4 if Luigi or Mario agree. It's a small change in `currentRelease`.
2. **D2: no test reads the status read's `backlog.release`.** `store.ts:944`. It changed with the
   helper, but only the Overview is tested. Add a test that a project gives the same release ref in
   the two.
3. **D3: `runsEnded` reads `SELECT *`, `ctx` blobs included.** `store.ts:1203`. The blobs are up to
   8 KB per run, and `usage` never uses them, while it reads every project for up to 90 days. Name
   the columns for `usage`, and keep `ctx` for `usage_day`. The status read does the same over ≤ 31
   days (`:954`), so this is existing practice, not new risk. Fix it before wave B's Usage page calls
   the read.
4. **D8: every run is expanded to its full call count.** `store.ts:1155`. `perCall` expands it,
   `totals` holds the day's calls in full, and `bands` sorts at every call up to the third-longest
   line (`usage.ts:103-113`). A lead with tens of thousands of calls makes this heavy. It's fine at
   today's sizes, so watch it. If needed, work on lines downsampled to 2000 before `bands`.
5. **D8: a doc comment was left behind.** `store.ts:3441`. The line `/** Context per call as the runs
   table keeps it… */` now stands above `callLine`'s own doc comment, and `ctxBlob` (`:3447`) has
   lost it. Move it back above `ctxBlob`.
6. **D9: two pushes can match one run.** `store.ts:726` at f7423a8. `lower(repo)` lets two `pushes`
   rows whose repos differ only by case match one CI run, and `UNIQUE (repo, sha)` is case-sensitive.
   The run then appears twice in its workflow's history. It's unlikely, but `B1`'s rewrite can join
   with `LIMIT 1` (a correlated subquery for `agent`) and remove it.
7. **D3: rounded figures may not add up.** A point's `weighted` is rounded on its own, and so is each
   `by_model` and `by_role` row (`store.ts:1110-1124`). Their sums can differ from the point's by a
   token or so. The views should not assert that they are equal.

## Not reviewed here

- **D4, D5, D10:** not built (Luigi's handoff `w_13ce6442.md`).
- **The D4 patch** (`bob171-d4-wip.patch`): not committed.
- **BOB-163 AC5**, Helix showing R2 live, needs the deploy, then a look at the dashboard.
