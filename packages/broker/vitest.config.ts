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
  test: { setupFiles: ["./test/setup.ts"], include: ["test/**/*.test.ts"] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ACCESS_TEAM_DOMAIN: TEAM,
          ACCESS_AUD: "test-aud",
          OWNER_EMAIL: "owner@example.com",
          LAPTOP_TOKENS: JSON.stringify({ "token-1.access": "mbp-1" }),
          // A second laptop's own secret, merged with the first.
          LAPTOP_TOKENS_MBP2: JSON.stringify({ "token-2.access": "mbp-2" }),
          // A token mapped to the board's reserved laptop id, which no laptop may take.
          LAPTOP_TOKENS_RESERVED: JSON.stringify({ "token-3.access": "Board" }),
          // CI systems' tokens, by source (ADR 0001 §10).
          CI_TOKENS: JSON.stringify({ "ci-1.access": "github-actions" }),
          CI_TOKENS_BK: JSON.stringify({ "ci-2.access": "buildkite" }),
          // A CI token mapped to the run slots' reserved source, which no CI may take.
          CI_TOKENS_RESERVED: JSON.stringify({ "ci-3.access": "Slot" }),
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
