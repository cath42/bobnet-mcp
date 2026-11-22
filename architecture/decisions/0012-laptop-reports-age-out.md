# 0012. Laptop reports age out: a request lives a day, a report is stale at 3 min and gone at 30 days, the outbox shows

- **Status:** accepted (Toad, 2026-11-22), for BOB-48 (session `BOB-48 design A`), which groups BOB-26,
  BOB-17, BOB-23 and BOB-28. Line numbers are at 6eb560c. The build brief is
  `architecture/bob48/build-brief.md`. Daisy designs the banner and the Laptops card's wording
  (`design/BOB-48/`). §2 and §3 are what my answer to her consult c_0e45c9ca gave her.

## Context

Casper: "a crapton of old permission requests ... why isn't it cleaning up properly?" (BOB-26,
captured 2026-11-15 14:10Z). Half of this has already been fixed: `6d4ef04`, released in rc.34
(2026-11-15), expires orphaned requests and stops offering a quiet laptop's requests. What it left
behind:

- **The bound lives only in the supervisor.** `ORPHAN_TTL_MS` (24 h, `supervisor/src/supervisor.ts:138`)
  is applied by `expireOrphans` (`:1114`) at start (`:655`) and every minute (`:712`). A copy of a remote
  request uses the same bound (`remotePending`, `:1039`). The dashboard shows whatever is in each laptop's
  `snapshot.pending` (`broker/public/app.js:1227`), so a supervisor older than rc.34 still shows its dead
  requests forever.
- **Reports never go.** The broker keeps every `laptop_reports` and `project_boards` row for good. The
  alarm (`broker/src/broker.ts:871-885`) sweeps messages, peers, audit and updates, but not these.
- **A stalled board outbox can't be seen.** BOB-27 held 312 board reports for 11 h, and only the
  supervisor's log said so (review `architecture/reviews/2026-11-15-bob27-board-reports-review.md`,
  findings 1 and 2).
- **The broker is silent on its own errors.** A handler's unexpected exception is rethrown
  (`broker.ts:154`), so the client times out after 15 s with no code. The broker's audit table is
  kept for 90 days, but nothing can read it (system review 2026-11-14, finding 12).

## Decision

### 1. A request lives a day, wherever it is shown

The supervisor is the authority. It owns its request rows, expires them (`expired`, decided by
`supervisor`, audited `orphan:expired`), and does that at start before it first reports. That doesn't
change. The bound is **24 h from `created_at`**. Anything that shows a laptop's pending requests applies
it as well, as a display guard: **the dashboard never shows, offers or counts a pending row whose
`created_at` is over 24 h old** (brokerNow, from any laptop, stale or not). That covers a supervisor
older than rc.34 and a stale report alike. The broker doesn't edit a laptop's snapshot: it stores what
the laptop said.

An open request can't be that old: the router times it out after `request_timeout_minutes` (default 60,
`supervisor/src/config.ts:200`). So the guard only ever hides dead rows. A config that set that timeout
above 1440 would lose its oldest open rows from the dashboard, but not from `pending_requests`. I accept
that.

### 2. A report is stale at 3 min and swept at 30 days

- **Stale:** no report for 3 min, which is three missed 60 s heartbeats (`REPORT_HEARTBEAT_MS`). The
  dashboard works this out (`staleReport`, `app.js:1225`) from the broker-stamped `at` and the broker's
  clock (`skew`). The broker computes no stale flag. A stale laptop's pending list is **kept and
  marked**: it is never offered, only counted, and §1 bounds the count. So after a day the count
  reaches 0, and the laptop shows only how long it has been since its last report.
- **Swept:** the hourly alarm deletes a `laptop_reports` row whose `at` is over 30 days old. It then
  deletes the `project_boards` rows of any laptop that has no report row left, once they too are over
  30 days old. A board is sent only when it changes (`supervisor/src/board.ts:391-402`), so a live
  laptop's board can be old and still current. That is why a board goes with its laptop and not by its
  own age. `laptop_supervisors` stays, so a laptop that comes back keeps its pin. A project removed from
  a laptop that is still live keeps its row until whole-board pushes retire (ADR 0001 §8). That is a
  known limit.

### 3. The report carries its board outbox

`LaptopSnapshot` gains an optional field, `board_outbox: { count: int ≥ 0, oldest_at: ISO | null, code:
string ≤ 40 | null }`:

- `code` is the error code the oldest row last waited on, or null before it fails.
- A new supervisor always sends the field, as `{ 0, null, null }` when the outbox is empty.
- An older supervisor sends nothing, and the dashboard shows nothing for it.
- **Stuck** means count > 0 and `oldest_at` over 5 min old. Below that the reports are in flight: the
  outbox is retried every minute and on every report.

The supervisor also checks each row's ctx with `BoardCtx.safeParse` before sending, next to the op check
it already makes (`supervisor.ts:3384`). A row that fails is final (`bad_row`, audited). Then a broker
`bad_frame` means only version skew. The broker already checks the ctx (`BoardOpFrame`,
`protocol/src/frames.ts:431`, parsed at `broker.ts:149`).

### 4. The broker answers its own failures and lets the owner read its audit

- **`internal`:** a new `ErrorCode`. A non-`FrameError` thrown while handling a frame is logged
  (`console.error`, with the rid), audited as `internal` (`{ t, rid, err }`, err clipped to 500 chars)
  and answered `{ t: "error", rid, code: "internal" }`. The message carries no stack. A client treats
  `internal` as a failure that can be retried, never as final. The supervisor's outbox already does
  (`FINAL_BOARD_ERRORS`, `supervisor.ts:142`).
- **`audit`:** a new client frame `{ t: "audit", rid, limit?: 1-500 (default 100), before?: seq }`, for the
  owner only (any other identity gets `forbidden`). It answers `{ entries: [{ seq, ts, actor, action,
  detail }], more }`, newest first (`ORDER BY seq DESC`). `before` pages back.
- **Boards follow the dashboard reply.** The `dashboard` reply's `boards` is always `[]`. After the `ok`,
  the broker sends one `{ t: "board", laptop, at, board }` frame per row, to that socket only. That is the
  frame live boards already use (`app.js:3063`). No reply nears the 1 MiB cap again.

### Compatibility

Every change is additive:

- An old broker strips `board_outbox`, because `LaptopSnapshot` is a non-strict `z.object`.
- An old supervisor omits it.
- An old client gets `internal` as a `BrokerError` instead of a timeout. It doesn't validate server
  frames (`client/src/connection.ts:229`).
- An old broker answers `audit` with `unsupported`.
- `Dashboard.boards` stays in the type.
- The dashboard and the broker deploy together.

## Consequences

- One number, 24 h, bounds a request everywhere. If it changes, it changes in the supervisor
  (`ORPHAN_TTL_MS`) and the dashboard's guard together. Each cites this ADR.
- A retired laptop leaves the dashboard 30 days after its last report, and its boards go with it.
- A stall like BOB-27 shows on the Laptops card within 5 min plus a heartbeat.
- The owner can read why the broker refused or failed something without `wrangler tail`.

## Alternatives

- **The broker drops old pending rows when it stores a report.** Rejected: the broker would rewrite a
  laptop's own account and gain nothing. The dashboard ships with the broker, so the guard there
  reaches every viewer just as soon.
- **A shorter request bound (for example 6 h).** Rejected: a human-tier request asked late in the day
  should still be answerable the next morning. The restart notice already goes out at once.
- **The broker computes `stale`.** Rejected: the dashboard needs a clock-corrected age anyway, and has
  one.
- **Sweep boards by their own `at`.** Rejected: an unchanged board on a live laptop would vanish (§2).
