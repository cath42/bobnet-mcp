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
   A feature without a recorded order comes after the ordered ones, by id, still numbered.
4. Each feature shows progress as acceptance criteria checked of total, across its tasks.
   *Evidence: test.* (Picard input: AC are the progress measure) The count is always the real one: a
   Done feature with unticked criteria shows Done and its real count, with a muted "Done, criteria
   not ticked" note. Status never overrides the count. (Peach, 2026-11-13, on Daisy's question:
   most of Helix's Done features have their criteria unticked, e.g. LAND-22 at 3 of 138.)
5. Each feature shows the agents working on it now, from the sessions the spawns declared. Nothing
   is guessed from a brief. *Evidence: test.*
6. A project summary across projects: per project, the open feature, the next Ready feature, and
   how much waits on Casper ([4](waiting-on-casper.md)). *Evidence: screenshot on phone and desktop.*
7. Backlog items ([capture.md](capture.md)) and open bugs show as counts with their age, per project
   and per release, and open as a triage list. *Evidence: test.* (Picard input, need 4)
8. It reads well on a phone and a tablet, in BobNet's own look. *Evidence: screenshots on phone and
   desktop.*
9. Which feature is open shows on the roadmap. Under the first frame it was derived from sessions (a
   feature is open while it has a session that isn't closed; Picard, 2026-11-13: Helix doesn't record
   it). Now the service may keep it ([board-writes.md](board-writes.md)). *Evidence: test.*

## Must not break

- Order inside a release is the project's PO's. The order of releases is Casper's. The view shows
  both. Changing them from the UI is [board-writes.md](board-writes.md).
- Everything in [1](board-service.md).

## Open questions

- None of its own. See the [README](README.md).

## Casper's verdict (BOB-1 #6, round 1, 2026-11-14)

The concept is accepted; the Overview screen of the prototype is rejected as UX ("looks bad, its
not a very good UX"). Daisy redoes it. The criteria above are the needs; the layout stays hers.
