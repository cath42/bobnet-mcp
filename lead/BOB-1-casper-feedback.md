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

## Round 2

> 3. yes answering from the dashboard would be a really strong feature, it makes it so much easier to answer
> questions - the new prototype is now missing one of the strongest features of the old one, the ability to
> see within a session the amount of tokens and context per call graph for the session and per agent -
> besides those, this looks very good

> Wait one more thing, often times we are waiting while CI is running or as someone is running a long running
> E2E test script, the CI is probably more clear but could we make it so that I can see if we are waiting on a
> CI run at least that would be good and how long its been running?

Mario's reading:
- Answering from the dashboard: yes. Mario had offered: an answer box on each question (pick the recommended
  option or write), his answer kept verbatim on the record, the question leaves the list, and the project's
  lead gets a message. He hasn't said yet whether permissions (allow/deny) belong there too.
- Bring back today's dashboard's context chart (packages/broker/public/app.js contextChart: "Context size
  per call", per session across all agents and per role/agent, with tokens) inside a session in the steps view.
- "besides those, this looks very good": round 1's Overview and agents-on-tasks are accepted.
- New: show when work waits on a CI run (and, if possible, a long E2E script), with how long it has run.
  Possible sources: the run slot (supervisor run_slots: holder, label, since) for land/test runs on the
  laptop; GitHub Actions runs (gh) for CI.

## Round 3: the verdict

Mario asked: 1. may Casper allow or deny agents' permission requests from the dashboard; 2. which CI
"waiting on CI" covers (GitHub Actions, or other CI too); 3. is the prototype (with rounds 1 and 2) accepted.

> 1 yes, 2. Any CI running anywhere, 3. Approved

Mario's reading:
- Permissions: allow/deny from the dashboard (Waits on you and the Overview's Needs you), like answers.
- CI: any CI running anywhere, not only GitHub Actions; local runs through the run slot as designed.
- BOB-1 is approved, with rounds 1 and 2. Next: Peach writes BOB-2..10's criteria; Toad's ADR for the
  service (BOB-2, BOB-7) before Luigi builds.

## Outcome (session closed 2026-11-14)

- BOB-1 approved and Done (Peach, v2 dc3d6f0); Casper's words in BOB-1's notes #6, rounds 1-3.
- Prototype turned around twice by Daisy: round 1 (Overview redone, agents on tasks, A-15 nit) 8ee76ea,
  5abbfcd; round 2 (context per call in sessions, answering/done/allow-deny, waiting on CI) d6b0cab, f3c27e9;
  closing pass (permissions agreed, any CI) a4c7828. Notes 1-48 in design/BOB-1/notes.md.
- Requirements: answering, actions done and permission allow/deny from the dashboard are Casper's own writes
  (waiting-on-casper.md); context-per-call chart per session and agent (steps-view 10); waiting on any CI and
  run-slot runs with duration (steps-view 11). BOB-2..10 criteria written, Draft until Toad has seen them.
- Next: Toad's ADR for the board service (BOB-2, BOB-7), worker w_a7c3d33e started at Casper's "lets go";
  then Peach marks BOB-2..5,7..10 Ready and Luigi builds. No release, no deploy this session.
