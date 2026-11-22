# BOB-123: supervisor-run disk cleanup, every laptop and project (Mario)

Casper, via poe 2026-11-21: "I'm tired of constantly cleaning up diskspace. ... In fact we should do that on all our
projects then". mbp-1's data volume was at 96-98%.

## Design (advisory: Toad c_425d73b6; becomes ADR 0009 if Toad records it)

- **Config** (Casper's; poe stages it): supervisor.yaml gets `cleanup: {schedule, floor_gib, floor_min_interval}`.
  Each project gets an optional `cleanup:` list of steps from a fixed set: `worktrees`, `ignored` (globs relative
  to the repo; default .turbo, dist, test-results, .wrangler), `docker`, `playwright`, `pnpm-store`, `paths` (extra
  ignored dirs). Nothing runs unless it's listed. An unknown step fails supervisor start with a clear message.
- **Worktrees**: one is pruned only if:
  - no live or queued worker uses it, and it isn't a standing role worktree;
  - its tree is clean;
  - its branch is an ancestor of the line (`merge-base --is-ancestor`).
  Removal is `git worktree remove` without --force, never rm -rf.
- **Ignored paths**: resolved with realpath, inside the repo root, confirmed by `git check-ignore`. Never a
  worktree root, never a path holding `.git`. Config `paths` must be gitignored too. If one isn't, it goes in
  .gitignore, not in an exception list.
- **docker, playwright, pnpm-store**: each tool's own prune command.
- **Running**:
  - Each step has a timeout that kills its whole process group. One failed step is recorded and the rest go on.
  - A run takes the run slot with a bounded wait. If it can't get the slot, it records "skipped: busy" and
    retries at the next tick.
  - The floor trigger has a minimum interval.
  - freed_bytes is the change in free space, and null when unknown.
- **On demand**: an MCP tool `cleanup {dry_run?, project?}`. It's remote-capable, under ADR 0007 §7's grants next
  to `upgrade`. A remote call is a dry run by default.
- **Report**: `LaptopSnapshot.cleanup` (protocol frames.ts) is optional and nullable, with .max() bounds, so no
  protocol bump. The broker keeps the last cleanup next to the snapshot. The dashboard shows it on the laptop
  row; null reads as "no cleanup yet".
- **Tests**: a dry-run test whose git fixtures include a live worker's worktree, an unmerged branch, a dirty
  tree, an ignored symlink pointing out of the repo, and a role folder.

## Order
Peach writes the criteria. Luigi builds it. Mario reviews and deploys the broker first (it only keeps the field),
then cuts the supervisor rc. poe rolls the rc and stages the config.

## Measured, 2026-11-21 22:40 (Mario; poe's question "if node_modules isn't it, why is ~/Code 59 GB?")
- node_modules are APFS clones of the pnpm store (`~/Library/pnpm/store/v11`, same volume, `nodeLinker: isolated`,
  import method auto). Test: a fresh `pnpm install --frozen-lockfile --offline` of this repo into /tmp: `du` shows
  776 MB of node_modules, `df` dropped 6 MB. So deleting a worktree's node_modules frees about 1% of what du shows. No
  switch to hardlinks or the global virtual store is needed; it would free nothing more.
  (Deleting an idle helix worktree's node_modules to measure was refused by the auto-mode classifier. The scratch
  install measures the same import from the same store; the helix worktrees record the same storeDir.)
- ~/Code without node_modules: 26.7 GB, of which helix-navigator-maps' services/read/maps/pipeline/cache is 13.1 GB and
  pipeline/out is 1.8 GB. Both are gitignored, so BOB-123's `ignored`/`paths` step can clean them once helix's config
  lists them. Next: landmanagement-features 2.3 GB, land-v5 0.7 GB, and everything else under 0.6 GB. The helix
  worktrees share one .git (517 MB in helix-navigator).
- **Casper's ruling** (via poe, 2026-11-21 ~22:2x, "it won't work"): the cleanup never touches helix-navigator-maps'
  pipeline/cache or pipeline/out, even though they're gitignored. They stay out of helix's paths list. The default
  `ignored` globs stay narrow (.turbo, dist, test-results, .wrangler), and `ignored` deletes only what its globs match,
  never every ignored path. A test keeps a gitignored cache/ and out/. The 15 GB stays; the close says so.
