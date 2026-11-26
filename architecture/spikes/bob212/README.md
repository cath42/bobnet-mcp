# BOB-212 spike: zoomable diagrams (LikeC4, Liam ERD) in BobNet's page

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
