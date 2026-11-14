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

**Proposed order** (Casper decides the release scope): 1, 2, 3 and 4 in the first release, since
they only read. 5 in the next release. 6 is deferred.

## What already exists (v2, 2026-11-13)

The supervisor already reads a Backlog.md board from git at a ref (`packages/supervisor/src/board.ts`).
The dashboard already shows the roadmap by milestone, a feature's tasks by build session, drafts,
and agents on the cards their spawn named. It covers one supervisor's projects, and only Backlog.md.
These requirements describe the whole system. Where something exists, the criteria still hold and
become its acceptance tests.

## Open questions

Each file lists its own. These cut across all of them:

- **Q1 (Casper): projects whose board isn't Backlog.md.** Helix and Envision use Backlog.md (Picard
  input; Envision runs on ubu1, without milestones). Vitals keeps a release table in
  `requirements/backlog.md`. Echo has no board. Does BobNet read other formats, or is Backlog.md
  the requirement for a project to show up, with the project moving to it?
- **Q2 (Casper): projects on other laptops.** Envision runs on ubu1. Is the central view all
  laptops' projects on one screen? Peach assumes yes: the broker already sees every supervisor.
- **Q3 (Toad): how boards reach the dashboard.** Each supervisor reads its projects' repos and sends a
  shaped board to the broker today. Does that hold across laptops and for Helix's size (the frame
  caps at 1500 items, per Picard input)? Does the broker keep it only as a cache, never as a store?
