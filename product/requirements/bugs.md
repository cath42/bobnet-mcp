# 8. Bugs

**State:** Open. Casper (2026-11-13): "we need to start considering how we want to handle bugs in this
system, we don't have those yet either." These are the questions to settle before criteria.

**Who needs it:** Casper, who finds bugs using the products. Agents, who find them while building.
Reviewers, whose findings (blockers, majors) are often bugs in all but name. The PO, who decides
when one is fixed.

## What is settled

- `bug` is one of the board's types (Helix's types).
- A bug is captured as quickly as any backlog item ([capture.md](capture.md)).

## Questions for Casper

1. **Where a bug lives.** In the feature that caused it, as a task? In whichever feature fixes it? On
   its own, outside features, like a backlog item? Peach's proposal: on its own when found, with a
   link to the feature and release it was found in. It is slotted like a backlog item when someone
   decides to fix it.
2. **What interrupts.** Does a bug in a released product jump the queue (a "fixes" session now), or
   wait for triage like everything else? Peach's proposal: a severity set at capture (blocks use /
   wrong / cosmetic), where "blocks use" shows on what waits on Casper.
3. **Review findings.** Are a review session's blockers and majors bugs on the board, or tasks of the
   feature under review? Today in Helix they are tasks or "fixes" builds on the same feature.
4. **Who may file one.** Any agent, Casper, the project's own users (later)?
5. **What closes one.** The fix landing, or Casper (or the PO) confirming it, with evidence like any
   acceptance criterion?
6. **Which product, which version.** Does a bug record the release or commit it was found in, and
   where (staging, production)?

## Input to ask for

- Picard: how Helix handles review findings and defects today, and what goes wrong.
