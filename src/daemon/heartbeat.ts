import type { Logger } from "../shared/logger.js";
import { Method } from "../shared/protocol.js";
import { newRequestId } from "../shared/ids.js";
import type { ConnectionManager } from "./connection-manager.js";

export interface HeartbeatOptions {
  intervalMs?: number;
  deadlineMs?: number;
}

export class HeartbeatMonitor {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly deadlineMs: number;
  private lastTickAt = 0;

  constructor(
    private readonly conns: ConnectionManager,
    private readonly onDead: (connectionId: string) => void,
    private readonly log: Logger,
    opts: HeartbeatOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 10_000;
    this.deadlineMs = opts.deadlineMs ?? 60_000;
  }

  start(): void {
    if (this.timer) return;
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const now = Date.now();
    const sinceLastTick = this.lastTickAt === 0 ? this.intervalMs : now - this.lastTickAt;
    this.lastTickAt = now;

    // If the wall clock jumped far past our scheduled interval, the host
    // probably just woke from sleep / App Nap / a long event-loop stall.
    // In that case every connection looks "idle" because no Node code ran
    // during the gap — evicting them all would wipe the registry. Refresh
    // lastActivity for everyone and let the next tick decide based on real
    // post-wake responsiveness.
    if (sinceLastTick > this.intervalMs * 3) {
      this.log.warn("clock jump detected; deferring evictions", {
        since_last_tick_ms: sinceLastTick,
        connection_count: this.conns.size(),
      });
      for (const conn of this.conns.all()) {
        conn.lastActivity = now;
      }
      return;
    }

    for (const conn of this.conns.all()) {
      const idle = now - conn.lastActivity;
      if (idle > this.deadlineMs) {
        this.log.warn("heartbeat deadline exceeded; evicting", {
          connection_id: conn.id,
          idle_ms: idle,
        });
        try {
          this.onDead(conn.id);
        } catch (err) {
          this.log.error("eviction handler threw", {
            connection_id: conn.id,
            err: (err as Error).message,
          });
        }
        conn.close("heartbeat_timeout");
        continue;
      }
      if (idle > this.intervalMs) {
        // Send ping to elicit activity; the response (or any frame) will
        // refresh lastActivity.
        conn.send({
          jsonrpc: "2.0",
          id: newRequestId(),
          method: Method.Ping,
          params: { nonce: newRequestId() },
        });
      }
    }
  }
}
