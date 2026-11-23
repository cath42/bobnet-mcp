# BOB-121: the build waves

Peach, 2026-11-22, after Casper's Q-13 verdict ("changes"; `lead/bob121/q13-verdict.md`). Sources:
`architecture/bob121/build-brief.md` (D1-D10), `design/BOB-121/spec.md` (views §2.0-2.11, tests §4),
ADR 0014, `product/requirements/dashboard-redesign.md` (AC4's meaning). Every task's criteria cite
their section and name their tests. Labels on the board: `wave-A`, `wave-B`, `wave-C`, `broker-deploy`,
`supervisor-rc`, `view`.

**Builds (Q-15, 2026-11-23).** Build A, A1's data reads, is done and live since the BOB-189 deploy. What is left:

| Build | Tasks, in order | Ships |
|---|---|---|
| **B** | BOB-171 (D4), BOB-169 (D10), BOB-172 (D5), **BOB-192** (review minors), BOB-173 (D6), BOB-162 (D7) | one broker deploy, **then** the supervisor rc (D6, D7) and a restart of mbp-1 and ubu1 |
| **C** | BOB-174, 175, 176, 177, 178 (wave B's views) | one broker deploy |
| **D** | BOB-179, 180, 181, 182 (wave C, first half) | broker deploy |
| **E** | BOB-183, 184, 185, 186 (wave C, second half) | broker deploy |

Data before the views that read it. **BOB-192's m3 lands before BOB-180** (the Usage page calls `usage`).
B and C are Ready. D's and E's criteria are checked against what landed after C.

- Build B may be deployed before C, so no page goes dead in B: BOB-172 adds the old-link resolver, and
  BOB-174/175 switch pages over.
- In C, #sessions lands on #laptops (BOB-174) until BOB-182 turns it to the project page, and the
  Features tab opens today's feature view until BOB-185.
- Wave B's criteria were checked against the landed shapes (D1 82568b2, D2 57c4da4, D3 1622e33, D8
  fb18a12, D9 56f1e94 + 71c2ea0): no failure line on the CI card and no delivered claim on a decided
  permission, because no data carries them; `usual_ms` comes with BOB-192.
- Folded: BOB-187 (BOB-176 criterion 7), BOB-164 (BOB-176 criterion 5), Daisy's BOB-189 m1-m3 (BOB-184).

The wave tables below keep each task's one line; the order above wins.

## Wave A: broker data (8 tasks; 5 Done in build A, BOB-171, 169, 172 in build B)

One broker deploy at the end. No supervisor change. Cut after D9 if it runs long: **A1** = D1, D2, D3,
D8, D9; **A2** = D4, D10, D5.

| Order | Task | One line |
|---|---|---|
| 1 | **BOB-166** D1 | the weight table in protocol: `USAGE_WEIGHTS`, `weightOf`, `weigh` (ratios, no price) |
| 2 | **BOB-163** D2 | `currentRelease(p)`: the Overview shows Helix on R2, not "R1, 4 of 4". Existing bug, folded; `Fixes: BOB-163` |
| 3 | **BOB-167** D3 | the `usage` read: a series per project, weighted, with `calls`, `by_role` and `top` sessions |
| 4 | **BOB-170** D8 | the `usage_day` read: a day's context per call by role and total, the period median as baseline (Casper's Q-13 change) |
| 5 | **BOB-168** D9 | CI history from `ci_runs`: latest run and the 5 before it per workflow, the landing agent through `pushes` |
| 6 | **BOB-171** D4 | the `project` read (ProjectPage) and weighted sessions; reads D2, D3 and D9 |
| 7 | **BOB-169** D10 | a feature's `own` criteria count and `done_at` on its summary (feeds Roadmap and Features) |
| 8 | **BOB-172** D5 | dashboard plumbing in `app.js`: live "so far", the weigh toggle, a day's detail fetch, old-link routes |

## Wave B: the Overview's parts, Laptops, the header, and the supervisor rc (7 tasks)

All Ready (2026-11-23). D6 and BOB-162 are in build B, the views in build C. One broker deploy for the views. **The supervisor rc is D6 and BOB-162
(D7); deploy the broker first, then roll the rc and restart mbp-1 and ubu1.** D6 may be cut to a
follow-up without failing AC12 (the weighting falls back to each run's declared model).

| Order | Task | One line |
|---|---|---|
| 9 | **BOB-174** | header, tabs, old links, the Sessions tab removed, Triage unchanged (AC10, AC13) |
| 10 | **BOB-175** | the Laptops page: laptops, agents, rules, the folded message log |
| 11 | **BOB-176** | Needs you: one item function, never stale (AC4), the permission form's note (AC16), "Answered from here today" (AC15) |
| 12 | **BOB-177** | the agent's detail row, a worker's AskUserQuestion whole with Show all (AC14); BOB-161 not built |
| 13 | **BOB-178** | the CI card: every workflow's last run, passed too, and the five before it (AC3) |
| 14 | **BOB-173** D6 | per-model tokens: `run_end.models` and the `run_models` table. **Supervisor rc + broker** |
| 15 | **BOB-162** D7 | `askOf` checks credentials before clipping (AC17). **Supervisor rc**; `Fixes: BOB-162` |

Needs a broker deploy: BOB-174 to BOB-178, and D6's broker half (the migration). Rides the supervisor
rc: **BOB-173 (D6) and BOB-162 (D7)**. Without them BOB-121 needs no supervisor restart (DoD 1).

## Wave C: the views that read the data (8 tasks)

All broker deploy. Cut after BOB-181 if it runs long: **C1** = Overview, Usage, Usage's day, project
page; **C2** = Status, Roadmap, Features, feature page.

| Order | Task | One line |
|---|---|---|
| 16 | **BOB-179** | the Overview: both Needs you groups, Working now by project, CI, Projects at a glance (AC3, AC5) |
| 17 | **BOB-180** | Usage: a graph per project, spikes, Weigh by model (AC11, AC12) |
| 18 | **BOB-181** | Usage, a day's detail: context per call and calls per day, Total or By agent, the period median (Casper's Q-13 change) |
| 19 | **BOB-182** | a project's page: release, running, who ran lately, waits, CI, usage, backlog health (AC6, AC13) |
| 20 | **BOB-183** | Status works on production data; BOB-33 closes against it (AC7) |
| 21 | **BOB-184** | Roadmap's "Where it stands": no unexplained criteria count (AC8) |
| 22 | **BOB-185** | Features lists the board's features; never "no backlog configured" (AC9) |
| 23 | **BOB-186** | a feature's page: a Done feature's unticked criteria, sessions with their runs (AC8, AC13) |

## After the waves

- Review (DoD 2) after builds B with C, and after E: Daisy against the prototype at 390, 1024 and 1440; Toad for
  D1-D10's shapes and the weighting.
- DoD 3: Casper sees it live and says so on the board.
- BOB-51's AC1-AC3 (dashboard half) are BOB-177, BOB-176 and BOB-176; BOB-33 closes against BOB-183.
- The prototype's "show other states" panel is never built (BOB-179 has a test that it is absent).
