import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";

// The dashboard in a simulated browser, for a suite of its own: the test plays the broker. `reads` answers
// the board's reads by op; a read it has no answer for waits, for the test to answer.

const html = readFileSync(join(import.meta.dirname, "../public/index.html"), "utf8");

export type Op = Record<string, unknown> & { op: string };
export type Sent = { t: string; rid: string; op?: Op; key?: string; laptop?: string; action?: Record<string, unknown> };

/** Stands in for the browser WebSocket. */
export class FakeSocket extends EventTarget {
  static last: FakeSocket;
  static readonly OPEN = 1;
  readyState = 1;
  readonly sent: Sent[] = [];
  constructor(readonly url: string) {
    super();
    FakeSocket.last = this;
  }
  send(data: string): void {
    if (data === '{"t":"ping"}') return;
    const f = JSON.parse(data) as Sent;
    this.sent.push(f);
    if (f.t === "dashboard") queueMicrotask(() => this.frame({ t: "ok", rid: f.rid, result: world.dashboard() }));
    const answer = f.t === "board_op" ? world.reads[f.op!.op] : undefined;
    if (answer) queueMicrotask(() => reply(f, answer));
  }
  close(): void {}
  frame(f: unknown): void {
    this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(f) }));
  }
}

export const iso = (minAgo: number, now = Date.now()) => new Date(now - minAgo * 60_000).toISOString();
/** Live frames re-render after a short debounce. */
export const settle = (ms = 320) => new Promise((r) => setTimeout(r, ms));
export const $ = (id: string) => document.getElementById(id)!;
export const view = () => $("view");
export const text = (sel: string, at: ParentNode = view()) => at.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? null;
export const texts = (sel: string, at: ParentNode = view()) => [...at.querySelectorAll(sel)].map((x) => x.textContent!.replace(/\s+/g, " ").trim());
export const click = async (el: Element | null | undefined) => {
  el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await settle(20);
};
export const key = async (el: Element | null | undefined, k: string) => {
  el!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  await settle(20);
};
export const go = async (hash: string) => {
  location.hash = hash;
  window.dispatchEvent(new Event("hashchange"));
  await settle();
};

export const tok = (n: number) => ({ input: n, output: 0, cache_read: 0, cache_write: 0 });
export const worker = (over: Record<string, unknown>) => ({
  id: "w_1", name: "Luigi", project: "bobnet", role: "luigi", state: "running", task: "t", model: "opus", effort: "high", checkpoint: null,
  started_at: iso(25), ended_at: null, last_event_at: iso(0), tokens: tok(1_000_000), session: null, task_ref: null, task_refs: [], calls: 3, context: 61000, ctx: [30000, 45000, 61000],
  remote_url: null, remote_from: null, remote_by: null, ...over,
});
export const snapshot = (workers: unknown[], over: Record<string, unknown> = {}) => ({ supervisor: { started_at: iso(120), concurrency: 3, active: workers.length, queued: 0 }, workers, pending: [], usage: [], decided: [], ...over });
export const project = (key: string, name: string, prefix: string) => ({ key, name, prefix, draft_prefix: null, lead: `Lead${prefix}@mbp-1`, po: `Po${prefix}@mbp-1`, repos: [`example/${key}`] });

/** What the broker has. Set before `open`, and change it in a test as the broker would. */
export const world = {
  reads: {} as Record<string, (op: Op) => unknown>,
  laptops: [] as Array<{ laptop: string; at: string; snapshot: unknown }>,
  boards: [] as unknown[],
  dashboard: () => ({ now: new Date().toISOString(), peers: [], laptops: world.laptops, boards: world.boards, traffic: [] }),
};
/** Answers a read: with what `answer` returns, or the error it throws. */
export function reply(f: Sent, answer: (op: Op) => unknown): void {
  try {
    FakeSocket.last.frame({ t: "ok", rid: f.rid, result: answer(f.op!) });
  } catch (err) {
    FakeSocket.last.frame({ t: "error", rid: f.rid, code: (err as { code?: string }).code ?? "unavailable", message: (err as Error).message });
  }
}
export const sent = (op: string) => FakeSocket.last.sent.filter((f) => f.op?.op === op);
export const refuse = (message: string, code = "unavailable") => {
  throw Object.assign(new Error(message), { code });
};
/** A laptop's report, live: kept in the world too. */
export const report = (laptop: string, snap: unknown, at = iso(0)) => {
  world.laptops = [...world.laptops.filter((l) => l.laptop !== laptop), { laptop, at, snapshot: snap }];
  FakeSocket.last.frame({ t: "report", laptop, at, snapshot: snap });
};
export const changed = (key: string) => FakeSocket.last.frame({ t: "board_changed", project: key, seq: 1, refs: [] });

const page = { timers: [] as ReturnType<typeof setInterval>[], listeners: [] as Array<[EventTarget, string, EventListener]> };
/** Loads the dashboard (again, as a reload does) at `hash`: the page before it stops. Answers as the world has it. */
export async function open(hash = ""): Promise<Record<string, unknown>> {
  await settle(page.timers.length ? 320 : 0);
  for (const t of page.timers.splice(0)) clearInterval(t);
  // The window's and the document's listeners go with the page: the document outlives a reload here, as it doesn't in a browser.
  for (const [on, type, f] of page.listeners.splice(0)) on.removeEventListener(type, f);
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>|<link[^>]*>/g, "");
  (globalThis as unknown as { WebSocket: typeof FakeSocket }).WebSocket = FakeSocket;
  location.hash = hash;
  vi.resetModules();
  const every = globalThis.setInterval, listen = window.addEventListener.bind(window), listenDoc = document.addEventListener.bind(document);
  globalThis.setInterval = ((...a: Parameters<typeof setInterval>) => { const t = every(...a); page.timers.push(t); return t; }) as typeof setInterval;
  window.addEventListener = ((type: string, f: EventListener, o?: AddEventListenerOptions) => { page.listeners.push([window, type, f]); listen(type, f, o); }) as typeof window.addEventListener;
  document.addEventListener = ((type: string, f: EventListener, o?: AddEventListenerOptions) => { page.listeners.push([document, type, f]); listenDoc(type, f, o); }) as typeof document.addEventListener;
  let app: Record<string, unknown>;
  try {
    app = (await import("../public/app.js")) as unknown as Record<string, unknown>;
  } finally {
    globalThis.setInterval = every;
    window.addEventListener = listen;
    document.addEventListener = listenDoc;
  }
  FakeSocket.last.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } });
  // The projects, then what the page reads with them, each drawn after the debounce.
  await settle(800);
  return app;
}
