# R2 "Run the team from your phone": what it delivered, and where R3 stands (Peach, 2026-11-26)

**R2 is complete: 7 of 7 features Done.** I have not closed R2 on the board. Closing it is your
approval to give (rule of 2026-11-25), and nothing in R4 starts until you approve R2 and R4's scope.
poe asks you.

Goal: answers wake agents; Waits and permissions are never stale or cut.

Links open on GitHub (branch `v2`): https://github.com/cath42/bobnet-mcp/blob/v2/

## What R2 delivered

| Feature | In plain words | Read |
|---|---|---|
| BOB-189 | Product owners create, edit, order, close and reopen releases on the board themselves | [review](https://github.com/cath42/bobnet-mcp/blob/v2/design/BOB-189/review-A.md) |
| BOB-122 | A PO moves a feature into or out of a release; it is no longer your gate | [board writes](https://github.com/cath42/bobnet-mcp/blob/v2/product/requirements/board-writes.md) |
| BOB-44 | One orchestrator spawns, follows, answers and stops workers on another laptop's supervisor | [requirement](https://github.com/cath42/bobnet-mcp/blob/v2/product/requirements/remote-orchestration.md), [laptop mark](https://github.com/cath42/bobnet-mcp/blob/v2/design/BOB-44/laptop-mark.md) |
| BOB-48 | Dead permission requests clear by themselves, and a quiet laptop is shown as quiet | [design](https://github.com/cath42/bobnet-mcp/tree/v2/design/BOB-48), [architecture](https://github.com/cath42/bobnet-mcp/tree/v2/architecture/bob48) |
| BOB-51 | A permission question reaches the dashboard whole, and a note sent with Allow is delivered | [design](https://github.com/cath42/bobnet-mcp/tree/v2/design/BOB-51), [architecture](https://github.com/cath42/bobnet-mcp/tree/v2/architecture/bob51) |
| BOB-111 | Your answer to a board question wakes whoever it holds up | [architecture](https://github.com/cath42/bobnet-mcp/tree/v2/architecture/bob111) |
| BOB-49 | Waits on you is never stale: a landed fix flags its bug for the PO, anything unchanged for a day is flagged to its owner, and a lead's question to you shows on Needs you | [spec](https://github.com/cath42/bobnet-mcp/blob/v2/design/BOB-49/spec.md), [review B](https://github.com/cath42/bobnet-mcp/blob/v2/architecture/bob49/review-B.md) |

## What is not in R2 (so you can judge it)

- **BOB-49 AC3 is counted on BobNet and Helix.** Both leads asked you with `board_ask` and
  `holds_sessions` and it showed on Needs you (Helix Q-294, Q-295; BobNet Q-16; poe's evidence of
  2026-11-26). Vitals and Athletic are on hold (your word, 2026-11-25), so their leads' lines and
  check moved to **BOB-207** in R7 (Harden what we built).
- Nobody has looked at the dashboard's Needs you with you present; if you want that checked by eye,
  say so.

## R3 "Dashboard revamp": already approved (Q-15), in progress

Goal: the dashboard looked at whole, use case first, as the prototype you approved with changes (Q-13).

| Feature | Where it stands |
|---|---|
| BOB-121 Dashboard redesign, use case first | All five builds (A to E) are live; build E's fix pass (BOB-202) is at broker version e2188d27 (2026-11-26). Daisy and Toad reviewed every build: no blockers, no majors. 24 of 31 tasks Done. Open: production checks (Status on Helix's real board BOB-183, Projects at a glance BOB-179, Needs you live items BOB-176) and your acceptance, DoD 3. |
| BOB-33 Status tab: catch up after hours away | Built (5 of 5 tasks), Draft: closes with BOB-121's Status check. |

**The one thing for you:** the dashboard question (Overview, Needs you, Projects, Status, Roadmap,
Features, Usage): accept, accept with changes, or not yet. Draft is in
[bob121-dod3-question.md](https://github.com/cath42/bobnet-mcp/blob/v2/product/bob121-dod3-question.md).
**Recommendation: accept.** Everything tests and screenshots can meet is checked; the open minors
(BOB-203 to 205) are polish. If Status or the Overview looks wrong on your real data, say accept with changes.

## R4 "Runs without you": waits for you

Goal: work goes on through the night, lands don't fail on a busy laptop, poe changes a laptop's config
without your hands. Features: BOB-188 (resume after a usage limit resets), BOB-190 (lands fail only
for real; run the land hook on another laptop), BOB-158 (poe edits another laptop's supervisor.yaml
remotely). All Draft; **nothing in R4 starts** until you approve R2 and R4's scope. Recommendation:
approve R2, finish R3's acceptance, then R4 in that order (BOB-188 first: it saves the most night hours).
