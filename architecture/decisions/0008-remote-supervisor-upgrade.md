# ADR 0008: A supervisor upgrades and restarts itself on a remote request

Status: accepted (Toad, 2026-11-20). Item: BOB-83 (Casper via poe, 22:14 CST, "3"). Builds on ADR 0007 §2 (the
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
