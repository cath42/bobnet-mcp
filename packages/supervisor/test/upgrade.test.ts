import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PushFrame } from "@bobnet/client/connection";
import { afterEach, describe, expect, it } from "vitest";
import * as rc41 from "../../protocol/test/fixtures/remote-rc41.ts";
import { claudeBinary, preflight, satisfies } from "../src/check.ts";
import { GhCiPoll } from "../src/ci-poll.ts";
import { DEFAULT_RELEASE_ROOT, guardedFolders, parseSupervisorConfig, releaseRoot } from "../src/config.ts";
import { callTool, handlers, ORCHESTRATOR_ONLY } from "../src/mcp.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { REMOTE_TOOLS_SINCE, remoteWaitMs, Supervisor } from "../src/supervisor.ts";
import { EXIT_UPGRADE, GitReleases, type Releases, runningRelease, serviceBin, switchLink, UpgradeRefused, Upgrades, UpgradeStepError, VERIFY_BUDGET_MS } from "../src/upgrade.ts";
import { fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";
import { FakeNetwork } from "./network.ts";

// BOB-83, ADR 0008: a supervisor upgrades and restarts itself when an address with the grant asks.
// Two real supervisors on the FakeNetwork (mbp-1's asks, ubu1's is upgraded) with a fake release
// source; GitReleases against a fake origin and clone in a temp dir, with a fake installer. Nothing
// here touches the live config or releases, or fetches anything but the temp origin.

const POLICY = new Policy(`rules: []`);
const SUP_MBP = "supervisor@mbp-1";
const SUP_UBU = "supervisor@ubu1";
const RUNNING = "2.0.0-rc.42";
const TAG = "v2.0.0-rc.43";
const UBU = `  studio:
    path: /work/studio
    roles:
      ann: { dir: /work/studio-ann }
      bea: { dir: /work/studio-bea }
      boss: { dir: /work/studio-boss, lead: true }
remote:
  supervisor@mbp-1: { spawn: { studio: [ann] }, upgrade: true }
  supervisor@mbp-2: { spawn: { studio: [ann] } }
  supervisor@mbp-3: { upgrade: true }
upgrade:
  repo: /work/bobnet
`;

/** A release source that records what was asked of it; a test sets what it refuses or fails. */
class FakeReleases implements Releases {
  readonly root = "/fake/releases";
  readonly calls: string[] = [];
  readonly installedTags = new Map<string, string>();
  missingWhy: string | null = null;
  refuse: Record<string, string> = {};
  gate: Promise<void> | null = null;
  verifyGate: Promise<void> | null = null;
  buildFails: UpgradeStepError | null = null;
  checkFails: UpgradeStepError | null = null;
  current: string | null = null;
  missing() {
    return this.missingWhy;
  }
  async installed(tag: string) {
    this.calls.push(`installed ${tag}`);
    return this.installedTags.get(tag) ?? null;
  }
  async verify(tag: string) {
    this.calls.push(`verify ${tag}`);
    if (this.verifyGate) await this.verifyGate;
    if (this.refuse[tag]) throw new UpgradeRefused(this.refuse[tag]);
    return tag.slice(1);
  }
  async build(tag: string) {
    this.calls.push(`build ${tag}`);
    if (this.gate) await this.gate;
    if (this.buildFails) throw this.buildFails;
    this.installedTags.set(tag, tag.slice(1));
  }
  discard(tag: string) {
    this.calls.push(`discard ${tag}`);
  }
  async check(tag: string) {
    this.calls.push(`check ${tag}`);
    if (this.checkFails) throw this.checkFails;
  }
  switch(tag: string) {
    this.calls.push(`switch ${tag}`);
    this.current = tag;
  }
  async tagged() {
    return null;
  }
}

const dirs: string[] = [];
const stores = new Set<Store>();
const running: Supervisor[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.shutdown()));
  await tick(20);
  for (const s of stores) s.close();
  stores.clear();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const temp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

async function boot(net: FakeNetwork, laptop: string, over: string, opts: { version?: string; releases?: Releases | null; dir?: string; holdRoles?: Promise<void> } = {}) {
  const dir = opts.dir ?? temp("bobnet-upgrade-");
  const store = new Store(join(dir, "supervisor.db"));
  stores.add(store);
  const link = net.link(laptop);
  const { queryFn, sessions } = fakeQuery();
  const ciPoll = new GhCiPoll(quiet, async () => {
    throw new Error("no gh in tests");
  });
  const restarts: number[] = [];
  // Held: the supervisor's own name registers, its roles' wait, so start() is caught before resume().
  const hold = opts.holdRoles;
  if (hold) {
    const register = link.register.bind(link);
    link.register = async (identity) => (!identity.supervisor && identity.purpose?.includes("(headless") ? hold.then(() => register(identity)) : register(identity));
  }
  const sup = new Supervisor({
    config: testConfig(dir, over),
    policy: POLICY,
    store,
    broker: link,
    queryFn,
    log: quiet,
    sandboxCheck: async () => null,
    ownerCheck: async () => false,
    sleep: net.sleep,
    ciPoll,
    version: opts.version ?? RUNNING,
    releases: opts.releases === undefined ? null : opts.releases,
    restart: () => restarts.push(EXIT_UPGRADE),
  });
  const frames: PushFrame[] = [];
  link.onPush = (f) => {
    frames.push(f);
    sup.onPush(f);
  };
  const started = sup.start();
  running.push(sup);
  if (!hold) await started;
  return { sup, store, link, sessions, restarts, frames, dir, started };
}

/** A tool as an orchestrator calls it: its JSON result, or its error text thrown. */
async function call(h: ReturnType<typeof handlers>, name: string, args: Record<string, unknown> = {}) {
  const r = await callTool(h, name, args);
  const text = r.content[0]!.text;
  if (r.isError) throw new Error(text);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
}

/** ubu1 (the target, with its fake releases and its orchestrator Bob) and mbp-1 (the requester, its Bob). */
async function setup(opts: { releases?: FakeReleases | null } = {}) {
  const net = new FakeNetwork();
  net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: RUNNING, protocol: 1 });
  const releases = opts.releases === undefined ? new FakeReleases() : opts.releases;
  const ubu = await boot(net, "ubu1", UBU, { releases });
  await ubu.link.register({ name: "Bob" });
  const mbp = await boot(net, "mbp-1", "");
  await mbp.link.register({ name: "Bob" });
  const bob = () => net.between(SUP_MBP, "Bob@mbp-1");
  const ubuBob = () => net.between(SUP_UBU, "Bob@ubu1");
  /** What ubu1 sent mbp-1, as JSON. */
  const toMbp = () => net.between(SUP_UBU, SUP_MBP).map((b) => JSON.parse(b) as Record<string, unknown>);
  const upgrade = (args: Record<string, unknown> = {}) => call(handlers(mbp.sup), "upgrade_supervisor", { laptop: "ubu1", tag: TAG, ...args });
  return { net, ubu, mbp, releases: releases!, bob, ubuBob, toMbp, upgrade };
}

/** Another laptop's supervisor, to ask ubu1 from an address other than mbp-1's. */
async function asker(net: FakeNetwork, laptop: string) {
  const a = await boot(net, laptop, "");
  return (args: Record<string, unknown> = {}) => call(handlers(a.sup), "upgrade_supervisor", { laptop: "ubu1", tag: TAG, ...args });
}

const audits = (store: Store, action = "remote:upgrade") => store.auditLog(500).filter((a) => a.action === action).map((a) => ({ actor: a.actor, ...(JSON.parse(a.detail) as Record<string, unknown>) })).reverse();

describe("the grant (AC 2)", () => {
  it("an address whose entry has upgrade: true may ask; the reply comes at once with from and to", async () => {
    const s = await setup();
    expect(await s.upgrade({ restart: "no" })).toMatchObject({ laptop: "ubu1", from: RUNNING, to: "2.0.0-rc.43", restart: "no" });
    await until(() => s.bob().length === 1);
    expect(s.bob()).toEqual(["ubu1: supervisor 2.0.0-rc.43 installed, not restarting (restart: no); upgrade_supervisor again with restart when_idle or now switches to it"]);
    // The request and each stage, audited on the target.
    expect(audits(s.ubu.store)).toEqual([
      expect.objectContaining({ actor: SUP_MBP, ok: true, tag: TAG, from: RUNNING, to: "2.0.0-rc.43" }),
      expect.objectContaining({ actor: SUP_MBP, stage: "installed", restart: "no" }),
    ]);
  });

  it("an address in the list without the grant (spawn only) is refused, audited, and nothing is fetched", async () => {
    const s = await setup();
    const ask = await asker(s.net, "mbp-2");
    await expect(ask()).rejects.toThrow("supervisor@mbp-2 may not upgrade this supervisor: its remote entry has no upgrade: true");
    expect(s.releases.calls).toEqual([]);
    expect(audits(s.ubu.store)).toEqual([expect.objectContaining({ actor: "supervisor@mbp-2", ok: false, tag: TAG, error: expect.stringContaining("may not upgrade") })]);
  });

  it("an address not in the list is refused and audited", async () => {
    const s = await setup();
    const ask = await asker(s.net, "mbp-4");
    await expect(ask()).rejects.toThrow("supervisor@mbp-4 may not make requests here: it isn't in this supervisor's remote list");
    expect(s.releases.calls).toEqual([]);
    expect(audits(s.ubu.store)).toEqual([expect.objectContaining({ actor: "supervisor@mbp-4", ok: false })]);
  });

  it("an entry with upgrade only may upgrade, and spawns nothing", async () => {
    const s = await setup();
    const net = s.net;
    const a = await boot(net, "mbp-3", "");
    const h = handlers(a.sup);
    expect(await call(h, "upgrade_supervisor", { laptop: "ubu1", tag: TAG, restart: "no" })).toMatchObject({ to: "2.0.0-rc.43" });
    await expect(call(h, "spawn_worker", { project: "studio", role: "ann", task: "x", laptop: "ubu1" })).rejects.toThrow("may spawn nothing");
  });

  it("the config: the grant is off when absent, apart from spawn; an entry grants something; upgrade: has repo, root and line", () => {
    const base = (remote: string, extra = "") => `orchestrator: Bob\nprojects:\n  p:\n    path: /w\n    roles:\n      a: { dir: /w/a }\nremote:\n${remote}${extra}`;
    const c = parseSupervisorConfig(base(`  x@l1: { spawn: { p: [a] } }\n  y@l2: { spawn: { p: [a] }, upgrade: true }\n  z@l3: { upgrade: true }\n`), (d) => d);
    expect([...c.remoteUpgrade]).toEqual(["y@l2", "z@l3"]);
    expect([...c.remote.get("z@l3")!]).toEqual([]);
    expect(c.upgrade).toBeUndefined();
    expect(c.releaseRoot).toBe(DEFAULT_RELEASE_ROOT);
    expect(() => parseSupervisorConfig(base(`  x@l1: {}\n`), (d) => d)).toThrow("must grant spawn, upgrade: true, cleanup: true, or more than one");
    expect(() => parseSupervisorConfig(base(`  x@l1: { upgrade: false }\n`), (d) => d)).toThrow("must grant spawn, upgrade: true, cleanup: true, or more than one");
    const u = parseSupervisorConfig(base(`  y@l2: { upgrade: true }\n`, `upgrade:\n  repo: ~/Code/bobnet\n`), (d) => d);
    expect(u.upgrade).toEqual({ repo: join(homedir(), "Code/bobnet"), root: DEFAULT_RELEASE_ROOT, line: "v2" });
    const r = parseSupervisorConfig(base(`  y@l2: { upgrade: true }\n`, `upgrade:\n  repo: /r\n  root: /opt/bobnet\n  line: release/v3\n`), (d) => d);
    expect(r.upgrade).toEqual({ repo: "/r", root: "/opt/bobnet", line: "release/v3" });
    expect(r.releaseRoot).toBe("/opt/bobnet");
    expect(() => parseSupervisorConfig(base(`  y@l2: { upgrade: true }\n`, `upgrade:\n  root: /opt/bobnet\n`), (d) => d)).toThrow();
  });
});

describe("refused without the configuration (§3)", () => {
  it("no upgrade section: the reply says so, and nothing runs", async () => {
    const s = await setup({ releases: null });
    await expect(s.upgrade()).rejects.toThrow("this supervisor has no upgrade section in supervisor.yaml");
  });

  it("no pnpm on the service's PATH: the reply says so", async () => {
    const releases = new FakeReleases();
    releases.missingWhy = "pnpm isn't on the supervisor's PATH, so a release can't be installed here";
    const s = await setup({ releases });
    await expect(s.upgrade()).rejects.toThrow("pnpm isn't on the supervisor's PATH");
    expect(releases.calls).toEqual([]);
  });

  it("a tag that isn't a release tag is refused by the tool, and by the op in-process", async () => {
    const s = await setup();
    await expect(s.upgrade({ tag: "main" })).rejects.toThrow("must be a release tag");
    const u = new Upgrades({ version: RUNNING, releases: new FakeReleases(), store: s.ubu.store, log: quiet, waitingOn: () => null, emit: () => {}, hold: () => {}, drain: async () => {}, restart: () => {}, released: async () => {} });
    await expect(u.ask("r1", "orchestrator", "v2.0.0;touch x")).rejects.toThrow("isn't a release tag");
  });

  it("a refusal from the tag's checks is the reply's error", async () => {
    const releases = new FakeReleases();
    releases.refuse[TAG] = `${TAG} isn't on origin/v2: only a tag on the line is installed`;
    const s = await setup({ releases });
    await expect(s.upgrade()).rejects.toThrow(`${TAG} isn't on origin/v2`);
    expect(releases.calls).toEqual([`installed ${TAG}`, `verify ${TAG}`]);
  });
});

describe("the op (AC 1)", () => {
  it("the reply goes before any event; the events are v: 2 upgrade events with req", async () => {
    const s = await setup();
    await s.upgrade({ restart: "no" });
    await until(() => s.toMbp().length === 2);
    const [reply, event] = s.toMbp();
    expect(reply).toMatchObject({ v: 2, re: "upgrade", ok: true, from: RUNNING, to: "2.0.0-rc.43" });
    expect(event).toEqual({ v: 2, event: "upgrade", req: reply!["req"], stage: "installed", from: RUNNING, to: "2.0.0-rc.43", restart: "no" });
  });

  it("one at a time: a new upgrade supersedes one waiting for idle, which fails 'superseded by <tag>'", async () => {
    const s = await setup();
    await call(handlers(s.ubu.sup), "spawn_worker", { project: "studio", role: "ann", task: "busy" });
    await until(() => s.ubu.sessions.length === 1);
    await s.upgrade();
    await until(() => s.bob().length === 1);
    expect(await s.upgrade({ tag: "v2.0.0-rc.44" })).toMatchObject({ to: "2.0.0-rc.44" });
    await until(() => s.bob().length === 3);
    expect(s.bob()).toEqual([
      "ubu1: supervisor 2.0.0-rc.43 installed, restarting when idle (waiting on 1 worker)",
      "ubu1: upgrade to 2.0.0-rc.43 not done: superseded by v2.0.0-rc.44",
      "ubu1: supervisor 2.0.0-rc.44 installed, restarting when idle (waiting on 1 worker)",
    ]);
    s.ubu.sessions[0]!.finish();
    await until(() => s.ubu.restarts.length === 1);
    expect(s.releases.current).toBe("v2.0.0-rc.44");
    expect(s.releases.calls.filter((c) => c.startsWith("switch"))).toEqual(["switch v2.0.0-rc.44"]);
  });

  it("one installing refuses a new one", async () => {
    const s = await setup();
    let open!: () => void;
    s.releases.gate = new Promise((r) => (open = r));
    await s.upgrade({ restart: "no" });
    await until(() => s.releases.calls.includes(`build ${TAG}`));
    await expect(s.upgrade({ tag: "v2.0.0-rc.44" })).rejects.toThrow(`an upgrade to ${TAG} is under way (installing); ask again once it has ended`);
    open();
    await until(() => s.bob().length === 1);
    expect(s.bob()[0]).toContain("2.0.0-rc.43 installed");
  });

  it("a second local upgrade whose verify ends after the first one's restart began is refused, and builds nothing (BOB-92 AC 1)", async () => {
    const s = await setup();
    const own = handlers(s.ubu.sup);
    await call(own, "spawn_worker", { project: "studio", role: "ann", task: "busy" });
    await until(() => s.ubu.sessions.length === 1);
    await call(own, "upgrade_supervisor", { laptop: "ubu1", tag: TAG });
    await until(() => s.ubuBob().some((b) => b.includes("installed")));
    // The second is checking its tag when the worker ends: the first switches and starts its exit.
    let open!: () => void;
    s.releases.verifyGate = new Promise((r) => (open = r));
    const second = call(own, "upgrade_supervisor", { laptop: "ubu1", tag: "v2.0.0-rc.44" });
    await until(() => s.releases.calls.includes("verify v2.0.0-rc.44"));
    s.ubu.sessions[0]!.finish();
    await until(() => s.ubu.restarts.length === 1);
    open();
    await expect(second).rejects.toThrow(`an upgrade to ${TAG} is under way (restarting); ask again once it has ended`);
    await tick(20);
    expect(s.releases.calls.filter((c) => c.startsWith("build") || c.startsWith("switch"))).toEqual([`build ${TAG}`, `switch ${TAG}`]);
    expect(s.releases.current).toBe(TAG);
    expect(s.ubuBob().filter((b) => b.startsWith("ubu1: "))).toEqual([
      "ubu1: supervisor 2.0.0-rc.43 installed, restarting when idle (waiting on 1 worker)",
      `ubu1: supervisor restarting into 2.0.0-rc.43 (from ${RUNNING})`,
    ]);
  });

  it("idempotent: a redelivered request gets its stored reply again and runs once", async () => {
    const s = await setup();
    await s.upgrade({ restart: "no" });
    await until(() => s.bob().length === 1);
    const delivered = s.ubu.frames.find((f) => f.t === "deliver" && f.msg.body.includes('"op":"upgrade"'))!;
    s.ubu.sup.onPush(delivered);
    await until(() => s.toMbp().filter((b) => b["re"] === "upgrade").length === 2);
    const replies = s.toMbp().filter((b) => b["re"] === "upgrade");
    expect(replies[1]).toEqual(replies[0]);
    expect(s.releases.calls.filter((c) => c.startsWith("build"))).toEqual([`build ${TAG}`]);
  });

  it("a tag already installed skips the fetch and the install; the preflight still runs", async () => {
    const releases = new FakeReleases();
    releases.installedTags.set("v2.0.0-rc.41", "2.0.0-rc.41");
    const s = await setup({ releases });
    expect(await s.upgrade({ tag: "v2.0.0-rc.41", restart: "no" })).toMatchObject({ from: RUNNING, to: "2.0.0-rc.41" });
    await until(() => s.bob().length === 1);
    expect(releases.calls).toEqual(["installed v2.0.0-rc.41", "check v2.0.0-rc.41"]);
  });

  it("an old target refuses the op as a bad request, and the tool says it is installed by hand", async () => {
    const net = new FakeNetwork();
    const mbp = await boot(net, "mbp-1", "");
    // A supervisor on rc.41's wire: it answers the op as rc.41 does, a bad request.
    const old = net.link("old1");
    await old.register({ name: "supervisor" });
    net.clients.set("supervisor@old1", { package: "@bobnet/supervisor", version: "2.0.0-rc.41", protocol: 1 });
    old.onPush = (f) => {
      if (f.t !== "deliver") return;
      const read = rc41.readRemoteRequest(f.msg.body, f.msg.in_reply_to);
      if (read && "error" in read) void old.request({ t: "send", as: "supervisor", to: [f.msg.from], body: JSON.stringify({ v: 2, re: read.re, req: f.msg.id, ok: false, error: read.error }), in_reply_to: f.msg.id });
    };
    await expect(call(handlers(mbp.sup), "upgrade_supervisor", { laptop: "old1", tag: TAG })).rejects.toThrow(/old1's supervisor has no upgrade op .*install a release by hand there once.*bad request: op /);
  });
});

describe("check, switch, exit (AC 4, AC 6)", () => {
  it("when_idle waits for a running worker; at its end: the row, the switch, restarting, then the exit (75)", async () => {
    const s = await setup();
    await call(handlers(s.ubu.sup), "spawn_worker", { project: "studio", role: "ann", task: "busy" });
    await until(() => s.ubu.sessions.length === 1);
    await s.upgrade();
    await until(() => s.bob().length === 1);
    expect(s.bob()).toEqual(["ubu1: supervisor 2.0.0-rc.43 installed, restarting when idle (waiting on 1 worker)"]);
    expect(s.toMbp().at(-1)).toMatchObject({ stage: "installed", restart: "when_idle", waiting_on: { workers: 1, runs: 0, requests: 0 } });
    await tick(50);
    expect(s.releases.current).toBeNull();
    expect(s.ubu.restarts).toEqual([]);
    s.ubu.sessions[0]!.finish();
    await until(() => s.ubu.restarts.length === 1);
    expect(s.ubu.restarts).toEqual([75]);
    expect(EXIT_UPGRADE).toBe(75);
    expect(s.releases.calls).toEqual([`installed ${TAG}`, `verify ${TAG}`, `build ${TAG}`, `check ${TAG}`, `switch ${TAG}`]);
    const req = String(s.toMbp()[0]!["req"]);
    expect(s.ubu.store.upgrade(req)).toMatchObject({ requester: SUP_MBP, from_version: RUNNING, to_version: "2.0.0-rc.43", tag: TAG, stage: "restarting" });
    await until(() => s.bob().length === 2);
    expect(s.bob()[1]).toBe(`ubu1: supervisor restarting into 2.0.0-rc.43 (from ${RUNNING})`);
    expect(s.toMbp().at(-1)).toMatchObject({ stage: "restarting", root: "/fake/releases" });
  });

  it("a live lead counts as a worker, by name, and when_idle doesn't restart under it", async () => {
    const s = await setup();
    await call(handlers(s.ubu.sup), "spawn_worker", { project: "studio", role: "boss", task: "lead", as: "lead" });
    await until(() => s.ubu.sessions.length === 1);
    s.ubu.sessions[0]!.turnDone();
    await s.upgrade();
    await until(() => s.bob().length === 1);
    expect(s.bob()).toEqual(["ubu1: supervisor 2.0.0-rc.43 installed, restarting when idle (waiting on 1 worker: Boss (lead))"]);
    expect(s.toMbp().at(-1)).toMatchObject({ waiting_on: { workers: 1, leads: ["Boss"] } });
    await tick(50);
    expect(s.ubu.restarts).toEqual([]);
  });

  it("now doesn't wait for workers, but waits for a run in a slot (a land mid-push)", async () => {
    const s = await setup();
    const h = handlers(s.ubu.sup);
    await call(h, "spawn_worker", { project: "studio", role: "ann", task: "busy" });
    await until(() => s.ubu.sessions.length === 1);
    await call(h, "take_slot", { project: "studio", name: "Zoe", label: "land" });
    await s.upgrade({ restart: "now" });
    await until(() => s.bob().length === 1);
    expect(s.bob()).toEqual(["ubu1: supervisor 2.0.0-rc.43 installed, restarting now (waiting on 1 run)"]);
    expect(s.toMbp().at(-1)).toMatchObject({ waiting_on: { workers: 0, runs: 1, requests: 0 } });
    await tick(50);
    expect(s.ubu.restarts).toEqual([]);
    await call(h, "free_slot", { name: "Zoe" });
    await until(() => s.ubu.restarts.length === 1);
    // The worker was running all along: now orphans it, as any restart does.
    expect(s.ubu.store.workers({ states: ["running"] })).toHaveLength(1);
  });

  it("now waits for a remote request in progress, and restarts once it has finished", async () => {
    const s = await setup();
    s.ubu.store.beginRemote("m_busy", SUP_MBP, "spawn", 2);
    await s.upgrade({ restart: "now" });
    await until(() => s.bob().length === 1);
    expect(s.bob()).toEqual(["ubu1: supervisor 2.0.0-rc.43 installed, restarting now (waiting on 1 remote request)"]);
    await tick(50);
    expect(s.ubu.restarts).toEqual([]);
    s.ubu.store.finishRemote("m_busy", "{}");
    // Any request that finishes looks again.
    await s.mbp.sup.remoteRequest(SUP_UBU, { v: 2, op: "list" });
    await until(() => s.ubu.restarts.length === 1);
  });

  it("idle at once: installed, then restarting straight away", async () => {
    const s = await setup();
    await s.upgrade();
    await until(() => s.ubu.restarts.length === 1);
    await until(() => s.bob().length === 2);
    expect(s.bob()).toEqual(["ubu1: supervisor 2.0.0-rc.43 installed, restarting", `ubu1: supervisor restarting into 2.0.0-rc.43 (from ${RUNNING})`]);
  });

  it("no stops after installed: no switch, no row, no exit", async () => {
    const s = await setup();
    await s.upgrade({ restart: "no" });
    await until(() => s.bob().length === 1);
    await tick(50);
    expect(s.releases.calls).not.toContain(`switch ${TAG}`);
    expect(s.ubu.store.upgradesRestarting()).toEqual([]);
    expect(s.ubu.store.upgrade(String(s.toMbp()[0]!["req"]))).toMatchObject({ stage: "installed" });
    expect(s.ubu.restarts).toEqual([]);
  });

  it("a failed preflight switches nothing and reports its output", async () => {
    const releases = new FakeReleases();
    releases.checkFails = new UpgradeStepError("check", "supervisor.yaml: projects.p.roles: Required");
    const s = await setup({ releases });
    await s.upgrade();
    await until(() => s.bob().length === 1);
    expect(s.bob()).toEqual(["ubu1: upgrade to 2.0.0-rc.43 failed at the preflight check: supervisor.yaml: projects.p.roles: Required"]);
    expect(s.toMbp().at(-1)).toMatchObject({ stage: "failed", step: "check" });
    expect(releases.calls).not.toContain(`switch ${TAG}`);
    expect(s.ubu.store.upgradesRestarting()).toEqual([]);
    expect(s.ubu.store.upgrade(String(s.toMbp()[0]!["req"]))).toMatchObject({ stage: "failed" });
    expect(s.ubu.restarts).toEqual([]);
  });

  it("a failed build reports its step and the end of its output; the next upgrade may go", async () => {
    const releases = new FakeReleases();
    releases.buildFails = new UpgradeStepError("pnpm install", "ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with frozen-lockfile");
    const s = await setup({ releases });
    await s.upgrade();
    await until(() => s.bob().length === 1);
    expect(s.bob()).toEqual(["ubu1: upgrade to 2.0.0-rc.43 failed at pnpm install: ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with frozen-lockfile"]);
    releases.buildFails = null;
    await expect(s.upgrade({ restart: "no" })).resolves.toMatchObject({ to: "2.0.0-rc.43" });
  });

  it("in the drain, nothing new starts: a spawn stays queued for the new process, a remote spawn is refused, a slot isn't given (BOB-95 AC 3)", async () => {
    const s = await setup();
    const h = handlers(s.ubu.sup);
    await s.upgrade();
    // The restart has begun: switched, restarting sent, the drain under way (the test's restart doesn't exit).
    await until(() => s.ubu.restarts.length === 1);
    // A local spawn, even when idle: queued, never started under the exit.
    const queued = (await call(h, "spawn_worker", { project: "studio", role: "ann", task: "after" })) as Record<string, unknown>;
    expect(queued).toMatchObject({ state: "queued", note: "queued: this supervisor is restarting into v2.0.0-rc.43; the new process starts it" });
    await tick(50);
    expect(s.ubu.sessions).toHaveLength(0);
    // A remote spawn is never queued (ADR 0007 §3): refused as transient, with no row and no reservation left.
    const workers = s.ubu.store.workers({}).length;
    const r = await s.mbp.sup.remoteRequest(SUP_UBU, { v: 2, op: "spawn", project: "studio", role: "ann", task: "remote", by: "Bob" });
    expect(r).toMatchObject({ outcome: "reply", reply: { ok: false, error: "Ann isn't spawned: this supervisor is restarting into v2.0.0-rc.43; ask again once it is ready" } });
    expect(s.ubu.store.workers({})).toHaveLength(workers);
    expect(s.ubu.store.auditLog(500).filter((a) => a.action === "spawn")).toHaveLength(1);
    // An interactive agent's slot: queued, not given.
    await call(h, "take_slot", { project: "studio", name: "Zoe", label: "land" });
    expect(await call(h, "run_slots")).toMatchObject({ holders: [], queue: [{ holder: "interactive:Zoe" }] });
    // The new process starts what was held.
    running.splice(running.indexOf(s.ubu.sup), 1);
    await s.ubu.sup.shutdown();
    s.ubu.store.close();
    stores.delete(s.ubu.store);
    const next = await boot(s.net, "ubu1", UBU, { releases: s.releases, version: "2.0.0-rc.43", dir: s.ubu.dir });
    await until(() => next.sessions.length === 1);
    expect(next.store.worker(String(queued["id"]))!.state).toBe("running");
  });

  it("the row survives the restart; the new process says ready with its version once registered", async () => {
    const s = await setup();
    await s.upgrade();
    await until(() => s.ubu.restarts.length === 1);
    await until(() => s.bob().length === 2);
    // The old process goes; the new one starts on the same db, as the service manager starts current.
    running.splice(running.indexOf(s.ubu.sup), 1);
    await s.ubu.sup.shutdown();
    s.ubu.store.close();
    stores.delete(s.ubu.store);
    const next = await boot(s.net, "ubu1", UBU, { releases: s.releases, version: "2.0.0-rc.43", dir: s.ubu.dir });
    await until(() => s.bob().length === 3);
    expect(s.bob()[2]).toBe("ubu1: supervisor 2.0.0-rc.43 ready");
    expect(s.toMbp().at(-1)).toMatchObject({ v: 2, event: "upgrade", stage: "ready", version: "2.0.0-rc.43", from: RUNNING, to: "2.0.0-rc.43" });
    expect(next.store.upgradesRestarting()).toEqual([]);
    expect(next.store.upgrade(String(s.toMbp()[0]!["req"]))).toMatchObject({ stage: "ready" });
  });

  it("a restart mid-install: the installing row is failed by the new process, the requester told, the partial discarded (BOB-93 AC 1, AC 2)", async () => {
    const s = await setup();
    s.releases.gate = new Promise(() => {});
    await s.upgrade();
    await until(() => s.releases.calls.includes(`build ${TAG}`));
    const req = String(s.toMbp()[0]!["req"]);
    expect(s.ubu.store.upgrade(req)).toMatchObject({ requester: SUP_MBP, to_version: "2.0.0-rc.43", tag: TAG, stage: "installing" });
    // The service restarts it mid-build, on the release it ran: no switch was made.
    running.splice(running.indexOf(s.ubu.sup), 1);
    await s.ubu.sup.shutdown();
    s.ubu.store.close();
    stores.delete(s.ubu.store);
    const next = await boot(s.net, "ubu1", UBU, { releases: s.releases, dir: s.ubu.dir });
    await until(() => s.bob().length === 1);
    expect(s.bob()).toEqual(["ubu1: upgrade to 2.0.0-rc.43 failed at start: restarted while installing"]);
    expect(s.toMbp().at(-1)).toMatchObject({ v: 2, event: "upgrade", req, stage: "failed", step: "start", error: "restarted while installing", from: RUNNING, to: "2.0.0-rc.43" });
    expect(s.releases.calls.filter((c) => !c.startsWith("installed") && !c.startsWith("verify"))).toEqual([`build ${TAG}`, `discard ${TAG}`]);
    expect(next.store.upgrade(req)).toMatchObject({ stage: "failed" });
    expect(next.store.upgradesOpen()).toEqual([]);
    expect(next.restarts).toEqual([]);
  });

  it("a restart while waiting for idle: the new process fails the row before the switch, and says asking again switches to it", async () => {
    const s = await setup();
    await call(handlers(s.ubu.sup), "spawn_worker", { project: "studio", role: "ann", task: "busy" });
    await until(() => s.ubu.sessions.length === 1);
    await s.upgrade();
    await until(() => s.bob().length === 1);
    const req = String(s.toMbp()[0]!["req"]);
    expect(s.ubu.store.upgrade(req)).toMatchObject({ stage: "waiting" });
    running.splice(running.indexOf(s.ubu.sup), 1);
    await s.ubu.sup.shutdown();
    s.ubu.store.close();
    stores.delete(s.ubu.store);
    const next = await boot(s.net, "ubu1", UBU, { releases: s.releases, dir: s.ubu.dir });
    await until(() => s.bob().length === 2);
    expect(s.bob()[1]).toBe(`ubu1: upgrade to 2.0.0-rc.43 not done: restarted before the switch; ${TAG} stays installed, so asking again switches to it`);
    expect(next.store.upgrade(req)).toMatchObject({ stage: "failed" });
    expect(s.releases.calls).not.toContain(`switch ${TAG}`);
    expect(s.releases.calls).not.toContain(`discard ${TAG}`);
  });

  it("an upgrade asked during start(), before resume(), is refused: not failed, nothing discarded, no restart; once started it runs (BOB-105 AC 1, AC 3)", async () => {
    const net = new FakeNetwork();
    net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: RUNNING, protocol: 1 });
    const releases = new FakeReleases();
    // A build that never ends: without the refusal, resume() would take its row for a dead process's.
    releases.gate = new Promise(() => {});
    let letRolesRegister!: () => void;
    const ubu = await boot(net, "ubu1", UBU, { releases, holdRoles: new Promise((r) => (letRolesRegister = r)) });
    await ubu.link.register({ name: "Bob" });
    const mbp = await boot(net, "mbp-1", "");
    await mbp.link.register({ name: "Bob" });
    const toMbp = () => net.between(SUP_UBU, SUP_MBP).map((b) => JSON.parse(b) as Record<string, unknown>);
    const upgrade = () => call(handlers(mbp.sup), "upgrade_supervisor", { laptop: "ubu1", tag: TAG });
    // ubu1's supervisor name is registered, its roles not yet: start() is short of resume().
    await until(() => [...ubu.link.hosted.values()].some((i) => i.supervisor));
    await expect(upgrade()).rejects.toThrow("this supervisor is starting; ask again once it is ready");
    letRolesRegister();
    await ubu.started;
    await tick(20);
    // The reply was the whole story: no event, no row, nothing built or discarded, no exit.
    expect(toMbp().filter((m) => m["event"] === "upgrade")).toEqual([]);
    expect(ubu.store.upgradesOpen()).toEqual([]);
    expect(releases.calls).toEqual([]);
    expect(ubu.restarts).toEqual([]);
    // Asked again once started, it runs, and what it says is what happens.
    releases.gate = null;
    await upgrade();
    await until(() => ubu.restarts.length === 1);
    expect(toMbp().filter((m) => m["event"] === "upgrade").map((m) => m["stage"])).toEqual(["installed", "restarting"]);
    expect(ubu.store.upgrade(String(toMbp().at(-1)!["req"]))).toMatchObject({ stage: "restarting" });
    expect(releases.calls).not.toContain(`discard ${TAG}`);
  });

  it("a new process on another version (current switched back by hand) says failed: running X, not Y, and nothing rolls back by itself", async () => {
    const s = await setup();
    await s.upgrade();
    await until(() => s.ubu.restarts.length === 1);
    await until(() => s.bob().length === 2);
    running.splice(running.indexOf(s.ubu.sup), 1);
    await s.ubu.sup.shutdown();
    s.ubu.store.close();
    stores.delete(s.ubu.store);
    const next = await boot(s.net, "ubu1", UBU, { releases: s.releases, version: RUNNING, dir: s.ubu.dir });
    await until(() => s.bob().length === 3);
    expect(s.bob()[2]).toBe(`ubu1: upgrade to 2.0.0-rc.43 failed at start: running ${RUNNING}, not 2.0.0-rc.43`);
    expect(next.store.upgradesRestarting()).toEqual([]);
    expect(next.restarts).toEqual([]);
    expect(s.releases.calls.filter((c) => c.startsWith("switch"))).toEqual([`switch ${TAG}`]);
  });
});

describe("the upgrades table: an ended row stays ended (BOB-105 AC 2)", () => {
  it("moveUpgrade and endUpgrade touch only open rows: an ended row isn't reopened, and its first end stands", () => {
    const store = new Store(join(temp("bobnet-upgrade-store-"), "supervisor.db"));
    stores.add(store);
    store.addUpgrade({ req: "r1", requester: SUP_MBP, from_version: RUNNING, to_version: "2.0.0-rc.43", tag: TAG });
    expect(store.moveUpgrade("r1", "waiting")).toBe(true);
    expect(store.endUpgrade("r1", "failed")).toBe(true);
    const ended = store.upgrade("r1");
    expect(store.moveUpgrade("r1", "waiting")).toBe(false);
    expect(store.moveUpgrade("r1", "restarting")).toBe(false);
    expect(store.endUpgrade("r1", "ready")).toBe(false);
    expect(store.endUpgrade("r1", "installed")).toBe(false);
    expect(store.upgrade("r1")).toEqual(ended);
    expect(store.upgradesOpen()).toEqual([]);
    expect(store.upgradesRestarting()).toEqual([]);
  });

  it("an upgrade whose row was ended under it stops: no further event, no switch, no exit", async () => {
    const s = await setup();
    let build!: () => void;
    s.releases.gate = new Promise((r) => (build = r));
    await s.upgrade();
    await until(() => s.releases.calls.includes(`build ${TAG}`));
    const req = String(s.toMbp()[0]!["req"]);
    // As resume() did in M1: the row failed while its build ran.
    s.ubu.store.endUpgrade(req, "failed");
    build();
    await tick(20);
    expect(s.ubu.store.upgrade(req)).toMatchObject({ stage: "failed" });
    expect(s.toMbp().filter((m) => m["event"] === "upgrade")).toEqual([]);
    expect(s.releases.calls).not.toContain(`switch ${TAG}`);
    expect(s.ubu.restarts).toEqual([]);
    // It no longer holds the line: the next upgrade may go.
    await s.upgrade();
    await until(() => s.ubu.restarts.length === 1);
  });
});

describe("the requester (AC 5)", () => {
  it("the orchestrator is told once per stage, even when an event comes twice", async () => {
    const s = await setup();
    await s.upgrade({ restart: "no" });
    await until(() => s.bob().length === 1);
    const event = s.mbp.frames.find((f) => f.t === "deliver" && f.msg.body.includes('"event":"upgrade"'))!;
    s.mbp.sup.onPush(event);
    await tick(30);
    expect(s.bob()).toHaveLength(1);
    expect(audits(s.mbp.store)).toEqual([expect.objectContaining({ actor: SUP_UBU, stage: "installed" })]);
  });

  it("an event is taken only from the address the upgrade went to, and only for an upgrade sent", async () => {
    const s = await setup();
    await call(handlers(s.mbp.sup), "spawn_worker", { project: "studio", role: "ann", task: "x", laptop: "ubu1" });
    await s.upgrade({ restart: "no" });
    await until(() => s.bob().length === 1);
    const sentUpgrade = s.mbp.store.remoteSentList().find((r) => r.op === "upgrade")!.message_id!;
    const sentSpawn = s.mbp.store.remoteSentList().find((r) => r.op === "spawn")!.message_id!;
    const evil = s.net.link("evil");
    await evil.register({ name: "supervisor" });
    const event = (req: string) => JSON.stringify({ v: 2, event: "upgrade", req, stage: "ready", from: RUNNING, to: "2.0.0-rc.43", version: "2.0.0-rc.43" });
    await evil.request({ t: "send", as: "supervisor", to: [SUP_MBP], body: event(sentUpgrade) });
    await s.ubu.link.request({ t: "send", as: "supervisor", to: [SUP_MBP], body: event("m_never_sent") });
    await s.ubu.link.request({ t: "send", as: "supervisor", to: [SUP_MBP], body: event(sentSpawn) });
    await tick(50);
    expect(s.bob()).toHaveLength(1);
  });

  it("a failed stage carries its step and reason", async () => {
    const releases = new FakeReleases();
    releases.checkFails = new UpgradeStepError("check", "engines: node 22.1.0 doesn't satisfy >=24");
    const s = await setup({ releases });
    await s.upgrade();
    await until(() => s.bob().length === 1);
    expect(s.bob()[0]).toBe("ubu1: upgrade to 2.0.0-rc.43 failed at the preflight check: engines: node 22.1.0 doesn't satisfy >=24");
  });

  it("no ready within 10 minutes of restarting: told once, with the way back by hand, on the 5-minute loop", async () => {
    const s = await setup();
    await s.upgrade();
    await until(() => s.bob().length === 2);
    const req = s.mbp.store.remoteSentList().find((r) => r.op === "upgrade")!.message_id!;
    const row = s.mbp.store.remoteUpgrade(req)!;
    expect(row).toMatchObject({ laptop: "ubu1", to_version: "2.0.0-rc.43", root: "/fake/releases", overdue_told: 0 });
    // Nine minutes on: not yet.
    s.mbp.store.putRemoteUpgrade({ ...row, restarting_at: new Date(Date.now() - 9 * 60_000).toISOString() });
    s.net.advance(300);
    await tick(30);
    expect(s.bob()).toHaveLength(2);
    s.mbp.store.putRemoteUpgrade({ ...row, restarting_at: new Date(Date.now() - 11 * 60_000).toISOString() });
    s.net.advance(300);
    await until(() => s.bob().length === 3);
    expect(s.bob()[2]).toBe('ubu1: no ready from the supervisor since restarting into 2.0.0-rc.43; it may not have started. Roll back by hand there: ln -sfn "$(readlink /fake/releases/previous)" /fake/releases/current, then restart the service (ADR 0008 §6)');
    s.net.advance(300);
    await tick(30);
    s.net.advance(300);
    await tick(30);
    expect(s.bob()).toHaveLength(3);
  });

  it("ready in time: no overdue notice", async () => {
    const s = await setup();
    await s.upgrade();
    await until(() => s.bob().length === 2);
    const req = s.mbp.store.remoteSentList().find((r) => r.op === "upgrade")!.message_id!;
    await s.ubu.link.request({ t: "send", as: "supervisor", to: [SUP_MBP], body: JSON.stringify({ v: 2, event: "upgrade", req, stage: "ready", from: RUNNING, to: "2.0.0-rc.43", version: "2.0.0-rc.43" }) });
    await until(() => s.bob().length === 3);
    s.mbp.store.putRemoteUpgrade({ ...s.mbp.store.remoteUpgrade(req)!, restarting_at: new Date(Date.now() - 11 * 60_000).toISOString() });
    s.net.advance(300);
    await tick(30);
    expect(s.bob()).toHaveLength(3);
  });

  it("the tool is the laptop orchestrator's: refused for a lead worker, and not among a lead's tools", async () => {
    const s = await setup();
    await expect(call(handlers(s.mbp.sup, { lead: "w_lead" }), "upgrade_supervisor", { laptop: "ubu1", tag: TAG })).rejects.toThrow("upgrade_supervisor is the laptop's orchestrator's, never a lead's");
    expect(ORCHESTRATOR_ONLY.has("upgrade_supervisor")).toBe(true);
    expect(s.releases.calls).toEqual([]);
  });

  it("this laptop's own: in-process, with no grant, its stages as notices to its orchestrator", async () => {
    const s = await setup();
    const r = await call(handlers(s.ubu.sup), "upgrade_supervisor", { laptop: "ubu1", tag: TAG, restart: "no" });
    expect(r).toMatchObject({ laptop: "ubu1", from: RUNNING, to: "2.0.0-rc.43" });
    await until(() => s.ubuBob().length === 1);
    expect(s.ubuBob()).toEqual(["ubu1: supervisor 2.0.0-rc.43 installed, not restarting (restart: no); upgrade_supervisor again with restart when_idle or now switches to it"]);
    expect(audits(s.ubu.store)).toEqual([expect.objectContaining({ actor: "orchestrator", ok: true, tag: TAG }), expect.objectContaining({ actor: "orchestrator", stage: "installed" })]);
    // Still needs the upgrade section: mbp-1 has none.
    await expect(call(handlers(s.mbp.sup), "upgrade_supervisor", { laptop: "mbp-1", tag: TAG })).rejects.toThrow("no upgrade section");
  });

  it("this laptop's own, restarting: ready comes to its orchestrator from the new process", async () => {
    const s = await setup();
    await call(handlers(s.ubu.sup), "upgrade_supervisor", { laptop: "ubu1", tag: TAG });
    await until(() => s.ubu.restarts.length === 1);
    await until(() => s.ubuBob().length === 2);
    running.splice(running.indexOf(s.ubu.sup), 1);
    await s.ubu.sup.shutdown();
    s.ubu.store.close();
    stores.delete(s.ubu.store);
    await boot(s.net, "ubu1", UBU, { releases: s.releases, version: "2.0.0-rc.43", dir: s.ubu.dir });
    await until(() => s.ubuBob().some((b) => b.includes("ready")));
    expect(s.ubuBob().filter((b) => b.startsWith("ubu1: "))).toEqual([
      "ubu1: supervisor 2.0.0-rc.43 installed, restarting",
      `ubu1: supervisor restarting into 2.0.0-rc.43 (from ${RUNNING})`,
      "ubu1: supervisor 2.0.0-rc.43 ready",
    ]);
  });
});

// ---------- GitReleases: a fake origin, its clone, a fake installer ----------

const GIT = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=v2"];
const git = (cwd: string, ...args: string[]) => execFileSync("git", [...GIT, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).toString();

/** A release's tree at `version`: root package.json, the supervisor's (upgradable or not), a bin.ts whose `check` passes unless FAKE_CHECK=fail. */
function commitRelease(work: string, version: string, upgradable: boolean, tag: string) {
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "bobnet", version, engines: { node: ">=24" } }));
  mkdirSync(join(work, "packages", "supervisor", "src"), { recursive: true });
  writeFileSync(join(work, "packages", "supervisor", "package.json"), JSON.stringify({ name: "@bobnet/supervisor", version, ...(upgradable ? { bobnet: { upgradable: true } } : {}) }));
  writeFileSync(join(work, "packages", "supervisor", "src", "bin.ts"), `if (process.env.FAKE_CHECK === "fail") { console.error("config.json: No broker URL"); process.exit(1); }\nconsole.log("ok");\n`);
  git(work, "add", "-A");
  git(work, "commit", "-m", version);
  git(work, "tag", tag);
}

/** origin (bare) with v2: rc.40 (not upgradable), rc.43, rc.51 whose package.json says rc.50; rc.99 on a side branch, its tag pushed. */
function fakeRepo() {
  const base = temp("bobnet-releases-");
  const origin = join(base, "origin.git");
  const work = join(base, "work");
  git(base, "init", "--bare", origin);
  git(base, "init", work);
  commitRelease(work, "2.0.0-rc.40", false, "v2.0.0-rc.40");
  commitRelease(work, "2.0.0-rc.43", true, "v2.0.0-rc.43");
  commitRelease(work, "2.0.0-rc.50", true, "v2.0.0-rc.51");
  git(work, "checkout", "-b", "side", "v2.0.0-rc.43");
  commitRelease(work, "2.0.0-rc.99", true, "v2.0.0-rc.99");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "origin", "v2", "--tags");
  const clone = join(base, "clone");
  git(base, "clone", "--no-tags", origin, clone);
  const root = join(base, "releases");
  mkdirSync(root);
  return { base, origin, clone, root };
}

const releasesFor = (r: { clone: string; root: string }, opts: ConstructorParameters<typeof GitReleases>[1] = {}) =>
  new GitReleases({ repo: r.clone, root: r.root, line: "v2" }, { install: ["sh", "-c", "echo installed > installed.txt"], ...opts });

describe("GitReleases: only a tag on the line, built here (AC 3)", () => {
  it("the happy path: fetched, checked, archived, installed, preflighted, switched; the release before stays", async () => {
    const r = fakeRepo();
    // A hand install before it, as rc.42 is (§7).
    mkdirSync(join(r.root, "v2.0.0-rc.42"));
    symlinkSync("v2.0.0-rc.42", join(r.root, "current"));
    const g = releasesFor(r, { self: join(r.base, "work", "packages", "supervisor", "src", "upgrade.ts") });
    expect(g.missing()).toBeNull();
    expect(await g.installed(TAG)).toBeNull();
    expect(await g.verify(TAG)).toBe("2.0.0-rc.43");
    await g.build(TAG);
    expect(readFileSync(join(r.root, TAG, "installed.txt"), "utf8").trim()).toBe("installed");
    expect(JSON.parse(readFileSync(join(r.root, TAG, "package.json"), "utf8")).version).toBe("2.0.0-rc.43");
    await g.check(TAG);
    g.switch(TAG);
    expect(readlinkSync(join(r.root, "current"))).toBe(TAG);
    expect(readlinkSync(join(r.root, "previous"))).toBe("v2.0.0-rc.42");
    // No partial left, no install removed, and nothing written outside root.
    expect(readdirSync(r.root).sort()).toEqual(["current", "previous", "v2.0.0-rc.42", TAG].sort());
    expect(readdirSync(r.base).sort()).toEqual(["clone", "origin.git", "releases", "work"]);
    // Asked again, it is installed: no git work.
    expect(await g.installed(TAG)).toBe("2.0.0-rc.43");
  }, 30_000);

  it("refuses a tag not on origin/v2", async () => {
    const g = releasesFor(fakeRepo());
    await expect(g.verify("v2.0.0-rc.99")).rejects.toThrow("v2.0.0-rc.99 isn't on origin/v2: only a tag on the line is installed");
  });

  it("refuses a tag whose package.json version isn't the tag's", async () => {
    const g = releasesFor(fakeRepo());
    await expect(g.verify("v2.0.0-rc.51")).rejects.toThrow("v2.0.0-rc.51's package.json says version 2.0.0-rc.50, not 2.0.0-rc.51");
  });

  it("refuses a tag older than the first release that carries upgrade", async () => {
    const g = releasesFor(fakeRepo());
    await expect(g.verify("v2.0.0-rc.40")).rejects.toThrow("v2.0.0-rc.40 is older than the first release that carries upgrade");
  });

  it("refuses a tag origin doesn't have", async () => {
    const g = releasesFor(fakeRepo());
    await expect(g.verify("v9.9.9")).rejects.toThrow("git fetch of v9.9.9");
  });

  it("origin's tag is the trust root: a local tag of the same name elsewhere is replaced by origin's", async () => {
    const r = fakeRepo();
    git(r.clone, "tag", "v2.0.0-rc.43", "HEAD~2");
    const g = releasesFor(r);
    expect(await g.verify(TAG)).toBe("2.0.0-rc.43");
    expect(git(r.clone, "rev-parse", `${TAG}^{commit}`)).toBe(git(r.origin, "rev-parse", `${TAG}^{commit}`));
  });

  it("the archive is the commit verify checked: the tag moved after the check changes nothing, and is resolved once (BOB-91 AC 2)", async () => {
    const r = fakeRepo();
    // A git on the PATH that logs each call, then runs the real one.
    const bin = temp("bobnet-git-");
    const log = join(bin, "calls.log");
    const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
    writeFileSync(join(bin, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const g = releasesFor(r, { env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` } });
    expect(await g.verify(TAG)).toBe("2.0.0-rc.43");
    const verified = git(r.clone, "rev-parse", `${TAG}^{commit}`).trim();
    // Between the check and the archive, the tag is moved to rc.50's commit.
    git(r.clone, "tag", "-f", TAG, "origin/v2");
    expect(git(r.clone, "rev-parse", `${TAG}^{commit}`).trim()).not.toBe(verified);
    await g.build(TAG);
    expect(JSON.parse(readFileSync(join(r.root, TAG, "package.json"), "utf8")).version).toBe("2.0.0-rc.43");
    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => l.replace(`-C ${r.clone} `, ""));
    expect(calls.filter((c) => c.startsWith("rev-parse"))).toEqual([`rev-parse --verify --quiet refs/tags/${TAG}^{commit}`]);
    // After the fetch and the one rev-parse, every call names the commit, never the tag.
    expect(calls.slice(2)).toEqual([
      `merge-base --is-ancestor ${verified} refs/remotes/origin/v2`,
      `show ${verified}:package.json`,
      `show ${verified}:packages/supervisor/package.json`,
      `archive --format=tar --output=${join(r.root, `.${TAG}.partial.tar`)} ${verified}`,
    ]);
    // A build of a tag this supervisor didn't verify archives nothing.
    rmSync(join(r.root, TAG), { recursive: true });
    await expect(releasesFor(r).build(TAG)).rejects.toMatchObject({ step: "git archive", message: `${TAG} wasn't verified by this supervisor` });
    expect(readdirSync(r.root)).toEqual([]);
  }, 30_000);

  /** A git on the PATH that runs `before` (sh) when its subcommand is `sub`, then the real one. */
  const wrappedGit = (sub: string, before: string) => {
    const bin = temp("bobnet-git-");
    const real = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
    writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$3" = "${sub}" ]; then ${before}; fi\nexec "${real}" "$@"\n`, { mode: 0o755 });
    return { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` };
  };

  it("show parses only stdout: what git writes on stderr doesn't break the JSON (BOB-95 AC 1)", async () => {
    const g = releasesFor(fakeRepo(), { env: wrappedGit("show", "echo 'warning: a hint on stderr {' >&2") });
    expect(await g.verify(TAG)).toBe("2.0.0-rc.43");
  });

  it("verify's git calls share one deadline, under the requester's 90 s: slow calls end in time with a clear failure (BOB-95 AC 2)", async () => {
    expect(VERIFY_BUDGET_MS).toBeLessThan(remoteWaitMs("upgrade") - 10_000);
    // Each call is fast enough alone (well under the 1.5 s), but together they aren't.
    const g = releasesFor(fakeRepo(), { env: wrappedGit("show", "sleep 1"), verifyBudgetMs: 1500 });
    const started = Date.now();
    await expect(g.verify(TAG)).rejects.toThrow(new UpgradeRefused(`the checks of ${TAG} took longer than their 1.5 s (git show didn't finish in time); ask again`));
    // The bounds leave a busy laptop room (BOB-117): the message says the deadline cut it; time only rules out waiting it out.
    expect(Date.now() - started).toBeLessThan(5000);
    // A call that hangs (its own child holding the pipe) is cut at the deadline too, not when it lets go.
    const hung = releasesFor(fakeRepo(), { env: wrappedGit("merge-base", "sleep 30"), verifyBudgetMs: 1500 });
    const t = Date.now();
    await expect(hung.verify(TAG)).rejects.toThrow("(git merge-base didn't finish in time)");
    expect(Date.now() - t).toBeLessThan(5000);
  }, 30_000);

  it("a failed install removes the partial directory and reports the step with the end of its output", async () => {
    const r = fakeRepo();
    const g = releasesFor(r, { install: ["sh", "-c", "echo ERR_PNPM_OUTDATED_LOCKFILE >&2; exit 1"] });
    await g.verify(TAG);
    const err = await g.build(TAG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpgradeStepError);
    expect(err).toMatchObject({ step: "sh -c", message: "ERR_PNPM_OUTDATED_LOCKFILE" });
    expect(readdirSync(r.root)).toEqual([]);
  });

  it("a build cut short leaves .<tag>.partial: discard removes it, and a retry of the tag clears it before building (BOB-93 AC 2)", async () => {
    const r = fakeRepo();
    const g = releasesFor(r);
    const partial = join(r.root, `.${TAG}.partial`);
    const left = () => {
      mkdirSync(join(partial, "node_modules"), { recursive: true });
      writeFileSync(join(partial, "stale.txt"), "from the cut-short build");
      writeFileSync(`${partial}.tar`, "");
    };
    left();
    g.discard(TAG);
    expect(readdirSync(r.root)).toEqual([]);
    left();
    await g.verify(TAG);
    await g.build(TAG);
    expect(readdirSync(r.root)).toEqual([TAG]);
    expect(existsSync(join(r.root, TAG, "stale.txt"))).toBe(false);
  });

  it("a failed preflight throws with its output; the release's own bin.ts runs it", async () => {
    const r = fakeRepo();
    const g = releasesFor(r, { env: { ...process.env, FAKE_CHECK: "fail" } });
    await g.verify(TAG);
    await g.build(TAG);
    await expect(g.check(TAG)).rejects.toMatchObject({ step: "check", message: "config.json: No broker URL" });
  });

  it("a folder at <root>/<tag> that isn't that release is refused, not overwritten", async () => {
    const r = fakeRepo();
    mkdirSync(join(r.root, TAG));
    writeFileSync(join(r.root, TAG, "package.json"), JSON.stringify({ version: "2.0.0-rc.41" }));
    await expect(releasesFor(r).installed(TAG)).rejects.toThrow("is there but is version 2.0.0-rc.41, not 2.0.0-rc.43");
    mkdirSync(join(r.root, "v2.0.0-rc.40", "packages", "supervisor"), { recursive: true });
    writeFileSync(join(r.root, "v2.0.0-rc.40", "package.json"), JSON.stringify({ version: "2.0.0-rc.40" }));
    writeFileSync(join(r.root, "v2.0.0-rc.40", "packages", "supervisor", "package.json"), JSON.stringify({}));
    await expect(releasesFor(r).installed("v2.0.0-rc.40")).rejects.toThrow("older than the first release that carries upgrade");
  });

  it("says what is missing: a clone, or pnpm on the PATH", () => {
    const r = fakeRepo();
    expect(new GitReleases({ repo: join(r.base, "nowhere"), root: r.root, line: "v2" }).missing()).toContain("isn't a git clone on this laptop");
    expect(new GitReleases({ repo: r.clone, root: r.root, line: "v2" }, { env: { PATH: "/nonexistent" } }).missing()).toBe("pnpm isn't on the supervisor's PATH, so a release can't be installed here");
  });
});

describe("the switch and the service's path (AC 1 §1, AC 7)", () => {
  it("switchLink replaces a link atomically and leaves no temporary name", () => {
    const root = temp("bobnet-switch-");
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b"));
    switchLink(root, "current", "a");
    switchLink(root, "current", "b");
    expect(readlinkSync(join(root, "current"))).toBe("b");
    expect(readdirSync(root).sort()).toEqual(["a", "b", "current"]);
  });

  it("previous is the running release, not whatever current says", () => {
    const root = temp("bobnet-switch-");
    for (const t of ["v2.0.0-rc.42", "v2.0.0-rc.43", "v2.0.0-rc.44"]) mkdirSync(join(root, t, "packages", "supervisor", "src"), { recursive: true });
    const self = join(root, "v2.0.0-rc.42", "packages", "supervisor", "src", "upgrade.ts");
    writeFileSync(self, "");
    symlinkSync("v2.0.0-rc.44", join(root, "current"));
    new GitReleases({ repo: root, root, line: "v2" }, { self }).switch("v2.0.0-rc.43");
    expect(readlinkSync(join(root, "previous"))).toBe("v2.0.0-rc.42");
    expect(readlinkSync(join(root, "current"))).toBe("v2.0.0-rc.43");
  });

  it("install-systemd and install-launchd write <root>/current's bin.ts when run from a release under <root>, their own otherwise", () => {
    const root = temp("bobnet-root-");
    const bin = join(root, "v2.0.0-rc.42", "packages", "supervisor", "src", "bin.ts");
    mkdirSync(dirname(bin), { recursive: true });
    writeFileSync(bin, "");
    symlinkSync("v2.0.0-rc.42", join(root, "current"));
    const current = join(root, "current", "packages", "supervisor", "src", "bin.ts");
    expect(serviceBin(bin, root)).toBe(current);
    expect(serviceBin(current, root)).toBe(current);
    expect(runningRelease(root, current)).toBe("v2.0.0-rc.42");
    // A repo checkout: its own path, as before.
    const checkout = join(temp("bobnet-checkout-"), "packages", "supervisor", "src", "bin.ts");
    mkdirSync(dirname(checkout), { recursive: true });
    writeFileSync(checkout, "");
    expect(serviceBin(checkout, root)).toBe(checkout);
    expect(runningRelease(root, checkout)).toBeNull();
    // A partial build under root is no release.
    const partial = join(root, ".v2.0.0-rc.43.partial", "packages", "supervisor", "src", "bin.ts");
    mkdirSync(dirname(partial), { recursive: true });
    writeFileSync(partial, "");
    expect(serviceBin(partial, root)).toBe(partial);
  });

  it("the root install-* use is supervisor.yaml's upgrade.root, else the default; a config that doesn't parse gives the default", () => {
    const dir = temp("bobnet-cfg-");
    expect(releaseRoot(dir)).toBe(DEFAULT_RELEASE_ROOT);
    writeFileSync(join(dir, "supervisor.yaml"), "upgrade:\n  repo: /r\n  root: ~/rel\n");
    expect(releaseRoot(dir)).toBe(join(homedir(), "rel"));
    writeFileSync(join(dir, "supervisor.yaml"), ": : :");
    expect(releaseRoot(dir)).toBe(DEFAULT_RELEASE_ROOT);
  });
});

describe("workers never touch the releases (AC 6, Toad's criterion)", () => {
  it("policy.ts's guard on the supervisor's folder covers <root> and upgrade.root, for every worker, the orchestrator lead too", () => {
    const cfg = temp("bobnet-policy-");
    writeFileSync(join(cfg, "policy.yaml"), `rules:\n  - { id: any, tools: ["*"], decision: allow }\n  - { id: bash, tools: [Bash], command: ".", decision: allow, allow_compound: true }\n`);
    const p = Policy.load(cfg, [DEFAULT_RELEASE_ROOT, "/opt/bobnet"]);
    const home = homedir();
    const rel = DEFAULT_RELEASE_ROOT.slice(home.length);
    for (const ctx of [
      { project: "p", role: "r", writeRoots: ["/w", DEFAULT_RELEASE_ROOT], cwd: "/w" },
      { project: "p", role: "mario", writeRoots: ["/w"], cwd: "/w", orchestrator: true },
    ]) {
      const no = (tool: string, input: Record<string, unknown>) => expect(p.evaluate(tool, input, ctx)).toMatchObject({ decision: "deny", rule: "builtin:supervisor" });
      no("Write", { file_path: join(DEFAULT_RELEASE_ROOT, "current", "packages", "supervisor", "src", "bin.ts"), content: "x" });
      no("Edit", { file_path: join(DEFAULT_RELEASE_ROOT, TAG, "package.json"), old_string: "a", new_string: "b" });
      no("Read", { file_path: join(DEFAULT_RELEASE_ROOT, "previous") });
      no("Bash", { command: `ln -sfn v2.0.0-rc.1 ~${rel}/current` });
      no("Bash", { command: `cd $HOME${rel} && pnpm install` });
      no("Write", { file_path: "/opt/bobnet/current/x", content: "x" });
      no("Bash", { command: "git archive v2.0.0-rc.43 | tar -x -C /opt/bobnet/v2.0.0-rc.43" });
      expect(p.evaluate("Read", { file_path: "/w/README.md" }, ctx).rule).not.toBe("builtin:supervisor");
    }
    // The config folder stays covered.
    expect(p.evaluate("Read", { file_path: join(cfg, "supervisor.token") }, { project: "p", role: "r", writeRoots: ["/w"], cwd: "/w" })).toMatchObject({ rule: "builtin:supervisor" });
  });
});

describe("workers never touch the clone upgrades come from (BOB-91 AC 1, ADR 0008 ruling 5)", () => {
  it("bin.ts guards guardedFolders(config): <root>, upgrade.root and upgrade.repo, wherever the clone sits; the lead too", () => {
    const base = `orchestrator: Bob\nprojects:\n  p:\n    path: /w\n    roles:\n      a: { dir: /w/a }\n`;
    const none = parseSupervisorConfig(base, (d) => d);
    expect(guardedFolders(none)).toEqual([DEFAULT_RELEASE_ROOT]);
    const c = parseSupervisorConfig(`${base}upgrade:\n  repo: ~/Code/bobnet-releases.git\n  root: /opt/bobnet\n`, (d) => d);
    const clone = join(homedir(), "Code", "bobnet-releases.git");
    expect(guardedFolders(c)).toEqual([DEFAULT_RELEASE_ROOT, "/opt/bobnet", clone]);
    // The clone under <root>, as rc.42's notes have it: <root> covers it, besides its own entry.
    const under = join(DEFAULT_RELEASE_ROOT, ".src.git");
    expect(guardedFolders(parseSupervisorConfig(`${base}upgrade:\n  repo: ${under}\n`, (d) => d))).toEqual([DEFAULT_RELEASE_ROOT, under]);
    const cfg = temp("bobnet-policy-");
    writeFileSync(join(cfg, "policy.yaml"), `rules:\n  - { id: any, tools: ["*"], decision: allow }\n  - { id: bash, tools: [Bash], command: ".", decision: allow, allow_compound: true }\n`);
    const p = Policy.load(cfg, guardedFolders(c));
    for (const ctx of [
      { project: "p", role: "r", writeRoots: ["/w", join(homedir(), "Code")], cwd: "/w" },
      { project: "p", role: "mario", writeRoots: ["/w"], cwd: "/w", orchestrator: true },
    ]) {
      const no = (tool: string, input: Record<string, unknown>) => expect(p.evaluate(tool, input, ctx)).toMatchObject({ decision: "deny", rule: "builtin:supervisor" });
      no("Edit", { file_path: join(clone, "config"), old_string: "a", new_string: "b" });
      no("Write", { file_path: join(clone, "hooks", "post-checkout"), content: "x" });
      no("Bash", { command: "git -C ~/Code/bobnet-releases.git config core.sshCommand 'sh /tmp/x'" });
      no("Bash", { command: `git -C ${clone} remote set-url origin https://example.invalid/x.git` });
      no("Write", { file_path: "/opt/bobnet/current/x", content: "x" });
      no("Read", { file_path: join(DEFAULT_RELEASE_ROOT, "previous") });
      expect(p.evaluate("Read", { file_path: join(homedir(), "Code", "bobnet-releases") }, ctx).rule).not.toBe("builtin:supervisor");
    }
  });
});

describe("bin.ts check: the preflight (AC 4)", () => {
  it("satisfies reads engines ranges as npm writes them", () => {
    expect(satisfies("24.1.0", ">=24")).toBe(true);
    expect(satisfies("v22.11.0", ">=24")).toBe(false);
    expect(satisfies("24.1.0", "^24.0.0")).toBe(true);
    expect(satisfies("25.0.0", "^24.0.0")).toBe(false);
    expect(satisfies("24.3.1", ">=24.2 <26")).toBe(true);
    expect(satisfies("26.0.0", ">=24.2 <26")).toBe(false);
    expect(satisfies("20.0.0", "^18 || ^20")).toBe(true);
    expect(satisfies("24.1.0", "~24.1.0")).toBe(true);
    expect(satisfies("24.2.0", "~24.1.0")).toBe(false);
    expect(satisfies("24.1.0", "latest")).toBe(false);
  });

  /** A config folder that parses, with its broker config from the environment, never the live one. */
  function configFolder() {
    const dir = temp("bobnet-check-");
    writeFileSync(join(dir, "supervisor.yaml"), `orchestrator: Bob\nstate_dir: ${join(dir, "state")}\nprojects: {}\n`);
    writeFileSync(join(dir, "policy.yaml"), "rules: []\n");
    writeFileSync(join(dir, "config.json"), JSON.stringify({ url: "wss://broker.invalid/v1/ws" }));
    const env = { PATH: process.env["PATH"] ?? "", HOME: dir, BOBNET_CONFIG_DIR: dir, BOBNET_CONFIG: join(dir, "config.json"), BOBNET_ACCESS_CLIENT_ID: "id", BOBNET_ACCESS_CLIENT_SECRET: "not-a-real-one" };
    return { dir, env };
  }
  const release = (engines: string) => {
    const d = temp("bobnet-release-");
    writeFileSync(join(d, "package.json"), JSON.stringify({ engines: { node: engines } }));
    return d;
  };

  it("passes when node satisfies engines and the three configs parse under the release's schemas", () => {
    const { dir, env } = configFolder();
    expect(preflight(dir, release(">=24"), "24.1.0", env)).toEqual([]);
  });

  it("names each problem: the node version, a config the schema refuses, a missing config", () => {
    const { dir, env } = configFolder();
    writeFileSync(join(dir, "supervisor.yaml"), "orchestrator: Bob\nprojects: {}\nremote:\n  x@l: {}\n");
    rmSync(join(dir, "config.json"));
    const problems = preflight(dir, release(">=26"), "24.1.0", env);
    expect(problems).toEqual([
      "engines: node 24.1.0 doesn't satisfy >=26",
      expect.stringMatching(/^supervisor\.yaml: .*must grant spawn, upgrade: true, cleanup: true, or more than one/),
      expect.stringMatching(/^config\.json: /),
    ]);
  });

  it("resolves the SDK's native claude binary, and names it a problem when the platform package is missing (rc.57)", () => {
    expect(existsSync(claudeBinary())).toBe(true);
    const sdk = temp("bobnet-sdk-");
    writeFileSync(join(sdk, "sdk.mjs"), "");
    expect(() => claudeBinary(join(sdk, "sdk.mjs"), "linux", "x64")).toThrow(/claude-agent-sdk-linux-x64 or @anthropic-ai\/claude-agent-sdk-linux-x64-musl not installed/);
    const { dir, env } = configFolder();
    const missing = () => claudeBinary(join(sdk, "sdk.mjs"), "freebsd", "arm64");
    expect(preflight(dir, release(">=24"), "24.1.0", env, missing)).toEqual([expect.stringMatching(/^claude binary: @anthropic-ai\/claude-agent-sdk-freebsd-arm64 not installed/)]);
  });

  it("the real bin.ts check exits 0 on a good config, opening no db and taking no pid file, and 1 on a bad one", () => {
    const { dir, env } = configFolder();
    const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
    const ok = spawnSync(process.execPath, [bin, "check"], { env, encoding: "utf8", timeout: 60_000 });
    expect(ok.stderr).toBe("");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^ok: \d+\.\d+\.\d+/);
    expect(existsSync(join(dir, "state"))).toBe(false);
    writeFileSync(join(dir, "policy.yaml"), "default: allow\n");
    const bad = spawnSync(process.execPath, [bin, "check"], { env, encoding: "utf8", timeout: 60_000 });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/^policy\.yaml: /);
  }, 60_000);
});

describe("the release that carries it says so (AC 3)", () => {
  it("packages/supervisor/package.json has bobnet.upgradable: true", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { bobnet?: { upgradable?: boolean } };
    expect(pkg.bobnet?.upgradable).toBe(true);
  });
  it("REMOTE_TOOLS_SINCE is unchanged: the op needs no version gate, an old target refuses it", () => {
    expect(REMOTE_TOOLS_SINCE).toBe("2.0.0-rc.39");
  });
});
