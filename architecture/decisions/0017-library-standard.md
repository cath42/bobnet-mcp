# 0017. The library standard: one source format and one place per section, the same in every repo

- **Status:** accepted (Toad, 2026-11-26), for BOB-212 (R9), after Casper's Q-21 answer
  (`lead/bob212/frameworks-decision.md`, last section, at `52d8509`): "make it consistent for all and prototype using a
  sample … im looking for standards and frameworks not 'work with what I've got' please".
- **The author's guide** is `architecture/library-standard.md`: every file's template and rules. It is part of this
  decision; changing it takes an amendment here.
- **The sample** is `architecture/spikes/bob212/sample/`: a fictional project, Toolshed, written to the standard. It
  draws in both viewers (§7).
- **What it replaces:**
  - in 0016: §2 (the manifest), §4 (build.py's pages onto the sections) and §5 (the sources), the page-kinds column
    of §1, `about`, and the build tasks;
  - in 0015: §3 (the manifest in each repo), and the `manifest` of §4's `library` op;
  - in 0016 §6 and §7: the ERD viewer's parser and CSP, and its messages gain the diagram and its toggle.
- **What stands:** 0015 §1 (the supervisor fetches and sends), §2 (the blob cache), §5 (staleness) and §7 (what rides
  what); 0016 §1's seven sections, their order and owner roles, §3's missing-section state, and §6's sandboxed
  viewers, their CSP and messages, apart from the changes in §7 here.

## Context

- **What 0016 did.** Each repo kept `.bobnet/library.json`, a manifest that mapped whatever files it had onto the
  seven sections: `children` dirs with globs, Helix's `table` areas, `mermaid` pages, a Postgres `erd` with an
  `about` file. So each repo drew differently, and the manifest was build.py's mapping again (0016 §4).
- **What Casper said** (Q-21): the data model was all tables or all tables with attributes, and he wanted to toggle
  that per diagram. And: one consistent standard for all, prototyped on a sample, not on the projects' repos.
- **What the formats must carry.**
  - Data model: entities, attributes (type, key, nullable, unique, default), relations with cardinality, and
    descriptions on tables and columns, which the entity card shows. Named diagrams, each with its own toggle.
  - Everything: written by agents from a template, readable as plain text on GitHub, and parsed in the browser
    under the viewers' CSP (0016 §6).

## Decision

### 1. The standard: one file or folder per section, under `library/` at the repo's root

| Section | Where, on main | Format | Framework | Owner role |
|---|---|---|---|---|
| `overview` | `library/overview.md` | Markdown, front matter, fixed headings | arc42 §1, 2, 10 | product owner |
| `architecture` | `library/architecture/*.c4` | LikeC4, with the standard's `spec.c4` | C4 levels 1-3; arc42 §3, 5, 6, 7 | architect |
| `data` | `library/data-model.dbml` | DBML, one file | ER model; a `DiagramView` per diagram | architect |
| `decisions` | `library/decisions/NNNN-slug.md` | ADR: Markdown, front matter, fixed headings | ADRs, MADR's front matter; arc42 §9 | architect |
| `usecases` | `library/usecases/NNNN-slug.md` | Use-case card: Markdown, front matter, fixed headings | Cockburn's fully dressed use case, cut down; Given/When/Then | product owner |
| `ux` | `library/ux/NNNN-slug.md` | UX card: Markdown, front matter, fixed headings | one card per feature | designer |
| `glossary` | `library/glossary.md` | Markdown, one `## Term` per entry | arc42 §12 | product owner |

- **Pictures** for UX cards go in `library/ux/images/`. They show as GitHub links (0015 §6).
- **Small diagrams** (a sequence, a flow) are fenced `mermaid` blocks inside any Markdown file, drawn in place
  (0015 §6, Mermaid 11.x). There is no Mermaid page.
- **Nothing else is read.** No file outside `library/`. A file under `library/` that the table doesn't name is not
  shown, and is listed as a problem (§5). The same paths in every repo: no manifest, no globs, no per-repo kinds.
- **`.bobnet/library.json` is gone.** The paths are fixed, so the only things it still held move into the standard:
  `title` and `tagline` into the overview's front matter, and the owners' names too (§6). `github` is derived from
  the remote, as 0015 §3 already did by default.
- **Where it lives in code.** `LIBRARY_STANDARD` in `protocol` replaces 0016's `LIBRARY_SECTIONS`: each section's id,
  path, owner role, and for card sections the front matter keys, which are required, and their allowed values.
  The supervisor and the page both read it.

### 2. Each format's rules (the guide has the templates)

- **Front matter**, for the overview and every card: `---` lines around `key: value` lines at the top of the file.
  A value is plain text to the line's end, a `"quoted string"`, or a flow list `[a, b]`. Nothing nested, nothing
  over two lines. That is a subset of YAML, so any YAML reader reads it.
- **Cards** (decisions, use cases, UX):
  - Named `NNNN-slug.md`: four digits from `0001`, unique in their folder and never reused. The number is the
    card's id. Its title is the first `# ` line.
  - **Decisions:** `status` (`proposed`, `accepted`, `rejected`, `deprecated` or `superseded`) and `date` are
    required; `decision-makers`, `supersedes: [NNNN]` and `feature` (a board ref) are optional. "Superseded by" is
    derived from the other ADRs' `supersedes`, never written. Headings: Context, Options, Decision, Consequences.
  - **Use cases:** `status` (`draft`, `agreed`, `built` or `retired`), `actor` and `date` are required; `feature` is
    optional. Headings: Goal, Preconditions, Main scenario, Extensions, Acceptance.
  - **UX cards:** `status` (`draft`, `in review`, `approved`, `changes asked` or `built`) and `date` are required;
    `feature`, `use-cases: [NNNN]`, `prototype` (a URL), `verdict` (the owner's words, quoted) and `verdict-date`
    are optional. Headings: Purpose, Screens, States, Open questions.
- **Architecture: LikeC4 with a fixed notation.**
  - `library/architecture/spec.c4` is the standard's, copied as it is (the sample's). Its kinds:
    - `person`, `system` and `external` for C4's context;
    - `container` and `store` (a container that keeps data);
    - `component`;
    - the deployment nodes `environment` and `node`;
    - the tags `#planned` and `#deprecated`.

    A project adds no kinds, but may set an element's `style { shape … }` (browser, mobile).
  - The model and views go in any other `*.c4` files in that folder, and at most 64 of them.
  - **The view ids are fixed:**
    - `index`, the context (C4 level 1);
    - `containers`, the system's containers (level 2);
    - `<container>Components`, one per container that has components (level 3);
    - `uc<NNNN>`, a dynamic view that is use case NNNN's flow (arc42 §6). The page links the two;
    - any id for a deployment view (arc42 §7).

    Level 4, code, is not drawn.
- **Data model: DBML** ([dbml.dbdiagram.io](https://dbml.dbdiagram.io/docs/)), one file.
  - A `Project` block with `database_type` and a `Note` that says what the model keeps.
  - **Every table has a `Note`.** A column has a `note:` when its name doesn't say it all.
  - **Keys and nullability are written:** `[pk]`, `[not null]`, `[unique]`. A column without `not null` may be null.
  - **Every relation is a ref:** inline `[ref: > table.id]`, or a `Ref:` line. `>` is many-to-one and `-` is
    one-to-one. `<>` is not used: a many-to-many is its join table, written out.
  - `Enum`s with a `note:` per value where it helps.
  - **The diagrams.** "All tables" is always drawn first. Then each `DiagramView` in the file adds one, in file
    order. It lists its `Tables { … }`, and may also take `TableGroups { … }`. Views may overlap, which
    `TableGroup`s can't: DBML puts a table in one group only.
- **Glossary:** `# Glossary`, then `## Term` per entry in alphabetical order. A first line `Also: other words` is
  optional. Then the definition, in users' words.

### 3. Why DBML for the data model

| | DBML | Postgres `schema.sql` (0016) | tbls `schema.json` | Prisma | Our own YAML |
|---|---|---|---|---|---|
| Entities, types, keys, nullability, relations | yes | yes | yes | yes | yes |
| Notes on tables, columns and enum values | first-class `Note` | `COMMENT ON`, apart from the table | yes | `///` comments | yes |
| Named, overlapping diagrams | `DiagramView` (DBML 13) | no | tbls' viewpoints, in its config | no | ours to invent |
| Any database, or none yet | yes | Postgres only | generated from a live database | Prisma's ORM | yes |
| Authored by an agent from a template | concise, widely known (dbdiagram.io) | verbose DDL | JSON meant to be generated | ORM-specific | no one else knows it |
| Parsed in the viewer | `@dbml/parse` 13.0.0, Apache-2.0: 490 KB, 127 KB gzip, pure JS, no `eval`, errors with line numbers | pg-query: about 2.4 MB, needs `'unsafe-eval'` | Liam reads it natively | Prisma's own wasm and Node | ours to write |
| A standard | yes | yes, for one engine | yes, a tool's | an ORM's | no |

- **What draws it.** Liam ERD still draws it, but Liam doesn't read DBML. It reads postgres, schemarb, prisma,
  drizzle, tbls and its own schema JSON (`@liam-hq/cli` 0.7.24, `supportedFormatSchema`).
- **So the ERD viewer converts.** It parses DBML with `@dbml/parse` and turns it into Liam's schema JSON inside the
  frame. That is about 60 lines, `architecture/spikes/bob212/dbml-to-liam.mjs`.
  - Notes become Liam's `comment`.
  - The many side of a ref becomes the foreign key. In a one-to-one ref, it is the side that isn't its table's key.
  - `[unique]` makes Liam draw a one-to-one.
- **The model is for readers.** A project with a database keeps its migrations where its code needs them; the DBML
  is its readable model. To start one from an existing schema, use `sql2dbml` (`@dbml/cli` 13.0.0, a project's own tool,
  not BobNet's). Checking the DBML against the live database is out of scope.

### 4. What the supervisor reads and sends (replaces 0015 §3 and 0016 §2, §5)

- **What it lists.** `git ls-tree -r <commit> -- library/` at the ref 0015 §1 names. It keeps only the standard's
  paths, and sends each file as a blob (0015 §1, §2): the overview, the glossary, the `.c4` files, the DBML and the
  cards. Images and other files aren't sent.
- **The index replaces the manifest** in the `library` op (0015 §4): `index: {standard: 1, files: [{path, section,
  blob, changed: {sha, date}, title?, head?}]} | null`. It is `null` when main has no `library/`.
  - `title` is the first `# ` line of a Markdown file.
  - `head` is the front matter, as strings, of the overview and the cards. The card lists need it without fetching
    every card.
  - Both are read by `protocol`'s `readFrontMatter`, which also checks each card against `LIBRARY_STANDARD`.
- **Problems** are `{kind: "standard", path, line?, message}`, never fatal:
  - a front matter key that is missing, unknown, or has a value outside its list;
  - a heading that is missing or out of order;
  - a card name not `NNNN-slug.md`, or a number used twice;
  - a file the standard doesn't name;
  - glossary terms out of order.

  The viewers find DBML's and LikeC4's own errors; the supervisor parses neither.
- **The limits:** 512 KB per blob (`too_large`, 0015 §2); 64 `.c4` files and 512 KB for the model; 200 cards.
- **`library_page`** (0015 §4, 0016 §5) becomes `{project, section, path?}`, answering `files: [{path, text}]`:
  - every `.c4` file for `architecture`;
  - the DBML for `data`;
  - the file for `overview` and `glossary`;
  - the card at `path` for a card section.

### 5. What a repo that doesn't follow the standard shows

- **No `library/` on main.** The project's library shows the seven sections, each muted, "not written yet", with
  its owner role, and a link to the standard's guide on GitHub. That replaces 0015's "no library yet".
- **A section's file or folder is absent:** that section alone is "not written yet" (0016 §3), with its owner's
  name (§6), else the role.
- **A file is there but breaks a rule:**
  - It shows as far as it can: a card without a valid `status` still shows its text.
  - Its problems are listed in the section, by file and line, and counted on the library's head.
  - A DBML or LikeC4 error is the viewer's list by line (0016 §6), with the file's GitHub link.
- **Files the standard doesn't name** under `library/` are not shown; each is a problem. Files outside `library/`
  are never read, so a repo's old docs simply don't appear until they are converted.
- **The wording is Daisy's.**

### 6. Owners

The overview's front matter names the people: `product-owner`, `architect` and `designer`. Each section shows its
role's name from there, else the role. That replaces the manifest's per-section `owner` (0016 §2).

### 7. The viewers (amends 0016 §6, §7)

- **The ERD viewer** is Liam's app plus the DBML parser and `dbml-to-liam.mjs` bundled to one script, packed into
  one HTML file as before (`spikes/bob212/pack-erd-dbml.mjs`).
  - **No pg-query, and so no `'unsafe-eval'`.** Its CSP is 0016 §6's with `script-src` holding only the hashes.
    Liam's app needs no wasm.
  - It is 2.9 MB, 0.87 MB gzip, parser included. Before, it was 2.5 MB (0.74 MB gzip) plus about 2.4 MB of pg-query.
  - `THIRD_PARTY.txt` gains `@dbml/parse` (Apache-2.0) and its `lodash-es`, `luxon` and `pathe` (MIT), and loses
    pg-query-emscripten.
- **The diagrams and the toggle.**
  - **The message.** `{t: "files", kind: "erd", files, view?, show?}`. `view` is a `DiagramView` id; absent, it is
    all tables. `show` is `tables`, `keys` or `columns`.
  - **What Liam gets.** The viewer hands Liam only that diagram's tables, and the relations among them. It sets
    Liam's own `?showMode=` (`TABLE_NAME`, `KEY_ONLY` or `ALL_FIELDS`).
  - **The toggle.** `{t: "show", show}` from the page toggles it live, by a `pushState` and a `popstate`, as 0016
    §6's focus does.
  - **On a narrow screen** Liam drops `?showMode=` when it loads, so the viewer applies it again after the first
    draw.
  - **Switching diagrams** reloads the frame. The document is cached `immutable`, and the parse takes about
    0.3 s.
- **`ready` for an `erd`** gains these:
  - `views: [{id, tables}]`;
  - `note`, the `Project` note;
  - `tables` as 0016 §6, now with each table's and column's note.

  The entity card reads these. `about` is gone, since the notes are in the DBML.
- **What the page keeps.** It keeps the toggle per diagram, on the device. A diagram opens as the owner last left
  it. The first time, "All tables" opens as tables only, and a `DiagramView` with its columns.
  - Daisy designs the control, and may offer Liam's middle mode, keys only.
  - **The route** is `#project/<key>/library/data/<diagram>[/<table>]`, where `<diagram>` is `all` or a
    `DiagramView` id.
- **Per-table expand** is not Liam's: its show mode is one for the whole diagram. The entity card shows one table's
  attributes. If Daisy's v4 wants a table expanded in the diagram, it is a time-boxed patch through 0016 §6's React
  Flow bridge, setting that node's data, in build B task 3.
- **The LikeC4 viewer is unchanged.** The page groups its views by the fixed ids (§2): the C4 levels, the use-case
  flows and the deployments.
  - The views picker matters on a phone. With the sample's wider containers view at 390 px, a node is too small to
    tap, so its drill-down button doesn't show. The drill works when the button is clicked (the frame test's
    fallback).

## Consequences

- **Every project's library reads the same.** One guide and one set of templates serve every team's agents, and
  the page has no per-repo case.
- **Each project converts its own content, as its own item, not in R9:**
  - **BobNet:** `architecture/model/bobnet.c4` onto `spec.c4`, and the ADRs into `library/decisions/` with front
    matter.
  - **Vitals:** `schema.sql` to DBML, then its notes.
  - **Helix:** its scenarios into use cases. Its taxonomy is not a section, so its conversion decides where it goes:
    glossary terms, or enums and notes in the DBML.
  - Until a project converts, its library shows "not written yet" with the guide's link.
- **The DBML is a second description** beside a project's migrations, and can drift from them. We accept that: the
  library is the readable model.
- **No `'unsafe-eval'` anywhere**, and a smaller ERD viewer.
- **Less to build.** The supervisor loses globs, `children`, `table`, `mermaid` and `about`, and gains one front
  matter reader in `protocol`.
- **Moving files.** A project's existing docs move into `library/` when it converts. Its CLAUDE.md and links follow
  the move.

## Alternatives

- **Keep the manifest, with defaults** (fixed paths unless `library.json` says otherwise). Rejected: that is the
  per-repo mapping again, which Casper said no to.
- **Postgres SQL, tbls, Prisma or our own YAML for the data model.** Rejected in §3.
- **LikeC4 for the data model too**, one tool for both. Rejected: LikeC4 has no attributes, types, keys or
  cardinality, and no ER notation.
- **Mermaid `erDiagram`.** Rejected as the format: it has no named views and no focus, and no notes on a table. It
  stays for small diagrams inside Markdown.
- **`docs/` instead of `library/`.** Rejected: `docs/` is often a site generator's folder, and `library/` says what
  it is.
- **Card numbers per project prefix** (`ADR-0003`, `UC-0003` in the file name). Rejected: the folder already says
  the kind. How a number is shown is Daisy's.

## Build tasks

These replace 0016's. Build A brings the library to the standard; build B brings the diagrams. Luigi's. The
fixtures are the sample (`architecture/spikes/bob212/sample/`). Converting Helix, Vitals and BobNet is each project's
own later item, not R9.

**Build A, the library** (0015, and §1-6 here), 7 tasks:

1. **Protocol.**
   - `LIBRARY_STANDARD`, and `readFrontMatter` with the card checks (§2, §4).
   - The `library_blob` and `library` ops with `index`, and the `library` and `library_page {section, path?}` reads.
   - `library` on the `projects` and `project` reads, and the 900 KB `library_blob` frame.
   - Tests on the sample, and on a broken copy of it.
2. **Broker, Board.** 0015 §2 as written, with `index` in place of `manifest`.
3. **Supervisor, the sync.**
   - 0015 §1: fetch, `ls-tree library/`, the standard's paths, `title` and `head`, the limits and problems.
   - `index: null` without `library/`.
   - Tests against a `git init` fixture made from the sample.
4. **Dashboard, the library page.**
   - The rail: the seven sections in order, owners' names from the overview, the "not written yet" states (§5), and
     the problems list with its count.
   - The route `#project/<key>/library/<section>[/<item>[/<focus>]]`.
   - markdown-it, the link rules, staleness, and `/vendor/*` immutable.
5. **Dashboard, the text sections.**
   - Overview: title, tagline and its headings. Glossary: terms, A-Z and anchors.
   - The card lists and cards, their heads from `head`:
     - decisions with status, date, supersedes and the derived "superseded by";
     - use cases with status, actor, a link to their `uc<NNNN>` flow when the model has one, and the UX cards that
       name them;
     - UX cards with status, the verdict and its date, the prototype and their use cases.
   - Mermaid fences, 11.x.
6. **The project menu** (AC3), per Daisy's v4 spec and Casper's answer to it.
7. **End to end.** The sample's library through the fixture supervisor, the broker and the page, at 1280 and 390
   wide: the evidence shots, until a project has converted.

**Build B, the diagrams** (0016 §6, §7, as amended in §7 here), 6 tasks:

1. **The tools and the Worker.**
   - `tools/vendor/` with the LikeC4 viewer (0016 §7's settings), `viewers.json` and `THIRD_PARTY.txt`.
   - The Worker serves each viewer with its CSP: `'wasm-unsafe-eval'` for LikeC4, and hashes only for the ERD.
   - The dashboard's CSP gains `frame-src 'self'`.
2. **Dashboard, the architecture page.**
   - The frame and its messages (0016 §6).
   - The bar: the crumb, ↑ Out, and the views picker grouped by C4 level, use-case flow and deployment.
   - A flow's link to its use case, the focus in the route, the errors and the loading state.
3. **The ERD viewer.**
   - Liam's app from source at one release, with the React Flow bridge (0016 §6).
   - The DBML parser bundle (`dbml-to-liam.mjs`, pinned `@dbml/parse` 13.0.0).
   - `files` with `view` and `show`, the live `show`, and `show` applied again after the first draw.
   - `ready` with `views`, `note` and `tables`.
   - The theme, `#1DED83`, the hidden header, no Google Fonts request, and the card's `hover` and `inset` if v4 keeps
     the card.
   - The vendoring test.
   - Time-boxed as 0016's: if the app won't build from source, use the CLI's prebuilt app, as the spike did.
4. **Dashboard, the data model page.**
   - The diagram picker: "All tables", then the `DiagramView`s.
   - The toggle per diagram, kept on the device (§7).
   - The table picker, Fit, Full screen, the diagram and table in the route, and the DBML errors by line.
5. **Dashboard, the entity card**, per Daisy's v4: from `ready.tables`, with its notes, keys and relation chips.
6. **Tests.** The spike's frame tests on the vendored viewers with the sample, in the broker's suite, at 1280 and
   390 wide:
   - `frame-test.mjs`: draw, drill, zoom;
   - `frame-dbml-test.mjs`: all tables and one diagram, the toggle both ways.

**What ships how.** It is as 0016 had it: a broker deploy carries build B and build A's tasks 1, 2 and 4-7. Task 3
rides an rc.
