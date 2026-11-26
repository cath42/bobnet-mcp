# BOB-202 c5: tap targets at 390 px, re-checked (Daisy, 2026-11-26)

Review E's `shots.mjs` (same checks: taps under 44 px in `#view`, contrast under 4.5:1, sideways overflow, cut text), run on v2 at
b497ec1 (my branch rebased onto it, 69 scenes). Log: `shots-c5/checks.log`. Luigi's handoff: `w_d92e958d.md`.

## c5 is met for what review E named (m3, m22)

| Tap (review E) | Was | Now |
|---|---|---|
| Project switch (BobNet, Helix) | 32 | **fixed** (not listed) |
| Status 24 h / A week | 40 | **fixed** |
| Edit your gates, Done | 36 | **fixed** |
| Close R1, Reopen, Close release | 40 | **fixed** |
| ↑ Earlier / ↓ Later | 40 | **fixed** |
| Features' filters (All, Open now, Ready, Draft, Done) | 32 | **fixed**, on one row |
| "6 done (…)" fold, Settled since (summary) | 30 / 18 | **fixed** |
| History, the span bar, On it now's agent buttons | – | **fixed** |
| Header BobNet and + Capture | 32 | **fixed** (not listed) |

## Still under 44 px at 390 (none was on m22's list)

| Tap | Size | Verdict |
|---|---|---|
| Status `span.l-t` (a row's title, whole row is the tap) | 336×39 | minor for BOB-204: 5 px short, a row padding change |
| Roadmap `select.move` (move a feature to another release) | 164×26 | minor for BOB-204: shown only in edit mode, but a select 26 px high is the hardest to hit |
| Features `input.find` | 366×40 | minor for BOB-204: 4 px short |
| Feature page: `div.a-btn` (a task's agent line) | 310×22 | minor for BOB-204: Luigi saw it; 22 px |
| `a.id` refs (BOB-121 …), `a. "R2"`, "2 backlog items", "All projects", "Helix's roadmap" | 15–20 high | allowed: inline links in text, as the handoff says. Features' list `a.id` is 320×20 but the whole row is the tap; not a minor |

## New, found by this run

- **`p.thin` "Thin: fewer than 2 Ready" is 3.8:1 in light** (status-bobnet, all widths). `--warn` on its own 10% warn tint. m19 raised
  `--warn` to 5:1 on `--bg`, but this line sits on a tint. Minor for BOB-204: tint 6% or use `--text`. (Review E's run did not show it.)
- Luigi's open item, the light **open badge at 4.15:1** (`--ok` on its 10% tint): my review didn't flag it. Same fix class as above:
  a darker `--ok` for the badge text in light, to 4.5:1. Minor for BOB-204.

## Unchanged from review E, not c5

`over` (sideways overflow count) on roadmap-long-390 (585), features-60-390 (388), features-60-done-390 (377), features-360 (417):
the same figures as review E; the scenes are 60 features and a long roadmap, and the page does not scroll sideways. Not a regression.

**c5: met.** Every tap m3 and m22 named is 44 px or more. Four small taps and two contrast lines go to BOB-204 (Draft, later).
