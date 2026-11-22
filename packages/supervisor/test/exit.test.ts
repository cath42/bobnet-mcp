import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Envelope, findSecret } from "@bobnet/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { GhCiPoll } from "../src/ci-poll.ts";
import { callTool, handlers } from "../src/mcp.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { type Detect, REMOTE_TOOLS_SINCE, Supervisor, withHandoff, withholdBody } from "../src/supervisor.ts";
import { fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";
import { FakeNetwork } from "./network.ts";

// The result comes back as text (ADR 0007 §6, §8; BOB-64): a `v: 2` worker's end reaches its
// spawner as an `exit` event carrying its handoff's text, read on the target, the whole body under
// 16 KiB; `summary` carries it too once ended; a worker failed at the target's start gets its exit.
// On the FakeNetwork: ubu1's supervisor is real; mbp-1's is real (with Bob) or scripted.

const POLICY = new Policy(`rules: []`);
const UBU = `  studio:
    path: /work/studio
    roles:
      ann: { dir: /work/studio-ann }
remote:
  supervisor@mbp-1: { spawn: { studio: [ann] } }
`;
const SUP_MBP = "supervisor@mbp-1";
const SUP_UBU = "supervisor@ubu1";
const SPAWN = { v: 2, op: "spawn", project: "studio", role: "ann", task: "one fix", by: "poe" } as const;
const KEY = "AKIAABCDEFGHIJKLMNOP";
/** The broker's detector before BOB-72 narrowed `password_assignment`: a newline written `\n` in a body runs into its value. */
const OLD_DETECT: Detect = (t) => findSecret(t) ?? (/\b(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/i.test(t) ? "password_assignment" : null);
/** A handoff no field of which matches the old detector, though its serialised form does. */
const MULTILINE = "# Handoff\n\nThe service reads its api_key:\n\nthen goes on.\n";

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

function newStore(): { dir: string; store: Store } {
  const dir = mkdtempSync(join(tmpdir(), "bobnet-exit-"));
  dirs.push(dir);
  const store = new Store(join(dir, "supervisor.db"));
  stores.add(store);
  return { dir, store };
}

async function boot(net: FakeNetwork, laptop: string, over: string, at = newStore(), query = fakeQuery(), detect?: Detect) {
  const link = net.link(laptop);
  const ciPoll = new GhCiPoll(quiet, async () => {
    throw new Error("no gh in tests");
  });
  const sup = new Supervisor({ config: testConfig(at.dir, over), policy: POLICY, store: at.store, broker: link, queryFn: query.queryFn, log: quiet, sandboxCheck: async () => null, ownerCheck: async () => false, sleep: net.sleep, ciPoll, ...(detect ? { detect } : {}) });
  link.onPush = (f) => sup.onPush(f);
  await sup.start();
  running.push(sup);
  /** Where a worker's handoff is on this laptop (its default path). */
  const handoff = (id: string) => join(at.dir, "handoffs", "studio", `${id}.md`);
  const writeHandoff = (id: string, text: string) => {
    mkdirSync(join(at.dir, "handoffs", "studio"), { recursive: true });
    writeFileSync(handoff(id), text);
  };
  return { sup, store: at.store, link, sessions: query.sessions, dir: at.dir, writeHandoff };
}

/** The fastest of 3 runs after one to warm up: a wall-clock bound, not the JIT's first pass (BOB-87). */
function fastest(run: () => unknown): number {
  run();
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    run();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

/** mbp-1's supervisor scripted: it sends requests and keeps what it gets. */
async function scripted(net: FakeNetwork) {
  const link = net.link("mbp-1");
  const got: Envelope[] = [];
  link.onPush = (f) => {
    if (f.t === "deliver") got.push(f.msg);
  };
  await link.register({ name: "supervisor" });
  const ask = async (body: unknown) => {
    const sent = await link.request<{ id: string }>({ t: "send", as: "supervisor", to: [SUP_UBU], body: JSON.stringify(body) });
    await until(() => got.some((m) => m.in_reply_to === sent.id));
    return { id: sent.id, reply: JSON.parse(got.find((m) => m.in_reply_to === sent.id)!.body) as Record<string, any> };
  };
  const exits = () => got.filter((m) => m.body.includes('"event":"exit"'));
  return { link, got, ask, exits };
}

/** ubu1 real, mbp-1 scripted, and one v: 2 worker of mbp-1's running on ubu1. */
async function spawned(query = fakeQuery(), detect?: Detect) {
  const net = new FakeNetwork();
  if (detect) net.detector = detect;
  const ubu = await boot(net, "ubu1", UBU, newStore(), query, detect);
  const mbp = await scripted(net);
  const { id: req, reply } = await mbp.ask(SPAWN);
  const id = reply["worker"].id as string;
  await until(() => ubu.sessions.length === 1);
  return { net, ubu, mbp, req, id };
}

/** Ends the worker with a handoff of `text` (none when null), and returns its exit as mbp-1 got it. */
async function endWith(s: Awaited<ReturnType<typeof spawned>>, text: string | null) {
  if (text !== null) s.ubu.writeHandoff(s.id, text);
  s.ubu.sessions[0]!.finish();
  await until(() => s.mbp.exits().length === 1);
  const msg = s.mbp.exits()[0]!;
  return { body: msg.body, exit: JSON.parse(msg.body) as Record<string, any> };
}

describe("the exit event carries the handoff's text (criterion 1)", () => {
  it("a real requester gets the text with no file read: the event, Bob's notice, and worker_summary", async () => {
    const net = new FakeNetwork();
    net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
    const ubu = await boot(net, "ubu1", UBU);
    const mbp = await boot(net, "mbp-1", "");
    await mbp.link.register({ name: "Bob" });
    const tools = handlers(mbp.sup);
    const call = async (name: string, args: Record<string, unknown>) => JSON.parse((await callTool(tools, name, args)).content[0]!.text);

    const { id } = await call("spawn_worker", { project: "studio", role: "ann", task: "one fix", laptop: "ubu1" });
    await until(() => ubu.sessions.length === 1);
    ubu.store.updateWorker(id, { checkpoint: "fix landed" });
    (ubu.sup as unknown as { landResults: Map<string, string[]> }).landResults.set(id, ["landed 1a2b3c4 on v2"]);
    ubu.writeHandoff(id, "# Done\n\nFixed it. Next: nothing.\n");
    ubu.sessions[0]!.finish();

    await until(() => net.between(SUP_UBU, SUP_MBP).some((b) => b.includes('"event":"exit"')));
    const exit = JSON.parse(net.between(SUP_UBU, SUP_MBP).find((b) => b.includes('"event":"exit"'))!);
    expect(exit).toEqual({ v: 2, event: "exit", worker: id, spawn_req: expect.any(String), state: "done", checkpoint: "fix landed", lands: ["landed 1a2b3c4 on v2"], handoff_text: "# Done\n\nFixed it. Next: nothing.\n" });
    expect(exit).not.toHaveProperty("handoff");
    await until(() => net.between(SUP_MBP, "Bob@mbp-1").some((b) => b.includes(id)));
    expect(net.between(SUP_MBP, "Bob@mbp-1")).toContain(`Ann (${id}, studio/ann) on ubu1 done: fix landed; handoff in worker_summary. Land: landed 1a2b3c4 on v2.`);
    expect(await call("worker_summary", { id })).toMatchObject({ laptop: "ubu1", worker: { id, state: "done" }, handoff_text: "# Done\n\nFixed it. Next: nothing.\n" });
  });

  it("carries the state, the checkpoint and the stop reason, the error cut to 500 characters", async () => {
    const s = await spawned();
    s.ubu.writeHandoff(s.id, "stopped half way");
    const stopping = s.ubu.sup.stop(s.id, `told to stop: ${"why ".repeat(300)}`);
    await until(() => s.ubu.sessions[0]!.inputs.length === 2);
    s.ubu.sessions[0]!.turnDone("handoff written");
    await stopping;
    await until(() => s.mbp.exits().length === 1);
    const exit = JSON.parse(s.mbp.exits()[0]!.body);
    expect(exit).toMatchObject({ v: 2, event: "exit", worker: s.id, spawn_req: s.req, state: "stopped", checkpoint: null, lands: [], handoff_text: "stopped half way" });
    expect(exit.error).toHaveLength(500);
    expect(exit.error).toMatch(/^told to stop: why why .*…$/);
  });

  it("a v-less spawn's worker gets today's exit, unchanged", async () => {
    const net = new FakeNetwork();
    const ubu = await boot(net, "ubu1", UBU);
    const mbp = await scripted(net);
    const { reply } = await mbp.ask({ op: "spawn", project: "studio", role: "ann", task: "one fix" });
    const id = reply["worker"].id as string;
    await until(() => ubu.sessions.length === 1);
    ubu.writeHandoff(id, "not sent");
    ubu.sessions[0]!.finish();
    await until(() => mbp.exits().length === 1);
    expect(JSON.parse(mbp.exits()[0]!.body)).toEqual({ event: "exit", worker: id, state: "done", checkpoint: null });
  });
});

describe("sized on the whole body (criterion 2)", () => {
  const event = { v: 2, event: "exit", worker: "w_1a2b3c4d", spawn_req: "m_0123456789abcdef", state: "failed", checkpoint: "F1 · a checkpoint", error: "e".repeat(500), lands: ["landed 1a2b3c4 on v2"] };
  const LIMIT = 16 * 1024;

  it.each([
    ["2 KB", 2_000, false],
    ["12 KB", 12_000, false],
    ["40 KB", 40_000, true],
  ])("a %s handoff: whole when it fits, else cut with handoff_truncated and the file's length; never over 16 KiB", (_, size, truncated) => {
    const text = "x".repeat(size - 1) + "\n";
    const out = withHandoff(event, text);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(LIMIT - 1024);
    if (!truncated) return expect(out).toEqual({ ...event, handoff_text: text });
    expect(out).toMatchObject({ handoff_truncated: true, handoff_length: 40_000 });
    expect(text.startsWith(out["handoff_text"] as string)).toBe(true);
    // Cut to the room there is, not far short of it.
    expect(JSON.stringify(out).length).toBeGreaterThan(LIMIT - 1024 - 10);
  });

  it("a handoff full of characters that escape is cut on its serialised length", () => {
    const text = '"\\\n\t\u0001'.repeat(3_000);
    const out = withHandoff(event, text);
    expect(out).toMatchObject({ handoff_truncated: true, handoff_length: 15_000 });
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(LIMIT - 1024);
    // 14 serialised characters for each 5: about 5,500 of them fit.
    expect((out["handoff_text"] as string).length).toBeLessThan(6_000);
    // Never half a surrogate pair.
    const emoji = withHandoff(event, "😀".repeat(20_000));
    expect(JSON.stringify(emoji).length).toBeLessThanOrEqual(LIMIT - 1024);
    expect((emoji["handoff_text"] as string).length % 2).toBe(0);
  });

  it("60 lands and a long handoff: the newest lands that fit, the rest counted, the whole body under 16 KiB, not dropped (BOB-74; BOB-64 AC 2)", async () => {
    const s = await spawned();
    const lands = Array.from({ length: 60 }, (_, i) => `landed ${String(i).padStart(2, "0")}: ${"a1b2c3d".repeat(4)} on v2, ${"x".repeat(240)}`);
    (s.ubu.sup as unknown as { landResults: Map<string, string[]> }).landResults.set(s.id, lands);
    const { body, exit } = await endWith(s, "h".repeat(40_000));
    expect(body.length).toBeLessThanOrEqual(LIMIT);
    expect(s.net.refused.filter((r) => r.to.includes(SUP_MBP))).toEqual([]);
    const got = exit["lands"] as string[];
    expect(got[0]).toMatch(/^\d+ earlier lands not listed$/);
    expect(Number(got[0]!.split(" ")[0]) + got.length - 1).toBe(60);
    expect(got.at(-1)).toBe(lands[59]);
    expect(exit).toMatchObject({ handoff_truncated: true, handoff_length: 40_000 });
    expect((exit["handoff_text"] as string).length).toBeGreaterThan(8_000);
  });

  it("on the wire: a 40 KB handoff and one that escapes both arrive, each body under 16 KiB", async () => {
    for (const text of ["y".repeat(40_000), '"\\\n'.repeat(10_000)]) {
      const s = await spawned();
      const { body, exit } = await endWith(s, text);
      expect(body.length).toBeLessThanOrEqual(LIMIT);
      expect(exit).toMatchObject({ handoff_truncated: true, handoff_length: text.length });
      expect(s.net.refused.filter((r) => r.to.includes(SUP_MBP))).toEqual([]);
    }
  });
});

describe("credentials (criterion 3)", () => {
  it("a credential-like span in the handoff is withheld, the rest goes", async () => {
    const s = await spawned();
    const { exit } = await endWith(s, `Deployed with ${KEY} as the key.\nNext: rotate it.`);
    expect(exit["handoff_text"]).toBe("Deployed with [withheld: looks like a credential] as the key.\nNext: rotate it.");
    expect(s.net.refused.filter((r) => r.to.includes(SUP_MBP))).toEqual([]);
  });

  it("a PEM block in the handoff: after redaction findSecret is null and no line of the key is left (BOB-73)", async () => {
    const key = ["b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW", "QyNTUxOQAAACDx3dVz0V3QyNTUxOQAAACDx3dVz0V3QyNTUxOQAAACDx3dVz0V3Q"];
    const pem = ["-----BEGIN OPENSSH PRIVATE KEY-----", ...key, "-----END OPENSSH PRIVATE KEY-----"].join("\n");
    const s = await spawned();
    const { body, exit } = await endWith(s, `# Handoff\n\nThe deploy key:\n${pem}\n\nNext: rotate it.\n`);
    expect(exit["handoff_text"]).toBe("# Handoff\n\nThe deploy key:\n[withheld: looks like a credential]\n\nNext: rotate it.\n");
    expect(findSecret(body)).toBeNull();
    for (const line of [...key, "END OPENSSH PRIVATE KEY"]) expect(body).not.toContain(line);
    expect(s.net.refused.filter((r) => r.to.includes(SUP_MBP))).toEqual([]);
  });

  it("the serialised body is checked after per-field redaction: a handoff that matches only serialised is withheld whole (BOB-72)", () => {
    const event = { v: 2, event: "exit", worker: "w_1", spawn_req: "m_1", state: "done", checkpoint: "fixed", lands: [] };
    expect(OLD_DETECT(MULTILINE)).toBeNull();
    expect(OLD_DETECT(JSON.stringify({ ...event, handoff_text: MULTILINE }))).toBe("password_assignment");
    const out = withHandoff(event, MULTILINE, OLD_DETECT);
    expect(out).toEqual({ ...event, handoff_text: null, handoff_withheld: true });
    expect(OLD_DETECT(JSON.stringify(out))).toBeNull();
    // Another field the same way: withheld whole, the rest kept.
    expect(withHandoff({ ...event, checkpoint: MULTILINE }, "fine", OLD_DETECT)).toEqual({ ...event, checkpoint: "[withheld: looks like a credential]", handoff_text: "fine" });
  });

  it("checked again after the whole-field withhold: a match across fields or in a key sends the stand-in (BOB-81 AC 2)", () => {
    // Neither string matches alone; serialised, `password=",[12345678]]}` does.
    const across = withholdBody({ v: 2, re: "status", req: "m_1", ok: true, x: ["note password=", [12345678]] });
    expect(across).toEqual({ v: 2, event: "withheld", re: "status", req: "m_1" });
    const key = { v: 2, event: "exit", worker: "w_1", spawn_req: "m_1", state: "done", tool_calls: { AKIAIOSFODNN7EXAMPLE: 1 } };
    expect(withholdBody(key)).toEqual({ v: 2, event: "withheld", worker: "w_1", spawn_req: "m_1" });
    // With a handoff, the stand-in goes as it is: no handoff added to it.
    expect(withHandoff(key, "the handoff")).toEqual({ v: 2, event: "withheld", worker: "w_1", spawn_req: "m_1" });
    for (const out of [across, withholdBody(key)]) expect(findSecret(JSON.stringify(out))).toBeNull();
  });

  it("BOB-80's corpus through withholdBody, then the broker's findSecret: null, each a mark in its place, no stand-in loop (BOB-80 AC 6, 7)", () => {
    const pgp = [`-----${"BEGIN"} PGP PRIVATE KEY BLOCK-----`, "", "lQOYBGXyAbcBCADsecretpgpbodyline", `-----${"END"} PGP PRIVATE KEY BLOCK-----`].join("\n");
    const ppk = (n: number) => [`PuTTY-User-Key-File-${n}${":"} ssh-ed25519`, "Encryption: none", "Private-Lines: 1", "AAAAIMsecretppkbodyline", `Private-MAC: ${"c3".repeat(n === 2 ? 20 : 32)}`].join("\n");
    const corpus = [
      "DB_PASSWORD=hunter2hunter2", "MYSQL_ROOT_PASSWORD: 'abcdefgh1'", "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY", 'export GH_PASSWORD = "abcdefghi"',
      pgp, `-----${"begin"} private key-----\nMIIEvQIBADANsecret\n-----${"end"} private key-----`, `-----${"BEGIN"} PGP PRIVATE KEY BLOCK-----\ncut off`, ppk(2), ppk(3), `PuTTY-User-Key-File-3${":"} cut off`,
      // Now withheld, though no secret (AC 7).
      "PASSWORD_RESET_URL=https://example.com/reset", "DB_PASSWORD=${DB_PASSWORD}", "PASSWORD_FILE=/run/secrets/db", "SECRET_NAME=prod-db-creds",
    ];
    for (const text of corpus) {
      expect(findSecret(text), text).not.toBeNull();
      const exit = { v: 2, event: "exit", worker: "w_1", spawn_req: "m_1", state: "done", checkpoint: `step: ${text}` };
      const out = withHandoff(exit, `# Handoff\n\n${text}\n\nNext: rotate it.\n`);
      expect(findSecret(JSON.stringify(out)), text).toBeNull();
      expect(out["handoff_text"], text).toContain("[withheld: looks like a credential]");
      expect(out["handoff_text"], text).toMatch(/^# Handoff\n\n[^]*\n\nNext: rotate it\.\n$/);
      expect(out["checkpoint"], text).toMatch(/^step: [^]*\[withheld: looks like a credential\]/);
      // Withheld again, it stays as it is: nothing in a stand-in matches.
      expect(withholdBody(out), text).toEqual(out);
    }
  });

  it("on the wire, against the fake's detector: the exit goes, with its state, the handoff withheld (BOB-72)", async () => {
    const s = await spawned(fakeQuery(), OLD_DETECT);
    const { body, exit } = await endWith(s, MULTILINE);
    expect(exit).toMatchObject({ v: 2, event: "exit", worker: s.id, state: "done", handoff_text: null, handoff_withheld: true });
    expect(OLD_DETECT(body)).toBeNull();
    expect(s.net.refused.filter((r) => r.to.includes(SUP_MBP))).toEqual([]);
  });
});

describe("summary carries the handoff once ended (criterion 4)", () => {
  it("not while running; once ended, handoff_text, sized with the reply", async () => {
    const s = await spawned();
    s.ubu.writeHandoff(s.id, "written early");
    expect((await s.mbp.ask({ v: 2, op: "summary", id: s.id })).reply).not.toHaveProperty("handoff_text");
    await endWith(s, "the handoff, for a requester whose exit expired");
    expect((await s.mbp.ask({ v: 2, op: "summary", id: s.id })).reply).toMatchObject({ v: 2, re: "summary", ok: true, worker: { id: s.id, state: "done" }, handoff_text: "the handoff, for a requester whose exit expired" });
    s.ubu.writeHandoff(s.id, "z".repeat(40_000));
    const msg = s.mbp.got.at(-1)!;
    const { reply } = await s.mbp.ask({ v: 2, op: "summary", id: s.id });
    expect(reply).toMatchObject({ ok: true, handoff_truncated: true, handoff_length: 40_000 });
    expect(s.mbp.got.at(-1)!.body.length).toBeLessThanOrEqual(16 * 1024);
    expect(s.mbp.got.at(-1)).not.toBe(msg);
  });
});

describe("A-fixes-2's minors (BOB-87)", () => {
  it("a summary withHandoff withholds goes as the stand-in without ok, audited as withheld (AC 2)", async () => {
    // Matches the summary's ok reply serialised, field by field and whole, but not its stand-in.
    const tripped: Detect = (t) => findSecret(t) ?? (/"re":"summary","req":"[^"]+","ok":true,"worker":\{/.test(t) ? "test_trip" : null);
    const s = await spawned(fakeQuery(), tripped);
    await endWith(s, "the handoff");
    const { id: req, reply } = await s.mbp.ask({ v: 2, op: "summary", id: s.id });
    expect(reply).toEqual({ v: 2, event: "withheld", worker: s.id, re: "summary", req });
    const audit = s.ubu.store.auditLog(50).filter((a) => JSON.parse(a.detail)["message"] === req);
    expect(audit).toEqual([expect.objectContaining({ action: "remote:withheld", worker_id: s.id })]);
    expect(JSON.parse(audit[0]!.detail)).toEqual({ message: req, re: "summary" });
    expect(s.net.refused.filter((r) => r.to.includes(SUP_MBP))).toEqual([]);
  });

  it("the supervisor's 200 KB adversarial handoffs: withHandoff under 250 ms (linear: a backtracking pattern takes seconds; room for the land's load, BOB-117's rule; 74 ms seen), warmed up, best of 3 (AC 4)", () => {
    const event = { v: 2, event: "exit", worker: "w_1", spawn_req: "m_1", state: "done", checkpoint: "fixed", lands: [] };
    const n = 200_000;
    const fill = (unit: string) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    const inputs = [fill("eyJ-"), fill("_password="), fill("password=x;"), fill("-----BEGIN PRIVATE KEY-----\n"), fill("-----END PRIVATE KEY-----\n"), fill(`PuTTY-User-Key-File-3${":"} x\n`), fill("Private-MAC: "), fill("AKIA")];
    for (const text of inputs) {
      expect(fastest(() => withHandoff(event, text)), text.slice(0, 20)).toBeLessThan(250);
      expect(findSecret(JSON.stringify(withHandoff(event, text))), text.slice(0, 20)).toBeNull();
    }
  });
});

describe("at the target's start (criterion 5)", () => {
  it("each v: 2 worker it fails gets an exit (failed) with its handoff, sent once connected", async () => {
    const at = newStore();
    const w = at.store.createWorker({ project: "studio", role: "ann", task: "one fix", handoff: null, priority: 0, resume_session: null, spawned_by: SUP_MBP, remote_by: "poe", spawn_req: "m_spawn1" });
    at.store.updateWorker(w.id, { state: "running", checkpoint: "half way" });
    const bare = at.store.createWorker({ project: "studio", role: "ann", task: "no file", handoff: null, priority: 0, resume_session: null, spawned_by: SUP_MBP, remote_by: "poe", spawn_req: "m_spawn2" });
    at.store.updateWorker(bare.id, { state: "running" });
    const local = at.store.createWorker({ project: "studio", role: "ann", task: "local", handoff: null, priority: 0, resume_session: null });
    at.store.updateWorker(local.id, { state: "running" });
    mkdirSync(join(at.dir, "handoffs", "studio"), { recursive: true });
    writeFileSync(join(at.dir, "handoffs", "studio", `${w.id}.md`), "what I got done before the restart");

    const net = new FakeNetwork();
    const mbp = await scripted(net);
    await boot(net, "ubu1", UBU, at);
    await until(() => mbp.exits().length === 2);
    const exits = mbp.exits().map((m) => JSON.parse(m.body));
    expect(exits).toEqual([
      { v: 2, event: "exit", worker: w.id, spawn_req: "m_spawn1", state: "failed", checkpoint: "half way", error: "supervisor restarted", lands: [], handoff_text: "what I got done before the restart" },
      { v: 2, event: "exit", worker: bare.id, spawn_req: "m_spawn2", state: "failed", checkpoint: null, error: "supervisor restarted", lands: [], handoff_text: null },
    ]);
  });
});

describe("Remote Control (criterion 6)", () => {
  it("the url goes to the spawner as a v: 2 remote_control event", async () => {
    const s = await spawned();
    await until(() => s.mbp.got.some((m) => m.body.includes('"event":"remote_control"')));
    expect(JSON.parse(s.mbp.got.find((m) => m.body.includes('"event":"remote_control"'))!.body)).toEqual({ v: 2, event: "remote_control", worker: s.id, spawn_req: s.req, url: "https://claude.ai/code/session_test" });
  });

  it("so does the error it runs without", async () => {
    const s = await spawned(fakeQuery({ remoteControl: false }));
    await until(() => s.mbp.got.some((m) => m.body.includes('"event":"remote_control"')));
    expect(JSON.parse(s.mbp.got.find((m) => m.body.includes('"event":"remote_control"'))!.body)).toEqual({ v: 2, event: "remote_control", worker: s.id, spawn_req: s.req, error: expect.stringMatching(/no enableRemoteControl/) });
  });
});

describe("no handoff file (criterion 7)", () => {
  it.each([
    ["missing", null],
    ["empty", ""],
    ["blank", "  \n"],
  ])("a %s file: handoff_text null in the exit and the summary", async (_, text) => {
    const s = await spawned();
    const { exit } = await endWith(s, text);
    expect(exit).toMatchObject({ state: "done", handoff_text: null });
    expect(exit).not.toHaveProperty("handoff_truncated");
    expect((await s.mbp.ask({ v: 2, op: "summary", id: s.id })).reply).toMatchObject({ ok: true, handoff_text: null });
  });

  it("the requester's notice says no handoff file", async () => {
    const net = new FakeNetwork();
    net.clients.set(SUP_UBU, { package: "@bobnet/supervisor", version: REMOTE_TOOLS_SINCE, protocol: 1 });
    const ubu = await boot(net, "ubu1", UBU);
    const mbp = await boot(net, "mbp-1", "");
    await mbp.link.register({ name: "Bob" });
    const r = await callTool(handlers(mbp.sup), "spawn_worker", { project: "studio", role: "ann", task: "one fix", laptop: "ubu1" });
    const { id } = JSON.parse(r.content[0]!.text) as { id: string };
    await until(() => ubu.sessions.length === 1);
    ubu.sessions[0]!.fail();
    await until(() => net.between(SUP_MBP, "Bob@mbp-1").some((b) => b.includes(id)));
    expect(net.between(SUP_MBP, "Bob@mbp-1").find((b) => b.includes(id))).toMatch(new RegExp(`^Ann \\(${id}, studio/ann\\) on ubu1 failed: .+; no handoff file\\.$`));
    // Delivered again, it isn't told twice.
    const exit = net.log.find((m) => m.body.includes('"event":"exit"'))!;
    mbp.sup.onPush({ t: "deliver", to: SUP_MBP, wake: true, msg: exit } as never);
    await tick(20);
    expect(net.between(SUP_MBP, "Bob@mbp-1").filter((b) => b.includes(id))).toHaveLength(1);
  });
});
