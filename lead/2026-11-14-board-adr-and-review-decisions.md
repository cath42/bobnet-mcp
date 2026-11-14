# Casper's decisions on ADR 0001 and the system review, 2026-11-14

In Mario's session (w_8f39e4b7). Mario asked:

1. ADR 0001 (architecture/decisions/0001-board-service.md): accept it, with Toad's four additions from the
   review (re-read Broker state after the Board RPC await; source of truth for runs live vs after run_end,
   and run_end through the supervisor's outbox when the broker is down; tokens only, no cost_usd; "Other
   work" is no session, not a kind)?
2. Migration order: BobNet's own board first, as the pilot, then Helix (BOB-9)?
3. Fix the review's findings 1-3 (stale-tip land; owner JWT as a bearer token to laptops; supervisor acks
   before a message is consumed) before the board build starts, Luigi building?
4. Toad writes proposed ADRs P1 (system shape, state ownership, trust boundaries), P4 (owner authority for
   dashboard actions) and P5 (landing) now?

Casper, verbatim:

> 1. Yes, 2. Yes 3. Yes 4. Yes

Consequences: ADR 0001 accepted (with the four additions); BobNet migrates first; Luigi fixes findings 1-3
first, then BOB-2 in ADR 0001's build order; Toad writes P1, P4, P5 (proposed; accepting them is Casper's).
Dashboard answers for Helix's questions come with BOB-9, after BobNet's pilot.
