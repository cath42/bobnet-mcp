import type { BoardAnswerEvent, ServerFrame } from "@bobnet/protocol";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { agent, Client, laptopToken, ORIGIN, ownerToken } from "./helpers.ts";

// An answer's notice, drained by the broker (ADR 0009 §1, §2, §5; BOB-111 AC1, AC3): the text to the
// lead and the asker, the JSON to the project's supervisor, once per answer.

type Deliver = Extract<ServerFrame, { t: "deliver" }>;
const deliver = (f: ServerFrame): f is Deliver => f.t === "deliver";
const network = () => env.BROKER.getByName("network");
const boardDo = () => env.BOARD.getByName("board");

async function owner(): Promise<Client> {
  return Client.open(await ownerToken(), { origin: ORIGIN });
}

/** Helix, led by `lead`, with LAND-1 and its session build 1; Picard@mbp-1 asks Q-1, holding both, and Q-2, holding the session too. */
async function helix(o: Client, lead = "Mario@mbp-2"): Promise<Client> {
  await o.request({ t: "board_op", op: { op: "create_project", key: "helix", name: "Helix", prefix: "LAND", lead } });
  await o.request({ t: "board_op", op: { op: "create", project: "helix", kind: "feature", type: "increment", title: "Roadmap" } });
  await o.request({ t: "board_op", op: { op: "grant", project: "helix", agent: "Picard", role: "lead", read: true, items: "none", fields: [], questions: true } });
  await o.request({ t: "board_op", op: { op: "grant", project: "helix", agent: "Riker", role: "po", read: true, items: "none", fields: [], questions: true } });
  const session = { feature: "LAND-1", kind: "build" as const, label: "1" };
  const sup = await Client.open(await laptopToken(2));
  await sup.request({ t: "register", name: "opener", supervisor: true });
  await sup.request({ t: "board_op", as: "opener", ctx: { worker: "w_1", role: "dev", project: "helix", session, tasks: [] }, op: { op: "session_join", project: "helix", session } });
  sup.close();
  // The opener served no project: it is no candidate for helix's notices.
  const picard = await agent(1, "Picard");
  await picard.request({ t: "board_op", as: "Picard", op: { op: "ask", project: "helix", text: "Which chart?", options: [{ key: "a", text: "Bars" }], holds: ["LAND-1"], holds_sessions: [session] } });
  await picard.request({ t: "board_op", as: "Picard", op: { op: "ask", project: "helix", text: "Which colour?", holds_sessions: [session] } });
  return picard;
}

/** A supervisor on laptop `n` that serves `projects`. */
async function supervisor(n: 1 | 2, projects: string[] = ["helix"]): Promise<Client> {
  const c = await Client.open(await laptopToken(n));
  await c.request({ t: "register", name: "poe", supervisor: true, projects });
  return c;
}

const audits = (action: string) =>
  runInDurableObject(network(), (_, state) => state.storage.sql.exec<{ actor: string; detail: string }>("SELECT actor, detail FROM audit WHERE action = ?", action).toArray());
const stored = (id: string) => runInDurableObject(network(), (_, state) => state.storage.sql.exec("SELECT id FROM messages WHERE id = ?", id).toArray().length);
const untaken = () => runInDurableObject(boardDo(), (_, state) => state.storage.sql.exec<{ seq: number }>("SELECT seq FROM notices WHERE taken_at IS NULL").toArray().map((r) => r.seq));

describe("an answer's notice (ADR 0009; BOB-111 AC1)", () => {
  it("reaches the asker with the project, ref, key, words and holds, and the supervisor with the JSON; the reply says who", async () => {
    const o = await owner();
    const picard = await helix(o);
    const poe = await supervisor(1);
    const res = await o.request({ t: "board_op", op: { op: "answer_question", project: "helix", ref: "Q-1", key: "a", words: "Bars, thin" } });
    // Mario, the lead, isn't online: told, and waiting for him.
    expect(res).toEqual({ ref: "Q-1", seq: expect.any(Number), told: ["Mario@mbp-2", "Picard@mbp-1", "poe@mbp-1"], waiting: ["Mario@mbp-2"], supervisor: "poe@mbp-1" });

    const got = await picard.next(deliver);
    expect(got).toMatchObject({ to: "Picard@mbp-1", wake: true, msg: { id: `m_board_${res.seq}`, from: "BobNet@board", to: ["Mario@mbp-2", "Picard@mbp-1"] } });
    for (const part of ["Casper answered Q-1 (helix)", "Option a: Bars", "His words: Bars, thin", "Holds: LAND-1; session LAND-1 build 1", "Still held by: Q-2 (session LAND-1 build 1)"])
      expect(got.msg.body).toContain(part);

    const json = await poe.next(deliver);
    expect(json).toMatchObject({ to: "poe@mbp-1", wake: true, msg: { id: `m_board_${res.seq}_s`, from: "BobNet@board", to: ["poe@mbp-1"] } });
    expect(JSON.parse(json.msg.body) as BoardAnswerEvent).toMatchObject({
      v: 2, event: "answer", seq: res.seq, project: "helix", ref: "Q-1", state: "answered", key: "a", option: "Bars", words: "Bars, thin", by: "owner", via: "dashboard",
      holds: { items: ["LAND-1"], sessions: [{ feature: "LAND-1", kind: "build", label: "1" }] }, still_held: [{ session: { feature: "LAND-1", kind: "build", label: "1" }, by: ["Q-2"] }],
    });
    expect(json.msg.body).not.toMatch(/owner@example\.com/i);
    expect(await untaken()).toEqual([]);

    // The offline lead gets it when he registers.
    const mario = await Client.open(await laptopToken(2));
    await expect(mario.request({ t: "register", name: "Mario" })).resolves.toMatchObject({ queued: 1 });
    expect(await mario.next(deliver)).toMatchObject({ msg: { id: `m_board_${res.seq}` } });
  });

  it("delivers an answer recorded with board_ask answer the same way, never to its recorder", async () => {
    const o = await owner();
    const picard = await helix(o);
    const poe = await supervisor(1);
    const riker = await agent(1, "Riker");
    const res = await riker.request({ t: "board_op", as: "Riker", op: { op: "record_answer", project: "helix", ref: "Q-1", key: "a", words: "Bars" } });
    expect(res).toMatchObject({ told: ["Mario@mbp-2", "Picard@mbp-1", "poe@mbp-1"], supervisor: "poe@mbp-1" });
    expect((await picard.next(deliver)).msg.body).toContain("recorded by Riker@mbp-1");
    expect(JSON.parse((await poe.next(deliver)).msg.body)).toMatchObject({ by: "Riker@mbp-1", via: "conversation" });
    expect(await riker.never(deliver)).toBe(true);
  });

  it("tells no supervisor when none serves the project, and says so", async () => {
    const o = await owner();
    await helix(o);
    await supervisor(1, ["other"]);
    const res = await o.request({ t: "board_op", op: { op: "answer_question", project: "helix", ref: "Q-1", key: "a" } });
    expect(res).toMatchObject({ told: ["Mario@mbp-2", "Picard@mbp-1"], supervisor: null });
  });

  it("tells only the supervisor on the lead's laptop when several serve the project; else the asker's; else nobody, audited", async () => {
    const o = await owner();
    const picard = await helix(o);
    const one = await supervisor(1);
    const two = await supervisor(2);
    // The lead, Mario, is on mbp-2.
    expect(await o.request({ t: "board_op", op: { op: "answer_question", project: "helix", ref: "Q-1", key: "a" } })).toMatchObject({ supervisor: "poe@mbp-2" });
    const toTwo = await two.next(deliver);
    expect(JSON.parse(toTwo.msg.body)).toMatchObject({ ref: "Q-1" });
    expect(await one.never(deliver)).toBe(true);
    two.raw(JSON.stringify({ t: "ack", as: "poe", ids: [toTwo.msg.id] }));
    await picard.next(deliver);

    // A lead on a laptop no supervisor serves helix from: the asker's, Picard's on mbp-1.
    await o.request({ t: "board_op", op: { op: "create_project", key: "solo", name: "Solo", prefix: "SOLO", lead: "Mario@mbp-9" } });
    await o.request({ t: "board_op", op: { op: "grant", project: "solo", agent: "Picard", role: "lead", read: true, items: "none", fields: [], questions: true } });
    await one.request({ t: "register", name: "poe", supervisor: true, projects: ["helix", "solo"] });
    await two.request({ t: "register", name: "poe", supervisor: true, projects: ["helix", "solo"] });
    await picard.request({ t: "board_op", as: "Picard", op: { op: "ask", project: "solo", text: "Alone?" } });
    expect(await o.request({ t: "board_op", op: { op: "answer_question", project: "solo", ref: "Q-1", words: "Yes" } })).toMatchObject({ supervisor: "poe@mbp-1" });
    expect(await two.never(deliver)).toBe(true);

    // Asked by the owner, led from mbp-9: neither rule picks one.
    await o.request({ t: "board_op", op: { op: "ask", project: "solo", text: "Mine?" } });
    const res = await o.request({ t: "board_op", op: { op: "answer_question", project: "solo", ref: "Q-2", words: "Yes" } });
    expect(res).toMatchObject({ told: ["Mario@mbp-9"], supervisor: null });
    expect((await audits("notice:no_supervisor")).map((a) => ({ ...a, detail: JSON.parse(a.detail) }))).toEqual([
      { actor: "board", detail: { seq: res.seq, project: "solo", serving: ["poe@mbp-1", "poe@mbp-2"] } },
    ]);
  });
});

describe("sent once per answer (ADR 0009 §1; BOB-111 AC3)", () => {
  it("redelivers the same message id on a reconnect", async () => {
    const o = await owner();
    const picard = await helix(o);
    const { seq } = await o.request({ t: "board_op", op: { op: "answer_question", project: "helix", ref: "Q-1", key: "a" } });
    expect((await picard.next(deliver)).msg.id).toBe(`m_board_${seq}`);
    // Not acked: the next register delivers the same id, which the client dedupes.
    picard.close();
    const again = await agent(1, "Picard");
    expect((await again.next(deliver)).msg.id).toBe(`m_board_${seq}`);
  });

  it("sends a withdrawal as its own notice, not the answer again, and nothing for an edit", async () => {
    const o = await owner();
    const picard = await helix(o);
    const poe = await supervisor(1);
    const answered = await o.request({ t: "board_op", op: { op: "answer_question", project: "helix", ref: "Q-1", key: "a", words: "Bars" } });
    await picard.next(deliver);
    await poe.next(deliver);
    const undone = await o.request({ t: "board_op", op: { op: "undo", project: "helix", seq: answered.seq } });
    expect(undone).toMatchObject({ told: ["Mario@mbp-2", "Picard@mbp-1", "poe@mbp-1"], supervisor: "poe@mbp-1" });
    const note = await picard.next(deliver);
    expect(note.msg.id).toBe(`m_board_${undone.seq}`);
    expect(note.msg.body).toMatch(/withdrew his answer to Q-1/);
    expect(JSON.parse((await poe.next(deliver)).msg.body)).toMatchObject({ state: "withdrawn", key: "a", words: "Bars" });
    expect(await picard.never(deliver)).toBe(true);

    await picard.request({ t: "board_op", as: "Picard", op: { op: "edit_question", project: "helix", ref: "Q-1", set: { text: "Which chart, really?" } } });
    expect(await picard.never(deliver)).toBe(true);
    expect(await poe.never(deliver)).toBe(true);
  });

  it("answers a keyed answer's resend with the same reply, and stores nothing more", async () => {
    const o = await owner();
    const picard = await helix(o);
    const answer = { t: "board_op", key: "0f6c1e2a-answer", op: { op: "answer_question", project: "helix", ref: "Q-1", words: "Bars" } } as const;
    const first = await o.request(answer);
    await picard.next(deliver);
    // As if the first reply was lost: the same key answers whom it told, and nobody is told twice.
    expect(await o.request(answer)).toEqual(first);
    expect(await picard.never(deliver)).toBe(true);
  });

  it("stores a notice once when a drain ends before marking it taken, and marks it on the next drain", async () => {
    const o = await owner();
    const picard = await helix(o);
    // noticesTaken fails, as if the broker restarted between the store and the mark.
    await runInDurableObject(boardDo(), (_, state) => {
      state.storage.sql.exec("CREATE TRIGGER no_mark BEFORE UPDATE ON notices BEGIN SELECT RAISE(ABORT, 'no mark'); END");
    });
    const { seq } = await o.request({ t: "board_op", op: { op: "answer_question", project: "helix", ref: "Q-1", key: "a" } });
    expect((await picard.next(deliver)).msg.id).toBe(`m_board_${seq}`);
    expect(await untaken()).toEqual([seq]);
    expect((await audits("notice:drain_failed")).length).toBe(1);
    const alarm = await runInDurableObject(network(), (_, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm! - Date.now()).toBeLessThanOrEqual(60_000);

    await runInDurableObject(boardDo(), (_, state) => {
      state.storage.sql.exec("DROP TRIGGER no_mark");
    });
    // The next drain, twice over: a supervisor's register and the alarm. Neither stores it again.
    const poe = await supervisor(1);
    await runDurableObjectAlarm(network());
    expect(await untaken()).toEqual([]);
    expect(await stored(`m_board_${seq}`)).toBe(1);
    expect(await stored(`m_board_${seq}_s`)).toBe(0);
    expect(await picard.never(deliver)).toBe(true);
    expect(await poe.never(deliver)).toBe(true);
  });

  it("audits a notice that can't be sent, leaves it untaken, and still sends the ones after it", async () => {
    const o = await owner();
    const picard = await helix(o);
    // The first answer's recipients are spoiled as it is written, so sending it throws.
    await runInDurableObject(boardDo(), (_, state) => {
      state.storage.sql.exec("CREATE TRIGGER spoil AFTER INSERT ON notices BEGIN UPDATE notices SET to_json = '[5]' WHERE seq = NEW.seq; END");
    });
    const bad = await o.request({ t: "board_op", op: { op: "answer_question", project: "helix", ref: "Q-1", key: "a" } });
    await runInDurableObject(boardDo(), (_, state) => {
      state.storage.sql.exec("DROP TRIGGER spoil");
    });
    const good = await o.request({ t: "board_op", op: { op: "answer_question", project: "helix", ref: "Q-2", words: "Red" } });
    expect(good.told).toContain("Picard@mbp-1");
    expect(await picard.next(deliver)).toMatchObject({ msg: { id: `m_board_${good.seq}` } });
    expect(await stored(`m_board_${bad.seq}`)).toBe(0);
    expect(await untaken()).toEqual([bad.seq]);
    expect(JSON.parse((await audits("notice:send_failed"))[0]!.detail)).toMatchObject({ seq: bad.seq });
    const alarm = await runInDurableObject(network(), (_, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
  });

  it("keeps the answer when a drain throws, and the next drain sends it", async () => {
    const o = await owner();
    const picard = await helix(o);
    // The notice can't be read back, so the drain throws before it stores anything.
    await runInDurableObject(boardDo(), (_, state) => {
      state.storage.sql.exec("CREATE TABLE saved (seq INTEGER, notice TEXT)");
      state.storage.sql.exec("CREATE TRIGGER spoil AFTER INSERT ON notices BEGIN INSERT INTO saved VALUES (NEW.seq, NEW.notice); UPDATE notices SET notice = '{' WHERE seq = NEW.seq; END");
    });
    const res = await o.request({ t: "board_op", op: { op: "answer_question", project: "helix", ref: "Q-1", key: "a", words: "Bars" } });
    // Stored whatever became of the delivery; the reply says whom the board meant to tell.
    expect(res).toEqual({ ref: "Q-1", seq: expect.any(Number), told: ["Mario@mbp-2", "Picard@mbp-1"] });
    const { question } = await o.request({ t: "board_op", op: { op: "get", project: "helix", ref: "Q-1" } });
    expect(question).toMatchObject({ state: "answered", answer: { key: "a", words: "Bars" } });
    expect(await picard.never(deliver)).toBe(true);
    expect(await untaken()).toEqual([res.seq]);

    await runInDurableObject(boardDo(), (_, state) => {
      state.storage.sql.exec("DROP TRIGGER spoil");
      state.storage.sql.exec("UPDATE notices SET notice = (SELECT notice FROM saved WHERE saved.seq = notices.seq)");
    });
    await runDurableObjectAlarm(network());
    expect(await picard.next(deliver)).toMatchObject({ msg: { id: `m_board_${res.seq}` } });
    expect(await untaken()).toEqual([]);
  });
});
