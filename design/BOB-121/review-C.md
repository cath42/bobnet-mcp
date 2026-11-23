# BOB-121 review C: on screen (BOB-174, 175, 176, 177, 178)

Daisy, 2026-11-23. Reviewed: v2 at 65f2f84, against `spec.md` (as amended in 57b32b2), the prototype, and each task's
criteria. Live evidence (176 c5's log lines, c6 on mbp-1's report) comes after the deploy and isn't judged here.

## Verdict: pass once M1 is fixed. 0 blockers, 1 major, 10 minors

The build is the design: the header, Needs you, the ask, the CI card and Laptops read as specified at all three widths, in
light and dark. M1 is the spec's mistake more than the build's, and so is its criterion (Peach). m1 is a few lines of CSS, and I'd put it
in the same fix.

## How I checked

Luigi's 77 shots (I opened the main ones of each task), then my own: `shots-review-C/shots.mjs`, 144 shots of 60 scenes on my data.
They cover unbroken words of 41 to 132 characters, 46 items, 7 projects, 4 laptops, 40 agents, one and two quiet laptops, the list / waits / overview /
every read failing, a failed re-read, the socket cut, an orphaned request, a 2,900-character command, every form open, and an
older supervisor. Widths 390, 1024, 1440 (some at 360 and 768), dark for the main views. The script prints counts, overflow,
tap targets and page errors: no page error. The pictures named below are in `shots-review-C/`.

| Checked | Result |
|---|---|
| A phone's first screen | Says what needs Casper: the count in the tab, "Needs you 8", "Holds work up 4" and its first three items whole with their buttons; with a quiet laptop, its banner, then the same (`first-overview-390`, `first-quiet-390`); with the board down, the banner and the live permission (`first-down-390`) |
| 174 header | Seven tabs on two rows at 390 and 360, no scroll, "· 2 laptops" drops; "1 quiet" in warn; Features lit on a feature, none on Laptops. |
| 174 old links | `#waits`, `#sessions`, `#sessions/helix` (toast), `#rules`, `#feature/BOB-121`, `#feature/%`, `#feature/%E0%A4%A`, `#feature`, `#now`: each where §2.0's build C column says, no error |
| 174 c6, Triage | The switch on Usage and the feature view is Roadmap's; Triage as prototyped |
| 175 | All of §2.11 at three widths; messages folded; the two dropped sections gone |
| 176 counts | Tab, Overview and switch agree in every scene; unread waits never read as 0 (the switch then shows no counts) |
| 176 c3 | Up to date / a quiet laptop left out / "Last updated" in warn, both for a failed re-read and a cut socket |
| 176 parts | Every row of §2.2's table is where it says, at 390, 1024 and 1440; item buttons and answer forms 44 px |
| 176 c5, c6, c7 | Both forms, the toasts (delivered, not delivered, refused), the rows without Undo; A-9's options as plain text (`needs-action-390`) |
| 177 | Folded to 2 / 3 lines, Show all whole, one row open, kept over a redraw; cut and older asks as specified (`ask-folded-390`) |
| 178 | The five statuses, dots 5 / 2 / none, no red on cancelled, no card with no CI (`ci-390`, `overview-dark-1024`) |
| Contrast | Needs you (light) and the Overview (both schemes): all text over 4.5:1 but m7 |

**Review B's minors, folded in:** Daisy m1 (couldn't be read, no count line), m2 (list alone fails: 8 items, names right), m3
("BobNet" from the overview) and m4 (the comment) are done. With *every* read failing the key still stands in for the name
("helix ›", `first-down-390`): nothing has the name then, so that is right. Toad's minor 1 (`oldLink`, `#rules`, `%`): done.

## Major

### M1 Allow on a worker's question never works, and the row says it does (BOB-177)
A question can't be allowed: `router.ts:129` refuses it ("is a question: answer it, or deny to let the worker proceed without
one"; `supervisor.test.ts:472`). But the row of a worker's AskUserQuestion has Allow as its primary button, 44 px on a phone, above "Today Allow and
Deny override the lead" (`ask-folded-390`). Every tap ends in an error toast. The button was there before; the sentence is
new, and the row is now the question's home. Spec §2.1 and BOB-177 c3 ask for both, so **the mistake is mine**, and Peach's
criterion needs a word. The Needs you form already leaves Allow out for a question.

Fix: for `kind: "question"`, draw **Deny** only. The line reads "Picking an option here is BOB-161, planned for later. Today its lead
answers it; Deny sends Marvin on without an answer." An approval keeps Allow and Deny. I'll put it in §2.1 when Peach has it.

## Minors

### m1 A long unbroken word pushes the page sideways, and the phone check can't see it
A 44-character tool name (`mcp__claude_ai_Google_Calendar__create_event`) in a question's option makes Needs you 19 px
wider than a phone, a 50-character URL 35 px; the other options are cut with it (`needs-question-realistic-390`; the extreme
in `needs-question-390`). The same in: an ask's option label (`ask-open-1024`), an opened edit's "holds: … → …" line, a CI
row's agent or workflow on desktop, where the words fall on "Run ↗" (`overview-1440`), a Laptops status. Fix:
`overflow-wrap: anywhere; min-width: 0` on `.opt-row > span`, `.ask .opts li > *`, `.edits li > *`, `.ci-st` and the status cell; `.opt-row`'s and
`.ask .opts li`'s columns `minmax(0, 1fr)`; `.ci-row`'s name column `minmax(9em, 45%)`. The option row is inherited, but it is how Casper answers.
**The evidence:** `shots-bob121.mjs` compares `scrollWidth` with `innerWidth`, and with `isMobile` the window grows with the
page, so "no overflow" at 390 was not measured. Compare with the viewport's own width.

### m2 New taps under 44 px on a phone
The connection pill 34 × 18 (the only way to Laptops on a good day); a CI workflow's name 11-26 × 16 ("ci", "e2e": the only
link to the run under 1100 px); "Answer it on Needs you →", "On Needs you →" and "Its context, …" 18 tall and stacked; "on Needs you →" on the
agent's row 16. Fix on ≤600 px: `min-height: 44px` with inline-flex on each; a CI row's whole first line as its link.
(The tabs' and switches' 32-34 px are as they were, and §3 allows the switches.)

### m3 An allowed permission stays up to 3 seconds, its button live
After `ok: true` the toast says "Allowed Howard's Bash" over the same item, still counted, until the laptop's next report
(`needs-allow-390`); a second tap gets "already answered". A board answer leaves at once. Fix: on `ok: true` leave the id out
of `livePending` until the report drops it.

### m4 A refused answer loses his note
The permission form closes when it is sent, so on `ok: false` ("r_5 is already answered", a laptop that just went) an 8 s
toast is all that is left of what he wrote. Fix: keep the form and its words, its buttons disabled, until the result; close on `ok: true`.

### m5 A long command is skipped when the form opens
"Allow or deny" opens the command whole, then puts the focus in the note: on a phone the page jumped 2,800 px past the
command, keyboard up. Fix: for a permission, don't focus the note; bring the item's top under the header.

### m6 "Unchanged for 2d 1h" beside "4 days"; said twice when a compact item is open
§2.2: under a day "3h 10m", then "2 days" (built: "2d 1h", "40h 0m" beside an age of "1 day"). `waitAge` already does it. And an
opened compact item shows "Unchanged for 3d 0h, nobody to ask" and "· unchanged 3 days": drop the short one while open. Its links also come before its
meta row; put them last (`status-tap-390`).

### m7 CI's idle words are hard to read
"cancelled 6h 57m ago" and "queued" in `--idle`: 3.5:1 in light, 3.8:1 in dark, at 13.5 px. My spec's. Keep the mark and dots in `--idle`, the
words in `--muted`. I'll change §2.4's tone column.

### m8 A tablet held upright: Capture alone on a second row
At 768 px the header puts + Capture by itself under the logo, left (`first-overview-768`). Fix: use the phone's order (Capture and
the pill on the first row, tabs on the second) up to 860 px.

### m9 The project switch doesn't wrap above 760 px
Needs you with 7 projects at 1024 is 84 px too wide (`needs-many-1024`). Three or four fit. Fix: `flex-wrap: wrap` on `.seg.projects` and
`.seg.filters` at every width.

### m10 Two alignments at 390
"Context per call" sits 13 px above the links beside it (`ask-folded-390`): `align-items: center` on its row. "What waits on
you couldn't be read." touches the line under it on the Overview (`first-down-390`): 8 px below it.

## Luigi's open question 1: an orphaned request, what should Casper see?

**My view: it stays on Needs you, saying that its worker stopped and that answering starts it again.** Peach rules.

- **It isn't stale.** Peach's word for stale is "shown but no longer true". After a restart Howard still can't go on without
  Casper's yes, and either answer resumes him (`answer(…, true, "dashboard")`).
- **Nobody else can give it.** It is human tier: the router refuses a lead's answer without Casper's own decision. With it gone, his phone
  says "Nothing needs you" while the one thing holding LAND-50 up is him, and the restart is exactly when he isn't at the desk.
- **The "worker running" rule hides nothing else.** With a supervisor that runs, an open request always has an active worker: a stop settles it
  (`router.ts:208-213`), and a settled one leaves the report. So a row in `pending` whose worker isn't active *is* an orphan, and the page
  can tell with no new field (Toad to confirm). The other two rules (report under 3 minutes, request under a day) stay.
- **When it really is moot it should go:** if the lead has started someone new on that role since (a worker of the same
  project and role, started after this one ended), don't show it: an Allow would start a second one. `resumed by a later worker` already expires in
  the supervisor; this is the fresh-spawn case.
- **Only a human-tier one.** An orchestrator-tier orphan is its lead's: told at the restart, in `list_requests`, as today.

On screen, in **Holds work up**, counted, oldest first, the same `li.need`:

| Part | Reads |
|---|---|
| Badge, text, age, command | as any permission: `permission` · **Howard wants Bash:** `pnpm exec …` · 14m |
| Meta | `Helix › LAND-50 · stopped by a restart 5m ago · on mbp-1` (warn; from the worker's `ended_at`), no live dot, no "holds up" |
| Button | Allow or deny |
| Form's foot | "Howard stopped when mbp-1 restarted. Allow or Deny starts it again, with your decision and your note. It can't be taken back." |
| Toast | "Allowed Howard's Bash; it starts again on mbp-1." · with a note: "…, with your note." · Deny the same |
| Freshness line | "An item leaves when it's answered or its worker stops for good." |
| Working now | no row for Howard (it isn't running) |

To do nothing he leaves it: it goes after a day, or when its lead dismisses it. If Peach says no, the least is a line in Needs you's foot,
"1 request from before mbp-1's restart is with Picard", so the page never says nothing needs him when something does.

It is one condition in `livePending`, the meta, the foot and the toast: worth doing before the deploy, since without it build C takes away what Waits
on you does today.

## Notes, not findings

- Opening an item on Status in place (it was a link) is better than the spec; "Show all" as the text itself works by tap, Enter and Space.
- BOB-179's parts (1.15fr, Working now by project, the CI pill on a project) are not in C and weren't judged.
- `today 12:38 PM` beside `Since 06:43`: two clocks, as before. For BOB-179.
