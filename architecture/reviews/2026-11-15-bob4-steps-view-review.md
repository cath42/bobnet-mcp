# Review: BOB-4 the steps view (cdedac5, 5474b52)

Toad, 2026-11-15, for Mario. Luigi's handoff `w_a53c1f42`. Read: cdedac5 (`packages/protocol/src/board.ts`,
`packages/broker/src/board/store.ts` `itemHistory`, `sessionRecord`, `ciRunRecord`, `usualMs`,
`runRecord`), 5474b52's `public/app.js` (route, `loadFeature`, the session card, the ctx panel,
`board_changed`), the client's `board-tools.ts` and `server.ts`, ADR 0001 §9 and §10. c404749 is
test-only BOB-3 evidence and I didn't review it. At 5474b52 I ran broker `test/board.test.ts` and
`test/board-export.test.ts` (83 pass) and the UI suite (65 pass).

## Verdict

**Not deploy-ready yet: one major (finding 1), a small broker fix. Signed off (BOB-4 DoD 3) once it
lands.** No migration, and that holds. rc.32 and rc.33 are safe apart from finding 1, which reaches
both of them the moment the broker deploys. `with_tasks` is dashboard-only and needs no client
release. Four minors and two nits can follow.

- **No migration.** `schema.ts` hasn't changed since board migration 2 (5b6717e). `runs.ctx`,
  `runs.remote_url` and `ci_runs` (`source`, `external_id`, `name`, `laptop`, `session`) are all in
  migration 1 (`schema.ts:235-303`), and `run_start`/`run_end` already fill them. cdedac5 only reads
  them.
- **rc.32 (live) and rc.33 (installed).** `packages/client` and `packages/supervisor` haven't
  changed since rc.33 (d584f4c). Since rc.32 (2173995), the only client change is BOB-10's tool
  descriptions. The protocol change is one optional zod field (`get.with_tasks`) plus result
  interfaces. `get` isn't `.strict()`, and the client's `checked()` passes the op through as it is
  (`board-tools.ts:39`). Replies go back as JSON with no response schema. So both clients take the
  new `RunRecord` and `SessionRecord` fields unchanged. That is exactly why finding 1 matters.
- **`with_tasks`: dashboard-only, confirmed.** The dashboard is served by the same deploy
  (`public/`), and it sends `board_op` over the owner's socket. `board_get`'s shape
  (`board-tools.ts:92`) doesn't offer the flag. If a model sent it anyway, an old client would pass
  it through and the broker would honour it, which does no harm. No client release is needed.

## Findings

### 1. Major: a run's `ctx` reaches agents through `board_get` (fix before deploy)

`runRecord` now returns `ctx` on every `get {session}` (`store.ts:2002`). The MCP tool `board_get`
returns the same reply, and the client writes it into the agent's context as
`JSON.stringify(result, null, 2)` (`client/src/server.ts:287`). A run's `ctx` is up to 400 points
(the supervisor's `CTX_POINTS`, `supervisor/src/board.ts:23`; the store accepts up to 2000).
Pretty-printed, that's one number per line: about 6 KB, or a few thousand tokens per run. A
build session with a resume or two then costs an agent 10-20k tokens per `board_get` of a session
(Peach's acceptance, Mario's planning), for a chart no agent reads. Production already has
`run_end` rows with `ctx`, so this starts the moment the broker deploys, for rc.32 and rc.33 alike.

The cause is ADR 0001 §9, which said `board_get` on a session "returns its runs with `ctx`". I wrote
that with the dashboard in mind and missed that the MCP tool is the same read. I've amended §9.

**Fix (broker only, additive):** `get` gains `ctx: z.boolean().optional()`. A session's runs carry
`ctx` only when it is true: make `RunRecord.ctx?: number[]` optional and leave it out otherwise.
`loadFeature` asks for it (`app.js:416`); the app already reads `r.ctx ?? []` almost everywhere. Don't
add it to `board_get`'s shape. Add a test: a `get {session}` without the flag has no `ctx` on its
runs, and with it, it does. `ci_runs` can stay: they're small, and an agent asking about a session
may want them.

### 2. Minor: a slot run's "usually" mixes projects

`usualMs` for `source = 'slot'` matches on (`laptop`, `name`) across projects (`store.ts`
`usualMs`). Every project's land slot is named `land` (`supervisor.ts:1152`), so on a laptop that
lands both BobNet and Helix, BobNet's "usually about N min" is a median over both projects' lands.
This also follows ADR 0001 §10 as I wrote it, and I've amended it: (`project`, `laptop`, `name`).
The fix is one `AND project = ?` term and an extra project in the test at `board.test.ts:716`.

### 3. Minor: every feature opened in a tab is refetched on every board change

`feats` is never pruned (`app.js:404`), and `board_changed` reloads every cached feature of that
project (`app.js:1976`). Each reload is a `get` with history and tasks' history, a full task list,
and one `get` per session, and each of those runs `usualMs` per CI run. A tab that has opened ten
features since morning makes about 40 Board reads on every write to the project, including each
`run_start`, `run_end` and `ci_run`. Reload only the feature on screen and drop the others, or mark
them stale and read them when opened. The dashboard is the only reader, so no protocol change.

### 4. Minor: "N calls" counts downsampled points

`app.js:651` and `:719` take `r.ctx?.length || r.calls`. `ctx` is downsampled to 400, so a run
of 900 calls shows "400 calls". Put `r.calls` first. The band (`app.js:709`) lines runs up by
point index, and for a run over 400 calls an index is not a call. That's acceptable for a
grey band, but say so in the chart note, or skip runs whose `calls` differs from `ctx.length`. The
`RunRecord.ctx` doc comment should say "downsampled to at most 400 points; `calls` is the count".

### 5. Nits

- `itemHistory` reads the project's whole history to keep one event (`history("projects", p.pk).filter(...)`).
  A read by `seq` does it directly.
- `usualMs` scans `ci_runs` with no index on (`project`, `source`, `name`, `status`). That's fine at
  today's size. If CI history grows, add the index in the next board migration, or compute it only
  for `queued`/`running` runs, if Daisy agrees the spec shows "usually" only on those.

## What I checked and found right

- **`itemHistory`** (BOB-14 #5). The import line is added only when the item has no
  `create`/`capture` of its own. `ORDER BY seq LIMIT 1` picks the project's first import, so a
  project carried through an export and re-import keeps its original line (import brings the old
  events, `export.ts:668`). `with_tasks` merges the events of the feature's current tasks by `seq`
  (`events_record (tbl, pk)` indexed). One consequence for Peach: a task moved into the feature
  brings its earlier history, and a task moved out takes its own.
- **`ci_runs` / `usual_ms`**: oldest first, median of the last 20 passed, null under three, as §10
  says (apart from finding 2). The tests cover both sources.
- **`remote_url`** is only written by `run_start`, a pinned supervisor's op (`supervisorOp`), and it
  is zod `url()`. It is shown as an `href` like the Now tab's existing link (`app.js:274`).
- **`#feature/<project>/<id>`** (my BOB-3 finding 2): resolved. `featureRoute` takes
  `<project>/<id>`, and a bare id still resolves by prefix or draft prefix. `featureHref` gives
  every service feature link its project, and the picker writes `<key>/<ref>`. A promoted draft
  still matches through `fd.item.ref`. A tiny thing: before `projects` arrives, a two-part hash goes
  to the Backlog.md path and sets `state.inc` to the project key for one render. That's harmless.
- **Close commit link**: `https://github.com/<repo>/commit/<sha>`, set as an attribute, with no
  markup path. Handoff text from the stored close, not the laptop path: right, since the browser
  can't open the file.

## Spec gaps (Luigi's 1-5), where they touch how the parts fit

1. **Next step's rule.** Building it in the dashboard is fine for BOB-4. It is a pure function of
   board records (status, sessions and their closes, waits), so nothing is lost by it. But Mario
   (planning), BOB-5's Waits and the Overview's "next" will want the same answer. Once a second
   reader needs it, move it into the store as a derived field on the feature (as `overview` already
   derives `next_ready`), so the dashboard and the lead can't disagree. Not showing "Then: …" when
   no record holds it is right: don't invent it.
2. **"With its tasks (N)" counts events.** Not a parts question. Note the scope in item 1 above
   (current tasks only).
3. **Roles in history.** The event stores the grant's role key (`events.role`). Show it as stored,
   unless the project gives its roles display names. Hard-coding `po` → "PO" in the app is fine as a
   one-off, but don't grow a table of role keys in `app.js`.
4. **Overview's run line.** Don't fan out a `get {session}` per running session from the Overview.
   When it's built, the `overview` read should carry each open session's latest CI or slot run
   (`status`, `started_at`, `usual_ms`) as an additive field. One Board read, the same rules as
   the session card. A slot that is held right now is already in the snapshot (`slots`) for the
   live part.
5. **Now stays until BOB-5's Waits tab.** Agreed. Now reads the snapshot, not the board, so keeping
   it costs nothing on the parts' side.

On Luigi's other decisions: session state (closed / running / waiting) derived on read, one detail
row at a time, and the existing `duration()` are all dashboard matters. The protocol is unaffected.

## For Mario

- Finding 1 goes to Luigi before the deploy. With it landed, BOB-4 is deploy-ready: broker only, no
  migration, no client or supervisor release, and rc.33 can go live in either order. 2-5 can ride
  along or follow.
- ADR 0001 §9 and §10 amended (this commit).
