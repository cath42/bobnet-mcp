# BOB-48 build A and review A: close (Mario, 2026-11-22)

## Build A (Luigi, w_b75e7018)
All 7 tasks of architecture/bob48/build-brief.md landed: d2293eb protocol, d33ce81 broker, e19a30a supervisor,
and c04ca7b dashboard (Fixes: BOB-26). Screenshots are in design/BOB-48/shots-build. Luigi's divergences, all
accepted by Toad: one commit per package; fitRunName clips by code point within 99 UTF-16 units; the page goes
live before render; a fake Date for the BOB-49 Waits tests; an accent link; the code clipped to 40.

## Review A (Toad, w_a6eb9bbd)
architecture/bob48/review-A.md (1c7d416): signed off for the deploy and the rc, no blockers and no majors. Minors:
the style.css:60 comment sits over the wrong rule (fix it the next time the file is touched), and a reconnect
renders twice (look at it on the phone). Chore captured: BOB-160 (hold the UI suite's clock for the whole file).
Toad checked old and new supervisors against the new broker.

## Live
- Broker deployed from a clean tree at 1c7d416, version a6e7bd2e-4bcf-45d6-997e-b0350900f288. The
  dashboard responds and the supervisors reconnected.
- v2.0.0-rc.52 (6594514), tag pushed. poe rolls it with upgrade_supervisor.
