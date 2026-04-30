import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { encode, FramingError, LineFramer } from "../../src/shared/framing.ts";

describe("LineFramer", () => {
  it("parses one frame", () => {
    const f = new LineFramer();
    const out = f.feed('{"a":1}\n');
    assert.deepEqual(out, [{ a: 1 }]);
  });

  it("parses multiple frames in one chunk", () => {
    const f = new LineFramer();
    const out = f.feed('{"a":1}\n{"b":2}\n{"c":3}\n');
    assert.deepEqual(out, [{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("buffers frames split across chunks", () => {
    const f = new LineFramer();
    assert.deepEqual(f.feed('{"a"'), []);
    assert.deepEqual(f.feed(":1}"), []);
    assert.deepEqual(f.feed("\n"), [{ a: 1 }]);
  });

  it("ignores empty lines", () => {
    const f = new LineFramer();
    const out = f.feed('\n{"a":1}\n\n');
    assert.deepEqual(out, [{ a: 1 }]);
  });

  it("throws on invalid JSON", () => {
    const f = new LineFramer();
    assert.throws(() => f.feed("not json\n"), FramingError);
  });

  it("throws when buffer exceeds max bytes", () => {
    const f = new LineFramer(64);
    const oversize = "x".repeat(100);
    assert.throws(() => f.feed(oversize), FramingError);
  });

  it("encode produces newline-terminated UTF-8", () => {
    const buf = encode({ hello: "world" });
    assert.equal(buf.toString("utf8"), '{"hello":"world"}\n');
  });
});
