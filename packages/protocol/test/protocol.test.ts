import { describe, expect, it } from "vitest";
import { addressKey, CLIENT_FRAME_TYPES, ClientFrame, findSecret, parseRecipient, PROTOCOL_VERSION } from "../src/index.ts";

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
  it("takes a register with or without the client's package, version and protocol", () => {
    const client = { package: "@bobnet/client", version: "0.2.0", protocol: PROTOCOL_VERSION };
    expect(ClientFrame.parse({ t: "register", rid: "1", name: "Bob", client })).toMatchObject({ client });
    expect(ClientFrame.parse({ t: "register", rid: "1", name: "Bob" })).not.toHaveProperty("client");
    expect(ClientFrame.safeParse({ t: "register", rid: "1", name: "Bob", client: { package: "x" } }).success).toBe(false);
  });
  it("lists every client frame type, for the broker to tell an unknown one", () => {
    expect(CLIENT_FRAME_TYPES).toContain("register");
    expect(CLIENT_FRAME_TYPES).toContain("ack");
    expect(CLIENT_FRAME_TYPES).toHaveLength(ClientFrame.options.length);
  });
});
