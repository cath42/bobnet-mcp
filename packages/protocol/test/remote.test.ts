import { describe, expect, it } from "vitest";
import { classifyRemote, compareVersions, parseRemoteRequest, readRemoteRequest, RemoteEvent, RemoteExit, RemoteReply, RemoteRequestV1, RemoteRequestV2, RemoteUpgrade, RemoteWithheld, UPGRADE_TAG } from "../src/index.ts";
import * as rc41 from "./fixtures/remote-rc41.ts";

// The wire between supervisors (ADR 0007 §2, §9).

const by = "poe";
const SPAWN = { v: 2, op: "spawn", project: "studio", role: "ann", task: "one fix", by };

describe("v: 2 requests: each op with §2's fields", () => {
  const valid = [
    SPAWN,
    { ...SPAWN, tasks: ["BOB-1"], session: { feature: "BOB-1", kind: "build", label: "1" }, model: "opus", effort: "high", as: "worker" },
    { ...SPAWN, session: null },
    { v: 2, op: "status", id: "w_1" },
    { v: 2, op: "stop", id: "w_1" },
    { v: 2, op: "list" },
    { v: 2, op: "list", ids: ["w_1"], reqs: ["m_1"] },
    { v: 2, op: "tail", id: "w_1", n: 40 },
    { v: 2, op: "summary", id: "w_1" },
    { v: 2, op: "request", id: "r_1" },
    { v: 2, op: "answer", id: "r_1", decision: "allow", user_decided: false, resume: true },
    { v: 2, op: "answer", id: "r_1", decision: "answer", answers: { "Which?": "A" }, message: "go", user_decided: true, resume: false },
    { v: 2, op: "upgrade", tag: "v2.0.0-rc.43" },
    { v: 2, op: "upgrade", tag: "v2.1.0", restart: "now" },
  ];
  it.each(valid.map((b) => [b.op, b]))("parses a valid %s", (_op, body) => {
    expect(RemoteRequestV2.parse(body)).toEqual(body);
    expect(parseRemoteRequest(body)).toEqual({ v: 2, request: body });
  });

  const invalid: Array<[string, Record<string, unknown>, RegExp]> = [
    ["spawn without by", { v: 2, op: "spawn", project: "studio", role: "ann", task: "x" }, /^bad request: by /],
    ["spawn with an empty task", { ...SPAWN, task: "" }, /^bad request: task /],
    ["spawn with a bad effort", { ...SPAWN, effort: "huge" }, /^bad request: effort /],
    ["spawn with over 50 tasks", { ...SPAWN, tasks: Array.from({ length: 51 }, (_, i) => `BOB-${i}`) }, /^bad request: tasks /],
    ["status without id", { v: 2, op: "status" }, /^bad request: id /],
    ["stop with an empty id", { v: 2, op: "stop", id: "" }, /^bad request: id /],
    ["list with a number for an id", { v: 2, op: "list", ids: [1] }, /^bad request: ids\.0 /],
    ["tail without n", { v: 2, op: "tail", id: "w_1" }, /^bad request: n /],
    ["tail with n over 500", { v: 2, op: "tail", id: "w_1", n: 501 }, /^bad request: n /],
    ["summary with an extra key", { v: 2, op: "summary", id: "w_1", full: true }, /^bad request: full is not allowed$/],
    ["request without id", { v: 2, op: "request" }, /^bad request: id /],
    ["answer without user_decided", { v: 2, op: "answer", id: "r_1", decision: "allow", resume: true }, /^bad request: user_decided /],
    ["answer without resume", { v: 2, op: "answer", id: "r_1", decision: "allow", user_decided: false }, /^bad request: resume /],
    ["answer with a bad decision", { v: 2, op: "answer", id: "r_1", decision: "maybe", user_decided: false, resume: true }, /^bad request: decision /],
    ["an op not in this version", { v: 2, op: "slots" }, /^bad request: op /],
    ["upgrade without a tag", { v: 2, op: "upgrade" }, /^bad request: tag /],
    ["upgrade with a branch for a tag", { v: 2, op: "upgrade", tag: "v2" }, /^bad request: tag must be a release tag/],
    ["upgrade with a bad restart", { v: 2, op: "upgrade", tag: "v2.0.0", restart: "later" }, /^bad request: restart /],
    ["upgrade with a path", { v: 2, op: "upgrade", tag: "v2.0.0", path: "/tmp/x" }, /^bad request: path is not allowed$/],
    ["upgrade with an archive", { v: 2, op: "upgrade", tag: "v2.0.0", archive: "H4sI" }, /^bad request: archive is not allowed$/],
  ];
  it.each(invalid)("refuses %s", (_what, body, error) => {
    expect(RemoteRequestV2.safeParse(body).success).toBe(false);
    expect(parseRemoteRequest(body)).toEqual({ v: 2, re: body["op"], error: expect.stringMatching(error) });
  });
});

describe("a v: 2 spawn never carries a path, nor makes a lead (criterion 4)", () => {
  it.each([
    ["handoff", { handoff: "/Users/ct/.local/state/x.md" }],
    ["resume_session", { resume_session: "sess-x" }],
    ["an unknown key", { cwd: "/tmp" }],
  ])("refuses %s as a bad request, naming the key", (_what, extra) => {
    expect(parseRemoteRequest({ ...SPAWN, ...extra })).toEqual({ v: 2, re: "spawn", error: `bad request: ${Object.keys(extra)[0]} is not allowed` });
  });
  it('refuses as: "lead"', () => {
    expect(parseRemoteRequest({ ...SPAWN, as: "lead" })).toEqual({ v: 2, re: "spawn", error: expect.stringMatching(/^bad request: as /) });
  });
});

describe("requests without v: today's, unchanged", () => {
  it("parses rc.37's four ops, a lead spawn included", () => {
    for (const body of [{ op: "spawn", project: "studio", role: "bob", task: "x", as: "lead" }, { op: "status", id: "w_1" }, { op: "stop", id: "w_1" }, { op: "list" }]) {
      expect(RemoteRequestV1.parse(body)).toEqual(body);
      expect(parseRemoteRequest(body)).toEqual({ v: 1, request: body });
    }
  });
  it("has none of v: 2's ops or fields, and any v but 2 is an unknown key", () => {
    expect(parseRemoteRequest({ op: "tail", id: "w_1", n: 4 })).toEqual({ v: 1, re: "tail", error: expect.stringMatching(/^bad request: op /) });
    expect(parseRemoteRequest({ op: "spawn", project: "studio", role: "bob", task: "x", by })).toEqual({ v: 1, re: "spawn", error: "bad request: by is not allowed" });
    expect(parseRemoteRequest({ v: 3, op: "list" })).toEqual({ v: 1, re: "list", error: "bad request: v is not allowed" });
    expect(parseRemoteRequest({ v: "2", op: "list" })).toEqual({ v: 1, re: "list", error: "bad request: v is not allowed" });
  });
});

describe("a malformed request's error: re is the sent op, the error each bad key's path, body at the root", () => {
  it("a readable op with a bad key", () => {
    expect(parseRemoteRequest({ v: 2, op: "status", id: "w_1", handoff: "/x" })).toEqual({ v: 2, re: "status", error: "bad request: handoff is not allowed" });
    expect(parseRemoteRequest({ op: "spawn", project: "studio", role: "bob", task: "x", handoff: "/x" })).toEqual({ v: 1, re: "spawn", error: "bad request: handoff is not allowed" });
  });
  it("a nested bad key", () => {
    expect(parseRemoteRequest({ ...SPAWN, session: { feature: "BOB-1", kind: "build", path: "/x" } })).toEqual({ v: 2, re: "spawn", error: "bad request: session.path is not allowed" });
    expect(parseRemoteRequest({ ...SPAWN, session: { feature: "BOB-1", kind: "party" } })).toEqual({ v: 2, re: "spawn", error: expect.stringMatching(/^bad request: session\.kind /) });
  });
  it("a body that isn't an object", () => {
    for (const body of [[{ op: "list" }], "list", 2, null]) expect(parseRemoteRequest(body)).toEqual({ v: 1, re: "invalid", error: "bad request: body must be one JSON object" });
  });
  it("a body with no op, or one that isn't a string", () => {
    expect(parseRemoteRequest({ v: 2, id: "w_1" })).toEqual({ v: 2, re: "invalid", error: expect.stringMatching(/^bad request: op /) });
    expect(parseRemoteRequest({ v: 2, op: 5 })).toEqual({ v: 2, re: "invalid", error: expect.stringMatching(/^bad request: op /) });
    expect(parseRemoteRequest({})).toEqual({ v: 1, re: "invalid", error: expect.stringMatching(/^bad request: op /) });
  });
  it("never labels a root key op, as rc.37 did", () => {
    for (const body of [{ ...SPAWN, handoff: "/x" }, { op: "list", extra: 1 }]) expect((parseRemoteRequest(body) as { error: string }).error).not.toMatch(/\bop\b/);
  });
});

describe("replies and events", () => {
  it("a reply is { v: 2, re, req, ok, ... } or { v: 2, re, req, ok: false, error }", () => {
    expect(RemoteReply.parse({ v: 2, re: "list", req: "m_1", ok: true, workers: [] })).toEqual({ v: 2, re: "list", req: "m_1", ok: true, workers: [] });
    expect(RemoteReply.parse({ v: 2, re: "spawn", req: "m_1", ok: false, error: "no" })).toMatchObject({ ok: false, error: "no" });
    for (const bad of [{ v: 2, re: "spawn", req: "m_1", ok: false }, { re: "list", req: "m_1", ok: true }, { v: 2, re: "list", ok: true }, { v: 2, req: "m_1", ok: true }, { ok: false, op: "spawn", error: "no" }])
      expect(RemoteReply.safeParse(bad).success).toBe(false);
  });
  it.each(["remote_control", "request", "settled", "resumed", "exit", "withheld"])("an event %s is { v: 2, event, worker, spawn_req, ... }", (event) => {
    const body = { v: 2, event, worker: "w_1", spawn_req: "m_1", extra: "kept" };
    expect(RemoteEvent.parse(body)).toEqual(body);
    expect(RemoteEvent.safeParse({ ...body, spawn_req: undefined }).success).toBe(false);
  });
  it("a reply's worker and workers each have a string id; the rest of a view passes as it is (BOB-74)", () => {
    const ok = { v: 2, re: "status", req: "m_1", ok: true };
    expect(RemoteReply.parse({ ...ok, worker: { id: "w_1", state: "running", new_field: 1 } })).toMatchObject({ worker: { id: "w_1", new_field: 1 } });
    for (const bad of [{ worker: {} }, { worker: { id: 42 } }, { worker: "w_1" }, { workers: [{ id: "w_1" }, { id: null }] }, { workers: [{}] }]) expect(RemoteReply.safeParse({ ...ok, ...bad }).success).toBe(false);
  });
  it("an exit's state is one that ends a worker (BOB-74)", () => {
    const exit = { v: 2, event: "exit", worker: "w_1", spawn_req: "m_1" };
    for (const state of ["done", "failed", "stopped"]) expect(RemoteExit.safeParse({ ...exit, state }).success).toBe(true);
    for (const state of [undefined, "running", 1]) expect(RemoteExit.safeParse({ ...exit, state }).success).toBe(false);
  });
  it("a withheld stand-in names what it can: v, worker, spawn_req, re and req all optional (BOB-74)", () => {
    expect(RemoteWithheld.safeParse({ event: "withheld" }).success).toBe(true);
    expect(RemoteWithheld.parse({ v: 2, event: "withheld", re: "summary", req: "m_1" })).toEqual({ v: 2, event: "withheld", re: "summary", req: "m_1" });
    for (const bad of [{ event: "exit" }, { event: "withheld", worker: 42 }, { event: "withheld", v: 1 }]) expect(RemoteWithheld.safeParse(bad).success).toBe(false);
  });
  it("refuses an event not in this version, and today's v-less ones", () => {
    expect(RemoteEvent.safeParse({ v: 2, event: "party", worker: "w_1", spawn_req: "m_1" }).success).toBe(false);
    expect(RemoteEvent.safeParse({ event: "exit", worker: "w_1", state: "done" }).success).toBe(false);
  });
});

describe("upgrade (ADR 0008 §2, §3, §5; BOB-83 AC 1, AC 3)", () => {
  it("a tag is v<semver> or one of its rcs, nothing else", () => {
    for (const t of ["v2.0.0", "v2.0.0-rc.42", "v10.20.30-rc.1"]) expect(UPGRADE_TAG.test(t)).toBe(true);
    for (const t of ["2.0.0", "v2.0", "v2.0.0-rc", "v2.0.0-beta.1", "v2.0.0-rc.1 ", "v2.0.0;touch x", "../v2.0.0", "main", "origin/v2"]) expect(UPGRADE_TAG.test(t)).toBe(false);
  });
  it("an event is { v: 2, event: upgrade, req, stage, from, to, ... }, each stage", () => {
    for (const stage of ["installed", "restarting", "ready", "failed"]) {
      const body = { v: 2, event: "upgrade", req: "m_1", stage, from: "2.0.0-rc.42", to: "2.0.0-rc.43", extra: "kept" };
      expect(RemoteUpgrade.parse(body)).toEqual(body);
    }
    expect(RemoteUpgrade.safeParse({ v: 2, event: "upgrade", req: "m_1", stage: "ready", from: null, to: "2.0.0" }).success).toBe(true);
    for (const bad of [{ stage: "installing" }, { req: undefined }, { to: undefined }, { v: 1 }, { event: "exit" }])
      expect(RemoteUpgrade.safeParse({ v: 2, event: "upgrade", req: "m_1", stage: "ready", from: "a", to: "b", ...bad }).success).toBe(false);
  });
  it("it is no RemoteEvent: it names no worker, and isn't one of its events", () => {
    expect(RemoteEvent.safeParse({ v: 2, event: "upgrade", req: "m_1", stage: "ready", from: "a", to: "b" }).success).toBe(false);
    expect(classifyRemote(JSON.stringify({ v: 2, event: "upgrade", req: "m_1", stage: "ready", from: "a", to: "b" }))?.kind).toBe("event");
  });
  it("an old target (rc.41's wire) refuses the op as a bad request, so it runs nothing", () => {
    const body = { v: 2, op: "upgrade", tag: "v2.0.0-rc.43" };
    expect(rc41.parseRemoteRequest(body)).toEqual({ v: 2, re: "upgrade", error: expect.stringMatching(/^bad request: op /) });
    expect(rc41.readRemoteRequest(JSON.stringify(body))).toMatchObject({ v: 2, re: "upgrade" });
  });
  it("an old requester (rc.41's wire) refuses the event, so it is logged and dropped", () => {
    for (const stage of ["installed", "restarting", "ready", "failed"]) {
      const body = { v: 2, event: "upgrade", req: "m_1", stage, from: "2.0.0-rc.42", to: "2.0.0-rc.43" };
      expect(rc41.RemoteEvent.safeParse(body).success).toBe(false);
      expect(rc41.RemoteExit.safeParse(body).success).toBe(false);
    }
  });
  it("every op the old wire takes, this one takes the same: the change is additive", () => {
    const bodies = [SPAWN, { v: 2, op: "list", ids: ["w_1"] }, { v: 2, op: "tail", id: "w_1", n: 3 }, { op: "spawn", project: "p", role: "r", task: "t" }];
    for (const b of bodies) expect(parseRemoteRequest(b)).toEqual(rc41.parseRemoteRequest(b));
  });
});

describe("the classification: a request only with op, no in_reply_to, and neither re nor event", () => {
  // rc.37's replies carry op (from the BOB-44 spike, architecture/spikes/bob44-two-laptops.md).
  const RC37_REPLIES = [
    `{"ok":false,"op":"spawn","error":"Luigi@mbp-1 may not spawn athletic/phelps; it may spawn athletic/reviewer"}`,
    `{"ok":false,"op":"invalid","error":"bad request: op Unrecognized key: \\"handoff\\""}`,
    `{"ok":true,"op":"list","workers":[]}`,
  ];
  const RC37_EVENTS = [`{"event":"remote_control","worker":"w_17d04a81","url":"https://claude.ai/code/session_x"}`, `{"event":"exit","worker":"w_67a19a5b","state":"done"}`];
  const V2_REPLIES = [`{"v":2,"re":"list","req":"m_1","ok":true,"workers":[]}`, `{"v":2,"re":"spawn","op":"spawn","req":"m_1","ok":false,"error":"no"}`];
  const V2_EVENTS = [`{"v":2,"event":"exit","worker":"w_1","spawn_req":"m_1","state":"done"}`, `{"v":2,"event":"settled","op":"answer","worker":"w_1","spawn_req":"m_1"}`];

  it("reads a request, bare or fenced, v-less or v: 2, malformed included", () => {
    for (const body of [`{"op":"list"}`, '```json\n{"op":"status","id":"w_1"}\n```', `{"v":2,"op":"list"}`, `{"op":"nope"}`]) expect(classifyRemote(body, null)?.kind).toBe("request");
    expect(readRemoteRequest(`{"v":2,"op":"list"}`)).toEqual({ v: 2, request: { v: 2, op: "list" } });
    expect(readRemoteRequest(`{"op":"list"}`)).toEqual({ v: 1, request: { op: "list" } });
  });
  it("today's replies, sent in reply, are replies", () => {
    for (const body of RC37_REPLIES) {
      expect(classifyRemote(body, "m_1")?.kind).toBe("reply");
      expect(readRemoteRequest(body, "m_1")).toBeNull();
    }
  });
  it("v: 2 replies are replies, sent in reply or resent without it", () => {
    for (const body of V2_REPLIES)
      for (const inReplyTo of ["m_1", null]) {
        expect(classifyRemote(body, inReplyTo)?.kind).toBe("reply");
        expect(readRemoteRequest(body, inReplyTo)).toBeNull();
      }
  });
  it("events are events, today's and v: 2, with or without in_reply_to, op or not", () => {
    for (const body of [...RC37_EVENTS, ...V2_EVENTS])
      for (const inReplyTo of ["m_1", null]) {
        expect(classifyRemote(body, inReplyTo)?.kind).toBe("event");
        expect(readRemoteRequest(body, inReplyTo)).toBeNull();
      }
  });
  it("anything sent in reply is never a request, whatever its body", () => {
    expect(classifyRemote(`{"op":"list"}`, "m_1")?.kind).toBe("reply");
    expect(classifyRemote(`{"op":"list","re":null}`, null)?.kind).toBe("reply");
  });
  it("a plain message, a JSON array or a body without op is no request", () => {
    expect(classifyRemote("Hi supervisor", null)).toBeNull();
    expect(classifyRemote("{not json", null)).toBeNull();
    expect(classifyRemote(`[{"op":"list"}]`, null)).toBeNull();
    expect(readRemoteRequest(`{"id":"w_1"}`, null)).toBeNull();
  });
});

describe("compareVersions: x.y.z[-rc.n]", () => {
  it("orders rc numbers numerically, above 9 too", () => {
    expect(compareVersions("2.0.0-rc.37", "2.0.0-rc.38")).toBe(-1);
    expect(compareVersions("2.0.0-rc.38", "2.0.0-rc.37")).toBe(1);
    expect(compareVersions("2.0.0-rc.9", "2.0.0-rc.10")).toBe(-1);
    expect(compareVersions("2.0.0-rc.100", "2.0.0-rc.99")).toBe(1);
    expect(compareVersions("2.0.0-rc.38", "2.0.0-rc.38")).toBe(0);
  });
  it("puts every rc before its release, and after the release before it", () => {
    expect(compareVersions("2.0.0-rc.38", "2.0.0")).toBe(-1);
    expect(compareVersions("2.0.0", "2.0.0-rc.99")).toBe(1);
    expect(compareVersions("1.9.9", "2.0.0-rc.1")).toBe(-1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  });
  it("orders major, minor and patch numerically", () => {
    expect(compareVersions("2.0.10", "2.0.9")).toBe(1);
    expect(compareVersions("2.10.0", "2.9.0")).toBe(1);
    expect(compareVersions("10.0.0", "9.0.0")).toBe(1);
    expect(compareVersions("v2.0.0-rc.38", "2.0.0-rc.38")).toBe(0);
  });
  it("is unknown (null) for a missing or unparseable version", () => {
    for (const bad of [null, undefined, "", "garbage", "2.0", "2.0.0-beta.1", "2.0.0-rc", "2.0.0-rc.x", "2.0.0.0", " ", "rc.38"]) {
      expect(compareVersions(bad, "2.0.0")).toBeNull();
      expect(compareVersions("2.0.0", bad)).toBeNull();
    }
  });
});
