# BOB-121 review C: what build C landed (Toad, 2026-11-23)

`d61268c..65f2f84` on v2 (Luigi, handoff w_74942fb7), checked against each task's criteria, the spec
(§2.0, 2.1, 2.2, 2.4, 2.11), ADR 0001 §7, 0012 and 0013. Line numbers are at `65f2f84`, the tip.

**Verdict: passes. Deploy-safe: yes. 0 blockers, 0 majors, 5 minors, and one ruling for Peach (gate 5).**

| Gate | Answer |
|---|---|
| 1. Broker deploy from the tip, rollback included | **yes** |
| 2. A page dead between builds C and D | **none** |
| 3. Needs you's reads, staleness, rows read | right; minors 1 and 2 |
| 4. A credential shown, a stale request answered twice | neither from build C; see the rc.54 note |
| 5. Orphaned requests | **bring back the human-tier one only, labelled, until its role runs again.** Doesn't hold the deploy |

| Task | Commit | Verdict |
|---|---|---|
| BOB-174 header, tabs, old links | e82a684 | pass, c1-c7 |
| BOB-175 Laptops | 38b4d99 | pass, c1-c5 |
| BOB-176 Needs you | 1eed0be | c1-c4, c7-c9 pass, minors 1, 2, 4; **c5 and c6 wait for their live evidence**, tests and shots pass |
| BOB-177 the agent's row | 91fd1d0 | pass, c1-c4, minor 3 |
| BOB-178 CI card | 65f2f84 | pass, c1-c4 |

Run here: the dashboard suite (150 passed) and broker `board.test.ts` (99 passed). A throwaway test (not
committed) showed minors 1, 2 and 3 and what gate 5 describes. I did not run the full suite: the last land did.
The 16 tests that went were renamed, or covered what a criterion removes (session updates, ended workers,
the CI lines, the header's picker).

## Gate 1: deploy-safe, yes

- **What changes on the broker** is one refusal (`broker/src/board/store.ts:2340`, `:2428`). No migration, no
  schema, no protocol field, no new read. `wrangler.jsonc` is unchanged.
- **rc.54 and rc.55 clients meet the same thing.** `board_ask` sends its op directly, never through the outbox
  (`client/src/board-tools.ts:169`), so no queued ask can be refused later and block it. An agent that
  puts options on an action gets `invalid` and the sentence that says to ask a question. It must ask again;
  nothing is half written, since the throw is before the counter moves. The tool's text still offers options
  on either kind until an rc changes it (Luigi's finding 2).
- **An action that already has options** keeps them, can still be edited otherwise, marked done and undone.
  An edit with `options: []` on it is still refused, by the key rule. Import (`broker/src/board/export.ts:603`)
  doesn't pass through the refusal, so a board with such an action still restores.
- **rc.54 and rc.55 supervisors** send `ask` and `decided`, so both get the note form. An older one gets
  today's. The CI card reads the board, which either supervisor already feeds; each change of a run sends
  `board_changed`, so the card follows live.
- **An open old page** keeps its own `index.html` and `app.js`, reconnects and works: every read and frame it
  uses is there. The only risk was one file new and the other old, since old `app.js` wants `#project` and
  `#waits-count`. They load together, and nothing caches them past a reload (no `_headers`, no service worker).
- **Rollback:** nothing is stored that the old broker or page can't read. `sessionStorage` ids are unchanged.
  `#needs` and `#laptops` open the Overview on the old page, as any unknown view. An action asked meanwhile is
  an ordinary one.

## Gate 2: no page goes dead

- Every link the page writes goes to one of the 8 views (`app.js:3166`); none to `#features` or `#project`.
- `oldLink` (`:3196`) is build C's column, `#rules` and a malformed `%` included, and is the one
  `decodeURIComponent`. `followOldLink` uses `replaceState`, which raises no `hashchange`, so it can't loop.
  It runs at load, on each hash change, and when the projects are read; until then `#feature/<ref>` reads
  "Reading the board…" and not an error.
- `#feature/<project>` can't be taken for a ref: a ref needs `<PREFIX>-`.
- **Not new, still true:** the Features tab of a project with no Backlog.md board says "This project has no
  backlog configured", until BOB-185 (Luigi's 5). Its features open from the Roadmap and the Overview.

## Gate 3: reads and staleness

- **The three rules hold**, in one place: `pendingAll` (report under 3 minutes) and `livePending` (a day, its worker
  in an active state, `:1336`). The tab, the Overview, the switch and the list count the same array.
- **After a restart:** until the new process reports, the old report may still offer a request. Sent in the gap
  it fails with "No supervisor is online"; just after, it answers the orphan and the worker resumes. Then the first
  report has the worker `failed`, and the request leaves (gate 5). Workers are kept 24 h after they end, so one is
  missing from the list only by the cap: minor 1.
- **Failed reads** keep what was read, never `[]`. Nothing unread is said to be none.
- **The 1 s tick** can't loop: a redraw writes the same `late` it is compared with, and it waits while one is due.
- **Rows read:** `board_changed` reads `overview` and `waits`, as before. New are one `get` when an action's form
  opens, and, only while a read is failing, a retry a minute. `overview` is the size in review B's gate 6.

## Gate 4: credentials, and answering twice

- The page draws only what the supervisor sent: `ask` (checked by `askOf`), `preview` (its own check), a
  decided row's `preview` and `note` (checked). A withheld ask shows the preview and no block (tested).
- **rc.54 note.** Build C is the first page to draw an ask whole (the old one never read `ask`). rc.55 has the
  fix of review B's M1; rc.54 hasn't, so a laptop on it could show Casper, behind Access, a credential from an
  MCP tool's input. It already crosses to the broker today. Not a gate: have both laptops on rc.55.
- **Twice:** the form closes when sent, and a second answer, from this page or a phone, is refused ("already
  answered", `router.ts:124`) and toasted. A board answer cut off by a drop goes again under its key and is taken
  once. Undo is refused by the board once anything newer happened to the question (`store.ts:2621`) or after two
  minutes, whatever the row still offers.
- **A note's toast** follows ADR 0013 §3: true, false, absent. `decided` is also kept when `fitReport` cuts
  rows, so `takesNotes` can't flip on a full report.

## Gate 5: Luigi's open question 1, orphaned requests

**What answering one does today** (`supervisor.ts:1111`, `:2513`):
- **Allow** settles it, resumes the worker's Claude session as a new worker, and pre-approves that one call, so it
  runs without asking again. A note goes in the first turn.
- **Deny also resumes the worker**, told it was denied. The dashboard can't just close one (`resume: false` is
  the lead's only).
- It expires after a day, when its session was resumed, or its role or session is gone, checked each minute
  (`expireOrphans`, `:1178`). A **fresh** worker of the same role on the same task doesn't expire it: answering then runs
  the work twice.
- Its lead is told at the restart that it is answerable, but can't decide a human-tier one without Casper's word.

**What has happened** (mbp-1's store, read only; ubu1's not read): 39 requests were answered after their worker
had ended, the latest on 14 November. All were human tier and **all 39 were denied**, most in one sweep, up to two
days late. None was ever allowed. Three more expired. That is why BOB-26 was made.

**My view: not as they were, and not gone.** Orchestrator-tier ones stay off, as built: the lead has them. A
human-tier one is the one thing only Casper can decide, and the page now says "Nothing needs you" over it. Show it when:
1. it is human tier, under a day, its laptop reporting, as any other;
2. it is orphaned, which the page can tell without an rc: `created_at` is before the report's
   `supervisor.started_at` (a start orphans every open request, then sets that time). A dead worker's
   request from after the start can't be resumed, and stays off;
3. its worker is listed as `failed`, and **no worker of its project and role has started since**. Once its lead
   runs the role again, it leaves. This is what keeps it from being stale or doubling the work.

Label it, e.g. "Howard stopped in a restart. Allow or Deny starts it again where it was", in the item, the form
and Allow's confirmation; its toast should say it resumes. Daisy words it. It changes 176 c1 and the staleness rule's
third condition (`product/requirements/dashboard-redesign.md:32`), so it is Peach's to rule. S, dashboard only. As a task
of BOB-121 in build D it is soon enough: until then he can tell the lead, who records it.

A Deny that closes an orphan and starts nothing needs the supervisor; I'd leave it to the backlog.

## Findings

### Blockers, majors

None.

### Minors

1. **A live request of a worker past the report's 100 leaves Needs you** (`app.js:1336`). The report lists the
   newest 100 workers by creation (`supervisor.ts:3660`), so the oldest active one, a lead, drops first, and the page then says
   "Nothing needs you" (shown by the probe). mbp-1 had 151 in 24 h today and has had 181. No active worker has ever
   been past it (the furthest now is 29 back), since leads restart with the supervisor. Under a day old, a request's
   worker can be absent only by that cap, so absent means unknown: drop a request only when its worker is
   **listed and not active**. One condition, and 176 c1's test line for `r_gone` turns. Later, in an rc: the supervisor
   keeps active workers first.
2. **On a reconnect, "Up to date" before the waits are read again** (`app.js:1861`). `pageLate` looks at the laptops'
   refresh, which comes first. After an hour asleep the page showed an hour-old question as up to date until the
   read answered (shown by the probe). Seconds, unless the board hangs. Late also while `ov.at` is before this socket's welcome.
3. **Allow on a worker's question is always refused** (`app.js:570`, and the line at `:592`). The router says a question is
   answered or denied, never allowed (`router.ts:128`). The button is older than build C, but the new line says "Today
   Allow and Deny override the lead", and 177 c3 asks for those words. Draw no Allow for `kind: "question"`, as
   `permissionForm` does; Daisy and Peach reword: "Today Deny overrides the lead."
4. **Allow's confirmation shows the preview, 400 characters** (`app.js:1656`), while the item above shows the command whole,
   up to 8000. As before, but a phone's dialog is the last thing he reads: say "shown whole above" when it was cut.
5. **A `board_changed` during the first read is lost** (`app.js:3382`): `ov.rows` is null and there is no error yet, so
   nothing is read again until the next change. Older than build C. `|| ov.loading` fixes it, and `loadOverview` already has `again`.

## After the deploy

176 c5's two log lines (Allow with a note, mbp-1 and ubu1), 176 c6 on mbp-1's report, and CI's first live change
on the card. No supervisor restart is needed for build C.
