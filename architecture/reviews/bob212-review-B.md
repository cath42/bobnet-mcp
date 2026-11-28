# BOB-212 build B, review B: architecture (Toad, 2026-11-28)

Range: `a461b23^..e269120` on origin/v2, 8 tasks (BOB-241, 242, 233, 243, 234, 235, 236, 244). `7931fb4`, `3996139`,
`83f28b9`, `3e67479` and `0937b86` are rc.58's lockfile fix, its release and test timeouts: glanced at. Checked
against ADR 0017 (§7, build tasks B1-B4) and 0016 §6-§7, and against review A's 7 minors (B5, B6). Casper's Q-23
stands: Liam ERD as is, menu A, no viewer of ours. Line numbers are at `e269120`.

**0 blockers, 0 majors, 4 minors.** At `e269120` I re-ran:

- `supervisor`: `test/library-sync.test.ts` and `test/upgrade.test.ts`, 81 passed;
- `broker`: `test/library.test.ts` and `test/auth.test.ts`, 17 passed;
- `broker`: `test-ui/viewers.test.ts` (frame-test and liam-as-is-test in Chromium, 1280 and 390), 2 passed;
- the two vendored files' sha256 against `viewers.json`: both equal.

## Per task

### BOB-241 B5, broker (review A 1, 2, 6): pass

- **Hashed only once admitted.** `admitBlob` checks the caller, then the size, at `broker/src/board/board.ts:40`,
  before `gitBlobId` at `:45`. The same check runs in `LibraryCache.blob` (`library.ts:137-141`). An unserved
  caller's 900 KB blob is refused before any hash (`test/library.test.ts:131`).
- **512 KB in bytes.** `library.ts:139-140` counts UTF-8 bytes, so a text of 512K UTF-16 units that is 900 KB in
  bytes is refused as `invalid`.
- **An equal date keeps the stored library** (`library.ts:65`, `>=`). The same commit is handled before that line,
  and refreshes `checked_at`. Tested at `test/library.test.ts:151`.

### BOB-242 B6, supervisor (review A 3, 4, 7): pass, minor 3

- **Said once.** `REFUSED` (`supervisor/src/library-sync.ts:156`) adds `bad_frame`, `unsupported` and
  `frame_too_large` to `invalid`. The log line is said once per start (`:230`).
- **The index fits.** `fitIndex` (`:110`) cuts the cards' long front-matter values, then all of them, and keeps the
  overview's. It adds one `too_large` problem on `library/`. It is bounded: 267 files at most, with no head values,
  fit easily.
- **The slot is asked per project.** `syncAll(projects, fetch: () => boolean)` (`:183`) is called with the slot check
  as a function (`supervisor.ts:3516`). Tested at `library-sync.test.ts:268`.

### BOB-233 B1, the vendored viewers and the Worker: pass, minors 1 and 2

- **Pinned.**
  - `tools/vendor/package.json` names exact versions: `@liam-hq/cli` 0.7.24, `@dbml/core` 13.1.0,
    `@liam-hq/schema` 0.6.1 and `likec4` 1.61.1.
  - It has its own `package-lock.json` and stays outside the pnpm workspace.
  - `build.mjs` refuses to run on any version in `node_modules` that differs from its pin.
  - A changed file under an unchanged name is refused too, because the file is cached `immutable`.
  - `viewers.json` records each file's sha256, and both match.
- **Liam as is.** `index-*.js` and `index-*.css` from `@liam-hq/cli/dist-cli/html` are inlined untouched, apart
  from the `</script` escape. There is no patch and no override stylesheet.
  - The parser bundle holds DBML's exporter and Liam's own `processor`. The ANTLR importers are stubbed.
  - The shell is 0017 §7's: storage shims, the `files` → `ready` exchange once, and `fetch("schema.json")`.
- **The frame shell checks the source.** The ERD shell checks `e.source!==parent` (build.mjs, the `shell` const).
  The LikeC4 viewer checks `e.source === parent` on `files`, `focus` and `fit` (`tools/vendor/likec4-viewer.jsx`).
- **CSP per viewer.** `broker/src/csp.ts:15-20` gives each viewer its hashes plus `'wasm-unsafe-eval'` (LikeC4) or
  `'unsafe-eval'` (ERD). The rest is 0016 §6's text, `connect-src 'none'` and `frame-ancestors 'self'` included.
  - The page's CSP gains `frame-src 'self'` and nothing else (`csp.ts:4-5`).
  - `test/auth.test.ts` checks each policy exactly, and that every hash is a script in the served file. It also
    checks that no `eval` reaches the page, and that other `/vendor/` files keep the page's policy.
- **One deviation from 0016 §6's wording, accepted.** The CSP is keyed on the extensionless address, not on
  `*.html`. Workers assets redirect `x.html` to `x`, and the redirect isn't `ok`, so it gets neither the viewer's CSP
  nor `immutable`. The page frames the extensionless address (`library.js:13-14`). Two tests tie the page's
  addresses to `viewers.json` (`test-ui/library.test.ts:297-301`, `:459`).
- **Licences.** `THIRD_PARTY.txt` covers 98 packages: Liam and `@dbml/core` are Apache-2.0, pg-query-emscripten is
  MIT.

### BOB-243 B7, library text fixes (review A 5; Daisy's review A): pass

`decPath` guards `decodeURI` (`library.js:65`). The rest is CSS and copy, which is Daisy's to judge.

### BOB-234 B2, the architecture page: pass

- **Messages are taken only from the current frame:** `e.source === v.win()` (`library.js:566-569`). Each field is
  type-checked before use (`errorsOf`, the `views` filter).
- **The frame is sandboxed:** `sandbox: "allow-scripts"`, without `allow-same-origin` (`:655`).
- **`open`:** `http(s)` links only, opened with `noopener` (`:762`). That is 0015 §6's rule for a web link.
- **Views are grouped by 0017 §2's fixed ids** (`viewKind`). A flow links to its use case. The focus goes in the
  route as a history entry.
- **Failures:** errors are shown by file and line. After 15 s without an answer, the page shows the model's files.
- **Redraws keep the frame.** `app.js` `drawView` leaves the element that holds the iframe in place, so a redraw
  doesn't reload the viewer.

### BOB-235 B3, the data model page: pass, minor 4

- **Liam's frame, as 0017 §7 has it.**
  - `files` is posted once, on `hello` (`library.js:821`).
  - `ready` gives the count. An error, or Liam's "couldn't read the converted model" with no line, shows the fail
    card, so nothing is half drawn.
  - The route is `#project/<key>/library/data`.
  - There is no picker, card or hover, and nothing of ours is inside the frame.
- The phone hint's `localStorage` is the page's own, not the frame's.

### BOB-236 B4, tests: pass

- `test-ui/viewers.test.ts` runs `frame-test.mjs` and `liam-as-is-test.mjs` in the broker's suite, so the land runs
  them.
- **The host is served with the Worker's real policies** (`viewer-server.mjs`, from `cspFor`).
- **Liam's checks** are all of 0017 §7's evidence:
  - 9 tables are drawn;
  - the DDL equals the unbundled exporter's (`fixtures/viewers/toolshed.sql`);
  - the parse equals the Liam CLI's (`toolshed.liam.json`);
  - a broken line is reported at its line, with 0 nodes;
  - the only console error is Google Fonts;
  - no request is made but the frame's own.
- The fixtures are written by `build.mjs` from the pinned packages, so a version bump re-checks them. Luigi showed
  that a changed fixture fails the test.

### BOB-244 B8, shots and touch sizes: pass

Test and CSS only (`e2e-bob212.mjs`, `style.css`). Nothing here is architecture.

### rc.58 commits (glance): fine

- The lockfile has all eight `@anthropic-ai/claude-agent-sdk-<platform>` packages.
  - They are listed under `packages:` and in the SDK's snapshot `optionalDependencies`.
  - `upgrade.test.ts` now fails a land whose lockfile drops darwin-arm64 or linux-x64 (`3e67479`).
- `check.ts` `claudeBinary` resolves the binary the way the SDK does, in the preflight only.
- `7931fb4` and `0937b86` only raise two test timeouts.

## Findings

All are minors. None blocks the deploy.

1. **minor: a viewer opened top-level isn't sandboxed.**
   - Where: `broker/src/csp.ts:18`.
   - Effect: if `/vendor/erd-viewer-0.7.24` is navigated to directly, it runs with the dashboard's origin and
     `'unsafe-eval'`.
   - It is not reachable with data:
     - the shell takes `files` only from `parent`, which is itself when the viewer is top-level;
     - `frame-ancestors 'self'` stops another site framing it;
     - `connect-src 'none'` gives it no network.

     So this is hardening, and the gap is in 0016 §6's text (mine), not in the build.
   - Fix: append `; sandbox allow-scripts` to `VIEWER_CSP`, so the document is opaque however it is loaded. The
     auth test's expected strings change with it.
2. **minor: two unversioned files are cached `immutable`.**
   - Where: `/vendor/viewers.json` and `/vendor/THIRD_PARTY.txt` get a year's `immutable` (`index.ts:101`).
   - Effect: a phone keeps a stale licence list. The Worker never needs `viewers.json` served, because it imports it.
   - Fix: move `viewers.json` out of `public/`, and give `immutable` only to names that carry a version.
3. **minor: one oversized blob is reported as an older broker.**
   - Where: `frame_too_large` is now in `REFUSED` (`library-sync.ts:156`).
   - Effect: a blob of 512 KB or less whose JSON escaping takes it over 900 KB (a text that is mostly quotes,
     backslashes or control characters) is refused at every tick. It is logged once, as "may predate libraries".
     This is pathological, not a real file.
   - Fix: in `readLibrary`, mark `too_large` any blob whose `JSON.stringify(text)` is over `LIBRARY_FIT_BYTES`.
4. **minor: a DBML with no tables is shown as an error.**
   - Where: a DBML with no tables and no errors shows "The viewer found errors in it:" with an empty list
     (`library.js:829`, `!n`).
   - Fix: give 0 tables with no errors its own state, worded by Daisy ("No tables yet"), not the fail card.

## Deploy safety

- **Worker CSP per viewer:** yes. The page never gets `eval` or wasm-eval, and each viewer has only its own
  (`csp.ts`, `auth.test.ts`). `run_worker_first: true` (`wrangler.jsonc:12`) means every asset, the viewers
  included, passes through the Worker's auth and headers.
- **Vendored packs pinned:** yes. Versions are exact and lockfiled, `build.mjs` guards both the versions and the
  file names, and the sha256 in `viewers.json` equals the files.
- **Sandboxed frames:** yes. Both use `sandbox="allow-scripts"` without `allow-same-origin`, and messages are
  checked by source on both sides.
- **No migrations that break running rc.58 clients:** none in the range.
  - `board/schema.ts` and `wrangler.jsonc` are unchanged.
  - The protocol change is one doc comment (`protocol/src/board.ts:539`).
  - The broker's B5 checks only refuse what rc.58 never sends (unserved callers, blobs over 512 KB in bytes).
  - An equal date now keeps the stored library, where before it replaced it.
- **Lockfile optional packages:** intact, as above, and guarded by a test.
- **Size:** 7.31 MB and 5.65 MB, under Workers assets' 25 MiB per file.

deploy: go
