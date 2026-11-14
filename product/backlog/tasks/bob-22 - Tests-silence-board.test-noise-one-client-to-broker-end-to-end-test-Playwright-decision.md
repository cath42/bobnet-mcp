---
id: BOB-22
title: >-
  Tests: silence board.test noise, one client-to-broker end-to-end test,
  Playwright decision
status: Ready
assignee: []
created_date: '2026-11-14 16:33'
updated_date: '2026-11-14 16:42'
labels: []
dependencies: []
references:
  - architecture/reviews/2026-11-14-system-review.md
type: chore
ordinal: 1950
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review chore 14 [finding 11]. The end-to-end test is ordered before BOB-2 so the board build has it as a safety net. Package: all tests. Size S. The Playwright choice is Toad's.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The `fatal: ambiguous argument 'origin/main'` noise from board.test (lines 250-253) is gone (`stdio` or `ref: main`). Evidence: pnpm -r test output is clean
- [ ] #2 One test runs the real `BrokerConnection` against the vitest-pool-workers broker: register, send, receive. BOB-2's board_op tests build on this harness. Evidence: the test
- [ ] #3 Playwright is a pinned devDependency: `playwright-core` at exactly 1.63.0 (matching chromium-1243) in packages/broker devDependencies, never shipped; take.mjs imports it normally (no PLAYWRIGHT env var, no borrowing Helix's tree) and its header gives the one-time install `pnpm --filter @bobnet/broker exec playwright-core install chromium`. Evidence: package.json, the lockfile and take.mjs's header
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
