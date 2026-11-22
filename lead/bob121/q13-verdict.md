# BOB-121 Q-13: Casper's verdict, 2026-11-22: "changes"

Recorded on Q-13 (key `changes`, seq 7172), his words verbatim:
1. "On the prototype, generally this looks much better, usage overview looks fine but I liked the calls/context line
   graphs, would i click on a bar to see the detailed context/call by agent and in total? the prototype isn't clear on
   that and what would we use as a baseline or comparison?"
2. "The protoype thing at the bottom of the overview is weird, i don't know what you are trying to do with that?"
3. "yes build it with the changes"

## The changes he agreed to (Mario's proposal, answered "yes build it with the changes")

- **Usage, a day's bar.** Tapping or pressing Enter on a day keeps today's day line (total, split by model, biggest
  sessions). It also opens that day's **context-per-call and calls line graphs**, with a switch between **Total** and
  **By agent** (role).
- **Baseline.** On those line graphs, a dashed line for that role's (or the total's) **median over the chosen period**
  (14 or 30 days). The bars keep the median day and the spike rule (over twice the median and over 4M).
- **"Show other states"** at the foot of the prototype pages is a preview switch for the prototype only. It is **not built**.

Before the build: Daisy amends design/BOB-121/spec.md §2.9. Toad confirms the read carries per-call context by role
for a day and the period medians (ADR 0014 / build brief D-tasks). Peach splits the tasks from the brief and spec.
