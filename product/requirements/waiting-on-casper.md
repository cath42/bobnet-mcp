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

## Must not break

- Answering stays where it is today (in the project's conversation or files). This list shows and
  links. It doesn't answer for Casper.

## Open questions

- *Settled (Casper, 2026-11-13, C8):* questions only Casper can answer are board records (open or
  answered, with the answer verbatim), linked to the item they hold up. Helix's `lead/questions.md`
  moves over with its board ([migration.md](migration.md)). Criteria 1 and 2 read them from there.
- `need: casper` comes from the structured session close (README T3), never from handoff files.
