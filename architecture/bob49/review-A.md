# BOB-49 review A (Toad): build A as landed

**Reviewed:** origin/v2 `bb3a095..f983ff4` (BOB-146..150). I checked it against ADR 0011 and
`architecture/bob49/build-brief.md` part A, and read Luigi's handoff (`w_363dbc75`, Decisions).
Line numbers are at f983ff4. My rulings are recorded in ADR 0011 §6.

## Verdict

**Not signed off for deploy yet.** It is close: two small fixes come first, **B1** and **M1**. Then
it is signed off without another review from me. The tests named under each fix are the check.

- M1 has to land before the deploy. Migration 7 hasn't shipped, so it can still be edited
  (`schema.ts:1-2`). Once it ships, the same change is a table rebuild.
- The migration itself is safe for production data (see "Migration" below).
- The rest is sound. The fix marking, the release, the stale rule and its due arithmetic, the
  owners, keep and withdraw, and the drain all match the ADR. AC1 and AC2 are covered as the brief
  asked.

## Blockers

**B1. `flagStale` fails for every project once one has 100 rows on Waits.**
`store.ts:2390` runs `DELETE … WHERE project = ? AND ref NOT IN (?, ?, …)` and binds 1 + N values.
A SQLite-backed Durable Object binds at most 100 values per statement. With 99 or more waits in one
project, the statement throws. The whole `transactionSync` (`board.ts:71`) rolls back, so no
project's rows are flagged, and the alarm audits `wait:flag_failed` every hour. It fails safe,
because nothing wrong is written, but the stale rule quietly stops for everyone. Every open question
is a wait, blocking or not, so Helix can get there.
- **Fix:** `ref NOT IN (SELECT value FROM json_each(?))`, bound to `JSON.stringify(refs)`.
- **Test:** a project with 120 open questions; `flagStale()` doesn't throw, and it deletes a flag
  whose question was answered.

## Majors

**M1. `bug_fixes.item` breaks the schema's rule on links within a project** (`schema.ts:454`). The
rule is at `schema.ts:4-6`: a link between records of one project is a composite key on
`(project, pk)`, so the store itself refuses a link that crosses projects. Today `push` can only
link a bug of the push's own project, but the table should hold that by itself.
- **Fix, in migration 7 before it ships:** `FOREIGN KEY (project, item) REFERENCES items (project, pk)`.
- `push` stays a plain `REFERENCES pushes (pk)`. `pushes` has no `UNIQUE (project, pk)`, and adding
  one isn't worth a rebuild.
- **Test:** the migration test still passes. An insert of a fix whose item is another project's is
  refused.

**M2. A round trip through export and import loses every fix and every release tag** (Luigi's open
question). `export.ts:264` exports pushes and CI runs, but not `bug_fixes` or `release_tags`. After
an import, a fixed bug is `blocking` again and has no release. **Ruling (ADR 0011 §6.6):** both
tables are board data, so they go in the document.
- Each is an optional array on the exported project, read as `[]` from an older document. The
  format stays additive.
- Refs replace pks: `fixes: [{ item: ref, sha, subject, push: "repo@sha", release, at }]` and
  `release_tags: [{ repo, tag, sha, push: "repo@sha" | null, at }]`.
- `wait_flags` and `notices` stay out.
- This isn't a deploy blocker, because a restore is the only thing that loses data. **Do it in build
  B**, with a round-trip test that has a fix with a release.

## Minors (build B)

- **m1. A release doesn't restart the bug's day** (Luigi's decision 3). The PO gets "BOB-27's fix is
  in rc.34", and if the fix landed about a day earlier, a stale flag follows within the hour.
  - **Ruling (ADR 0011 §6.3):** keep the event on the push record. Also write an `items` event for
    each open bug the tag released: op `release_tag`, change `["release", null, tag]`.
  - The place is `store.ts:2591-2612`.
- **m2. The stale text for a bug with a fix says "waited on Casper"** (`store.ts:2384`), but that bug
  waits on its PO. Use ADR 0011 §6.9's text when `w.fix` is set.
- **m3. Nothing tells dashboards that a flag happened.** `flagStale` returns no `changed`
  (`board.ts:71`, `broker.ts:888-895`), and `stale` is worked out when Waits is read. So an open
  dashboard shows a row going stale or being flagged only on its next re-read.
  - The dashboard half of B should re-read Waits on a timer (an hour is enough).
  - Or the broker could broadcast `changed` for each project that has a row in `flagged`.
  - Daisy's spec decides which one is visible.

## Must-haves for build B's supervisor (not defects in A)

- **The supervisor must make `fixes` fit the schema before it sends the push**
  (`protocol/src/board.ts:439`). That means 40-hex shas (`%H`), the subject clipped to 200
  characters, and at most 20 entries.
  - Otherwise the broker refuses the whole push as `bad_frame`. That is final (BOB-27), so the
    push's CI tie is lost as well.
  - **Test:** a subject of 300 characters and 25 trailers.
- **`release_tag`'s `repo` must be written the way `push`'s is**, because the broker matches them with
  `lower(repo) = lower(?)` (`store.ts:2576-2589`). Both should come from the same `repoName(origin)`.
  - **Test:** a land, then an upgrade's tag on that tip, ends with a fix marked as released.

## Luigi's decisions (handoff, Decisions)

| # | Decision | Ruling |
|---|---|---|
| 1 | `Tx.at` reads the injected clock | **Accepted.** The ADR said `Tx.at` doesn't change; §2 is amended and §6.1 added. In production both clocks are `Date.now`. |
| 2 | A stale flag's event is on the project's record | **Accepted** (§6.2). Event seqs are the notices' keys, so the event can't be skipped, and it can't go on the row's own record. The export already takes actor kind `board` (`board-export.ts:193`). Project history shows the flags, which is right. |
| 3 | `release_tag`'s event is on the push record; bugs get no event | **The push event is accepted. The "no item event" part is changed** (§6.3, m1). |
| 4 | One `fix_released` notice per tag, lines per open bug | **Accepted** (§6.4). |
| 5 | A fix notice with no PO and no lead still goes, `to` empty | **Accepted** (§6.5). I checked that `noticeSupervisor` (`broker.ts:518-534`) picks the single serving supervisor without `lead` or `asked_by`. |
| 6 | `push` result `fixed`/`fixes_ignored`; `release_tag` result `released` | **Accepted** (§6.4). These are additive results. |
| 7 | The fix notice clips the subject at 80 characters with "…" | **Accepted.** |
| 8 | `keep` refuses a question that isn't open; `keep` on an item needs `status` | **Accepted.** This is the ADR's §2. Prefixes Q and A are refused at project creation (`store.ts:1193`), so the `[QA]-n` dispatch in `keep` is unambiguous. |
| open | `bug_fixes` and `release_tags` aren't exported | **They are to be exported** (M2, §6.6). |

## Migration (production safety)

Migration 7 runs in the Board DO's constructor inside one `transactionSync` (`board.ts:23`). If any
statement fails, nothing is applied and the board doesn't start, so I checked each statement against
live data:

- **New tables** (`release_tags`, `bug_fixes`, `wait_flags`): they are empty, and their keys point
  at tables that exist.
- **The `notices` remake:**
  - The old rows' `state` values (`answered`, `done`, `withdrawn`) all pass the new CHECK.
  - `question` maps to `subject`, which is NOT NULL, and every row has one.
  - `kind` is the literal `'answer'`.
  - Nothing references `notices`, so `DROP TABLE` has no foreign key to trip.
  - The index `notices_untaken` goes with the old table and is made again after the rename, so the
    name doesn't clash.
  - This is the same pattern as migration 5, which is live.
- **The migration test** (`board-waits.test.ts:49`) builds a board at 6 with an untaken and a taken
  notice and a push. Its rows survive, and the untaken notice still drains under the new names.
- **Numbering:** BOB-6's build hasn't landed, so this is 7. **BOB-6 must take 8** (ADR 0011 §4) and
  only widen the CHECKs: `kind` gains `start`, plus its states. Mario should tell Luigi when BOB-6's
  build starts.

**Compatibility with the live rc:**

- The current supervisor reads a `board_notice` as a `RemoteEvent`. That has no `worker`, so it
  fails to parse, and the supervisor logs a warning and drops it (`supervisor.ts:1356-1363`). It does
  this once per notice, and nothing else happens.
- An old supervisor sends no `fixes` and no `release_tag`.
- `keep` and `withdraw` reach workers through the existing `board_write` path as soon as the broker
  is deployed. Their descriptions come with B.

**Expect a burst at the first alarm after the deploy.** Every row on Waits that is already over a
day old is flagged in the same hour: one message to each row's owner, plus one `board_notice` per
row to the supervisors, which they drop until B. That is the rule working, not a fault. poe should
tell the POs and leads before the deploy that it is coming.
