import { describe, expect, it } from "vitest";
import { BoardOp } from "../src/index.ts";

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
