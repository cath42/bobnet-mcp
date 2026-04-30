import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { assertSunPath, lockPath, logPath, socketPath } from "../../src/shared/paths.ts";

describe("paths", () => {
  it("socketPath fits within sun_path limit", () => {
    const p = socketPath();
    assert.ok(Buffer.byteLength(p, "utf8") <= 103, `path too long: ${p} (${Buffer.byteLength(p)} bytes)`);
  });

  it("socketPath ends with .sock", () => {
    assert.match(socketPath(), /\.sock$/);
  });

  it("lockPath ends with .lock", () => {
    assert.match(lockPath(), /\.lock$/);
  });

  it("logPath ends with .log", () => {
    assert.match(logPath(), /\.log$/);
  });

  it("assertSunPath throws for oversize path", () => {
    const longPath = "/" + "x".repeat(200);
    assert.throws(() => assertSunPath(longPath), /sun_path/);
  });

  it("assertSunPath accepts short path", () => {
    assertSunPath("/tmp/x.sock");
  });
});
