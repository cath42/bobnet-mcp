import { BOARD_READS, BoardOp, gitBlobId, type BoardCaller, type BoardReadName, type BoardExportV1, type BoardImportReply, type BoardReply } from "@bobnet/protocol";
import { DurableObject } from "cloudflare:workers";
import { migrate } from "../schema.ts";
import { BoardError } from "./errors.ts";
import { exportBoard, importBoard, type Reader } from "./export.ts";
import { BOARD_MIGRATIONS } from "./schema.ts";
import { admitBlob } from "./library.ts";
import { BoardStore, type NoticeRow } from "./store.ts";

/**
 * Every project's board (ADR 0001 §1): its own Durable Object, so it restores
 * on its own and its reads don't queue messages. Only the broker calls it, with
 * the caller it verified; it answers the result and what changed. An answer's
 * messages are notice rows in its transaction, which the broker drains and sends
 * (ADR 0009 §1), as are a fix's and a stale row's (ADR 0011 §4).
 */
export class Board extends DurableObject<Env> {
  private readonly store: BoardStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("PRAGMA foreign_keys = ON");
    ctx.storage.transactionSync(() => migrate(sql, BOARD_MIGRATIONS));
    this.store = new BoardStore(sql);
  }

  /**
   * One operation. A write and its events commit together, or not at all. A write with a `key` is made
   * once per key: its repeat answers the first reply (§12).
   */
  async apply(caller: BoardCaller, input: unknown, key?: string): Promise<BoardReply> {
    const parsed = BoardOp.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid operation" };
    const op = parsed.data;
    // A library's blob is main's bytes, provably (ADR 0015 §2): its id is git's own for its text. Hashed only once its
    // sender may send it and its bytes fit.
    if (op.op === "library_blob") {
      try {
        admitBlob(caller, op);
      } catch (err) {
        if (err instanceof BoardError) return { ok: false, code: err.code, message: err.message };
        throw err;
      }
      if ((await gitBlobId(op.text)) !== op.blob) return { ok: false, code: "invalid", message: `The text isn't blob ${op.blob}: its git id differs` };
    }
    return this.answer(op.op, () => {
      if (isRead(op)) return { ok: true, result: this.store.read(caller, op), changed: null };
      const { result, changed } = this.ctx.storage.transactionSync(() =>
        key === undefined ? this.store.write(caller, op) : this.store.writeOnce(caller, op, key),
      );
      return { ok: true, result, changed };
    });
  }

  /** A CI run's start or end (§10), for POST /v1/runs: `source` is the CI token's, never the body's. */
  async reportCi(source: string, input: unknown): Promise<BoardReply> {
    const parsed = BoardOp.safeParse(typeof input === "object" && input !== null ? { ...input, op: "ci_run" } : input);
    if (!parsed.success) return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid run" };
    const op = parsed.data;
    if (op.op !== "ci_run") return { ok: false, code: "invalid", message: "Invalid run" };
    return this.answer(op.op, () => {
      const { result, changed } = this.ctx.storage.transactionSync(() => this.store.ciRun(source, op));
      return { ok: true, result, changed };
    });
  }

  /** The answers' notices the broker hasn't taken yet, oldest first, 50 at most (ADR 0009 §1). */
  async notices(): Promise<NoticeRow[]> {
    return this.store.notices();
  }

  /** Marks notices taken once the broker has stored their messages; taken ones go after 30 days. */
  async noticesTaken(seqs: number[]): Promise<void> {
    this.ctx.storage.transactionSync(() => this.store.noticesTaken(seqs));
  }

  /**
   * Tells the owners of rows a day unchanged on Waits, once a day each, as notices for the broker to
   * drain (ADR 0011 §2); the alarm calls it hourly. The rows flagged, and those with no owner to tell.
   */
  async flagStale(): Promise<ReturnType<BoardStore["flagStale"]>> {
    return this.ctx.storage.transactionSync(() => this.store.flagStale());
  }

  /** Runs one operation, answering a refusal or a bug as a reply. */
  private answer(name: string, run: () => BoardReply): BoardReply {
    try {
      return run();
    } catch (err) {
      if (err instanceof BoardError) return { ok: false, code: err.code, message: err.message };
      // The schema is the backstop for a link or a value the operation layer let through.
      const message = err instanceof Error ? err.message : String(err);
      if (/constraint failed/i.test(message)) return { ok: false, code: "invalid", message: `Refused by the board's schema: ${message}` };
      // A bug here is not an outage: answered as such, so no agent retries it for a minute.
      console.error("board error", { op: name, err: message });
      return { ok: false, code: "invalid", message: `Board error: ${message}` };
    }
  }

  /** The board as one document (§11), as far as `by` may read it, for GET /v1/board/export. */
  async exportBoard(by: Reader): Promise<BoardExportV1> {
    return exportBoard(this.ctx.storage.sql, by);
  }

  /** A document's projects into the board, all or nothing (§11), for POST /v1/board/import. */
  async importBoard(by: Reader, doc: unknown): Promise<BoardImportReply> {
    try {
      return this.ctx.storage.transactionSync(() => importBoard(this.ctx.storage.sql, by, doc));
    } catch (err) {
      if (err instanceof BoardError) return { ok: false, code: err.code === "unavailable" ? "invalid" : err.code, message: err.message };
      const message = err instanceof Error ? err.message : String(err);
      if (!/constraint failed/i.test(message)) console.error("board import error", { err: message });
      return { ok: false, code: "invalid", message: `Refused by the board's schema: ${message}` };
    }
  }
}

function isRead(op: BoardOp): op is Extract<BoardOp, { op: BoardReadName }> {
  return BOARD_READS.includes(op.op);
}
