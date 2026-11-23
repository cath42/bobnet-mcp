# BOB-121 review D: on screen (BOB-179, 180, 181, 182; AC3, AC5)

Daisy, 2026-11-23. Reviewed: v2 at c82f3e0, against `spec.md` §2.1, 2.3, 2.4, 2.9, the prototype and each task's criteria.

## Verdict: pass once M1 is fixed. 0 blockers, 1 major, 12 minors

The four pages are the design, at all three widths, light and dark. M1 is the spec's rule (mine and Toad's), not a slip of the
build, but it would be the first thing Casper sees on Usage. m4 and m5 are one-line CSS; I'd put them with it, before the deploy.

## How I checked

Luigi's shots (the main ones of each task), then 150 of my own (`shots-review-D/shots.mjs`, 53 scenes): 7 projects, a project
ten days old, one that never ran, one with 900 tokens, three spikes in a row, unbroken names, 29 sessions, 18 runs in one
session, one and two quiet laptops, a laptop asleep 14 hours, each read failing alone, a failed re-read, dark, weighed, a touch
on a graph, Escape. Widths 360 to 1440. It prints overflow, contrast and tap sizes; no page error. Toad's queries and figures
aren't mine to judge. One figure differs in my shots only: the dot's calls and the key's are from two made-up reads.

| Checked | Result |
|---|---|
| **AC3**, phone | First screen: the Status line, "Needs you 8", and what holds work up, with its buttons (`first-overview-390`). With nothing waiting, who is running is on it too (`first-nothing-390`). With eight items, Working now is 1.6 screens down and CI 2.1. That is the prototype Casper approved, so it passes; see the question below |
| **AC3**, tablet, desktop | Needs you and Working now whole, CI's first rows on the first screen (`first-overview-1024`). Failed, running, passed: each in words, mark and colour |
| **AC5** | The row's release, meter, "1 of 6 features done", "R1 all done: waiting for your close"; none, two and no release; the whole row opens its page (`overview-many-1440`). Helix's real board: after the deploy (179 c3) |
| 179 c1, c2, c6, c7 | Compact three then the link; every project in Working now; the CI pill; review C's m6, m8, m10 are done |
| 180 | Every project, own scale; the switch changes every figure; What's factored fits a phone; 14 days; asleep; failed and failed again (the old figures stay, with their time). Not its spikes: M1 |
| 181 | Open, close, Escape and focus; loading, failed, no calls, no band; stacked, side by side, stacked; a touch leaves the tip up (`day-tap-390`); weighing leaves the context alone; 30 calls to 1,650 |
| 182 | Both projects; nobody; nothing at all (a project that never ran); each read failing alone; lost, failed, running, no report; `#sessions` lands here with its toast |
| Sideways scroll | None in 150 but m4 |
| Contrast | All text over 4.5:1 but m10 (CI's ○ is a mark, its word is beside it) |

**The CI name column (review C fix pass): `fit-content(45%)` is right.** My `minmax(9em, 45%)` took room from the status on every
ordinary row. Short names give it back; long ones wrap inside 45 % and touch nothing (`ci-1440`, `ci-1100`). §2.4 now says so.

## Major

### M1 A young project is all spikes (BOB-180 c3, BOB-181)
The median day counts days before the project began, and days off, as 0. This team began on 13 Nov, so BobNet has at most 11 days in 30, and on the
default 30 days its median is **0**: "11 spikes over twice the median day", every bar orange, their values over each other,
"median day 0" (`usage-1440`, `first-usage-390`). The day's key then says "median day · 0 calls" beside a dashed line. Casper asked for spikes to
be seen without clicking (AC11), and for a baseline (Q-13); this shows neither, on the first card.

Fix: the median is over the span's days with tokens; calls, over days with a call (the role's: days it made one). Under 3 such days:
"median day –", no spike, no dashed calls line. `usageFigures` and `dayDetail`'s fallback in app.js; `store.ts:1326` and `:1330`. The context
line already works this way. I asked Toad (c_4fa17383); no answer in ten minutes, so §2.9 says "Toad to confirm".

## Minors

| | Finding | Fix |
|---|---|---|
| m1 | **On a phone, a project's page has what waits on Casper four screens down** (3,235 px of 4,970): Who ran lately is above it, two lines a run, and consults (1 call, 15k tokens) are most of the lines (`project-390`, `project-bobnet-1024`). My order | Spec changed (§2.3): one column is release, running, waits, CI, who ran, usage, backlog; consults fold to one line. On a phone "done" isn't a line of its own |
| m2 | Phone: 44 px links inside running text open gaps and split sentences: "R1 all done", Ready, 12 items, Biggest, the spikes, "Nobody is running" (`overview-390`, `day-helix-390`; Luigi's `project-bobnet-390`) | Keep the text's line height; grow the tap with `::after { inset: -12px 0 }`, as a project's row does. Biggest and spikes: one per row |
| m3 | A bar is 9.4 px wide on a phone at 30 days, so a tap often takes its neighbour; 30 tab stops a card (Luigi's Q4) | Spec changed (§2.9): ‹ › on the day line, arrows between bars, one tab stop |
| m4 | The aside's day line runs out of its card, the page 8 px too wide at 1024 (`project-dark-1024`); "Sonnet-equivalent tokens" does it with ordinary data | `.uday { grid-template-columns: minmax(0, 1fr) }`, and its links wrap |
| m5 | Phone: × drops to a row of its own, at the left, for a wide date ("Mon 16 Nov in detail"; "Fri 13 Nov" fits) (`day-helix-390`) | `.ud-h { flex-wrap: nowrap }`, the h3 `min-width: 0` and wrapping |
| m6 | Odd data: a spike's value is drawn over a taller bar beside it, orange on orange (`usage-1440`), or touches the next (`project-390`); axis "2k, 2k, 1k" (`usage-dark-1440`); 160 px of nothing with no tokens; "No calls" in 424 px (`day-empty-390`) | Leave a value out where it meets a taller bar; "1.5k" under 10k; §2.9's words for none; a short frame |
| m7 | A long project name runs over RELEASE on desktop (`overview-many-1440`); a phone's CI puts a long workflow and its branch in two thin columns (`ci-390`) | `.pname a { overflow-wrap: anywhere }`; the name and branch in one span of `.ci-wf` |
| m8 | A quiet laptop: every **ended** run says "@mbp-1 · no report 14 min" in warn, for 14 days back, and squeezes the role to 5 letters (`project-quiet-1024`) | The mark on running runs only (§2.3) |
| m9 | A project's page with `usage` failed: no reason, no Retry, and the running runs read "not weighed" (`project-usagedown-390`) | The read's message and Retry in the card |
| m10 | The kind words, 12 px in their colour: review 2.8:1, design 3.2:1, retro 2.2:1 (build 4.4) | The word in `--text`, a small square in the colour before it. The feature page has the same |
| m11 | Total's graph is called "Context per call" and goes to 126M: it is summed. Only the tip says so (`day-helix-390`) | Caption "Context, summed call by call" (§2.9) |
| m12 | Phone, the board down: the project heads touch the card's edge and the line above (`first-down-390`): their padding is 0 for a 44 px link that isn't there | Padding back for a head without a link |

## Questions

- **Peach, AC3 on a phone:** with a full Needs you, the first screen says nothing of who runs or CI. A second row in the Status line's card,
  ≤600 px only, "4 running · CI failed on BobNet" (each half jumps to its section), would fix it for 44 px. It isn't in the prototype, so
  I haven't put it in the spec. I'd build it with m1 (build E).
- **Luigi's 1** (All features): fine to wait for BOB-185. **His 4:** m3.
- **Usage with a quiet laptop:** "today so far" is silently short. Its words could be "today so far 36.0M, mbp-1's as of 14h ago". Build E, or not at all.

## Spec changes in this land

From review D: §2.3 order on a phone, consults, ended runs (m1, m8); §2.4 the name column; §2.9 the median (M1), no tokens, one tab
stop and ‹ › (m3), Total's caption (m11), the no-calls frame. Older: §2.1 and §2.2 as built in build C and its fixes (Deny only on a question,
orphans, "stops for good", links last), §2.4 queued and cancelled words in `--muted`, §2.11 "Take admin away".
