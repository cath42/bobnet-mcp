# BOB-1: release 1's prototype, for Casper's verdict

Mario, 2026-11-13 (night; parked for Casper's morning). Built by Daisy (BOB-1.1), on v2 at 6f44ed1.

## Open it

`open ~/Code/bobnet-mcp-mario/design/BOB-1/prototype/index.html` (any v2 checkout works: it loads the real
`packages/broker/public/style.css` by relative path; no server). Tabs: Overview, Waits on you, Roadmap,
Feature (LAND-49), Triage, and + Capture. Gates: "Edit your gates" on the roadmap.

Screenshots at phone 390, tablet 1024 and desktop 1440: `design/BOB-1/shots/` (named by BOB-1 criterion:
c1-roadmap, c2-feature-land-49, c3-waits, c7-capture, c8-gates, c9-triage-bugs, ...).

## Read first

- `design/BOB-1/notes.md`: 27 design decisions the requirements left open (steps view as a vertical
  chain with the next step as banner and last link; what folds at phone width; gates behind "Edit your gates"
  with Undo; Waits on you in two groups, "Holds work up" and "When you have time"). Accept or correct each.
- `design/BOB-1/spec.md`: the screens, for Luigi once you accept.

## What it covers (BOB-1 acceptance criteria)

#1 roadmap, #2 a feature's sessions and steps, #3 waits on Casper with its count, #4 Helix's real board
(helix-navigator-picard 282cca2fe: 698 tasks, 103 drafts, 29 features; named on every screen), #5 BobNet's
look on phone and tablet, #7 capture and triage, #8 your gates (release scope, release order, close),
#9 bugs and your open questions. #6 is yours: your words go verbatim in BOB-1's notes (Peach records them).

## Mario's review

Checked the land (design/ and five requirement edits from Peach only; nothing in packages/, so no release
or restart), every criterion has shots at three widths, and I looked at the LAND-49 feature on a phone and
Waits on you on a desktop. One nit for the round after your verdict: on Waits on you, A-15 says "Holds up
the demo" but sits under "When you have time".

## Open points (Daisy's, notes.md), for you or for later

1. Session outcomes have no source today: LAND-49's six sessions are hand-transcribed; three have no close
   file. The steps view needs Toad's structured session close before it can be built.
2. "Open" isn't on Helix's board (LAND-49 says Ready after six sessions): the service has to keep it.
3. Helix rarely ticks criteria (LAND-22 Done at 3 of 138): criteria are a weak progress measure on today's
   data. Worth raising with Picard before Helix's move (BOB-9).
4. The blocks-use bug, the pending permission and session token counts are marked "example": no record exists.
5. Only mbp-1 is in the sample.
6. "Fixes" as its own session kind is still Peach's question (shown as a build labelled Fixes).

## After your verdict

Peach records your words (BOB-1 #6) and writes BOB-2..10's criteria; then Toad's ADR for the service
(BOB-2, BOB-7) before Luigi builds. Nothing is being built until then.
