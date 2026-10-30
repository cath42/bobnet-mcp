import { mkdtempSync, rmSync, statSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureToken, serveMcp } from "../src/mcp.ts";
import { Policy } from "../src/policy.ts";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { FakeBroker, fakeQuery, quiet, testConfig, tick, until } from "./fakes.ts";

let dir: string;
let store: Store;
let http: HttpServer;
let sup: Supervisor;
let sessions: ReturnType<typeof fakeQuery>["sessions"];
let url: URL;
const TOKEN = "test-token-123";

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "bobnet-mcp-"));
  store = new Store(join(dir, "supervisor.db"));
  const fq = fakeQuery();
  sessions = fq.sessions;
  sup = new Supervisor({
    config: testConfig(dir),
    policy: new Policy(`rules: [{ id: fetch, tools: [WebFetch], decision: escalate, tier: orchestrator }]`),
    store,
    broker: new FakeBroker(),
    queryFn: fq.queryFn,
    log: quiet,
  });
  await sup.start();
  http = await serveMcp(sup, { port: 0, token: TOKEN, log: quiet });
  url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`);
});

afterEach(async () => {
  await sup.shutdown();
  http.close();
  await tick(20);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function client(token = TOKEN): Promise<Client> {
  const c = new Client({ name: "orchestrator-test", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
}

const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
  const text = r.content[0]!.text;
  if (r.isError) throw new Error(text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

describe("orchestrator MCP server", () => {
  it("refuses requests without the token, or on another path", async () => {
    expect((await fetch(url, { method: "POST" })).status).toBe(401);
    expect((await fetch(url, { method: "POST", headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await fetch(new URL("/other", url), { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
    await expect(client("wrong")).rejects.toThrow();
  });

  it("lists every tool in the design", async () => {
    const c = await client();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "answer_request",
        "audit_log",
        "list_projects",
        "list_workers",
        "pending_requests",
        "reset_worker",
        "spawn_worker",
        "stop_worker",
        "tail_worker",
        "worker_status",
        "worker_summary",
      ].sort(),
    );
  });

  it("spawns a worker, sees its request, answers it and reads its summary", async () => {
    const c = await client();
    expect((await call(c, "list_projects")).map((p: { key: string }) => p.key)).toEqual(["helix", "games"]);
    const w = await call(c, "spawn_worker", { project: "helix", role: "bill", task: "Draft ADR 0094" });
    expect(w).toMatchObject({ project: "helix", role: "bill" });
    await until(() => sessions.length === 1);

    const pending = sessions[0]!.ask("WebFetch", { url: "https://docs.example" });
    await until(() => sup.pending().length === 1);
    const [req] = await call(c, "pending_requests");
    expect(req).toMatchObject({ worker: "Bill", tool: "WebFetch", kind: "approval" });
    await call(c, "answer_request", { id: req.id, decision: "allow" });
    await expect(pending).resolves.toMatchObject({ behavior: "allow" });

    sessions[0]!.say("Drafted.");
    sessions[0]!.finish("ADR drafted");
    await until(() => sup.status(w.id).state === "done");
    expect(await call(c, "worker_summary", { id: w.id })).toMatchObject({ state: "done", result: "ADR drafted" });
    expect(await call(c, "tail_worker", { id: w.id, n: 5 })).toContain("say  Drafted.");
    expect((await call(c, "list_workers", { project: "helix" }))[0]).toMatchObject({ id: w.id, name: "Bill", state: "done" });
  });

  it("returns clear errors for bad input", async () => {
    const c = await client();
    await expect(call(c, "spawn_worker", { project: "nope", role: "bill", task: "x" })).rejects.toThrow(/No project nope/);
    await expect(call(c, "spawn_worker", { project: "helix" })).rejects.toThrow(/bad_arguments/);
    await expect(call(c, "answer_request", { id: "r_none", decision: "allow" })).rejects.toThrow(/No request r_none/);
  });
});

describe("ensureToken", () => {
  it("creates a 0600 token once and reuses it", () => {
    const d = mkdtempSync(join(tmpdir(), "bobnet-tok-"));
    const f = join(d, "supervisor.token");
    const t = ensureToken(f);
    expect(t.length).toBeGreaterThan(30);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(ensureToken(f)).toBe(t);
    rmSync(d, { recursive: true, force: true });
  });
});
