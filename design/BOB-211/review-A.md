# BOB-211 build A: design review

Daisy, 2026-11-26. This review checks v2 059ad55, 57acfca and a818b81 against `spec.md` (with §7's rulings, and the
prototype Casper approved in Q-17) and against the criteria of BOB-215 to BOB-221.

**Result: 0 blockers, 1 major, 2 minors.** The build matches the prototype closely at 390, 1024 and 1440, and in dark.
That covers the parts and their shades, the tip, the day line's list, the panel's head, meta and spend chart, the
picker, All agents and one agent with its band and resets, the running state, and Sonnet-equivalent. Tokens only. The
major is one line of the tip, which can state a wrong whole-session figure.

## How I checked

- **Shots:** I compared Luigi's 33 shots (`packages/broker/test-ui/shots/bob211-*`) with mine
  (`design/BOB-211/shots/`), shot by shot. I looked closely at 01, 02, 03, 04, 06, 07, 08, 09, 10 and 11, across the
  three widths and dark. No shot is missing a state, so I didn't re-run the script.
- **Tests:** `test-ui/usage-sessions.test.ts` and `test-ui/usage.test.ts` pass, 54 of 54 (vitest, UI config). Between
  them they cover:
  - keyboard: Up/Down through the parts, Enter on a session's part or on the rest, Escape closing the panel and then
    the day, × focusing the row, and focus on × at open;
  - the link and its encoding, and 30 → 14 days closing both;
  - one read per session, the lost-run, failed and older-broker states;
  - no "$", "USD", "cost" or "price" in the panel.
- **AC5:** `usage.test.ts` changes only the "Biggest:" expectations, which are now §2.2's list. Its feature-page hrefs
  went too, because that link moved into the panel (§2.2). The spike labels, median, spikes, today's look and the day's
  detail are unchanged. Hiding a spike label that collides with another on a phone is BOB-121's own code, not a change.
- **CSS:** `proto.css` against the `style.css` diff. Every rule is ported, `--ag-1..6` light and dark included, and
  `.proto-asis` is left out. The phone block makes these ≥44 px: rows, ×, picker, the panel head's link and the foot
  link.

## Major

### M1. The tip's "Whole session" can be wrong before the feature is read

- **Where:** `partTip` → `wholeSession` (`packages/broker/public/app.js`, about lines 3345-3372). Shot
  `bob211-06-review-e-from-its-bar-on-23-nov-1440.png`.
- **What:** pointing at review E's part on 25 Nov, the build's tip says "Whole session: 13.2M · ran 25–26 Nov,
  2 days". The session is 15.9M and ran 23–26 Nov, 3 days: the prototype's shot 06 says that, and so does the panel's
  own head. Before the feature is read, the build adds up the session's entries in each day's `top`. A day where the
  session's share is too small for that day's top 6 drops out of both the figure and the dates. On real data this is
  common: a long review's small share on its first day, or on any busy day, is usually outside the top 6. The tip then
  states a lower figure as the whole session, which is exactly what Casper's first question ("what is the build
  session") relies on. Luigi flagged the risk in his handoff. My spec assumed the runs' sum (§3), which only the
  feature read gives, and Toad ruled that read is never prefetched.
- **Fix:** don't call the partial sum "Whole session".
  - Before the read, the line says "Named on 25–26 Nov: 13.2M · click for the whole session". It lists only the
    days the bars name, with no "N days" count.
  - Once the feature is read (it's kept per feature, so after the first open), the line says "Whole session: 15.9M ·
    ran 23–26 Nov, 3 days" from the runs, as now.
  - This keeps the no-prefetch rule.
  - **Test:** a session missing from one day's `top` gives the "Named on" line before the read and "Whole session"
    with the runs' sum after it.

## Minors

### m1. On a tablet (touch), the day line's session rows and the panel's × are 32 px

- **Where:** `.u-s` (`min-height: 32px`) and `.ud-x` in `style.css`. The 44 px rule is inside `@media
  (max-width: 600px)` only. Shots `bob211-01-…-1024.png` and `bob211-03-…-1024.png`.
- **What:** at 1024 the bar is one touch target and the rows are how you open a session, but each row is a single
  32 px line. The spec asked for ≥44 px only "on a phone" (§2.5, §2.7), which is a gap in my spec. The seg switches can
  stay at 32 px, as the spec says.
- **Fix:** add `@media (pointer: coarse) { .u-s, .sp-h .ud-x { min-height: 44px; } .sp-h .ud-x { min-width: 44px; } }`.
  The row layout stays the same: one line, just taller.

### m2. On a phone, the panel's head wraps the session's label

- **Where:** `.sp-h h3` at ≤600 px. Shot `bob211-07-running-session-today-390.png`.
- **What:** "BOB-211 design A" breaks into "BOB-211 design" and then "A" on the next line, beside "running" and ×. In
  the prototype it fits on one line. The likely cause is that the build's `.sp-h h3 .id` is now `inline-flex;
  min-height: 44px` with `margin-right: 5px`.
- **Fix:** keep the kind and label together (`white-space: nowrap` on the label span) so the line breaks before
  "running", not inside the name. Check 07-390 and 10-390 again.

## Not findings

- **The picked bar is one outline over the whole bar, not one per part:** fine. It reads the same, and BOB-121's `.b`
  test stays as it was.
- **Agent colours can change when Sonnet-equivalent re-orders the agents:** the prototype does the same, so this is
  as designed.
- **A tip can cover the bars next to the one you point at (01 and 06 at 1440):** the spec only says not over the bar
  itself, and the prototype is the same.
- **A running session's earlier days don't show on the bar while it runs:** in shot 10, LAND-50 Fixes ran "Wed 25 Nov
  08:00 – now", 31.7M. Today's bar names 17.5M of it, but 25 Nov has no LAND-50 part. The prototype's 10 drew one.
  This is `usageSoFar` (BOB-172), which adds a running run only to today; it is not new in BOB-211. The panel is
  right: whole session 31.7M, and "Thu 26 Nov: 17.5M of it". When the runs end, 25 Nov gets its share. If Casper wants
  that share drawn while the run is still going, it is a backlog item for Peach (a store change, so Toad's call), not a
  fix for this build.
- **The day detail's Total / By agent switch is 32 px on a phone** (Luigi's open question): this is BOB-121's own
  state, which BOB-211 doesn't change. I'd leave it.

## Criteria (my view, for Peach)

- **BOB-215, BOB-217, BOB-218, BOB-219, BOB-220 and BOB-221:** shown by the tests and shots named in Luigi's handoff.
- **BOB-216 AC1:** holds once M1 is fixed. The tip's "whole session" has to be the whole session.
- **m1 and m2:** neither blocks a criterion.
