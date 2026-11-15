import { BoardExportV1, type BoardCaller, type BoardCtx, type BoardOpInput, type BoardReply, type BoardResults, type ExportItem, type ExportProject, type Identity } from "@bobnet/protocol";
import { reset } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
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

const exported = async (by: Identity = { kind: "owner", email: "owner@example.com" }) => BoardExportV1.parse(await board().exportBoard(by));
const imported = async (doc: unknown, by: Identity = { kind: "laptop", laptop: "mbp-1" }) => board().importBoard(by, doc);

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
  await ok(sup("Bill", session), { op: "run_end", project: "helix", id: "w_bill", ended_at: at(5), tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 }, calls: 2, ctx: [1000, 0x10000000] });
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
    expect(p!.runs).toMatchObject([{ id: "w_bill", session: { feature: f1, kind: "build", label: "1" }, ctx: [1000, 0x10000000], tasks: [t1] }]);
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
    const keys = async (by: Identity) => (await exported(by)).projects.map((p) => p.key);
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
    const got = await ok(owner, { op: "get", project: "helix", session: { feature: f1, kind: "build", label: "1" } });
    expect(got.session).toMatchObject({ runs: [{ id: "w_bill", calls: 2 }] });
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
