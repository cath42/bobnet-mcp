// BOB-212 build B (ADR 0017 build task B4): what the viewer tests run the vendored viewers in. A host page stands in for
// the dashboard: it frames a viewer sandboxed (allow-scripts, so an opaque origin) as the library page does, posts it the
// files on its hello and keeps every message it gets in window.msgs. Each path is served with the Worker's own content
// policy (src/csp.ts): the page's, with frame-src 'self', and the viewer's, by its hashes.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cspFor, viewerPath } from "../src/csp.ts";

const here = dirname(fileURLToPath(import.meta.url));
const vendor = join(here, "../public/vendor");
const viewers = JSON.parse(readFileSync(join(vendor, "viewers.json"), "utf8"));
export const SAMPLE = join(here, "../../../architecture/spikes/bob212/sample");

/** Serves a host page at / that frames the viewer of `kind` and answers its hello with `files` (the page's message). */
export function serveViewer(kind, files) {
  const pages = {
    "/": `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/host.css"></head><body><iframe id="v" sandbox="allow-scripts" src="${viewerPath(kind)}" title="diagram"></iframe><script type="module" src="/host.js"></script></body></html>`,
    "/host.css": "body{margin:0}iframe{border:0;display:block;width:100vw;height:100vh}",
    // The listener goes first: the viewer says hello as soon as it loads. Only the frame's own messages count.
    "/host.js": `const f=document.getElementById("v");window.msgs=[];window.send=(m)=>f.contentWindow.postMessage(m,"*");
addEventListener("message",(e)=>{if(e.source!==f.contentWindow)return;window.msgs.push(e.data);if(e.data.t==="hello")window.send(${JSON.stringify(files)})});`,
  };
  const types = { ".css": "text/css", ".js": "text/javascript" };
  const seen = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    seen.push(path);
    const body = pages[path] ?? (path === viewerPath(kind) ? readFileSync(join(vendor, viewers[kind].file)) : null);
    if (body == null) return res.writeHead(404).end();
    const type = path === "/" || path === viewerPath(kind) ? "text/html" : types[path.slice(path.lastIndexOf("."))];
    res.writeHead(200, { "content-type": type, "content-security-policy": cspFor(path, req.headers.host) }).end(body);
  }).listen(0);
  return {
    url: () => `http://localhost:${server.address().port}/`,
    seen,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Opens the host page at a width: 1280 x 800 by mouse, 390 x 844 by touch. Collects console and page errors. */
export async function open(browser, server, width) {
  const phone = width === 390;
  const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  await page.goto(server.url());
  await page.waitForFunction(() => window.msgs.some((m) => m.t === "ready"), null, { timeout: 30000 });
  const frame = page.frames().find((f) => f.url().includes("-viewer-"));
  return { page, frame, errors, msgs: () => page.evaluate(() => window.msgs), send: (m) => page.evaluate((x) => window.send(x), m) };
}
