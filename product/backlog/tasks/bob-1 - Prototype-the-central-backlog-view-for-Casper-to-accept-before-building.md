---
id: BOB-1
title: 'Prototype the central backlog view, for Casper to accept before building'
status: In Review
assignee: []
created_date: '2026-11-14 03:59'
updated_date: '2026-11-14 05:00'
labels: []
milestone: m-0
dependencies: []
references:
  - product/requirements/README.md
  - product/requirements/roadmap-view.md
  - product/requirements/steps-view.md
  - product/requirements/waiting-on-casper.md
  - product/requirements/board-sources.md
type: increment
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Casper, 2026-11-13: a prototype before we start building. A clickable prototype of release 1's screens (capabilities 1-4 in product/requirements/README.md), on Helix's real board, which Casper sees on a phone and a desktop and accepts or corrects. The steps view in product/requirements/steps-view.md is an example, not a spec: the screen's shape is Daisy's. Nothing in packages/ changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The roadmap across projects and laptops: releases in order, features in order with state and AC progress, the open feature, drafts (roadmap-view.md 1-9). Evidence: prototype screenshots, phone and desktop
- [ ] #2 A feature opened: its sessions in the order they ran with outcomes, its tasks, and the next step (steps-view.md 1-8). Evidence: prototype screenshots, phone and desktop
- [ ] #3 What waits on Casper, across projects, with its count on the overview (waiting-on-casper.md 1-3). Evidence: prototype screenshots, phone and desktop
- [ ] #4 Built from a sample of Helix's real board (LAND-49 and its release, ~700 tasks' worth of counts), not invented data. Evidence: the sample's source named in the prototype
- [ ] #5 BobNet's own look (packages/broker/public/style.css), usable on a phone and a tablet. Evidence: screenshots
- [ ] #6 Casper accepted it, or his corrections are recorded in the requirements. Evidence: Casper's words, verbatim, in the feature's notes
- [ ] #7 Capture on a phone in one field, and a project's triage list of backlog items (capture.md 4-6). Evidence: prototype screenshots, phone and desktop
- [ ] #8 Casper's gates editable on the dashboard: release scope, order of releases, closing a release (board-writes.md, C2). Evidence: prototype screenshots
- [ ] #9 Bugs in the triage list, a 'blocks use' bug and Casper's open questions on the waits-on-Casper list (bugs.md, waiting-on-casper.md, C8). Evidence: prototype screenshots, phone and desktop
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prototype landed (BOB-1.1 Done, v2 6f44ed1): design/BOB-1/. Waiting for Casper's verdict; Mario's summary for him: lead/BOB-1-prototype-for-casper.md. Casper's words go here verbatim.

#6 Casper's verdict on the prototype, verbatim (session 2026-11-14; source: Mario's lead/BOB-1-casper-feedback.md). Round by round.

Round 1:
> 1. I like the concept, but the overview looks bad, its not a very good UX - also what is missing here is something that overlays agents work against tasks/stories within a feature, I want to know who is working on what right now which would all be within a feature session right? Finally, you have questions in here, can I answer questions from the UI and if so, how?

Peach's reading: concept accepted; Overview rejected as UX (Daisy redoes it); new need: agents overlaid on a feature's tasks (steps-view.md criterion 9); answering from the UI is a question to Casper (waiting-on-casper.md open question; today's "Must not break" stands until he answers).
<!-- SECTION:NOTES:END -->
