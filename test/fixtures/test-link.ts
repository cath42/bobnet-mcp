import { DaemonLink } from "../../src/client/daemon-link.ts";
import { createLogger } from "../../src/shared/logger.ts";
import { Method } from "../../src/shared/protocol.ts";
import { PROTOCOL_VERSION } from "../../src/shared/version.ts";
import { nowIso } from "../../src/shared/time.ts";
import type { ChannelEvent } from "../../src/shared/protocol.ts";

const silentLog = createLogger({ to: "stderr", level: "error" });

export async function connectClient(socketPath: string): Promise<{
  link: DaemonLink;
  events: ChannelEvent[];
  closed: { reason?: Error };
  drainEvents(): ChannelEvent[];
  waitFor(predicate: (e: ChannelEvent) => boolean, timeoutMs?: number): Promise<ChannelEvent>;
}> {
  const link = new DaemonLink(socketPath, silentLog);
  await link.connect();
  await link.call(Method.Hello, {
    protocol_version: PROTOCOL_VERSION,
    client_pid: process.pid,
    client_started_at: nowIso(),
  });
  const events: ChannelEvent[] = [];
  const closed: { reason?: Error } = {};
  link.onChannelEvent((e) => events.push(e));
  link.onClose((err) => {
    if (err) closed.reason = err;
  });
  return {
    link,
    events,
    closed,
    drainEvents() {
      const out = events.slice();
      events.length = 0;
      return out;
    },
    async waitFor(predicate, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = events.find(predicate);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`);
    },
  };
}
