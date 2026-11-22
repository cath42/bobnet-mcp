# BOB-49 review B (Toad): build B as landed

**Reviewed:** origin/v2 `6f8af40..d07137e`:

- 861cd06: the supervisor and the MCP surface (BOB-151, BOB-152);
- 6477916: the dashboard (BOB-153);
- e2f434f: review A's M2, m1, m2 and the supervisor's must-haves;
- d07137e: the shots.

I also checked that 9a25376 (review A's B1 and M1) landed as asked. I checked all of it against
ADR 0011 (with §6), `architecture/bob49/build-brief.md` part B, the must-haves in `review-A.md` and
`design/BOB-49/spec.md` (shots in `design/BOB-49/shots-build/`). Luigi's handoff is `w_b9b546cf`.
Line numbers are at d07137e. At d07137e, `pnpm -r typecheck` and `pnpm -r test` pass on my worktree
(protocol 151, client 38, broker 206 + UI 105, supervisor 579). My rulings are recorded in ADR 0011 §7.

## Verdict

**Signed off for the broker deploy and the supervisor rc.** There are no blockers and no majors.

- The two minors below need no code. They are about order and about what to expect once it is live.
- Deploy the broker first, then roll the rc to mbp-1 and ubu1. The order is a preference, not a
  requirement (see "Compatibility").
- poe should roll the rc soon after the deploy, because of m1.

**DoD line:** `Toad signed off: review B, architecture/bob49/review-B.md (d07137e; A as amended by 9a25376)`.

## Review A's items, checked

| Item | Where | State |
|---|---|---|
| B1 json_each | 9a25376, `store.ts` flagStale cleanup; test with 120 waits | Done |
| M1 composite key | 9a25376, `schema.ts` migration 7; a fix crossing projects is refused | Done, before migration 7 shipped |
| M2 export | `export.ts:288-302`, import `:676-691`, `board-export.ts:155-159, 234-236` | Done. Both are optional arrays with refs and `repo@sha`. The round-trip test has a released fix, a never-pushed tag, and the `items` release event, and the bug is still non-blocking after import. |
| m1 day restarts | `store.ts:2615` | Done. One `items` event per open bug. |
| m2 stale text | `store.ts:2385-2387` | Done. It is §6.9's text, word for word. |
| m3 dashboards re-read | `app.js:3107` | Done, hourly (ruling 5 below) |
| Must-have: fixes fit the schema | `supervisor.ts:3905-3920` | Done. Full shas (`%H`, checked against 40 hex), the subject clipped to 200, at most 20. The test sends a 300-character subject and 25 refs, and the result passes `BoardOp`. |
| Must-have: one spelling of repo | `supervisor.ts:3426-3442` | Done. The upgrade's repo is matched case-blind against the service project's remote, and the release tag is sent with the project's own `repoName`, the one `reportPush` uses. The test lands, then upgrades on that tip. |

## Part B against the brief

- **Trailer read** (`supervisor.ts:3905`, called from `reportPush` with `tipBefore`).
  - It runs §1's `git log` over `tipBefore..HEAD`, or `-1 HEAD` with no target.
  - Only the `Fixes` key counts. Values may be comma separated or the key repeated, and each ref is
    upper-cased and parsed with `ItemRef`. A commit's repeated ref is deduplicated.
  - The brief's four tests are there: `Fixes: BOB-27` beside `Co-Authored-By:`, `BOB-27, BOB-30`,
    every commit of a multi-commit land, and none for `v2: BOB-122: plan`.
  - `%(trailers:key=…,valueonly,separator=…)` needs git 2.22 or later. macOS and Ubuntu 22.04+
    have it.
- **release_tag** (`upgrade.ts:275-281, 488-494`).
  - It uses the commit `verify` resolved (`refs/tags/<tag>^{commit}`, `upgrade.ts:262`), so an
    annotated tag still matches the push's sha.
  - It is sent after the build and check, before the restart, through the outbox with `ctx: null`.
    The upgrade's drain flushes it before the exit, and if it doesn't, the outbox survives the
    restart.
  - A failure only logs, and the upgrade goes on.
  - It is sent only for a repo that one of the supervisor's service projects has. That set is the
    one it registers as `serves` (`supervisor.ts:673`), which the broker checks
    (`store.ts:2583-2586`).
  - The broker ignores a second report of the same `(repo, tag)` from the other laptop
    (`store.ts:2589`), so mbp-1 and ubu1 both upgrading is harmless.
- **board_notice** (`supervisor.ts:1423-1449`).
  - It is parsed with `BoardNoticeEvent`, and only from `BobNet@board` (`fromBoard`, `:1352`).
  - It is dropped for a project not run here, and recorded once per id before anything is sent
    (`beginBoardNotice`).
  - It goes to the laptop's orchestrator and the project's own orchestrator, skipping one that is in
    `to`. This is as ADR 0009 §4 does for answers.
- **Router** (`router.ts:71-77`). A lead on a service board gets §5's text word for word, and
  otherwise today's. Both are tested (`lead.test.ts`).
- **MCP surface** (`board-tools.ts:33, 129-130, 141-142`; `worker-tools.ts:62-63`). The `keep` and
  `withdraw` ops are in `WRITES` and so in `z.enum` as well, and `board_ask` and `land` carry the
  brief's sentences. Tested in the client tool list and in `board-service.test.ts`.
- **Dashboard** (`app.js:1272, 1602-1617, 1653-1677, 1690-1696, 2039-2042`; `style.css`). It
  matches spec (a) and (b):
  - the badge `bug · fix landed` in `--ok`, and the `.fix` line with sha7, its subject as the title,
    and the three release cases;
  - `waits on <PO|lead|its PO> to close it`;
  - a stale span in three cases, in `--warn`, with ticking `ago()`;
  - a kept span, never shown together with a stale one;
  - ` · unchanged <age>` on Needs you;
  - the withdrawn-form toast.

  For (c) nothing changes. The shots at 390 and 1440 read as the spec, and all three fields are
  optional, so an old broker's rows read as they did.

## Luigi's divergences (handoff `w_b9b546cf`, Decisions)

| # | Divergence | Ruling |
|---|---|---|
| 1 | A forwarded `board_notice` ends with ` (Sent to <to>.)` | **Accepted** (§7.1). The orchestrator learns who already has it, so it doesn't send it again. The board's own text is unchanged. |
| 2 | `release_tag` is sent only for a repo that a service project here has, and a tag already installed isn't sent again | **Accepted** (§7.2). The broker would refuse any other repo (`serves`, `projectOfRepo`). A refusal is final `bad_frame`, so not sending is the clean form of it. A reinstall wasn't verified in this process, so it has no sha to send. Any tag that is lost is covered by the next one: push order marks everything up to it, and errs late. |
| 3 | The withdrawn toast adds "…" only past 80 characters, and stays up while it carries a draft | **Accepted from the architecture side** (§7.3). An ellipsis marks a cut, and a draft that vanishes with a timed toast is the loss the spec wanted to avoid. The wording is Daisy's: she may overrule it in her spec without a code question from me. |
| 4 | Status's `needLine` uses the fixed badge, and says "when you have time" for a bug that doesn't block | **Accepted** (§7.4). Before BOB-49 every bug on Waits blocked, so `kind === "bug"` stood for "blocks use". `blocking` is now the truth, as on Waits (`app.js:2042`). |
| 5 | m3 is an hourly timer, not a broker broadcast | **Accepted** (§7.5). A row goes stale with no write on the board, and a flag is written by the alarm. The alarm is hourly, so an hourly re-read adds at most one hour, and the ages tick in between. A broadcast would mean a `changed` with no change in it, for each project with a flag, every hour. If Casper finds an hour too slow, the timer is what to shorten. |

## Findings

No blockers and no majors.

**m1. Until the rc is live, no supervisor worker can call `keep` or `withdraw`.** This corrects
review A, which said they "reach workers through the existing `board_write` path as soon as the
broker is deployed". They don't.
- The live rc's client checks every op against its own `WRITES` enum and its own `BoardOp`
  (`board-tools.ts:40-46`). Neither had `keep` or `withdraw` before f983ff4. So a worker told
  "keep it (board_write keep, with why)" by a stale notice gets `bad_arguments`.
- Until then it can still edit, answer, move or archive the row. Each of those clears the flag too.
- **No code change.** poe rolls the rc soon after the deploy. poe's warning to the POs and leads
  about the first-alarm burst (review A, "Migration") should say that `keep` and `withdraw` arrive
  with the rc.

**m2. BOB-49's own rc gets no `release_tag`.**
- An upgrade is reported by the supervisor that runs it, and the rc that carries build B is
  installed by an older one. The first tag the board learns is the rc after it.
- No `Fixes:` commit is reported before build B's rc is live, so no fix is mislabelled.
- AC1's evidence is the test with BOB-27's case (`board-service.test.ts`, land then upgrade; and the
  broker's own tests). A live "in \<release\>" can be seen only from the next rc on.
- **No code change.** Peach should know this before looking for it live.

**Note (no action).** `released` is called after the build and check but before the switch. If the
switch then fails, the tag has been reported while this laptop still runs the old release. That is
right: "in \<release\>" means the fix is in the verified tag on origin, not that a given laptop runs
it.

## Compatibility (the deploy and the rc, either way round)

| Supervisor × broker | What happens |
|---|---|
| **Old (live rc) × new broker** | As review A found: a `board_notice` fails `RemoteEvent` and is dropped with a warning, once per notice (`supervisor.ts:1356-1363` at the old rc). There are no `fixes` and no `release_tag`, so m1 and m2's broker paths never run. The export gains two optional arrays, which an older importer would strip (it is the broker's own). The dashboard reads fields the board now sends. Workers can't `keep` or `withdraw` (m1). Nothing that works today breaks. |
| **New × new broker** | `push.fixes` fits `protocol/src/board.ts:439` by construction, and the test parses the op with `BoardOp`. `release_tag` passes `serves` and is idempotent. A `board_notice` parses, is deduplicated and is forwarded. `keep` and `withdraw` pass the client and the board. |
| **New × broker without A** (only if the rc goes before any BOB-49 deploy) | The old `push` schema strips `fixes`, and the push and its CI tie are kept. `release_tag` is an unknown op, refused as `bad_frame`, final and audited (BOB-27), and the upgrade goes on. No `board_notice` arrives. A `keep` or `withdraw` from a worker gets the broker's error. Harmless, so the order is a preference. |

**Order:** the broker deploy, then the rc on mbp-1 and ubu1 (`upgrade_supervisor`, poe). ubu1 reports
tags only if it serves a project whose remote is BobNet's. If it doesn't, mbp-1 reports them, and
either way the second report is a no-op.

## Live

- **Broker deploy:** BOB-49 A and the broker half of B (m1, m2, export, dashboard). Migration 7 is
  unchanged since review A's safety check, apart from M1's key, which is part of that check.
- **Supervisor rc and a restart of mbp-1 and ubu1:** the trailer read, `release_tag`,
  `board_notice` forwarding, the router text, and the new tool descriptions and ops.
- **After the build (BOB-154, Mario and poe):**
  - the lead prompt lines;
  - the `Fixes:` convention in each project's commit rules;
  - `board_grants`'s `questions` check;
  - AC3's live evidence.
