# BOB-123 build A: close (Mario, 2026-11-21)

- Built by Luigi in da5a618 and reviewed by Mario. I read cleanup.ts's worktree, ignored/paths, old-pnpm-stores,
  runner and logs steps, and the phone screenshot. The criteria map to tests as Luigi listed them in
  supervisor/test/cleanup.test.ts: AC1 triggers, AC2 config, AC3 worktree/ignored, AC4 dry run, AC5 failure, timeout
  and busy, AC7 old stores, AC8 logs, AC9 runner, AC10 Playwright, AC11 maps never cleaned. AC6 is protocol, broker
  and dashboard tests plus shots bob123-laptops-390/-1440.
- Minor, filed: BOB-125. A pruned worktree's gitignored files (.env, say) go with it.
- Broker deployed from code identical to da5a618: version 3f073ee0-160c-4694-bd43-6db7833e464f.
- Supervisor release v2.0.0-rc.48 at a32457c on origin/v2, tag pushed. Notes: lead/bob123/rc48-notes.md. poe rolls it.
- Nothing runs until Casper's config lists steps (poe stages it; example in Luigi's handoff w_188391dd.md). Read a
  dry run (`cleanup {dry_run: true}`) before the first real run.

## Measured (poe's "if node_modules isn't it, why is ~/Code 59 GB?")
- node_modules are APFS clones of the pnpm store. A fresh offline install of this repo showed 776 MB in du and
  6 MB in df. Deleting them, or switching to hardlinks or the global virtual store, frees nearly nothing, so pnpm
  is unchanged. The classifier refused deleting an idle helix worktree's node_modules; the scratch install measures
  the same store.
- ~/Code without node_modules is 26.7 GB. Of that, helix-navigator-maps' pipeline/cache is 13.1 GB and pipeline/out
  is 1.8 GB. **Those stay, by Casper's ruling** ("it won't work"): the cleanup never touches them, as built in
  NEVER_CLEAN and tested (AC11). Next are landmanagement-features at 2.3 GB and land-v5 at 0.7 GB.
- What the cleanup can free, by poe's measurements (portfolio-orchestrator/research/disk-2026-11-21.md):
  pnpm store v3 1.0 GB, logs about 1 GB, runner _update/_tool about 0.6-0.9 GB, Playwright about 0.5 GB, and docker
  prune (compaction not in scope).
