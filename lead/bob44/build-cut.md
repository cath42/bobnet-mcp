# BOB-44 build cut (Mario, with Peach on the board)

From ADR 0007 §12 (v2 3c6a45b) and Luigi's costs (architecture/reviews/2026-11-17-adr0007-luigi.md, "What
each section costs"). Two builds, a review each; tasks cut along the ADR's sections and the feature's
criteria (product/requirements/remote-orchestration.md). Days are Luigi's, fixes included.

## Build A: poe drives ubu1; poe@ubu1 still answers (criteria 1, 3, 4, 5, 6 for spawn) ≈ 8 days

Ships alone: a `v: 2` worker's requests are still announced on the target, as today.
A1 lands first and alone: a supervisor that answers replies takes both laptops down.

| # | Board | Task | ADR | Days |
|---|---|---|---|---|
| A1 | BOB-59 | Test harness: a fake network for two supervisors on one broker, and the loop test (two supervisors never answer each other's replies, old and `v: 2`) | §2, Luigi 11 | 1.5 |
| A2 | BOB-60 | The wire in `packages/protocol`: request, reply and event schemas with `v: 2`, the classification (request only with `op`, no `in_reply_to`, no `re`/`event`), the rc version comparison | §2, §9 | 1 |
| A3 | BOB-61 | The durable `remote` outbox: verbatim bodies with `in_reply_to` and ttl, in order, final codes dropped with an audit row; `findSecret` before enqueue; `req` matching, resend, deadlines | §2, Bill M1/M2, Luigi 1/2/9/10 | 1 |
| A4 | BOB-62 | The target's spawn: now or refused with the reason (never queued), in-progress dedupe and the reservation, never a path, `by`/`remote_by`/`spawn_req` recorded, audit | §3, Luigi 3 | 1 |
| A5 | BOB-63 | The requester's tools with `laptop`: spawn, worker_status, tail_worker, worker_summary, stop_worker, list_workers; default this laptop, old callers unchanged; leads refused; peer and version check, offline refuses at once, "spawned after all" | §1, §5 | 1.5 |
| A6 | BOB-64 | The result: `exit` event with the handoff text, sized on the whole body; exits sent at the target's start for workers that ended while it was down | §6, §8 | 0.5 |
| A7 | BOB-65 | The requester's copies: remote workers table, reconcile on start, connect, join and a timer; events for unknown workers kept, not dropped | §7, §8, Luigi 4/6 | 1.5 |

## Build B: one answerer, and the laptop mark (criteria 2, 6 for answers, 7) ≈ 4 days

| # | Board | Task | ADR | Days |
|---|---|---|---|---|
| B1 | BOB-66 | Request lifecycle events to the spawner: `request`, `settled` (every source), `resumed`; orphan and resume | §4, Luigi 8/14 | 1 |
| B2 | BOB-67 | The target's `request` and `answer` ops: auth against the config at answer time, the spawner only; `remote:answer` / `remote:refused` audit | §4, criterion 6 | 0.5 |
| B3 | BOB-68 | One answerer: the target's `pending_requests` and `answer_request` leave out and refuse a `v: 2` requester's workers; the target's other notices rerouted as events; the worker's preamble (bare names) | §4, §3, Bill (bare names), Luigi 7 | 1 |
| B4 | BOB-69 | The requester's request tools: pending_requests, request_detail, answer_request with remote ids; merged lists; `slots` | §5 | 0.5 |
| B5 | BOB-70 | Dashboard data: `remote_from`/`remote_by` on WorkerSnapshot, `laptop` on StatusStuckRun | §7 | 0.5 |
| B6 | BOB-71 | The laptop mark per design/BOB-44/laptop-mark.md, phone and desktop; broker deploy via poe (Toad's sign-off) | §7, criterion 7 | 0.5 |

## Order and the field

- A1 first, then A2, A3; A4-A7 after A3 (A5 and A7 may run together in two worktrees only if Luigi says the
  files part; default one Luigi, in order).
- Build A ships in a release; ubu1 and mbp-1 both on it before the tools are used (§9). The `remote` entry on
  ubu1 then keys on `supervisor@mbp-1` (Casper's config, staged by poe@ubu1).
- After B: Casper may retire poe@ubu1.
- The spike (architecture/spikes/bob44-two-laptops.md) may change a task; Toad folds it into the ADR, I re-cut
  if needed before build A starts.
