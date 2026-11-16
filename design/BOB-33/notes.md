# BOB-33: the Status tab, prototype notes for Casper

Daisy, 2026-11-16. From `product/requirements/project-status.md` (24349f1) and Casper's answers: Q-2 tab,
Q-3 last visit with widen chips and "I'm caught up", Q-4 all six sections, Q-5 the lead's note.

**Open it:** `design/BOB-33/prototype/index.html` (works from the file). The bar at the top is the
prototype's: switch to a first visit, take the broker down, reset. **Shots:** `shots/`, each at 390, 1024 and
1440 (`node design/BOB-33/shots/take.mjs`): `s1-status-top` (the phone's first screen, no scrolling),
`s1-status` and `-dark` (all projects), `s2-helix` and `-dark`, `s2-helix-open` (phone with every section open),
`s3-bobnet` (an old lead's note), `s4-week` (widened), `s5-caught-up` (after the tap, with Undo),
`s6-first-visit`, `s7-overview-line`.

The data is shaped like BobNet's and Helix's boards. Refs, titles, agents and commits up to 6c523c5 are real;
the night's sessions, later commits and token counts are made up (`prototype/data.js`).

## Choices for you to accept or change

1. **Status is the third tab**, after Waits on you, so it's on the phone's first screen of tabs. A dot on it
   means something is new since your last visit.
2. **The top screen gives two answers**: *Needs you* (count, how many hold work up, the oldest) and *Is it
   going OK?* in one word: **Going OK** (nothing stuck), **Mostly OK** (something stuck, nothing failed),
   **Needs a look** (CI red, a land or a run failed). Below that is one card per project with the same
   answers and the first lines of the lead's note.
3. **"Done" counts closed sessions.** Overnight, a feature reaching Done is rare, so counting features would
   often read "0 done". The section shows features Done, sessions, lands and deploys separately.
4. **Each section says what it looks at:** *since 23:10* (What got done, Usage), *open now* (Needs you,
   What's stuck: they stay until settled, and anything older than the span says "from before 23:10"),
   *last 4 weeks* (Recurring problems: a pattern needs history; it marks what came back in the span), and
   *now* (Backlog health).
5. **I'm caught up is one per device, for every project**, and it's only on All projects: at the top on a
   tablet or desktop, at the end of the page on a phone (after you've read it). It shows a toast with
   **Undo**, because a stray tap would lose the list. Widening to 24 h or a week doesn't move your last visit.
6. **The lead's note is above the facts.** It turns amber with "3 things happened since" when newer facts
   follow it (BobNet's sample).
7. **On a phone the sections are folded** to a headline you can read without opening: count, what kind,
   coloured edge. From 700 px they open, in two columns from 1100 px.
8. **Stuck shows what settled**, folded ("Settled since 23:10: 1"), so a run that broke and was restarted
   overnight isn't lost.
9. **A recurring retro finding links to its backlog item**, or says "No backlog item for it yet" (BobNet's
   stale-tip finding links to BOB-11, which is Ready and in no release).
10. **The Overview gets one line at the top**: "Since 23:10 (7 h ago): 11 done, 4 stuck, CI red on Helix ·
    Status ›", with its edge coloured like the verdict.
11. **Answering stays on Waits on you.** A Needs you line opens it there.

## Unfinished (wrapped up early, on Mario's word)

- No spec.md for Luigi yet: these notes plus the prototype stand in until Casper has reacted.
- Not covered: loading and error states beyond "broker down", and a project with a thousand items (lists
  cut at 5 sessions or 4 lands, then "Show all").
- I haven't checked every shot by eye, only `s1-status-top-390` and `s2-helix-1440`.

## Open questions

- Peach: "Done" as closed sessions (3); recurring over 4 weeks (4); one I'm caught up for all projects (5).
- Toad's rulings (ADR 0005, architecture/reviews/2026-11-15-bob33-status-rulings.md, f9fa9ef) arrived as I wrapped
  up. The prototype disagrees with them in two places, to fix next: it **lists lands** (the ruling: a count only)
  and **shows deploys** (not shown; BOB-41). Also still to add: "tokens unknown" for lost runs in Usage, an
  "untagged" group in Recurring, and the 600-character limit on the lead's note.
- Is a project's lead the right person to see "Is it going OK?" computed this way, or only Casper?
