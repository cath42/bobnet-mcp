import type { Envelope, PeerInfo } from "@bobnet/protocol";
import { describe, expect, it } from "vitest";
import { Inbox } from "../src/inbox.ts";

const msg = (over: Partial<Envelope> = {}): Envelope => ({
  id: "m_1",
  type: "message",
  from: "Bob@mbp-1",
  to: ["Mario@mbp-1"],
  team: "bobnet",
  laptop: "mbp-1",
  in_reply_to: null,
  urgent: false,
  body: "hello",
  created_at: "2026-10-30T00:00:00.000Z",
  expires_at: "2026-11-30T00:00:00.000Z",
  ...over,
});
const peer = (over: Partial<PeerInfo> = {}): PeerInfo => ({
  address: "Bill@mbp-2",
  name: "Bill",
  laptop: "mbp-2",
  team: "bobnet",
  purpose: "architect",
  expertise: [],
  status: null,
  online: true,
  last_seen: "2026-10-30T00:00:00.000Z",
  ...over,
});

function inbox() {
  const i = new Inbox();
  i.setSelf("Mario@mbp-1", "bobnet");
  return i;
}

describe("Inbox", () => {
  it("pushes a woken message with its meta and acks it", () => {
    const { event, ack } = inbox().receive({ t: "deliver", to: "Mario@mbp-1", wake: true, msg: msg({ in_reply_to: "m_0" }) });
    expect(ack).toEqual(["m_1"]);
    expect(event).toEqual({
      content: "hello",
      meta: { event: "message", from: "Bob@mbp-1", message_id: "m_1", sent_at: "2026-10-30T00:00:00.000Z", in_reply_to: "m_0" },
    });
  });

  it("notes other recipients and other teams", () => {
    const { event } = inbox().receive({
      t: "deliver",
      to: "Mario@mbp-1",
      wake: true,
      msg: msg({ to: ["Mario@mbp-1", "Bender@mbp-1"], team: "land" }),
    });
    expect(event!.meta).toMatchObject({ cc: "Bender@mbp-1", cross_team: "true" });
    expect(event!.content).toContain("Also sent to: Bender@mbp-1");
    expect(event!.content).toContain("Cross-team");
  });

  it("drops redeliveries but still acks them", () => {
    const i = inbox();
    const f = { t: "deliver" as const, to: "Mario@mbp-1", wake: true, msg: msg() };
    expect(i.receive(f).event).not.toBeNull();
    expect(i.receive(f)).toEqual({ event: null, ack: ["m_1"] });
  });

  it("queues quiet broadcasts and presence, then attaches the digest to the next push", () => {
    const i = inbox();
    expect(i.receive({ t: "deliver", to: "Mario@mbp-1", wake: false, msg: msg({ id: "m_b", type: "broadcast", body: "standup" }) }).event).toBeNull();
    i.receive({ t: "presence", event: "joined", peer: peer() });
    i.receive({ t: "presence", event: "status", peer: peer({ status: "one" }) });
    i.receive({ t: "presence", event: "status", peer: peer({ status: "two" }) });
    const { event } = i.receive({ t: "deliver", to: "Mario@mbp-1", wake: true, msg: msg({ id: "m_2" }) });
    expect(event!.meta["queued_updates"]).toBe("3");
    expect(event!.content).toContain("info only, no response needed");
    expect(event!.content).toContain("Bob@mbp-1 [team: bobnet] broadcast: standup");
    expect(event!.content).toContain("Bill@mbp-2 [team: bobnet] joined — architect");
    expect(event!.content).toContain("status: two");
    expect(event!.content).not.toContain("status: one");
    expect(i.takeDigest()).toBeNull();
  });

  it("ignores its own presence and caps the digest", () => {
    const i = inbox();
    i.receive({ t: "presence", event: "joined", peer: peer({ address: "Mario@mbp-1" }) });
    expect(i.takeDigest()).toBeNull();
    for (let n = 0; n < 55; n++) i.receive({ t: "presence", event: "left", peer: peer({ address: `P${n}@mbp-2` }) });
    const d = i.takeDigest()!;
    expect(d.split("\n").filter((l) => l.startsWith("• P"))).toHaveLength(50);
    expect(d).toContain("5 older updates dropped");
  });

  it("marks an urgent broadcast", () => {
    const { event } = inbox().receive({
      t: "deliver",
      to: "Mario@mbp-1",
      wake: true,
      msg: msg({ type: "broadcast", urgent: true, body: "push hold" }),
    });
    expect(event!.meta).toMatchObject({ event: "broadcast", urgent: "true" });
    expect(event!.content).toContain("Urgent broadcast");
  });
});
