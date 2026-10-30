import type { Identity } from "@bobnet/protocol";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Cloudflare Access sits in front of every route; the Worker verifies the
// Access JWT itself as well, so a misconfigured route can't let anything in.
// Service tokens (laptops) carry `common_name` = the token's client ID;
// users carry `email`.

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(team: string) {
  let jwks = jwksByTeam.get(team);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    jwksByTeam.set(team, jwks);
  }
  return jwks;
}

function laptopTokens(env: Env): Record<string, string> {
  const parsed: unknown = JSON.parse(env.LAPTOP_TOKENS);
  if (typeof parsed !== "object" || parsed === null) throw new Error("LAPTOP_TOKENS must be a JSON object");
  return parsed as Record<string, string>;
}

/** Returns who the request is from, or null if it isn't the owner or a known laptop. */
export async function authenticate(req: Request, env: Env): Promise<Identity | null> {
  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.OWNER_EMAIL) return null;

  const team = env.ACCESS_TEAM_DOMAIN.replace(/\/+$/, "");
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwksFor(team), { issuer: team, audience: env.ACCESS_AUD }));
  } catch {
    return null;
  }

  const commonName = payload["common_name"];
  if (typeof commonName === "string" && commonName !== "") {
    const laptop = laptopTokens(env)[commonName];
    return laptop ? { kind: "laptop", laptop } : null;
  }

  const email = payload["email"];
  if (typeof email === "string" && email.toLowerCase() === env.OWNER_EMAIL.toLowerCase()) {
    return { kind: "owner", email: email.toLowerCase() };
  }
  return null;
}
