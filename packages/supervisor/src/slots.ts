import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Run slots: one heavy run at a time on the laptop (tests, probes, a landing
// push), whoever asks, in the order they asked. A hold ("keep the Mac quiet",
// e.g. while CI runs on this laptop's runner) grants no slot and starts no new
// worker until it is released; runs already in a slot finish. The hold is a
// file, so it survives a supervisor restart.

export interface SlotHolder {
  workerId: string;
  /** What runs: a command, or "land". */
  label: string;
  since: string;
}

export interface Hold {
  reason: string;
  by: string;
  since: string;
}

interface Waiter extends SlotHolder {
  grant: (release: () => void) => void;
}

export class SlotAbortedError extends Error {}

export class RunSlots {
  private readonly size: number;
  private readonly holdFile: string;
  private readonly onChange: () => void;
  private readonly holders: SlotHolder[] = [];
  private readonly queue: Waiter[] = [];
  private holdState: Hold | null;

  constructor(opts: { size: number; holdFile: string; onChange?: () => void }) {
    this.size = opts.size;
    this.holdFile = opts.holdFile;
    this.onChange = opts.onChange ?? (() => {});
    this.holdState = readHold(opts.holdFile);
  }

  /** Waits for a slot; the returned function releases it (once). */
  acquire(workerId: string, label: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new SlotAbortedError("aborted"));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { workerId, label, since: new Date().toISOString(), grant: resolve };
      this.queue.push(waiter);
      signal?.addEventListener(
        "abort",
        () => {
          const i = this.queue.indexOf(waiter);
          if (i === -1) return;
          this.queue.splice(i, 1);
          this.onChange();
          reject(new SlotAbortedError("aborted while waiting for a run slot"));
        },
        { once: true },
      );
      this.pump();
    });
  }

  hold(reason: string, by: string): Hold {
    this.holdState = { reason, by, since: new Date().toISOString() };
    mkdirSync(dirname(this.holdFile), { recursive: true });
    writeFileSync(`${this.holdFile}.tmp`, JSON.stringify(this.holdState), { mode: 0o600 });
    renameSync(`${this.holdFile}.tmp`, this.holdFile);
    this.onChange();
    return this.holdState;
  }

  release(): Hold | null {
    const was = this.holdState;
    this.holdState = null;
    rmSync(this.holdFile, { force: true });
    this.pump();
    this.onChange();
    return was;
  }

  get held(): Hold | null {
    return this.holdState;
  }

  status(): { size: number; hold: Hold | null; holders: SlotHolder[]; queue: SlotHolder[] } {
    const strip = ({ workerId, label, since }: SlotHolder) => ({ workerId, label, since });
    return { size: this.size, hold: this.holdState, holders: this.holders.map(strip), queue: this.queue.map(strip) };
  }

  private pump(): void {
    while (!this.holdState && this.holders.length < this.size && this.queue.length > 0) {
      const next = this.queue.shift()!;
      const holder: SlotHolder = { workerId: next.workerId, label: next.label, since: new Date().toISOString() };
      this.holders.push(holder);
      let released = false;
      next.grant(() => {
        if (released) return;
        released = true;
        this.holders.splice(this.holders.indexOf(holder), 1);
        this.pump();
        this.onChange();
      });
    }
    this.onChange();
  }
}

function readHold(file: string): Hold | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Hold;
  } catch {
    return null;
  }
}
