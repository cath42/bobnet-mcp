# BOB-212 build A: review A, the screens

Daisy, 2026-11-28. Shots: `packages/broker/test-ui/shots/bob212-*.png` on v2 at `b733241` (made by
`test-ui/e2e-bob212.mjs`: Toolshed, Vitals and Workshop through the supervisor's sync, the broker and the page). Against
`design/BOB-212/spec.md` v6 (Casper's Q-23: Liam as is, menu A). I opened and looked at each of the 39 images.

**Verdict: passes, with no blockers or majors.** The library reads as the spec draws it at 1280 and 390: the menu
(A), Work · Library, the rail, the seven tiles, the cards, the glossary, problems, a section not written, and a
project with no library. Three minors to fix, and one shot to retake. The diagrams (Architecture, Data model) are
build B, so A shows a stand-in card. I accept that for A; see 03 and 04.

## Per shot

| Shot | 1280 | 390 |
|---|---|---|
| 01 home | Pass (§6: head, 4 across, tags, status counts, owner, "changed", the line under the tiles). | Pass (§5 phone: "Section: Home"; one column). |
| 02 overview | Pass (§12: lede, meta, headings, "On this page" with In/Out nested). | **Minor, retake.** Taken while the section still read "Reading…": the phone's overview isn't shown. Fix in `e2e-bob212.mjs`: wait for `.doc` (as 19 does for its diagram), not `.lib`. |
| 03 architecture | Pass for build A: a stand-in dashed card, "The model isn't drawn here yet", its files, the source line (§10 under the frame). Not a spec state. It goes when B4 lands. §5's folded rail on a diagram page comes with the frame in B, not now. | Pass, the same. |
| 04 data | Pass for build A, as 03. The source line already reads as §11.1 item 4: "Model: data-model.dbml · DBML · main at c75253e". When B lands, §11.1-11.3 apply: the bar (count, Full screen), Liam's frame, and the phone hint. | Pass, the same. |
| 05 decisions | **Minor (§9.1).** The deciders column cuts "Otto, Wren a…". Fix: let the last column wrap to two lines, or give it the width the date column doesn't need. The rest passes: the bar, the pills, "superseded by 0003", newest first. | Pass (§9.1: two lines a row, no deciders). |
| 06 decision | Pass (§9.1: head box two across, Supersedes linked, meta, headings). **Minor (§9.1, also 08, 10, 19):** the link "0002  Reminders go by email" underlines the gap between the number and the title. Fix: one underline, the gap outside the link's underline (or a single space inside one text run). | Pass (the head box stacks; "On this page · 4 sections" folded). |
| 07 use cases | Pass (§9.2: the cards, Actor and Goal, "Its flow ›", UX chips). | Pass. **Minor (§9.2, also 09):** at 44 px on touch the short chips ("UX 0002", "0002") come out nearly round. Fix: keep the 44 px tap height but draw the pill at its normal height inside it (padding or a ::before hit area), so they read as the same pills as at 1280. |
| 08 use case | Pass (§9.2: head box order, Given/when/then semibold). | Pass. |
| 09 UX design | Pass (§9.3: feature in accent, "Waiting on a verdict" warn, the verdict quote and date, The card, Prototype ↗). | Pass, with 07's chip minor. |
| 10 UX card | Pass (§9.3: head box, nested headings in "On this page"). | Pass. |
| 11 glossary | Pass (§12: find and count, letters, "also return", the marked term with its fill and edge). | Pass (44 px letters wrap to a second row; fine). |
| 12 section missing | Pass (§7: the dashed card, the owner in brackets, the rail's muted "not written yet · product owner"). The rail's head reads "TOOLSHED LIBRARY" on Workshop: that is right by the build (the library's own `title`), but see the fixture note below. | **Minor (§5 phone):** the title "Glossary" is repeated under the section button; §5 says only the owner line shows there. Fix: hide the section title at ≤760 here as on the written sections (01-11 already do). |
| 13 problems | Pass (§8: "3 problems" on the as-of line, "Decisions 2" on the rail, "2 problems" on the tile, the open warn box with paths, lines, messages and the owner line; the Glossary tile dashed, "the product owner, Wren, writes it"; "6 of 7"). | Pass. |
| 14 card problems | Pass (§8: the warn box under the title, the dashed "decided ?" pill, "Choices" shown as written, the missing heading just missing). | Pass. |
| 15 no library | Pass (§7: "Vitals's library", the dashed card with main's sha, seven dashed tiles with their paths, the rail all muted). | Pass. |
| 16 work tab | Pass (§4: Work unchanged, Library beside it, no as-of line on Work). | Pass. |
| 17 menu | Pass (§3: "Toolshed ▾" as the current tab, Overview not lit, 340 px, taglines, "Library not written yet", Library pills, accent edge on the current, the foot). | Pass (§3: spans the screen 8 px in; rows over 52 px; 40 px pills). |
| 18 sections | (390 only) | Pass (§5: the list opens in place under the button, 44 px rows, the current with its accent edge). |
| 19 after sync | Pass (§13 "main moved": the toast "Toolshed's library is now main at b7070ad." and the page redrawn at b7070ad; §14 the mermaid flow fitted, with Full size and Source). | Pass for the page and the small diagram (the 390 shot is the page after the sync, without the toast; fine). |
| 20 overview rows | Pass (§2 links in: "Library" under each project's name, accent; "Projects ▾" in the header when no project is open). | Pass. |

**A fixture note, not a finding:** Workshop's library is Toolshed's with problems added, `title` included, so 12-14
show "TOOLSHED LIBRARY" and "Toolshed" on Workshop's page. The build is right (the head is the library's `title`,
§6), but a reader of the shots takes it for a bug. Give Workshop's fixture overview its own `title` and `tagline`
when the shots are next made.

## Spec states with no shot

None of these blocks build A; they are what the next shot run should add (and B's for the diagrams):

- **Tablet, 1024** (design/CLAUDE.md, §5: the rail at 761-1279, "On this page" folded, 3 tiles across). Every shot is
  1280 or 390.
- **Dark** (§15).
- **GitHub links:** the e2e's libraries have no GitHub repo, so no shot shows the sha as a link, "line 2 ↗" in the
  problems, the paths' ↗, the source line's ↗, or the rail's "library/ on GitHub ↗" (§4, §5, §8, §10, §11.1). The
  code draws them (`library.js` 304, 415, 526-534); one shot from `library.test.ts`'s GitHub fixture would show them.
- **§13:** reading (first read), the read failed, no library sent (and the menu's "no library"), may be behind, the
  last fetch failed.
- **§2:** an unknown section, an unknown card.
- **§8:** a section's own folded box, "2 problems in Decisions", on the Decisions list.
- **§9 and §12, finding:** "1 of 3 decisions" and "No decision matches…", "2 of 10 terms".
- **§3:** the menu at 1280 from a page that isn't a project's (20 shows the closed "Projects ▾" only).
- **Build B (not A):** §10's frame and its states, §11.1's bar, frame, Full screen and heights, §11.2's phone hint,
  §11.3's states, and §5's folded rail on a diagram page.

## Fixes asked of Luigi (all minor)

1. 05: the deciders column wraps instead of cutting (§9.1).
2. 06, 08, 10, 19: one underline on a "0002 Title" link, not across the gap.
3. 07, 09 (390): touch chips keep the pill shape; the 44 px is the hit area.
4. 12 (390): no repeated section title under the section button on a not-written section (§5).
5. Shots: 02-390 waits for the section's text; Workshop's fixture gets its own title; next run adds 1024 and the
   GitHub fixture.
