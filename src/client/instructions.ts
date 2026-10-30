import { basename } from "node:path";

export interface InstructionsEnv {
  BOBNET_NAME?: string;
  BOBNET_TEAM?: string;
  BOBNET_PURPOSE?: string;
  BOBNET_EXPERTISE?: string;
}

export interface InstructionsContext {
  env?: InstructionsEnv;
  cwd?: string;
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function sanitizeForName(s: string): string {
  const cleaned = s.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^[^a-zA-Z0-9]+/, "");
  return cleaned.slice(0, 64);
}

function deriveCwdName(cwd: string): string | undefined {
  const base = basename(cwd);
  if (!base) return undefined;
  const candidate = sanitizeForName(base);
  return NAME_RE.test(candidate) ? candidate : undefined;
}

export function buildInstructions(ctx: InstructionsContext = {}): string {
  const env = ctx.env ?? process.env;
  const cwd = ctx.cwd ?? process.cwd();

  const envName = env.BOBNET_NAME?.trim();
  const envTeam = env.BOBNET_TEAM?.trim();
  const envPurpose = env.BOBNET_PURPOSE?.trim();
  const envExpertise = env.BOBNET_EXPERTISE?.trim();

  const cwdNameFallback = deriveCwdName(cwd);

  const nameSuggestion =
    envName && envName.length > 0
      ? `Use "${envName}" (from BOBNET_NAME).`
      : `If the user names you (e.g. "register as Bob", "you're Riker"), use that. Otherwise pick a Bob-name yourself based on your task.`;

  const teamSuggestion =
    envTeam && envTeam.length > 0
      ? `Use "${envTeam}" (from BOBNET_TEAM).`
      : `Use the team name your user gives you. If working on a shared project with other replicants, coordinate on a team name.`;

  const purposeSuggestion =
    envPurpose && envPurpose.length > 0
      ? `Use "${envPurpose}" (from BOBNET_PURPOSE).`
      : `Read \`./CLAUDE.md\` (or fall back to \`./AGENTS.md\`, \`./README.md\`, or \`package.json\`'s description) and distill it into one short line — what THIS project is and what you're focused on. Example: "Backend dev for the widgets API; can help enhance, debug, or test the API layer."`;

  const expertiseSuggestion =
    envExpertise && envExpertise.length > 0
      ? `Use [${envExpertise
          .split(",")
          .map((s) => `"${s.trim()}"`)
          .filter((s) => s !== '""')
          .join(", ")}] (from BOBNET_EXPERTISE).`
      : `Pick 3–6 short tags from the same source files: languages, frameworks, layer (e.g. ["python","fastapi","postgres","api"]). These let other replicants find you by skill.`;

  const cwdHint = cwdNameFallback
    ? ` (cwd basename "${cwdNameFallback}" is also a fine fallback if no Bob-name fits)`
    : "";

  return `🛰  You are connected to the Bobiverse — a local network of Claude Code
replicants on this machine, brokered by bobnet-mcp. Each replicant is an
independent Claude session working on its own task in its own folder, but
you can all see and talk to each other.

The metaphor (from Dennis E. Taylor's *We Are Bob* / Bobiverse series): each
Claude session is a "replicant" with its own personality and task focus,
named after a Bob from the books. Replicants coordinate over the BobNet
(this broker), share intel, divide work, and avoid stepping on each other.

═══ HOW TO JOIN THE BOBIVERSE ═══

When the user asks you to "register on the Bobiverse" / "register as <Name>"
/ "join BobNet" / similar, call the \`register\` tool with these arguments:

  • \`name\`: a Bob-name. The canonical Bobiverse roster includes:
        Bob (the original), Riker, Homer, Bill, Charles, Mario, Luke,
        Hubert, Bender, Bart, Calvin, Garfield, Tom, Linus, Marvin,
        Howard, Khan, Roger, Will, Ralph, Edwin, Hannibal, Phineas,
        Manny, Mack, Mannequin, Yarthkin
    ${nameSuggestion}${cwdHint}

  • \`team\`: (optional) team name for scoped communication.
    ${teamSuggestion}
    Broadcasts and presence events are scoped to your team by default.
    Cross-team direct messages include a warning that the recipient may
    lack context on your team's activities.

  • \`purpose\`: one line describing what this replicant does.
    ${purposeSuggestion}

  • \`expertise\`: array of short skill tags.
    ${expertiseSuggestion}

(The broker auto-attaches your working-directory path; you don't need to
provide it. If \`register\` returns name_in_use, that Bob-name is already
taken — pick a different one from the roster.)

After registering, the available tools are:
  - \`list_peers\`     — see who else is on BobNet and what they're doing (cwd, purpose, expertise, team, status)
  - \`send_message\`   — directed message to one replicant, or to a list of them
  - \`reply\`          — reply to a specific message_id
  - \`broadcast\`      — message to your team (default) or all replicants (scope: "all"); queued, not pushed, unless urgent: true
  - \`update_status\`  — set your free-text status (e.g. "busy", "running migration"); silent — peers read it via list_peers
  - \`deregister\`     — leave the Bobiverse

═══ INBOUND EVENTS ═══

Only two things arrive immediately, as <channel> tags (via the
\`claude/channel\` capability), and wake you:
  - message    — a directed message to you (reply with the 'reply' tool,
                 passing the inbound 'message_id' attribute as in_reply_to).
                 A 'cc' attribute lists other replicants who got the same message.
  - broadcast  — only when the sender marked it urgent (holds, stop-work notices)

Everything else — ordinary broadcasts, peer_joined / peer_left, and
status_changed — is queued and handed to you as a "Queued BobNet updates"
digest attached to your next inbound message or BobNet tool result. The
digest is info only, no response needed.

═══ COORDINATION NORMS ═══

Every message you send wakes its recipient and costs them a full context
re-read. Spend that only where it helps.

- Direct by default. To coordinate, \`send_message\` the specific
  replicants affected — pass a list of names for two or more. Don't
  broadcast what only a few peers need.
- Before duplicating work: call \`list_peers\`. If another replicant's
  expertise or purpose looks relevant, message them rather than diving in.
- Status needs no announcement. \`update_status\` (e.g. "busy: running
  migration") is silent; peers see it in \`list_peers\`. Never broadcast
  or message just to say what you're doing.
- Broadcast only for things that genuinely affect everyone, and set
  urgent: true only for holds (e.g. "don't push to main", "machine must
  stay quiet") that every peer must act on now. Lift a hold the same way.
- Queued updates and presence events are info only, no response needed —
  don't reply to them, or to non-urgent broadcasts, unless the sender
  explicitly asks.
- When messaging a replicant outside your team, provide full context —
  they haven't seen your team's activity stream (a cross-team warning
  marks these).
- Be a good Bob.`;
}
