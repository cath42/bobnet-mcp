// Screenshots of a laptop that stopped reporting and a stuck board outbox (BOB-48, design/BOB-48/spec.md) at phone
// and desktop widths, against a fake broker in the page: Overview and Waits with one stale laptop with requests for
// you, Overview with three, and the Laptops card with a stuck outbox (with and without its last error) and a stale laptop.
//   node test-ui/shots-bob48.mjs   (from packages/broker; writes design/BOB-48/shots-build/*.png)
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "../public");
const out = join(here, "../../../design/BOB-48/shots-build");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try {
    const body = await readFile(join(pub, path === "/" ? "index.html" : path));
    res.writeHead(200, { "content-type": types[extname(path || ".html")] ?? "text/html" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

/** Runs in the page: a broker that answers the dashboard and the board's reads from memory, with the laptops of `scene`. */
function fakeBroker(scene) {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString();
  const projects = [{ key: "bobnet", name: "BobNet", prefix: "BOB", draft_prefix: null, lead: "Mario@mbp-1", po: "Peach@mbp-1", repos: [] }];
  const overviewRow = (p) => ({ project: p, release: null, release_number: null, open: [], next_ready: null, waits_on_you: null, backlog: { items: 0, bugs: 0, oldest: null } });
  const answer = (op) => {
    switch (op.op) {
      case "projects": return { projects };
      case "overview": return { projects: projects.map(overviewRow) };
      case "waits": return { waits: [], answered: [] };
      case "status": return { at: new Date(now).toISOString(), since: iso(60), projects: [] };
      default: return { ref: null, seq: 1 };
    }
  };
  const worker = (id, name, role, session, state = "running") => ({ id, name, project: "bobnet", role, state, task: session ?? role, model: "opus", effort: "high", checkpoint: null,
    started_at: iso(40), ended_at: null, last_event_at: iso(0), tokens: { input: 20_000, output: 30_000, cache_read: 900_000, cache_write: 50_000 }, session, task_ref: null, calls: 80, context: 90000, ctx: [] });
  const ask = (id, worker_id, name, minAgo, tier = "human") => ({ id, worker_id, name, kind: "approval", tool: "Bash", tier, created_at: iso(minAgo), preview: "git push origin luigi/work" });
  const snapshot = (over) => ({ supervisor: { started_at: iso(60 * 52), concurrency: 3, active: 0, queued: 0 }, workers: [], pending: [], usage: [], cleanup: null, board_outbox: { count: 0, oldest_at: null, code: null }, ...over });
  const mbp = { laptop: "mbp-1", at: iso(0), snapshot: snapshot({ supervisor: { started_at: iso(60 * 52), concurrency: 3, active: 2, queued: 0 }, workers: [worker("w_l", "Luigi", "engineer", "BOB-48 build A"), worker("w_m", "Mario", "lead", null)] }) };
  const quiet = (laptop, minAgo, pending, over = {}) => ({ laptop, at: iso(minAgo), snapshot: snapshot({ workers: [worker(`w_${laptop}`, "Toad", "architect", "BOB-48 review A", "waiting-approval")], pending, ...over }) });
  const scenes = {
    one: [mbp, quiet("ubu1", 12, [ask("r_1", "w_ubu1", "Toad", 20), ask("r_2", "w_ubu1", "Toad", 15), ask("r_3", "w_ubu1", "Toad", 18, "orchestrator"), ask("r_dead", "w_ubu1", "Toad", 60 * 30)])],
    three: [mbp, quiet("ubu1", 200, [ask("r_1", "w_ubu1", "Toad", 230)]), quiet("mini", 40, []), quiet("mbp-2", 12, [ask("r_2", "w_mbp-2", "Toad", 30), ask("r_3", "w_mbp-2", "Toad", 25)])],
    laptops: [
      { ...mbp, snapshot: { ...mbp.snapshot, board_outbox: { count: 14, oldest_at: iso(60 * 11 + 2), code: "unavailable" } } },
      { laptop: "mini", at: iso(0), snapshot: snapshot({ board_outbox: { count: 3, oldest_at: iso(7), code: null } }) },
      quiet("ubu1", 12, [ask("r_1", "w_ubu1", "Toad", 20), ask("r_2", "w_ubu1", "Toad", 15), ask("r_3", "w_ubu1", "Toad", 18, "orchestrator")], { board_outbox: { count: 5, oldest_at: iso(30), code: "timeout" } }),
      quiet("mbp-2", 60 * 50, [ask("r_9", "w_mbp-2", "Toad", 60 * 51)]),
    ],
  };
  const dashboard = { now: new Date(now).toISOString(), peers: [], laptops: scenes[scene], boards: [], updates: [], traffic: [] };

  class FakeSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      super();
      setTimeout(() => this.frame({ t: "welcome", v: 1, identity: { kind: "owner", email: "owner@example.com" } }));
    }
    frame(f) { this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(f) })); }
    send(data) {
      const f = JSON.parse(data);
      if (f.t === "dashboard") setTimeout(() => this.frame({ t: "ok", rid: f.rid, result: dashboard }));
      if (f.t === "board_op") setTimeout(() => this.frame({ t: "ok", rid: f.rid, result: answer(f.op) }), 30);
    }
    close() {}
  }
  window.WebSocket = FakeSocket;
}

const widths = { 390: [390, 844], 1440: [1440, 900] };
// [name, scene, hash, selector to wait for, element to shoot (null: the viewport)]
const all = [
  ["overview-one-stale", "one", "overview", ".stale-banners", null],
  ["waits-one-stale", "one", "waits", ".stale-banners", null],
  ["overview-three-stale", "three", "overview", ".stale-banners", null],
  ["laptops-card", "laptops", "laptops", "#laptops .outbox", "section:has(#laptops)"],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, scene, hash, ready, element] of all) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      await page.addInitScript(fakeBroker, scene);
      await page.goto(`${base}#${hash}`);
      await page.waitForSelector(ready);
      await page.waitForTimeout(1000);
      const path = join(out, `${name}-${w}.png`);
      if (element) {
        // The page re-renders as the board answers: shoot the element's box on the whole page, not the node.
        await page.addStyleTag({ content: "header { position: static !important; } #toast { display: none !important; }" });
        await page.evaluate(() => window.scrollTo(0, 0));
        const box = await page.locator(element).boundingBox();
        await page.screenshot({ path, fullPage: true, clip: { x: 0, y: box.y - 8, width, height: box.height + 16 } });
      } else await page.screenshot({ path });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
