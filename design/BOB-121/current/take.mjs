// Screenshots of today's dashboard (packages/broker/public as on v2, 2026-11-22), every tab at 390, 1024 and 1440,
// against the fake brokers the broker's own shot scripts use (test-ui/shots.mjs, test-ui/shots-bob33.mjs).
//   node design/BOB-121/current/take.mjs   (playwright-core from @bobnet/broker)
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const broker = join(here, "../../../packages/broker");
const { chromium } = createRequire(join(broker, "package.json"))("playwright-core");
const pub = join(broker, "public"), ui = join(broker, "test-ui"), sample = join(here, "../../BOB-1/sample");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

/** A shot script's in-page fake broker, as source. */
const fake = async (file) => {
  const src = await readFile(join(ui, file), "utf8");
  const a = src.indexOf("function fakeBroker()"), b = src.indexOf("\nconst widths");
  return `(${src.slice(a, src.lastIndexOf("}", b) + 1)})();`;
};
const main = await fake("shots.mjs"), status = await fake("shots-bob33.mjs");

/** A laptop's board report as production sends it since the boards moved into the service: no Backlog.md (backlog
 * null), the sessions and runs the Usage tab reads. Wraps the fake socket so the dashboard reply carries it. */
const legacy = `{
  const now = Date.now(), iso = (m) => new Date(now - m * 60_000).toISOString();
  const tok = (n) => ({ input: n * 0.02, output: n * 0.03, cache_read: n * 0.9, cache_write: n * 0.05 });
  const ctx = (n, a, s) => Array.from({ length: n }, (_, i) => a + i * s);
  const run = (id, name, role, session, a, b, t, c) => ({ id, name, role, session, task_ref: null, model: "opus", effort: "high", started_at: iso(a), ended_at: iso(b), resumed: false, tokens: t, ctx: c });
  const board = { project: "bobnet", ref: "f90256f0", backlog: null, commits: [], ci: [], baseline: { runs: 9, p25: [25000, 30000], p50: [30000, 40000], p75: [35000, 55000] },
    sessions: [
      { name: "BOB-51 build A", kind: "build", started_at: iso(900), ended_at: iso(700), workers: 2, calls: 260, tokens: tok(31_000_000) },
      { name: "BOB-51 review A", kind: "review", started_at: iso(690), ended_at: iso(600), workers: 2, calls: 90, tokens: tok(6_000_000) },
      { name: "BOB-121 design A", kind: "design", started_at: iso(60), ended_at: null, workers: 2, calls: 80, tokens: tok(5_200_000) } ],
    runs: [
      run("w_a", "Luigi", "engineer", "BOB-51 build A", 900, 700, 27_000_000, ctx(200, 30000, 900)),
      run("w_b", "Toad", "architect", "BOB-51 build A", 880, 820, 4_000_000, ctx(60, 28000, 1500)),
      run("w_c", "Daisy", "designer", "BOB-51 review A", 690, 620, 3_000_000, ctx(45, 30000, 2000)),
      run("w_d", "Toad", "architect", "BOB-51 review A", 690, 600, 3_000_000, ctx(45, 30000, 1800)),
      run("w_e", "Daisy", "designer", "BOB-121 design A", 60, 5, 3_700_000, ctx(50, 30000, 3000)),
      run("w_f", "Toad", "architect", "BOB-121 design A", 55, 10, 1_500_000, ctx(30, 30000, 2500)) ] };
  const W = window.WebSocket;
  window.WebSocket = class extends W { frame(f) { if (f.result?.laptops && f.result.boards) f.result.boards.push({ laptop: "mbp-1", at: new Date().toISOString(), board }); super.frame(f); } };
}`;

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try { res.writeHead(200, { "content-type": types[extname(path || ".html")] ?? "text/html" }).end(await readFile(join(pub, path === "/" ? "index.html" : path))); }
  catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const widths = { 390: [390, 844], 1024: [1024, 768], 1440: [1440, 900] };

// [name, hash, flags, fake, wait for]. Feature (no feature picked) and Usage read the laptop's board report, not the
// board service: LEGACY gives them the report production sends today.
const only = process.argv[2];
const shots0 = [
  ["overview", "overview", ["BOB5", "TWO", "BOB44"], main, ".prow"],
  ["waits", "waits", ["BOB5", "TWO"], main, '#waits-holding li[data-kind="question"]'],
  ["status", "status", [], status, ".pcards"],
  ["status-project", "status/helix", [], status, ".secs"],
  ["roadmap", "roadmap/helix", ["TWO"], main, "section.release"],
  ["feature-list", "feature", ["BOB5", "TWO", "LEGACY"], main, ".banner"],
  ["feature", "feature/bobnet/BOB-4", ["BOB4"], main, "#feature-head"],
  ["triage", "triage/bobnet", [], main, ".totals"],
  ["usage", "usage", ["BOB5", "TWO", "LEGACY"], main, "#ctx"],
  ["sessions", "sessions", ["BOB123", "BOB5", "TWO"], main, "#laptops .card"],
];

const shots = shots0.filter(([n]) => !only || n === only);
const browser = await chromium.launch();
try {
  for (const [name, hash, flags, script, until] of shots) {
    for (const [w, [width, height]] of Object.entries(widths)) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.addInitScript(() => localStorage.setItem("bobnet.status.lastVisit", new Date(Date.now() - 7 * 3600_000).toISOString()));
      for (const f of flags) await page.addInitScript({ content: `window.${f} = true;` });
      if (flags.includes("BOB5")) await page.addInitScript({ path: join(sample, "records.js") });
      if (flags.includes("TWO")) await page.addInitScript({ path: join(sample, "helix.js") });
      await page.addInitScript({ content: script });
      if (flags.includes("LEGACY")) await page.addInitScript({ content: legacy });
      page.on("pageerror", (e) => console.warn(name, e.message));
      await page.goto(`${base}#${hash}`);
      await page.waitForSelector(until, { timeout: 5000 }).catch(() => console.warn(`${name}-${w}: no ${until}`));
      await page.waitForTimeout(600);
      await page.addStyleTag({ content: "header { position: static !important; } #toast { display: none !important; }" });
      await page.screenshot({ path: join(here, `${name}-${w}.png`), fullPage: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
