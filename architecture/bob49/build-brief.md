# BOB-49 build brief (for Luigi)

**Design:** ADR 0011 (`architecture/decisions/0011-waits-never-stale.md`). The § numbers below are its
sections. **Screens:** Daisy's spec in `design/BOB-49/`. **Criteria:** BOB-49 AC1-3 and the DoD. Line
numbers are at aa05ec6.

**Cut:** two build sessions, in order. Each lands on its own.

- **A: the board and the broker** (tasks 1-5). Deployable alone: an
  old supervisor sends no `fixes`, so only the stale rule acts until B is live.
- **B: the supervisor and the dashboard** (tasks 6-8).

**Broker migration: yes.** Board migration 8, or 7 if this builds before BOB-6 (§4: the second to land
renumbers, and whichever lands first does the `notices` remake to ADR 0010's shape).
**Supervisor: yes, it needs an rc** (task 6) and a restart of mbp-1, with ubu1 to match. **Broker
deploy:** for A and B's dashboard half.

## A: the board and the broker

1. **Migration** (`broker/src/board/schema.ts`, after `:422`):
   - `bug_fixes (pk, project, item → items, sha, subject, push → pushes, release TEXT NULL, at)`, unique
     on `(item, sha)`;
   - `release_tags (pk, project, repo, tag, sha, push → pushes NULL, at)`, unique on `(repo, tag)`;
   - `wait_flags (project, ref, owner, changed_at, flagged_at)`, primary key `(project, ref)`. Like
     `notices`, it is not board data: never exported, never read by `board_*`;
   - `notices`: `kind` gains `fix` and `stale`, and `state` gains `fix_landed`, `fix_released` and
     `stale` (§4). Do the `subject`/`kind` remake if BOB-6's hasn't landed.

   Done when a migration test takes a db at the previous version, with notices and pushes, to the
   new one with its rows intact.
2. **Protocol** (`protocol/src/board.ts`, `remote.ts`):
   - `push` gains `fixes: z.array({ ref: ItemRef, sha: 40-hex, subject: ≤200 }).max(20).optional()`;
   - a new op, `release_tag { project?, repo, tag (≤100), sha (40-hex) }`, in `SUPERVISOR_OPS`. It has
     no worker, like `ci_run`;
   - new ops `keep { project, ref, reason (1-500) }` and `withdraw { project, ref, reason (1-500) }`;
   - `WaitRecord` gains `fix?`, `stale?` and `kept?`, exactly as §3 gives them;
   - `BoardNoticeEvent` (loose, `event: "board_notice"`, §4) next to `BoardAnswerEvent`.

   Done when typecheck passes and a parse test shows that a `push` without `fixes` still parses.
3. **The fix and the release** (`broker/src/board/store.ts`, `push` at `:2345`, plus a new
   `releaseTag`):
   - **§1's marking:** resolve each ref, skip what isn't an open bug (listed as `fixes_ignored` in the
     push event), insert into `bug_fixes`, and write the `items` event with change `fix`.
   - **The PO's notice:** `kind fix`, `state fix_landed`, sent to `po`, else `lead`, in the same
     transaction.
   - **`releaseTag`:** store the tag, find its push, and set `release` on the earlier `bug_fixes` rows
     of that repo and branch. Each PO whose bug got a release gets one `fix_released` notice.
   - **`waitsOf`** (`:506`) fills `fix` for bugs and sets `blocking: false` when a bug has one.

   Done when **AC1's test** passes, as BOB-27's case in `board-waits.test.ts` or beside it:
   - bobnet's bug BOB-27, `blocks_use`, is on Waits and `blocking`;
   - a `push` with `fixes: [{ ref: "BOB-27", sha: "5d4617f4bed3884d73deb1a9cc71e1ed366215f4", subject: "v2: BOB-27: board reports no longer stall behind a row the protocol won't take" }]`
     leaves it on Waits with `fix.sha` set, `release` null and `blocking: false`, and writes a notice
     to Peach@mbp-1 whose text names the sha and "close BOB-27";
   - a `release_tag v2.0.0-rc.34` on a later push sets `fix.release` and writes the second notice;
   - `fixes` naming a feature, a Done bug, or another project's ref marks nothing;
   - the same push sent twice marks once.
4. **The stale rule** (`store.ts`, `board.ts` the DO):
   - the store takes `now: () => number`, defaulting to `Date.now`; `waitsOf` reads it;
   - `changed_at` is the newest event on the row's record (§2), and `stale` and `kept` go on the row;
   - the owner per kind is as in §2's table;
   - `flagStale()` is §2's due rule: an upsert into `wait_flags`, a `stale` notice to the owner, and
     a cleanup of flags whose record has left Waits;
   - `keep` and `withdraw`, with their rights (§2). `withdraw` sets `state = 'withdrawn'` and writes an
     event. Check that held, `startCheck` (if BOB-6 has landed) and `waitsOf` still read only `open`.

   Done when **AC2's test** passes with the injected clock:
   - a question asked at t0 isn't stale at t0+23h;
   - at t0+25h it is stale with its asker as owner, and `flagStale()` writes one notice;
   - another `flagStale()` at t0+26h writes none;
   - at t0+49h it writes a second;
   - a `keep` at t0+50h clears `stale`, and nothing is sent until t0+74h;
   - a review gate's and a bug's owner is the PO, and the lead when the project has no PO;
   - a row with no owner sends nothing and is audited;
   - `withdraw` takes a question off Waits.
5. **The broker** (`broker/src/broker.ts`):
   - `alarm()` (`:868`) calls the board's `flagStale()` before `drainSafely()`;
   - the drain reads `subject` and renders the new kinds' text and JSON;
   - `noticeSupervisor` (`:518`) works unchanged off the JSON's `lead` and `asked_by`;
   - a `release_tag` with no worker goes through the same gate as `ci_run`.

   Done when a broker test shows the alarm, with a moved clock, sending the stale message to the
   owner and the `board_notice` to the project's supervisor once, and a `push` with `fixes` delivering
   to the PO.

## B: the supervisor and the dashboard

6. **The supervisor** (rc):
   - **The trailer read** (`supervisor.ts`, `reportPush` at `:3427`; pass it `tipBefore` from `:2758`).
     Run the `git log` of §1, parse with `ItemRef`, and send `fixes`. With no target, read `HEAD` only.
   - **`release_tag`** after `upgrade_supervisor` builds a tag (`upgrade.ts`, using the sha `verify`
     resolved at `:171`). Send it through the outbox with `ctx: null`, as `ci_poll`'s ops go (`:3381`).
   - **`board_notice` forwarding** beside `onBoardAnswer` (`:1386`), to the same orchestrators. Skip
     an orchestrator that is in `to`, and record the id first.
   - **The router** (`router.ts:65-73`): `forWorker` gets the project's `board`, and a service board
     gets §5's text, word for word.

   Done when four tests pass:
   - a land of a commit carrying `Fixes: BOB-27` and `Co-Authored-By:` reports that fix, and a land
     with `Fixes: BOB-27, BOB-30` reports two;
   - an upgrade reports its tag;
   - a `board_notice` reaches the orchestrator once;
   - a lead on a service board gets the board_ask text, and a lead elsewhere gets today's.
7. **The MCP surface** (`packages/client`, `supervisor/src/mcp.ts` and `worker-tools.ts`, wherever
   `board_write` and `board_ask` are described):
   - `board_write` gains `keep` and `withdraw`;
   - `board_ask`'s description adds: "A lead waiting on Casper asks here, with holds_sessions, never only
     in plain text."
   - `land`'s description adds: "A commit that fixes a bug carries the trailer `Fixes: <REF>`."

   Done when a tool-list test shows the new ops and words.
8. **The dashboard, to Daisy's spec** (`broker/public/app.js`, `style.css`): how `fix`, `stale` and `kept`
   read on Waits on you and Needs you. Done when the dashboard tests cover a fixed bug, a stale row
   (flagged and not yet flagged), a kept row and a lead's question on Needs you, and there are
   screenshots on a phone and a desktop.

## After the build (not code)

9. **AC3, live:**
   - Mario adds the BobNet lines below to `lead/CLAUDE.md`;
   - poe sends Helix's, Athletic's and Vitals' orchestrators their lines;
   - poe checks with `board_grants` that each project's lead has `questions`;
   - the evidence is a real lead's `board_ask` with `holds_sessions` seen on Needs you on the live
     dashboard.
10. **The convention:** each project's commit rules gain `Fixes: <REF>`. BobNet's are in `CLAUDE.md`
    (Mario), and each other project's go through its orchestrator (poe).

## Lead prompt lines

**BobNet** (`lead/CLAUDE.md`, under how Mario asks Casper):

> When you need Casper's answer before work can go on, ask with `board_ask`: the question, your
> options (mark the one you recommend), context, and `holds_sessions` for the session that waits on
> it (or `holds` for the items). A question only in your reply or a message doesn't show on his
> dashboard. If he answers in your Remote Control session, record it at once with `board_ask answer
> { ref, key, words }`, his words verbatim. If you're told a question of yours has waited a day,
> `keep` it with why it still stands, edit it, or `withdraw` it. A commit that fixes a bug carries the
> trailer `Fixes: BOB-n`.

**Helix, Athletic, Vitals** (poe sends each orchestrator; they put it in their lead's prompt, with their
prefix):

> Ask Casper on the board, not only in your session. When you need his answer before work can go on,
> call `board_ask` with the question, your options (mark the one you recommend), context, and
> `holds_sessions` for the session that waits on it (or `holds` for the items). Then end your turn;
> you may also say the question in your reply. A question asked only in plain text doesn't show on
> his dashboard. If he answers by typing in your session, record it at once with `board_ask answer
> { ref, key, words }`, his words verbatim. If BobNet tells you a question of yours has waited a day
> unchanged, `keep` it with why it still stands, edit it, or `withdraw` it. A commit that fixes a bug
> ends with the trailer `Fixes: <REF>` (e.g. `Fixes: LAND-312`), so the board marks the bug for your
> PO to close.

**Helix can `board_ask` today:** BOB-9 is Done (2026-11-17), its board is the service, and its workers
get the board tools (`supervisor.ts:2494`). Its lead needs only `questions` in its grant, which is to be
checked (task 9).

## Not here

- A "turn ended waiting on Casper" signal (§5, alternatives).
- Releases for projects that don't run `upgrade_supervisor` on their own repo, such as Helix's deploys.
  Their bugs say "fix landed <sha>" with no release. A later `release_tag` sender (a deploy job, through
  the CI token's path) can fill it in without changing this design.
