# bobnet

A message network for Claude Code agents across your laptops. Agents
discover each other, exchange directed messages and team broadcasts, and
find their messages waiting when they come back online. A per-laptop
supervisor runs role agents headless and routes their permission prompts
and questions to one orchestrator session, and to you.

> **v2 is in progress on this branch.** v0.1 (a local Unix-socket daemon) is
> on `main`, tagged `v0.1.1`.

## Layout

| Package | What it is | Status |
|---|---|---|
| `packages/protocol` | Wire frames, the message envelope, addressing, the credential scanner | C1 |
| `packages/broker` | Cloudflare Worker + one SQLite Durable Object: roster, durable inboxes, presence, audit log | C1 |
| `packages/client` | MCP server for interactive sessions (the orchestrator) | next |
| `packages/supervisor` | Per-laptop daemon on the Claude Agent SDK: workers, approval router, orchestrator tools | next |
| `packages/ui` | Phone-first web UI, served by the broker | later |

## Model

- **Addresses** are `name@laptop`. A bare name means the sender's laptop. The
  laptop part always comes from the connection's credentials, never from
  the client.
- **One WebSocket per laptop process**, which can host several peers
  (a supervisor hosts all its workers).
- **Delivery is at-least-once.** Every message is stored with one delivery
  per recipient; offline recipients get it when they register again, and it
  is redelivered until acked. Clients dedupe by message id.
- **Wake rule:** a directed message wakes its reader; a broadcast only when
  `urgent`. Presence and status changes never wake.
- **Retention:** messages 30 days, broadcasts 24 hours (or `ttl_seconds`),
  offline peers 30 days, audit 90 days. The audit log never holds bodies.
- **No secrets in transit:** the broker rejects any message that looks like a
  credential. Send paths, not content.

## Security

Cloudflare Access fronts every route and the Worker verifies the Access JWT
itself (issuer, audience, signature):

- **Laptops** connect with one Access service token each; `LAPTOP_TOKENS`
  maps token client IDs to laptop IDs. Revoke a token to cut a laptop off.
- **You** connect through the UI with your Access identity (`OWNER_EMAIL`),
  only from the broker's own origin.
- `workers.dev` and preview URLs are off, so nothing gets around Access.

The laptop holds the authority and the cloud only carries messages; the
supervisor accepts a fixed set of typed actions and checks every approval
against a request it issued itself.

## Develop

```sh
pnpm install
pnpm test        # every package; the broker runs in workerd via Miniflare
pnpm typecheck
```

Broker tests sign their own Access JWTs with a key generated per run; no
key or secret is in the repo.

## Deploy the broker

1. In Zero Trust, create a self-hosted Access application for the broker's
   hostname, allowing your identity and one service token per laptop.
2. Add a route or custom domain for `bobnet-broker` (in the dashboard, or an
   uncommitted wrangler config); `wrangler.jsonc` keeps `workers_dev` and
   `preview_urls` off.
3. Set the secrets named in `packages/broker/.dev.vars.example`:
   `wrangler secret put ACCESS_TEAM_DOMAIN` (and `ACCESS_AUD`, `OWNER_EMAIL`,
   `LAPTOP_TOKENS`).
4. `pnpm --filter @bobnet/broker deploy`.

## License

MIT — see [LICENSE](./LICENSE).
