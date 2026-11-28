import { checkLibrary, LIBRARY_BLOB_MAX, type BoardOpInput, type BoardResults, type LibraryIndex, type LibraryProblem } from "@bobnet/protocol";
import type { Logger } from "@bobnet/client/log";
import { catFiles, exec as run, type Exec } from "./board.ts";
import { repoName } from "./ci-poll.ts";
import type { ProjectConfig } from "./config.ts";

// A project's library (ADR 0015 §1, 0017 §4): the supervisor reads `library/` from its clone's ref and sends it to the
// Board as blobs and an index, with the clone's own remote and no new credential. The broker never reaches GitHub.

/** How often each service project's library is read (0015 §1), beside the CI poll. */
export const LIBRARY_SYNC_MS = 10 * 60_000;
/** An unchanged library is sent again this often, alone, so the page knows how old the check is (0015 §5). */
export const LIBRARY_HEARTBEAT_MS = 60 * 60_000;

/** What a read of the clone found: the library op, and the texts of the blobs it names. */
export interface LibraryRead {
  op: BoardOpInput & { op: "library_sync" };
  texts: Map<string, string>;
}

/** The ref a project's library is read at: the rebase target, else origin/main, as its backlog was (0015 §1). */
export function libraryRef(p: ProjectConfig): { remote: string; branch: string } {
  return p.rebase ?? { remote: "origin", branch: "main" };
}

/** `https://github.com/<owner>/<name>` for a GitHub remote; null for any other (0015 §3). */
export function githubOf(url: string): string | null {
  if (!/github\.com[/:]/i.test(url)) return null;
  const name = repoName(url);
  return name ? `https://github.com/${name}` : null;
}

/**
 * Reads the library at the project's ref (0015 §1, 0017 §4): fetches it (unless `fetch` is false: after a land's push
 * the ref has already moved), lists `library/` with `ls-tree`, reads the files the standard names, and checks them.
 * A failed fetch isn't fatal: the last commit the clone has is read, with a `fetch_failed` problem.
 */
export async function readLibrary(p: ProjectConfig, opts: { fetch: boolean; exec?: Exec; now?: () => Date }): Promise<LibraryRead> {
  const exec = opts.exec ?? run;
  const git = (...args: string[]) => exec("git", args, p.path);
  const { remote, branch } = libraryRef(p);
  const ref = `${remote}/${branch}`;
  const problems: LibraryProblem[] = [];
  if (opts.fetch) {
    try {
      await git("fetch", "-q", remote, branch);
    } catch (err) {
      const message = (err as Error).message.split("\n").find((l) => /fatal|error/i.test(l)) ?? (err as Error).message;
      problems.push({ kind: "fetch_failed", at: (opts.now?.() ?? new Date()).toISOString(), message: `git fetch ${remote} ${branch}: ${message.trim()}`.slice(0, 500) });
    }
  }
  const commit = (await git("rev-parse", "--verify", `${ref}^{commit}`)).trim();
  const committed_at = (await git("log", "-1", "--format=%cI", commit)).trim();
  let github: string | null = null;
  try {
    github = githubOf((await git("remote", "get-url", remote)).trim());
  } catch {
    // no such remote: no GitHub links
  }

  // `<mode> <type> <blob> <size>\t<path>`, sizes in bytes.
  const listed = (await git("ls-tree", "-r", "-l", "-z", commit, "--", "library/"))
    .split("\0")
    .filter(Boolean)
    .map((l) => {
      const [meta, path] = l.split("\t") as [string, string];
      const [, type, blob, size] = meta.split(/\s+/) as [string, string, string, string];
      return { path, type, blob, bytes: Number(size) };
    })
    .filter((f) => f.type === "blob" && f.path.startsWith("library/"));
  if (listed.length === 0) {
    return { op: { op: "library_sync", project: p.key, ref, commit, committed_at, github, index: null, problems }, texts: new Map() };
  }

  // The texts of what the standard names and may send; nothing else is read (0017 §4).
  const first = checkLibrary(listed.map((f) => ({ path: f.path, bytes: f.bytes })));
  const wanted = listed.filter((f) => first.files.some((x) => x.path === f.path && !x.too_large) && f.bytes <= LIBRARY_BLOB_MAX);
  const texts = await catFiles(p.path, wanted.map((f) => f.blob));
  const textOf = new Map<string, string>();
  // A file that isn't UTF-8 text can't cross as text with its blob id: it is left out, a problem.
  const unreadable = new Set<string>();
  wanted.forEach((f, i) => (Buffer.byteLength(texts[i]!) === f.bytes && !texts[i]!.includes("\uFFFD") ? textOf.set(f.path, texts[i]!) : unreadable.add(f.path)));
  const kept = listed.filter((f) => !unreadable.has(f.path));
  const checked = checkLibrary(kept.map((f) => ({ path: f.path, bytes: f.bytes, ...(textOf.has(f.path) ? { text: textOf.get(f.path)! } : {}) })));
  for (const path of unreadable) checked.problems.push({ kind: "standard", path, message: "it isn't UTF-8 text, so it isn't shown" });

  const changed = await lastChanges(git, commit);
  const blobOf = new Map(kept.map((f) => [f.path, f.blob]));
  const files: LibraryIndex["files"] = checked.files.map((f) => ({
    ...f,
    blob: blobOf.get(f.path)!,
    changed: changed.get(f.path) ?? { sha: commit.slice(0, 7), date: committed_at },
  }));
  const send = new Map<string, string>();
  for (const f of files) if (!f.too_large && textOf.has(f.path)) send.set(f.blob, textOf.get(f.path)!);
  return {
    op: { op: "library_sync", project: p.key, ref, commit, committed_at, github, index: { standard: 1, files }, problems: [...problems, ...checked.problems].slice(0, 200) },
    texts: send,
  };
}

/** Each file's last change at or before `commit`, from one `git log` of `library/`: its short sha and its date. */
async function lastChanges(git: (...a: string[]) => Promise<string>, commit: string): Promise<Map<string, { sha: string; date: string }>> {
  const out = new Map<string, { sha: string; date: string }>();
  let at: { sha: string; date: string } | null = null;
  for (const line of (await git("log", "--format=@@%h %cI", "--name-only", commit, "--", "library/")).split("\n")) {
    if (line.startsWith("@@")) {
      const [sha, date] = line.slice(2).split(" ") as [string, string];
      at = { sha, date };
    } else if (line && at && !out.has(line)) out.set(line, at);
  }
  return out;
}

/** Makes a library op on the Board: its answer, or an error with the broker's code. */
export interface LibrarySend {
  (op: BoardOpInput & { op: "library_blob" }): Promise<BoardResults["library_blob"]>;
  (op: BoardOpInput & { op: "library_sync" }): Promise<BoardResults["library_sync"]>;
}

interface Sent {
  /** The blobs the Board has had from here since this start. */
  blobs: Set<string>;
  /** The last library op sent and kept, and when. */
  last: string | null;
  at: number;
}

/**
 * Sends the service projects' libraries (0015 §1): directly, the reply awaited, never through the outbox; a failed
 * send is simply tried again at the next tick. A blob goes once per start; an unchanged library goes again only as
 * the hourly heartbeat; a `missing` answer clears what it thought the Board had, and sends it all again.
 */
export class LibrarySync {
  private readonly sent = new Map<string, Sent>();
  private readonly running = new Map<string, Promise<void>>();
  private refused = false;

  private readonly deps: { log: Logger; send: LibrarySend; exec?: Exec; now?: () => number };

  constructor(deps: { log: Logger; send: LibrarySend; exec?: Exec; now?: () => number }) {
    this.deps = deps;
  }

  /** Resolves once no sync is running. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running.values()]);
  }

  /** Every project, one after the other. */
  async syncAll(projects: ProjectConfig[], fetch = true): Promise<void> {
    for (const p of projects) await this.sync(p, fetch);
  }

  /** One project; a sync already running for it is waited for, not doubled. */
  async sync(p: ProjectConfig, fetch = true): Promise<void> {
    const running = this.running.get(p.key);
    if (running) return running;
    const job = this.syncOnce(p, fetch).finally(() => this.running.delete(p.key));
    this.running.set(p.key, job);
    return job;
  }

  private async syncOnce(p: ProjectConfig, fetch: boolean): Promise<void> {
    const now = this.deps.now ?? Date.now;
    let read: LibraryRead;
    try {
      read = await readLibrary(p, { fetch, ...(this.deps.exec ? { exec: this.deps.exec } : {}), now: () => new Date(now()) });
    } catch (err) {
      this.deps.log.warn("couldn't read the project's library", { project: p.key, err: (err as Error).message });
      return;
    }
    const state = this.sent.get(p.key) ?? { blobs: new Set<string>(), last: null, at: 0 };
    this.sent.set(p.key, state);
    const key = JSON.stringify(read.op);
    if (state.last === key && now() - state.at < LIBRARY_HEARTBEAT_MS) return;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        for (const [blob, text] of read.texts) {
          if (state.blobs.has(blob)) continue;
          await this.deps.send({ op: "library_blob", project: p.key, blob, text });
          state.blobs.add(blob);
        }
        const r = await this.deps.send(read.op);
        if (r.missing.length === 0) {
          state.last = key;
          state.at = now();
          return;
        }
        // Another laptop's newer library dropped what this one thought was there (0015 §1).
        state.blobs.clear();
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      // An older broker doesn't know the ops: said once per start, and tried again at the tick (0015 §4).
      if (code === "invalid" && !this.refused) {
        this.refused = true;
        this.deps.log.warn("the broker refused the library; it may predate libraries", { project: p.key, err: (err as Error).message });
      } else if (code !== "invalid") {
        this.deps.log.info("the library wasn't sent; trying again at the next tick", { project: p.key, err: (err as Error).message });
      }
    }
  }
}
