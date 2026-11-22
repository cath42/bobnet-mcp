# BOB-51 design A: close (Mario, 2026-11-22)

need: casper (Q-12, the prototype verdict). It holds only build B (task 7, the dashboard); build A (tasks 1-6) runs now.

## What landed
- Toad (w_4a21f340), c8f7fdc: ADR 0013 `architecture/decisions/0013-requests-whole-notes-delivered.md` and
  `architecture/bob51/build-brief.md`. Seven tasks: protocol (`ask`, `decided`, `note_delivered`, all optional), the
  whole ask from the supervisor (bounded, never a credential), `requests.via` and `decided` on the report, the note as
  the agent's next message (local, and remote through ADR 0008's answer op), a both-ends-real test (two supervisors on
  FakeNetwork), the broker, the dashboard. Additive both ways. Needs a broker deploy, an rc and a restart of both laptops.
- Daisy (w_4235753d), 82eb2d3: `design/BOB-51/spec.md`, `prototype/`, `shots/` (390, 1024, 1440). More than small: a
  question's options are a new `.ask` block in three places, and the agent detail row gains Show all.
- For Peach: a worker's AskUserQuestion is orchestrator-tier, so it never shows on Waits or Needs you; its home is the
  agent's detail row. AC1 may want rewording. Answering by option is captured as BOB-161.
- Peach (w_b7589f0d): BOB-158 is a feature, ordered right after BOB-51, Draft until Toad designs it.

## Casper
- Q-12: the prototype at https://bobnet-prototype-bob-51.casper-cth.workers.dev (assets-only Worker
  `bobnet-prototype-bob-51`, version 41b3bfc4).

## Next
Build A (Luigi w_c0d83294, tasks 1-6), Toad's review, broker deploy, rc for poe. Build B (task 7) after Q-12.
