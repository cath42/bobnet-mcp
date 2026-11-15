# Plan (Mario)

Updated 2026-11-15 ~03:00Z. Live: broker at v2.0.0-rc.29 (v2 e12cdc8, version 41cbc1dc, live
02:33:23Z); mbp-1's supervisor on rc.29 since 02:42:28Z (pid 48318); ubu1 on rc.29.

## Fully deployed: YES (sent to poe, m_9aa3f32c)
- After poe's re-registration restart (02:42Z): every supervisor peer on both laptops carries
  client @bobnet/supervisor 2.0.0-rc.29; no "could not report" since 02:42:28Z; the pin is written
  on each supervisor register by the new code (inferred, the DO table isn't readable from here).
- poe's channel clients show client null: they run the rc.19 client (BOB-16 shipped in rc.29).
  Expected, not a blocker. Moving poe's MCP entry to rc.29's client is Casper's config, via poe.
- Hold lifted by poe (m_0917c4c4, ~02:45Z). Post-deploy work spawned (see Running).

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
- Luigi (w_07934845): done, 5b6717e (0b: R1 op keys + Board migration 2, finding 2, R2, finding 3).
  Open: the dashboard answer UI must make one key per answer, done mark or undo (Daisy/Luigi then).
  Rollout: broker deploy BEFORE rc.31 (an old broker strips `key`, so no idempotency).
- Toad (w_289cf060): signed off 5b6717e, nothing to fix (architecture/reviews/2026-11-14-bob5-followups-review.md, 94cb5b9).
  HARD rollout order (ADR 0001 §12): broker deploy with Board migration 2 FIRST, then rc.31 (supervisor
  and any rc.31 channel client). Against the old broker the new client resends unkeyed writes, so a
  lost reply doubles a create/ask/close. rc.30 against the new broker is safe. rc.31's notes must say
  "needs the broker with Board migration 2". writeOnce is atomic (inside the write's transactionSync).
  Peach told to accept BOB-5.
- 02:58:13Z: transient broker socket drop (1006), reconnected 7 s later; not a deploy or restart.
- Luigi (w_7735afa0): done, a720d5f (0c: dotted ids, Toad's notes 1-2, import findings 3-6 and 9).
  Finding 5: Peach confirmed BLOCKS (19fdde9); Helix's R1 is Picard's to fix or confirm. Finding 7 waits on Picard.
- Peach (w_48c8180e): 0b accepted as follow-up, NOT BOB-5: BOB-5 stays Ready (#1-#3 lists/groups/
  Needed-before, #4's answer UI with Undo + one key per answer, #5 allow/deny, #6 counts, phone shots).
- Luigi (w_2bb286e8): BOB-2 rest: (a) close_release + undo, (b) step 4 view data, (c) CI runs.
  The broker deploy is pinned to the 0c commit Toad signs off; BOB-2 lands don't ride it.
- Toad (w_17300a34): signed off a720d5f (architecture/reviews/2026-11-14-dotted-ids-review.md, 167c07a).
  Deploy-ready: e12cdc8 -> a720d5f broker/protocol src is only 0b + 0c (Board migration 2, op key,
  told, widened ItemRef); no Broker migrations, no new DO class.
- rc.31: tagged 15ea0a3 (= a720d5f + docs + versions), installed at ~/.local/share/bobnet/v2.0.0-rc.31.
  NOT announced to poe until the broker deploy is checked.
- Broker DEPLOYED on Casper's go, 03:18:03Z, from the v2.0.0-rc.31 tree (15ea0a3): Current Version
  ID 58701295-2bcc-466b-a9fb-855158081b44. Last time the new code served ~20 min after deploy, so
  check (1) waits until the supervisors have reconnected onto it.
  Check (2) PASS: Casper read /v1/board/export as owner, version 1 (03:2xZ): migration 2 ran.
  Check (1) pending: no supervisor reconnect since the deploy as of 03:20:43Z (old sockets, old code).
  After the deploy: (1) every supervisor peer on both laptops reconnects, no "could not report"
  (re-check after a couple of minutes); (2) GET /v1/board/export as the owner answers 200, version 1
  (runs migration 2); (3) wrangler version id into this plan. Then poe: rc.31 on both supervisors.
  BOB-14 then: Peach's --grants (product/bobnet-grants.json), no --questions (lead/questions.md
  doesn't exist), dry run at the commit posted, then --post.
- rc.30: tagged bd96a94, installed, poe told (m_25706d01). Supervisor only (e221738, b31489a).
- Toad (w_1b639410): done, 6c52056: all four signed off. Later notes: Luigi (1) --post fetch
  throw/timeout says "it may have taken the import; post again, a 409 means it did", before
  BOB-9's post; (2) PeerAddress from address.ts's SEGMENT with the next board.ts change.
  Daisy: `told` is who it was sent to, so the toast says "sent to", not "heard by".
- Toad (w_d0f0ee00): done, 73a6794 (ADR 0001 amended: §2, §8, §11; Luigi's list in "Dotted ids:
  what Luigi changes"). Protocol widening left to Luigi: it ships in one commit with the import.
- Peach (w_61f02f37, w_454eff2a): done, 3d9dfea + 1555dbd (product/bobnet-grants.json; Mario and
  Peach hold `sessions`; dotted ids in product/requirements/migration.md).
- Luigi (w_07934845): item 0b (R1 op keys + Board migration 2, finding 2, R2; finding 3 if small).
- Toad (w_39a3303d): done, d64d65b (architecture/reviews/2026-11-14-backlog-import-review.md).
- Peach (w_bf298cca): done, 9e6c4d1 (product/requirements/migration.md "Import answers").
- Luigi (w_92cfd796): done, f34a0f2 (§7 service side) and 6724d0e (#12 test); no migrations.
- Toad (w_e78313f8): signed off f34a0f2 and 6724d0e (architecture/reviews/2026-11-14-bob5-service-review.md, e975ccf).
- Luigi (w_8ca50011): item 0 below.

## Next, in order
Order decided 2026-11-15 (Mario): BOB-14 does NOT post until dotted ids are live, so BOB-1.1 stays
dotted (Casper's choice; a posted project can't be imported again). 0b and dotted ids both need a
broker deploy: one deploy (Casper's call) + rc.31 carry both, then BOB-14 posts.
0c. Luigi, right after 0b: dotted ids, one commit, per ADR 0001 "Dotted ids: what Luigi changes"
   (1-4), with Toad's later notes (--post timeout wording; PeerAddress from SEGMENT). Findings 3-6
   and 9 of the import review before BOB-9. Toad reviews 0b and 0c.
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

## Decided by Casper
- 2026-11-15: no one besides the owner gets `admin` on a board. product/bobnet-grants.json already
  gives none; no change.
- 2026-11-15: imported task ids keep their dotted form. Next: Toad amends ADR 0001 §2 and ItemRef
  (after w_1b639410's review), then Luigi changes store and import, before BOB-9. Peach records it.
