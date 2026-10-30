import { describe, expect, it } from "vitest";
import { addressKey, ClientFrame, findSecret, parseRecipient } from "../src/index.ts";

describe("parseRecipient", () => {
  it("resolves a bare name to the sender's laptop", () => {
    expect(parseRecipient("Bill", "mbp-1")).toEqual({ name: "Bill", laptop: "mbp-1" });
  });
  it("keeps an explicit laptop", () => {
    expect(parseRecipient("Bill@mbp-2", "mbp-1")).toEqual({ name: "Bill", laptop: "mbp-2" });
  });
  it("rejects malformed recipients", () => {
    for (const bad of ["", "@mbp", "Bill@", "1bob", "a@b@c", "bob smith"]) {
      expect(parseRecipient(bad, "mbp-1")).toBeNull();
    }
  });
  it("keys case-insensitively", () => {
    expect(addressKey({ name: "Bill", laptop: "MBP-1" })).toBe("bill@mbp-1");
  });
});

describe("findSecret", () => {
  it.each([
    ["private_key", "-----BEGIN OPENSSH PRIVATE KEY-----"],
    ["anthropic_key", "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz"],
    ["aws_access_key", "AKIAIOSFODNN7EXAMPLE"],
    ["github_token", "ghp_" + "a".repeat(36)],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"],
    ["password_assignment", "password=hunter2hunter2"],
  ])("flags %s", (name, text) => {
    expect(findSecret(text)).toBe(name);
  });
  it("passes ordinary coordination text", () => {
    expect(findSecret("LAND-12.3 done, see architecture/design-notes/LAND-12.3.md")).toBeNull();
  });
});

describe("ClientFrame", () => {
  it("parses a send", () => {
    const f = ClientFrame.parse({ t: "send", rid: "1", as: "Bob", to: ["Bill"], body: "hi" });
    expect(f.t).toBe("send");
  });
  it("rejects unknown frame types and missing fields", () => {
    expect(ClientFrame.safeParse({ t: "nope", rid: "1" }).success).toBe(false);
    expect(ClientFrame.safeParse({ t: "send", rid: "1", as: "Bob", to: [], body: "hi" }).success).toBe(false);
  });
});
