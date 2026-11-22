# 0014. Usage weighted by model and the project page's read

- **Status:** accepted (Toad, 2026-11-22), for BOB-121 (session `BOB-121 design A`), ACs 5, 6, 11, 12
  and 13. Line numbers are at `89c5f58` (origin/v2). The build brief is `architecture/bob121/build-brief.md`.
  Daisy designs the screens (`design/BOB-121/`). §1 is what my answer to her consult c_2c826fdc gave her.
  **Amended 2026-11-22** after Casper's Q-13 verdict (`lead/bob121/q13-verdict.md`): §3a.

## Context

- **Casper asked** (`lead/bob51/casper-dashboard-feedback.md`, second message): "the graphs should allow me
  to toggle factoring the model/effort (sonnet low vs opus high has a very different token spend) or is
  that already factored in?" Today nothing is factored. Usage sums the four token kinds raw
  (`totalTokens`, `broker/public/app.js:130`), and model and effort are a label (`fmtModel`, `:145`).
- **What the reports carry.**
  - A run on the board has `model`, `effort`, the four token kinds, `outcome`, `session`, `started_at`
    and `ended_at` (`runs`, `broker/src/board/schema.ts:235`; `run_start` and `run_end`,
    `protocol/src/board.ts:391-428`).
  - `model` is what the spawn declared: an alias (`"opus"`) or null for Claude Code's default. For
    example, BOB-51 build A's runs were `opus`/`high` and `null`/`null`.
  - Tokens reach the board only at `run_end` (`supervisor/src/supervisor.ts:3141`), and a lead's run
    lives until it is stopped.
  - The supervisor gets the real per-model split from the SDK's `result.modelUsage` but sums it away
    (`supervisor/src/worker.ts:491-501`).
  - A laptop report's `usage` rows (`protocol/src/frames.ts:238`) are 14 days of totals per day,
    project, role and declared model. They carry no effort.
  - A running worker's live tokens are only in the laptop report (`WorkerSnapshot.tokens`). The Board
    is its own Durable Object (`env.BOARD`, `broker/src/index.ts:68`) and cannot read the reports.
- **Projects at a glance is wrong (BOB-163).** `overview()` takes the first release with status `open`
  (`broker/src/board/store.ts:641-643`). A finished R1 that Casper hasn't closed stays "current", and
  an R2 still `planned` is never chosen. That is how Helix shows "R1, 4 of 4".
- **The Sessions tab goes** (AC13). The tab read laptop board reports. Every session's runs, tokens and
  close are already on the board (`SessionRecord`, `protocol/src/board.ts:690`), but no read lists a
  project's recent sessions.

## Decision

### 1. Weighted tokens: Sonnet-equivalent, by model, never by effort

- **The rule.** A weighted token count is Σ over runs, models and token kinds of
  `tokens[kind] × factor(model, kind)`. `factor(model, kind)` is that model's Anthropic list price for
  `kind` divided by Claude Sonnet 5.5's price for the same kind.
- **Sonnet 5.5 is 1.0 for every kind.** So a Sonnet-only project reads the same with the toggle off
  and on. The unit is still tokens: "Sonnet-equivalent tokens".
- **Where the factors come from.** Anthropic publishes nothing on how Max limits weigh one model's
  token against another's, and states only that larger models use them faster. The list price is the
  only published per-model, per-kind measure of what a token takes. So we use it, and only as a ratio.
  - Source: platform.claude.com/docs/en/about-claude/pricing, read 2026-11-22.
  - The code keeps **ratios only**: no price, no currency, nothing that computes or shows money (ADR
    0001 §9).
  - The table is one constant, `USAGE_WEIGHTS` in `packages/protocol/src/weights.ts`. It records the
    date it was read and is updated by hand when Anthropic changes prices or ships a model.

| Model (family alias → this) | input | output | cache write | cache read |
|---|---|---|---|---|
| Sonnet 5.5 (`sonnet`) | 1 | 1 | 1 | 1 |
| Opus 5.5 (`opus`) | 2 | 2 | 2 | 2 |
| Haiku 5.5 (`haiku`), prompts ≤ 100k | 0.05 | 0.05 | 0.05 | 0.1 |
| Fable 5.1 (`fable`) | 5 | 5 | 5 | 2.5 |
| Fable 5.2 | 4 | 4 | 4 | 2 |
| Mythos 5.1 / 5.2 | as Fable 5.1 / 5.2 | | | |
| Opus 5, 4.5–4.8 | 2.5 | 2.5 | 2.5 | 5 |
| Sonnet 5 | 1 | 1 | 1 | 2 |
| Sonnet 4.5, 4.6 | 1.5 | 1.5 | 1.5 | 3 |
| Haiku 4.5 | 0.5 | 0.5 | 0.5 | 1 |

- **Resolving a model.** Lowercase the model string.
  1. A full id (`claude-opus-5-5`, `claude-opus-5-5-20261001`) matches its row by family and version.
  2. A bare alias (`opus`, `sonnet`, `haiku`, `fable`), or a known family at a version the table
     lacks, takes the row the alias column names: the family's current model.
  3. Anything else, including null, is **unknown**: it counts at ×1, and its tokens are reported apart
     (`unknown`, below).
- **Cache writes.** The 5-minute and 1-hour writes have the same ratio between models, so one column
  covers both.
- **Haiku's over-100k tier** is not applied: a run's report has no per-call prompt size.
- **Effort is not weighted: 1.0 at every level.** Effort decides how much a model thinks. Thinking is
  output tokens, and more of it means more calls and more context, all of which are already in the raw
  count. A token at `high` costs what a token at `low` costs. So for "sonnet low vs opus high", the
  "high" is already factored in today, and the "opus" (×2) is what the toggle adds. Effort stays a
  label. The laptop's `usage` rows needn't gain it.
- **Token kinds are not weighed against each other.** A cache read still counts as one token, scaled
  only by its model. Weighting kinds against each other (a cache read at 0.05 of an output token) would
  turn the figure into a cost proxy. Casper asked about model and effort only.
- **Fast mode and data residency are out.** They are premium rates the reports cannot see.
- **The page.** Daisy owns the layout. The words are:
  - **Toggle:** "Weigh by model". Off is "Raw tokens", today's numbers. On is "Sonnet-equivalent
    tokens".
  - **On:** "Sonnet-equivalent: each model's tokens count at its list-price ratio to Sonnet 5.5 (Opus
    5.5 ×2, Haiku 5.5 ×0.05, Fable 5.1 ×5). Effort isn't weighted: higher effort already shows as more
    tokens. Tokens only, nothing is priced."
  - **Off:** "Raw tokens: input, output, cache reads and writes as reported, every model counted the
    same."
  - **A "What's factored" disclosure** renders the table from the read's `weights` (§3), so page and
    code cannot disagree.
  - **Unknown tokens.** When any of a graph's tokens are unknown, a muted line under it reads "N
    tokens on an unnamed model, counted at ×1". It is absent when N is 0.

### 2. The real model per run, from the supervisor (additive)

- **Why.** A run declared `null` is unknown under §1, and a worker's subagents may run on another
  model. The supervisor already holds the truth in `modelUsage`.
- **What `run_end` gains.** An optional `models: [{ model, tokens: TokenTotals }]` (≤ 10). It is each
  model's tokens for this run, net of a resumed session's earlier ones per model, the way `ownUsage`
  nets the total (`supervisor.ts:3608`).
  - The supervisor sends it only when its sums equal the `tokens` it sends. A run that ends mid-turn,
    with no final `result`, sends none.
  - The broker keeps it in a new table `run_models (project, run, model, input, output, cache_read,
    cache_write)`.
- **How weighting reads it.** `models` when the run has them, else `runs.model`, else unknown.
- **Compatibility.** `run_end` is not `.strict()`, so an older broker drops the field. An older
  supervisor sends none, and its runs weigh by the declared model. It rides the supervisor rc that
  BOB-121 needs anyway for BOB-162 (AC17). It is not needed for AC12.

### 3. Two new Board reads: `usage` and `project`

Both are board reads (`BOARD_READS`, `protocol/src/board.ts:486`), derived on read and never stored,
for any caller that reads the project. The dashboard calls them through `boardOp`, as it calls
`overview` and `status`. They are not added to the agents' `board_*` MCP tools.

**`{ op: "usage", project?, days = 30 (1..90), tz = "UTC" }`** → `{ weights, days: string[], projects:
UsageSeries[] }`. There is one series per readable project, including a project with no runs (all
zeros), so each project has its own graph (AC11).

```ts
interface UsageSeries {
  project: string; name: string;
  /** One entry per day of `days`, oldest first, in `tz`'s calendar. */
  points: Array<{
    raw: TokenTotals;            // as today
    weighted: number;            // §1, summed over kinds
    unknown: number;             // raw tokens counted at ×1 because their model is unknown
    by_model: Array<{ model: string; raw: number; weighted: number }>; // for the tooltip, ≤ 10
  }>;
  /** Runs ended in the span with outcome `lost`: tokens unknown, never shown as 0. */
  lost: number;
}
```

- **Which runs count.** Runs that ended in the span, with tokens from `run_models` or the run's own.
- **A run's tokens are spread over the days it ran, by wall time.** A three-day lead that ends today is
  three days of usage, not one false spike today. A 20-minute worker falls in one day.
- **`weights`** is the table of §1 as data: rows of `{ model, alias, input, output, cache_read,
  cache_write }` plus `read_at`.
- **Running workers are added by the dashboard**, because only the laptop reports carry their live
  tokens. To today's point it adds each worker whose state is `running`, `queued` or `waiting-*`,
  spread the same way from its `started_at` and weighted with `weights` by its declared model. These
  workers are labelled "so far". A worker that has ended is the board's, so nothing is counted twice
  once its `run_end` arrives.

**`{ op: "project", project, days = 14 (1..90) }`** → `ProjectPage`:

```ts
interface ProjectPage {
  project: ProjectRecord;
  release: CurrentRelease | null;            // §4
  /** Releases before it, not closed, with every feature Done: "R1 all done, waiting for your close". */
  done_unclosed: Array<{ ref: string; title: string }>;
  waits: WaitRecord[];                        // waitsOf(p), as Needs you reads it
  backlog: StatusRow["backlog"];              // the status read's, same code
  /** Open sessions and those ended in the span, newest activity first, ≤ 50. */
  sessions: Array<{
    session: SessionRef; feature_title: string;
    started_at: string; ended_at: string | null;
    close: { need: "none" | "answer" | "casper"; summary: string; blockers: number; majors: number; sent_back: number } | null;
    tokens: TokenTotals; weighted: number; unknown: number; lost: number;
    runs: Array<{ id: string; agent: string; role: string; laptop: string; model: string | null; effort: string | null;
      started_at: string; ended_at: string | null; tokens: TokenTotals; weighted: number; calls: number;
      outcome: "done" | "failed" | "stopped" | "lost" | null; outcome_reason: string | null }>;
  }>;
  /** Runs in the span outside any session (consults, ad-hoc work), newest first, ≤ 50. */
  other_runs: ProjectPage["sessions"][number]["runs"];
  usage: UsageSeries;                         // the usage read's, same code, same days
  more: Record<string, number>;               // as StatusRow.more
}
```

- **What the dashboard takes from where:**
  - **Who is running:** from the laptop reports, as on the Overview.
  - **CI:** from the laptop board report's `ci` (`ciLines`, `app.js:1365`), as on the Overview.
  - **The board:** the existing views, linked.
- **Outcome `null`** is a run from a supervisor before ADR 0005 §3, shown as "ended". A run still
  going has `ended_at` null and zero tokens on the board. Its live tokens come from its laptop report.
- **`get` with `session`** gains `weighted` and `unknown` on the session and on each run (optional
  fields), so the feature page shows the same figures (AC13).

### 3a. After Q-13: a day's context per call, CI history, a feature's own criteria

**A day's context per call: a third read, `usage_day`.** Casper keeps the context-per-call line graphs.
Tapping a day opens them for that day, Total and By agent, against a baseline: the period's median
(spec §2.9, "Baseline (Toad)"). The source is the board's `runs`: `calls` (main-thread model calls) and
`ctx` (`schema.ts:253`: up to `RUN_CTX_MAX` = 2000 uint32s, evenly taken, first and last kept,
`board.ts:142`). Nothing new is recorded. `ctx` has no time per call, so a run that crosses midnight
splits its calls and its points over its days by wall time, as its tokens do (§3). The blobs are too
heavy for `usage`, which serves every project for up to 90 days, so they come from their own read, on a
tap:

`{ op: "usage_day", project, day: "YYYY-MM-DD", days = 30 (1..90), tz = "UTC" }` → `UsageDay`:

```ts
/** Points evenly taken over calls 1..calls, first and last kept (the runs table's rule); pts.length === calls up to 2000. */
interface CallLine { calls: number; pts: number[] }
interface UsageDay {
  project: string; day: string; days: string[];      // the page's period, as `usage` gives it; `day` is in it
  /** Runs with calls in the day, by start; `first`: the run's own number of the day's first call (1 unless it began earlier). */
  runs: Array<{ id: string; agent: string; role: string; session: SessionRef | null; model: string | null;
    started_at: string; ended_at: string; resumed: boolean; first: number; ctx: CallLine }>;
  /** Medians over the period's days, call by call, while ≥ 3 reach the call; empty when fewer. */
  baseline: {
    total: { days: number; calls: number; p50: CallLine };             // calls: the median day's
    roles: Array<{ role: string; runs: number; calls: number;          // calls: the role's median day's
      p25: CallLine; p50: CallLine; p75: CallLine }>;
  };
  lost: number;                                       // lost runs that day: no calls, no context
}
```

- **Total** is the day's runs in start order, their points summed as they go (the session card's
  "Whole session"). The baseline's `total` is that same curve for each day of the period, median at each
  call.
- **By agent** groups by `role`. The baseline per role is its runs that ended in the period, each
  whole and from its own first call, as the laptop report's `baseline` (`supervisor/src/board.ts:118`)
  and the session card's band do today.
- **The period is the page's** (the last `days` days to today, in `tz`), not one ending on the tapped
  day, and it includes that day. So does the bars' median day: one rule. A `day` outside it is `invalid`.
- **Today's running workers** come from the laptop reports (`ctx`, ≤ 400 points, `frames.ts:120`),
  added by the dashboard, as §3's "so far" adds their tokens.
- **Calls per day per role** for the period are cheap and go on `usage` itself: each point gains
  `calls` and `by_role: Array<{ role, calls, raw, weighted }>`.

**A day's biggest sessions** (spec §6 Q4). Each `usage` point gains `top`: the sessions in the top 3 by
raw or by weighted that day (≤ 6), each `{ session: SessionRef | null, feature_title, raw, weighted }`.
`session: null` is the day's work outside any session, as one entry. The dashboard sorts by the switch
and shows three.

**CI history** (spec §6 Q2) is the board's, not the laptop report's. `ci_runs` (`schema.ts:285`)
already keeps every run the supervisor's gh adapter posts (`ci-poll.ts:47`), passed ones included. A
land's push ties a run on its sha to the worker (`pushes`, `store.ts:2683`). One helper, `ciOf(p)`,
gives per workflow (`name`, source not `slot`) its latest run and the 5 before it: `{ name, branch,
status, sha, url, started_at, ended_at, agent }`, where `agent` is `runs.agent` through `pushes.run`,
else null. The `project` read gains `ci`, and `OverviewRow` gains it as an optional field. The laptop
report's `ci` stays on the wire for older dashboards.

**A feature's own criteria** (spec §6 Q3). `Progress` stays its own plus its tasks' AC (`store.ts:266`),
as every list reads it. A feature's `ItemSummary` gains optional `own: { checked, total }`: its own AC
and DoD together. It also gains `done_at`: when it was last moved to Done, by the rule the status read
already uses (`store.ts:998`). A Done feature's unticked criteria are `get`'s `criteria` with `state:
"open"`. That read exists already.

### 4. The current release (BOB-163)

- **The rule.** A project's current release is the first release, in the board's order (`ord IS NULL,
  ord, pk`), whose status is not `closed` and which holds at least one feature that is not Done and not
  archived.
- **When there is none,** it is the last non-closed release (all its work done, waiting for Casper's
  close), or null.
- **`CurrentRelease`** is `ReleaseRecord` plus `number`, its 1-based place in that order. Its
  `features` stay done of total, non-archived features only (`releaseRecord`, `store.ts:449`).
- **Who uses it.** `overview()` and `project` share one helper. The status read's `backlog.release`
  (`store.ts:907`) takes the same helper, so the three never disagree.
- **Helix.** It shows R2, its true count, and R1 under `done_unclosed` (on the project page) or nothing
  (on the Overview).

### 5. What crosses what

| Change | Protocol | Broker deploy | Supervisor rc and restart |
|---|---|---|---|
| §1 weights, §3 reads, §4 release rule | additive: three board read ops (`usage_day`, §3a), optional fields on `SessionRecord`/`RunRecord`, `ItemSummary` (`own`, `done_at`) and `OverviewRow` (`ci`) | yes | no |
| §2 `run_end.models` | additive optional field, new broker table | yes, first | yes, riding with BOB-162 |

## Consequences

- Casper's question has a one-line answer on the page: effort is already in the count, and the model
  is what the toggle adds.
- **The table goes stale** when Anthropic changes prices or ships a model. A new model's tokens show as
  unknown (×1, said on the page) until someone adds its row: wrong in a visible way, never silently.
- **Weighting happens in the broker.** The dashboard weighs only the live "so far" part, and only with
  the table the broker sent.
- **Until §2 ships,** a role declared with no model (most of ours, e.g. consults) shows as unknown.
  The unknown line says how much.
- The laptop reports' `usage` rows are no longer the Usage page's source. They stay on the wire
  unchanged.

## Alternatives considered

- **A factor per effort level.** Rejected. It would count thinking twice: once as the output tokens
  already reported, and again as a multiplier.
- **Weighting kinds against each other** (output ×5, cache read ×0.05), i.e. cost-weighted tokens.
  Rejected for this toggle. It is a money proxy in all but name, and it changes every number Casper
  knows. It can be its own toggle if he asks.
- **One factor per model, from the output price only.** Rejected. Fable's and the older models'
  cache-read ratios differ from their other ratios, and cache reads are most of the raw count.
- **Weighting in the dashboard only.** Rejected. It is untestable in the broker's suite, and every
  reader would need its own copy of the table.
- **Bucketing a run on the day it ended.** Rejected. A long-lived lead would appear as a spike on the
  day it stops.
