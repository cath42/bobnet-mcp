# BOB-121 design A: close (Mario, 2026-11-22)

need: casper (Q-13, the verdict on the full prototype). It holds BOB-121: no build before his words on the board.

## What landed
- Toad (w_ad774112), 4e0a003: ADR 0014 `architecture/decisions/0014-usage-weighting-and-project-page.md` and
  `architecture/bob121/build-brief.md` (data tasks D1-D7).
  - Weighted usage = Sonnet-equivalent tokens: each model's tokens times its list-price ratio to Sonnet 5.5 (Opus x2,
    Haiku x0.05, Fable 5.1 x5). Ratios only, never a price. Effort isn't weighted (already in the raw count). Unknown or
    null model counts x1 and is named. Off = raw tokens as today.
  - Two new board reads (`usage`, `project`), broker deploy only. BOB-163's cause: overview() takes the first `open`
    release; new rule is the first non-closed release with a feature not Done (D2, `Fixes: BOB-163`).
  - D1-D5 broker deploy only; D6 (SDK per-model split, optional) rides with D7 = BOB-162 in an rc + restart.
  - Open: `fable` alias 5.1 vs 5.2 (Luigi verifies); D2 ends with a live check against Helix's board.
- Daisy (w_c45b3ef0), 0f0d29e: `design/BOB-121/` use-cases.md (AC1, with current/ shots), spec.md (§1 change list,
  §6 open questions), prototype/ (every view), shots/ (22 views x 390, 1024, 1440).
  - Open for Peach: AC4 "nothing over a day old" read as live requests only; board questions stay while open, with
    their age. Open for Toad/build: CI history (last 5 runs per workflow), a feature's own criteria count, a day's
    top sessions in the usage read.

## Review (Mario)
- Minor for the build: on a phone the Usage "What's factored" table overflows (cache-read column cut at 390).

## Deployed
- https://bobnet-prototype-bob-121.casper-cth.workers.dev (assets-only Worker `bobnet-prototype-bob-121`, version
  a48af9bd), from 0f0d29e's design/BOB-121/prototype in a clean temp dir.

## Side: BOB-48 / BOB-26 live evidence
- Luigi (w_819dedf3): blocked, the dashboard is behind Cloudflare Access and agents hold no credential. Nothing changed.
- mbp-1 pending_requests empty at ~20:55Z. Asked poe to check ubu1's requests and both outboxes and send Peach the
  result; told Peach she may accept on that or ask for Casper's screenshots via me.

## Next
After Q-13: BOB-121 build. Peach splits it into tasks from the build brief and the spec; Luigi builds (data D1-D5
first, then views), Daisy and Toad review. Where it goes relative to R3 is Peach's slotting / Casper's release order.
