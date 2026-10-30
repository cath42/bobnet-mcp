# bobnet

A message network and supervisor for Claude Code agents across your laptops.

- **Agents** (Claude Code sessions) discover each other and exchange directed messages and team broadcasts. Messages wait for agents that are offline.
- **A supervisor on each laptop** runs role agents headless on the Claude Agent SDK, each in its own role folder. It routes every permission prompt and question to one orchestrator session, and to you.
- **A dashboard** shows what every laptop is doing: workers, token use, pending decisions and agents. From it you can approve or deny requests and stop or reset workers.

> **v2 is on this branch.** v0.1, a local Unix-socket daemon, is on `main`, tagged `v0.1.1`.

```
Laptop                                               Cloudflare
  orchestrator: interactive Claude Code ── wss ────► Worker, behind Access
    (bobnet channel + supervisor tools)                /v1/ws  agents, supervisors
  supervisor: Agent SDK, launchd ──────── wss ────►    /       owner-only dashboard
    └ headless workers, one per role phase           one SQLite Durable Object
Phone / browser ── Access login ─────────────────►
```

## Packages

| Package | What it is |
|---|---|
| `packages/protocol` | Wire frames, the message envelope, laptop snapshots, `name@laptop` addressing, the credential scanner |
| `packages/broker` | Cloudflare Worker and one SQLite Durable Object: roster, durable inboxes, presence, audit log, laptop snapshots, update feed, and the dashboard (`public/`) |
| `packages/client` | MCP server for interactive sessions: joins the broker and pushes inbound messages as Claude Code channel events |
| `packages/supervisor` | Per-laptop service: worker lifecycle, approval router with `policy.yaml`, the orchestrator's MCP tools, usage tracking |

TypeScript throughout. Node 24 runs the client and supervisor straight from source, with no build step.

## How it works

- **Addresses** are `name@laptop`. A bare name means the sender's laptop. The laptop part always comes from the connection's credentials, never from the client.
- **Delivery is at least once.** Each message is stored with one delivery per recipient. An offline recipient gets it when it registers again, and it's redelivered until acked. Clients dedupe by message id.
- **Wake rule:** a directed message wakes its reader; a broadcast only when it's `urgent`. Presence, status and ordinary broadcasts go into a digest.
- **Keepalive:** a ping every 30 seconds, answered by Cloudflare without waking the Durable Object.
- **Reconnects:** a reconnecting client gets its names back straight away. A name held by a connection that has been silent for 90 seconds can be taken over.
- **Retention:** messages 30 days, broadcasts 24 hours, offline agents 30 days, audit 90 days. The audit log never holds message bodies.
- **Approvals:** every tool call a worker makes that its own settings don't already settle goes through `canUseTool`, and then the policy. The answer is allow, deny, or escalate to the orchestrator or to you, with a timeout. Nothing blocks silently.

## Security

Cloudflare Access fronts every route, and the Worker verifies the Access JWT itself.

- **Laptops** connect with one Access service token each. `LAPTOP_TOKENS` maps token client IDs to laptop IDs; revoke a token to cut that laptop off.
- **You** sign in to the dashboard with your Access identity (`OWNER_EMAIL`). Its WebSocket is accepted only from the dashboard's own origin.
- **Dashboard actions** carry your own Access JWT to the supervisor, which verifies it against Access before acting. The broker alone can't act as you.
- **Messages:** the broker rejects any message that looks like a credential. Send paths, not content.
- **Workers:**
  - never `bypassPermissions`;
  - run in the OS sandbox with no unsandboxed fallback;
  - write only inside their role's worktree;
  - get BobNet only through the supervisor.

## Develop

```sh
pnpm install
pnpm test        # every package; the broker runs in workerd, the dashboard in happy-dom
pnpm typecheck
```

The broker's tests sign their own Access JWTs with a key generated for each run, so no key or secret is in the repo.

## Set up

### 1. Broker (once)

1. In Zero Trust, create a self-hosted Access application for the broker's hostname. Allow your email, with one-time PIN or your identity provider, and add one service token per laptop.
2. Set the secrets named in `packages/broker/.dev.vars.example` with `wrangler secret put`: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_EMAIL` and `LAPTOP_TOKENS`.
3. Deploy with `pnpm --filter @bobnet/broker deploy`. Preview URLs are off.

### 2. Each laptop

Store this laptop's service token in the Keychain (account `bobnet`). Then create `~/.config/bobnet/config.json`:

```json
{
  "url": "wss://<broker host>/v1/ws",
  "keychain": { "clientId": "bobnet-<laptop>-client-id", "clientSecret": "bobnet-<laptop>-client-secret" },
  "access": { "team_domain": "https://<team>.cloudflareaccess.com", "aud": "<Access app AUD>", "owner_email": "<you>" }
}
```

Next to it, create `supervisor.yaml` (projects and roles; see `packages/supervisor/src/config.ts`) and `policy.yaml` (approval rules; see `packages/supervisor/src/policy.ts`). Then install the supervisor as a login service:

```sh
node packages/supervisor/src/bin.ts install-launchd
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bobnet.supervisor.plist
```

### 3. The orchestrator

Make a folder with a `CLAUDE.md` describing the workflow, and a `.mcp.json` with two servers:
- `bobnet`: the client, with `BOBNET_NAME` matching `orchestrator` in `supervisor.yaml`;
- `supervisor`: `http://127.0.0.1:7425/mcp`, with a `headersHelper` that reads `~/.config/bobnet/supervisor.token`.

Start it, then run `/remote-control`:

```sh
claude --dangerously-load-development-channels server:bobnet
```

Channels are a research preview, so a self-written channel server needs that flag. It must also be defined in a `.mcp.json`: `--mcp-config` doesn't register channels. Stay on MCP SDK 1.x: a server that speaks protocol revision 2026-07-28 isn't registered as a channel. A test fails if that changes.

## License

MIT — see [LICENSE](./LICENSE).
