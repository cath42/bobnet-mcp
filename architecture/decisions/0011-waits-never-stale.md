# 0011. Waits on you is never stale: a landed fix marks its bug, a day unchanged flags its owner, a lead asks on the board

- **Status:** accepted (Toad, 2026-11-22), for BOB-49 (session `BOB-49 design A`), which groups BOB-34 and
  BOB-45. Builds on ADR 0001 §7 and §10 (questions; pushes and CI), ADR 0008 (the upgrade's verified
  tag), ADR 0009 (notice rows, the project's supervisor) and ADR 0010 (board migration 7). Line numbers
  are at aa05ec6. The build brief is `architecture/bob49/build-brief.md`. Daisy designs how flagged rows
  read (`design/BOB-49/`). My answer to her consult c_50bb9fc9 is what §2 and §3's fields rule.

## Context

Casper: "we don't have stale items in that list, that's important" (BOB-34). Two cases went wrong:

- **BOB-27** was a bug (blocks use, captured 2026-11-15 16:10Z). It stayed on Waits for about eleven
  hours after its fix, `5d4617f` (16:11Z), went live in `v2.0.0-rc.34`. Nothing linked the commit to
  the bug. `push` records only the land's tip, as `(repo, branch, sha, worker)`
  (`broker/src/board/store.ts:2345`, `protocol/src/board.ts:421`). The supervisor sends it after a land
  that passes (`supervisor/src/supervisor.ts:2796`, `reportPush` at `:3427`). The broker never sees a
  commit message. Even so, the broker would also have to know which release a sha is in.
- **Nothing ages.** `waitsOf` (`store.ts:506`) lists open questions and actions, In Review items with a
  Casper gate open, and bugs that block use. A row's `since` is when it was asked or captured. Nobody is
  ever told that a row has sat there unchanged.
- **BOB-45.** A lead that calls `AskUserQuestion` is denied and told to ask "in your reply, plainly"
  (`supervisor/src/router.ts:65-73`). The broker never sees that question, so Needs you can't show it.
  Every lead works on a project whose board is the service (BOB-9 is Done, so Helix since 2026-11-17;
  Vitals since BOB-115). So every lead has `board_ask` (`supervisor.ts:2494`) as long as its grant has
  `questions` (`board/rules.ts:39`).

## Decision

### 1. A landed commit names a bug with a `Fixes:` trailer; the supervisor reads it, the broker marks the bug

- **The convention is a git trailer.** It goes in the commit message's last paragraph:
  `Fixes: BOB-27`. It may be repeated, or list several refs separated by commas. Only this key counts.
  A ref in the subject doesn't, because commits such as `v2: BOB-122: plan` name items they don't fix.
  For 5d4617f the trailer would have sat next to its `Co-Authored-By:`.
- **The supervisor matches.** It has the commits, and the broker doesn't. After a land passes, before
  `reportPush` sends the push, the supervisor runs
  `git log --format=%H%x1f%s%x1f%(trailers:key=Fixes,valueonly,separator=%x2C)%x1e <tipBefore>..HEAD`.
  `tipBefore` is the target's tip that the land fetched (`supervisor.ts:2758`). A project with no
  target fetches nothing, so it reads `HEAD` alone. Each value that parses as an `ItemRef` becomes
  `{ ref, sha, subject }`, at most 20 per push.
- **`push` gains `fixes?: { ref, sha (40 hex), subject (≤ 200) }[]`.** The field is optional. An older
  broker's `z.object` strips it, and an older supervisor never sends it.
- **The broker marks the bug** in `push`'s transaction. It resolves each ref in the push's project,
  aliases included. A ref is skipped, and listed in the push event's changes as `fixes_ignored`, if it
  is not an item of type `bug`, or is archived, or is Done. Otherwise the broker does two things:
  - it inserts `bug_fixes (item, sha, subject, push, at)`, unique on `(item, sha)`;
  - it writes an `items` event, op `push`, change `["fix", null, sha]`. Landing the fix is a change
    to the bug, so it also resets §2's clock.

  A bug can only be fixed from its own project's repo. A BobNet commit can't touch a Helix bug.
- **"In \<release\>" comes from a tag the upgrade verified.** There is a new supervisor op,
  `release_tag { project?, repo, tag, sha }`. Like `ci_run`, it has no worker (`board.ts:429`), and
  `project` may be left out when the repo is one project's.
  - **Who sends it:** the supervisor, once `upgrade_supervisor` has built a tag. That tag is the one
    ADR 0008 resolved and checked to a sha on `origin` (`upgrade.ts:171`). `repo` is
    `repoName(origin of upgrade.repo)`. Today that means BobNet's rc tags, which are what make a
    BobNet fix live.
  - **What the broker does:** it stores `release_tags (project, repo, tag, sha, push, at)`, unique on
    `(repo, tag)`. It finds the tag's own push, which exists because a release's version commit is
    landed. Every `bug_fixes` row with `release` null whose push is in that repo and branch and no
    later than that push gets `release = tag`.
  - **Why push order is enough:** lands into one branch are serialised by the run slot and rebased
    first (`supervisor.ts:2758-2771`), so the order of pushes is the order of the branch.
  - **A tag whose sha was never pushed** is stored with `push` null and marks nothing.
  - A project that never reports a tag (Helix today) keeps `release` null, and its rows say nothing
    about a release (§3).
- **The PO is told, through a notice (ADR 0009 §1),** in the push's transaction. It goes to the
  project's `po`, or to its `lead` if the project has no PO. The text:
  `BOB-27's fix landed: 5d4617f "v2: BOB-27: board reports no longer stall…", by Mario@mbp-1. Check
  it and close BOB-27: tick its criterion with the commit as evidence, then move it to Done.`
  The project's supervisor gets the JSON of §4, so a PO with no worker running still reaches
  someone who can start one.
- **When the tag arrives,** a second notice to the same PO says `BOB-27's fix 5d4617f is in
  v2.0.0-rc.34`. That is when a BobNet PO can check the fix live.

### 2. The stale rule: a day without a change on the row's own record flags its owner, once a day

- **"Changed"** is the newest `events.at` with `tbl` and `pk` equal to the row's record:
  - `questions` for a question or an action;
  - `items` for a review gate or a bug. Criteria ticks, status moves and §1's fix are all `items`
    events (`store.ts:1412`).

  Events on other records don't count: an answer to another question, a session closing on it. An
  imported row with no event uses its `since`.
- **Stale** means `now − changed_at > 24 h` (`STALE_MS = 86_400_000`).
- **The owner of each kind of row.** Casper is never the owner: he is what the row waits on.

  | row | owner |
  |---|---|
  | question, action | its `asked_by` |
  | review_gate, bug | the project's `po`, else its `lead` |

  A row with no owner gets `owner: null`. Nothing is sent, and the flag is audited as
  `wait:no_owner`.
- **The owner can clear it.** Any event on the record clears it. There are two new ops for an owner
  who has nothing else to change, both in `board_write`:
  - **`keep { project, ref, reason }`**. The row is still current. It writes an event on the record
    with change `["kept", null, reason]`, so the clock restarts. It may be called by the asker or a
    `questions`-flag holder for a question or action, and by a `status` grant holder for an item.
  - **`withdraw { project, ref, reason }`**. A question or action that is moot goes from `open` to
    `withdrawn`. That state is already in the CHECK (`schema.ts:185`), but no op set it until now. It
    holds nothing from then on, and it leaves Waits. It may be called by the asker or a
    `questions`-flag holder. No notice is sent: the only person to tell is the asker.
- **Delivery.** The Board DO gets one RPC, `flagStale()`. It reads the store's clock. For each row of
  every project's `waitsOf` that is stale, it checks `wait_flags (project, ref, owner, changed_at,
  flagged_at)`. A row is **due** when it has no flag row, or `flagged_at < changed_at`, or
  `flagged_at + 24 h ≤ now`. For a due row it writes a notice (state `stale`) to the owner and
  upserts `flagged_at = now`. So an owner hears once when a row goes stale, and again only after
  another full day with no change: never once per tick. Flag rows whose record has left Waits are
  deleted.
  - Text: `Q-282 (helix) has waited on Casper for 26 h unchanged since 2026-11-21 16:40Z. If it is
    still current, keep it (board_write keep, with why); if not, edit it, withdraw it, or move it.`
  - The Broker DO's alarm (`broker.ts:868`, hourly) calls `flagStale()` before it drains. A row is
    therefore flagged between 24 h and 25 h after its last change.
- **The clock is injected.** The board store takes `now: () => number` in its constructor, defaulting
  to `Date.now`. `waitsOf`, `flagStale` and `Tx.at` read it (review A, ruling 1). A test builds the
  store with a clock it moves forward.

### 3. What a wait row carries (additive, on `WaitRecord`, `protocol/src/board.ts:512`)

- `fix?: { sha, subject, landed_at, release: string | null, tags_known: boolean } | null`. This is
  the bug's latest `bug_fixes` row. `tags_known` is whether the repo has ever reported a
  `release_tag`, and it decides whether "not in a release yet" can be said. **A bug with a fix is
  `blocking: false`**: it no longer waits on Casper, only on its PO. It stays on Waits until its PO
  moves it to Done or archives it. If the PO doesn't, §2 flags it after a day.
- `stale?: { changed_at, owner: string | null, flagged_at: string | null } | null`. Null while it is
  fresh.
- `kept?: { by, at, reason } | null`. This is the latest `keep` since the record's last other change.

Daisy decides how these read (`design/BOB-49/`). The overview's `waits_on_you` uses `blocking`
(`store.ts:611`), so it follows without changes.

### 4. Notices grow two states; the supervisor forwards them as it forwards answers

- **Board migration 8.** It adds `bug_fixes`, `release_tags` and `wait_flags`, and widens `notices`.
  - **Order with BOB-6.** ADR 0010's migration 7 remakes `notices` with `kind` (`answer` | `start`)
    and `question` renamed to `subject` (`bob6/build-brief.md`, task 1). This ADR uses the same
    shape. Here `kind` gains `fix` and `stale`, `subject` is the item's or question's ref, and `state`
    gains `fix_landed`, `fix_released` and `stale`.
  - **If BOB-49 builds first,** it takes 7 and does that remake itself with its own values. BOB-6's
    migration then only widens the CHECKs. The CHECKs are a table rebuild either way: copy the rows
    and recreate the index.
- **The drain** (`broker.ts:411`) is unchanged except that it reads `subject`. The pick of the project's
  supervisor (`noticeSupervisor`, `broker.ts:518`) reads the notice JSON's `lead`, then its
  `asked_by`, so the new JSON carries both: `asked_by` is the row's owner.
- **The supervisor's JSON** is a new remote event from `BobNet@board`:
  `{ v: 2, event: "board_notice", seq, project, ref, kind: "fix_landed" | "fix_released" | "stale",
  to: string[], lead: string | null, asked_by: string | null, text, at }`. Its schema is
  `BoardNoticeEvent` in `protocol/src/remote.ts`, a loose object like `BoardAnswerEvent`.
  - The supervisor forwards `text` to the same orchestrator(s) as an answer (ADR 0009 §4 and its
    addendum). It skips an orchestrator that is itself in `to`, and records the id first.
  - An older supervisor drops it as an unknown event, as ADR 0009 §3 says. Nothing gets worse.

### 5. A lead that waits on Casper asks with `board_ask`, and the router says so

- **The rule.** A lead that needs Casper's answer before work can go on asks with `board_ask`. It
  sets `holds_sessions` to the session(s) waiting, or `holds` to the items. Then it may also say it
  in its reply. If Casper answers by typing in the lead's Remote Control session, the lead records
  it verbatim with `board_ask answer { ref, key?, words }`. A plain-text question alone is never
  enough. A question that holds something is `blocking`, so it shows on Needs you as an ordinary
  `question` with `asked_by` = the lead (`store.ts:516-532`). The dashboard needs nothing new.
- **The router changes** (`router.ts:65-73`). When a lead's `AskUserQuestion` is denied, the message
  depends on whether the lead's project is a service board (`project.board === "service"`, passed
  into `forWorker`):
  - Service board:
    > Questions don't open a dialog here. Ask Casper with board_ask: the question, your options
    > (mark the one you recommend), context, and holds_sessions for the session that waits on his
    > answer (or holds for the items). Then end your turn; you may say the question in your reply
    > too. If he answers by typing in this Remote Control session, record it at once with board_ask
    > answer { ref, key, words }, his words verbatim. A question asked only in plain text doesn't
    > show on his dashboard.
  - Otherwise, today's text.
- **The prompt lines** (`architecture/bob49/build-brief.md`, "Lead prompt lines") go into
  `lead/CLAUDE.md` for BobNet. poe passes them on to Helix, Athletic and Vitals; BobNet doesn't edit
  their repos.
- **Helix can `board_ask` today.** BOB-9 is Done, and its supervisor entry is `board: service`
  (rc.38). The only thing to check is that Helix's lead grant has `questions`, and so for
  Athletic's and Vitals'. poe, admin on `*`, reads them with `board_grants` and asks each PO.
- **No "turn ended waiting" signal.** The supervisor can't tell a question in prose from a status
  line. A heuristic would put false rows on the very list this ADR keeps clean.

### 6. Rulings from review A (2026-11-22, `architecture/bob49/review-A.md`)

Build A landed as f983ff4. Where it went past or against the text above, this is what stands.

1. **`Tx.at` reads the store's clock.** A `keep` at a moved time has to be stamped at that time, or
   AC2 can't be tested. In production both are `Date.now`.
2. **A stale flag's event is on the project's record** (`tbl projects`, op `flag_stale`, actor kind
   `board`, `ref` the row's ref, change `stale → owner`). Its seq is the notice's `seq`. An event on
   the row's own record would restart the row's day, so it can't go there. The flag shows in the
   project's history and in the export, which is right: it was said to someone.
3. **`release_tag` writes its event on the tag's push** (op `release_tag`, change `tag`).
   `release_tags` is not an export table. A tag never pushed is stored with no event. **Added:** each
   bug still open whose fix the tag released also gets an `items` event (op `release_tag`, change
   `["release", null, tag]`). The PO was just told to check it live, so the row's day starts again
   there; a stale flag an hour after the release notice would be noise.
4. **Results:** `push` answers `fixed` and `fixes_ignored`; `release_tag` answers `released`. One
   `fix_released` notice per tag, a line per open bug, `ref` the first.
5. **A fix with no PO and no lead** still writes its notice, `to` empty. The project's supervisor
   gets the JSON: `noticeSupervisor` picks the one supervisor that serves the project without `lead`
   or `asked_by` (`broker.ts:518`).
6. **`bug_fixes` and `release_tags` are board data, so they go in the export and the import.** Each
   is an optional array on the exported project, read as empty from an older document, with refs in
   place of pks (the item's ref, a push as `repo@sha`). `wait_flags` and `notices` stay out.
7. **`flagStale`'s cleanup binds one value, whatever the number of rows.** A Durable Object binds 100
   values per statement at most, so `NOT IN (?, ?, …)` over a project's waits must not grow with them
   (`ref NOT IN (SELECT value FROM json_each(?))`).
8. **`bug_fixes.item` is a composite key**, `(project, item) → items (project, pk)`, as every link
   in one project is (`schema.ts:4-6`). `push` stays a plain key: `pushes` has no `(project, pk)`.
9. **A stale bug whose fix has landed waits on its PO, not on Casper**, and its text says so:
   `BOB-27 (bobnet) has waited on its PO for 26 h since its fix landed, unchanged since 2026-11-21
   16:40Z. Check it and close it, or keep it (board_write keep, with why).`

### 7. Rulings from review B (2026-11-22, `architecture/bob49/review-B.md`)

Build B landed as d07137e. Where it went past the text above, this is what stands.

1. **A forwarded `board_notice` ends with ` (Sent to <to>.)`** when `to` is not empty, so the
   orchestrator knows who already has it. The board's own text doesn't change.
2. **The supervisor sends `release_tag` only for a repo that one of its service projects has**, with
   that project's key and its own spelling of the repo. Any other repo would be refused, and the
   refusal is final. A tag that this process didn't verify (one already installed) isn't sent. A
   tag that goes unreported is covered by the next one, which errs late.
3. **The withdrawn toast** adds "…" only when the draft was cut, and it stays up while it carries a
   draft. The wording is Daisy's to change.
4. **Every view reads `blocking`, not `kind === "bug"`, for "blocks use".** A bug with a fix is
   "when you have time" on Status too.
5. **Dashboards re-read Waits hourly** (review A, m3), with no broker broadcast. A flag is written by
   the hourly alarm, so the lag is at most one more hour.
6. **`keep` and `withdraw` reach supervisor workers only with the rc.** A client checks ops against
   its own `WRITES` and `BoardOp`. This corrects review A.

## Consequences

- A landed `Fixes:` commit takes a bug off Needs you at once and tells its PO, with the release
  following when a supervisor installs it. BOB-27 replays as: captured 16:10Z; fix landed 16:11Z,
  non-blocking and PO told; rc.34 installed 16:48Z, PO told again; no longer stuck for hours.
- Every row on Waits is either less than a day old, kept with a reason by its owner, or flagged to
  its owner within the hour, and again each day. Casper is never the one flagged.
- **Live:** this needs the broker deploy (migration 8, `push.fixes`, `release_tag`, `keep`,
  `withdraw`, the alarm's `flagStale`) and a supervisor rc plus a restart (the trailer read, the
  upgrade's `release_tag`, `board_notice` forwarding, the router text). The two halves are
  independent: an old supervisor sends no fixes, and an old broker strips them and refuses
  `release_tag`. A refused `release_tag` is `bad_frame`, final and audited since BOB-27's own fix.
- The convention binds every project's committers: a fix commit carries `Fixes: <REF>`. That line
  goes into the lead prompt lines and each project's commit rules.

## Alternatives considered

- **Match any ref in the message:** `v2: BOB-122: plan` would mark a feature, and a bug's plan or
  review commit would mark it fixed. A trailer is explicit and git parses it.
- **The broker reads commits from GitHub:** this needs a token per repo, and the broker would be
  reading other projects' repos. The supervisor already has the clone.
- **Release containment by `git tag --contains` on the broker's demand:** the broker can't ask a
  supervisor a question that is answered later, and the laptop that holds the clone may be off. Push
  order on a slot-serialised branch is exact enough, and it errs towards "not in a release yet".
- **Hide a fixed bug from Waits:** AC1 wants it marked on Waits, and Casper sees that it is on its
  way, not gone silently.
- **Flag every tick, or only once ever:** every tick is noise. Once ever leaves a row that is stale
  for a week looking handled. Once a day, cleared by any change or a `keep`, sits between them.
- **Router turns `AskUserQuestion` into a `board_ask` itself:** it doesn't know what the question
  holds, so the question would never block, and the lead might ask again. The lead knows its
  session.
