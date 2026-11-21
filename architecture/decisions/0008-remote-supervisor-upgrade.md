# ADR 0008: A supervisor upgrades and restarts itself on a remote request

Status: accepted (Toad, 2026-11-20); rulings for the BOB-83 build added 2026-11-21. Item: BOB-83 (Casper via poe, 22:14 CST, "3"). Builds on ADR 0007 §2 (the
`v: 2` wire) and §7 (who owns what). Line numbers are at dd9279e.

## Context

poe@ubu1 is gone. Before, poe@ubu1 put each release on ubu1 by hand:
- it installed the rc;
- it pointed the systemd unit at the rc;
- it restarted the supervisor.

Now one poe (poe@mbp-1) runs every laptop, so nobody is on ubu1 to do this. BOB-83 asks that a supervisor
accept an upgrade from an address in its remote list, so that poe can roll a release to every laptop over
BobNet. The first release that carries this still needs one install by hand on each laptop.

What the code does today:
- **The service file names a release.** The unit's `ExecStart` (`systemd.ts:25`) and the plist's
  `ProgramArguments` (`launchd.ts:29`) name the `bin.ts` of the installing release
  (`~/.local/share/bobnet/<tag>/…`). So every release means rewriting the unit or plist and reloading it.
- **A clean exit is not restarted.** The service restarts the supervisor only on a non-zero exit: systemd has
  `Restart=on-failure`, and launchd has `KeepAlive.SuccessfulExit=false`, each after 10 s. A clean shutdown
  exits 0 (`bin.ts:89-97`) and stays down.
- **A start orphans active workers** (`supervisor.ts:511`), and answers each remote request that was in
  progress with "the target restarted while handling it" (`:530-536`).
- **The remote list grants only `spawn`** (`config.ts:203-213`): "it answers no request and changes no policy
  or role".
- **A release, as cut today:** a tag `v2.0.0-rc.N` on `origin/v2`, `git archive` into
  `~/.local/share/bobnet/<tag>`, then `pnpm install --frozen-lockfile` (`lead/CLAUDE.md`, Releases).

## Decision

### 1. One stable path: `<root>/current`

- The unit and the plist run `<root>/current/packages/supervisor/src/bin.ts`. `<root>` is
  `~/.local/share/bobnet`, which `upgrade.root` can change.
- `current` is a symlink to `<root>/<tag>`, and `previous` is a symlink to the tag before it.
- `install-systemd` and `install-launchd` write the `current` path when they are run from a release under
  `<root>`, and their own path otherwise (a repo checkout, as today).
- An upgrade then never touches the unit or the plist. It switches `current` and exits non-zero, and the
  service manager starts the new release.
- Each switch is atomic: a new symlink under a temporary name, then `rename` over the old one.

### 2. The op: `upgrade` (`v: 2`)

| Op | Fields | Does | Who may |
|---|---|---|---|
| `upgrade` | `tag`; `restart?`: `"when_idle"` (default), `"now"` or `"no"` | installs `tag`, checks it, and restarts into it (§4) | an address whose remote entry has `upgrade: true` |

- **The grant.** `remote.<address>.upgrade: true` in `supervisor.yaml`. It is off by default, it is separate
  from `spawn`, and an entry may have either one or both. The config is Casper's.
- **What an older supervisor does with it.**
  - An older supervisor's `z.object` strips the unknown `upgrade` key from its config.
  - Its `.strict()` request schema refuses the unknown op as a bad request (ADR 0007 §2's additive rule).
- **The broker doesn't change.** The op, the reply and the events are message bodies, as in ADR 0007 §2.
- **The reply comes at once,** before any work, so the request never waits on an install:
  - `{ v: 2, re: "upgrade", req, ok: true, from: "<running version>", to: "<tag's version>" }`;
  - or `ok: false` with an error (§3's refusals, or an upgrade already under way).

  Everything after the reply is reported as events (§5).
- **One upgrade at a time.** A new `upgrade` replaces one waiting for idle: the old one gets `failed`,
  "superseded by <tag>". An upgrade that is installing refuses the new one.
- **Idempotent, as every `v: 2` request is** (`remote_requests`). Asking again for a tag that is already
  installed skips the fetch and the install.

### 3. What it may install: a tag on the line, built here

- **The tag.**
  - Its name matches `^v\d+\.\d+\.\d+(-rc\.\d+)?$`.
  - It is fetched in the local clone that `upgrade.repo` names: `git fetch origin tag <tag>`, with
    `GIT_TERMINAL_PROMPT=0` and a timeout.
  - Its commit must be on `origin/<upgrade.line>` (default `v2`), checked with
    `git merge-base --is-ancestor`.
  - Its root `package.json` version must equal the tag without its `v`.
- **The trust root is the tag on `origin`, as it is for a hand install today.** No path, archive, URL or code
  ever comes in the request.
- **No release older than the first one that carries `upgrade`.** A release older than that has no `upgrade`
  op, so a laptop on it could never be upgraded remotely again.
  - The release's `packages/supervisor` must declare it: `bobnet.upgradable: true` in its `package.json`.
  - A downgrade to an earlier upgradable release is allowed, and is the rollback (§6).
- **The build.**
  1. `git archive <tag>` into `<root>/.<tag>.partial`.
  2. `pnpm install --frozen-lockfile` there, with a 10 min timeout.
  3. Rename it to `<root>/<tag>`.

  A failed step removes the partial directory and reports `failed` with the step and the last lines of its
  output.
- **Refused without the configuration.** Without an `upgrade` section, or without `pnpm` on the service's
  PATH, the op is refused, and the reply says what is missing.

### 4. Check, then switch, then exit: never mid-reply, mid-land or mid-request

1. **Preflight.** Run `node <root>/<tag>/packages/supervisor/src/bin.ts check`, a new subcommand of the
   release, with the same config dir. It exits 0 only if:
   - the node version satisfies the release's `engines`;
   - the supervisor's modules import;
   - `supervisor.yaml`, `policy.yaml` and `config.json` parse under the new schemas.

   It opens no database, takes no pid file and connects to nothing. If it fails, nothing is switched, and
   `failed` carries its output.
2. **Wait for idle, unless `restart` is `"now"` or `"no"`.**
   - Idle means: no worker in `ACTIVE_STATES`, no run in a run slot, and no remote request in progress
     (`remoteInProgress`). A queued worker isn't running yet, so the restart doesn't wait for it.
   - `"when_idle"` reports `installed` with what it waits on. It restarts the first time it is idle, checked
     on each worker end, run end and request finish.
   - `"now"` doesn't wait for workers, which are orphaned as on any restart (`supervisor.ts:511`). It still
     waits for a run in a slot (a land mid-push) and for the remote requests in progress.
   - `"no"` stops after `installed`.
3. **Record the upgrade, then switch.**
   - An `upgrades` row in `supervisor.db` (a new table, additive): `req`, `requester`, `from`, `to`,
     `stage = restarting`.
   - Then `previous` → the running release, and `current` → `<tag>`.
4. **Report, then exit.**
   - The `restarting` event goes through the outbox (ADR 0007 §2).
   - The supervisor waits up to 15 s for the outbox to flush. A row left behind is durable, and the new
     process sends it.
   - Then it shuts down as on SIGTERM (`bin.ts:89-97`), except that it exits with **75**. launchd and systemd
     restart it 10 s later, through `current`.
5. **Ready.**
   - The new process starts, registers, and finds the `upgrades` row at `restarting`.
   - Once it has registered with the broker, it sends `ready` with its own version and marks the row done.
   - If its version isn't the row's `to` (`current` was switched back by hand), it sends `failed`: "running X,
     not Y".

### 5. What comes back

- **Events.** `{ v: 2, event: "upgrade", req, stage, from, to, … }`, where `stage` is one of:
  - `installed`, with `restart` and, when it waits, `waiting_on`: counts of workers, runs and requests;
  - `restarting`;
  - `ready`, with `version`;
  - `failed`, with `step` and `error`.
- **Its own schema.** The event isn't about a worker, so it gets `RemoteUpgrade` in `packages/protocol`.
  - The requester routes `event: "upgrade"` to it before `RemoteEvent`.
  - It takes the event only from the address the request went to, and only for a `req` it sent.
  - An older requester logs it and drops it, which is ADR 0007 §2's rule for unknown events.
- **The orchestrator is told once per stage.** For example:
  - "ubu1: supervisor 2.0.0-rc.43 installed, restarting when idle (2 workers)";
  - "ubu1: supervisor 2.0.0-rc.43 ready";
  - "ubu1: upgrade to 2.0.0-rc.43 failed at pnpm install: …".
- **No `ready` within 10 min of `restarting`.** The requester tells the orchestrator once: "ubu1: no ready
  from the supervisor since restarting into <tag>; it may not have started (roll back by hand, §6)". The check
  rides the 5 min reconcile loop (`supervisor.ts:1400`).
- **The tool.** `upgrade_supervisor { laptop, tag, restart? }` on the orchestrator's supervisor MCP, and only
  for a lead. Its result is the reply. The rest of the stages arrive as notices.

### 6. Rollback

- **No automatic rollback.** The preflight catches what can be caught without running the new release: a
  missing dependency, a config the new schema refuses, the node version.
- **A release that passes the preflight and then crashes at start** loops under the service manager, and no
  `ready` comes (§5).
- **The way back, by hand on the laptop:** `ln -sfn "$(readlink <root>/previous)" <root>/current`, then
  restart the service.
- **A release that starts but misbehaves:** `upgrade` to the previous tag. It is installed already, so only
  the switch and the restart run.
- **Installs are never removed by the op.** Pruning old tags stays a manual job.
- **A rollback must keep working on an upgraded database.** Schema changes stay additive, as BobNet's are
  today (`ALTER TABLE … ADD COLUMN`, guarded).

### 7. The first release that carries it

- It is installed by hand on each laptop, the last such install:
  1. `git archive` and `pnpm install` into `<root>/<tag>`;
  2. `ln -s <tag> <root>/current`;
  3. `install-systemd` (ubu1) or `install-launchd` (mbp-1) run from `current`;
  4. reload the unit and restart.
- Casper adds `upgrade:` (`repo`, and optionally `root` and `line`) and the grant to `supervisor.yaml`.
- poe does the restarts. The config is Casper's (CLAUDE.md, Ground rules).
- After that, a release reaches a laptop as `upgrade_supervisor`. Mario cuts and tags; poe asks.

## Rulings, BOB-83 build

Toad, 2026-11-21. These are my answers to Luigi's consults during the build (c_97c7a90a, c_9e8b6d19), as
built in a5ed7dd, and the review's rulings (`reviews/2026-11-21-bob44-a-fixes-4.md`). Line numbers are at
a5ed7dd. Where they say more than §1-§7, they win.

1. **Who may use the tool.**
   - `upgrade_supervisor` is the laptop orchestrator's: poe's MCP, whose handlers have no `lead`.
   - A lead worker is refused (`mcp.ts`, `opts.lead`), and `lead-tools.ts` leaves the tool out of a lead's
     in-process tools (`ORCHESTRATOR_ONLY`).
   - "Lead" in §5 means the laptop's orchestrator, not a lead worker.
2. **The orchestrator's own laptop.**
   - The upgrade runs in-process, on the same code path: the same `upgrades` row, and the same audit, with
     `orchestrator` as the requester.
   - It needs no grant, because the tool's token is the authority. It does need the `upgrade:` section.
   - Its stages come to the orchestrator as notices.
3. **The grant is on the address the request comes from.** poe's tool sends as its laptop's supervisor, so
   the grant on ubu1 is `remote."supervisor@mbp-1".upgrade: true`, not `poe@mbp-1`.
4. **The guard on `<root>`.**
   - It has the same reach as the config-folder guard: every worker, the orchestrator lead included, any
     touch, and any Bash command that names the path.
   - `<root>` is `upgrade.root ?? ~/.local/share/bobnet`. The guard covers it even without an `upgrade:`
     section.
   - When the two differ, both the default and `upgrade.root` are covered (`bin.ts:81`). That withholds
     more.
5. **The clone is guarded too (review M1).**
   - The supervisor runs `git` in `upgrade.repo`. Its `.git/config` says where `origin` is (the trust
     root, §3), and it can name commands git runs (`core.sshCommand`, `credential.helper`).
   - So a worker that can write the clone can make the next upgrade run its code as the supervisor, with
     no guard.
   - For rc.42, the clone lives under `<root>`, so the existing guard covers it. A dot-name keeps
     `runningRelease` off it, e.g. `<root>/.src.git`, a bare clone.
   - In the next build, `bin.ts` also adds `upgrade.repo` to the guard's roots, wherever it is.
6. **Small rulings.**
   - (a) In a `remote` entry, `spawn` is optional, and an entry must grant something
     (`config.ts`, the refine).
   - (b) "Older than the first release that carries `upgrade`" is read from the tag's
     `packages/supervisor/package.json`, `bobnet.upgradable`, with `git show` before the archive. No version
     is hard-coded.
   - (c) The reply waits for the fetch and the checks, not for the archive or the install. A requester waits
     90 s for an `upgrade` reply, and the ttl is 30 s.
   - (d) `waiting_on` is `{workers, runs, requests}`, plus `leads` by name.
   - (e) Exit 75 removes the pid file, as SIGTERM does.
   - (f) An installed tag skips the git work only when `<root>/<tag>` is a complete folder, its version
     matches the tag, and it is upgradable.
7. **A live lead holds `when_idle`.** A lead is `running` for its whole life, so on a laptop with a live
   lead, `when_idle` never fires. The notice names the lead. poe uses `now` once the lead has left its
   handoff.
8. **Luigi's departures from §2-§5, all accepted.** None of them is on the wire, except an additive field.
   - **The fetch** is `git fetch --no-tags origin +refs/heads/<line>:refs/remotes/origin/<line>
     +refs/tags/<tag>:refs/tags/<tag>`, not `git fetch origin tag <tag>`. `origin/<line>` must be fresh for
     the ancestry check, and origin's tag wins over a local one. That is stronger than §3.
   - **`restarting` carries `root`**, so the overdue notice can give the exact rollback command. This is
     additive: `RemoteUpgrade` is loose.
   - **The failed steps** are named `git archive`, `pnpm install`, `check`, `switch`, `wait` (superseded)
     and `start` (version mismatch).
   - **`missing()`** also refuses when `upgrade.repo` isn't a git clone.
9. **Luigi's open questions.**
   - **A restart mid-install** leaves no row, so the requester gets no `failed`, and a `.<tag>.partial` may
     stay behind until the next build clears it. This is a minor (review m3), not for rc.42. Later, an
     `installing` row lets `resume()` send `failed`, "restarted while installing".
   - **pnpm's `.bin` shims after the rename:** fine. Each shim runs its target through `$basedir`, a
     relative path. Only its fallback `NODE_PATH` names the `.partial` folder.
   - **The service's environment:** fine.
     - `servicePath` puts node's folder first, then the installing shell's PATH.
     - `missing()` refuses an upgrade with no pnpm.
     - A fetch that can't authenticate fails within 60 s and says so in the reply. With no tty, ssh fails;
       it doesn't prompt.
     - The rc notes have the as-the-service fetch test.

## As built, build C

Toad, 2026-11-21. This is build C, v2 47b422c..ec3fb35 (BOB-91..95), as reviewed in
`reviews/2026-11-21-bob44-build-c.md`. Where it says more than §1-§7 and the rulings above, it wins. None of it is on
the wire.

1. **The guard (ruling 5, BOB-91, BOB-94).**
   - Guarded: the config folder, the default `<root>`, `upgrade.root` and `upgrade.repo` (`config.ts`
     `guardedFolders`).
   - Paths are compared by real path with case folded, on every laptop. A folder is named whole, so a
     same-prefix sibling isn't it.
   - Relative words are resolved from the worker's cwd and its `cd`s.
   - It is still a best effort. The sandbox enforces.
2. **The commit, not the tag (§3).** `verify` resolves `refs/tags/<tag>^{commit}` once. The ancestry check, both
   `git show`s and `git archive` use that SHA. `build` archives only a tag this process verified.
3. **Verify's deadline.**
   - All of verify's git calls share one deadline of 75 s (`VERIFY_BUDGET_MS`), inside the requester's 90 s. So the
     fetch has up to 75 s, not ruling 9's 60.
   - A call that runs out is a refusal that says which call it was.
   - A timed-out command returns at its deadline, even if a child of it holds the pipe.
4. **The row's stages (§4.3, §4.5).**
   - The `upgrades` row is written when the build starts, not at the switch.
   - Its stages are `installing`, then `waiting` (installed, waiting for idle), then `restarting`.
   - It ends `ready`, `failed` or `installed` (`restart: "no"`). Every failure ends it.
   - At start, `resume()` reads every open row:
     - `installing` fails, step `start`, "restarted while installing", and its `.<tag>.partial` is removed;
     - `waiting` fails, step `wait`; the tag stays installed, so asking again switches to it;
     - `restarting` goes as in §4.5.
   - The values are new text in a TEXT column, so this needs no migration. rc.44 leaves `installing` and `waiting`
     rows unread, which is harmless.
5. **A shutdown isn't idle (§4.2).** A worker's exit during a shutdown doesn't trigger the switch. The next process
   fails the waiting row. Two other paths can still trigger it: a slot's release and a request's finish (review C,
   m1).
6. **The drain holds (§4.4).** From the switch to the exit, nothing new starts:
   - no queued worker is launched; it stays queued, and the new process starts it;
   - no run slot is given; the waiters wait;
   - a `v: 2` remote spawn is refused, before or after its board join, with "<Role> isn't spawned: this
     supervisor is restarting into <tag>; ask again once it is ready". It uses the existing refusal shape. It is a
     new reason, not a limit.
   - a consult that would start a worker is refused.

   A refusal after the join leaves the board a join with no run behind it. A crash between the join and the spawn
   leaves the same. The retry after `ready` joins again as a new worker.

## Consequences

- A release is one request per laptop. ubu1 needs no poe of its own and no ssh.
- **The workers' guard covers the release tree.** The supervisor writes under `<root>`, and workers must not.
  `policy.ts`'s guard on the supervisor's folder must cover `<root>` too, if it doesn't today. That is a
  criterion for the build.
- **A wrong grant is a large one.** An address with `upgrade: true` can restart the supervisor with any
  tagged release on the line, at any time it is idle, or at once with `"now"`. It is Casper's to give, by
  address, and the audit records each request (`remote:upgrade`) and each stage.
- **Neither the protocol nor the broker changes beyond additive fields.**
  - The op is new, and an older target refuses it.
  - The event is new, and an older requester drops it.
  - The broker carries bodies as before.

## Alternatives considered

- **An archive or a path in the request.** It puts code on the wire, and the target would have to trust
  whatever comes. The tag on `origin/<line>` is the trust root a hand install already uses.
- **The op rewrites the unit or plist and reloads it** (`systemctl --user daemon-reload`, `launchctl
  bootout`/`bootstrap`).
  - `bootout` kills the caller, so the supervisor would need a detached helper to finish.
  - It needs two code paths, one per service manager.
  - The symlink needs neither: an exit and the existing restart rule do it.
- **A watchdog launcher for automatic rollback**, a small script outside releases that switches `current`
  back after N failed starts.
  - It is more machinery outside every release, and it would need its own upgrade path.
  - The preflight, together with the missing-`ready` notice, covers the likely failures.
  - Revisit if a crash-at-start ever reaches a laptop.
- **Wait for idle by holding new spawns.** It would block poe's work for as long as a worker runs. `when_idle`
  waits without holding anything, and `now` exists for when poe decides.
