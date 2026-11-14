import type { BoardErrorCode } from "@bobnet/protocol";

/** A refusal with its reason, answered to the caller as an `error` frame of its code. */
export class BoardError extends Error {
  constructor(
    readonly code: BoardErrorCode,
    message: string,
  ) {
    super(message);
  }
}
