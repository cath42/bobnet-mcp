# BobNet requirements

What BobNet must do, one file per capability: who needs it, the criteria and their evidence, and
what must not break. Peach owns these; Casper decides what BobNet is for, its release scope and
the order of releases.

## The central backlog system

One place where every project's work lives and is driven (Helix, Envision, Echo, Vitals and BobNet
itself): a board service inside BobNet that agents work through, and a dashboard Casper sees it on.

**Frame** (Casper, 2026-11-13, second version; replaces the first, which kept boards in repos):

- **The board is a BobNet service**, not files in each repo. Agents read and write it through an API
  and an MCP layer. **Backlog.md is retired by it, as a goal.**
- Hierarchy: release > feature > sessions (design, build, review, fixes, retro) > tasks. **Backlog
  items** sit outside it until someone slots them: in a release or in no release, in no feature
  ([capture.md](capture.md)).
- **Bugs** are part of the system; how they are handled is still to be settled ([bugs.md](bugs.md)).
- A new system designed for Helix, its main stakeholder. What other projects keep today doesn't
  constrain it.
- Views first (the roadmap, a feature's sessions, what waits on Casper), then starting a session from
  the UI. A prototype before any build.

*First version of the frame (superseded):* boards stay in their repos as the only source, and BobNet is
a view and launcher, not a second store, with edits as requests to each project's PO.

**Stakeholders.** Casper (owner, the one who decides and watches from a phone). Each project's product
owner and orchestrator. Picard (Helix's backlog product owner) is the largest stakeholder: Helix
has the largest board (~700 task files, 3 releases, ~29 features). Picard's written input:
`~/Code/helix-navigator-picard/product/roadmap/bobnet-backlog-input.md` (2026-11-13), cited below as
*Picard input*. It is input, not a ruling.

| # | Capability | File | State |
|---|---|---|---|
| 1 | The board service: store, API and MCP | [board-service.md](board-service.md) | Draft |
| 2 | The roadmap: releases and features across projects | [roadmap-view.md](roadmap-view.md) | Draft |
| 3 | The steps view: a feature's sessions and tasks | [steps-view.md](steps-view.md) | Draft |
| 4 | What waits on Casper | [waiting-on-casper.md](waiting-on-casper.md) | Draft |
| 5 | Start a session from the UI | [start-session.md](start-session.md) | Draft |
| 6 | Who writes the board, and editing from the UI | [board-writes.md](board-writes.md) | Draft |
| 7 | Capture backlog items without structuring them | [capture.md](capture.md) | Draft |
| 8 | Bugs | [bugs.md](bugs.md) | Open |
| 9 | Moving boards off Backlog.md | [migration.md](migration.md) | Draft |

State: Open (questions before criteria), Draft (being written), Agreed (Casper agreed it), Deferred.

**Release scope** (Casper, 2026-11-13, set under the first frame): the views (2, 3, 4) in the first
release, starting a session (5) in the next. **A prototype comes before any build.** Under the new
frame the views need the board service (1) and Helix moved onto it (9) first; how that changes the
releases is Casper's (open question C1 below).

## Settled with Casper (2026-11-13)

- **A new system, designed for Helix.** What each project keeps today doesn't constrain it. Helix
  is the main stakeholder, so its board (its hierarchy and rules, today in Backlog.md) and its build
  process shape the system. Other projects adopt the system's shape to show up in it; BobNet doesn't
  read their current formats.
- **One view across every laptop.** All supervisors' projects show on one screen.
- **The steps view is an example, not a spec.** Casper's "steps view" was brainstorming: an example
  of the design questions that come out of the build process. The criteria in
  [steps-view.md](steps-view.md) state the needs. The screen's shape is Daisy's, and the prototype
  settles it.
- **A session started from the UI goes to poe**, who starts sessions today. Bob may not exist by
  then, so the request names no orchestrator.

## What already exists (v2, 2026-11-13)

The supervisor reads a Backlog.md board from git (`packages/supervisor/src/board.ts`), and the dashboard
shows the roadmap by milestone, a feature's tasks by build session, drafts, and agents on the cards
their spawn named. Under the new frame that reader is a bridge for migration
([migration.md](migration.md)), not the design. The dashboard's views carry over.

## Open questions

Each file lists its own. These cut across all of them.

For Casper:
- **C1: releases.** The service and Helix's move onto it now come before the views can show anything
  real. Is release 1 "the service, Helix moved onto it, and the views", with the prototype first?
- **C2: who writes.** With the board in BobNet, may Casper edit and reorder from the dashboard
  directly, or do edits still go through each project's PO ([board-writes.md](board-writes.md))?
- **C3: bugs.** The questions in [bugs.md](bugs.md).
- **C4: the service is in the path.** Agents can't read or write their board when BobNet's service is
  down or a laptop is offline. Acceptable, or must agents keep working (a local copy that syncs)?

For Toad (architecture under the new frame, [Toad's first advice](#toads-first-advice-superseded) is
mostly moot):
- **T1:** where the board lives (the broker's Durable Object on Cloudflare, or elsewhere), its data
  model, and its API and MCP surface for agents.
- **T2:** history and audit: who changed what and when, since git history no longer records it.
- **T3:** a session's close as a structured record (Toad's first advice still holds), now in the same
  store as the board.

### Toad's first advice (superseded)

Under the first frame (consult, 2026-11-13): each supervisor reads its repos and sends a shaped board,
the broker holds it as a cache only; session closes become structured records the supervisor keeps;
project layout is named in the supervisor's config.
