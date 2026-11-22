# rc.48 (v2.0.0-rc.48): BOB-123 supervisor-run disk cleanup

## What's in it (since rc.47)
- BOB-123 da5a618 (Luigi; reviewed by Mario): a disk cleanup per laptop and project, from config.
  - It runs daily at `cleanup.schedule`, below `floor_gib` (at most once per `floor_min_interval`), and on demand
    with the `cleanup {dry_run?, project?}` MCP tool. A remote call needs `remote.<sender>.cleanup: true` and is a
    dry run unless it passes `dry_run: false`.
  - Steps per project: worktrees, ignored (globs; default .turbo, dist, test-results, .wrangler), paths, docker,
    playwright, pnpm-store, old-pnpm-stores, runner. The supervisor's worker logs rotate by `logs.keep_days` /
    `keep_mb`.
  - helix-navigator-maps' pipeline cache/ and out/ are never cleaned, by Casper's ruling.
  - Safety rules are listed in lead/bob123/plan.md. An unknown step fails supervisor start.
  - LaptopSnapshot.cleanup is an optional field. The broker that keeps it and the dashboard that shows it on the
    laptop row are deployed (3f073ee0).
- Known minor: BOB-125. A pruned worktree's gitignored files (.env, say) go with it.

## How each laptop gets it
- poe rolls it with `upgrade_supervisor {tag: "v2.0.0-rc.48"}`. With no `cleanup` config, nothing runs except an
  on-demand call.
- Config is Casper's, staged by poe. Luigi's example is in his handoff (w_188391dd.md). Read a dry run first
  (`cleanup {dry_run: true}`) before the first real run.
- **Check**: `supervisor@<laptop>` reports 2.0.0-rc.48. The dashboard's laptop row says "No cleanup yet" until
  the first run.
