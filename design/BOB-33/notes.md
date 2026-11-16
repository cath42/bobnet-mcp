# BOB-33: the Status tab, prototype notes for Casper

Daisy, 2026-11-15. From `product/requirements/project-status.md`, Casper's Q-2 to Q-5, and ADR 0005 with
Toad's rulings (`architecture/reviews/2026-11-15-bob33-status-rulings.md`).

**Open it:** `design/BOB-33/prototype/index.html` (works from the file). The bar at the top is the prototype's
own: first visit, broker down, and **Ships**: "BOB-33 only" shows the page before theme tags (BOB-35) and the
lead's note (BOB-36) arrive. The sample is shaped like BobNet's and Helix's boards; the night's events and token
counts are made up (`prototype/data.js`).

**Show first:** `shots/s1-status-390.png` (all projects on a phone), `shots/s2-helix-1440.png` (one project,
every section open), `shots/s3-bobnet-1024.png` (a lead's note that is out of date).

All shots, each at 390, 1024 and 1440 (`node design/BOB-33/shots/take.mjs`): `s1-status-top` (the phone's first
screen), `s1-status` and `-dark`, `s2-helix` and `-dark`, `s2-helix-open` (phone, all open), `s3-bobnet`,
`s4-week` (widened; shows an untagged finding), `s5-caught-up`, `s6-first-visit`, `s7-overview-line`,
`s8-bob33-only`.

## Choices for you to accept or change

1. **Status is the third tab**, after Waits on you. A dot on it means something is new since your last visit.
2. **Two answers on top:** *Needs you* (count, how many hold work up, the oldest) and *Is it going OK?* in one
   word: **Going OK**, **Mostly OK** (something stuck, nothing failed), **Needs a look** (CI red, a land or run
   failed). Then one card per project with the same answers and the start of the lead's note.
3. **"Done" counts closed sessions**, because overnight a feature reaching Done is rare. The section lists
   features Done, releases closed and sessions; **lands are only a count**, and **deploys aren't shown** (nothing
   records them yet; BOB-41).
4. **Each section says what it covers:** *since 23:10* (Done, Usage), *open now* (Needs you, Stuck: they stay
   until settled, older ones say "from before 23:10"), *now* (Backlog health), and Recurring: findings *since
   23:10*, marked "came back" when the theme was in 2 or more sessions in the last 30 days.
5. **One "I'm caught up" per device, for every project**, only on All projects (top on tablet and desktop, end of
   page on a phone), with **Undo**. Widening to 24 h or a week doesn't move it.
6. **The lead's note sits above the facts**, at most 600 characters. When newer facts follow it, it turns amber
   and says what: "4 things since: 4 sessions closed". On a phone a long note folds to five lines.
7. **On a phone the sections are folded** to a one-line headline; from 700 px they open, two columns from 1100 px.
8. **Stuck keeps what settled**, folded ("Settled since 23:10: 2"), so a run lost overnight and restarted shows.
9. **Recurring groups findings by theme** (one of sixteen), plus **untagged** for closes without one, which are
   never guessed. Until BOB-35 ships the section says "Comes with theme tags" (`s8-bob33-only`).
10. **Usage counts a run once, when it ends.** A run lost to a supervisor restart shows as "1 run unknown", never
    as zero. Runs still going are listed apart under *Running now*, "so far", and not in the total.
11. **The Overview gets one line**: "Since 23:10 (7 h ago): 11 done, 4 stuck, CI red on Helix · Status ›".
12. **Answering stays on Waits on you.** A Needs you line opens it there.

## Changed since the draft (bd936f6)

Aligned with ADR 0005: lands as a count, no deploys, untagged themes, tokens unknown, running runs apart, the
note's 600-character limit and its "N things since" (sessions closed, features Done, releases closed). Dropped:
a recurring retro finding linking to its backlog item (the board doesn't record that link).

## Open questions

- Peach: "done" as closed sessions (3); recurring as the span plus 30 days back (4, ADR 0005 §4, was 4 weeks in
  the draft); one I'm caught up for all projects (5).
- Before BOB-35, should Recurring hide instead of saying "Comes with theme tags"?
- Not covered yet: loading and error states beyond "broker down", and a list past 100 (the read's `more` count).

spec.md for Luigi follows once Casper has reacted.
