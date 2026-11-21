# rc.44 on ubu1: the last hand install (ADR 0008 §7)

This is the last hand install on ubu1 (it was written for rc.42; the steps are the same for rc.44). After it,
poe@mbp-1 rolls releases with `upgrade_supervisor`.
- Casper's go: A-2, 2026-11-21 10:53 CST ("go"). It covers the install, step 6 and the bob44-probe rule (step 7).
- Background: `lead/bob44/rc42-notes.md`. Review: `lead/bob44/review-a-fixes-4.md` (its M1 is why the clone sits
  under `<root>`).

**Who runs it:** one Claude Code session on ubu1, started by Casper outside the supervisor (not a worker: the
restarts below would kill a worker, and nobody could answer its escalations). Everything it needs is in this file.
Run as `ct` in a shell on ubu1, in order. Each block stops at its first error. Steps 1-4 don't touch the running
supervisor, so do them any time. Steps 5 and 8 restart the supervisor: do them only when ubu1 is idle, that is,
`systemctl --user status bobnet-supervisor` shows no `claude` child processes under the unit, or poe@mbp-1 says
`list_workers {laptop: "ubu1"}` is empty. If a step fails, stop and report its output to Casper (or poe@mbp-1);
don't improvise a fix.

```sh
TAG=v2.0.0-rc.44
```

## 0. Look first
```sh
systemctl --user cat bobnet-supervisor | grep ExecStart   # expect …/.local/share/bobnet/v2.0.0-rc.41/…
ls -a ~/.local/share/bobnet/                              # expect v2.0.0-rc.41 among others; no current, no .src.git
```
If `ExecStart` doesn't name `~/.local/share/bobnet/v2.0.0-rc.41`, put the release that it does name in
`PREV` below instead of `v2.0.0-rc.41`. If `current` or `.src.git` already exists, stop and report.

## 1. The upgrade clone, bare, under `<root>` (review M1)
```sh
set -e
ROOT=~/.local/share/bobnet
git clone --bare https://github.com/cath42/bobnet-mcp.git "$ROOT/.src.git"
```

## 2. Build rc.44 from that clone into `<root>/v2.0.0-rc.44`
```sh
set -e
ROOT=~/.local/share/bobnet; TAG=v2.0.0-rc.44
git -C "$ROOT/.src.git" fetch --no-tags origin "+refs/heads/v2:refs/remotes/origin/v2" "+refs/tags/${TAG}:refs/tags/${TAG}"
git -C "$ROOT/.src.git" merge-base --is-ancestor "refs/tags/${TAG}^{commit}" refs/remotes/origin/v2 && echo "on v2: ok"
mkdir "$ROOT/$TAG"
git -C "$ROOT/.src.git" archive "$TAG" | tar -x -C "$ROOT/$TAG"
(cd "$ROOT/$TAG" && pnpm install --frozen-lockfile)
```

## 3. Links: `current` to rc.44, `previous` to what runs now
```sh
set -e
ROOT=~/.local/share/bobnet; TAG=v2.0.0-rc.44; PREV=v2.0.0-rc.41
ln -s "$TAG" "$ROOT/current"
ln -s "$PREV" "$ROOT/previous"
readlink "$ROOT/current" "$ROOT/previous"   # v2.0.0-rc.44, v2.0.0-rc.41
```

## 4. Preflight: the release checks itself against ubu1's config (no db, no pid, no connection)
```sh
( set -a; . ~/.config/bobnet/supervisor.env; set +a
  node ~/.local/share/bobnet/current/packages/supervisor/src/bin.ts check )
```
Expect `ok: 2.0.0-rc.44 on node …` and exit 0. If it names a problem, stop here and report. Nothing has changed
for the running supervisor yet. To undo, `rm` the two links and the rc.44 folder.

Also try the fetch the way the service will run it, with no prompt. If git asks for anything here, the remote
upgrade can't work until it doesn't. The release still works.
```sh
env -i HOME="$HOME" PATH="$(systemctl --user show bobnet-supervisor -p Environment | sed -n 's/.*PATH=\([^ ]*\).*/\1/p')" \
  GIT_TERMINAL_PROMPT=0 git -C ~/.local/share/bobnet/.src.git fetch --no-tags origin +refs/heads/v2:refs/remotes/origin/v2 && echo "fetch: ok"
```

## 5. Point the unit at `current`, then restart (when ubu1 is idle)
```sh
set -e
node ~/.local/share/bobnet/current/packages/supervisor/src/bin.ts install-systemd
systemctl --user cat bobnet-supervisor | grep ExecStart   # must name …/.local/share/bobnet/current/packages/supervisor/src/bin.ts
systemctl --user daemon-reload && systemctl --user restart bobnet-supervisor
```
Use the node the service should run on: the one `install-systemd` runs under is written into the unit.

**Check:** `journalctl --user -u bobnet-supervisor -n 30` shows "supervisor ready" after the restart, and on the
dashboard (or poe@mbp-1's `list_peers`) `supervisor@ubu1` reports 2.0.0-rc.44.

**If it doesn't start:**
- Run `ln -sfn v2.0.0-rc.41 ~/.local/share/bobnet/current && systemctl --user restart bobnet-supervisor`.
  The unit names `current`, so this runs rc.41 again. Stop and report.

## 6. Config: the upgrade section and the grant (only once step 5's check passed; rc.41 refuses these keys)

**Which `remote:` entry.** The target checks the sender the broker stamps. Everything poe does through its
supervisor tools with `laptop: "ubu1"` (`spawn_worker`, `worker_status`, `answer_request`, `upgrade_supervisor`)
goes out from mbp-1's supervisor, so it arrives as **`supervisor@mbp-1`** (BOB-82), never as `poe@mbp-1`. So:
- `supervisor@mbp-1` is the entry that needs `upgrade: true` and a `spawn:` grant that includes
  `athletic: [reviewer]` (the BOB-69 check in step 7 spawns athletic/reviewer through `spawn_worker`).
- The existing `poe@mbp-1` entry only covers BobNet JSON that poe sends by hand to `supervisor@ubu1`. Leave it
  as it is; it isn't needed for anything here, and it gets no `upgrade: true`.
- Both keys can stay. Only `supervisor@mbp-1` is required.

Back up first:
```sh
cp ~/.config/bobnet/supervisor.yaml ~/.config/bobnet/supervisor.yaml.bak-2026-11-21-rc44
```
Then edit `~/.config/bobnet/supervisor.yaml`:
- Add a top-level `upgrade:` section (if there is one already, stop and report):
  ```yaml
  upgrade:
    repo: ~/.local/share/bobnet/.src.git
  ```
- Under `remote:`, add a `supervisor@mbp-1` entry (or, if one exists, change it). Its `spawn:` is the same
  project-to-roles map the `poe@mbp-1` entry has today, with `reviewer` in `athletic`'s list (add `athletic:
  [reviewer]` if `athletic` isn't there), plus `upgrade: true`. For example, if `poe@mbp-1` has
  `spawn: { athletic: [reviewer] }`:
  ```yaml
  remote:
    poe@mbp-1: { spawn: { athletic: [reviewer] } }                    # unchanged
    supervisor@mbp-1: { spawn: { athletic: [reviewer] }, upgrade: true }
  ```
  Every project and role named must exist in this config, or the check below names it.

Don't restart yet: step 7's rule needs a restart too, and step 8 does one for both. Check the config:
```sh
( set -a; . ~/.config/bobnet/supervisor.env; set +a
  node ~/.local/share/bobnet/current/packages/supervisor/src/bin.ts check )
```
Expect `ok: 2.0.0-rc.44 …`. If not, restore the backup and report.

## 7. The bob44-probe rule (for BOB-69 AC 6, the real-broker check; ADR 0007 §4 "Proven where")

Back up first:
```sh
cp ~/.config/bobnet/policy.yaml ~/.config/bobnet/policy.yaml.bak-2026-11-21-rc44
```
Add this as the **first** item of the top-level `rules:` list in `~/.config/bobnet/policy.yaml` (first, so no
earlier rule settles the call before it):
```yaml
  - id: bob44-probe
    roles: [reviewer]
    projects: [athletic]
    tools: [Bash]
    command: "^echo bob44-probe$"
    decision: escalate
    tier: orchestrator
    reason: BOB-44 real-broker check
```
It makes only the exact command `echo bob44-probe`, run by athletic's reviewer, ask mbp-1's orchestrator. Nothing
else changes. Run step 6's `bin.ts check` again: expect `ok`.

## 8. Restart for steps 6 and 7 (when ubu1 is idle)
```sh
systemctl --user restart bobnet-supervisor
journalctl --user -u bobnet-supervisor -n 30   # "supervisor ready"
```
If it doesn't start: restore both `.bak-2026-11-21-rc44` files, restart again, and report.

Then tell Casper (he passes it to poe@mbp-1) that ubu1 runs rc.44 with the `upgrade:` section, the
`supervisor@mbp-1` grant and the probe rule. The session on ubu1 is done.

## After: poe@mbp-1, not this session
- poe runs the BOB-69 AC 6 check from mbp-1 (spawn athletic/reviewer on ubu1, `echo bob44-probe` twice, allow
  then deny). The steps and expected output are in ADR 0007 §4 "Proven where".
- The probe rule then comes out of `policy.yaml` (restore the backup, or delete the item) with a restart. That needs
  someone on ubu1 again. It can wait: the rule only makes `echo bob44-probe` by athletic's reviewer ask mbp-1.
- Later releases (rc.45 on) reach ubu1 with `upgrade_supervisor`, mbp-1 first.

The same setup on mbp-1 is the `upgrade:` section only, with no grant. poe added it on 2026-11-21; it goes live
at mbp-1's next restart (the rc.45 install).
