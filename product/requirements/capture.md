# 7. Capture backlog items without structuring them

**Who needs it:** Casper, who throws items at an agent to capture for later without stopping to
structure them (Casper, 2026-11-13). Any agent that finds work outside its task. The PO, who triages.

**What it is:** a **backlog item** is work captured but not yet slotted in a feature. It may be in a
release or in none: "it may not even know the release yet" (Casper). Later the PO slots it into a
feature, makes it a feature of its own, or drops it.

## Criteria

1. Any agent can capture an item with one MCP call, with only a title and a sentence. Project,
   release, type and anything else are optional. *Evidence: MCP test.*
2. Capture never asks a question back and never blocks the agent. Missing fields stay empty, to be
   filled at triage. *Evidence: test.*
3. A captured item records where it came from: who captured it, in which session, and Casper's
   words verbatim when it was Casper's. *Evidence: test.*
4. Backlog items show as a triage list per project, and per release for those that have one, with
   count and age. *Evidence: test; screenshot on phone.* (Picard input, need 4: drafts as a triage
   queue)
5. Triage can slot an item into a feature (it becomes a task), make it a feature, put it in a release
   or take it out, or drop it with a reason. It keeps its id throughout. *Evidence: test.*
6. Casper can capture from the dashboard too, in one field, on a phone. *Evidence: screenshot on
   phone.*

## Open questions

- *Settled (Picard, 2026-11-14):* Helix's `drafts/` (DRAFT-n, ~103 items) are only captured, not-yet-in-a-feature items, the same thing; some carry a parent hint (DRAFT-46: parent LAND-43) or a milestone, which the PO clears or sets when placing them. They move over as backlog items ([migration.md](migration.md)); keep the hints as fields.
- *Settled (Casper, 2026-11-13):* no capture without a project. Every item belongs to a project from
  the moment it is captured.
