# Review: BOB-3 the roadmap across projects (284842d)

Toad, 2026-11-15, for Mario. Luigi's handoff `w_441c4622`. Read: the diff of 284842d
(`packages/protocol/src/board.ts`, `packages/broker/src/board/store.ts` `overview`/`backlogCounts`,
`public/app.js`, the tests), ADR 0001 §7, BOB-7 AC 5, design/BOB-1/notes.md 15. Ran broker
`test/board.test.ts` (70 pass) and the UI suite (51 pass) at 284842d.

## Verdict

**Deploy-ready, rc.33-safe. Signed off (BOB-3 DoD 3, the protocol and store change).** No blocker,
no major. A broker deploy only: no migration, no client or supervisor change. Four minors, all can
follow.

- **No migration.** `no_release` is a count over existing columns, covered by the existing index
  `items_release (project, release)` (`schema.ts:91`). The two fixes are extra `WHERE` terms.
- **rc.33 and rc.32 are untouched.** Between rc.33 (d584f4c) and 284842d, `packages/client` and
  `packages/supervisor` don't change, and neither reads `overview`. The protocol change is one
  result interface, no zod schema. Either client gets the extra field as JSON and passes it through.

## The service

- **`OverviewRow.no_release`** (`store.ts:561`): `backlogCounts("project = ? AND release IS NULL")`,
  so kind backlog, not archived, in no release. It is the same set as Triage's "No release" filter
  (`app.js` `viewTriage`: `!d.release` over the backlog list), so the roadmap's line and the triage
  count agree. Additive on the wire: an old reader ignores it.
- **`open` leaves out Done** (`store.ts:543`): matches notes 15 ("has sessions and isn't Done") and
  the dashboard's `featureState`, which already put Done before open. Now the overview, the roadmap
  and the head card all use the same rule. The agent on a Done feature whose session is still open
  still shows under Working now, from its declared session. That's correct.
- **`next_ready` skips open** (`store.ts:548`, `open_since IS NULL`): correct. The test sets the open
  feature to Ready first, so it covers the case.

## The dashboard

- **Allow/Deny in Needs you: Casper's own writes, as ADR 0001 §7 and BOB-7 AC 5 require.** The
  buttons call the same `act()` → `action` frame `answer` as the Now tab (`app.js:73`, `:256`).
  The broker takes it only from the owner's socket (broker.test.ts, a laptop's allow/deny is refused
  `forbidden`), and the supervisor checks it against Casper's Access JWT (`owner.ts`). The BOB-7
  ruling holds: a permission is not a board record, and the board's write rules don't apply to it.
  Filtering to `tier === "human"` is right. An orchestrator-tier request is the orchestrator's to
  decide, and it stays answerable on Now as before. The Needs you count (permissions + service
  waits) matches ADR 0001 §7's Waits list, so the Waits tab (BOB-5) will count the same.
- **A broker without `no_release`:** `o.projects[0]?.no_release ?? null` leaves the counts line
  out, and a test covers it ("leaves the no-release counts line out…"). In practice the dashboard
  ships with the broker in one deploy. This case only comes up for a tab still open across a deploy
  or a rollback, and both fail soft.

## Findings

1. **Minor: `no_release` should be optional in the type.** `protocol/src/board.ts:498` declares
   `no_release: BacklogCounts`, but a broker before 284842d doesn't send it. `ReleaseRecord.backlog`
   was added the same way and is `backlog?:` (`:438`). The wire is fine. The type should still tell
   a TS reader what the dashboard already handles, so make it `no_release?: BacklogCounts`. Nobody
   reads it in TS today, so it can wait for the next protocol touch.
2. **Minor, before BOB-9: `#feature/<id>` finds its project by `prefix` only** (`viewFeature`,
   `id.startsWith(\`${x.prefix}-\`)`). A Draft id (`draft_prefix`, Helix's `DRAFT-n`) matches no
   project, so it falls into the Backlog.md path and sets `state.inc`. Two projects with the same
   draft prefix would also be ambiguous. This needs fixing before Helix moves. Either match
   `draft_prefix` too, or carry the project in the hash (`#feature/<project>/<id>`). The second is
   cleaner and belongs with BOB-4's Feature view.
3. **Minor (Daisy's call): a Casper-tier question in Needs you has only Deny.** Now says "Answer it
   through the orchestrator, or Deny" (`app.js:254`). The Overview line drops that hint, so Deny looks
   like the only answer. Add the same muted hint, or link to Now.
4. **Nit: one read per roadmap load is duplicated.** `loadRoadmap` now also calls `overview` for its
   project. On `board_changed` with the Overview open, the global `overview` runs as well, so a project's
   overview row is computed twice. It's cheap (6-13 ms reads), so leave it. If it matters later, take
   `no_release` from `ov.rows`, or add it to `list of: releases`.

Note, already there before this commit: `backlogCounts` counts `bugs` as `type = 'bug'` whatever the
status, and the line says "open bug". A backlog bug marked Done and not archived would still be
counted. The blocks-use wait already filters `status != 'Done'` (`store.ts:504`). The counts should
filter the same way the next time `backlogCounts` is touched.

## Release

Broker deploy only (`pnpm run deploy` in `packages/broker`, when Casper asks). No client or
supervisor release, no restart. rc.33 can go live independently of this deploy, in either order.
