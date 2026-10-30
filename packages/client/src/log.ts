// JSON lines on stderr; Claude Code captures an MCP server's stderr. Never
// pass credentials or message bodies to the logger.

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(debug = process.env["BOBNET_DEBUG"] === "1"): Logger {
  const write = (level: string) => (msg: string, fields: Record<string, unknown> = {}) => {
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + "\n");
  };
  return {
    debug: debug ? write("debug") : () => {},
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
  };
}
