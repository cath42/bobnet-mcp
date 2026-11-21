# 0007. One orchestrator across laptops

- **Status:** accepted (Casper, 2026-11-17, on Q-9 option "accept", dashboard 2026-11-17T23:48Z; to poe@mbp-1: "Accepted lets go"); proposed (Toad, 2026-11-17), for BOB-44 (session `BOB-44 design A`). Revised the same
  day after two reviews: Luigi's as its builder (`architecture/reviews/2026-11-17-adr0007-luigi.md`)
  and Bill@mbp-1's as an architect outside BobNet (`architecture/reviews/2026-11-17-adr0007-bill.md`);
  every finding is settled in `architecture/reviews/2026-11-17-adr0007-disposition.md`. Luigi's
  two-laptop spike ran the same day against ubu1 on rc.37 (`architecture/spikes/bob44-two-laptops.md`,
  c4b9fc6) and is folded in (§13 has each item's result); §4 is still unproven on the real broker
  and build B checks it there (§13). Build A (BOB-59..65, v2 517ec3a..6883060) as built, and
  where it didn't hold as written: §14 (Toad, 2026-11-18).
- **For:** BOB-44 and `product/requirements/remote-orchestration.md` (criteria 1-7, Casper's Q-6 and
  Q-7). Amends ADR 0004 §1, §3 and §4 (Consequences).

## Context

Casper runs a poe on mbp-1 and another on ubu1, because an orchestrator spawns only on its own
laptop. He wants one (BOB-44, 2026-11-16), and a solid design (11-16 ~22:45).

What exists, from the code:

- **Remote requests.** A directed message to a laptop's supervisor whose body is one JSON object is a
  request (`remote.ts:12-30`, read at `supervisor.ts:768-785`). Ops `spawn`, `status`, `stop`,
  `list`. The broker stamps the sender (ADR 0004 §2), and the target's `remote` allowlist decides:
  sender address, then project, then roles (`config.ts:214-224`, `supervisor.ts:787-822`). A
  requester follows and stops only what it spawned (`spawned_by`). A request is answered once its
  reply is recorded (`store.remoteReply`, `supervisor.ts:771`, recorded at `:782`), and audited on
  the target (`:783`). The worker's Remote Control URL and its end come back as messages
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
- **What the wire can't lean on as it is** (both reviews): the outbox prefixes every body with
  `(sent …)` and keeps no `in_reply_to` or TTL (`supervisor.ts:1667`, `store.ts:95-110`), and stops at
  the first failed row for good (`:1665-1673`); the broker refuses an `in_reply_to` naming a message
  its hourly sweep has deleted (`broker.ts:302-304, 739-742`); a message is acked only after
  `onRemote` ends (`:726`), so a reconnect during a slow spawn redelivers it.

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
- Why the supervisor: the state the feature needs (remote workers, their open requests, what it
  sent, notices for a poe that is away) must outlive a poe session, and live state is the
  supervisor's (ADR 0004 §1); a channel client owns only the session's identity and digest. And it
  narrows who can ask: only the supervisor process sends as `supervisor`, and only a holder of its MCP
  token (`mcp.ts:270-276`) makes it send, while any agent on mbp-1 can send as itself. Neither is a
  boundary against a hostile process (ADR 0004 §4: a laptop speaks for every name on it); it is the
  usual guard against mistakes.
- **Only the orchestrator.** `laptop` other than this one is the MCP caller's (the interactive
  orchestrator's). A lead's tools (`lead-tools.ts:14`, `handlers` with `lead`) refuse it in this
  version, and never list or answer remote requests (§5). The requester puts its orchestrator's
  name in every `spawn` as `by` (required: `"poe"`, the project's `orchestrator`, else the laptop's,
  as `notify` picks it, `supervisor.ts:1600`). The target authorises on the stamped sender alone,
  never on `by`; it keeps `by` with the worker for the audit, the dashboard (§7) and the worker's
  own messages (§3).
- **Target address:** `<the requester's own name>@<laptop>`, i.e. `supervisor@ubu1` with both on the
  default name (`config.ts:188`). The peer list doesn't mark a supervisor (`broker.ts:661-674`), so a
  laptop whose supervisor has another name isn't reachable by the tools in this version; the tool's
  offline refusal (§3) names the address it tried. Hand-written JSON still reaches any name.
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
  | `spawn` | today's (`remote.ts:15-25`) and `by`; `as: "lead"` refused | spawns now or refuses (§3) | the allowlist, for that project and role |
  | `status` | `id` | `remoteView` (`supervisor.ts:824`) | the spawner |
  | `stop` | `id` | stops with a last turn for the handoff, as local; a worker already ended is `ok` with `already_ended: true` and its view | the spawner |
  | `list` | `ids?`, `reqs?` | the sender's workers named by id or by the spawn message that made them, else its live ones; each with its open and orphaned requests | any allowlisted sender, its own only |
  | `tail` | `id`, `n` | as `tail_worker`, cut to fit the body | the spawner |
  | `summary` | `id` | as `worker_summary`, with `handoff_text` once ended (§6) | the spawner |
  | `request` | `id` (a request id) | as `request_detail`, cut to fit | the spawner of the request's worker |
  | `answer` | `id` (a request id), `decision`, `message?`, `answers?`, `user_decided`, `resume` | as `answer_request` (§4) | the spawner of the request's worker |

  Not in this version: `slots` (the target's run slot; poe needs it for no criterion), `reset`,
  `take_slot`, `free_slot`, `order_run_queue` (they queue interactive agents on the target, which has
  its own orchestrator for them).
- **Replies.** One per request: `{ v: 2, re: <op>, req: <the request's message id>, ok, ... }` or
  `{ v: 2, re, req, ok: false, error }`. The requester matches a reply on `req`, never on the
  envelope. It is sent with `in_reply_to` the request's id, as today (`supervisor.ts:784`), for the
  dashboard's thread; if the broker refuses that because the request has expired and been swept
  (`unknown_message`, `broker.ts:302-304`), it is resent once without it.
- **Events**, requester-bound, unasked: `{ v: 2, event, worker, spawn_req, ... }`, `spawn_req` the
  message id of the `spawn` that made the worker (kept with it on the target). `event` is one of
  `remote_control` (url, or the error it runs without), `request` (a request opened, §4), `settled`
  (a request answered, expired, dismissed or orphaned, and by whom), `resumed` (an orphaned request's
  answer resumed the worker as a new id), `exit` (§6).
- **A supervisor never answers an answer.** It treats a message as a request only if it has an `op`,
  has no `in_reply_to`, and carries neither `re` nor `event`; anything else is a reply or an event
  (matched to what it sent, §7, else logged and dropped). Today's replies carry `op`
  (`supervisor.ts:777`) and `readRequest` would read one as a malformed request and answer it
  (`remote.ts:44-50`); between two supervisors that is an endless exchange. The spike saw it on rc.37's
  real bodies: a refusal `{"ok":false,"op":"spawn",…}` would be read back as a request, fail `.strict()`
  on `ok`, and be answered `{"ok":false,"op":"invalid",…}`, which has `op` too (§13). A resent reply
  without `in_reply_to` still carries `re`. The build's first test, two supervisors on one fake
  network (see Consequences), shows the exchange can't start, fed those exact bodies.
- **A malformed request's reply** names what was sent: its `re` is the request's `op` when the body has
  a string `op`, else `"invalid"`, and its error names each bad key by its path, or `body` for one at
  the root. Today it says `op: "invalid"` for any malformed body and labels a root key `op`
  (`"op Unrecognized key: \"handoff\""`, from `remote.ts:49`'s `|| "op"`; §13 item 8).
- **Delivery: a `remote` outbox.** Every `v: 2` reply and event is put in the outbox first and then
  flushed, never sent directly, so they leave in the order they were made. A new outbox kind `remote`
  keeps `to`, the body verbatim (no `(sent …)` prefix), `in_reply_to` and `ttl_seconds`. A row the
  broker refuses for good (`secret_detected`, `unknown_peer`, `bad_frame`, too long) is logged,
  audited `remote:undeliverable` and dropped, as `flushBoardReports` does (`supervisor.ts:1685-1706`);
  a broker that can't be reached keeps it and all behind it. Kind `message` (`notify`'s) gets the same
  final-code rule: today one refused row holds up every notice behind it (`:1665-1673`).
- **Order isn't relied on.** Delivery after an outage is ordered by the broker's `created_at`, `id`
  (`broker.ts:620-624`), not strictly the send order, and a resend changes it. The requester's copies
  change only forward (§7), so an event that arrives late does no harm.
- **Deadlines.** A request is sent with `ttl_seconds`: 30 for `spawn`, 20 for the rest; the broker
  drops it undelivered when it expires, so a request never starts late (§3). TTLs are durations the
  broker applies on its own clock, and the requester's waits are local durations: clock skew between
  laptops doesn't move them. The requester waits up to the TTL plus 30 s; a `spawn` that joins a board
  session can take up to a minute (`supervisor.ts:394-407`), so its wait is 90 s. Without a reply, the
  requester sends `list` with the request's id in `reqs`; the tool then reports the worker if it
  exists, and only else fails saying the request may or may not have run. A reply that arrives later
  still counts (§7). Measured on the real broker: every reply within ~2 s, a spawn without a session
  started ~1 s after the send (§13 item 1), so the margins are wide; a board join's time wasn't
  measured, and the 90 s stays.
- **Replies and events expire in a day** (`ttl_seconds: 86400`), not the default 30 days
  (`frames.ts:30`): what they carry (previews, tails, handoff text) shouldn't sit at the broker
  longer than it is useful. A requester away for longer recovers by reconciling (§7), which doesn't
  need them.
- **Idempotent on the target.** Before any work, the target records the request's message id in
  `remote_requests` as in progress (reply null). A redelivery that finds it in progress is acked and
  ignored; one that finds it done resends the stored reply, as today. At start, a row still in
  progress (the target died mid-request) gets the reply "the target restarted while handling it; list
  shows whether it ran", which is sent.
- **Size.** The whole serialised body is at most 16 KiB (`frames.ts:25`), escaping included: `tail`
  and `request` cut to fit and say `truncated: true`; `exit` is §6's.
- **Credentials.** The target runs `findSecret` (`protocol/src/secrets.ts:17`, the broker's own check)
  on each text field before it enqueues, and replaces a matching span with `[withheld: looks like a
  credential]`, so the rest of a preview or a handoff still goes. If the broker refuses the body
  anyway (detectors of two versions), the row is final (above), and a short `{ event: "withheld",
  worker }` goes in its place. The orchestrator asks the role on the target, or Casper, who sees the
  request on the dashboard.

### 3. A spawn on the target: its limits, now or not at all

- **The target's config decides everything:** the allowlist (as today), `admit`'s checks (model,
  effort caps, sandbox, tasks, session; `supervisor.ts:411-449`), its policy, its run slot, its
  usage. The requester's laptop counts for nothing.
- **Never queued, and never refused after a join.** Where a local spawn would queue
  (`queuedBecause`, `supervisor.ts:452-458`), a `v: 2` spawn is refused at once with that reason
  ("athletic/reviewer already has a worker running", "3 workers running, the laptop's limit"). The
  check runs synchronously before the board's `session_join` and reserves the role and a place under
  `concurrency` until the worker's row is made or the spawn fails, so nothing can take them during the
  join. A failed join frees them. No row is made for a refusal.
- **A retry is safe.** A role runs one worker per laptop, so a retried `spawn` of a worker that did
  start is refused as busy; with §2's `list` after a timeout, poe sees the first. No idempotency key.
- **Offline refuses at once,** usually. The requester checks the peer list first: if
  `supervisor@ubu1` isn't online, the tool refuses with "ubu1's supervisor is offline (last seen …)"
  and sends nothing. The peer list isn't filtered by team (`broker.ts:661-674`), so this holds
  although the two supervisors are on different teams (§7, §13 item 3). If it goes offline between
  the check and the send, the send's result names it in `queued_for`, and the tool refuses the same
  way. A laptop that sleeps can look online while the
  broker still holds its half-open socket (`online` is a live socket, `broker.ts:670,698`): then the
  request is `delivered_to` it, expires unread, and the tool says "may or may not have run" after its
  wait (§2). Only a target that reconnects inside the 30 s runs it; its reply then reaches the
  requester's copies (§7) and a note to poe ("spawned after all").
- **Never a path.** The remote `spawn` has no `handoff` and no `resume_session`, and its schema
  refuses unknown keys (`remote.ts:14-25`). Repos and worktrees must exist on the target (Q-7).
- **No remote leads.** A `v: 2` spawn with `as: "lead"` is refused: a lead's own workers have the
  lead as spawner and would be answered on the target, outside §4.
- **The worker's own messages.** Bare names resolve on the sender's laptop (`address.ts:30-36`), so a
  worker on ubu1 that writes to "poe" reaches poe@ubu1 (seen, §13 item 10). A `v: 2` worker's
  preamble names its orchestrator as `<by>@<the requester's laptop>` (`systemAppend`,
  `supervisor.ts:2081-2084`), and poe's briefs for remote workers use full addresses.
- **The board.** A remote spawn on a project with a board needs `tasks` (and `session` when it has
  one), as a local one does: the target's `admit` refuses it otherwise, before anything else
  (`supervisor.ts:411-449`; seen on ubu1, §13 item 6). The requester passes `tasks` and `session`
  through unchanged and relays the target's refusal word for word; it never checks them itself, since
  the board is the target's to ask. The worker joins its session and reports its run from the
  target, as its role on that laptop. A grant may be bound to a laptop (`board/rules.ts:45-52`): a
  role spawned on ubu1 needs a grant that covers ubu1. The spike didn't test the join (§13 item 6);
  build A's first real spawn with a session does.

### 4. Requests and questions: to the spawner, answered as local

- **Routing.** A request (approval or question) of a worker spawned by a `v: 2` spawn is announced to
  its spawner, never to the target's orchestrator: `announce` (`supervisor.ts:1571`) sends a
  `request` event (id, worker, kind, tool, tier, rule, preview, created_at) instead of a `notify`.
  Workers spawned locally, or by a request without `v`, are announced as today. A worker is a `v: 2`
  one when its row has `remote_by` (§7); that one column is the only test.
- **The target's other notices about a `v: 2` worker** become events to its spawner too, and none goes
  to the target's orchestrator: its end (`supervisor.ts:1520`, as `exit`), Remote Control failing
  (`:973`, as `remote_control` with the error), and the restart notice (`:309-314`, below).
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
- **What that grants, said plainly** (for Casper to accept knowingly): `user_decided` is the caller's
  assertion, locally too (`mcp.ts:214`), so a `remote` entry for `supervisor@mbp-1` lets whoever holds
  mbp-1's MCP token make ubu1's human-tier decisions for the workers it spawned. And `spawned_by` is
  the supervisor, so any orchestrator on mbp-1 may answer or stop any worker mbp-1 spawned on ubu1.
  Both are what a local orchestrator may do today, and ADR 0004 §4's line (a laptop speaks for every
  name on it); `config.ts:214-218`'s comment says so.
- **Audit on the target.** Every remote answer, allowed or refused, is a row: actor the sender
  address, action `remote:answer` or `remote:refused`, the worker, `{ message, request, decision, by
  }`. `answer` adds its own `answer:<decision>` row with `decided_by` (`router.ts:133`).
- **One answerer.** On the target, `pending_requests` leaves out requests of `v: 2` workers, and
  `answer_request` refuses them: "r_… is supervisor@mbp-1's worker's; it answers". The dashboard still
  shows them, and Casper, the owner, may answer any request there, as today (`supervisor.ts:869`); the
  requester learns of it from the `settled` event.
- **Every settle is told, from one place.** A request's state changes in six places: `router.answer`
  (`router.ts:126`), the timeout (`:171`), the dismiss (`supervisor.ts:566`), `expireOrphans`
  (`:606`), `markOrphaned` at start (`:282`), and a worker stopped while waiting (`router.ts:190-199`),
  which today leaves the row `open` until a restart. The target wraps `store.settleRequest` and
  `store.markOrphaned` with one hook that sends `settled` for a `v: 2` worker's request, and the abort
  path settles its row (`expired`, decided by `stop`), for every worker, local ones too.
- **When nobody answers,** the target's timeout denies, as for a local request (`router.ts:169-186`),
  and `settled` (by `timeout`) clears the requester's copy.
- **A target restart.** At start, for each `v: 2` worker it fails (`supervisor.ts:269-280`) the target
  sends `exit` (failed, "supervisor restarted", with the handoff text if the file exists, §6), and for
  each of their requests it orphans, `settled` with state `orphaned`, so the copy says "answering
  resumes the worker". They go through the outbox, which flushes when the target is connected.
- **An orphaned request** is answered the same way. With `resume`, the target resumes the session as a
  new worker with the same `spawned_by` and `remote_by` (`supervisor.ts:576-588` copies both) and
  sends `resumed` (old id, new id). That resume continues an admitted worker: it follows the target's
  local rule and may queue, unlike a new spawn.
- **Proven where.** The `FakeNetwork` tests carry this section (Consequences). The spike couldn't
  raise a request on ubu1 (§13 item 4), so build B's acceptance checks it once on the real broker,
  with a rule that makes a harmless call escalate. In auto mode a worker's call reaches the router only
  when the preflight sends it there: a policy rule with `decision: escalate` turns it into `ask`
  before the classifier (`policy.ts:274-279`, `supervisor.ts:1058-1083`); anything else the classifier
  settles, or the role's sandbox, hooks or tool list refuse (each seen on athletic/reviewer, §13
  item 4). Casper's config on ubu1, staged by poe@ubu1, first in `policy.yaml`'s rules:

  ```yaml
  - id: bob44-probe
    roles: [reviewer]
    projects: [athletic]
    tools: [Bash]
    command: "^echo bob44-probe$"
    decision: escalate
    tier: orchestrator
    reason: BOB-44 real-broker check
  ```

  Policy loads at start (`bin.ts:62`), so the rule needs a restart of ubu1's supervisor (poe@ubu1's,
  with its `list_workers` empty) to come in and another to go out; the `remote` entry then keys on
  `supervisor@mbp-1`. poe@mbp-1 spawns athletic/reviewer on ubu1 with `laptop` and a task that runs
  `echo bob44-probe` twice, and the check shows: the request reaches poe@mbp-1 (its
  `pending_requests`, `laptop: "ubu1"`) and not poe@ubu1 (nothing announced; ubu1's
  `pending_requests` leaves it out); `answer_request` allow runs the first call and deny refuses the
  second; each `settled` clears the copy; ubu1's audit has two `remote:answer` rows. A question
  (`AskUserQuestion`) takes the same path from the router on and stays with the fake: it isn't
  available to athletic/reviewer (§13 item 4).

### 5. The tools, with `laptop`

Old callers are unchanged: without `laptop`, every tool acts on this laptop as today.

| Tool | With `laptop` |
|---|---|
| `spawn_worker` | `laptop` names the target; `tasks`, `session`, `model`, `effort` pass through unchanged and the target's refusal comes back word for word (§3); `handoff`, `resume_session` and `as: "lead"` are refused with it |
| `list_workers` | `laptop: "ubu1"`: the workers this supervisor spawned there; `laptop: "*"` (`all` is a valid laptop name): local and every laptop's, each row with `laptop`. Remote rows come from the copies (§7), with `as_of` |
| `worker_status`, `tail_worker`, `worker_summary`, `stop_worker` | an id this supervisor spawned elsewhere resolves to its laptop; `laptop` is optional and, if given, must match. `status` and `summary` are asked live; offline, they answer from the copy with `as_of` and say so |
| `pending_requests` | local and remote together, each row with `laptop` (remote ones from the copies) |
| `request_detail`, `answer_request` | a request id from another laptop resolves the same way; `answer_request`'s result is the target's |
| `run_slots`, `reset_worker`, `take_slot`, `free_slot`, `order_run_queue` | refuse `laptop` other than this one |

A stop that races the worker's own end is common (the spike's two stops both found the worker
ended, one by about a second; today that is an error, "is done, not running", `supervisor.ts:467`).
With `laptop`, `stop_worker` reports it as ended, with the state and checkpoint from the `stop`
reply, and updates the copy; it isn't an error.

A lead's tools (`handlers(sup, { lead })`, `mcp.ts:162`) refuse `laptop` other than its own, list no
remote rows, and refuse a remote request id (§1). Ids are random; if a worker or request id matches on
two laptops, the tool asks for `laptop`.

### 6. The result comes back as text

- The `exit` event carries what the local end notice does (`supervisor.ts:1506-1520`): state,
  checkpoint, error or stop reason, the land outcomes, and **the handoff file's text**, read by the
  target from its own file. The handoff is what the role wrote for whoever comes next; poe reads it
  as text, not as a path (Q-7, criterion 5). With no file, or an empty one, `handoff_text` is null
  and the requester's notice says "no handoff file": a project's own write hook may refuse the
  handoff path to a worker that otherwise ran fine (the spike's spawn 4 said so, unverified, §13
  item 5).
- **Size, on the whole body.** The error is cut to 500 characters; the handoff then gets whatever the
  serialised body has left under 16 KiB, with a margin, and is cut with `handoff_truncated: true` and
  the file's length. Today's handoffs on mbp-1: median 1.3 KB, 90th percentile 3.4 KB, 2 of 948 over
  12 KB. A cut or withheld (§2) handoff is the role's to summarise: poe spawns the role on the target
  and asks.
- The requester keeps it with the worker's copy (§7), tells poe as for a local end ("… done: …;
  handoff in worker_summary"), and `worker_summary` returns it as `handoff_text`. The `summary` op
  returns it too, so a requester whose `exit` event expired (§2) still gets it. No file read crosses
  laptops: the target reads its own file, and only the text crosses.

### 7. Who owns what (ADR 0004 §1)

- **The target owns** the worker, its run, its requests and their answers, its audit, its usage:
  everything, as for a local worker. Its report to the broker and the board shows the worker on the
  target: a worker's laptop is where it runs, the supervisor that reports it.
- **What the target adds:** two columns on its worker row, `remote_by` (the `by` of a `v: 2` spawn;
  set marks the worker as `v: 2`, §4) and `spawn_req` (the spawn's message id, §2); none for local
  workers.
- **What the dashboard needs** (criterion 7; Daisy's `design/BOB-44/laptop-mark.md`, 0f8a182), two
  additive fields, null by default:
  - `remote_from` on `WorkerSnapshot` (`frames.ts:93-123`): the authorised sender address of a
    remote spawn (`spawned_by`, `supervisor@mbp-1`), and `remote_by` beside it (`poe`). The dashboard
    writes the spawner as `poe@mbp-1` (`remote_by` at `remote_from`'s laptop), or `remote_from` when
    `remote_by` is null. A local spawn's `"orchestrator"` or a lead's worker id is never sent.
  - `laptop` on `StatusStuckRun` (`board.ts:764`; ADR 0005 §2): the run's `RunRecord.laptop`.
- **The requester's three tables**, in its SQLite:
  - `remote_sent`: one row per op it sent (message id, laptop, op, worker or request id, deadline,
    outcome), written before the send, so a reply that lands after a timeout or a restart is matched.
  - `remote_workers`: per remote worker (laptop, id, `spawn_req`, the last `remoteView`, `as_of`, the
    handoff text when ended).
  - `remote_asks`: per remote request (laptop, id, worker, the preview fields, state).
  (`remote_requests` is taken: the target's inbound dedupe, `store.ts:102`.)
- **Copies change only from the target, and only forward.** A copy changes from the target's replies
  and events, never from the requester's own writes: an answer the target accepted clears the copy
  when `settled` arrives, not before. A worker copy's ended state is final; a request copy's settled
  state is final, and an event for an unknown request makes its copy in the event's state, so a
  `request` that arrives after its `settled` changes nothing. A copy's `remote_url` is set from the
  `remote_control` event or a view that has one and never cleared by a null: the spawn reply has none
  yet, and `remoteView` drops it once the worker ends (`supervisor.ts:839`, §13). The requester
  handles a remote message synchronously (no `await` between reading a copy and writing it). A copy is shown with `as_of`.
- **Unknown workers are learnt, not dropped.** An event or reply is accepted only from the target
  supervisor's address (the worker's laptop and the supervisor's name). Since the target sends events
  only to a worker's spawner, an event for a worker the requester has no copy of (its spawn reply was
  late or lost) makes the copy, tied to the spawn poe was told of by `spawn_req`, and the requester
  asks `status` to fill it.
- **Reconciling.** The requester sends `list`, with `ids` (its copies not ended) and `reqs` (its
  spawns with no reply), and replaces its copies for that laptop: on its own start, on each connect to
  the broker, and every 5 minutes while any copy is not ended. Not on a target's `joined`: presence
  reaches a connection only if it hosts a peer on the subject's team or one with no team
  (`broker.ts:676-690`), and the live supervisors aren't on one team (`portfolio` on ubu1, `land` on
  mbp-1; §13 item 3), so mbp-1's supervisor never hears ubu1's join. Nothing needs it: a target that
  restarts sends its exits and orphans through its outbox (§4), and the timer covers the rest. Giving
  supervisors no team would make the join heard, but it is a config and presence change for every
  peer on the connection, not this feature's. An id asked
  for and not returned is marked `unknown`, not dropped. A copy newly seen ended without its handoff
  text gets it with `summary`.

### 8. When something dies

- **poe ends.** Nothing on either supervisor waits for poe. The requester keeps the copies; its
  notices to poe are queued by the broker for poe's return (30 days, `frames.ts:30`), and wait in the
  outbox only while the broker itself can't be reached. A new poe sees every remote worker and request
  through the tools. Meanwhile the target's timeout denies what is open (`router.ts:169-186`), and the
  remote workers run to their end.
- **The requester's supervisor is down** (mbp-1 asleep, or restarted). The target's events wait at the
  broker and in the target's outbox, and arrive when it is back; it reconciles on start and connect
  (§7). Requests time out as denied on the target meanwhile. The workers run to their end; nothing on
  the target depends on the requester being up except answers.
- **The target is down.** The tools refuse new requests (§3), and show copies with `as_of`. Its
  workers stop with it, as local workers do on a restart; at its start it tells the spawner (§4).
- **No failover.** A worker's spawner is fixed (`spawned_by`). Another orchestrator taking over
  remote workers is split out (requirements, "Split out"). Casper on the dashboard can still answer
  and stop any worker on the target.

### 9. Versions in the field

The live pair is mixed during rollout (ubu1 on rc.37, mbp-1 on rc.38 today).

- **A new requester, an old target.** The requester reads the target's supervisor version from the
  peer list (`client`, `frames.ts:79`) and compares it with a small `x.y.z[-rc.n]` comparison in
  `protocol` (there is none today). Below the release that brings this ADR, the tool refuses at once:
  "ubu1's supervisor runs 2.0.0-rc.37; the remote tools need rc.N there". If the version is missing or
  doesn't parse, the request is sent anyway: the old target rejects the `v: 2` body as a bad request
  and runs nothing, so nothing half-happens.
- **An old requester, a new target.** An old requester has no tools; its agents' hand-written
  requests have no `v` and are served exactly as today: queued when full, requests to the target's
  orchestrator, no answering.
- **A target rolled back** below rc.N keeps its rows but serves them as today: requests of its `v: 2`
  workers go to its own orchestrator, and its events come without `v` (`{ event, worker }`). The
  requester accepts a `v`-less `exit` or `remote_control` from a target for a worker it has a copy of,
  and the version check refuses new requests.
- **Rollout:** a release on both laptops and a restart of both supervisors (poe's), each when its
  `list_workers` is empty, since a restart fails running workers (`supervisor.ts:269`). Either order
  is safe. The remote tools need no broker change. The laptop mark (criterion 7) needs a broker deploy
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
  as a backlog chore, to be built only if `land:stale` outcomes beaten from another laptop are more
  than rare. Measured from the two laptops' audits: a `land:stale` (`supervisor.ts:1222,1249`) is
  beaten from the other laptop when that laptop has a `land:ok` on the same line between the loser's
  start and its stale result. The audit holds no laptop of the winner; the pair of audits does.

### 11. Not in this decision

- Remote spawns by a lead (§1), remote leads (§3), remote `slots`, `reset` and slot queueing (§2),
  failover of a spawner (§8), a cross-laptop land lease (§10), a supervisor on another name (§1).
- A role hosted on two laptops at once. Bare names on the broker are resolved per laptop; this ADR
  assumes a project's roles run on the laptop that holds the project, and the worker's own messages
  to its orchestrator use a full address (§3). Spawning a project's roles on two laptops is a later
  decision.
- Reading files or cloning repos across laptops: dropped by Casper (Q-7); a worker on that laptop
  does it as a task.

### 12. Build order

Luigi costs this at ≈11.5 engineer-days, the reviews' fixes included. Most of it is what the
criteria need to hold in the field (a reply never lost, a spawn never doubled, a copy never stuck);
dropping it would leave rare, random field bugs, so the first cut is smaller by order, not by
corners. Suggested cut, for Mario and Peach to set:

- **Build A: poe drives ubu1, poe@ubu1 still answers** (criteria 1, 3, 4, 5, 6 for spawn). The fake
  network and the loop test, first; the protocol schemas and the version comparison; the `remote`
  outbox with final codes (both kinds) and `findSecret` before enqueue; the target's in-progress
  dedupe, reservation, `remote_by`/`spawn_req`, `req` replies and their resend; `exit` with the
  handoff and the restart exits; the requester's three tables, the tools for spawn, follow and stop
  with `laptop`, and reconciling. In A, a `v: 2` worker's requests are still announced on the target
  (today's routing), so A ships alone and changes nothing for poe@ubu1. Its acceptance on the real
  broker: a spawn with a session on a boarded ubu1 project (the join and run report, §3) and the
  handoff text of a real `exit` (§6), the two spike items that needed it (§13). As built: §14.
- **Build B: one answerer, and the mark** (criteria 2, 6 for answers, 7). The `request`, `settled`
  and `resumed` events, the settle hook and the abort settle, the `request` and `answer` ops with
  their auth and audit, the one-answerer filter, `pending_requests`/`request_detail`/`answer_request`
  with remote ids, the target's other notices as events, the worker's preamble (§3); then
  `remote_from`/`remote_by`, `StatusStuckRun.laptop` and Daisy's mark (a broker deploy). Its
  acceptance on the real broker: §4's check with the `bob44-probe` rule (§4, "Proven where").

After B, Casper may retire poe@ubu1.

## Consequences

- **ADR 0004 is amended:** §3's row "Another laptop's orchestrator" becomes "another laptop's
  supervisor, for its orchestrator": spawn the roles its `remote` entry names; follow, stop and
  answer the requests of only what it spawned. §1's supervisor row adds "copies of the workers and
  requests it spawned elsewhere, and what it sent". §4 adds: what crosses the broker now includes tool
  inputs and previews, transcript tails and handoff text, kept a day (§2); `findSecret` is a
  heuristic, so a credential in them can still reach the broker's storage.
- `remote.ts:4-9` and `config.ts:214-218` stop saying the requester is "another laptop's
  orchestrator" that "answers no request"; the config comment says what an entry grants (§4).
- The remote schemas and a version comparison move to `packages/protocol`; `v: 2` is an additive
  change, and `v`-less requests keep their meaning until a release says otherwise.
- The requester gets three tables (`remote_sent`, `remote_workers`, `remote_asks`); the target gets
  two columns on its worker row (`remote_by`, `spawn_req`) and an in-progress state in
  `remote_requests`. The outbox gets a kind `remote` with `in_reply_to` and `ttl_seconds`.
- Two fixes reach local behaviour too: the outbox drops a row the broker refuses for good, and a
  worker stopped while waiting settles its request.
- `WorkerSnapshot` gains `remote_from` and `remote_by`, `StatusStuckRun` gains `laptop` (§7), additive.
- ubu1's `supervisor.yaml` needs a `remote` entry for `supervisor@mbp-1`, and the board may need
  grants for ubu1 (§3). Both are Casper's or Peach's, not the build's.
- **Testing.** `FakeBroker` is one laptop (`test/fakes.ts:154-205`) and the broker's tests run in
  workerd, where the supervisor can't. The build adds a `FakeNetwork` in `supervisor/test`: several
  supervisors, routing by `name@laptop`, `delivered_to`/`queued_for`, TTL expiry, the `in_reply_to`
  check with a sweep the test controls, redelivery of unacked messages on reconnect, presence with the
  team rule, and the `findSecret` refusal. Criteria 1-6 are tested there, with the loop test first.
  Broker e2e tests pin the four behaviours the fake copies: expiry, `delivered_to`/`queued_for`, a
  refused `in_reply_to` to a swept message, and the order of pending delivery. The spike (§13) showed
  what today's code does on the real broker across two laptops; what it couldn't show is either in
  the fake or in a build's acceptance (§12).

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
- **Point the target's orchestrator at the one poe** (`orchestrator: poe@mbp-1` in ubu1's config;
  Bill). Config only, and every notice from ubu1 would reach poe@mbp-1. But poe@mbp-1 can't answer
  what it is told: its `answer_request` acts on mbp-1, and a worker ubu1 spawned locally isn't its own
  to answer remotely, so those requests would time out unseen by anyone who could. Notices as text
  give no `pending_requests` either. Rejected as the mechanism; once poe@ubu1 is retired every ubu1
  worker comes from a `v: 2` spawn and nothing goes to ubu1's orchestrator (§4).
- **A per-worker `seq` on events** (Luigi), applied only in order. Copies that change only forward
  (§7) need no sequence and survive a resend; rejected as more state for the same result.
- **An idempotency `key` on `spawn`** (Bill). One worker per role per laptop already refuses a retry
  of a running worker, and the requester's `list` after a timeout shows the first (§3). Rejected.
- **No copies: `pending_requests` asks every laptop live.** One round trip per laptop per call, and an
  offline laptop's requests vanish from the view instead of showing as last known. The `request` event
  has to reach the requester anyway to wake poe. Rejected.
- **A broker-side lease on the line** (§10). Split out, with its reasons.

## 13. The spike: what it showed

Luigi ran it on 2026-11-17 (`architecture/spikes/bob44-two-laptops.md`, c4b9fc6): 18 hand-written
requests from `Luigi@mbp-1` to `supervisor@ubu1` on rc.37, under a temporary `remote` entry for
athletic/reviewer (Casper's OK, staged by poe@ubu1, removed after), and four spawns. No request came
from mbp-1's supervisor, so today's replies couldn't loop (§2). Item by item:

1. **Round trip: confirmed** for `spawn`, `status`, `list`, each reply with `in_reply_to`, all within
   ~2 s; a spawn without a session started ~1 s after the send. `stop` went both ways, but both stops
   found the worker already ended, so stopping a running remote worker wasn't seen. Changes: §2's
   deadlines stand (wide margins); §2's `stop` op and §5's `stop_worker` treat an ended worker as
   ended, not an error.
2. **Delivery receipt: half.** `delivered_to: ["supervisor@ubu1"]` on all 18 sends. The TTL half
   couldn't be tried: the `send_message` tool has no `ttl_seconds`. The half-open socket wasn't tried.
   Both go to the fake (below); §3 is unchanged.
3. **Version visible: confirmed** (`client: { package: "@bobnet/supervisor", version: "2.0.0-rc.37",
   protocol: 1 }`). Seen too: `supervisor@ubu1` is on team `portfolio`, `supervisor@mbp-1` on `land`.
   Changes: §7 no longer reconciles on a target's `joined`, which mbp-1 never hears; §3's offline check
   is unaffected (the peer list isn't filtered by team).
4. **Today's request routing: not shown.** athletic/reviewer never raised a request in four tries: the
   OS sandbox blocked `curl`, `dangerouslyDisableSandbox` is off for the role, WebFetch and
   AskUserQuestion aren't available to it, and a Write outside its worktree was denied by Athletic's
   write-scope hook and its Bash fallback by the auto-mode classifier. Nothing reached mbp-1. By the
   code, it would be announced to athletic's orchestrator on ubu1 (`supervisor.ts:1571-1600`).
   Changes: §4 gains "Proven where": the fake carries it, and build B's acceptance checks it on the
   real broker with a `policy.yaml` rule that escalates `echo bob44-probe` (Casper's config, staged by
   poe@ubu1, a restart of ubu1's supervisor in and out).
5. **The end: confirmed, with gaps.** Every `exit` came with `state` and `checkpoint`, no
   `in_reply_to`, and no `ended_at`, error, handoff text or `spawn_req` (§6 and §2 add them). The
   handoff size on ubu1 wasn't measured (no remote file read; poe@ubu1 can `wc -c` them). Spawn 4's
   checkpoint says Athletic's write-scope hook refused its handoff too (unverified). Changes: §6's
   `exit` says "no handoff file" rather than sending empty text; build A's acceptance reads a real
   handoff.
6. **The board from ubu1: not tested** (no session; board writes were out of scope). Seen: ubu1
   refuses a spawn on athletic without `tasks` before anything else. Changes: §3 and §5 pass `tasks`
   and `session` through and relay the refusal; build A's acceptance makes the join.
7. **A refusal: confirmed,** with the reason and the allowed roles ("Luigi@mbp-1 may not spawn
   athletic/phelps; it may spawn athletic/reviewer"). The `remote:refused` row is written by the code
   (`supervisor.ts:783`); nobody looked at ubu1's audit. No change.
8. **A path: confirmed:** `handoff` is refused as a bad request. Its reply said `op: "invalid"` and
   labelled the root key `op`. Changes: §2's malformed-request reply.
9. **A swept reply: not testable today** (it needs `ttl_seconds` on a send, item 2). The fake's
   controlled sweep and the broker's e2e test carry it (Consequences); §2 is unchanged.
10. **A bare name: confirmed:** the ubu1 worker's message to "poe" reached poe@ubu1. §3's preamble
    stands.
11. **A target restart: not done.** The fake carries it; §4's restart exits are unchanged.

Seen besides: `remoteView` has `remote_url: null` in the spawn reply and after the end, so only the
`remote_control` event and a running `status` carry it (§7 now keeps it); `status` of an id that isn't
the sender's says so without saying whether it exists (as wanted); worker names repeat across laptops
(`Reviewer@mbp-1` in sandbox, `Reviewer@ubu1` in athletic). Daisy's mark shows a laptop only when a
project spans laptops, so in a list of several projects two such names read alike: Daisy's to weigh
(`design/BOB-44/laptop-mark.md`), not this ADR's.

**Left for the `FakeNetwork`** (Consequences) besides a broker outage and a redelivery during a slow
spawn: TTL expiry and the swept reply (items 2, 9), a stop of a running remote worker (item 1), the
target's restart (item 11), and the question kind (item 4). **Left for a build's acceptance on the real
broker:** the board join and a real handoff (build A), and §4 (build B), as in §12.

## 14. As built (build A)

Build A landed as BOB-59..65 (v2 517ec3a..6883060; Luigi, reviewed by Mario). Where it didn't hold as
written, or left a part for later, by section. The decisions stand; this records the build. Its
real-broker acceptance (§12: the board join, a real handoff) waits for rc.39 on both laptops (BOB-65
AC 10). Sources: Mario's notes and Luigi's handoffs for BOB-59..65.

**§2, the wire**

- **Classification** (`protocol/src/remote.ts:89`, 85ad372): `event` in the body makes an event; else
  `in_reply_to` set, `re` present, or no `op` makes a reply; else a request. Non-object JSON and plain
  text are neither. Any `v` but the number 2 is today's request and fails "v is not allowed".
- **"A body with no op" and "a non-object body" are never requests**, so a supervisor never answers
  them. `parseRemoteRequest` (`remote.ts:120`) still gives them `re: "invalid"` and an error at `op`
  or `body`, for a caller that parses a body as a request.
- **The malformed reply's `re`** (the sent op) is `v: 2` only; a `v`-less malformed request keeps
  today's `op: "invalid"`, with the error now naming the path.
- **Schemas, stricter than the table:** `by` is required on a `v: 2` spawn; `answer` requires
  `user_decided` and `resume`; `tail` requires `n` (at most 500). `as: "lead"` fails the schema
  (`as: z.literal("worker")`), so it is a bad request, audited `remote:refused`.
- **The outbox carries every reply and event**, today's `v`-less ones too (ttl a day). Final codes
  (`supervisor.ts:130`): `secret_detected`, `unknown_peer`, `unknown_message` when it can't be resent,
  `bad_frame`, `frame_too_large`, and `too_long`, the supervisor's own check against the broker's
  limit before sending. Anything else waits. A kind `message` row dropped is audited
  `message:undeliverable`, not `remote:undeliverable`.
- **The resend without `in_reply_to`** happens only if the body read alone still isn't a request
  (`supervisor.ts:2493`). A `v`-less (rc.37-style) reply carries `op` and no `re`, so it is never
  resent: refused `unknown_message`, it is dropped and audited. That keeps the loop guard in a mixed
  field.
- **The withheld stand-in** is `{ v?, event: "withheld", worker?, spawn_req?, re?, req? }`: a reply's
  keeps `re` and `req`, so the requester takes it as the answer.
- **A send that fails** throws "could not send `<op>` to `<to>`: …" and marks the row `failed`.
  Requests never go through the outbox (§3: they never start late).
- **Without a reply**, `list` with `reqs` fits only `spawn` (a req names a spawn message). `status`,
  `stop`, `tail` and `summary` list by `ids`; `request` and `answer` have nothing to list and report
  "may or may not have run" (`supervisor.ts:1296`).
- **After a target restart**, the broker's redelivery of a still-unacked request resends the stored
  restart reply, so the requester can get it twice. Harmless: matched on `req`, and nothing replaces a
  reply.
- **`list`'s "open and orphaned requests"** per worker is build B (with the request ops).
- **`request` and `answer` are refused** until build B. A worker without `spawn_req` (a `v`-less
  spawn) sends today's events, unchanged; so do the `v`-less exit and `remote_control` error.

**§3, the spawn on the target**

- **Busy refuses in four cases, not two:** beyond a running worker of the role and the laptop's limit,
  a worker of the role reserved (starting) or queued (`supervisor.ts:610-617`). A local spawn during a
  reservation queues, "has a worker starting for another laptop". The reserved worker launches
  directly, so a local spawn queued during the join can't take its place.
- **The preamble's `<by>@<laptop>`** is build B (B3); `remote_by` is stored for it. The target still
  sends its own end notice to its own orchestrator for a `v: 2` worker; rerouting it is B3 too.

**§5, the tools** (e6f7f24, 6883060)

- **`REMOTE_TOOLS_SINCE = "2.0.0-rc.39"`** (`supervisor.ts:147`): §9's rc.N. Build A ships as rc.39, or
  the constant moves with it.
- **"Offline"** is any failure to reach the target: no `supervisor@<laptop>` in the peer list at all
  ("ubu1's supervisor isn't on BobNet"), the send dropped, or no reply. Then `status` and `summary`
  answer from the copy with `as_of`. A refusal by the target is still an error.
- **`list_workers` with a laptop** reconciles first (a live `list`), then reads the copies. A worker
  the target has, with no copy and no unanswered spawn here, isn't discovered (see the ruling below).
  `laptop: "*"` gives a laptop that can't be asked as a row `{ laptop, unreachable }`. project, since
  and limit are applied on the requester.
- **"Spawned after all"** fires when a copy is first made for a spawn its tool gave up on: from the
  late reply, a reconcile's `reqs`, or an event. A late refusal is only recorded.
- **A lead's tools** refuse another laptop with "A lead's tools act on its own laptop only".
- **`summary`** leaves out the brief (`task`); the requester has it.
- **`pending_requests`, `request_detail` and `answer_request` with `laptop`** are build B (B4).
- **Who holds the tools:** the orchestrator `supervisor.yaml`'s `orchestrator:` names (`orchestratorOf`,
  `supervisor.ts:2392`; also a remote spawn's `by` and where its end notice goes), through the supervisor
  MCP (127.0.0.1, bearer token). §1 assumed that was poe; nobody checked before the build. On mbp-1 it
  named the offline `Orchestrator`, now `orchestrator: poe` (Casper, 2026-11-20: config only). The JSON
  op path stays without `laptop`: giving it one would open the relay to any `remote` agent, against §1.

**§6, the result** (af5ef9d)

- Held as written, §8's exits-at-start too. `handoff_length` is in characters (the measure of the
  broker's 16 KiB); a whitespace-only handoff counts as none. The handoff is fitted by a binary search
  on the serialised body, secrets withheld first.

**§7, the copies and reconciling** (6883060)

- **An event is accepted only when its `spawn_req` names a `spawn` in `remote_sent` sent to the
  sender's address** (`onRemoteEvent`, `supervisor.ts:1076-1083`), and a copy that has a `spawn_req`
  must match it. Stricter than §7's sender check, which alone would take a `supervisor@<any laptop>`
  event with an invented `spawn_req`; kept (ruling below).
- **`unknown`** counts as not ended: each reconcile asks it again and the 5-minute timer keeps
  running. A worker truly gone costs one `list` of at most 10 ids every 5 minutes.
- **Reconcile batches** 10 `ids` and 10 `reqs` per `list` (`supervisor.ts:153`) so the views fit one
  reply; a truncated list marks nothing `unknown`. `reqs` reach a day back (the replies' ttl).
- **An ended copy is final once it has a target view.** One made from an `exit` (no view yet) still
  takes the `status` fill, its ended state kept. A `remote_control` after the end is ignored.
- **The end notice** goes once the ended copy has its handoff fields (from `exit`, or `summary` when
  it ended by a reply). `told` is persisted, so a restart doesn't notify twice.
- **`remote_asks`** and the `request`, `settled` and `resumed` events are build B; an event of those
  kinds today only makes or keeps the worker copy.

**§9, versions:** a `v`-less `exit` or `remote_control` (a target rolled back below rc.39) is logged
and dropped (`supervisor.ts:1047-1048`), not taken for a copy as §9 says. Reconcile asks nothing there (the
version check refuses it), so those copies stay not ended until the target is back on rc.39; see the
open items.

**Consequences, testing:** the broker e2e tests of the four behaviours the fake copies came with A3
(`remote-wire.test.ts`), not with A1.

**Ruling: a spawn whose broker ack was lost.** `remoteAsk` (`supervisor.ts:1316-1338`) stores the
spawn's message id only from the broker's ack. If the socket drops after the frame left, or the ack
misses its 15 s (`client/src/connection.ts:21`), the row is `failed` with no message id, the tool says
"could not send", and the spawn may still have run on the target. Its reply and events then match
nothing and are dropped, and reconcile has no `req` to ask by: poe never learns of the worker.

- **Acceptable for build A.** The window is one ack's round trip, at a disconnect; it hasn't been
  seen. In A the worker's requests still go to poe@ubu1, so nothing waits on poe; it runs to its end on
  the target, visible on the dashboard and to poe@ubu1; and a retried spawn is refused as busy (§3),
  which tells poe the role is running there. The strict event check stays: loosening it to the sender
  alone would take events for spawns never sent.
- **Not acceptable once poe@ubu1 is retired** (after build B): the worker's `request` events would be
  dropped, its requests would time out denied, and its handoff would never reach poe. So **a task in
  build B**, before §12's "Casper may retire poe@ubu1", with no wire change:
  1. A spawn whose send throws once the frame may have left (a disconnect or a timeout, not "not
     connected") is kept as `unacked`, not `failed`, and its tool says "may or may not have run", as
     §2's no-reply does.
  2. While a laptop has an `unacked` spawn, reconcile also sends a bare `list` (the sender's live
     workers there) and adopts a worker whose `spawn_req` names no spawn it knows and whose project and
     role match exactly one `unacked` spawn to that address: the row takes that `spawn_req` as its
     message id, the copy is made, and poe gets "spawned after all". One worker per role per laptop
     (§3) makes the match unique. A worker already ended is missed by the bare list; that is left.
  3. An event whose `spawn_req` is unknown, from an address with an `unacked` spawn, triggers that
     reconcile instead of only being dropped.
  4. An `unacked` row is dropped after a day (the replies' ttl), as `reqs` are.

**Open items for review A or build B** (Mario's to place): the §9 `v`-less events above (accept a
`v`-less `exit` or `remote_control` for a copy, from its laptop's supervisor, as §9 says); the lost-ack task above.
The first is ruled in review A (`architecture/reviews/2026-11-20-bob44-build-a.md`): no fix, and §9's
sentence on accepting them is struck, since a rolled-back target sends no `v`-less event for a worker the
requester has a copy of; the copy shows `as_of`, and the target's queued `exit` or a reconcile ends it once
the target is back on rc.39 or later.

**§2, credentials, after the A-fixes** (rc.41: b2c8a96, c985339; `architecture/reviews/2026-11-20-bob44-a-fixes.md`):
the target redacts each field, then checks the serialised body as the broker does and withholds a matching
field whole (a handoff as `handoff_text: null, handoff_withheld: true`). `password_assignment`'s value
excludes `\`, so a body matches only where a field does. `private_key` redacts BEGIN through END, or to the
end of the text. The requester ends a copy whose handoff is withheld with "handoff withheld: ask <name> on
<laptop>". Until the broker carries the narrowed pattern (B6, BOB-71), the target checks with the narrowed
one and the broker refuses: stand-ins carry the end, and a worker whose `error` matches only serialised
withholds its `status` and `list` too.

**Ruling, review A-fixes F1** (consult c_8eed3623, advisory (c); Mario confirmed; `lead/bob44/review-a-fixes.md`):
the fix for the gap (the target passes a body that the broker, on the old pattern, refuses) has two parts.
(a) Deploy the narrowed `findSecret` to the broker ahead of build B. The broker uses only `findSecret` from
`secrets.ts` (`broker.ts:636`), and `packages/broker/src` is unchanged since f0e7f8f, so the deploy carries only
the narrowed `password_assignment`. It was deployed on 2026-11-20 as version
2a36f1e6-129d-4190-b844-1aab6b1160b0 (02:35:52Z). (b) The requester-side fix, BOB-78: a withheld `list` goes on
to the next batch, and a withheld `status` tells poe once. It stays useful after (a), because any later gap
between the two detectors, such as a laptop rolled back, shows up the same way. **Rejected:** a union of the old
and new patterns on the target. It leaves a second pattern to retire, and after (a) it would withhold more than
the broker refuses.

**Ruling, BOB-80 (review A-fixes F3; Casper Q3 "Yes"): the widened `findSecret`.** All four widen detection, so
the broker refuses more. Measured with node on 200 KB adversarial inputs: each pattern runs in under 5 ms.

1. **`X_PASSWORD` names.** `password_assignment` keeps its name and its value rule, and its prefix changes:
   ```
   /(?<![A-Za-z0-9])(?:password|passwd|secret|api[_-]?key)(?!_detected\b)(?:_[A-Za-z0-9]{1,32}){0,4}\s*[:=]\s*["']?[^\s"'\\]{8,}/i
   ```
   - **Before the keyword:** the lookbehind replaces `\b`, so `_` may precede it (`DB_PASSWORD`,
     `MYSQL_ROOT_PASSWORD`, `X_API_KEY`). The match starts at the keyword, so redaction keeps `DB_`.
   - **After the keyword:** up to 4 `_`-joined segments of 1..32 alphanumerics (`SECRET_KEY`,
     `AWS_SECRET_ACCESS_KEY`, `PASSWORD_HASH`). Without that bound, 200 KB of `_password` repeated is quadratic.
   - **`(?!_detected\b)`** keeps BobNet's own refusal text from matching. `secret_detected: password_assignment`
     would otherwise match, and a stand-in or error that quotes it would be refused in turn.
   - **Must match:** `DB_PASSWORD=hunter2hunter2`, `MYSQL_ROOT_PASSWORD: 'abcdefgh1'`,
     `AWS_SECRET_ACCESS_KEY=…`, `export GH_PASSWORD = "abcdefghi"`, and today's `password=…`.
   - **Must not match:** `password reset`, a bare `PASSWORD`, `passwordless=abcdefghijk`, `MYPASSWORD=…` (no
     separator: not in Casper's scope), `DB_PASSWORDS=…`, `DB_PASSWORD=short`, `DB_PASSWORD=Pa\ssw0rd!!` (Q1's
     `\` gap, kept), `"password": "…"` (a quote after the name: not detected today either, and not in scope),
     `secret_detected: …`, and the stand-in texts (`[withheld: looks like a credential]`,
     `[hidden: looks like it contains a credential]`, the broker's and client's `secret_detected` messages).
   - **Now withheld though not a secret** (AC 7's list; each ends as a stand-in):
     `PASSWORD_RESET_URL=https://…`, `DB_PASSWORD=${DB_PASSWORD}`, `PASSWORD_FILE=/run/secrets/db`,
     `SECRET_NAME=prod-db-creds`.
2. **PGP blocks and lowercase PEM: still `private_key`, one pattern:**
   ```
   BEGIN: /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/i
   END:   /-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/i
   ```
   - **Must match:** PGP's `PRIVATE KEY BLOCK`, any case, and the existing PKCS#8, RSA, EC and OPENSSH labels.
   - **Must not match:** `PGP PUBLIC KEY BLOCK`, `PGP SIGNATURE`, `CERTIFICATE`, `PUBLIC KEY`.
   - The label is capped at 40 characters, so a run of letters after BEGIN is bounded.
3. **PuTTY `.ppk`: a new name, `putty_key`.**
   ```
   detect: /PuTTY-User-Key-File-\d{1,2}:/
   end:    /Private-MAC:[ \t]*[0-9a-f]{1,128}/i
   ```
   - Case-sensitive, as PuTTY reads it.
   - The span runs from the header through the end of the Private-MAC line. That covers v2 and v3, and v3's
     Argon2 lines.
   - **Not matched:** prose naming the header without its colon. Prose quoting the header with its colon is
     withheld.
   - A new name is additive. Nothing branches on the name; it appears only in the broker's error text.
4. **Spans (AF2's rule for every kind).** A BEGIN or header redacts through the first END of its kind after it.
   With no such END, it redacts only its own line (Casper Q2). The span code must be **linear in the text**: find
   each kind's ENDs once per text, not once per BEGIN.
   - A lazy BEGIN..END regex without `|$`, replaced globally, took 367 ms on 200 KB of BEGIN lines and grows
     quadratically. Loop-until-no-BEGIN for nested keys has the same problem.
   - The bound: 200 KB of BEGIN lines with no END, and 200 KB of `.ppk` headers, each redact in under 50 ms.
   - Luigi was told during BOB-79 (m_cf9d46ac).
5. **One detector both sides.** The target's `withholdBody` and the broker both call the one `findSecret`, so
   AC 6 holds by construction once both run the same release.
   - The added test runs the new corpus through `withholdBody`, then `findSecret` on the result: null.
   - The stand-in texts and refusal messages above stay non-matching. That is the loop guard.
6. **Not in scope:** camelCase names (`dbPassword=`), a quoted JSON key (`"password": "…"`), and the RFC 4716
   SSH2 format (four dashes). Each needs a question to Casper first.

**Rollout: laptops first, then the broker (confirmed).**
- A broker that refuses what a target still passes reopens F1's window (a copy left running, nobody told). A
  target stricter than the broker only withholds more.
- So the order is:
  1. the release carrying BOB-80, installed and restarted on both mbp-1 and ubu1;
  2. then a broker deploy, poe's window, with Toad's go.
- A client that is older than the broker gets `secret_detected` back on a send or a close. That is a refusal it
  sees, not a stall. Captures drop it as permanent (`capture-queue.ts:38`).
- After the deploy, rolling a laptop back below that release reopens the window. BOB-78 bounds it to one notice
  per copy.
- If B6 (BOB-71) deploys after both laptops carry BOB-80, that one deploy carries BOB-80's widening and B6's mark.
  Otherwise BOB-80 has its own deploy.

**Build: BOB-80 can join BOB-79's build** (Luigi's BOB-78/79/81).
- Order: after BOB-79, as its own commit. BOB-80 adds the PGP and `.ppk` kinds to BOB-79's span code. The
  linear pairing above belongs to BOB-79.
- BOB-79 and BOB-81 need no broker deploy, and BOB-78 has none of its own. The release that carries all four
  goes to the laptops first, and the broker deploy follows (above).
