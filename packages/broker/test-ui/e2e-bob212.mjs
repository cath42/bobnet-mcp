// BOB-212 build A, end to end (ADR 0017 build task 7): the standard's sample library, Toolshed
// (architecture/spikes/bob212/sample/), through the supervisor's library sync, the broker and the page.
//
//   - A `git init` fixture: a working copy with the sample's library/, its origin (bare) and the project's clone.
//   - The broker as it deploys, under `wrangler dev`, with a stand-in Access: this script signs the JWTs and serves the
//     keys it checks them with.
//   - The supervisor's own LibrarySync (packages/supervisor/src/library-sync.ts) reading the clone and sending over the
//     client's BrokerConnection as a laptop's supervisor that serves toolshed.
//   - The page in Chromium as the owner, at 1280 and 390 wide: every section, then a change pushed to the fixture's main
//     (a use case gains a mermaid sequence) shown after the next sync.
//   - Two more projects: "workshop", the sample with its glossary gone and files that break the standard; and "vitals",
//     whose main has no library/.
//
//   node test-ui/e2e-bob212.mjs [filter]   (from packages/broker; writes test-ui/shots/bob212-*.png)
// Prints each check, any page error, any page wider than its viewport, and at 390 the tap targets under 44 px.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { chromium } from "playwright-core";
import { BrokerConnection } from "@bobnet/client/connection";
import { LibrarySync } from "../../supervisor/src/library-sync.ts";

const here = dirname(fileURLToPath(import.meta.url));
const broker = join(here, "..");
const SAMPLE = join(here, "../../../architecture/spikes/bob212/sample");
const out = join(here, "shots");
const filter = process.argv[2] ?? "";
const checks = [];
const check = (ok, what) => {
  checks.push([ok, what]);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};
const quiet = { debug() {}, info() {}, warn: (m, x) => console.log("warn", m, x ?? ""), error: (m, x) => console.log("error", m, x ?? "") };

// ---------- the fixtures: one git repo per project, each with an origin and the clone the supervisor reads ----------
const root = mkdtempSync(join(tmpdir(), "bob212-e2e-"));
function fixture(key, make) {
  const work = join(root, key, "work"), origin = join(root, key, "origin.git"), clone = join(root, key, "clone");
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
  mkdirSync(work, { recursive: true });
  git(work, "init", "-q", "-b", "main");
  git(work, "config", "user.email", "otto@toolshed.example");
  git(work, "config", "user.name", "Otto");
  make(work);
  writeFileSync(join(work, "README.md"), `# ${key}\n`);
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", `${key}: its library`);
  git(root, "clone", "-q", "--bare", work, origin);
  git(work, "remote", "add", "origin", origin);
  git(root, "clone", "-q", origin, clone);
  // The links go to GitHub: the sample's own home is bobnet-mcp; the fetch still goes to the local origin.
  git(clone, "remote", "set-url", "--push", "origin", origin);
  return {
    project: { key, path: clone, rebase: undefined, board: "service" },
    push(files, message) {
      for (const [path, text] of Object.entries(files)) {
        if (text === null) git(work, "rm", "-q", path);
        else {
          mkdirSync(dirname(join(work, path)), { recursive: true });
          writeFileSync(join(work, path), text);
          git(work, "add", path);
        }
      }
      git(work, "commit", "-q", "-m", message);
      git(work, "push", "-q", "origin", "main");
      return git(work, "rev-parse", "HEAD");
    },
    head: () => git(clone, "rev-parse", "origin/main"),
  };
}
const copySample = (work) => cpSync(join(SAMPLE, "library"), join(work, "library"), { recursive: true });
const toolshed = fixture("toolshed", copySample);
const workshop = fixture("workshop", (work) => {
  copySample(work);
  rmSync(join(work, "library/glossary.md"));
  const adr = join(work, "library/decisions/0001-reservations-hold-for-24-hours.md");
  writeFileSync(adr, readFileSync(adr, "utf8").replace("status: accepted", "status: decided").replace("## Options", "## Choices"));
  mkdirSync(join(work, "library/notes"));
  writeFileSync(join(work, "library/notes/counter-ideas.md"), "# Ideas for the counter\n");
});
const vitals = fixture("vitals", (work) => writeFileSync(join(work, "schema.sql"), "create table reading (id uuid primary key);\n"));

// ---------- a stand-in Access: the keys the Worker checks JWTs with, and the JWTs ----------
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: "e2e", alg: "RS256", use: "sig" };
const access = createServer((req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [jwk] }))).listen(0, "127.0.0.1");
await new Promise((r) => access.once("listening", r));
const TEAM = `http://127.0.0.1:${access.address().port}`;
const sign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "e2e" }).setIssuer(TEAM).setAudience("e2e-aud").setIssuedAt().setExpirationTime("2h").sign(privateKey);
const ownerJwt = await sign({ email: "owner@example.com", sub: "owner" });
const laptopJwt = await sign({ common_name: "e2e-laptop.access", sub: "" });

// ---------- the broker, as it deploys, under wrangler dev ----------
const PORT = 8800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const vars = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "e2e-aud", OWNER_EMAIL: "owner@example.com", LAPTOP_TOKENS: JSON.stringify({ "e2e-laptop.access": "mbp-1" }), CI_TOKENS: "{}" };
writeFileSync(join(root, ".dev.vars"), Object.entries(vars).map(([k, v]) => `${k}='${v}'`).join("\n"));
const wrangler = spawn("npx", ["wrangler", "dev", "--ip", "127.0.0.1", "--port", String(PORT), "--persist-to", join(root, "state"), "--env-file", join(root, ".dev.vars"), "--show-interactive-dev-session=false"],
  { cwd: broker, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
let wlog = "";
wrangler.stdout.on("data", (d) => (wlog += d));
wrangler.stderr.on("data", (d) => (wlog += d));
const stop = () => {
  wrangler.kill();
  access.close();
};
process.on("exit", stop);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(BASE)).status === 401) break;
  } catch {}
  if (i > 120) throw new Error(`wrangler dev didn't start:\n${wlog}`);
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`broker at ${BASE}, fixtures in ${root}`);

// ---------- the owner makes the projects; the laptop's supervisor serves them ----------
/** A socket that sends the stand-in Access's JWT, as Access would in front of the Worker. */
const withJwt = (jwt, origin) => class extends WebSocket {
  constructor(url) {
    super(url, { headers: { "cf-access-jwt-assertion": jwt, ...(origin ? { origin } : {}) } });
  }
};
const conn = (jwt, origin) => {
  const c = new BrokerConnection({ url: `${BASE.replace("http", "ws")}/v1/ws`, credentials: { clientId: "-", clientSecret: "-" }, log: quiet, onPush: () => {}, WebSocketImpl: withJwt(jwt, origin) });
  c.start();
  return c;
};
const owner = conn(ownerJwt, BASE);
await owner.request({ t: "board_op", op: { op: "projects" } });
for (const [key, name, prefix] of [["toolshed", "Toolshed", "TS"], ["workshop", "Workshop", "WS"], ["vitals", "Vitals", "VIT"]]) {
  await owner.request({ t: "board_op", op: { op: "create_project", key, name, prefix, lead: "Otto@mbp-1", po: "Wren@mbp-1", repos: [`example/${key}`] } });
}
const sup = conn(laptopJwt);
await sup.register({ name: "supervisor", supervisor: true, projects: ["toolshed", "workshop", "vitals"] });
const sync = new LibrarySync({ log: quiet, send: (op) => sup.boardOp("supervisor", op) });
// The fixtures' remotes are local paths: their GitHub links are bobnet-mcp's, where the sample lives.
const readLib = async (key) => (await owner.request({ t: "board_op", op: { op: "library", project: key } })).library;
await sync.syncAll([toolshed.project, workshop.project, vitals.project]);
const first = await readLib("toolshed");
check(first?.commit === toolshed.head(), `the sync sent toolshed at its main, ${first?.commit?.slice(0, 7)}`);
check(first?.index?.files.length === 14 && first.problems.length === 0, `toolshed: 14 files, ${first?.problems.length} problems`);
const ws = await readLib("workshop");
check(ws?.problems.length === 3 && !ws.index.files.some((f) => f.section === "glossary"), `workshop: no glossary, ${ws?.problems.length} problems`);
check((await readLib("vitals"))?.index === null, "vitals: index null, no library/ on main");

// ---------- the page ----------
const browser = await chromium.launch();
const shots = [];
async function page(width, touch) {
  const ctx = await browser.newContext({ viewport: { width, height: touch ? 844 : 900 }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, extraHTTPHeaders: { "cf-access-jwt-assertion": ownerJwt }, timezoneId: "America/Chicago" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log(`page error at ${width}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !/Content Security Policy|favicon/.test(m.text()) && console.log(`console at ${width}: ${m.text().slice(0, 300)}`));
  return p;
}
async function shot(p, name, hash, wait = null) {
  if (filter && !name.includes(filter)) return;
  await p.goto(`${BASE}/${hash}`);
  await p.waitForSelector(wait ?? ".lib, .lib-empty, .p-tabs", { timeout: 15000 });
  await p.waitForTimeout(600);
  const w = p.viewportSize().width;
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (wide > 0) console.log(`  ${name} at ${w}: ${wide} px wider than the viewport`);
  if (w <= 390) {
    // The library's own controls; links inside a sentence (prose, a meta or source line, a field's value) aren't targets,
    // and a pill's 44 px is its hit area, checked on its own below.
    const small = await p.evaluate(() => [...document.querySelectorAll("#view .p-tabs a, #view .lib a, #view .lib button, #view .lib input, #view .lib summary, #pm-btn")]
      .filter((el) => el.offsetParent && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 44 && !el.closest(".doc, .probs, .lib-rail .foot, .doc-meta, .fresh, .src-line, .uc-f dd, .ux-v, .adr-list .t, .lib-how, .nw-card p, .files, .uc-links"))
      .map((el) => `${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 24)}" ${Math.round(el.getBoundingClientRect().height)}px`));
    if (small.length) console.log(`  ${name} at ${w}: under 44 px: ${[...new Set(small)].slice(0, 8).join("; ")}`);
  }
  const file = join(out, `bob212-${name}-${w}.png`);
  // A full-page shot from the top: a sticky header would otherwise be drawn where the page was scrolled to.
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: file, fullPage: true });
  shots.push(file);
}

const SECTIONS = [
  ["01-home", "#project/toolshed/library"],
  ["02-overview", "#project/toolshed/library/overview"],
  ["03-architecture", "#project/toolshed/library/architecture"],
  ["04-data", "#project/toolshed/library/data"],
  ["05-decisions", "#project/toolshed/library/decisions"],
  ["06-decision", "#project/toolshed/library/decisions/0003"],
  ["07-usecases", "#project/toolshed/library/usecases"],
  ["08-usecase", "#project/toolshed/library/usecases/0001"],
  ["09-ux", "#project/toolshed/library/ux"],
  ["10-uxcard", "#project/toolshed/library/ux/0001"],
  ["11-glossary", "#project/toolshed/library/glossary/hold"],
  ["12-section-missing", "#project/workshop/library/glossary"],
  ["13-problems", "#project/workshop/library"],
  ["14-card-problems", "#project/workshop/library/decisions/0001"],
  ["15-no-library", "#project/vitals/library"],
  ["16-work-tab", "#project/toolshed"],
  ["20-overview-rows", "#overview"],
];
for (const [width, touch] of [[1280, false], [390, true]]) {
  const p = await page(width, touch);
  for (const [name, hash] of SECTIONS) await shot(p, name, hash, name === "16-work-tab" ? ".p-tabs" : name === "20-overview-rows" ? ".prow .plib" : null);
  // The Projects menu, open.
  if (!filter || "17-menu".includes(filter)) {
    await p.goto(`${BASE}/#project/toolshed/library`);
    await p.waitForSelector(".lib");
    await p.click("#pm-btn");
    await p.waitForTimeout(300);
    const rows = await p.$$eval(".pm-row", (rs) => rs.map((r) => r.textContent.replace(/\s+/g, " ").trim()));
    check(rows.length === 3 && rows[0].includes("Toolshed") && rows.some((r) => r.includes("Library not written yet")), `the menu at ${width}: ${rows.join(" | ")}`);
    if (touch) {
      const h = await p.$$eval(".pm-row, .pm-lib", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      check(h.every((x) => x >= 44), `the menu's rows and Library pills at 390 are 44 px or more: ${h.join(", ")}`);
    }
    await p.screenshot({ path: join(out, `bob212-17-menu-${width}.png`) });
  }
  // A touch pill is drawn 28 px tall; its ::before takes taps 8 px above and below it, 44 px in all (Daisy, review A 3).
  if (touch && (!filter || "07-usecases".includes(filter))) {
    // A fresh load: a hash-only goto would keep the Projects menu the step above left open.
    await p.goto(`${BASE}/#project/toolshed/library/usecases`);
    await p.reload();
    await p.waitForSelector(".uc-links a");
    const hits = await p.$$eval(".uc-links a", (as) => as.map((a) => {
      a.scrollIntoView({ block: "center" });
      const r = a.getBoundingClientRect(), x = r.left + r.width / 2;
      const reach = (y, d) => { let n = 0; while (n < 30 && a.contains(document.elementFromPoint(x, y + d * (n + 1)))) n++; return n; };
      return Math.round(r.height + reach(r.top + 0.5, -1) + reach(r.bottom - 0.5, 1));
    }));
    check(hits.length > 0 && hits.every((h) => h >= 44), `the use cases' pills at 390 take a tap over 44 px or more: ${hits.join(", ")}`);
  }
  if (touch && (!filter || "18-sections".includes(filter))) {
    await p.goto(`${BASE}/#project/toolshed/library/decisions`);
    await p.waitForSelector(".secs-pick");
    await p.click(".secs-pick");
    await p.waitForTimeout(200);
    await p.screenshot({ path: join(out, `bob212-18-sections-${width}.png`) });
  }
  // Deep links: each section and item opens at its address.
  if (!touch) {
    await p.goto(`${BASE}/#project/toolshed/library/usecases/0001/acceptance`);
    await p.waitForSelector("#h-acceptance");
    await p.waitForTimeout(400);
    const [top, y] = await p.$eval("#h-acceptance", (el) => [Math.round(el.getBoundingClientRect().top), Math.round(scrollY)]);
    check(y > 0 && top >= 0 && top < 900 - 60, `a card's heading in the address is scrolled into view (the page at ${y} px, the heading ${top} px from the top)`);
    await p.click(`a[href="#project/toolshed/library/decisions/0002"]`).catch(() => {});
    const links = await p.$$eval(".uc-f a", (as) => as.map((a) => a.getAttribute("href")));
    check(links.includes("#project/toolshed/library/architecture/uc0001") && links.includes("#project/toolshed/library/ux/0001"), `use case 0001 links its flow and its UX card: ${links.join(", ")}`);
    await p.goto(`${BASE}/#project/toolshed/library/decisions/0002`);
    await p.waitForSelector(".head-box");
    const by = await p.$eval(".head-box", (el) => el.textContent);
    check(/Superseded by\s*0003/.test(by), "decision 0002 shows superseded by 0003, derived");
  }
  await p.context().close();
}

// ---------- a change pushed to the fixture's main shows after the next sync ----------
const uc = "library/usecases/0002-borrow-and-return-a-tool.md";
const before = readFileSync(join(SAMPLE, uc), "utf8");
const sequence = "\n```mermaid\nsequenceDiagram\n  actor M as Member\n  participant C as Counter\n  participant A as API\n  M->>C: Shows the reservation\n  C->>A: Mark the loan out\n  A-->>C: Loan out, due in 3 days\n  M->>C: Brings the tool back\n  C->>A: Mark it returned\n```\n";
const moved = toolshed.push({ [uc]: before.replace("## Extensions", `${sequence}\n## Extensions`) }, "Use case 0002: the counter's sequence");
const page2 = await page(1280, false);
await page2.goto(`${BASE}/#project/toolshed/library/usecases/0002`);
await page2.waitForSelector(".doc");
check(!(await page2.$(".dia")), "before the sync the page shows the old main: no diagram");
await sync.syncAll([toolshed.project]);
check((await readLib("toolshed")).commit === moved, `after the next sync the library is main at ${moved.slice(0, 7)}`);
await page2.waitForSelector("#toast:not([hidden])", { timeout: 15000 }).catch(() => {});
const toastText = await page2.$eval("#toast", (t) => (t.hidden ? "" : t.textContent)).catch(() => "");
check(toastText.includes(moved.slice(0, 7)), `the open page says main moved: "${toastText}"`);
await page2.waitForSelector(".dia .dia-view img", { timeout: 20000 }).catch(() => {});
check(Boolean(await page2.$(".dia .dia-view img")), "and shows the change without a reload, its mermaid sequence drawn");
await page2.screenshot({ path: join(out, "bob212-19-after-sync-1280.png"), fullPage: true });
const p390 = await page(390, true);
await shot(p390, "19-after-sync", "#project/toolshed/library/usecases/0002", ".dia .dia-view img");

await browser.close();
owner.stop();
sup.stop();
stop();
const failed = checks.filter(([ok]) => !ok);
console.log(`${shots.length} shots in ${out}; ${checks.length - failed.length} of ${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
