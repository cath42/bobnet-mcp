# rc.45 (v2.0.0-rc.45): BOB-44 build C + build D

Tagged by Mario after review D (Toad: 0/0/0, `architecture/reviews/2026-11-21-bob44-build-d.md`; independent: 0/0/2,
review-d-independent.md). Build C was reviewed in review C (review-c.md); its one major is BOB-105. From rc.42 on,
Mario stops at the tag and the push. Broker not deployed. Supervisor-only: no protocol or config schema change.

## What's in it (since rc.44)
- BOB-91 fd534aa: the guard covers guardedFolders(config) (<root>, upgrade.root, upgrade.repo) for every worker and
  the lead; the upgrade resolves the tag to a SHA once and uses only that.
- BOB-94 3560b95: the guard compares by real path and folded case; Bash commands checked as words from their cd.
- BOB-92 d3ce4ac: a second local upgrade whose verify outlasts the first one's restart is refused, builds nothing.
- BOB-93 b860909: the upgrades row is written from `installing`; resume() fails an open row and discards its partial.
- BOB-95 ec3fb35: exec keeps stdout apart; verify has one 75 s deadline; nothing new starts between switch and exit.
- BOB-105 a0cfe42: ask() refuses until resume() has run ("this supervisor is starting; ask again once it is
  ready"); an ended upgrades row is never reopened.
- Not in it: BOB-104, BOB-102, BOB-103, BOB-106..110, BOB-113, BOB-114.

## Order
No new rule (Toad, review D). The rc.43 rules from rc44-notes.md stand for anything below rc.43: the requester
(mbp-1) first on install; on rollback the target first.

## How each laptop gets it
- **mbp-1** (on rc.44): poe hand-installs it after Mario's review D close, as rc.44 was (`git archive` of the tag into
  the install root's `v2.0.0-rc.45`, `pnpm install --frozen-lockfile` there, `current` pointed at it, restart). That
  restart also makes mbp-1's `upgrade:` section live.
- **ubu1** (on rc.41): Casper's one session runs rc42-ubu1-install.md (rc.44, v2 5d3d44e). Once ubu1 reports
  2.0.0-rc.44, poe rolls rc.45 there with `upgrade_supervisor {tag: "v2.0.0-rc.45"}` (BOB-83 AC 7). Right after
  ubu1's restart the ask may be refused "this supervisor is starting": transient, ask again.
- **Check**: `supervisor@<laptop>` reports 2.0.0-rc.45 in `list_peers`. Supervisor tests at the tag: 526.

## Broker
Unchanged: BOB-80, BOB-71, BOB-96 deploy once both laptops run rc.42 or later (rc.43 for BOB-71 AC 4); waits on
ubu1. Then BOB-69 AC 6 and BOB-71 AC 4.
