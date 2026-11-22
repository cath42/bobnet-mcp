# BOB-121 build brief: the data tasks (for Luigi)

**Design:** ADR 0014 (`architecture/decisions/0014-usage-weighting-and-project-page.md`). The § numbers
below are its sections. **Screens:** Daisy's prototype in `design/BOB-121/`. **Criteria:** BOB-121 ACs 5,
6, 11, 12, 13 and 17, and DoD 1. Line numbers are at `89c5f58` (origin/v2).

**Gate:** no build starts before Casper's verdict on the prototype is on the board (AC2). These are the
data tasks only. The view tasks (Overview, Needs you, project page, Usage, feature page, Sessions removal,
Status, Roadmap, Features) come from Daisy's prototype and are cut after the verdict. **D1-D5 come before
the views that read them.**

**What ships how:**

| | Tasks |
|---|---|
| Broker migration | one table, `run_models` (D6) |
| Broker deploy | yes: D1-D4, D6 |
| Supervisor rc | yes, D6 and D7 (BOB-162), which ride together. After the rc, restart mbp-1 and ubu1, and deploy the broker before that restart. Without D6 and D7, BOB-121 needs no supervisor restart (DoD 1). |

## Already true on v2: checked, not to build

- **Every run's figures are on the board** (`runs`, `broker/src/board/schema.ts:235`): model, effort,
  the four token kinds, outcome and outcome_reason (`:386`), session, laptop, start and end.
- **Every session's close is on the board:** `SessionRecord` (`protocol/src/board.ts:690`), built by
  `get` with `session`.
- **Needs you's list:** `waitsOf(p)` (`store.ts:521`).
- **Backlog health:** the status read's `backlog` (`store.ts:963-976`). Lift it into a helper; don't
  copy it.
- **CI per project and who is running** stay the laptop reports' (`ciLines`, `app.js:1365`; snapshot
  workers). The project page reads them as the Overview does. No new read.
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
- **Done when tests show:**
  - two projects each get their own series (AC11);
  - an Opus run weighs double a Sonnet run with the same tokens (AC12);
  - a run declared null lands in `unknown`;
  - a 48-hour run splits across three days by its hours;
  - a lost run is in `lost` and not in the tokens;
  - `tz` moves a run at 23:30 UTC into the next day for `Europe/Copenhagen`;
  - a project the caller can't read is absent.

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
- **Done when tests show:**
  - a running worker adds to today's point and an ended one doesn't;
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

**Size:** D1-D5 are about one build session. D6 and D7 make a short second one, or the same one if it
runs long enough.

**Review (DoD 2): Toad.** I check:
- D1's table against ADR 0014 §1, and the pricing page's date;
- D2-D4's shapes against §3 and §4;
- that no `$`, `cost` or `price` appears in the new code or on the page.
