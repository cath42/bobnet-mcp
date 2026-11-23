# BOB-121 review D: what build D landed (Toad, 2026-11-23)

`93311ab..c82f3e0` on v2 (Luigi, handoff w_7730b161), checked against each task's criteria, the spec (§2.0, 2.1,
2.3, 2.9) and ADR 0014. Gate 1 covers the combined tree, `9fde1b9..c82f3e0`. Line numbers are at `c82f3e0`, the tip.

**Verdict: passes both gates. 0 blockers, 1 major (M1: one line, fix it before the deploy), 3 minors, and one rule
of mine changed (R1, same deploy).**

| Gate | Answer |
|---|---|
| 1. Broker deploy of C and D together, rollback included | **yes** |
| 2. The rc with BOB-195's half, either order | **yes**; broker first |
| 3. Reads | fine; review B's minors 2 and 3 are done |
| 4. Shapes against ADR 0014 | right; `done_unclosed` on the Overview accepted; R1 |
| 5. Tokens only | yes |
| 6. A page dead or a link broken | none |

| Task | Commit | Verdict |
|---|---|---|
| BOB-195 `ctx_even` | 1752a58 | pass, c1-c3; c4 is the close's; minor 3 |
| BOB-180 Usage | a4f588e | pass, c1-c7; c3's median changes with R1 |
| BOB-181 a day's detail | e945a71 | c1-c7 met by its tests; M1, minor 1, R1 |
| BOB-182 a project's page | 2faf1b3 | pass, c1-c10; minor 2 |
| BOB-179 the Overview | c82f3e0 | pass, c1, c2, c4-c7; c3's Helix part after the deploy |

Run here: the dashboard suite twice (the second 201 passed; in the first, at load 13 and beside my measuring,
one test of `project.test.ts` failed, "reads again on board_changed"; it passed alone and in the second run, and I
didn't keep its message), broker `board`, `board-export`, `board-project`, `board-usage` (152 passed), protocol (171), the
supervisor's `usage and snapshots` and report-limit tests (12). Probes in Chromium and workerd, not committed.

## Gate 1: deploy-safe, yes: C and D together, over 9fde1b9

- **No migration.** `schema.ts`, `wrangler.jsonc` and the lockfile are unchanged in `9fde1b9..c82f3e0`. The broker's own
  source changes only in `board/store.ts`: an action's options are refused (C); `done_unclosed` on the Overview, and
  `modelsEnded` with the project read that uses it (D). The protocol gains two optional fields.
- **rc.54 and rc.55 supervisors** send no `ctx_even`, and their lines are drawn as before (`app.js:3386`); Total then says
  it is approximate. Review C's notes stand: an agent's `board_ask` with options on an action is refused in words, and
  both laptops should be on rc.55 before the page draws an ask whole.
- **An open page (build B's)** keeps its own files and reconnects. Every read it makes is there, with fields only
  added. A reload gets the new page whole.
- **Rollback to 9fde1b9.** Nothing new is stored but `ctx_even` inside a laptop's snapshot, which the old broker hands on
  unread. An open new page draws no `done_unclosed` and otherwise works: the old broker has every read it makes.
  `#project/<key>` on the old page opens the Overview.

## Gate 2: rc-safe, yes, in both orders

The supervisor's change since `9fde1b9` (rc.55's is the same) is `callsOf` and nothing else.

| Order | What happens |
|---|---|
| New broker, rc.54 or rc.55 | as gate 1 |
| New broker, rc | the flag crosses; Total is right past 400 calls |
| rc, broker of 9fde1b9 (or rolled back) | the flag is dropped, the report is taken. Build B's page shows a live run whole instead of its end. A new page still open places the points as the last 400, and says approximate, until it reloads |

- The flag adds 17 bytes to a running worker's row; the report-limit test has it on every one.
- Total, live against ended: exact on linear context, as tested. On a real run the live one has 400 points and the
  ended one up to 2000, so it is near, not equal, until it ends. That is what c3 can mean.
- Split over days: the page's `perCall` is the board's (`usage.ts:81`), cut at the same `round(calls x share)`.

## Gate 3: reads

Rows on workerd's SQLite at review B's sizes (with 1,125 `pushes`), `93311ab` against `c82f3e0`, same data.

| Read | Rows before | Rows now | Queries |
|---|---|---|---|
| `usage` 14 / 30 / 90 days, every project | 5,624 / 11,648 / 32,714 | 4,074 / 8,442 / 23,712 | same |
| `usage` 14 days, one project | 1,873 | 1,357 | same |
| `project` 14 / 90 days | 42,915 / 57,819 | 41,412 / 52,470 | 551 to 119 / 1,723 to 473 |
| `overview`, every project / one | 86,317 / 30,269 | the same | same |
| `waits` / `status` a day / `usage_day` | 1,215 / 44,531 / 564 | the same | same |
| `list` features / releases, one project | 4,003 / 3,608 | the same | same |

- **Minor 2 is done:** no `ORDER BY`, no temp B-tree. **Minor 3 is done:** one read of `run_models`, every step of it on an
  index. Its two halves meet on `ended_at`, so no run is read twice or missed.
- **Per `board_changed`,** on top of `overview` and `waits` (87,532): Usage adds 8,442. A project's page adds 80,649
  for a change of its own project (its read 41,412, `usage` 1,357, the roadmap 37,880: minor 2), and nothing for another's.
- **Luigi's question 2: accepted as built.** Usage adds a tenth to what each change reads already, reads never overlap
  (`readKept`, `app.js:3003`), and one no page shows isn't made. Reading the changed project alone into the kept reply
  would be a quarter of it: not worth its code now.
- **For the backlog, not this deploy:** three quarters of `overview` is CI history, and most of that is its agent lookup, which
  scans every project's `pushes` for each kept run (`store.ts:104`; the table has no index on project), and so grows with each
  land. An index on `pushes (project, sha)` ends it. It is a migration.

## Gate 4: shapes

- **`done_unclosed` on the Overview read: accepted.** Optional, the project page's helper, no read of its own, and
  179 c3 needs it. ADR 0014 §4 said "nothing" there; it is amended in this commit.
- `project`, `usage` and `usage_day` keep ADR 0014's shapes. `liveLine` and Total against an ended run: gate 2.
- **R1. The median day leaves out days with no work** (Daisy's finding, consult c_4fa17383; my rule didn't say). The
  30-day median of a project 11 days old is 0, so each bar over 4M is a spike, and the key says "median day · 0
  calls" beside a real dashed line. Ruled in ADR 0014 §3a, this commit. Broker: `store.ts:1326`, `:1330`. Page: `app.js:3042`,
  and `dayDetail`'s median and its fallback (`:3275`). No new field; either half alone is harmless. Peach: 180 c3's words.

## Gate 5: tokens only, yes

No `$`, currency or cost in the new source or on the page. "Price" is in ADR 0014's sentence and the table's note
(`app.js:3051`, `:3060`), as ratios.

## Gate 6: no page dead, no link broken

- Every link goes to one of the 9 views (`app.js:3715`). `#project/<key>` has its links: the CI card's and the Overview's
  names, Working now's groups, the Usage cards' heads.
- `#sessions` and `#sessions/<x>` open the first project's page with one toast; until the projects are read, the Overview.
- `#usage/<key>` scrolls to the card; a day outside the span opens nothing. Nothing refers to what went (`showRun`, the old chart).
- Still true until BOB-185: the Features tab of a project with no Backlog.md board.

## Findings

### Blockers

None.

### Major

**M1. Escape with the pointer over a day's graph stops Usage's live redraws** (`app.js:3203`, `:3209`, `:3784`).
- The graph holds redraws while it is pointed at and lets go on `pointerleave`. Escape closes the detail through
  `render()`, which removes the graph, and a removed element gets no `pointerleave`. So `holdRender` stays true, and
  `scheduleRender` puts itself off for good.
- Shown in Chromium on the real page: click a bar, point at its graph, Escape, move away: 5 live frames, 0 draws.
  Closed by its × instead: 5 draws. Enter on the bar takes the same path.
- Until he changes page or points at another graph, the bars, the workers' "so far", any read's error and the header's Needs
  you count stand still, and nothing says so. A click draws once. Escape is the spec's own way to close (§2.9).
- **Fix:** `holdRender = false` at the start of `render()`; a pointer still over the new graph sets it again as it moves.
  Test: `pointermove` on the graph, Escape, a report frame, and the view is drawn again.

### Minors

1. **After a reconnect, today's open detail isn't read again** (`app.js:1044`, `:3369`). `loadProjects` marks the kept reads
   old, not `usageDays`, so a run that ended while the page was cut off is in the bar and not in the detail until that
   project's next change. Mark them all old there.
2. **The project page reads a project's `overview` through `loadRoadmap`** (`app.js:1055`) for `no_release`, which it doesn't
   draw: 30,269 of its 80,649 rows. And a roadmap once loaded is read again at each change of its project, on any view
   (`app.js:3942`); now a visit to a project's page loads one. Read it again only while a view that draws it shows.
3. **A session card counts a live run's points as its calls** (`app.js:762`, `:807`, `:832`; Luigi's finding 3). Older than D,
   but from the rc the 400 points are the whole run: "Whole session" sums 400 of 1,000 calls, and the line is shorter and
   steeper than the earlier sessions' beside it. Take `calls` for the count, and place the points by call as `callAt` does.

## What must wait for which deploy

1. **Before the broker deploy (C and D):** M1 and R1. Minors 1 and 2 if cheap. None of them changes gates 1 and 2,
   as long as the fixes touch only `app.js` and `store.ts:1326`, `:1330`.
2. **After the broker deploy:** 179 c3 on Helix's real board; 176 c5 and c6 and the CI card's first live change (review C).
3. **Then the rc** with `callsOf`, rolled out once the broker is up; 195 c4 says which of mbp-1 and ubu1 restarted.
   Minor 3 is best on the page before it, and can follow.
4. **A later deploy:** the `pushes` index, with its migration.
