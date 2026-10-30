import type { Envelope, PeerInfo } from "@bobnet/protocol";
import type { PushFrame } from "./connection.ts";

// Every channel notification wakes the session and costs it a full context
// re-read, so only frames the broker marks `wake` are pushed. Everything else
// waits in a digest that rides along on the next push or tool result.

export interface ChannelEvent {
  content: string;
  meta: Record<string, string>;
}

const DIGEST_MAX = 50;
const SEEN_MAX = 2_000;
const INFO_ONLY = "── Queued BobNet updates (info only, no response needed) ──";

export class Inbox {
  private readonly seen = new Set<string>();
  private digest: string[] = [];
  private dropped = 0;
  /** Latest status line per peer, so a chatty status only queues once. */
  private readonly statusLine = new Map<string, number>();
  private self: { address: string; team: string | null } | null = null;

  setSelf(address: string, team: string | null): void {
    this.self = { address, team };
  }

  clearSelf(): void {
    this.self = null;
  }

  /**
   * Handles one pushed frame. Returns the channel event to emit, or null if it
   * was queued or was a duplicate. `ack` lists message ids to acknowledge.
   */
  receive(frame: PushFrame): { event: ChannelEvent | null; ack: string[] } {
    if (frame.t === "presence") {
      this.queuePresence(frame.event, frame.peer);
      return { event: null, ack: [] };
    }

    const msg = frame.msg;
    if (this.seen.has(msg.id)) return { event: null, ack: [msg.id] };
    this.remember(msg.id);

    if (!frame.wake) {
      this.queue(`• ${msg.from}${msg.team ? ` [team: ${msg.team}]` : ""} broadcast: ${msg.body}`);
      return { event: null, ack: [msg.id] };
    }
    return { event: this.withDigest(this.toEvent(msg)), ack: [msg.id] };
  }

  /** The pending digest as text for a tool result, emptying it; null if empty. */
  takeDigest(): string | null {
    if (this.digest.length === 0 && this.dropped === 0) return null;
    const lines = [INFO_ONLY, ...this.digest];
    if (this.dropped > 0) lines.push(`• (${this.dropped} older updates dropped)`);
    this.digest = [];
    this.dropped = 0;
    this.statusLine.clear();
    return lines.join("\n");
  }

  private toEvent(msg: Envelope): ChannelEvent {
    const others = msg.to.filter((a) => a !== this.self?.address);
    const crossTeam = this.self !== null && msg.team !== this.self.team;
    const notes: string[] = [];
    if (msg.type === "message" && others.length > 0) notes.push(`👥 Also sent to: ${others.join(", ")}.`);
    if (msg.type === "broadcast") {
      notes.push("🚨 Urgent broadcast — act on it if it affects your work; reply only if asked.");
    }
    if (crossTeam) {
      notes.push("⚠️ Cross-team message — the sender is not on your team and may lack context on its work.");
    }

    const meta: Record<string, string> = {
      event: msg.type,
      from: msg.from,
      message_id: msg.id,
      sent_at: msg.created_at,
    };
    if (msg.in_reply_to) meta["in_reply_to"] = msg.in_reply_to;
    if (msg.type === "message" && others.length > 0) meta["cc"] = others.join(",");
    if (msg.urgent) meta["urgent"] = "true";
    if (crossTeam) meta["cross_team"] = "true";

    return { content: [msg.body, ...notes].join("\n\n"), meta };
  }

  private withDigest(event: ChannelEvent): ChannelEvent {
    const queued = this.digest.length + this.dropped;
    const digest = this.takeDigest();
    if (!digest) return event;
    return { content: `${event.content}\n\n${digest}`, meta: { ...event.meta, queued_updates: String(queued) } };
  }

  private queuePresence(event: "joined" | "left" | "status", peer: PeerInfo): void {
    if (peer.address === this.self?.address) return;
    const who = `${peer.address}${peer.team ? ` [team: ${peer.team}]` : ""}`;
    if (event === "joined") this.queue(`• ${who} joined${peer.purpose ? ` — ${peer.purpose}` : ""}`);
    else if (event === "left") this.queue(`• ${who} left`);
    else {
      const line = `• ${who} status: ${peer.status ?? "(cleared)"}`;
      const at = this.statusLine.get(peer.address);
      if (at !== undefined && this.digest[at] !== undefined) this.digest[at] = line;
      else {
        this.queue(line);
        this.statusLine.set(peer.address, this.digest.length - 1);
      }
    }
  }

  private queue(line: string): void {
    this.digest.push(line);
    if (this.digest.length > DIGEST_MAX) {
      this.digest.shift();
      this.dropped++;
      // Indexes shifted; status de-duplication restarts from here.
      this.statusLine.clear();
    }
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value!);
  }
}
