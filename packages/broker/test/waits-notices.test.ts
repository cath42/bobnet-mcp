import type { BoardNoticeEvent, ServerFrame } from "@bobnet/protocol";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { BoardStore } from "../src/board/store.ts";
import { agent, Client, laptopToken, ORIGIN, ownerToken } from "./helpers.ts";

// A fix's and a stale row's notices, drained by the broker (ADR 0011 §1, §2, §4; BOB-49): the text to the
// row's owner, the JSON to the project's supervisor, once each.

type Deliver = Extract<ServerFrame, { t: "deliver" }>;
const deliver = (f: ServerFrame): f is Deliver => f.t === "deliver";
const network = () => env.BROKER.getByName("network");
const boardDo = () => env.BOARD.getByName("board");
const H = 60 * 60 * 1000;
const FIX = "5d4617f4bed3884d73deb1a9cc71e1ed366215f4";

/** The Board's store on a clock the test moves: `clock.t` is now. */
async function moveableClock(): Promise<{ t: number }> {
  const clock = { t: Date.now() };
  await runInDurableObject(boardDo(), (instance, state) => {
    (instance as unknown as { store: BoardStore }).store = new BoardStore(state.storage.sql, () => clock.t);
  });
  return clock;
}

/** Helix, led by Mario@mbp-2 with Riker@mbp-1 its PO, and poe@mbp-1 its supervisor. */
async function helix(): Promise<{ o: Client; poe: Client }> {
  const o = await Client.open(await ownerToken(), { origin: ORIGIN });
  await o.request({ t: "board_op", op: { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", lead: "Mario@mbp-2", po: "Riker@mbp-1", repos: ["cath42/helix"] } });
  await o.request({ t: "board_op", op: { op: "grant", project: "helix", agent: "Picard", role: "dev", read: true, items: "none", fields: [], questions: true } });
  const poe = await Client.open(await laptopToken(1));
  await poe.request({ t: "register", name: "poe", supervisor: true, projects: ["helix"] });
  return { o, poe };
}

const audits = (action: string) =>
  runInDurableObject(network(), (_, state) => state.storage.sql.exec<{ detail: string }>("SELECT detail FROM audit WHERE action = ?", action).toArray().map((r) => JSON.parse(r.detail) as unknown));

describe("a stale row's notice (ADR 0011 §2; BOB-49 AC2)", () => {
  it("goes out on the alarm, past a day, to the asker and the supervisor, once", async () => {
    const clock = await moveableClock();
    const { poe } = await helix();
    const picard = await agent(1, "Picard");
    await picard.request({ t: "board_op", as: "Picard", op: { op: "ask", project: "helix", text: "Which chart?" } });

    clock.t += 23 * H;
    await runDurableObjectAlarm(network());
    expect(await picard.never(deliver)).toBe(true);

    clock.t += 2 * H;
    await runDurableObjectAlarm(network());
    const got = await picard.next(deliver);
    expect(got).toMatchObject({ to: "Picard@mbp-1", msg: { from: "BobNet@board", to: ["Picard@mbp-1"] } });
    expect(got.msg.body).toMatch(/^Q-1 \(helix\) has waited on Casper for 25 h unchanged since .*keep it \(board_write keep, with why\)/);
    const json = await poe.next(deliver);
    expect(json.msg.id).toBe(`${got.msg.id}_s`);
    expect(JSON.parse(json.msg.body) as BoardNoticeEvent).toMatchObject({ v: 2, event: "board_notice", project: "helix", ref: "Q-1", kind: "stale", to: ["Picard@mbp-1"], lead: "Mario@mbp-2", asked_by: "Picard@mbp-1" });

    // The next hour's alarm sends nothing more.
    clock.t += H;
    await runDurableObjectAlarm(network());
    expect(await picard.never(deliver)).toBe(true);
    expect(await poe.never(deliver)).toBe(true);
  });

  it("sends nothing for a row with no owner, and audits it", async () => {
    const clock = await moveableClock();
    const { o } = await helix();
    await o.request({ t: "board_op", op: { op: "ask", project: "helix", text: "Mine?" } });
    clock.t += 25 * H;
    await runDurableObjectAlarm(network());
    expect(await audits("wait:no_owner")).toEqual([{ project: "helix", ref: "Q-1" }]);
    expect(await audits("board_message")).toEqual([]);
  });
});

describe("a landed fix's notice (ADR 0011 §1; BOB-49 AC1)", () => {
  it("reaches the PO with the sha, and the supervisor with the JSON, from the push's write", async () => {
    const { o, poe } = await helix();
    await o.request({ t: "board_op", op: { op: "capture", project: "helix", capture_id: "00000000-0000-4000-8000-000000000001", title: "Crashes", type: "bug", blocks_use: true } });
    const riker = await agent(1, "Riker");
    const ctx = { worker: "w_1", role: "dev", project: "helix", session: null, tasks: [] };
    const pushed = await poe.request({
      t: "board_op",
      as: "poe",
      ctx,
      op: { op: "push", project: "helix", repo: "cath42/helix", branch: "main", sha: FIX, fixes: [{ ref: "LAND-1", sha: FIX, subject: "main: LAND-1: no crash" }] },
    });
    expect(pushed).toMatchObject({ fixed: ["LAND-1"], fixes_ignored: [] });
    const got = await riker.next(deliver);
    expect(got).toMatchObject({ to: "Riker@mbp-1", msg: { from: "BobNet@board", to: ["Riker@mbp-1"] } });
    expect(got.msg.body).toBe(`LAND-1's fix landed: 5d4617f "main: LAND-1: no crash", by w_1. Check it and close LAND-1: tick its criterion with the commit as evidence, then move it to Done.`);
    expect(JSON.parse((await poe.next(deliver)).msg.body)).toMatchObject({ event: "board_notice", kind: "fix_landed", ref: "LAND-1", asked_by: "Riker@mbp-1" });
  });
});
