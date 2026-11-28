# BOB-212 build B: review B, the screens

Daisy, 2026-11-28. Shots: `packages/broker/test-ui/shots/bob212-*.png` on v2 at `e269120` (1280, 390, and 1024 for
01-17 and 20), made by `test-ui/e2e-bob212.mjs` with the real vendored viewers under wrangler dev. Against
`design/BOB-212/spec.md` v6 and `design/BOB-212/review-A.md`. Casper's Q-23 (Liam ERD as is, menu A, no viewer of
ours) stands and isn't reopened here. I looked at each shot named below, and read `library.js` and `style.css`
where a shot didn't settle it.

**Verdict: passes, with no blockers or majors.** Review A's five fixes are all in. The architecture page (LikeC4 in
its frame, our bar over it) and the data model page (Liam as is, the count, Full screen, the hint, the source line)
read as §10 and §11 draw them at 1280, 1024 and 390, and so do their states. There are four minors. One of them,
Liam's font, is for Casper to see at the R3.1 gate.

## Per task

### BOB-243: text fixes and touch pills: **pass**

| Review A's fix | Shot | |
|---|---|---|
| 1. The deciders wrap | 05-decisions-1280 | Pass: "Otto, Wren and Ines" on two lines, nothing cut. |
| 2. One underline on "0002 Title" | 06-decision-1280, -1024 | Pass: "0002" plain, the title alone underlined. |
| 3. Touch chips keep the pill shape | 07-usecases-390 (and 09) | Pass: 28 px pills as at 1280 (review A's shot had round 44 px chips), and the e2e shows 45 px taps. |
| 4. No repeated title on the phone | 12-section-missing-390 | Pass: "Section: Glossary", then only "owner Wren", then the card. |

### BOB-234: the architecture page: **pass, one minor (shared with 235)**

- **03-architecture-1280 / -1024:** pass (§10). The rail folds into "Architecture ▾", with "owner Otto" after it.
  The crumb reads "Context", with "Level 1: the context" under it. On the right are ↑ Out (disabled at the
  context), the picker, Fit and Full screen. The frame takes the full width, and the source line "Model:
  library/architecture/ · LikeC4 · main at 149e7bc" sits under it.
- **03-architecture-390:** pass (§10 phone). The picker has a full-width row of its own. ↑ Out is on the left
  under it, with Fit and Full screen on the right. "Tap to explore" shows over the frame.
- **22-arch-drilled-1280 / -390:** pass. The crumb reads "Context › Toolshed › **API**" with "Level 3: the
  components of API". The picker shows "API: components" and ↑ Out is enabled. On the phone, "Done" appears while
  you explore.
- **23-arch-zoomed-390:** pass (the zoom stays inside the frame and the page doesn't move).
- **21-arch-loading-1280:** pass (§10 Drawing). It shows "Drawing the model…", "The first time on this device, the
  viewer downloads (2.5 MB).", grey lines, and a grey crumb. 2.5 MB is the real size; the spec's 2.4 was an
  estimate, and the build is right.
- **24-arch-error-1280 / -390:** pass (§10 "Errors, a model drawn"). The warn line reads "2 problems in the model:
  what they touch may be missing", with the lines at views.c4 line 31, over the drawn model. The shot shows it
  opened; the code draws it folded (`library.js:751`), as the spec says.
- **25-arch-no-answer-1280 / -390:** pass for the state (§10 "No answer in 15 s": the dashed card, "The viewer
  didn't answer within 15 seconds.", the files with their sizes, Try again at 44 px on the phone). See minors 2
  and 3.
- **26-arch-sections-1280:** pass (§5). The folded rail opens as a ~280 px menu under the title, with the current
  section marked by its accent edge.

### BOB-235: the data model page, Liam ERD as is: **pass, one minor for the gate**

- **27-data-1280 / 04-data-1024:** pass (§11.1). The page reads "Data model ▾" and "owner Otto". The bar has
  "9 tables" on the left and Full screen on the right, with nothing else. Liam sits in a bordered, rounded frame
  across the content width, with "Model: data-model.dbml · DBML · main at 149e7bc" under it and the "As of" line
  in the head.
- **27-data-390:** pass (§11.2). The bar is one row (the count and a 44 px Full screen), with "Pinch to zoom, tap a
  table for its columns." under it. The frame is full width and tall, and all 9 tables are drawn small, as Toad's
  spike showed.
- **28-data-table-1280:** pass (Liam's own side pane for `loan`: its note, columns and related tables).
- **28-data-full-1280 / -390:** pass (§11.1 Full screen). The bar and the frame fill the screen, and Close takes
  Full screen's place.
- **29-data-error-1280 / -390:** pass (§11.3 "The DBML has errors"). The card reads "This data model couldn't be
  drawn here." and "data-model.dbml line 51: Table 'sheds' does not exist in Schema 'public'". The file and Try
  again follow, and no frame is drawn.
- **Minor 1 (27, 28, 04-1024; §11.2):** Liam's text is drawn in **Times**, a serif. That covers "Liam ERD", the
  table names, the side pane, Export, Copy Link and "show Table Name". The frame's CSP refuses Liam's Google
  Fonts request (as the B4 test expects), and Liam's font stack has no sans fallback, so the browser falls back
  to its default serif. My spec said "its font is the system's", which was wrong. Next to our sans page this
  looks broken rather than "Liam's look". Two ways to fix it, without touching Liam's code or adding a stylesheet
  of ours: vendor Liam's own font files into the pack and let the frame's CSP allow `font-src 'self'`, or allow
  Google Fonts in that frame's CSP. Which one is Toad's call, or Casper's at the gate; I'd vendor it, so the
  frame makes no outside request.

### BOB-244: shots and the fail card: **pass**

- **02-overview-390:** pass (review A's retake). It shows the phone's overview: "Section: Overview", the tagline,
  "On this page · 5 sections", then Goals to Quality goals. "Reading…" no longer appears.
- **Workshop's own title (12, 13, 14, 30):** pass. The rail reads "WORKSHOP LIBRARY", and the home reads "Workshop"
  with "Benches and tools by the hour, in a shared workshop".
- **1024 (01-17, 20):** pass (§5 tablet). 01-home-1024 has the rail and 3 tiles across, and 06-decision-1024 has
  "On this page · 4 sections" folded under the head. The diagram states 21-29 have no 1024 shot; 03 and 04 cover
  the frame at that width, and that is enough.
- **GitHub links (30-github-home, -card, -data, at 1280 and 390):** pass. These links appear: the sha in the
  "As of" line, "line 2 ↗" and "line 21 ↗" in the problems, the paths, "library/ on GitHub ↗" in the rail, the
  card's path, the DBML error's "line 51 ↗", the fail card's file, and the source line's "data-model.dbml ↗".
- **The fail card's Try again on touch:** pass (25-390, 29-390: 44 px).

## Minors (none blocks R3.1)

1. **Liam's font falls back to Times** (27, 28, 04-1024). See BOB-235 above. Casper should see it at the gate.
2. **The fail card's file names use the browser's default monospace** (25, 29, 30-github-data). They come out in a
   Courier-like face, unlike every other path on the page. `.vf-fail .files code` (`style.css:1650`) sets a size
   but no `font-family`. Fix: give it the page's `ui-monospace, SFMono-Regular, Menlo, monospace` stack.
3. **"Its 3 files on GitHub at 149e7bc:" when there is no GitHub** (25, 29: the library has no repo, so the files
   aren't links). Fix (`library.js:618`): drop "on GitHub" when the library has no GitHub remote ("Its 3 files at
   149e7bc:").
4. **The header's project pill at 390** ("Toolshed ▾", "Workshop ▾" in every 390 shot) is a tall oval, the same
   44 px-on-a-short-pill problem as review A's fix 3. I missed it in review A, and build B didn't cause it. Fix:
   the same `::before` hit area as `.uc-links .chip-b`, with the pill at its normal height.

## Not checked here

- The live dashboard: an Access login blocks it here. The live check is Casper's at the R3.1 gate.
- Dark (§15), and the §13 states review A listed with no shot (first read, read failed, may be behind, last fetch
  failed). Neither belongs to build B.
