import { createRemoteJWKSet, jwtVerify } from "jose";

// Dashboard actions arrive through the broker carrying the owner's Access JWT.
// The supervisor checks that token against Cloudflare Access itself, so a
// broker that has been taken over can't act as the owner.

export interface AccessConfig {
  /** e.g. https://myteam.cloudflareaccess.com */
  team_domain: string;
  aud: string;
  owner_email: string;
}

export type OwnerCheck = (token: string, claimedEmail: string) => Promise<boolean>;

export function ownerCheck(access: AccessConfig): OwnerCheck {
  const team = access.team_domain.replace(/\/+$/, "");
  const jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
  const owner = access.owner_email.toLowerCase();
  return async (token, claimedEmail) => {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: team, audience: access.aud });
      const email = typeof payload["email"] === "string" ? payload["email"].toLowerCase() : "";
      return email === owner && email === claimedEmail.toLowerCase();
    } catch {
      return false;
    }
  };
}
