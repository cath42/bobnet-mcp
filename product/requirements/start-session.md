# 5. Start a session from the UI

**Who needs it:** Casper, to start the next step of a feature from a phone. Each project's
orchestrator (poe for Helix today), who now writes the same spawn brief by hand each time (Picard
input, pains).

**What it is:** from a feature in the steps view, start its next session (design, build, review,
retro). BobNet fills in the brief and Casper confirms. The project's orchestrator runs it, as now.

## Criteria

1. Start is offered only on a feature its board allows: Ready for design or build, built for review.
   It is never offered past a gate. *Evidence: test.* (Picard input: must not skip Ready)
2. The brief is filled in from fields BobNet has: feature, session kind, label, the last session's
   close path, the project's skill for that kind, and Casper's ruling verbatim where there is one.
   Casper sees it and may edit it before confirming. *Evidence: test; screenshot on phone.*
   (Picard input, need 6)
3. Nothing starts without Casper's confirmation, which carries his identity. *Evidence: test.*
4. The session reaches the project's orchestrator as a request. The orchestrator starts it and
   declares its session and tasks, as with any spawn. *Evidence: test.*
5. Starting refuses, with the reason, when the project's rule forbids it: Helix allows one open
   feature at a time. *Evidence: test.*

## Must not break

- Release scope, the order of releases and closing a release stay Casper's, outside this button.
- The project's orchestrator stays in charge of who works on what. The UI asks; it doesn't spawn
  around it.
- Board status still moves only by the PO, at session boundaries.

## Open questions

- **Casper:** does a start go to the project's orchestrator (Bob for Helix), or to poe as today?
- **Toad:** how does a project declare its gates and session kinds (one open feature, which statuses
  allow which session) so BobNet doesn't hard-code Helix's rules?
