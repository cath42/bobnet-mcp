# R3 "Dashboard revamp": what it delivered, and where R4 stands (Peach, 2026-11-26)

**R3 is complete: 2 of 2 features Done** (BOB-121 the dashboard, BOB-33 Status). I have not closed R3 on the
board. Closing it is your approval to give (rule of 2026-11-25), and nothing in R4 starts until you approve R3
and review R4's scope. poe asks you.

Goal: the dashboard looked at whole, use case first, as the prototype you approved with changes (Q-13).

**See it:** the live dashboard, https://bobnet-broker.cath42.workers.dev (broker version e2188d27, 2026-11-26;
sign in as usual). Specs and shots open on GitHub (branch `v2`): https://github.com/cath42/bobnet-mcp/blob/v2/

## What R3 delivered

| Feature | In plain words | Read |
|---|---|---|
| BOB-121 | The whole dashboard rebuilt from your use cases: Overview (who is running, CI per project, Needs you in its two groups), Needs you that never goes stale, Projects at a glance with the true current release, a page per project, Status, Roadmap and Features that say true things, a feature's page, and Usage with a graph per project, a weigh-by-model toggle and a day's detail. The Sessions tab is gone; its parts live on the project and feature pages. You looked at it live and accepted ("dashboard looks great, i like it!", Q-16). | [spec](https://github.com/cath42/bobnet-mcp/blob/v2/design/BOB-121/spec.md), [Daisy's review E](https://github.com/cath42/bobnet-mcp/blob/v2/design/BOB-121/review-E.md), [Toad's review E](https://github.com/cath42/bobnet-mcp/blob/v2/architecture/bob121/review-E.md) |
| BOB-33 | Status: catch up after hours away, with an "I'm caught up" marker that moves only when you press it | [requirement](https://github.com/cath42/bobnet-mcp/blob/v2/product/requirements/project-status.md) |

## What is not in R3 (so you can judge it)

- **Polish minors** (BOB-203 words and numbers, BOB-204 layout, BOB-205 reads) are now BOB-209 in R7 (Harden
  what we built). They are wording and spacing; no page is unusable without them. I moved them out so R3 could
  complete rather than wait on polish.
- **One live check is unseen:** that a note sent with Allow arrives in the worker's log right after the tool
  result, on both laptops. Tests cover the form and every message; your look can't show a log. It is BOB-208 in R7.
- **The first Status failure you saw was never reproduced.** Status works on real data now; its original cause
  is not written down.

## R4 "Runs without you": waits for you

Goal: work goes on through the night, lands don't fail on a busy laptop, poe changes a laptop's config without
your hands. Features, all Draft:

- BOB-188: resume after a usage limit resets (saves the most night hours).
- BOB-190: lands fail only for real; run the land hook on another laptop.
- BOB-158: poe edits another laptop's supervisor.yaml remotely.

**Recommendation:** approve R3 (close it), then R4 in that order, BOB-188 first. Nothing in R4 has started.
