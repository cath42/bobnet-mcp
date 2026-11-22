# Casper's dashboard feedback (2026-11-22, his Q-12 verdict on the BOB-51 prototype)

Verbatim:

> I don't like the prototype, let's try something more use case driven - i like the overview, i like being able to see
> who is running, the CI status' (running, failed, passed, last run etc.) per project - i love the 'needs you' we just
> cannot allow any of it to become stale, the separation of blocked vs when you have time questions is great, but maybe
> we could improve on the UI. I like the projects as a glance view but not sure its working as intended, for example
> right now it shows Helix as release R1 which is incorrect its on R2 right now and it says 4 of 4 features done which
> also isn't correct at all, the idea is good though - i'd want to click on a project and go to a project page with
> details about the project - i'll stop here, i got a lot more comments on the other but start there

## As Mario reads it
- Keep: the Overview; who is running; CI status per project (running, failed, passed, last run); Needs you; the split
  between "blocked" and "when you have time" questions.
- Must hold: nothing on Needs you may go stale.
- Improve: the UI of Needs you; design use-case first, not piece by piece.
- Projects at a glance: the idea stays, but the data is wrong (Helix shows R1 and 4 of 4 done; it is on R2) -> bug BOB-163.
  Wanted: click a project to open a project page with its details.
- More comments are coming on the other views.

## What it means for BOB-51
The prototype is not built. Build A (protocol, supervisor, broker) stands and ships in rc.53: it carries the data.
The dashboard half (task 7) waits for a use-case-driven redesign that starts from the Overview.
