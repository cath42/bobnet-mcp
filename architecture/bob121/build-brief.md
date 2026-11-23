# BOB-121 build brief: the data tasks (for Luigi)

**Design:** ADR 0014 (`architecture/decisions/0014-usage-weighting-and-project-page.md`). The § numbers
below are its sections. **Screens:** Daisy's prototype in `design/BOB-121/`. **Criteria:** BOB-121 ACs 5,
6, 11, 12, 13 and 17, and DoD 1. Line numbers are at `89c5f58` (origin/v2).

**Gate:** Casper's verdict is on the board: Q-13, "changes" (`lead/bob121/q13-verdict.md`). These are the
data tasks only. The view tasks (Overview, Needs you, project page, Usage, feature page, Sessions removal,
Status, Roadmap, Features) come from Daisy's spec as amended after Q-13. **D1-D5 and D8-D10 come before
the views that read them.** D8-D10 and the additions to D3 and D5 are ADR 0014 §3a (amended after Q-13).

**What ships how:**

| | Tasks |
|---|---|
| Broker migration | one table, `run_models` (D6) |
| Broker deploy | yes: D1-D4, D6, D8-D10 |
| Supervisor rc | yes, D6 and D7 (BOB-162), which ride together. After the rc, restart mbp-1 and ubu1, and deploy the broker before that restart. Without D6 and D7, BOB-121 needs no supervisor restart (DoD 1). |

## Already true on v2: checked, not to build

- **Every run's figures are on the board** (`runs`, `broker/src/board/schema.ts:235`): model, effort,
  the four token kinds, outcome and outcome_reason (`:386`), session, laptop, start and end.
- **Every session's close is on the board:** `SessionRecord` (`protocol/src/board.ts:690`), built by
  `get` with `session`.
- **Needs you's list:** `waitsOf(p)` (`store.ts:521`).
- **Backlog health:** the status read's `backlog` (`store.ts:963-976`). Lift it into a helper; don't
  copy it.
- **Who is running** stays the laptop reports' (snapshot workers). The project page reads them as the
  Overview does. No new read.
- **CI history is on the board already:** `ci_runs` (`schema.ts:285`), from the supervisor's gh adapter
  (`ci-poll.ts:47`), passed runs included, with the landing worker tied through `pushes`
  (`store.ts:2683`). D9 reads it. No supervisor change.
- **Context per call and calls per run are on the board already:** `runs.calls` (main-thread calls) and
  `runs.ctx` (`schema.ts:253`, ≤ 2000 points, evenly taken). D3 and D8 read them. Nothing new is recorded.
- **A release's done count** (`releaseRecord`, `store.ts:449`) is right: features, non-archived. BOB-163
  is in which release is chosen (`store.ts:641-643`), not in the count.

## Tasks

**D1. The weight table** (S). Create `packages/protocol/src/weights.ts`.
- `USAGE_WEIGHTS`: ADR 0014 §1's table as rows `{ model, alias, input, output, cache_read, cache_write }`,
  plus `USAGE_WEIGHTS_READ_AT = "2026-11-22"` and a comment naming the pricing page. Ratios only: no
  price and no currency anywhere.
- `weightOf(model: string | null): Row | null`, resolving as §1 says: a full id, then an alias or a
  known family at an unknown version, then null.
- `weigh(tokens: TokenTotals, model: string | null): { weighted: number; unknown: number }`. An unknown
  model gives `weighted` = the raw sum and `unknown` = the raw sum.
- Export it from the index.
- **Done when tests show:**
  - Sonnet 5.5 weighs to its raw sum;
  - `opus` and `claude-opus-5-5` are both ×2 on every kind;
  - Fable 5.1's cache read is ×2.5 and its other kinds ×5;
  - `null`, `""` and `gpt-9` are unknown at ×1;
  - a full id with a date suffix resolves;
  - effort changes nothing: there is no effort parameter.

**D2. The current-release helper, Overview fix** (S). Fixes BOB-163: the commit carries `Fixes: BOB-163`.
- `currentRelease(p)` in `broker/src/board/store.ts`, by §4's rule. It returns `{ release, number,
  done_unclosed }`.
- `overview()` (`:641-643`) and the status read's `backlog.release` (`:907`) use it.
- **Done when tests show:**
  - a project with R1 open and all done, and R2 planned with work: the Overview gives R2, number 2,
    its count;
  - R2 `open` with work after an R1 that is closed: R2;
  - every release done but none closed: the last one;
  - no releases: null;
  - an archived not-Done feature is not "work".
- Then check it on the dashboard against Helix's real board (AC5 evidence).

**D3. The `usage` read** (M). §3.
- Protocol: add the `usage` op to the board ops, to `BoardReadName` and `BOARD_READS`
  (`protocol/src/board.ts:486`), and its result type. Bounds: `days` 1..90, `tz` an IANA name ≤ 60.
- Store: runs of each readable project with `ended_at` in the span.
- Each run's tokens are spread over the days it ran, by wall time, in `tz`'s calendar (use
  `Intl.DateTimeFormat` to find day edges). Weigh per model with D1: from `run_models` when D6 is in,
  else `runs.model`.
- `lost` runs are counted, never summed. A project with no runs still gets its series of zeros.
  `weights` is D1's table.
- Each point also carries (§3a):
  - `calls`, and `by_role: [{ role, calls, raw, weighted }]`. A run's calls are spread over its days
    like its tokens.
  - `top`: the sessions in the day's top 3 by raw or by weighted (≤ 6), each `{ session, feature_title,
    raw, weighted }`. `session: null` is the day's work outside any session, as one entry.
- **Done when tests show:**
  - two projects each get their own series (AC11);
  - an Opus run weighs double a Sonnet run with the same tokens (AC12);
  - a run declared null lands in `unknown`;
  - a 48-hour run splits across three days by its hours;
  - a lost run is in `lost` and not in the tokens;
  - `tz` moves a run at 23:30 UTC into the next day for `Europe/Copenhagen`;
  - a project the caller can't read is absent;
  - two roles' calls land in their own `by_role` rows, and the 48-hour run's calls split as its tokens do;
  - `top`, for a day with four sessions where a Haiku-heavy one is in the raw top 3 and not the weighted
    top 3, holds both rankings' sessions, and other work shows as `session: null`.

**D4. The `project` read and weighted sessions** (M). §3.
- Protocol: add the `project` op and `ProjectPage`. Add the optional `weighted` and `unknown` to
  `SessionRecord` and `RunRecord`.
- Store, reusing D2, D3, `waitsOf`, and the backlog helper lifted from `statusRow`:
  - `sessions`: open ones, plus those ended in the span, newest activity first, ≤ 50, with `more`.
  - Each session's close is counted from `session_tasks`. `feature_title` is the feature's title.
  - Runs are ordered by start.
  - `other_runs`: runs with `session IS NULL` ended in the span.
- `get` with `session` fills `weighted` and `unknown`.
- **Done when tests show, on one project:**
  - an open session with a running run (tokens zero, `ended_at` null);
  - a closed session with a failed run and its reason;
  - a consult run in `other_runs`;
  - its waits and backlog equal what the `waits` and `status` reads give for it;
  - `usage` equals the `usage` read's series for it;
  - a reader without the project gets `forbidden`.

**D5. Dashboard data plumbing** (S). In `app.js`, with no screen of its own. The views use it.
- **Live "so far".** Add to today's point the workers in the laptop reports whose state is
  `running`, `queued` or `waiting-*` for that project. Spread each from its `started_at`, and weigh it
  with the read's `weights` by its declared model (the same resolve rule as D1, ported from the
  returned table, not from hard-coded factors).
- The toggle state is kept in `state` and the URL hash, as other filters are.
- `#sessions` and `#sessions/<x>` resolve to the project or feature page (AC13).
- **A day's detail** (D8) fetches `usage_day` on the tap and keeps it per project, day, span and tz. For
  today, it adds the running workers' `ctx` and `calls` from the laptop reports as runs, as above.
  A downsampled line (`pts.length < calls`) puts point i at call `1 + round(i × (calls − 1) /
  (pts.length − 1))`. Summed for Total, each point counts `calls / pts.length` calls.
- **Done when tests show:**
  - a running worker adds to today's point and an ended one doesn't;
  - a running worker's context per call is in today's detail, and not in yesterday's;
  - the toggle off shows raw figures equal to the read's `raw`;
  - an old `#sessions` link lands on a page.

**D6. Per-model tokens from the supervisor** (M). §2. Rides the rc with D7. It may be cut to a follow-up
without failing AC12; say so at the close if it is.
- Protocol: `run_end` gains `models: z.array(z.object({ model: z.string().max(100), tokens: TokenTotals
  })).max(10).optional()`.
- Supervisor (`worker.ts:491`): keep `modelUsage` per model, not only its sum. A resumed run nets per
  model against the base it started from (store it with `usage`'s `base`).
  - `run_end` (`supervisor.ts:3141`) sends `models` only when their sums equal `tokens`.
  - A `lost` run (`:664`) sends none.
- Broker:
  - migration: `run_models (project, run, model, input, output, cache_read, cache_write)`, primary key
    `(run, model)`;
  - `run_end` writes the rows;
  - D3 and D4 weigh from them when present.
- **Done when tests show:**
  - a run with two models (Opus with a Haiku subagent) reports both, and they sum to its tokens;
  - a resumed run's models are net of the earlier run;
  - a run ending mid-turn sends no `models`;
  - an older broker's parse of `run_end` with `models` succeeds (the field is dropped);
  - a run without `models` weighs by its declared model.

**D7. BOB-162** (S), as BOB-121 AC17 states it.
- `askOf` (`supervisor.ts`, ADR 0013 §1) checks each field for a credential before clipping it, as
  `preview()` does.
- **Done when a test shows:** a credential straddling the clip doesn't cross as a prefix.
- The commit carries `Fixes: BOB-162`.

**D8. The `usage_day` read** (M). ADR 0014 §3a. It answers what the Q-13 change needs: a day's context
per call, Total and By agent (role), and the period's median as the baseline (spec §2.9, "Baseline
(Toad)").
- Protocol: add the `usage_day` op (`project`, `day`, `days` 1..90, `tz` as D3), and `CallLine` and
  `UsageDay`. Add it to `BoardReadName` and `BOARD_READS`, not to the agents' MCP tools.
- Store:
  - Read the project's runs ended in the page's period (the last `days` days to today in `tz`) with
    their `ctx`. A `day` outside the period is `invalid`.
  - A run's calls and points are split over its days by wall time, with D3's day edges.
  - Total: the day's runs in start order, points summed as they go. `baseline.total`: that curve for
    each day of the period, median at each call.
  - By agent: group by `role`. `baseline.roles`: each role's whole runs, each from its own first call,
    with p25, p50 and p75 at each call.
  - A baseline line stops at the first call fewer than 3 days or runs reach. Every line goes out as a
    `CallLine` of ≤ 2000 points, by the runs table's rule (`downsample`, `supervisor.ts:4165`). Put
    a copy in protocol for the broker; the supervisor's stay, so no rc is needed.
- **Done when tests show:**
  - a day with two roles gives each role its runs in start order, with their `first`;
  - a run from 22:00 to 02:00 gives 2 h of its calls to each day (in `tz`), its points split the same
    way, and `first` on the second day is the next call;
  - the role baseline at call 5 is the median of the role's runs that reach call 5, and stops where only
    two do;
  - `baseline.total` over days with 10, 20 and 30 calls has its median at each call and stops after 10 (from call 11 only two days reach it);
  - `calls` in each baseline is the median day's calls;
  - a run over 2000 calls comes back as ≤ 2000 points with its true `calls`;
  - a lost run counts in `lost` and draws nothing;
  - a project the caller can't read is `forbidden`, and a day outside the period is `invalid`.

**D9. CI history from the board** (S). ADR 0014 §3a; spec §2.4, §6 Q2.
- `ciOf(p)` in `store.ts`. For each workflow (`ci_runs.name`, source not `slot`), it gives the latest run
  and the 5 before it, newest first: `{ name, branch, status, sha, url, started_at, ended_at, agent }`.
  `agent` is `runs.agent` through `pushes` (`repo`, `sha`) → `run`, else null.
- The `project` read (D4) gains `ci`. `OverviewRow` gains it as an optional field, for every project.
- The dashboard's CI card and project page read it instead of the report's `ci`. The report's `ci`
  stays on the wire.
- **Done when tests show:**
  - a workflow with 8 runs gives its latest and the 5 before it, a passed run included;
  - a run on a landed sha names the agent whose push tied it, and one without a push has `agent` null;
  - slot runs are not workflows;
  - the Overview and the project read give the same `ci` for a project.

**D10. A feature's own criteria and done date** (S). ADR 0014 §3a; spec §2.6, §6 Q3.
- In `SUMMARY` (`store.ts:259`), a feature's row gains `own: { checked, total }` (its own AC and DoD,
  not its tasks') and `done_at` (the latest move to Done, by the rule at `store.ts:998`; null if not
  Done). Both are optional on `ItemSummary`. `progress` is unchanged.
- **Done when tests show:**
  - a feature with 3 own criteria (1 checked) and a task with 4 has `own` 1 of 3 and `progress` as
    before;
  - a DoD criterion counts in `own`;
  - a Done feature has its `done_at`, a feature moved back from Done has none, and a task has neither
    field.

## Spec §6: Toad's answers (Q2-Q4)

- **Q2, CI history:** from the board's `ci_runs`, not the laptop report: D9. Passed runs are kept, and
  the land→run link exists (`pushes`), so "Toad's land" stays. It is null when no push tied the run.
- **Q3, a feature's own criteria:** `own` and `done_at` on the feature's summary, so the Roadmap list
  needs no `get` per row: D10. A Done feature's unticked criteria are `get`'s `criteria` with state
  `open`, which exists already.
- **Q4, a day's biggest sessions:** the `usage` read's points gain `top` (D3). The day line shows
  "Biggest: …" as designed.

**Size:** D1-D5 and D8-D10 are about one and a half build sessions. Cut D8-D10 as their own session if
the first runs long. D6 and D7 make a short second one, or the same one if it runs long enough.

**Review (DoD 2): Toad.** I check:
- D1's table against ADR 0014 §1, and the pricing page's date;
- D2-D4's and D8-D10's shapes against §3, §3a and §4;
- that no `$`, `cost` or `price` appears in the new code or on the page.
