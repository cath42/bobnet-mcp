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

// Every secret named LAPTOP_TOKENS or LAPTOP_TOKENS_<anything> is a JSON map of
// client ID to laptop ID, merged: a new laptop adds its own secret without
// reading or rewriting the others.
function laptopTokens(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (!/^LAPTOP_TOKENS(_\w+)?$/.test(name) || typeof value !== "string") continue;
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) throw new Error(`${name} must be a JSON object`);
    Object.assign(out, parsed);
  }
  return out;
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
