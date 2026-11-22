# BOB-51 review A (Toad): build A, brief tasks 1-6

**Reviewed:** origin/v2 `b7e906f^..cb0a086` (6 commits: protocol, whole ask, via/decided/note, notes.test.ts,
`fitReport`, broker relay). I checked it against ADR 0013, `architecture/bob51/build-brief.md` and Luigi's
handoff (`w_c0d83294`). Task 7, the dashboard, is build B and is not reviewed here.

## Verdict

**Signed off for the broker deploy and for an rc.** There are no blockers and no majors. I found two minors:
- Minor 1 is captured as BOB-162 and can go into build B.
- Minor 2 is a ruling only.

The deploy and the rc can go live in either order (ADR 0013, Compatibility, checked below). The ACs are
checked live only after the broker deploy, the rc, the restarts of mbp-1 and ubu1, and build B.

## Against the brief

| Task | What I checked | Result |
|---|---|---|
| 1 Protocol | `PendingAsk` and its maxima, `pending[].ask` nullable and optional, `preview` still `max(400)`. `decided` `max(50)` and optional. `note_delivered` optional on `ActionResultFrame` and the owner's `action_result`. The `answer` op comment. | as briefed |
| 1 Tests | A snapshot with and without `ask`/`decided`, over-maximum refused, an older schema strips and still parses. `action_result` with and without the field. | as briefed |
| 2 Whole ask | `askOf`, and `clip` shared with `fitRunName`. Questions, headers, options and `multi`, with no option `preview`. Text picked as `preview()` picks it. Withheld whole on `detect`. Budget of 128 KiB, human tier first. | as briefed, apart from minor 1 |
| 2 Tests | 4 questions whole. 9000 → 8000 with `cut`, and no lone surrogate on either side of the limit. Credential in an option's description gives `null` with the preview kept. The budget nulls the newest orchestrator rows first. | as briefed |
| 3 Via, decided | Migration block (column, plus the index `(via, decided_at)`, so `decidedVia` uses it). `settleRequest` writes `via`. `Router.answer` / `Supervisor.answer` pass `via`, and only `onAction` sets `"dashboard"`. The default "denied from the dashboard" is gone. `toResult` reads "Denied by Casper" or "Denied by the orchestrator". `decided` covers 24 h, newest first, at most 50, with the note withheld as `preview` is. | as briefed |
| 3 Tests | Dashboard allow and deny with a note. Orchestrator, relayed `user_decided` and timeout are left out. 25 h ago is gone. Both deny texts. Old db migrates. | as briefed |
| 4 Note | `noteLine` builds the §3 line. A live request is injected after `router.answer` resolves the waiter. An orphan gets the line in `resumeTask`. `note:undelivered` is audited for no session, a closed input, or a failed resume. `note_delivered` is on `action_result`, on the `answer` op reply (and `false` on the `resume_error` branch), and on `answer_request` local and remote. A remote reply without the field gives "not delivered" and the reason. | as briefed |
| 4 Tests | Allow and answer with a note give the next user input. No note means no line and no field. The orphan's resume carries the line. A closed input gives `false` and an audit row. | as briefed (in `supervisor.test.ts`, divergence 3) |
| 5 Both ends real | `notes.test.ts`, covering the remote half, the old-target variant and the local half. | see AC3 below |
| 6 Broker | `actionResult` forwards `note_delivered` only when present. A report's `ask`/`decided` come back whole in `dashboard` and `report`. The worst case with ordinary lengths is accepted. | as briefed |

**Luigi's divergences.** I accept all seven.
- **1, `fitReport`:** this was my ruling. It is now in ADR 0013, Consequences, recorded in this commit.
- **4, greedy fill:** it is a better use of the budget, and the order rule still holds.
- **5, `<who>` = `remote_by@laptop`:** recorded in ADR 0013 too. The worker knows its orchestrator by that name.
- **6:** the decided note is clipped and withheld as `preview` is.
- **2, 3 and 7:** these are about where the tests live and the tool's wording.

## Compatibility (ADR 0013 table)

- **Old supervisor, new broker.** The report has no `ask` or `decided`, and both are optional, so it parses
  and is stored as before. `action_result` comes without `note_delivered`, and `actionResult` leaves it
  out. The broker test "relays note_delivered … leaves it out when an older one doesn't" covers this.
  The live dashboard (old `app.js`, until build B) sends a note only with Deny (`app.js:1575`), so no note
  with Allow is sent that it would then misreport.
- **New supervisor, old broker.** `LaptopSnapshot` and `ActionResultFrame` are plain `z.object`, not
  strict. So an old broker strips `ask`, `decided` and `note_delivered`, takes the frame, and stores the
  parsed snapshot (`broker.ts:591`, `JSON.stringify(snapshot)`). The protocol test "an older broker's
  schema drops them and still takes the snapshot" pins this. The frame limit is unchanged, and `fitReport`
  keeps the report inside it.
- **Supervisor to supervisor (`answer` op).** The request side is unchanged, because `message` was already
  carried. The reply is a `looseObject`, so an old requester ignores `note_delivered`. A new requester
  facing an old target says "not delivered" (the updated `requests.test.ts` case, and the old-target
  variant in `notes.test.ts`).
- **New dashboard (build B) against an old supervisor.** The dashboard keys off whether `decided` is
  present (§2). This build sends `[]` when there is nothing, so it is always present from a new supervisor.

## Credentials

- **The ask.** `askOf` checks every field with the supervisor's `detect`, in serialised form, as
  `withholdWhole` does, and sends `null` whole on any match. `preview` keeps its own check. The private-key
  pattern matches on the BEGIN line, which survives every clip unless the clip lands inside the header.
  See minor 1 for the clip boundary.
- **Decided.** `preview` goes through `preview()`, and `note` is `HIDDEN` when `findSecret` matches.
- **The note line.** It goes to the worker's own conversation on its own laptop and never crosses the
  broker. Through the `answer` op, the message crosses as it already did before 0013.

## AC3: "both ends real"

**Holds for the automated half.** `notes.test.ts` boots two real `Supervisor`s, mbp-1 and ubu1, on one
`FakeNetwork`. Each has its real `Router`, `WorkerRun` and SQLite store; only the SDK is a FakeQuery. The
ubu1 worker is a genuine v: 2 spawn from mbp-1's `spawn_worker`.
- **Remote half:** mbp-1's `answer_request` gives ubu1's `canUseTool` an allow, and ubu1's FakeQuery input
  then has exactly the §3 line ("Note from Bob@mbp-1 …"). Also checked: `note_delivered: true`,
  `remote:answer` in ubu1's audit, and `via: null`.
- **Local half:** a real `action` frame goes through ubu1's link to `onAction`. Its `action_result` has
  `note_delivered: true`, the line names Casper, and `decided` lists the row.
- **Gaps:** the broker hop is the FakeNetwork, and the old target is a stub of `Supervisor.answer`, not an
  older handler. Both are as the brief set it, and the broker's relay of `note_delivered` is tested on its
  own. What no fake can show is *when* the real SDK hands a `next`-priority input to the model: right
  after the allowed call's tool result, or only at the end of the turn. That is the live half of AC3 in the
  brief's Evidence. If the worker's log shows the line only at the end of the turn, raise it as a bug
  against BOB-51.

## Findings

### Blockers
None.

### Majors
None.

### Minors
1. **`askOf` checks the clipped fields, not their source** (`supervisor.ts`, `askOf`'s `fields` check).
   `preview()` checks the whole text before it clips. `askOf` checks only what survived the clip. So a
   credential that straddles a field's limit can go as a prefix: e.g. `ghp_` followed by fewer than 36
   characters at the 8000 cut, or `password=` with part of the value. The prefix is undetected and
   unusable, but §1 says no credential crosses. **Fix:** in `fit`, also run `detect` on the source string,
   and withhold the whole ask when either check matches. Captured as **BOB-162**; fold it into build B.
2. **An orphan's dashboard allow whose resume throws** (Luigi's open question). The request is settled,
   the note is audited `note:undelivered`, and `onAction` replies `ok: false` with the error and no
   `note_delivered`. **Ruling:** that is right. For build B, a toast for `ok: false` shows the error and
   says nothing about a note. The rule "absent means not delivered" applies only to `ok: true`.

## Live (DoD 4)

- **Broker deploy:** tasks 1 and 6 now, and task 7 with build B. Reviewed, so the standing go applies; poe gives the window.
- **rc, then restart mbp-1 and ubu1:** tasks 2-5. ubu1 must be on the rc for the remote half of AC3.
