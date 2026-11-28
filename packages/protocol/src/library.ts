import { z } from "zod";

// A project's library (ADR 0015, 0017): seven sections, each one file or folder under `library/` on main, the same in
// every repo. The supervisor reads it from its clone and sends the files as blobs and an index of them; the Board keeps
// them as a cache; the page draws them. This is the standard as code: what both the supervisor and the page read.

export const LibrarySectionId = z.enum(["overview", "architecture", "data", "decisions", "usecases", "ux", "glossary"]);
export type LibrarySectionId = z.infer<typeof LibrarySectionId>;

/** A front matter value's rule (ADR 0017 §2): one of a list, a date, card numbers, names, a URL, quoted words, or text. */
export type FrontMatterRule =
  | { kind: "one_of"; values: readonly string[] }
  | { kind: "date" }
  | { kind: "numbers" }
  | { kind: "names" }
  | { kind: "url" }
  | { kind: "quoted" }
  | { kind: "text" };

export interface FrontMatterKey {
  key: string;
  required: boolean;
  rule: FrontMatterRule;
}

/** Who owns a section, as the overview's front matter names them (ADR 0017 §6). */
export type LibraryOwnerKey = "product-owner" | "architect" | "designer";

export interface LibrarySection {
  id: LibrarySectionId;
  label: string;
  /** A file, or a folder ending in `/`, under `library/`. */
  path: string;
  /** The owner's role, and the overview's key that names them. */
  role: string;
  owner: LibraryOwnerKey;
  /** A card section's front matter keys, and the overview's; none for the others. */
  front?: readonly FrontMatterKey[];
  /** The fixed `## ` headings, in order. */
  headings?: readonly string[];
  /** A card section's card, in the page's words: "Decision 0003". */
  card?: string;
}

const text: FrontMatterRule = { kind: "text" };
const date: FrontMatterRule = { kind: "date" };
const key = (k: string, required: boolean, rule: FrontMatterRule): FrontMatterKey => ({ key: k, required, rule });

/** ADR 0017 §1, §2, §6: the sections in their order, their paths and owners, and the cards' rules. */
export const LIBRARY_STANDARD = {
  version: 1,
  guide: "architecture/library-standard.md",
  sections: [
    {
      id: "overview",
      label: "Overview",
      path: "library/overview.md",
      role: "product owner",
      owner: "product-owner",
      front: [key("title", true, text), key("tagline", false, text), key("product-owner", false, text), key("architect", false, text), key("designer", false, text)],
      headings: ["Goals", "Stakeholders", "Scope", "Constraints", "Quality goals"],
    },
    { id: "architecture", label: "Architecture", path: "library/architecture/", role: "architect", owner: "architect" },
    { id: "data", label: "Data model", path: "library/data-model.dbml", role: "architect", owner: "architect" },
    {
      id: "decisions",
      label: "Decisions",
      path: "library/decisions/",
      role: "architect",
      owner: "architect",
      card: "Decision",
      front: [
        key("status", true, { kind: "one_of", values: ["proposed", "accepted", "rejected", "deprecated", "superseded"] }),
        key("date", true, date),
        key("decision-makers", false, { kind: "names" }),
        key("supersedes", false, { kind: "numbers" }),
        key("feature", false, text),
      ],
      headings: ["Context", "Options", "Decision", "Consequences"],
    },
    {
      id: "usecases",
      label: "Use cases",
      path: "library/usecases/",
      role: "product owner",
      owner: "product-owner",
      card: "Use case",
      front: [
        key("status", true, { kind: "one_of", values: ["draft", "agreed", "built", "retired"] }),
        key("actor", true, text),
        key("date", true, date),
        key("feature", false, text),
      ],
      headings: ["Goal", "Preconditions", "Main scenario", "Extensions", "Acceptance"],
    },
    {
      id: "ux",
      label: "UX design",
      path: "library/ux/",
      role: "designer",
      owner: "designer",
      card: "UX card",
      front: [
        key("status", true, { kind: "one_of", values: ["draft", "in review", "approved", "changes asked", "built"] }),
        key("date", true, date),
        key("feature", false, text),
        key("use-cases", false, { kind: "numbers" }),
        key("prototype", false, { kind: "url" }),
        key("verdict", false, { kind: "quoted" }),
        key("verdict-date", false, date),
      ],
      headings: ["Purpose", "Screens", "States", "Open questions"],
    },
    { id: "glossary", label: "Glossary", path: "library/glossary.md", role: "product owner", owner: "product-owner" },
  ] as const satisfies readonly LibrarySection[],
} as const;

export const librarySection = (id: LibrarySectionId): LibrarySection => LIBRARY_STANDARD.sections.find((s) => s.id === id)!;

// ---------- Limits (0015 §2, 0017 §4) ----------

/** A file over this many bytes isn't sent: it shows as too large, with its GitHub link. */
export const LIBRARY_BLOB_MAX = 512 * 1024;
/** The architecture's `.c4` files: at most this many, and this many bytes together. */
export const LIBRARY_C4_FILES_MAX = 64;
export const LIBRARY_C4_BYTES_MAX = 512 * 1024;
/** Cards, over the three card sections. */
export const LIBRARY_CARDS_MAX = 200;
/** Every file the index may list: the cards, the `.c4` files and the three single files. */
export const LIBRARY_FILES_MAX = LIBRARY_CARDS_MAX + LIBRARY_C4_FILES_MAX + 3;
export const LIBRARY_PROBLEMS_MAX = 200;
export const LIBRARY_TITLE_MAX = 300;
export const LIBRARY_VALUE_MAX = 1000;
const MESSAGE_MAX = 500;

// ---------- The wire: index and problems (0017 §4) ----------

export const LibraryPath = z.string().min(9).max(300).regex(/^library\/[^\0]*[^/]$/);
const gitSha = z.string().regex(/^[0-9a-f]{40}$/);
const shortSha = z.string().regex(/^[0-9a-f]{4,40}$/);
const iso = z.string().datetime({ offset: true });

/** One file of the standard's, at the library's commit. `head`: the front matter, as strings, of the overview and the cards. */
export const LibraryFile = z.object({
  path: LibraryPath,
  section: LibrarySectionId,
  /** Its git blob id: sha1("blob <bytes>\0" + bytes). */
  blob: gitSha,
  bytes: z.number().int().nonnegative(),
  /** Its last change at or before the library's commit. */
  changed: z.object({ sha: shortSha, date: iso }),
  /** A Markdown file's first `# ` line. */
  title: z.string().max(LIBRARY_TITLE_MAX).nullable().optional(),
  head: z.record(z.string().max(60), z.string().max(LIBRARY_VALUE_MAX)).nullable().optional(),
  /** Over a limit: not sent, so it shows as too large and links to GitHub. */
  too_large: z.literal(true).optional(),
});
export type LibraryFile = z.infer<typeof LibraryFile>;

export const LibraryIndex = z.object({ standard: z.literal(1), files: z.array(LibraryFile).max(LIBRARY_FILES_MAX) });
export type LibraryIndex = z.infer<typeof LibraryIndex>;

/**
 * What is wrong, never fatal (0017 §4, 0015 §1): a file that breaks the standard, by line where it has one; a file or a
 * section over a limit; and a fetch that failed, when the library is the last commit the laptop had.
 */
export const LibraryProblem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("standard"), path: z.string().min(1).max(300), line: z.number().int().positive().optional(), message: z.string().max(MESSAGE_MAX) }),
  z.object({ kind: z.literal("too_large"), path: z.string().min(1).max(300), message: z.string().max(MESSAGE_MAX) }),
  z.object({ kind: z.literal("fetch_failed"), at: iso, message: z.string().max(MESSAGE_MAX) }),
]);
export type LibraryProblem = z.infer<typeof LibraryProblem>;

/** git's own id of a blob, which the Board checks a sent text against (0015 §2). */
export async function gitBlobId(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const all = new Uint8Array(head.byteLength + bytes.byteLength);
  all.set(head);
  all.set(bytes, head.byteLength);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Reading the standard ----------

/** Where a path under `library/` belongs: a section, an image (sent nowhere, not a problem), or nothing (a problem). */
export function librarySectionOf(path: string): LibrarySectionId | "image" | null {
  if (path === "library/overview.md") return "overview";
  if (path === "library/data-model.dbml") return "data";
  if (path === "library/glossary.md") return "glossary";
  if (/^library\/architecture\/[^/]+\.c4$/.test(path)) return "architecture";
  if (path.startsWith("library/ux/images/")) return "image";
  const card = /^library\/(decisions|usecases|ux)\/[^/]+\.md$/.exec(path);
  if (card && CARD_NAME.test(path.slice(path.lastIndexOf("/") + 1))) return card[1] as LibrarySectionId;
  return null;
}

/** A card's file name: four digits from 0001, then a slug of lowercase words and hyphens. */
const CARD_NAME = /^(?!0000)\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$/;
/** A card's number, from its path. */
export const cardNumber = (path: string): string | null => /\/(\d{4})-[^/]*$/.exec(path)?.[1] ?? null;

export interface LineProblem {
  line?: number;
  message: string;
}

export interface FrontMatter {
  /** The values as strings: a quoted one without its quotes, a list as written, `[a, b]`. */
  head: Record<string, string>;
  /** The first `# ` line after it. */
  title: string | null;
  /** The front matter's syntax, and, given a section, its keys and headings against the standard. */
  problems: LineProblem[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIST = /^\[(.*)\]$/;

const oneOfWords = (values: readonly string[]) => (values.length < 2 ? values.join("") : `${values.slice(0, -1).join(", ")} or ${values.at(-1)}`);

function valueProblem(k: FrontMatterKey, raw: string, value: string): string | null {
  const r = k.rule;
  switch (r.kind) {
    case "one_of":
      return r.values.includes(value) ? null : `${k.key} is "${value}": it is one of ${oneOfWords(r.values)}`;
    case "date":
      return DATE.test(value) && !Number.isNaN(Date.parse(value)) ? null : `${k.key} is "${value}": a date is YYYY-MM-DD`;
    case "numbers": {
      const m = LIST.exec(raw);
      if (!m) return `${k.key} is "${value}": it is a list of card numbers, [0001, 0002]`;
      const items = m[1]!.split(",").map((x) => x.trim()).filter(Boolean);
      return items.every((x) => /^\d{4}$/.test(x)) ? null : `${k.key} is "${value}": each card number is four digits, [0001, 0002]`;
    }
    case "names":
      return LIST.test(raw) ? null : `${k.key} is "${value}": it is a list, [name, name]`;
    case "url":
      return /^https?:\/\/\S+$/.test(value) ? null : `${k.key} is "${value}": it is a web address, https://…`;
    case "quoted":
      return /^".*"$/.test(raw) ? null : `${k.key} is someone's words: put them in "quotes"`;
    case "text":
      return value.trim() ? null : `${k.key} is empty`;
  }
}

/** Markdown's `#`/`##` lines outside fenced code, with their 1-based line numbers. */
function headingLines(lines: string[], from: number): Array<{ level: number; text: string; line: number }> {
  const out: Array<{ level: number; text: string; line: number }> = [];
  let fence: string | null = null;
  for (let i = from; i < lines.length; i++) {
    const l = lines[i]!;
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
    if (f) {
      if (fence === null) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = /^(#{1,2}) +(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push({ level: m[1]!.length, text: m[2]!, line: i + 1 });
  }
  return out;
}

/**
 * The front matter of a Markdown file (0017 §2): `---` lines around `key: value` lines at its top. Given a section with
 * keys and headings (the overview and the cards), it also checks them: a key missing, unknown or with a value outside
 * its rule, and a fixed heading missing or out of order. Problems never stop the read: what is readable is returned.
 */
export function readFrontMatter(source: string, section?: LibrarySectionId): FrontMatter {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const head: Record<string, string> = {};
  const raws = new Map<string, { raw: string; line: number }>();
  const problems: LineProblem[] = [];
  let body = 0;
  if (lines[0]?.trim() === "---") {
    let i = 1;
    for (; i < lines.length && lines[i]!.trim() !== "---"; i++) {
      const l = lines[i]!;
      if (!l.trim()) continue;
      const m = /^([a-z][a-z0-9-]*):[ \t]*(.*?)\s*$/.exec(l);
      if (!m) {
        problems.push({ line: i + 1, message: "not a key: value line: a value is one line, nothing nested" });
        continue;
      }
      const [, k, raw] = m as unknown as [string, string, string];
      if (raws.has(k)) problems.push({ line: i + 1, message: `${k} is set twice` });
      const quoted = /^"(.*)"$/.exec(raw);
      head[k] = (quoted ? quoted[1]! : raw).slice(0, LIBRARY_VALUE_MAX);
      raws.set(k, { raw, line: i + 1 });
    }
    if (i >= lines.length) problems.push({ line: 1, message: "the front matter has no closing --- line" });
    body = Math.min(i + 1, lines.length);
  }
  const hs = headingLines(lines, body);
  const title = hs.find((h) => h.level === 1)?.text.slice(0, LIBRARY_TITLE_MAX) ?? null;

  const spec = section ? librarySection(section) : undefined;
  if (spec?.front) {
    if (body === 0) problems.push({ line: 1, message: "it has no front matter: --- lines around key: value lines, at the top" });
    else {
      for (const k of spec.front) if (k.required && !raws.has(k.key)) problems.push({ line: 1, message: `${k.key} is missing: ${spec.card ? `a ${spec.card.toLowerCase()}` : "the overview"} needs it` });
      for (const [k, { raw, line }] of raws) {
        const rule = spec.front.find((x) => x.key === k);
        if (!rule) {
          problems.push({ line, message: `${k} isn't one of the standard's keys: ${spec.front.map((x) => x.key).join(", ")}` });
          continue;
        }
        const bad = valueProblem(rule, raw, head[k]!);
        if (bad) problems.push({ line, message: bad });
      }
    }
    if (title === null) problems.push({ message: "it has no # title line" });
  }
  if (spec?.headings) problems.push(...headingProblems(spec.headings, hs.filter((h) => h.level === 2)));
  problems.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
  return { head, title, problems };
}

function headingProblems(fixed: readonly string[], found: Array<{ text: string; line: number }>): LineProblem[] {
  const out: LineProblem[] = [];
  const order = `${fixed.join(", ")}, in that order`;
  const at = (h: string) => found.find((f) => f.text === h);
  let last = -1;
  for (const f of found) {
    const i = fixed.indexOf(f.text);
    if (i < 0) continue;
    if (i < last) out.push({ line: f.line, message: `the heading ${f.text} is out of order: ${order}` });
    else last = i;
  }
  fixed.forEach((h, i) => {
    if (at(h)) return;
    // Where it should be: at the next fixed heading that is there.
    const next = fixed.slice(i + 1).map(at).find(Boolean);
    out.push({ ...(next ? { line: next.line } : {}), message: `the heading ${h} is missing: ${order}` });
  });
  return out;
}

/** The glossary's terms (0017 §2): one `## Term` each, in alphabetical order. */
export function glossaryProblems(source: string): LineProblem[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const terms = headingLines(lines, 0).filter((h) => h.level === 2);
  const out: LineProblem[] = [];
  for (let i = 1; i < terms.length; i++) {
    const a = terms[i - 1]!, b = terms[i]!;
    if (b.text.localeCompare(a.text, "en", { sensitivity: "base" }) < 0) out.push({ line: b.line, message: `${b.text} is out of alphabetical order: it comes after ${a.text}` });
  }
  return out;
}

export interface LibraryEntry {
  path: string;
  bytes: number;
  /** A Markdown file's text: the overview's, the cards' and the glossary's. Others may leave it out. */
  text?: string;
}

export interface CheckedFile {
  path: string;
  section: LibrarySectionId;
  bytes: number;
  title?: string | null;
  head?: Record<string, string> | null;
  too_large?: true;
}

/**
 * The standard applied to what is under `library/` at a commit (0017 §4): each file the standard names with its
 * section, title and head; and the problems. Files the standard doesn't name are left out, each a problem; so are
 * cards past the limit. A file or the architecture over a limit stays in, `too_large`, with a problem.
 */
export function checkLibrary(entries: readonly LibraryEntry[]): { files: CheckedFile[]; problems: LibraryProblem[] } {
  const files: CheckedFile[] = [];
  const problems: LibraryProblem[] = [];
  const standard = (path: string, p: LineProblem) => problems.push({ kind: "standard", path, ...(p.line ? { line: p.line } : {}), message: p.message.slice(0, MESSAGE_MAX) });
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const numbers = new Map<string, string>();
  let cards = 0;
  for (const e of sorted) {
    const section = librarySectionOf(e.path);
    if (section === "image") continue;
    if (section === null) {
      const card = /^library\/(decisions|usecases|ux)\/[^/]+$/.test(e.path);
      standard(e.path, {
        message: card ? "a card's name is NNNN-slug.md, four digits and lowercase words, so it isn't shown" : "the standard doesn't name this file, so it isn't shown",
      });
      continue;
    }
    const isCard = section === "decisions" || section === "usecases" || section === "ux";
    if (isCard) {
      if (++cards > LIBRARY_CARDS_MAX) {
        problems.push({ kind: "too_large", path: e.path, message: `a library shows ${LIBRARY_CARDS_MAX} cards at most, so it isn't shown` });
        continue;
      }
      const num = `${section}/${cardNumber(e.path)}`;
      const first = numbers.get(num);
      if (first) standard(e.path, { message: `its number is ${first}'s too: a card's number is used once` });
      else numbers.set(num, e.path.slice(e.path.lastIndexOf("/") + 1));
    }
    const file: CheckedFile = { path: e.path, section, bytes: e.bytes };
    if (e.bytes > LIBRARY_BLOB_MAX) {
      file.too_large = true;
      problems.push({ kind: "too_large", path: e.path, message: `it is ${Math.ceil(e.bytes / 1024)} KB, over the ${LIBRARY_BLOB_MAX / 1024} KB a file may be, so it shows on GitHub only` });
    } else if (e.text !== undefined && e.path.endsWith(".md")) {
      const fm = readFrontMatter(e.text, section);
      file.title = fm.title;
      if (section === "overview" || isCard) file.head = fm.head;
      for (const p of fm.problems) standard(e.path, p);
      if (section === "glossary") for (const p of glossaryProblems(e.text)) standard(e.path, p);
    }
    files.push(file);
  }
  const c4 = files.filter((f) => f.section === "architecture");
  const c4Bytes = c4.reduce((n, f) => n + f.bytes, 0);
  if (c4.length > LIBRARY_C4_FILES_MAX || c4Bytes > LIBRARY_C4_BYTES_MAX) {
    for (const f of c4) f.too_large = true;
    problems.push({
      kind: "too_large",
      path: "library/architecture/",
      message: `the model is ${c4.length} files and ${Math.ceil(c4Bytes / 1024)} KB, over the ${LIBRARY_C4_FILES_MAX} files and ${LIBRARY_C4_BYTES_MAX / 1024} KB it may be, so it shows on GitHub only`,
    });
  }
  return { files, problems: problems.slice(0, LIBRARY_PROBLEMS_MAX) };
}
