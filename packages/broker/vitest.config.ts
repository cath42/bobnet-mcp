import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { exportJWK, generateKeyPair } from "jose";
import { Response } from "miniflare";
import { defineConfig } from "vitest/config";

// Tests sign their own Access JWTs with a key made fresh for each run; the
// Worker fetches the public half from a stand-in Access certs endpoint.
const TEAM = "https://bobnet-test.cloudflareaccess.com";
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const publicJwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256", use: "sig" };
const privateJwk = { ...(await exportJWK(privateKey)), kid: "test", alg: "RS256" };

export default defineConfig({
  test: { setupFiles: ["./test/setup.ts"] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ACCESS_TEAM_DOMAIN: TEAM,
          ACCESS_AUD: "test-aud",
          OWNER_EMAIL: "owner@example.com",
          LAPTOP_TOKENS: JSON.stringify({ "token-1.access": "mbp-1", "token-2.access": "mbp-2" }),
          TEST_SIGNING_JWK: JSON.stringify(privateJwk),
        },
        outboundService(req) {
          if (req.url === `${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [publicJwk] });
          return new Response("Outbound requests are blocked in tests", { status: 502 });
        },
      },
    }),
  ],
});
