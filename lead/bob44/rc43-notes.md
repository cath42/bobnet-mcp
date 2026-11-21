# rc.43 (v2.0.0-rc.43, 757058e): BOB-44 build B

Tag pushed 2026-11-21 by Mario. From rc.42 Mario stops at the tag; poe rolls it (lead/CLAUDE.md "Releases").
Broker not deployed (see "Broker" below). Review B has not run yet: rc.43 ships for BOB-69 AC 6, the real-broker
§4 check, as rc.39 did for build A's AC 10.

## What's in it
- BOB-66 b289bfe: a `v: 2` worker's requests go to its spawner as `request`/`settled`/`resumed` events (not to the
  target's orchestrator); a stopped worker's waiting request settles `expired` (by `stop`), local workers too; a
  shutdown leaves them open, so the next start orphans them and answering resumes.
- BOB-67 8cf77a7, BOB-68 7a166f8: the target's `request` and `answer` ops (the spawner only, its entry read from the
  config at start; `remote:answer`/`remote:refused` audit); the target's `pending_requests`/`answer_request` leave
  out and refuse those requests; end, RC failure and restart notices go as events; preamble `<by>@<laptop>`.
- BOB-69 0f738c7: `pending_requests` merges remote copies (rows with `laptop`), `request_detail`/`answer_request`
  take remote ids.
- BOB-75 674cc6c: a spawn whose broker ack was lost is kept `unacked` and adopted by reconcile; `remote_sent` rows
  reconciled at start.
- BOB-70 8a0e9a7, BOB-71 b2bc9af: `remote_from`/`remote_by` on WorkerSnapshot, `laptop` on the stuck run (optional,
  additive), and the dashboard's laptop mark (broker deploy pending).

## Order: the requester first
An rc.42 (or rc.41) requester ignores the new `request` event: a request of a worker it spawned on an rc.43 target
would reach no orchestrator (only the dashboard or the timeout). The other way round is fine: an rc.43 requester's
`request`/`answer` ops are refused cleanly by an older target, whose own orchestrator still answers as today.
So **mbp-1 (the requester) on rc.43 before ubu1**, and no cross-laptop spawn by poe@mbp-1 while ubu1 runs rc.43
and mbp-1 doesn't.

## How each laptop gets it
- **mbp-1** (on rc.42): `upgrade_supervisor {tag: "v2.0.0-rc.43"}` on this laptop needs mbp-1's `upgrade:` section
  (`repo: ~/.local/share/bobnet/.src.git`, the clone is there), Casper's config, staged by poe; then
  `restart: now` once Mario has left a handoff. Until that section exists, the op is refused.
- **ubu1** (on rc.41): Casper's parked hand install of rc.42 (rc42-ubu1-install.md) plus its step 6 (the `upgrade:`
  section and `upgrade: true` on `supervisor@mbp-1`); then poe@mbp-1 rolls rc.43 there with
  `upgrade_supervisor {laptop: "ubu1", tag: "v2.0.0-rc.43"}`. That first remote upgrade is also BOB-83's AC 7.
  If Casper prefers one hand install, the same file with `TAG=v2.0.0-rc.43` in steps 2-3 works (step 4 then
  expects `ok: 2.0.0-rc.43`); step 6 is the same. mbp-1 runs rc.43 since 14:47:24Z, so the order holds either
  way (review B, Toad).
- **Check** on each: `supervisor@<laptop>` reports 2.0.0-rc.43 in `list_peers`.
- **Rollback, the target first** (review B, independent M1): never roll mbp-1 back alone while ubu1 runs rc.43,
  or a v: 2 worker's requests on ubu1 reach no orchestrator (only the dashboard or the timeout). Roll ubu1 back
  first, then mbp-1. `previous` points at rc.42 after the upgrade; `upgrade_supervisor` to v2.0.0-rc.42, or
  `ln -sfn v2.0.0-rc.42 <root>/current` and restart.

## Broker (laptops first)
- BOB-80 (findSecret wider; Toad's go in review A-fixes-4): deploy once ubu1 runs rc.42 or later.
- BOB-71 (the laptop mark, the RunRecord `laptop`): after review B's sign-off by Toad, and once both laptops run
  rc.43. One deploy can carry both if they line up. Window from poe; Mario deploys.

## After both run rc.43
BOB-69 AC 6, the real-broker §4 check: steps in ~/.local/state/bobnet/handoffs/bobnet/w_0720a815.md
"BOB-69 AC 6"; needs the `bob44-probe` rule in ubu1's policy.yaml (Casper's config, staged by poe@ubu1) and
ubu1's `supervisor@mbp-1` entry with athletic: [reviewer].
