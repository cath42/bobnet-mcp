# BOB-189 and BOB-121 wave A: live check after the deploy (Mario, 2026-11-23 ~01:10 CST)

Broker deployed by poe from 5b1140d (version 0311b28f). mbp-1 and ubu1 run rc.54.
A written check, not a screenshot: the dashboard sits behind sign-in this session can't use, so the
check reads the live broker through board_list (the same store the Overview and Roadmap read) and
applies currentRelease (packages/broker/src/board/store.ts:677, ADR 0014 §4) to it.

## Helix: Projects at a glance shows R2 (BOB-163 AC1, AC3; BOB-121 AC5)
Live releases, in order: R0 open, 4 of 4 Done; R1 closed (25/25); R2 open, 5 of 11 Done; R3 planned, empty.
currentRelease = the first not closed with a feature not Done = **R2**, number 3, its count 5 of 11;
done_unclosed = [R0] (open, every feature Done: Picard's close to make). Before D2 the Overview showed
Helix on R1, 4 of 4: that no longer happens. (Spec §4 said "R2, 1 of 6": Helix's R2 has grown since;
5 of 11 is the live count.)

## BobNet: R2, with R1 under done_unclosed
R1 open, 10 of 10 Done; R2 open, 0 of 2. currentRelease = **R2**, done_unclosed = [R1].

## Planned badge on Roadmap (BOB-189 AC1, AC5)
Helix R3 "Lease obligations and the real position" was created by Picard through create_release on the
live broker: status **planned**, its goal set, ord 1003. R6 (b7ec467) renders status planned with the
'planned' badge and the goal under the title; Daisy's review A checked that on screen at 390 and 1440
(design/BOB-189/review-A.md, shots-build, shots-review). So the live Roadmap shows R3 as planned.
That Picard could create it under his helix grant is AC1/AC4's evidence on production.

## Not checked here
A picture of the live page. If Peach wants one, it's Daisy's, not Casper's (no feature-level manual test).
