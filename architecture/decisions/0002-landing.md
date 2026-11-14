# 0002. Landing: the line, the run slot, preconditions, outcomes, rebase and holds

- **Status:** accepted (Casper, 2026-11-14, lead/2026-11-14-board-adr-and-review-decisions.md, "Later the same day").
- **For:** review finding 1 (a stale tip fails late) and finding 6 (BobNet's rules live in Helix's
  ADRs), `architecture/reviews/2026-11-14-system-review.md`; BOB-11. It takes in what the review
  proposed as P6 (run slots and holds), because the code cites one source for both.
- **Replaces** every citation of Helix's ADR 0093 and 0094 in BobNet's code (table at the end).
  Helix's ADRs stay Helix's rules for Helix's repo. This ADR says what the supervisor does for any
  project.

## Context

The supervisor lands for its workers: `land` runs the project's land command in the worker's
worktree, as the worker's author, in the run slot, one attempt (`supervisor.ts:955-1047`). The rules
behind it were written for Helix, in Helix's repo: 0093 (agents land on their own branch, one
integrator moves `main`, no retry loop, flaky gets one more run) and 0094 (the supervisor lands,
holds one run slot, strips API keys). BobNet's code cites them (`supervisor.ts:108, 468, 726, 862,
957, 1001, 1041`; `slots.ts:3, 7`; `config.ts:145, 187`; `worker.ts:56`), but BobNet's own team
doesn't land that way: its land command checks and pushes the line itself (`pnpm -r typecheck &&
pnpm -r test && git push origin HEAD:refs/heads/v2`), with no integrator. And BobNet has diverged
from 0094 where it had reason to: the supervisor rebases a worker's branch at the worker's request
and after each land (`supervisor.ts:1049-1097`), which 0094 §1 forbids, and a hold no longer stops
spawns (`supervisor.ts:726`), which 0094 §2 says it does.

The gap that costs work (finding 1): nothing checks that the worker's HEAD contains the line's
current tip. A land that queued behind another runs its whole check on the old base, then the push
is refused as non-fast-forward and reported as `could not land (exit 1)`, the words of a red test,
and that HEAD is recorded as refused. It happened to this ADR's own predecessor today: ADR 0001's
land ran typecheck and every test, then was rejected at the push because Peach had landed meanwhile.

## Decision

### 1. Each project has a line, and one of two shapes of land

- **The line** is the branch a project's work lands on: `v2` for BobNet, `main` for Helix. The
  project's config names it as `remote/branch`: `rebase.onto` for the rebase tool (`config.ts:153`),
  and `land.target` for the land (§4).
- **A direct land** checks and moves the line itself: the land command runs the checks and pushes
  `HEAD` to the line as a fast-forward. BobNet's is one. Lands on one laptop are serialised by the run
  slot (§3), and the stale check (§4) makes a land that lost a race fail fast and say so.
- **An integrated land** pushes to a branch of the author's, and an integrator moves the line (Helix,
  its ADR 0093). A stale tip isn't a failure there, because the integrator replays onto the line.
- The supervisor doesn't know which shape a command has. The project's config says whether a land
  must contain the line's tip: `land.target: remote/branch` turns the tip check (§4) on, and unset
  leaves it off, as today. BobNet's project sets `land.target: origin/v2` (Casper's config). Helix's
  leaves it unset.

### 2. Who lands

- **A supervised worker** lands only through the `land` tool. The supervisor runs the project's land
  command in the worker's worktree, with the role's git author and committer, through the repo's
  hooks. The worker's own git never pushes: a project's `policy.yaml` denies `git push`, and the
  built-in guard denies `--no-verify` everywhere (`policy.ts:293`). That is defence in depth; the
  gate is the land command and the hooks.
- **While a land runs**, the worker's file tools and Bash wait for its result (`supervisor.ts:862`),
  so the tree it lands is the tree it checked.
- **The supervisor never authors or changes a worker's commits.** It doesn't amend, squash, reword,
  resolve a conflict or commit as itself. Its one write to the branch is the rebase of §6.
- **Anyone else** (an interactive agent, Casper) lands with the project's command from their own
  checkout. Those pushes don't take the supervisor's slot, so they can race a worker's land. The
  stale check is what keeps that race from costing a full check.

### 3. The run slot

- **A run** is anything that loads the laptop: a land (with its hooks), tests, a probe, a local
  database or a dev server, a build. At most `run_slots` runs hold a slot at once on a laptop,
  across every project and agent (`config.ts:188`, default 1).
- **Workers:** the supervisor holds a Bash command its policy marks as a slot run until a slot is
  free (`policy.ts`'s `slot`, the preflight). A land takes a slot for its whole command. Reading,
  editing and short commands never wait.
- **Interactive agents** are queued by their orchestrator (`take_slot`, `free_slot`;
  `supervisor.ts:468`), in the same queue. A long interactive hold is recorded and shown.
- The queue is first come, first served. The slot and its queue are in memory: a supervisor restart
  drops them, and the waiting lands fail as stopped (the restart rules are P7's).

### 4. Preconditions, in order

Each refusal names the one precondition that failed and what to do. Nothing is fixed for the worker.

1. The project has a land command.
2. **A clean tree.**
3. **Not a HEAD already refused** (§5), unless its last failure was flaky.
4. **The environment**: `land.env_command` succeeds and `land.requires_env` is set.
5. **The slot** (§3). The land waits here.
6. **The line's tip, inside the slot**, when `land.target` is set: fetch it. If HEAD doesn't contain
   its tip, rebase the branch onto it there, with §6's rebase. A clean rebase lands the rebased HEAD:
   the command runs on it. A conflict is aborted, the branch is left as it was, and the outcome is
   **stale**, without running the command.

The cheap checks come before the wait, so a land that can't run doesn't queue. The tip check comes
after it, because the line can move while the land queues, and before the command, because the
command is the expensive part. The rebase is safe there because the worker's file tools and Bash
already wait for the land (§2), and it is the same rebase the worker would ask for. A fetch that
fails (the remote can't be reached) is a refusal that names the fetch; it is not stale.

### 5. Outcomes

| Outcome | How the supervisor knows | May that HEAD land again? | What the worker does |
|---|---|---|---|
| **landed** | exit 0 | it has landed | nothing; the branch is rebased (§6) |
| **stale** | §4.6's rebase onto the line's tip conflicted, or after a failed command a fresh fetch shows the tip moved and HEAD doesn't contain it | yes: it isn't recorded as refused | after a conflict: rework its commits on the line's tip, or ask its orchestrator, then `land`; after a moved tip: `land` again, which rebases in the slot |
| **held** | the project's `held_exit` | yes, and it lands by itself after the hold: don't land again | nothing |
| **flaky** | the project's `flaky_exit` | once more, at once | land again now; a second failure is **failed** |
| **failed** | any other exit, or a timeout | no, until a new commit | fix, commit, land |
| **refused** | a precondition (§4.1-4.5) | yes, once it holds | what the refusal says |

- **Stale is known from git, never from the push's text.** After a command that was neither landed
  nor held, the supervisor fetches the line again. If its tip moved since §4.6's fetch and HEAD
  doesn't contain it, the line moved during the run, and the outcome is stale whatever the exit code
  (audit `land:stale`). A real red check that coincides with the line moving reads as stale too. Its
  full output is still returned, and it costs at most one more run: the next land rebases and runs
  the check again, and a real failure then fails as **failed**.
- **Every outcome is told** to the worker in the tool's result with the command's tail, and to the
  orchestrator with the worker's run end (one wake per worker, `supervisor.ts:1037`). The words
  differ per outcome: only **failed** says "could not land".

### 6. One attempt per HEAD, and the rebase

- **No retry loop.** The supervisor runs a land only when the worker calls `land`, and never re-runs
  one on its own. A HEAD that **failed** is refused until the branch has a new commit
  (`refusedHeads`, `supervisor.ts:998-1003, 1029-1031`). **Flaky** buys one more run of the same HEAD.
  **Stale** and **held** don't count against it.
- **Rebase never repairs.** A worker may call `rebase` at any time: the supervisor fetches the line and
  rebases the worker's branch onto it, outside the sandbox (which write-protects `.claude/`), as the
  worker's committer, with the worker's tools waiting as for a land. A conflict is aborted at once
  and the branch is left as it was, with the conflicting paths named (`supervisor.ts:1084-1092`).
  It refuses a dirty tree, a detached HEAD, and the line itself.
- **After each landed land**, the supervisor rebases the branch onto the line, so the landed commits
  drop out and the next land doesn't replay them. A failed rebase there doesn't undo the land; it
  says so (`supervisor.ts:974-981`).
- **Inside a land, the supervisor rebases onto the line's tip** when `land.target` is set and HEAD is
  behind (§4.6). It never resolves a conflict: a conflict is stale, and the worker resolves it.

### 7. Holds

- **A hold is a project's file**, named by `hold_file` (`config.ts:155`), owned by whoever the
  project says (Helix: its lead, `pnpm integrate hold`). The supervisor reads it and keeps no hold of
  its own, so there is one register (`slots.ts:1-9`). The broker keeps none either.
- **A hold stops lands, nothing else.** The land command itself answers **held** under a hold, and
  the supervisor reports it. Spawns, checks and slots go on, so a held worker can still finish its
  work and reach `land` (`supervisor.ts:726`). The hold shows with the slot on the dashboard.
- A project with no hold file has no holds.

### 8. Where BobNet's code cited Helix

| Code | Cited | Now cites |
|---|---|---|
| `supervisor.ts:108, 862` (tools wait for a land) | 0094 §1 | 0002 §2 |
| `supervisor.ts:468` (interactive slot queue) | 0094 §2 | 0002 §3 |
| `supervisor.ts:726` (a hold doesn't stop spawns) | 0093 | 0002 §7 |
| `supervisor.ts:957` (land) | 0094 §1 | 0002 §2, §4 |
| `supervisor.ts:1001` (no retry loop) | 0093 §4 | 0002 §6 |
| `supervisor.ts:1041`, `config.ts:145` (flaky) | 0093 §4 (d) | 0002 §5 |
| `slots.ts:3, 7`, `config.ts:187` (run slots, holds) | 0094 §2, 0093 | 0002 §3, §7 |
| `worker.ts:56` (subscription only) | 0094 §3 | 0004 (system shape), which takes the billing rule |

Luigi changes the citations with review chore 8. Test data that mentions Helix's ADRs as sample
text (`supervisor.test.ts`, `cutover.test.ts`, `broker.test.ts`) is data, not a citation, and stays.
`app.js:109` cites Helix's 0060 in a comment about Helix's briefs; it goes with chore 8's move of
Helix strings into config.

## Consequences

- A land that queued behind another is rebased and checked on the new tip, so it lands instead of
  failing at the push. One that conflicts costs a fetch, not a full check, and says **stale**, so
  nobody reads it as a red test and the HEAD isn't burnt.
- What lands is the rebased HEAD, not the commit the worker called `land` on. The tool's result names
  both hashes, as the rebase tool does.
- The supervisor fetches the line twice in the worst case (before the command, and after a failure).
  Both are inside the slot, so they add seconds to a land, not load.
- A race is still possible in the window between the tip check and the push, from a push outside
  the slot (an interactive agent, another laptop). §5's after-failure fetch reports it as stale, so
  it costs one check, not a refused HEAD.
- Projects keep their own land rules (Helix's 0093 and 0094 stand for Helix), and BobNet's
  supervisor no longer needs them to explain itself.
- BOB-11's tests are this ADR's: a behind HEAD rebased in the slot and landed; a conflicting one
  stale with the command never run and the HEAD landable again; a line that moves during the run
  reported as stale; the existing held and flaky tests unchanged.

## Alternatives considered

- **Refuse a behind HEAD as stale, and leave the rebase to the worker:** the worker sees its tree
  change only when it asks. Rejected: the worker's tools already wait for the land, the rebase is the
  one it would call next, and a round trip per race costs a worker turn each time. A conflict still
  goes back to the worker.
- **Classify stale by the push's output** (`[rejected]`, `non-fast-forward`): parsing a tool's text,
  which differs by git version, hook and remote. Rejected for §5's fetch.
- **Make every land a direct land by default:** Helix's integrated lands would be refused as stale
  for no reason. The stale check is per project.
- **A lock on the remote** (a ref or a lease that every lander takes): would close the race with
  pushes from outside the slot, at the cost of a second mechanism that every interactive agent and
  Casper must honour. Not worth it at one laptop per project.
- **Keep citing Helix's ADRs:** the rules would change when Helix's change, by people who aren't
  deciding for BobNet, and BobNet already diverges from them (rebase, holds). Rejected.
