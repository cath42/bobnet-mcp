import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { boardAnswerText, Supervisor } from "../src/supervisor.ts";
import { FakeBroker, fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";

// An answer's notice from the board, forwarded to the project's orchestrator (ADR 0009 §4; BOB-111 AC2).

let dir: string;
let store: Store;
let running: Supervisor[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bobnet-board-answer-"));
  store = new Store(join(dir, "supervisor.db"));
});
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.shutdown()));
  await tick(20);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

// Games has its own orchestrator; helix has the laptop's, Bob.
const GAMES_ORCH = `  arcade:\n    path: /work/arcade\n    orchestrator: Peach\n    roles:\n      toad: { dir: /work/arcade/toad }\n`;

const SESSION = { feature: "LAND-56", kind: "design", label: "B" };
const ANSWER = {
  v: 2, event: "answer", seq: 5123, project: "helix", ref: "Q-282", kind: "question", state: "answered", key: "accept", option: "Accept the prototype", words: "Ship it",
  by: "owner", via: "dashboard", asked_by: "kong@mbp-1", holds: { items: [], sessions: [SESSION] }, still_held: [], at: "2026-11-21T16:40:00Z",
};

async function setup() {
  const broker = new FakeBroker();
  const { queryFn, sessions } = fakeQuery();
  const sup = new Supervisor({ config: testConfig(dir, GAMES_ORCH), policy: POLICY, store, broker, queryFn, log: quiet, sandboxCheck: async () => null, ownerCheck: async () => false });
  await sup.start();
  running.push(sup);
  /** A message to the supervisor from `from`, as the broker delivers it. */
  const push = (body: unknown, id: string, from = "BobNet@board") =>
    sup.onPush({
      t: "message",
      to: "supervisor@mbp-1",
      wake: true,
      msg: { id, type: "message", from, to: ["supervisor@mbp-1"], team: null, laptop: from.split("@")[1], in_reply_to: null, urgent: false, body: typeof body === "string" ? body : JSON.stringify(body), created_at: "2026-11-21T16:40:00Z", expires_at: "2026-12-21T16:40:00Z" },
    } as never);
  const told = (name: string) => broker.sent.filter((s) => s.to.includes(name));
  return { sup, broker, sessions, push, told };
}

const POLICY = new Policy(`rules: []`);

describe("an answer notice from the board (ADR 0009 §4)", () => {
  it("is forwarded to the project's orchestrator once, as the supervisor, and spawns nothing", async () => {
    const { push, told, sessions } = await setup();
    push(ANSWER, "m_board_5123_s");
    await until(() => told("Bob").length === 1);
    expect(told("Bob")[0]).toEqual({
      as: "supervisor",
      to: ["Bob"],
      body: 'Casper answered helix Q-282 (accept: Accept the prototype, "Ship it"). It held session LAND-56 design B. Nothing else holds session LAND-56 design B now: it can start.',
    });
    expect(store.auditLog(20).find((a) => a.action === "board:answer")).toMatchObject({ actor: "BobNet@board", detail: expect.stringContaining('"ref":"Q-282"') });
    // A redelivery (an ack lost in a reconnect) is not forwarded again.
    push(ANSWER, "m_board_5123_s");
    await tick(30);
    expect(told("Bob").length).toBe(1);
    expect(sessions.length).toBe(0);
  });

  it("goes to the laptop's orchestrator and to a project's own, unless that is the asker, who has the text", async () => {
    const { push, told } = await setup();
    // (b) Peach is neither Bob nor the asker (kong): both are told.
    push({ ...ANSWER, project: "arcade" }, "m_board_1_s");
    await until(() => told("Peach").length === 1);
    expect(told("Bob").length).toBe(1);
    // (a) Peach is the asker: one forward, to the laptop's orchestrator.
    push({ ...ANSWER, project: "arcade", asked_by: "Peach@mbp-1" }, "m_board_2_s");
    await until(() => told("Bob").length === 2);
    await tick(30);
    expect(told("Peach").length).toBe(1);
  });

  it("drops a project not run here, a body that doesn't parse, and an answer event from anyone but the board", async () => {
    const { push, broker } = await setup();
    push({ ...ANSWER, project: "studio" }, "m_board_2_s");
    push({ ...ANSWER, holds: undefined }, "m_board_3_s");
    push({ ...ANSWER, state: "open" }, "m_board_4_s");
    push(ANSWER, "m_x5", "poe@ubu1");
    push(ANSWER, "m_x6", "BobNet@mbp-2");
    await tick(50);
    expect(broker.sent).toEqual([]);
    expect(store.auditLog(50).filter((a) => a.action.startsWith("board:"))).toEqual([]);
  });

  it("skips an answer the orchestrator recorded itself, per target: it knows", async () => {
    const { push, broker, told } = await setup();
    push({ ...ANSWER, by: "Bob@mbp-1", via: "conversation" }, "m_board_7_s");
    await until(() => store.auditLog(20).some((a) => a.action === "board:answer_own"));
    expect(broker.sent).toEqual([]);
    // Recorded by someone else: forwarded, naming the recorder.
    push({ ...ANSWER, by: "kong@mbp-1", via: "conversation" }, "m_board_8_s");
    await until(() => broker.sent.length === 1);
    expect(broker.sent[0]!.body).toMatch(/^Casper \(recorded by kong@mbp-1\) answered helix Q-282/);
    // The laptop's orchestrator recorded it: the project's own is still told, Bob is not.
    push({ ...ANSWER, project: "arcade", by: "Bob@mbp-1", via: "conversation" }, "m_board_9_s");
    await until(() => told("Peach").length === 1);
    expect(told("Bob").length).toBe(1);
    // The project's own recorded it: Bob is told, Peach is not.
    push({ ...ANSWER, project: "arcade", by: "Peach@mbp-1", via: "conversation" }, "m_board_10_s");
    await until(() => told("Bob").length === 2);
    await tick(30);
    expect(told("Peach").length).toBe(1);
  });
});

describe("the forwarded text", () => {
  it("says what still holds it, and 'can start' only for what nothing else holds", () => {
    const still = { ...ANSWER, holds: { items: ["LAND-56"], sessions: [SESSION] }, still_held: [{ session: SESSION, by: ["Q-283"] }] };
    expect(boardAnswerText(still as never)).toBe(
      'Casper answered helix Q-282 (accept: Accept the prototype, "Ship it"). It held LAND-56 and session LAND-56 design B. Still held: session LAND-56 design B by Q-283. Nothing else holds LAND-56 now: it can start.',
    );
    const all = { ...still, holds: { items: [], sessions: [SESSION] } };
    expect(boardAnswerText(all as never)).not.toMatch(/can start/);
    expect(boardAnswerText({ ...ANSWER, holds: { items: [], sessions: [] } } as never)).toMatch(/It held nothing on the board\.$/);
  });

  it("says a withdrawal is one, and a done mark with its note", () => {
    expect(boardAnswerText({ ...ANSWER, state: "withdrawn" } as never)).toBe(
      'Casper withdrew his answer to helix Q-282 (accept: Accept the prototype, "Ship it"); it is open again. It holds session LAND-56 design B again.',
    );
    expect(boardAnswerText({ ...ANSWER, ref: "A-17", kind: "action", state: "done", key: null, option: null, words: "Rotated" } as never)).toBe(
      'Casper marked helix A-17 done: "Rotated". It held session LAND-56 design B. Nothing else holds session LAND-56 design B now: it can start.',
    );
  });
});

describe("a board notice (ADR 0011 §4)", () => {
  const NOTICE = {
    v: 2, event: "board_notice", seq: 6001, project: "helix", ref: "LAND-27", kind: "fix_landed", to: ["kong@mbp-1"], lead: "Bob@mbp-1", asked_by: "kong@mbp-1",
    text: "LAND-27's fix landed: 5d4617f \"Fix the chart\", by Mario@mbp-1. Check it and close LAND-27: tick its criterion with the commit as evidence, then move it to Done.", at: "2026-11-22T08:00:00Z",
  };

  it("reaches the orchestrator once, with whom the board sent it to, and spawns nothing", async () => {
    const { push, told, sessions } = await setup();
    push(NOTICE, "m_board_6001_s");
    await until(() => told("Bob").length === 1);
    expect(told("Bob")[0]).toEqual({ as: "supervisor", to: ["Bob"], body: `${NOTICE.text} (Sent to kong@mbp-1.)` });
    expect(store.auditLog(20).find((a) => a.action === "board:notice")).toMatchObject({ actor: "BobNet@board", detail: expect.stringContaining('"kind":"fix_landed"') });
    push(NOTICE, "m_board_6001_s");
    await tick(30);
    expect(told("Bob").length).toBe(1);
    expect(sessions.length).toBe(0);
  });

  it("skips an orchestrator the board sent it to, and drops one from anyone but the board", async () => {
    const { push, told, broker } = await setup();
    // A stale flag whose owner is the project's orchestrator, Peach: only Bob is told.
    push({ ...NOTICE, project: "arcade", kind: "stale", to: ["Peach@mbp-1"], asked_by: "Peach@mbp-1" }, "m_board_6002_s");
    await until(() => told("Bob").length === 1);
    await tick(30);
    expect(told("Peach").length).toBe(0);
    expect(store.auditLog(20).find((a) => a.action === "board:notice_own")).toMatchObject({ detail: expect.stringContaining('"to":"Peach"') });
    push(NOTICE, "m_x7", "poe@ubu1");
    push({ ...NOTICE, kind: "other" }, "m_board_6003_s");
    await tick(50);
    expect(broker.sent.length).toBe(1);
  });
});
