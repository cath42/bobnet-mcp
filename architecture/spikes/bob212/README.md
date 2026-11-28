# BOB-212 spike: zoomable diagrams (LikeC4, Liam ERD) in BobNet's page

> **Since ADR 0017** (the library standard), the data model is DBML, not a Postgres schema. The second spike is
> at the end: "DBML in the ERD viewer". The sample project it draws is `sample/`.

Toad, 2026-11-26. The decision this feeds is ADR 0016. Casper's go and the direction are in
`lead/bob212/frameworks-decision.md`.

The question: can the dashboard draw a LikeC4 model and a database schema from the raw files on
main, under the dashboard's CSP, on a phone? Or does something have to build them first?

## What was built

- **BobNet's own architecture as a LikeC4 model**, `architecture/model/bobnet.c4`. It has six views:
  - `index`: the context;
  - `containers`;
  - `brokerComponents`, `boardComponents` and `supervisorComponents`;
  - `land`, a dynamic view.

  Clicking an element that has its own view drills in: from context to containers, then to the
  broker, then to the Board object, three levels. `likec4 validate` passes. ADR 0015's planned parts
  are tagged `#planned`.
- **A generic LikeC4 viewer** (`viewer-frame.jsx`). It takes `.c4` sources by `postMessage`, then
  parses, lays out and draws them in the browser, using `@likec4/language-services/browser` and
  `likec4/react` 1.61.1. It is bundled with esbuild:
  - `--alias:node:events=events --alias:node:module=./node-module-stub.js`;
  - `--define:import.meta.env='{"DEV":false,...}'`;
  - `--loader:.wasm=binary`.

  `pack-viewer.mjs` then makes it one self-contained HTML file and writes the CSP hashes beside it.
- **A generic ERD viewer** (`pack-liam.mjs`). It is Liam's own prebuilt app from `@liam-hq/cli`
  0.7.24 (`dist-cli/html`), packed into one HTML file. A preamble shims storage and cookies, and
  answers the app's `fetch("./schema.json")` with what the dashboard posts in.
- **A mock dashboard** (`mock-dashboard/`). It is served with the dashboard's CSP plus
  `frame-src 'self'`, and frames a viewer with `sandbox="allow-scripts"`, which gives the viewer an
  opaque origin. `frame-test.mjs` and `frame-erd-test.mjs` drive it in headless Chromium at
  1280×800 and at 390×844 with touch.

## What it showed

| | LikeC4 | Liam ERD |
|---|---|---|
| Interactive output from the CLI | `likec4 build`: 6.8 MB, of which 3.3 MB is the generic app and 61 KB is the model | `liam erd build`: 3.2 MB, of which 2.4 MB is the generic app and the schema JSON is 44 KB for 10 tables |
| Under the dashboard's own CSP, unframed | draws, but loses its inline `<style>`s and fonts | draws, but loses its inline `<style>`s and Google Fonts |
| Parse in the browser | yes: 10 ms to compute and 155 ms to lay out 6 views, about 270 ms in all | `@liam-hq/schema` 0.6.1 (npm) parses Postgres in the browser, but needs `'unsafe-eval'` (pg-query-emscripten) |
| What the parse needs from the CSP | `'wasm-unsafe-eval'` (Graphviz wasm) and `style-src 'unsafe-inline'` | `'unsafe-eval'` and `style-src 'unsafe-inline'` |
| Packed viewer | one HTML file, 6.9 MB (2.4 MB gzip) | one HTML file, 2.5 MB (0.74 MB gzip), plus about 2.4 MB for a parser |
| Sandboxed frame, no network (`connect-src 'none'`) | works: drill, zoom and pan, and the dashboard's crumb follows the view; 0 errors on desktop and phone | works: 10 tables, a click focuses a table, its relations and its columns; 0 errors apart from the blocked Google Fonts |
| Requests from the frame | none: only the frame's own document | none |

**Gotchas**, each one fixed in the scripts:

- An opaque origin throws on `localStorage`, `sessionStorage` and `document.cookie`, so the viewer
  shims them before the app loads.
- The parent must listen before the viewer says hello.
- A minified pg-query bundle broke in the browser; the unminified one worked.
- **The parser and the renderer must come from one Liam release.** npm's standalone
  `@liam-hq/schema` 0.6.1 is older than the parser inside the CLI 0.7.24. On a real schema it cut
  most CHECK bodies at the wrong offsets, and the CLI's app drew none of its output. The CLI's own
  parser got them right.

## Where the outputs are (outside the repo)

`~/.cache/bobnet-spikes/bob212/`:

- **Public** (BobNet's own model):
  - `likec4-site/`: LikeC4's full static site, hash routes;
  - `likec4-single/index.html`: the same as one file;
  - `frame-test/`: the packed viewer `likec4-viewer.html` with `.hash`, the mock dashboard and
    `sources.json`;
  - `shots/`: the screenshots.
- **Private: Vitals' schema.** In `private-vitals/` (mode 700):
  - `liam-erd/`: the CLI's site;
  - `frame-erd/`: the packed `erd-viewer.html` and `schema.json`.

  Never commit these, and never deploy them to a URL that isn't behind Access.

To re-run:

```
cd ~/.cache/bobnet-spikes/bob212
TOOLS=$PWD/tools EXE=<chrome-headless-shell> node <repo>/architecture/spikes/bob212/frame-test.mjs frame-test
```

## DBML in the ERD viewer (ADR 0017)

Toad, 2026-11-26, after Casper's Q-21 answer: one standard format for every repo's data model.

- **Liam doesn't read DBML.** `@liam-hq/cli` 0.7.24 takes `schemarb`, `postgres`, `prisma`, `drizzle`, `tbls` and
  `liam`, its own schema JSON. So the viewer converts DBML to Liam's JSON in the frame: `dbml-to-liam.mjs`.
- **The parser.**
  - `@dbml/core` bundles every SQL importer: 15 MB. Its DBML compiler alone, `@dbml/parse` 13.0.0, is 490 KB
    (127 KB gzip). It is pure JS with no `eval`, and its errors carry line numbers.
  - DBML 13 has `DiagramView`: named diagrams, which may overlap. `TableGroup`s can't: DBML refuses a table in two
    groups.
- **The viewer.** `pack-erd-dbml.mjs` packs Liam's app, the parser bundle and a preamble into one file: 2.9 MB,
  0.87 MB gzip. The preamble gives Liam only the chosen diagram's tables, and sets Liam's own `?showMode=`. It
  toggles the mode live by a `pushState` and a `popstate`.
  - Liam drops the mode when it loads on a narrow screen, so the preamble applies it again after the first draw.
  - Liam keeps `showMode`, `active` and `hidden` (the hidden tables, a compressed list) in its URL, through nuqs.
- **The test.** `frame-dbml-test.mjs` runs it under the dashboard's CSP and the viewer's, with no
  `'unsafe-eval'`. The results are in `sample/README.md`.
- **The rules check.** `check-library.mjs` checks a library's front matter, headings, names and stray files. It
  is a reference for `protocol`'s `readFrontMatter`.

To re-run (outside the repo, in `~/.cache/bobnet-spikes/bob212/`):

```
cd dbml && npm i @dbml/parse@13.0.0 esbuild && cp <repo>/architecture/spikes/bob212/dbml-to-liam.mjs .
echo 'import { dbmlToLiam, only } from "./dbml-to-liam.mjs"; window.dbmlToLiam = dbmlToLiam; window.dbmlOnly = only;' > entry.mjs
npx esbuild entry.mjs --bundle --minify --format=iife --platform=browser --outfile=dbml.js
node <repo>/architecture/spikes/bob212/pack-erd-dbml.mjs ../tools/node_modules/@liam-hq/cli/dist-cli/html dbml.js ../frame-dbml/erd-viewer.html
cd ../frame-dbml && TOOLS=../tools EXE=<chrome-headless-shell> node <repo>/architecture/spikes/bob212/frame-dbml-test.mjs . <repo>/architecture/spikes/bob212/sample/library/data-model.dbml
```

The sample's architecture is `frame-test.mjs` with `sources.json` made from `sample/library/architecture/*.c4`, and
`API` as the element to drill.

## Each table opened on its own: BobNet's own ERD viewer (ADR 0017 §7, Q-22)

Toad, 2026-11-27, after Casper's Q-22: "I want to be able to toggle column/attribute level details PER ENTITY". Liam's
show mode is one for the whole diagram, so Liam is dropped (0017 §7, Alternatives).

- **The viewer.** `erd-viewer.jsx` (React Flow 12 draws, dagre lays out), `erd-viewer.css` and `dbml-model.mjs`
  (DBML to the tables, enums, diagrams and notes the viewer and the entity card read). `pack-erd-viewer.mjs`
  bundles it with esbuild into one HTML file, 0.96 MB (0.28 MB gzip), and writes its one CSP hash. It replaces
  `dbml-to-liam.mjs` and `pack-erd-dbml.mjs`, kept here as the record of the Liam spike.
- **Each table** has a control on its node, a button with its column count. It shows or hides that table's columns,
  and leaves the rest as they are. On every toggle the diagram is laid out again. The order stays (dagre orders by
  relations, not sizes), and the tables glide 200 ms. While the reader hasn't moved the view, it stays fitted;
  once they have, the toggled table stays put. Under 700 px wide it lays out top to bottom.
- **The test.** `frame-erd-own-test.mjs` runs it in a sandboxed frame under the dashboard's CSP and the viewer's (its
  hash only), at 1280 by mouse and 390 by tap. It asserts, after each step: which tables show columns, the
  `expanded` message, and no overlapping tables. Then the state handed back in `files`, focus, hover, expand all /
  collapse all, and the Lending diagram. 0 console errors. The shots are in `shots-per-entity/`:

  | Shot | What it shows |
  |---|---|
  | `*-a-all-collapsed` | All tables, every one closed |
  | `*-b-loan-expanded` | loan open, the other 8 closed |
  | `*-c-loan-member-expanded` | loan and member open |
  | `*-d-member-only` | loan closed again; member still open |
  | `*-e-expand-all` | every table open (the page's optional extra) |
  | `*-f-lending-loan-expanded` | the Lending diagram, loan open |

  At 390 the fitted diagram is at about 60 %, so a node's control is about 33 x 20 px on screen. Pinch-zoom makes it
  bigger.

To re-run (outside the repo):

```
cd ~/.cache/bobnet-spikes/bob212 && mkdir -p erd-own && cd erd-own && npm init -y
npm i react@19 react-dom@19 @xyflow/react@12 @dagrejs/dagre @dbml/parse@13.0.0 esbuild && cd ..
node <repo>/architecture/spikes/bob212/pack-erd-viewer.mjs erd-own frame-own/erd-viewer.html
TOOLS=$PWD/tools EXE=<chrome-headless-shell> node <repo>/architecture/spikes/bob212/frame-erd-own-test.mjs frame-own \
  <repo>/architecture/spikes/bob212/sample/library/data-model.dbml frame-own/shots
```

## Liam as is (ADR 0017 §7, Q-23)

Toad, 2026-11-27, after Casper's Q-23: "Liam as is". Our viewer above is dropped. Liam ERD draws the data model,
unpatched.

- **The pipeline, all in the sandboxed frame.** First DBML, then DBML's own exporter (`@dbml/core` 13.1.0,
  `exporter.export(text, "postgres")`), then PostgreSQL DDL, then Liam's own parser (`@liam-hq/schema` 0.6.1's SQL
  processor), then Liam's schema JSON, then Liam CLI 0.7.24's app, byte for byte.
- **The pack.** `pack-liam-as-is.mjs` writes one HTML file: 5.65 MB, 1.38 MB gzip. It stubs `@dbml/core`'s SQL
  importers, 14.6 MB that export never calls; without the stubs the bundle is 17.5 MB. The frame shell is the
  storage shims and the answer to `fetch("schema.json")`, as `pack-liam.mjs` has them.
- **The CSP** needs `'unsafe-eval'` (pg-query-emscripten), isolated by the sandbox (0016 §6).
- **The test.** `liam-as-is-test.mjs`, at 1280 by mouse and 390 by touch, checks:
  - 9 tables drawn;
  - the frame's DDL is the unbundled exporter's;
  - Liam's parse in the frame equals Liam CLI's `schema.json` for the same DDL (same content; only key order
    differs);
  - a broken DBML reports line 83;
  - the only console error is the blocked Google Fonts request.

  It takes about 2 s to ready. The shots are in `shots-liam-as-is/`. At 390 the fitted diagram is about 25 %, and a
  tap opens Liam's side pane.

To re-run (outside the repo, in `~/.cache/bobnet-spikes/bob212/`):

```
mkdir liam-as-is && cd liam-as-is && npm init -y && npm i @dbml/core@13.1.0 @liam-hq/schema@0.6.1 esbuild
node -e 'const fs=require("fs");fs.writeFileSync("schema.sql",require("@dbml/core").exporter.export(fs.readFileSync(process.argv[1],"utf8"),"postgres"))' \
  <repo>/architecture/spikes/bob212/sample/library/data-model.dbml
../tools/node_modules/.bin/liam erd build --format postgres --input schema.sql --output-dir cli/out && cd ..
node <repo>/architecture/spikes/bob212/pack-liam-as-is.mjs liam-as-is tools/node_modules/@liam-hq/cli/dist-cli/html frame-liam-as-is/erd-viewer.html
TOOLS=$PWD/tools EXE=<chrome-headless-shell> node <repo>/architecture/spikes/bob212/liam-as-is-test.mjs frame-liam-as-is \
  <repo>/architecture/spikes/bob212/sample/library/data-model.dbml liam-as-is liam-as-is/cli/out/schema.json <repo>/architecture/spikes/bob212/shots-liam-as-is
```
