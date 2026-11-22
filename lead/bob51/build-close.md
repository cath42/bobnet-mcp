# BOB-51 build A and review A: close (Mario, 2026-11-22)

need: none for these sessions. Build B (task 7, the dashboard) waits on Q-12, the prototype verdict.

## Build A (Luigi w_c0d83294), b7e906f..cb0a086
Brief tasks 1-6: protocol (`ask`, `decided`, `note_delivered`, optional), the whole ask (`askOf`, `clip`, 128 KiB
budget, never a credential), `requests.via` and `decided` on the report, the note as the agent's next message on all
three paths, `notes.test.ts` (both ends real), the `fitReport` size guard, and the broker's `note_delivered` relay.
Test names per AC: Luigi's handoff `/Users/ct/.local/state/bobnet/handoffs/bobnet/w_c0d83294.md`.

## Review A (Toad w_62017d21), 56fe63d: `architecture/bob51/review-A.md`
Signed off for the broker deploy and the rc. No blockers or majors; all seven of Luigi's divergences accepted (fitReport
and `<who>` = remote_by@laptop recorded in ADR 0013). Minors: (1) `askOf` checks clipped fields, so a credential cut at
the clip can cross as a prefix (BOB-162, into build B); (2) a ruling for build B's toast (ok:false shows the error;
absent note_delivered means not delivered only on ok:true). For the live AC3 check: see whether the note arrives right
after the tool result or only at the end of the turn.

## Release
v2.0.0-rc.53 (0d2071e, tag pushed), for poe to roll to mbp-1 and ubu1 in place of rc.52. Broker deploy in poe's window
(after Bob's LAND-45 close), before the mbp-1 restart.
