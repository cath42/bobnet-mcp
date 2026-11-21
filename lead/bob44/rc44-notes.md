# rc.44 (v2.0.0-rc.44): BOB-44 build B-fixes

Tagged by Mario after review B-fixes (Toad: 0 blockers, 0 majors, 0 minors; review-b-fixes.md). From rc.42 on,
Mario stops at the tag and the push. Broker not deployed.

## What's in it (since rc.43, 757058e)
- BOB-96 511a1ce (dashboard, broker static; reaches users only with the broker deploy): a wrapped role in
  Working now lines up with the name on a phone.
- BOB-97 aeb897b: a request copy that missed its `settled` no longer stays open for good. A full list finalises the
  copies it leaves out (`gone`), `pending_requests` leaves out copies over a day old, final copies are pruned after
  a day, and the `answer` reply updates the copy.
- BOB-98 9bbf292: the target's `answer` op refuses a non-v2 worker's request; a v: 2 spawn's `by` must be a
  BobNet name.
- BOB-99 8261176: `fitRequest` also cuts `answers` (stubbing `input` as a last resort); a withheld reply gives
  advice by op; the `answer` op's audit says what happened; an orphan answered whose resume failed comes back
  `not_resumed`, not as an error.
- BOB-100 8bd1407: "spawned after all" fires only for a spawn's first copy; a stop asked for before a shutdown
  still settles the worker's request.
- BOB-101 c334cd9: tests only (both supervisors real).
- Not in it: BOB-104 (local answer_request on a failed resume still throws), BOB-102, BOB-103.

## Order
No new rule (Toad). rc.43 and rc.44 work in either order. The rc.43 rules stand for anything below rc.43:
**the requester (mbp-1) first** on install; on rollback **the target first**, so never roll mbp-1 back alone
while ubu1 runs rc.43 or later. Rolling mbp-1 back from rc.44 to rc.43 is safe while ubu1 is on rc.41.

## How each laptop gets it
- **mbp-1** (on rc.43): poe hand-installs it after Mario's close (the rc.43 guard), as rc.43 was (`git archive`
  of the tag into the install root's `v2.0.0-rc.44`, `pnpm install --frozen-lockfile` there, `current` pointed at
  it, restart). Once mbp-1 has its `upgrade:` section, `upgrade_supervisor {tag: "v2.0.0-rc.44"}` does the same.
- **ubu1** (on rc.41): stays until Casper's A-2 (casper.md). A-2 could install rc.44 directly instead of rc.42/43:
  rc42-ubu1-install.md with `TAG=v2.0.0-rc.44` in steps 2-3, and step 4 then expects `ok: 2.0.0-rc.44`.
- **Check**: `supervisor@mbp-1` reports 2.0.0-rc.44 in `list_peers`. Supervisor tests at the tag: 508.

## Broker
Unchanged from rc43-notes.md: BOB-80, BOB-71 (and BOB-96) deploy once both laptops run rc.42 or later (rc.43 for
BOB-71 AC 4), so that waits on A-2. After that, BOB-69 AC 6 and BOB-71 AC 4.
