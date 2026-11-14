# 4. What waits on Casper

**Who needs it:** Casper. Everything that only Casper can unblock, across every project, in one list.

## Criteria

1. One list across projects of what waits on Casper: open questions (Helix's `Q-n` in
   `lead/questions.md`), actions only Casper can do (Helix's `A-n` in the same file, e.g. A-17,
   which holds up LAND-49.14), sessions closed with `need: casper`, review-gated items, and pending
   permission requests. Actions are their own kind of record, like questions (C8), linked to what
   they hold up. Each item has its project, feature, age and a link. *Evidence: test;
   screenshot on phone.* (Picard input, need 3)
2. An item leaves the list when its source says it is answered. The list keeps no state of its own.
   *Evidence: test.*
3. Its count shows on the overview, so Casper sees there is something without opening it.
   *Evidence: screenshot.*
4. Casper answers a question from the dashboard. The question offers the recommended option where
   there is one, or free text; his answer is kept verbatim on the question's record, the question
   leaves the list, and the project's lead (or PO) gets a message with the answer. It is Casper's
   own write, like his gates ([board-writes.md](board-writes.md)); anyone else is refused.
   Casper (BOB-1 #6 round 2): "answering from the dashboard would be a really strong feature".
   *Evidence: test (answer stored verbatim, refused for another role, lead messaged); screenshot on
   phone.*
5. Casper allows or denies a pending permission request from the same list (Casper, BOB-1 #6
   round 3: "yes"), with the action the dashboard has today for it, and the request leaves the
   list. Risky ones keep today's confirmation. *Evidence: test; screenshot on phone.*

## Must not break

- A question is answered once, by Casper, and the answer is never edited by anyone else. Answering
  in the project's conversation still works: the record shows it answered either way.

## Open questions

- *Settled (Casper, BOB-1 #6 rounds 2 and 3):* he answers questions (criterion 4) and allows or
  denies permission requests (criterion 5) from the dashboard. The list no longer only "shows and
  links".
- **Toad:** how an answer reaches the project's lead (a BobNet message from the service, written
  with the answer), and how the answer is written until Helix's board is in the service (BOB-9),
  while its `Q-n` are still in `lead/questions.md`. Peach's view: the dashboard answers only
  questions that are records in the service; Helix's stay answered in conversation until the move.
- *Settled (Casper, 2026-11-13, C8):* questions only Casper can answer are board records (open or
  answered, with the answer verbatim), linked to the item they hold up. Helix's `lead/questions.md`
  moves over with its board ([migration.md](migration.md)). Criteria 1 and 2 read them from there.
- `need: casper` comes from the structured session close (README T3), never from handoff files.
