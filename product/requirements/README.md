# BobNet requirements

What BobNet must do, one file per capability: who needs it, the criteria and their evidence, and
what must not break. Peach owns these; Casper decides what BobNet is for, its release scope and
the order of releases.

## The central backlog system

One place to see and drive every project's work (Helix, Envision, Echo, Vitals and BobNet itself)
without moving any board out of its repo.

**Frame** (agreed with Casper 2026-11-13; a start, not settled):

- Each project's board stays in its repo and is the only source. BobNet is the central view and
  launcher, not a second store.
- Hierarchy: release > feature > sessions (design, build, review, fixes, retro) > tasks.
- First the steps view, then starting a session from the UI.
- Editing and reordering are deferred. When they come, they are requests to that project's backlog
  product owner, never writes by BobNet.

**Stakeholders.** Casper (owner, the one who decides and watches from a phone). Each project's product
owner and orchestrator. Picard (Helix's backlog product owner) is the largest stakeholder: Helix
has the largest board (~700 task files, 3 releases, ~29 features). Picard's written input:
`~/Code/helix-navigator-picard/product/roadmap/bobnet-backlog-input.md` (2026-11-13), cited below as
*Picard input*. It is input, not a ruling.

| # | Capability | File | State |
|---|---|---|---|
| 1 | Read each project's board from its repo | [board-sources.md](board-sources.md) | Draft |
| 2 | The roadmap: releases and features across projects | [roadmap-view.md](roadmap-view.md) | Draft |
| 3 | The steps view: a feature's sessions and tasks | [steps-view.md](steps-view.md) | Draft |
| 4 | What waits on Casper | [waiting-on-casper.md](waiting-on-casper.md) | Draft |
| 5 | Start a session from the UI | [start-session.md](start-session.md) | Draft |
| 6 | Board changes as requests to the project's PO | [board-change-requests.md](board-change-requests.md) | Deferred |

State: Draft (being written), Agreed (Casper agreed it), Deferred (recorded, not planned).

**Release scope** (Casper, 2026-11-13): 1, 2, 3 and 4 in the first release, since they only read.
5 in the next. 6 is deferred. **A prototype comes before any build** (Casper, 2026-11-13): Daisy
prototypes the first release's screens from these requirements, Casper sees and accepts it, and only
then does building start.

## Settled with Casper (2026-11-13)

- **A new system, designed for Helix.** What each project keeps today doesn't constrain it. Helix
  is the main stakeholder, so its board (Backlog.md, its hierarchy and rules) and its build process
  shape the system. Other projects adopt the system's shape to show up in it; BobNet doesn't
  read their current formats.
- **One view across every laptop.** All supervisors' projects show on one screen.
- **The steps view is an example, not a spec.** Casper's "steps view" was brainstorming: an example
  of the design questions that come out of the build process. The criteria in
  [steps-view.md](steps-view.md) state the needs. The screen's shape is Daisy's, and the prototype
  settles it.
- **A session started from the UI goes to poe**, who starts sessions today. Bob may not exist by
  then, so the request names no orchestrator.

## What already exists (v2, 2026-11-13)

The supervisor already reads a Backlog.md board from git at a ref (`packages/supervisor/src/board.ts`).
The dashboard already shows the roadmap by milestone, a feature's tasks by build session, drafts,
and agents on the cards their spawn named. It covers one supervisor's projects, and only Backlog.md.
These requirements describe the whole system. Where something exists, the criteria still hold and
become its acceptance tests.

## Open questions

Each file lists its own. These cut across all of them:

- **Q3 (Toad): how boards reach the dashboard.** Each supervisor reads its projects' repos and sends a
  shaped board to the broker today. Does that hold across laptops and for Helix's size (the frame
  caps at 1500 items, per Picard input)? Does the broker keep it only as a cache, never as a store?
  *Toad's advice (consult, 2026-11-13; not yet an ADR):* yes, with four conditions. Snapshots are
  keyed by project, laptop and commit, and sent only when the commit changes. Open work is sent in
  full; done features go as counts and ids, with detail fetched on click through the supervisor.
  Fields are added additively. The same repo at two refs on two laptops shows twice, labelled, and is
  never merged. Board-sources criteria 7 and 8 already fit this.
