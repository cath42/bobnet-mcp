import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ActionResultFrame, addressKey, CleanupReport, CLIENT_FRAME_TYPES, ClientFrame, ErrorCode, findSecret, LaptopSnapshot, redactSecrets, parseRecipient, PROTOCOL_VERSION, WorkerSnapshot } from "../src/index.ts";
import { redactSecrets as redactSecretsBb51add } from "./fixtures/secrets-bb51add.ts";

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
    // Each BEGIN through the first END after it, unioned with the stack's pairs (Toad, consult on BOB-85).
    expect(redactSecrets(`before\n${BEGIN()}\nouter1\n${BEGIN()}\n${BODY}\n${END()}\nouter-tail\n${END()}\nafter`, MARK)).toBe(`before\n${MARK}\nafter`);
  });
  it("each BEGIN through the first END after it; only one with no END after it is its line (BOB-85, §14 A-fixes-3 2)", () => {
    // AC 2: the outer key's body goes too (BOB-79's stack left OUTER in clear).
    const nested = `${BEGIN()}\nOUTERKEYDATA\n${BEGIN()}\nINNER\n${END()}\ntail`;
    expect(redactSecrets(nested, MARK)).toBe(`${MARK}\ntail`);
    // A BEGIN quoted in prose before a real key goes through that key's END: more withheld, nothing leaked.
    const prose = `${BEGIN()}\nprose\n${BEGIN("EC")}\n${BODY}\n${END("EC")}\nafter`;
    expect(redactSecrets(prose, MARK)).toBe(`${MARK}\nafter`);
    // As before: a stray END before a key, PGP with CRLF, a v3 .ppk.
    const stray = `${END()}\nbetween\n${BEGIN()}\n${BODY}\n${END()}`;
    expect(redactSecrets(stray, MARK)).toBe(`${END()}\nbetween\n${MARK}`);
    const pgp = `Key:\r\n${PGP.replace(/\n/g, "\r\n")}\r\nkept`;
    expect(redactSecrets(pgp, MARK)).toBe(`Key:\r\n${MARK}\r\nkept`);
    expect(redactSecrets(`Key:\n${PPK3}\nkept`, MARK)).toBe(`Key:\n${MARK}\nkept`);
    // A BEGIN after the last END: its own line, the rest kept.
    expect(redactSecrets(`${PEM}\n${BEGIN()}\n${BODY}`, MARK)).toBe(`${MARK}\n${MARK}\n${BODY}`);
    for (const text of [nested, prose, stray, pgp]) expect(findSecret(redactSecrets(text, MARK)), text).toBeNull();
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
    // A backtracking pattern takes seconds on these; 250 ms leaves a busy laptop room (BOB-117: 52 ms against 50 failed a land).
    for (const text of inputs) expect(fastest(() => redactSecrets(text, MARK)), text.slice(0, 40)).toBeLessThan(250);
  });
});

// BOB-80 (ADR 0007 §14, "Ruling, BOB-80"): the widened findSecret. Headers are built from parts, as above.
const PW = (name: string, value = "hunter2hunter2") => `${name}=${value}`;
const PGP_BEGIN = `-----${"BEGIN"} PGP PRIVATE KEY BLOCK-----`;
const PGP_END = `-----${"END"} PGP PRIVATE KEY BLOCK-----`;
const PGP = [PGP_BEGIN, "", "lQOYBGXyAbcBCADsecretpgpbodyline", "=Ab1c", PGP_END].join("\n");
const PPK_HEAD = (n: number) => `PuTTY-User-Key-File-${n}${":"}`;
const PPK2 = [`${PPK_HEAD(2)} ssh-rsa`, "Encryption: none", "Comment: rsa-key-20201120", "Public-Lines: 1", "AAAAB3NzaC1yc2EAAAABJQAAAQEA", "Private-Lines: 1", "AAABAQCsecretppkv2bodyline", `Private-MAC: ${"a1".repeat(20)}`].join("\n");
const PPK3 = [
  `${PPK_HEAD(3)} ssh-ed25519`, "Encryption: aes256-cbc", "Comment: ed25519-key-20261120", "Public-Lines: 2", "AAAAC3NzaC1lZDI1NTE5AAAAIOx", "dGVzdA==",
  "Key-Derivation: Argon2id", "Argon2-Memory: 8192", "Argon2-Passes: 13", "Argon2-Parallelism: 1", "Argon2-Salt: 0123456789abcdef0123456789abcdef",
  "Private-Lines: 1", "AAAAIMsecretppkv3bodyline", `Private-MAC: ${"b2".repeat(32)}`,
].join("\n");
/**
 * What BOB-80 now withholds though it is no secret: the cost Casper accepted (Q3), bounded to these
 * shapes. Each ends as a stand-in in its place, the rest of the text kept, and nothing left matches.
 */
const NOW_WITHHELD: ReadonlyArray<readonly [string, string]> = [
  ["PASSWORD_RESET_URL=https://example.com/reset", "PASSWORD_RESET_URL=…"],
  ["DB_PASSWORD=${DB_PASSWORD}", "a variable, not its value"],
  ["PASSWORD_FILE=/run/secrets/db", "a path to the secret"],
  ["SECRET_NAME=prod-db-creds", "the secret's name"],
  [`The file begins with ${PPK_HEAD(3)} and then the key type.`, "docs quoting a .ppk header with its colon"],
  [`A PGP key starts ${PGP_BEGIN.toLowerCase()} in a doc.`, "docs quoting a header"],
];

describe("findSecret, widened (BOB-80)", () => {
  const MARK = "[withheld: looks like a credential]";
  it("X_PASSWORD names: `_` before or inside the name, the same value rule (AC 2)", () => {
    for (const text of [
      PW("DB_PASSWORD"), "MYSQL_ROOT_PASSWORD: 'abcdefgh1'", PW("AWS_SECRET_ACCESS_KEY", "wJalrXUtnFEMIK7MDENGbPxRfiCY"),
      'export GH_PASSWORD = "abcdefghi"', PW("password"), PW("X_API_KEY"), PW("SECRET_KEY"), PW("PASSWORD_HASH"), PW("db_passwd"),
    ]) expect(findSecret(text), text).toBe("password_assignment");
    // The match starts at the keyword: the prefix stays, the rest is one mark.
    expect(redactSecrets(`env: ${PW("DB_PASSWORD")} then`, MARK)).toBe(`env: DB_${MARK} then`);
    expect(redactSecrets("MYSQL_ROOT_PASSWORD: 'abcdefgh1' ok", MARK)).toBe(`MYSQL_ROOT_${MARK}' ok`);
    expect(redactSecrets(PW("AWS_SECRET_ACCESS_KEY", "wJalrXUtnFEMIK7MDENGbPxRfiCY"), MARK)).toBe(`AWS_${MARK}`);
  });
  it("X_PASSWORD near-misses stay unmatched (AC 2; §14 1)", () => {
    for (const text of [
      "password reset", "Set PASSWORD in the env.", "PASSWORD", PW("passwordless", "abcdefghijk"), PW("MYPASSWORD"), PW("DB_PASSWORDS"),
      PW("DB_PASSWORD", "short"), PW("DB_PASSWORD", "Pa\\ssw0rd!!"), '"password": "hunter2hunter2"', PW("DB_PASSWORD_A_B_C_D_E"),
      `DB_PASSWORD_${"x".repeat(33)}=hunter2hunter2`,
      // BobNet's own texts: the refusal and the stand-ins.
      "secret_detected: password_assignment", "secret_detected: the handoff holds what looks like a credential (password_assignment); take it out and close again",
      "Message looks like it contains a credential (password_assignment); send a path instead", MARK, "[hidden: looks like it contains a credential]",
    ]) {
      expect(findSecret(text), text).toBeNull();
      expect(redactSecrets(text, MARK), text).toBe(text);
    }
  });
  it("a PGP private key block: BEGIN through END whole; a BEGIN with no END only its line (AC 3)", () => {
    const out = redactSecrets(`Key:\n${PGP}\nkept`, MARK);
    expect(findSecret(PGP)).toBe("private_key");
    expect(out).toBe(`Key:\n${MARK}\nkept`);
    expect(findSecret(out)).toBeNull();
    const cut = PGP.split("\n").slice(0, 3).join("\n");
    expect(redactSecrets(`Key:\n${cut}\nkept`, MARK)).toBe(`Key:\n${MARK}\n${cut.split("\n").slice(1).join("\n")}\nkept`);
    // A public block, a signature, a certificate and a public key are none.
    for (const label of ["PGP PUBLIC KEY BLOCK", "PGP SIGNATURE", "CERTIFICATE", "PUBLIC KEY", "RSA PUBLIC KEY"]) {
      expect(findSecret(`-----${"BEGIN"} ${label}-----\nAbc\n-----${"END"} ${label}-----`), label).toBeNull();
    }
  });
  it("lowercase PEM headers, as uppercase ones (AC 4)", () => {
    const pem = [`-----${"begin"} private key-----`, "MIIEvQIBADANBgkqhkiGsecret", `-----${"end"} private key-----`].join("\n");
    expect(findSecret(pem)).toBe("private_key");
    expect(redactSecrets(`a\n${pem}\nb`, MARK)).toBe(`a\n${MARK}\nb`);
    expect(findSecret(`-----${"Begin"} Rsa Private Key-----`)).toBe("private_key");
    // Mixed case pairs: a lowercase END closes an uppercase BEGIN.
    expect(redactSecrets(`-----${"BEGIN"} EC PRIVATE KEY-----\nMHcCAQEE\n-----${"end"} ec private key-----\nb`, MARK)).toBe(`${MARK}\nb`);
  });
  it("a PuTTY .ppk key, v2 and v3: header through Private-MAC (AC 5)", () => {
    for (const ppk of [PPK2, PPK3]) {
      expect(findSecret(ppk)).toBe("putty_key");
      const out = redactSecrets(`Key:\n${ppk}\nkept`, MARK);
      expect(out).toBe(`Key:\n${MARK}\nkept`);
      expect(findSecret(out)).toBeNull();
    }
    // A header with no Private-MAC: only its line. CRLF too.
    expect(redactSecrets(`${PPK_HEAD(3)} ssh-ed25519\r\nEncryption: none\r\n`, MARK)).toBe(`${MARK}\r\nEncryption: none\r\n`);
    expect(redactSecrets(PPK3.replace(/\n/g, "\r\n"), MARK)).toBe(MARK);
    // Case-sensitive, as PuTTY reads it; the header without its colon is prose.
    expect(findSecret("putty-user-key-file-3: ssh-ed25519")).toBeNull();
    expect(findSecret("the PuTTY-User-Key-File-3 header names the version")).toBeNull();
    // A Private-MAC with no header closes nothing.
    expect(redactSecrets(`Private-MAC: ${"ab".repeat(20)}`, MARK)).toBe(`Private-MAC: ${"ab".repeat(20)}`);
  });
  it("what is now withheld though no secret, each a stand-in in its place (AC 7)", () => {
    for (const [text, why] of NOW_WITHHELD) {
      expect(findSecret(text), why).not.toBeNull();
      const out = redactSecrets(text, MARK);
      expect(out, why).toContain(MARK);
      expect(findSecret(out), why).toBeNull();
    }
    expect(redactSecrets("PASSWORD_RESET_URL=https://example.com/reset", MARK)).toBe(MARK);
    expect(redactSecrets("DB_PASSWORD=${DB_PASSWORD}", MARK)).toBe(`DB_${MARK}`);
  });
  it("linear in the text: 200 KB adversarial inputs in under 50 ms each (AC 7; §14 4)", () => {
    const n = 200_000;
    const inputs = [
      `${PGP_BEGIN}\n`.repeat(n / PGP_BEGIN.length),
      PGP_BEGIN.toLowerCase().repeat(n / PGP_BEGIN.length),
      `${PGP_BEGIN}\n${PGP_END}\n`.repeat(n / 80),
      "-----BEGIN " + "a ".repeat(n / 2),
      ("-----BEGIN " + "A".repeat(39) + " ").repeat(n / 51),
      `${PPK_HEAD(3)} ssh-ed25519\n`.repeat(n / 36),
      PPK_HEAD(2).repeat(n / 22),
      "Private-MAC: ".repeat(n / 13),
      `Private-MAC:${" ".repeat(n)}`,
      `${PPK3}\n`.repeat(n / PPK3.length),
      "_password".repeat(n / 9),
      "DB_PASSWORD_A_B_C_D".repeat(n / 19),
      "X_PASSWORD" + "_abcdefgh".repeat(n / 9),
      "password" + "_".repeat(n) + "=",
      "secret_detected ".repeat(n / 16),
    ];
    for (const text of inputs) {
      for (const run of [() => findSecret(text), () => redactSecrets(text, MARK)]) expect(fastest(run), text.slice(0, 40)).toBeLessThan(50);
    }
  });
});

// A-fixes-3 (ADR 0007 §14, "Ruling, A-fixes-3"). Headers built from parts, as above.
describe("redactSecrets, every span on the original text (BOB-84)", () => {
  const MARK = "[withheld: looks like a credential]";
  const ANT = "sk-ant-api03-" + "a".repeat(30);
  const PEM_PART = `-----${"BEGIN"} RSA PRIVATE KEY-----\nMIIE\n-----${"END"} RSA PRIVATE KEY-----`;
  it("a short value doesn't swallow the next assignment's name and leave its value (AC 2)", () => {
    expect(redactSecrets('password=x;password="RealSecret123"', MARK)).toBe(`${MARK}"`);
    expect(redactSecrets("DB_PASSWORD=;API_KEY='Hunter2hunter2'", MARK)).toBe(`DB_${MARK}'`);
    expect(redactSecrets('{api_key:x,password:"Hunter2hunter2"}', MARK)).toBe(`{${MARK}"}`);
    // One mark: the first value reaches the second assignment's span and goes through it.
    expect(redactSecrets('api_key=secret:"abcdefgh"', MARK)).toBe(`${MARK}"`);
    // The token is a span on the original text, not cut out first: the assignment's run goes on past it.
    expect(redactSecrets(`secret=${ANT}{=Hunter2hunter2 kept`, MARK)).toBe(`${MARK} kept`);
    for (const text of ['password=x;password="RealSecret123"', "DB_PASSWORD=;API_KEY='Hunter2hunter2'", '{api_key:x,password:"Hunter2hunter2"}', 'api_key=secret:"abcdefgh"', `secret=${ANT}{=Hunter2hunter2`]) {
      const out = redactSecrets(text, MARK);
      expect(out.split(MARK).length - 1, text).toBe(1);
      expect(findSecret(out), text).toBeNull();
      expect(out, text).not.toMatch(/RealSecret123|Hunter2hunter2|abcdefgh/);
    }
  });
  it("a short value alone stays; one that reaches a span goes through it (AC 1)", () => {
    expect(redactSecrets("password=x; then", MARK)).toBe("password=x; then");
    expect(redactSecrets(`api_key=${MARK} then`, MARK)).toBe(`${MARK} then`);
    expect(redactSecrets(`password=ab-----${"BEGIN"} RSA PRIVATE KEY-----\nMIIE\n-----${"END"} RSA PRIVATE KEY-----\nkept`, MARK)).toBe(`${MARK}\nkept`);
    // A span that ends inside a word (a Private-MAC's hex) takes the word: nothing glued after it matches once marked.
    // A mark never sits inside a run of letters and digits: the run goes with it, so nothing beside it matches.
    const ppk = `${PPK_HEAD(2)} ssh-rsa\nPrivate-MAC: ${"a1".repeat(20)}ghp_${"c".repeat(36)} kept`;
    expect(redactSecrets(ppk, MARK)).toBe(`${MARK} kept`);
    expect(redactSecrets(`AKIAIOSFODNN7EXAMPLE${PPK_HEAD(3)} ssh-ed25519\nkept`, MARK)).toBe(`${MARK}\nkept`);
    expect(redactSecrets(`env DB_PASSWORD=hunter2hunter2 kept`, MARK)).toBe(`env DB_${MARK} kept`);
    const glued = redactSecrets(`${PEM_PART}eyJ${"h".repeat(12)}.eyJ${"p".repeat(12)}.${"s".repeat(12)}{ kept`, MARK);
    expect(glued).toBe(`${MARK}.eyJ${"p".repeat(12)}.${"s".repeat(12)}{ kept`);
    expect(findSecret(glued)).toBeNull();
  });
  it("property: nothing redacted still matches, and no assignment value at any keyword survives (AC 3)", () => {
    // The oracle: password_assignment as findSecret has it, tried at every position.
    const at = /(?<![A-Za-z0-9])(?:password|passwd|secret(?!_detected\b)|api[_-]?key)(?:_[A-Za-z0-9]{1,32}){0,4}\s*[:=]\s*["']?([^\s"'\\]{8,})/iy;
    let seed = 0x2f6b1a3d;
    const rand = (n: number) => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      return seed % n;
    };
    const pick = <T,>(xs: readonly T[]) => xs[rand(xs.length)]!;
    const KEYS = ["password", "PASSWORD", "DB_PASSWORD", "passwd", "secret", "SECRET_KEY", "api_key", "API-KEY", "apikey", "AWS_SECRET_ACCESS_KEY", "secret_detected", "password_detected", "x_password", "Xpassword"];
    const SEPS = ["=", ":", " = ", ': "', "='", '="', ":'", "=\"'", " :\t"];
    const PUNCT = [";", ",", '"', "'", " ", "\n", "\r\n", "\\", "{", "}", "-", "_", "", "", ""];
    const SPANS = [ANT, "AKIAIOSFODNN7EXAMPLE", "ghp_" + "c".repeat(36), "Bearer " + "t".repeat(30), MARK, `-----${"BEGIN"} RSA PRIVATE KEY-----`, `-----${"END"} RSA PRIVATE KEY-----`, `${PPK_HEAD(3)} ssh-ed25519`, `Private-MAC: ${"b2".repeat(8)}`, "eyJ" + "h".repeat(12) + ".eyJ" + "p".repeat(12) + "." + "s".repeat(12)];
    let id = 0;
    const value = () => (rand(3) === 0 ? pick(["x", "ab", "", "abc-", "1234567"]) : `Tok${id++}Z${"v".repeat(rand(8))}`);
    let checked = 0;
    for (let n = 0; n < 20_000; n++) {
      let text = "";
      for (let k = 1 + rand(8); k > 0; k--) {
        const r = rand(10);
        text += r < 5 ? pick(KEYS) + pick(SEPS) + value() : r < 7 ? pick(SPANS) : r < 9 ? pick(PUNCT) : value();
        text += pick(PUNCT);
      }
      const out = redactSecrets(text, MARK);
      expect(findSecret(out), JSON.stringify(text)).toBeNull();
      for (let i = 0; i < text.length; i++) {
        at.lastIndex = i;
        const m = at.exec(text);
        if (!m) continue;
        for (const tok of m[1]!.match(/Tok\d+Z/g) ?? []) {
          checked++;
          expect(out.includes(tok), `${tok} in ${JSON.stringify(text)} -> ${JSON.stringify(out)}`).toBe(false);
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });
  it("linear: 200 KB adversarial inputs redact in under 50 ms each (AC 4)", () => {
    const n = 200_000;
    const inputs = [
      "password=".repeat(n / 9),
      "password=x;".repeat(n / 11),
      "_password".repeat(n / 9),
      "api_key: " + MARK.repeat(n / MARK.length),
      `password=${MARK}`.repeat(n / 45),
      `password=ab-----${"BEGIN"} RSA PRIVATE KEY-----\n`.repeat(n / 43),
      `secret=${"-----END RSA PRIVATE KEY-----"}`.repeat(n / 36),
      `${PPK_HEAD(3)}password=`.repeat(n / 30),
      `Private-MAC: ab password=`.repeat(n / 25),
      "password=" + "x".repeat(n),
      ("password=" + ANT + ";").repeat(n / 52),
      // The edges: spans glued to words and token runs on either side.
      "xoxb-aaaaaaaaaa_".repeat(n / 16),
      "AKIAIOSFODNN7EXAMPLE-".repeat(n / 21),
      `AKIAIOSFODNN7EXAMPLE${PPK_HEAD(3)}`.repeat(n / 42),
      `${PPK_HEAD(3)}abcPrivate-MAC: abghp_`.repeat(n / 43),
      `-----${"END"} RSA PRIVATE KEY-----eyJ`.repeat(n / 32),
      `x${PEM_PART}x`.repeat(n / 70),
      "a".repeat(n / 2) + PEM_PART + "b".repeat(n / 2),
    ];
    // A backtracking pattern takes seconds on these; 250 ms leaves a busy laptop room (BOB-117: 52 ms against 50 failed a land).
    for (const text of inputs) expect(fastest(() => redactSecrets(text, MARK)), text.slice(0, 40)).toBeLessThan(250);
  });
});

describe("redactSecrets, a linear word edge (BOB-89)", () => {
  const MARK = "[withheld: looks like a credential]";
  const SLACK = "xoxb-" + "a".repeat(10);
  it("the slack-token chain from the A-fixes-3 review's M1 redacts 200 KB in under 50 ms (AC 1)", () => {
    const n = 200_000;
    for (const text of [`${SLACK}_-`.repeat(16_384 / 17), `${SLACK}_-`.repeat(n / 17), `${SLACK}_`.repeat(n / 16), `${SLACK}_-ghp_`.repeat(n / 22), `a${SLACK}_-x`.repeat(n / 19)]) {
      expect(fastest(() => redactSecrets(text, MARK)), text.slice(0, 40)).toBeLessThan(50);
    }
    expect(redactSecrets(`${SLACK}_-`.repeat(n / 17) + " kept", MARK)).toBe(`${MARK} kept`);
  });
  it("output identical to bb51add's on a fuzz of glued fragments (AC 2)", () => {
    // Toad's generator (reviews/2026-11-20-a-fixes-3-fuzz.mts): fragments glued with no separator, so every
    // junction between a token, a block line, a keyword, a mark and a word is tried; plus slack-token runs.
    const B = "BEGIN", E = "END";
    const FRAG = [
      "password", "PASSWORD", "DB_PASSWORD", "passwd", "secret", "SECRET_KEY", "api_key", "API-KEY", "apikey", "AWS_SECRET_ACCESS_KEY",
      "secret_detected", "password_detected", "x_password", "Xpassword", "_", "-", "=", ":", " = ", '"', "'", "\\", " ", "\n", "\r\n", ";", ",", "{", "}", ".",
      "sk-ant-api03-" + "a".repeat(22), "sk-" + "p".repeat(33), "AKIAIOSFODNN7EXAMPLE", "ASIA" + "Q".repeat(16), "ghp_" + "c".repeat(36), "github_pat_" + "d".repeat(60),
      "xoxb-" + "1".repeat(10), SLACK, `${SLACK}_-`, `${SLACK}_`, "Bearer ", "Bearer " + "t".repeat(24), "eyJ", "eyJ" + "h".repeat(10), ".eyJ" + "p".repeat(10), "." + "s".repeat(10),
      `-----${B} RSA PRIVATE KEY-----`, `-----${E} RSA PRIVATE KEY-----`, `-----${B} PGP PRIVATE KEY BLOCK-----`, `-----${E} PGP PRIVATE KEY BLOCK-----`, `-----${B} private key-----`,
      `${PPK_HEAD(3)}`, `${PPK_HEAD(2)} ssh-rsa`, "Private-MAC: ", "Private-MAC: a1b2", "ab12", "MIIE", "body",
      MARK, "[withheld", "credential]", "abc", "X", "9", "Tok",
    ];
    let seed = 0x5eed0089;
    const rand = (n: number) => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      return seed % n;
    };
    let differences = 0;
    let edged = 0;
    for (let n = 0; n < 40_000; n++) {
      let text = "";
      for (let k = 1 + rand(14); k > 0; k--) text += rand(5) === 0 ? `Tok${seed % 100_000}Z${"v".repeat(rand(9))}` : FRAG[rand(FRAG.length)]!;
      const out = redactSecrets(text, MARK);
      if (out !== redactSecretsBb51add(text, MARK)) differences++;
      if (/xox[a-z]-[A-Za-z0-9-]{10,}_/.test(text) && out !== text) edged++;
    }
    expect(differences).toBe(0);
    // The fuzz reaches the word edge it is about: slack tokens glued to a word.
    expect(edged).toBeGreaterThan(1_000);
  });
  it("2 MB with 125k matches redacts without a RangeError (AC 3)", () => {
    const text = `${SLACK} `.repeat(2_000_000 / 16);
    expect(text.length).toBe(2_000_000);
    let out = "";
    expect(() => (out = redactSecrets(text, MARK))).not.toThrow();
    expect(out).toBe(`${MARK} `.repeat(125_000));
    const glued = `${SLACK}_-`.repeat(2_000_000 / 17);
    expect(redactSecrets(glued, MARK)).toBe(MARK);
  });
});

describe("findSecret, jwt and the `_detected` guard (BOB-86)", () => {
  const MARK = "[withheld: looks like a credential]";
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  it("a JWT after a space, =, :, a quote, / or Bearer is detected and redacted (AC 1)", () => {
    for (const before of ["token ", "t=", "t:", '"', "/", "Bearer ", ""]) {
      const text = `${before}${JWT} kept`;
      expect(findSecret(text), before).toBe("jwt");
      // After `Bearer `, the bearer span takes both.
      expect(redactSecrets(text, MARK), before).toBe(before === "Bearer " ? `${MARK} kept` : `${before}${MARK} kept`);
    }
  });
  it("one glued after a `-` or a word is no longer detected: the narrowing §14 accepts (AC 1)", () => {
    for (const text of [`abc-${JWT}`, `x${JWT}`, `_${JWT}`]) {
      expect(findSecret(text), text).toBeNull();
      expect(redactSecrets(text, MARK), text).toBe(text);
    }
  });
  it("`eyJ-` repeated to 16 KiB and 200 KB returns in under 50 ms (AC 2)", () => {
    for (const text of ["eyJ-".repeat(16_384 / 4), "eyJ-".repeat(200_000 / 4), "a-eyJ".repeat(200_000 / 5), "eyJaaaaaaaaaaaa.".repeat(200_000 / 16)]) {
      for (const run of [() => findSecret(text), () => redactSecrets(text, MARK)]) expect(fastest(run), text.slice(0, 20)).toBeLessThan(50);
    }
  });
  it("the guard is on `secret` only: password_detected is detected, secret_detected and the stand-ins are not (AC 3)", () => {
    for (const text of ["password_detected=hunter2hunter2", "PASSWD_DETECTED: abcdefghij", "api_key_detected=abcdefghij"]) {
      expect(findSecret(text), text).toBe("password_assignment");
      expect(findSecret(redactSecrets(text, MARK)), text).toBeNull();
    }
    for (const text of [
      "secret_detected: password_assignment", "secret_detected: the handoff holds what looks like a credential (password_assignment); take it out and close again",
      "SECRET_DETECTED=password_assignment", MARK, "[hidden: looks like it contains a credential]",
      "Message looks like it contains a credential (password_assignment); send a path instead",
    ]) {
      expect(findSecret(text), text).toBeNull();
      expect(redactSecrets(text, MARK), text).toBe(text);
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

describe("the laptop mark's data (BOB-70, ADR 0007 §7)", () => {
  const worker = {
    id: "w_1", name: "Ann", project: "studio", role: "ann", state: "running", task: "one fix", checkpoint: null,
    started_at: null, ended_at: null, last_event_at: null, tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 },
  };

  it("carries remote_from and remote_by, both null when a snapshot has neither (an old supervisor's)", () => {
    expect(WorkerSnapshot.parse({ ...worker, remote_from: "supervisor@mbp-1", remote_by: "poe" })).toMatchObject({ remote_from: "supervisor@mbp-1", remote_by: "poe" });
    expect(WorkerSnapshot.parse(worker)).toMatchObject({ remote_from: null, remote_by: null });
    const snap = { supervisor: { started_at: "x", concurrency: 1, active: 1, queued: 0 }, workers: [worker], pending: [], usage: [] };
    expect(LaptopSnapshot.parse(snap).workers[0]).toMatchObject({ remote_from: null, remote_by: null });
  });

  it("an old broker's schema drops the fields and still takes the snapshot", () => {
    const old = WorkerSnapshot.omit({ remote_from: true, remote_by: true });
    const got = old.parse({ ...worker, remote_from: "supervisor@mbp-1", remote_by: "poe" });
    expect(got).not.toHaveProperty("remote_from");
    expect(got).not.toHaveProperty("remote_by");
  });
});

describe("a laptop's last cleanup (BOB-123 AC 6)", () => {
  const snap = { supervisor: { started_at: "x", concurrency: 1, active: 0, queued: 0 }, workers: [], pending: [], usage: [] };
  const run = {
    at: "2026-11-21T22:00:00.000Z", trigger: "floor", skipped: null, freed_bytes: 1_500_000_000,
    projects: [{ project: "helix", freed_bytes: null, steps: [{ step: "ignored", ok: true, error: null, skipped: null, acted: 3, freed_bytes: null }, { step: "docker", ok: false, error: "timed out after 30 min", skipped: null, acted: 0, freed_bytes: null }] }],
    steps: [{ step: "logs", ok: true, error: null, skipped: null, acted: 12, freed_bytes: 900_000_000 }],
  };

  it("is null in an older supervisor's snapshot, which still reads", () => {
    expect(LaptopSnapshot.parse(snap).cleanup).toBeNull();
    expect(ClientFrame.parse({ t: "report", rid: "r1", as: "supervisor", snapshot: snap })).toMatchObject({ snapshot: { cleanup: null } });
  });

  it("carries the run: when, trigger, freed per project (null unknown, never 0), failed steps", () => {
    expect(LaptopSnapshot.parse({ ...snap, cleanup: run }).cleanup).toEqual(run);
    expect(LaptopSnapshot.parse({ ...snap, cleanup: { at: "y", trigger: "schedule", skipped: "busy", freed_bytes: null, projects: [] } }).cleanup).toEqual({ at: "y", trigger: "schedule", skipped: "busy", freed_bytes: null, projects: [], steps: [] });
    // A step a newer supervisor has still reads.
    expect(CleanupReport.parse({ ...run, steps: [{ step: "a-new-step", ok: true, freed_bytes: 1 }] }).steps[0]).toEqual({ step: "a-new-step", ok: true, error: null, skipped: null, acted: 0, freed_bytes: 1 });
  });

  it("is bounded: a step's error, the steps, the projects", () => {
    const step = { step: "docker", ok: false, error: "x".repeat(301), skipped: null, acted: 0, freed_bytes: null };
    expect(CleanupReport.safeParse({ ...run, projects: [{ project: "p", freed_bytes: 0, steps: [step] }] }).success).toBe(false);
    expect(CleanupReport.safeParse({ ...run, projects: Array.from({ length: 51 }, () => run.projects[0]) }).success).toBe(false);
    expect(CleanupReport.safeParse({ ...run, freed_bytes: 1.5 }).success).toBe(false);
  });

  it("an older broker's schema drops it and still takes the snapshot", () => {
    const got = LaptopSnapshot.omit({ cleanup: true }).parse({ ...snap, cleanup: run });
    expect(got).not.toHaveProperty("cleanup");
  });
});

describe("ADR 0012: the board outbox, internal and the audit frame (BOB-48)", () => {
  const snap = { supervisor: { started_at: "x", concurrency: 1, active: 0, queued: 0 }, workers: [], pending: [], usage: [] };

  it("reads a snapshot with its board outbox, and an older supervisor's without one", () => {
    expect(LaptopSnapshot.parse(snap)).not.toHaveProperty("board_outbox");
    const empty = { count: 0, oldest_at: null, code: null };
    expect(LaptopSnapshot.parse({ ...snap, board_outbox: empty }).board_outbox).toEqual(empty);
    const stuck = { count: 312, oldest_at: "2026-11-15T03:00:00.000Z", code: "unavailable" };
    expect(LaptopSnapshot.parse({ ...snap, board_outbox: stuck }).board_outbox).toEqual(stuck);
    expect(LaptopSnapshot.safeParse({ ...snap, board_outbox: { ...stuck, count: -1 } }).success).toBe(false);
    expect(LaptopSnapshot.safeParse({ ...snap, board_outbox: { ...stuck, code: "x".repeat(41) } }).success).toBe(false);
    // An older broker's schema drops it and still takes the snapshot.
    expect(LaptopSnapshot.omit({ board_outbox: true }).parse({ ...snap, board_outbox: stuck })).not.toHaveProperty("board_outbox");
  });

  it("knows the audit frame, its limit 1 to 500 and its before", () => {
    expect(CLIENT_FRAME_TYPES).toContain("audit");
    expect(ClientFrame.parse({ t: "audit", rid: "a1" })).toEqual({ t: "audit", rid: "a1" });
    expect(ClientFrame.parse({ t: "audit", rid: "a1", limit: 500, before: 42 })).toEqual({ t: "audit", rid: "a1", limit: 500, before: 42 });
    expect(ClientFrame.safeParse({ t: "audit", rid: "a1", limit: 0 }).success).toBe(false);
    expect(ClientFrame.safeParse({ t: "audit", rid: "a1", limit: 501 }).success).toBe(false);
    expect(ClientFrame.safeParse({ t: "audit", rid: "a1", before: 1.5 }).success).toBe(false);
  });

  it("has an internal error code", () => {
    expect(ErrorCode.parse("internal")).toBe("internal");
  });
});

describe("ADR 0013: the whole ask, decided and note_delivered (BOB-51)", () => {
  const snap = { supervisor: { started_at: "x", concurrency: 1, active: 0, queued: 0 }, workers: [], usage: [] };
  const row = { id: "r1", worker_id: "w1", name: "luigi", kind: "approval", tool: "Bash", tier: "human", created_at: "t", preview: "ls" };
  const ask = {
    text: "Which?",
    cut: false,
    questions: [{ question: "Which?", header: "Pick", multi: true, options: [{ label: "A", description: "the first" }] }],
  };
  const decided = {
    id: "r0", worker_id: "w1", name: "luigi", project: "bobnet", kind: "approval", tool: "Bash",
    created_at: "t0", decided_at: "t1", decision: "allow", preview: "ls", note: "go on",
  };

  it("reads a snapshot with and without ask and decided", () => {
    const old = LaptopSnapshot.parse({ ...snap, pending: [row] });
    expect(old.pending[0]).not.toHaveProperty("ask");
    expect(old).not.toHaveProperty("decided");
    const got = LaptopSnapshot.parse({ ...snap, pending: [{ ...row, ask }, { ...row, id: "r2", ask: null }], decided: [decided] });
    expect(got.pending[0]!.ask).toEqual(ask);
    expect(got.pending[1]!.ask).toBeNull();
    expect(got.decided).toEqual([decided]);
    expect(LaptopSnapshot.parse({ ...snap, pending: [], decided: [] }).decided).toEqual([]);
  });

  it("refuses an ask or a decided row over its maxima", () => {
    const q = ask.questions[0]!;
    const bad = [
      { ...ask, text: "x".repeat(8001) },
      { ...ask, questions: [{ ...q, question: "x".repeat(4001) }] },
      { ...ask, questions: [{ ...q, header: "x".repeat(41) }] },
      { ...ask, questions: [{ ...q, options: [{ label: "x".repeat(201), description: "" }] }] },
      { ...ask, questions: [{ ...q, options: [{ label: "A", description: "x".repeat(1001) }] }] },
      { ...ask, questions: [{ ...q, options: Array(5).fill(q.options[0]) }] },
      { ...ask, questions: Array(5).fill(q) },
    ];
    for (const a of bad) expect(LaptopSnapshot.safeParse({ ...snap, pending: [{ ...row, ask: a }] }).success).toBe(false);
    expect(LaptopSnapshot.safeParse({ ...snap, pending: [{ ...row, ask: { ...ask, text: "x".repeat(8000) } }] }).success).toBe(true);
    expect(LaptopSnapshot.safeParse({ ...snap, pending: [], decided: [{ ...decided, note: "x".repeat(2001) }] }).success).toBe(false);
    expect(LaptopSnapshot.safeParse({ ...snap, pending: [], decided: [{ ...decided, decision: "answer" }] }).success).toBe(false);
    expect(LaptopSnapshot.safeParse({ ...snap, pending: [], decided: Array(51).fill(decided) }).success).toBe(false);
  });

  it("an older broker's schema drops them and still takes the snapshot", () => {
    const older = LaptopSnapshot.omit({ decided: true }).extend({ pending: z.array(LaptopSnapshot.shape.pending.element.omit({ ask: true })) });
    const got = older.parse({ ...snap, pending: [{ ...row, ask }], decided: [decided] });
    expect(got).not.toHaveProperty("decided");
    expect(got.pending[0]).not.toHaveProperty("ask");
  });

  it("reads action_result with and without note_delivered", () => {
    const r = { t: "action_result", as: "supervisor", id: "a1", ok: true, message: "allowed" };
    expect(ActionResultFrame.parse(r)).not.toHaveProperty("note_delivered");
    expect(ActionResultFrame.parse({ ...r, note_delivered: false }).note_delivered).toBe(false);
    expect(ClientFrame.parse({ ...r, note_delivered: true })).toMatchObject({ note_delivered: true });
  });
});
