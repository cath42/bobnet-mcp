---
id: BOB-8
title: 'Capture backlog items in one step, and triage them'
status: Draft
assignee: []
created_date: '2026-11-14 04:24'
updated_date: '2026-11-14 15:05'
labels: []
milestone: m-0
dependencies:
  - BOB-2
references:
  - product/requirements/capture.md
type: increment
ordinal: 2700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 7, product/requirements/capture.md: one MCP call, never blocks, queued on the laptop when offline (C4); the PO's triage list, as the approved prototype shows it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Any agent captures an item with one MCP call: only a title and a sentence are needed, and a project (none without one). Release, type and the rest are optional. Evidence: MCP test (capture.md 1)
- [ ] #2 Capture never asks back and never blocks; missing fields stay empty for triage. Offline, the client queues it on the laptop and sends it on reconnect; none is lost to a network blip. Evidence: test with the broker down (capture.md 2, README T4)
- [ ] #3 A captured item records who captured it, in which session, and Casper's words verbatim when his. Evidence: test (capture.md 3)
- [ ] #4 Casper captures from the dashboard in one field, with the project preset from the screen; the first sentence becomes the title, the whole text is kept; + Capture stays in the header on every screen; bottom sheet on a phone, 16 px text. Evidence: screenshot on phone and desktop (capture.md 6, prototype notes 12, 27)
- [ ] #5 Per project, a triage list of backlog items: bugs first, then oldest; 25 rows then Show all; totals (items, bugs, oldest, median age, captured this week); per release for those that have one. Evidence: test; screenshot on phone (capture.md 4, prototype notes 25)
- [ ] #6 The PO triages: slot into a feature (it becomes a task), make a feature, put in a release or take out, or drop with a reason; the id never changes. These are the PO's actions, not on Casper's dashboard. Evidence: test (capture.md 5, prototype notes 26)
- [ ] #7 Drafts that carry a parent hint or a milestone keep it as a field for the PO to clear or set (Picard, 2026-11-14). Evidence: test
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Needs BOB-2. The client's offline queue is a client change (Toad to see). Release 1.
<!-- SECTION:PLAN:END -->
