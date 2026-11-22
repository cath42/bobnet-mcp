# BOB-48 review A (Toad, 2026-11-22)

**Reviewed:** Luigi's build A on v2: `d2293eb` (protocol), `d33ce81` (broker), `e19a30a` (supervisor),
`c04ca7b` (dashboard). Checked against `architecture/bob48/build-brief.md`, ADR 0012,
`design/BOB-48/spec.md` with the screenshots in `design/BOB-48/shots-build`, and BOB-48's criteria.
Luigi's handoff: `w_b75e7018.md`.

**Verdict: signed off for the broker deploy and for the rc.** No blockers and no majors. There are
two minors. Neither one holds anything up.

## Against the brief, task by task

1. **Protocol.** `board_outbox` is optional and non-strict, with `count` an int ≥ 0, `oldest_at` ≤ 40 and
   `code` ≤ 40. `internal` is in `ErrorCode`. `AuditFrame` takes a limit from 1 to 500 and is in
   `ClientFrame`. `Results.audit` and `AuditEntry` are added, and `Dashboard.boards` has its comment.
   All as §3 and §4 say.
2. **`internal`.** In `webSocketMessage`'s catch, a `FrameError` gets its answer as before. Anything
   else is logged with its rid and `t`, and audited on the connection's actor (`this.audit`, which is
   `auditAs` on that actor) with `err` clipped to 500. It is answered with `internal` and a message
   that has no stack, and it is never rethrown. `t` is lifted out of the try, so a frame that fails
   before the parse still names it. If the audit insert itself throws (storage failing), the catch
   throws on. That is fine: the broker can't answer for storage it can't write.
3. **Boards after the reply.** `dashboard()` returns `boards: []`. The `dashboard` case sends `ok`,
   then one `board` frame per row (by laptop, then project) through `this.send(ws, …)`, to that
   socket only. The dashboard's reply handler rebuilds `state.boards` from the reply's (empty) list,
   then `case "board"` adds each one. So a reconnect clears the old map first, and a UI test checks
   that.
4. **Sweep.** The report goes once its `at` is past 30 days. The boards go after it, with
   `NOT IN (SELECT laptop FROM laptop_reports)`, and `laptop_supervisors` is untouched. Both `at`s
   are broker-stamped ISO, so comparing the strings is sound.
5. **Audit read.** It is owner only (`forbidden` otherwise), newest first, `seq < before` (no bound
   by default), and reads `limit + 1` to set `more`. `detail` is `JSON.parse`d. Every writer
   stores `JSON.stringify` output, and a bad row would now come back as `internal`, not a hang.
6. **Supervisor.** `outboxSummary` is one aggregate with no bodies. `boardWait {seq, code}` is
   reported only while its seq is the head. Outbox seqs are `AUTOINCREMENT`, so a stale `boardWait`
   can never match a later head, and it never needs clearing. The ctx check comes after the op check,
   as `bad_row`: final and audited `board:refused`. The restart test ages a real orphan to 25 h and
   sees it expired in the first report with no call of its own.
7. **Dashboard.**
   - `livePending` is the only reader of `snapshot.pending` left (`pendingAll` and the card).
     Everything else (`humanPerms`, agent lines, `waitCount`) goes through `pendingAll`.
   - `staleBanners()` matches the spec:
     - it shows for a laptop under 24 h, oldest first;
     - two laptops get two banners, three or more get one;
     - none show unless the page is live;
     - it comes after "Board unavailable";
     - its count is human-tier rows under 24 h;
     - it has the title and the link.
   - The card's wording is the spec's. `outboxLine` shows only when the outbox is stuck (over 5 min),
     never "0", and nothing at all when the field is missing.
   - "No laptop has reported in the last 30 days." is there.

The screenshots match the spec's mock-ups at 390 and 1440 (Overview with one and three stale laptops,
the Laptops card).

## Luigi's divergences: rulings

| # | Divergence | Ruling |
|---|---|---|
| 1 | One commit per package (4), not per task | **Accepted.** Each commit names its tasks and parents, and tasks 2-5 are one file. |
| 2 | `fitRunName` clips whole code points within 99 UTF-16 units | **Accepted, and the brief was wrong.** `Array.from(name).slice(0, 99)` counts code points, so 60 emoji would come to 120 units. That fails `BoardOp`'s `max(100)` (zod counts units) and the row is dropped as `bad_row`, which is the very loss task 6 was meant to stop. His loop is right, and the test covers both a pair at the edge and a name made of nothing but pairs. |
| 3 | `setConn("live")` before the reply's render; leaving live schedules a render | **Accepted.** The spec's rule "no stale banner while the page is cut off" needs the page to be live when that render runs. The only other reader of the state is the `=== "down"` check (`app.js:2079`), and that one is more correct on a page that is already live. |
| 4 | A fake `Date` in the BOB-49 Waits tests | **Accepted.** It is scoped to that describe (`beforeAll`/`afterAll`) and fakes only `Date`, so the timers that `settle()` needs stay real. The cause is older than this build: fixtures are stamped when the file loads, and the suite runs about 2 min. Captured as chore **BOB-160** (hold the clock for the whole file). |
| 5 | The banner's link in the accent colour (`.stale-banners a`) | **Accepted.** It is the dashboard's own link colour (`--accent`), and `nowrap` keeps "Laptops →" in one piece on a phone. Daisy can restyle it in a later pass if she wants to. |
| 6 | The code clipped to 40 for the snapshot | **Accepted, and needed.** The protocol's `max(40)` on `code` sits inside `LaptopSnapshot`. Unclipped, one long code would make the broker refuse the whole report. |

## Findings

- **Minor 1: the CSS comment.** The new `.card .outbox` rules went in under the comment
  `/* A laptop's last cleanup (BOB-123) … */` (`style.css:60`), so that comment now sits over the
  wrong rule. Move it, or give the outbox its own one line, the next time `style.css` is touched.
- **Minor 2: boards arrive after the first render.** On a reconnect the page renders once with no
  boards, then renders again (debounced) as the `board` frames arrive. Anything drawn from
  `projects()` (the laptops a project runs on, legacy project rows) can flash empty for that
  moment. That is the price of §4, and the Overview's Projects card reads from the board API anyway.
  Watch for it on the phone after the deploy. No change is asked for.

**Seen, not this build:** a stale laptop's worker still reads "waiting on a permission" on Working
now (the 1440 shot with three stale laptops). That is the worker state from its last report, already
marked "no report N min" since BOB-26. Its request is not offered there.

## Old and new against each other (the deploy may go before the rc)

| Broker | Supervisor | Result |
|---|---|---|
| new | old (rc.51 on mbp-1; ubu1 whatever it runs) | The snapshot parses without `board_outbox`, and the card shows no outbox line. A broker failure reaches the old client as `{t:"error", code:"internal"}`. Its `connection.ts` rejects that with a `BrokerError` and validates no server frame. The board outbox retries it, because `internal` isn't in `FINAL_BOARD_ERRORS` (`supervisor.ts:142`). Before, the client waited 15 s for a timeout. No supervisor reads the `dashboard` reply (only the dashboard sends `dashboard`). A live laptop reports every 60 s, so the sweep never touches it. |
| new | below rc.34 (if ubu1 is that old) | Its dead requests stay in its snapshot, and the dashboard's 24 h guard hides them. That is the AC1 case the guard is for. |
| old | new | The old broker's `LaptopSnapshot` is not strict, so it strips `board_outbox`. The new ctx check is local and only stricter. Nothing else in the frames changes. |
| new | new | All of the above. |

**The dashboard against the broker:** the two deploy together. A tab still open on the old `app.js`
gets `boards: []` and then `board` frames, which its existing `case "board"` already adds. So an
open tab is right until it reloads.

## Sign-off

- **Broker deploy (tasks 2-5, 7, with the protocol): yes.** It needs no migration.
- **rc (task 6) and a restart of mbp-1 and ubu1: yes.** The two can go live in either order.
- **For Peach:** AC1 still needs the dashboard check on mbp-1 and ubu1 after the deploy, and the rc
  ubu1 runs. AC3's wording should name the supervisor's ctx check (see the brief).
