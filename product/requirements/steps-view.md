# 3. The steps view: a feature's sessions and tasks

**Who needs it:** Casper, to see what happened to a feature and what comes next without opening
handoff files. The project's orchestrator and PO, to pick the next session.

**What it is:** a feature, opened, shows its sessions as a chain of steps in the order they ran
(design, build 1, build 2, fixes, review, retro), each with its outcome, and under each its tasks.
The next step shows at the end of the chain.

Casper (2026-11-13): "steps view" was a suggestion, an example of the design questions our build
process raises. The criteria below are the needs. The layout of the screen is Daisy's to design, and
the prototype settles it.

## Criteria

1. A feature's sessions show in the order they ran, each with kind, label, start and end, and
   state (running, closed, waiting). *Evidence: test.*
2. A closed session shows its outcome without opening its handoff: what it needs (`need: none`,
   `answer` or `casper`), blockers and majors found, and the tasks it closed. *Evidence: test with a
   real handoff.* (Picard input, need 5)
3. A running session shows its agents, live, with tokens. *Evidence: dashboard check.*
4. Under each session, its tasks with their status and AC progress. A task that belongs to no
   session shows under the feature. *Evidence: test.*
5. The next step shows: which kind of session the feature's state calls for, or "waits on Casper"
   with the question. *Evidence: test.*
6. A link to each session's handoff file and its Remote Control session, where there is one.
   *Evidence: dashboard check.*
7. Usage shows as tokens, never money. *Evidence: test.*
8. Phone and tablet, in BobNet's own look. *Evidence: screenshots on phone and desktop.*

## Must not break

- A task's status comes from the board, and a session's state comes from BobNet's own records of
  its runs. Neither is derived from the other (Picard input: status moves only at session
  boundaries, by the PO).
- Cards and sessions come only from what `spawn_worker` declared, never from parsing a brief.

## Open questions

- **Toad:** where does a session's outcome live? Today it is in handoff files on the laptop
  (`~/.local/state/bobnet/handoffs/<project>/`) and in the close message. Should the close become a
  structured record BobNet keeps (it is BobNet's own data, not the board's), or should handoffs gain
  a fixed header BobNet reads?
- Which session kinds exist across projects? Helix uses design, build, review, retro and "fixes"
  (as a build label). Is "fixes" a kind of its own?
