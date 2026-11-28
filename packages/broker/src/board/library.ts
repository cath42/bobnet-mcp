import {
  LIBRARY_BLOB_MAX,
  LIBRARY_STANDARD,
  type BoardCaller,
  type BoardOp,
  type BoardResults,
  type LibraryIndex,
  type LibraryProblem,
  type LibraryRecord,
  type LibrarySummary,
} from "@bobnet/protocol";
import { BoardError } from "./errors.ts";

type Op<N extends BoardOp["op"]> = Extract<BoardOp, { op: N }>;

interface LibraryRow {
  project: number;
  ref: string;
  commit_sha: string;
  committed_at: string;
  github: string | null;
  index_json: string | null;
  laptop: string;
  checked_at: string;
  problems_json: string;
  [k: string]: SqlStorageValue;
}

/**
 * A project's library (ADR 0015 §2, 0017 §4): a cache of its main, kept by blob, never edited and never the record.
 * Only a supervisor that serves the project writes it; nothing else edits it, it is left out of the board's export,
 * and deleting both tables loses nothing: the next sync sends it all again. Its writes make no event.
 */
export class LibraryCache {
  constructor(
    private readonly sql: SqlStorage,
    private readonly now: () => number,
  ) {}

  /** One blob, once: its id was checked against its text before this (`Board.apply`, after `admitBlob`). */
  blob(caller: BoardCaller, project: { pk: number; key: string }, op: Op<"library_blob">): { stored: boolean } {
    const bytes = admitBlob(caller, op);
    const had = this.sql.exec("SELECT 1 FROM library_blobs WHERE project = ? AND blob = ?", project.pk, op.blob).toArray().length > 0;
    if (!had) this.sql.exec("INSERT INTO library_blobs (project, blob, text, bytes) VALUES (?, ?, ?, ?)", project.pk, op.blob, op.text, bytes);
    return { stored: !had };
  }

  /**
   * The library at a commit (0015 §1, §2). The newest `committed_at` is kept: an older commit, from a laptop that hasn't
   * fetched, or another commit of the same date, changes nothing; the same commit refreshes when it was checked, from where, and its problems (a failed
   * fetch). A new commit replaces it whole once every blob it names is here, and drops the blobs nothing names.
   * `changed`: whether an open page should read it again.
   */
  sync(caller: BoardCaller, project: { pk: number; key: string }, op: Op<"library_sync">): { stored: boolean; missing: string[]; changed: boolean } {
    servedBy(caller, project.key, "library");
    const laptop = caller.kind === "agent" ? caller.laptop : "";
    const at = new Date(this.now()).toISOString();
    const had = this.row(project.pk);
    const problems = JSON.stringify(op.problems);
    if (had && had.commit_sha === op.commit) {
      this.sql.exec("UPDATE libraries SET checked_at = ?, laptop = ?, problems_json = ? WHERE project = ?", at, laptop, problems, project.pk);
      return { stored: true, missing: [], changed: had.problems_json !== problems };
    }
    // An equal date keeps it too: two laptops on different commits of the same second don't replace each other every tick.
    if (had && Date.parse(had.committed_at) >= Date.parse(op.committed_at)) return { stored: false, missing: [], changed: false };
    const named = [...new Set((op.index?.files ?? []).filter((f) => !f.too_large).map((f) => f.blob))];
    const have = new Set(this.sql.exec<{ blob: string }>("SELECT blob FROM library_blobs WHERE project = ?", project.pk).toArray().map((b) => b.blob));
    const missing = named.filter((b) => !have.has(b));
    if (missing.length > 0) return { stored: false, missing, changed: false };
    this.sql.exec(
      `INSERT INTO libraries (project, ref, commit_sha, committed_at, github, index_json, laptop, checked_at, problems_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project) DO UPDATE SET ref = excluded.ref, commit_sha = excluded.commit_sha, committed_at = excluded.committed_at, github = excluded.github,
         index_json = excluded.index_json, laptop = excluded.laptop, checked_at = excluded.checked_at, problems_json = excluded.problems_json`,
      project.pk,
      op.ref,
      op.commit,
      op.committed_at,
      op.github,
      op.index === null ? null : JSON.stringify(op.index),
      laptop,
      at,
      problems,
    );
    const keep = new Set(named);
    for (const b of have) if (!keep.has(b)) this.sql.exec("DELETE FROM library_blobs WHERE project = ? AND blob = ?", project.pk, b);
    return { stored: true, missing: [], changed: true };
  }

  /** The `library` read (0015 §4): the row without texts, the standard, and the Board's clock for staleness (§5). */
  read(project: { pk: number; key: string }): BoardResults["library"] {
    const row = this.row(project.pk);
    return { library: row ? record(project.key, row) : null, standard: LIBRARY_STANDARD, now: new Date(this.now()).toISOString() };
  }

  /** The `library_page` read (0017 §4): a section's texts at the library's commit. A card section's one card, given its path. */
  page(project: { pk: number; key: string }, op: Op<"library_page">): BoardResults["library_page"] {
    const row = this.row(project.pk);
    if (!row) throw new BoardError("invalid", `${project.key} has no library yet`);
    const files = (parse<LibraryIndex>(row.index_json)?.files ?? []).filter((f) => f.section === op.section && (op.path === undefined || f.path === op.path));
    if (op.path !== undefined && files.length === 0) throw new BoardError("invalid", `${project.key}'s library has no ${op.path} in ${op.section}`);
    const out: Array<{ path: string; text: string }> = [];
    for (const f of files) {
      if (f.too_large) continue;
      const b = this.sql.exec<{ text: string }>("SELECT text FROM library_blobs WHERE project = ? AND blob = ?", project.pk, f.blob).toArray()[0];
      if (b) out.push({ path: f.path, text: b.text });
    }
    return { commit: row.commit_sha, files: out };
  }

  /** What the project menu and page offer (0015 §4): null when no laptop has sent a library. */
  summary(project: number): LibrarySummary | null {
    const row = this.row(project);
    if (!row) return null;
    const index = parse<LibraryIndex>(row.index_json);
    const head = index?.files.find((f) => f.section === "overview")?.head ?? null;
    const problems = parse<LibraryProblem[]>(row.problems_json) ?? [];
    return {
      commit: row.commit_sha,
      committed_at: row.committed_at,
      checked_at: row.checked_at,
      written: index !== null,
      title: head?.["title"] ?? null,
      tagline: head?.["tagline"] ?? null,
      problems: problems.filter((p) => p.kind === "standard").length,
    };
  }

  private row(project: number): LibraryRow | undefined {
    return this.sql.exec<LibraryRow>("SELECT * FROM libraries WHERE project = ?", project).toArray()[0];
  }
}

/**
 * Whether a blob may be kept, before anything costly is done with it: who sends it, then its size in UTF-8 bytes
 * (the schema's cap counts UTF-16 units). `Board.apply` calls it before it hashes the text. Its size in bytes.
 */
export function admitBlob(caller: BoardCaller, op: Op<"library_blob">): number {
  servedBy(caller, op.project, "library blob");
  const bytes = new TextEncoder().encode(op.text).byteLength;
  if (bytes > LIBRARY_BLOB_MAX) throw new BoardError("invalid", `The text is ${bytes} bytes, over the ${LIBRARY_BLOB_MAX} a library file may be`);
  return bytes;
}

/** A supervisor's, over its pinned connection, for a project it registered as one it serves (as `release_tag`). */
function servedBy(caller: BoardCaller, key: string, what: string): void {
  if (caller.kind !== "agent" || !caller.supervisor) throw new BoardError("forbidden", `A ${what} is sent by a laptop's supervisor, from its clone of the project`);
  if (!(caller.serves ?? []).includes(key)) {
    throw new BoardError("forbidden", `${caller.laptop}'s supervisor didn't register ${key} as a project it serves on the board, so it sends none of its library`);
  }
}

function record(project: string, r: LibraryRow): LibraryRecord {
  return {
    project,
    ref: r.ref,
    commit: r.commit_sha,
    committed_at: r.committed_at,
    checked_at: r.checked_at,
    laptop: r.laptop,
    github: r.github,
    index: parse<LibraryIndex>(r.index_json),
    problems: parse<LibraryProblem[]>(r.problems_json) ?? [],
  };
}

const parse = <T>(json: string | null): T | null => (json === null ? null : (JSON.parse(json) as T));
