import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { CleanupReport } from "@bobnet/protocol";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Cleanup, type CleanupDeps, globMatcher, runCommand } from "../src/cleanup.ts";
import { checkCleanupPaths, gitIgnores, parseSupervisorConfig, type ProjectConfig } from "../src/config.ts";
import { GhCiPoll } from "../src/ci-poll.ts";
import { callTool, handlers, ORCHESTRATOR_ONLY } from "../src/mcp.ts";
import { Policy } from "../src/policy.ts";
import { RunSlots } from "../src/slots.ts";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { fakeQuery, quiet, testConfig, until } from "./fakes.ts";
import { FakeNetwork } from "./network.ts";

/** A fixture test runs many git commands: room for a laptop loaded by a CI runner. */
const SLOW = { timeout: 60_000 };

// BOB-123: the supervisor's disk cleanup. Every repository here is a git fixture in a temp folder,
// and every prune command a stand-in (`true`, `sh -c ...`): nothing touches a real folder, docker,
// Playwright or the pnpm store, and nothing runs against this laptop.

const dirs: string[] = [];
const temp = (prefix = "bobnet-cleanup-") => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const write = (path: string, text = "x".repeat(5000)) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

/** Stand-ins for the prunes: each succeeds and does nothing. */
const NO_PRUNES = { docker: ["true"], "pnpm-store": ["true"] };
/** Nothing outside a fixture: no Playwright registry, no pnpm store, no processes. */
const NOWHERE = { playwrightDir: "/nonexistent/bobnet-test/ms-playwright", pnpmStorePath: async () => null, processes: async () => [] };

/**
 * A repository with every case AC 3 names, and what the run may remove: worktrees under .worktrees/
 * (ignored), each on its branch; ignored build output, Casper's cache/ and out/, a symlink out of the
 * repository, a tracked file under a dist, an ignored folder holding a .git.
 */
function fixture() {
  const base = temp();
  const repo = join(base, "repo");
  const outside = join(base, "outside");
  mkdirSync(repo);
  write(join(outside, "precious.txt"), "not the repository's");
  git(repo, "init", "-q", "-b", "main");
  write(join(repo, ".gitignore"), ["dist", ".turbo/", "cache/", "out/", ".worktrees/", "linked", "scratch/", ""].join("\n"));
  write(join(repo, "README.md"), "tracked");
  write(join(repo, "lib/dist/keep.txt"), "tracked under a dist");
  git(repo, "add", ".gitignore", "README.md");
  git(repo, "add", "-f", "lib/dist/keep.txt");
  git(repo, "commit", "-q", "-m", "one");
  // The line: origin/main, as a remote-tracking ref with no remote to fetch.
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  const wt = (name: string) => join(repo, ".worktrees", name);
  for (const name of ["merged", "live", "role", "dirty", "unmerged"]) git(repo, "worktree", "add", "-q", "-b", name, wt(name), "main");
  write(join(wt("dirty"), "README.md"), "changed");
  write(join(wt("unmerged"), "new.txt"), "unmerged work");
  git(wt("unmerged"), "add", "new.txt");
  git(wt("unmerged"), "commit", "-q", "-m", "not on the line");
  write(join(wt("live"), "dist/app.js"));
  write(join(wt("live"), "packages/ui/src.ts"));
  // Ignored output the default globs clear, and what they never do (Casper: pipeline/cache and pipeline/out).
  write(join(repo, "dist/app.js"));
  write(join(repo, "packages/web/dist/index.js"));
  write(join(repo, ".turbo/cache.log"));
  write(join(repo, "lib/dist/gen.js"));
  write(join(repo, "services/read/maps/pipeline/cache/tiles.bin"));
  write(join(repo, "services/read/maps/pipeline/out/maps.pmtiles"));
  write(join(repo, "scratch/tmp.bin"));
  // An ignored dist that is a symlink out of the repository, and an ignored folder holding a .git.
  symlinkSync(outside, join(repo, "packages/web/linked"));
  mkdirSync(join(repo, "packages/api"), { recursive: true });
  symlinkSync(outside, join(repo, "packages/api/dist"));
  git(repo, "init", "-q", join(repo, "packages/nested/.turbo"));
  return { base, repo, outside, wt };
}

/** Every path under `root`, with its size or link target: what "nothing changed" compares. */
function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    const st = lstatSync(p);
    out.push(`${p.slice(root.length)} ${st.isSymbolicLink() ? `-> ${readlinkSync(p)}` : st.isDirectory() ? "dir" : st.size}`);
    if (st.isDirectory() && !st.isSymbolicLink()) for (const e of readdirSync(p).sort()) walk(join(p, e));
  };
  walk(root);
  return out;
}

const projectYaml = (repo: string, steps: string) => `
orchestrator: Bob
projects:
  fix:
    path: ${repo}
    cleanup: ${steps}
    roles:
      ann: { dir: ${repo}/.worktrees/role/packages }
`;

/** The fixture project, as config, and a Cleanup over it with the live worker in .worktrees/live. */
function cleanupFor(repo: string, steps = "[worktrees, ignored, docker, playwright, pnpm-store]", over: Partial<CleanupDeps> = {}) {
  const config = parseSupervisorConfig(projectYaml(repo, steps), (d) => d);
  const records: CleanupReport[] = [];
  const commands: string[][] = [];
  const cleanup = new Cleanup({
    projects: () => [...config.projects.values()],
    config: undefined,
    busyDirs: () => [join(repo, ".worktrees/live/packages/ui")],
    standingDirs: () => [...config.projects.get("fix")!.roles.values()].map((r) => r.dir),
    acquireSlot: async () => () => {},
    record: (r) => records.push(r),
    log: quiet,
    commands: NO_PRUNES,
    ...NOWHERE,
    run: (command, cwd, signal) => {
      commands.push(command);
      return runCommand(command, cwd, signal);
    },
    ...over,
  });
  return { cleanup, records, commands, config };
}

describe("config: each project's steps (AC 2)", () => {
  const parse = (steps: string, top = "") => parseSupervisorConfig(`orchestrator: Bob\n${top}projects:\n  p:\n    path: /work/p\n    cleanup: ${steps}\n    roles: { a: { dir: /work/p/a } }\n`, (d) => d);

  it("reads the fixed set, with ignored's defaults and worktrees' line from the land target", () => {
    const p = parse("[worktrees, ignored, docker, playwright, pnpm-store, { paths: [services/cache] }]").projects.get("p")!;
    expect(p.cleanup).toEqual([
      { step: "worktrees", line: "origin/main" },
      { step: "ignored", globs: [".turbo", "dist", "test-results", ".wrangler"] },
      { step: "docker", volumes: false },
      { step: "playwright" },
      { step: "pnpm-store" },
      { step: "paths", paths: ["services/cache"] },
    ]);
    expect(parse("[old-pnpm-stores, { docker: { volumes: true } }, { runner: [~/actions-runner, /opt/runner] }]").projects.get("p")!.cleanup).toEqual([
      { step: "old-pnpm-stores" },
      { step: "docker", volumes: true },
      { step: "runner", dirs: [join(homedir(), "actions-runner"), "/opt/runner"] },
    ]);
    expect(parse("[{ ignored: [dist] }, { worktrees: { line: origin/v2 } }]").projects.get("p")!.cleanup).toEqual([{ step: "ignored", globs: ["dist"] }, { step: "worktrees", line: "origin/v2" }]);
  });

  it("runs nothing that isn't listed: no cleanup, no steps", () => {
    const c = parseSupervisorConfig(`orchestrator: Bob\nprojects:\n  p:\n    path: /work/p\n    roles: { a: { dir: /work/p/a } }\n`, (d) => d);
    expect(c.projects.get("p")!.cleanup).toEqual([]);
    expect(c.cleanup).toBeUndefined();
  });

  it.each([
    ["an unknown step", "[worktrees, git-clean]", 'p.cleanup: unknown step "git-clean"; the steps are worktrees, ignored, paths, docker, playwright, pnpm-store, old-pnpm-stores, runner'],
    ["a step listed twice", "[docker, docker]", 'p.cleanup: step "docker" is listed twice'],
    ["a path outside the repository", "[{ paths: [../elsewhere] }]", 'p.cleanup.paths: "../elsewhere" must be a path inside the repository'],
    ["an absolute path", "[{ paths: [/Users/x] }]", 'p.cleanup.paths: "/Users/x" must be a path inside the repository'],
    ["settings on a prune", "[{ pnpm-store: [all] }]", "p.cleanup.pnpm-store: takes no settings"],
    ["docker with an unknown setting", "[{ docker: { images: all } }]", "p.cleanup.docker: takes only volumes: true or false"],
    ["a relative runner folder", "[{ runner: [actions-runner] }]", 'p.cleanup.runner: "actions-runner" must be an absolute path (or start with ~/)'],
    ["paths without any", "[{ paths: [] }]", "p.cleanup.paths: must list paths"],
  ])("refuses %s, naming it", (_what, steps, message) => {
    expect(() => parse(steps)).toThrow(message);
  });

  it("reads the laptop's schedule, floor and interval, and refuses a bad one", () => {
    const c = parse("[docker]", "cleanup: { schedule: '03:30', floor_gib: 20, floor_min_interval: 6h }\n").cleanup!;
    expect(c).toEqual({ schedule: "03:30", floorBytes: 20 * 2 ** 30, floorMinIntervalMs: 6 * 3_600_000, stepTimeoutMs: 30 * 60_000, slotWaitMs: 10 * 60_000, logs: { keepMs: 14 * 86_400_000, keepBytes: 1024 * 2 ** 20 } });
    expect(() => parse("[docker]", "cleanup: { schedule: '3am' }\n")).toThrow(/must be HH:MM/);
    expect(() => parse("[docker]", "cleanup: { floor_min_interval: soon }\n")).toThrow(/must be a number and m, h or d/);
  });

  it("reads the logs' age and size to keep, or logs: false (AC 8)", () => {
    expect(parse("[docker]", "cleanup: { logs: { keep_days: 7, keep_mb: 200 } }\n").cleanup!.logs).toEqual({ keepMs: 7 * 86_400_000, keepBytes: 200 * 2 ** 20 });
    expect(parse("[docker]", "cleanup: { logs: { keep_days: 3 } }\n").cleanup!.logs).toEqual({ keepMs: 3 * 86_400_000, keepBytes: 1024 * 2 ** 20 });
    expect(parse("[docker]", "cleanup: { logs: false }\n").cleanup!.logs).toBeNull();
    expect(() => parse("[docker]", "cleanup: { logs: { keep_days: -1 } }\n")).toThrow();
  });

  it("grants a remote cleanup only with cleanup: true", () => {
    const c = parseSupervisorConfig(`orchestrator: Bob\nprojects: {}\nremote:\n  supervisor@mbp-1: { cleanup: true }\n  supervisor@mbp-2: { upgrade: true }\n`, (d) => d);
    expect([...c.remoteCleanup]).toEqual(["supervisor@mbp-1"]);
  });

  it("a path git doesn't ignore fails the start, named; an ignored one passes", SLOW, async () => {
    const { repo } = fixture();
    const ok = parseSupervisorConfig(projectYaml(repo, "[{ paths: [services/read/maps/pipeline/cache] }]"), (d) => d);
    expect(() => checkCleanupPaths(ok, gitIgnores)).not.toThrow();
    const bad = parseSupervisorConfig(projectYaml(repo, "[{ paths: [services/maps] }]"), (d) => d);
    expect(() => checkCleanupPaths(bad, gitIgnores)).toThrow(`fix.cleanup.paths: services/maps isn't ignored by git in ${repo}; add it to .gitignore to clear it`);
    // A tracked file's folder isn't ignored either, though .gitignore names it.
    const tracked = parseSupervisorConfig(projectYaml(repo, "[{ paths: [lib/dist/keep.txt] }]"), (d) => d);
    expect(() => checkCleanupPaths(tracked, gitIgnores)).toThrow("lib/dist/keep.txt isn't ignored");
    // And the supervisor's start stops on it.
    const state = temp();
    const store = new Store(join(state, "supervisor.db"));
    const sup = new Supervisor({ config: { ...bad, stateDir: state }, policy: new Policy("rules: []"), store, broker: new FakeNetwork().link("mbp-1"), queryFn: fakeQuery().queryFn, log: quiet, sandboxCheck: async () => null });
    await expect(sup.start()).rejects.toThrow("fix.cleanup.paths: services/maps isn't ignored by git");
    store.close();
  });

  it("matches ignored's globs as .gitignore does: a bare name at any depth, a path from the root", () => {
    const m = globMatcher(["dist", ".turbo", "apps/*/build", "**/tmp"]);
    expect(["dist", "packages/web/dist", ".turbo", "apps/web/build", "a/b/tmp", "tmp"].every(m)).toBe(true);
    expect(["distx", "cache", "out", "apps/web/x/build", "build", "packages/dist/gen.js"].some(m)).toBe(false);
  });
});

describe("a dry run on the fixtures (AC 4)", () => {
  it("lists each path and prune it would act on, with sizes where known, and changes nothing on disk", SLOW, async () => {
    const f = fixture();
    const { cleanup, records } = cleanupFor(f.repo, "[worktrees, ignored, { paths: [scratch, .worktrees] }, docker, playwright, pnpm-store]");
    const before = tree(f.base);
    const out = await cleanup.run({ trigger: "demand", dryRun: true });
    expect(tree(f.base)).toEqual(before);
    expect(records).toEqual([]);
    const steps = Object.fromEntries(out.projects[0]!.steps.map((s) => [s.step, s]));
    expect(steps["worktrees"]!.actions).toEqual([{ kind: "worktree", target: f.wt("merged"), bytes: expect.any(Number) }]);
    expect(steps["worktrees"]!.actions[0]!.bytes).toBeGreaterThan(0);
    const dirs = steps["ignored"]!.actions.map((a) => a.target).sort();
    expect(dirs).toEqual([join(f.repo, ".turbo"), join(f.repo, "dist"), join(f.repo, "packages/web/dist")]);
    for (const a of steps["ignored"]!.actions) expect(a.bytes).toBeGreaterThan(0);
    expect(steps["paths"]!.actions.map((a) => a.target)).toEqual([join(f.repo, "scratch")]);
    expect(["docker", "pnpm-store"].map((s) => steps[s]!.actions)).toEqual([[{ kind: "command", target: "true", bytes: null }], [{ kind: "command", target: "true", bytes: null }]]);
    // What it keeps, and why.
    const why = (step: string) => Object.fromEntries(steps[step]!.kept.map((k) => [k.path, k.why]));
    expect(why("worktrees")).toEqual({
      [f.wt("live")]: "a live or queued worker uses it",
      [f.wt("role")]: "a standing role's worktree",
      [f.wt("dirty")]: "its tree isn't clean",
      [f.wt("unmerged")]: "unmerged has commits not on origin/main",
    });
    expect({ ...why("ignored"), ...why("paths") }).toEqual({
      [f.wt("live")]: "a live or queued worker uses this worktree",
      [join(f.repo, "packages/api/dist")]: "a symlink",
      [join(f.repo, "packages/nested/.turbo")]: "holds a .git",
      [join(f.repo, ".worktrees")]: "a worktree, or holds one",
      // Casper's ruling (AC 11): listed as kept.
      [join(f.repo, "services/read/maps/pipeline/cache")]: "never cleaned: Casper's ruling, 2026-11-21",
      [join(f.repo, "services/read/maps/pipeline/out")]: "never cleaned: Casper's ruling, 2026-11-21",
    });
  });
});

describe("a real run on the fixtures (AC 3)", () => {
  it("removes only a merged, clean, unused worktree and ignored output, with git worktree remove and never --force", SLOW, async () => {
    const f = fixture();
    const { cleanup, records, commands } = cleanupFor(f.repo, "[worktrees, ignored, { paths: [scratch, .worktrees] }, docker, playwright, pnpm-store]");
    const tracked = git(f.repo, "ls-files").split("\n").filter(Boolean);
    const out = await cleanup.run({ trigger: "demand", dryRun: false });

    // Removed: the merged, clean, unused worktree (its branch kept) and the ignored output the globs name.
    expect(existsSync(f.wt("merged"))).toBe(false);
    expect(git(f.repo, "worktree", "list")).not.toContain(".worktrees/merged");
    expect(git(f.repo, "branch", "--list", "merged")).toContain("merged");
    for (const gone of ["dist", "packages/web/dist", ".turbo", "scratch"]) expect(existsSync(join(f.repo, gone))).toBe(false);
    expect(commands.filter((c) => c.includes("worktree") && c.includes("remove"))).toEqual([["git", "-C", f.repo, "worktree", "remove", f.wt("merged")]]);
    expect(commands.flat()).not.toContain("--force");

    // Kept: every tracked file, the live worker's worktree and its output, the role's, the dirty and the unmerged ones,
    // the symlinks and what they point at, the folder holding a .git, and Casper's cache/ and out/.
    for (const t of tracked) expect(existsSync(join(f.repo, t))).toBe(true);
    for (const name of ["live", "role", "dirty", "unmerged"]) expect(existsSync(join(f.wt(name), "README.md"))).toBe(true);
    expect(existsSync(join(f.wt("live"), "dist/app.js"))).toBe(true);
    expect(existsSync(join(f.wt("dirty"), "README.md"))).toBe(true);
    expect(git(f.wt("dirty"), "status", "--porcelain")).toContain("README.md");
    expect(existsSync(join(f.wt("unmerged"), "new.txt"))).toBe(true);
    expect(existsSync(join(f.repo, "lib/dist/keep.txt"))).toBe(true);
    expect(existsSync(join(f.repo, "lib/dist/gen.js"))).toBe(true);
    expect(lstatSync(join(f.repo, "packages/api/dist")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(f.outside, "precious.txt"))).toBe(true);
    expect(existsSync(join(f.repo, "packages/nested/.turbo/.git"))).toBe(true);
    expect(existsSync(join(f.repo, "services/read/maps/pipeline/cache/tiles.bin"))).toBe(true);
    expect(existsSync(join(f.repo, "services/read/maps/pipeline/out/maps.pmtiles"))).toBe(true);

    // Recorded: each step ok, what it acted on counted.
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ trigger: "demand", skipped: null, projects: [{ project: "fix", steps: [
      { step: "worktrees", ok: true, acted: 1 },
      { step: "ignored", ok: true, acted: 3 },
      { step: "paths", ok: true, acted: 1 },
      { step: "docker", ok: true, acted: 1 },
      { step: "playwright", ok: true, acted: 0, skipped: "no Playwright browsers in /nonexistent/bobnet-test/ms-playwright" },
      { step: "pnpm-store", ok: true, acted: 1 },
    ] }] });
    expect(out.report).toEqual(records[0]);
  });

  it("never cleans helix-navigator-maps' pipeline cache/ and out/, by ignored or by paths: kept in a real run, listed as kept in a dry run (AC 11)", SLOW, async () => {
    const f = fixture();
    const kept = (step: { kept: Array<{ path: string; why: string }> }) => step.kept.filter((k) => k.why.startsWith("never cleaned")).map((k) => k.path.slice(f.repo.length + 1));
    // A paths entry naming them, and a glob that would match them, change nothing.
    for (const steps of ["[ignored]", "[{ ignored: [cache, out, dist] }]", "[{ paths: [services/read/maps/pipeline/cache, services/read/maps/pipeline/out, services/read/maps] }]"]) {
      const { cleanup } = cleanupFor(f.repo, steps);
      const dry = await cleanup.run({ trigger: "demand", dryRun: true });
      expect(kept(dry.projects[0]!.steps[0]!)).toEqual(["services/read/maps/pipeline/cache", "services/read/maps/pipeline/out"]);
      await cleanup.run({ trigger: "schedule", dryRun: false });
      expect(existsSync(join(f.repo, "services/read/maps/pipeline/cache/tiles.bin"))).toBe(true);
      expect(existsSync(join(f.repo, "services/read/maps/pipeline/out/maps.pmtiles"))).toBe(true);
    }
    // The dist beside them went.
    expect(existsSync(join(f.repo, "dist"))).toBe(false);
  });

  it("freed_bytes is the change in free space, null (never 0) when it can't be read", SLOW, async () => {
    const f = fixture();
    let free = 100;
    const known = cleanupFor(f.repo, "[docker]", { freeBytes: async () => (free += 50) });
    const r = (await known.cleanup.run({ trigger: "demand", dryRun: false })).report!;
    // project before 150, step before 200, step after 250, project after 300.
    expect(r.projects[0]!.steps[0]!.freed_bytes).toBe(50);
    expect(r.projects[0]!.freed_bytes).toBe(150);
    expect(r.freed_bytes).toBe(150);
    const unknown = cleanupFor(f.repo, "[docker]", { freeBytes: async () => null });
    const u = (await unknown.cleanup.run({ trigger: "demand", dryRun: false })).report!;
    expect([u.freed_bytes, u.projects[0]!.freed_bytes, u.projects[0]!.steps[0]!.freed_bytes]).toEqual([null, null, null]);
  });
});

describe("failures and the run slot (AC 5)", () => {
  it("a failed step is recorded with its reason and the others still run", SLOW, async () => {
    const f = fixture();
    const { cleanup, records } = cleanupFor(f.repo, "[docker, ignored, pnpm-store]", { commands: { docker: ["sh", "-c", "echo 'Cannot connect to the Docker daemon' >&2; exit 3"], "pnpm-store": ["true"] } });
    await cleanup.run({ trigger: "demand", dryRun: false });
    expect(records[0]!.projects[0]!.steps).toEqual([
      { step: "docker", ok: false, error: "sh -c echo 'Cannot connect to the Docker daemon' >&2; exit 3 exited 3: Cannot connect to the Docker daemon", skipped: null, acted: 1, freed_bytes: expect.anything() },
      { step: "ignored", ok: true, error: null, skipped: null, acted: 3, freed_bytes: expect.anything() },
      { step: "pnpm-store", ok: true, error: null, skipped: null, acted: 1, freed_bytes: expect.anything() },
    ]);
    expect(existsSync(join(f.repo, "dist"))).toBe(false);
  });

  it("a missing command fails its step, named", SLOW, async () => {
    const f = fixture();
    const { cleanup, records } = cleanupFor(f.repo, "[docker]", { commands: { docker: ["bobnet-no-such-command"] } });
    await cleanup.run({ trigger: "demand", dryRun: false });
    expect(records[0]!.projects[0]!.steps[0]).toMatchObject({ ok: false, error: "bobnet-no-such-command: not found" });
  });

  it("a step past its timeout is killed with its whole process group, recorded, and the next step runs", SLOW, async () => {
    const f = fixture();
    const pidFile = join(f.base, "grandchild.pid");
    const { cleanup, records } = cleanupFor(f.repo, "[docker, pnpm-store]", {
      stepTimeoutMs: 1500,
      commands: { docker: ["sh", "-c", `sleep 60 & echo $! > ${pidFile}; wait`], "pnpm-store": ["true"] },
    });
    await cleanup.run({ trigger: "demand", dryRun: false });
    expect(records[0]!.projects[0]!.steps.map((s) => [s.step, s.ok, s.error])).toEqual([["docker", false, "timed out after 1500 ms"], ["pnpm-store", true, null]]);
    // The sleep the shell started in the background went with it.
    const pid = Number(execFileSync("cat", [pidFile], { encoding: "utf8" }).trim());
    await until(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }, 5000);
  });

  it("a run that can't get the run slot in time is recorded 'skipped: busy' and runs at the next tick", SLOW, async () => {
    const f = fixture();
    const slots = new RunSlots({ size: 1, readHold: () => null });
    const release = await slots.acquire("w_land", "Luigi", "land");
    let now = new Date("2026-11-22T02:00:00");
    const { cleanup, records } = cleanupFor(f.repo, "[ignored]", {
      config: { schedule: "03:00", floorBytes: undefined, floorMinIntervalMs: 0, stepTimeoutMs: 60_000, slotWaitMs: 100, logs: null },
      acquireSlot: (signal) => slots.acquire("cleanup", "supervisor", "cleanup", signal),
      now: () => now,
    });
    now = new Date("2026-11-22T03:00:30");
    expect((await cleanup.tick())!.report).toMatchObject({ trigger: "schedule", skipped: "busy", freed_bytes: null, projects: [], steps: [] });
    expect(existsSync(join(f.repo, "dist"))).toBe(true);
    expect(slots.status().queue).toEqual([]);
    // Still busy at the next tick: skipped again.
    now = new Date("2026-11-22T03:05:30");
    expect((await cleanup.tick())!.report).toMatchObject({ skipped: "busy" });
    release();
    now = new Date("2026-11-22T03:10:30");
    expect((await cleanup.tick())!.report).toMatchObject({ trigger: "schedule", skipped: null });
    expect(existsSync(join(f.repo, "dist"))).toBe(false);
    expect(records.map((r) => r.skipped)).toEqual(["busy", "busy", null]);
    // The retry is done; the schedule's next is tomorrow.
    now = new Date("2026-11-22T03:15:30");
    expect(await cleanup.tick()).toBeNull();
  });

  it("a dry run takes no slot", SLOW, async () => {
    const f = fixture();
    const { cleanup } = cleanupFor(f.repo, "[ignored]", { acquireSlot: () => Promise.reject(new Error("no slot for a dry run")) });
    await expect(cleanup.run({ trigger: "demand", dryRun: true })).resolves.toMatchObject({ dry_run: true });
  });
});

describe("the triggers, on a clock with a fake free-space reading (AC 1)", () => {
  const GiB = 2 ** 30;
  const make = (config: CleanupDeps["config"], free: () => number | null) => {
    const f = fixture();
    let now = new Date("2026-11-22T01:00:00");
    const c = cleanupFor(f.repo, "[docker]", { config, now: () => now, freeBytes: async () => free() });
    return { ...c, at: (iso: string) => (now = new Date(iso)) };
  };

  it("schedule: once its time passes, then again the next day", SLOW, async () => {
    const s = make({ schedule: "03:00", floorBytes: undefined, floorMinIntervalMs: 0, stepTimeoutMs: 60_000, slotWaitMs: 1000, logs: null }, () => 500 * GiB);
    s.at("2026-11-22T02:59:00");
    expect(await s.cleanup.tick()).toBeNull();
    s.at("2026-11-22T03:02:00");
    expect((await s.cleanup.tick())!.report!.trigger).toBe("schedule");
    s.at("2026-11-22T03:07:00");
    expect(await s.cleanup.tick()).toBeNull();
    s.at("2026-11-23T03:01:00");
    expect((await s.cleanup.tick())!.report!.trigger).toBe("schedule");
    expect(s.records.map((r) => r.trigger)).toEqual(["schedule", "schedule"]);
  });

  it("floor: below it runs, at most once per interval; above it, never", SLOW, async () => {
    let free = 5 * GiB;
    const s = make({ schedule: undefined, floorBytes: 10 * GiB, floorMinIntervalMs: 6 * 3_600_000, stepTimeoutMs: 60_000, slotWaitMs: 1000, logs: null }, () => free);
    s.at("2026-11-22T10:00:00");
    expect((await s.cleanup.tick())!.report!.trigger).toBe("floor");
    s.at("2026-11-22T10:05:00");
    expect(await s.cleanup.tick()).toBeNull();
    s.at("2026-11-22T15:59:00");
    expect(await s.cleanup.tick()).toBeNull();
    s.at("2026-11-22T16:00:00");
    expect((await s.cleanup.tick())!.report!.trigger).toBe("floor");
    free = 50 * GiB;
    s.at("2026-11-23T10:00:00");
    expect(await s.cleanup.tick()).toBeNull();
    // An unreadable free space never triggers it.
    free = null as unknown as number;
    expect(await s.cleanup.tick()).toBeNull();
    expect(s.records.map((r) => r.trigger)).toEqual(["floor", "floor"]);
  });

  it("without a cleanup section it never runs by itself", SLOW, async () => {
    const s = make(undefined, () => 0);
    s.at("2026-11-22T03:00:00");
    expect(await s.cleanup.tick()).toBeNull();
  });
});

describe("old pnpm stores (AC 7)", () => {
  it("removes an old store version only when it isn't current and no project's .modules.yaml names it", SLOW, async () => {
    const f = fixture();
    const stores = join(f.base, "pnpm/store");
    for (const v of ["v3", "v10", "v11"]) write(join(stores, v, "files/00/blob"));
    // The fixture project's node_modules name v3 as their store; v11 is pnpm's current.
    write(join(f.repo, "node_modules/.modules.yaml"), `"storeDir": "${join(stores, "v3")}"\n"layoutVersion": 5\n`);
    const { cleanup } = cleanupFor(f.repo, "[old-pnpm-stores]", { pnpmStorePath: async () => join(stores, "v11") });
    const dry = (await cleanup.run({ trigger: "demand", dryRun: true })).projects[0]!.steps[0]!;
    expect(dry.actions.map((a) => a.target)).toEqual([join(stores, "v10")]);
    expect(dry.kept).toEqual([
      { path: join(stores, "v11"), why: "the current store" },
      { path: join(stores, "v3"), why: `named by ${join(f.repo, "node_modules/.modules.yaml")}` },
    ]);
    await cleanup.run({ trigger: "demand", dryRun: false });
    expect(["v3", "v10", "v11"].map((v) => existsSync(join(stores, v)))).toEqual([true, false, true]);
    // Named by none: v3 goes too; the current store stays whatever names it.
    rmSync(join(f.repo, "node_modules"), { recursive: true });
    await cleanup.run({ trigger: "demand", dryRun: false });
    expect(["v3", "v11"].map((v) => existsSync(join(stores, v)))).toEqual([false, true]);
  });

  it("removes nothing when pnpm names no current store", SLOW, async () => {
    const f = fixture();
    const stores = join(f.base, "pnpm/store");
    write(join(stores, "v3/files/blob"));
    const { cleanup, records } = cleanupFor(f.repo, "[old-pnpm-stores]", { pnpmStorePath: async () => null });
    await cleanup.run({ trigger: "demand", dryRun: false });
    expect(records[0]!.projects[0]!.steps[0]).toMatchObject({ ok: false, error: "pnpm store path named no store in any project" });
    expect(existsSync(join(stores, "v3"))).toBe(true);
  });
});

describe("the supervisor's own logs (AC 8)", () => {
  const DAY = 86_400_000;
  it("removes logs older than keep_days, then the oldest past keep_mb, never a live worker's open log", SLOW, async () => {
    const f = fixture();
    const logs = join(f.base, "state/logs");
    const now = new Date("2026-11-22T12:00:00Z");
    const log = (name: string, daysOld: number, bytes: number) => {
      const path = join(logs, name);
      write(path, "x".repeat(bytes));
      const t = new Date(now.getTime() - daysOld * DAY);
      utimesSync(path, t, t);
      return path;
    };
    const old = log("helix/w_old.jsonl", 30, 1000);
    const liveOld = log("helix/w_live.jsonl", 40, 50_000);
    const big = log("bobnet/w_big.jsonl", 5, 30_000);
    const young = log("bobnet/w_young.jsonl", 1, 10_000);
    const youngest = log("bobnet/w_now.jsonl", 0, 10_000);
    const { cleanup, records } = cleanupFor(f.repo, "[docker]", {
      logsDir: logs,
      liveLogs: () => [liveOld],
      now: () => now,
      // 14 days, and 30 000 bytes at most once the live one (50 000) is counted: big and young go by size, oldest first.
      config: { schedule: undefined, floorBytes: undefined, floorMinIntervalMs: 0, stepTimeoutMs: 60_000, slotWaitMs: 1000, logs: { keepMs: 14 * DAY, keepBytes: 70_000 } },
    });
    const dry = await cleanup.run({ trigger: "demand", dryRun: true });
    expect(dry.steps[0]!.actions.map((a) => a.target)).toEqual([old, big]);
    expect(dry.steps[0]!.kept).toEqual([{ path: liveOld, why: "a live worker's open log" }]);
    expect([old, liveOld, big, young, youngest].every((p) => existsSync(p))).toBe(true);
    await cleanup.run({ trigger: "schedule", dryRun: false });
    expect([old, liveOld, big, young, youngest].map((p) => existsSync(p))).toEqual([false, true, false, true, true]);
    expect(records[0]!.steps).toEqual([{ step: "logs", ok: true, error: null, skipped: null, acted: 2, freed_bytes: expect.anything() }]);
  });

  it("logs: false leaves them; a project-only run leaves them too", SLOW, async () => {
    const f = fixture();
    const logs = join(f.base, "state/logs");
    write(join(logs, "p/w_1.jsonl"));
    utimesSync(join(logs, "p/w_1.jsonl"), new Date(0), new Date(0));
    const off = cleanupFor(f.repo, "[docker]", { logsDir: logs, config: { schedule: undefined, floorBytes: undefined, floorMinIntervalMs: 0, stepTimeoutMs: 60_000, slotWaitMs: 1000, logs: null } });
    expect((await off.cleanup.run({ trigger: "demand", dryRun: false })).steps).toEqual([]);
    const on = cleanupFor(f.repo, "[docker]", { logsDir: logs });
    expect((await on.cleanup.run({ trigger: "demand", dryRun: false, project: "fix" })).steps).toEqual([]);
    expect(existsSync(join(logs, "p/w_1.jsonl"))).toBe(true);
    // Without a cleanup section, the defaults: 14 days.
    await on.cleanup.run({ trigger: "demand", dryRun: false });
    expect(existsSync(join(logs, "p/w_1.jsonl"))).toBe(false);
  });
});

describe("an actions-runner folder (AC 9)", () => {
  function runnerDir(base: string) {
    const dir = join(base, "actions-runner");
    write(join(dir, "config.sh"), "#!/bin/sh");
    for (const v of ["2.337.0", "2.338.0", "2.338.2"]) {
      write(join(dir, `bin.${v}/Runner.Worker`));
      write(join(dir, `externals.${v}/node/bin/node`));
    }
    symlinkSync(join(dir, "bin.2.338.2"), join(dir, "bin"));
    symlinkSync(join(dir, "externals.2.338.2"), join(dir, "externals"));
    write(join(dir, "_work/_update/bin/Runner.Listener"));
    write(join(dir, "_work/_tool/node/22.0.0/x64/bin/node"));
    write(join(dir, "_work/athletic/athletic/README.md"));
    return dir;
  }

  it("while a job runs from it, removes nothing and says it skipped; idle, removes superseded versions, _update and _tool, and keeps the current one", SLOW, async () => {
    const f = fixture();
    const dir = runnerDir(f.base);
    let procs = [`${dir}/bin/Runner.Listener run --startuptype service`, `${dir}/bin.2.338.2/Runner.Worker spawnclient 103 106`, "/usr/sbin/cfprefsd agent"];
    const { cleanup, records } = cleanupFor(f.repo, `[{ runner: [${dir}] }]`, { processes: async () => procs });
    const before = tree(dir);
    await cleanup.run({ trigger: "schedule", dryRun: false });
    expect(tree(dir)).toEqual(before);
    expect(records[0]!.projects[0]!.steps[0]).toEqual({ step: "runner", ok: true, error: null, skipped: `a runner job is running from ${dir}`, acted: 0, freed_bytes: expect.anything() });

    // Idle: only the listener runs (another runner's job doesn't count).
    procs = [`${dir}/bin/Runner.Listener run --startuptype service`, "/Users/other/actions-runner/bin/Runner.Worker spawnclient 1 2"];
    const dry = (await cleanup.run({ trigger: "demand", dryRun: true })).projects[0]!.steps[0]!;
    expect(dry.actions.map((a) => a.target.slice(dir.length + 1))).toEqual(["bin.2.337.0", "bin.2.338.0", "externals.2.337.0", "externals.2.338.0", "_work/_update", "_work/_tool"]);
    expect(tree(dir)).toEqual(before);
    await cleanup.run({ trigger: "schedule", dryRun: false });
    expect(readdirSync(dir).sort()).toEqual(["_work", "bin", "bin.2.338.2", "config.sh", "externals", "externals.2.338.2"]);
    expect(readdirSync(join(dir, "_work"))).toEqual(["athletic"]);
    expect(existsSync(join(dir, "bin/Runner.Worker"))).toBe(true);
    expect(records[1]!.projects[0]!.steps[0]).toMatchObject({ ok: true, skipped: null, acted: 6 });
  });

  it("a folder that isn't a runner fails the step, named, and is left", SLOW, async () => {
    const f = fixture();
    const { cleanup, records } = cleanupFor(f.repo, `[{ runner: [${f.outside}] }]`);
    await cleanup.run({ trigger: "demand", dryRun: false });
    expect(records[0]!.projects[0]!.steps[0]).toMatchObject({ ok: false, error: `1 of 1 failed: ${f.outside}: isn't an actions-runner folder (no config.sh and bin)` });
    expect(existsSync(join(f.outside, "precious.txt"))).toBe(true);
  });
});

describe("Playwright's browsers (AC 10)", () => {
  it("keeps the builds an installed Playwright needs and removes the rest", SLOW, async () => {
    const f = fixture();
    const registry = join(f.base, "ms-playwright");
    for (const b of ["chromium-1234", "chromium-1243", "chromium_headless_shell-1243", "ffmpeg-1011"]) write(join(registry, b, "INSTALLATION_COMPLETE"));
    // The installed version: in the project's node_modules, as pnpm lays it out, needing 1243 and ffmpeg 1011.
    const pkg = join(f.repo, "node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core");
    write(join(pkg, "browsers.json"), JSON.stringify({ browsers: [
      { name: "chromium", revision: "1243" },
      { name: "chromium-headless-shell", revision: "1243" },
      { name: "ffmpeg", revision: "1011" },
      { name: "webkit", revision: "2200", revisionOverrides: { "mac14": "2100" } },
    ] }));
    const { cleanup } = cleanupFor(f.repo, "[playwright]", { playwrightDir: registry });
    const dry = (await cleanup.run({ trigger: "demand", dryRun: true })).projects[0]!.steps[0]!;
    expect(dry.actions.map((a) => a.target)).toEqual([join(registry, "chromium-1234")]);
    expect(dry.actions[0]!.bytes).toBeGreaterThan(0);
    expect(dry.kept.map((k) => k.path.slice(registry.length + 1))).toEqual(["chromium-1243", "chromium_headless_shell-1243", "ffmpeg-1011"]);
    await cleanup.run({ trigger: "demand", dryRun: false });
    expect(readdirSync(registry).sort()).toEqual(["chromium-1243", "chromium_headless_shell-1243", "ffmpeg-1011"]);
  });

  it("keeps what a linked installation elsewhere needs, and everything when it finds none installed", SLOW, async () => {
    const f = fixture();
    const registry = join(f.base, "ms-playwright");
    for (const b of ["chromium-1234", "chromium-1243"]) write(join(registry, b, "INSTALLATION_COMPLETE"));
    const { cleanup } = cleanupFor(f.repo, "[playwright]", { playwrightDir: registry });
    expect((await cleanup.run({ trigger: "demand", dryRun: true })).projects[0]!.steps[0]!).toMatchObject({ actions: [], skipped: "no installed Playwright found, so every browser build is kept" });
    // A runner's checkout ran `playwright install`: its link names its package, which needs 1234.
    const other = join(f.base, "elsewhere/node_modules/playwright-core");
    write(join(other, "browsers.json"), JSON.stringify({ browsers: [{ name: "chromium", revision: "1234" }] }));
    write(join(registry, ".links/abc"), other);
    await cleanup.run({ trigger: "demand", dryRun: false });
    expect(readdirSync(registry).sort()).toEqual([".links", "chromium-1234"]);
  });
});

describe("on the supervisor: the tool, the remote default and the report (AC 1, AC 6)", () => {
  const running: Supervisor[] = [];
  const stores: Store[] = [];
  afterEach(async () => {
    for (const s of running.splice(0)) await s.shutdown();
    for (const s of stores.splice(0)) s.close();
  });

  async function boot(net: FakeNetwork, laptop: string, over: string, dir = temp()) {
    const store = new Store(join(dir, "supervisor.db"));
    stores.push(store);
    const link = net.link(laptop);
    const sup = new Supervisor({
      config: testConfig(dir, over),
      policy: new Policy("rules: []"),
      store,
      broker: link,
      queryFn: fakeQuery().queryFn,
      log: quiet,
      sandboxCheck: async () => null,
      ownerCheck: async () => false,
      sleep: net.sleep,
      ciPoll: new GhCiPoll(quiet, async () => {
        throw new Error("no gh in tests");
      }),
      cleanup: { commands: NO_PRUNES, freeBytes: async () => 1000, ...NOWHERE },
    });
    link.onPush = (f) => sup.onPush(f);
    await sup.start();
    running.push(sup);
    return { sup, store, link, dir };
  }

  const fixProject = (repo: string) => `  fix:
    path: ${repo}
    cleanup: [worktrees, ignored, docker]
    roles:
      ann: { dir: ${repo}/.worktrees/role/packages }
`;

  async function call(h: ReturnType<typeof handlers>, name: string, args: Record<string, unknown> = {}) {
    const r = await callTool(h, name, args);
    const text = r.content[0]!.text;
    if (r.isError) throw new Error(text);
    return JSON.parse(text) as Record<string, unknown>;
  }

  it("on this laptop, cleanup runs for real (or dry when asked), and the snapshot carries the last real one, kept across a restart", SLOW, async () => {
    const f = fixture();
    const net = new FakeNetwork();
    const a = await boot(net, "mbp-1", fixProject(f.repo));
    expect(a.sup.snapshot().cleanup).toBeNull();
    const before = tree(f.base);
    const dry = await call(handlers(a.sup), "cleanup", { dry_run: true });
    expect(dry).toMatchObject({ laptop: "mbp-1", dry_run: true, trigger: "demand", projects: [{ project: "fix", steps: [{ step: "worktrees", would: [{ path: f.wt("merged") }] }, { step: "ignored" }, { step: "docker", would: [{ command: "true", bytes: null }] }] }] });
    expect(tree(f.base)).toEqual(before);
    expect(a.sup.snapshot().cleanup).toBeNull();

    const real = await call(handlers(a.sup), "cleanup", { project: "fix" });
    expect(real).toMatchObject({ laptop: "mbp-1", dry_run: false, trigger: "demand", skipped: null, freed_bytes: 0 });
    expect(existsSync(f.wt("merged"))).toBe(false);
    // The live worker's worktree is in .worktrees/live: no worker runs here, but the role's is standing.
    expect(existsSync(f.wt("role"))).toBe(true);
    const snap = a.sup.snapshot().cleanup!;
    expect(snap).toMatchObject({ trigger: "demand", projects: [{ project: "fix", steps: [{ step: "worktrees", ok: true, acted: 1 }, { step: "ignored", ok: true }, { step: "docker", ok: true }] }] });

    await expect(call(handlers(a.sup), "cleanup", { project: "helix" })).rejects.toThrow("no project helix with cleanup steps on mbp-1");
    // Never a lead's, as upgrade_supervisor.
    expect(ORCHESTRATOR_ONLY.has("cleanup")).toBe(true);
    await expect(call(handlers(a.sup, { lead: "w_lead" }), "cleanup", {})).rejects.toThrow("cleanup is the laptop's orchestrator's, never a lead's");

    // A restart reads it back from the audit.
    await a.sup.shutdown();
    running.splice(running.indexOf(a.sup), 1);
    a.store.close();
    stores.splice(stores.indexOf(a.store), 1);
    const b = await boot(new FakeNetwork(), "mbp-1", fixProject(f.repo), a.dir);
    expect(b.sup.snapshot().cleanup).toEqual(snap);
  });

  it("from another laptop it is a dry run unless dry_run: false, under the cleanup grant only", SLOW, async () => {
    const f = fixture();
    const net = new FakeNetwork();
    net.clients.set("supervisor@ubu1", { package: "@bobnet/supervisor", version: "2.0.0-rc.47", protocol: 1 });
    const ubu = await boot(net, "ubu1", `${fixProject(f.repo)}remote:\n  supervisor@mbp-1: { cleanup: true }\n  supervisor@mbp-2: { upgrade: true }\n`);
    const mbp = await boot(net, "mbp-1", "");
    const before = tree(f.base);
    const dry = await call(handlers(mbp.sup), "cleanup", { laptop: "ubu1" });
    expect(dry).toMatchObject({ laptop: "ubu1", dry_run: true, projects: [{ project: "fix" }] });
    expect(tree(f.base)).toEqual(before);
    expect(ubu.sup.snapshot().cleanup).toBeNull();

    const started = await call(handlers(mbp.sup), "cleanup", { laptop: "ubu1", dry_run: false });
    expect(started).toMatchObject({ laptop: "ubu1", started: true });
    await until(() => ubu.sup.snapshot().cleanup !== null, 10_000);
    expect(existsSync(f.wt("merged"))).toBe(false);

    const other = await boot(net, "mbp-2", "");
    await expect(call(handlers(other.sup), "cleanup", { laptop: "ubu1" })).rejects.toThrow("supervisor@mbp-2 may not run a cleanup here: its remote entry has no cleanup: true");
  });
});
