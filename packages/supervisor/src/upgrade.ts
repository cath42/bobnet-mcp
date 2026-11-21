import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "@bobnet/client/log";
import { UPGRADE_TAG, type UpgradeRestart, type UpgradeStage } from "@bobnet/protocol";
import type { UpgradeConfig } from "./config.ts";
import type { Store } from "./store.ts";

// A supervisor upgrades and restarts itself on a request (ADR 0008): it builds a tag of its line
// from its own clone into <root>/<tag>, checks the build with the release's own `check`, waits
// for idle unless told otherwise, records the upgrade, switches <root>/current to it and exits 75;
// the service manager starts it again through `current`. The unit and the plist are never touched,
// no install is ever removed, and nothing rolls back by itself (§6).

/** The exit that asks the service manager for a restart (§4): not 0, which launchd and systemd leave down. */
export const EXIT_UPGRADE = 75;
/** How long the `restarting` event has to leave before the exit (§4); a row left behind goes from the new process. */
export const UPGRADE_DRAIN_MS = 15_000;
/** How long after `restarting` the requester waits for `ready` before it says so, once (§5). */
export const UPGRADE_READY_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 60_000;
const ARCHIVE_TIMEOUT_MS = 2 * 60_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const CHECK_TIMEOUT_MS = 2 * 60_000;
/** Where a release's supervisor starts, inside the release. */
const BIN = join("packages", "supervisor", "src", "bin.ts");
/** A full object name, SHA-1 or SHA-256. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** A request refused before any work (§3): its message is the reply's error. */
export class UpgradeRefused extends Error {}

/** A step that failed after the reply (§3, §4): reported as `failed` with the step and its output's last lines. */
export class UpgradeStepError extends Error {
  readonly step: string;
  constructor(step: string, message: string) {
    super(message);
    this.step = step;
  }
}

/** Where the releases come from and go (§3), so a test can stand in a fake repo and installer. */
export interface Releases {
  readonly root: string;
  /** What this laptop lacks for an upgrade (no clone, no pnpm on the service's PATH), or null. */
  missing(): string | null;
  /** The tag's version if <root>/<tag> is that release, complete and upgradable; null if it isn't there. */
  installed(tag: string): Promise<string | null>;
  /** Fetches the tag and checks it: on the line, its version its name, upgradable. Its version. */
  verify(tag: string): Promise<string>;
  /** git archive (of the commit verify checked) and pnpm install into <root>/.<tag>.partial, then renamed to <root>/<tag>. */
  build(tag: string): Promise<void>;
  /** Removes what a build of the tag cut short left behind: <root>/.<tag>.partial and its tar. */
  discard(tag: string): void;
  /** The release's own preflight, `bin.ts check`, with this supervisor's config dir. */
  check(tag: string): Promise<void>;
  /** `previous` to the running release and `current` to the tag, each switched atomically. */
  switch(tag: string): void;
}

/** A command's exit code (null when it timed out or couldn't start) and the end of its output. */
async function exec(cmd: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const keep = (b: Buffer) => {
      output = (output + b.toString("utf8")).slice(-64_000);
    };
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      output += `\n(timed out after ${opts.timeoutMs / 1000} s)`;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/** The last lines of a command's output, as a `failed` event carries them. */
export function lastLines(output: string, lines = 20, chars = 2000): string {
  const text = output.trimEnd().split("\n").slice(-lines).join("\n");
  return text.length > chars ? `…${text.slice(-chars)}` : text;
}

/** Whether `cmd` runs: a path that is executable, or a name found on `pathVar`. */
export function onPath(cmd: string, pathVar = process.env["PATH"] ?? ""): boolean {
  const runs = (p: string) => {
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (cmd.includes("/")) return runs(cmd);
  return pathVar.split(delimiter).some((d) => d && runs(join(d, cmd)));
}

const readJson = (text: string) => JSON.parse(text) as { version?: unknown; bobnet?: { upgradable?: unknown } };

/**
 * The release a supervisor at `self` runs from: its folder's name when `self` is
 * <root>/<name>/packages/supervisor/…, through `current` or not; null for any other place (a repo checkout).
 */
export function runningRelease(root: string, self: string = fileURLToPath(import.meta.url)): string | null {
  try {
    const rel = relative(realpathSync(root), realpathSync(self)).split(sep);
    if (rel.length < 4 || rel[0] === ".." || rel[0]!.startsWith(".") || isAbsolute(rel[0]!) || rel[1] !== "packages" || rel[2] !== "supervisor") return null;
    return rel[0]!;
  } catch {
    return null;
  }
}

/**
 * The bin.ts a unit or a plist should run (§1): <root>/current's when `ownBin` is a release's under
 * <root>, so an upgrade never rewrites it; its own path otherwise (a repo checkout), as before.
 */
export function serviceBin(ownBin: string, root: string): string {
  const tag = runningRelease(root, ownBin);
  return tag !== null && realpathSync(ownBin) === realpathSync(join(root, tag, BIN)) ? join(root, "current", BIN) : ownBin;
}

/** Points <root>/<name> at `target` atomically: a new link under a temporary name, renamed over the old (§1). */
export function switchLink(root: string, name: string, target: string): void {
  const tmp = join(root, `.${name}.${randomUUID().slice(0, 8)}`);
  symlinkSync(target, tmp);
  try {
    renameSync(tmp, join(root, name));
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Releases built from tags of `line` in the clone `repo`, as a hand install does (§3; lead/CLAUDE.md, Releases). */
export class GitReleases implements Releases {
  readonly root: string;
  private readonly repo: string;
  private readonly line: string;
  private readonly install: string[];
  private readonly node: string;
  private readonly configDir: string | undefined;
  private readonly self: string | undefined;
  private readonly env: NodeJS.ProcessEnv;
  /** Each tag's commit as verify resolved and checked it: build archives that commit, never the tag again. */
  private readonly verified = new Map<string, string>();

  constructor(
    config: UpgradeConfig,
    opts: {
      /** The install command, run in the new release (default pnpm install --frozen-lockfile). */
      install?: string[];
      /** The node the preflight runs on: this supervisor's. */
      node?: string;
      /** The config dir the preflight reads; unset, the release's default (BOBNET_CONFIG_DIR, else ~/.config/bobnet). */
      configDir?: string;
      /** This supervisor's own source file, for the running release (tests). */
      self?: string;
      env?: NodeJS.ProcessEnv;
    } = {},
  ) {
    this.root = config.root;
    this.repo = config.repo;
    this.line = config.line;
    this.install = opts.install ?? ["pnpm", "install", "--frozen-lockfile"];
    this.node = opts.node ?? process.execPath;
    this.configDir = opts.configDir;
    this.self = opts.self;
    this.env = opts.env ?? process.env;
  }

  missing(): string | null {
    if (!existsSync(join(this.repo, ".git")) && !existsSync(join(this.repo, "HEAD"))) return `upgrade.repo ${this.repo} isn't a git clone on this laptop`;
    if (!onPath(this.install[0]!, this.env["PATH"] ?? "")) return `${this.install[0]} isn't on the supervisor's PATH, so a release can't be installed here`;
    return null;
  }

  async installed(tag: string): Promise<string | null> {
    const dir = join(this.root, tag);
    if (!existsSync(dir)) return null;
    let version: unknown;
    try {
      version = readJson(readFileSync(join(dir, "package.json"), "utf8")).version;
    } catch (err) {
      throw new UpgradeRefused(`${dir} is there but isn't a release (${(err as Error).message}); move it away by hand to install ${tag}`);
    }
    if (version !== tag.slice(1)) throw new UpgradeRefused(`${dir} is there but is version ${String(version)}, not ${tag.slice(1)}; move it away by hand to install ${tag}`);
    let upgradable: unknown;
    try {
      upgradable = readJson(readFileSync(join(dir, "packages", "supervisor", "package.json"), "utf8")).bobnet?.upgradable;
    } catch {
      upgradable = false;
    }
    if (upgradable !== true) throw new UpgradeRefused(tooOld(tag));
    return version;
  }

  private git(args: string[], timeoutMs = FETCH_TIMEOUT_MS) {
    return exec(["git", "-C", this.repo, ...args], { env: { ...this.env, GIT_TERMINAL_PROMPT: "0" }, timeoutMs });
  }

  private async show(tag: string, commit: string, file: string): Promise<ReturnType<typeof readJson>> {
    const r = await this.git(["show", `${commit}:${file}`]);
    if (r.code !== 0) throw new UpgradeRefused(`${tag} has no ${file}: ${lastLines(r.output, 3)}`);
    try {
      return readJson(r.output);
    } catch {
      throw new UpgradeRefused(`${tag}'s ${file} isn't JSON`);
    }
  }

  async verify(tag: string): Promise<string> {
    // The tag and the line both from origin, the tag forced over any local one: origin's tag is the trust root.
    const fetched = await this.git(["fetch", "--no-tags", "origin", `+refs/heads/${this.line}:refs/remotes/origin/${this.line}`, `+refs/tags/${tag}:refs/tags/${tag}`]);
    if (fetched.code !== 0) throw new UpgradeRefused(`git fetch of ${tag} in ${this.repo} failed: ${lastLines(fetched.output, 5)}`);
    // The tag resolved once: the checks and the archive are all of this commit, whatever moves the tag after.
    this.verified.delete(tag);
    const resolved = await this.git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]);
    const commit = resolved.output.trim();
    if (resolved.code !== 0 || !COMMIT.test(commit)) throw new UpgradeRefused(`couldn't resolve ${tag} to a commit in ${this.repo}: ${lastLines(resolved.output, 3)}`);
    const on = await this.git(["merge-base", "--is-ancestor", commit, `refs/remotes/origin/${this.line}`]);
    if (on.code === 1) throw new UpgradeRefused(`${tag} isn't on origin/${this.line}: only a tag on the line is installed`);
    if (on.code !== 0) throw new UpgradeRefused(`couldn't check that ${tag} is on origin/${this.line}: ${lastLines(on.output, 3)}`);
    const version = (await this.show(tag, commit, "package.json")).version;
    if (version !== tag.slice(1)) throw new UpgradeRefused(`${tag}'s package.json says version ${String(version)}, not ${tag.slice(1)}`);
    if ((await this.show(tag, commit, "packages/supervisor/package.json")).bobnet?.upgradable !== true) throw new UpgradeRefused(tooOld(tag));
    this.verified.set(tag, commit);
    return version;
  }

  discard(tag: string): void {
    const partial = join(this.root, `.${tag}.partial`);
    rmSync(partial, { recursive: true, force: true });
    rmSync(`${partial}.tar`, { force: true });
  }

  async build(tag: string): Promise<void> {
    const partial = join(this.root, `.${tag}.partial`);
    const tar = `${partial}.tar`;
    const clean = () => this.discard(tag);
    clean();
    try {
      mkdirSync(partial, { recursive: true });
      const commit = this.verified.get(tag);
      if (!commit) throw new UpgradeStepError("git archive", `${tag} wasn't verified by this supervisor`);
      const archived = await this.git(["archive", "--format=tar", `--output=${tar}`, commit], ARCHIVE_TIMEOUT_MS);
      if (archived.code !== 0) throw new UpgradeStepError("git archive", lastLines(archived.output));
      const unpacked = await exec(["tar", "-xf", tar, "-C", partial], { timeoutMs: ARCHIVE_TIMEOUT_MS });
      if (unpacked.code !== 0) throw new UpgradeStepError("git archive", lastLines(unpacked.output));
      rmSync(tar, { force: true });
      const installed = await exec(this.install, { cwd: partial, env: this.env, timeoutMs: INSTALL_TIMEOUT_MS });
      if (installed.code !== 0) throw new UpgradeStepError(this.install.slice(0, 2).join(" "), lastLines(installed.output));
      renameSync(partial, join(this.root, tag));
    } catch (err) {
      clean();
      throw err instanceof UpgradeStepError ? err : new UpgradeStepError("install", (err as Error).message);
    }
  }

  async check(tag: string): Promise<void> {
    const dir = join(this.root, tag);
    const env = { ...this.env, ...(this.configDir ? { BOBNET_CONFIG_DIR: this.configDir } : {}) };
    const r = await exec([this.node, join(dir, BIN), "check"], { cwd: dir, env, timeoutMs: CHECK_TIMEOUT_MS });
    if (r.code !== 0) throw new UpgradeStepError("check", lastLines(r.output) || `exit ${String(r.code)}`);
  }

  switch(tag: string): void {
    const running = runningRelease(this.root, this.self);
    let was: string | null = running;
    if (was === null) {
      try {
        was = readlinkSync(join(this.root, "current"));
      } catch {
        was = null;
      }
    }
    if (was !== null && was !== tag) switchLink(this.root, "previous", was);
    switchLink(this.root, "current", tag);
  }
}

const tooOld = (tag: string) =>
  `${tag} is older than the first release that carries upgrade (its packages/supervisor/package.json has no bobnet.upgradable): on it, this laptop could never be upgraded remotely again`;

/** What a restart now would cut short (§4): counts, and the leads by name, since a live lead never ends by itself. */
export interface WaitingOn {
  workers: number;
  runs: number;
  requests: number;
  leads?: string[];
}

/** What the supervisor lends an upgrade. */
export interface UpgradeHost {
  /** The running release's version. */
  version: string;
  releases: Releases | null;
  store: Store;
  log: Logger;
  /** Null when idle for `restart`'s idea of it; else what it waits on. */
  waitingOn(restart: UpgradeRestart): WaitingOn | null;
  /** An event (§5) to whoever asked: another laptop's supervisor, or "orchestrator" for this laptop's own. */
  emit(requester: string, req: string, event: Record<string, unknown> & { stage: UpgradeStage }): void;
  /** Waits up to `ms` for what was queued to the broker to leave. */
  drain(ms: number): Promise<void>;
  /** Exits EXIT_UPGRADE, as a shutdown otherwise does. */
  restart(): void;
}

interface Pending {
  req: string;
  requester: string;
  tag: string;
  from: string;
  to: string;
  restart: UpgradeRestart;
  installed: boolean;
  state: "installing" | "waiting" | "restarting";
}

/**
 * The upgrades of this supervisor, one at a time (§2): a new one replaces one waiting for idle (which
 * fails "superseded"), and is refused while one is being checked, built or restarted.
 */
export class Upgrades {
  private current: Pending | null = null;
  private verifying = false;
  private readonly host: UpgradeHost;

  constructor(host: UpgradeHost) {
    this.host = host;
  }

  /**
   * Checks the request and the tag, and starts the build after the caller has replied: the reply
   * says `from` and `to`, or this throws UpgradeRefused with why not. A tag already installed skips the git work.
   */
  async ask(req: string, requester: string, tag: string, restart: UpgradeRestart = "when_idle"): Promise<{ from: string; to: string }> {
    const releases = this.host.releases;
    if (!releases) throw new UpgradeRefused("this supervisor has no upgrade section in supervisor.yaml (repo, and optionally root and line), so it can't upgrade itself");
    const missing = releases.missing();
    if (missing) throw new UpgradeRefused(missing);
    if (!UPGRADE_TAG.test(tag)) throw new UpgradeRefused(`${tag} isn't a release tag (v<x.y.z> or v<x.y.z>-rc.<n>)`);
    const c = this.current;
    if (this.verifying || (c && c.state !== "waiting")) throw new UpgradeRefused(`an upgrade${c ? ` to ${c.tag}` : ""} is under way (${this.verifying ? "checking a tag" : c!.state}); ask again once it has ended`);
    this.verifying = true;
    let to: string;
    let installed: boolean;
    try {
      const have = await releases.installed(tag);
      installed = have !== null;
      to = have ?? (await releases.verify(tag));
    } finally {
      this.verifying = false;
    }
    // One waiting for idle may have started its restart during the verify (poke doesn't wait for it): refused, not run under the exit.
    const now = this.current;
    if (now && now.state !== "waiting") throw new UpgradeRefused(`an upgrade to ${now.tag} is under way (${now.state}); ask again once it has ended`);
    if (this.current?.state === "waiting") this.fail(this.current, "wait", `superseded by ${tag}`);
    const u: Pending = { req, requester, tag, from: this.host.version, to, restart, installed, state: "installing" };
    this.current = u;
    // After the caller's reply is queued: the reply goes before any event (§2).
    setImmediate(() => void this.run(u));
    return { from: u.from, to };
  }

  /** A worker, a run or a request ended: an upgrade waiting for idle restarts if it now is. */
  poke(): void {
    const u = this.current;
    if (!u || u.state !== "waiting" || this.host.waitingOn(u.restart)) return;
    void this.switchAndExit(u);
  }

  /**
   * At start, once registered (§4 step 5): the upgrade this process was started for says `ready`, or that
   * it runs another version; one a restart cut short before its switch says `failed`, its partial build removed.
   */
  resume(): void {
    for (const row of this.host.store.upgradesOpen()) {
      const base = { from: row.from_version, to: row.to_version };
      if (row.stage === "installing") {
        this.host.store.endUpgrade(row.req, "failed");
        try {
          this.host.releases?.discard(row.tag);
        } catch (err) {
          this.host.log.warn("upgrade: couldn't remove a partial build", { tag: row.tag, error: (err as Error).message });
        }
        this.host.emit(row.requester, row.req, { ...base, stage: "failed", step: "start", error: "restarted while installing" });
      } else if (row.stage === "waiting") {
        this.host.store.endUpgrade(row.req, "failed");
        this.host.emit(row.requester, row.req, { ...base, stage: "failed", step: "wait", error: `restarted before the switch; ${row.tag} stays installed, so asking again switches to it` });
      } else if (row.to_version === this.host.version) {
        this.host.store.endUpgrade(row.req, "ready");
        this.host.emit(row.requester, row.req, { ...base, stage: "ready", version: this.host.version });
      } else {
        this.host.store.endUpgrade(row.req, "failed");
        this.host.emit(row.requester, row.req, { ...base, stage: "failed", step: "start", error: `running ${this.host.version}, not ${row.to_version}` });
      }
    }
  }

  private emit(u: Pending, event: Record<string, unknown> & { stage: UpgradeStage }): void {
    this.host.emit(u.requester, u.req, { from: u.from, to: u.to, ...event });
  }

  private fail(u: Pending, step: string, error: string): void {
    if (this.current === u) this.current = null;
    this.host.store.endUpgrade(u.req, "failed");
    this.emit(u, { stage: "failed", step, error });
  }

  private async run(u: Pending): Promise<void> {
    const releases = this.host.releases!;
    // Before any build: a restart from here on finds the row, and the new process tells the requester (resume).
    this.host.store.addUpgrade({ req: u.req, requester: u.requester, from_version: u.from, to_version: u.to, tag: u.tag });
    try {
      if (!u.installed) await releases.build(u.tag);
      await releases.check(u.tag);
    } catch (err) {
      return this.fail(u, err instanceof UpgradeStepError ? err.step : "install", (err as Error).message);
    }
    if (u.restart === "no") {
      this.current = null;
      this.host.store.endUpgrade(u.req, "installed");
      return this.emit(u, { stage: "installed", restart: "no" });
    }
    const waiting = this.host.waitingOn(u.restart);
    this.emit(u, { stage: "installed", restart: u.restart, ...(waiting ? { waiting_on: waiting } : {}) });
    u.state = "waiting";
    this.host.store.moveUpgrade(u.req, "waiting");
    this.poke();
  }

  /** Recorded, switched, reported, then the exit (§4 steps 3-4). Never before the preflight passed. */
  private async switchAndExit(u: Pending): Promise<void> {
    u.state = "restarting";
    const releases = this.host.releases!;
    this.host.store.moveUpgrade(u.req, "restarting");
    try {
      releases.switch(u.tag);
    } catch (err) {
      return this.fail(u, "switch", (err as Error).message);
    }
    this.emit(u, { stage: "restarting", root: releases.root });
    this.host.log.info("upgraded: restarting into the new release", { tag: u.tag, from: u.from, to: u.to });
    await this.host.drain(UPGRADE_DRAIN_MS);
    this.host.restart();
  }
}

const STEPS: Record<string, string> = { wait: "the wait for idle", check: "the preflight check", switch: "the switch of current", start: "start" };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** What it waits on, in words: "2 workers: Mario (lead), 1 run". */
function waitingWords(w: WaitingOn): string {
  const parts = [
    ...(w.workers ? [`${plural(w.workers, "worker")}${w.leads?.length ? `: ${w.leads.map((l) => `${l} (lead)`).join(", ")}` : ""}`] : []),
    ...(w.runs ? [plural(w.runs, "run")] : []),
    ...(w.requests ? [plural(w.requests, "remote request")] : []),
  ];
  return parts.join(", ");
}

/** The orchestrator's notice for an upgrade's event (§5), one per stage; `laptop` the one upgraded. */
export function upgradeNotice(laptop: string, e: Record<string, unknown>): string {
  const to = String(e["to"]);
  switch (e["stage"]) {
    case "installed": {
      if (e["restart"] === "no") return `${laptop}: supervisor ${to} installed, not restarting (restart: no); upgrade_supervisor again with restart when_idle or now switches to it`;
      const w = e["waiting_on"] as WaitingOn | undefined;
      const when = e["restart"] === "now" ? "now" : "when idle";
      return w ? `${laptop}: supervisor ${to} installed, restarting ${when} (waiting on ${waitingWords(w)})` : `${laptop}: supervisor ${to} installed, restarting`;
    }
    case "restarting":
      return `${laptop}: supervisor restarting into ${to} (from ${String(e["from"])})`;
    case "ready":
      return `${laptop}: supervisor ${String(e["version"] ?? to)} ready`;
    default: {
      const step = String(e["step"] ?? "");
      if (step === "wait") return `${laptop}: upgrade to ${to} not done: ${String(e["error"])}`;
      return `${laptop}: upgrade to ${to} failed at ${STEPS[step] ?? step}: ${String(e["error"])}`;
    }
  }
}

/** The notice when no `ready` came (§5): where to roll back by hand (§6). */
export function overdueNotice(laptop: string, to: string, root: string | null): string {
  const r = root ?? "<root>";
  return `${laptop}: no ready from the supervisor since restarting into ${to}; it may not have started. Roll back by hand there: ln -sfn "$(readlink ${r}/previous)" ${r}/current, then restart the service (ADR 0008 §6)`;
}
