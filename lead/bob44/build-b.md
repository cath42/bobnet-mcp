# BOB-44 build B (Mario, w_621e3c65, 2026-11-21)

Session `BOB-44 build B`. Input: build-cut.md (B1-B6), review-a-fixes-4.md, rc42-notes.md. mbp-1 runs rc.42 since
2026-11-21 13:33:23Z; ubu1 is on rc.41 until Casper's hand install (rc42-ubu1-install.md).

## The cut

Build B is the seven `build-B` tasks: BOB-66, 67, 68, 69, 70, 71, 75 (B1-B7). That is Casper's ~7 (2026-11-16), so
BOB-91 does not ride here.

**Build C (`a-fixes-5`), after review B:** BOB-91 (A-fixes-4 major M1: upgrade.repo in the guard's roots, archive
pinned to the SHA) and the minors BOB-92 (local upgrade race), BOB-93 (restart mid-install), BOB-94 (substring guard),
BOB-95 (upgrade robustness). All five are the supervisor's upgrade path and its guard: one package, one review.
BOB-91's risk is covered for now: rc.42's notes put the clone at <root>/.src.git, under the guard, and no laptop
has an `upgrade:` section yet (Casper's step 6). C must ship before Casper turns `upgrade:` on with a clone outside
<root>; I say so when he does.

## Order (one Luigi worktree, sequential; a task lands alone, one commit each)

| Worker | Tasks | Side | Why together |
|---|---|---|---|
| L1 | BOB-66 (B1) | target + requester | the lifecycle events and `remote_asks`; everything after reads them |
| L2 | BOB-67, BOB-68 (B2, B3) | target | the `request`/`answer` ops and the one answerer are one auth path |
| L3 | BOB-69, BOB-75 (B4, B7) | requester | request tools with remote ids; unacked spawns in the same outbox/reconcile code |
| L4 | BOB-70, BOB-71 (B5, B6) | protocol, broker, dashboard | the data, then the mark (design/BOB-44/laptop-mark.md) |

## Field steps after the build (not code)

- A release (rc.43) with build B. From rc.42 I stop at tag + push; poe rolls it with `upgrade_supervisor`
  (mbp-1 needs Casper's `upgrade:` section first; until then poe/Casper install by hand).
- BOB-69's build B acceptance (the §4 check on the real broker) needs ubu1 on that release and the `bob44-probe`
  rule on ubu1 (Casper's config).
- Broker deploys, laptops first: BOB-80 (findSecret wider) once ubu1 runs rc.42; BOB-71's dashboard once the
  release with B5 runs on both laptops. Window from poe; I deploy (Casper's deploy rule, 2026-11-16).

## Log

- 13:36Z L1 Luigi w_df97ddb7 on BOB-66. Peach w_b34391e8: BOB-66 In Progress; BOB-92..95 into a-fixes-5 with BOB-91;
  BOB-71 note and AC 4 wording (Mario deploys in poe's window).
- Daisy (consult c_bf90b74c): BOB-71's cross-project question needs no spec change: mixed-project lists follow each
  line's own project's rule (laptop-mark.md line 65, 0f8a182).
- 13:43Z BOB-66 landed b289bfe (Luigi w_df97ddb7; 17 tests, requests.test.ts). Read: matches §4. For Toad in review B:
  a shutdown leaves waiting requests open (so the next start orphans and resume still works), a stop settles them;
  field names (`request` not `id`; `resumed` {worker: new, previous}). **No release between B1 and B4**: a v: 2
  worker's request goes only to remote_asks until B2/B4 let poe see and answer it.
- 13:45Z L2 Luigi w_8af6163d on BOB-67, BOB-68.
- 13:55Z BOB-67 landed 8cf77a7, BOB-68 7a166f8 (Luigi w_8af6163d). Read the BOB-67 diff: ownRequest checks the
  worker before the entry (no existence leak), entry read from the config at the last start (no reload), answer goes
  through the local router (human tier needs user_decided, which the remote orchestrator asserts as a local one does).
  For Toad in review B: those three, and that the `request` reply carries the full RequestRow (input) through
  withholdBody.
- 13:57Z L3 Luigi w_0720a815 on BOB-69, BOB-75. Peach: accept BOB-66..68, BOB-69/75 In Progress.
- 14:2xZ BOB-69 landed 0f738c7, BOB-75 674cc6c (Luigi w_0720a815; suites 481 + 165 + 88 green). BOB-69 renamed B2's
  `answer` reply field `worker` to `worker_id` (a string `worker` failed the requester's RemoteReply schema, so the
  reply was dropped): B2's tests didn't cover the requester parsing it. Unreleased, so nothing in the field. For
  review B: the test gap. BOB-69 AC 6 (real-broker §4 check) waits on a release on both laptops; steps in
  ~/.local/state/bobnet/handoffs/bobnet/w_0720a815.md "BOB-69 AC 6".
- L4 Luigi on BOB-70, BOB-71 (no deploy).
- 14:3xZ BOB-70 landed 8a0e9a7, BOB-71 b2bc9af (Luigi w_04603501; shots packages/broker/test-ui/shots/bob44-*).
  Build B is all on v2. Peach: BOB-66..71, 75 In Review; open: BOB-69 AC 6 (real broker), BOB-71 AC 1-2 (Daisy
  w_b42d4dac checking the shots) and AC 4 (deploy).
- rc.43: release commit 757058e landed (supervisor 482, broker 165 + 94 green), tag v2.0.0-rc.43 pushed.
  Notes: rc43-notes.md (requester mbp-1 first: an older requester ignores the `request` event). Casper: A-2 (ubu1
  rc.42 install + step 6, mbp-1 `upgrade:` section, bob44-probe rule), holds BOB-69, BOB-71.
- For review B (Toad): mixed versions (§9) for the new events; B2's tests missed the requester parsing the answer
  reply (the `worker` field, fixed in BOB-69).
