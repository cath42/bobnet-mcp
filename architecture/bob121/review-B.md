# BOB-121 review B: what build B landed (Toad, 2026-11-23)

`07cdc3b..0a7df68` on v2 (Luigi, handoff w_08c5b32c), checked against each task's criteria, the build
brief, ADR 0014 and ADR 0012 §2. Line numbers are at `0a7df68`. v2's tip after it, `c9fd1b5`, changes only
`CLAUDE.md`.

**Verdict: passes both gates. 0 blockers, 1 major, 7 minors.**

| Gate | Answer |
|---|---|
| 1. Broker deploy from the tip, migration 8 included | **yes** |
| 2. Supervisor rc with D6 and D7 | **yes** (M1 is as bad in rc.54; fix it before the rc is cut and it needs no second one) |

| Task | Commit | Verdict |
|---|---|---|
| BOB-171 D4, `project` read | 70db144 | pass, minor 3 |
| BOB-169 D10, `own`, `done_at` | 9510ae2 | pass, minor 4 |
| BOB-172 D5, plumbing | 77d95b8 | pass, minors 1, 5, 6 |
| BOB-192 review minors | 5510c00 | pass, c1-c7 |
| BOB-173 D6, per-model tokens | 021557b | pass, c1-c3; c4 is the close's; minors 2, 7 |
| BOB-162 D7, `askOf` | e3ba2f8 | **c1 not met for a raw-input ask: M1** |
| BOB-193 retired projects | 0a7df68 | pass, c1-c3's test and diff parts; the post-deploy evidence is still to take |

Run here: broker `board`, `board-project`, `board-usage`, `board-export` (149 passed), the dashboard suite
(126 passed), supervisor `board-service -t run` (23 passed). I did not run the full suite again: the last
land did.

## Gate 1: deploy-safe, yes

- **Migration 8 is additive** (`broker/src/board/schema.ts:492`): one new table, no `ALTER`, no rewrite,
  nothing read from it at migration. Its foreign key is the one `run_tasks` has. It runs in the
  constructor's transaction, so it is in whole or not at all.
- **rc.54 and older supervisors** send `run_end` without `models`. The field is optional, the write is
  skipped, and the run weighs by its declared model, as today. They need no restart for this deploy.
- **An open page** (old `app.js`) reads replies that only gained fields. The new `app.js` ends in an
  `export`; `index.html:9` loads it as a module, and nothing else loads it.
- **Rollback.** `migrate()` (`broker/src/schema.ts:107`) runs only versions past the stored one, so a
  broker of 7 migrations on a database at 8 starts, leaves `run_models` alone, and works: it never deletes
  a run, so the foreign key can't refuse it. Runs that end meanwhile have no models and weigh as declared.
  A later redeploy stays at 8. `wrangler.jsonc` is unchanged, so there is no object migration to undo.
- **What a reader sees:** the Overview and Status take the new current-release fallback (§4: none where
  there was a guess; `projectRow` already draws "no open release"), and Alexa-MCP and Sandbox are gone. The new
  reads have no caller on a page yet except `usage_day`, which no page opens.

## Gate 2: rc-safe, yes, in both orders

| Order | What happens |
|---|---|
| New broker, rc.54 | as above |
| rc, broker of before | `run_end` is a plain `z.object`, so `models` is dropped and the rest is taken. A report queued in the outbox likewise. Those runs weigh as declared for good. |
| rc, then back to rc.54 | `usage` in `workers` holds an extra `models` key, which rc.54 doesn't read. No supervisor store migration. |

Deploy the broker first anyway: a run that ends on the rc before it loses its split.

- D6 sends `models` only when every kind adds up (`supervisor.ts:3626`). I followed the cases that could
  make a wrong one: a run ended mid-turn (tokens ahead of the last result's models), a resume of a session
  that ended mid-turn, a resume of one from rc.54 (no models in its base), a kind clamped at zero, more than
  10 models. Each ends in none, so the fallback. The broker checks the sums again and drops a lost run's
  (`store.ts:2963`). A second `run_end` returns before the insert, so nothing is added twice.
- D7 changes no shape: more asks are `null`, which every dashboard since ADR 0013 reads.

## Gate 3: shapes and weighting, as ADR 0014

- **D4:** `ProjectPage` is §3's. `tz` is added on the op: right, since `usage` in it must equal the usage
  read's. Backlog lists cut at the status read's 100: right, since §3 says the same code. ADR 0014 §3 now
  says both. Waits, backlog, usage and CI come from the shared helpers (`backlogHealth`, `store.ts:1366`,
  is moved, not copied), and the equality tests compare the replies.
- **D6 and weighting:** `run_models` when a run has them, else `runs.model`, else unknown, in `usage`, the
  project page, and `get`'s session and runs, all through `runParts` (`store.ts:1357`). Spread, `by_role`
  and `top` take the split too. Raw counts cannot change, since the sums are enforced.
- **D5's port of the resolve rule:** I ran `weightRow` beside the protocol's `weightOf` on 17 names
  (aliases, dated ids, `[1m]`, unknown versions, Mythos, null): the same row each time. Its factors are the
  reply's.
- **D10:** `own` is AC and DoD of the feature alone; `done_at` uses the status read's rule, shared as
  `DONE_AT`. Both are absent on tasks and backlog items.
- **BOB-192:** §4's fallback, `usual_ms` (absent, not null), a CI run once, and `usage` without `ctx` are as
  ruled. A push with no run doesn't hide an earlier one that has an agent, which is right.
- **Tokens only:** no `$`, cost or price in the new source or on the page. The tests' SDK fakes carry the
  SDK's own field names, as before.

## Gate 4: BOB-162's credential check

For a command, path, URL or question the check is right: raw and serialised, on the source before its clip,
and any hit withholds the whole ask. The raw-input fallback is not covered: M1.

## Gate 5: BOB-193 against ADR 0012 §2, yes

`projects()` (`app.js:210`) is still the only reader of `state.boards` and filters by `svc.projects`.
`legacyRow`, `legacyCard`, `OLD_BOARD` and their styles are gone. A failed read keeps the last list; with
none read, pages say the error, and it is tried again each minute and on any `board_changed`. Live workers
and requests of an unlisted project stay (tested). The commit touches `public` and `test-ui` only: no
broker change, nothing deleted.

## Gate 6: rows read

Measured with a throwaway test (not committed) on workerd's own SQLite, old store (`07cdc3b`) against new,
same data: 5 projects, 3 of them with 40 features (30 Done, 33 events or more each), 160 tasks, 100
sessions, 1500 runs over 87 days with 2 models each, 1500 CI runs and 375 pushes.

| Read | Rows before | Rows now | Why |
|---|---|---|---|
| `overview` | 27,543 | 28,689 | `usual_ms`: about 90 rows a workflow |
| `status` | 50,606 | 51,926 | `own` on its feature rows |
| `list` features, one project | 2,843 | 8,163 | `done_at`: minor 4 |
| `usage` 30 / 90 days, all projects | 1,998 / 5,709 | 11,489 / 32,714 | `run_models`: minor 2 |
| `usage_day` | 547 | 547 | |
| `get` session | 4,539 | 4,599 | |
| `project` 14 / 90 days | | 24,611 / 36,437 | minor 3 |

All fine at today's sizes. Two thirds of `overview` is D9's window over every CI run of a project, from
wave A. It grows with `ci_runs`, and the Overview is read on every `board_changed`. Nothing to do now.

## Findings

### Blockers

None.

### Major

**M1. A credential after an escaped newline or tab still crosses when the ask is the raw input.**
`supervisor.ts:3957` (`askOf`) and `:3872` (`preview`).

- When a tool has no `command`, `file_path`, `url` or `path` (an MCP tool, `Agent`, `WebSearch`), the text is
  `r.input`, which is JSON. A newline in it is the two characters `\n`, so the `n` touches the token and no
  pattern's word boundary matches. `detect(s)` and `detect(JSON.stringify(s))` both miss it.
- Run against `0a7df68`: `{ body: "x\n<github token>" }` crosses whole; the same with a tab. With the token
  over the 8000 clip, 38 of its 40 characters cross as a prefix. That is what c1 says must not happen.
  After a space, it is withheld. `password=` after a newline crosses too.
- It is not new: rc.54 does the same, and `preview` has the same hole. So it doesn't hold the rc.
  But e3ba2f8 found this very effect for the picked text and closed it only there, and ADR 0013 §1 says no
  credential crosses.
- **Fix:** where the text is the raw input, also run `detect` on every string (and key) of the parsed input,
  as `withholdSecrets` (`:205`) walks one; in `preview` too. Tests: a token after `\n` and after `\t` in an MCP
  tool's field, whole and across the clip, gives `ask: null` and a hidden preview.
- A task of BOB-121 (S, supervisor), before BOB-162 is Done. Best before the rc is cut.

### Minors

1. **`oldLink` is §2.0's "Later" column, not build C's** (`app.js:3115`). In C, `#sessions` goes to
   `#laptops` with the other toast, `#feature` alone stays the feature view, and `#rules` (missing here) goes to
   `#laptops`. It isn't wired, so nothing breaks now. BOB-174 and BOB-175 must not wire it as it is.
   `decodeURIComponent` (`:3124`) throws on a malformed `%`: catch it when it is wired.
2. **`modelsEnded` sorts what it needn't** (`store.ts:1347`). The read costs 3 rows per model row, part of it the
   temp B-tree its `ORDER BY` builds, and `usage` sorts `by_model` itself. Drop it before BOB-180 calls `usage`.
3. **The project page reads `run_models` twice for every run** (`store.ts:1167`, `:1237`): 870 of its 1,065
   queries. Weigh each run once from one read, as `usage` does. Before BOB-182.
4. **`done_at` reads all of a Done feature's events** (`store.ts:313`), in every feature list, which the
   Roadmap re-reads on each `board_changed`. Fine now; if a list passes 50,000 rows, index
   `event_changes` on moves to Done, or keep the date on the item.
5. **A quiet laptop's workers, and a worker that just ended** (`app.js:2844-2856`). `beforeToday` spreads to
   now, not to the report's `at`, so a laptop asleep since yesterday puts part of its tokens in today. And
   when a worker ends, its live part goes at once while a kept `usage` reply lacks its run: BOB-180's loader must
   read `usage` again on `board_changed`, as `usageDayChanged` does for the detail, or today's bar falls.
6. **`setWeigh` drops the hash's other filters** (`app.js:2811`): it writes `?weigh=` alone. Nothing has
   another today. Fix in BOB-180 if it adds one (the span).
7. **The export.** `docs/board-export-v1.md` mentions neither a run's `models` nor its `outcome` (Luigi's
   finding 2). And an imported run's `models` (`protocol/src/board-export.ts:152`) have no cap and aren't
   checked against its tokens, as `run_end`'s are: an edited file could change a run's weighted count.

## Luigi's finding 1: a live worker's `ctx` is its last 400 calls

**Accept for build B and its deploy; a task before BOB-181 ships.** Luigi read it right, and ADR 0014 §3a never
said those points were evenly taken. No page draws `totalLine` yet, and tokens, calls and By agent are
unaffected: By agent draws the points where they were made.

- What is wrong is Total for a worker past 400 calls, a lead mostly. The curve starts at call N-399 and
  rises `calls / 400` times too steeply, since the latest calls stand in for the earlier, smaller ones. It
  snaps to the truth when the run ends.
- **Task (S, supervisor and protocol):** `WorkerSnapshot` gains an optional `ctx_even: true`, and `callsOf`
  (`supervisor.ts:3638`) sends `downsample(run.ctx, 400)` with it. With the flag `liveLine` is a plain
  downsampled line, split over days as a run's is; without it (an older supervisor) `known` stays as built.
  Broker first: one without the field strips it, and the page would then misplace the points. It answers
  Luigi's "the page can't tell which supervisor sent it". The session cards draw the same field, and gain the
  whole run in place of its end.
- **If BOB-181 ships before that rc,** its note says Total is approximate while a run on the day has `known`.
