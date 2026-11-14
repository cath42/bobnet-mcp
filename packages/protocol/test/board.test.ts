import { describe, expect, it } from "vitest";
import { BoardOp, ClientFrame } from "../src/index.ts";

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

  it("has no session kind other: other work is a run with no session", () => {
    const join = { op: "session_join", project: "helix", session: { feature: "LAND-49", kind: "other", label: "1" } };
    expect(BoardOp.safeParse(join).success).toBe(false);
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
