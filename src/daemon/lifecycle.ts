import type { Logger } from "../shared/logger.js";

export interface LifecycleOptions {
  idleShutdownMs?: number;
  onShutdown: () => Promise<void> | void;
}

export class Lifecycle {
  private timer: NodeJS.Timeout | null = null;
  private readonly idleMs: number;
  private active = 0;
  private shuttingDown = false;

  constructor(
    private readonly log: Logger,
    private readonly opts: LifecycleOptions,
  ) {
    this.idleMs = opts.idleShutdownMs ?? 60_000;
  }

  start(): void {
    if (this.active === 0) this.armIdle();
  }

  noteConnect(): void {
    this.active += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  noteDisconnect(): void {
    this.active = Math.max(0, this.active - 1);
    if (this.active === 0) this.armIdle();
  }

  beginShutdown(reason: string): Promise<void> {
    if (this.shuttingDown) return Promise.resolve();
    this.shuttingDown = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.log.info("daemon shutting down", { reason });
    return Promise.resolve(this.opts.onShutdown()).then(
      () => undefined,
      (err) => {
        this.log.error("shutdown handler threw", { err: (err as Error).message });
      },
    );
  }

  private armIdle(): void {
    if (this.timer || this.shuttingDown) return;
    this.log.debug("arming idle shutdown timer", { idle_ms: this.idleMs });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.beginShutdown("idle_timeout");
    }, this.idleMs);
    this.timer.unref();
  }
}
