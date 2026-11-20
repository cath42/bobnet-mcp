import { describe, expect, it } from "vitest";
import { addressKey, CLIENT_FRAME_TYPES, ClientFrame, findSecret, LaptopSnapshot, redactSecrets, parseRecipient, PROTOCOL_VERSION, WorkerSnapshot } from "../src/index.ts";

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
  it("password_assignment doesn't match across a JSON escape: the serialised body only where a field does (BOB-72)", () => {
    const handoff = "# Handoff\n\nThe service reads its api_key:\n\nthen goes on.\n";
    expect(findSecret(handoff)).toBeNull();
    expect(findSecret(JSON.stringify({ v: 2, event: "exit", handoff_text: handoff }))).toBeNull();
    expect(findSecret("api_key=abcdefgh123")).toBe("password_assignment");
    expect(findSecret(JSON.stringify({ handoff_text: "set password=hunter2hunter2\n" }))).toBe("password_assignment");
  });
});

describe("redactSecrets", () => {
  const MARK = "[withheld: looks like a credential]";
  it("replaces each matching span, every one, and keeps the rest", () => {
    const gh = "ghp_" + "a".repeat(36);
    const text = `Pushed with ${gh}; then AKIAIOSFODNN7EXAMPLE and ${gh} again. Handoff in lead/h.md`;
    const out = redactSecrets(text, MARK);
    expect(out).toBe(`Pushed with ${MARK}; then ${MARK} and ${MARK} again. Handoff in lead/h.md`);
    expect(findSecret(out)).toBeNull();
  });
  it("leaves ordinary text as it is", () => {
    const text = "LAND-12.3 done, see architecture/design-notes/LAND-12.3.md";
    expect(redactSecrets(text, MARK)).toBe(text);
  });
  const PEM = ["-----BEGIN OPENSSH PRIVATE KEY-----", "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW", "QyNTUxOQAAACDx3dVz0V3QyNTUxOQAAACDx3dVz0V3QyNTUxOQAAACDx3dVz0V3Q", "-----END OPENSSH PRIVATE KEY-----"].join("\n");
  it("a private key: BEGIN through END, every line of the key (BOB-73)", () => {
    const out = redactSecrets(`Deploy key:\n${PEM}\nThen restart.`, MARK);
    expect(out).toBe(`Deploy key:\n${MARK}\nThen restart.`);
    expect(findSecret(out)).toBeNull();
    // Two blocks: each its own span, the text between them kept.
    expect(redactSecrets(`${PEM}\nand\n${PEM}`, MARK)).toBe(`${MARK}\nand\n${MARK}`);
  });
  it("a private key with no END line: to the end of the text (BOB-73)", () => {
    const cutOff = PEM.split("\n").slice(0, 3).join("\n");
    const out = redactSecrets(`Key below.\n${cutOff}\n`, MARK);
    expect(out).toBe(`Key below.\n${MARK}`);
    expect(out).not.toContain("b3BlbnNzaC1rZXkt");
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

describe("tokens only (BOB-21)", () => {
  const worker = {
    id: "w_1", name: "Luigi", project: "bobnet", role: "luigi", state: "running", task: "BOB-2", checkpoint: null,
    started_at: null, ended_at: null, last_event_at: null, tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 },
  };

  it("takes a worker and a usage row without cost_usd", () => {
    expect(WorkerSnapshot.parse(worker)).not.toHaveProperty("cost_usd");
    const usage = { day: "2026-11-14", project: "bobnet", role: "luigi", workers: 1, tokens: worker.tokens };
    const snap = { supervisor: { started_at: "x", concurrency: 1, active: 1, queued: 0 }, workers: [worker], pending: [], usage: [usage] };
    expect(LaptopSnapshot.parse(snap).usage[0]).not.toHaveProperty("cost_usd");
  });

  it("still takes cost_usd from a supervisor that sends it", () => {
    expect(WorkerSnapshot.parse({ ...worker, cost_usd: 0.5 }).cost_usd).toBe(0.5);
  });
});
