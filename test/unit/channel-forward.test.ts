import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  ChannelForwarder,
  isWakingEvent,
  renderChannelEvent,
} from "../../src/client/channel-forward.ts";
import { normalizeRecipients } from "../../src/client/tools.ts";
import type { ChannelEvent } from "../../src/shared/protocol.ts";

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
    assert.match(out.content, /^alpha joined — doing things/);
    assert.match(out.content, /Info only, no response needed/);
    assert.equal(out.meta.event, "peer_joined");
    assert.equal(out.meta.name, "alpha");
    assert.equal(out.meta.expertise, "ts,node");
    assert.equal(out.meta.status, "active");
  });

  it("includes team and cwd in peer_joined content and meta", () => {
    const out = renderChannelEvent({
      event_type: "peer_joined",
      peer: {
        peer_id: "p",
        name: "Bob",
        team: "backend",
        cwd: "/code/widgets/api",
        purpose: "API dev",
        joined_at: "t",
      },
    });
    assert.match(out.content, /Bob \[team: backend\] \(\/code\/widgets\/api\) joined — API dev/);
    assert.equal(out.meta.cwd, "/code/widgets/api");
    assert.equal(out.meta.team, "backend");
  });

  it("renders peer_joined without purpose or cwd", () => {
    const out = renderChannelEvent({
      event_type: "peer_joined",
      peer: { peer_id: "p", name: "alpha", joined_at: "x" },
    });
    assert.match(out.content, /^alpha joined/);
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

  it("renders team broadcast with info-only note", () => {
    const out = renderChannelEvent({
      event_type: "broadcast",
      from: "alpha",
      message_id: "msg_3",
      body: "heads up",
      scope: "team",
      sent_at: "t",
    });
    assert.match(out.content, /^heads up/);
    assert.match(out.content, /info only, no response needed/);
    assert.equal(out.meta.event, "broadcast");
    assert.equal(out.meta.scope, "team");
  });

  it("renders all-scope broadcast without info-only note", () => {
    const out = renderChannelEvent({
      event_type: "broadcast",
      from: "alpha",
      message_id: "msg_4",
      body: "global notice",
      scope: "all",
      sent_at: "t",
    });
    assert.equal(out.content, "global notice");
    assert.equal(out.meta.scope, "all");
  });

  it("renders peer_left with reason and info-only note", () => {
    const out = renderChannelEvent({
      event_type: "peer_left",
      name: "beta",
      peer_id: "p",
      reason: "crashed",
      left_at: "t",
    });
    assert.match(out.content, /beta left \(crashed\)/);
    assert.match(out.content, /Info only, no response needed/);
    assert.equal(out.meta.reason, "crashed");
  });

  it("renders status_changed with info-only note", () => {
    const out = renderChannelEvent({
      event_type: "status_changed",
      name: "alpha",
      peer_id: "p",
      status: "busy",
      changed_at: "t",
    });
    assert.match(out.content, /alpha status: busy/);
    assert.match(out.content, /Info only, no response needed/);
    assert.equal(out.meta.status, "busy");
  });

  it("renders cross-team message with warning", () => {
    const out = renderChannelEvent({
      event_type: "message",
      from: "alpha",
      message_id: "msg_5",
      body: "hey there",
      cross_team: true,
      sent_at: "t",
    });
    assert.match(out.content, /hey there/);
    assert.match(out.content, /Cross-team message/);
    assert.equal(out.meta.cross_team, "true");
  });

  it("renders same-team message without warning", () => {
    const out = renderChannelEvent({
      event_type: "message",
      from: "alpha",
      message_id: "msg_6",
      body: "hey teammate",
      sent_at: "t",
    });
    assert.equal(out.content, "hey teammate");
    assert.equal(out.meta.cross_team, undefined);
  });
});

describe("renderChannelEvent — urgent and cc", () => {
  it("marks urgent broadcasts and omits the info-only note", () => {
    const out = renderChannelEvent({
      event_type: "broadcast",
      from: "Bill",
      message_id: "msg_u",
      body: "hold all pushes to main",
      scope: "team",
      urgent: true,
      sent_at: "t",
    });
    assert.match(out.content, /Urgent broadcast/);
    assert.doesNotMatch(out.content, /info only/);
    assert.equal(out.meta.urgent, "true");
  });

  it("lists other recipients of a multi-recipient message", () => {
    const out = renderChannelEvent({
      event_type: "message",
      from: "Bob",
      message_id: "msg_cc",
      body: "who owns the schema change?",
      cc: ["Bill", "Homer"],
      sent_at: "t",
    });
    assert.match(out.content, /Also sent to: Bill, Homer\./);
    assert.equal(out.meta.cc, "Bill,Homer");
  });
});

const msg = (body: string): ChannelEvent => ({
  event_type: "message",
  from: "Bob",
  message_id: `msg_${body}`,
  body,
  sent_at: "t",
});
const status = (name: string, s: string): ChannelEvent => ({
  event_type: "status_changed",
  name,
  peer_id: `p_${name}`,
  status: s,
  changed_at: "t",
});
const bcast = (body: string, urgent?: boolean): ChannelEvent => ({
  event_type: "broadcast",
  from: "Bill",
  message_id: `msg_${body}`,
  body,
  scope: "team",
  ...(urgent ? { urgent: true } : {}),
  sent_at: "t",
});

describe("isWakingEvent", () => {
  it("wakes only for messages and urgent broadcasts", () => {
    assert.equal(isWakingEvent(msg("x")), true);
    assert.equal(isWakingEvent(bcast("x", true)), true);
    assert.equal(isWakingEvent(bcast("x")), false);
    assert.equal(isWakingEvent(status("Bob", "busy")), false);
    assert.equal(
      isWakingEvent({ event_type: "peer_left", name: "a", peer_id: "p", reason: "crashed", left_at: "t" }),
      false,
    );
    assert.equal(
      isWakingEvent({ event_type: "peer_joined", peer: { peer_id: "p", name: "a", joined_at: "t" } }),
      false,
    );
  });
});

describe("ChannelForwarder", () => {
  it("queues info-only events and attaches them to the next message", () => {
    const f = new ChannelForwarder();
    assert.equal(f.handle(status("Bender", "busy")), null);
    assert.equal(f.handle(bcast("docs pushed")), null);
    assert.equal(
      f.handle({ event_type: "peer_joined", peer: { peer_id: "p", name: "Homer", team: "land", purpose: "QA", joined_at: "t" } }),
      null,
    );
    assert.equal(f.pendingCount(), 3);

    const out = f.handle(msg("ping"));
    assert.ok(out);
    assert.match(out.content, /^ping\n\n── Queued BobNet updates/);
    assert.match(out.content, /Broadcast from Bill \(team, msg_docs pushed\): docs pushed/);
    assert.match(out.content, /Homer \[team: land\] joined — QA/);
    assert.match(out.content, /Bender status: busy/);
    assert.equal(out.meta.queued_updates, "3");
    assert.equal(f.pendingCount(), 0);
  });

  it("delivers a message unchanged when nothing is queued", () => {
    const f = new ChannelForwarder();
    const out = f.handle(msg("hello"));
    assert.ok(out);
    assert.equal(out.content, "hello");
    assert.equal(out.meta.queued_updates, undefined);
  });

  it("pushes urgent broadcasts immediately, with the digest", () => {
    const f = new ChannelForwarder();
    f.handle(bcast("fyi"));
    const out = f.handle(bcast("HOLD", true));
    assert.ok(out);
    assert.match(out.content, /^HOLD/);
    assert.match(out.content, /fyi/);
  });

  it("keeps only the latest status per peer and drops it when they leave", () => {
    const f = new ChannelForwarder();
    f.handle(status("Bender", "busy"));
    f.handle(status("Bender", "idle"));
    f.handle(status("Bill", "testing"));
    f.handle({ event_type: "peer_left", name: "Bill", peer_id: "p", reason: "disconnected", left_at: "t" });
    const digest = f.drainDigest();
    assert.ok(digest);
    assert.doesNotMatch(digest, /busy/);
    assert.match(digest, /Bender status: idle/);
    assert.doesNotMatch(digest, /Bill status/);
    assert.match(digest, /Bill left \(disconnected\)/);
    assert.equal(f.drainDigest(), null);
  });

  it("caps the queue and reports dropped updates", () => {
    const f = new ChannelForwarder(3);
    for (let i = 0; i < 5; i++) f.handle(bcast(`b${i}`));
    const digest = f.drainDigest();
    assert.ok(digest);
    assert.match(digest, /2 older updates dropped/);
    assert.doesNotMatch(digest, /: b1$/m);
    assert.match(digest, /: b4$/m);
  });

  it("indents multi-line broadcast bodies", () => {
    const f = new ChannelForwarder();
    f.handle(bcast("line one\nline two"));
    assert.match(f.drainDigest() ?? "", /line one\n    line two/);
  });
});

describe("normalizeRecipients", () => {
  it("passes through single names and arrays", () => {
    assert.equal(normalizeRecipients("Bob"), "Bob");
    assert.deepEqual(normalizeRecipients(["Bob", "Bill"]), ["Bob", "Bill"]);
  });

  it("parses JSON-string and comma-separated lists", () => {
    assert.deepEqual(normalizeRecipients('["Bob","Bill"]'), ["Bob", "Bill"]);
    assert.deepEqual(normalizeRecipients("Bob, Bill ,Homer"), ["Bob", "Bill", "Homer"]);
  });
});
