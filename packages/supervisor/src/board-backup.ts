import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BoardExportV1 } from "@bobnet/protocol";
import type { Logger } from "@bobnet/client/log";

// The board's nightly backup (ADR 0001 §11): the board's export, written to board.json in a git
// repository and committed. A backup and an exit route, never a second store: nothing reads it back
// but an import. A night when only exported_at would change commits nothing.

const FILE = "board.json";
const GIT_TIMEOUT_MS = 30_000;

export interface BoardBackupOptions {
  repo: string;
  /** HH:MM, this laptop's time. */
  at: string;
  /** GET /v1/board/export, as this laptop. */
  fetchExport: () => Promise<unknown>;
  log: Logger;
  now?: () => Date;
  git?: (args: string[], cwd: string) => Promise<string>;
}

const git = (args: string[], cwd: string) =>
  new Promise<string>((resolve, reject) =>
    execFile("git", args, { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS }, (err, out, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(out))),
  );

/** The next time it is `at` (HH:MM) after `now`, local time. */
export function nextRun(now: Date, at: string): Date {
  const [h, m] = at.split(":").map(Number) as [number, number];
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

export class BoardBackup {
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => Date;
  private readonly git: (args: string[], cwd: string) => Promise<string>;
  private readonly opts: BoardBackupOptions;

  constructor(opts: BoardBackupOptions) {
    this.opts = opts;
    this.now = opts.now ?? (() => new Date());
    this.git = opts.git ?? git;
  }

  start(): void {
    const wait = nextRun(this.now(), this.opts.at).getTime() - this.now().getTime();
    this.timer = setTimeout(() => {
      void this.run().finally(() => this.start());
    }, wait);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One backup: the commit it made, or null when the board hadn't changed or the backup failed (logged). */
  async run(): Promise<string | null> {
    const { repo, log } = this.opts;
    try {
      const parsed = BoardExportV1.safeParse(await this.opts.fetchExport());
      if (!parsed.success) throw new Error(`the export isn't a v1 board export: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      const doc = parsed.data;
      const path = join(repo, FILE);
      if (existsSync(path) && sameBoard(readFileSync(path, "utf8"), doc)) {
        log.info("board backup: unchanged", { repo });
        return null;
      }
      writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
      await this.git(["add", FILE], repo);
      await this.git(["commit", "--quiet", "-m", `board backup: ${doc.projects.length} projects through event ${doc.last_event_seq}`, "--", FILE], repo);
      const sha = (await this.git(["rev-parse", "HEAD"], repo)).trim();
      log.info("board backup: committed", { repo, sha, last_event_seq: doc.last_event_seq });
      return sha;
    } catch (err) {
      log.error("board backup failed", { repo, err: (err as Error).message });
      return null;
    }
  }
}

/** Whether a committed board.json holds this board, apart from when it was exported. */
function sameBoard(committed: string, doc: BoardExportV1): boolean {
  try {
    const old = JSON.parse(committed) as BoardExportV1;
    return JSON.stringify({ ...old, exported_at: "" }) === JSON.stringify({ ...doc, exported_at: "" });
  } catch {
    return false;
  }
}

/** GET /v1/board/export with this laptop's Access service token; `url` is the broker's socket URL. */
export function exportFetcher(url: string, credentials: { clientId: string; clientSecret: string }): () => Promise<unknown> {
  const target = new URL("/v1/board/export", url.replace(/^ws/, "http"));
  return async () => {
    const res = await fetch(target, { headers: { "CF-Access-Client-Id": credentials.clientId, "CF-Access-Client-Secret": credentials.clientSecret } });
    if (!res.ok) throw new Error(`GET ${target.pathname}: ${res.status}`);
    return res.json();
  };
}
