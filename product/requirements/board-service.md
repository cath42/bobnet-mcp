# 1. The board service: store, API and MCP

**Who needs it:** every project's agents, who keep and navigate their board through it. Each project's
product owner, who writes it. Casper, who sees it on the dashboard. It is the base of everything else
here.

**What it is:** BobNet holds every project's board. Agents read and write it through an API and an MCP
layer. Nothing about the board lives in the project's repo. It replaces Backlog.md (Casper,
2026-11-13: "backlog.md dies with this solution, that's a goal").

## Criteria

0. **The board is a database, not files** (Casper, 2026-11-13: "a structured system like an actual
   database ... not still trying to hack something with MD files"). Every item kind (project,
   release, feature, task, backlog item, bug, session, question) is its own record with typed fields.
   Links between them are references the store enforces: an item's parent, release, dependencies, the
   session that closed it. Acceptance criteria are records of their own, each with its text, evidence
   and state, not checkboxes in text. Status, type and other closed lists are constrained values. No
   Markdown or YAML is parsed or stored as structure. Only description and notes are free text.
   *Evidence: the schema (Toad's ADR); a test that an invalid status or a dangling link is refused.*
1. Every project's board is in the service: releases, features, tasks, backlog items
   ([capture.md](capture.md)) and bugs ([bugs.md](bugs.md)), each in exactly one project.
   *Evidence: test.*
2. An agent can navigate the board through MCP tools. It can see a project's releases, a release's
   features, a feature's tasks and sessions, backlog items, and one item in full. It can search by
   text, status and label. *Evidence: MCP test.*
3. An agent can create and change items through MCP and the API, as far as its role may
   ([board-writes.md](board-writes.md)). *Evidence: MCP test.*
4. Each item has an id, title, status, type, parent, release, labels, dependencies, description and
   acceptance criteria that can be checked off, each naming its evidence. Progress is criteria
   checked of total. *Evidence: test.* (Picard input: AC are the progress measure)
5. Ids are per project with the project's prefix (`LAND-49`, `BOB-1`) and are never reused. Moving an
   item to another feature or release keeps its id, so Helix's "Was LAND-n.m" re-creation is no
   longer needed. *Evidence: test.* (Picard input)
6. Order is explicit and kept: features in a release, releases in a project, backlog items in
   triage. *Evidence: test.* (Picard input: show order, not only id)
7. Every change is recorded: who (role and project), when, what changed, from what to what. An item's
   history can be read through MCP and on the dashboard. *Evidence: test.*
8. The statuses are Helix's: Draft, Ready, In Progress, In Review, Done. The types are increment
   (feature), task, spike, bug and chore. A project may not invent its own. *Evidence: test.*
   (Helix's board; to confirm with Casper whether projects may differ)
9. Agents of different projects never see or change each other's boards, unless a role is given
   more (Casper, Mario). *Evidence: test.*
10. Done features keep counts in lists, with their tasks loaded when opened, so Helix's size (~700
    tasks, ~29 features) stays fast on a phone. *Evidence: test with a Helix-sized board.*

## Must not break

- One writer per item at a time. Helix has two writers by rule: the session PO writes the open
  feature, Picard everything else (Picard input). The service must be able to enforce that
  ([board-writes.md](board-writes.md)).
- Status moves only when the PO moves it, at session boundaries, never from builders' activity.
  Live state comes from sessions (Picard input).
- Release scope, the order of releases and closing a release are Casper's.
- Usage shows as tokens, never money.

## Superseded

Under the first frame this file was "Read each project's board from its repo" (read from git at a
ref, never written by BobNet). Picard's input "board stays in the repo; agents and CLI work with
BobNet off" is overruled by Casper (2026-11-13); whether agents must still work with the service down
is question C4 in the [README](README.md).

## Open questions

- C4 in the [README](README.md): agents when the service is unreachable.
- T1 and T2 in the [README](README.md): where it lives, its model, its MCP surface, history.
- Helix's releases index (`product/releases/README.md`) holds each release's status and what it
  delivers. Does a release in the service carry that text (a description), or does the spec stay in
  the repo with a link? Peach's proposal: the release's status and order are in the service; its
  spec document may stay in the repo, linked.
