# BOB-189 review A: the screen half (R6, b7ec467)

Daisy, 2026-11-22. What I checked: `packages/broker/public/app.js` and `style.css` in b7ec467, Luigi's shots
(`shots-build/`, 390 and 1440) and my own run of his script at 390, **1024** and 1440 (`shots-review/`; his
script took no tablet width), read view and Edit your gates. Against: the dashboard's look (`style.css`), BOB-189
AC5, and BOB-121's Roadmap (`design/BOB-121/spec.md` §2.6).

## Verdict: pass

No blockers, no majors. AC5 holds on the screen: a planned release has its own badge and its goal, a closed one
reads "closed · closed <date>", folds its features, and an empty closed one says "Closed, with no features". Edit
your gates gives a closed release Reopen where Close was. Nothing new borrows another look: the badge, the goal line
and Reopen are the badge, `.muted`-type text and plain button the dashboard already has. All three widths hold: the
heads wrap, the gate buttons take their own row on the phone, no overflow.

It doesn't fight BOB-121: §2.6 keeps the release heads "as today", and the head is where all of R6 lives (badge,
goal line under it, Reopen in the gate). §2.6 is amended to say so (below), so the redesign keeps them.

## Findings

### m1 (minor) planned and closed look alike
Both are a grey outlined pill: planned `--idle` (#8a8983), closed `--muted`; side by side (R3, R4 in the shots) only
the word tells them apart. Planned is "not started yet", like a draft feature, which already has a dashed border.
Fix: `.badge[data-state="planned"] { color: var(--idle); border-style: dashed; }`.

### m2 (minor) on a phone, behind Edit your gates, the goal sits under the buttons
At 390 the gate wraps onto its own row inside `.rel-h`, so the order is title, counts, Earlier/Later/Close, then the
goal (`shots-review/roadmap-edit-390.png`, R2 and R3). The goal belongs to the title. Fix: render `.rel-goal` before
the gate on narrow screens (e.g. put the goal in the head before `.gate` with `flex-basis: 100%`, or `order` it in
the ≤600px block). Read view and wider widths are fine as built.

### m3 (minor) the banner's wording
"…close or reopen a release: yours, and Picard's. Changes save as you make them, each with Undo, …" reads as if only
reopen were shared, and Reopen has no Undo (by design). Words to use:

> Move a feature into or out of a release, change the order of releases, close or reopen a release: these gates
> are yours and Picard's. Changes save as you make them and go in the board's history as yours; each has Undo but a
> reopen (close it again instead). Anything else is a request to Picard.

The footnote's "the order of releases is yours, and Picard's" → "the order of releases is yours and Picard's"
(no comma).

### m4 (minor, not R6's code; for Toad) the current release can land on a planned one
`currentRelease` (store.ts ~677): when no release before has open work, it takes "the last that isn't closed".
With planned releases that is the last planned one (Helix's Later), not the done release waiting for its close. So
when Helix's R2 is all done and R3–Later are planned and empty, the Overview and BOB-121's CURRENT tag would point at
Later. Suggest: "else the last that isn't closed and isn't planned, else none" (a question for Toad; ADR 0014 §4).

## Notes
- AC1 says "idea"; the screen says "planned" (the stored status). That is Peach's open question from Luigi's
  handoff, not a screen finding; the word on screen stays "planned" whatever the AC says.
- Luigi's shots cover phone and desktop as AC5 asks; tablet is in `shots-review/`.
