import { BoardExportV1, type BoardCaller, type BoardCtx, type BoardOpInput, type BoardReply, type BoardResults, type ExportItem, type ExportProject } from "@bobnet/protocol";
import type { Reader } from "../src/board/export.ts";
import { BOARD_MIGRATIONS } from "../src/board/schema.ts";
import { reset, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import backlogImport from "./fixtures/backlog-import.json";
import { laptopToken, ORIGIN, ownerToken } from "./helpers.ts";

// Export and import (ADR 0001 §11): the board as one document, and that document back into new projects.

const owner: BoardCaller = { kind: "owner", email: "owner@example.com" };
const agent = (name: string): BoardCaller => ({ kind: "agent", name, laptop: "mbp-1", supervisor: false, ctx: null });
const sup = (name: string, session: BoardCtx["session"]): BoardCaller => ({
  kind: "agent",
  name: "Sup",
  laptop: "mbp-1",
  supervisor: true,
  ctx: { worker: `w_${name.toLowerCase()}`, role: name.toLowerCase(), project: "helix", session, tasks: [] },
});
const board = () => env.BOARD.getByName("board");
const at = (min: number) => new Date(Date.UTC(2026, 10, 14, 10, min)).toISOString();

async function ok<K extends keyof BoardResults>(caller: BoardCaller, op: BoardOpInput & { op: K }): Promise<BoardResults[K]> {
  const reply = (await board().apply(caller, op)) as unknown as BoardReply;
  if (!reply.ok) throw new Error(`${op.op} refused: ${reply.code}: ${reply.message}`);
  return reply.result as BoardResults[K];
}

const exported = async (by: Reader = { kind: "owner", email: "owner@example.com" }) => BoardExportV1.parse(await board().exportBoard(by));
const imported = async (doc: unknown, by: Reader = { kind: "laptop", laptop: "mbp-1" }) => board().importBoard(by, doc);

/** Helix with a bit of everything: rules, a release, features and tasks, a session with a run and a push, and an answered question. */
async function helix() {
  await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", lead: "Picard@mbp-1", po: "Picard@mbp-1", repos: ["helix"] });
  await ok(owner, { op: "grant", project: "helix", agent: "Picard", laptop: "mbp-1", role: "backlog PO", read: true, items: "all", fields: ["status", "content", "create"], sessions: true, questions: true });
  const r1 = (await ok(owner, { op: "create_release", project: "helix", title: "Release 1" })).ref!;
  const f1 = (await ok(owner, { op: "create", project: "helix", kind: "feature", type: "increment", title: "Roadmap", release: r1, labels: ["ui"] })).ref!;
  const t1 = (await ok(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "Draw it", parent: f1, criteria: [{ text: "Drawn" }] })).ref!;
  const t2 = (await ok(owner, { op: "create", project: "helix", kind: "task", type: "task", title: "Count it", parent: f1, deps: [t1] })).ref!;
  await ok(owner, { op: "update", project: "helix", ref: t1, set: { status: "Ready" } });
  const session = { feature: f1, kind: "build" as const, label: "1" };
  await ok(sup("Bill", session), { op: "session_join", project: "helix", session });
  await ok(sup("Bill", session), { op: "run_start", project: "helix", id: "w_bill", started_at: at(0), session, tasks: [t1] });
  await ok(sup("Bill", session), { op: "run_end", project: "helix", id: "w_bill", ended_at: at(5), tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 }, calls: 2, ctx: [1000, 0x10000000], models: [{ model: "claude-opus-5-5", tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 } }] });
  await ok(sup("Bill", session), { op: "push", project: "helix", repo: "helix", branch: "v2", sha: "abc1234" });
  await ok(agent("Picard"), { op: "ask", project: "helix", text: "Which chart?", options: [{ key: "a", text: "Bars", recommended: true }], holds: [t2] });
  await ok(agent("Picard"), { op: "record_answer", project: "helix", ref: "Q-1", key: "a", words: "Bars" });
  return { r1, f1, t1, t2 };
}

/** An export with what changes between boards taken out: when, and the events' numbers. */
const comparable = (doc: BoardExportV1) => ({
  ...doc,
  exported_at: null,
  last_event_seq: null,
  projects: doc.projects.map((p) => ({ ...p, events: p.events.filter((e) => e.op !== "import").map(({ seq: _, undo_of: __, ...e }) => e) })),
});

/** A document made from elsewhere, as the Backlog.md import writes it. */
function document(project: Partial<ExportProject> = {}, items: Array<Partial<ExportItem> & { ref: string }> = []): BoardExportV1 {
  const item = (i: Partial<ExportItem> & { ref: string }): ExportItem => ({
    aliases: [],
    kind: "backlog",
    type: "task",
    status: "Draft",
    title: i.ref,
    description: null,
    notes: null,
    plan: null,
    parent: null,
    release: null,
    ord: null,
    open_since: null,
    archived_at: null,
    archive_reason: null,
    captured_by: null,
    captured_session: null,
    casper_words: null,
    capture_id: null,
    parent_hint: null,
    bug_where: null,
    blocks_use: false,
    found_in: null,
    labels: [],
    deps: [],
    criteria: [],
    created_at: at(0),
    updated_at: at(0),
    ...i,
  });
  return {
    format: "bobnet-board",
    version: 1,
    exported_at: at(0),
    source: "Backlog.md at bobnet 1234567",
    last_event_seq: 0,
    grants: [],
    events: [],
    projects: [
      {
        key: "bobnet",
        name: "BobNet",
        prefix: "BOB",
        draft_prefix: null,
        lead: null,
        po: null,
        repos: [],
        next: { item: 1, release: 1, question: 1, action: 1 },
        created_at: at(0),
        releases: [],
        items: items.map(item),
        sessions: [],
        questions: [],
        runs: [],
        pushes: [],
        ci_runs: [],
        grants: [],
        events: [],
        ...project,
      },
    ],
  };
}

describe("export (ADR 0001 §11)", () => {
  it("writes every table as rows with refs, in the protocol's shape, the same each time", async () => {
    const { r1, f1, t1, t2 } = await helix();
    const doc = await exported();
    const [p] = doc.projects;
    expect(p).toMatchObject({ key: "helix", prefix: "LAND", repos: ["helix"], next: { item: 4, release: 2, question: 2 } });
    expect(p!.items.map((i) => i.ref)).toEqual([f1, t1, t2]);
    expect(p!.items[0]).toMatchObject({ release: r1, labels: ["ui"], kind: "feature" });
    expect(p!.items[2]).toMatchObject({ parent: f1, deps: [t1] });
    expect(p!.runs).toMatchObject([{ id: "w_bill", session: { feature: f1, kind: "build", label: "1" }, ctx: [1000, 0x10000000], tasks: [t1], models: [{ model: "claude-opus-5-5", input: 1, output: 2, cache_read: 3, cache_write: 4 }] }]);
    expect(p!.pushes).toMatchObject([{ sha: "abc1234", run: "w_bill" }]);
    expect(p!.questions).toMatchObject([{ ref: "Q-1", state: "answered", holds: [{ item: t2 }], options: [{ key: "a", recommended: true }] }]);
    expect(p!.grants).toMatchObject([{ agent: "Picard", fields: ["content", "create", "status"] }]);
    expect(p!.events.find((e) => e.op === "update")).toMatchObject({ table: "items", record: t1, changes: [{ field: "status", old: "Draft", new: "Ready" }] });
    expect(doc.last_event_seq).toBe(Math.max(...p!.events.map((e) => e.seq)));
    expect(comparable(await exported())).toEqual(comparable(doc));
  });

  it("gives a laptop only the projects its read rules cover, and the owner every one", async () => {
    await helix();
    await ok(owner, { op: "create_project", key: "bobnet", name: "BobNet", prefix: "BOB" });
    const keys = async (by: Reader) => (await exported(by)).projects.map((p) => p.key);
    expect(await keys({ kind: "owner", email: "owner@example.com" })).toEqual(["bobnet", "helix"]);
    expect(await keys({ kind: "laptop", laptop: "mbp-1" })).toEqual(["helix"]);
    expect(await keys({ kind: "laptop", laptop: "mbp-2" })).toEqual([]);
    // A rule for every project gives every project, and its own rules go out with them.
    await ok(owner, { op: "grant", project: "*", agent: "Mario", laptop: "mbp-2", role: "lead", read: true, items: "none", fields: [] });
    const doc = await exported({ kind: "laptop", laptop: "mbp-2" });
    expect(doc.projects.map((p) => p.key)).toEqual(["bobnet", "helix"]);
    expect(doc.grants).toMatchObject([{ agent: "Mario", laptop: "mbp-2" }]);
    expect((await exported({ kind: "laptop", laptop: "mbp-3" })).grants).toEqual([]);
  });

  it("is a laptop's to fetch as JSON, by GET only", async () => {
    await helix();
    const res = await exports.default.fetch(`${ORIGIN}/v1/board/export`, { headers: { "cf-access-jwt-assertion": await laptopToken(1) } });
    expect(res.status).toBe(200);
    expect(BoardExportV1.parse(await res.json()).projects.map((p) => p.key)).toEqual(["helix"]);
    expect((await exports.default.fetch(`${ORIGIN}/v1/board/export`, { method: "POST", headers: { "cf-access-jwt-assertion": await laptopToken(1) } })).status).toBe(405);
    expect((await exports.default.fetch(`${ORIGIN}/v1/board/export`)).status).toBe(401);
  });
});

describe("import (ADR 0001 §11)", () => {
  it("rebuilds an empty board from its export, history kept, plus one event saying where it came from", async () => {
    const { f1 } = await helix();
    const doc = await exported();
    await reset();
    expect(await imported(doc)).toMatchObject({ ok: true, projects: [{ key: "helix", items: 3, next_item: 4 }] });
    const again = await exported();
    expect(comparable(again)).toEqual(comparable(doc));
    const added = again.projects[0]!.events.filter((e) => e.op === "import");
    expect(added).toMatchObject([{ table: "projects", record: "helix", actor: { kind: "board", who: "import@mbp-1" } }]);
    expect(added[0]!.reason).toContain("imported from BobNet's board");
    // The rebuilt board works: a session found by name, a run's context as it was.
    const got = await ok(owner, { op: "get", project: "helix", session: { feature: f1, kind: "build", label: "1" }, ctx: true });
    expect(got.session).toMatchObject({ runs: [{ id: "w_bill", calls: 2, ctx: [1000, 0x10000000] }] });
  });

  it("keeps a bug's fix, its release and the release tag through a round trip (ADR 0011 §6.6; review A M2)", async () => {
    const { f1 } = await helix();
    const bug = (await ok(agent("Picard"), { op: "capture", project: "helix", capture_id: "00000000-0000-4000-8000-000000000001", title: "Tracts don't load", type: "bug", blocks_use: true })).ref!;
    const session = { feature: f1, kind: "build" as const, label: "1" };
    const fix = "5d4617f4bed3884d73deb1a9cc71e1ed366215f4", tip = "6e151ac8a1b2c3d4e5f60718293a4b5c6d7e8f90";
    await ok(sup("Bill", session), { op: "push", project: "helix", repo: "helix", branch: "v2", sha: fix, fixes: [{ ref: bug, sha: fix, subject: "Tracts load" }] });
    await ok(sup("Bill", session), { op: "push", project: "helix", repo: "helix", branch: "v2", sha: tip });
    const serving: BoardCaller = { kind: "agent", name: "supervisor", laptop: "mbp-1", supervisor: true, ctx: null, serves: ["helix"] };
    await ok(serving, { op: "release_tag", repo: "helix", tag: "v1.0.0", sha: tip });
    await ok(serving, { op: "release_tag", repo: "helix", tag: "v1.0.1-never-pushed", sha: "f".repeat(40) });
    const doc = await exported();
    expect(doc.projects[0]!.fixes).toEqual([{ item: bug, sha: fix, subject: "Tracts load", push: `helix@${fix}`, release: "v1.0.0", at: expect.any(String) }]);
    expect(doc.projects[0]!.release_tags).toEqual([
      { repo: "helix", tag: "v1.0.0", sha: tip, push: `helix@${tip}`, at: expect.any(String) },
      { repo: "helix", tag: "v1.0.1-never-pushed", sha: "f".repeat(40), push: null, at: expect.any(String) },
    ]);
    await reset();
    await imported(doc);
    expect(comparable(await exported())).toEqual(comparable(doc));
    // The fixed bug still doesn't block, and says its release.
    const waits = (await ok(owner, { op: "waits", project: "helix" })).waits;
    expect(waits.find((w) => w.ref === bug)).toMatchObject({ blocking: false, fix: { sha: fix, release: "v1.0.0", tags_known: true } });
  });

  it("refuses a project the board has, by key or prefix, and writes nothing", async () => {
    await helix();
    const doc = await exported();
    expect(await imported(doc)).toMatchObject({ ok: false, code: "conflict" });
    const other = { ...doc, projects: [document().projects[0]!, { ...doc.projects[0]!, key: "helix2" }] };
    expect(await imported(other)).toMatchObject({ ok: false, code: "conflict" });
    expect((await ok(owner, { op: "projects" })).projects.map((p) => p.key)).toEqual(["helix"]);
  });

  it("starts every counter past every id it brings, aliases included (Toad, step 1)", async () => {
    const doc = document({ next: { item: 2, release: 1, question: 1, action: 1 }, questions: [] }, [
      { ref: "BOB-3", aliases: ["BOB-7.2", "LAND-40"] },
      { ref: "BOB-5" },
    ]);
    expect(await imported(doc)).toMatchObject({ ok: true, projects: [{ key: "bobnet", next_item: 8 }] });
    expect((await ok(owner, { op: "create", project: "bobnet", kind: "backlog", type: "task", title: "Next" })).ref).toBe("BOB-8");
    // An old id still finds its item, dotted or not; the reply names its ref.
    expect((await ok(owner, { op: "get", project: "bobnet", ref: "LAND-40" })).item).toMatchObject({ ref: "BOB-3" });
    expect((await ok(owner, { op: "get", project: "bobnet", ref: "BOB-7.2" })).item).toMatchObject({ ref: "BOB-3" });
  });

  it("keeps an imported dotted ref as the item's own: found, written and exported by it, and new items flat past it (ADR 0001 §2)", async () => {
    const doc = document({}, [
      { ref: "BOB-1", kind: "feature", type: "increment" },
      { ref: "BOB-1.1", kind: "task", parent: "BOB-1" },
      { ref: "BOB-1.2", kind: "task", parent: "BOB-1", deps: ["BOB-1.1"] },
      { ref: "BOB-1.10", kind: "task", parent: "BOB-1" },
    ]);
    expect(await imported(doc)).toMatchObject({ ok: true, projects: [{ key: "bobnet", items: 4, next_item: 2 }] });
    expect((await ok(owner, { op: "get", project: "bobnet", ref: "BOB-1.1" })).item).toMatchObject({ ref: "BOB-1.1", parent: "BOB-1" });
    expect((await ok(owner, { op: "update", project: "bobnet", ref: "BOB-1.10", set: { status: "Ready" } })).ref).toBe("BOB-1.10");
    expect((await ok(owner, { op: "get", project: "bobnet", ref: "BOB-1.2" })).item).toMatchObject({ deps: ["BOB-1.1"] });
    expect((await ok(owner, { op: "create", project: "bobnet", kind: "task", type: "task", title: "Next", parent: "BOB-1" })).ref).toBe("BOB-2");
    // A round trip keeps it, and a feature's tasks keep their order: export orders by pk.
    const out = await exported();
    expect(out.projects[0]!.items.map((i) => i.ref)).toEqual(["BOB-1", "BOB-1.1", "BOB-1.2", "BOB-1.10", "BOB-2"]);
    await reset();
    expect(await imported(out)).toMatchObject({ ok: true, projects: [{ key: "bobnet", items: 5, next_item: 3 }] });
    expect(comparable(await exported())).toEqual(comparable(out));
  });

  it("starts the history of an item that came over without events at its project's import, its tasks' merged in on ask (BOB-14 #5)", async () => {
    const doc = document({}, [
      { ref: "BOB-1", kind: "feature", type: "increment" },
      { ref: "BOB-1.1", kind: "task", parent: "BOB-1" },
    ]);
    expect(await imported(doc)).toMatchObject({ ok: true });
    await ok(owner, { op: "update", project: "bobnet", ref: "BOB-1.1", set: { status: "Ready" } });
    await ok(owner, { op: "update", project: "bobnet", ref: "BOB-1", set: { title: "Steps" } });
    const own = (await ok(owner, { op: "get", project: "bobnet", ref: "BOB-1", history: true })).history!;
    expect(own.map((e) => [e.op, e.record.table])).toEqual([["import", "projects"], ["update", "items"]]);
    expect(own[0]!.reason).toContain("imported from Backlog.md at bobnet 1234567");
    const all = (await ok(owner, { op: "get", project: "bobnet", ref: "BOB-1", history: true, with_tasks: true })).history!;
    expect(all.map((e) => [e.op, e.record.ref])).toEqual([["import", "bobnet"], ["update", "BOB-1.1"], ["update", "BOB-1"]]);
    // An item made in the service starts with its own creation.
    const made = (await ok(owner, { op: "create", project: "bobnet", kind: "backlog", type: "task", title: "Next" })).ref!;
    expect((await ok(owner, { op: "get", project: "bobnet", ref: made, history: true })).history!.map((e) => e.op)).toEqual(["create"]);
  });

  it("takes what the Backlog.md import writes (import review, finding 9; the supervisor's test pins the fixture)", async () => {
    expect(await imported(backlogImport)).toMatchObject({ ok: true, projects: [{ key: "bobnet", items: 8, next_item: 4 }] });
    // A dotted primary, a task under a task under its feature, a re-creation's old id, and a renumbered one.
    expect((await ok(owner, { op: "get", project: "bobnet", ref: "BOB-1.1.1" })).item).toMatchObject({ ref: "BOB-1.1.1", kind: "task", parent: "BOB-1" });
    expect((await ok(owner, { op: "get", project: "bobnet", ref: "BOB-1.3" })).item).toMatchObject({ ref: "BOB-2.1", parent: "BOB-2" });
    expect((await ok(owner, { op: "get", project: "bobnet", ref: "OLD-4" })).item).toMatchObject({ ref: "BOB-3", type: "bug" });
    expect((await ok(owner, { op: "get", project: "bobnet", ref: "BOB-1" })).item).toMatchObject({ kind: "feature", release: "R1" });
    expect((await ok(owner, { op: "create", project: "bobnet", kind: "backlog", type: "task", title: "Next" })).ref).toBe("BOB-4");
  });

  it("refuses Q and A as prefixes, an id twice, a link outside the document, and what isn't an export", async () => {
    expect(await imported(document({ prefix: "Q" }))).toMatchObject({ ok: false, code: "invalid" });
    expect(await imported(document({}, [{ ref: "BOB-1" }, { ref: "BOB-2", aliases: ["BOB-1"] }]))).toMatchObject({ ok: false, code: "invalid", message: expect.stringContaining("BOB-1 is the id of two items") });
    expect(await imported(document({}, [{ ref: "BOB-1", kind: "task", parent: "BOB-9" }]))).toMatchObject({ ok: false, code: "invalid", message: expect.stringContaining("BOB-9") });
    expect(await imported(document({}, [{ ref: "LAND-1" }]))).toMatchObject({ ok: false, code: "invalid" });
    expect(await imported({ format: "bobnet-board", version: 2 })).toMatchObject({ ok: false, code: "invalid" });
    // A lead or PO an answer can't reach (BOB-5 review, finding 1).
    expect(await imported(document({ lead: "Mario" }))).toMatchObject({ ok: false, code: "invalid", message: expect.stringContaining("lead Mario is not name@laptop") });
    expect(await imported(document({ po: "Peach@board" }))).toMatchObject({ ok: false, code: "invalid", message: expect.stringContaining("po Peach@board") });
    expect((await ok(owner, { op: "projects" })).projects).toEqual([]);
  });

  it("brings rules for every project from a laptop only into an empty board; the owner into one without any", async () => {
    const rule = { agent: "Mario", laptop: "*", role: "lead", read: true, items: "all" as const, fields: [], sessions: false, questions: false, admin: true };
    const global = { ...document(), grants: [rule] };
    await ok(owner, { op: "create_project", key: "other", name: "Other", prefix: "OTH" });
    expect(await imported(global)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await imported(global, { kind: "owner", email: "owner@example.com" })).toMatchObject({ ok: true });
    await reset();
    expect(await imported(global)).toMatchObject({ ok: true });
  });

  it("is posted as JSON by a laptop, or by the owner from the dashboard's own origin", async () => {
    const post = async (token: string, body: string, headers: Record<string, string> = {}) =>
      exports.default.fetch(`${ORIGIN}/v1/board/import`, { method: "POST", body, headers: { "cf-access-jwt-assertion": token, ...headers } });
    expect((await post(await ownerToken(), JSON.stringify(document()))).status).toBe(403);
    expect((await post(await laptopToken(1), "not json")).status).toBe(400);
    const res = await post(await laptopToken(1), JSON.stringify(document()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, projects: [{ key: "bobnet" }] });
    expect((await post(await ownerToken(), JSON.stringify(document()), { origin: ORIGIN })).status).toBe(409);
  });
});

describe("board migration 4: bobnet frees draft prefix DRAFT (ADR 0006)", () => {
  // BobNet as its BOB-14 import left it: draft prefix DRAFT; then migration 4 run again over it.
  const bobnet = (items: Array<Partial<ExportItem> & { ref: string }>) => imported(document({ draft_prefix: "DRAFT", next: { item: 9, release: 1, question: 1, action: 1 } }, items));
  const migrate4 = () => runInDurableObject(board(), (_, state) => void state.storage.sql.exec(BOARD_MIGRATIONS[3]!));
  const draftPrefix = async () => (await ok(owner, { op: "projects" })).projects.find((p) => p.key === "bobnet")!.draft_prefix;
  const helixDoc = () => document({ key: "helix", name: "Helix", prefix: "LAND", draft_prefix: "DRAFT", next: { item: 3, release: 1, question: 1, action: 1 } }, [{ ref: "LAND-1" }, { ref: "DRAFT-2" }]);

  it("clears it when no id of bobnet's is a DRAFT- one, with an event saying so; Helix's import then brings DRAFT-n", async () => {
    expect(await bobnet([{ ref: "BOB-1" }, { ref: "BOB-2", aliases: ["OLD-3"] }])).toMatchObject({ ok: true });
    expect(await imported(helixDoc())).toMatchObject({ ok: false, code: "conflict", message: "helix: a project with prefix DRAFT exists; an import brings new projects only" });
    await migrate4();
    expect(await draftPrefix()).toBeNull();
    const changes = await runInDurableObject(board(), (_, state) =>
      state.storage.sql
        .exec("SELECT e.actor_kind, e.actor, e.op, e.tbl, e.ref, c.field, c.old, c.new FROM events e JOIN event_changes c ON c.event = e.seq WHERE e.op = 'update_project'")
        .toArray(),
    );
    expect(changes).toEqual([{ actor_kind: "board", actor: "migration 4", op: "update_project", tbl: "projects", ref: "bobnet", field: "draft_prefix", old: "DRAFT", new: null }]);
    expect(await imported(helixDoc())).toMatchObject({ ok: true, projects: [{ key: "helix" }] });
    expect((await ok(owner, { op: "get", project: "helix", ref: "DRAFT-2" })).item).toMatchObject({ ref: "DRAFT-2" });
    expect((await ok(owner, { op: "projects" })).projects.find((p) => p.key === "helix")!.draft_prefix).toBe("DRAFT");
  });

  it("keeps it when an item of bobnet's is a DRAFT- one, or has had a DRAFT- id, and writes nothing", async () => {
    expect(await bobnet([{ ref: "BOB-1" }, { ref: "DRAFT-2" }])).toMatchObject({ ok: true });
    await migrate4();
    expect(await draftPrefix()).toBe("DRAFT");
    await reset();
    expect(await bobnet([{ ref: "BOB-1", aliases: ["DRAFT-4"] }])).toMatchObject({ ok: true });
    await migrate4();
    expect(await draftPrefix()).toBe("DRAFT");
    const n = await runInDurableObject(board(), (_, state) => state.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM events WHERE op = 'update_project'").one().n);
    expect(n).toBe(0);
  });
});

describe("board migration 5: grant field 'release' (BOB-122)", () => {
  it("keeps every rule's fields and lets a rule take 'release'", async () => {
    await ok(owner, { op: "create_project", key: "helix", name: "Helix", prefix: "LAND" });
    await ok(owner, { op: "grant", project: "helix", agent: "Picard", role: "PO", read: true, items: "all", fields: ["status", "triage"] });
    // The table as it was before migration 5, then migration 5 over it.
    await runInDurableObject(board(), (_, state) => {
      const sql = state.storage.sql;
      sql.exec(`DROP TABLE grant_fields;
        CREATE TABLE grant_fields (
          grant_pk INTEGER NOT NULL REFERENCES grants (pk) ON DELETE CASCADE,
          field    TEXT NOT NULL CHECK (field IN ('status', 'order', 'content', 'criteria', 'triage', 'create')),
          PRIMARY KEY (grant_pk, field)
        );
        INSERT INTO grant_fields (grant_pk, field) SELECT pk, 'status' FROM grants;
        INSERT INTO grant_fields (grant_pk, field) SELECT pk, 'triage' FROM grants;`);
      expect(() => sql.exec("INSERT INTO grant_fields (grant_pk, field) SELECT pk, 'release' FROM grants")).toThrow(/CHECK constraint failed/);
      sql.exec(BOARD_MIGRATIONS[4]!);
    });
    const fields = async () => (await ok(owner, { op: "grants", project: "helix" })).grants.find((g) => g.agent === "Picard")!.fields;
    expect(await fields()).toEqual(["status", "triage"]);
    await ok(owner, { op: "grant", project: "helix", agent: "Picard", role: "PO", read: true, items: "all", fields: ["status", "triage", "release"] });
    expect(await fields()).toEqual(["release", "status", "triage"]);
    await ok(owner, { op: "revoke", project: "helix", agent: "Picard" });
    expect(await runInDurableObject(board(), (_, state) => state.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM grant_fields").one().n)).toBe(0);
  });
});
