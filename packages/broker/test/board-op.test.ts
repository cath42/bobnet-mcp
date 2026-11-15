import type { BoardCtx, GrantField, ServerFrame } from "@bobnet/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { agent, Client, errorCode, laptopToken, ORIGIN, ownerToken } from "./helpers.ts";

// board_op through the broker (ADR 0001 §1, §4, §8): the caller it verified, the
// reply to the caller's socket, and board_changed to the owners.

type Changed = Extract<ServerFrame, { t: "board_changed" }>;
const changed = (f: ServerFrame): f is Changed => f.t === "board_changed";

async function owner(): Promise<Client> {
  return Client.open(await ownerToken(), { origin: ORIGIN });
}

/** Helix, with Riker as its session PO and Bill as a builder. */
async function helix(o: Client): Promise<void> {
  await o.request({ t: "board_op", op: { op: "create_project", key: "helix", name: "Helix", prefix: "LAND" } });
  await o.request({ t: "board_op", op: { op: "create", project: "helix", kind: "feature", type: "increment", title: "Roadmap" } });
  await o.request({ t: "board_op", op: { op: "create", project: "helix", kind: "task", type: "task", title: "Draw it", parent: "LAND-1" } });
  const po = { read: true, fields: ["status", "content", "criteria"] as GrantField[] };
  await o.request({ t: "board_op", op: { op: "grant", project: "helix", agent: "Riker", role: "session PO", items: "open_feature", ...po } });
  await o.request({ t: "board_op", op: { op: "grant", project: "helix", agent: "Bill", role: "builder", read: true, items: "none", fields: [] } });
  // The session opens as a spawn opens it: by the supervisor of a laptop (here the other one), for its worker.
  const sup = await Client.open(await laptopToken(2));
  await sup.request({ t: "register", name: "supervisor", supervisor: true });
  await sup.request({ t: "board_op", as: "supervisor", ctx: { ...ctx, worker: "w_spawn" }, op: { op: "session_join", project: "helix", session: ctx.session! } });
  sup.ws.close();
}

const ctx: BoardCtx = { worker: "w_7", role: "po", project: "helix", session: { feature: "LAND-1", kind: "build", label: "1" }, tasks: ["LAND-2"] };

describe("board_op", () => {
  it("runs the owner's operation as the owner and tells the owners what changed", async () => {
    const o = await owner();
    await expect(o.request({ t: "board_op", op: { op: "create_project", key: "helix", name: "Helix", prefix: "LAND" } })).resolves.toEqual({ ref: "helix", seq: 1 });
    await expect(o.next(changed)).resolves.toEqual({ t: "board_changed", project: "helix", seq: 1, refs: ["helix"] });
    expect(await errorCode(o.request({ t: "board_op", op: { op: "get", project: "helix", ref: "LAND-1" } }))).toBe("invalid");
  });

  it("runs a peer's operation as that peer, stamped with its supervisor's ctx", async () => {
    const o = await owner();
    await helix(o);
    const sup = await agent(1, "supervisor");
    await sup.request({ t: "register", name: "supervisor", supervisor: true });
    await sup.request({ t: "register", name: "Riker" });
    await sup.request({ t: "board_op", as: "Riker", ctx, op: { op: "update", project: "helix", ref: "LAND-2", set: { status: "In Progress" } } });
    const { history } = await o.request({ t: "board_op", op: { op: "get", project: "helix", ref: "LAND-2", history: true } });
    expect(history.at(-1)).toMatchObject({
      actor: { kind: "agent", who: "Riker@mbp-1", role: "po", worker: "w_7", session: { feature: "LAND-1", kind: "build", label: "1" } },
      changes: [{ field: "status", old: "Draft", new: "In Progress" }],
    });
    await sup.request({ t: "board_op", as: "Riker", ctx, op: { op: "run_start", project: "helix", id: "w_7", started_at: "2026-11-14T10:00:00.000Z", session: ctx.session } });
  });

  it("takes ctx, and the supervisor's operations, only over the laptop's pinned supervisor connection", async () => {
    const o = await owner();
    await helix(o);
    const sup = await agent(1, "supervisor");
    await sup.request({ t: "register", name: "supervisor", supervisor: true });
    // Riker on a connection of its own: the laptop's token, but not its supervisor.
    const riker = await agent(1, "Riker");
    const refused = riker.request({ t: "board_op", as: "Riker", ctx, op: { op: "update", project: "helix", ref: "LAND-2", set: { status: "In Progress" } } });
    await expect(refused).rejects.toMatchObject({ code: "forbidden", message: expect.stringMatching(/^Riker may not change status on LAND-2 in helix \(LAND-1 is open\)/) });
    const start = { op: "run_start" as const, project: "helix", id: "w_7", started_at: "2026-11-14T10:00:00.000Z", session: ctx.session };
    await expect(riker.request({ t: "board_op", as: "Riker", ctx, op: start })).rejects.toMatchObject({ code: "forbidden" });
    await expect(sup.request({ t: "board_op", as: "supervisor", ctx, op: start })).resolves.toMatchObject({ ref: "w_7" });
  });

  it("answers a refusal with its code and reason, and pushes nothing", async () => {
    const o = await owner();
    await helix(o);
    while (!(await o.never(changed, 50)));
    const bill = await agent(1, "Bill");
    const refused = bill.request({ t: "board_op", as: "Bill", op: { op: "update", project: "helix", ref: "LAND-2", set: { status: "Done" } } });
    await expect(refused).rejects.toMatchObject({ code: "forbidden", message: "Bill may not change status on LAND-2 in helix; Riker on the open feature may" });
    expect(await o.never(changed)).toBe(true);
  });

  it("acts only as a peer the connection hosts, and the owner as no peer", async () => {
    const o = await owner();
    await helix(o);
    await agent(1, "Riker");
    const other = await agent(1, "Bill");
    expect(await errorCode(other.request({ t: "board_op", as: "Riker", op: { op: "projects" } }))).toBe("not_hosted");
    expect(await errorCode(other.request({ t: "board_op", op: { op: "projects" } }))).toBe("bad_frame");
    expect(await errorCode(o.request({ t: "board_op", as: "Riker", op: { op: "projects" } }))).toBe("bad_frame");
    expect(await errorCode(other.request({ t: "board_op", as: "Bill", op: { op: "update", project: "helix", ref: "LAND-2", set: { status: "Blocked" } } as never }))).toBe("bad_frame");
  });

  it("keeps a write whose caller's name is taken over while the board runs it", async () => {
    const o = await owner();
    await helix(o);
    while (!(await o.never(changed, 50)));
    const before = await Client.open(await laptopToken(1));
    await before.request({ t: "register", name: "supervisor", supervisor: true, instance: "proc-abc123" });
    await before.request({ t: "register", name: "Riker", instance: "proc-abc123" });
    const after = await Client.open(await laptopToken(1));
    const closed = new Promise<number>((resolve) => before.ws.addEventListener("close", (e) => resolve(e.code)));

    // The write goes out, and the same process's new socket takes the name before or while the board answers.
    before.raw(JSON.stringify({ t: "board_op", rid: "w1", as: "Riker", ctx, op: { op: "update", project: "helix", ref: "LAND-2", set: { status: "In Review" } } }));
    await after.request({ t: "register", name: "Riker", instance: "proc-abc123" });
    expect(await closed).toBe(4001);

    // The board committed it: the owners hear of it, and the name's new holder reads it.
    await expect(o.next(changed)).resolves.toMatchObject({ project: "helix", refs: ["LAND-2"] });
    const { item } = await after.request({ t: "board_op", as: "Riker", ctx, op: { op: "get", project: "helix", ref: "LAND-2" } });
    expect(item.status).toBe("In Review");
    // And the broker carries on routing.
    await expect(after.request({ t: "peers" })).resolves.toMatchObject({ peers: expect.arrayContaining([expect.objectContaining({ name: "Riker", online: true })]) });
  });
});

describe("the board's messages (ADR 0001 §7)", () => {
  it("stores and delivers an answer from BobNet@board to the lead and the asker, online or not yet registered", async () => {
    const o = await owner();
    await o.request({ t: "board_op", op: { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", lead: "Mario@mbp-2" } });
    await o.request({ t: "board_op", op: { op: "grant", project: "helix", agent: "Picard", role: "lead", read: true, items: "none", fields: [], questions: true } });
    const picard = await agent(1, "Picard");
    await picard.request({ t: "board_op", as: "Picard", op: { op: "ask", project: "helix", text: "Which chart?", options: [{ key: "a", text: "Bars" }] } });

    const { seq } = await o.request({ t: "board_op", op: { op: "answer_question", project: "helix", ref: "Q-1", key: "a", words: "Bars" } });
    const got = await picard.next((f) => f.t === "deliver");
    expect(got).toMatchObject({ to: "Picard@mbp-1", wake: true, msg: { type: "message", from: "BobNet@board", laptop: "board", to: ["Mario@mbp-2", "Picard@mbp-1"] } });
    if (got.t !== "deliver") throw new Error("not a delivery");
    expect(got.msg.body).toContain("Bars");
    expect((await o.next((f) => f.t === "traffic")) as unknown).toMatchObject({ item: { from: "BobNet@board" } });

    // Mario, the lead, registers later: the answer and the undo's second message wait for him.
    await o.request({ t: "board_op", op: { op: "undo", project: "helix", seq } });
    await picard.next((f) => f.t === "deliver" && /withdr/i.test(f.msg.body));
    const mario = await Client.open(await laptopToken(2));
    await expect(mario.request({ t: "register", name: "Mario" })).resolves.toMatchObject({ queued: 2 });
    const first = await mario.next((f) => f.t === "deliver");
    const second = await mario.next((f) => f.t === "deliver");
    expect([first, second].map((f) => (f.t === "deliver" ? f.msg.from : null))).toEqual(["BobNet@board", "BobNet@board"]);
  });

  it("delivers a keyed answer's message again when the answer is resent with its key", async () => {
    const o = await owner();
    await o.request({ t: "board_op", op: { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", lead: "Picard@mbp-1" } });
    await o.request({ t: "board_op", op: { op: "ask", project: "helix", text: "Which chart?" } });
    const picard = await agent(1, "Picard");
    const answer = { t: "board_op", key: "0f6c1e2a-answer", op: { op: "answer_question", project: "helix", ref: "Q-1", words: "Bars" } } as const;
    const first = await o.request(answer);
    await picard.next((f) => f.t === "deliver");
    // As if the first reply was lost: the same key answers the same result, and the lead is told again.
    expect(await o.request(answer)).toEqual(first);
    const again = await picard.next((f) => f.t === "deliver");
    expect(again.t === "deliver" && again.msg.body).toContain("Bars");
  });

  it("sends nothing for a refused answer", async () => {
    const o = await owner();
    await o.request({ t: "board_op", op: { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", lead: "Picard@mbp-1" } });
    const picard = await agent(1, "Picard");
    expect(await errorCode(o.request({ t: "board_op", op: { op: "answer_question", project: "helix", ref: "Q-1", words: "Yes" } }))).toBe("invalid");
    expect(await picard.never((f) => f.t === "deliver")).toBe(true);
  });

  it("takes a supervisor's CI run only for a project it registered as on the service (ADR 0001 §10)", async () => {
    const o = await owner();
    await helix(o);
    const run = { op: "ci_run" as const, project: "helix", external_id: "55-1", name: "CI", status: "running" as const };
    const sup = await agent(1, "supervisor");
    // An older supervisor registers no projects: it reports no CI runs.
    await sup.request({ t: "register", name: "supervisor", supervisor: true });
    const projects = () =>
      runInDurableObject(env.BROKER.getByName("network"), (_, state) => state.storage.sql.exec("SELECT projects FROM laptop_supervisors WHERE laptop = 'mbp-1'").toArray());
    expect(await projects()).toEqual([{ projects: null }]);
    await expect(sup.request({ t: "board_op", as: "supervisor", op: run })).rejects.toMatchObject({ code: "forbidden", message: expect.stringMatching(/didn't register helix/) });
    // Registered again with helix: the list is replaced, and the run is the gh adapter's, with no worker.
    await sup.request({ t: "register", name: "supervisor", supervisor: true, projects: ["helix"] });
    await expect(sup.request({ t: "board_op", as: "supervisor", op: run })).resolves.toMatchObject({ ref: "github-actions 55-1", tied: null });
    expect(await projects()).toEqual([{ projects: '["helix"]' }]);
    // The history names the supervisor that reported it.
    const events = await runInDurableObject(env.BOARD.getByName("board"), (_, state) =>
      state.storage.sql.exec("SELECT actor_kind, actor FROM events WHERE tbl = 'ci_runs'").toArray(),
    );
    expect(events).toEqual([{ actor_kind: "ci", actor: "github-actions via supervisor@mbp-1" }]);
    await expect(sup.request({ t: "board_op", as: "supervisor", op: { ...run, project: undefined } })).rejects.toMatchObject({ code: "invalid" });
    // A peer on another connection is not the supervisor, whatever it registered.
    const riker = await agent(1, "Riker");
    await expect(riker.request({ t: "board_op", as: "Riker", op: run })).rejects.toMatchObject({ code: "forbidden" });
    await sup.request({ t: "register", name: "supervisor", supervisor: true, projects: [] });
    await expect(sup.request({ t: "board_op", as: "supervisor", op: { ...run, status: "passed" } })).rejects.toMatchObject({ code: "forbidden" });
  });
});
