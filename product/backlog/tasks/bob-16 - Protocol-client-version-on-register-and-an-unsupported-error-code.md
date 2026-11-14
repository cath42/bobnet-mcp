---
id: BOB-16
title: 'Protocol: client version on register, and an unsupported error code'
status: Ready
assignee: []
created_date: '2026-11-14 16:33'
updated_date: '2026-11-14 16:42'
labels: []
dependencies: []
references:
  - architecture/reviews/2026-11-14-system-review.md
type: chore
ordinal: 1900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
System review chore 11 [finding 8]. Ordered just before BOB-2 because BOB-2 grows the protocol (frames, error codes) additively and this makes that safe for old clients. Packages: protocol, broker, client. Size S. Toad to confirm.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `register` carries an optional `client: {package, version, protocol}`; the broker stores it and the dashboard shows it per agent. Evidence: a broker test and a dashboard check
- [ ] #2 A frame type the broker doesn't know is answered with an `unsupported` error code, not dropped or crashed on. Evidence: a protocol/broker test
- [ ] #3 An old client without `client` still registers (holds by construction: the field is optional). Evidence: a test
- [ ] #4 Given `unsupported`, the client says "the broker doesn't know <frame>; it is older than this client", not a bare error. Evidence: a client test
- [ ] #5 Ships in the broker deploy before BOB-2's (the client message helps only once this broker is deployed). Evidence: release order noted on the board
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Landed on v2 (land: pnpm -r typecheck and pnpm -r test pass)
- [ ] #2 Acceptance criteria pass, evidence linked (test, phone and desktop screenshot, or dashboard check)
- [ ] #3 Architect (Toad) signed off if it touches the protocol, the broker store or how the parts fit (or: not applicable, because ...)
- [ ] #4 Live only after a release and a restart: say whether it needs one
<!-- DOD:END -->
