import type { ChannelEvent } from "../shared/protocol.js";

export interface ChannelNotificationPayload {
  content: string;
  meta: Record<string, string>;
}

export function renderChannelEvent(evt: ChannelEvent): ChannelNotificationPayload {
  switch (evt.event_type) {
    case "peer_joined": {
      const { peer } = evt;
      const cwdSuffix = peer.cwd ? ` (${peer.cwd})` : "";
      const content = peer.purpose
        ? `${peer.name}${cwdSuffix} joined — ${peer.purpose}`
        : `${peer.name}${cwdSuffix} joined`;
      return {
        content,
        meta: removeUndefined({
          event: "peer_joined",
          name: peer.name,
          peer_id: peer.peer_id,
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
        content: `${evt.name} left (${evt.reason})`,
        meta: {
          event: "peer_left",
          name: evt.name,
          peer_id: evt.peer_id,
          reason: evt.reason,
          left_at: evt.left_at,
        },
      };
    case "message":
      return {
        content: evt.body,
        meta: removeUndefined({
          event: "message",
          from: evt.from,
          message_id: evt.message_id,
          in_reply_to: evt.in_reply_to,
          sent_at: evt.sent_at,
        }),
      };
    case "broadcast":
      return {
        content: evt.body,
        meta: {
          event: "broadcast",
          from: evt.from,
          message_id: evt.message_id,
          sent_at: evt.sent_at,
        },
      };
    case "status_changed":
      return {
        content: `${evt.name} status: ${evt.status}`,
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
