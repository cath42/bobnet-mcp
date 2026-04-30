export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

export class FramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FramingError";
  }
}

export class LineFramer {
  private buf = "";
  private readonly maxBytes: number;

  constructor(maxBytes = MAX_FRAME_BYTES) {
    this.maxBytes = maxBytes;
  }

  feed(chunk: Buffer | string): unknown[] {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.buf += text;

    if (this.buf.length > this.maxBytes) {
      throw new FramingError(
        `frame buffer exceeded ${this.maxBytes} bytes without newline`,
      );
    }

    const out: unknown[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.length === 0) continue;
      out.push(parseLine(line));
    }
    return out;
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch (err) {
    throw new FramingError(
      `invalid JSON frame: ${(err as Error).message}; line=${truncate(line, 200)}`,
    );
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "...";
}

export function encode(obj: unknown): Buffer {
  const json = JSON.stringify(obj);
  if (json === undefined) {
    throw new FramingError("cannot encode value to JSON");
  }
  return Buffer.from(json + "\n", "utf8");
}
