# BOB-212: each project's library on BobNet, and the project menu back

Daisy, design session `BOB-212 design A`, 2026-11-26. For R9 (R3.1). Built from BOB-212's five criteria and
Casper's words on it ("…could we maybe elavate those to bobnet project documentation? We don't actually
have a project many any longer so maybe we need to bring that back and then migrate that content to
bobnet"). Data path: Toad's ADR 0015 (`architecture/decisions/0015-project-library-from-main.md`, on v2
at 5e9fdbb). This spec is the screens; where the two meet it cites ADR 0015 §n.

Prototype: `design/BOB-212/prototype/` (open `index.html#project/helix/library`). It shows real Helix and
Vitals library content from each repo's origin/main (Helix `5474afabb`, Vitals `62e475d`), in ADR 0015's
shapes. **That content is not in this repo**: Helix and Vitals are private repos and BobNet's is public. So
`prototype/data.js` and `shots/` are git-ignored. Make them on a laptop with the clones:
`python3 -I design/BOB-212/tools/gen_data.py design/BOB-212/prototype/data.js`, then
`node design/BOB-212/tools/shots.mjs` (§12). The same goes for the deployed prototype: it should be
behind Cloudflare Access, not on an open workers.dev URL.

## 0. What changes, in short

- **The header gets a Projects menu back**, first in the tabs. It lists every project; each opens its
  page, and each with a library has a **Library** link. On a project's page the button reads the
  project's name.
- **A project's page gets two tabs, Work and Library.** Work is today's page (BOB-182), unchanged.
  Library is the project's architecture, data model, taxonomy, scenarios, decisions and the rest, read
  from the repo's main, and replaces poe's claude.ai artifacts.
- **Every library says what it shows**: "As of main at 5474afa, 26 Nov 11:49 · checked 4 min ago from
  mbp-1", and says plainly when it may be behind.
- Pages read well on a phone: sections behind one button, tables in their own sideways frame, a
  diagram fitted with Full size, and a long page with "On this page".

## 1. "The project menu": what Casper likely means (AC3, to settle with him)

**What happened.** Until 23 Nov the header had a project dropdown (`<select id="project">`) after the
tabs. It scoped Roadmap, Feature, Triage and Sessions to one project. BOB-121's revamp removed it
(spec §2.0: "The header: no project dropdown"; Luigi's e82a684, BOB-174). Each page that needs a project
got its own switch instead (Roadmap, Triage, Usage, Features, a project's page). The project pages came
in the same release (BOB-182, `#project/<key>`), but the only ways to reach one are the Overview's
Projects rows and links inside other pages. Nothing in the header leads to a project. So Casper has
project pages but no menu to them, and the library needs a home under a project.

**Three readings:**

| | Reading | What he'd see | For | Against |
|---|---|---|---|---|
| **A** (rec) | **A Projects menu in the header, to each project's page; the page gets Work and Library tabs** | "Projects ▾" first in the tabs. It lists BobNet, Helix and Vitals, each with a Library link. On Helix's page it reads "Helix ▾". | One place to go to a project, from any page. The library sits where the project is. The per-page switches stay. | One more control in the header (the tabs stay two rows on a phone, as now). |
| B | **The old dropdown back**: one project picked in the header scopes every tab, plus a Library tab | A select after the tabs: Roadmap, Features, Triage, Usage and Library show the picked project. | What he had before 23 Nov. | Overview and Needs you are across projects, so the dropdown means nothing there. It duplicates the page switches BOB-121 put in (or removes them). An 8th tab for Library. |
| C | **A Projects tab**: an 8th tab with a card per project, each opening its page with Work and Library | "Projects" beside Overview: a card per project (release, who runs, Library). | A page to browse projects. | It duplicates the Overview's Projects rows. Switching takes two taps instead of one. |

**Recommendation: A.** It brings back the menu he misses without the scope that BOB-121 removed for good
reasons, and it gives the library a place that is plainly the project's. The prototype shows A.
Casper's answer goes here, verbatim, when Mario has it (AC3's evidence).

> Casper (Q-…, date): _to come_

## 2. Where the library lives, and its links

- `#project/<key>`: the Work tab (today's page; a link to it opens it as now).
- `#project/<key>/library`: the library's home.
- `#project/<key>/library/<page-id>`: a page (ADR 0015 §6). Page ids come from the manifest
  (`overview`, `entities`, `taxonomy`, `scenarios-domain-hold-and-expiry`…).
- `#project/<key>/library/<page-id>/<heading>`: a page scrolled to a heading (the heading's slug:
  lower case, runs of anything but a-z0-9 to one `-`). Copying the address shares the spot.
- An unknown page id: the library's frame with "Helix Library has no page "x". It may have been
  renamed in .bobnet/library.json. The library's sections" (a link home).
- An unknown heading: the page from its top, nothing said.
- A project with no library: the Library tab is still there; it opens the "no library yet" state (§10).

Where else it is linked:

- The Projects menu (§3): a Library link on each project's row that has one.
- The Overview's Projects rows: "Library" under the project's name and its people line (a plain link,
  13 px, accent). None for a project without one.
- Nowhere else in this feature.

## 3. Header: the Projects menu

- **The button** is first in the tabs, before Overview: "Projects ▾". On a project's page (either tab)
  it reads the project's name, "Helix ▾", and is the current tab (white pill, as a tab's
  `aria-current`). The Overview tab is no longer lit on a project's page (this changes BOB-121 §2.0:
  "A project page highlights Overview").
- **The menu** opens under the button (340 px wide; at ≤860 px it spans the screen, 8 px in from each
  edge, under the header). One row per project, in the service's project order:
  - the name (15 px, semibold), and under it the project's one-line description in muted 12.5 px (the
    library's tagline when it has one, else the project's description; none is fine);
  - at the right, **Library** as a small outlined pill (accent text), or "no library" in muted;
  - the whole row opens the project's page; Library opens its library;
  - the project you are on has the accent left edge.
  - Foot: "Every project at a glance, on the Overview" (to `#overview`).
- **Behaviour**: a click or Enter/Space opens it and moves focus to the first row. Up/Down move between
  links, Escape closes and returns focus to the button, a click outside or on any link closes it. The
  button has `aria-expanded` and `aria-controls`.
- **Phone**: the button is one of the tab pills, so the tabs still wrap onto two rows at 390 px (shot
  01-menu-open-390). Rows are at least 52 px, the Library pill 40 px tall.
- **No counts in the menu.** Needs you, running and CI are on the Overview and the page; the menu is for
  going somewhere.

## 4. A project's page: Work · Library

- The head is as built (‹ Overview, the name, "lead · PO · laptops · repo", the project switch).
- Under it, **two tabs**: **Work** and **Library**, underlined (2 px accent under the current one, 14.5
  px, the current semibold), on a hairline that spans the page.
- **The project switch** keeps the tab: on Library it opens the other project's library at the same
  page id if it has one, else its home.
- On Library, the tab row's right end carries the freshness line (§9). On a phone it goes on its own row
  under the tabs.
- The page is `main.wide` (1320 px max) on both tabs.

## 5. The library's layout

Three columns at the widest; they fold in as the screen narrows. Nothing ever scrolls the page sideways.

| Width | Sections | Page | On this page |
|---|---|---|---|
| ≥1280 (desktop 1440) | rail, 220 px, sticky | up to 780 px reading width | a 200 px rail, sticky, the heading being read marked |
| 761-1279 (tablet 1024) | rail, 220 px, sticky | the rest | folded under the page's head: "On this page · 3 sections" |
| ≤760 (phone 390) | one button, "Section: Architecture ▾", opening the list in place | full width | folded under the head |

**Sections** (the rail):

- A label, the library's title ("HELIX LIBRARY", 11.5 px caps, muted).
- Home, then each page in the manifest's order, by its nav label. A child page (Helix's scenarios) is
  indented, with its group at the right in small caps ("DOMAIN").
- A `coming` page is muted text with "SOON" (not a link).
- A missing page is muted with "MISSING" in warn (§10).
- The current one: surface background and a 3 px accent left edge, semibold.
- Foot: "Repository ↗" (the repo on GitHub) and "Sections from `.bobnet/library.json`" (that file on
  GitHub at the commit), so whoever wants to change the list knows where.
- On a phone the button shows the current section; the list opens under it, rows 44 px, and closes when
  one is picked.

**On this page**: the page's h2 and h3 headings (h3 indented), shown when a page has 3 or more. A page of
the `table` kind (the taxonomy) has no right rail at any width: it folds under the head, and the table
gets the width.

## 6. A page

**Head**:

- An eyebrow in accent caps: the section's nav label, or for a child "Scenarios · domain".
- The title: the file's first `# ` heading (26 px, 22 on a phone). The file's own h1 isn't shown twice.
- The meta line, muted 13 px: "owner Bill · changed 3954a6c, 22 Nov · architecture/overview.md ↗". The
  last is the file on GitHub at the commit shown (§8). Wraps on a phone.

**The markdown** (rendered in the page, ADR 0015 §6; raw HTML shows as text):

- Body 15.5 px / 1.6 (15 on a phone), lines at most 72 characters.
- h2 20 px and h3 16.5 px, semibold, in the text colour. These are not style.css's h2: no caps, not
  muted. A "#" link shows on hover (none on touch) and puts the heading in the address.
- Lists keep their numbers (`start`) and nest. Inline code is mono 0.86 em in a hairline box and breaks
  anywhere. Bold is semibold.
- Code blocks: surface background, hairline, 12.5 px mono (11.5 on a phone), and they scroll sideways in
  their own box (Helix's ASCII layer diagram). They never wrap.
- Blockquotes: muted text, a 3 px line edge. An `hr` is a hairline with room.
- Images (ADR 0015 §6): only `data:` images show. A repo image is a link, "image: <alt> ↗", to it on
  GitHub.

**A long page** (Vitals' use cases is 44 KB): "On this page" is the way through. The address follows the
heading only when one is picked (scrolling doesn't rewrite it). A route to a heading lands it under the
sticky header (80 px; 140 at ≤860, where the tabs are two rows).

## 7. Tables

**In a page**:

- Every table is in its own frame (surface, hairline, 8 px radius) that scrolls sideways inside itself.
  A soft shadow at an edge says there is more that way.
- Cells wrap: at least 7 em and at most 46 ch each. The header row is 12 px muted on `--bg` and stays
  on one line.
- style.css nowraps every third cell (`td:nth-child(3)`). Inside a document that rule is undone.

**Helix's taxonomy** (`kind: table`, 850 elements in 10 area files, merged as build.py does):

- The README is rendered first. Then "All elements" (its own heading, routable as `…/taxonomy/all-elements`).
- The bar, wrapping on a phone:
  - a find box, 16 px so a phone doesn't zoom: "Find a key, element, calculation or source";
  - Area: "All areas", then each area in the manifest's order;
  - a switch: All · Stored · Derived;
  - the count: "5 of 850 elements", announced as it changes.
- Columns: Key (mono, breaks at any character, 16-30 ch), Area, Type (mono, muted), Unit, Stored or
  derived (a pill, accent when derived), Calculation, Source (muted 12.5 px).
- **A thousand rows**: the first 200 that match, then "Show the other 650". A new find or filter goes
  back to 200.
- No match: "No element matches. Clear the find or pick All areas."
- **Phone** (≤760): a row is a card (style.css's `table.stack`): the key in bold and its stored/derived
  pill on the first line, then Area, Type and Unit labelled in two columns, then Calculation and Source
  full width. An empty cell is left out.

## 8. Links and the source on GitHub

ADR 0015 §6's rule, as the reader sees it:

- **To another library page**: stays in BobNet (`#project/helix/library/<id>[/<heading>]`). Plain accent
  link.
- **To any other file in the repo**: opens it on GitHub *at the commit shown*
  (`…/blob/<commit>/<path>`), in a new tab, marked ↗. Its tooltip: "<path> on GitHub at 5474afa". The
  link always matches what the page shows, even after main has moved.
- **http(s)**: out, new tab, ↗.
- **Anything else** (mailto, javascript…): plain muted text, not a link.
- Each page's meta line links its own source, and the rail's foot links the repo and the manifest. The
  sha in the freshness line links the commit.

## 9. "As of" and staleness

**The line** (the tab row's right end; its own row on a phone):

> As of main at `5474afa`, 26 Nov 11:49 · checked 4 min ago from mbp-1

- The sha is a link to the commit on GitHub. The date is `committed_at` in Casper's zone; the age is
  `checked_at` against the broker's clock (ADR 0015 §5).
- The branch is the project's ref as the read gives it: "main" for Helix and Vitals, "v2" for BobNet.

**May be behind** (`checked_at` 2 h or more old):

- The line turns warn with a warn dot ("checked 5h ago from mbp-1").
- A banner over the page: **This may be behind main.** "mbp-1 last checked 5h ago; it checks every 10
  minutes while it runs. The pages are main at 5474afa (26 Nov)."
- If the laptop is quiet, the dashboard's quiet-laptop banner shows too (BOB-48, as built).

**The last fetch failed** (`problems` has `fetch_failed`):

- The line turns warn.
- Banner: **mbp-1 couldn't fetch helix-navigator 12 min ago.** "<its message>. The pages are main at
  5474afa (26 Nov), last checked 3h ago. They update at its next fetch."

**When main moves while a page is open** (`board_changed … library`):

- The manifest is read again, and the page if its blob changed.
- The page is redrawn at the same heading.
- A toast: "Helix's library is now main at 9c01d2e."
- Nothing else moves.

## 10. States

| State | What shows |
|---|---|
| Reading (first read) | The rail and the page as grey lines (still with reduced motion), "Reading the library…". |
| Reading a page | The rail stays. The page area reads "Reading Architecture…" over grey lines. |
| The read failed | `.banner.down`: **The library couldn't be read** "<error>" and Retry. What was read stays under it ("…from 14:02"). |
| No library | A dashed card: **Helix has no library yet.** "A library is the pages a project lists in `.bobnet/library.json` on its main: architecture, data model, decisions and the like. Its architect writes the file; the supervisor on its laptop sends the pages here." "A laptop whose supervisor is older than the release with libraries sends none." In the menu: "no library". |
| A page missing on main (`missing`) | In the rail, muted with MISSING. On the home, its card is dashed, shows its path, with MISSING, and a banner: "A page is missing on main: <path> is not on main at 5474afa." Opened: **<path> isn't on main at 5474afa.** "The library still lists it. Its owner (Bill) moves the entry in `.bobnet/library.json` or puts the file back." "Its history on GitHub ↗". |
| A page too large (`too_large`, >512 KB) | **<path> is too large to show here** (n KB). "Read it on GitHub ↗". |
| A bad manifest (`problems: manifest`) | Banner: **Helix's .bobnet/library.json couldn't be read at 9c01d2e.** "<message>. The library is as it was at 5474afa." |
| A diagram drawing | The diagram box with "Drawing the diagram…" over its source as code. |
| A diagram that can't be drawn | The box: "This diagram couldn't be drawn here. Its source is below." in warn, the source, "On GitHub ↗". (Today's Helix data model is this state: §11.) |
| A `coming` page | Muted in the rail with SOON. A dashed card on the home with its owner and "SOON". Not a link. |

## 11. Diagrams

- `mermaid` code blocks and `kind: mermaid` pages draw as an image fitted to the column, in a box:
  "Diagram" at the left of its bar, then **Full size** (natural size, scrolling inside the box, at most
  80 vh tall; the button then reads Fit) and **Source** (shows the text under it).
- Colours from style.css's tokens (surface, text, accent edges, muted lines). Light and dark are each
  drawn for the scheme in use.
- Phone: a big ER diagram fitted to 390 px is a map, not a read. Full size is the way to read it (40 px
  buttons).
- The alt text: "Diagram: <page title>. Its source is under Source."
- **Found in the prototype:** Helix's `architecture/model/entities.md` doesn't parse in mermaid 10.9.1
  (build.py's pin) or 11.4.1. Line 54 uses `to` as an unquoted relation label, and `to` is a keyword
  (`CONTRACTUAL_UNIT … : to`); it wants `: "to"`. So Helix's Data model shows the fallback until Helix
  quotes it. That is Helix's to fix (Bill's file), not BobNet's. Vitals' `.mmd` draws with 11.4.1.

## 12. Look

- BobNet's own: style.css's tokens, type and radius; the menu and cards are `.card`/surface/hairline; the
  banners are style.css's `.banner`. Nothing from the claude.ai artifacts' look (their IBM Plex, green
  palette and Google fonts) comes along.
- New rules are in `prototype/proto.css` (all but `.proto-*`), and move into style.css. Collisions with
  style.css to mind:
  - style.css's `nav` rules (at ≤860 `order: 3; width: 100%`) are the header's. The library's rail and
    the project's tabs are `<nav>` too and need `order: 0` (without it, the rail falls under the page
    on a phone).
  - `.kind` is the session-kind chip. The taxonomy's stored/derived pill is `.sd`.
  - `h2` is the small-caps section label. Document headings are restyled under `.doc`.
  - `td:nth-child(3)` is nowrap. It is undone under `.doc .tw`.
- Dark: every colour is a token; shots 02, 03, 06 and 07 are also taken dark.

**Shots** (`shots/`, 390 / 1024 / 1440, light; `-dark` four of them):
01 the menu open · 02 a library's home (full page) · 03 a long page (Architecture) · 04 a route to a
heading · 05 sections open on a phone · 06 Helix's data model (diagram fallback, real) · 07 the taxonomy ·
08 the taxonomy found and filtered · 09 a scenario (child page) · 10 Vitals' use cases (long) · 11 Vitals'
diagram drawn · 12 may be behind · 13 fetch failed · 14 a page missing · 15 no library (BobNet) · 16 the
diagram fallback · 17 reading · 18 the Work tab.

The prototype has a "Prototype: states" switch at the bottom right for §9-§10's states. It is not built.
It loads mermaid from a CDN; the build vendors it (ADR 0015 §6).

## 13. For Luigi: what the page reads (ADR 0015 §4)

- **Menu and Overview**: `projects` gains `library: {commit, checked_at, pages} | null`. Library link or
  "no library" from that.
- **The library's frame**: read `library {project}`: manifest, commit, `committed_at`, `checked_at`,
  laptop, github, problems.
- **A page**: read `library_page {project, page}`: its text, or for `table` every area's text in order.
  Read lazily, kept for the visit, read again on `board_changed` when the blob changed.
- markdown-it with `html: false`. The link rule is §8. The heading ids are §2's slug, prefixed `h-`
  in the DOM.

## 14. Open questions

1. **AC3**: Casper picks A, B or C (§1); Mario asks him. The build waits for his answer only for the
   header and tabs. The library itself is the same under all three.
2. Helix's diagram (§11): Mario passes it to Helix's lead. It isn't BobNet's to fix.
3. Is Vitals a service project on a laptop with its clone (ADR 0015, consequences)? It's poe's to check.
   Until it is, Vitals shows "no library yet".
