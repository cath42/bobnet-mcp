import type { Identity } from "@bobnet/client/config";
import { BrokerError, type PushFrame, type RequestFrame } from "@bobnet/client/connection";
import { addressKey, type BoardCtx, type BoardOpInput, type BoardResults, type ClientInfo, type Envelope, findSecret, formatAddress, LIMITS, parseRecipient, type PeerInfo } from "@bobnet/protocol";
import type { BrokerLink } from "../src/supervisor.ts";

// Several laptops on one fake broker (ADR 0007, Consequences "Testing"): each supervisor gets its
// own link, and messages route between them by name@laptop as the broker routes them
// (packages/broker/src/broker.ts). It copies what the remote wire relies on: delivered_to and
// queued_for, ttl_seconds, the in_reply_to check against what a sweep left, redelivery of unacked
// messages on reconnect, presence with the team rule, the findSecret refusal. The clock and the
// sweep are the test's: nothing expires or goes until it says so. packages/broker's
// test/remote-wire.test.ts pins the same behaviours on the real broker.

interface Peer {
  name: string;
  laptop: string;
  team: string | null;
  /** Its laptop's link while connected; null once it dropped. */
  link: FakeLink | null;
  last_seen: string;
}

export class FakeNetwork {
  /** The broker's clock, ms; moved only by `advance`. */
  now = Date.parse("2026-11-17T12:00:00Z");
  /** Every message the broker took, in order: the traffic a test counts. */
  readonly log: Envelope[] = [];
  /** Sends refused, with the broker's code. */
  readonly refused: Array<{ from: string; to: string[]; code: string }> = [];
  /** Past this many messages a send is refused: a runaway exchange fails its test instead of spinning. */
  limit = 200;
  /** The broker's credential check; a test swaps it for a newer detector than the supervisor's. */
  detector: (body: string) => string | null = findSecret;
  /** What each peer says it runs (its `client`, by address), as the broker keeps it from register; none is null, as a client too old to say. */
  readonly clients = new Map<string, ClientInfo>();

  private readonly links = new Map<string, FakeLink>();
  private readonly peers = new Map<string, Peer>();
  /** Stored messages, until swept. */
  private readonly messages = new Map<string, Envelope>();
  /** message id → recipient keys not yet acked. */
  private readonly deliveries = new Map<string, Set<string>>();
  private seq = 0;
  /** Waits on this clock (a supervisor's `sleep`), resolved by `advance`. */
  private timers: Array<{ at: number; resolve: () => void }> = [];

  /** The link for a laptop's supervisor: one connection that hosts the names it registers. */
  link(laptop: string): FakeLink {
    let l = this.links.get(laptop);
    if (!l) this.links.set(laptop, (l = new FakeLink(this, laptop)));
    return l;
  }

  advance(seconds: number): void {
    this.now += seconds * 1000;
    const due = this.timers.filter((t) => t.at <= this.now);
    this.timers = this.timers.filter((t) => t.at > this.now);
    for (const t of due) t.resolve();
  }

  /** A wait on the network's clock, for a Supervisor's `sleep`; gone from the clock once `signal` aborts. */
  readonly sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      const timer = { at: this.now + ms, resolve };
      this.timers.push(timer);
      signal?.addEventListener(
        "abort",
        () => {
          this.timers = this.timers.filter((t) => t !== timer);
          resolve();
        },
        { once: true },
      );
    });

  /** The waits still on the clock: when each is due, ms. */
  pending(): number[] {
    return this.timers.map((t) => t.at);
  }

  /** The broker's alarm: drops what has expired, so an in_reply_to to it is refused. */
  sweep(): void {
    for (const [id, m] of this.messages) {
      if (Date.parse(m.expires_at) <= this.now) {
        this.messages.delete(id);
        this.deliveries.delete(id);
      }
    }
  }

  /** The laptop's socket drops: its peers go offline, and what is sent to them waits. */
  disconnect(laptop: string): void {
    const link = this.link(laptop);
    link.connected = false;
    for (const p of this.peers.values()) {
      if (p.link !== link) continue;
      p.link = null;
      p.last_seen = this.iso();
      this.presence("left", p);
    }
  }

  /** The laptop connects again and its names re-register, as BrokerConnection does: unacked messages come again. */
  async reconnect(laptop: string): Promise<void> {
    const link = this.link(laptop);
    link.connected = true;
    for (const identity of [...link.hosted.values()]) await link.register(identity);
  }

  /** Bodies sent from one address to another, in order. */
  between(from: string, to: string): string[] {
    return this.log.filter((m) => m.from === from && m.to.includes(to)).map((m) => m.body);
  }

  peerList(): PeerInfo[] {
    return [...this.peers.values()].map((p) => this.info(p));
  }

  register(link: FakeLink, identity: Identity): { address: string; queued: number } {
    if (!link.connected) throw new BrokerError("disconnected", "not connected");
    const key = addressKey({ name: identity.name, laptop: link.laptop });
    const existing = this.peers.get(key);
    if (existing?.link && existing.link !== link) throw new BrokerError("name_in_use", `${identity.name} is in use`);
    const wasOnline = existing?.link === link;
    const peer: Peer = { name: identity.name, laptop: link.laptop, team: identity.team ?? null, link, last_seen: this.iso() };
    this.peers.set(key, peer);
    if (!wasOnline) this.presence("joined", peer);
    const pending = this.pendingFor(key);
    // The ok goes first so the client knows the address before deliveries arrive.
    queueMicrotask(() => {
      for (const msg of pending) link.deliver({ t: "deliver", to: formatAddress(peer), wake: msg.type === "message" || msg.urgent, msg });
    });
    return { address: formatAddress(peer), queued: pending.length };
  }

  send(link: FakeLink, frame: Extract<RequestFrame, { t: "send" }>): { id: string; delivered_to: string[]; queued_for: string[] } {
    const sender = this.hosted(link, frame.as);
    const refuse = (code: ConstructorParameters<typeof BrokerError>[0], message: string): never => {
      this.refused.push({ from: formatAddress(sender), to: frame.to, code });
      throw new BrokerError(code, message);
    };
    if (frame.body.length > LIMITS.bodyChars) refuse("bad_frame", "body too long");
    const found = this.detector(frame.body);
    if (found) refuse("secret_detected", `Message looks like it contains a credential (${found}); send a path instead`);
    const recipients: Peer[] = [];
    const unknown: string[] = [];
    for (const raw of new Set(frame.to)) {
      const addr = parseRecipient(raw, sender.laptop);
      const peer = addr ? this.peers.get(addressKey(addr)) : undefined;
      if (peer) recipients.push(peer);
      else unknown.push(raw);
    }
    if (unknown.length > 0) refuse("unknown_peer", `No such peer: ${unknown.join(", ")}`);
    if (frame.in_reply_to !== undefined && !this.messages.has(frame.in_reply_to)) refuse("unknown_message", `No message ${frame.in_reply_to}`);
    if (this.log.length >= this.limit) refuse("bad_frame", `the fake network's limit of ${this.limit} messages`);

    const msg: Envelope = {
      id: `m_${(++this.seq).toString().padStart(8, "0")}`,
      type: "message",
      from: formatAddress(sender),
      to: recipients.map((p) => formatAddress(p)),
      team: sender.team,
      laptop: sender.laptop,
      in_reply_to: frame.in_reply_to ?? null,
      urgent: frame.urgent ?? false,
      body: frame.body,
      created_at: this.iso(),
      expires_at: new Date(this.now + (frame.ttl_seconds ?? LIMITS.defaultMessageTtlSeconds) * 1000).toISOString(),
    };
    this.messages.set(msg.id, msg);
    this.deliveries.set(msg.id, new Set(recipients.map((p) => addressKey(p))));
    this.log.push(msg);
    const delivered = recipients.filter((p) => p.link?.connected);
    queueMicrotask(() => {
      for (const p of delivered) p.link?.deliver({ t: "deliver", to: formatAddress(p), wake: true, msg });
    });
    return { id: msg.id, delivered_to: delivered.map((p) => formatAddress(p)), queued_for: recipients.filter((p) => !delivered.includes(p)).map((p) => formatAddress(p)) };
  }

  /** Whether every recipient of a message has acked it: a supervisor acks once it has handled the message. */
  acked(id: string): boolean {
    return this.deliveries.get(id)?.size === 0;
  }

  ack(link: FakeLink, as: string, ids: string[]): void {
    const key = addressKey({ name: as, laptop: link.laptop });
    for (const id of ids) this.deliveries.get(id)?.delete(key);
  }

  /** Unacked and unexpired, in the broker's order: created_at, then id. */
  private pendingFor(key: string): Envelope[] {
    return [...this.deliveries]
      .filter(([id, to]) => to.has(key) && Date.parse(this.messages.get(id)!.expires_at) > this.now)
      .map(([id]) => this.messages.get(id)!)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  }

  private hosted(link: FakeLink, as: string): Peer {
    const peer = this.peers.get(addressKey({ name: as, laptop: link.laptop }));
    if (!link.connected) throw new BrokerError("disconnected", "not connected");
    if (!peer || peer.link !== link) throw new BrokerError("not_hosted", `${as} is not registered on this connection`);
    return peer;
  }

  /** As the broker: a connection hears of a peer if it hosts another peer on the same team or one with no team. */
  private presence(event: "joined" | "left", subject: Peer): void {
    const listeners = new Set<FakeLink>();
    for (const p of this.peers.values()) {
      if (!p.link || p === subject) continue;
      if (p.team === null || p.team === subject.team) listeners.add(p.link);
    }
    const frame: PushFrame = { t: "presence", event, peer: this.info(subject) };
    for (const l of listeners) queueMicrotask(() => l.deliver(frame));
  }

  private info(p: Peer): PeerInfo {
    return { address: formatAddress(p), name: p.name, laptop: p.laptop, team: p.team, purpose: null, expertise: [], status: null, online: p.link !== null, last_seen: p.last_seen, client: this.clients.get(formatAddress(p)) ?? null };
  }

  private iso(): string {
    return new Date(this.now).toISOString();
  }
}

/** One laptop's connection to the FakeNetwork: what a Supervisor takes as its broker. */
export class FakeLink implements BrokerLink {
  connected = true;
  /** Names registered on this connection, re-registered on reconnect. */
  readonly hosted = new Map<string, Identity>();
  /** Every push this laptop got, in order. */
  readonly pushes: PushFrame[] = [];
  /** Where pushes go: the supervisor's onPush, set once it exists. */
  onPush: (frame: PushFrame) => void = () => {};
  /** A send this returns a code for fails with it before it reaches the network: an outage, or a refusal the fake doesn't make. */
  failSend: (frame: Extract<RequestFrame, { t: "send" }>) => string | null = () => null;
  /** A send this returns a code for reaches the network and then fails with it: its ack lost to a drop or the ack's timeout. */
  loseAck: (frame: Extract<RequestFrame, { t: "send" }>) => string | null = () => null;

  private readonly net: FakeNetwork;
  readonly laptop: string;

  constructor(net: FakeNetwork, laptop: string) {
    this.net = net;
    this.laptop = laptop;
  }

  deliver(frame: PushFrame): void {
    if (!this.connected) return;
    this.pushes.push(frame);
    this.onPush(frame);
  }

  async register(identity: Identity): Promise<unknown> {
    const r = this.net.register(this, identity);
    this.hosted.set(identity.name, identity);
    return r;
  }

  async request<R>(frame: RequestFrame): Promise<R> {
    switch (frame.t) {
      case "send": {
        const code = this.failSend(frame);
        // "disconnected" here is the client's: not connected, so the frame never left (its whenReady).
        if (code) throw new BrokerError(code as ConstructorParameters<typeof BrokerError>[0], code === "disconnected" ? "Not connected to the BobNet broker; retrying in the background" : `failed as the test said: ${code}`);
        const sent = this.net.send(this, frame) as R;
        const lost = this.loseAck(frame);
        if (lost) throw new BrokerError(lost as ConstructorParameters<typeof BrokerError>[0], lost === "timeout" ? "No reply to send within 15000 ms" : "Connection to the BobNet broker dropped");
        return sent;
      }
      case "peers":
        return { peers: this.net.peerList() } as R;
      case "report":
        return { laptop: this.laptop } as R;
      default:
        return {} as R;
    }
  }

  async boardOp<K extends keyof BoardResults>(_as: string, _op: BoardOpInput & { op: K }, _ctx?: BoardCtx): Promise<BoardResults[K]> {
    return { ref: null, seq: 1 } as BoardResults[K];
  }

  /** The action results this laptop's supervisor sent, as the broker would forward them to the owner. */
  readonly results: Array<Extract<Parameters<BrokerLink["sendRaw"]>[0], { t: "action_result" }>> = [];

  sendRaw(frame: Parameters<BrokerLink["sendRaw"]>[0]): void {
    if (frame.t === "ack") this.net.ack(this, frame.as, frame.ids);
    else this.results.push(frame);
  }
}
