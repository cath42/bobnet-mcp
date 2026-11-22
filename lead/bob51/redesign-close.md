# Mario handoff: BOB-51 redesign session — closed

## Task
BOB-51 design "redesign": gather Casper's dashboard feedback, have Peach turn it into a redesign feature, and settle BOB-51.

## Done
- Casper's feedback is complete (3 messages): lead/bob51/casper-dashboard-feedback.md, landed 03a43a9. His last: "I'd also like a full prototype not just anything you believe are changes", so the prototype covers every view.
- Peach (w_deca80dc): the redesign is **BOB-121** (Ready, the reused "Dashboard revamp"): 17 AC + 3 DoD, with a full prototype of every view as a gate before build. Plan: design (Daisy, the full prototype; Toad, the usage weighting rule and the project page's data), then build, then review. BOB-162 and BOB-163 are its tasks; BOB-161 isn't in it. AC7 "Status works" closes BOB-33. Sessions is dropped as a tab.
  It sits first among the unreleased features. Whether it goes before R3 is Casper's call (release order is his gate).
- BOB-51 is Done on build A (BOB-29 and BOB-32 Done). Its dashboard half is BOB-121 AC14-16. AC3's live timing is chore BOB-164.
- Spawned Peach (sonnet/low) to close BOB-48 and BOB-26 against rc.53, as poe asked.

## Files changed
lead/bob51/casper-dashboard-feedback.md

## Open
- BOB-121's place relative to R3: Casper's call.

## Next
A new session: BOB-121 design A. Daisy builds the full prototype of every view, deployed per prototype_deploy_cloudflare, and Toad works out the usage weighting and the project page's data. Then one board_ask with the link for Casper's verdict.
