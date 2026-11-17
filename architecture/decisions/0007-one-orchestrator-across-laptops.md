# 0007. One orchestrator across laptops

- **Status:** proposed (Toad, 2026-11-17), for BOB-44 (session `BOB-44 design A`). To be checked by
  Luigi (as its builder) and Bill@mbp-1 (an architect outside BobNet), and by the two-laptop spike
  (`architecture/spikes/bob44-two-laptops.md`, §13) before Casper accepts it.
- **For:** BOB-44 and `product/requirements/remote-orchestration.md` (criteria 1-7, Casper's Q-6 and
  Q-7). Amends ADR 0004 §1 and §3 (Consequences).

## Context

Casper runs a poe on mbp-1 and another on ubu1, because an orchestrator spawns only on its own
laptop. He wants one (BOB-44, 2026-11-16), and a solid design (11-16 ~22:45).

What exists, from the code:

- **Remote requests.** A directed message to a laptop's supervisor whose body is one JSON object is a
  request (`remote.ts:12-30`, read at `supervisor.ts:768-785`). Ops `spawn`, `status`, `stop`,
  `list`. The broker stamps the sender (ADR 0004 §2), and the target's `remote` allowlist decides:
  sender address, then project, then roles (`config.ts:214-224`, `supervisor.ts:787-822`). A
  requester follows and stops only what it spawned (`spawned_by`). Each request is answered once,
  redelivery included (`store.remoteReply`, `supervisor.ts:771`), and audited on the target
  (`:783`). The worker's Remote Control URL and its end come back as messages
  (`remoteEvent`, `:850-853`, called at `:970` and `:1506`).
- **No tool.** poe writes that JSON by hand. `spawn_worker`, `list_workers`, `worker_status`,
  `tail_worker`, `worker_summary`, `stop_worker`, `pending_requests`, `answer_request`, `run_slots`
  are the supervisor's MCP tools on 127.0.0.1 (`mcp.ts:162-226`) and act on its own laptop only.
- **No answering.** A worker's permission request or question is announced to the target laptop's
  orchestrator (`announce`, `supervisor.ts:1571`, through `notify`, `:1599-1607`). A remote requester
  "answers no request" (`remote.ts:7`). Unanswered, a request is denied after
  `request_timeout_minutes` (`router.ts:169-186`, default 60).
- **A spawn that can't start queues** (`queuedBecause`, `supervisor.ts:452-458`): the role is busy or
  the laptop is at `concurrency`.
- **The protocol already has what the wire needs:** a send carries `ttl_seconds` and the broker
  drops an undelivered message when it expires (`frames.ts:323`, `broker.ts:620-624, 741-742`); a
  send's result names who it was `delivered_to` and who it is `queued_for` (`frames.ts:466`); the
  peer list carries each peer's client package and version (`frames.ts:79`, set by the supervisor at
  `bin.ts:74`). A body is at most 16 KiB (`frames.ts:25`), and the broker refuses one that looks
  like a credential (`broker.ts:635-638`).

## Decision

### 1. Shape: poe asks its own supervisor; supervisors talk to each other

```
poe@mbp-1 ──MCP (127.0.0.1)──▶ supervisor@mbp-1 ──message──▶ supervisor@ubu1 ──▶ worker on ubu1
          ◀── tool result ────                  ◀──message──                 ◀── requests, end
```

- poe calls its usual tools with a `laptop` argument (§5). Its own supervisor, the **requester**,
  sends the request to the **target** supervisor as a message. The target spawns and runs the worker
  under its own config, policy, run slot and limits, as for a local spawn, and sends replies and
  events back to the requester.
- **The requester is the supervisor, not poe.** The broker stamps the sender as
  `supervisor@mbp-1`. The target's `remote` allowlist keys on that address, unchanged in form
  (`config.ts:217-223`); Casper adds `supervisor@mbp-1: { spawn: { athletic: [reviewer] } }` to
  ubu1's `supervisor.yaml`.
- Why the supervisor: the state the feature needs (remote workers, their open requests, the outbox
  for a poe that is away) must outlive a poe session, and live state is the supervisor's (ADR 0004
  §1); a channel client owns only the session's identity and digest. And it narrows who can ask: only
  the supervisor process sends as `supervisor`, and only a holder of its MCP token
  (`mcp.ts:270-276`) makes it send, while any agent on mbp-1 can send as itself. Neither is a
  boundary against a hostile process (ADR 0004 §4: a laptop speaks for every name on it); it is the
  usual guard against mistakes.
- **Only the orchestrator.** `laptop` other than this one is the MCP caller's (the interactive
  orchestrator's). A lead's tools (`lead-tools.ts:14`, `handlers` with `lead`) refuse it in this
  version: "only the orchestrator spawns on another laptop". The requester puts its orchestrator's
  name in the request as `by` (`"poe"`: the project's `orchestrator`, else the laptop's, as `notify`
  picks it, `supervisor.ts:1600`), for the target's audit and the dashboard (§7); the target
  authorises on the stamped sender alone, never on `by`.
- **Target address:** `<the requester's own name>@<laptop>`, i.e. `supervisor@ubu1` with both on the
  default name (`config.ts:188`). A laptop whose supervisor has another name isn't reachable by the
  tools in this version; hand-written JSON still is.
- Hand-written requests from an agent (today's way) keep working, exactly as today (§9).

### 2. The wire: remote.ts's message ops, extended

No new frame and no broker change. Requests, replies and events stay message bodies, one JSON
object each. Their schemas move from `packages/supervisor/src/remote.ts` to `packages/protocol`,
since they now cross between two supervisors that may run different releases (ADR 0004 §1, one wire
definition).

- **A version mark.** A request the tools send carries `v: 2`. A `v: 2` request gets this ADR's
  behaviour (§3-§6); a request without `v` gets today's, unchanged. An old target rejects `v` as an
  unknown key (the schema is `.strict()`, `remote.ts:14-30`) and does nothing (§9).
- **Ops** (`v: 2`; `id` is a worker id unless said):

  | Op | Fields | Does | Who may |
  |---|---|---|---|
  | `spawn` | today's (`remote.ts:15-25`) | spawns now or refuses (§3) | the allowlist, for that project and role |
  | `status` | `id` | `remoteView` (`supervisor.ts:824`) | the spawner |
  | `stop` | `id` | stops with a last turn for the handoff, as local | the spawner |
  | `list` | `all?`, `limit?`, `since?` | the sender's workers, with their open requests | any allowlisted sender, its own only |
  | `tail` | `id`, `n` | as `tail_worker`, cut to fit the body | the spawner |
  | `summary` | `id` | as `worker_summary` | the spawner |
  | `request` | `id` (a request id) | as `request_detail` | the spawner of the request's worker |
  | `answer` | `id` (a request id), `decision`, `message?`, `answers?`, `user_decided`, `resume` | as `answer_request` (§4) | the spawner of the request's worker |
  | `slots` | none | as `run_slots` | any allowlisted sender |

  Not in this version: `reset` (stop, then spawn), `take_slot`, `free_slot`, `order_run_queue`
  (they queue interactive agents on the target, which has its own orchestrator for them).
- **Replies.** One per request, sent with `in_reply_to` the request's message id (as today,
  `supervisor.ts:784`): `{ v: 2, re: <op>, ok, ... }` or `{ v: 2, re, ok: false, error }`. A `v: 2`
  reply names its op as `re`, never `op`.
- **Events**, requester-bound, unasked: `{ v: 2, event, worker, ... }`, with `event` one of
  `remote_control` (url), `request` (a request opened, §4), `settled` (a request answered, expired or
  dismissed, and by whom), `resumed` (an orphaned request's answer resumed the worker as a new id),
  `exit` (§6).
- **A supervisor never answers an answer.** It treats a message as a request only if it has an `op`,
  has no `in_reply_to`, and carries neither `re` nor `event`; anything else is a reply or an event
  (matched to what it sent, else logged and dropped). Today's replies carry `op`
  (`supervisor.ts:777`) and `readRequest` would read one as a malformed request and answer it
  (`remote.ts:44-50`); between two supervisors that is an endless exchange. The build has a test of
  two supervisors on one broker that shows it can't happen.
- **Durable events.** Events and replies go through the outbox (`store.addOutbox`, as `notify` does,
  `supervisor.ts:1599-1607`), so a broker outage loses none and keeps their order. Today `toRemote`
  only logs a failure (`:843-847`).
- **Deadlines.** A request is sent with `ttl_seconds`: 30 for `spawn`, 20 for the rest. The broker
  drops it undelivered when it expires, so a request never runs late (§3). The requester waits for the
  reply up to the deadline plus 30 s; a `spawn` that joins a board session can take up to a minute
  (`supervisor.ts:394-407`), so its reply wait is 90 s. Without a reply, the tool fails saying the
  request may or may not have run, and `list_workers` with `laptop` shows which.
- **Size.** A body is at most 16 KiB. `tail` and `request` cut to fit and say `truncated: true`; the
  handoff text is §6's. **A credential-looking body** is refused by the broker (`broker.ts:635-638`);
  the target then resends without the field that holds it, with `withheld: "looks like a
  credential"`. The orchestrator denies, or asks Casper, who sees it on the dashboard.

### 3. A spawn on the target: its limits, now or not at all

- **The target's config decides everything:** the allowlist (as today), `admit`'s checks (model,
  effort caps, sandbox, tasks, session; `supervisor.ts:411-449`), its policy, its run slot, its
  usage. The requester's laptop counts for nothing.
- **Never queued.** Where a local spawn would queue (`queuedBecause`, `supervisor.ts:452-458`), a
  `v: 2` spawn is refused at once with that reason ("athletic/reviewer already has a worker running",
  "3 workers running, the laptop's limit"). No row is made.
- **Offline refuses at once.** The requester checks the peer list first: if `supervisor@ubu1` isn't
  online, the tool refuses with "ubu1's supervisor is offline (last seen …)" and sends nothing. If it
  goes offline between the check and the send, the send's result names it in `queued_for`, and the
  tool refuses the same way. The request then expires at the broker within 30 s; only a target that
  reconnects inside those 30 s runs it, and its reply then reaches the requester's view (§7) and a
  note to poe ("spawned after all").
- **Never a path.** The remote `spawn` has no `handoff` and no `resume_session`, and its schema
  refuses unknown keys (`remote.ts:14-25`). Repos and worktrees must exist on the target (Q-7).
- **The board.** The worker joins its session and reports its run from the target, as its role on
  that laptop. A grant may be bound to a laptop (`board/rules.ts:45-52`): a role spawned on ubu1
  needs a grant that covers ubu1 (the spike checks BobNet's and Athletic's, §13).

### 4. Requests and questions: to the spawner, answered as local

- **Routing.** A request (approval or question) of a worker spawned by a `v: 2` spawn is announced to
  its spawner, never to the target's orchestrator: `announce` (`supervisor.ts:1571`) sends a
  `request` event (id, worker, kind, tool, tier, rule, preview, created_at) instead of a `notify`.
  Workers spawned locally, or by a request without `v`, are announced as today.
- **The requester shows it as its own.** It keeps a copy of the request (§7), adds it to
  `pending_requests` with `laptop: "ubu1"`, and tells poe as for a local one, through `notify`:
  "Reviewer@ubu1 needs approval for Bash (r_…, ubu1, …). See pending_requests and answer with
  answer_request." poe answers with `answer_request`, as for a local request (Q-6: "poe no different
  than local sessions").
- **The answer's auth, on the target, in order:** the sender is in `remote`; its entry still lists the
  worker's project and role (the config at the time of the answer, not of the spawn: Casper's removal
  of an entry ends answering too, criterion 6); the request exists and its worker's `spawned_by` is
  the sender; the request is open or orphaned. Then `answer` runs as for a local one
  (`supervisor.ts:562-590`, `router.ts`): a `human`-tier request needs `user_decided`, a question
  takes `answer` or `deny`, an approval `allow` or `deny`. A refusal is a `v: 2` reply with the reason.
- **Audit on the target.** Every remote answer, allowed or refused, is a row: actor the sender
  address, action `remote:answer` or `remote:refused`, the worker, `{ message, request, decision, by
  }`. `answer` adds its own `answer:<decision>` row with `decided_by` (`router.ts:133`).
- **One answerer.** On the target, `pending_requests` leaves out requests of workers a `v: 2`
  requester spawned, and `answer_request` refuses them: "r_… is supervisor@mbp-1's worker's; it
  answers". The dashboard still shows them, and Casper, the owner, may answer any request there, as
  today (`supervisor.ts:869`); the requester learns of it from the `settled` event.
- **When nobody answers,** the target's timeout denies, as for a local request (`router.ts:169-186`),
  and a `settled` event (by `timeout`) clears the requester's copy.
- **An orphaned request** (the target restarted) is answered the same way. With `resume`, the target
  resumes the session as a new worker with the same `spawned_by` (`supervisor.ts:576-588`) and sends
  `resumed` (old id, new id). That resume continues an admitted worker: it follows the target's local
  rule and may queue, unlike a new spawn.

### 5. The tools, with `laptop`

Old callers are unchanged: without `laptop`, every tool acts on this laptop as today.

| Tool | With `laptop` |
|---|---|
| `spawn_worker` | `laptop` names the target; `handoff` and `resume_session` are refused with it |
| `list_workers` | `laptop: "ubu1"`: the workers this supervisor spawned there; `laptop: "all"`: local and every laptop's, each row with `laptop`. Remote rows come from the copy (§7), with `as_of` |
| `worker_status`, `tail_worker`, `worker_summary`, `stop_worker` | an id this supervisor spawned elsewhere resolves to its laptop; `laptop` is optional and, if given, must match. `status` and `summary` are asked live; offline, `status` answers from the copy with `as_of` and says so |
| `pending_requests` | always local and remote together, each row with `laptop` (remote ones from the copy) |
| `request_detail`, `answer_request` | a request id from another laptop resolves the same way; `answer_request`'s result is the target's |
| `run_slots` | `laptop`: the target's slot, read live |
| `reset_worker`, `take_slot`, `free_slot`, `order_run_queue` | refuse `laptop` other than this one |

A lead's tools refuse `laptop` other than its own (§1). Ids are random; if a worker or request id
matches on two laptops, the tool asks for `laptop`.

### 6. The result comes back as text

- The `exit` event carries what the local end notice does (`supervisor.ts:1506-1520`): state,
  checkpoint, error or stop reason, the land outcomes, and **the handoff file's text**, read by the
  target from its own file. The handoff is what the role wrote for whoever comes next; poe reads it
  as text, not as a path (Q-7, criterion 5).
- **Size:** up to 12,000 characters, the rest cut with `handoff_truncated: true` and the file's
  length. Today's handoffs on mbp-1: median 1.3 KB, 90th percentile 3.4 KB, 2 of 948 over 12 KB. A
  cut one is the role's to summarise: poe asks the role.
- The requester keeps it with the worker's copy (§7), tells poe as for a local end ("… done: …;
  handoff in worker_summary"), and `worker_summary` returns it as `handoff_text`. No file read
  crosses laptops: the target reads its own file, and only the text crosses.

### 7. Who owns what (ADR 0004 §1)

- **The target owns** the worker, its run, its requests and their answers, its audit, its usage:
  everything, as for a local worker. Its report to the broker and the board shows the worker on the
  target: a worker's laptop is where it runs, the supervisor that reports it.
- **What the dashboard needs** (criterion 7; Daisy's `design/BOB-44/laptop-mark.md`, 0f8a182), two
  additive fields, null by default:
  - `remote_from` on `WorkerSnapshot` (`frames.ts:93-123`): the authorised sender address of a
    remote spawn (`spawned_by`, `supervisor@mbp-1`), and `remote_by` beside it: the `by` it stated
    (`poe`). The dashboard writes the spawner as `poe@mbp-1` (`remote_by` at `remote_from`'s
    laptop), or `remote_from` when `remote_by` is null. A local spawn's `"orchestrator"` or a lead's
    worker id is never sent. The target keeps `by` with the worker (one column) for this.
  - `laptop` on `StatusStuckRun` (`board.ts:764`; ADR 0005 §2): the run's `RunRecord.laptop`.
- **The requester holds copies:** per remote worker (laptop, id, the last `remoteView`, `as_of`, the
  handoff text when ended) and per open remote request (laptop, id, worker, the preview fields,
  state), in its SQLite. Copies change only from the target's replies and events, never from the
  requester's own writes: an answer that the target accepted clears the copy when its `settled` event
  arrives, not before. A copy is shown with `as_of`.
- **Reconciling.** When the target's supervisor comes online (a presence `joined`), the requester
  sends `list` (with open requests) and replaces its copies for that laptop. A worker it no longer
  lists is marked `unknown`, not dropped.
- **Only the target speaks for its workers.** An event or reply is accepted only from the laptop the
  worker runs on (the sender's laptop and the supervisor's name), only for a worker this supervisor
  spawned there.

### 8. When something dies

- **poe ends.** Nothing on either supervisor waits for poe. The requester keeps the copies; its
  notices to poe wait in the outbox and go when poe is back (`supervisor.ts:716`). A new poe sees
  every remote worker and request through the tools. Meanwhile the target's timeout denies what is
  open (`router.ts:169-186`), and the remote workers run to their end.
- **The requester's supervisor is down** (mbp-1 asleep, or restarted). The target's events wait at the
  broker and in the target's outbox, and arrive when it is back; then it reconciles (§7). Requests
  time out as denied on the target meanwhile. The workers run to their end; nothing on the target
  depends on the requester being up except answers.
- **The target is down.** The tools refuse new requests at once (§3), and show copies with `as_of`.
  Its workers stop with it, as local workers do on a restart, and its orphaned requests are §4's.
- **No failover.** A worker's spawner is fixed (`spawned_by`). Another orchestrator taking over
  remote workers is split out (requirements, "Split out"). Casper on the dashboard can still answer
  and stop any worker on the target.

### 9. Versions in the field

The live pair is mixed during rollout (ubu1 on rc.37, mbp-1 on rc.38 today).

- **A new requester, an old target.** The requester reads the target's supervisor version from the
  peer list (`client`, `frames.ts:79`). Below the release that brings this ADR, the tool refuses at
  once: "ubu1's supervisor runs 2.0.0-rc.37; the remote tools need rc.N there". If the version is
  unknown or the check is wrong, the old target rejects the `v: 2` body as a bad request and does
  nothing, so nothing half-happens.
- **An old requester, a new target.** An old requester has no tools; its agents' hand-written
  requests have no `v` and are served exactly as today: queued when full, requests to the target's
  orchestrator, no answering.
- **Rollout:** a release on both laptops and a restart of both supervisors (poe's). Either order is
  safe. The remote tools need no broker change. The laptop mark (criterion 7) needs a broker deploy
  for its dashboard and `StatusStuckRun.laptop`, in any order with the supervisors: an old supervisor
  sends no `remote_from` and the mark shows no spawner; an old broker drops the field.
- **Switching gradually** (requirements, "Must not break"): poe@ubu1 keeps running ubu1's local
  workers; one poe@mbp-1 spawns on ubu1 alongside. Casper retires poe@ubu1 when he chooses.

### 10. Landing on the shared `v2` from two laptops

Settled by ADR 0002; no new lock.

- The run slot is per laptop by design: it guards a laptop's load, not the line (ADR 0002 §3). Two
  laptops may land `v2` at once.
- BobNet's land is direct, a fast-forward push (ADR 0002 §1). Git takes one push and refuses the
  other; the loser's land is **stale**, known from git, not from the push's text (§5), and its next
  land rebases inside the slot and runs again (§4.6). That race exists today between a worker and an
  interactive land (§2), and the stale check is what bounds it: one extra check run for the loser.
- The window is the check's length (minutes), and it opens only when two laptops land the same
  project's line. Helix's land is integrated and has no race (ADR 0002 §1).
- A cross-laptop lease on the broker would make every land depend on the broker being up (today a
  land needs only GitHub) and would need expiry for a laptop that sleeps mid-land. It is split out
  as a backlog chore, to be built only if the audit shows `land:stale` outcomes whose winner landed
  from another laptop more than rarely.

### 11. Not in this decision

- Remote spawns by a lead (§1), remote `reset` and slot queueing (§2), failover of a spawner (§8),
  a cross-laptop land lease (§10).
- A role hosted on two laptops at once. Bare names on the broker are resolved per laptop; this ADR
  assumes a project's roles run on the laptop that holds the project. Spawning a project's roles on
  two laptops is a later decision.
- Reading files or cloning repos across laptops: dropped by Casper (Q-7); a worker on that laptop
  does it as a task.

## Consequences

- **ADR 0004 is amended:** §3's row "Another laptop's orchestrator" becomes "another laptop's
  supervisor, for its orchestrator": spawn the roles its `remote` entry names; follow, stop and
  answer the requests of only what it spawned. §1's supervisor row adds "copies of the workers and
  requests it spawned elsewhere".
- `remote.ts:4-9` and `config.ts:214-218` stop saying a requester "answers no request".
- The remote schemas move to `packages/protocol`; `v: 2` is an additive change, and `v`-less requests
  keep their meaning until a release says otherwise.
- The requester gets two tables (remote workers, remote requests); the target gets no new table:
  `spawned_by` and the request rows already hold what it needs, plus a column for `by` (§7).
- `WorkerSnapshot` gains `remote_from` and `remote_by`, `StatusStuckRun` gains `laptop` (§7), additive.
- ubu1's `supervisor.yaml` needs a `remote` entry for `supervisor@mbp-1`, and the board may need
  grants for ubu1 (§3). Both are Casper's or Peach's, not the build's.
- Testing: two supervisors on one test broker cover criteria 1-6 without two laptops; the spike (§13)
  covers what only the real broker and two real laptops show.

## Alternatives considered

- **A new `worker_cmd` frame** (my consult c_b8bd33df, from memory). It needs a broker change and a
  deploy, its own delivery and auth, and duplicates what messages already give: sender stamping,
  `in_reply_to`, queueing with `ttl_seconds`, delivery receipts, redelivery deduplication. Rejected:
  the message ops exist and work.
- **poe sends the requests itself** (sender `poe@mbp-1`). Its tools are the supervisor's, not the
  channel client's, so the client would need its own tools; and the open requests, copies and
  notices would live in poe's session and die with it. Rejected (§1).
- **Requests answered by whoever is on the target,** today's behaviour. With one poe there is nobody.
  Rejected by Q-6.
- **No copies: `pending_requests` asks every laptop live.** One round trip per laptop per call, and an
  offline laptop's requests vanish from the view instead of showing as last known. The `request` event
  has to reach the requester anyway to wake poe. Rejected.
- **A broker-side lease on the line** (§10). Split out, with its reasons.

## Spike to confirm

Luigi's spike (`architecture/spikes/bob44-two-laptops.md`) uses today's code: hand-written JSON from an
agent on mbp-1 to `supervisor@ubu1`, on an existing ubu1 project and a harmless role. It must not send
requests from mbp-1's supervisor (§2: today's replies would loop between two supervisors). It must
show, with times and the audit rows:

1. **Round trip.** `spawn`, `status`, `list`, `stop` from mbp-1 reach ubu1 and their replies come back
   with `in_reply_to`; the time of each (sets §2's deadlines).
2. **Delivery receipt.** The send's result names `supervisor@ubu1` in `delivered_to` when it is online;
   a send with `ttl_seconds: 20` to an offline name is `queued_for` and gone after 20 s (§3).
3. **Version visible.** The peer list shows `supervisor@ubu1` with `client.package` and
   `client.version` (§9).
4. **Today's request routing.** A permission request and a question of the remote worker: where they
   are announced (poe@ubu1, per §4's premise), their id format, and that nothing reaches mbp-1.
5. **The end.** The `exit` event reaches the sender with state and checkpoint; the handoff file's size
   on ubu1 (§6).
6. **The board from ubu1.** The worker's `session_join` and run reports on its project's board are
   accepted for a role running on ubu1, or which grant refuses them (§3).
7. **A refusal.** A spawn of a role not in the entry is refused with the reason and leaves a
   `remote:refused` row in ubu1's audit (criterion 6).
8. **A path.** A spawn with `handoff` is refused as a bad request (criterion 4).
9. **Clocks.** The skew between mbp-1, ubu1 and the broker's `created_at`, so §2's deadlines hold.

What it finds is folded into this ADR before it is accepted: a result that contradicts a section
changes that section or says why not.
