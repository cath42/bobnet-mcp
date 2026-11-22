# BOB-6: plan (Mario, 2026-11-22)

Design session A, one lead session:
1. Toad and Daisy in parallel (they may consult each other):
   - Toad: ADR 0010, how a project declares its gates and session kinds in the board service, and the start
     request to the project's supervisor over BOB-111's delivery (ADR 0009); a build brief in
     architecture/bob6/.
   - Daisy: design/BOB-6/: spec and static prototype of the Start button, the brief editor (phone first), a
     refused start, and the pending request on the feature's page. Sample data only (it goes public).
2. Peach, after both land: refines BOB-6's criteria and cuts the build into sessions of ~7 tasks or fewer
   (A, B, ...) as tasks on the board.
3. Mario deploys the prototype to Cloudflare Pages (project bobnet-prototypes, branch bob-6), then asks Casper
   one board_ask: the link, what he approves, what to watch. The verdict holds the build, not this session.
4. Close need: casper; tell poe what poe does when a start request arrives.
