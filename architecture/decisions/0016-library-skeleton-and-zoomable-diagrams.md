# 0016. A project's library: a fixed skeleton of sections, and zoomable diagrams drawn from main in sandboxed viewers

- **Status:** accepted (Toad, 2026-11-26), for BOB-212 (R9), after Casper's go in Mario's session
  (`lead/bob212/frameworks-decision.md`, "Yes agreee go ahead").
- **What it amends in ADR 0015:**
  - **Replaced:** §3's manifest shape, §6's route, and its build tasks.
  - **Extended:** §4's `library_page` and §6's rendering.
  - **Unchanged:** the rest of 0015: the supervisor fetches, the broker caches by blob, the page renders.
- **The spike behind it:** `architecture/spikes/bob212/README.md`. Line numbers are at `e0f5330`.
- **Amended** (Toad, 2026-11-26) by Daisy's version 3 spec (`design/BOB-212/spec.md` at `e0f4d84`, §14 and §15.5):
  - card heads under the title, and `children`'s `match` and `skip` (§2);
  - `about` on an `erd` page (§2, §5);
  - the viewers' messages, and centring through React Flow (§6);
  - the vendoring's patches and its test (§7);
  - the entity card, and the build tasks re-cut.

  **Pending Q-21** (Casper's verdict on version 3) is marked where his answer could reverse it: the entity card,
  `about` and the messages only the card uses. Everything else stands whatever he answers.
- **Amended by ADR 0017** (2026-11-26, Casper's Q-21: one standard, not each repo's files): §2, §4 and §5 and the
  page-kinds column of §1 are replaced by fixed paths and one format per section; `about` is gone; the ERD viewer
  reads DBML with no `'unsafe-eval'`, and draws a diagram at a time with its own toggle (0017 §7). The build tasks
  are 0017's. What stands is listed at 0017's head.
- **Amended by ADR 0017 again** (2026-11-27, Casper's Q-22: each table opened on its own): the ERD viewer is
  BobNet's own (React Flow and dagre), not Liam's app, so §6's Liam parts (the bridge, `?active=`, the parser from
  Liam's release) are gone. Its messages are 0017 §7's.
- **Amended by ADR 0017 a third time** (2026-11-27, Casper's Q-23, "Liam as is"): the ERD viewer is Liam's app
  again, now unpatched, fed from the DBML by DBML's own exporter to Postgres DDL and Liam's own parser, in the frame.
  So §6's `'unsafe-eval'` for the ERD frame is back. Its bridge, `?active=`, theme stylesheet, hidden header and
  drawer, and the card stay gone. §7's changes to Liam are none. The messages are 0017 §7's: `files` and `ready`.

## Context

- **What Casper asked for.** "Some structure around architecture, data models, use cases,
  prototypes, ux design". Then: "applying some architectural frameworks", and diagrams one can
  "interact with and focus/zoom on details … or zoom out and see bigger picture".
- **What Mario recommended and Casper agreed:**
  - the frameworks: C4, arc42-lite as the fixed skeleton, short ADRs, use-case cards, and one UX
    card per feature;
  - the diagrams: LikeC4 for architecture, Liam ERD for data models, and Mermaid only for small
    diagrams;
  - the scope: BOB-212 brings the skeleton and draws LikeC4 and Liam where a repo has them. Each
    project converts its own content later.
- **What the spike found:**
  - BobNet's architecture as a LikeC4 model (`architecture/model/bobnet.c4`) drills three levels.
  - LikeC4 parses and lays out in the browser in about 270 ms. That needs `'wasm-unsafe-eval'`
    (Graphviz) and inline styles.
  - Liam draws Vitals' `schema.sql`. Its Postgres parser needs `'unsafe-eval'`, and it must come
    from the same Liam release as the renderer.
  - Both draw cleanly in a sandboxed frame with no network.
  - The dashboard's CSP, `script-src 'self'; style-src 'self'` (`broker/src/index.ts:14-15`), allows
    neither tool.
- **The rules that still hold:**
  - Main stays the source, and the cache is byte-for-byte main's (0015 §2).
  - The broker has no GitHub access.
  - The dashboard has its own look, and works on a phone.

## Decision

### 1. The skeleton: seven fixed sections, in this order

| id | Nav label | Owner role | What it holds | Page kinds |
|---|---|---|---|---|
| `overview` | Overview | product owner | Goals, scope, constraints, quality goals (arc42 §1, 2, 10) | md |
| `architecture` | Architecture | architect | The C4 model, from context to containers to components. Also the solution strategy, runtime and deployment views, and crosscutting concepts (arc42 §3-8) | likec4, md, mermaid |
| `data` | Data model | architect | The schema as an ERD, the data dictionary, the taxonomy | erd, md, table, mermaid |
| `decisions` | Decisions | architect | ADRs: context, options, decision, consequences, status (arc42 §9) | md, children |
| `usecases` | Use cases | product owner | One card per use case, with its scenarios under it | children, md |
| `ux` | UX design | designer | One card per feature: spec, prototype, Casper's verdict and its date | children, md |
| `glossary` | Glossary | product owner | Terms in users' words (arc42 §12) | md, table |

- **Where it lives.** The skeleton is one constant, `LIBRARY_SECTIONS`, in `protocol`. The supervisor
  checks manifests against it, and the page draws its rail from it. Changing it takes an ADR.
- **Labels.** Daisy may word the nav labels. The ids are fixed.
- **Left out.** arc42 §11, risks and debt: that is each board's backlog. §4 and §8 are pages under
  Architecture.
- **Owners.** The skeleton fixes each section's owner *role*. The manifest names the person, as
  build.py does (`"owner": "Bill"`). The page shows "owner Bill" and falls back to the role.

### 2. The manifest, `.bobnet/library.json` version 2

This replaces 0015 §3's shape. No version 1 manifest was ever landed, so nothing migrates.

```json
{
  "version": 2,
  "title": "Vitals Library",
  "tagline": "…",
  "sections": {
    "architecture": { "owner": "Galen", "pages": [
      { "id": "model", "kind": "likec4", "dir": "architecture/model", "view": "index" },
      { "id": "notes", "src": "docs/library/architecture.md" } ] },
    "data": { "owner": "Galen", "pages": [
      { "id": "erd", "kind": "erd", "format": "postgres", "src": "database/schema/schema.sql", "title": "Schema" },
      { "id": "entities", "kind": "mermaid", "src": "database/data-model.mmd", "title": "Entities and relations", "intro": "…" },
      { "id": "dictionary", "src": "docs/library/data-dictionary.md" } ] },
    "decisions": { "owner": "Galen", "pages": [
      { "id": "index", "src": "docs/decisions/README.md" },
      { "id": "adrs", "kind": "children", "dir": "docs/decisions" } ] }
  }
}
```

- **Top level:** `version: 2`, `title`, `tagline`, `sections`, and optionally `github` (0015 §3).
  `coming` is gone: the skeleton lists every section, and an absent section is the "coming" one (§3).
- **Each section** has an `owner` and its ordered `pages`. Each page has an `id`, unique in its
  section, and a `kind`, which defaults to `md`. Its `title` defaults to the file's first `# `.
- **The fields of each kind:**
  - `md`: `src`.
  - `table`: `src` (the intro), plus `table: {dir, areas}` as in 0015.
  - `mermaid`: `src`, `title`, `intro` as in 0015.
  - `children`: `dir`, and `owners` per first folder as in 0015.
    - **Which files** (amended): `match`, a glob on the path under `dir`, defaults to `**/*.md`. `skip`
      is a list of paths under `dir` to leave out. Globs know `*`, `**`, `?` and `[…]`, never regex. So
      ADRs are `"match": "[0-9][0-9][0-9][0-9]-*.md"`, and UX cards are `"match": "*/spec.md"`, which
      leaves out the review files beside them. The supervisor applies both before it counts the 200
      pages. (The prototype's regexes, `tools/gen_data.py:34-76`, become these globs.)
    - **A card's head** comes from the first of these two:
      - a front matter block of `key: value` lines between `---` lines at the top;
      - else (amended) the `Key: value` lines right under the file's `# ` title, up to the first blank
        line. They are written as `Key: value`, `**Key:** value` or `- **Key:** value`. A key is one to
        four words of letters, digits, spaces or hyphens. An indented line continues the value above
        it. The first line that isn't one ends the head, and the head is then the lines before it. This
        is how Helix's, Vitals' and BobNet's ADRs already open, so none is rewritten.
    - The page shows the head in file order, with values that are links following 0015 §6's link
      rule. The rest of the file, without the head, is the card's markdown.
    - That makes ADRs, use-case cards and UX cards one kind. The keys are the template owners' to
      set: Peach for use-case cards, Daisy for UX cards, the architect for ADRs. The page needs none
      of them.
  - `likec4`: `dir`, and the start view `view` (default `index`). Every `*.c4`, `*.likec4` and
    `likec4.config.json` under the dir at the commit belongs to the model.
  - `erd`: `src`, one schema file, and `format`.
    - Only `postgres` for now. `prisma`, `schemarb` and `tbls` come when a project needs one.
    - Liam's `drizzle` parser runs native swc and can't run in a browser.
    - Optionally `about` (amended, **pending Q-21**), one markdown file that describes the tables,
      such as a data dictionary. The page matches it to the tables by Daisy's rule (spec §10.3): a
      `##`-`####` heading that opens with the table's name in backticks. A schema's own comment wins.
      An unmatched table gets no description and no problem. Helix gets its descriptions as
      `COMMENT ON` in a `schema.sql` its build writes (spec §10.4), so BobNet takes no second schema
      format.
- **What isn't valid.** These are problems, `{kind: "manifest", message}` (0015 §3), and never fatal:
  - a section id outside the skeleton;
  - a kind its section doesn't allow;
  - a duplicate page id.

  That section or page is left out, and the rest shows.

### 3. What a missing section shows

- **When a section counts as missing.** It is absent from `sections`, or it has no pages.
- **In the rail** it stays in its fixed place, muted, reading "not written yet" with its owner role.
  That replaces build.py's `coming` / "SOON".
- **Its page** shows the skeleton's "what it holds" and who writes it ("the product owner writes
  this"), and points to `.bobnet/library.json` on GitHub.
- **The other states are as in 0015.** A page whose source is gone shows `missing`. A project without
  the file has "no library yet".
- **The wording is Daisy's.**

### 4. build.py's pages onto the sections

| Project | build.py page (nav, src, owner) | Section | Kind |
|---|---|---|---|
| Helix | Architecture, `architecture/overview.md`, Bill | architecture | md |
| Helix | Data model, `architecture/model/entities.md`, Bill | data | md, with its mermaid block (it fails to parse until Helix quotes line 54: Daisy's spec §11) |
| Helix | Taxonomy, `architecture/model/taxonomy/*`, Bill + Picard | data | table |
| Helix | Scenarios, `scenarios/**`, owners per group | usecases | children (they become cards when Helix writes its use cases) |
| Helix | Decisions, `architecture/decisions-index.md`, Bill | decisions | md |
| Helix | coming: Use cases (Picard), Glossary (Picard) | usecases, glossary | `usecases` has the scenarios; `glossary` is missing |
| Vitals | Architecture, `docs/library/architecture.md`, Galen | architecture | md |
| Vitals | Data model, `database/data-model.mmd`, Galen | data | mermaid |
| Vitals | (new) Schema, `database/schema/schema.sql`, Galen | data | erd, the section's first page |
| Vitals | Data dictionary, `docs/library/data-dictionary.md`, Galen | data | md |
| Vitals | Use cases, `docs/library/use-cases.md`, Curie | usecases | md |
| Vitals | Decisions, `docs/decisions/README.md`, Galen | decisions | md |
| Vitals | Glossary, `docs/library/glossary.md`, Galen | glossary | md |

- **Overview** is missing in both projects, and **UX design** too, until they write them.
- **No LikeC4 model** exists in either repo yet. Writing one is the project's own item. BobNet's model
  (`architecture/model/bobnet.c4`, from the spike) is the example.

### 5. The sources: the supervisor reads them; still no derived data

The supervisor resolves `likec4` and `erd` pages as it does the other kinds (0015 §1, §3):

- **`likec4`.** It runs `git ls-tree -r <commit> -- <dir>`, filters to the model's files, and sends
  each as a blob.
  - Limits: at most 64 files and 512 KB in all. Over that, the page carries `too_large`.
  - The page counts as one of 0015's 200 pages.
- **`erd`.** One blob, and one more for `about` when the page has one, resolved on main like `src`
  and cached by its blob the same way. A missing `about` is a problem, never fatal: the ERD still
  draws.
- **`library_page`** (0015 §4) answers `files: [{path, text}]`: every file for a `likec4` page, and
  for an `erd` page the schema first, then `about`.

Nothing is parsed, laid out or built outside the browser. The cache stays main's bytes, checked by
blob id (0015 §2).

### 6. Drawing: Markdown in the page, zoomable diagrams in sandboxed viewers

- **What the page itself draws.** Markdown, tables, cards and `mermaid` draw in the page, as 0015
  §6, with `mermaid` pinned to 11.x (Daisy's finding).
- **What the viewers draw.** `likec4` and `erd` pages draw in a viewer:
  - an `<iframe sandbox="allow-scripts">` on a vendored, single-file document:
    `/vendor/likec4-viewer-<version>.html` or `/vendor/erd-viewer-<version>.html`;
  - it parses the sources it is handed, lays them out and draws them, with pan, zoom, pinch,
    drill-down (LikeC4) and focus on a table (Liam).

- **Why a frame.** Both tools need what the dashboard's CSP refuses: wasm (LikeC4's Graphviz), `eval`
  (Liam's pg-query parser) and inline styles. Loosening the dashboard's own CSP would put `eval`
  beside the owner's socket. A sandbox without `allow-same-origin` gives the viewer an opaque origin,
  so it has:
  - no cookies;
  - no storage (the viewer shims it in memory);
  - no access to the parent;
  - no popups;
  - and, by its CSP, no network.

  It can only draw what it is handed and post messages back.
- **The viewer's CSP.** The Worker sets it for `/vendor/*-viewer-*.html`:

  ```
  default-src 'none'; script-src <its sha256 hashes> 'wasm-unsafe-eval' ['unsafe-eval': erd only];
  style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none';
  base-uri 'none'; form-action 'none'; frame-ancestors 'self'
  ```

  The hashes come from `public/vendor/viewers.json`, written by the vendoring tool (§7). Each viewer
  is served `immutable`, as 0015 §6's `/vendor/*`.
- **The dashboard's CSP** gains `frame-src 'self'` and nothing else (`index.ts:14-15`, set at `:101`).
- **Why a single file.** The document needs no further request. Requests from an opaque origin are
  cross-site, and Access' cookie may not go with them. In the spike the frame made none.
- **The messages** (amended). The page checks `e.source === frame.contentWindow`, and the viewer
  checks `e.source === parent`. The viewer parses; the page parses no model and no SQL. A message
  with a `t` the receiver doesn't know is ignored, so either side can gain one first.

  | Direction | Message | What for |
  |---|---|---|
  | viewer → page | `{t: "hello"}` | It is listening. |
  | page → viewer | `{t: "files", kind, files: [{path, text}], format?, focus?}` | The sources. For an `erd`, only the schema: the page reads `about` itself. |
  | viewer → page | `{t: "ready", errors: [{path, line, message}], views?, tables?}` | Drawn, with what the bar needs. `likec4`: `views: [{id, title, label, crumb: [ids], dynamic}]`. `erd`: `tables`, below. |
  | viewer → page | `{t: "focus", focus}` | The user moved: a LikeC4 view id, or a table name, or `null` for all. The page puts it in the route. |
  | viewer → page | `{t: "open", url}` | A link in the model. The page applies 0015 §6's link rule and opens it. |
  | page → viewer | `{t: "focus", focus}` | The bar, ↑ Out, the crumb, a chip or the route moved it. No files are sent again. The viewer doesn't answer with its own `focus`. |
  | page → viewer | `{t: "fit"}` | Fit the whole view, or all tables. |
  | viewer → page | `{t: "hover", table, rect?}` | `erd`, **pending Q-21**. The table under a fine pointer, or `null`; `rect: {x, y, w, h}` in the frame's pixels. One message per change of table, never per move. |
  | page → viewer | `{t: "inset", right, bottom}` | `erd`, **pending Q-21**. The frame's pixels the entity card covers, sent when it opens, closes or the frame resizes. The viewer centres an opened table in what is left. |

  - **`ready.tables`** is each table from Liam's own parse: `[{name, comment, columns: [{name, type,
    notNull, comment}], pk: [names], fks: [{columns, table, targetColumns}]}]`. The bar's picker needs
    the names. The rest is the entity card's (**pending Q-21**; without the card, names alone).
    Never the SQL text.
- **The entity card** (Daisy's spec §10.2, **pending Q-21**) is drawn by the page over the frame, from
  `ready.tables` and `about`, so it is the dashboard's look and keyboard. Nothing of it is in Liam.
  Liam's own table drawer is hidden (§7).
- **Centring a table** (spec §15.5). An opened table is centred at 100 % in the part of the frame the
  card leaves free, however it was opened. The viewer does it through React Flow, not through events:
  - The vendoring tool builds Liam's app from source (as below), so it adds one small component
    inside Liam's `ReactFlowProvider`. It calls `useReactFlow()` and hands the preamble `setCenter`,
    `getNode` and `fitView`.
  - To focus a table, the preamble sets Liam's own `?active=<table>` (a `pushState` and a `popstate`).
    Liam then lights it and its relations. Then it calls `setCenter` on the node's centre, shifted by
    half the inset, at zoom 1. `fit` is `fitView`.
  - The prototype's click on the node and synthetic wheel (`design/BOB-212/tools/pack-erd.mjs:28-32`)
    is the fallback. It is used only if Liam's app won't build from source in build B's time box.
  - Either way the vendoring test (§7) checks that an opened table lands in the free part's centre.
- **The route** is `#project/<key>/library/<section>/<page>[/<focus>]`. It replaces 0015 §6's
  `<page-id>`, so a C4 level or a table can be linked.
- **When it fails.** The page lists the model's files with GitHub links, and the viewer's errors by
  file and line. It does the same if the viewer hasn't said `ready` within 15 s.
- **Liam's parser and renderer come from one Liam release.** Both are built from Liam's repo at the
  tag of the CLI whose app is used: `packages/schema` and the CLI's `html` app, built from source so
  the React Flow bridge above can be added. npm's
  `@liam-hq/schema` 0.6.1 with CLI 0.7.24's app drew nothing in the spike.
- **The look** is Daisy's, applied in the vendoring tool:
  - LikeC4 takes the dashboard's colour scheme and the model's own colours.
  - Liam's viewer carries a stylesheet that maps Liam's CSS variables to `style.css`'s tokens, and
    hides Liam's header actions (Copy Link, GitHub, Export), which do nothing in a sandbox.
- **Size and speed, once per version per device:**
  - LikeC4's viewer is 2.4 MB gzip.
  - The ERD viewer is about 1.3 MB gzip.
  - Parsing and layout take about 0.3 s on a desktop. A phone is slower, so Daisy designs a loading
    state.

### 7. The vendoring tool

- **Where.** `tools/vendor/` at the repo root, outside the pnpm workspace: `pnpm-workspace.yaml` lists
  `packages/*` only. It has its own `package.json` and lockfile with pinned versions, so a land never
  installs its roughly 300 MB.
- **What it writes.** `node tools/vendor/build.mjs` writes these to `packages/broker/public/vendor/`:
  - the two viewers;
  - `viewers.json`, the file names and hashes the Worker imports;
  - `THIRD_PARTY.txt`, the licences: LikeC4 and langium MIT, `@hpcc-js/wasm-graphviz` Apache-2.0,
    Liam Apache-2.0, pg-query-emscripten MIT, React MIT.

  The output is committed, like 0015's markdown-it and mermaid.
- **When it runs.** Only when Luigi bumps a version.
- **The recipe** is the spike's: `viewer-frame.jsx`, `pack-viewer.mjs` and `pack-liam.mjs`, as Daisy's
  prototype extended them (`design/BOB-212/tools/`).
- **The LikeC4 viewer's settings** (amended) are `design/BOB-212/tools/likec4-viewer.jsx`'s:
  - `controls`, `showNavigationButtons`, `enableSearch`, `enableNotations` and
    `enableCompareWithLatest` off, since BobNet's bar has these;
  - details, relationship details, focus mode and the dynamic step-through on;
  - `injectFontCss={false}`.
- **What the tool changes in Liam** (amended). Each is Liam 0.7.24's and may break with a release:
  - It replaces Liam's literal `#1DED83` (29 places in its script) with the accent before it hashes.
  - It appends `design/BOB-212/tools/erd-theme.css`, with style.css's tokens written in as literals
    from its `:root` when the tool runs. That hides Liam's `<header>` and, **pending Q-21**, its drawer
    (`[data-vaul-drawer]`). It selects by element and attribute, never by Liam's hashed classes.
  - **Pending Q-21:** the preamble keeps Liam's capture `mousedown` "outside the drawer" off the
    canvas, so a pan or a click on another table doesn't close the card (`pack-erd.mjs:40`).
  - It adds the React Flow bridge (§6).
- **The vendoring test** fails when a Liam release stops matching any of these. It checks that there
  were `#1DED83`s to replace, that the header (and the drawer) are hidden, that the bridge is reached,
  and that an opened table is centred in the free part. It runs in the tool, before it writes, and
  its frame tests run in the broker's suite (build B).

## Consequences

- **What a project can write.** A LikeC4 model or a Postgres schema on main is a zoomable diagram in
  BobNet within one sync. Nothing is built in the repo, on a laptop or on the broker.
- **What a renderer fix or upgrade costs:** a run of the vendoring tool and one broker deploy. No rc.
- **The repo** grows by about 10 MB per viewer version, committed. Bumps should be rare.
- **The third-party code is held apart.** About 12 MB of it runs in an opaque, offline frame.
  `'unsafe-eval'` exists only there, never in the owner's page.
- **The look.** Liam and LikeC4 bring their own React UI inside the frame, so BobNet's look there is
  only as good as the override stylesheet.
- **The parsers are the viewers'.** A model that LikeC4 1.61 parses but a later version doesn't
  shows its errors after a bump. The page lists them by file and line.
- **The content is each project's own item.** The skeleton shows them what is missing.

## Alternatives

- **The supervisor builds the layouts and the schema JSON at sync time** (`likec4 export json`,
  Liam's CLI) and sends them as derived blobs.
  - For: smaller viewers, and no wasm or eval in any browser.
  - Against:
    - The cache would no longer be main's bytes.
    - The supervisor would take about 100 MB of dependencies, Liam's with native swc and Prisma.
    - A renderer fix would need an rc on every laptop.
    - Laptops on different rcs would send dumps in formats the one vendored renderer may not read.
  - Rejected. It is the fallback for `erd` only, if Liam's parser won't build for the browser (build
    B, task 3).
- **Loosen the dashboard's own CSP** (`'unsafe-eval'`, inline styles) and draw in the page. Rejected:
  `eval` beside the owner socket.
- **A full LikeC4 site per project** (`likec4 build`, 6.8 MB each) in a frame. It needs a Node build
  per change, so the same objections as the supervisor build apply, plus the size. Rejected.
- **Projects commit the built output to main.** That puts generated files on main, which drift from
  their sources, and needs tooling in every repo. Rejected.
- **Mermaid's C4 and ER diagrams.** No drill-down and no focus. They stay for small diagrams.
  Structurizr and IcePanel were ruled out by Mario's recommendation: a server, and SaaS.

## Build tasks

These replace 0015's list, and were re-cut by the amendment. Build A brings the library with its
skeleton. Build B brings the zoomable diagrams and the entity card. Each is at most 7 tasks, for
Luigi. A task marked **pending Q-21** waits for Casper's verdict on version 3; the rest don't.

**Build A, the library** (0015, plus §1-5 here), 7 tasks:

1. **Protocol.** 0015 §4's ops and reads; `LIBRARY_SECTIONS`; the v2 manifest's zod types, with
   `children`'s `match` and `skip`, the `likec4` and `erd` kinds, `erd`'s optional `about`, and
   `library_page`'s `files`; the 900 KB `library_blob` frame.
2. **Broker, Board.** 0015 §2, as written.
3. **Supervisor, the sync.** 0015 §1; resolving v2: sections against the skeleton, `children` with
   `match` and `skip`, `table`, `likec4` dirs, `erd` files with `about`, `missing`, the limits and
   problems. Tests against a `git init` fixture.
4. **Dashboard, the library page.** The rail in skeleton order with missing sections (§3), folded into
   the section's name on a diagram page (spec §5); the page head, markdown-it, the link rules and the
   states; the route with section, page and focus; `/vendor/*` immutable.
5. **Dashboard, the special kinds.** `table`; `children` with card heads from front matter or the
   lines under the title (§2); `mermaid` 11.x as an `<img>`; `likec4` and `erd` pages show their
   source list with GitHub links, which is also their fallback in build B.
6. **The project menu** (AC3), per Daisy's spec. **Pending Q-21** (A, B or C).
7. **The manifests.** Helix's and Vitals' v2 from build.py per §4, Vitals' `erd` with its `about`.
   Mario routes them to those projects' leads.

`about` costs build A nothing more than a field in task 1 and a blob in task 3. If Q-21 drops the
card, both are left out.

**Build B, the zoomable diagrams and the entity card** (§6, §7), 6 tasks:

1. **The tools and the Worker.** `tools/vendor/` with the LikeC4 viewer (its settings, §7),
   `viewers.json` and `THIRD_PARTY.txt`; the Worker serves the viewers with their CSP; the dashboard's
   CSP gains `frame-src 'self'`.
2. **Dashboard, the `likec4` page.** The frame and the messages (`ready.views`, both `focus`, `fit`);
   the bar (crumb, ↑ Out, the views picker); the focus in the route, the errors, opening links, the
   loading state.
3. **The ERD viewer.** Liam's parser and app from source at one release; the React Flow bridge; the
   theme, `#1DED83` and the hidden header; `'unsafe-eval'`; `ready.tables` in full, and, **pending
   Q-21**, `hover`, `inset` and the drawer kept off. The vendoring test. Time-boxed: if Liam's
   `packages/schema` won't bundle for the browser, stop and send Toad what failed (the fallback is in
   Alternatives). If only the app won't build from source, use the CLI's prebuilt app with the
   click-and-wheel centring, under the same test.
4. **Dashboard, the `erd` page.** The frame, the bar (crumb, the table picker, Fit, Full screen), a
   table's focus in the route, the errors.
5. **Dashboard, the entity card** (spec §10.2, §10.3). **Pending Q-21.** The card docked or as a
   sheet, its relation chips, key fields and folded columns from `ready.tables`; `about` matched to
   the tables; the inset sent to the viewer; the hover preview on a fine pointer; the keyboard.
6. **Tests.** The spike's frame tests (`architecture/spikes/bob212/frame-*.mjs`) on the vendored
   viewers at 1280 and 390 wide, in the broker's suite: the messages, a table opened and centred,
   and the card (**pending Q-21**).

The card is about 2 tasks, as sized for Q-21: half of B3 (the viewer's richer `ready.tables`,
`hover` and `inset`), B5 (the page), and `about` in A1 and A3. No build C is needed.

**What ships how.** A broker deploy carries everything in build B, and build A's tasks 1, 2 and 4-6.
Task 3 rides an rc. Task 7 rides the projects' own lands. Helix's `schema.sql` is Helix's task
(Bill's, spec §10.4), not BobNet's.
