# BOB-212 build A, review A: architecture (Toad, 2026-11-28)

Range: `de4a1d9..b733241` on origin/v2 (BOB-227..232; BOB-226's protocol is `de4a1d9` itself, read where the build
uses it). Checked against ADR 0015 (§1, §2, §4-§7) and ADR 0017 as amended for Casper's Q-23 ("Liam as is": no
viewer of ours, no per-table control, no entity card; menu A). Line numbers are at `b733241`.

**0 blockers, 0 majors, 7 minors.** I re-ran `supervisor/test/library-sync.test.ts` (10 passed) and the broker's
`test/library.test.ts` and `test/auth.test.ts` (14 passed).

## 1. BOB-228 AC2: pass

The AC: "No new credential or service: it reads the local clone's origin/main only. Evidence: code review against
ADR 0017; a change committed to the fixture's main shows in the next sync."

- **No new credential.** The sync runs `git` and nothing else, in the project's own clone (`p.path`), through the
  supervisor's existing `exec` (`supervisor/src/board.ts:327-330`) and `catFiles` (`:333-361`).
  - The only network call is `git fetch -q <remote> <branch>` (`supervisor/src/library-sync.ts:44-51`). It uses that
    remote's existing configuration and credential helper, as the rebase tool does.
  - It reads no token, sets no environment and calls no `gh` or HTTP. The `github` link is derived from
    `git remote get-url` (`:54-59`, `githubOf` `:27-31`), which is a config read.
- **No new service.** It sends over the supervisor's existing broker connection, as itself
  (`supervisor.ts:591`, `this.broker.boardOp(this.config.name, op)`). The broker never reaches GitHub. The ops are
  `SUPERVISOR_OPS` and are refused unless the caller is a supervisor that registered the project as one it serves
  (`broker/src/board/library.ts:133-138`).
- **It reads the ref, never a worktree.** Everything is read at the commit `rev-parse --verify <remote>/<branch>`
  gives (`library-sync.ts:52`):
  - `ls-tree -r -l -z <commit> -- library/` (`:62`);
  - `cat-file --batch` by blob id (`:78`);
  - `git log … <commit> -- library/` (`:106`).

  The ref is `libraryRef` (`:22-24`): the rebase target, else `origin/main`, as 0015 §1 says. So it is `origin/main`
  for the fixture, Helix and Vitals, and `origin/v2` for BobNet. The AC's "origin/main" is the default case of that
  rule, not a different rule.
- **A change on main shows at the next sync.** `library-sync.test.ts:151-168` pushes a glossary change to the
  fixture's origin main. The next `sync` keeps the new commit, sends only the new blob, and the file's `changed.sha`
  is the new commit. The clone's working tree is never updated in the fixture, so the test also proves that the
  worktree isn't what is read. `:215-227` shows that the post-land sync (`fetch: false`) reads the moved ref and
  nothing else.

**Ruling: AC2 passes.** Peach may check it with this file as the evidence.

## 2. The op's name, and the 900 KB frames

- **`library_sync` is the right name, and the ADRs were wrong to call the write `library`.** Reads and writes are
  one discriminated union keyed by `op` (`protocol/src/board.ts:243` is the read, `:542-552` the write).
  `BOARD_READS` and `SUPERVISOR_OPS` (`:568-570`) list them by that name, and the broker tells reads from writes by it
  (`broker.ts:398`, `board.ts:40`). A write named `library` can't exist beside the read `library`. The read keeps
  0015 §4's name, and the write is named for what it does. I have amended the text of 0015 §4 and 0017 §4 to match
  (same commit as this review). The change is additive: both ops are new.
- **900 KB frames are within the limits.**
  - The runtime caps a WebSocket message at 1 MiB (`broker.ts:138`), and 900 KB is under that.
  - The size check runs before the parse into `ClientFrame`. It widens the limit only for `t: "board_op"` with
    `op.op` in `LARGE_BOARD_OPS` (`broker.ts:150`, `protocol/src/board.ts:572`). Every other `board_op` stays at
    64 KB. An oversized frame is answered `frame_too_large`, and the socket is not closed (`broker.ts:162-166`).
  - The Broker→Board RPC is well under its 32 MiB cap.
  - A blob row is at most the frame's size, under the Durable Object SQLite's 2 MB per row.
  - The Board is bounded per project. A new library deletes the blobs it no longer names, in the same transaction
    (`library.ts:83-84`, inside `transactionSync`, `board.ts:41`).
  - It is safe because the larger frame buys nothing beyond `servedBy`. Minors 1 and 2 tighten the edges.

## 3. Deploy safety

- **Store and migration: safe.** Migration 9 (`broker/src/board/schema.ts:507-529`) only adds two tables. No
  existing table or row is altered.
  - The foreign keys to `projects (pk)` can't block anything. Nothing deletes a project, and an import brings only
    new projects (`board/export.ts:347-375`).
  - Both tables stay out of the export and import (`export.ts` is unchanged). Dropping them loses nothing.
  - Library writes make no event and no history (`store.ts:1533`, `:1540-1550`). `apply` refuses them
    (`store.ts:1650-1652`).
- **CSP: unchanged, as build A should leave it.** `broker/src/index.ts:14-15` is as before. It has no `frame-src`,
  no `'unsafe-eval'` and no `'wasm-unsafe-eval'`: those belong to build B's ERD and LikeC4 frames (0016 §6, 0017 §7).
  - The only header change is `/vendor/*` served `immutable`, and only for an asset that exists (`index.ts:102-104`,
    `auth.test.ts:25-37`).
  - markdown-it runs with `html: false` (`public/library.js:96`). Links follow 0015 §6's rule (`:192-215`). Repo
    images become GitHub links (`:158-164`).
  - Mermaid runs with `securityLevel: "strict"` and is shown as a `data:` SVG `<img>` (`:244-252`). It is loaded as a
    classic script from `'self'` (`:221-226`).
  - The page has no `innerHTML`, `eval` or `new Function`.
- **Protocol drift: none.** Everything is additive.
  - Two new supervisor ops, and two new reads (from `de4a1d9`).
  - An optional `library` on `ProjectRecord`.
  - A wider frame limit for those two ops only.
  - Old clients and MCP tools see one more optional field on `projects` and `project`.
  - An old supervisor sends nothing, and the page shows "not written yet".
  - A new supervisor with an old broker is answered `bad_frame` and is otherwise harmless (minor 3).
- **Nothing of build B and no custom viewer.**
  - `public/vendor/` holds only markdown-it 15.0.3, mermaid 11.17.2 and their licences.
  - Architecture and Data show "isn't drawn here yet" with their GitHub links (`library.js:495`, `:520-529`).
  - There is no iframe, `postMessage`, Liam, LikeC4, React Flow, dagre or `@dbml/parse`.
  - There is no per-table control, entity card or "Expand all".
  - The menu is design A, the "Projects ▾" button (`public/index.html:15-21`).

## Findings

All are minors. None blocks the deploy. Luigi fixes them in build B or a follow-up, as Mario orders them.

1. **minor: the Board hashes a blob before it knows the caller may send one.**
   - Where: `broker/src/board/board.ts:36-39` runs `gitBlobId` on up to 900 KB, before `servedBy`
     (`library.ts:41`).
   - Effect: any connection that may send a `board_op` can make the Board hash 900 KB and then be refused.
   - Fix: check `servedBy` (caller and project) in `Board.apply` before the hash, or move the hash into
     `LibraryCache.blob` after `servedBy`. The cache would then need to be async.
2. **minor: the broker doesn't enforce 512 KB in bytes.**
   - Where: `protocol/src/board.ts:536` caps `text` with `z.string().max(LIBRARY_BLOB_MAX)`, which counts UTF-16 units,
     not bytes. The 900 KB frame is the only real bound.
   - Fix: in `LibraryCache.blob` (`library.ts:42`), refuse `bytes > LIBRARY_BLOB_MAX` as `invalid`.
3. **minor: an older broker isn't "said once".**
   - Where: an older broker answers the new ops with `bad_frame` (unknown `op` in `BoardOpFrame`), and a blob over
     64 KB with `frame_too_large`, not `invalid`. `LibrarySync` logs "said once" only for `invalid`
     (`library-sync.ts:196-201`). Every other code logs at info on every tick, per project.
   - Fix: treat `bad_frame` and `unsupported` as `invalid` (0015 §4: logged once per start).
4. **minor: an index frame can be over 900 KB.**
   - Where: worst case, 267 files with a title of 300 and up to about 7 head values of 1,000 each, plus 200
     problems. The frame is then refused `frame_too_large` on every tick (`library-sync.ts:184`). The library freezes
     and later reads "may be behind main", and nothing says why.
   - Fix: in `readLibrary`, measure `JSON.stringify(op)` against `LIMITS.boardFrameBytes - 1024` (as
     `REPORT_FIT_BYTES`, `supervisor.ts:3927`). Over it, drop the cards' `head` values over a smaller cap and add one
     problem, `{kind: "too_large", path: "library/", …}`.
5. **minor: a malformed link escape breaks a page.**
   - Where: `public/library.js:208` calls `decodeURI(path)` unguarded. A link like `[x](a%zz.md)` throws `URIError`
     and the file doesn't render.
   - Fix: guard it as `dec` does at `:81`, falling back to the raw path.
6. **minor: equal `committed_at`, different commit, replaces the library.**
   - Where: `library.ts:64` keeps the stored library only when it is strictly newer. Two laptops on different commits
     with the same second's date (a different ref, or a commit and its amend) would replace each other every tick.
   - Fix: on equal dates, keep the stored commit unless the sender's is a descendant. Simpler: also keep it when the
     dates are equal. The next real commit moves it either way.
7. **minor: a library fetch can collide with a land's fetch.**
   - Where: `supervisor.ts:3515` checks the run slot once per tick, before `syncAll` walks the projects one by one.
     A land that is granted meanwhile can meet the library's `git fetch` on the same remote-tracking ref and fail with
     a ref-lock error.
   - Fix: check the slot per project inside `syncAll`, or take the clone's fetch through the same lock the land
     uses.

Copy, for Daisy: the Data tile says "All tables, in Liam" (`library.js:462`), but build A doesn't draw it yet (the
section says "isn't drawn here yet"). It is true once build B lands, so leave it if B ships in the same deploy (0017,
"What ships how").

deploy-safe: yes (additive migration of two cache tables, CSP unchanged with no 'unsafe-eval' anywhere in build A, protocol additive for old clients and supervisors, 900 KB only for the two library ops, nothing of build B or a custom viewer; 7 minors, none blocking)
