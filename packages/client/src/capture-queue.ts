import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BoardCtx, BoardOpInput, BoardResults } from "@bobnet/protocol";
import { BrokerError } from "./connection.ts";

// Capture never waits (ADR 0001 §12). Each capture is a file on the laptop,
// named by a capture_id made here, written before it is sent. The board stores
// a capture_id once, so a file sent twice, by this process or another one
// flushing the same folder, is still one item. A file is removed once the board
// has it, and moved to refused/ if the board refuses it, so no capture is lost
// in silence.

/** What a capture says; the queue gives it its capture_id. */
export type CaptureInput = Omit<Extract<BoardOpInput, { op: "capture" }>, "op" | "capture_id">;
export type Captured = BoardResults["capture"];

/** How long a capture waits for the board's answer before it says queued. */
export const CAPTURE_ANSWER_MS = 2_000;

interface Queued {
  as: string;
  ctx?: BoardCtx;
  op: Extract<BoardOpInput, { op: "capture" }>;
  at: string;
}

/** Sends one queued capture as `as`; rejects with a BrokerError when the board can't take it now. */
export type CaptureSend = (as: string, op: Extract<BoardOpInput, { op: "capture" }>, ctx: BoardCtx | undefined, waitMs: number) => Promise<Captured>;

export type CaptureOutcome = (Captured & { capture_id: string; queued: false }) | { capture_id: string; queued: true; message: string };

/** Refusals that a later send won't change. */
const PERMANENT = new Set(["invalid", "forbidden", "conflict", "bad_frame", "frame_too_large", "secret_detected"]);

export function defaultCaptureDir(): string {
  const state = process.env["XDG_STATE_HOME"] || join(homedir(), ".local", "state");
  return join(state, "bobnet", "capture-queue");
}

export class CaptureQueue {
  private readonly flushing = new Set<string>();
  private readonly send: CaptureSend;
  private readonly opts: { dir?: string; answerMs?: number; onError?: (msg: string, detail: Record<string, unknown>) => void };

  constructor(send: CaptureSend, opts: CaptureQueue["opts"] = {}) {
    this.send = send;
    this.opts = opts;
  }

  get dir(): string {
    return this.opts.dir ?? defaultCaptureDir();
  }

  /** Writes the capture to the queue, sends it, and answers with its id if the board does within two seconds. */
  async capture(as: string, input: CaptureInput, ctx?: BoardCtx): Promise<CaptureOutcome> {
    const capture_id = randomUUID();
    const q: Queued = { as, ...(ctx ? { ctx } : {}), op: { ...input, op: "capture", capture_id }, at: new Date().toISOString() };
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, `${capture_id}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(q));
    renameSync(`${file}.tmp`, file);

    const answerMs = this.opts.answerMs ?? CAPTURE_ANSWER_MS;
    const sent = this.sendFile(file, q, answerMs);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), answerMs).unref());
    const result = await Promise.race([sent, timeout]);
    if (result && "ref" in result) return { ...result, capture_id, queued: false };
    if (result && "refused" in result) throw new BrokerError(result.code, result.message);
    return { capture_id, queued: true, message: "queued; it gets its id when the board is back" };
  }

  /**
   * Sends every queued capture made as a name this process hosts (on connect, and now and then).
   * One made as a name it doesn't host waits for that name's process.
   */
  async flush(hosts: (name: string) => boolean): Promise<{ sent: number; kept: number }> {
    let names: string[];
    try {
      names = readdirSync(this.dir).filter((n) => n.endsWith(".json"));
    } catch {
      return { sent: 0, kept: 0 };
    }
    let sent = 0;
    let kept = 0;
    for (const name of names.sort((a, b) => mtime(join(this.dir, a)) - mtime(join(this.dir, b)))) {
      const file = join(this.dir, name);
      let q: Queued;
      try {
        q = JSON.parse(readFileSync(file, "utf8")) as Queued;
      } catch {
        continue; // removed meanwhile, or another process is still writing it
      }
      if (!hosts(q.as)) {
        kept++;
        continue;
      }
      const r = await this.sendFile(file, q, 0);
      if (r && "ref" in r) sent++;
      else kept++;
    }
    return { sent, kept };
  }

  /** One send. The file goes once the board has it, or to refused/ if the board refuses it; it stays if the board is away. */
  private async sendFile(file: string, q: Queued, waitMs: number): Promise<Captured | { refused: true; code: BrokerError["code"]; message: string } | null> {
    if (this.flushing.has(file)) return null;
    this.flushing.add(file);
    try {
      const result = await this.send(q.as, q.op, q.ctx, waitMs);
      rm(file);
      return result;
    } catch (err) {
      if (err instanceof BrokerError && PERMANENT.has(err.code)) {
        const refused = join(this.dir, "refused");
        mkdirSync(refused, { recursive: true });
        try {
          writeFileSync(join(refused, `${q.op.capture_id}.json`), JSON.stringify({ ...q, refused: { code: err.code, message: err.message } }));
          rm(file);
        } catch {
          // Kept in the queue; the next flush tries again.
        }
        this.opts.onError?.("capture refused by the board", { capture_id: q.op.capture_id, code: err.code, message: err.message });
        return { refused: true, code: err.code, message: err.message };
      }
      return null;
    } finally {
      this.flushing.delete(file);
    }
  }
}

function mtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function rm(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // Already gone: another process flushed it.
  }
}
