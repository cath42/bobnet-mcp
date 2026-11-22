# BOB-44 accept: live evidence for the last open criteria (Mario, 2026-11-22)

Session: BOB-44 review "accept". Nothing built. Sources: mbp-1's supervisor db (`~/.local/state/bobnet/supervisor.db`,
read-only), `wrangler deployments list` (read-only), handoffs, v2 history.

## Facts

- **Laptops.** ubu1 took its first remote upgrade on 2026-11-21T23:10:36Z: `upgrade_supervisor` from mbp-1, rc.44 to
  rc.46, req m_0643eec7, stages installed, restarting, ready (table `remote_upgrades`, root /home/ct/.local/share/bobnet,
  overdue_told 0). Then rc.47 (04:35Z), rc.48 (05:11Z), rc.49 (05:28Z), rc.50 (06:26Z), rc.51 (08:08Z), rc.52 (15:03Z),
  rc.53 (16:00Z), all `ready`, all on 2026-11-22. mbp-1's own: rc.46 to rc.51 (14:09Z), rc.51 to rc.53 (19:58Z).
  53 `remote:upgrade` audit rows on mbp-1. Today both run rc.53.
- **Broker deploys** (wrangler): 2a36f1e6 (2026-11-21T02:35Z, F1(a), the narrowed password_assignment) and then
  nothing until **d5e4c9b6** (2026-11-22T02:25Z, from v2 067d246, handoff w_9ab3778f). By then ubu1 ran rc.46 and
  mbp-1 rc.46: laptops first, then the broker. 067d246 contains dd9279e (BOB-80), bb51add (BOB-86), 692d757
  (BOB-89, the last secrets.ts change; `git log 692d757..v2 -- packages/protocol/src/secrets.ts` is empty), b2bc9af
  (BOB-71, the laptop mark) and 511a1ce (BOB-96). Every later deploy (bf8f3ff7 ... a6e7bd2e) and today's
  **948a9364** (2026-11-22T19:55Z) carry the same secrets.ts and the mark.
- **Toad's go.** BOB-80/BOB-86: `lead/bob44/review-a-fixes-4.md:13` ("BOB-80's broker deploy: go, laptops first. The
  broker diff since bb51add is empty and findSecret is unchanged"). BOB-71: `lead/bob44/review-b.md` §"Broker deploy"
  (Toad w_232c69a8), condition both laptops on rc.42 or later, held on A-2, met as above.
- **Post-deploy checks (BOB-86 AC 4), today against the live path:** `send_message` with `DB_PASSWORD=hunter2hunter2`
  refused, "contains a credential (password_assignment)"; with `-----BEGIN PGP PRIVATE KEY BLOCK-----` refused
  "(private_key)". The refusal text is the client's (same findSecret as the broker; the broker's own refusal of these
  kinds is broker.test.ts:172). 16 KiB of `eyJ-`: protocol.test.ts:397-399 (under 50 ms), not resent live. mbp-1 has
  no `remote:state_withheld` or `remote:list_withheld` audit rows at all. Both laptops exchange: 91 remote:spawn,
  68 remote:stop, 8 remote:exit, the upgrades above.

## Per criterion

| Task | Criterion | Verdict | Evidence |
|---|---|---|---|
| BOB-83 | AC 7 rollout | met | upgrade.test.ts:1006 (install-* path choice); lead/bob44/rc42-notes.md, rc42-ubu1-install.md; Casper did A-2 (done 2026-11-21T16:55Z): ubu1 hand install, `upgrade:` + grant; first remote upgrade m_0643eec7 rc.44 to rc.46 `ready`, and eight more since |
| BOB-80 | AC 8 rollout | met | laptops on rc.46 first, then d5e4c9b6 from 067d246 (handoff w_9ab3778f), Toad's go review-a-fixes-4.md:13; BOB-71's note says which deploy carries what |
| BOB-86 | AC 4 rollout + checks | met | rides d5e4c9b6 as above (no secrets.ts change since 692d757); checks in Facts |
| BOB-78 | AC 4 corrected text | met | a-fixes.md:32 (8eb7c5e) and rc42-notes.md "Known limit until the broker carries BOB-80's findSecret" (this session's commit) |
| BOB-71 | AC 4 deploy | met but for the production screenshot | Toad's sign-off review-b.md; deploy d5e4c9b6 from 067d246 carrying b2bc9af and 511a1ce, live since, still in 948a9364. No agent can screenshot production (Cloudflare Access); Daisy's check of the same code, design/BOB-44/laptop-mark-check.md, shots bob44-*-{390,1440}.png. Casper accepts features on review evidence, not by hand. |
| BOB-69 | AC 6 real-broker §4 check | met but for the ubu1 audit rows | poe's run below |

BOB-69 AC 6 needs poe as orchestrator (a lead's tools refuse remote requests, BOB-69 AC 4) and the bob44-probe rule on
ubu1. Asked poe (m_c38b8f51). poe's run, 2026-11-22 (m_df7a1a9f): the rule is on ubu1. athletic/reviewer w_26edf1cb on
ubu1 (spawn_req m_c337cff0) ran `echo bob44-probe` twice. r_f9f61d17 (21:28:05Z) showed in poe@mbp-1's pending_requests
with laptop ubu1, tier orchestrator, rule bob44-probe; allowed (note_delivered true), the echo ran. r_5c1632e7
(21:28:30Z) same shape; denied, the worker reported it denied. mbp-1's remote_asks has both answered (21:28:28Z allow,
21:28:47Z deny, decided_by orchestrator) and pending_requests was empty after: `settled` cleared both copies. remote:exit
for w_26edf1cb, done, 21:28:56Z. There is no poe@ubu1 any more, so nothing could reach it. Not read: the two
`remote:answer` rows in ubu1's own audit (no remote op reads ubu1's audit); the target accepted both answers, and its
audit of the answer op is BOB-67's tested behaviour. The question kind stays FakeNetwork-only, as the criterion says.
