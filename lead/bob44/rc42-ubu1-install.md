# rc.42 on ubu1: Casper's hand install (ADR 0008 §7)

This is the last hand install on ubu1. After it, poe@mbp-1 rolls releases with `upgrade_supervisor`.
- Background: `lead/bob44/rc42-notes.md`.
- Review: `lead/bob44/review-a-fixes-4.md` (its M1 is why the clone sits under `<root>`).

Run these as `ct` in a shell on ubu1, in order, after Mario has pushed the tag `v2.0.0-rc.42`. Each block
stops at its first error. Steps 1-4 don't touch the running supervisor, so do them any time. Step 5 restarts
the supervisor, so do it when ubu1 is idle: poe@mbp-1 checks with `list_workers {laptop: "ubu1"}` (poe@ubu1 is retired).

## 0. Look first
```sh
systemctl --user cat bobnet-supervisor | grep ExecStart   # expect …/.local/share/bobnet/v2.0.0-rc.41/…
ls ~/.local/share/bobnet/                                 # expect v2.0.0-rc.41 among others; no current, no .src.git
```
If `ExecStart` doesn't name `~/.local/share/bobnet/v2.0.0-rc.41`, put the release that it does name in
`PREV` below instead of `v2.0.0-rc.41`.

## 1. The upgrade clone, bare, under `<root>` (review M1)
```sh
set -e
ROOT=~/.local/share/bobnet
git clone --bare https://github.com/cath42/bobnet-mcp.git "$ROOT/.src.git"
```

## 2. Build rc.42 from that clone into `<root>/v2.0.0-rc.42`
```sh
set -e
ROOT=~/.local/share/bobnet; TAG=v2.0.0-rc.42
git -C "$ROOT/.src.git" fetch --no-tags origin "+refs/heads/v2:refs/remotes/origin/v2" "+refs/tags/${TAG}:refs/tags/${TAG}"
git -C "$ROOT/.src.git" merge-base --is-ancestor "refs/tags/${TAG}^{commit}" refs/remotes/origin/v2 && echo "on v2: ok"
mkdir "$ROOT/$TAG"
git -C "$ROOT/.src.git" archive "$TAG" | tar -x -C "$ROOT/$TAG"
(cd "$ROOT/$TAG" && pnpm install --frozen-lockfile)
```

## 3. Links: `current` to rc.42, `previous` to what runs now
```sh
set -e
ROOT=~/.local/share/bobnet; TAG=v2.0.0-rc.42; PREV=v2.0.0-rc.41
ln -s "$TAG" "$ROOT/current"
ln -s "$PREV" "$ROOT/previous"
readlink "$ROOT/current" "$ROOT/previous"   # v2.0.0-rc.42, v2.0.0-rc.41
```

## 4. Preflight: the release checks itself against ubu1's config (no db, no pid, no connection)
```sh
( set -a; . ~/.config/bobnet/supervisor.env; set +a
  node ~/.local/share/bobnet/current/packages/supervisor/src/bin.ts check )
```
Expect `ok: 2.0.0-rc.42 on node …` and exit 0. If it names a problem, stop here and tell poe@mbp-1. Nothing
has changed for the running supervisor yet. To undo, `rm` the two links and the rc.42 folder.

Also try the fetch the way the service will run it, with no prompt. If git asks for anything here, the remote
upgrade can't work until it doesn't. The release still works.
```sh
env -i HOME="$HOME" PATH="$(systemctl --user show bobnet-supervisor -p Environment | sed -n 's/.*PATH=\([^ ]*\).*/\1/p')" \
  GIT_TERMINAL_PROMPT=0 git -C ~/.local/share/bobnet/.src.git fetch --no-tags origin +refs/heads/v2:refs/remotes/origin/v2 && echo "fetch: ok"
```

## 5. Point the unit at `current`, then restart (when ubu1 is idle; poe@mbp-1 checks)
```sh
set -e
node ~/.local/share/bobnet/current/packages/supervisor/src/bin.ts install-systemd
systemctl --user cat bobnet-supervisor | grep ExecStart   # must name …/.local/share/bobnet/current/packages/supervisor/src/bin.ts
systemctl --user daemon-reload && systemctl --user restart bobnet-supervisor
```
Use the node the service should run on: the one `install-systemd` runs under is written into the unit.

**Check:** `journalctl --user -u bobnet-supervisor -n 30` shows "supervisor ready" after the restart, and on the
dashboard (or poe@mbp-1's `list_peers`) `supervisor@ubu1` reports 2.0.0-rc.42.

**If it doesn't start:**
- Run `ln -sfn v2.0.0-rc.41 ~/.local/share/bobnet/current && systemctl --user restart bobnet-supervisor`.
  The unit names `current`, so this runs rc.41 again.

## 6. Afterwards: config, yours, optional

This turns the remote upgrade on for ubu1. Until it's there, the op is off and refused.
- **When:** only once ubu1 runs rc.42. rc.41 refuses these keys.
- **Back up first:** `cp ~/.config/bobnet/supervisor.yaml ~/.config/bobnet/supervisor.yaml.bak-2026-11-21-rc42`.
- **Add** the `upgrade:` section and the grant to `~/.config/bobnet/supervisor.yaml`. Keep the existing
  `supervisor@mbp-1` entry and add only `upgrade: true` beside its `spawn`:
  ```yaml
  upgrade:
    repo: ~/.local/share/bobnet/.src.git

  remote:
    supervisor@mbp-1: { spawn: { …as today… }, upgrade: true }
  ```
- **Then** `systemctl --user restart bobnet-supervisor` (when ubu1 is idle; poe@mbp-1 checks).

The same on mbp-1 is the `upgrade:` section only, with no grant:
- Mario makes `.src.git` there as part of the rc.42 install.
- The edit and its restart are yours and poe's.
