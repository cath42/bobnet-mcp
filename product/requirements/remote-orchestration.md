# 11. One orchestrator across laptops

**Who needs it:** Casper, who runs a poe on mbp-1 and another on ubu1 because an orchestrator can
spawn workers only on its own laptop (BOB-44, his words, 2026-11-16: "can bobnet fix that … i can
reduce to just one Poe orchestrator? That would simplify coordination").

**What it is:** one orchestrator spawns, follows, answers and stops workers on any laptop's
supervisor through the broker, as it does on its own.

## What exists (read from the code, 2026-11-16; Toad's consult c_b8bd33df answered from memory and
proposes a new `worker_cmd` frame, which the code makes unnecessary)

A supervisor already takes a request from another laptop's orchestrator: a directed message whose
body is one JSON object (`packages/supervisor/src/remote.ts`). Ops: `spawn`, `status`, `stop`,
`list`. Who may is the target's `supervisor.yaml` `remote` allowlist (sender address, then project,
then roles). It follows and stops only what it spawned; the worker's events come back as messages
(`supervisor.ts:844`). It is hand-written JSON; the orchestrator has no tool for it.

## The gap

1. **No tool.** A poe writes JSON by hand; `spawn_worker`, `worker_status`, `tail_worker`,
   `stop_worker`, `list_workers` act on this laptop only.
2. **No answering.** A remote requester "answers no request": a remote worker's permission
   requests and questions wait for whoever is on the target laptop (the other poe, or Casper).
   With one poe there is none. This is the core of the feature.
3. **No view of it.** The remote worker is not in the orchestrator's `list_workers`,
   `pending_requests` or run-slot view.
4. **Handoff files are laptop-local.** The orchestrator cannot read what a remote worker wrote.

## Criteria (Draft; Toad's ADR settles the shape)

1. The orchestrator spawns, follows (status, tail, summary), and stops a worker on a named laptop
   with the tools it uses for its own: a `laptop` argument, default this laptop. Old callers are
   unchanged. *Evidence: test between two supervisors on one broker.*
2. The orchestrator sees a remote worker's permission requests and questions and answers them, only
   for workers it spawned there, and only when the target's config allows answering. *Evidence: test;
   a refused answer for another worker's request.*
3. A target laptop's own limits apply: its run slot, its usage, its config. The orchestrator's laptop
   does not count. A full or offline target refuses at once, with the reason; a spawn is never queued
   for later. *Evidence: test.*
4. A spawn names project, role and session, never a path. Repos and worktrees must already exist on
   the target. *Evidence: test (a path is refused).*
5. A remote worker's final result (the handoff's text) reaches the orchestrator without a file read
   across laptops. *Evidence: test.*
6. The target's config stays the authority: no `remote` entry, no remote spawn, and what is listed
   per project and role is all that is allowed. A refusal and an audit row on the target. *Evidence:
   test (exists today for spawn; extended to answer).*
7. The dashboard marks a worker's laptop wherever workers show. *Evidence: screenshot on phone and
   desktop (Daisy).*

## Must not break

- A laptop's token speaks for its own names only; the broker still stamps the sender (ADR 0004).
- A worker's board writes, `land` and `rebase` run on the target laptop, against its own worktree
  and slot, unchanged.
- The orchestrator dying leaves a remote worker running to its end; unanswered requests time out as
  denied.
- Local spawns and the one-poe-per-laptop setup keep working, so Casper may switch gradually.

## Split out (not in this feature, ask Casper before any)

- Reading a remote laptop's files (handoffs, logs) over the broker.
- Cloning a repo to a laptop that lacks it.
- A lock so two laptops don't land at once (Toad is checking ADR 0002 for a race on the shared `v2`).
- Which laptop's supervisor hosts the orchestrator, and a failover when it is down.

## Open questions

For Casper: Q-6 (who answers a remote worker's requests), Q-7 (repo cloning and remote file reads left out).
For Toad (ADR 0006): wire shape (the existing message vs a `worker_cmd` frame), the auth of answers,
`list_workers` across laptops, the landing race.
