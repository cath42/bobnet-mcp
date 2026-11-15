# Plan (Mario)

Updated 2026-11-15 02:50Z. Live: broker at v2.0.0-rc.29 (v2 e12cdc8, version 41cbc1dc, live
02:33:23Z); mbp-1's supervisor on rc.29 since 02:34:28Z (pid 36994); ubu1 on rc.29.

## After the rc.29 restart: checks (sent to poe)
- (a) versions: FAIL. Every peer has `client: null`: all registered with the old broker code.
- (b) reports: the first two failed (02:34:28Z, 02:34:31Z) with the old broker's schema error:
  `cost_usd` was required until 42a7924 (Nov 14), and rc.29 doesn't send it. The new version went
  live 02:33:23Z; mbp-1 reconnected 64 s later and was served by the old code. Nothing has failed
  since. The live code is new (peers carry the `client` key). The snapshot validates against
  rc.29's ReportFrame (checked offline on a copy of supervisor.db). No code bug, no redeploy, no
  release. The pin is NOT in effect yet: laptop_supervisors came with 2460707 (Nov 14), so the old
  code's registration didn't write it.
- (c) stale land: PASS ("rebased first", e221738..7ee3adf).
- (d) consumed_by: PASS for spawn delivery. m_0e7fbbf0 was delivered again (the rc.28 mid-turn gap).
  Its fix e221738 is on v2, for rc.30.
- Fully deployed needs each laptop to re-register with the new broker: restart mbp-1's supervisor
  (poe) and ubu1's (poe@ubu1). poe's own sessions too. Then (a) shows versions and (b) pins.

## Running
- Toad (w_39a3303d): done, d64d65b (architecture/reviews/2026-11-14-backlog-import-review.md).
- Peach (w_bf298cca): done, 9e6c4d1 (product/requirements/migration.md "Import answers").
- Luigi (w_92cfd796): done, f34a0f2 (§7 service side) and 6724d0e (#12 test); no migrations.
- Toad (w_e78313f8): signed off f34a0f2 and 6724d0e (architecture/reviews/2026-11-14-bob5-service-review.md, e975ccf).
- Luigi (w_8ca50011): item 0 below.

## Next, in order
0. Luigi, after §7, before BOB-14: Toad's import review findings 1 (--post exits 0 on a refused
   import) and 2 (a --grants file, BOB-14 #7; Mario@mbp-1's '*' read row gets in from a laptop only
   into an empty board, else Casper adds it as owner). Findings 3-9 before BOB-9 or later.
   With it, the import appends each item's references to its notes as a "References:"
   list (Peach, product/requirements/migration.md "Import answers"; BOB-14 #6). Helix's answers
   wait on Picard and may add more.
   Also the supervisor: a message injected mid-turn never gets inbox consumed_by, so it reaches
   the role's next worker again (poe's check 3 after rc.28; worker.ts taken()). Told poe.
0b. Luigi, before BOB-14 or the dashboard answer UI: the bob5 review's R1 (an optional operation
   key on writes, board migration 2 op_keys, the connection resends a keyed write), its finding 2,
   R2 (record_answer messages the lead and the asker, not the recorder). Finding 3 (receivers
   recognise BobNet@board) before dashboard answers go live. Finding 1 rides with item 0.
1. BOB-2: close_release and undo; step 4 view data; CI (POST /v1/runs, the gh adapter).
2. BOB-14, the pilot: broker deploy (Casper), `--post`, then `board: service` in bobnet's config.
3. BOB-9, Helix, at Picard's date.

## Waiting on Casper
- The next broker deploy: Board migration 2 once 0b lands.
- Task ids on import: flat renumbering with the old id as an alias, or dotted ids kept. Mario
  leans dotted; Toad recommends dotted for imported ids, LAND-n for new ones, ItemRef widened
  additively (the review's "If Casper picks dotted ids" section). If dotted: Toad amends ADR 0001 §2 and ItemRef, Luigi changes store and import
  before BOB-9.
