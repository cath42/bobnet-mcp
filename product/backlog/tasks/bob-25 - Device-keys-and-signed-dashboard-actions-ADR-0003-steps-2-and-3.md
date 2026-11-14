---
id: BOB-25
title: Device keys and signed dashboard actions (ADR 0003 steps 2 and 3)
status: Ready
assignee: []
created_date: '2026-11-14 17:28'
labels: []
dependencies:
  - BOB-12
  - BOB-2
references:
  - architecture/decisions/0003-owner-authority.md
priority: medium
type: increment
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0003 (accepted 2026-11-14) §5 steps 2 and 3, size M, after BOB-2's core and BOB-12 (step 1). Each browser enrols a device key once with a fresh Access sign-in; laptop-verified actions (answer, stop, reset) are then signed by it, so the owner JWT stops travelling to laptops. Packages: protocol, supervisor, broker, dashboard. Needs a release and restart. Casper agreed a shorter Access session for the dashboard app is his setting; no item for us. Daisy specs the 'add this device' flow and the enrolled-keys display before the dashboard part starts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Protocol, additive (ADR 0003 §6): Action gains enrol and revoke; client and server action frames gain optional signed {payload, sig, key}; server token is optional; LaptopSnapshot gains optional supervisor_id and owner_keys. Evidence: protocol tests, and an old-shape frame still parses
- [ ] #2 Supervisor makes a random supervisor id at first start, keeps it in its state folder and reports it. Evidence: test: id survives a restart
- [ ] #3 Supervisor acts on a signed action only if key enrolled and not revoked, signature verifies, `to` is its own id, `at` within two minutes, nonce unseen in ten minutes; otherwise refuses and records which check failed (clock skew names both times). Evidence: one test per check
- [ ] #4 owner_keys and seen-nonce tables exist under numbered migrations; nonces are swept; keys are revoked, never deleted. Evidence: tests
- [ ] #5 enrol is accepted only with a verified JWT whose iat is within ten minutes and a signature by the new key. Evidence: tests: stale JWT refused, unsigned refused
- [ ] #6 Dashboard makes a non-extractable ECDSA P-256 key per browser in IndexedDB, signs laptop-verified actions, and 'add this device' goes through sign-out and sign-in, reconnects, then enrols on every online laptop; an offline laptop shows 'not enrolled'. Evidence: screenshots on phone and desktop
- [ ] #7 Each laptop's enrolled keys (name, short id, enrolled, last used) show on the dashboard, an enrolment from the last day is flagged on every device, and revoke works from the dashboard and with `bobnet-supervisor keys`. Evidence: screenshot on phone and desktop, test for the command
- [ ] #8 Step 2 compatibility: a new supervisor without `signed` falls back to the token, an old supervisor ignores `signed`. Evidence: tests
- [ ] #9 Step 3: with the supervisor option on (default from the release that says so), an unsigned action other than enrol is refused, and the broker sends the owner JWT only with enrol. Evidence: tests; README says 'The broker alone can't act as you' with the Cloudflare account caveat (ADR 0003 §4)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
