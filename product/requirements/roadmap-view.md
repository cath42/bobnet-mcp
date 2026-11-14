# 2. The roadmap: releases and features across projects

**Who needs it:** Casper, on a phone, to see where every project stands. Each project's product
owner, to see order and what is Ready.

**What it is:** one screen per project (and a summary across projects) showing releases in their
order, each with its features in their order and where each stands.

## Criteria

1. Every connected project shows, on every laptop, with its releases in order. *Evidence: dashboard
   check with two projects on two laptops.*
2. A release lists its features in the board's order, each with its state: Draft, Ready, open (in
   progress), in review, done. *Evidence: test.* (Picard input, need 1 and 2)
3. Order is shown explicitly (1, 2, 3...), not only implied by id. *Evidence: screenshot.* (Picard input)
4. Each feature shows progress as acceptance criteria checked of total, across its tasks.
   *Evidence: test.* (Picard input: AC are the progress measure)
5. Each feature shows the agents working on it now, from the sessions the spawns declared. Nothing
   is guessed from a brief. *Evidence: test.*
6. A project summary across projects: per project, the open feature, the next Ready feature, and
   how much waits on Casper ([4](waiting-on-casper.md)). *Evidence: screenshot on phone and desktop.*
7. Drafts show as a count with their age. A draft also shows which session close it came from, when
   the board records that. *Evidence: test.* (Picard input, need 4)
8. It reads well on a phone and a tablet, in BobNet's own look. *Evidence: screenshots on phone and
   desktop.*

## Must not break

- Order inside a release is the project's PO's. The order of releases is Casper's. The view shows
  both and changes neither.
- Everything in [1](board-sources.md).

## Open questions

- Is "open" a board state or a session state? In Helix, one feature is open at a time and that
  decides who writes the board (Picard input), but no field records it. Peach's proposal: a feature
  counts as open while it has a session that isn't closed. Peach will ask Picard.
