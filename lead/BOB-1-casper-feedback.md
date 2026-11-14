# BOB-1: Casper's feedback on the prototype, verbatim

Session 2026-11-14 (Mario w_8f39e4b7, Casper in Remote Control). Each round as he typed it; Mario's
reading under it. Peach records the words in BOB-1's notes (#6); Daisy turns the prototype around.

## Round 1

> 1. I like the concept, but the overview looks bad, its not a very good UX - also what is missing here is
> something that overlays agents work against tasks/stories within a feature, I want to know who is working
> on what right now which would all be within a feature session right? Finally, you have questions in here,
> can I answer questions from the UI and if so, how?

Mario's reading:
- The concept is accepted; the Overview is not (UX to be redone).
- New: overlay agents on a feature's tasks: who works on which task right now. Workers declare their session
  and tasks at spawn (spawn_worker `session`, `tasks`), so the data exists; leads and consults have no
  session ("Other work").
- Question: answering from the UI. Today's requirement says no (waiting-on-casper.md, Must not break:
  "This list shows and links. It doesn't answer for Casper.").
