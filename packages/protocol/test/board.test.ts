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
