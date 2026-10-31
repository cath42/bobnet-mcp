import { readFileSync, statSync } from "node:fs";

// Run slots (ADR 0094 §2): one heavy run at a time on the laptop (tests,
// probes, a land and its hook), over every agent: workers wait here, and
// interactive agents are queued here by their orchestrator. A hold keeps the
// laptop quiet: no slot is given, except to the authors it allows. The hold
// is not kept here: it is read from each project's hold file (for helix,
// `pnpm integrate hold`'s), so there is one register and it can't disagree.

export interface Hold {
  reason: string;
  /** Authors whose runs and lands still go (a red main's fix). */
  allow: string[];
  /** The file it was read from. */
  source: string;
}

export interface SlotEntry {
  /** A worker id, or `interactive:<name>` for an agent the orchestrator queued. */
  holder: string;
  /** The git author the hold's allow list is checked against. */
  author: string;
  /** What runs: a command, or "land". */
  label: string;
  since: string;
}

interface Waiter extends SlotEntry {
  grant: (release: () => void) => void;
}

export class SlotAbortedError extends Error {}

export class RunSlots {
  private readonly size: number;
  private readonly readHold: () => Hold | null;
  private readonly onChange: () => void;
  private readonly onGrant: (entry: SlotEntry) => void;
  private readonly holders: SlotEntry[] = [];
  private readonly releases = new Map<SlotEntry, () => void>();
  private queue: Waiter[] = [];

  constructor(opts: { size: number; readHold: () => Hold | null; onChange?: () => void; onGrant?: (entry: SlotEntry) => void }) {
    this.size = opts.size;
    this.readHold = opts.readHold;
    this.onChange = opts.onChange ?? (() => {});
    this.onGrant = opts.onGrant ?? (() => {});
  }

  /** Waits for a slot; the returned function releases it (once). */
  acquire(holder: string, author: string, label: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new SlotAbortedError("aborted"));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { holder, author, label, since: new Date().toISOString(), grant: resolve };
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

  /** Frees every slot a holder has and drops it from the queue. */
  drop(holder: string): boolean {
    let found = false;
    for (const e of [...this.holders]) {
      if (e.holder !== holder) continue;
      found = true;
      this.releases.get(e)?.();
    }
    const before = this.queue.length;
    this.queue = this.queue.filter((w) => w.holder !== holder);
    if (this.queue.length !== before) found = true;
    this.pump();
    return found;
  }

  /** Moves the named holders to the front of the queue, in that order; the rest keep theirs. */
  reorder(holders: string[]): void {
    const first = holders.flatMap((h) => this.queue.filter((w) => w.holder === h));
    this.queue = [...first, ...this.queue.filter((w) => !first.includes(w))];
    this.pump();
  }

  get held(): Hold | null {
    return this.readHold();
  }

  /** Re-reads the hold and gives any slot it now allows. */
  refresh(): void {
    this.pump();
  }

  status(): { size: number; hold: Hold | null; holders: SlotEntry[]; queue: SlotEntry[] } {
    const strip = ({ holder, author, label, since }: SlotEntry) => ({ holder, author, label, since });
    return { size: this.size, hold: this.readHold(), holders: this.holders.map(strip), queue: this.queue.map(strip) };
  }

  private pump(): void {
    const hold = this.readHold();
    let i = 0;
    while (this.holders.length < this.size && i < this.queue.length) {
      const next = this.queue[i]!;
      if (hold && !holdAllows(hold, next.author)) {
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      const entry: SlotEntry = { holder: next.holder, author: next.author, label: next.label, since: new Date().toISOString() };
      this.holders.push(entry);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.releases.delete(entry);
        this.holders.splice(this.holders.indexOf(entry), 1);
        this.pump();
      };
      this.releases.set(entry, release);
      next.grant(release);
      this.onGrant(entry);
    }
    this.onChange();
  }
}

/** Whether a hold lets this git author run; names match whatever their case (`homer` allows Homer). */
export function holdAllows(hold: Hold, author: string): boolean {
  const a = author.toLowerCase();
  return hold.allow.some((x) => x.toLowerCase() === a);
}

/**
 * Reads a hold file: JSON `{ "reason": "...", "allow": ["Homer"] }`, or text whose
 * first line is the reason and whose `allow:` line lists authors. No file, no hold.
 */
export function readHoldFile(file: string): Hold | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const j = JSON.parse(text) as { reason?: unknown; allow?: unknown };
    return {
      reason: typeof j.reason === "string" && j.reason ? j.reason : "held",
      allow: Array.isArray(j.allow) ? j.allow.filter((a): a is string => typeof a === "string") : [],
      source: file,
    };
  } catch {
    const lines = text.split("\n").map((l) => l.trim());
    const allowLine = lines.find((l) => /^allow(ed)?\s*:/i.test(l));
    return {
      reason: lines.find((l) => l && l !== allowLine) ?? "held",
      allow: allowLine ? allowLine.replace(/^allow(ed)?\s*:/i, "").split(/[\s,]+/).filter(Boolean) : [],
      source: file,
    };
  }
}

/** Reads hold files, re-reading one only when its mtime changes. */
export function holdReader(files: () => string[]): () => Hold | null {
  const cache = new Map<string, { mtime: number; hold: Hold | null }>();
  return () => {
    const holds: Hold[] = [];
    for (const f of files()) {
      let mtime: number;
      try {
        mtime = statSync(f).mtimeMs;
      } catch {
        cache.delete(f);
        continue;
      }
      let c = cache.get(f);
      if (!c || c.mtime !== mtime) {
        c = { mtime, hold: readHoldFile(f) };
        cache.set(f, c);
      }
      if (c.hold) holds.push(c.hold);
    }
    if (holds.length === 0) return null;
    // One Mac: any project's hold holds it; only an author every hold allows still goes.
    return {
      reason: holds.map((h) => h.reason).join("; "),
      allow: holds.reduce((acc, h) => acc.filter((a) => h.allow.includes(a)), holds[0]!.allow),
      source: holds.map((h) => h.source).join(", "),
    };
  };
}
