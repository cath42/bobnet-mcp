# BOB-44 review A-fixes-4 (2026-11-21)

Reviewed v2 692d757 (BOB-89, `protocol/src/secrets.ts`) and a5ed7dd (BOB-83, the remote supervisor upgrade, ADR 0008).
Two reviewers:
- Toad, protocol and supervisor: `architecture/reviews/2026-11-21-bob44-a-fixes-4.md` (aabec16), plus ADR 0008
  "Rulings, BOB-83 build". 0 blockers, 1 major, 3 minors.
- An independent reviewer (Mario's subagent, fresh context, read-only): 0 blockers, 0 majors, 5 minors. 1.4M fuzzed
  texts (0 leaks, 0 idempotence failures), 33 adversarial shapes at 200 KB and 800 KB (all linear, worst 6.8 ms /
  27.7 ms), 8 MB with 500k matches without a throw. typecheck clean; supervisor 427/427, protocol 133/133.
- (Both first runs died at the usage limit at ~01:00 and were re-run after its reset.)

**Result: 1 major, fixed without code for rc.42 (the release notes put the upgrade clone under `<root>`). rc.42: go.
BOB-80's broker deploy: go, laptops first. The broker diff since bb51add is empty and `findSecret` is unchanged.**

## Major

### M1. The upgrade clone is code the supervisor runs, and workers can write it (Toad)
- `upgrade.repo`'s `.git/config` (`remote.origin.url`, `core.sshCommand`, `credential.helper`) decides what the
  supervisor fetches and runs. The draft notes put it at `~/Code/bobnet-releases.git`, outside the guard.
- **rc.42 (done here, no code):** the notes now say a bare clone at `~/.local/share/bobnet/.src.git`, under `<root>`,
  which the guard already denies every worker. The fetch test points at it.
- **Next build:** `bin.ts` adds `config.upgrade?.repo` to the guard's roots (one line and a test; ADR 0008 ruling 5).
  This is a task of BOB-83.
- The independent reviewer's minor 2 is the same root cause: `git archive` re-resolves the tag after the
  check (TOCTOU). Under `<root>` no worker can move it. Pinning the archive to the verified SHA
  (`rev-parse refs/tags/<tag>^{commit}` once) goes into the same task.

## Minors (backlog)
1. **The start-edge walk is quadratic for a mark that starts with a word character.**
   - Found by both: Toad m1, and the independent reviewer's latent minor. This rules on my hunch.
   - Not reachable today: the only mark, `WITHHELD`, starts with `[`.
   - Toad has a tested fix. It goes in with the next touch of `secrets.ts` (BOB-90).
2. **A second local upgrade can race the first one's restart.**
   - Found by both: Toad m2, and the independent reviewer reproduced it.
   - Only this laptop's own orchestrator can hit it.
   - Fix: after the verify, refuse if `current` is no longer waiting.
3. **A restart mid-install reports nothing and leaves `.<tag>.partial`** (Toad m3, Luigi's open question 1).
   - Fix: an `installing` row, which `resume()` fails.
4. **The policy guard is a substring check** (independent).
   - It doesn't catch case (`BOBNET` on APFS), `"$HOME"/…`, `//` or `cd` + a relative path.
   - The workers' sandbox `allowWrite` is the real enforcement. The config folder has had the same weakness all along.
5. **The grant is only as strong as laptop authentication** (independent).
   - A process holding the laptop credential can register `supervisor@mbp-1` while the real one is offline.
   - Same trust model as `spawn`. No action beyond noting it.
6. **Small robustness points** (independent):
   - `exec` merges stderr into what `show()` parses as JSON.
   - verify's four git calls can take up to 4×60 s against the requester's 90 s wait.
   - A spawn or slot run that starts in the ≤15 s drain is cut, even under `when_idle`.

## Luigi's open questions (Toad)
- Restart mid-install: minor 3.
- pnpm `.bin` shims after the rename: fine, tested. They run through `$basedir`, and the supervisor doesn't use them.
- Service env: fine. `servicePath` puts node first, then the installing shell's PATH. With no pnpm the op is refused,
  saying so. With no prompt-free auth the fetch fails within 60 s and says why.

## Checked and fine
- BOB-89: Toad's cursor as sketched. Output identical to bb51add. Push loop. `findSecret`, PATTERNS, ASSIGNMENT and BLOCKS
  unchanged. The A-fixes-3 M1 chain at 200 KB: 6.0 ms (was 16.3 s).
- BOB-83 against every section of ADR 0008:
  - **Grant:** on the broker-stamped sender, off by default. Every request audited.
  - **The tool:** refused for a lead and left out of lead-tools.
  - **The tag:** anchored `UPGRADE_TAG` on the wire, in the tool and in `ask()`.
  - **Fetch:** forced, then the ancestry check on `^{commit}`, the version and `upgradable`.
  - **Switch:** the release's own `check` first, then an atomic symlink rename. The row is written before the switch. Exit 75 only after it.
  - **After the restart:** `ready`, or "running X, not Y".
  - **Wire:** additive. rc.41's fixture refuses the op cleanly.

## Next
- Peach:
  - One task of BOB-83: `upgrade.repo` in the guard's roots, and the archive pinned to the verified SHA.
  - Backlog tasks: minors 2, 3 and 6, and minor 4 (guard by realpath and case).
  - Minor 1 joins BOB-90.
- Mario: cut rc.42 and install it on mbp-1, including `<root>/.src.git`. Then poe restarts. ubu1 is Casper's hand install
  (`lead/bob44/rc42-ubu1-install.md`).
- BOB-80's broker deploy, once both laptops run rc.42: a window from poe, then Mario deploys.
