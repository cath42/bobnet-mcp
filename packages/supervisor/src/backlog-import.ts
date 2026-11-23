import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  BOARD_EXPORT_FORMAT,
  BoardExportV1,
  type ExportGrant,
  type ExportItem,
  type ExportProject,
  type ExportQuestion,
  type ExportSession,
  ItemStatus,
  ItemType,
  PeerAddress,
  ProjectKey,
} from "@bobnet/protocol";
import { z } from "zod";
import { type BacklogFile, catFiles, readBacklogFile } from "./board.ts";
import type { ImportPosted } from "./board-backup.ts";

// The Backlog.md import (ADR 0001 §11, BOB-9): a project's Backlog.md at a named commit, and its
// lead/questions.md, as one board export for POST /v1/board/import. The one place Markdown is read,
// once per project. Ids under the project's prefix keep their form, dotted or not (LAND-49.19 stays
// LAND-49.19), and so does a draft's in drafts/; an id under another prefix, or a draft id outside
// drafts/, gets the next number past every id there is and keeps the old id as an alias. New items
// on the board are flat (ADR 0001 §2). A "Was LAND-n.m" re-creation takes the old id as an alias, absorbing the old item when it was
// archived. What doesn't map is reported for the PO to settle before the cut-over.

const GIT_TIMEOUT_MS = 60_000;
const FOLDERS = ["tasks", "completed", "drafts", "milestones", "archive/tasks", "archive/drafts", "archive/milestones"] as const;
type Folder = (typeof FOLDERS)[number];

export interface BacklogProject {
  key: string;
  name: string;
  prefix: string;
  draft_prefix: string | null;
  lead: string | null;
  po: string | null;
  repos: string[];
}

export interface BacklogFiles {
  /** The commit read, for the document's source. */
  sha: string;
  /** Repository name, for the source: "helix". */
  repo: string;
  files: Array<{ folder: Folder; path: string; text: string }>;
  questions: string | null;
}

/** A rule the import seeds (ADR 0001 §5, §11): the export's grant row, and the project it is for, or '*' for every project. */
export const ImportGrant = BoardExportV1.shape.grants.element.extend({ project: z.union([ProjectKey, z.literal("*")]) }).strict();
export type ImportGrant = z.infer<typeof ImportGrant>;

export interface ImportReport {
  source: string;
  /** The rules it brings, one line each. */
  grants: string[];
  counts: Record<string, number>;
  /** Old id → new ref, for every id that changed: one under another prefix, or a draft's outside drafts/. */
  renumbered: Array<[string, string]>;
  /** A "was <id>" the rule didn't take, with the item that says it: the PO settles each (BOB-9 #6). */
  mentions: string[];
  /** What couldn't map as it is: the PO settles each before the cut-over. A clean board has none. */
  problems: string[];
  /** What the import did by rule, for the PO to check. */
  notes: string[];
}

const run = (args: string[], cwd: string) =>
  new Promise<string>((resolve, reject) =>
    execFile("git", args, { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (err, out, stderr) =>
      err ? reject(new Error(stderr.trim() || err.message)) : resolve(out),
    ),
  );

/** A backlog's files at a commit, through git, never from a worktree. */
export async function readBacklogAt(repoPath: string, ref: string, dir: string, questionsPath: string | null): Promise<BacklogFiles> {
  const sha = (await run(["rev-parse", "--short=12", `${ref}^{commit}`], repoPath)).trim();
  const paths = (await run(["ls-tree", "-r", "-z", "--name-only", sha, "--", dir], repoPath)).split("\0").filter((f) => f.endsWith(".md"));
  const files: BacklogFiles["files"] = [];
  const texts = await catFiles(repoPath, paths.map((p) => `${sha}:${p}`));
  paths.forEach((path, i) => {
    const rest = path.slice(dir.length + 1);
    const folder = FOLDERS.find((f) => rest.startsWith(`${f}/`) && !rest.slice(f.length + 1).includes("/"));
    if (folder) files.push({ folder, path, text: texts[i] ?? "" });
  });
  let questions: string | null = null;
  if (questionsPath) questions = (await catFiles(repoPath, [`${sha}:${questionsPath}`]))[0] || null;
  // The repository's name as its remote has it, not a worktree's folder.
  const remote = await run(["config", "--get", "remote.origin.url"], repoPath).catch(() => "");
  const top = (await run(["rev-parse", "--show-toplevel"], repoPath)).trim();
  const repo = (remote.trim().split(/[/:]/).pop() || top.split("/").pop()!).replace(/\.git$/, "");
  return { sha, repo, files, questions };
}

/** Backlog.md's `2026-11-14 03:59` (or a date alone) as an ISO time. Backlog.md writes no zone; read as UTC. */
function when(v: string | null): string | null {
  const m = v && /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(v);
  return m ? `${m[1]}T${m[2] ?? "00"}:${m[3] ?? "00"}:00.000Z` : null;
}

/** An id's numbers: LAND-49.19 → [49, 19]. */
const numbers = (id: string) => id.slice(id.indexOf("-") + 1).split(".").map(Number);
const prefixOf = (id: string) => id.slice(0, id.indexOf("-"));
function byNumber(a: string, b: string): number {
  const [x, y] = [numbers(a), numbers(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
  return a < b ? -1 : a > b ? 1 : 0;
}
const ID = /^[A-Z][A-Z0-9]{0,9}-\d{1,6}(\.\d{1,4})*$/;
const WAS = /^Was ([A-Z][A-Z0-9]*-\d+(?:\.\d+)*)\b/gm;
/** Any "was <id>", for the ones WAS doesn't take: mid-line or lower case. */
const WAS_ANYWHERE = /\b[Ww]as ([A-Z][A-Z0-9]*-\d+(?:\.\d+)*)\b/g;
/** Ordinals are ranked within their scope and spaced by this, as the board spaces them. */
const ORD_STEP = 1000;

interface Read {
  file: BacklogFile;
  folder: Folder;
  path: string;
  draft: boolean;
  archived: boolean;
  aliases: Set<string>;
}

/** The board export a backlog makes, and what the import made of it. */
export function backlogToExport(project: BacklogProject, input: BacklogFiles, now = new Date(), grants: ImportGrant[] = []): { doc: BoardExportV1; report: ImportReport } {
  const at = now.toISOString();
  const source = `Backlog.md at ${input.repo} ${input.sha}`;
  const problems: string[] = [];
  const notes: string[] = [];
  const counts: Record<string, number> = {};
  const count = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  for (const pre of [project.prefix, project.draft_prefix]) {
    if (pre === "Q" || pre === "A") throw new Error(`Prefix ${pre} is questions' and actions': ${project.key} can't use it`);
  }

  // ---------- Read ----------
  const milestones: Array<{ id: string; title: string; archived: boolean }> = [];
  const items = new Map<string, Read>();
  /** Ids of files that didn't read: never given to another item. */
  const reserved: string[] = [];
  for (const f of input.files) {
    const file = readBacklogFile(f.text);
    if (!file) {
      const id = /^id: *['"]?([A-Za-z][A-Za-z0-9]*-[\d.]+)/m.exec(f.text)?.[1]?.toUpperCase();
      if (id) reserved.push(id);
      problems.push(`${f.path}: its front matter isn't valid YAML with an id; not imported`);
      continue;
    }
    if (f.folder.endsWith("milestones")) {
      milestones.push({ id: file.id.toLowerCase(), title: file.title || file.id, archived: f.folder.startsWith("archive/") });
      continue;
    }
    if (!ID.test(file.id)) {
      problems.push(`${f.path}: id ${file.id} isn't PREFIX-n; not imported`);
      continue;
    }
    if (prefixOf(file.id) === "Q" || prefixOf(file.id) === "A") {
      problems.push(`${file.id}: reads as a question's or action's id; not imported`);
      continue;
    }
    if (items.has(file.id)) {
      problems.push(`${file.id}: two files (${items.get(file.id)!.path}, ${f.path}); the second is not imported`);
      continue;
    }
    items.set(file.id, { file, folder: f.folder, path: f.path, draft: f.folder.endsWith("drafts"), archived: f.folder.startsWith("archive/"), aliases: new Set() });
  }

  // ---------- Releases ----------
  const releaseOf = new Map<string, string>();
  const releases: ExportProject["releases"] = [];
  for (const m of milestones) {
    const n = /^R(\d{1,4})\b/i.exec(m.title)?.[1] ?? /^m-(\d+)$/.exec(m.id)?.[1];
    if (n === undefined) {
      problems.push(`milestone ${m.id} (${m.title}): no release number in its title or id; not imported`);
      continue;
    }
    const ref = `R${Number(n)}`;
    if (releases.some((r) => r.ref === ref)) {
      problems.push(`milestone ${m.id} (${m.title}): ${ref} is already another milestone's; not imported`);
      continue;
    }
    releaseOf.set(m.id, ref);
    releases.push({ ref, title: m.title, goal: null, status: m.archived ? "closed" : "planned", ord: null, spec_url: null, closed_at: null, closed_by: null });
  }
  releases.sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));
  releases.forEach((r, i) => (r.ord = i + 1));
  const firstOpen = releases.find((r) => r.status !== "closed");
  if (firstOpen) firstOpen.status = "open";
  for (const r of releases) notes.push(`${r.ref} "${r.title}": ${r.status}${r.status === "open" ? " (the first not archived)" : r.status === "closed" ? " (archived)" : ""}`);
  const release = (m: string | null, who: string): string | null => {
    if (!m) return null;
    const r = releaseOf.get(m.toLowerCase());
    if (!r) problems.push(`${who}: milestone ${m} isn't a release; dropped`);
    return r ?? null;
  };

  // ---------- "Was X" re-creations ----------
  const mergedInto = new Map<string, string>();
  const absorbed: Array<[string, string]> = [];
  const mentions: string[] = [];
  for (const [id, r] of [...items].sort(([a], [b]) => byNumber(a, b))) {
    const said = `${r.file.desc ?? ""}\n${r.file.notes ?? ""}`;
    // Not widened: a mention mid-line may not be a re-creation ("its only wait was LAND-2.20").
    for (const m of said.matchAll(WAS_ANYWHERE)) {
      if (m[0].startsWith("Was ") && (m.index === 0 || said[m.index! - 1] === "\n")) continue;
      const line = said.slice(said.lastIndexOf("\n", m.index!) + 1, said.indexOf("\n", m.index!) === -1 ? undefined : said.indexOf("\n", m.index!)).trim();
      mentions.push(`${id}: "${m[0]}" in "${line.length > 120 ? `${line.slice(0, 117)}...` : line}"`);
    }
    for (const m of said.matchAll(WAS)) {
      const old = m[1]!;
      if (old === id) continue;
      const was = items.get(old);
      if (!was) {
        r.aliases.add(old);
        count("was: old id kept as an alias");
      } else if (was.archived && !mergedInto.has(old)) {
        mergedInto.set(old, id);
      } else if (!was.archived) {
        problems.push(`${id} says it was ${old}, but ${old} is still on the board (${was.folder}); both kept, not linked`);
      }
    }
  }
  const target = (id: string) => {
    const seen = new Set<string>();
    while (mergedInto.has(id) && !seen.has(id)) {
      seen.add(id);
      id = mergedInto.get(id)!;
    }
    return id;
  };
  for (const old of mergedInto.keys()) {
    const into = target(old);
    if (into === old) continue;
    const r = items.get(old)!;
    const keep = items.get(into)!;
    keep.aliases.add(old);
    for (const a of r.aliases) keep.aliases.add(a);
    items.delete(old);
    count("was: archived old item absorbed");
    absorbed.push([old, into]);
  }
  for (const r of items.values()) for (const a of r.aliases) if (items.has(a)) r.aliases.delete(a);
  const alias = new Map<string, string>();
  for (const [id, r] of items) {
    for (const a of r.aliases) {
      if (alias.has(a)) {
        problems.push(`${a} is an old id of both ${alias.get(a)} and ${id}; kept on ${alias.get(a)} only`);
        r.aliases.delete(a);
      } else alias.set(a, id);
    }
  }
  /** The item an id names now, through re-creations. */
  const resolve = (id: string): string | null => (items.has(id) ? id : alias.has(id) ? alias.get(id)! : mergedInto.has(id) ? target(id) : null);

  // ---------- Refs ----------
  const allIds = [...items.keys(), ...alias.keys(), ...reserved];
  let next = Math.max(0, ...allIds.filter((i) => prefixOf(i) === project.prefix).map((i) => numbers(i)[0]!)) + 1;
  const refOf = new Map<string, string>();
  const keeps = (id: string) => prefixOf(id) === project.prefix || (prefixOf(id) === project.draft_prefix && items.get(id)!.draft);
  const renumbered: Array<[string, string]> = [];
  for (const id of [...items.keys()].sort(byNumber)) {
    if (keeps(id)) refOf.set(id, id);
  }
  for (const id of [...items.keys()].filter((i) => !keeps(i)).sort((a, b) => (prefixOf(a) === prefixOf(b) ? byNumber(a, b) : prefixOf(a) < prefixOf(b) ? -1 : 1))) {
    const ref = `${project.prefix}-${next++}`;
    refOf.set(id, ref);
    renumbered.push([id, ref]);
    items.get(id)!.aliases.add(id);
  }
  const ref = (id: string) => {
    const r = resolve(id);
    return r === null ? null : refOf.get(r)!;
  };
  for (const [old, into] of absorbed) notes.push(`${old} (archived) was re-created as ${into}${refOf.get(into) !== into ? ` (${refOf.get(into)})` : ""}: its file isn't imported, its id finds the new item`);

  // ---------- Kinds ----------
  // A top-level item that holds tasks is a feature, whatever its type (Helix's LAND-1, LAND-17 upkeep):
  // only a feature holds tasks on the board.
  const holders = new Set([...items.values()].filter((r) => !r.draft && r.file.parent).map((r) => resolve(r.file.parent!)));
  const isFeature = (id: string) => {
    const r = items.get(id);
    return !!r && !r.draft && (r.file.type === "increment" || (holders.has(id) && !r.file.parent));
  };
  /** The feature a task belongs under: its parent, or its parent's, as far up as one is. */
  const featureOf = (id: string): string | null => {
    const seen = new Set<string>();
    let p = items.get(id)!.file.parent;
    while (p) {
      const r = resolve(p);
      if (r === null || seen.has(r)) return null;
      if (isFeature(r)) return r;
      seen.add(r);
      p = items.get(r)!.file.parent;
    }
    return null;
  };

  const out: ExportItem[] = [];
  const sessions: ExportSession[] = [];
  for (const id of [...items.keys()].sort((a, b) => byNumber(refOf.get(a)!, refOf.get(b)!))) {
    const { file: f, draft, archived } = items.get(id)!;
    const who = id === refOf.get(id) ? id : `${id} (${refOf.get(id)})`;
    const created = when(f.created) ?? (problems.push(`${who}: no created_date; the import's time used`), at);
    const updated = when(f.updated) ?? created;
    let status = f.status as ItemExport["status"];
    if (!ItemStatus.safeParse(status).success) {
      problems.push(`${who}: status "${f.status}" isn't one of ${ItemStatus.options.join(", ")}; imported as Draft`);
      status = "Draft";
    }
    let type = (f.type ?? "task") as ItemExport["type"];
    if (f.type === null) count("type missing: imported as task");
    else if (!ItemType.safeParse(type).success) {
      problems.push(`${who}: type "${f.type}" isn't one of ${ItemType.options.join(", ")}; imported as task`);
      type = "task";
    }

    let kind: ItemExport["kind"];
    let parent: string | null = null;
    let parentHint: string | null = null;
    let rel = release(f.milestone, who);
    if (draft) {
      kind = "backlog";
      if (type === "increment") {
        notes.push(`${who}: a draft of type increment; imported as a backlog item of type task`);
        type = "task";
      }
      if (f.parent) {
        const p = resolve(f.parent);
        if (p && isFeature(p)) parentHint = refOf.get(p)!;
        else problems.push(`${who}: parent ${f.parent} isn't a feature; its hint is dropped`);
      }
    } else if (isFeature(id)) {
      kind = "feature";
      if (type !== "increment") {
        notes.push(`${who}: type ${f.type ?? "none"}, but it holds tasks; imported as a feature (type increment)`);
        type = "increment";
      }
      if (f.parent) problems.push(`${who}: a feature with parent ${f.parent}; the parent is dropped`);
    } else if (f.parent) {
      const feature = featureOf(id);
      if (feature) {
        kind = "task";
        parent = refOf.get(feature)!;
        const direct = resolve(f.parent);
        if (direct !== feature) count("task under a task: put under its feature");
        const fm = items.get(feature)!.file.milestone;
        if (f.milestone && fm && f.milestone.toLowerCase() !== fm.toLowerCase()) {
          problems.push(`${who}: milestone ${f.milestone} differs from its feature ${refOf.get(feature)}'s ${fm}; the task follows its feature`);
        } else if (f.milestone && !fm) {
          problems.push(`${who}: milestone ${f.milestone}, but its feature ${refOf.get(feature)} has none; the task follows its feature, in no release`);
        }
        rel = null;
      } else {
        kind = "backlog";
        problems.push(`${who}: parent ${f.parent} ${resolve(f.parent) ? "isn't under a feature" : "isn't on the board"}; imported as a backlog item`);
      }
    } else kind = "backlog";

    const deps: string[] = [];
    for (const d of f.deps) {
      const r = ref(d);
      if (r === null) problems.push(`${who}: dependency ${d} isn't on the board; dropped`);
      else if (r !== refOf.get(id) && !deps.includes(r)) deps.push(r);
    }
    const criteria = (section: "ac" | "dod", list: BacklogFile["ac"]) => {
      const seen = new Set<number>();
      return list
        .filter(([, , text]) => text.length > 0)
        .map(([checked, n, text]) => {
          if (seen.has(n) || n < 1) {
            problems.push(`${who}: ${section === "ac" ? "acceptance criterion" : "definition of done"} #${n} appears twice; numbered after the others`);
            n = Math.max(0, ...seen) + 1;
          }
          seen.add(n);
          return { section, n, text, evidence: null, state: checked ? ("checked" as const) : ("open" as const), checked_by: checked ? "Backlog.md" : null, checked_at: checked ? updated : null, casper_gate: false };
        });
    };
    if (kind === "feature" && status === "Done" && f.ac.some(([c]) => !c)) count("Done feature, criteria not ticked");
    if (f.assignee.length) count("assignee not carried (no field)");
    if (f.references.length) count("references appended to notes");
    if (f.priority) count("priority not carried (no field)");
    if (f.summary) count("final summary appended to notes");
    const openSince = kind === "feature" && status === "In Progress" && !archived ? updated : null;
    if (openSince) {
      sessions.push({
        feature: refOf.get(id)!,
        kind: "build",
        label: "imported",
        started_at: openSince,
        ended_at: null,
        imported: true,
        need: null,
        minors_fixed: null,
        summary: null,
        handoff_path: null,
        handoff_text: null,
        commit_sha: null,
        closed_by: null,
        tasks: [],
        waits_on: [],
      });
      notes.push(`${who}: In Progress, so open, with a build session "imported"`);
    }
    count(archived ? `${kind} (archived)` : kind);
    out.push({
      ref: refOf.get(id)!,
      aliases: [...items.get(id)!.aliases].sort(byNumber),
      kind,
      type,
      status,
      title: f.title || id,
      description: f.desc,
      notes: notesOf(f),
      plan: f.plan,
      parent,
      release: kind === "task" ? null : rel,
      ord: f.ordinal,
      open_since: openSince,
      archived_at: archived ? updated : null,
      archive_reason: archived ? "archived in Backlog.md" : null,
      captured_by: null,
      captured_session: null,
      casper_words: null,
      capture_id: null,
      parent_hint: parentHint,
      bug_where: null,
      blocks_use: false,
      found_in: null,
      labels: [...new Set(f.labels)].sort(),
      deps: deps.sort(byNumber),
      criteria: [...criteria("ac", f.ac), ...criteria("dod", f.dod)],
      created_at: created,
      updated_at: updated,
    });
  }
  // Ordinals ranked within each scope and spaced, so a tie in Backlog.md stays a tie and nothing new
  // ties: Helix's 204204.1 and 60000.5 would round onto their neighbours (import review, finding 3).
  const scopes = new Map<string, ExportItem[]>();
  for (const i of out) {
    if (i.ord === null) continue;
    const scope = i.kind === "task" ? `task ${i.parent}` : i.kind === "feature" ? `feature ${i.release}` : "backlog";
    scopes.set(scope, [...(scopes.get(scope) ?? []), i]);
  }
  for (const list of scopes.values()) {
    const ranks = [...new Set(list.map((i) => i.ord!))].sort((a, b) => a - b);
    for (const i of list) i.ord = (ranks.indexOf(i.ord!) + 1) * ORD_STEP;
  }
  const ranked = [...scopes.values()].reduce((n, l) => n + l.length, 0);
  if (ranked > 0) notes.push(`ordinals: ${ranked} ranked within their feature's tasks, their release's features or the backlog, and spaced by ${ORD_STEP}; ties kept`);
  for (const r of releases) {
    if (r.status !== "closed") continue;
    // The board's close_release refuses this: settled before the post, not by a reopen after it (import review, finding 5).
    const featureRelease = (i: ExportItem) => (i.parent ? out.find((f) => f.ref === i.parent)?.release : i.release);
    const open = out.filter((i) => featureRelease(i) === r.ref && i.status !== "Done" && i.archived_at === null).map((i) => `${i.ref} (${i.status})`);
    if (open.length > 0) problems.push(`${r.ref} "${r.title}" comes in closed (archived) holding work not Done: ${open.join(", ")}; settle the release or the items before the post`);
    const last = out.filter((i) => i.release === r.ref || (i.parent && out.find((f) => f.ref === i.parent)?.release === r.ref)).map((i) => i.updated_at).sort().pop();
    r.closed_at = last ?? at;
    r.closed_by = "Backlog.md";
  }

  // ---------- Questions and actions ----------
  const q = input.questions ? readQuestions(input.questions, at) : { questions: [], next: { question: 1, action: 1 }, problems: [] };
  problems.push(...q.problems);
  count("question (open)", q.questions.filter((x) => x.kind === "question" && x.state === "open").length);
  count("question (answered)", q.questions.filter((x) => x.kind === "question" && x.state === "answered").length);
  count("action (open)", q.questions.filter((x) => x.kind === "action").length);

  // ---------- Rules ----------
  const rules = { own: [] as ExportGrant[], every: [] as ExportGrant[] };
  const seen = new Set<string>();
  for (const { project: key, ...g } of grants) {
    const who = `${g.agent}@${g.laptop}`;
    if (key !== "*" && key !== project.key) throw new Error(`The rule for ${who} is for project ${key}, not ${project.key}`);
    const k = `${key} ${who.toLowerCase()}`;
    if (seen.has(k)) throw new Error(`Two rules for ${who} on ${key === "*" ? "every project" : key}`);
    seen.add(k);
    (key === "*" ? rules.every : rules.own).push(g);
  }
  const byWho = (a: ExportGrant, b: ExportGrant) => a.agent.toLowerCase().localeCompare(b.agent.toLowerCase()) || a.laptop.toLowerCase().localeCompare(b.laptop.toLowerCase());
  rules.own.sort(byWho);
  rules.every.sort(byWho);
  const ruleLines = [...rules.own.map((g) => [project.key, g] as const), ...rules.every.map((g) => ["every project ('*')", g] as const)].map(([on, g]) => {
    const flags = [g.read && "read", g.sessions && "sessions", g.questions && "questions", g.admin && "admin"].filter(Boolean).join(", ");
    return `${g.agent}@${g.laptop} on ${on}, ${g.role}: items ${g.items}; fields ${g.fields.length ? g.fields.join(", ") : "none"}${flags ? `; ${flags}` : ""}`;
  });

  const created = out.map((i) => i.created_at).sort()[0] ?? at;
  const doc: BoardExportV1 = {
    format: BOARD_EXPORT_FORMAT,
    version: 1,
    exported_at: at,
    source,
    last_event_seq: 0,
    grants: rules.every,
    events: [],
    projects: [
      {
        ...project,
        repos: [...new Set(project.repos)].sort(),
        next: {
          item: next,
          release: Math.max(0, ...releases.map((r) => Number(r.ref.slice(1)))) + 1,
          question: q.next.question,
          action: q.next.action,
        },
        created_at: created,
        releases,
        items: out,
        sessions,
        questions: q.questions,
        runs: [],
        pushes: [],
        ci_runs: [],
        grants: rules.own,
        events: [],
      },
    ],
  };
  const checked = BoardExportV1.safeParse(doc);
  if (!checked.success) for (const i of checked.error.issues.slice(0, 20)) problems.push(`the document: ${i.path.join(".")}: ${i.message}`);
  return { doc, report: { source, grants: ruleLines, counts, renumbered, mentions, problems, notes } };
}

type ItemExport = ExportItem;

/** An item's notes, then what Backlog.md kept beside them that has no field: its final summary, and its references one per line. */
function notesOf(f: BacklogFile): string | null {
  const refs = [...new Set(f.references.map((r) => r.trim()).filter(Boolean))];
  const parts = [f.notes, f.summary && `Final summary:\n${f.summary}`, refs.length > 0 && `References:\n${refs.map((r) => `- ${r}`).join("\n")}`].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** The cells of a Markdown table row. */
const cells = (line: string) =>
  line
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/** The text inside the parentheses that open at `from`. */
function balanced(text: string, from: number): string | null {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(from + 1, i);
  }
  return null;
}

/**
 * Helix's lead/questions.md: open questions and actions as table rows (`| Q-214 | From | Question |
 * Context | Recommendation | Blocking? |`, `| A-6 | Action | Where | For |`); answered questions only
 * as `Q-258 (Casper, 2026-11-13, …)` in its running paragraph, the answer kept verbatim; and the next
 * ids as `The next ID is **Q-267**`.
 */
export function readQuestions(text: string, at: string): { questions: ExportQuestion[]; next: { question: number; action: number }; problems: string[] } {
  const problems: string[] = [];
  const byRef = new Map<string, ExportQuestion>();
  const base = { context: null, session: null, needed_before: null, answer_key: null, answer_words: null, answered_by: null, answered_at: null, answered_via: null, options: [], holds: [] };
  const add = (q: ExportQuestion) => {
    if (byRef.has(q.ref)) problems.push(`${q.ref} appears twice in questions.md; the first kept`);
    else byRef.set(q.ref, q);
  };
  for (const line of text.split("\n")) {
    const m = /^\|\s*([QA])-(\d+)\s*\|/.exec(line);
    if (!m) continue;
    const c = cells(line);
    const ref = `${m[1]}-${Number(m[2])}`;
    if (m[1] === "Q") {
      const [, from, question, context, rec, blocking] = c;
      if (!question) {
        problems.push(`${ref}: a row with no question; not imported`);
        continue;
      }
      const ctx = [context, rec && `Recommendation: ${rec}`, blocking && `Blocking: ${blocking}`].filter(Boolean).join("\n\n");
      add({ ...base, ref, kind: "question", text: question, context: ctx || null, asked_by: from || "unknown", state: "open", created_at: at });
    } else {
      const [, action, where, forWhat] = c;
      if (!action) {
        problems.push(`${ref}: a row with no action; not imported`);
        continue;
      }
      const ctx = [where && `Where: ${where}`, forWhat && `For: ${forWhat}`].filter(Boolean).join("\n\n");
      add({ ...base, ref, kind: "action", text: action, context: ctx || null, asked_by: "unknown", state: "open", created_at: at });
    }
  }
  for (const m of text.matchAll(/\bQ-(\d+) \(/g)) {
    const ref = `Q-${Number(m[1])}`;
    const inner = balanced(text, m.index! + m[0].length - 1);
    if (inner === null || /^open\b/.test(inner) || byRef.has(ref)) continue;
    if (!/^[A-Z][\w ,&]*?,/.test(inner)) continue;
    const by = inner.split(",")[0]!.trim();
    const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(inner)?.[1];
    const answeredAt = date ? `${date}T00:00:00.000Z` : at;
    add({
      ...base,
      ref,
      kind: "question",
      text: `${ref}, answered before the move; questions.md kept only the answer`,
      asked_by: "unknown",
      state: "answered",
      answer_words: inner,
      answered_by: by,
      answered_at: answeredAt,
      answered_via: "conversation",
      created_at: answeredAt,
    });
  }
  const nextOf = (k: "Q" | "A") => Number(new RegExp(`next ID is \\*\\*${k}-(\\d+)\\*\\*`).exec(text)?.[1] ?? 0);
  const questions = [...byRef.values()].sort((a, b) => (a.kind === b.kind ? Number(a.ref.slice(2)) - Number(b.ref.slice(2)) : a.kind === "question" ? -1 : 1));
  const highest = (k: string) => Math.max(0, ...questions.filter((q) => q.ref.startsWith(k)).map((q) => Number(q.ref.slice(2))));
  return { questions, next: { question: Math.max(nextOf("Q"), highest("Q-") + 1), action: Math.max(nextOf("A"), highest("A-") + 1) }, problems };
}

/** The report as Markdown, for the PO and the handoff. */
export function formatReport(r: ImportReport): string {
  const lines = [`# Backlog.md import: ${r.source}`, "", "## Counts", ""];
  for (const [k, n] of Object.entries(r.counts).filter(([, n]) => n > 0).sort()) lines.push(`- ${k}: ${n}`);
  lines.push("", `## Rules (${r.grants.length})`, "");
  lines.push(...(r.grants.length ? r.grants.map((g) => `- ${g}`) : ["None: after the import only the owner can write it."]));
  lines.push("", `## What couldn't map (${r.problems.length})`, "");
  lines.push(...(r.problems.length ? r.problems.map((p) => `- ${p}`) : ["None."]));
  lines.push("", `## Renumbered (${r.renumbered.length}): an id under another prefix or a draft's outside drafts/, old id → new ref, the old id kept as an alias`, "");
  lines.push(...(r.renumbered.length ? r.renumbered.map(([a, b]) => `- ${a} → ${b}`) : ["None."]));
  lines.push("", `## "Was" mentions not taken (${r.mentions.length}): only "Was <id>" at a line's start links; the PO settles each`, "");
  lines.push(...(r.mentions.length ? r.mentions.map((m) => `- ${m}`) : ["None."]));
  lines.push("", `## Done by rule (${r.notes.length})`, "");
  lines.push(...(r.notes.length ? r.notes.map((n) => `- ${n}`) : ["None."]));
  return `${lines.join("\n")}\n`;
}

const USAGE = `bobnet-supervisor import-backlog --repo <path> --ref <commit> --project <key> --name <name> --prefix <PREFIX>
  [--dir product/backlog] [--draft-prefix DRAFT] [--questions lead/questions.md] [--lead name@laptop] [--po name@laptop]
  [--grants grants.json [--no-admin]] [--out board.json] [--report report.md] [--post]
Reads the backlog at the commit and writes the board export and the report. Nothing is posted without --post.
--grants is a JSON array of the rules to seed: each an export grant row with "project", the project's key or "*".
It needs a rule with admin, or --no-admin to seed the rules all the same.`;

/** The rules in a --grants file, or why they can't be read. */
export function readGrants(text: string): ImportGrant[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`isn't JSON: ${(e as Error).message}`);
  }
  const parsed = z.array(ImportGrant).safeParse(json);
  if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "the file"}: ${i.message}`).join("; "));
  return parsed.data;
}

/** Why a --grants file with no admin is refused (BOB-118): no one but the owner could change the project's rules after. */
export const NO_ADMIN_REFUSAL =
  "No rule in --grants has admin: after the import only the owner (Casper) could change this project's rules, and no agent could add one " +
  "(BOB-115's dead end). Give the lead admin, or pass --no-admin to seed them as they are.";

/** Said before a post that brings a rule for every project: the broker takes one from a laptop only into an empty board. */
export const EVERY_PROJECT_WARNING =
  "This brings a rule for every project ('*'). From a laptop the broker takes that only into an empty board (no projects, rules or events): " +
  "on a board in use it answers 403 and imports nothing. Then post without the '*' row, and Casper adds it as the owner.";

/** The command: a dry run unless --post, which sends the document to the broker in config.json. */
export async function importBacklogCommand(argv: string[], post?: () => (doc: BoardExportV1) => Promise<ImportPosted>): Promise<number> {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      repo: { type: "string" },
      ref: { type: "string" },
      dir: { type: "string", default: "product/backlog" },
      project: { type: "string" },
      name: { type: "string" },
      prefix: { type: "string" },
      "draft-prefix": { type: "string" },
      questions: { type: "string" },
      lead: { type: "string" },
      po: { type: "string" },
      grants: { type: "string" },
      out: { type: "string" },
      report: { type: "string" },
      post: { type: "boolean", default: false },
      "no-admin": { type: "boolean", default: false },
    },
  });
  if (!v.repo || !v.ref || !v.project || !v.name || !v.prefix) {
    console.error(USAGE);
    return 2;
  }
  // Answers go to the lead (ADR 0001 §7): an address that can't be reached would tell no one.
  for (const [k, a] of [["lead", v.lead], ["po", v.po]] as const) {
    if (a !== undefined && !PeerAddress.safeParse(a).success) {
      console.error(`--${k} ${a} is not name@laptop`);
      return 2;
    }
  }
  let grants: ImportGrant[] = [];
  if (v.grants) {
    try {
      grants = readGrants(readFileSync(v.grants, "utf8"));
    } catch (e) {
      console.error(`--grants ${v.grants}: ${(e as Error).message}`);
      return 2;
    }
    if (!grants.some((g) => g.admin) && !v["no-admin"]) {
      console.error(`--grants ${v.grants}: ${NO_ADMIN_REFUSAL}`);
      return 2;
    }
  }
  const files = await readBacklogAt(v.repo, v.ref, v.dir!, v.questions ?? null);
  if (v.questions && files.questions === null) console.error(`No ${v.questions} at ${files.sha}`);
  const { doc, report } = backlogToExport(
    { key: v.project, name: v.name, prefix: v.prefix, draft_prefix: v["draft-prefix"] ?? null, lead: v.lead ?? null, po: v.po ?? null, repos: [files.repo] },
    files,
    new Date(),
    grants,
  );
  const text = formatReport(report);
  if (v.out) writeFileSync(v.out, `${JSON.stringify(doc, null, 2)}\n`);
  // Said on the dry run too, so whoever posts knows before the 403.
  if (doc.grants.length > 0) console.error(EVERY_PROJECT_WARNING);
  if (v.report) writeFileSync(v.report, text);
  else process.stdout.write(text);
  if (v.post) {
    if (!post) throw new Error("posting needs the broker's credentials");
    if (report.problems.length > 0) {
      console.error(`Not posted: ${report.problems.length} things couldn't map; settle them first`);
      return 1;
    }
    let answer: ImportPosted;
    try {
      answer = await post()(doc);
    } catch (e) {
      // A timeout may come after the broker committed. The import is write-once per project key, so posting again is the check.
      console.error(`No answer from the broker (${(e as Error).message}): it may have taken the import; post again, and a 409 "exists" means it did`);
      return 1;
    }
    const { status, reply } = answer;
    if (status < 200 || status >= 300 || !reply?.ok) {
      const why = reply && !reply.ok ? `${reply.code}: ${reply.message}` : "no reply it could read";
      console.error(`Not imported: the broker answered ${status}, ${why}`);
      return 1;
    }
    console.log(JSON.stringify(reply));
  }
  return 0;
}
