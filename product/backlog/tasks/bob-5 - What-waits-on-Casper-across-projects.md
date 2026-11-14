---
id: BOB-5
title: 'What waits on Casper, across projects'
status: Draft
assignee: []
created_date: '2026-11-14 03:59'
updated_date: '2026-11-14 15:05'
labels: []
milestone: m-0
dependencies:
  - BOB-1
  - BOB-2
references:
  - product/requirements/waiting-on-casper.md
type: increment
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Capability 4, product/requirements/waiting-on-casper.md, as the approved prototype shows it, with Casper's answering from the dashboard (questions and permissions, rounds 2 and 3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One list across projects of what waits on Casper: questions (Q-n), actions (A-n), sessions closed with need: casper (shown on the question they wait for), review gates, pending permission requests, bugs that block use; each with project, feature, age, what it holds up, a link. Evidence: test; screenshot on phone (waiting-on-casper.md 1)
- [ ] #2 Two groups, Holds work up and When you have time, each oldest first; 'Holds up' appears only on items that hold up a named task, session or feature, otherwise 'Needed before ...'. Evidence: test with A-15 and Q-259 as in the prototype (prototype notes 22, 35)
- [ ] #3 An item leaves the list when its source says it is answered; the list keeps no state. Evidence: test (waiting-on-casper.md 2)
- [ ] #4 Casper answers a question from the dashboard: the recommended option or free text; the answer is stored verbatim on the question record; the question leaves the list; the project's lead gets a message with it; only Casper may write it, never edited by another role. Evidence: test (verbatim, refused for another role, lead messaged); screenshot on phone (waiting-on-casper.md 4)
- [ ] #5 Casper allows or denies a pending permission request from the list, with today's action and today's confirmation for risky ones. Evidence: test; screenshot on phone (waiting-on-casper.md 5)
- [ ] #6 The count shows on the Overview and the tab. Evidence: screenshot (waiting-on-casper.md 3)
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
Needs BOB-2 (question and action records). Open for Toad: how the lead gets the answer, and how answers are written for Helix's Q-n until BOB-9. Peach's view: the dashboard answers only questions that are records in the service. Release 1.
<!-- SECTION:PLAN:END -->
