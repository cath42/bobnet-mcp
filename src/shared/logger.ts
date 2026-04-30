import { createWriteStream, type WriteStream } from "node:fs";
import { nowIso } from "./time.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(extra: Record<string, unknown>): Logger;
  close(): void;
}

export interface LoggerOptions {
  to: "stderr" | { file: string };
  level?: LogLevel;
  base?: Record<string, unknown>;
}

export function createLogger(opts: LoggerOptions): Logger {
  const minRank = LEVEL_RANK[opts.level ?? "info"];
  const base = opts.base ?? {};
  let stream: WriteStream | NodeJS.WriteStream;
  let needsClose = false;

  if (opts.to === "stderr") {
    stream = process.stderr;
  } else {
    stream = createWriteStream(opts.to.file, { flags: "a" });
    needsClose = true;
  }

  function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < minRank) return;
    const record = {
      ts: nowIso(),
      level,
      msg,
      ...base,
      ...(fields ?? {}),
    };
    try {
      stream.write(JSON.stringify(record) + "\n");
    } catch {
      // best-effort; logging must not throw
    }
  }

  function child(extra: Record<string, unknown>): Logger {
    return wrap({ ...base, ...extra });
  }

  function wrap(b: Record<string, unknown>): Logger {
    return {
      debug: (m, f) => emitWith("debug", m, f, b),
      info: (m, f) => emitWith("info", m, f, b),
      warn: (m, f) => emitWith("warn", m, f, b),
      error: (m, f) => emitWith("error", m, f, b),
      child: (e) => wrap({ ...b, ...e }),
      close: () => {
        if (needsClose && "end" in stream) {
          (stream as WriteStream).end();
        }
      },
    };
  }

  function emitWith(
    level: LogLevel,
    msg: string,
    fields: Record<string, unknown> | undefined,
    b: Record<string, unknown>,
  ): void {
    if (LEVEL_RANK[level] < minRank) return;
    const record = {
      ts: nowIso(),
      level,
      msg,
      ...b,
      ...(fields ?? {}),
    };
    try {
      stream.write(JSON.stringify(record) + "\n");
    } catch {
      /* ignore */
    }
  }

  return wrap(base);
}
