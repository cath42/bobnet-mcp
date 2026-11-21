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
  it("gives the same result on the same text, call after call (BOB-74)", () => {
    const text = `password=hunter2hunter2 and ${"ghp_" + "b".repeat(36)}, then -----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----`;
    const first = redactSecrets(text, MARK);
    for (let i = 0; i < 3; i++) {
      expect(redactSecrets(text, MARK)).toBe(first);
      expect(findSecret(text)).toBe("private_key");
    }
    expect(first).toBe(`${MARK} and ${MARK}, then ${MARK}`);
  });
  const PEM = ["-----BEGIN OPENSSH PRIVATE KEY-----", "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW", "QyNTUxOQAAACDx3dVz0V3QyNTUxOQAAACDx3dVz0V3QyNTUxOQAAACDx3dVz0V3Q", "-----END OPENSSH PRIVATE KEY-----"].join("\n");
  it("a private key: BEGIN through END, every line of the key (BOB-73)", () => {
    const out = redactSecrets(`Deploy key:\n${PEM}\nThen restart.`, MARK);
    expect(out).toBe(`Deploy key:\n${MARK}\nThen restart.`);
    expect(findSecret(out)).toBeNull();
    // Two blocks: each its own span, the text between them kept.
    expect(redactSecrets(`${PEM}\nand\n${PEM}`, MARK)).toBe(`${MARK}\nand\n${MARK}`);
  });
  // Built from parts: a header pasted whole into a message is refused by the broker.
  const BEGIN = (kind = "RSA") => `-----${"BEGIN"} ${kind} PRIVATE KEY-----`;
  const END = (kind = "RSA") => `-----${"END"} ${kind} PRIVATE KEY-----`;
  const BODY = "MIIEowIBAAKCAQEAsecretbodyline";
  it("a BEGIN line with no END: only that line, the rest of the field kept (BOB-79 AC 1)", () => {
    const text = `# Handoff\n\nThe file starts with ${BEGIN()} and that was all.\nNext: rotate it.\n\nDone.`;
    const out = redactSecrets(text, MARK);
    expect(out).toBe(`# Handoff\n\nThe file starts with ${MARK}\nNext: rotate it.\n\nDone.`);
    expect(findSecret(out)).toBeNull();
    // CRLF ends the line too; a cut-off key keeps its body lines (Casper, 2026-11-20: "No" to withholding the rest).
    expect(redactSecrets(`Key below.\r\n${BEGIN()}\r\n${BODY}\r\n`, MARK)).toBe(`Key below.\r\n${MARK}\r\n${BODY}\r\n`);
    expect(redactSecrets(`Key below.\n${PEM.split("\n").slice(0, 3).join("\n")}`, MARK)).toBe(`Key below.\n${MARK}\n${PEM.split("\n").slice(1, 3).join("\n")}`);
  });
  it("BEGIN..END still whole: CRLF, an END of another type, END before BEGIN, Proc-Type/DEK-Info, JSON-escaped (BOB-79 AC 2; BOB-73)", () => {
    expect(redactSecrets(`a\r\n${BEGIN()}\r\n${BODY}\r\n${END()}\r\nb`, MARK)).toBe(`a\r\n${MARK}\r\nb`);
    expect(redactSecrets(`${BEGIN("EC")}\n${BODY}\n${END("RSA")}\nafter`, MARK)).toBe(`${MARK}\nafter`);
    expect(redactSecrets(`${END()}\nbetween\n${BEGIN()}\n${BODY}\n${END()}`, MARK)).toBe(`${END()}\nbetween\n${MARK}`);
    expect(redactSecrets(`${BEGIN()}\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0011\n\n${BODY}\n${END()}\nkept`, MARK)).toBe(`${MARK}\nkept`);
    const escaped = JSON.stringify(`${BEGIN()}\n${BODY}\n${END()}`).slice(1, -1);
    expect(redactSecrets(`key: ${escaped} kept`, MARK)).toBe(`key: ${MARK} kept`);
    // A certificate's END closes no private key.
    expect(redactSecrets(`${BEGIN()}\n${BODY}\n-----END CERTIFICATE-----\nkept`, MARK)).toBe(`${MARK}\n${BODY}\n-----END CERTIFICATE-----\nkept`);
  });
  it("a nested key leaves no tail of the outer one (BOB-79 AC 3)", () => {
    const out = redactSecrets(`before\n${BEGIN()}\nouter1\n${BEGIN("EC")}\n${BODY}\n${END("EC")}\nouter-tail\n${END()}\nafter`, MARK);
    expect(out).toBe(`before\n${MARK}\nafter`);
    // The outer END missing: the inner block goes whole, the outer BEGIN its line.
    expect(redactSecrets(`${BEGIN()}\nprose\n${BEGIN("EC")}\n${BODY}\n${END("EC")}\nafter`, MARK)).toBe(`${MARK}\nprose\n${MARK}\nafter`);
  });
  it("one mark, not a mark after a mark; nothing it gives still matches findSecret (BOB-79 AC 4)", () => {
    const ant = "sk-ant-api03-" + "a".repeat(30);
    expect(redactSecrets(`api_key = ${ant} then`, MARK)).toBe(`${MARK} then`);
    expect(redactSecrets(`password: ${BEGIN()}\n${BODY}\n${END()}`, MARK)).toBe(MARK);
    for (const text of [
      `api_key = ${ant}`, `secret="${ant}"`, `password: ${BEGIN()}`, `token AKIAIOSFODNN7EXAMPLE and password=hunter2hunter2`,
      `${BEGIN()} ${BEGIN("EC")}\n${BODY}\n${END("EC")}`, `Bearer ${"x".repeat(30)} api-key:${"y".repeat(9)}`,
    ]) {
      const out = redactSecrets(text, MARK);
      expect(out.split(MARK).length - 1, text).toBeGreaterThan(0);
      expect(findSecret(out), text).toBeNull();
      expect(out, text).not.toContain(`${MARK} looks like`);
    }
  });
  it("linear in the text: 200 KB adversarial inputs in a few ms (BOB-79 AC 5)", () => {
    const n = 200_000;
    const inputs = [
      `${BEGIN()}\n`.repeat(n / 31),
      BEGIN().repeat(n / 30),
      `${END()}\n`.repeat(n / 30),
      `${BEGIN()}\n${END()}\n`.repeat(n / 60),
      "-----BEGIN " + "A ".repeat(n / 2),
      "password=".repeat(n / 9),
      "api_key: " + MARK.repeat(n / MARK.length),
    ];
    for (const text of inputs) {
      const t = performance.now();
      redactSecrets(text, MARK);
      expect(performance.now() - t, text.slice(0, 40)).toBeLessThan(50);
    }
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
