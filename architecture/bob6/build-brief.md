# BOB-6 build brief (for Luigi)

**Design:** ADR 0010 (`architecture/decisions/0010-start-requests.md`). The § numbers below are its
sections. **Screens:** Daisy's spec in `design/BOB-6/`. **Criteria:** BOB-6 AC1-4 and the DoD. Line
numbers are at d26bc6e.

**Cut:** three build sessions of at most 7 tasks each, in order. Each lands on its own.

- **A: the board** (tasks 1-7). The schema, the ops, the gates and the brief. Tested in the store, and
  safe to deploy alone: no project has a declaration, so nothing is offered (§1, §7).
- **B: delivery** (tasks 8-13). The broker's drain, the supervisor's `onBoardStart` and `decline_start`, and
  the client. AC3's test with both ends real is here.
- **C: the dashboard** (tasks 14-17), to Daisy's spec. It needs A's reads and B's toast fields.

**Live:** a **broker deploy** (A, B's broker half and C), then a **release and a restart** of mbp-1's supervisor
(and ubu1's to match) for B's supervisor and client half. Then the POs write their declarations (task 18,
not code).

## A: the board

1. **Migration 7** (`broker/src/board/schema.ts`, after `:422`). §1 and §4, exactly:
   - the tables `session_kinds`, `session_kind_statuses` and `start_requests` (with the partial unique
     index);
   - the columns `projects.open_features_max`, `projects.next_start` and `grants.start_rules`;
   - `notices` remade with `kind` (`answer` | `start`), `question` renamed to `subject`, and `state` gaining
     `requested`. Copy the rows in as `kind = 'answer'`.

   Update `NoticeRow` (`store.ts:2815`) and `notices()` (`:2220`). Migration test: a db at 6 with notices
   migrates with its rows intact.
2. **Protocol** (`protocol/src/board.ts`, `remote.ts`):
   - the ops `set_start_rules`, `start_rules` (read), `start_options` (read), `start_request`, `withdraw_start` and
     `decline_start`, shaped as in §1, §2, §4 and §5. Add `start_rules` and `start_options` to `BOARD_READS`.
   - types `StartRequest`, `StartOption` and `StartRules`; `get`'s feature result gains `requests`;
   - `grant` gains `start_rules: z.boolean().optional()`;
   - `BoardStartEvent` (loose, `event: "start"`, `state: requested | withdrawn`) next to `BoardAnswerEvent`;
   - results: `start_request` and `withdraw_start` return `{ ref, seq }` plus `BoardTold`.
3. **The declaration** (`store.ts`, `rules.ts`):
   - the `start_rules` flag in `FLAGS` (`rules.ts:39`), `"set the project's session kinds and limits"`;
   - `set_start_rules` replaces the rows whole, with events, and needs the flag;
   - `start_rules` reads them (`read` needed);
   - `grant` keeps the row's `start_rules` when the op omits it;
   - the `grants` read shows `start_rules` and the declaration.

   Tests: set and read, replace drops a kind, refused without the flag (the reason names the holders), an old
   `grant` keeps `start_rules`.
4. **`startCheck` and the offer** (`store.ts`): §2's checks in the table's order, with its codes and service-written
   reasons, plus the label proposal (the first free letter of A-Z). `start_options` returns the declared kinds
   only, with `ok`/`code`/`reason`/`label`/`brief`, plus `pending` and `requests` (the last 5). `supervisor` is
   left for the broker (task 8).
5. **The brief** (`store.ts`): §3's text, assembled from the feature, the kind's skill, the most recent closed
   session (summary, need, commit, handoff path; never the handoff text), and the answered/done questions that
   hold the feature or its sessions or are needed before it, newest first, his words verbatim. Cut oldest-first
   to 16,384 characters, with the "and N older answers" line. A golden-text test.
6. **The request's life** (`store.ts`):
   - `start_request`: owner only. It runs `startCheck` again in the transaction (`conflict` with the reason),
     stores the brief verbatim, sets `edited`, takes `S-<next_start>`, and writes a `start` notice row (`to_json`
     `[]`, JSON as in §4, `by: "owner"`, `lead` the project's).
   - `withdraw_start`: owner only, pending only, and a `withdrawn` notice.
   - `decline_start`: `caller.supervisor` and `caller.serves` includes the project, pending only, reason 1 to
     300 characters, no notice.
   - In `sessionJoin` (`store.ts:1673`): a pending request on the feature and kind becomes `started` with the
     session, in the same transaction, for a new session and a rejoin alike.
   - `noticesTaken` takes `[{ seq, supervisor }]` and, for a start notice, records `supervisor`, or declines with
     `resolved_by: 'BobNet@board'` and "no supervisor runs <project>" when it is null (§4).
7. **Tests with both projects' rules and the export:**
   - Helix's declaration (one open feature; review after build) and BobNet's (§1's table). Each code refuses,
     with its reason, both in `start_options` and at `start_request`; a review on the open feature passes the
     limit; a pending request counts toward the limit; at most one pending per feature.
   - Matching: a join with another label still matches; a declined or withdrawn request isn't matched; a
     `carrySession` spawn isn't matched.
   - Who: an agent's `start_request` is `forbidden`; `decline_start` off a supervisor connection, or for a
     project it doesn't serve, is `forbidden`.
   - Export and import (`export.ts`, `protocol/src/board-export.ts`) carry the declaration, grants' `start_rules` and
     `start_requests` as optional fields; the round trip is equal.

## B: delivery

8. **The broker** (`broker/src/broker.ts`):
   - Make `noticeSupervisor` (`:501`) a function of `(project, lead, asked_by?)` and use it for both kinds. A start
     has no asker fallback.
   - `sendNotice` (`:442`) sends only `_s` for a start notice. The exactly-once check is as now.
   - `drainNotices` (`:411`) passes `{ seq, supervisor }` to `noticesTaken`, taking `toldBefore(seq).supervisor`
     for a row that was stored earlier. It sends the owners `board_changed` when a drain resolved a request.
   - Add `start_request` and `withdraw_start` to `NOTICE_OPS` (`:50`).
   - On a successful `start_options`, add `supervisor` (the pick for the project's lead) to the result before
     replying.

   Tests: exactly once across two drains; no supervisor declines; several candidates pick the lead's laptop;
   `start_options.supervisor`.
9. **The supervisor: `onBoardStart`** (`supervisor/src/supervisor.ts`, beside `onBoardAnswer` at `:1386`; branch
   at `:1349`):
   - parse `BoardStartEvent`;
   - drop it for a project not run here;
   - `beginBoardNotice` first;
   - forward to the orchestrators that answers go to (ADR 0009 addendum c_6d88fb52: `config.orchestrator`, and
     `project.orchestrator` if different), with the text below;
   - audit `board:start`.

   The text (`boardStartText`, exported for tests):
   - requested: `Casper asks to start <project> <feature> <kind> <label> (start request S-n, from the
     dashboard<; brief edited by him>). Spawn it with session { feature, kind, label } as given, the tasks you
     choose, and his brief below as the task. Or decline it: decline_start { project, request: "S-n", reason }.`
     then `---` and the brief verbatim.
   - withdrawn: `Casper withdrew start request S-n (<feature> <kind> <label>): don't start it; if you queued it,
     stop that worker.`
10. **The supervisor: `decline_start`** (`supervisor/src/mcp.ts` `TOOLS`, handler beside the lead tools). It takes
    `{ project, request, reason }` and is offered to orchestrators. It is refused (`no`, with the reason) for a
    project this laptop doesn't run on the service. Otherwise the supervisor sends `board_op decline_start` `as`
    its own `config.name`, and returns the board's reply or refusal verbatim.
11. **The client and its MCP tools** (`packages/client`): `board_write` gains `set_start_rules`, and `board_grants` shows
    the declaration with the rules. `board_get` of a feature shows `requests`. Whether to offer `start_request` to
    agents: **no**, it is owner-only.
12. **Both ends real (AC3):** a test that runs a broker with its Board and a supervisor, posts `start_request` as
    the owner, and sees the orchestrator get §9's message. A spawn with that session then marks the request
    `started`, and a `decline_start` through the tool shows `declined` with its reason. Do the same with the
    supervisor registered as another laptop's.
13. **Rollout check:** an rc.49-shaped supervisor drops a `start` event with a log and nothing else (a unit test on
    the classifier). The handoff says the order in §7.

## C: the dashboard (to Daisy's spec in `design/BOB-6/`)

14. **Start on the feature's page:**
    - render `start_options`: offered kinds, and refused ones with their reason verbatim;
    - "no supervisor runs <project>" when `supervisor` is null;
    - the brief editor with the proposed label (editable, 1 to 40 characters) and the brief (16,384 characters);
    - confirm sends `start_request` with a §12 `key`.

    A `conflict` keeps his text and shows the reason in the editor.
15. **The toast:** ADR 0009 §5's `sentTo` / `waiting` / `supervisor` clauses for `start_request` and
    `withdraw_start`.
16. **The request on the page:** pending (to whom, online or not), started (the session, linked), declined (the
    reason, by whom), withdrawn. Withdraw on a pending one. Refetch on `board_changed`.
17. **Evidence:** dashboard tests for 14-16, and screenshots on a phone and on a desktop (AC2, AC4).

## After the build (not code)

18. **The declarations:** an admin grants `start_rules` to each project's PO. Then Peach writes bobnet's declaration and
    Helix's PO writes helix's, as each sees fit; §1 has my proposal. Only after the restart (§7).

## Not here

- Gates that bind every spawn (`session_join`), a device-key signature on the request, and a role per kind in the
  declaration are all deferred (ADR 0010, alternatives).
- No status moves: Start never moves status (must-not-break).
