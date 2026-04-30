export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  NotRegistered: -32000,
  NameInUse: -32001,
  UnknownPeer: -32002,
  InvalidName: -32003,
  ProtocolVersionMismatch: -32004,
  AlreadyRegistered: -32005,
  NotHandshaken: -32006,
} as const;

export type ErrorCodeName = keyof typeof ErrorCode;
export type ErrorCodeValue = (typeof ErrorCode)[ErrorCodeName];

export interface RpcErrorData {
  user_message: string;
  [k: string]: unknown;
}

export class RpcError extends Error {
  public readonly code: number;
  public readonly data: RpcErrorData;

  constructor(code: number, userMessage: string, extra: Record<string, unknown> = {}) {
    super(userMessage);
    this.name = "RpcError";
    this.code = code;
    this.data = { user_message: userMessage, ...extra };
  }

  toJsonRpcError(): { code: number; message: string; data: RpcErrorData } {
    return { code: this.code, message: this.message, data: this.data };
  }
}
