import { describe, expect, it } from "vitest";
import { accessToken, Client, laptopToken, ORIGIN, ownerToken, upgrade } from "./helpers.ts";

describe("Worker auth", () => {
  it("answers nothing to an unauthenticated request", async () => {
    const { exports } = await import("cloudflare:workers");
    expect((await exports.default.fetch(`${ORIGIN}/`)).status).toBe(401);
    expect((await exports.default.fetch(`${ORIGIN}/app.js`)).status).toBe(401);
    expect((await exports.default.fetch(`${ORIGIN}/v1/ws`)).status).toBe(401);
  });

  it("serves the dashboard to the owner only, with a strict content policy", async () => {
    const { exports } = await import("cloudflare:workers");
    const page = await exports.default.fetch(`${ORIGIN}/`, { headers: { "cf-access-jwt-assertion": await ownerToken() } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>BobNet</title>");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(page.headers.get("content-security-policy")).toContain("connect-src 'self' wss://bobnet.test;");
    const laptop = await exports.default.fetch(`${ORIGIN}/`, { headers: { "cf-access-jwt-assertion": await laptopToken(1) } });
    expect(laptop.status).toBe(404);
    const ws = await exports.default.fetch(`${ORIGIN}/v1/ws`, { headers: { "cf-access-jwt-assertion": await laptopToken(1) } });
    expect(ws.status).toBe(426);
  });

  it("serves the vendored libraries immutable, by their versioned names, and everything else no-store (ADR 0015 §6)", async () => {
    const { exports } = await import("cloudflare:workers");
    const get = async (path: string) => exports.default.fetch(`${ORIGIN}${path}`, { headers: { "cf-access-jwt-assertion": await ownerToken() } });
    const md = await get("/vendor/markdown-it-15.0.3.min.js");
    expect(md.status).toBe(200);
    expect(md.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(md.headers.get("content-type")).toMatch(/javascript/);
    expect((await get("/vendor/mermaid-11.17.2.min.js")).headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect((await get("/app.js")).headers.get("cache-control")).toBe("no-store");
    expect((await get("/vendor/none-1.0.0.min.js")).headers.get("cache-control")).toBe("no-store");
    const laptop = await exports.default.fetch(`${ORIGIN}/vendor/markdown-it-15.0.3.min.js`, { headers: { "cf-access-jwt-assertion": await laptopToken(1) } });
    expect(laptop.status).toBe(404);
  });

  it("frames the viewers: the page may frame its own origin, and each viewer has its own content policy (ADR 0016 §6, 0017 §7)", async () => {
    const { exports } = await import("cloudflare:workers");
    const viewers = (await import("../public/vendor/viewers.json")).default;
    const get = async (path: string) => exports.default.fetch(`${ORIGIN}${path}`, { headers: { "cf-access-jwt-assertion": await ownerToken() } });
    const page = (await get("/")).headers.get("content-security-policy")!;
    expect(page).toContain("frame-src 'self';");
    expect(page).toContain("script-src 'self';");
    expect(page).not.toContain("eval");

    const at = (file: string) => `/vendor/${file.replace(/\.html$/, "")}`;
    const likec4 = await get(at(viewers.likec4.file));
    expect(likec4.status).toBe(200);
    expect(likec4.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const lc = likec4.headers.get("content-security-policy")!;
    expect(lc).toBe(`default-src 'none'; script-src ${viewers.likec4.scripts.join(" ")} 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
    expect(lc).not.toContain("'unsafe-eval'");

    const erd = await get(at(viewers.erd.file));
    expect(erd.status).toBe(200);
    expect(erd.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const e = erd.headers.get("content-security-policy")!;
    expect(e).toBe(`default-src 'none'; script-src ${viewers.erd.scripts.join(" ")} 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
    expect(e).not.toContain("wasm-unsafe-eval");
    // Each hash is of a script in the file the Worker serves: a re-pack without a new viewers.json fails here.
    const { createHash } = await import("node:crypto");
    for (const [res, kind] of [[likec4, "likec4"], [erd, "erd"]] as const) {
      const html = await res.text();
      const inline = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`);
      expect(inline).toEqual(viewers[kind].scripts);
    }
    // The file's own name redirects to that address, which is what the page frames.
    const named = await exports.default.fetch(`${ORIGIN}/vendor/${viewers.erd.file}`, { headers: { "cf-access-jwt-assertion": await ownerToken() }, redirect: "manual" });
    expect(new URL(named.headers.get("location")!, ORIGIN).pathname).toBe(at(viewers.erd.file));
    // Any other vendored file keeps the page's policy.
    expect((await get("/vendor/markdown-it-15.0.3.min.js")).headers.get("content-security-policy")).toBe(page);
  });

  it("rejects a missing, forged or misaddressed token", async () => {
    expect((await upgrade(null)).status).toBe(401);
    expect((await upgrade("not-a-jwt")).status).toBe(401);
    expect((await upgrade(await accessToken({ common_name: "token-1.access" }, { aud: "other" }))).status).toBe(401);
    expect((await upgrade(await accessToken({ common_name: "token-1.access" }, { iss: "https://evil.example" }))).status).toBe(401);
    expect((await upgrade(await accessToken({ common_name: "token-1.access" }, { expiresIn: "-1m" }))).status).toBe(401);
  });

  it("rejects an unknown service token and anyone but the owner", async () => {
    expect((await upgrade(await accessToken({ common_name: "token-9.access" }))).status).toBe(401);
    expect((await upgrade(await accessToken({ email: "someone@example.com" }), { origin: ORIGIN })).status).toBe(401);
  });

  it("lets no laptop take the board's reserved id, whatever its case (ADR 0001 §7)", async () => {
    expect((await upgrade(await accessToken({ common_name: "token-3.access", sub: "" }))).status).toBe(401);
  });

  it("stamps the laptop from the token, whichever LAPTOP_TOKENS_* secret names it", async () => {
    const res = await upgrade(await laptopToken(2));
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const first = await new Promise<string>((r) => ws.addEventListener("message", (e) => r(e.data as string), { once: true }));
    expect(JSON.parse(first)).toEqual({ t: "welcome", v: 1, identity: { kind: "laptop", laptop: "mbp-2" } });
    ws.close();
  });

  it("lets the owner in only from the broker's own origin", async () => {
    expect((await upgrade(await ownerToken())).status).toBe(403);
    expect((await upgrade(await ownerToken(), { origin: "https://evil.example" })).status).toBe(403);
    const owner = await Client.open(await ownerToken(), { origin: ORIGIN });
    owner.close();
  });
});
