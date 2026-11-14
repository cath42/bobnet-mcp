# bobnet

A message network and supervisor for Claude Code agents across your laptops.

- **Agents** (Claude Code sessions) discover each other and exchange directed messages and team broadcasts. Messages wait for agents that are offline.
- **A supervisor on each laptop** runs role agents headless on the Claude Agent SDK, each in its own role folder. It routes every permission prompt and question to one orchestrator session, and to you.
- **A dashboard**, built for a phone as much as a desk, shows who is working on what right now, each project's backlog as kanban boards (the roadmap by release, and a feature's tasks by build session) with the agents at work on their cards, and token use: context per call by session, role and run, and tokens per session. From it you can approve or deny requests and stop or reset workers.

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
- **Approvals:** every tool call a worker makes that its own settings don't already settle goes through `canUseTool`, and then the policy. The answer is allow, deny, or escalate to the orchestrator or to you, with a timeout; a call no rule matches goes to the orchestrator. A chained Bash command is checked part by part and allowed only if every part is. Nothing blocks silently.

## Security

Cloudflare Access fronts every route, and the Worker verifies the Access JWT itself.

- **Laptops** connect with one Access service token each. `LAPTOP_TOKENS` maps token client IDs to laptop IDs, and so does each `LAPTOP_TOKENS_<name>` secret, merged with it; revoke a token to cut that laptop off.
- **You** sign in to the dashboard with your Access identity (`OWNER_EMAIL`). Its WebSocket is accepted only from the dashboard's own origin.
- **Dashboard actions** carry your own Access JWT to the laptop's supervisor, which verifies it against Access before acting. The broker sends them only to the name each supervisor registered as, and takes a laptop's reports only from it. That stops a mistake, not an attacker: the token is a bearer token for as long as it is live (the dashboard app's Access session length), so whoever controls the broker, or a supervisor that receives it, can replay it for dashboard actions until then. A shorter Access session for the dashboard app narrows that window; it is your setting in Access.
- **Messages:** the broker rejects any message that looks like a credential. Send paths, not content.
- **Workers:**
  - never `bypassPermissions`;
  - run in the OS sandbox with no unsandboxed fallback;
  - write only inside their role's worktree (and, for a linked worktree, the git data a commit needs, never hooks or config), plus any `sandbox_write` paths in supervisor.yaml;
  - get BobNet only through the supervisor;
  - start lean: built-in tools Read, Edit, Write, Glob, Grep and Bash (a role's `tools` overrides this), and no MCP server but `bobnet` and those the role names in `mcp` (taken from the project's `.mcp.json`). `memory_dir` on a project or role points workers at another auto-memory folder, whose `MEMORY.md` is the index they load; `false` turns memory off.

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
3. Deploy with `pnpm --filter @bobnet/broker run deploy`. Preview URLs are off.

### 2. Each laptop

Add a service token for this laptop to the Access application, and name it to the broker in a secret of its own, so no other laptop's entry is read or rewritten: from `packages/broker`, `npx wrangler secret put LAPTOP_TOKENS_<NAME>` with `{"<client id>":"<laptop>"}`. Store the token in the Keychain (account `bobnet`). Then create `~/.config/bobnet/config.json`:

```json
{
  "url": "wss://<broker host>/v1/ws",
  "keychain": { "clientId": "bobnet-<laptop>-client-id", "clientSecret": "bobnet-<laptop>-client-secret" },
  "access": { "team_domain": "https://<team>.cloudflareaccess.com", "aud": "<Access app AUD>", "owner_email": "<you>" }
}
```

Next to it, create `supervisor.yaml` (projects and roles; see `packages/supervisor/src/config.ts`) and `policy.yaml` (approval rules; see `packages/supervisor/src/policy.ts`). For a project's boards, point it at a [Backlog.md](https://github.com/MrLesk/Backlog.md) backlog: `backlog: { dir: product/backlog }`. It is read from git at the rebase target (or `origin/main`), never from a worktree; a task's `build:<n>` (or `build:design`) label puts it in a build session, and a worker belongs to the session its spawn declares (`spawn_worker`'s `session`, e.g. `{ feature: LAND-43, kind: build, label: B }`) and shows on the cards its spawn names (`tasks`); nothing is read from the brief. Set a project's `orchestrator_dir` to the folder its orchestrator's Claude Code session runs in, and its usage shows in each session beside its workers'. Then install the supervisor as a login service:

```sh
node packages/supervisor/src/bin.ts install-launchd
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bobnet.supervisor.plist
```

On Linux, workers run in Claude Code's sandbox, which is bubblewrap there: `apt install bubblewrap socat`. Ubuntu 24.04 keeps bubblewrap from creating user namespaces (`kernel.apparmor_restrict_unprivileged_userns=1`), so the sandbox fails with `loopback: Failed RTM_NEWADDR: Operation not permitted`. Give bwrap alone its own AppArmor profile; the rest of the system stays as it is:

```sh
sudo tee /etc/apparmor.d/bwrap >/dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/bwrap
bwrap --ro-bind / / --unshare-net true && echo sandbox ok
```

The supervisor runs the same check when it starts. If it fails, the supervisor logs why and refuses to spawn sandboxed roles, saying why, instead of letting a worker die at its first call.

Install it as a systemd user service instead of the LaunchAgent. There's no Keychain, so put the laptop's service token in `~/.config/bobnet/supervisor.env` (mode 0600) as `BOBNET_ACCESS_CLIENT_ID=…` and `BOBNET_ACCESS_CLIENT_SECRET=…`, and leave `keychain` out of `config.json`. Workers never get those variables, and they can't read the supervisor's folder.

```sh
node packages/supervisor/src/bin.ts install-systemd
systemctl --user daemon-reload && systemctl --user enable --now bobnet-supervisor
loginctl enable-linger $USER   # keep it running while you're logged out
```

Another laptop's orchestrator can ask this supervisor to spawn. List it in `supervisor.yaml` under `remote`, by address, with the roles it may spawn:

```yaml
remote:
  poe@ubu1: { spawn: { helix: [bob] } }
```

It sends `supervisor@<laptop>` a BobNet message whose body is one JSON request, and gets one JSON answer back:
- `{"op":"spawn","project":…,"role":…,"task":…,"tasks":[…],"session":{…}}`, optionally with `model` and `effort`;
- `{"op":"status","id":…}`, `{"op":"stop","id":…}` and `{"op":"list"}`, which reach only workers it spawned.

It also hears when each of its workers' Remote Control session is ready and when the worker ends. It can't answer requests, change policy or roles, or resume a session. The broker's word on who sent a message is trusted (Casper, 2026-11-07), so the list is the whole guard: keep it narrow.

### 3. The orchestrator

Make a folder with a `CLAUDE.md` describing the workflow, and a `.mcp.json` with two servers:
- `bobnet`: the client, with `BOBNET_NAME` matching `orchestrator` in `supervisor.yaml`;
- `supervisor`: `http://127.0.0.1:7425/mcp`, with a `headersHelper` that reads `~/.config/bobnet/supervisor.token`.

Start it, then run `/remote-control`:

```sh
claude --dangerously-load-development-channels server:bobnet
```

A role with `lead: true` can run as a lead: a long-lived session you talk to, as many per project as it needs (a product owner, an architect, the orchestrator). Whoever spawns it decides: `spawn_worker` (and the remote `spawn` op) takes `as: "lead"` or `as: "worker"`, and the default is a worker, which ends after its result like any other role. So when you want a lead, ask for one (poe spawns it `as: "lead"`); when a lead spawns the role for a task, it gets a worker. A role runs one worker at a time, so a task run waits while the role's lead runs, and the spawn says so.

As a lead:
- **Life:** it stays alive between turns and wakes on each message (a BobNet message, a worker's news, or you typing), with the same info-only digest an interactive session gets. It ends only when stopped.
- **Running:** it holds none of the laptop's worker slots and is never stalled by the clock. It runs in auto mode unless its role or project sets `permission_mode`.
- **Talking:** it has `broadcast`, `post_update` and `update_status`, and asks you its questions in its own session.

Any other lead is a worker under `policy.yaml` like the rest, and its requests go to the project's orchestrator.

**The lead named as its project's orchestrator is the orchestrator, run as a worker,** and can do what the interactive orchestrator does, and nothing less:
- It gets the orchestrator's tools in-process, so no token reaches it.
- `policy.yaml`'s rules don't bind it. Only two guards do: the supervisor's folder and hooks. Auto mode judges the rest, and what that leaves open waits for you on the dashboard, with no timeout.
- It never answers its own requests.

Every worker starts with Remote Control on, named for its session: follow it and type to it in claude.ai/code, through the link in `worker_status` and on the dashboard. Set `remote_control: false` on the supervisor, a project or a role to turn it off; a consult never has it. That uses the Agent SDK's `enableRemoteControl`, which isn't in its types, so the SDK is pinned; without it, the worker runs on and says why.

Channels are a research preview, so a self-written channel server needs that flag. It must also be defined in a `.mcp.json`: `--mcp-config` doesn't register channels. Stay on MCP SDK 1.x: a server that speaks protocol revision 2026-07-28 isn't registered as a channel. A test fails if that changes.

## License

MIT — see [LICENSE](./LICENSE).
