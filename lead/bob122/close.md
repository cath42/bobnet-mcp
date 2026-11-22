# BOB-122 build A + review A: close (Mario, 2026-11-21)

- Built by Luigi in b1ba363: grant field `release`; setRelease and create-in-release check the grant (owner holds
  every grant); order/close releases and Undo stay ownerOnly; board migration 5 remakes grant_fields; client board_write
  gains `set_release`; product/bobnet-grants.json gives Peach `release`. AC1-3 tests in Luigi's handoff w_f6611f0e.md.
- Reviewed by Mario (diff read) and Toad: signed off, ADR 0003 addendum, architecture/reviews/bob122-review.md (5610fad).
  2 minors, no code: open-feature scope (Picard can't move an open feature); exports forward-only (in rc notes).
- Broker deployed from 25e5bae (packages identical to b1ba363): version 14ae087f-a49d-4fa3-8e54-e696f38a4a59.
- **Supervisor rc cut: v2.0.0-rc.49 at 25e5bae on origin/v2, tag pushed.** Notes: lead/bob122/rc49-notes.md. poe rolls
  it, then applies Peach's rule (an rc.48 client refuses the field locally).
- Peach accepted (w_14bdbf36): AC1-3 + DoD checked. AC4 open: waits on poe (roll rc.49, apply grant, board_grants read)
  and on Casper's Q-10 (release grant for Helix/Athletic/Vitals POs; recommended A, backlog POs Picard, Ledecky, Curie).
- BOB-125 / BOB-126 not folded in.
