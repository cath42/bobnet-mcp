# Review: the import fixes (4b10900, 641c730, b31489a) and the folded-input fix (e221738)

Toad, 2026-11-14. Luigi's four lands on v2 (handoff w_8ca50011), checked against my rulings: the
Backlog.md import review (`2026-11-14-backlog-import-review.md`, findings 1 and 2), the BOB-5 service
review (`2026-11-14-bob5-service-review.md`, finding 1), Peach's import answer 3
(`product/requirements/migration.md`, "Import answers") and BOB-14 #6 and #7. I read each diff
against origin/v2. For e221738 I also read the SDK's own contract for `user_message_uuid(s)`
(`@anthropic-ai/claude-agent-sdk` 0.3.312, `sdk.d.ts`).

**Verdict: all four signed off.** Nothing must be fixed before rc.30. e221738 and b31489a can ride in
it. The notes below are small and for later, and each says when.

| Commit | What | Verdict |
|---|---|---|
| 4b10900 | `--post` exits 1 unless the broker took it (import review F1) | Signed off |
| 641c730 | `--grants`, lead/PO as `name@laptop`, `told` (import review F2, BOB-14 #7, BOB-5 review F1) | Signed off |
| b31489a | References appended to notes (Import answers 3, BOB-14 #6) | Signed off, rides in rc.30 |
| e221738 | Folded input marked taken from `user_message_uuids` | Signed off, rides in rc.30 |

## 4b10900: `--post` exit code

This is finding 1 as ruled. The command exits 0 only when the status is 2xx **and** `reply.ok`, and
otherwise prints `Not imported: the broker answered <status>, <code>: <message>` and exits 1. A body
that isn't JSON says "no reply it could read". That case also covers an Access login page served
with 200 when the token is wrong, because `res.json()` fails and `reply` is null. The test covers
403, 409, 502 with no body, and a 200 whose reply isn't ok. `ImportPosted` types the poster, and the
reply is cast rather than parsed. That's fine here, because only `ok`, `code` and `message` are read.

- *Note 1 (later, before BOB-9's post).* If the fetch itself throws (network, or the 60 s
  `AbortSignal.timeout`), the rejection reaches the top-level await in `bin.ts:26`, and Node exits 1
  with a stack trace. The exit code is right. On a timeout, though, the import may have committed,
  and the trace doesn't say so. Catch it in `importBacklogCommand` and print "no answer from the
  broker: it may have taken the import; post again, and a 409 'exists' means it did". The import is
  write-once per project key, so posting again is the safe check.
- Cosmetic: `board-backup.ts:119` has a blank line between `importPoster`'s doc comment and the
  function.

## 641c730: grants, lead and PO, `told`

**Grants (import review F2, BOB-14 #7).** This is as ruled. `ImportGrant` is the export's own grant
row plus `project` (the key or `'*'`), strict, and derived from `BoardExportV1`, so it can't drift
from the document and adds no protocol export. Project rows go to the project's `grants`, and `'*'`
rows to the document's top-level `grants`. A row for another project throws, and so do two rows for
one agent@laptop (case-folded) on the same scope, before the broker would. The report gains a
"Rules" section, and says "None: after the import only the owner can write it" when there are none,
which is the case that matters most. `EVERY_PROJECT_WARNING` goes to stderr whenever the document
carries a `'*'` row, on the dry run too. That is better than I asked, because the PO sees it before
the 403. The doc's example now has `--lead`, `--po` and `--grants`. It shows the grants file shape
and the empty-board rule with what to do when the board isn't empty. BOB-14 #7's evidence
(board.json on mbp-1 holds BobNet's items) still needs Peach's real file, which is hers to write.

**Lead and PO (BOB-5 review F1).** This is as ruled. `PeerAddress` refuses a bare name, an empty
part, `*`, a space and `@board` in any case. The tests include `Mario@BOARD` and `Mario@*`.
`create_project`, the broker's import (`export.ts`, as `invalid`) and `--lead`/`--po` all check
through it. Luigi's choice to check in the import code and not in the export's zod schema is right:
a board that already stores a bad lead still exports, so the nightly backup keeps working.

- Narrowing `create_project`'s `lead`/`po` changes a request schema, and that isn't additive in the
  strict sense. It's acceptable: only the owner's dashboard sends `create_project`, I asked for the
  narrowing, and an old caller that sends a bare name now gets `invalid` instead of a lead that
  tells no one.
- *Note 2 (later, with any change to `board.ts`).* `PeerAddress` writes the segment pattern out
  again instead of using `address.ts`'s `SEGMENT`/`isValidSegment`. Today the two are identical.
  If the address rules change (BOB-5 review, note A), one of them will be missed. Build
  `PeerAddress` from the one pattern.

**`told` (BOB-5 review F1, second half).** The change is additive (`BoardWritten & { told }` on
`answer_question`, `mark_done` and `undo`), and `notify` returns the same deduplicated list it
messages. The test covers a lead, and an empty list when there is none.

- *For Daisy, when she places the toast.* `told` lists the addresses the message was **sent** to,
  not the peers who were online. A registered-later peer gets it on register (`pendingFor`). So the
  toast should say "sent to Mario@mbp-1" or "nobody was told: the project has no lead", not "heard
  by".

## b31489a: references in notes

This is Peach's answer 3 as written. `notesOf` writes the notes, then `Final summary:` and its text,
then `References:` with one `- <path or URL>` line each, joined by blank lines. References are
trimmed, empty ones dropped and duplicates removed in order. An item with nothing in any of the
three gets `null` notes, as before. The count is now "references appended to notes", and the doc's
mapping rules say so, with assignee and priority dropped. The test covers all four shapes (notes,
summary and refs; refs only; notes only; none) and the duplicate. A list item per line is still "one
path or URL per line". I take the `- ` as making it the Markdown list the dashboard renders, not as a
change of format.

If appending pushes an item's notes past the export's text limit, `BoardExportV1.safeParse` fails.
That shows in the report as a problem and blocks `--post`, which is the right failure. BobNet's 25
won't come close.

## e221738: folded input marked taken

The fix reads what the CLI promises. Per the SDK's contract, `user_message_uuids` lists "every user
message whose prompt this turn has consumed so far… then any user message folded into the turn". It
is "present exactly when `user_message_uuid` is" on reply frames, and on the result it lists every
input the turn consumed, "once taken off the queue". The SDK says to fall back to
`user_message_uuid` for older producers, and `taken()` does exactly that. A typed-prompt turn stamps
its reply frames once per kind, so a fold after the first reply shows only on the result. That
matches what Luigi found in rc.28's log for w_e3a26fa2. Reading the result frame as well as
assistant frames is therefore the fix, and the `user_message_uuids` list is the typed field to use.
Luigi was right not to build on `command_lifecycle`.

The direction of failure is the safe one. An input is marked taken only once the CLI names it as
consumed. If the session dies after a fold but before its result, the message stays untaken and the
role's next worker gets it again, which is a duplicate, not a loss. The same holds for the 64-entry
cap: anything the list drops stays untaken. The loop removes each uuid as it marks it, so a uuid
listed again on a later frame is a no-op. The test folds input 1 into turn 0, ends with only the
result naming it, and checks that `waiting()` is empty and that the next worker's input doesn't
carry `m_folded`.

## Nothing changes in the ADRs

ADR 0001 §5 already says the rules are seeded at import from the PO's rows, §7 already sends answers
to the lead, and §11 already makes the import the only writer. These commits implement those
sections without changing them.
