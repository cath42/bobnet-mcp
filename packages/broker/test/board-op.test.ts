import type { BoardCtx, GrantField, ServerFrame } from "@bobnet/protocol";
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
