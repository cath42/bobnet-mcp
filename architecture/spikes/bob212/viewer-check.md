# BOB-212: off-the-shelf DBML viewers, checked (Toad, 2026-11-27)

Casper asked "Is that a custom build? I wanted to try and stick to some good frameworks", and agreed that DBML stays
the open foundation and we check off-the-shelf viewers first (`lead/bob212/frameworks-decision.md`). A two-hour
time box. Q-23 waits on this.

## The answer

**None passes. Keep our thin layer on React Flow + dagre + `@dbml/parse`** (ADR 0017 §7). Those three are the
frameworks: React Flow (MIT, 12.x, what Liam, ChartDB and many ERD tools draw with), dagre (MIT, the layout drawDB
also uses) and `@dbml/parse` (Apache-2.0, Holistics' own DBML parser). Ours is the ~230 lines that join them. DBML
stays the source, so a viewer that passes later can replace ours without touching any project's library.

The nearest is **drawDB**: it has a per-table toggle on the node, but it hides only the columns that aren't keys,
only in its editor (not read-only), only on hover (a mouse), drops our DiagramViews, and its page doesn't fit a phone.

## The needs

1. **Per entity:** ONE table's columns shown or hidden on the diagram, the others unchanged (Q-22). Tried, not read.
2. **Reads DBML**, our `data-model.dbml` standard (ADR 0017) with its `DiagramView`s, or an equivalent.
3. **Embeds under ADR 0016/0017 §6/§7:** a sandboxed iframe from `/vendor`, no network, our CSP (no eval), no account
   or server.
4. **A phone** (tap), and **maintained** (licence, last release).

## The table

| Candidate | 1. Per entity | 2. DBML + views | 3. Embeds | 4. Phone; maintained |
|---|---|---|---|---|
| **drawDB** (`drawdb-io/drawdb`, AGPL-3.0, v1.9.0 2026-11-01) | **Partial, fail.** Tried: hovering `loan` shows a ▴ on its head, "Collapse unlinked columns". It hid 4 of loan's 9 columns; the 5 keys stay. Then `member`: 2 of 7 stay. Others unchanged. Never names only. The button is `disabled` when read-only (`Table.jsx:98`, `layout.readOnly`) and shown only on hover (`group-hover:flex`). Nothing re-lays the diagram out on a toggle (not tried: it only shrank here). | **Fail.** Imports Toolshed (9 tables, 15 refs) but ignores both DiagramViews: "Views (0)" is SQL views; `utils/dbml/` has no TableGroup or view handling. | **Fail as is.** Loads under our CSP with no eval (`connect-src 'none'`), but pulls Font Awesome and Bootstrap Icons from CDNs (blocked), is a whole editor (24 MB `dist`), stores in IndexedDB, imports by an upload dialog: no way to hand it a file by message without forking it. | **Fail.** At 390 px the editor's side panel fills the screen and the canvas is off it; the toggle needs hover. Active (40k stars, pushed 2026-11-25). AGPL-3.0: vendoring it makes our page's licence question too. |
| **ChartDB** (`chartdb/chartdb`, AGPL-3.0, v1.21.0 2026-11-01) | **Fail.** Tried: with Toolshed (≤ 9 columns a table) there is no control on any node. Its only one, "Show More / Show Less", appears above 10 columns and toggles between the first 10 (keys first) and all (`table-node.tsx:291`, `TABLE_MINIMIZED_FIELDS = 10`). Never names only. | **Fail.** Tried: rejects Toolshed, "Line 117: A custom element can only appear in a Project" (the first `DiagramView`; its `@dbml/core` is 3.14). With the views stripped it imports 9 tables and 15 relations. It strips TableGroups by regex (`dbml-import.ts:75`). | **Fail as is.** An inline script (CSP needs a hash or `unsafe-inline`), Google Fonts, Fathom analytics, a GitHub-buttons iframe; a full editor with a start wizard. | Desktop editor; not tried at 390. Active (23k stars). AGPL-3.0. |
| **Azimutt** (`azimuttapp/azimutt`, MIT) | **Pass on paper, not tried.** Per-table "Collapse table" in the node's context menu and a hotkey (`TableContextMenu.elm:76`, `Hotkey.elm:166`). A right-click, not a tap. | **Fail.** Imports DBML through `libs/parser-dbml` on `@dbml/core` 3.9.0, which rejects `DiagramView` (as ChartDB's 3.14 does). It has its own layouts instead. | **Fail.** The Elm app is served by its Phoenix backend (`/embed` is `ElmController.embed`) and reads projects from `/api/v1/organizations/…`. A server and accounts; not a static `/vendor` file. | No GitHub releases; the last commits (2026-08-25, 06-20) are billing and admin fixes. Context menus, not taps. |
| **Liam ERD** (`liam-hq/liam`, Apache-2.0) | **Fail.** Tried in v3/v4 (ADR 0017 §7, `9f2c8f1`): its show mode (table names, keys, all columns) is one for the whole diagram. | Via our `dbml-to-liam.mjs`, no views. | Passed our CSP in v4 (2.9 MB with its parser). | CLI release 2025-11-25; active repo. |
| **dbml-view** (`adawolfa/dbml-view`, MIT) | **Fail.** No collapse or expand of a table on the diagram (source: only group bounding boxes). | Reads DBML (`@dbml/parse` 8). | Custom elements, could be vendored. | One author, 0 stars, last push 2026-05-26; "Diagram rendering is meh" (its README). |
| **erd-editor** (`dineug/erd-editor`, MIT, v5.1.1 2026-11-26) | **Fail.** Collapse is only in its explorer tree (`explorerSearch.ts`), not on a table node. | Imports DBML into its own schema (`convertSource.ts:24`); no views. | A web component; an editor, not a viewer. | Active. |
| dbdiagram.io, dbdocs.io | Not open source; SaaS. Out. | | | |
| `dbml-renderer` (static SVG), Mermaid `erDiagram` | Static pictures, no toggle at all. Out. | | | |

Not checked in the time box: building Azimutt locally, Liam's newest release for a per-table mode, other
React-Flow ERD components (their per-table toggles would be ours to write anyway).

## Why ours stays

- Need 1 is the one that matters to Casper, and only drawDB comes near. Making it pass means forking a 24 MB AGPL
  editor: removing the key-keeping rule, enabling the toggle read-only, showing it without hover, adding a re-layout,
  reading DiagramViews, a message API, the CDN fonts and the phone layout. That is more custom work than ours, on
  someone else's code, under the AGPL.
- Every app here bundles an editor, a store and a start wizard; BobNet only shows the file. Ours is the viewer part
  alone: 0.96 MB, one CSP hash, no eval, tapped and clicked on the node (shots in `shots-per-entity/`).
- The parts it stands on are the frameworks the others use: React Flow (Liam, ChartDB), dagre (drawDB) and
  `@dbml/parse` (Holistics' parser for its own language; ChartDB and dbml-view use it too).

## What changes

Nothing in ADR 0017 or build B. ADR 0017 §7 gains one line pointing here as the record that off-the-shelf viewers were
checked first, and that a viewer passing needs 1–4 later may replace ours, since DBML is the source.

## Evidence

In `viewer-check/` (the apps built from their GitHub sources of 2026-11-27, served with our viewer's CSP and
`script-src 'self'`; Toolshed's `sample/library/data-model.dbml`; Playwright on chrome-headless-shell):

- `drawdb-1280-a-imported.png`: Toolshed imported, before layout.
- `drawdb-1280-c-member-collapsed.png`: laid out (its "Layered, left to right"), `loan` and `member` toggled; their
  key columns stay.
- `drawdb-390-a-imported.png`: at 390 px the canvas isn't on screen.
- `chartdb-1280-2-pasted.png`: Toolshed refused at line 117, the DiagramView.
- `chartdb-1280-noviews-3-diagram.png`: views stripped, imported; no control on any node.
- `drawdb-trial.mjs`, `chartdb-trial.mjs`: the trials. `node drawdb-trial.mjs <drawdb/dist> <dbml> <out> [w h]`
  with `TOOLS` and `EXE` as in `README.md`.

The sources and builds are in `/tmp/bob212vc` and not kept.
