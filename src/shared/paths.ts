import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

const SUN_PATH_MAX = 103;

function uid(): number {
  const info = userInfo();
  return typeof info.uid === "number" && info.uid >= 0 ? info.uid : 0;
}

function preferredTmpDir(): string {
  const t = process.env["TMPDIR"] ?? tmpdir();
  return t.endsWith("/") ? t.slice(0, -1) : t;
}

function pickShortest(...candidates: string[]): string {
  for (const c of candidates) {
    if (Buffer.byteLength(c, "utf8") <= SUN_PATH_MAX) return c;
  }
  throw new Error(
    `bobnet-mcp: all candidate socket paths exceed ${SUN_PATH_MAX} bytes (macOS sun_path limit). ` +
      `Tried: ${candidates.join(", ")}`,
  );
}

export function socketPath(): string {
  const u = uid();
  return pickShortest(
    join(preferredTmpDir(), `bobnet-mcp-${u}.sock`),
    `/tmp/bobnet-mcp-${u}.sock`,
  );
}

export function lockPath(): string {
  const u = uid();
  return join(preferredTmpDir(), `bobnet-mcp-${u}.lock`);
}

export function logPath(): string {
  const u = uid();
  return join(preferredTmpDir(), `bobnet-mcp-${u}.log`);
}

export function assertSunPath(p: string): void {
  const len = Buffer.byteLength(p, "utf8");
  if (len > SUN_PATH_MAX) {
    throw new Error(
      `bobnet-mcp: socket path "${p}" is ${len} bytes; macOS sun_path limit is ${SUN_PATH_MAX}.`,
    );
  }
}
