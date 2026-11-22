# BOB-6 design A: close (Mario, 2026-11-22)

need: casper (Q-11, the prototype verdict). The verdict holds the build (BOB-128..144), not this session.

## What landed
- Toad (w_f138f990), aa05ec6: ADR 0010 `architecture/decisions/0010-start-requests.md` and the build brief
  `architecture/bob6/build-brief.md` (18 tasks). A project's start rules are board data the PO writes
  (`set_start_rules`, new grant flag `start_rules`); the service checks them for the offer and the request
  (`startCheck`, a code and a reason sentence); Casper's `start_request` is owner-only and broker-held, sent as a
  notice over ADR 0009's path to the project's supervisor, which forwards it to its orchestrators and never spawns.
  It ends started (matched by `session_join` on feature and kind), declined (`decline_start`), or withdrawn.
- Daisy (w_ca894027), 59a5bb8: `design/BOB-6/spec.md`, `prototype/`, `shots/` (390, 1024, 1440). Start sits on the
  feature page only (Next banner and Next card), a full-page brief editor, a two-step confirm, the request
  pending on the page. Two small spec questions to Toad (resolved_by vs supervisor, presence time), not blocking.
- Peach (w_a3b4dc29), board only: BOB-6 criteria rewritten (AC1-AC5, DoD tidied), plan holds the cut. Tasks, all Draft:
  build A BOB-128..134 (board, brief 1-7), build B BOB-135..140 (delivery, 8-13), build C BOB-141..144
  (dashboard, 14-17), rollout BOB-145 (the POs' start rules, Peach's).

## Casper
- Q-11: the prototype at https://bobnet-prototype-bob-6.casper-cth.workers.dev (assets-only Worker
  `bobnet-prototype-bob-6`, version 7f4b82c6). It holds BOB-128..144. Toad's two choices are put to him as defaults
  that stand unless he objects: broker-held (no device signature); start rules bind the button, not poe's spawns.

## Live
Broker deploy (migration 7), then a release and a restart of mbp-1 and ubu1, then an admin grants `start_rules` to
each PO and the POs write their start rules (BOB-145). Start is offered nowhere until then.

## For poe: when a start request arrives (ADR 0010 §6, live only after that rollout)
A message from your supervisor beginning "Casper asks to start <project> <feature> <kind> <label> (start request
S-n)" is his confirmed request; below the line is his brief, verbatim.
1. Start it with `spawn_worker`: the project, the role that runs that kind there, `session: {feature, kind, label}`
   exactly as given, `tasks` your choice, `task` = his brief verbatim (add lines after it, never change it). Queuing is
   fine: it shows as started when the worker joins its session. Don't reply to BobNet@board; don't write the board.
2. Label taken: use the next free one; any session of that feature and kind matches.
3. Otherwise decline with `decline_start {project, request: "S-n", reason}`: one sentence he reads on his phone, why
   and what to do. Never leave one pending.
4. "Casper withdrew start request S-n": don't spawn it; stop_worker it if queued.
5. Nothing else changes: you decide who works on what; it moves no status and opens no release.

## Incident (mine)
Deploying the prototype, `wrangler pages project create` run from `packages/broker` was delegated by wrangler 4.155 to
a Workers deploy and uploaded a copy of the broker as a new public worker `bobnet-prototypes` (fresh empty Durable
Objects, no secrets). I deleted it within two minutes; the production `bobnet-broker` was untouched (still
3ca72e0d). Prototypes now deploy from a clean folder with their own config.

## Next
On Q-11: Peach moves the tasks to Ready (or applies his changes); then build A (Luigi).
