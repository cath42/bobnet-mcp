# BOB-121 review E: on screen (BOB-183, 184, 185, 186, 200; AC7, AC8, AC9, AC13)

Daisy, 2026-11-25. Reviewed: v2 ff466f9..421840e (Status, the Roadmap, Features, a feature's page, review D's minors), against
`spec.md` §2.5 to 2.8, the prototype and each task's criteria.

## Verdict: pass. 0 blockers, 0 majors, 25 minors; fix 7 of them before the deploy

The four pages are the design at 390, 1024 and 1440, light and dark, and the redesign holds together across views: the same
header, the same switch, "where it stands" in the same words on the Roadmap, Features and a feature's head, every feature id a
link to its page, every project to its own. What breaks the whole is small and is words: two clocks (m1), three wordings of a
session's findings (m9) and of an age (m15). None of it stops Casper using a page.

**Fix before the deploy** (each is a line or two): **m1, m2, m3, m5, m18, m19, m22**. The rest can follow in a minors pass.

## How I checked

Luigi's shots of build E (all of them), then 69 of my own (`shots-review-E/shots.mjs`, 37 scenes; 25 kept, the full output in
`shots-review-E/checks.log`): his scene "e" (BobNet's and Helix's boards as production has them) plus 60 features, an unbroken
title and release name, no releases, 28 criteria and the criteria box's own scroll, each read (features, releases, a feature)
failing alone, a board that never answers ("Reading the board…"), an unknown feature, seven projects, 360 px, dark. It prints
page errors, sideways scroll, contrast under 4.5:1 and taps under 44 px at phone width. No page error in any scene.

| Checked | Result |
|---|---|
| **AC7** Status | Opens; the digest and six sections on a project with work and one without (`status-bobnet-1440`, `status-helix-dark-390`); seven projects (`status-many-390`); "Reading the board…" while it reads (`status-slow-390`); a failed read with Retry (Luigi's `status-failed`). The marker moves only on its button (status.test.ts, "not on open, a change…"). **Production data (183 c1, c4) is unchecked**: that needs a signed-in look after the deploy |
| **AC8** Roadmap, a feature's page | A Done feature shows "done 16 Nov", no count (`roadmap-1024`); BOB-51 shape, Done with criteria open, reads "Done 24 Nov, with 3 criteria not ticked" and lists them (`feature-done-1024`); all ticked, no fold (Luigi's `feature-ticked`) |
| **AC9** Features | BobNet and Helix listed from the board; "BobNet has no feature yet." (`features-none-390`); "Helix has no draft feature. [Show all]"; a find with no match; a failed read with Retry (`features-failed-390`). Never "no backlog configured" |
| **AC13** | The feature page has each session, its runs, its outcome, Review evidence (`feature-open-1440`); the project page who ran (review D). No Sessions tab |
| BOB-200 (review D's minors) | All as ruled. **m10 on the feature page, light and dark**: a kind is in the text colour with its colour as a square before it (`feature-open-1440`, `feature-open-dark-390`), contrast clean |
| Sideways scroll | None, but with an unbroken release name (m20) |
| Contrast | All text over 4.5:1 but the draft and planned badges and "All done: waiting for your close" (m19) |
| Taps at 390 | m22. Inline ids (`a.id`, 15 to 20 px) are left: the row or title is the tap, as review D ruled |

**AC4, 5, 10, 14, 15, 16**: build E did not touch them. Its diff to `app.js` changes no Needs you, ask, note, toast or Triage
code (viewNeeds, viewTriage, the ask and the toast are not in it), and the Overview's row only reads its roadmap through
`roadmapsChanged()`. Reviews C and D's verdicts stand; AC5 on Helix's real board is after the deploy (179 c3), as review D said.

## Rulings on Luigi's questions

- The feature page's project picker gone: **yes**. The head's project link and the Features switch do its work.
- Close R1 outside Edit your gates: **yes**. The gate Casper keeps is the close, and it should be one tap; §2.6 now says so.
- "Any note" as "waits on you: Q-6": **yes**.
- Inline item links under 44 px outside m2's list: **may stay**, as above.
- The doubled "ready ready · 8 criteria" and "draft draft …" (badge, then words): **stays**. It is the prototype Casper approved.
- "draft" under an open badge: **no**, see m2; §2.6 now says an open feature reads as open whatever its status.

## Minors

Before the deploy: **bold**.

| | Finding | Where, fix |
|---|---|---|
| **m1** | **Two clocks.** Status and the Overview say 15:20; a project's page, the feature page ("22 Nov 09:02 PM – 23 Nov 03:02 AM") and "Answered today" use the browser's 12-hour time. The spec's times are 24-hour | `clock` (app.js:159): `hourCycle: "h23"`, and the feature page's dates through it |
| **m2** | **An open badge beside "draft · 5 of 11 criteria left"** (BOB-33, BOB-322 in my shots): the badge says open, the words say draft | `whereStands`: with a session open, the open words ("5 of 11 criteria left"), whatever the status. §2.6 |
| **m3** | **Phone Features: the filters wrap**: "Done 15" alone on a second row, the frame's gaps showing (`features-none-390`) | ≤520: buttons `flex: 1 1 auto`, 8 px padding, 44 px tall (with m22) |
| m4 | Phone Features: a one-line title sits in a 44 px box, so short rows gap (BOB-6, BOB-33) while two-line ones are tight | review D m2's `::after` way |
| **m5** | **Feature page, On it now: "build 2 ›" with nothing after it** for an agent with no task (Marvin, Picard) | viewServiceFeature: the › only before task refs |
| m6 | A running session's agents show three times: On it now, the session card's lines, its runs table (and once more under Tasks) | the prototype has the table only; drop the card's lines |
| m7 | Weighed, On it now says "15.8M tokens" raw beside the table's Sonnet-equivalent "so far" | weigh both, or say "raw" |
| m8 | Feature page on a phone: Handoff / Close / Context per call take two rows; the head's project link opens a gap above the title | spacing only |
| m9 | Words: the feature page "0 blockers · 0 majors", "moved 0 tasks"; a project's page "no findings"; Status "need none" | one wording: "no findings", and say "moved n tasks" only when n > 0 |
| m10 | Roadmap: "closed 2026-11-06" beside "done 16 Nov" | `releaseCount` (app.js:1180): `day()` |
| m11 | Roadmap desktop: State and Where it stands start at a different x in each release (`roadmap-1024`) | fixed column widths |
| m12 | Roadmap phone, Edit your gates: the release select is half width, 26 px tall and clipped; a Done row has no select there (desktop has it) | the select across the row, 44 px; `table.stack tr.done td:not(.keep)` |
| m13 | Status digest, Helix: Backlog health "OK" in amber with an amber edge, over "0 Ready features with criteria" (`status-helix-dark-390`) | OK only when it is; else "thin", as BobNet's says |
| m14 | Status, What's stuck: "BOB-33 BOB-33 design reqs is open…" (the ref twice); the "before 15:20" pill as wide as the time | app.js:2221 (sessName); `.rows time .before` inline |
| m15 | Status cards: "2 / 1 feature" sets DONE's figure off the row; ages read "oldest 4 d", "4 days", "20h 0m", "8h 0m", "3h 10m" in one list | `.pcard`; one age wording: "4 d", "20 h", "3 h 10 m" |
| m16 | Phone: "What's factored" loses its ▶ and reads as a link | `.factored > summary` |
| m17 | `.unticked .note` touches the last criterion | margin |
| **m18** | **Roadmap, its first read failed: "0 releases · 0 features" and "BobNet has no releases yet. Its PO makes the first one." under "Board unavailable"** (`roadmap-failed-390`). Untrue, the thing AC9 forbids on Features | with an error and nothing read, no counts and no empty box; the banner and Retry only |
| **m19** | **Contrast**: the draft and planned badges' words are 3.5:1 and 3.2:1 (light), 3.8:1 and 4.2:1 (dark); "All done: waiting for your close" 4.3:1. They are on every Roadmap and Features row now | badges' text `--muted`, the dashed edge keeps the meaning; the warn line 14 px semibold, or `--warn` a shade darker |
| m20 | An unbroken release name pushes the phone page 585 px wide (the Roadmap's head) and 388 px (the release in Features' rows) (`roadmap-long-390`, `features-60-390`). Titles break; release names don't | `overflow-wrap: anywhere` on `.rel-h b`, `.rel-goal`, `.counts-line` and the row's release |
| m21 | A feature's page whose read failed has no Retry and no way back (`feature-failed-390`); an unknown ref says "No feature LAND-999 in Helix." and nothing else (`feature-none-390`) | Retry as Features has it; "‹ Helix's features" on both |
| **m22** | **Taps at 390 under 44 px**: the project switch (32, Roadmap and Features), the filters (32), Edit your gates (36), a fold's "6 done (1–2, 7…)" (30), History (36), Status's 24 h / A week (40), "Settled since" and "Tasks it is on" (18) | ≤520: 44 px min-height on `.switch button`, `.filters button`, `.gates-btn`, `.fold button`, `.hist-btn`, the span bar, and the summaries' padding |
| m23 | Status digest: "What's stuck 0 · Nothing stuck" then, open, "Nothing stuck." again | the body empty, or say what was checked |
| m24 | "Every feature on Vitals's board" | "Vitals' board" (a name ending in s) |
| m25 | Feature page at ≥1100: the criteria box is sticky and scrolls on its own (28 criteria, `feature-28-aside-1440`); it works, but its head ("3 of 28 criteria met") scrolls out of it | keep the count on top of the box's scroll |

## Spec changes in this land

§2.6: an open feature's words are the open words whatever its status; Close is beside the release head, outside Edit your gates.

## Open questions

None for Casper. AC7's production check (183 c1, c4) and AC5 on Helix's real board are for after the deploy.
