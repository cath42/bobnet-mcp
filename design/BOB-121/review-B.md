# BOB-121 review B: on screen (BOB-193; BOB-172 as plumbing)

Daisy, 2026-11-23. Reviewed: `packages/broker/public` from 07cdc3b to 0a7df68 (BOB-172 at 77d95b8, BOB-193 at
0a7df68; the CSS change is BOB-193's). Against BOB-193's criteria and ADR 0012 §2. Spec §2.0's amendments of 57b32b2
start at build C and weren't applied here.

## Verdict: pass. 0 blockers, 0 majors, 4 minors

A board of a project the service doesn't have is drawn nowhere, the listed projects (athletic with no release
included) are all there, and nothing else on the page moved. The minors can go with build C.

## How I checked

`shots-review-B/shots.mjs` runs both versions of the page (07cdc3b and 0a7df68) on the same data with the clock
frozen, at 390, 1024 and 1440. Test data: service projects BobNet, Helix and athletic (22 features, no release, no
laptop's board); laptop boards of alexa-mcp and sandbox, the most recent of all, with failed CI, a session, runs and a
backlog. 168 shots per version; no page error and no sideways overflow in any. I read the pictures named below and
compared the rest by pixel and by what each page says. The kept pictures are `before-*` and `after-*`.

| What | 390, 1024, 1440 |
|---|---|
| Overview: rows, CI lines, header's picker | Before: sandbox and alexa-mcp in all three, sandbox picked first. After: bobnet, helix, athletic; no CI line of theirs; bobnet picked (`*-retired-overview-*`) |
| Status, cards and count | 5 cards before, 3 after, "Projects 3" (`*-retired-status-*`). #status/sandbox: "No project sandbox on BobNet, or you can't read its board." |
| Pickers of Waits, Roadmap, Triage, Capture | BobNet, Helix, athletic, as before (they read the service's list) |
| Roadmap, Feature, Usage, Sessions, Rules | No text of either, where the first three opened on sandbox's board before. Sessions keeps the feed ("Writer sandbox haiku written"), as the criterion says |
| athletic | Overview row "no open release", Status card, all pickers, "athletic has no releases yet. Its PO makes the first one." |
| A live worker and its request in sandbox | Kept on Overview, Waits and Status (`after-live-overview-*`) |
| The retired boards' effect on the new page | None: the 12 views × 3 widths with them and without them are the same picture (33 byte for byte, 3 differ by 1 level of 255 in under 50 px) |
| List not read yet | "Reading the board…" on every page, no picker, no board (`after-reading-overview-390`) |
| First read failed | "Board unavailable" on Overview, Waits, Status, Roadmap, Feature, Triage, Usage, Rules; no legacy row (`after-down-*`). Read again by the page itself after a minute: banner gone, rows back (run on the page's own clock) |
| Re-read failed | The last list stays, everything drawn as before (`after-reread-overview-*`) |

**Nothing else changed.**
- Without the retired boards, 14 pages × 3 widths before against after: 38 of 42 byte for byte the same, 1 differs by 1
  level of 255 in 18 px. The other 3 are `#usage?weigh=1`, which was an unknown page (Overview) and is now Usage,
  as BOB-172 means; raw figures, no toggle drawn.
- The repo's own five scripts on both versions (190 shots): 181 the same. Of the 9 others, 8 also differ
  between two runs of the same version. The last (`bob5-ci-line-390`) differs only in where its script scrolls to:
  the old page drew a legacy row for BobNet before the list was read, which is the flash this removes.
- Removed styles: `.prow .pc.legacy` and `.pcard.old` have no user left in `app.js`. Dropping `:not(.legacy)` lowers
  two phone selectors' weight and nothing overrides them: the project rows at 390 are unchanged.
- BOB-172: `#sessions`, `#sessions/helix` and `#waits` still open today's pages; no new control. Plumbing only: yes.

## Findings

### m1 (minor) after a failed first read, Needs you and Waits still say "Reading the board…"
Overview says "Board unavailable", and Projects says "couldn't be read", but Needs you keeps "Reading the board…" under
the same banner (`after-down-overview-390`, `-1440`); Waits does too, with "0 items, oldest first" above it
(`after-down-waits-390`). Both were so before; BOB-193 fixed only Projects. "0 items" is the worse half: it
isn't known. Fix: with `boardError()` set and no `ov.waits`, both say "What waits on you couldn't be read." and Waits
leaves its count line out. Build C replaces Waits with Needs you (BOB-175): take it there.

### m2 (minor) when only the list's read fails, what waits on Casper isn't read for up to a minute
Before, Overview and Waits read the overview and the waits whether the list came or not. Now both wait for
`svc.projects` (`app.js:1336`, `:1796`), so a list read that fails alone leaves Needs you, the Waits count and the
project rows blank until the minute's retry, while Status reads fine (`after-listdown-overview-1440`). The case is rare
(one database answers both), and the page says it is down, so it is a minor. Fix: when the first list read fails, read
`overview` and `waits` anyway, and draw the rows they give (they are the service's).

### m3 (minor) the project's key stands in for its name while the list is missing
With the list unread, Working now says "bobnet › BOB-121" instead of "BobNet" (`after-down-overview-1440`). It is
right to keep the worker. Nothing to fix unless m2 is taken, which gives the names too (`overview` has the projects).

### m4 (minor) a stale comment
`style.css:799` still names "a muted old-board card". Remove those words.

## Notes, not findings

- Picking athletic in the header on Usage or Feature falls back to BobNet, since it has no laptop's board. The same
  before this change; build D's Usage reads the service.
- After the deploy, BOB-193's live evidence is still to take (c1, c3): not a screen check.
