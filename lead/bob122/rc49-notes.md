# rc.49 (v2.0.0-rc.49): BOB-122, the PO's 'release' grant

## What's in it (since rc.48)
- BOB-122 b1ba363 (Luigi; Toad signed off, ADR 0003 addendum 5610fad, architecture/reviews/bob122-review.md):
  - Grant field `release`: a rule with it moves a feature into, between and out of releases. The owner holds every
    grant. Ordering and closing releases and Undo stay Casper's.
  - The client's `board_write` gains op `set_release {ref, release (null: out of any), reason?}`, and its grants tool
    accepts the `release` field. **An rc.48 client has neither**: it refuses both locally.
- Broker deployed: 14ae087f-a49d-4fa3-8e54-e696f38a4a59 (board migration 5 ran; board reads fine).
- Board exports from this broker import only into this broker or later (Toad's minor 2).

## How each laptop gets it
- poe rolls it with `upgrade_supervisor {tag: "v2.0.0-rc.49"}`.
- **Then** apply Peach's rule from product/bobnet-grants.json (fields + `release`), from an rc.49 client or by Casper
  on the dashboard, not from an rc.48 client.
- **Check**: `supervisor@<laptop>` reports 2.0.0-rc.49; `board_grants` (bobnet) shows Peach with `release`.
- Other projects' POs get `release` only on Casper's yes (Q-10). Helix's Picard (not_open_feature) can't move a
  feature that's in an open session: that's the session PO's or Casper's (Toad's minor 1).
