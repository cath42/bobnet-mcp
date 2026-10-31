import type { Envelope, PeerInfo } from "@bobnet/protocol";
import type { PushFrame } from "./connection.ts";

// Every channel notification wakes the session and costs it a full context
// re-read, so only frames the broker marks `wake` are pushed. Everything else
// waits in a digest that rides along on the next push or tool result. Presence
// is folded per peer, so a supervisor's restart (every role it holds leaves and
// rejoins) reads as one line, not one per role.

export interface ChannelEvent {
  content: string;
  meta: Record<string, string>;
}

const DIGEST_MAX = 50;
const SEEN_MAX = 2_000;
const INFO_ONLY = "── Queued BobNet updates (info only, no response needed) ──";

/** What a peer did since the last digest. */
interface PeerNews {
  who: string;
  purpose: string | null;
  joined: boolean;
  left: boolean;
  /** After its last join or leave: online or not; null if it did neither. */
  online: boolean | null;
  /** Its latest status, if it changed; undefined if it didn't. */
  status?: string | null;
}

export class Inbox {
  private readonly seen = new Set<string>();
  /** Quiet broadcasts, in order. */
  private digest: string[] = [];
  private dropped = 0;
  private readonly presence = new Map<string, PeerNews>();
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
    // Dashboard actions are for supervisors; an interactive session ignores them.
    if (frame.t === "action") return { event: null, ack: [] };
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
    const lines = this.digestLines();
    if (lines.length === 0) return null;
    this.digest = [];
    this.dropped = 0;
    this.presence.clear();
    return [INFO_ONLY, ...lines].join("\n");
  }

  private digestLines(): string[] {
    const lines = [...this.digest];
    if (this.dropped > 0) lines.push(`• (${this.dropped} older updates dropped)`);
    const left: string[] = [];
    const rejoined: string[] = [];
    const statuses = new Map<string, string[]>();
    for (const [address, p] of this.presence) {
      if (p.joined && p.left && p.online) rejoined.push(address);
      else if (p.joined && p.online) lines.push(`• ${p.who} joined${p.purpose ? ` — ${p.purpose}` : ""}`);
      else if (p.left) left.push(p.who);
      if (p.status !== undefined && p.online !== false) {
        const text = p.status ?? "(cleared)";
        statuses.set(text, [...(statuses.get(text) ?? []), p.who]);
      }
    }
    if (rejoined.length === 1) lines.push(`• ${this.presence.get(rejoined[0]!)!.who} left and rejoined`);
    else if (rejoined.length > 1) lines.push(`• ${rejoined.length} agents left and rejoined (a reconnect): ${rejoined.join(", ")}`);
    if (left.length === 1) lines.push(`• ${left[0]} left`);
    else if (left.length > 1) lines.push(`• ${left.length} agents left: ${left.join(", ")}`);
    for (const [text, who] of statuses) {
      lines.push(who.length === 1 ? `• ${who[0]} status: ${text}` : `• status: ${text} — ${who.length} agents: ${who.join(", ")}`);
    }
    return lines;
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
    const digest = this.takeDigest();
    if (!digest) return event;
    const queued = digest.split("\n").length - 1;
    return { content: `${event.content}\n\n${digest}`, meta: { ...event.meta, queued_updates: String(queued) } };
  }

  private queuePresence(event: "joined" | "left" | "status", peer: PeerInfo): void {
    if (peer.address === this.self?.address) return;
    const who = `${peer.address}${peer.team ? ` [team: ${peer.team}]` : ""}`;
    const p = this.presence.get(peer.address) ?? { who, purpose: null, joined: false, left: false, online: null };
    p.who = who;
    if (event === "joined") Object.assign(p, { joined: true, online: true, purpose: peer.purpose ?? null });
    else if (event === "left") Object.assign(p, { left: true, online: false });
    else p.status = peer.status ?? null;
    this.presence.set(peer.address, p);
  }

  private queue(line: string): void {
    this.digest.push(line);
    if (this.digest.length > DIGEST_MAX) {
      this.digest.shift();
      this.dropped++;
    }
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value!);
  }
}
