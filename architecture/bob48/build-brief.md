# BOB-48 build brief (for Luigi)

**Design:** ADR 0012 (`architecture/decisions/0012-laptop-reports-age-out.md`). The § numbers below are
its sections. **Screens:** Daisy's spec in `design/BOB-48/`, for the stale banner and the Laptops card's
backlog line. **Criteria:** BOB-48 AC1-4 and the DoD. Line numbers are at 6eb560c.

**Cut:** one build session of 7 tasks, in this order. **Broker migration: none.** The sweep only
deletes, and the new frame reads an existing table. **Broker deploy: yes**, for tasks 2-5 and 7.
**Supervisor rc: yes**, for task 6. After it, restart mbp-1 and ubu1. Either can go live first (ADR 0012,
Compatibility).

## Already true on v2: checked, not to build

- **AC1, mostly done in `6d4ef04` (rc.34).** `expireOrphans` (`supervisor/src/supervisor.ts:1114`)
  expires an orphan in four cases: no session, role gone, already resumed, or over 24 h
  (`ORPHAN_TTL_MS`, `:138`). It runs at start before the first report (`:655`) and every minute (`:712`).
  Remote copies use the same bound (`:1039`). Tests: `supervisor/test/supervisor.test.ts:784-826`. What
  is left: the dashboard guard (task 7) and a restart test with a row already over 24 h old (task 6).
- **AC2, the stale part, done in `6d4ef04`.** `staleReport`, 3 min against the broker clock
  (`broker/public/app.js:1225`). A stale laptop's requests are not offered (`:1227`). The card shows "no
  recent report" and "N requests from its last report not offered" (`:2807-2809`). The Now stale-line
  (`:1325-1331`) shows only human-tier rows. What is left: the banner (BOB-23 AC3, Daisy's spec) and
  the sweep (task 4).
- **AC3, the broker's ctx check, already true.** `BoardOpFrame.ctx` is `BoardCtx.optional()`
  (`protocol/src/frames.ts:431`), parsed at `broker/src/broker.ts:149`. The open part, from the BOB-27
  review's finding 2, is the **supervisor's** local check (task 6). Peach: AC3's wording names the
  broker. I suggest "the supervisor checks each outbox row's ctx with BoardCtx.safeParse (the broker
  already does)".
- **AC4: none of the three parts is done.** The `dashboard` reply still carries every board
  (`broker.ts:201-203`, `:661-664`). A non-`FrameError` is rethrown with no answer (`broker.ts:154`). No
  frame reads the broker's `audit` table (`ClientFrame`, `frames.ts:436-451`). The audit is written at
  `broker.ts:857` and swept at `:879`.

## Tasks

1. **Protocol** (`protocol/src/frames.ts`). Parent: BOB-28, BOB-23.
   - `LaptopSnapshot` (`:165`) gains `board_outbox: z.object({ count: int ≥ 0, oldest_at: string.nullable(),
     code: string.max(40).nullable() }).optional()` (§3).
   - `ErrorCode` (`:459`) gains `internal` (§4).
   - A new `AuditFrame = { t: "audit", rid, limit: int 1-500 optional, before: int optional }` goes in
     `ClientFrame`. `Results.audit = { entries: Array<{ seq, ts, actor, action, detail: unknown }>, more:
     boolean }`.
   - `Dashboard.boards` stays as it is, with a comment: always `[]` from 0012 on, and the boards follow
     as `board` frames.

   Done when a parse test shows a snapshot parses with and without `board_outbox`, and an `audit`
   frame parses and fails on `limit: 0`.
2. **`internal` with the rid** (`broker.ts:153-156`). Parent: BOB-23 AC1. In `webSocketMessage`'s
   catch, a non-`FrameError` is:
   - `console.error("frame failed", { rid, t, err })`, with the stack in the log only;
   - `auditAs` on the connection's actor: `internal`, with `{ t, rid, err: message.slice(0, 500) }`;
   - sent as `{ t: "error", rid, code: "internal", message: "The broker failed on this frame; it is in its audit" }`.

   It is never rethrown. Done when a test (`runInDurableObject`, with a method such as `listPeers`
   swapped for one that throws, then a `peers` frame) gets `error`/`internal` with its rid, and an
   audit row.
3. **Boards after the reply** (`broker.ts:201-203`, `dashboard()` at `:625`). Parent: BOB-17 AC1.
   - `dashboard()` returns `boards: []`.
   - The `dashboard` case sends `ok`, then one `{ t: "board", laptop, at, board }` per `project_boards`
     row, ordered by laptop and project, to that socket only (`this.send(ws, ...)`, not `toOwners`).
   - `app.js:3041` already builds `state.boards` from the reply, and the frames arrive after it and add
     to it (`:3063`). Check that a reconnect's fresh reply clears the old map first. It does today.

   Done when a broker test reads the frames in order: `ok` with `boards: []`, then N `board` frames.
4. **Sweep** (`alarm`, `broker.ts:871`). Parent: BOB-17 AC2. `REPORT_RETENTION_MS = 30 days`:
   - `DELETE FROM laptop_reports WHERE at <= cutoff`;
   - then `DELETE FROM project_boards WHERE at <= cutoff AND laptop NOT IN (SELECT laptop FROM laptop_reports)`.

   `laptop_supervisors` is kept (§2). Done when a test runs the alarm with an old laptop and a fresh one,
   each with a board, plus a fresh laptop with a board 40 days old. The first laptop's report and its
   board are gone. The other two keep theirs.
5. **The audit read** (`broker.ts` `dispatch`). Parent: BOB-23 AC2.
   - The new `audit` case is owner only, else `FrameError("forbidden")`.
   - It runs `SELECT seq, ts, actor, action, detail FROM audit WHERE seq < ? ORDER BY seq DESC LIMIT ?`,
     with `before` defaulting to "no bound", and `limit + 1` read to set `more`.
   - `detail` is `JSON.parse`d.

   Done when a test checks three things: the owner gets the newest first, `limit` and `before` page, and
   a laptop identity is refused.
6. **Supervisor** (`supervisor.ts`, `store.ts`). Parent: BOB-28, BOB-26.
   - `snapshot()` (`:3569`) adds `board_outbox` from a new `store.outboxSummary("board_op")`:
     `SELECT count(*), min(seq), min(created_at) ... WHERE kind = ?`. Don't read the bodies: this runs
     every 3 s.
   - `code` is the oldest row's last error code. Replace `boardWaitLogged: number` (`:3280`) with
     `boardWait: { seq, code } | null`, and use the code only when its seq is still the head.
   - In `flushBoardReports` (`:3384`), next to the `BoardOp` check: `report.ctx` that fails
     `BoardCtx.safeParse` is `bad_row`, final and audited.
   - `fitRunName` (`:401`) clips by code point: `Array.from(name).slice(0, SLOT_NAME_MAX - 1).join("")
     + "…"`.

   Done when tests show four things:
   - a restart with an orphan whose `created_at` is 25 h old has it expired before the first snapshot,
     with no `expireOrphans` call;
   - `board_outbox` reads `{0,null,null}` empty, then the count, oldest and code while a row waits;
   - a bad-ctx row is dropped with `board:refused`;
   - a name of 99 units ending in a surrogate pair isn't split.
7. **Dashboard** (`broker/public/app.js`, `test-ui/dashboard.test.ts`). Parent: BOB-26, BOB-23 AC3,
   BOB-28.
   - `REQUEST_MAX_AGE_MS = 24 h` (§1; the comment cites `ORPHAN_TTL_MS`). A `livePending(l)` drops rows
     with `created_at` past it. Use it in `pendingAll` (`:1227`), `staleLines` (`:1328`) and the card's
     count (`:2809`).
   - The stale banner and the backlog line follow Daisy's spec. Stuck means count > 0 and `oldest_at`
     over 5 min old. Show nothing when the field is missing or the outbox isn't stuck.

   Done when the UI tests cover: a 25 h-old row from a fresh laptop isn't shown, a stale laptop's banner
   shows, the backlog line appears at 6 min and not at 2 min, and an old snapshot without the field shows
   no line. Screenshots at 390 and 1440 go in `design/BOB-48/shots-build`.

## Evidence, for the review

- **AC1:**
  - task 6's restart test and supervisor.test.ts:784's clock tests;
  - a dashboard check on mbp-1 and ubu1 after the deploy, showing no request over 24 h old;
  - which rc ubu1 runs. It needs ≥ rc.34 for its own expiry, and task 7's guard covers it either way.
- **AC2:** task 4's test, task 7's banner test, and screenshots.
- **AC3:** task 6's and task 7's tests, and screenshots.
- **AC4:** tests 2, 3 and 5. Nothing found already done (above).
- **DoD 4:** say "broker deploy (tasks 2-5, 7) and rc plus restart of mbp-1 and ubu1 (task 6)".

## Side check: the pnpm store (poe's BOB-126/BOB-123 note)

**Keeping `~/Library/pnpm/store/v3` was right.** The installed pnpm is 11.3.0 (fnm's node 24), and its
store is `v11`. But `~/Code/health` and `~/Code/choreography` pin `packageManager: pnpm@9.15.0`, so pnpm
switches to 9.15.0 there:

- `pnpm store path` in those two repos says `/Users/ct/Library/pnpm/store/v3`;
- their `node_modules/.modules.yaml` has `storeDir: .../store/v3`.

v3 (1.0 GB) is a live store for those projects. Removing it would cost a full re-download at their
next install. `oldPnpmStores` (`supervisor/src/cleanup.ts:645`) built `current` from each project's
`pnpm store path`, as it should.

The only fault is the wording: "the current store" doesn't say whose. That is a backlog chore (BOB-159),
not this build: the kept reason should name the project, for example "the store pnpm uses in health".
