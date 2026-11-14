# 0004. System shape: the parts, who owns which state, principals and trust boundaries

- **Status:** accepted (Casper, 2026-11-14, lead/2026-11-14-board-adr-and-review-decisions.md, "Later the same day").
- **For:** review findings 4 (the laptop token is the laptop's whole identity), 13 (teams scope
  presence only) and 6 (BobNet's rules in Helix's ADRs: the billing rule, ADR 0002 §8);
  `architecture/reviews/2026-11-14-system-review.md`. It is the map that ADR 0001-0003 and the
  later ones (P2 delivery, P3 versioning, P7 persistence, P8 permissions) hang from.

## Context

BobNet grew part by part, and its rules are spread over the README, code comments, Helix's ADRs and
ADR 0001. Nothing says in one place which part owns which fact, who may do what, or what BobNet
defends against. The review found the cost: a README claim that holds only with the sandbox
(`README.md:111`), a laptop token that any unsandboxed process can read and use as any name on that
laptop, and team boundaries whose meaning nobody wrote down.

## Decision

### 1. The parts and what each owns

Every fact has one owner, which holds the truth. Other parts hold copies, say so, refresh them from
the owner, and never write back.

| Part | Runs | Owns (the truth) | Holds as copies |
|---|---|---|---|
| **Worker** (`packages/broker/src/index.ts`) | Cloudflare | nothing: authenticates every request (`auth.ts`), routes to the objects, serves the dashboard | — |
| **`Broker` object** (`network`) | Cloudflare, one Durable Object | the roster (peers, names, presence), messages and deliveries, the broker audit, the owner's socket token for the socket's life (ADR 0003 §4) | each laptop's latest report (the supervisor's), legacy `project_boards` (git's, until ADR 0001 retires them) |
| **`Board` object** (ADR 0001) | Cloudflare, one Durable Object | the boards of projects on the service: records, events, grants, finished runs, CI runs, pushes | — |
| **Supervisor** | each laptop, its own SQLite | workers and their live runs, permission requests, its inbox and outbox, the supervisor audit, remote requests, enrolled owner keys (ADR 0003); in memory: run slots, consults, lands in flight | the hold file (the project's) |
| **Channel client** | each interactive session | the session's identity (name, instance) and its digest of quiet broadcasts, in memory | — |
| **Capture queue** (ADR 0001 §12) | each laptop, a folder | captures not yet acknowledged by `Board` | — |
| **Git** (each project's repo) | GitHub and laptops | code, docs, decisions; a project's Backlog.md board until it moves (ADR 0001) | the nightly board export (a backup, never read back) |
| **Laptop files** | each laptop | Casper's config (`~/.config/bobnet`), handoff files, the installed release | — |

- **Live state belongs to the laptop, finished state to the board.** A running worker's tokens,
  context and requests are the supervisor's. From `run_end` on, the run's record is `Board`'s
  (ADR 0001 §9).
- **Copies age visibly.** A laptop report older than twice the heartbeat is shown as stale, not as
  live (review chore 15).
- **Recovery is per owner.** Each Durable Object restores alone (ADR 0001 §1). A supervisor restart
  keeps what its SQLite owns and loses what it holds in memory (P7 writes the list). A client restart
  loses its digest (P2).
- **One wire definition.** Every frame and operation that crosses a part is a zod schema in
  `packages/protocol`, and changes additively (`architecture/CLAUDE.md`; P3 adds the version
  handshake).

### 2. What crosses where

| From → to | Carries | Identity comes from |
|---|---|---|
| Browser → Worker → `Broker` | the owner's socket: dashboard reads, board operations, actions | Access user JWT, checked by the Worker; passed to the object as a header it alone sets (`index.ts:33-39`) |
| Supervisor or client → Worker → `Broker` | one socket per process, any number of hosted peers | the laptop's Access service token → laptop id (`auth.ts:20-50`); the peer name is checked against what that socket registered (`broker.ts` `hosted`) |
| `Broker` → `Board` | operations with the caller and `ctx` (ADR 0001 §1, §4) | what `Broker` already verified, passed as values |
| CI → Worker → `Board` | run reports (ADR 0001 §10) | a CI service token → source name |
| `Broker` → supervisor | deliveries, actions (ADR 0003), remote requests | the broker stamps the sender (`address.ts:1-3`); never taken from a frame |
| Supervisor → worker | tools in-process, with the worker's identity stamped by the supervisor (`worker-tools.ts`) | the supervisor; the worker holds no credential |

### 3. Principals and what each may do

| Principal | Credential | May |
|---|---|---|
| **Casper (owner)** | Access user JWT | read everything; broker-held writes (board, gates); laptop actions only with a device key's signature, once ADR 0003 is in |
| **A laptop** | Access service token, one per laptop | register any free name on that laptop, send, broadcast, report, and make board operations as those names. **It speaks for every name on its laptop.** |
| **A worker** | none | act only through its supervisor's tools, as its role; never sees a token |
| **An interactive agent** | the laptop's token, through the channel client | the same as its laptop: it is trusted as that laptop |
| **Another laptop's orchestrator** | a BobNet sender | spawn on this laptop only the roles its `remote` allowlist names, and follow and stop only what it spawned (`remote.ts:4-9`) |
| **A CI system** | its own Access service token | report CI runs, nothing else (ADR 0001 §4) |
| **`BobNet@board`** | none: reserved | the sender of the board's own messages; no laptop may register it (ADR 0001 §7) |

### 4. What BobNet defends against, and what it doesn't

**The threat is mistakes and agents overstepping their role.** BobNet guards against:

- an agent acting as another role: identity is stamped by the supervisor or the broker, never read
  from what the agent sends;
- an agent writing outside its role: board grants (ADR 0001 §5), `policy.yaml` and the built-in
  guards, the sandbox where it is on;
- an agent pasting a credential into a message: the broker refuses it (`broker.ts:521`);
- a broker whose storage or traffic is read: owner actions are signed (ADR 0003); laptop tokens never
  cross the broker;
- a land on a stale line, a lost message, an unknown frame: ADR 0002, P2, P3.

**It doesn't defend against a hostile process on a laptop.** Anything running as Casper's user can
read the laptop's token (the Keychain through `security`, or `supervisor.env` on Linux) and then be
that laptop: take any free name on it, send as it, report for it. Workers with `sandbox: false`
(BobNet's and Helix's roles today) are such processes, held back by policy and guards that catch
mistakes and are not a boundary (P8 writes the layers). The built-in guard for the Keychain
(BOB-15) catches the mistake. It doesn't stop a determined process. The README says what holds with
the sandbox and what holds without it.

**It doesn't defend against Casper's Cloudflare account.** Whoever can deploy the Worker controls
the broker, the board and the dashboard's code (ADR 0003 §4).

Per-peer credentials issued by the supervisor would make a name, not a laptop, the unit of trust.
They are large, and the threat above doesn't need them yet.

### 5. Teams scope noise, not visibility

A team decides who gets presence events (`broker.ts:564-574`): the same team, and the teamless.
Everyone can list every peer (`:538-543`) and send to anyone (`:255-286`). A team is not a
permission, and nothing may rely on it as one. A rule that must keep one project's agents from
another's is a grant (ADR 0001 §5) or a supervisor's `remote` list, never a team.

### 6. Workers run on Casper's subscription, and usage is tokens

This replaces Helix's ADR 0094 §3 for BobNet (cited at `worker.ts:56`):

- The supervisor removes the billing variables (`BILLING_ENV`, `config.ts:22`) and the laptop's
  broker credentials from every worker's environment (`worker.ts:513-521`), and refuses a role that
  sets a billing variable (`config.ts:33`).
- It stops a worker at once if the session reports any key source other than `none`
  (`worker.ts:416-420`), and the stop reaches the orchestrator as any worker's end does.
- A per-token key for a worker needs a new decision by Casper.
- Usage is shown and reported as tokens, never money. `cost_usd` leaves the protocol with ADR 0001's
  runs (review finding 10).

### 7. Other projects' repos

BobNet runs other projects' teams and reads their repos (Backlog.md, hold files) through git. It
never writes them: it doesn't commit, push or edit a project's files on its own behalf, and what a
project's agents write goes through that project's own land command. A project that moves its board
to the service (ADR 0001, Casper's decision of 2026-11-13) makes `Board` the store for that board
only; its code, docs and decisions stay in its repo.

## Consequences

- Each later ADR says which part owns the state it adds, using §1's table, and which principal may
  do what, using §3's. A new principal is an amendment here.
- `README.md:47` (BOB-12) and `README.md:111` (BOB-15) are corrected to match §4.
- `worker.ts:56` cites 0004 §6 instead of Helix's 0094 §3 (review chore 8).
- Nothing here changes code by itself. The fixes it names are BOB-12, BOB-15 and chores 8 and 15.

## Alternatives considered

- **A hostile laptop process as the threat:** it needs per-peer credentials, OS-level isolation of
  every worker and a key store workers can't reach. That is large, and it doesn't match how the team
  works (unsandboxed roles by choice). Rejected for now; §4 says what that leaves open.
- **Teams as a permission boundary:** it would need `peers` and `send` filtered by team, and
  cross-team work (Mario to Helix's Bob, poe to every lead) to be granted case by case. Rejected:
  grants and the `remote` list already cover what needs a permission.
- **Leave the billing rule in Helix's ADR:** BobNet's code would follow a rule another project owns.
  Rejected (§6).
