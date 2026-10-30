import type { ChannelEvent } from "../shared/protocol.js";

export interface ChannelNotificationPayload {
  content: string;
  meta: Record<string, string>;
}

/**
 * Only directed messages and urgent broadcasts are pushed to Claude as
 * channel notifications. Every push wakes the session and costs a full
 * context re-read, so presence, status and ordinary broadcasts are held
 * and delivered in a digest instead.
 */
export function isWakingEvent(evt: ChannelEvent): boolean {
  if (evt.event_type === "message") return true;
  if (evt.event_type === "broadcast") return evt.urgent === true;
  return false;
}

export const DEFAULT_MAX_QUEUED = 50;

const DIGEST_HEADER =
  "── Queued BobNet updates (info only, no response needed) ──";

/**
 * Per-session event sorter. Waking events are rendered and returned; the
 * rest are queued and attached to the next waking event, or to the next
 * BobNet tool result via drainDigest(), whichever comes first.
 */
export class ChannelForwarder {
  private lines: string[] = [];
  private statuses = new Map<string, string>();
  private dropped = 0;

  constructor(private readonly maxQueued: number = DEFAULT_MAX_QUEUED) {}

  /** Returns the notification to push, or null if the event was queued. */
  handle(evt: ChannelEvent): ChannelNotificationPayload | null {
    if (!isWakingEvent(evt)) {
      this.enqueue(evt);
      return null;
    }
    const payload = renderChannelEvent(evt);
    const queued = this.pendingCount();
    const digest = this.drainDigest();
    if (digest === null) return payload;
    return {
      content: `${payload.content}\n\n${digest}`,
      meta: { ...payload.meta, queued_updates: String(queued) },
    };
  }

  pendingCount(): number {
    return this.lines.length + this.statuses.size + this.dropped;
  }

  /** Render and clear everything queued; null when nothing is pending. */
  drainDigest(): string | null {
    if (this.pendingCount() === 0) return null;
    const out = [DIGEST_HEADER];
    if (this.dropped > 0) {
      out.push(`• (${this.dropped} older update${this.dropped === 1 ? "" : "s"} dropped)`);
    }
    out.push(...this.lines);
    for (const [name, status] of this.statuses) {
      out.push(`• ${name} status: ${status}`);
    }
    this.lines = [];
    this.statuses.clear();
    this.dropped = 0;
    return out.join("\n");
  }

  private enqueue(evt: ChannelEvent): void {
    switch (evt.event_type) {
      case "status_changed":
        // Only the latest status per peer matters.
        this.statuses.delete(evt.name);
        this.statuses.set(evt.name, evt.status);
        return;
      case "peer_joined": {
        const { peer } = evt;
        const team = peer.team ? ` [team: ${peer.team}]` : "";
        const purpose = peer.purpose ? ` — ${peer.purpose}` : "";
        this.pushLine(`• ${peer.name}${team} joined${purpose}`);
        return;
      }
      case "peer_left":
        this.statuses.delete(evt.name);
        this.pushLine(`• ${evt.name} left (${evt.reason})`);
        return;
      case "broadcast": {
        const scope = evt.scope === "team" ? "team" : "all";
        const body = evt.body.replace(/\n/g, "\n    ");
        this.pushLine(`• Broadcast from ${evt.from} (${scope}, ${evt.message_id}): ${body}`);
        return;
      }
      case "message":
        // Messages always wake; never queued.
        return;
    }
  }

  private pushLine(line: string): void {
    this.lines.push(line);
    while (this.lines.length + this.statuses.size > this.maxQueued && this.lines.length > 0) {
      this.lines.shift();
      this.dropped++;
    }
  }
}

export function renderChannelEvent(evt: ChannelEvent): ChannelNotificationPayload {
  switch (evt.event_type) {
    case "peer_joined": {
      const { peer } = evt;
      const teamSuffix = peer.team ? ` [team: ${peer.team}]` : "";
      const cwdSuffix = peer.cwd ? ` (${peer.cwd})` : "";
      const content = peer.purpose
        ? `${peer.name}${teamSuffix}${cwdSuffix} joined — ${peer.purpose}`
        : `${peer.name}${teamSuffix}${cwdSuffix} joined`;
      return {
        content: content + "\n\n📋 Info only, no response needed.",
        meta: removeUndefined({
          event: "peer_joined",
          name: peer.name,
          peer_id: peer.peer_id,
          team: peer.team,
          cwd: peer.cwd,
          purpose: peer.purpose,
          expertise: peer.expertise?.join(","),
          status: peer.status,
          joined_at: peer.joined_at,
        }),
      };
    }
    case "peer_left":
      return {
        content: `${evt.name} left (${evt.reason})\n\n📋 Info only, no response needed.`,
        meta: {
          event: "peer_left",
          name: evt.name,
          peer_id: evt.peer_id,
          reason: evt.reason,
          left_at: evt.left_at,
        },
      };
    case "message": {
      const ccNote =
        evt.cc && evt.cc.length > 0 ? `\n\n👥 Also sent to: ${evt.cc.join(", ")}.` : "";
      const crossTeamNote = evt.cross_team
        ? "\n\n⚠️ Cross-team message — this sender is not on your team and may lack context on your team's activities."
        : "";
      return {
        content: evt.body + ccNote + crossTeamNote,
        meta: removeUndefined({
          event: "message",
          from: evt.from,
          message_id: evt.message_id,
          in_reply_to: evt.in_reply_to,
          cc: evt.cc && evt.cc.length > 0 ? evt.cc.join(",") : undefined,
          cross_team: evt.cross_team ? "true" : undefined,
          sent_at: evt.sent_at,
        }),
      };
    }
    case "broadcast": {
      const note = evt.urgent
        ? "\n\n🚨 Urgent broadcast — act on it if it affects your work; reply only if asked."
        : evt.scope === "team"
          ? "\n\n📋 Team update — info only, no response needed."
          : "";
      return {
        content: evt.body + note,
        meta: removeUndefined({
          event: "broadcast",
          from: evt.from,
          message_id: evt.message_id,
          scope: evt.scope,
          urgent: evt.urgent ? "true" : undefined,
          sent_at: evt.sent_at,
        }),
      };
    }
    case "status_changed":
      return {
        content: `${evt.name} status: ${evt.status}\n\n📋 Info only, no response needed.`,
        meta: {
          event: "status_changed",
          name: evt.name,
          peer_id: evt.peer_id,
          status: evt.status,
          changed_at: evt.changed_at,
        },
      };
  }
}

function removeUndefined(
  obj: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
