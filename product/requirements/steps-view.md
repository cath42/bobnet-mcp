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
7. Usage shows as tokens, never money. A closed session's outcome line shows its total tokens (all
   its agents, the orchestrator's share included where known), as today's dashboard shows tokens per
   session. (Peach, 2026-11-13, on Daisy's question.) *Evidence: test.*
8. Phone and tablet, in BobNet's own look. *Evidence: screenshots on phone and desktop.*

## Must not break

- A task's status comes from the board, and a session's state comes from BobNet's own records of
  its runs. Neither is derived from the other (Picard input: status moves only at session
  boundaries, by the PO).
- Cards and sessions come only from what `spawn_worker` declared, never from parsing a brief.

## Open questions

- **Toad:** where does a session's outcome live? *Toad's advice (consult, 2026-11-13; not yet an
  ADR):* make a session's close a structured record the supervisor keeps as BobNet's own data,
  written from what the session declares when it closes (need, blockers and majors, tasks closed),
  with a link to the handoff. Never parse handoff files. Criterion 2 reads it from there once Toad
  records it.
- *Settled (Peach, 2026-11-13):* the session kinds are design, build, review and retro. "Fixes" is
  not a kind of its own: it is a build labelled Fixes, as Helix runs it and as the prototype shows
  it (design/BOB-1/notes.md open point 6).
