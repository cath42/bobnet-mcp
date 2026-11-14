# System review: BobNet v2, 2026-11-14

Toad, at Casper's request ("a full architecture and design review session on bobnet ... I want to keep
the design strong and healthy"). Read at v2 `753a56e`: every source file in `packages/protocol`,
`packages/broker` (with `public/app.js` in outline), `packages/client` and `packages/supervisor`, the
README and the CLAUDE.md files, and ADR 0001 (proposed). `pnpm -r test`: all 245 tests pass (protocol
13, client 16, broker 37 + 19 UI, supervisor 160). Nothing here changes code; accepting a proposed ADR
is Casper's.

## Verdict

**Sound core, strained edges.** The broker is small, synchronous and easy to reason about: one
Durable Object, run-to-completion frame handling with no awaits (`broker.ts:157-187`), versioned
migrations (`schema.ts`), durable per-recipient deliveries with acks, and identity stamped from
credentials and never taken from a frame (`address.ts:1-3`, `index.ts:33-39`). The client's reconnect
and re-register logic is careful and tested. The weak spots are where BobNet grew quickly for Helix:
landing, the owner's token, delivery once a message reaches the supervisor, one 1,800-line supervisor
class, and design rules that live in Helix's ADRs instead of BobNet's. Nothing is on fire. Findings 1
and 2 are worth fixing before release 1 goes wide. The rest are chores and ADRs.

## Findings, ranked

Severity: **High** costs work or breaks a stated guarantee now. **Medium** is a real risk or a drag
on change. **Low** is hygiene. Effort: S (under a day for Luigi), M (a few days), L (more).

### 1. High: a land on a stale tip fails late and reads as a failure

- **Evidence.** `doLand` (`supervisor.ts:983-1047`) checks for a clean tree and a HEAD it already
  refused, then waits for the run slot (`:1017`) and runs the project's land command against the
  worker's HEAD as it was. Nothing checks that HEAD contains the target's current tip. BobNet's land
  command is `pnpm -r typecheck && pnpm -r test && git push origin HEAD:refs/heads/v2` (Casper's
  supervisor.yaml). The run slot serialises lands on one laptop (`run_slots` defaults to 1,
  `config.ts:188`), but a land that queued behind another runs its whole check on the old base and
  then fails at the push as non-fast-forward. It is reported as `could not land (exit 1)`
  (`supervisor.ts:1034`), the same words as a red test, and `refusedHeads` records that HEAD
  (`:1031`), so "it was a fluke" can't land the same commit again. Pushes from interactive sessions
  and other laptops skip the slot entirely. No test covers a stale tip: the land tests are at
  `cutover.test.ts:284-440` and `:572`.
- **Recommendation.** Inside the slot and before the command, fetch the target. If HEAD doesn't
  contain it, either run the existing `doRebase` (it aborts on conflict, `:1084-1092`) or refuse at
  once with "stale tip: call rebase, then land", without running the check. Report a push the remote
  refused as **stale**, separate from failed, and don't count it as a refusal of that HEAD. Record the
  rule (finding 6, ADR P5).
- **Effort.** S for the stale precondition and its wording, M for rebase-in-slot with tests.

### 2. High: the owner's JWT is a bearer token handed to laptops, and the README claims more than holds

- **Evidence.** The Worker forwards the owner's Access JWT to the DO (`index.ts:37`), which keeps it
  in `owner_tokens` for the life of the socket (`broker.ts:96-99`, `schema.ts:71-76`). The DO sends it
  with every dashboard action to the peer named in `laptop_reports.reporter` (`broker.ts:431-441`).
  The reporter is whichever peer on that laptop sent the latest `report` frame (`:331-338`), and any
  hosted peer may send one. The supervisor checks only signature, audience and email (`owner.ts:20-27`).
  Nothing binds the token to the action, its id or a short freshness window. So:
  (a) whoever controls the broker can replay a captured token to any supervisor until it expires,
  although the README says "The broker alone can't act as you" (`README.md:47`);
  (b) a process with the laptop token can make itself reporter with one `report` frame and collect
  owner tokens;
  (c) an owner token on a laptop is a credential for Access itself. The origin check (`index.ts:30`)
  stops browsers, not scripts. Whether Access takes it from a script is unverified, so treat it as if
  it does.
- **Recommendation.** Pin the reporter to the supervisor's configured name. Refuse `report` from any
  other peer, or at least stop letting it move `reporter`. Have the supervisor require a fresh `iat`
  (a few minutes) and an action-bound nonce. Better still, the dashboard signs each action with a
  device key the owner registers once, and the JWT stops travelling at all. Correct the README now.
  Decide it in ADR P4.
- **Effort.** S for the README, the reporter pin and the `iat` window. M for signed actions.

### 3. Medium: the supervisor acks a message before anything has consumed it

- **Evidence.** For a role with a running worker, `onPush` injects the message into the session's
  input queue and acks it (`supervisor.ts:595-603`). If the worker ends before its next turn reads
  the queue, the message is lost: the broker has its ack and the supervisor inbox never got it. A
  redelivery (an ack lost in a reconnect) is injected again, because only the inbox path dedups by id
  (`store.ts:252-253`) and `onPush` keeps no seen-set. Other gaps: the channel client acks quiet
  broadcasts into an in-memory digest, lost on restart (`inbox.ts:63-66`, `server.ts:159`). The broker
  redelivers only on `register` (`broker.ts:240-243`), never to a peer that stayed connected.
- **Recommendation.** Write every inbound message for a role to the supervisor inbox first (it is
  durable and deduped), ack after that write, and mark it consumed when the worker's turn takes it. A
  worker that ends with input still unread leaves those messages waiting for the role's next worker.
  Record the delivery contract in ADR P2.
- **Effort.** S to M.

### 4. Medium: the laptop token is the laptop's whole identity, and unsandboxed workers can reach it

- **Evidence.** Any holder of a laptop's service token can register any free name on that laptop.
  It can take over a silent one (`broker.ts:198-214`), send as that name, become the reporter
  (finding 2), and spawn on other laptops as an allow-listed orchestrator: `remote.ts:4-9` trusts the
  sender, and `supervisor.ts:629` checks only the address. The client reads the token from the
  Keychain with `security` (`client/src/config.ts:52-61`). Workers don't get the env vars
  (`worker.ts:513-521`). But BobNet's and Helix's roles run `sandbox: false`, and the built-in guard
  is a string match on the supervisor's folder in the command (`policy.ts:288-291`), which doesn't
  cover `security find-generic-password`. `README.md:111` ("they can't read the supervisor's folder")
  holds only inside the sandbox. ADR 0001 §4 already writes this boundary down for the board ("not a
  hostile laptop").
- **Recommendation.** Write the trust boundary down once for the whole system (ADR P1): the threat is
  mistakes and agents overstepping, not a hostile process on the laptop. Add `security` with BobNet's
  service names to the built-in guards. State in the README what holds with the sandbox and what
  holds without it. Per-peer credentials issued by the supervisor would close this properly. They are
  L and not needed yet.
- **Effort.** S (ADR, guard, README).

### 5. Medium: one DO, one unbounded dashboard reply, and no retention for reports and boards

- **Evidence.** The `dashboard` reply carries every laptop snapshot and every project board in one
  `ok` frame (`broker.ts:374-426`). A board may be up to 900 KB (`frames.ts:23`), and the runtime caps
  a WebSocket message at about 1 MiB (comment at `broker.ts:112`). Two large boards would break the
  dashboard's load. The hourly sweep never deletes `laptop_reports` or `project_boards`
  (`broker.ts:620-631`): a retired laptop or a renamed project stays forever. Every snapshot (up to
  100 workers with 400 ctx points each) is rewritten as a whole JSON row every 3 s while workers run
  (`supervisor.ts:44, 1540-1553`). One DO is also the only recovery unit for the roster, messages,
  audit and boards. ADR 0001's `Board` DO is the first split, and the right one.
- **Recommendation.** Send boards in their own frames after the `dashboard` reply, or cap the reply
  and page it. Sweep reports and boards that have gone stale (say 30 days). Keep whole-board pushes
  only until ADR 0001 retires them.
- **Effort.** S.

### 6. Medium: BobNet's own design rules live in Helix's ADRs

- **Evidence.** The supervisor's landing, run slots and holds cite ADR 0093 and 0094
  (`supervisor.ts:108, 726, 862, 957, 1001, 1041`; `slots.ts:3, 7`; `config.ts:145, 187`;
  `worker.ts:56`). The dashboard cites ADR 0060 (`app.js:109`). Broker tests cite 0090 and 0094
  (`broker.test.ts:203-230`). Those are Helix's (`helix-navigator-*/architecture/decisions/0093-agents-land-on-their-own-branch-one-integrator-moves-main.md`,
  `0094-the-supervisor-lands-and-runs-for-supervised-agents.md`), not BobNet's: BobNet's start at 0001.
  Helix's vocabulary has also leaked into generic code: `app.js:110` reads a "Bob's brief" headline,
  `app.js:194` looks for `svc:`/`layer:` labels, and `supervisor.ts:1011` calls `requires_env` "the
  Postgres environment".
- **Recommendation.** Record the rules BobNet implements as BobNet ADRs (P5, P6), cite those numbers in
  the code, and make the Helix-specific strings come from config.
- **Effort.** S each.

### 7. Medium: `Supervisor` is one class that does everything

- **Evidence.** `supervisor.ts` is 1,828 lines, with about 30 maps and sets of in-memory state
  (`:84-126`). It holds lifecycle, the orchestrator API, broker routing (`:555-604`), remote requests
  (`:606-694`), dashboard actions (`:696-722`), scheduling and launch (`:724-842`), permission wrappers
  (`:844-952`), landing and rebase (`:954-1097`), listed runs (`:1099-1153`), consults (`:1155-1213`),
  the exit bookkeeping that touches all of them (`:1215-1276`), and reporting (`:1432-1580`). The seams
  are already visible, but every feature still adds a field to the one class and a branch to
  `onExit`. `app.js` (855 lines) is plain JS that reads protocol shapes with no type check, and it
  already copes with two shapes of `tokens` (`app.js:133`).
- **Recommendation.** Extract classes along the existing sections, with no behaviour change and one
  at a time, each keeping its tests: `Landing` (land, rebase, `refusedHeads`, `landResults`,
  `landing`, `landWaits`), `Consults`, `Reporter` (snapshot, report, `status.json`) and `BrokerInbound`
  (`onPush`, `onRemote`, `onAction`). Each takes a small interface, not the `Supervisor`. Add
  `// @ts-check` and JSDoc types imported from `@bobnet/protocol` to `app.js`.
- **Effort.** M overall, in S steps.

### 8. Medium: the protocol has no version handshake

- **Evidence.** `welcome` carries `v: 1` (`frames.ts:391`), but the client never reads it
  (`connection.ts:173-176`), and `register` says nothing about the client's version (`frames.ts:272-284`).
  The broker can't tell which clients are old, and it needs to know that before dropping anything kept
  for compatibility (`cost_usd`, `task_ref`, `ProjectBoard`). Additive fields are safe because zod
  strips unknown keys. A new frame type sent to an old broker fails as `bad_frame`
  (`broker.ts:128-129`), which doesn't say "unsupported". Server frames reach the client as a bare
  cast (`connection.ts:167`).
- **Recommendation.** ADR P3: `register` carries `client: { package, version, protocol }`, stored on
  `peers` and shown on the dashboard. Add an `unsupported` error code for an unknown `t`. Keep a
  deprecation list naming the release that removes each item.
- **Effort.** S.

### 9. Medium: the supervisor's store has no migration versioning and no retention

- **Evidence.** `store.ts:112-127` adds columns by probing `PRAGMA table_info`. The broker uses
  numbered, append-only migrations (`schema.ts:1-3, 90-101`). Nothing in the store is ever deleted
  except outbox rows (`store.ts:284`), so `workers`, `requests`, `inbox`, `audit` and
  `remote_requests` grow forever, and `snapshot()` and `Boards` scan `workers`. Restarts lose
  consults, the slot queue and in-flight lands by design (`supervisor.ts:191-199`), but no document
  says so.
- **Recommendation.** Use the `schema.ts` pattern in `store.ts`. Add a daily sweep (audit and
  requests after 90 days, consumed inbox rows after 30). Record what survives a restart (ADR P7).
- **Effort.** S.

### 10. Low: leftovers that break the team's own rules

- **Evidence.** The usage rule is tokens, never dollars, yet `cost_usd` is still on `WorkerSnapshot`
  and usage rows (`frames.ts:97, 148`) and is computed in `worker.ts:455` and
  `supervisor.ts:1453, 1489, 1503-1510`. The rule is that nothing is guessed from a brief, and the
  spawn path enforces it (`supervisor.ts:282-299`). But `namedSession`, `briefTask` and `workerTasks`
  still parse briefs for rows where `tasks` is NULL (`board.ts:49-55, 84-100`), and the dashboard
  reads task ids from update text (`app.js:118`). `SessionKind` mixes the display bucket "other" into
  the kind enum (`frames.ts:157`, `board.ts:57`).
- **Recommendation.** Make `cost_usd` optional now and remove it with ADR 0001's runs. Delete the
  brief fallbacks once no row with NULL `tasks` is younger than the 14-day usage window. Fix the kind
  enum in ADR 0001's sessions.
- **Effort.** S.

### 11. Low: test health

- **Evidence.** The suite is green and broad. Gaps:
  - Nothing runs the real client against the real broker. Client tests use a fake socket and broker
    tests send raw frames, so their contract is checked only by shared types.
  - No stale-tip land test (finding 1) and no dashboard-size test (finding 5).
  - Noise: `fatal: ambiguous argument 'origin/main'` ×3 comes from `board.test.ts:250-253`. That
    test's `exec` is an `execFileSync` with no `stdio`, so git's stderr reaches the console. Its project
    has no backlog ref or rebase, so `board.ts:541` falls back to `origin/main`, which the fixture repo
    lacks. Harmless, but it trains people to ignore `fatal:`.
  - Playwright isn't a dependency anywhere. Daisy's screenshots borrow Helix's playwright-core through
    an env var (`design/BOB-1/shots/take.mjs:2-8`, `design/BOB-1/notes.md:201`).
- **Recommendation.** In `board.test.ts`, pass `stdio: ["ignore", "pipe", "ignore"]` or give the
  project `ref: main`. Add one end-to-end test (client `BrokerConnection` against the
  vitest-pool-workers broker), the stale-tip test and a size test. Either add `playwright-core` as a
  broker devDependency, pinned to the Chromium installed, or write down that screenshots use the
  machine's.
- **Effort.** S each.

### 12. Low: observability

- **Evidence.** An unexpected exception in a frame handler is rethrown (`broker.ts:132`), so the
  client gets no reply and times out after 15 s with no code (`connection.ts:118-121`). Workers logs
  are on (`wrangler.jsonc:17`). The broker's audit table is kept for 90 days, but nothing can read it.
  The supervisor's audit can be read through the orchestrator's tool (`supervisor.ts:551`). The
  dashboard has no explicit "this laptop stopped reporting" state beyond the `at` timestamp.
- **Recommendation.** Answer `internal` with the rid and log the error. Give the owner a read of the
  broker's audit tail. Show a stale-report banner per laptop, past twice the 60 s heartbeat.
- **Effort.** S.

### 13. Low: teams scope presence but not visibility

- **Evidence.** Presence goes only to the same team or the teamless (`broker.ts:559-574`), but `peers`
  lists everyone (`:538-543`) and `send` reaches anyone (`:255-286`). That is fine if teams only
  control noise. Nothing says that they do.
- **Recommendation.** Say so in ADR P1.
- **Effort.** S.

## How ADR 0001 fits

It fits, and it moves the design the right way. The second DO starts splitting the single recovery
unit (finding 5). §4 writes down the trust boundary (finding 4). The new frames are additive
(`board_op`, `board_changed`). Whole-board pushes and `ProjectBoard` get a retirement path (§8). Four
things to settle in it before Luigi builds:

1. **Frame handling stops running to completion.** Today `dispatch` makes no awaits, so each frame is
   atomic (`broker.ts:157-187`). Calling `Board` over RPC adds an await. Other frames interleave
   there, because input gates don't block during outbound calls. The ADR should say that board-op
   handlers re-read any `Broker` state after the await and never hold a roster row across it.
2. **The source of truth for runs.** Today the supervisor's SQLite holds workers and runs, and boards
   derive from it. Under §9, `Board.runs` becomes what the dashboard shows. Say which side is the
   truth while a run is live (the supervisor) and after `run_end` (the broker). Say how `run_end`
   survives an offline broker: §12's capture queue covers captures only. Reusing the supervisor's
   outbox (`store.ts:275-285`) for its own board ops would cover it.
3. **Tokens only.** The runs table should carry tokens and drop `cost_usd` (finding 10).
4. **The kind enum.** "Other work" is no session, not a kind (finding 10).

## ADRs to write (proposed; titles and a paragraph each; none written yet)

Numbers follow 0001 and are provisional.

- **P1. System shape, state ownership and trust boundaries.** The four parts and what each owns.
  - The broker owns: the roster, messages and deliveries, the broker audit, the latest reports, and
    later boards.
  - The supervisor owns: workers, requests, inbox and outbox, the supervisor audit, and slots.
  - The client owns: one session's identity, plus its in-memory digest.
  - Git owns: code, and Backlog.md until a project moves.

  It also records the principals and what each may do: owner JWT, laptop token, worker via its
  supervisor, CI token. A laptop token speaks for every name on its laptop. The threat model is
  mistakes, not a hostile laptop. Teams scope noise, not visibility. Findings 4 and 13.
- **P2. Message delivery semantics.** Directed messages and urgent broadcasts reach the session at
  least once, deduped by id. Acks happen when the message is consumed or durably stored, never on
  receipt. Quiet broadcasts and presence are at most once and info-only. The ADR records TTLs and
  that the broker redelivers on register. Finding 3.
- **P3. Protocol versioning and deprecation.** The client announces its package and protocol version.
  Changes are additive by default. The ADR adds an `unsupported` error and a deprecation register with
  removal releases, and says when `PROTOCOL_VERSION` changes. Finding 8.
- **P4. Owner authority for dashboard actions.** Who may act as Casper, and how a supervisor knows it.
  The reporter is pinned, the token fresh and action-bound, or each action is signed with a device
  key. It also decides whether the broker may ever hold the owner's token at rest. Finding 2.
- **P5. Landing.** One line per project and lands serialised per laptop. The target is fetched and
  rebased inside the slot. Stale, held, flaky and failed are distinct outcomes, with one attempt per
  HEAD. A rebase follows each land. It imports what BobNet implements from Helix's 0093 and 0094 and
  supersedes the code's citations of them. Findings 1 and 6.
- **P6. Run slots and holds.** One heavy run at a time per laptop, across agents and projects. Hold
  files are read, not owned. A hold stops lands, not spawns or checks. Interactive agents are queued
  by their orchestrator. This is from Helix 0094 §2 and 0093. Finding 6.
- **P7. Supervisor persistence and restart.** Local SQLite is the truth for workers, requests and
  inbox. The ADR fixes the migration pattern and retention, and what a restart keeps (answerable
  requests, inbox) and loses (consults, the slot queue, in-flight lands, running sessions, which are
  marked failed). Finding 9.
- **P8. Permissions for headless workers.** The layers and what each guarantees: `canUseTool` in
  default mode, auto mode's preflight, `policy.yaml`, the built-in guards, the sandbox on or off, and
  the human tier. It states plainly that the guards without the sandbox catch mistakes and are not a
  boundary. Finding 4.
- **P9. Leads, workers and consults.** `run_as`, lifetimes, which ones hold worker slots, how consults
  are advisory and read-only, and remote spawns across laptops (the `remote` allowlist; a requester
  follows only what it spawned).

## Chores for Peach's board

Each is small and independent. Findings are in brackets.

1. Land: fetch the target in the slot and refuse a stale tip before the check; report a remote's
   non-fast-forward as "stale", without recording a refused HEAD; add a stale-tip test. [1] S
2. Pin `laptop_reports.reporter` to the supervisor's configured name; ignore `report` from other
   peers. [2] S
3. Supervisor checks the owner JWT's `iat` is within a few minutes. [2] S
4. README: correct "The broker alone can't act as you" (`README.md:47`) and the worker-isolation
   claim (`README.md:111`) to what holds with and without the sandbox. [2, 4] S
5. Built-in guard: deny `security find-generic-password` for BobNet's Keychain services. [4] S
6. Supervisor: store every inbound role message in the inbox before acking; dedup injects by message
   id; return unread input to the inbox when a worker ends. [3] S-M
7. Broker: send boards after the `dashboard` reply, not inside it; sweep `laptop_reports` and
   `project_boards` older than 30 days. [5] S
8. Replace citations of Helix's ADR 0060, 0090, 0093 and 0094 in code and tests once P5 and P6 exist;
   move Helix-specific strings (`Bob's brief`, `svc:`/`layer:`, "the Postgres environment") into
   config. [6] S
9. Split `Supervisor`: `Landing`, then `Consults`, then `Reporter`, then `BrokerInbound`, with no
   behaviour change, one step at a time. [7] M
10. `app.js`: `// @ts-check` with JSDoc types from `@bobnet/protocol`. [7] S
11. Protocol: `client` version on `register`, stored and shown; an `unsupported` error code for an
    unknown frame type. [8] S
12. `store.ts`: numbered migrations as in `schema.ts`; a daily retention sweep. [9] S
13. Make `cost_usd` optional in the protocol and stop computing it; remove the brief fallbacks
    (`namedSession`, `briefTask`, `workerTasks`' fallback, `app.js` `taskRef`) once no NULL-`tasks`
    row is younger than 14 days. [10] S
14. Tests: silence `board.test.ts:250-253` (`stdio` or `ref: main`); add one client-to-broker
    end-to-end test; decide Playwright (a pinned devDependency or a written-down "use the
    machine's"). [11] S
15. Broker: answer `internal` with the rid on an unexpected error; an owner-only read of the audit
    tail; a stale-report banner per laptop on the dashboard. [12] S
