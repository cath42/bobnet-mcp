---
id: BOB-15
title: Guard Keychain reads and correct the worker-isolation claim
status: Ready
assignee: []
created_date: '2026-11-14 16:33'
labels: []
dependencies: []
references:
  - architecture/reviews/2026-11-14-system-review.md
type: chore
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review finding 4 (chores 4 for README:111, and 5). Packages: supervisor (policy), README. Size S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The built-in guard denies `security find-generic-password` for BobNet's Keychain services. Evidence: a policy test
- [ ] #2 README.md:111 (worker isolation) says what holds with and without the sandbox. Evidence: the diff, read by Toad
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
