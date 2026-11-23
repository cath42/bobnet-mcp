# BOB-189 build brief: a PO organizes releases (for Luigi)

**Design:** ADR 0003, addendum 2026-11-22 (`architecture/decisions/0003-owner-authority.md`). **Criteria:**
BOB-189 AC1-AC5 and DoD. Line numbers are at `4427ae1`.

**What ships how:**

| | |
|---|---|
| Protocol | two new ops, `update_release` and `reopen_release`; additive |
| Broker migration | none: `events.op` has no CHECK, and `releases` has every column already |
| Broker deploy | yes (R1-R4), before the rc's restart |
| Client / supervisor rc | **yes** (R5), then poe's upgrade and a restart of Picard's supervisor |
| Dashboard | R6, in the same broker deploy |

## Why an rc, whatever the shape

`board_write`'s op list is `WRITES` in the client (`client/src/board-tools.ts:33`), and the tool parses
every call against the client's own copy of the protocol before it is sent (`checked`, `:40`). Picard is a
supervisor worker, served these tools by the installed supervisor. Reusing ops doesn't avoid it:
`create` with kind `release` fails the installed `ItemKind`, `update` on `R3` fails `ItemRef`, `order`
with scope `releases` fails its enum. `create_release`, `order_releases` and `close_release` are already
in the protocol (`protocol/src/board.ts:216, 261, 267`) but not in `WRITES`. Since an rc is needed
anyway, release writes get release ops (three exist; two are new), not overloaded item ops.

**Without an rc, today:** AC4's moves (`promote`, `set_release`, `order`) are in `WRITES` from rc.49
(b1ba363). If the installed rc is rc.49 or later, Picard can organize features into R0-R2 now. Only
creating, editing, closing and reopening releases wait on the rc.

## Already true on v2: checked, not to build

- **Create:** `create_release` (`store.ts:1221`) takes title, goal and spec_url. Its ref is the next
  number (`R${next_release}`). Helix's import set `next_release` to max+1 (`export.ts` import, `next.release`),
  so R3, ..., R10 come in order and "Later" is R11. It is born `planned`, last in the order.
- **"idea" is `planned`.** The board's release statuses are `planned`, `open` and `closed`
  (`protocol/src/board.ts:19`). Helix's `idea` maps to `planned`, `building` to `open`, `released` to
  `closed`. A release opens by itself on its first session (ADR 0001 §6, `store.ts:1761`); no write
  opens one by hand. AC1's "idea or open" is met by `planned`. A release is created `open` only if Peach
  asks for it, and then the first-open-release rule (`store.ts:905`) needs a look first.
- **Close:** `close_release` (`store.ts:1630`) takes a destination for every feature not Done and
  records `closed_at` and `closed_by`. Only who may call it changes (R2).
- **AC4's ops:** `promote` (`triage`, `:1523`), `set_release` (`release`, `:1590`), `order` with scope
  `features` and a release (`order`, `:1561`). Under a `not_open_feature` rule they cover every feature
  that isn't open. `promote` drops a backlog item's release: putting it in one is a `set_release` after.
  That stays.

## Tasks

### R1. Protocol: `update_release` and `reopen_release`

- `update_release {project, ref: ReleaseRef, set: {title?, goal?, spec_url?} (strict, at least one), reason?}`.
- `reopen_release {project, ref: ReleaseRef, reason?}`.
- Both reply `BoardWritten` (`BoardResults`, `protocol/src/board.ts:896`).
- **Done when tests show:** both parse. An empty `set`, an unknown key in `set` (`status`, `ord`) and an
  item ref are refused.

### R2. Broker: the `release` grant writes release records

- `createRelease` requires `release`, not `create` (`store.ts:1223`). Scope null ("releases").
- `orderReleases` (`:1607`) and `closeRelease` (`:1631`): `ownerOnly` becomes
  `rules.require(caller, p, "release", null, "releases")`.
- `closeRelease` also requires `release` on each moved feature's scope (`this.scope(row)`), as
  `set_release` does. A `not_open_feature` PO can't move an open feature out by closing its release.
- `undo` stays the owner's, of his own events (unchanged).
- `SAYS.release` (`rules.ts:36`) says it all: "organize releases (the 'release' field)".
- **Done when tests show:** a rule with `release` (`items: not_open_feature`) creates R3 (the next ref,
  planned, last) and places it with `order_releases` (AC1). It reorders all releases (AC2). It closes a
  release with moves, and `closed_at`/`closed_by` name the agent (AC3). Rules with only `create`, only
  `triage` or only `order` are refused each of these writes, and the refusal names who holds `release`.
  A close that moves an open feature is refused for that rule and allowed for the owner. A PO's `undo` is
  refused. The owner still does all of it.

### R3. Broker: `updateRelease` and `reopenRelease`

- `updateRelease`: needs `release`. Writes what `set` names, one `update_release` event on `releases`
  with old and new for each field changed. A no-op set returns `seq: 0`. A closed release may be edited.
- `reopenRelease`: needs `release`. Refused (`conflict`) unless the release is `closed`. Status goes back
  to the one before its last close, read from that close's `status` change (as `undo` reads it). An
  imported closed release with no close event reopens as `planned`. `closed_at` and `closed_by` become
  null. The event records their old values, so the history keeps who closed it and when. Features the
  close moved out stay where they went: a reopen is not an undo.
- **Done when tests show:** title, goal and spec_url change, each in the history with old and new (AC2).
  open → closed → reopen gives `open`, and planned → closed → reopen gives `planned`. After a reopen,
  `get` shows null `closed_at`, its history shows the close and the reopen by the PO (AC3), and
  `set_release` into it works again. Reopening an open release is a conflict. Both are refused without
  `release`.

### R4. Broker: AC4 end to end under Picard's rule

- One test with Picard's helix rule exactly as `board_grants` shows it (Peach or Mario reads it; AC4 says
  its fields include `release`, `triage` and `order`). It sets that rule up with the test's `grant` and
  runs it as an agent caller.
- The sequence is the job Picard is waiting to do. Create R3, then Later. Promote a backlog item and
  `set_release` it into R3. Move it to Later, then out of every release (`release: null`). Order R3's
  features. Close R0 with moves for its features that aren't Done. Then reopen R0 and close it again.
- Anything refused here is fixed in R2/R3, not worked around in the test.
- **Done when tests show:** the whole sequence passes under that rule, and `list releases` / `list
  features` show the end state (AC4, and AC1-AC3 again under the real rule).

### R5. Client: the ops in `board_write` (the rc)

- `WRITES` (`board-tools.ts:33`) adds `create_release`, `update_release`, `order_releases`,
  `close_release` and `reopen_release`.
- The description gains one clause: `create_release {title, goal?, spec_url?}`, last in the order;
  `update_release {ref, set: {title?, goal?, spec_url?}}`; `order_releases {refs}`, every release once;
  `close_release {ref, moves: [{feature, to (null: none)}]}`, a destination for every feature not Done;
  `reopen_release {ref, reason?}`. Keep it short: the description costs context on every call.
- **Done when tests show:** `board.test.ts` runs `board_write` for each of the five through `checked`, and
  the fake `op` receives the op with the project filled in. A malformed one (`close_release` without
  `ref`) fails before sending.

### R6. Dashboard: planned and closed releases on the roadmap (AC5)

- `releaseSection` (`public/app.js:1030`): a planned release gets a badge, as open and closed do (today
  `relState` is null for it, `:1044`). Its word is Daisy's; Helix says "idea". The release's `goal`
  shows under its title when set: Picard's R3-R10 carry the README's outcome as goal.
- A closed release stays folded with its closed date (`:1034`, `:1080`). Check it with one whose features
  were all moved out ("Closed, with no features").
- In the edit view, a closed release gets **Reopen** (`reopen_release`) where Close was.
- The gates banner (`:1019`) and the footnote (`:1025`) still call the order of releases and the close
  "yours". They become: "yours, and the PO's" (for order, only if Casper's answer to the open question
  says so).
- **Done when:** screenshots at 390 and 1440 of a roadmap with planned, open and closed releases (one
  closed and empty), in read and edit views (AC5).

## Order and live

R1 → R2, R3 (one PR) → R4 → R5 and R6. Land, deploy the broker (poe's window), then cut the rc. After
poe's upgrade and the restart, Picard runs: create R3-R10 and Later, then close R0.

## Open

- **For Casper, through Mario (non-blocking):** may a PO holding `release` reorder releases, or does the
  order stay his alone? Recommended: **yes, the PO may**, and Casper keeps it on the dashboard. A new
  release has to go somewhere, and if only Casper can place it, every new release waits on him. Each
  reorder is an event in the history under the PO's name. Build R2 as recommended. If he says no,
  `orderReleases` goes back to `ownerOnly`: one line and one test. Picard's job doesn't depend on the
  answer: R3-R10 and Later are created in README order and land in that order.
- **For Peach:** AC1 says "idea or open". The brief does `planned` only (above). Say so on the AC, or ask
  for `open` at creation.
