# rc.42 notes: the remote supervisor upgrade (BOB-83, ADR 0008)

Drafted by Luigi, finalised by Mario 2026-11-21 after review A-fixes-4 (`lead/bob44/review-a-fixes-4.md`; its M1 moves
the upgrade clone under `<root>`). rc.42 carries A-fixes-3 (BOB-84..87), BOB-89 and BOB-83. ubu1's hand install,
exactly: `lead/bob44/rc42-ubu1-install.md`. Mario owns these notes and the release; poe does the restarts; the
config is Casper's. `<root>` is `~/.local/share/bobnet` unless `upgrade.root` says otherwise. `<tag>` is
`v2.0.0-rc.42`, the first release that carries the `upgrade` op (its `packages/supervisor/package.json` has
`bobnet.upgradable: true`).

## What changes for whoever runs a laptop

- The unit and the plist name `<root>/current/packages/supervisor/src/bin.ts`, a symlink to `<root>/<tag>`.
  From rc.42 on, a release reaches a laptop as `upgrade_supervisor {laptop, tag, restart?}` from that
  laptop's orchestrator (poe), never by rewriting the unit or plist.
- An upgrade switches `current` (and `previous`, to the release it ran) and exits 75. launchd
  (`KeepAlive.SuccessfulExit=false`) and systemd (`Restart=on-failure`) start it again 10 s later.
- **Workers can't touch `<root>` any more**, the orchestrator lead included (policy.ts's built-in guard,
  as for `~/.config/bobnet`; Toad's ruling, BOB-83). Mario can no longer `git archive`/`pnpm install` into
  `<root>` once mbp-1 runs rc.42: lead/CLAUDE.md "Releases" needs its install step changed (Mario cuts,
  tags and pushes; poe asks `upgrade_supervisor`; a hand install is poe's or Casper's). Mario's file.
- **A live lead holds `when_idle` for ever.** A lead is `running` for its whole life, so on mbp-1 (Mario)
  `restart: when_idle` never fires; the `installed` notice says "waiting on 1 worker: Mario (lead)". Use
  `restart: now` once the lead has left its handoff: a restart ends the lead and every worker, as any does.

## The one hand install on each laptop (§7)

Run in a shell on the laptop, after Mario has tagged and pushed `v2.0.0-rc.42`. The clone can be any
clone of bobnet-mcp; below it is `$SRC`.

1. Build it into `<root>/<tag>`:
   ```sh
   SRC=~/Code/bobnet-mcp           # a clone of bobnet-mcp
   ROOT=~/.local/share/bobnet
   TAG=v2.0.0-rc.42
   git -C "$SRC" fetch origin tag "$TAG"
   mkdir "$ROOT/$TAG"
   git -C "$SRC" archive "$TAG" | tar -x -C "$ROOT/$TAG"
   (cd "$ROOT/$TAG" && pnpm install --frozen-lockfile)
   ```
2. Link `current` (relative, as the op makes it; there is no `current` before rc.42):
   ```sh
   ln -s "$TAG" "$ROOT/current"
   ```
   On a laptop that ran a release from `<root>` before, also `ln -s <that tag> "$ROOT/previous"`, so the
   hand rollback below has somewhere to go.
3. Check the release against this laptop's config before anything points at it (the op's own preflight):
   ```sh
   node "$ROOT/current/packages/supervisor/src/bin.ts" check     # mbp-1
   ( set -a; . ~/.config/bobnet/supervisor.env; set +a;          # ubu1: its credentials are in the env file
     node "$ROOT/current/packages/supervisor/src/bin.ts" check )
   ```
   It prints `ok: 2.0.0-rc.42 on node …` and exits 0, or names each problem and exits 1. It opens no
   database, takes no pid file and connects to nothing.
4. Rewrite the service file from `current`, with the node the service should run on. Run from a release
   under `<root>` (through `current` or not), install-* writes the `current` path; it prints the file it wrote.
   - mbp-1: `node "$ROOT/current/packages/supervisor/src/bin.ts" install-launchd`, then check the plist's
     `ProgramArguments` names `…/bobnet/current/packages/supervisor/src/bin.ts`.
   - ubu1: `node "$ROOT/current/packages/supervisor/src/bin.ts" install-systemd`, then check `ExecStart`.
5. Reload and restart (poe):
   - mbp-1: `launchctl bootout gui/$(id -u)/com.bobnet.supervisor; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bobnet.supervisor.plist`
   - ubu1: `systemctl --user daemon-reload && systemctl --user restart bobnet-supervisor`
   Then the dashboard shows the laptop's supervisor on 2.0.0-rc.42.

## Casper's part (not blocking; until it is there the feature is off)

In each laptop's `~/.config/bobnet/supervisor.yaml`, only once that laptop runs rc.42 (an older
supervisor refuses a `remote` entry that has no `spawn`):

```yaml
upgrade:
  repo: ~/.local/share/bobnet/.src.git   # the bare clone the supervisor fetches tags in (below)
  # root: ~/.local/share/bobnet      # the default
  # line: v2                         # the default: a tag must be on origin/v2
```

and on ubu1, the grant for mbp-1's supervisor, beside its `spawn` (poe's tool sends as mbp-1's
supervisor, so the address is `supervisor@mbp-1`, not `poe@mbp-1`):

```yaml
remote:
  supervisor@mbp-1: { spawn: { …as today… }, upgrade: true }
```

mbp-1 upgrading itself needs no grant (in-process, the tool's token is the authority), only `upgrade:`.
The config is read at start: a restart (poe) after the edit.

Before relying on it, on each laptop:
- **The clone (review A-fixes-4 M1, Toad).** A bare clone of its own **under `<root>`**, which the guard
  denies to every worker: `git clone --bare https://github.com/cath42/bobnet-mcp.git ~/.local/share/bobnet/.src.git`.
  Never a worktree's repository and never a clone outside `<root>` (e.g. under `~/Code`): its `.git/config`
  (`remote.origin.url`, `core.sshCommand`, `credential.helper`) is code the supervisor runs, and a worker could
  rewrite it there. The dot-name keeps it apart from the releases. The op runs `git fetch --no-tags origin
  +refs/heads/v2:refs/remotes/origin/v2 +refs/tags/<tag>:refs/tags/<tag>` in it (a local tag of the same
  name is replaced by origin's) and `git archive` from it. (From the next build the guard also covers
  whatever `upgrade.repo` names; until then, only under `<root>` is guarded.)
- **The fetch must work from the service, without a prompt** (`GIT_TERMINAL_PROMPT=0`, 60 s): an ssh
  remote needs a key the service's environment can use with no agent and no passphrase prompt, or use an
  https remote with a credential helper that needs no prompt. Try it as the service would:
  `env -i HOME="$HOME" PATH="<the unit's or plist's PATH>" GIT_TERMINAL_PROMPT=0 git -C ~/.local/share/bobnet/.src.git fetch --no-tags origin +refs/heads/v2:refs/remotes/origin/v2`.
- **pnpm on the service's PATH**: the PATH in the unit or plist (node's folder first). Without it the op
  is refused, saying so.

## Rolling a release (after the above)

poe, for each laptop: `upgrade_supervisor {laptop: "ubu1", tag: "v2.0.0-rc.43"}` (default `when_idle`;
`now` doesn't wait for workers but still waits for a run in a slot and for remote requests in progress;
`no` installs and checks only). The result is the reply (`from`, `to`) or the refusal; then, one notice
each: `installed` (with what it waits on), `restarting`, `ready` with the version, or `failed` with the
step (`git archive`, `pnpm install`, the preflight check, the switch, start) and the end of its output.
No `ready` within 10 minutes of `restarting` is said once, with the hand rollback.

## The way back (§6)

Nothing rolls back by itself, and no install is removed by the op (pruning old tags is by hand).

- **It starts but misbehaves:** `upgrade_supervisor {laptop, tag: <the previous tag>}`. It is installed,
  so only the preflight, the switch and the restart run.
- **It doesn't start** (no `ready`; the service loops): on the laptop,
  ```sh
  ln -sfn "$(readlink ~/.local/share/bobnet/previous)" ~/.local/share/bobnet/current
  ```
  then restart the service (poe): mbp-1 `launchctl kickstart -k gui/$(id -u)/com.bobnet.supervisor`,
  ubu1 `systemctl --user restart bobnet-supervisor`. The new process sends `failed`, "running X, not Y",
  for the upgrade it was started for.
- **Back to a release before rc.42** (none carries the op): point the plist or unit at that release by
  hand, as before rc.42 (its own install-* writes its own path). Upgrades are by hand again from there.
- The database stays usable by the release before: the new tables (`upgrades`, `remote_upgrades`) are
  additive and the older release ignores them.

## Known limit until the broker carries BOB-80's findSecret (BOB-78 AC 4)

Added 2026-11-22 by Mario (the a-fixes.md half: `lead/bob44/a-fixes.md:32`, 8eb7c5e). Between a laptop on this
release and a broker still on the older findSecret, a body the target lets through can be refused by the broker. The
window covers `exit` and `summary` when the match is in the handoff, and `status` and `list` too when the text is in
the worker's `error` or `checkpoint` (`remoteView` carries them): both then come back withheld. rc.42 carries BOB-78:
the orchestrator is told once ("<name> on <laptop>: state withheld, ask there"), and a reconcile goes on past a
withheld batch. The window closed with broker version d5e4c9b6 (2026-11-22T02:25Z, from 067d246), deployed after
both laptops ran rc.42 or later.
