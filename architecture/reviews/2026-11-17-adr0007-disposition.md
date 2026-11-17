# ADR 0007: disposition of the two reviews

- **By:** Toad, 2026-11-17, session `BOB-44 design A`, step 4 (settle reviews).
- **Reviews:** Luigi's, as builder (`2026-11-17-adr0007-luigi.md`: 1 blocker, 10 majors, 7 minors) and
  Bill@mbp-1's, outside architect (`2026-11-17-adr0007-bill.md`: 0 blockers, 7 majors, 9 minors, two
  simpler alternatives).
- **Checked against the code** at v2 `5707552`, not taken on trust: the outbox prefix, missing
  `in_reply_to`/TTL and stop-at-first-failure (`supervisor.ts:1663-1673`, `store.ts:95-110`); the
  broker's `unknown_message` on a swept request (`broker.ts:302-304, 631-633, 739-742`); ack after
  `onRemote` and reply recorded after the work (`supervisor.ts:726, 771-782`); presence by team
  (`broker.ts:676-690`); `list`'s last 20 (`:819`); the target's other notices (`:309-314, 973, 1520`);
  restart orphans without `remoteEvent` (`:269-283`); the six settle sites, the abort path leaving the
  row open (`router.ts:126, 171, 190-199`, `supervisor.ts:566, 606, 282`); bare names on the sender's
  laptop (`address.ts:30-36`); default TTL 30 days (`frames.ts:30`); `user_decided` asserted by the
  caller (`mcp.ts:214`); the resume path passing `spawnedBy` only (`supervisor.ts:576-588`);
  `FakeBroker` as one laptop (`test/fakes.ts:154-165`); no supervisor mark in `PeerInfo`
  (`broker.ts:661-674`). Each held.
- **Count:** 34 findings. 33 change the ADR (4 of them in part or by another fix than proposed), 1 is
  declined. Of Bill's two alternatives, 1 is declined and 1 is taken in part. Status stays Proposed.
- Section marks are the revised ADR's (§1-§13, C = Consequences, Alt = Alternatives considered).

## Luigi

| Id | Finding | Disposition |
|---|---|---|
| L1 | Blocker: the outbox can't carry events or replies | Changed, §2 "Delivery": outbox kind `remote` (verbatim body, `in_reply_to`, `ttl_seconds`), always enqueued then flushed, final codes dropped and audited `remote:undeliverable`; same final-code rule for kind `message`; C |
| L2 | A late reply is refused by the broker | Changed, §2 "Replies": `req` in the body, matched on it; `in_reply_to` a hint, resent once without it on `unknown_message`; C (fake network's sweep); spike 9 |
| L3 | A redelivery during a spawn runs it twice | Changed, §2 "Idempotent on the target": in-progress row before any work, redelivery ignored; added: an in-progress row found at start gets a "target restarted" reply |
| L4 | Events for a worker the requester doesn't know are dropped | Changed, §7 "Unknown workers are learnt": accepted from the target's address, copy made, `status` fills it; `spawn_req` on every event (§2) |
| L5 | No ordering guarantee between events | Changed by another fix: always-enqueue order (§2) taken; the per-worker `seq` declined for copies that change only forward (terminal states final, unknown request made in the event's state) and synchronous handling (§7, §2 "Order isn't relied on", Alt) |
| L6 | Reconciling misses the requester's restart, other teams, old workers | Changed, §7 "Reconciling": on start, each connect, `joined`, and every 5 min while a copy is open; `list` takes `ids` and `reqs` (§2); `unknown` only when asked and not returned |
| L7 | The target still tells its own orchestrator about v: 2 workers; orphaned workers get no exit | Changed, §4: end, Remote Control failure and restart become events to the spawner; at start `exit` per failed v: 2 worker and `settled` (orphaned) per request, through the outbox |
| L8 | `settled` has six sources; the ADR names three | Changed, §4 "Every settle is told": one hook on `settleRequest`/`markOrphaned`; the abort path settles its row (all workers, C) |
| L9 | Check credentials before sending | Changed, §2 "Credentials": `findSecret` per field before enqueue, span replaced; broker refusal final, a `withheld` event in its place |
| L10 | The requester has no record of what it sent | Changed, §7: `remote_sent`, `remote_workers`, `remote_asks` (name clash with `remote_requests` noted); C |
| L11 | The two-supervisor test has no harness | Changed, C "Testing": `FakeNetwork` with the listed behaviours, loop test first; broker e2e pins for the four behaviours; §12 puts it first in build A |
| L12 | "Offline" can look online | Changed, §3 "Offline refuses at once, usually": half-open socket and its outcome; spike 2 |
| L13 | Size the exit event on the whole body | Changed, §6 "Size, on the whole body": error cut to 500, handoff gets the rest under 16 KiB with a margin; §2 "Size" |
| L14 | `by` required, carried into a resumed worker | Changed, §1 (required), §7 (`remote_by` marks v: 2), §4 (resume copies `spawned_by` and `remote_by`) |
| L15 | Comparing rc versions needs code | Changed, §9: `x.y.z[-rc.n]` comparison in `protocol`; missing or unparseable sends anyway |
| L16 | v: 2 `as: "lead"` | Changed, §3 "No remote leads", §2 table, §5, §11 |
| L17 | The lead's view, and `laptop: "all"` | Changed, §5: a lead lists no remote rows and refuses remote ids; `"*"` for every laptop |
| L18 | Wording: §13, §8's outbox, remote.ts/config.ts wording | Changed: the spike is §13 by number; §8 says the broker queues for poe and the outbox holds only what the broker couldn't take; C names both comments |

## Bill

| Id | Finding | Disposition |
|---|---|---|
| M1 | The outbox can't carry replies or events | Changed, as L1 (§2 "Delivery") |
| M2 | Replies depend on the request message still existing | Changed, as L2 (§2 "Replies"; `req` rather than `re_id`, since `re` names the op) |
| M3 | A spawn is not idempotent; "never queued" not atomic | Changed in part. (a) in-progress row: §2, as L3. (b) the check runs before the board join and reserves the role and a `concurrency` place until the row is made, so no refusal follows a join and no dangling join is left (§3); this also answers Bill's open question. (d) `list` after a timeout: §2 "Deadlines". (c) an idempotency `key`: declined, since one worker per role per laptop already refuses a retry of a running worker, and (d) shows the first (§3 "A retry is safe", Alt) |
| M4 | Late replies and events are dropped on the requester | Changed, as L4 and L10 (§7: `remote_sent` written before the send; unknown workers learnt) |
| M5 | A target restart tells nobody who needs to know | Changed, §4 "A target restart", as L7, using `settled` with state `orphaned` rather than a new `orphaned` event (one event per request change); reconcile on start and connect, as L6 |
| M6 | A remote worker's own messages go to the wrong laptop | Changed, §3 "The worker's own messages": the preamble names `<by>@<requester's laptop>`; briefs use full addresses; §11; spike 10 |
| M7 | More crosses the broker, and stays 30 days | Changed, §2 "Replies and events expire in a day" (one TTL for both, since reconcile and `summary` recover anything older, §6, §7); `tail`/`request` cut to fit; C amends ADR 0004 §4 |
| m1 | The answer grant includes the human tier | Changed, §4 "What that grants, said plainly", and the config comment (C) |
| m2 | Size the serialised body | Changed, as L13 (§6) |
| m3 | A withheld handoff leaves nothing | Changed, §2 "Credentials" withholds the span only, and §6 says poe spawns the role on the target to summarise; the resend-without-field design is gone |
| m4 | Target address: use the broker's reporter or the peer list | Declined: `PeerInfo` carries no supervisor mark (`broker.ts:661-674`) and `laptop_reports.reporter` isn't exposed, so either needs a broker change and a deploy for a case no laptop has (every supervisor runs on the default name). §1 says so, the offline refusal names the address tried, §11 lists it |
| m5 | Rollback | Changed, §9 "A target rolled back": the requester accepts `v`-less `exit` and `remote_control` for a copy; the version check refuses new requests |
| m6 | Rollout restart fails running workers | Changed, §9 "Rollout": restart each when its `list_workers` is empty |
| m7 | §10's trigger can't be measured | Changed, §10: measured from the two laptops' audits (`land:stale` against the other's `land:ok` in the window) |
| m8 | Spike 9 (clocks) is mostly moot | Changed: dropped from the spike, reason in §13; §2 says TTLs and waits are durations |
| m9 | The spike misses the cases that bite | Changed in part, §13: swept reply (9), bare name (10), target restart if poe@ubu1 agrees (11) added; broker outage and redelivery during a slow spawn left to the `FakeNetwork` tests, since the broker is production and a reconnect can't be forced on it |
| Alt1 | Point the target's orchestrator at the one poe | Declined, Alt: poe@mbp-1 would be told of requests it can't answer (its `answer_request` acts on mbp-1, and ubu1's local workers aren't its to answer), and text notices give no `pending_requests`; after poe@ubu1 retires nothing goes to ubu1's orchestrator anyway (§4) |
| Alt2 | Stage the ops | Taken in part: `slots` left out of this version (§2, §5, §11); `tail` stays (criterion 1 names it) and `request` stays, cut to fit (criterion 2: "exactly as local", where `request_detail` is how poe decides). The staging is §12's A/B |

## The cost

Luigi's ≈11.5 engineer-days hardly moves: `seq` and `slots` come out, the reservation, the preamble
and `summary`'s handoff go in. Most of it is what the criteria need to hold in the field, so §12
proposes a smaller first cut by order rather than by dropping fixes: build A (poe@mbp-1 spawns,
follows, stops and gets the result on ubu1, while poe@ubu1 still answers; criteria 1, 3, 4, 5, 6 for
spawn), shippable alone, then build B (one answerer and the mark; criteria 2, 6 for answers, 7).

## Open questions

- None for Casper beyond accepting the ADR; §4 "What that grants" is the part he should read
  knowingly.
- The spike's results (§13) are folded in after it runs.
