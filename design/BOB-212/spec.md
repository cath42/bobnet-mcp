# BOB-212: each project's library on BobNet, and the project menu back

Daisy, design session `BOB-212 design A`, version 6, 2026-11-27 (version 5 the same day, version 4 on 26 Nov). For R9 (R3.1).

**Sources:**

- BOB-212's five criteria.
- Casper's words, in `lead/bob212/frameworks-decision.md`: "some structure around architecture, data models,
  use cases, prototypes, ux design"; "Its a lot of text though"; diagrams one can "focus/zoom on details … or zoom
  out and see bigger picture"; on version 2, "id prefer entity context be something I can open or see on the diagram
  somehow".
- **His verdict on version 3 (Q-21), the last section of that file:** the data model was all tables or all tables
  with attributes, and he wanted "to toggle that by diagram"; and "make it consistent for all and prototype using a
  sample … im looking for standards and frameworks not "work with what I've got" please".
- **His verdict on version 4 (Q-22), the same file's last section:** "I want to be able to toggle column/attribute
  level details PER ENTITY". The section turns it into a check; §11.4 is how this version passes it.
- **His verdict on version 5 (Q-23), the same file's last section:** "Liam as is": accept the limitations, use open
  standards for the models, and maybe change the visualization later. §0 and §11 are what that changes.
- **The standard:** Toad's ADR 0017 (`architecture/decisions/0017-library-standard.md`), its author's guide
  (`architecture/library-standard.md`), and the sample project Toolshed (`architecture/spikes/bob212/sample/`). ADR
  0015 and 0016 stand where 0017 says they do.

This spec is the screens. Where it meets the ADRs, it cites them as 0015 §n, 0016 §n and 0017 §n.

**The prototype** is `design/BOB-212/prototype/`. Open `index.html#project/toolshed/library`. It shows **Toolshed
only**: a fictional tool library written to the standard, every section filled. BobNet, Helix and Vitals are in the
menu but have no `library/` yet, so their libraries show what an unconverted project shows (§7). No real project's
content is in it, so its data (`prototype/data.js`, made by `tools/gen_data.mjs` from the sample) is committed. Its
GitHub links open the sample's files in bobnet-mcp at `1c83f2b`.

## 0. What changed since version 5 (Casper's Q-23: "Liam as is")

Marked "dropped, Q-23" where it was; §11 holds the list.

- **The data model shows in Liam ERD, unpatched,** in its own look and side pane, fed from the DBML (§11). No viewer
  of ours, no override.
- **Dropped, Q-23:** our ERD viewer, the per-table chip, "Expand all · Collapse all", the finder, the diagram tabs
  and their addresses (only "all tables"), and our entity card. Liam's whole-diagram show mode takes the place of
  the per-table toggle, a limit Casper accepted.
- **Page around the frame** (§11.1): title and owner, a bar with the table count and Full screen, the frame, the
  source line, the "as of" line. A phone: §11.2.
- **Stays:** LikeC4 for the architecture (§10), the seven sections, the cards (§9), the standard, the library
  layout.
- **The project menu is A** (§1, his "Its fine"). Version 5's prototype and shots are not redone: they show what §11
  drops, so read §11 over §11.1-11.5 of version 5, in git at ce7581a.

## 0.2 What changed from version 4 to 5 (§11's part is dropped, Q-23)

- **Each table opens on its own node** (§11.4, Casper's Q-22). Every table in the diagram has its own control, a chip
  with its column count and ▸, on its node. A click or a tap on it shows or hides that table's columns in place; the
  others stay as they are. So one diagram can show loan with its columns and member, tool and the rest as names.
  Which tables are open is kept per diagram, on the device.
- **The Tables · Keys · Columns toggle is gone.** The bar keeps a small extra, "Expand all · Collapse all", as two
  quiet text buttons (§11.2).
- **The viewer is BobNet's own** (0017 §7 as amended: React Flow, dagre, @dbml/parse; Liam dropped). The node's look
  and its control are mine (§11.5); its tap target on a phone is at least 44 px at the zoom the reader is at.
- Everything else stands: the standard, the tabs, the entity card, the C4 views, the cards. The project menu (§1)
  is still open.

## 0.1 What changed from version 3 to 4

- **One standard for every project** (0017 §1). Each section is one file or one folder under `library/` on main,
  in one format, the same in every repo. So the page has no per-repo shapes:
  - no section with several pages and page tabs;
  - no `children` lists, no use cases cut out of a long page, no taxonomy table;
  - no `.bobnet/library.json`, no "missing page" state;
  - no `about` file: the descriptions are the DBML's notes.
- **The data model has named diagrams** (§11). "All tables" comes first, then each `DiagramView` in the DBML, as
  tabs. (Version 4's toggle per diagram is replaced in version 5 by each table's own control.)
- **The entity card stays** (§11.3), now from the DBML. It also shows:
  - which diagrams draw the table;
  - one-to-one relations;
  - what may be null, and the defaults;
  - an enum column's values with their notes;
  - the table's line in the file.
- **Cards are the standard's cards** (§9). Decisions, use cases and UX cards are numbered files with fixed front
  matter, and are linked to each other:
  - a decision to what it supersedes and what supersedes it;
  - a use case to its flow in the architecture and to its UX cards;
  - a UX card to its use cases.
- **The architecture's views picker is grouped**: C4 levels, use-case flows, deployment (§10). On a phone it is the
  way into a wide view, whose boxes are too small to tap (0017 §7).
- **Problems with the standard** are listed and counted, never fatal (§8).

The project menu (§1) is unchanged, and still open.

## 1. "The project menu": what Casper likely means (AC3, to settle with him)

**What happened.**

- Until 23 Nov the header had a project dropdown (`<select id="project">`) after the tabs. It scoped Roadmap,
  Feature, Triage and Sessions to one project.
- BOB-121's revamp removed it (spec §2.0: "The header: no project dropdown"; Luigi's e82a684, BOB-174). Each page
  that needs a project got its own switch instead.
- The project pages came in the same release (BOB-182, `#project/<key>`). The only ways to one are the
  Overview's Projects rows and links inside other pages. Nothing in the header leads to a project.

So Casper has project pages but no menu to them, and the library needs a home under a project.

**Three readings:**

| | Reading | What he'd see | For | Against |
|---|---|---|---|---|
| **A** (rec) | **A Projects menu in the header, to each project's page. The page gets Work and Library tabs** | "Projects ▾" first in the tabs. It lists the projects, each with a Library link. On Helix's page it reads "Helix ▾". | One place to go to a project, from any page. The library sits where the project is. The per-page switches stay. | One more control in the header. The tabs stay two rows on a phone, as now. |
| B | **The old dropdown back**: one project picked in the header scopes every tab, plus a Library tab | A select after the tabs: Roadmap, Features, Triage, Usage and Library show the picked project. | What he had before 23 Nov. | Overview and Needs you are across projects, so the dropdown means nothing there. It duplicates the page switches BOB-121 put in, or removes them. An 8th tab for Library. |
| C | **A Projects tab**: an 8th tab with a card per project, each opening its page with Work and Library | "Projects" beside Overview: a card per project (release, who runs, Library). | A page to browse projects. | It duplicates the Overview's Projects rows. Switching takes two taps instead of one. |

**Recommendation: A.** It brings back the menu he misses without the scope that BOB-121 removed for good reasons.
It also gives the library a place that is plainly the project's. The prototype shows A. Casper's answer goes here,
verbatim, when Mario has it (AC3's evidence).

> Casper (Q-23, 2026-11-27, in Mario's session), asked where the menu choices were; the prototype showed A, the
> "Toolshed ▾" project button, and B and C were only described: "Its fine, but this is still custom right? We agreed
> to use the framework and not build a bunch of custom instead accept the limitations and use open standards for
> models and maybe opt for changing the visualization later right?" Then, on Liam: "Liam as is".

**Settled: A** (his "Its fine" on the menu as shown). The header's Projects menu, and Work and Library on a project's
page, are built as §3 and §4 draw them.

## 2. Addresses

`#project/<key>/library[/<section>[/<item>[/<focus>]]]` (0017 build A task 4). What the item and the focus are
depends on the section:

| Section | `<item>` | `<focus>` | Example |
|---|---|---|---|
| `overview` | a heading's slug | | `…/library/overview/quality-goals` |
| `architecture` | a view id (0017 §2's fixed ids) | | `…/library/architecture/apiComponents`, `…/architecture/uc0001` |
| `data` | none (the diagram and table addresses, `…/data/lending/loan`, are dropped, Q-23) | none | `…/library/data` |
| `decisions`, `usecases`, `ux` | the card's number | a heading's slug | `…/library/decisions/0003`, `…/usecases/0001/acceptance` |
| `glossary` | a term's slug | | `…/library/glossary/hold` |

- **A slug** is the text in lower case, with each run of anything but a-z and 0-9 turned into one `-`.
- **History:**
  - Drilling into a C4 view, opening a table, or switching a diagram adds a history entry, so the browser's Back
    goes back one step.
  - A heading or a term moves the page and the address, and adds an entry too.
- **Unknown names:**
  - An unknown section shows the library's frame with "A library has no section "x"." and a link to its sections.
  - An unknown card shows "<Section> has no card 0009.", and where its cards come from.
  - An unknown view, table, heading or term opens the section from its start, and says nothing.
- **Links in:**
  - the Projects menu (§3): a Library link on each project's row;
  - the Overview's Projects rows: "Library" under the name (13 px, accent).

## 3. Header: the Projects menu

As in version 3. The one change is a project's second line:

- **The button** is "Projects ▾", first in the tabs, before Overview.
  - On a project's page (either tab) it reads the project's name, "Helix ▾", and is the current tab.
  - The Overview tab is then no longer lit. That changes BOB-121 §2.0.
- **The menu** is 340 px wide. At ≤860 px it spans the screen, 8 px in from each edge.
- **One row per project:**
  - the name;
  - under it, in muted 12.5 px, the library's tagline (the overview's `tagline`), or **"Library not written yet"**
    when main has no `library/`;
  - at the right, **Library** as an outlined pill. Every project has one, written or not (§7). "no library" in muted
    shows only when the laptop sent no library at all (§13);
  - the row opens the project's page;
  - the current project has the accent left edge.
- **Its foot:** "Every project at a glance, on the Overview".
- **The keyboard:** Enter or Space opens it with the focus on the first row. Up and Down move. Escape closes it and
  returns the focus to the button. The button has `aria-expanded` and `aria-controls`.
- **On a phone** the rows are at least 52 px, and the Library pill 40 px.
- **No counts.** The menu is for going somewhere.

The prototype lists Toolshed first, tagged "sample". The build lists the board's projects; Toolshed is a fixture,
not a project.

## 4. A project's page: Work · Library

- **The head** is as built: ‹ Overview, the name, "lead · PO · laptop · repo", and the project switch. On Library
  the switch keeps the section.
- **Two underlined tabs, Work and Library.** Work is today's page, unchanged.
- **The "as of" line** is at the right end of the tab row on Library:

  > As of main at `1c83f2b`, 26 Nov 21:34 · checked 4 min ago from mbp-1 · **3 problems**

  - The branch is the project's ref: "v2" for BobNet.
  - The sha links the commit.
  - **"3 problems"** (warn, a link to the library's home) shows only when files break the standard (§8).
  - On a phone the line is on its own row.

## 5. The library's layout

| Width | Sections | Page | On this page |
|---|---|---|---|
| ≥1280 (desktop 1440) | rail, 220 px, sticky | the rest. Prose up to 780 px; cards, lists and diagrams take the full width | 200 px rail, sticky, for a page with 3 or more headings |
| 761-1279 (tablet 1024) | rail, 220 px, sticky | the rest | folded under the page's head |
| ≤760 (phone 390) | one button, "Section: Data model ▾", opening the list in place | full width | folded under the head |

**The rail** has "TOOLSHED LIBRARY" (caps, muted), then:

- **Home**.
- **The seven sections, always, in the standard's order.**
  - A written section is its label. One with problems has a warn count after it: "Decisions 2".
  - A section not written is muted, with a second line in 11.5 px: "not written yet · architect".
  - The current section is semibold with a 3 px accent edge.
- **The foot**: "library/ on GitHub ↗" (the folder at the commit; "Repository ↗" when there is none) and "The library
  standard ↗" (the author's guide, `architecture/library-standard.md` on v2).

**On a phone**, the button names the section. Its list opens under it, with 44 px rows. The section's own title
isn't repeated under the button; only "owner Otto" shows.

**A diagram page (Architecture, Data model) folds the rail at every width**, as in version 3, so the frame has the
page's width:

- The section's title becomes the button: "Data model ▾", at the title's size (22 px, 20 on a phone). It opens the
  rail's list, 280 px wide, as a menu under it. A click outside closes it, and so does Escape, which returns the focus
  to the button.
- The owner follows the button. (The data model's diagram tabs that stood here are dropped, Q-23.) A phone stacks them.

## 6. The home: seven tiles

Shots 02, 25.

- **The head**:
  - the library's title (26 px), from the overview's front matter (`title`);
  - its `tagline` (muted 16 px);
  - its people, in muted 13.5 px: "Wren, product owner · Otto, architect · Ines, designer" (0017 §6).
- **The problems**, when there are any (§8), open, above the tiles.
- **Then a tile per section, in the standard's order.** The grid is `auto-fill, minmax(240px, 1fr)`: 4 across at
  1440 and 3 at 1024. A phone has one column.
- **A written tile** (a link to its section) has:
  - the label (16 px semibold), and a warn "2 problems" when it has any;
  - what is in it, a kind tag in 10.5 px accent caps, then a line:

    | Section | Tag | The line |
    |---|---|---|
    | Overview | PAGE | Goals, scope and quality goals |
    | Architecture | C4 DIAGRAM | Context, containers, components and flows |
    | Data model | ERD | All tables, in Liam (§11) |
    | Decisions, Use cases, UX design | 3 DECISIONS, 3 USE CASES, 2 CARDS | latest: the highest number's title |
    | Glossary | A–Z | Terms in users' words |

  - for a card section, a second line counting each status: "2 accepted · 1 superseded";
  - at the foot, the owner's name (else the role) and "changed 26 Nov", the newest file's commit date.
- **A tile not written** has a dashed edge on no fill. Its label is muted, then "Not written yet", then "the
  architect, Otto, writes it". It still links to its section (§7).
- **Under the tiles**, in muted 13.5 px: "7 of 7 sections written. Each is a file or a folder under library/ on main,
  the same in every project: the library standard ↗. To change one, ask its owner."
- **The home reads only the index** (0017 §4): the paths, titles, heads and commit dates. It fetches no file, so the
  Architecture, Data model and Glossary tiles say what they hold, not counts.

## 7. Not written: a section, or a whole project

**A section not written** (its file or folder absent; 0016 §3, 0017 §5) keeps its place and its address. Shot 28:

> **Glossary isn't written yet.**
> It holds: terms in users' words, A to Z.
> The product owner (Wren) writes it as `library/glossary.md` on main, from its template in the library standard ↗.

- It is a dashed card, left-aligned. The name in brackets is the overview's owner, when the overview names one.
- What each section holds, in the page's words:

| Section | Holds |
|---|---|
| Overview | Goals, stakeholders, scope, constraints and quality goals. |
| Architecture | The C4 model, from context to containers to components, each use case's flow, and where it runs. |
| Data model | Every table, its columns and relations, as diagrams: all tables, and the named ones. |
| Decisions | One record per decision: its context, the options, the decision, its consequences and its status. |
| Use cases | One card per use case: its actor, goal, scenario and acceptance. |
| UX design | One card per feature: its screens and states, its prototype, and the owner's verdict with its date. |
| Glossary | Terms in users' words, A to Z. |

**A project with no `library/` on main** (0017 §5; BobNet, Helix and Vitals today). Shot 27:

- The Library tab still opens. The rail shows the seven sections, all muted.
- The home's head is "Helix's library", then a dashed card:

  > **Helix has no library on main yet.**
  > A library is seven sections in a `library/` folder on main, in the same files in every project. Helix's main at
  > 5ed684a has none, so each section below is not written yet.
  > Its team writes them from the templates in the library standard ↗. Files elsewhere in the repo aren't read.

- Then the seven tiles, dashed, each with "Not written yet" and its path in mono: `library/data-model.dbml`.
- A section opens §7's card, without an owner's name (there is no overview to name one).

## 8. Problems with the standard

0017 §4 lists the problems the supervisor finds: a front matter key missing, unknown or with a value outside its
list; a heading missing or out of order; a card name or number wrong or used twice; a file the standard doesn't name;
glossary terms out of order. They are never fatal. Shots 25, 26:

- **Counted** on the "as of" line (§4), on the rail ("Decisions 2"), and on the section's tile.
- **Listed** on the home, open, in a box with a warn edge:
  - "3 problems with the library standard";
  - one line each: the path under `library/` and "line 2 ↗", linked to that line on GitHub, then the message;
  - "Its owner fixes the file on main; the library standard ↗ has the rules and templates."
- **In its section**, the same box, folded, with only that section's problems: "2 problems in Decisions".
- **On its card**, the problems in a warn box under the title: "Line 2: status is "decided": it is one of proposed,
  accepted, rejected, deprecated or superseded".
- **The file still shows as far as it can** (0017 §5):
  - a status outside the list shows as written, in a dashed warn pill with "?": "decided ?", titled "Not one of the
    standard's statuses";
  - a missing heading is just missing.
- **A file the standard doesn't name** is listed, never shown: "notes/counter-ideas.md: the standard doesn't name
  this file, so it isn't shown".

The messages are 0017 §4's kinds in the page's words. The supervisor's text is the build's; the prototype's three are
examples.

## 9. Cards: decisions, use cases, UX design

Shots 17-22.

**What every card has** (0017 §2): a number (`NNNN`, the file's name), a title (its `# ` line), front matter with
fixed keys, and fixed headings.

**Numbers** show as they are written, `0003`, in muted tabular 13 px, in lists and in references. A card's own page
puts its kind and number over the title: "DECISION 0003", "USE CASE 0001", "UX CARD 0002" (12 px caps, muted). No
"ADR-" or "UC-" prefix: the section says the kind (0017's alternatives leave this to me).

**Status pills** (11.5 px, a 1 px border in the colour):

| Colour | Values (0017 §2) |
|---|---|
| ok | accepted, agreed, built, approved |
| warn | proposed, draft, in review, changes asked |
| muted | superseded, rejected, deprecated, retired |
| warn, dashed, with "?" | anything else (§8) |

**Every list has the same bar**:

- "Find a decision" (16 px, so a phone doesn't zoom). It searches the number, the title, the front matter and the
  card's first 4,000 characters.
- The statuses that occur, each with its count, "All 3 · Accepted 2 · Superseded 1", when there are two or more.
- The count: "3 decisions, newest first", or "1 of 3 decisions" while finding.
- No match: "No decision matches. Clear the find or pick All."
- Highest number first.

### 9.1 Decisions

**The list** is one hairline-framed list, a row per decision:

- the number;
- the title, and "superseded by 0003" in muted 12.5 px when another decision's `supersedes` names it;
- the status pill;
- the `date` ("11 Jun 2026");
- `decision-makers`, joined: "Otto, Wren and Ines".

At ≤760 a row is two lines: the number, the pill and the date, then the title. The deciders go.

**A decision's page:**

- "‹ Decisions", "DECISION 0003", the title (21 px).
- A head box (the surface, a hairline, 8 px radius). Its fields sit two across at ≥760 and stack on a phone:
  - Status: its pill;
  - Date;
  - Decided by;
  - Supersedes: each as "0002 Reminders go by email", a link;
  - Superseded by: derived, never written (0017 §2), linked the same way;
  - Feature: the board ref.
- The meta line: "owner Otto · changed `1c83f2b`, 26 Nov · library/decisions/0003-….md ↗".
- Then Context, Options, Decision and Consequences, with "On this page" (§5).

### 9.2 Use cases

**The list** is cards, `minmax(300px, 1fr)`, one column on a phone:

- the number and the status pill;
- the title, which opens the card;
- Actor (`actor`), and Goal: the first paragraph under `## Goal`, cut at about 150 characters;
- at the foot, chips:
  - **"Its flow ›"** when the architecture has the dynamic view `uc<NNNN>`. It opens that view;
  - **"UX 0001"** for each UX card whose `use-cases` names it.

**A use case's page:** "‹ Use cases", "USE CASE 0001", the title, then the head box:

- Status;
- Actor;
- Date;
- Feature;
- Flow: "Its flow, in the architecture ›";
- UX design: "0001 Catalogue and reserving".

Then Goal, Preconditions, Main scenario, Extensions and Acceptance. In Acceptance, **Given**, **when** and
**then** are semibold, so each criterion reads at a glance.

### 9.3 UX design

**The cards** are in a grid, `minmax(280px, 1fr)`:

- the number, the `feature` (accent), and the status pill;
- the title, which opens the card;
- **the verdict**:
  - with a `verdict`, its words in quotes, then "the verdict, 9 Mar 2026" (`verdict-date`) in muted;
  - "Waiting on a verdict" (warn) when the status is in review;
  - "Changes asked" (warn) when it is changes asked;
  - otherwise "No verdict yet" (muted);
- "Use cases" and a chip per number in `use-cases`;
- **The card** and **Prototype ↗** (`prototype`, in a new tab): 36 px buttons, 44 px on touch.

**A UX card's page:** "‹ UX design", "UX CARD 0001", the title, then the head box:

- Status;
- Verdict: the quote · its date;
- Prototype: "Open it ↗";
- Use cases, linked;
- Date;
- Feature.

Then Purpose, Screens, States and Open questions.

## 10. Architecture: the C4 frame (LikeC4)

Shots 03-08, 31. The viewer is unchanged (0017 §7); the page groups the views by 0017 §2's fixed ids.

**The bar, above the frame:**

- **The crumb**, one link per level, named by its element: "Context › Toolshed › **API**". The current level is
  bold.
- **Under it, what the view is**, in muted 13 px (hidden on a phone):

  | View | The line |
  |---|---|
  | `index` | Level 1: the context |
  | `containers` | Level 2: its containers |
  | `<container>Components` | Level 3: the components of API |
  | `uc<NNNN>` | **The flow of use case 0001: Reserve a tool ›**, a link to the use case |
  | any other (deployment) | Where it runs |

- **At the right:**
  - **↑ Out**: one level up. It is disabled at the context. A flow's and a deployment's level up is the context.
  - **The views**: a select with three groups, in this order:
    - **C4 levels**: Context, Containers, then "API: components" for each container that has a view;
    - **Use-case flows**: "0001 · Reserve a tool";
    - **Deployment**: "Production".

    A group with no views is left out. Picking one goes there, as a history entry. Its text is 16 px so the phone
    doesn't zoom.
  - **Fit**, and **Full screen**.

**The frame**, its heights, pan and zoom, the ⤢ drill on a box, a box's details, the focus on a double-click, the
dynamic view's step-through, the hidden LikeC4 panels and "Tap to explore" are as in version 3:

| Width | Frame height |
|---|---|
| ≥1280 | `clamp(420px, 100vh − 290px, 760px)` |
| 761-1279 | 62 vh |
| ≤760 | 64 vh, at least 380 px |

**On a phone the picker is the way in** (0017 §7). In a wide view at 390 px a box is too small to tap, so its ⤢
doesn't show. So on a phone (shot 06):

- the picker has its own row, full width, 40 px, right under the crumb, above the frame;
- under it, ↑ Out on the left, Fit and Full screen on the right;
- picking a view brings the frame up when it is below the fold.

Full screen is still the way to read a big view: the bar and the frame fill the screen, and Close or Escape leaves.

**Under the frame**, one line in muted 12.5 px: "Model: library/architecture/ ↗ · LikeC4 · main at 1c83f2b".

**States:**

| State | What shows |
|---|---|
| Drawing | Over the frame: **Drawing the model…**, "The first time on this device, the viewer downloads (2.4 MB).", and three grey lines. |
| No answer in 15 s | The frame is replaced by a dashed card: **This model couldn't be drawn here.** "The viewer didn't answer within 15 seconds." Its files with GitHub links and sizes, and **Try again**. |
| Errors, nothing drawn | The same card: "The viewer found errors in it:", then each as "views.c4 line 30 ↗: Could not resolve reference to …", linked to the line. |
| Errors, a model drawn | The frame shows. Above it, a warn line, "1 problem in the model: what they touch may be missing", opens the same list (shot 31). |
| Too large (0017 §4: 64 files, 512 KB) | **This model is too large to show here** (n files, n KB), and its files on GitHub. |

## 11. Data model: Liam ERD as is (Casper's Q-23)

Casper's Q-23, 2026-11-27: "Liam as is". The data model shows in **Liam ERD, unpatched, in its own look and its own
side pane**, with no override stylesheet and no viewer of ours. The model is one file, `library/data-model.dbml`
(0017 §2); the frame turns it into PostgreSQL DDL with `@dbml/core`'s own exporter and hands that to Liam (0017 §7
as Toad amends it; his word, not this spec's, for how the frame does it). Everything inside the frame is Liam's.
This section is only what the page shows around it.

**Dropped, Q-23** (version 5's §11.1-11.5, all of it; the prototype's ERD still shows them and is not redone):

- our ERD viewer (React Flow, dagre, @dbml/parse), its node, the per-table chip (`7 ▸`), its 44 px tap target and
  `--z`: dropped, Q-23. Q-22's per-entity toggle is knowingly given up until a viewer does it;
- "Expand all · Collapse all", "Find a table", Fit, the hover preview and "Tap to explore": dropped, Q-23;
- the diagram tabs ("All tables 9 · Catalogue 4 · Lending 6"), and so the `…/data/<diagram>` address: dropped,
  Q-23. Only the "all tables" diagram shows; a `DiagramView` in the DBML is not drawn;
- our entity card (its relations, key fields, enum values, "Drawn in", the line link): dropped, Q-23. Liam's side
  pane shows a table's columns and relations instead;
- the crumb, the `Project` note under the bar, `files.expanded` and the device's `expanded.<project>.<diagram>`
  key: dropped, Q-23;
- BobNet's own look on the diagram (§11.5): dropped, Q-23. Liam draws itself, in its own colours and type. It is
  the one place on the page that does not follow style.css, and the frame's edge says so by being a frame (below).

**Accepted limits, Casper's words** ("accept the limitations and use open standards for models and maybe opt for
changing the visualization later"): columns show for all tables or none, by Liam's own show mode (tables, keys,
all columns), not per table; one diagram; Liam's look. DBML stays the source, so a better viewer can replace Liam
later and no repo's `library/` changes.

### 11.1 The page around the frame

Top to bottom, at every width:

1. **The title**: "Data model ▾", the rail's menu button of §5, then the owner, "owner Otto". The tabs are gone,
   so the row holds nothing else (it stacks on a phone as §5 says).
2. **The bar**, one row above the frame:
   - at the left, muted 13 px: "**9 tables**", from the frame's `ready.tables` (Toad: optional, and absent until the
     frame answers; then the bar's left is empty, not a placeholder);
   - at the right, **Full screen** (the only control; it is the page's, not Liam's). A secondary button, 40 px on a
     phone, 32 px elsewhere.
   - No crumb, no note, no finder.
3. **The frame**: Liam, filling the width of the content column (the whole screen in Full screen). It has the card
   look of the other frames, a 1 px border and the page's radius, so the reader sees where BobNet stops and Liam
   starts.
4. **Under the frame**, one line in muted 12.5 px, as §10's: "**Model:** data-model.dbml ↗ · DBML · main at 1c83f2b".
   The link opens the file on GitHub at that commit. This is the model's source link.
5. **The "as of" line** is the library's, in the page's head as on every section (§5): "main at 1c83f2b · 26 Nov ·
   checked 4 min ago by mbp-1". It turns warn when it may be behind (§13).

**Heights:**

| Width | Frame height |
|---|---|
| ≥1280 | `clamp(420px, 100vh − 250px, 760px)` |
| 761-1279 | 62 vh |
| ≤760 | 70 vh, at least 420 px |

**Full screen** fills the screen with the bar's row and the frame; Close (on the bar's right, where Full screen was)
or Escape leaves, as §10's.

### 11.2 A phone (390)

- The title and owner stack as in §5. The bar is one row: the table count at the left, Full screen at the right,
  40 px tall.
- The frame is full width, 70 vh, at least 420 px. Liam takes touch itself (Toad's 390 × 844 shots,
  `architecture/spikes/bob212/shots-liam-as-is/`): all 9 Toolshed tables fit, but at about 25 %, so **the names
  can't be read until the reader zooms**. A tap on a table slides Liam's side pane over with its note and columns;
  pinch-zoom works. Liam's header (Search, Export, Copy Link, GitHub, help) stays as it is, and its font is the
  system's (the frame's CSP blocks Google Fonts).
- **The hint** is about zooming, never about a bigger screen: in muted 12.5 px under the bar on a coarse pointer,
  "Pinch to zoom, tap a table for its columns." It goes after the first pinch or tap, kept on the device.
- **Full screen plus pinch is the way in on a phone**: the whole diagram is small at 390. The bar's row is the first thing
  under the title, so the button is above the fold.
- The source line wraps under the frame, in two lines if it must; nothing scrolls sideways.
- The page's pinch and scroll: a scroll that starts on the frame pans Liam, so the frame is never between the reader
  and the rest of the page: the page scrolls from anywhere outside it, and the bar is above it.

### 11.3 States

§10's, with "the data model" for "the model", and these differences:

| State | What shows |
|---|---|
| Drawing | Over the frame until `ready`: **Drawing the data model…**, "The first time on this device, the viewer downloads (its size is in the ADR).", and three grey lines. The bar shows no count. |
| No answer in 15 s | The frame is replaced by a dashed card: **The data model couldn't be drawn here.** "The viewer didn't answer within 15 seconds." The file on GitHub with its size, and **Try again**. |
| The DBML has errors | The same card: "The viewer found errors in it:", then each as "data-model.dbml line 51 ↗: Table 'sheds' does not exist in Schema 'public'", linked to the line (0017 §5). Nothing is drawn: there is no half-drawn ERD. |
| Liam can't read the converted model | The same card, one error and no line: **The viewer couldn't read the converted model.** The file's link and Try again. Toad says this should not happen. |
| Too large (0017 §4) | §10's: **This data model is too large to show here**, and the file on GitHub. |
| No data model | §7's "not written" card. |

The frame is sandboxed (0016 §6) and may need `unsafe-eval` inside, for Liam's SQL parser; that is the frame's
business, and the page needs nothing beyond `frame-src 'self'`.

## 12. Overview and glossary

**The overview** (shot 24) is a prose page:

- the section's head, then the `tagline` as its lede (17 px);
- the meta line: "changed `1c83f2b`, 26 Nov · library/overview.md ↗";
- its fixed headings, Goals, Stakeholders, Scope, Constraints and Quality goals, with "On this page".

The front matter isn't shown as fields. Its title, tagline and people head the library's home (§6).

**The glossary** (shot 23):

- the meta line;
- **Find a term** (16 px), and the count, "10 terms" or "2 of 10 terms";
- **the letters** that open a term, each a 32 px square button (44 px on touch). It jumps to the first term under that
  letter;
- **the terms**, a hairline between each:
  - the term (16 px semibold, a link to its own address);
  - its `Also:` words in muted: "also return";
  - its definition (15 px, at most 72 characters a line).
- **A term in the address** (`…/glossary/hold`) is scrolled to the middle, and marked with a light accent fill and a
  3 px accent edge.

## 13. States

| State | What shows |
|---|---|
| Reading (first read) | The rail and the tiles as grey shapes, still under reduced motion, and "Reading the library…". |
| The read failed | `.banner.down`: **The library couldn't be read**, the error, and Retry. What was read stays under it. |
| No library sent (the laptop's supervisor predates libraries) | A dashed card: **No library from Toolshed's laptop yet.** "The supervisor on a project's laptop reads its `library/` folder on main and sends it here. One older than the release with libraries sends none." The menu reads "no library". |
| No `library/` on main | §7 (shot 27). |
| A section not written | §7 (shot 28). |
| Files that break the standard | §8 (shots 25, 26). |
| May be behind (`checked_at` 2 h or more) | The "as of" line turns warn, and a banner: **This may be behind main.** "mbp-1 last checked 5h ago; it checks every 10 minutes while it runs. The library is main at 1c83f2b (26 Nov)." |
| The last fetch failed | The line turns warn, and a banner: **mbp-1 couldn't fetch Toolshed 12 min ago.** "<its message>. The library is main at 1c83f2b (26 Nov), last checked 3h ago. It updates at the next fetch." |
| Main moved while open | The page is redrawn at the same spot, and a toast: "Toolshed's library is now main at 9c01d2e." A diagram already open isn't redrawn until the reader leaves it, or presses Try again. |
| A diagram drawing, failing or with errors | §10, §11.3 (shots 29-31; 29 and 30 show the dropped viewer's version of §11.3). |
| A small (mermaid) diagram that can't be drawn | "This diagram couldn't be drawn here. Its source is below." |

Gone since version 3: the bad manifest and the page missing on main. There is no manifest, and a file is either on
main or not written.

## 14. Prose, links and small diagrams

As in version 3:

- **Markdown** is rendered with markdown-it (`html: false`). Body text is 15.5 px / 1.6, at most 72 characters a
  line. Headings are restyled under `.doc`. A heading shows "#" on hover, which puts it in the address. Code scrolls
  sideways. A repo image is a link to it on GitHub; UX images are in `library/ux/images/` (0017 §1).
- **A table** sits in its own frame that scrolls sideways.
- **The links:**
  - to a file the library shows (a card, the overview, the glossary, the model): it opens in place. A card by its
    number, a heading by its slug;
  - to any other file in the repo: it opens on GitHub at the commit shown, in a new tab, marked ↗;
  - http(s): a new tab;
  - anything else is plain text.
- **A mermaid block** (0015 §6, 11.x) is drawn as an image fitted to the column, with Full size and Source.

## 15. Look, the prototype, and the shots

- **The look is BobNet's own:** style.css's tokens, type, radius, `.card`, `.seg`, `.banner` and buttons. New rules
  are in `prototype/proto.css` (all but `.proto-*`), and move into style.css. Version 4's are at its end. Dark is every
  colour as a token, and the frames follow the system's scheme too.
- **The prototype's own:**
  - "Prototype: states", at the bottom right, switches §13's states. It is not built. "Files that break the
    standard" adds a decision with two problems and a stray file; "A diagram with errors" breaks one line of
    `views.c4` and one of the DBML.
  - It loads mermaid from a CDN.
  - The "sample" tag on Toolshed.
  - The frames are served with their CSP: `tools/shots.mjs`'s server, and the deployed worker's `_headers`.
- **To make it**, from the repo:
  - `node design/BOB-212/tools/gen_data.mjs`: `prototype/data.js` from the sample (committed);
  - (the ERD viewer, dropped, Q-23; the prototype still packs it, and is not redone) the ERD viewer, with Toad's spike cache: `node tools/pack-erd.mjs ~/.cache/bobnet-spikes/bob212/erd-own
    prototype/vendor/erd-viewer.html`. No eval of any kind: its CSP is the one hash in `erd-viewer.hash`;
  - the C4 viewer: esbuild `tools/likec4-viewer.jsx` with the spike's flags, then
    `architecture/spikes/bob212/pack-viewer.mjs` → `prototype/vendor/likec4-viewer.html` (unchanged since v3);
  - `node tools/shots.mjs [filter]` → `shots/v5/`;
  - `sh tools/stage.sh`: the deploy dir in a fresh temp dir (assets only, `bobnet-prototype-bob-212`, `_headers`
    with noindex and each viewer's CSP);
  - `node tools/shots-v5.mjs <that dir>` → `shots-v5/`, with its checks (dropped, Q-23: it shows the per-table chip).

  `prototype/vendor/` and `shots/` are made, not kept (about 10 MB). `shots-v5/` is kept: it is Q-22's evidence.

**Shots** are in `shots/v5/` (the v4 list without 10 and 12), at 390, 1024 and 1440, light, with `-dark` for some:

| | | | |
|---|---|---|---|
| 01 the menu open | 02 the home (dark too) | 03 the C4 context (dark too) | 04 drilled to the API (dark too) |
| 05 a click on ⤢ drills | 06 a phone picks a view | 07 a use case's flow | 08 full screen |
| 09 All tables (dark too) | | 11 Lending (dark too) | |
| 13 a table's card (dark too) | 14 a card's other columns | 15 hover on a table | 16 the card on a phone, full screen |
| 17 the decisions (dark too) | 18 a decision | 19 the use cases (dark too) | 20 a use case |
| 21 the UX cards (dark too) | 22 a UX card | 23 the glossary at a term | 24 the overview |
| 25 problems, on the home | 26 a card with problems | 27 Helix: no library/ yet | 28 a section not written |
| 29 a diagram drawing | 30 a DBML error | 31 a C4 error, drawn | 32 may be behind |
| 33 fetch failed | 34 no library sent | 35 reading | 36 the folded sections |
| 37 the Work tab | 38 two clicks on tables, two cards | | |

## 16. For Luigi and Toad

**What the page reads** is 0017 §4: the `library` read's `index` (paths, sections, blobs, `changed`, `title`,
`head`), its problems, and `library_page {section, path?}` for a section's files. The home reads only the index.

**Settled since version 3:** ADR 0016 recorded v3's §14 items 1-12 (Toad, 2e5b177; his message of 26 Nov). 0017 drops
1, 2 and 10 (head lines, `children`'s `match`, `about`), and the card's parts it kept pending Q-21 hold, as the card
stays.

**Settled since version 5** (Casper's Q-23; Toad amends ADR 0017 §7 beside this spec):

- The data model's viewer is Liam ERD as is. The frame: DBML to PostgreSQL DDL with `@dbml/core`, Liam's own app,
  `hello` then `ready {errors, tables}`, no other messages (no focus, hover, fit, show, expanded or about). It has
  `unsafe-eval` for Liam's SQL parser, kept in 0016 §6's sandbox (opaque origin, `connect-src 'none'`); the page
  needs only `frame-src 'self'`. Toad's words are the rule: this spec only records them (his consult, 27 Nov, until
  the ADR lands).
- **Dropped, Q-23** from what version 5 asked for: items 1-5 below, `files.expanded`, `{t: "expand"}`, `{t:
  "expanded"}`, `enums`, `line`, the card's fields, the diagram tabs' `ready.views` and the `…/data/<diagram>`
  address. Build tasks B3-B6 shrink to the frame, the bar, the states and the source line (Toad re-cuts them).

**Settled since version 4** (Toad, 9016889, ADR 0017 §7 as amended, and his message of 27 Nov): `ready` carries
`enums` with notes, each table's `line`, each column's `default`, `unique` and `pk`, `shown` and `expanded`; the
messages `files.expanded`, `{t: "expand"}` and `{t: "expanded"}`; the show toggle and Liam's menus are gone; the
`uc<NNNN>` regex stays (item 5 of v4).

**What version 5 adds, for Toad and Luigi:**

1. **One node size on every device**: HEAD 40 and TOG 52 on a coarse pointer too (his `size()` had 48 and 64). The
   tap target does the work instead (§11.4).
2. **The zoom as a CSS variable**: the viewer sets `--z` on its root from React Flow's transform (`useStore((s) =>
   s.transform[2])`), which `erd-node.css` reads for the tap target. In the prototype both are patches on
   `erd-viewer.jsx` in `tools/pack-erd.mjs`, which fail loudly if his source moves.
3. **The node's styles** are `tools/erd-node.css`, after his `erd-viewer.css`; his `(pointer: coarse)` sizes are
   overridden there. Build B3 can fold them into one file.
4. **The device key** is `expanded.<project>.<diagram>`, a JSON list of names. A diagram renamed in the DBML starts
   closed; a table renamed is dropped from the list by the viewer (it filters by `shown`).
5. **The card's fields**: the viewer's model calls a note `note`; the prototype's card reads `comment` and maps it.
   The build should read `note` directly.

**Build tasks** are 0017's as amended (A 7, B 6). Version 5 changes none of them:

- the node's control and the tabs are B4;
- the card is B5;
- §16's items 1-3 are B3;
- §8's problems and §7's states are A4;
- the cards and the glossary are A5.

## 17. Open questions

1. ~~AC3~~: settled, A (§1, Q-23).
2. ~~Per-table expand~~: given up, Q-23 (§11).
3. **Toad**: ADR 0017 §7's wording of the frame (§16), and whether `ready.tables` stays; the count is optional.
4. **Peach**: AC1's evidence reads "Helix and Vitals libraries shown on phone and desktop". Under Q-21 that is
   Toolshed's library end to end, and each real project's library comes with its conversion (Toad's handoff says the
   same).
