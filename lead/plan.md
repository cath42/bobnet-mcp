# Plan (Mario)

Updated 2026-11-15 ~03:00Z. Live: broker at v2.0.0-rc.29 (v2 e12cdc8, version 41cbc1dc, live
02:33:23Z); mbp-1's supervisor on rc.29 since 02:42:28Z (pid 48318); ubu1 on rc.29.

## Release 1: drive to finished and deployed (Casper's standing go, 2026-11-14 22:25)
No approvals for deploys or releases; ask Casper only real product calls or failures needing his hands.
- 04:31:57Z mbp-1 supervisor on rc.32 (pid 71790). Checks PASS on mbp-1: every supervisor peer
  2.0.0-rc.32; no "could not report", no "board report can't be made; dropped" since. ubu1: poe@ubu1.
- 04:5xZ BOB-14 import POSTED at v2 6f9a14f: ok, bobnet 26 items, next_item 26; 0 unmapped, 0
  renumbered, 6 rules. product/backlog is frozen from here: nothing is written to both.
- `board: service` for bobnet staged: ~/.local/state/bobnet/handoffs/bobnet/bob14-board-service.md, sent to poe.
- After that restart: Peach does BOB-14's cut-over (AC 1 count/sample, 3 remove product/backlog +
  pointers, 4 MCP only + a builder refusal, 5, 6; 7 at the nightly backup). Peach accepts BOB-2.
- 04:39Z poe applied `board: service` for bobnet. Checks 1, 2 PASS (ready lists bobnet; no report
  errors since). Check 3: Mario's board tools answer (R1, R2; BOB-7 in full). Peach's read: w_f84edce0.
- 04:40Z spawned Peach w_f84edce0 (BOB-14 cut-over + accept BOB-2) and Luigi w_9ff16006 (BOB-7).
  board_list `progress` shows 0/0 for features with criteria: Luigi to fix if a bug.
- Peach w_f84edce0 done, 461a875: check 3 PASS (her read answered). BOB-14 cut over (product/backlog
  removed, product/BOARD.md); AC 1, 3, 4, 6 checked; AC 2, 5, 7 open (7 at the nightly backup).
  BOB-2 accepted bar AC 5 (feature progress = own ac + tasks'; Luigi in BOB-7), AC 10 (Helix-sized
  board test: Luigi after BOB-7), AC 11 (= BOB-14 AC 7).
- Luigi w_9ff16006 done, BOB-7 at 01cddfd (5c3086c progress fix + tests, gates UI on the Roadmap
  tab; shots packages/broker/test-ui/shots/bob7-*). Broker deploy needed, no release, no migration.
  Mario read the store diff: OK. Toad w_080605d6 reviews; Daisy w_1f97dcec rules on gaps 1, 2.
  Deploy after Toad's sign-off; then Peach accepts BOB-7.
- Daisy w_1f97dcec (249115d): gap 2 accepted, gap 1 with changes 1-3 (count line, muted text, shot
  retakes). Toad w_080605d6 (34ff0fd): signed off, deploy-ready; minors 1 (seq-0 Undo), 2 (resend
  with key after welcome). All five sent to Luigi as one small BOB-7 commit ahead of BOB-8; the
  BOB-7 deploy goes from that commit (one deploy, not two).
- Luigi 1cf25fb: the five follow-ups. Broker DEPLOYED (3rd) 04:59:38Z from v2 7f0b2b6 (= 1cf25fb +
  lead/): Version ID 27ea6fd5-432d-49e5-a02a-dfb813b50f83. Checks 05:05Z PASS: no report errors
  since; board_list progress counts own ac (BOB-7 0/6), so the new code serves.
- Peach w_01bfd4e5 (8ad6c9c): BOB-7 Done (AC 1-6, DoD). BOB-2 AC 5 checked (open: 10, 11).
  BOB-14 AC 5 open: no item-history view yet. For the release-1 close: Casper's live look at the
  gates and the close dialog is still wanted (not a blocker; goes in the close summary).
- 05:1xZ poe: Casper off ~8h; Helix back on. Told poe Helix can start now (views are broker-only,
  deploys don't cut agents, no restart foreseen). Bob keeps to at most 2 worker slots; Helix up to 3.
- Luigi w_6a83777e done: BOB-8 + BOB-2 AC 10 at 5c5f355 (additive ItemSummary fields; reads 3-14 ms
  under load at Helix size). Broker deploy needed, no release. Toad w_176b85c2 reviews; Daisy
  w_7cd48eba rules on gaps 2-4. BOB-10 waits for a free Bob slot (2 max while Helix runs).
- Daisy w_7cd48eba (d48b771): gaps 2-4 ruled, 3 small changes. Toad w_176b85c2 (48ac061): deploy-ready,
  wire additive and rc.32-safe; finding 1 MAJOR (dashboard capture lost on `unavailable`; fix before
  Peach accepts), 3 and 4 minor, sent to Luigi w_3c382245 with Daisy's (one follow-up commit, then
  BOB-10). Finding 2 (Triage release Undo is a blind inverse update) accepted for now; a real fix is
  a service `undo` of a release-only update. BOB-8 deploy goes from Luigi's follow-up hash.
- Luigi 0b8a185: BOB-8 follow-ups. Broker DEPLOYED (4th) 05:26:33Z from v2 b3b6672 (= 0b8a185 +
  lead/): Version ID 0acf3c27-6aa2-4bfa-9172-19a59d9ed29a. Omitted summary keys are optional in the
  protocol (rc.32-safe). Checks 05:32Z PASS: no report errors; backlog rows omit null triage keys (new code serves). Peach accepts BOB-8 when a Bob slot frees.
- Luigi w_3c382245: BOB-10 at 214304a (bug criterion "It no longer happens", Done refused until
  checked). Broker deploy + a RELEASE (client MCP tool descriptions): batch the release with the
  next one; no restart needed for release 1's views otherwise. Toad w_9453f36a reviews.
  Gap 1 (dashboard capture "found in" preset from a feature screen): Daisy, with BOB-4.
- Toad w_9453f36a (f095e38): BOB-10 deploy-ready, ADR 0001 §2 amended (bug close). Finding 1 (close_session
  description) MUST be in before the client release; 2, 5, 6 any time: all sent to Luigi (one commit).
- Broker DEPLOYED (5th) 05:37:22Z from v2 3501eb6 (= f095e38 + lead/; packages same as 214304a):
  Version ID 498a41c1-a98d-4731-9c35-b483380ff1c2. Checks ~05:43Z.
- BOB-10 deploy checks 05:43Z PASS (no report errors).
- Peach w_0d736f9e: BOB-8 Done; BOB-2 AC 10 checked (open: AC 11, DoD); BOB-10 In Review (AC 5 waits on
  rc.33's client; AC 3 on screen with BOB-5). Live look wanted from Casper: Triage on a phone, gates,
  close dialog (release-1 close summary).
- Luigi 72eeb56: Toad's BOB-10 findings 1, 2, 5, 6.
- rc.33 CUT: version commit d584f4c (on v2), tag v2.0.0-rc.33 pushed, installed at
  ~/.local/share/bobnet/v2.0.0-rc.33. Broker DEPLOYED (6th) 05:45:56Z from d584f4c: Version ID
  6671ac8d-de76-40e8-8f6d-2dc0fcde87dc. Sent to poe (m_522451f6), no hurry, at a close; check 3 is
  mine (worker tool description), then Peach ticks BOB-10 AC 5.
- Luigi w_441c4622 done: BOB-3 at 284842d (Overview tab, roadmap links + "Not in a release" counts,
  service Feature head card; additive OverviewRow.no_release; overview open/next_ready fixes).
  Broker deploy needed, no release. History (BOB-14 AC 5) not in the spec. Toad w_bd150a53 reviews;
  Daisy w_d38c1154 rules gaps 1-5 and specs history + "found in" preset for BOB-4.
- Daisy (44bf8f4): gaps ruled, 3 changes; history, found-in preset, agent detail row specced for BOB-4.
  Toad (5d615ff): BOB-3 signed off, rc.33-safe; 1, 3, 5 into the follow-up; 2 (#feature/<project>/<id>)
  with BOB-4, before BOB-9; 4 left.
- Luigi 3855419: BOB-3 follow-ups. Broker DEPLOYED (7th) 06:27:28Z from v2 8d34eef (= 3855419 + lead/):
  Version ID f17550b3-5f07-47f3-9870-70ef3bc62bbe. Checks ~06:33Z. Peach w_19fd3bfe accepts BOB-3.
- BOB-3 deploy checks 06:33Z PASS.
- ~06:35Z the usage limit stopped Luigi w_335afdd9 (BOB-4 begun, uncommitted in his worktree) and Peach
  w_19fd3bfe (BOB-3: AC 2, 4-7, DoD 1, 3, 4 checked; no handoff). Casper: "Limit hit, pls continue".
- 13:52Z resumed: Luigi w_a53c1f42 (BOB-4 from the uncommitted diff), Peach w_a2341d79 (finish BOB-3).
- Next release (rc.33): BOB-10's client MCP descriptions + Toad's finding 1. Cut once Luigi's
  fix commit lands; send poe to restart at a Bob/Helix close (no hurry: descriptions only). (+ BOB-7 gaps 3, 4; BOB-2 AC 10 Helix-sized test).
- Then the views, Luigi, one at a time (one worktree), from design/BOB-1/spec.md, in Peach's order:
  BOB-7, BOB-8, BOB-10, BOB-3, BOB-4, BOB-5. Toad reviews each; broker deploy after each review.

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
- Luigi (w_2bb286e8): done, BOB-2 rest: d824e95 (close_release + undo, set_release undo), cd8c98c
  (waits/overview reads), c0dbd0d (POST /v1/runs, CI_TOKENS secret), 8d7c1c5 (gh adapter, BROKER
  migration 8 laptop_supervisors.projects). None is in the 03:18Z deploy or rc.31: they need a
  second broker deploy (+ CI_TOKENS secret, Casper's) and rc.32 after it.
  Daisy, for the gates: the release ↑/↓ Undo is an inverse order_releases, not `undo`.
- Toad (w_b9c1997a): signed off all five (architecture/reviews/2026-11-15-bob2-rest-review.md, 708c97b);
  consults recorded in ADR 0001 §5, §6, §8, §10. Low findings 1-4 -> Luigi w_4411f00c (ride a later deploy).
- Broker DEPLOYED (2nd) on Casper's go, 04:08:40Z, from fa05243's tree: Version ID
  d5f2d7db-7936-4a34-bd4f-13739701ce52 (broker migration 8). Check 1 PASS (no drops/report errors to
  04:14:30Z). Check 2 PASS (Casper: export still version 1). rc.32 to poe (supersedes rc.31; mbp-1 still on rc.29).
- rc.32: tagged 2173995 (BOB-2 rest + 1518102), installed at ~/.local/share/bobnet/v2.0.0-rc.32,
  NOT announced. Needs broker migration 8 deployed first. Luigi's fa05243 (findings 1-4, broker + docs
  only, Mario read it OK; Toad signed it off, ef09481) makes the deploy tree fa05243, not the tag. Asked Casper for the second deploy from
  the rc.32 tag. CI_TOKENS secret NOT needed for rc.32 (gh adapter needs none); a later
  `wrangler secret put` + Access app entry is Casper's call.
  After the deploy: (1) agents reconnected/no report errors; (2) export still version 1;
  (3) after rc.32, no "board report can't be made; dropped" for ci_run in supervisor.log.
  No live CI row to check until a repo has workflows (Helix at BOB-9).
- Peach (w_a066c9e6): done, 6de7894 (board-writes.md 6, 7): a release opens automatically when its
  first session starts (system write); closing a planned release is allowed (Casper's close gate).
- Luigi (w_1e72629b): done, 1518102 (no migration): session_join opens a planned release; a start under a closed release is refused. Added to Toad w_b9c1997a's review.
- Toad (w_17300a34): signed off a720d5f (architecture/reviews/2026-11-14-dotted-ids-review.md, 167c07a).
  Deploy-ready: e12cdc8 -> a720d5f broker/protocol src is only 0b + 0c (Board migration 2, op key,
  told, widened ItemRef); no Broker migrations, no new DO class.
- rc.31: tagged 15ea0a3 (= a720d5f + docs + versions), installed at ~/.local/share/bobnet/v2.0.0-rc.31.
  NOT announced to poe until the broker deploy is checked.
- Broker DEPLOYED on Casper's go, 03:18:03Z, from the v2.0.0-rc.31 tree (15ea0a3): Current Version
  ID 58701295-2bcc-466b-a9fb-855158081b44. Last time the new code served ~20 min after deploy, so
  check (1) waits until the supervisors have reconnected onto it.
  Check (2) PASS: Casper read /v1/board/export as owner, version 1 (03:2xZ): migration 2 ran.
  Check (1) PASS (03:45Z): no "could not report" since. No reconnect happens: the Broker DO uses
  hibernatable WebSockets (broker.ts:108), which survive a code update and adopt the new code within
  the default deferred max_delay of 300 s (no code_update_strategy in wrangler.jsonc). Note for next
  time: don't wait for a socket drop after a deploy. Told poe rc.31 is ready (m_1727b2bf).
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
