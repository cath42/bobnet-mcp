import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { renderChannelEvent } from "../../src/client/channel-forward.ts";

describe("renderChannelEvent", () => {
  it("renders peer_joined with purpose", () => {
    const out = renderChannelEvent({
      event_type: "peer_joined",
      peer: {
        peer_id: "peer_x",
        name: "alpha",
        purpose: "doing things",
        expertise: ["ts", "node"],
        status: "active",
        joined_at: "2026-04-26T00:00:00Z",
      },
    });
    assert.equal(out.content, "alpha joined — doing things");
    assert.equal(out.meta.event, "peer_joined");
    assert.equal(out.meta.name, "alpha");
    assert.equal(out.meta.expertise, "ts,node");
    assert.equal(out.meta.status, "active");
  });

  it("includes cwd in peer_joined content and meta", () => {
    const out = renderChannelEvent({
      event_type: "peer_joined",
      peer: {
        peer_id: "p",
        name: "Bob",
        cwd: "/code/widgets/api",
        purpose: "API dev",
        joined_at: "t",
      },
    });
    assert.equal(out.content, "Bob (/code/widgets/api) joined — API dev");
    assert.equal(out.meta.cwd, "/code/widgets/api");
  });

  it("renders peer_joined without purpose or cwd", () => {
    const out = renderChannelEvent({
      event_type: "peer_joined",
      peer: { peer_id: "p", name: "alpha", joined_at: "x" },
    });
    assert.equal(out.content, "alpha joined");
    assert.equal(out.meta.purpose, undefined);
    assert.equal(out.meta.cwd, undefined);
  });

  it("renders message with body verbatim", () => {
    const out = renderChannelEvent({
      event_type: "message",
      from: "alpha",
      message_id: "msg_1",
      body: "hello world",
      sent_at: "t",
    });
    assert.equal(out.content, "hello world");
    assert.equal(out.meta.event, "message");
    assert.equal(out.meta.from, "alpha");
    assert.equal(out.meta.message_id, "msg_1");
    assert.equal(out.meta.in_reply_to, undefined);
  });

  it("renders message with in_reply_to", () => {
    const out = renderChannelEvent({
      event_type: "message",
      from: "alpha",
      message_id: "msg_2",
      body: "re: hi",
      in_reply_to: "msg_1",
      sent_at: "t",
    });
    assert.equal(out.meta.in_reply_to, "msg_1");
  });

  it("renders broadcast", () => {
    const out = renderChannelEvent({
      event_type: "broadcast",
      from: "alpha",
      message_id: "msg_3",
      body: "heads up",
      sent_at: "t",
    });
    assert.equal(out.content, "heads up");
    assert.equal(out.meta.event, "broadcast");
  });

  it("renders peer_left with reason", () => {
    const out = renderChannelEvent({
      event_type: "peer_left",
      name: "beta",
      peer_id: "p",
      reason: "crashed",
      left_at: "t",
    });
    assert.equal(out.content, "beta left (crashed)");
    assert.equal(out.meta.reason, "crashed");
  });

  it("renders status_changed", () => {
    const out = renderChannelEvent({
      event_type: "status_changed",
      name: "alpha",
      peer_id: "p",
      status: "busy",
      changed_at: "t",
    });
    assert.equal(out.content, "alpha status: busy");
    assert.equal(out.meta.status, "busy");
  });
});
