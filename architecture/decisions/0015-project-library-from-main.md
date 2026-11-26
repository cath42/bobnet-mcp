# 0015. A project's library: read from main by its supervisor, cached by blob in the Board, drawn by the page

- **Status:** accepted (Toad, 2026-11-26), for BOB-212 (R9, session `BOB-212 design A`), ACs 1, 2, 4
  and 5. Line numbers are at `6a2b96b` (origin/v2). Daisy designs the screens and the project menu
  (AC3, `design/BOB-212/`). §5 and §6 are what my answer to her consult c_820aa69f gave her.

## Context

- **What exists.** poe builds one claude.ai artifact per project with
  `portfolio-orchestrator/library/build.py`. Its `PROJECTS` dict (`build.py:12-55`) holds the title,
  tagline, repo, GitHub URL and ref, and the pages. Each page has an id, a nav label, a source path and
  an owner. There are three special kinds:
  - `table`: Helix's taxonomy. Pipe tables from ten area files are merged into one filterable table
    (`:132-140`).
  - `children`: Helix's scenarios. Every `.md` under a dir becomes a sub-page, grouped by its first
    folder (`:105-119`).
  - `mermaid`: Vitals' `database/data-model.mmd`, wrapped in a title and an intro (`:124-125`).
  - Besides pages, `coming` lists placeholders.
- **How build.py reads and renders.** It reads every file with `git show <sha>:<path>` after a
  `git fetch`, never from a worktree (`:101-102`). It renders with python-markdown, raw HTML shown as
  text (`:62-70`). Links are rewritten (`:73-89`): one to another library page stays in the site; one
  to any other file goes to `github.com/<repo>/blob/<sha>/<path>`; anything but http(s) or `#` goes dead.
- **Sizes at today's main.** Helix (`5474afabb`): about 180 KB over 16 files, 145 KB of it the
  taxonomy. Vitals (`62e475d`): about 136 KB over 7 files, the largest 45 KB.
- **Casper's rules** (BOB-212's description and AC2, AC4):
  - The repo's main stays the source. A cache is fine if it is rebuilt from main.
  - The broker has no GitHub access.
  - Prefer no new credential, e.g. the supervisor sending main's markdown from its clone.
- **The precedents.**
  - The supervisor already reads each project's clone and reports what it finds as its own board
    ops. The gh adapter does this for CI runs (`supervisor/src/ci-poll.ts:76-103`, sent at
    `supervisor.ts:3488-3494`), and `release_tag` for tags (`:3501-3516`). These are
    `SUPERVISOR_OPS` (`protocol/src/board.ts:545`), taken only for the projects the supervisor
    registered.
  - Backlog.md was read the same way, "through git, never from a worktree", at the rebase target or
    `origin/main` (`supervisor/src/config.ts:164-172, 532`).
- **The dashboard's constraints.**
  - Its CSP is `script-src 'self'; style-src 'self'; img-src 'self' data:` (`broker/src/index.ts:14-15`).
    So there is no CDN, and inline styles are blocked.
  - Every asset is served `no-store` (`:17-21, 97-101`).
  - It has no build step and no vendored code today.
  - Frames are 64 KB. Only `board` and `report` frames may reach 900 KB (`broker/src/broker.ts:148`,
    `protocol/src/frames.ts:18-24`).

## Decision

### 1. The supervisor fetches and sends; the broker never reaches GitHub

The supervisor syncs the libraries of its service projects (`serviceProjects()`,
`supervisor.ts:3480`). It needs no new credential: it uses the clone's own git remote, as `gh` and the
rebase tool already do.

- **When it syncs.**
  - At start.
  - Every 10 minutes: `LIBRARY_SYNC_MS`, alongside `CI_POLL_MS`.
  - Right after a land of that project pushes. The push moves the remote-tracking ref locally, so
    this costs no fetch (`supervisor.ts:3574`).
  - Nothing is on demand: no dashboard button and no broker-to-supervisor request.
- **What it reads.**
  1. `git fetch -q <remote> <branch>` in the project's main clone, for the project's ref. The ref is
     the one a backlog was read at: the rebase target, else `origin/main` (`config.ts:532`). That
     makes it `origin/v2` for BobNet and `origin/main` for Helix and Vitals.
  2. `rev-parse` of the ref.
  3. The manifest at that commit (§3).
  4. Every source at that commit, with `git show <sha>:<path>`. Each source's git blob id comes from
     `git rev-parse <sha>:<path>`, and its last change from `git log -1 --format='%h %cs' <sha> -- <path>`.
- **What it sends.** Raw bytes as git has them, plus commit, blob id and path. Two new supervisor
  ops (§4):
  - `library_blob` for each blob the broker may lack.
  - Then `library`: the resolved manifest at that commit.
- **How it sends.** Directly, with the reply awaited, **not through the outbox.** Everything is
  derivable from the clone, so a failed send is simply retried at the next tick.
  - **The sent set.** The supervisor keeps in memory which blobs each project's broker already has.
    After a restart it sends them all once, about 300 KB for both projects.
  - **A `missing` refusal.** Another laptop's newer library may have dropped a blob. The broker then
    refuses `library` with `missing`, and the supervisor clears that project's sent set.
  - **Nothing changed.** If the resolved manifest is the same as the last one sent, nothing goes.
    Once an hour it resends `library` alone as a heartbeat, so the page can show the check's age (§5).
  - **A failed fetch** is not fatal. The supervisor sends the last commit it has, with a problem
    `{ kind: "fetch_failed", at }`.
- **Several laptops with one project** all send. The broker keeps the library with the latest
  `committed_at`. An equal commit only refreshes `checked_at` and `laptop`. A laptop that hasn't
  fetched yet can't move the library back.

### 2. The broker keeps a cache, keyed by blob, never edited and never the record

The cache lives in the Board Durable Object, beside the project it belongs to (`env.BOARD`,
`broker/src/index.ts:11`). It has two tables:

- `library_blobs (project, blob, text, bytes)`, primary key `(project, blob)`.
  - A row is written once and never updated.
  - The broker checks each blob: it computes git's own id,
    `sha1("blob " + byteLength + "\0" + bytes)`, with `crypto.subtle`, and refuses a mismatch. So the
    cache is provably main's bytes.
- `libraries (project PK, ref, commit, committed_at, manifest JSON, laptop, checked_at, problems JSON)`.
  - One row per project: the current library.
  - A newer commit replaces it whole, in one transaction, after checking that every blob it names is
    present (else `missing`). The same transaction deletes the project's blobs that nothing names
    any more.

This is a cache, not a record:

- **Nothing edits it** from the dashboard, MCP or the API.
- **It is left out of the board export and import** (`broker/src/board/export.ts`,
  `protocol/src/board-export.ts`) and so out of the board backup. A restored board has no library
  until its supervisor's next sync, at the latest 10 minutes later.
- **Deleting both tables loses nothing.**
- **The limits.**
  - A blob over 512 KB isn't sent. Its page carries `too_large`, and the page links to GitHub.
  - A library has at most 200 pages.
  - `library_blob` frames may reach `boardFrameBytes` (900 KB): `broker.ts:148` checks
    `raw.op?.op === "library_blob"` beside `board` and `report`. Every other `board_op` stays at 64 KB.

### 3. The manifest lives in each repo, at `.bobnet/library.json` on its main

- **It is build.py's `PROJECTS` entry, nearly as-is**, in JSON with build.py's own keys:
  - top level: `version: 1`, `title`, `tagline`, `pages`, `coming`;
  - per page: `table: {dir, areas}`, `children: {dir, owners}`, and `mermaid: true` with `title` and
    `intro`.
  - It drops `repo` and `ref`, which are the supervisor's. `github` is optional: by default it is
    derived from the remote's URL (`repoName`, `ci-poll.ts:14-17`), and it is left off for a remote
    that isn't GitHub.
- **Why the repo.** What is in a project's library is part of its docs. The project's own team
  changes it by a land, and it is versioned with the files it names.
  - Not the supervisor config: that is Casper's, and no worker can edit it.
  - Not the broker: it would be a record there.
- **A project without the file has no library.** The page shows its "no library yet" state.
- **The supervisor resolves it** before sending:
  - `children` dirs are expanded with `ls-tree` at the commit, titles taken from each file's first
    `# ` line, as build.py does.
  - Each page gets `kind` (`md`, `table` or `mermaid`), its blob ids, `changed {sha, date}`, and
    `missing: true` if its source isn't at that commit.
  - A bad manifest is not fatal. It becomes a `problems` entry `{kind: "manifest", message}`, and the
    last good library stays.
  - The dashboard therefore never has to know the dir layout.
- **Who writes the first manifests.** Helix's and Vitals' files are those projects' own lands. We
  never write their repos (architecture/CLAUDE.md). Luigi converts build.py's two entries, and Mario
  sends each to that project's lead to land.
  - BobNet's own manifest waits for BobNet's library pages (BOB-120's table in
    `lead/bob120/bobnet-view.md`). It isn't in this feature's ACs.

### 4. The surface: two supervisor ops, two reads, one change notice; no MCP tool

Everything here is additive in `protocol/src/board.ts`.

- **`library_blob {project, blob, text}`.** A supervisor op, added to `SUPERVISOR_OPS`. It is
  idempotent: a blob already there is `ok`.
- **`library {project, ref, commit, committed_at, github, manifest | null, problems}`.** A supervisor
  op. `manifest: null` means the file is gone from main: the broker clears the project's library.
  - It answers `{ok, missing: [blob]}`.
  - A new commit sends `board_changed {project, refs: ["library"]}` (`broker.ts:420`) so an open page
    refetches. A heartbeat sends none.
- **Read `library {project}`** gives the row without texts: the manifest, commit, `committed_at`,
  `checked_at`, laptop, github and problems. The owner and any role with read on the project may use it.
- **Read `library_page {project, page}`** gives that page's texts. For an `md` or `mermaid` page that
  is one; for a `table` page it is every area file's, in the manifest's order.
- **`projects` and `project` reads** gain `library: {commit, checked_at, pages} | null`, so the
  project menu and the project page can offer the library only where there is one.
- **No MCP tool and no HTTP route.** Agents read their own repo. BOB-120's weekly sync (AC5) reads
  the page: the commit against main, and `problems` and `missing` pages as the drift to fix.
- **Compatibility.**
  - An old supervisor with a new broker sends nothing, and the page shows "no library yet".
  - A new supervisor with an old broker gets `invalid` for the new ops. It logs that once per start
    and keeps trying at the tick.

### 5. Staleness: commit, its date, and the check's age

The page knows three things:

- the commit it shows and its `committed_at`;
- `checked_at`, the last sync that found that commit, refreshed at least hourly by any laptop that
  has the project;
- `problems`, e.g. a fetch that failed, with its time.

It cannot know whether main has moved since: only that same fetch could tell it.

- **The rule.** Up to date while `checked_at` is under 2 hours old by the broker's clock (`Dashboard.now`,
  as ADR 0012 judges reports). After that, "may be behind main: last checked <age> ago on <laptop>".
- **Wording and placement** are Daisy's.

### 6. Rendering: in the page, from raw markdown, with vendored libraries

- **Markdown.** `markdown-it` (MIT), pinned and vendored as `public/vendor/markdown-it-<version>.min.js`.
  It is loaded only when the library opens.
  - It runs with `html: false`, so raw HTML shows as text, as in build.py. Its default `validateLink`
    is kept, which refuses `javascript:`, `vbscript:`, `file:` and non-image `data:`.
  - Tables are on (GFM tables are core in markdown-it).
- **Why the page renders, not the broker or the supervisor.**
  - The cache stays byte-for-byte main's.
  - A renderer fix rides one broker deploy instead of an rc on every laptop.
  - The Worker spends no CPU per read.
  - The page builds its DOM itself, so no laptop-supplied HTML is ever trusted.
- **Links.** `rewrite_links`' rule, in the page:
  - A relative link whose resolved path is a page's `src` goes to `#project/<key>/library/<page-id>`,
    with its fragment.
  - Any other relative link goes to `<github>/blob/<commit>/<path>[#frag]` in a new tab.
  - Absolute links must be http(s) or `#`; anything else is dead.
  - An image is shown only if it is `data:`. A repo image links to GitHub instead: the CSP's img-src
    has no GitHub.
- **Table pages.** The page parses the area files' pipe tables (build.py's `cells`, `:92-95`), merges
  them with the area column, and filters in place.
- **Diagrams.** `mermaid`, pinned and vendored as `public/vendor/mermaid-<version>.min.js` (about 3 MB).
  - It is loaded only for a page with a diagram.
  - The drawn SVG is shown as `<img src="data:image/svg+xml,…">`. That keeps the CSP as it is:
    mermaid's SVG carries an inline `<style>`, which `style-src 'self'` would block in the page.
  - If drawing fails, or until it has drawn, the source shows as a code block with "see it on GitHub".
- **Caching the vendored files.** `/vendor/*` is served `cache-control: private, max-age=31536000, immutable`.
  It is the one exception to `no-store` (`index.ts:97-101`), and safe because the file name carries
  the version. A phone downloads mermaid once.
- **The route** is `#project/<key>/library/<page-id>`. The menu and the layout are Daisy's (AC3).

### 7. What rides what

- **A broker deploy:**
  - the protocol ops and reads;
  - the Board tables and their migration;
  - the frame limit;
  - the dashboard pages, the vendored files and the cache header.
  It goes first, and is harmless alone.
- **An rc of the supervisor:** the sync. Mario tags; poe rolls it with `upgrade_supervisor`.
- **Each project's lands:** the manifests. They work as soon as both of the above are live.
- **What poe retires:** build.py and the two claude.ai artifacts, once AC1's evidence is in.

## Consequences

- A library is only as fresh as the last awake laptop with the project. A push to main shows within
  about 10 minutes, or at once after a land through BobNet. With every laptop asleep it shows what it
  last had and says how old the check is.
- **A new dependency** for the dashboard: two vendored, pinned files under `public/vendor/`. The
  broker's npm dependencies are unchanged, and so is the supervisor's.
- The Board object grows by about 300 KB per two projects. That is bounded by the 512 KB blob cap and
  the 200-page cap, and dropped blobs are deleted.
- A project needs `board: service` on a laptop that has its clone before its library can show
  (`config.ts:177`). Helix and Vitals are on the board today. Whether a supervisor with Vitals'
  clone has it as a service project is poe's to check.
- `library.json` is a second file a project's team keeps in step with its docs. A page that has gone
  shows as `missing`, which is what BOB-120's weekly sync looks at.

## Alternatives

- **The broker reads GitHub** (a token, the contents API, on demand or by webhook). It is the
  freshest, and needs no laptop awake. But it needs a GitHub credential in the broker, which is
  Casper's call, and it makes GitHub a dependency of every read. Not recommended.
- **A GitHub Action in each repo posts the library on push to main**, with a CI token (the `ci`
  identity exists, `broker/src/auth.ts:36-75`, `docs/ci-reporting.md`). It shows within seconds,
  with no laptop needed. But each repo needs a new Access service token as a secret, which is
  Casper's call, plus a workflow to keep in each repo.
  - The broker side is the same as §2 and §4, so this can be added later without redoing anything.
  - Recommended only if laptop-asleep staleness turns out to matter. Not now.
- **No cache: the page asks a supervisor live.** That needs a broker-to-supervisor request path, and
  the library would be dark whenever the laptop sleeps. Rejected.
- **The supervisor renders HTML.** Renderer fixes would need an rc on every laptop, and the dashboard
  would show laptop-made HTML. Rejected.
- **The Worker renders HTML.** It would add an npm dependency to the broker and CPU on every read, for
  nothing the page can't do. Rejected.
- **A whole-library frame each time.** Simpler, but Helix's grows past 900 KB in time, and it resends
  what hasn't changed. Rejected for per-blob sends.
- **The manifest in the supervisor config, or on the board.** The config is Casper's, and the board
  would make the broker a record. Rejected (§3).
- **Mermaid as code only.** It is the fallback, not the plan: Vitals' data model is a diagram, and the
  artifact draws it today.

## Build tasks (build A, Luigi)

1. **Protocol.**
   - The `library_blob` and `library` supervisor ops, and the `library` and `library_page` reads, with
     their zod types and caps (§2, §4).
   - `library` on the `projects` and `project` reads.
   - The 900 KB limit for `library_blob` frames.
2. **Broker, Board.**
   - The two tables and their migration.
   - The ops: blob id check, commit-date rule, `missing`, garbage collection in one transaction.
   - The reads and `board_changed`.
   - Leave both tables out of the export and import.
   - Tests.
3. **Supervisor, the sync.**
   - Read and resolve the manifest at the ref: children, table, mermaid, missing, problems.
   - When it runs: fetch at start, every 10 minutes and after a land; the hourly heartbeat.
   - Direct sends with the in-memory sent set, and handling `missing`.
   - Tests against a fixture repo made with `git init`.
4. **Dashboard, the library page** per Daisy's spec.
   - The route, nav and owner and changed lines.
   - Vendored markdown-it, the link rules, and images as GitHub links.
   - The no-library, stale, missing-page and too-large states.
   - `/vendor/*` served immutable.
5. **Dashboard, the special pages.** The merged, filterable table, and the mermaid diagram as an
   `<img>`, with its code-block fallback.
6. **The project menu or project pages** per Daisy's spec with Casper's words (AC3).
7. **The manifests.**
   - Convert build.py's helix and vitals entries to `.bobnet/library.json`.
   - Mario routes them to those projects' leads to land.
   - Once both show on phone and desktop, poe retires the artifacts.

Tasks 1, 2 and 4-6 ride a broker deploy, task 3 an rc, and task 7 the projects' own lands.
