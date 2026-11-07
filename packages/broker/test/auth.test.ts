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
