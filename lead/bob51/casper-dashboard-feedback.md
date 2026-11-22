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

## Second message (verbatim)

> The status was a great idea, i have to admit i haven't used it much yet, but lets keep it, it should work, the roadmap
> is weird its a good overview but often even for features marked done it shows 58 of 62 criterias i have no idea what
> that means and why that would be important, it seems to indicate the feature is not done but with no explanation.
> Feature in current version always show 'this project has no backlog configured' could we please include that also in
> the prototype? Triage is fine, usage is a very important feature but I'm kind of thinking we should do a graph per
> project rather than a filter and then show all of them on there instead so i can always keep an eye on any spikes -
> also the graphs should allow me to toggle factoring the model/effort (sonnet low vs opus high has a very different
> token spend) or is that already factored in? the sessions i never look at, this view isn't much useful, challenge me
> if you think otherwise

## As Mario reads it
- Status: keep; it must work.
- Roadmap: a good overview, but "58 of 62 criteria" on a Done feature reads as "not done" with no explanation. Either
  say what's missing or don't show a count for a Done feature.
- Features: always says "This project has no backlog configured" (app.js:353, the Backlog.md-era empty state). The
  prototype must cover the Features view.
- Triage: fine as is.
- Usage: very important. One graph per project, all shown at once (no filter), to spot spikes. A toggle to weigh tokens
  by model/effort. Today it is raw tokens; model and effort are only a label (app.js:145), not factored in.
- Sessions: Casper never looks at it. Mario's take: drop it as a tab; what's useful in it (who ran, tokens per session,
  review evidence) moves to the project page and the feature page.

## Third message (verbatim, 2026-11-22, in Mario's session)

> That was it for now, I'd also like a full prototype not just anything you believe are changes

## As Mario reads it
- The feedback is complete for now: the redesign feature can be written.
- The prototype covers the whole dashboard, every view (Overview, Needs you, Projects and the project page, Status,
  Roadmap, Features, Triage, Usage, and wherever Sessions' useful parts land), not only the views that change.
