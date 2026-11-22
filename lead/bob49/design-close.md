# BOB-49 design A: close (Mario, 2026-11-22)

need: none. Daisy's change is small (row wording only, no layout), so no prototype and no Casper verdict.

## What landed
- Daisy (w_f882ccd3), d786d6f: `design/BOB-49/spec.md`. A bug whose fix landed moves to "When you have time"
  ("bug · fix landed", "Fix landed <sha>, in <release> · waits on <PO> to close it"); a stale row gets a warn meta
  ("Unchanged for 2d 3h, <owner> asked to check it 40m ago"); a lead's board_ask needs no change.
- Toad (w_215918ba), bb3a095: ADR 0011 `architecture/decisions/0011-waits-never-stale.md` and
  `architecture/bob49/build-brief.md`. `Fixes: <REF>` trailer read by the supervisor at land (`push.fixes`);
  `release_tag` op after an upgrade fills "in <release>"; a Waits row unchanged a day on its own record is
  flagged to its owner (asker, else PO, else lead) once a day by the broker's alarm; `keep` / `withdraw` clear it;
  the router's lead text points leads at board_ask. Broker migration (8, or 7 before BOB-6), a deploy, and an rc.
- Peach (w_9bd82f38): build A BOB-146..150 (broker), build B BOB-151..153 (supervisor, MCP, dashboard), BOB-154 (AC3 live, Fixes: convention; Mario + poe). BOB-34, BOB-45 archived as superseded.

## Next
Build A (Luigi), Toad review, broker deploy; build B, review, rc for poe; lead lines; Peach accepts.
