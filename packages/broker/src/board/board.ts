import { BOARD_READS, BoardOp, type BoardCaller, type BoardReply } from "@bobnet/protocol";
import { DurableObject } from "cloudflare:workers";
import { migrate } from "../schema.ts";
import { BoardError } from "./errors.ts";
import { BOARD_MIGRATIONS } from "./schema.ts";
import { BoardStore } from "./store.ts";

/**
 * Every project's board (ADR 0001 §1): its own Durable Object, so it restores
 * on its own and its reads don't queue messages. Only the broker calls it, with
 * the caller it verified; it answers the result and what changed, and the
 * broker does the sending.
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

  /** One operation. A write and its events commit together, or not at all. */
  async apply(caller: BoardCaller, input: unknown): Promise<BoardReply> {
    const parsed = BoardOp.safeParse(input);
    if (!parsed.success) return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid operation" };
    const op = parsed.data;
    try {
      if (isRead(op)) return { ok: true, result: this.store.read(caller, op), changed: null };
      const { result, changed } = this.ctx.storage.transactionSync(() => this.store.write(caller, op));
      return { ok: true, result, changed };
    } catch (err) {
      if (err instanceof BoardError) return { ok: false, code: err.code, message: err.message };
      // The schema is the backstop for a link or a value the operation layer let through.
      const message = err instanceof Error ? err.message : String(err);
      if (/constraint failed/i.test(message)) return { ok: false, code: "invalid", message: `Refused by the board's schema: ${message}` };
      // A bug here is not an outage: answered as such, so no agent retries it for a minute.
      console.error("board error", { op: op.op, err: message });
      return { ok: false, code: "invalid", message: `Board error: ${message}` };
    }
  }
}

function isRead(op: BoardOp): op is Extract<BoardOp, { op: "projects" | "list" | "get" | "grants" }> {
  return BOARD_READS.includes(op.op);
}
