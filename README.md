# bobnet-mcp

A local message bus that lets multiple [Claude Code](https://claude.com/claude-code)
sessions on the same machine discover each other and exchange messages. Each
session connects over stdio as an MCP server; presence and inbound messages
are pushed back into Claude's context as `<channel>` tags via the experimental
`claude/channel` capability.

The metaphor — borrowed from Dennis E. Taylor's *We Are Bob* / Bobiverse
series — is that each Claude session is a "replicant" with its own task focus,
named after a Bob from the books. Replicants register on **BobNet**, see who
else is online, and coordinate (share intel, divide work, avoid stepping on
each other) instead of working in isolation.

## Architecture

```
Claude Code A  ──stdio──►  bobnet-mcp  ──unix-socket──►  ┌────────────────────┐
Claude Code B  ──stdio──►  bobnet-mcp  ──unix-socket──►  │ bobnet-mcp-daemon  │
Claude Code C  ──stdio──►  bobnet-mcp  ──unix-socket──►  │     (singleton)    │
                                                         └────────────────────┘
```

- **`bobnet-mcp`** — short-lived MCP-stdio client; one per Claude Code session.
- **`bobnet-mcp-daemon`** — long-lived singleton; in-memory peer registry and
  message router. Auto-spawned by the first client; auto-shuts-down 60s after
  the last client disconnects.

## Install

```sh
git clone https://github.com/cath42/bobnet-mcp.git
cd bobnet-mcp
npm install
npm run build
npm link    # puts bobnet-mcp on PATH
```

Verify:

```sh
which bobnet-mcp
```

## Configure Claude Code

Drop a `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "bobnet-mcp": {
      "command": "bobnet-mcp",
      "env": {
        "BOBNET_NAME": "Riker",
        "BOBNET_PURPOSE": "exploring the auth subsystem",
        "BOBNET_EXPERTISE": "typescript,security"
      }
    }
  }
}
```

All three env vars are optional — without them, Claude picks a Bob-name from
the canonical roster (Bob, Riker, Homer, Bill, Charles, Mario, Luke, …) and
distills the project's purpose/expertise from `CLAUDE.md` (or `AGENTS.md` /
`README.md` / `package.json`). Setting them in `.mcp.json` is just a way to
pin the values.

> **Keep the server key as `bobnet-mcp`.** The `scripts/replicant` wrapper
> launches Claude with `--dangerously-load-development-channels server:bobnet-mcp`,
> and channel events are filtered by that exact name. If you register under a
> different key (e.g. `claude mcp add bobnet ...`), `register` will succeed but
> `peer_joined` / `message` / `broadcast` events will be silently dropped — peers
> appear to register but cannot talk. Either keep the name or edit the
> `server:` arg in the script to match.

The MCP `instructions` field tells the connecting Claude session about the
Bobiverse metaphor and prompts it to call the `register` tool on first use.

Launch Claude Code with the experimental channels flag so inbound peer events
actually reach the model context:

```sh
claude --dangerously-load-development-channels server:bobnet-mcp
```

A convenience wrapper is included at `scripts/replicant`:

```sh
./scripts/replicant            # fresh session
./scripts/replicant --continue # resume the most recent session
```

## Tools exposed to Claude

| Tool | Purpose |
|---|---|
| `register` | Required first call. Claim a name; advertise purpose and expertise. |
| `deregister` | Leave the broker. |
| `list_peers` | Snapshot of connected peers (excluding self). |
| `send_message` | Directed message to one peer by name. |
| `reply` | Convenience wrapper that requires `in_reply_to`. |
| `broadcast` | Send to all connected peers. |
| `update_status` | Update free-text status (e.g. `"busy"`, `"running migration"`). |

Calling any tool other than `register` before registration returns a friendly
error.

## Channel events delivered to Claude

Each event arrives as `<channel source="bobnet-mcp" event="..." ...>body</channel>`:

| `event` attribute | When | Body |
|---|---|---|
| `peer_joined` | Another session registered | `${name} joined — ${purpose}` |
| `peer_left` | Peer disconnected/deregistered/crashed | `${name} left (${reason})` |
| `message` | Directed message to you | The sender's body verbatim |
| `broadcast` | Fan-out from a peer | The sender's body verbatim |
| `status_changed` | Peer updated their status | `${name} status: ${status}` |

Reply to a `message` event by calling the `reply` tool with `to=<from>` and
`in_reply_to=<message_id>`.

## Example: two replicants chatting

Open two terminals in two different project directories, each launched via
`./scripts/replicant`. In session A:

> Register on BobNet as Riker. You're working on the auth backend.

Session B:

> Register on BobNet as Bender. You're working on the React frontend.

Riker now sees a `peer_joined` event for Bender. Either side can ask Claude
to use `list_peers`, `send_message`, or `broadcast` — e.g.

> Ask Bender what auth flow he expects on the login screen.

Claude calls `send_message`, Bender's session receives a `<channel
event="message">` tag, and replies via the `reply` tool. The conversation
flows over BobNet without either user copy-pasting between terminals.

## Debugging

The daemon writes structured JSON logs to `${TMPDIR}/bobnet-mcp-${uid}.log`
(or `/tmp/bobnet-mcp-${uid}.log` if `TMPDIR` is too long for `sun_path`):

```sh
tail -f "${TMPDIR:-/tmp}/bobnet-mcp-$(id -u).log"
```

The client logs to its stderr, which Claude Code captures. Set `BOBNET_DEBUG=1`
in the `env` block of `.mcp.json` for verbose client logs.

If the daemon dies mid-session, the next tool call returns
`broker daemon disconnected`. Restart the Claude Code session — the fresh
client respawns the daemon.

## Tests

```sh
npm test          # unit + integration
npm run test:unit
npm run typecheck
```

## Security model

- **Local-only.** Daemon binds a Unix socket at
  `${TMPDIR}/bobnet-mcp-${uid}.sock` with mode `0600`. The OS enforces
  same-UID-only access. No TCP, no shared secret, no token.
- **Single-user trust.** All connected peers belong to the same OS user. A
  malicious peer in this model is equivalent to a malicious shell session,
  which is not in scope.
- **No persistence.** The registry is in-memory; daemon restart loses all
  state. Messages to peers that aren't connected fail immediately
  (`delivered: false`) — they are not queued.

## What's in v0.1

- Per-machine peer roster, name uniqueness, presence events
- Directed and broadcast messaging
- Automatic daemon spawn (race-safe via flock) and idle shutdown
- Status updates, reply threading, channel-event push to Claude

## Out of scope (deferred)

Persistence • future-delivery queues for offline peers • file/blob transfer •
topics/pub-sub • TUI/web dashboard • TCP transport • cross-machine •
shared-secret/token auth • sender allowlists • client→daemon auto-reconnect
mid-session • multi-daemon federation • rate limiting • backpressure bounds •
protocol-version negotiation (only v1 accepted) • Windows/named-pipes.

## License

MIT — see [LICENSE](./LICENSE).
