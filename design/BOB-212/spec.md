# BOB-212: each project's library on BobNet, and the project menu back

Daisy, design session `BOB-212 design A`, version 2, 2026-11-26. For R9 (R3.1).

**Sources:**

- BOB-212's five criteria.
- Casper's words, in `lead/bob212/frameworks-decision.md`: "some structure around architecture, data models,
  use cases, prototypes, ux design"; "Its a lot of text though"; diagrams one can "focus/zoom on details … or zoom
  out and see bigger picture"; then "Yes agreee go ahead".
- The data path and the skeleton: Toad's ADR 0015, as amended by ADR 0016
  (`architecture/decisions/0016-library-skeleton-and-zoomable-diagrams.md`), and his spike
  (`architecture/spikes/bob212/README.md`).

This spec is the screens. Where it meets the ADRs, it cites them as 0015 §n and 0016 §n.

**The prototype** is `design/BOB-212/prototype/`. Open `index.html#project/bobnet/library`. It shows:

- BobNet's own library as the target: its LikeC4 model, its ADRs, its capabilities and its UX cards, from `v2`;
- Helix's and Vitals' real library pages, from each repo's main, put into the sections as 0016 §4 maps them;
- Vitals' schema as a zoomable ERD.

**Helix and Vitals are private repos, and bobnet-mcp is public**, so `prototype/data.js`, `prototype/vendor/` and
`shots/` are git-ignored. To make them on a laptop with the clones and Toad's spike cache, see §13. Casper allowed
the deployed prototype on an open, unlisted link (Q-18, "an unlisted link is fine").

## 0. What changed since the first prototype

- **Seven fixed sections** (0016 §1): Overview, Architecture, Data model, Decisions, Use cases, UX design and
  Glossary. They are in the same order in every project. A section not written yet stays in its place, muted, with
  who writes it.
- **Less text.** Each section opens on cards or a diagram, and the prose is one tap behind:
  - the home is seven tiles;
  - the decisions are a list with each one's status;
  - the use cases are cards with their actor and goal;
  - the UX design is one card per feature, with its prototype and Casper's verdict.
- **Diagrams you can zoom.** The architecture is a LikeC4 model: click a box to drill in, and the crumb takes you
  back out. The data model is Liam's ERD: tap a table to focus it and its relations. Both work on a phone (§9,
  §10).
- The Projects menu, the Work · Library tabs, the "As of main" line and the states are as in version 1.

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
| **A** (rec) | **A Projects menu in the header, to each project's page. The page gets Work and Library tabs** | "Projects ▾" first in the tabs. It lists BobNet, Helix and Vitals, each with a Library link. On Helix's page it reads "Helix ▾". | One place to go to a project, from any page. The library sits where the project is. The per-page switches stay. | One more control in the header. The tabs stay two rows on a phone, as now. |
| B | **The old dropdown back**: one project picked in the header scopes every tab, plus a Library tab | A select after the tabs: Roadmap, Features, Triage, Usage and Library show the picked project. | What he had before 23 Nov. | Overview and Needs you are across projects, so the dropdown means nothing there. It duplicates the page switches BOB-121 put in, or removes them. An 8th tab for Library. |
| C | **A Projects tab**: an 8th tab with a card per project, each opening its page with Work and Library | "Projects" beside Overview: a card per project (release, who runs, Library). | A page to browse projects. | It duplicates the Overview's Projects rows. Switching takes two taps instead of one. |

**Recommendation: A.** It brings back the menu he misses without the scope that BOB-121 removed for good reasons.
It also gives the library a place that is plainly the project's. The prototype shows A. Casper's answer goes here,
verbatim, when Mario has it (AC3's evidence).

> Casper (Q-…, date): _to come_

## 2. Where the library lives, and its links

| Address | Opens |
|---|---|
| `#project/<key>` | The Work tab, today's page |
| `#project/<key>/library` | The library's home (§6) |
| `#project/<key>/library/<section>` | A section's first page (§7) |
| `#project/<key>/library/<section>/<page>` | One page of a section |
| `#project/<key>/library/<section>/<page>/<focus>` | A page at a spot (0016 §6) |

What the focus is depends on the kind of page:

| Page kind | The focus is | Example |
|---|---|---|
| `md` | a heading's slug | `…/architecture/overview/details-by-area` |
| `md` with use-case cards (§8) | a card's slug; opening a card writes it | `…/usecases/catalogue/uc-7-<its-title>` |
| `children` | a child, by its file name | `…/decisions/adrs/0016-library-skeleton-and-zoomable-diagrams` |
| `likec4` | a C4 view id | `…/architecture/model/boardComponents` |
| `erd` | a table name | `…/data/erd/<table>` |
| `table` | `all-elements`, the taxonomy's table | `…/data/taxonomy/all-elements` |

- **A slug** is the text in lower case, with each run of anything but a-z and 0-9 turned into one `-`.
- **Drilling into a C4 view or focusing a table adds a history entry**, so the browser's Back backs out one level.
  Opening a card only replaces the address, so Back leaves the page.
- **A heading inside a child** isn't in the address. Its "On this page" scrolls.
- **Unknown names:**
  - An unknown section or page shows the library's frame with "<Section> has no page "x". It may have been renamed in
    .bobnet/library.json." and a link to the section.
  - An unknown focus opens the page from its top, or at the start view (`view`, else `index`), and says nothing.
- **A project with no library** still has the Library tab. It opens "no library yet" (§11).

**Other links in:**

- the Projects menu (§3): a Library link on each project's row that has one;
- the Overview's Projects rows: "Library" under the name (13 px, accent).

## 3. Header: the Projects menu

As in version 1:

- **The button** is "Projects ▾", first in the tabs, before Overview.
  - On a project's page (either tab) it reads the project's name, "Helix ▾", and is the current tab.
  - The Overview tab is then no longer lit. That changes BOB-121 §2.0.
- **The menu** is 340 px wide. At ≤860 px it spans the screen, 8 px in from each edge.
- **One row per project:**
  - the name, and under it the library's tagline in muted 12.5 px;
  - at the right, **Library** as an outlined pill, or "no library" in muted;
  - the row opens the project's page;
  - the current project has the accent left edge.
- **Its foot:** "Every project at a glance, on the Overview".
- **The keyboard:** Enter or Space opens it with the focus on the first row. Up and Down move. Escape closes it and
  returns the focus to the button. The button has `aria-expanded` and `aria-controls`.
- **On a phone** the rows are at least 52 px, and the Library pill 40 px.
- **No counts.** The menu is for going somewhere.

## 4. A project's page: Work · Library

- **The head** is as built: ‹ Overview, the name, "lead · PO · laptop · repo", and the project switch. On Library
  the switch keeps the section.
- **Two underlined tabs, Work and Library.** Work is today's page, unchanged.
- **The "as of" line** is at the right end of the tab row on Library:

  > As of main at `5ed684a`, 26 Nov 18:00 · checked 4 min ago from mbp-1

  - The branch is the project's ref: "v2" for BobNet.
  - The sha links the commit.
  - On a phone the line is on its own row.

## 5. The library's layout

| Width | Sections | Page | On this page |
|---|---|---|---|
| ≥1280 (desktop 1440) | rail, 220 px, sticky | the rest. Prose up to 780 px; cards, lists and diagrams take the full width | 200 px rail, sticky, for a prose page with 3 or more headings |
| 761-1279 (tablet 1024) | rail, 220 px, sticky | the rest | folded under the page's head |
| ≤760 (phone 390) | one button, "Section: Data model ▾", opening the list in place | full width | folded under the head |

**The rail** has the library's title ("BOBNET LIBRARY", caps, muted), then:

- **Home**.
- **The seven sections, always, in the skeleton's order.**
  - A written section is its label.
  - A missing one is muted, with a second line in 11.5 px: "not written yet · architect". The owner *role* comes from
    the skeleton (0016 §1, §3).
  - The current section is semibold with a 3 px accent edge. When it has more than one page, those pages are
    indented under it, and the current page gets the edge.
- **The foot**: "Repository ↗" and "Sections from `.bobnet/library.json`", linked at the commit.

**On a phone**, the button names the section. Its list opens under it, with 44 px rows. The section's own title
isn't repeated under the button; only "owner Galen" shows.

## 6. The home: seven tiles

- **The head**: the library's title (26 px) and its tagline (muted 16 px).
- **Then a tile per section, in the skeleton's order.** The grid is `auto-fill, minmax(240px, 1fr)`: 4 across at 1440
  and 3 at 1024. A phone has one column.
- **A written tile** (a link to its section) has:
  - the label (16 px semibold);
  - up to 3 lines, one per page. Each is a kind tag in 10.5 px accent caps, then the page title:
    - **C4 DIAGRAM** BobNet in C4
    - **ERD** Schema
    - **TABLE** Taxonomy
    - **PAGE** Data dictionary
    - a children page: its count, then the most recent child, e.g. **16 DECISIONS** latest: A project's library: a
      fixed skeleton…, or **10 FEATURES** latest: Usage, from a session's bar to its agents
  - at the foot, the owner (the manifest's person, else the role) and "changed 26 Nov", the newest page.
- **A missing tile** has a dashed edge on no fill. Its label is muted, then "Not written yet", then "the architect
  writes it". It still links to its section (§7, missing).
- **Under the tiles**, in muted 13.5 px: "5 of 7 sections written. Each is files on v2 in cath42/bobnet-mcp; to change
  one, ask its owner."

## 7. A section

- **The head**: the section's label (26 px; 22 px on a phone, where it is hidden behind the picker), then "owner
  Toad" in muted 13 px.
- **Its pages as underlined tabs** when it has more than one, as Vitals' Data model has: Schema · Entities and
  relations · Data dictionary.
  - The first page opens by default.
  - On a phone the tabs scroll sideways inside their row.
- **Then the page**, drawn by its kind:

| Kind | Drawn as | § |
|---|---|---|
| `likec4` | the C4 frame | §9 |
| `erd` | the ERD frame | §10 |
| `children` in Decisions | the decision list | §8 |
| `children` in UX design | the UX cards | §8 |
| `children` in Use cases (or anywhere else) | a card per file | §8 |
| `md` in Use cases, with 3 or more `###` cases | use-case cards | §8 |
| `md`, `mermaid`, `table` | prose, a small diagram, the taxonomy, as in version 1 | §12 |

- **A prose page's head** is one line, under the section's tabs: the page title (15 px semibold), then "changed
  `cd9d226`, 22 Nov · path ↗". The owner shows only when it differs from the section's.

**A missing section** (absent, or with no pages; 0016 §3) keeps its place and its address:

> **UX design isn't written yet.**
> It holds: one card per feature: its spec, its prototype, and Casper's verdict with its date.
> The designer writes it, as files on main, and lists them under `sections.ux` in `.bobnet/library.json ↗`.

- It is a dashed card, left-aligned. The "holds" line is the skeleton's (below), in the page's words.
- When the manifest names the section's owner, it reads "The designer writes it (Daisy)".

| Section | Holds (the page's wording; the ids and roles are 0016 §1's) |
|---|---|
| Overview | Goals, scope, constraints and quality goals. |
| Architecture | The C4 model, from context to containers to components, and how the parts run and deploy. |
| Data model | The schema as a diagram, the data dictionary and the taxonomy. |
| Decisions | One record per decision: its context, the options, the decision, its consequences and its status. |
| Use cases | One card per use case, with its scenarios under it. |
| UX design | One card per feature: its spec, its prototype, and Casper's verdict with its date. |
| Glossary | Terms in users' words. |

## 8. Cards: the prose behind them

### 8.1 A card's head

A child file's head is read from one of two places:

- **Front matter**: `key: value` lines between `---` lines at the top (0016 §2).
- **Otherwise, the `Key: value` lines right under the file's `# ` title, up to the first blank line.** They may be
  written as `Key: value`, `**Key:** value` or `- **Key:** value`. An indented line continues the value above it.
  This is what Helix's and Vitals' ADRs already have:

  ```
  Date: <day>
  Status: accepted (<day>; Q-<n>) …
  Decided by: Casper
  ```

  BobNet's ADRs have the same thing as `- **Status:** accepted (Toad, 2026-11-26), …`. So 129 ADRs become a list
  without being rewritten. **This is a proposed addition to 0016 §2, for Toad** (§14).

**The status word** is the first word of `status`, shown as a pill (11.5 px, 1 px border in its colour):

| Colour | Words |
|---|---|
| ok | accepted, handled, built, approved, done |
| warn | proposed, partly, waiting, draft, designing |
| muted | not yet, superseded, rejected, deprecated, and any other word (cut to 12 characters) |

The rest of the status line shows on the child's page.

### 8.2 Decisions: the list

Shots 08, 14.

- **The bar**:
  - "Find a decision" (16 px, so a phone doesn't zoom). It searches the number, title, status, decider and the
    record's first 4,000 characters.
  - The statuses that occur, each with its count: "All 117 · Accepted 113 · Proposed 1 · Rejected 1 · Superseded 1".
    It shows only when there are two or more.
  - The count: "117 decisions, newest first", or "3 of 117 decisions" while finding.
- **One row per record, highest number first**, in one hairline-framed list:
  - the number (muted, tabular);
  - the title, without its "0016." or "ADR 0008:" prefix;
  - the status pill;
  - the date ("26 Nov 2026": the `date` field, else the first date in the status);
  - who decided (`decided by`, else the name that opens the status's brackets).
- **At ≤760** a row is two lines: the number, the pill and the date, then the title. "Who" goes.
- **The first 40 rows show**, then "Show the other 77". A new find or filter goes back to 40.
- **No match:** "No decision matches. Clear the find or pick All."
- **A row opens the child page** (§8.5).
- **A Decisions section with an index page** (Helix's decisions index, Vitals' README) shows it as the
  section's first tab, and the list as the second.

### 8.3 UX design: a card per feature

Shot 10.

- The cards are in a grid (`minmax(280px, 1fr)`), newest feature first, under "10 features, newest first".
- **Each card has:**
  - the feature id (accent) and its status pill;
  - the title, from the spec's `# ` line, without "BOB-211 design A:" and capitalised;
  - **the verdict**: Casper's words in quotes, then "Casper, Q-17 · 26 Nov". Waiting reads "Waiting on Casper's
    verdict" in warn. With no verdict on the card, it reads "No verdict on the card yet" in muted;
  - **Spec**, which opens the spec as the child page, and **Prototype ↗**, the link, in a new tab. Both are 36 px
    buttons, 44 px on touch.
- **The template** is mine to set (0016 §2). Each feature's `design/<feature>/spec.md` opens with:

  ```
  ---
  feature: BOB-211
  status: built            # designing | waiting | approved | built
  prototype: https://bobnet-prototype-bob-211.casper-cth.workers.dev
  verdict: Build it as shown
  verdict by: Casper, Q-17
  verdict date: 2026-11-26
  ---
  ```

  The prototype fills BobNet's ten cards from the board: Q-13 for BOB-121, Q-17 for BOB-211, and BOB-212 waiting.
  The other seven have no verdict on record, so they read "No verdict on the card yet". Adding the front matter is
  BobNet's own conversion item, and mine.
- The UX section lists only the specs. That needs a file pattern on `children` (§14).

### 8.4 Use cases: cards

Shots 11, 15, 20, 21.

**A use-case page** is an `md` page in Use cases with 3 or more `###` headings, such as Vitals' catalogue (34 use
cases) or a Helix scenario file (20 cases). It shows as cards:

- **The bar**: "Find a use case" (or "Find a case" in a scenario file), the status filter when the cases have a
  `Status`, and "34 use cases in 10 groups".
- **"About this page"**: the text before the first `##`, folded in a hairline box.
- **Each `##` is a group**: its title (15 px semibold) and its count. Its `###` cases are cards in a grid
  (`minmax(300px, 1fr)`; one column on a phone). A `##` with no cases under it is a folded box with its prose, such as
  an opening walk-through.
- **A card's face:**
  - its title (15 px semibold) and, when it has a `Status`, the status pill;
  - up to 3 fields, label then value. They come from the leading `- **Key:** value` lines, which may hold several
    fields joined by " · ". Actor, Door, Goal, Case and Expected come first; otherwise the first fields other than
    Status. A value is cut at about 150 characters;
  - the fold, named by what is behind it: "<the other fields' names, joined by ·>". Opening it shows the
    whole case and puts the case in the address.
- **The find** searches each case's title and text. The count reads "3 of 34 use cases", and a group with no match
  hides.

**A Use cases `children` page** (Helix's scenarios, BobNet's capabilities) is a card per file:

- the file's title;
- its first sentence (muted, about 170 characters);
- "20 cases", "6 criteria" (the items under `## Criteria`) or "a page", then the owner and "changed 22 Nov".

The folder's README sits behind "About scenarios". A file with 3 or more cases opens as cards; any other file opens
as prose.

### 8.5 A child's page

Shot 09.

- **"‹ Architecture decisions"** (back to the list), then the title (21 px).
- **Its head:**
  - for a UX card: the pill, the verdict and Prototype ↗;
  - for any card: every field in a hairline box, label (8.5 em) then value, with the status pill before the status
    line.
- **The meta line**: "owner Bill · changed `cd9d226`, 22 Nov · path ↗".
- **Then the prose, without the head lines.** "On this page" works as on any prose page, by scrolling (§2).

## 9. Architecture: the C4 frame (LikeC4)

Shots 03-07, 23, 24.

**The bar, above the frame:**

- **The crumb**, one link per level, named by its element: "Context › BobNet › Broker › **Board object**".
  - The levels come from the model: each view's element and the views of its ancestors.
  - The current level is bold.
  - Under the crumb, in muted 13 px, the view's own title: "Board object: components". It is hidden on a phone.
- **At the right:**
  - **↑ Out**: one level up. It is disabled at the context.
  - **Fit**: the whole view in the frame.
  - **Full screen**.

**The frame** is a hairline box on the surface, with the radius:

| Width | Height |
|---|---|
| ≥1280 | `clamp(420px, 100vh − 290px, 760px)` |
| 761-1279 | 62 vh |
| ≤760 | 64 vh, at least 380 px |

**In the frame:**

- **Pan and zoom** by drag, wheel and pinch.
- **A box with its own view has LikeC4's ⤢ "Navigate to view" button.** It drills in, the crumb follows, and the
  address gains the view (§2).
- **Any other box** opens LikeC4's details on click: its description, technology, relations and its views.
- **A relation's label** opens what it links.
- **A double-click** focuses an element: the rest dims.
- **A dynamic view** ("A land") has LikeC4's step-through.

**LikeC4's own top panel** (its logo, back and forward, title and view switch) is hidden: BobNet's bar has these.
So are its search, notation legend and "compare with auto layout". The model's colours and shapes are its own: the
architect chooses them in the `.c4` files. The rest is the dashboard's, and LikeC4 follows the system's light or
dark.

**Under the frame:**

- "6 VIEWS" and a chip per view. The current one is in accent, and a dynamic view is marked "· steps". A chip goes
  straight to that view, a history entry.
- "Model: architecture/model/bobnet.c4 ↗ · drawn here by LikeC4, from main at 0a8fbe3" (muted 12.5 px; every file of
  the model, linked at the commit).

**On a touch screen** (`pointer: coarse`):

- The frame is covered by **"Tap to explore"**, an accent pill, with "Then pinch to zoom, drag to move, tap a box to
  open it" under it. So a finger on the page scrolls the page and never gets caught in the diagram.
- A tap hands the frame the finger, and **Done** appears in the bar to give it back.
- The bar's buttons and the chips are 40 px.
- **Full screen is the way to read a big view on a phone** (shot 07). The bar, the frame and the chips fill the
  screen, the page doesn't scroll behind it, and Close or Escape leaves.

**States:**

| State | What shows |
|---|---|
| Drawing | Over the frame, on the surface: **Drawing the model…**, "The first time on this device, the viewer downloads (2.4 MB).", and three grey lines. It is about 0.3 s on a desktop once the viewer is cached (0016 §6). |
| No answer in 15 s | The frame is replaced by a dashed card: **This model couldn't be drawn here.** "The viewer didn't answer within 15 seconds." It lists the model's files with GitHub links and sizes, and has **Try again**. |
| Errors, nothing drawn | The same card: "The viewer found errors in it:", then each as "bobnet.c4 line 54: Could not resolve reference to Element named 'bobnet.brokr'" in warn. (The prototype's example.) |
| Errors, a model drawn | The frame shows. Above it, a warn line: "2 problems in the model: what they touch may be missing" opens the same list. |
| Too large (`too_large`, 0016 §5) | **This model is too large to show here** (n files, n KB), and its files on GitHub. |

## 10. Data model: the ERD frame (Liam)

Shots 18, 19.

**The bar**: "All 10 tables" › **<table>** (the focused table), with Fit and Full screen at the right.

**In the frame:**

- Liam's canvas: pan, zoom and pinch.
- **A click on a table focuses it.**
  - It and its relations light in accent, and its detail pane opens at the right: columns, keys, not-null and
    related tables.
  - The address gains the table, so a table can be linked.
  - Liam's own bottom toolbar stays: zoom, fit, tidy up, and "show": table name, keys or all columns.

**Under the frame:**

- "FOCUS A TABLE" and a chip per table (mono 12.5 px). A chip focuses its table, and a second tap clears it.
- "Schema: database/schema/schema.sql ↗ · drawn here by Liam ERD, from main at 62e475d".

**Touch, full screen, the frame's heights and the states** are as in §9, with "the schema" in place of "the model",
and 1.3 MB. An ERD's errors are the parser's, by line ("schema.sql line 12: syntax error at or near "CONSTRAINT"").

**Liam's look, mapped to style.css** (0016 §6; Toad's finding 2). The override is
`design/BOB-212/tools/erd-theme.css`. The vendoring tool appends it to the viewer's `<style>`. How it works:

- **The frame can't read the dashboard's variables** (an opaque origin). So the file opens with style.css's tokens as
  literals, `--bn-bg`, `--bn-surface`, `--bn-text`, `--bn-muted`, `--bn-line`, `--bn-accent` and the rest, light
  and then under `prefers-color-scheme: dark`. The tool writes those two blocks from style.css's `:root` when it runs,
  so a token change follows at the next vendoring.
- **Then Liam's variables (Liam 0.7.24) are mapped to them:**

| Liam | BobNet |
|---|---|
| `--global-background`, `--pane-muted-background`, the canvas (`--xy-background-color-default`) | `--bg` |
| `--global-muted-background`, `--pane-background`, `--node-background`, buttons | `--surface` |
| `--global-foreground`, `--global-body-text`, `--node-foreground`, and `--overlay-5…100` (Liam's text is white at an alpha) | `--text`, at the same alphas |
| `--global-mute-text`, `--node-action` | `--muted` |
| `--global-border`, `--pane-border`, `--node-border`, the canvas dots | `--line` |
| `--primary-*` (Liam's green #1DED83), `--node-selected`, `--node-layout` (a focused table's relations) | `--accent` |
| `--main-font`, `--message-font` | style.css's system font stack (Liam's is Times in a sandbox: its Google font can't load) |
| `--code-font` | the dashboard's mono stack |

- **React Flow's own variables** are set again on `.react-flow.dark`, because Liam runs React Flow in its dark mode.
- **What is hidden:** Liam's one `<header>`. That is its logo and title, its Search (⌘K), GitHub, release notes,
  help, Export and Copy Link. In a sandbox with no network the links and Copy Link do nothing, and BobNet's bar has
  the table finder. It is selected by element, never by Liam's hashed classes (`_wrapper_j2hiu_1`), which change
  with each release.
- **What is left of Liam's own colour:** the glow on a focused table's relations is a literal `#1DED83` in Liam's
  script (29 places), not a variable. The tool should replace it with the accent in the bundle before it hashes it.
  The prototype doesn't, so a faint green glow shows. Shots 18 and 19 show light and dark.

## 11. States

| State | What shows |
|---|---|
| Reading (first read) | The rail and seven tiles as grey shapes, still under reduced motion, and "Reading the library…". |
| The read failed | `.banner.down`: **The library couldn't be read**, the error, and Retry. What was read stays under it. |
| No library | A dashed card: **BobNet has no library yet.** "A library is a project's architecture, data model, decisions, use cases, UX design and glossary, from files on its main that `.bobnet/library.json` lists. Its architect writes that file; the supervisor on its laptop sends them here." "A laptop whose supervisor is older than the release with libraries sends none." The menu reads "no library". |
| May be behind (`checked_at` 2 h or more) | The "as of" line turns warn with a dot, and a banner: **This may be behind main.** "mbp-1 last checked 5h ago; it checks every 10 minutes while it runs. The pages are main at 62e475d (22 Nov)." |
| The last fetch failed | The line turns warn, and a banner: **mbp-1 couldn't fetch helix-navigator 12 min ago.** "<its message>. The pages are main at 5ed684a (26 Nov), last checked 3h ago. They update at its next fetch." |
| Main moved while open | The page is redrawn at the same spot, and a toast: "Helix's library is now main at 9c01d2e." A diagram already open isn't redrawn until the reader leaves it, or presses Try again. |
| A page missing on main | A banner: **A page is missing on main.** "<path> is not on main at 5ed684a." The page itself: **<path> isn't on main at 5ed684a.** "The library still lists it. Its owner (Bill) moves the entry in `.bobnet/library.json` or puts the file back." "Its history on GitHub ↗". Its tab is marked "missing" in warn. |
| A missing section | §7. |
| A bad manifest (`problems: manifest`) | A banner: **Helix's .bobnet/library.json has a problem at 9c01d2e:** "<message>". That section or page is left out and the rest shows (0016 §2). |
| A diagram drawing, failing or with errors | §9. |
| A small (mermaid) diagram that can't be drawn | As in version 1: "This diagram couldn't be drawn here. Its source is below." Helix's `entities.md` line 54 is still this state until Helix quotes `to`. |

## 12. Prose pages, tables, links and small diagrams

These are unchanged from version 1. In short:

- **The markdown** is rendered in the page with markdown-it (`html: false`; raw HTML shows as text).
  - Body text is 15.5 px / 1.6, at most 72 characters a line.
  - Headings are restyled under `.doc`: not style.css's small-caps `h2`.
  - A heading shows "#" on hover, which puts it in the address.
  - Code blocks scroll sideways in their own box.
  - Only `data:` images show. A repo image is a link to it on GitHub.
- **A table** sits in its own frame that scrolls sideways. Its cells wrap between 7 em and 46 ch, and style.css's
  `td:nth-child(3)` nowrap is undone.
- **Helix's taxonomy** (`table`, 850 elements) has a find box, Area, All · Stored · Derived and the count.
  - It shows the first 200 rows, then "Show the other 650".
  - On a phone each row is a card (`table.stack`).
- **The links:**
  - to another library page or child: it opens in place;
  - to any other file in the repo: it opens on GitHub at the commit shown, in a new tab, marked ↗;
  - http(s): it opens in a new tab;
  - anything else is plain text.
- **A mermaid block** (0015 §6, mermaid pinned to 11.x) is drawn as an image fitted to the column, with Full size and
  Source. It stays for small diagrams; zoomable ones are §9 and §10.

## 13. Look, the prototype, and the shots

- **The look is BobNet's own:** style.css's tokens, type, radius, `.card`, `.seg`, `.banner` and buttons. New rules
  are in `prototype/proto.css` (all but `.proto-*`), and move into style.css. Dark is every colour as a token, and the
  frames follow the system's scheme too.
- **Collisions with style.css** (as in version 1):
  - `nav` at ≤860 px. The rail and the section tabs are navs and need `order: 0`.
  - `.kind`: use `.st` for status pills and `.sd` for the taxonomy.
  - `h2` caps.
  - `td:nth-child(3)` nowrap.
- **The prototype's own:**
  - "Prototype: states", at the bottom right, switches §11's states, a diagram that never answers, and one with
    errors. It is not built.
  - It loads mermaid from a CDN.
  - The frames are served by the shots' server with the viewer CSP of 0016 §6, and by the deployed worker the same
    way (`_headers`).
- **To make the git-ignored parts** on a laptop with the clones and `~/.cache/bobnet-spikes/bob212`:
  - `python3 -I tools/gen_data.py prototype/data.js <spike>/private-vitals/frame-erd/schema.json`
  - the C4 viewer: esbuild `tools/likec4-viewer.jsx` with the spike's flags, then
    `architecture/spikes/bob212/pack-viewer.mjs` → `prototype/vendor/likec4-viewer.html`
  - `node tools/pack-erd.mjs <@liam-hq/cli 0.7.24>/dist-cli/html prototype/vendor/erd-viewer.html`
  - `node tools/shots.mjs`

**Shots** are in `shots/`, at 390, 1024 and 1440, light, with `-dark` for some:

| | | | |
|---|---|---|---|
| 01 the menu open | 02 BobNet's home (dark too) | 03 the C4 context (dark too) | 04 drilled to the Board object (dark too) |
| 05 the containers | 06 a phone, exploring | 07 full screen | 08 BobNet's decisions (dark too) |
| 09 an ADR opened | 10 the UX cards (dark too) | 11 BobNet's capabilities | 12 a missing section |
| 13 Helix's home | 14 Helix's 117 decisions | 15 a Helix scenario file as cards | 16 the taxonomy |
| 17 Vitals' home | 18 Vitals' ERD (dark too) | 19 a table focused (dark too) | 20 Vitals' use cases |
| 21 a use case opened | 22 a prose page | 23 a diagram drawing | 24 a diagram with errors |
| 25 may be behind | 26 fetch failed | 27 a page missing | 28 no library |
| 29 reading | 30 the sections open on a phone | 31 the Work tab | |

**What each project shows** (0016 §4, as the prototype maps it):

| Section | BobNet (v2, 0a8fbe3) | Helix (main) | Vitals (main, 62e475d) |
|---|---|---|---|
| Overview | `product/requirements/README.md` | not written yet | not written yet |
| Architecture | **LikeC4**: `architecture/model/` | `architecture/overview.md` | `docs/library/architecture.md` |
| Data model | not written yet | `entities.md` (its mermaid fails, §11); the taxonomy table | **ERD**: `schema.sql`; `data-model.mmd`; the data dictionary |
| Decisions | 16 ADRs, `children` | `decisions-index.md`; 117 ADRs, `children` | `docs/decisions/README.md`; 11 ADRs, `children` |
| Use cases | 11 capabilities, `children` of `product/requirements` | `scenarios/`, `children` (1 file, 20 cases) | `use-cases.md`, as cards (34) |
| UX design | 10 features, `children` of `design/*/spec.md` | not written yet | not written yet |
| Glossary | not written yet | not written yet | `glossary.md` |

Each repo's ADR folder as a `children` page is 0016 §2's own example for Vitals, and the same for Helix and BobNet.
It costs no rewriting (§8.1).

## 14. For Luigi and Toad

**What the page reads** (0015 §4, 0016 §5):

- `library {project}`: the manifest, resolved, with the commit, `committed_at`, `checked_at`, the laptop, github
  and problems.
- `library_page {project, section, page}`:
  - the text;
  - every area's text for `table`;
  - every child's path and text for `children`;
  - `files: [{path, text}]` for `likec4` and `erd`.

  The home's tiles need only the manifest, plus the children's titles and dates.

**What the prototype found that 0016 doesn't say yet.** These are proposals, Toad's to rule on:

1. **Card heads from the lines under the title** (§8.1), as well as front matter. Helix and Vitals already write ADRs
   that way.
2. **`children` needs a file pattern**: `"match": "*/spec.md"` for the UX cards in `design/`, and `^\d{4}-` to leave a
   folder's README out. Without it every review file is a card. The prototype uses `match` and `skip`.
3. **Two more messages from the page to a viewer:** `{t: "focus", focus}`, so BobNet's crumb, ↑ Out and the chips can
   move it without sending the files again, and `{t: "fit"}`.
4. **`ready` carries what the bar needs:** `views: [{id, title, label, crumb, dynamic}]` for LikeC4 and
   `tables: [names]` for an ERD. The page parses nothing; the viewer does.
5. **The LikeC4 viewer's settings:**
   - `controls={false}`, `showNavigationButtons={false}`, `enableSearch={false}`, `enableNotations={false}`,
     `enableCompareWithLatest={false}`;
   - details, relationship details, focus mode and the dynamic step-through on;
   - `injectFontCss={false}`.

   The source is `tools/likec4-viewer.jsx`.
6. **The ERD viewer's focus** is Liam's own `?active=<table>`. The preamble reads it (wrapping `pushState`) and writes
   it (`pushState` and a `popstate`): `tools/pack-erd.mjs`.
7. **The vendoring tool replaces Liam's literal `#1DED83`** before hashing (§10).

## 15. Open questions

1. **AC3**: Casper picks A, B or C (§1); Mario asks him. Only the header and the tabs wait for his answer.
2. **Toad**: §14's proposals 1, 2 and 7 change 0016 §2 and §7. Proposals 3 to 6 are the viewers' messages.
3. **Peach**: BobNet's Use cases are its capability files (`product/requirements/*.md`), as cards with their criteria
   count. Are those BobNet's use cases, or should Peach write use-case cards? It is BobNet's own conversion item
   either way.
4. Helix's mermaid (§11, line 54's `to`) is Helix's to fix. Mario passes it to Helix's lead.
