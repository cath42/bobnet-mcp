# BobNet

BobNet connects Claude Code agents across Casper's laptops: a broker on Cloudflare (`packages/broker`,
with the dashboard in `public/`), a channel client each agent runs (`packages/client`), the wire
protocol (`packages/protocol`), and the supervisor that runs role agents headless on a laptop
(`packages/supervisor`). Projects such as Helix run their teams on it, and so does this one.

This file is loaded for every role. Your own rules are in your role's folder:

| Role | Name | Folder | Owns |
|---|---|---|---|
| Lead, orchestrator | Mario | `lead/` | the plan, who works on what, landing order, releases |
| Product owner | Peach | `product/` | requirements, the board (`product/backlog`), acceptance |
| UI/UX designer | Daisy | `design/` | how BobNet looks and behaves on screen: specs, prototypes |
| Architect | Toad | `architecture/` | ADRs, the protocol and data model, how the parts fit |
| Full-stack engineer | Luigi | `packages/` | the code: broker, dashboard, client, protocol, supervisor |

## Ground rules

- **BobNet runs the team that builds it.** The live supervisor runs an installed release
  (`~/.local/share/bobnet/<tag>`), not this repo. A repo change is live only after a release and a
  restart. Never touch `~/.config/bobnet`, `~/.local/share/bobnet`, `launchctl` or the plist:
  releases are Mario's, restarts are poe's, the config is Casper's.
- **The broker is production.** `wrangler deploy` (`pnpm run deploy` in `packages/broker`) runs only
  when Casper asks for that deploy. It drops every agent's connection.
- **One role per worktree.** You work in `~/Code/bobnet-mcp-<you>`, on your branch `<you>/work`. The
  line is `v2` (not `main`, which is the v0.1 release). Commit, then call the `land` tool: it runs
  `pnpm -r typecheck`, `pnpm -r test` and pushes to `v2`, in the run slot. Never push, fetch or
  rebase yourself; call `rebase`.
- **Files record, messages coordinate.** Put what you produce in your folder and send the path.
- **Usage is tokens, never dollars** (a Max subscription), in the UI and in reports.
- **The dashboard has its own look** (`packages/broker/public/style.css`), never another product's,
  and works on a phone and a tablet.
- **Boards stay in their repos.** BobNet shows and launches; a project's board files are written by
  that project's product owner with its own tools, never by BobNet.
- Questions only Casper can answer go to Mario, who asks Casper. Peach asks Casper directly about
  requirements, in Peach's own conversations.
