import { describe, expect, it } from "vitest";
import { BOARD_READS, BoardOp, downsample, ClientFrame, ItemRef, PeerAddress, SUPERVISOR_OPS, type WaitRecord } from "../src/index.ts";

describe("BoardOp", () => {
  it("parses an item's create with its criteria, defaulting each to an acceptance criterion", () => {
    const op = BoardOp.parse({ op: "create", project: "helix", kind: "task", type: "task", title: "Ship it", parent: "LAND-49", criteria: [{ text: "It ships" }] });
    expect(op).toMatchObject({ op: "create", criteria: [{ text: "It ships", section: "ac", casper_gate: false }] });
  });

  it("refuses a status outside Helix's five, a kind that isn't one, and a malformed id", () => {
    expect(BoardOp.safeParse({ op: "update", project: "helix", ref: "LAND-1", set: { status: "Blocked" } }).success).toBe(false);
    expect(BoardOp.safeParse({ op: "create", project: "helix", kind: "bug", type: "bug", title: "x" }).success).toBe(false);
    expect(BoardOp.safeParse({ op: "get", project: "helix", ref: "land-1" }).success).toBe(false);
  });

  it("takes a flat or a dotted ref as an item's, and nothing that isn't an id", () => {
    for (const ok of ["LAND-49", "LAND-49.14", "LAND-49.3.1"]) expect(ItemRef.safeParse(ok).success).toBe(true);
    for (const bad of ["LAND-49.", "land-49", "LAND-", "LAND-49..1"]) expect(ItemRef.safeParse(bad).success).toBe(false);
    expect(BoardOp.parse({ op: "update", project: "helix", ref: "LAND-49.14", set: { status: "Done" } })).toMatchObject({ ref: "LAND-49.14" });
  });

  it("takes a lead as name@laptop, built from the address segment", () => {
    expect(PeerAddress.safeParse("Mario@mbp-1").success).toBe(true);
    for (const bad of ["Mario", "Mario@", "@mbp-1", "Mario@*", "Mario@mbp-1@x", "Mario@Board", "1Mario@mbp-1"]) {
      expect(PeerAddress.safeParse(bad).success).toBe(false);
    }
  });

  it("has no session kind other: other work is a run with no session", () => {
    const join = { op: "session_join", project: "helix", session: { feature: "LAND-49", kind: "other", label: "1" } };
    expect(BoardOp.safeParse(join).success).toBe(false);
  });

  const badLinks = ["http://claude.ai/code/s_1", "javascript:alert(1)", "javascript://claude.ai/%0aalert(1)", "data:text/html,x", "https://evil.example/code/s_1", "https://claude.ai.evil.example/x", "not a url", `https://claude.ai/${"x".repeat(500)}`];

  it("takes a run's Remote Control link only as a claude.ai https link", () => {
    const remote = { op: "run_remote", project: "helix", id: "w_1" };
    expect(BoardOp.parse({ ...remote, remote_url: "https://claude.ai/code/s_1" })).toMatchObject({ op: "run_remote", id: "w_1", remote_url: "https://claude.ai/code/s_1" });
    for (const bad of [...badLinks, null]) {
      expect(BoardOp.safeParse({ ...remote, remote_url: bad }).success).toBe(false);
    }
    expect(BoardOp.safeParse(remote).success).toBe(false);
  });

  it("takes run_start's optional link only as a claude.ai https link", () => {
    const start = { op: "run_start", project: "helix", id: "w_1", started_at: "2026-11-15T10:00:00Z", session: null };
    expect(BoardOp.parse(start)).toMatchObject({ op: "run_start", id: "w_1" });
    expect(BoardOp.parse({ ...start, remote_url: null })).toMatchObject({ remote_url: null });
    expect(BoardOp.parse({ ...start, remote_url: "https://claude.ai/code/s_1" })).toMatchObject({ remote_url: "https://claude.ai/code/s_1" });
    for (const bad of badLinks) {
      expect(BoardOp.safeParse({ ...start, remote_url: bad }).success).toBe(false);
    }
  });

  it("takes a grant for every project only as *", () => {
    const grant = { op: "grant", agent: "Mario", role: "lead", read: true, items: "none", fields: [] };
    expect(BoardOp.parse({ ...grant, project: "*" })).toMatchObject({ project: "*", laptop: "*", admin: false });
    expect(BoardOp.safeParse({ ...grant, project: "**" }).success).toBe(false);
  });
});

describe("step 2's operations", () => {
  const uuid = "6f1c1a52-6c0e-4d39-9a49-0a6c4f1f6a10";

  it("captures with an id made where it was captured, a task unless typed, never a feature", () => {
    expect(BoardOp.parse({ op: "capture", project: "helix", capture_id: uuid, title: "Fix the chart" })).toMatchObject({ type: "task" });
    expect(BoardOp.safeParse({ op: "capture", project: "helix", capture_id: "not-a-uuid", title: "x" }).success).toBe(false);
    expect(BoardOp.safeParse({ op: "capture", project: "helix", capture_id: uuid, title: "x", type: "increment" }).success).toBe(false);
  });

  it("closes a session with its summary and handoff, defaulting the lists", () => {
    const close = BoardOp.parse({
      op: "close_session",
      project: "helix",
      session: { feature: "LAND-49", kind: "review", label: "1" },
      need: "none",
      summary: "Reviewed",
      handoff: { path: "/tmp/h.md", text: "# Handoff" },
    });
    expect(close).toMatchObject({ waits_on: [], blockers: [], moves: [], minors_fixed: 0 });
    expect(BoardOp.safeParse({ ...close, summary: "x".repeat(301) }).success).toBe(false);
  });

  it("reports runs in tokens with context per call, and no money", () => {
    const end = { op: "run_end", project: "helix", id: "w_1a2b3c4d", ended_at: "2026-11-14T10:00:00.000Z", tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 }, calls: 2, ctx: [10, 20] };
    expect(BoardOp.parse(end)).toMatchObject({ ctx: [10, 20] });
    expect(BoardOp.safeParse({ ...end, ctx: Array.from({ length: 2001 }, () => 1) }).success).toBe(false);
    expect(BoardOp.parse({ ...end, cost_usd: 1 })).not.toHaveProperty("cost_usd");
  });

  it("gets a question by its ref and a session by what declares it", () => {
    expect(BoardOp.safeParse({ op: "get", project: "helix", ref: "Q-258" }).success).toBe(true);
    expect(BoardOp.safeParse({ op: "get", project: "helix", session: { feature: "LAND-49", kind: "build", label: "1" } }).success).toBe(true);
  });
});

describe("BOB-121's reads (ADR 0014 §3, §3a)", () => {
  it("bounds usage to 1..90 days and a zone name of 60, 30 days in UTC by default, and reads it as a read", () => {
    expect(BoardOp.parse({ op: "usage" })).toEqual({ op: "usage", days: 30, tz: "UTC" });
    expect(BoardOp.parse({ op: "usage", project: "helix", days: 90, tz: "Europe/Copenhagen" })).toMatchObject({ days: 90, tz: "Europe/Copenhagen" });
    for (const bad of [{ days: 0 }, { days: 91 }, { days: 1.5 }, { tz: "" }, { tz: "x".repeat(61) }]) expect(BoardOp.safeParse({ op: "usage", ...bad }).success).toBe(false);
    expect(BOARD_READS).toContain("usage");
  });

  it("takes usage_day for one project and a YYYY-MM-DD day, with usage's bounds, and keeps downsample's rule", () => {
    expect(BoardOp.parse({ op: "usage_day", project: "helix", day: "2026-11-22" })).toEqual({ op: "usage_day", project: "helix", day: "2026-11-22", days: 30, tz: "UTC" });
    for (const bad of [{ day: "22-11-2026" }, { day: "2026-11-22", days: 91 }, { day: "2026-11-22", tz: "x".repeat(61) }]) expect(BoardOp.safeParse({ op: "usage_day", project: "helix", ...bad }).success).toBe(false);
    expect(BoardOp.safeParse({ op: "usage_day", day: "2026-11-22" }).success).toBe(false);
    expect(BOARD_READS).toContain("usage_day");
    const kept = downsample(Array.from({ length: 5000 }, (_, i) => i));
    expect([kept.length, kept[0], kept.at(-1)]).toEqual([2000, 0, 4999]);
    expect(downsample([1, 2])).toEqual([1, 2]);
  });
});

describe("board_op frame", () => {
  it("carries the operation, the peer and the supervisor's ctx", () => {
    const ctx = { worker: "w_1", role: "po", project: "helix", session: { feature: "LAND-49", kind: "build", label: "3" }, tasks: ["LAND-50"] };
    const f = ClientFrame.parse({ t: "board_op", rid: "1", as: "Riker", ctx, op: { op: "get", project: "helix", ref: "LAND-50" } });
    expect(f).toMatchObject({ t: "board_op", as: "Riker", ctx });
  });

  it("is sent without a peer by the owner's socket", () => {
    expect(ClientFrame.safeParse({ t: "board_op", rid: "1", op: { op: "projects" } }).success).toBe(true);
  });
});

describe("WaitRecord (BOB-31)", () => {
  it("carries a question's or action's context, null for a review gate or a bug; the ask op takes it up to 16 KB", () => {
    const wait = (kind: WaitRecord["kind"], context: string | null): WaitRecord => ({
      project: "helix", kind, ref: "Q-1", feature: null, text: "Ship it?", recommended: null, context, holds: { items: [], sessions: [] },
      waiting_sessions: [], needed_before: null, asked_by: null, since: "2026-11-15T00:00:00.000Z", blocking: false, edits: [],
    });
    expect(wait("question", "Line one\nLine two").context).toBe("Line one\nLine two");
    expect(wait("review_gate", null).context).toBeNull();
    expect(BoardOp.safeParse({ op: "ask", project: "helix", text: "Ship it?", context: "x".repeat(16 * 1024) }).success).toBe(true);
    expect(BoardOp.safeParse({ op: "ask", project: "helix", text: "Ship it?", context: "x".repeat(16 * 1024 + 1) }).success).toBe(false);
  });
});

describe("edit_question (BOB-119)", () => {
  it("sets only what it names, from the fields an ask has; kind, state and answers aren't among them", () => {
    const edit = (set: Record<string, unknown>) => BoardOp.safeParse({ op: "edit_question", project: "helix", ref: "A-24", set, reason: "holds were left out" });
    expect(edit({ holds: ["LAND-49"], holds_sessions: [{ feature: "LAND-49", kind: "build", label: "3" }] }).success).toBe(true);
    expect(edit({ text: "Ship it?", context: null, needed_before: null, options: [{ key: "a", text: "Yes" }] }).success).toBe(true);
    expect(edit({}).success).toBe(true);
    expect(edit({ kind: "question" }).success).toBe(false);
    expect(edit({ state: "open" }).success).toBe(false);
    expect(edit({ text: " " }).success).toBe(false);
    expect(BoardOp.safeParse({ op: "edit_question", project: "helix", ref: "LAND-1", set: {} }).success).toBe(false);
  });
});

describe("Waits is never stale (ADR 0011; BOB-49)", () => {
  const SHA = "5d4617f4bed3884d73deb1a9cc71e1ed366215f4";
  const push = { op: "push", project: "bobnet", repo: "cath42/bobnet", branch: "v2", sha: SHA };

  it("parses a push without fixes, as an older supervisor sends it, and with them", () => {
    expect(BoardOp.parse(push)).toEqual(push);
    const fixes = [{ ref: "BOB-27", sha: SHA, subject: "v2: BOB-27: board reports no longer stall behind a row the protocol won't take" }];
    expect(BoardOp.parse({ ...push, fixes })).toEqual({ ...push, fixes });
  });

  it("refuses a fix with a short sha, a long subject, a bad ref, or more than 20", () => {
    const fix = { ref: "BOB-27", sha: SHA, subject: "x" };
    for (const bad of [{ sha: SHA.slice(0, 7) }, { subject: "x".repeat(201) }, { ref: "bob-27" }])
      expect(BoardOp.safeParse({ ...push, fixes: [{ ...fix, ...bad }] }).success).toBe(false);
    expect(BoardOp.safeParse({ ...push, fixes: Array.from({ length: 21 }, () => fix) }).success).toBe(false);
  });

  it("parses release_tag with or without its project, keep and withdraw with a reason", () => {
    expect(BoardOp.parse({ op: "release_tag", repo: "cath42/bobnet", tag: "v2.0.0-rc.34", sha: SHA })).toMatchObject({ op: "release_tag", tag: "v2.0.0-rc.34" });
    expect(BoardOp.safeParse({ op: "release_tag", repo: "cath42/bobnet", tag: "x".repeat(101), sha: SHA }).success).toBe(false);
    expect(BoardOp.parse({ op: "keep", project: "helix", ref: "Q-14", reason: "Still open upstream" })).toMatchObject({ ref: "Q-14" });
    expect(BoardOp.parse({ op: "keep", project: "helix", ref: "LAND-56", reason: "Casper reviews it Monday" })).toMatchObject({ ref: "LAND-56" });
    expect(BoardOp.safeParse({ op: "keep", project: "helix", ref: "Q-14", reason: " " }).success).toBe(false);
    expect(BoardOp.parse({ op: "withdraw", project: "helix", ref: "A-3", reason: "Moot" })).toMatchObject({ op: "withdraw" });
    expect(BoardOp.safeParse({ op: "withdraw", project: "helix", ref: "LAND-56", reason: "Moot" }).success).toBe(false);
    expect(SUPERVISOR_OPS).toContain("release_tag");
  });
});

describe("update_release and reopen_release (BOB-189)", () => {
  it("edits a release's title, goal or spec_url, at least one, and reopens one by its ref", () => {
    const update = (set: Record<string, unknown>, ref = "R3") => BoardOp.safeParse({ op: "update_release", project: "helix", ref, set, reason: "README's outcome" });
    expect(update({ title: "Nightly", goal: "Every day starts green", spec_url: "https://example.com/r3" }).success).toBe(true);
    expect(update({ goal: null, spec_url: null }).success).toBe(true);
    expect(update({}).success).toBe(false);
    expect(update({ status: "open" }).success).toBe(false);
    expect(update({ ord: 1 }).success).toBe(false);
    expect(update({ title: " " }).success).toBe(false);
    expect(update({ title: "Nightly" }, "LAND-3").success).toBe(false);
    expect(BoardOp.safeParse({ op: "reopen_release", project: "helix", ref: "R0" }).success).toBe(true);
    expect(BoardOp.safeParse({ op: "reopen_release", project: "helix", ref: "R0", reason: "closed too soon" }).success).toBe(true);
    expect(BoardOp.safeParse({ op: "reopen_release", project: "helix", ref: "LAND-3" }).success).toBe(false);
    expect(BoardOp.safeParse({ op: "reopen_release", project: "helix" }).success).toBe(false);
  });
});
