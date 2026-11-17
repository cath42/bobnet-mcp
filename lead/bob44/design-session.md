# BOB-44 design session: one orchestrator across laptops (Mario's plan)

Casper, 2026-11-16 ~22:45 (to poe, verbatim): "For bobnet, whats next? Can we prioritize the design and build to
spawn agents across machines? That one is starting to get important to get rid of the extra poe session, but I want
to make sure we get a solid design". BOB-44 moves to the front, right after BOB-47 (Athletic, finishing as planned). Order (Casper ~22:50 via poe): Mario's
current session finishes BOB-9 and BOB-47 and closes; BOB-44 design A starts as a new Mario spawn.

Session: `BOB-44 design A`. Inputs: board_get BOB-44 (6 ACs), product/requirements/remote-orchestration.md,
packages/supervisor/src/remote.ts (message-based remote spawn with a per-laptop `remote` allowlist exists today),
supervisor.ts:844 (worker events come back as messages), ADR 0002 (landing), ADR 0004 (system shape).
Casper has answered both questions already: Q-6 "why not? Poe answers, it doesnt matter what machine the owner of
the question is." (a); Q-7 (a), leave repo cloning and remote file reads out (a backlog item, not now).

## Steps, in order (each a worker in this session; Mario spawns, reads, sends on)
1. **Peach**: BOB-44 ordered right after BOB-47. Firm remote-orchestration.md into Ready criteria with Q-6 and Q-7's
   answers in. Q-6 reads as: poe answers its own remote workers' requests on any laptop; the target's `remote` entry
   still decides who may (AC 5). If "off by default" no longer holds after Q-6, say so in the criteria.
2. **Toad: ADR 0007** (0006 is taken: free-draft-prefix). Settles: the wire (extend remote.ts's message ops vs a
   frame; the code argues extend); the auth of an answer (only the spawner, only its own worker's request, audit on
   the target); `list_workers` / `pending_requests` / run slots across laptops; the landing race on the shared `v2`
   from two laptops (ADR 0002); the final result back as a message (AC 4); what happens when the orchestrator dies.
3. **Luigi: two-laptop spike on the real broker**, before the build is planned: today's remote.ts JSON from mbp-1 to
   ubu1: spawn a trivial worker, status, a permission request it raises (seen? answerable?), stop, final result.
   Needs a `remote` entry in ubu1's supervisor.yaml for the spawning address on an existing ubu1 project and a
   harmless role (athletic/Reviewer or helix/riker, read-only task; `sandbox` is closed, Casper 11-16): Casper's
   config, staged by poe@ubu1, OK'd by Casper in poe@ubu1's session in the morning. Result: architecture/spikes/bob44-two-laptops.md; Toad folds it into the ADR.
4. **Independent review of ADR 0007**, not only Toad's own sign-off: Luigi reads it as its builder (can it be built and
   tested as written?), and one architect outside BobNet: Bill@mbp-1 (Helix's architect), spawned by poe (agreed 11-16) when the
   session asks, with ADR 0007's path. Findings go
   back to Toad; the ADR changes or says why not.
5. **Daisy**: the laptop mark wherever workers show (AC 6), phone and desktop, a short spec.
6. **Mario with Peach: the build cut** into sessions `BOB-44 build A` and `build B` (and a review each), at most ~7
   tasks each, cut along AC lines, tasks on the board under BOB-44.

## Done (the session closes when all hold)
- remote-orchestration.md criteria Ready; BOB-44's ACs match it (Peach).
- ADR 0007 landed, Proposed; the spike file landed and cited by it; the two reviews landed with every finding settled.
- Daisy's spec landed.
- The build tasks on the board, cut into A and B, ≤ ~7 each; the first build named.
- Close `need: casper`: ADR 0007 acceptance (a board_ask with the ADR path; Casper reads it ~07:00).
