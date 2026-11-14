# 8. Bugs

**State:** Draft. Casper (2026-11-13): "we need to start considering how we want to handle bugs in this
system, we don't have those yet either." The proposal below was accepted by Casper the same day
("yes").

**Who needs it:** Casper, who finds bugs using the products. Agents, who find them while building.
The PO, who decides when one gets fixed.

## How bugs work (Peach proposal, accepted by Casper 2026-11-13)

A bug is captured like any backlog item ([capture.md](capture.md)), with type `bug`. It is not put
into a feature when it is found. It waits in the project's triage list until the PO decides which
feature or release fixes it.

1. **Capture.** Casper or any agent records it in one step: what happened, where (staging or
   production), and the feature it was found in, if known.
2. **Triage.** The PO slots it like any backlog item: into a feature (usually a "fixes" session), into
   a release, or closes it with a reason.
3. **Urgent ones.** A bug marked "blocks use" also shows on the "waits on Casper" list, so Casper decides
   whether it jumps the queue.
4. **Review findings are not bugs.** A review session's blockers and majors stay tasks of the feature
   under review, as in Helix today, because that feature isn't done yet.
5. **Closing.** A bug closes when its fix has landed and its one acceptance criterion ("it no longer
   happens", with evidence) is checked.

## Criteria

1. A bug is captured in one MCP call, or one field on the dashboard, with what happened, where
   (staging or production) and, optionally, the feature it was found in. *Evidence: MCP test.*
2. It waits in the project's triage list with the other backlog items, marked as a bug.
   *Evidence: test.*
3. A bug marked "blocks use" also shows on the "waits on Casper" list until it is slotted or closed.
   *Evidence: test.*
4. A bug closes only when its fix has landed and its acceptance criterion ("it no longer happens")
   is checked with evidence. Closing without a fix needs a reason. *Evidence: test.*

## Input to ask for

- *Answered (Picard, 2026-11-14):* matches. A review blocker or major is a task of the feature under review; other findings go to drafts (Helix ADR 0066 §1); a `bug` is delivered behaviour that breaks an accepted criterion, found after Done.
