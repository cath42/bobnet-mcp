import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type OwnerCheck, ownerCheck } from "../src/owner.ts";

// A stand-in Access team: serves its public key at /cdn-cgi/access/certs.
let server: Server;
let team: string;
let sign: (claims: JWTPayload, opts?: { aud?: string; iss?: string; exp?: string }) => Promise<string>;
let check: OwnerCheck;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  server = createServer((req, res) => {
    if (req.url === "/cdn-cgi/access/certs") res.end(JSON.stringify({ keys: [jwk] }));
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  team = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  sign = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? team)
      .setAudience(opts.aud ?? "the-aud")
      .setExpirationTime(opts.exp ?? "5m")
      .sign(privateKey);
  check = ownerCheck({ team_domain: team, aud: "the-aud", owner_email: "Owner@Example.com" });
});

afterAll(() => server.close());

describe("ownerCheck", () => {
  it("accepts the owner's valid Access token", async () => {
    expect(await check(await sign({ email: "owner@example.com" }), "owner@example.com")).toBe(true);
  });

  it("rejects anyone else, a mismatched claim, or a bad token", async () => {
    expect(await check(await sign({ email: "someone@example.com" }), "someone@example.com")).toBe(false);
    expect(await check(await sign({ email: "owner@example.com" }), "someone@example.com")).toBe(false);
    expect(await check(await sign({ email: "owner@example.com" }, { aud: "other" }), "owner@example.com")).toBe(false);
    expect(await check(await sign({ email: "owner@example.com" }, { iss: "https://evil.example" }), "owner@example.com")).toBe(false);
    expect(await check(await sign({ email: "owner@example.com" }, { exp: "-1m" }), "owner@example.com")).toBe(false);
    expect(await check("not-a-jwt", "owner@example.com")).toBe(false);
  });
});
