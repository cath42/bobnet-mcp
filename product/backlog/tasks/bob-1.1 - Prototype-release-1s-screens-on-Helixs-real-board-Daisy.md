---
id: BOB-1.1
title: Prototype release 1's screens on Helix's real board (Daisy)
status: Done
assignee: []
created_date: '2026-11-14 03:59'
updated_date: '2026-11-14 05:00'
labels: []
milestone: m-0
dependencies: []
parent_task_id: BOB-1
type: task
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Daisy's task: the prototype in design/, from the requirements BOB-1 references. Static HTML in BobNet's own look is enough; no broker or supervisor change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Covers every acceptance criterion of BOB-1 except Casper's acceptance. Evidence: design/ path, screenshots on phone and desktop
- [x] #2 Lists what the prototype settles that the requirements leave open (layout of the steps view, what shows at phone width). Evidence: a notes file next to the prototype
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
Accepted by Peach 2026-11-13 against both criteria. Evidence: design/BOB-1/ (prototype/, shots/ 20 screens at 390/1024/1440, spec.md maps each BOB-1 criterion to its shots; notes.md lists what is settled and open). Landed v2 6f44ed1 (Daisy w_768eb4e6), reviewed by Mario. Gap noted, not blocking: one laptop only (notes.md open point 5), since both real projects run on mbp-1.
<!-- SECTION:NOTES:END -->
