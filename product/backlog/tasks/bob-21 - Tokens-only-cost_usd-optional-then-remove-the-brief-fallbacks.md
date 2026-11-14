---
id: BOB-21
title: 'Tokens only: cost_usd optional, then remove the brief fallbacks'
status: Ready
assignee: []
created_date: '2026-11-14 16:33'
labels: []
dependencies: []
references:
  - architecture/reviews/2026-11-14-system-review.md
type: chore
ordinal: 2100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review chore 13 [finding 10]. Usage is tokens, never money (Max subscription). Part 1 (cost_usd optional, stop computing it) goes with BOB-2 because run records carry tokens only (ADR 0001 §9). Part 2 (remove the brief fallbacks) waits until no row with NULL tasks is younger than 14 days, per the review, and cards come only from what spawn_worker declares. Packages: protocol, supervisor, broker (public/). Size S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `cost_usd` is optional in the protocol and nothing computes or shows it. Evidence: a protocol test; grep finds no cost shown in the dashboard
- [ ] #2 `namedSession`, `briefTask`, the fallback in `workerTasks` and `app.js` `taskRef` are removed once no row with NULL `tasks` is younger than 14 days. Evidence: a broker query showing no such row; the diff; tests pass
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
