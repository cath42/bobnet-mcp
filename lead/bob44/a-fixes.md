# BOB-44 build A-fixes: Mario's read of the land (2026-11-20)

Landed on v2 7d9e1d4..bf2203f by Luigi (w_e549e48b): BOB-72 b2c8a96, BOB-73 c985339, chore 09adf97 (the
import's `--post` tests get 30 s), BOB-74 bf2203f. Evidence per criterion: Luigi's handoff
`~/.local/state/bobnet/handoffs/bobnet/w_e549e48b.md`. Released as rc.41.

**Result: no blocker, no major.** The independent review of this build follows the session close (poe).

## Read

- **BOB-72.** `withholdBody` (supervisor.ts) redacts per field, then checks the serialised body with the same
  detector; the handoff is withheld whole (`handoff_text: null, handoff_withheld: true`, its truncation fields
  dropped), any other string whose own serialised form matches is withheld whole. `withHandoff` checks again
  after a cut. Replies (`onRemote`), events and exits all go through it. Requester: a withheld event for an
  open copy asks `status` now; a withheld `summary` for an ended copy without a handoff ends it with
  `WITHHELD_HANDOFF`, and the notice says "handoff withheld: ask <name> on <laptop>". The target's stand-in
  keeps `v: 2`, so it passes the new schema gate. `password_assignment` drops the backslash.
- **BOB-73.** `SPANS.private_key` redacts BEGIN through END, or to the end of the text (lazy, `$` without `m`).
  Detection unchanged.
- **BOB-74.** Schemas on read before any handling (v-less non-answers still dropped first); `.catch` on
  `onRemote`; rebuild in `BEGIN IMMEDIATE`..`COMMIT` with `ROLLBACK`; `strandedState` before the pid file;
  no double `g`; `fitLands` by a 4000-character budget with an "N earlier lands not listed" line; the wait's
  timer aborted; `Promise.all` for `laptop: "*"`; positive signals in copies.test.ts.

## Notes (no task)

- **Known limit, agreed with Luigi (m_78768eca).** The target checks with the narrowed `findSecret`, so until
  the broker carries it (B6, BOB-71) the multi-line case is refused by the broker, not withheld by the target.
  It ends through BOB-72 AC2 (stand-in, `status`, `summary` stand-in, copy ended, one notice); the exit's state
  arrives by `status`. review-a.md's "the target's body check guards until then" no longer holds. No
  old-pattern check on the target: that would widen what is withheld.
  **Corrected (BOB-78 AC4, review-a-fixes.md F1):** "the exit's state arrives by `status`" holds only when the
  match is in the handoff. When the text is in the worker's `error` or `checkpoint`, `remoteView` carries it, so
  the window also covers `status` and `list`: both come back withheld, and before BOB-78 the copy stayed
  `running` with nobody told and each reconcile stopped at that `list`. BOB-78 tells the orchestrator once
  ("<name> on <laptop>: state withheld, ask there") and lets a reconcile go on past a withheld batch. The
  window closed with the broker deploy of the narrowed `findSecret` (2a36f1e6, 2026-11-21 02:35Z).
- `withholdBody`'s whole-field fallback can't split a match that spans two fields; with the supervisor's own
  field names none can form (`"` sits between a value and the next `:`), and the broker's stand-in covers it.
- The land's final attempt reported exit 1 after both ranges had landed (nothing left to push); v2 is at bf2203f.
