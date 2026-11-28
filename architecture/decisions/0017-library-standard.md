# 0017. The library standard: one source format and one place per section, the same in every repo

- **Status:** accepted (Toad, 2026-11-26), for BOB-212 (R9), after Casper's Q-21 answer
  (`lead/bob212/frameworks-decision.md`, last section, at `52d8509`): "make it consistent for all and prototype using a
  sample … im looking for standards and frameworks not 'work with what I've got' please".
- **Amended** 2026-11-27 (Toad), after Casper's Q-22: §7's ERD viewer, each table opened on its own; build B tasks
  3-6.
- **Amended again** 2026-11-27 (Toad), after Casper's Q-23, "Liam as is" (`lead/bob212/frameworks-decision.md`, last
  section, at `6f27396`): the data model is drawn by Liam ERD, unpatched, fed from the DBML by DBML's own exporter.
  Our viewer, its per-table control and the entity card are dropped. §2's diagrams, §3, §7, the consequences, the
  alternatives, build A task 6 and build B. What §7 said under Q-22 is in git at `6f27396`.
- **The author's guide** is `architecture/library-standard.md`: every file's template and rules. It is part of this
  decision; changing it takes an amendment here.
- **The sample** is `architecture/spikes/bob212/sample/`: a fictional project, Toolshed, written to the standard. It
  draws in both viewers (§7).
- **What it replaces:**
  - in 0016: §2 (the manifest), §4 (build.py's pages onto the sections) and §5 (the sources), the page-kinds column
    of §1, `about`, and the build tasks;
  - in 0015: §3 (the manifest in each repo), and the `manifest` of §4's `library` op;
  - in 0016 §6 and §7: the ERD viewer's parser (DBML's exporter, then Liam's own Postgres parser), its messages
    (`files` and `ready` only), and everything 0016 changed in Liam: the bridge, `?active=`, the theme stylesheet,
    the hidden header and drawer, the entity card and `about` are gone (§7).
- **What stands:** 0015 §1 (the supervisor fetches and sends), §2 (the blob cache), §5 (staleness) and §7 (what rides
  what); 0016 §1's seven sections, their order and owner roles, §3's missing-section state, and §6's sandboxed
  viewers and their CSP, `'unsafe-eval'` for the ERD frame only, as 0016 had it, apart from the changes in §7 here.

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
  - **The diagrams.** Each `DiagramView` lists its `Tables { … }`, and may also take `TableGroups { … }`. Views may
    overlap, which `TableGroup`s can't: DBML puts a table in one group only. They stay in the standard (Casper,
    Q-23: "DBML stays the standard, DiagramViews included"), though Liam draws only all the tables (§7). A viewer
    that draws them can replace Liam with no change to any repo.
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
| Drawn by Liam ERD, unpatched (§7) | through DBML's own exporter to PostgreSQL DDL, which Liam reads natively | natively | natively | natively (its parser needs native swc, not in a browser) | no |
| A standard | yes | yes, for one engine | yes, a tool's | an ORM's | no |

- **What draws it** is Liam ERD, as it is (§7). Liam doesn't read DBML, so DBML's own exporter
  (`@dbml/core`, `exporter.export(dbml, "postgres")`, the same as `dbml2sql`) turns it into PostgreSQL DDL, which Liam
  reads. Tables, columns, types, keys, nullability, uniques, defaults, enums, indexes, relations and the notes (as
  `COMMENT ON`) all carry over. The DDL is never written to a repo: it lives only in the viewer's frame.
- **The model is for readers.** A project with a database keeps its migrations where its code needs them; the DBML
  is its readable model. To start one from an existing schema, use `sql2dbml` (`@dbml/cli` 13.0.0, a project's own tool,
  not BobNet's). Checking the DBML against the live database is out of scope.

### 4. What the supervisor reads and sends (replaces 0015 §3 and 0016 §2, §5)

- **What it lists.** `git ls-tree -r <commit> -- library/` at the ref 0015 §1 names. It keeps only the standard's
  paths, and sends each file as a blob (0015 §1, §2): the overview, the glossary, the `.c4` files, the DBML and the
  cards. Images and other files aren't sent.
- **The index replaces the manifest** in the `library` op (0015 §4; `library_sync` in the protocol): `index: {standard: 1, files: [{path, section,
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

- **Amended 2026-11-27, after Casper's Q-23**: "Liam as is". He wanted a framework over our own build, its limits
  accepted, with the open standard at the source so the viewer can be swapped later (the last section of
  `lead/bob212/frameworks-decision.md`, at `6f27396`). So BobNet's own ERD viewer of Q-22 (React Flow, dagre,
  `@dbml/parse`, about 230 lines), its per-table control, and the entity card are dropped. They are in git at
  `6f27396` and in `spikes/bob212/`.
- **Liam is the off-the-shelf choice.** The time-boxed check (`spikes/bob212/viewer-check.md`) found no viewer that
  does the per-table toggle as well as embedding. Of those it tried, Liam alone embeds as it is: Apache-2.0, a
  prebuilt static app, nothing to fetch.

#### The ERD viewer: Liam ERD, unpatched, at one release

- **What is vendored**: `/vendor/erd-viewer-<version>.html`, one file packed by the vendoring tool
  (`spikes/bob212/pack-liam-as-is.mjs`). It holds four things:
  - **Liam's app**: `@liam-hq/cli` 0.7.24's `dist-cli/html`, its script and stylesheet byte for byte. No patch, no
    override stylesheet, no recoloured accent, nothing hidden: its header, its show switch (names · keys · all
    columns, for the whole diagram), its side pane and its look are Liam's.
  - **DBML's exporter**: `@dbml/core` 13.1.0's `exporter.export(text, "postgres")`. The bundle leaves out
    `@dbml/core`'s SQL importers (14.6 MB of ANTLR grammars that export never calls) by stubbing those modules; the
    test (below) checks that the frame's DDL is still the unbundled exporter's.
  - **Liam's own Postgres parser**: `@liam-hq/schema` 0.6.1's SQL processor, on `pg-query-emscripten` 5.1.0. The
    parser and the app must agree (0016 §6). npm's 0.6.1 is older than the CLI's bundled one, and in 0016's spike it
    cut Vitals' CHECK bodies. So the test checks that its parse of the exported DDL is the CLI's own
    `liam erd build --format postgres` output for the same DDL. On the sample it is.
  - **The frame shell**, about 1 KB, which every sandboxed embed needs: storage and cookie shims for the opaque origin
    (0016 §6), and the answer to Liam's `fetch("schema.json")`. It draws nothing and styles nothing.
- **One Liam release, pinned.** Moving to a new Liam or DBML release is a vendoring change: re-pack, re-run the test,
  look at the shots.
- **Size**: 5.65 MB, 1.38 MB gzip: Liam's app 2.45 MB, and the parsers 3.19 MB (pg-query is 2.4 MB of that). It is
  cached `immutable` like every viewer.

#### Where DBML becomes DDL, and the CSP

- **In the viewer's frame**, at view time. The page posts the DBML text, as it posts LikeC4's `.c4` files. Not in
  the page, which keeps its strict CSP. Not in the supervisor either: 0016's alternatives rejected that (Liam's ~100
  MB of dependencies, an rc for every parser fix, and laptops on different rcs feeding one renderer), and it would
  split the parser and the app across two release trains.
- **`'unsafe-eval'` is needed again, for the ERD frame only.** The DBML exporter doesn't need it. Liam's parser does:
  `pg-query-emscripten` calls `eval`. So the ERD viewer's CSP is 0016 §6's, as 0016 first had it:
  `script-src <its three hashes> 'unsafe-eval'`. The LikeC4 frame keeps `'wasm-unsafe-eval'` only. The page never
  gets either.
- **How 0016 §6 keeps it isolated.** The frame is `sandbox="allow-scripts"`, with no `allow-same-origin`, so it has
  an opaque origin: no cookies, no storage, no access to the page or the owner's socket. It has no popups, no
  downloads and no top navigation, and `connect-src 'none'` gives it no network. Whatever is evaluated in it sees
  only the DBML text the page handed it, and can only post messages back. The page checks `e.source` and the message
  shapes, as 0016 §6 says.
- **What Liam reaches for and doesn't get.** It asks Google Fonts for IBM Plex, which the CSP blocks, so it uses the
  system font: that is the one console error the test allows. Its header's GitHub, help, Export and Copy Link do
  nothing in the sandbox. Both are accepted, because the alternative is patching Liam.

#### The messages (0016 §6's `hello` stands; the rest are replaced)

| Direction | Message | What for |
|---|---|---|
| viewer → page | `{t: "hello"}` | The frame is listening. |
| page → viewer | `{t: "files", kind: "erd", files: [{path: "library/data-model.dbml", text}]}` | The DBML, once. |
| viewer → page | `{t: "ready", errors: [{path, line, message}], tables}` | `tables` is the count drawn. With errors there is nothing to draw. |

- **`errors`**: the DBML's own, by line, from the exporter's parse (`line` from 1). The page lists them with the
  file's GitHub line link (§5). If Liam's parser rejects the exporter's DDL (it shouldn't), it is one error with
  `line: 0`: "the viewer couldn't read the converted model".
- **Nothing else crosses**: no `view`, `focus`, `fit`, `hover`, `inset`, `show`, `expand`, `expanded`, and no
  `tables`, `enums` or `note` lists. Liam's focus, fit, zoom, show switch and side pane are used inside the frame.
- **Only "All tables" is drawn.** Liam has no named diagrams, so the `DiagramView`s are not drawn (§2).
- **The route** is `#project/<key>/library/data`, with no diagram and no table.
- **Around the frame** the page shows the section's title, owner, source link and staleness, and its own Full
  screen. That is Daisy's spec §11. There is no diagram picker, no table picker, no card and no hover.

#### The evidence

`spikes/bob212/liam-as-is-test.mjs` runs on the sample (Toolshed). The frame is served under the dashboard's CSP and
the viewer's, at 1280 x 800 by mouse and 390 x 844 by touch. It checks:

- `ready` has no errors and 9 tables, and 9 nodes are drawn, in about 2 s;
- the frame's DDL is the unbundled `@dbml/core` exporter's;
- Liam's parse in the frame equals Liam CLI 0.7.24's `schema.json` for that DDL;
- a broken DBML gives its error at its line (83);
- the only console error is the blocked Google Fonts request;
- no request leaves for anything but the frame's own document.

The shots are in `spikes/bob212/shots-liam-as-is/`:

- `liam-as-is-1280.png` and `liam-as-is-390.png`, fitted;
- `-loan.png`, with loan clicked or tapped, which opens Liam's side pane with its note and columns.

At 390 the fitted diagram is drawn at about 25 %, too small to read. A tap still opens the side pane, and pinch zooms
in. On a phone, the page's Full screen and a pinch are the way in (Daisy's).

#### The LikeC4 viewer is unchanged

- The page groups its views by the fixed ids (§2): the C4 levels, the use-case flows and the deployments.
- The views picker matters on a phone. With the sample's wider containers view at 390 px, a node is too small to
  tap, so its drill-down button doesn't show. The drill works when the button is clicked (the frame test's
  fallback).
- **A use case's flow link** (Daisy's spec §16 item 5): the page keeps its regex on the `.c4` text,
  `dynamic view uc<NNNN>`. The ids are fixed by §2, so it is reading the standard, not guessing. The supervisor
  doesn't parse `.c4` files, and the index stays paths and heads.

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
- **No viewer code of ours.** The data model is drawn by Liam as it is, with DBML's exporter and Liam's own parser in
  front. Liam's limits are accepted (Casper, Q-23):
  - columns show for all tables or none (Liam's switch), not per table: Q-22's per-entity toggle is given up until a
    viewer does it;
  - only "All tables": the `DiagramView`s are written but not drawn;
  - Liam's own look, header and side pane, not the dashboard's;
  - no entity card.
- **The viewer can be replaced.** DBML is the source, so a better viewer is a vendoring change, with no change to any
  repo. The test's checks on the DDL and the parse are what a Liam or DBML release must pass.
- **`'unsafe-eval'` in the ERD frame**, for Liam's parser, isolated by 0016 §6's sandbox. The page and the LikeC4
  frame never get it. The ERD viewer is 1.38 MB gzip, where Q-22's own viewer was 0.28 MB.
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
- **BobNet's own ERD viewer** (Q-22's: React Flow, dagre and `@dbml/parse`, about 230 lines, each table opened on its
  own, and the entity card). Rejected by Casper (Q-23): a framework with its limits, not a custom build. It is in git
  at `6f27396` if a later release wants it back.
- **Per-entity expand by patching Liam's node component** (Q-22). Rejected: Liam ships a minified, prebuilt app
  whose show mode is global. A patch would be on hashed code, re-checked on every Liam release. And Q-23 is Liam
  unpatched.
- **Our own DBML to Liam JSON converter** (`spikes/bob212/dbml-to-liam.mjs`, v3). Rejected: custom code where
  DBML's own exporter and Liam's own parser do the job.
- **The supervisor converts the DBML** (to DDL, or on to Liam's JSON) and sends it as a derived blob. That would take
  `'unsafe-eval'` out of every browser. Rejected, as in 0016's alternatives: Liam's dependencies on every laptop, an
  rc for every parser fix, and the parser and the app on two release trains.
- **Off-the-shelf viewers other than Liam** (drawDB, ChartDB, Azimutt, dbml-view, erd-editor). Rejected in
  `spikes/bob212/viewer-check.md`: none embeds as it is.
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
6. **The project menu** (AC3): design A, the "<Project> ▾" button, per Daisy's spec. Casper's answer to Q-23: "Its
   fine".
7. **End to end.** The sample's library (Toolshed) through the fixture supervisor, the broker and the page, at 1280
   and 390 wide. These shots are AC1's evidence until a project has converted. Converting Helix, Vitals and BobNet
   is each project's own later item.

**Build B, the diagrams** (0016 §6, §7, as amended in §7 here), 4 tasks:

1. **The vendored viewers and the Worker.** `tools/vendor/` packs the LikeC4 viewer (0016 §7's settings), and the
   ERD viewer as is from `pack-liam-as-is.mjs`: Liam CLI 0.7.24's app untouched, `@dbml/core` 13.1.0's exporter and
   `@liam-hq/schema` 0.6.1's SQL parser, all pinned. It writes `viewers.json` and `THIRD_PARTY.txt` (Liam and
   `@dbml/core` Apache-2.0, pg-query-emscripten MIT). The Worker serves each viewer with its CSP:
   `'wasm-unsafe-eval'` for LikeC4, `'unsafe-eval'` for the ERD. The dashboard's CSP gains `frame-src 'self'`.
2. **Dashboard, the architecture page.** The frame and its messages (0016 §6). The bar: the crumb, ↑ Out, and the
   views picker grouped by C4 level, use-case flow and deployment. A flow's link to its use case, the focus in the
   route, the errors and the loading state.
3. **Dashboard, the data model page**, per Daisy's spec §11: the Liam frame with `files` and `ready` (§7), loading
   until `ready`, the DBML errors by line with GitHub links, the source line, staleness and Full screen. Route
   `#project/<key>/library/data`.
4. **Tests**, in the broker's suite, on the vendored viewers with the sample, at 1280 and 390 wide:
   - `frame-test.mjs`: draw, drill and zoom;
   - `liam-as-is-test.mjs`: 9 tables drawn; the DDL is the exporter's; the parse is Liam CLI's; a DBML error at
     its line; only the Google Fonts error.

   They fail on a Liam or DBML release that breaks them.

**What ships how.** It is as 0016 had it: a broker deploy carries build B and build A's tasks 1, 2 and 4-7. Task 3
rides an rc.
