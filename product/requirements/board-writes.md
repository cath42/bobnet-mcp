# 6. Who writes the board, and editing from the UI

**Who needs it:** each project's PO, who must stay the board's writer. Casper, who wants to change
things from a phone.

**What it is:** the board is in BobNet now, so BobNet decides who may write what. Projects' rules
(Helix: the session PO writes the open feature, Picard everything else) are enforced by the service
rather than by convention.

## Criteria

1. Each role's write access is set per project: which items (all, the open feature's, none) and which
   fields (status, order, release). A write outside it is refused with the reason. *Evidence: test.*
2. Helix's rule can be expressed: the open feature's items by its session PO, the rest by the backlog
   PO, Casper's gates by Casper. *Evidence: test with Helix's roles.* (Picard input)
3. Builders read the board but don't move status. *Evidence: test.* (Picard input)
4. Every write carries who made it, in the item's history ([board-service.md](board-service.md) 7).
   *Evidence: test.*

## Open questions

- *Settled (Casper, 2026-11-13, C2):* Casper edits his own gates (release scope, order of releases,
  closing a release) on the dashboard directly. Everything else he wants changed is a request to the
  project's PO, which keeps one writer and the PO's judgement. Criteria for both to be written.
- Is "open feature" a field the service keeps now? It decides who may write, so the service needs it.
  Under the first frame it was derived from sessions (roadmap-view.md 9).

## Superseded

Under the first frame this was "Board changes as requests to the project's PO (deferred)".
