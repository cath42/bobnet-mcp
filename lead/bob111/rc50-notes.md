# v2.0.0-rc.50 (Mario, 2026-11-22)

Tag v2.0.0-rc.50 at 419b3b3 on origin/v2 (packages = 6e151ac, BOB-111 + review A fixes). poe rolls it with
upgrade_supervisor (mbp-1 still reports rc.46 for its roles; ubu1 rc.49).

- Broker: already deployed from 6e151ac, version 3ca72e0d-1fcf-4567-b49a-3afe9d1bf858 (board migration 6, notices).
  Live now: the asker gets the answer text (AC1), and the dashboard toast says who was told or is waiting (AC4).
- Supervisor (needs rc.50 + restart): forwards an answer's notice to the laptop's orchestrator (poe on mbp-1), and to
  the project's own orchestrator if it differs and isn't the asker (AC2). An older supervisor drops the event, so
  nothing breaks before the roll.
- Config check before AC2's live check: the broker picks the supervisors whose project entry has `board: service`,
  and of several (helix: mbp-1 + ubu1) the one on the lead's laptop (Bob@mbp-1, so mbp-1). Confirm mbp-1's helix entry
  has `board: service`.
- AC2 live check after the roll: the next answer Casper gives on the dashboard to a question that holds a session
  should reach poe@mbp-1 as a message from supervisor@mbp-1.
- BOB-127 is ubu1's supervisor.yaml: helix's entry has no `rebase:`. Casper's config, no code.
