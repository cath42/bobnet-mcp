# BOB-44: the laptop mark

Criterion 7 of `product/requirements/remote-orchestration.md`: "The dashboard marks a worker's laptop
wherever workers show. *Evidence: screenshot on phone and desktop.*" This spec says where, in what
form, and when. It is short on purpose: one small mark, applied in every place a worker shows. No
prototype: the mark is one `<span>` and its CSS is below.

## Which laptop is "its" laptop

**Where it runs.** That is the supervisor that reports it: the dashboard already builds every worker
from a laptop's snapshot (`workers()`, `app.js:168`, sets `w.laptop` from the reporting supervisor),
and every board run carries `laptop` (`RunRecord`, `protocol/src/board.ts`). A worker that poe@mbp-1
spawned on ubu1 is reported by ubu1's supervisor, uses ubu1's run slot, worktree and usage (criterion
3), and Stop/Reset/Allow go to ubu1 (`act(w.laptop, …)`). So its mark is **ubu1**.

**The spawner shows too, but only in the detail row, and only when it is on another laptop:**
`spawned by poe@mbp-1`. Why: it tells Casper who answers that worker's requests and gets its result
(Q-6; criteria 2 and 5), which is otherwise invisible: the project's lead may be on a third laptop or
not involved at all. It stays off the headline lines because the line answers "where is it", and two
laptop names on one line read as a move. A local spawn (the usual case) shows no spawner line.

## The mark

The worker's name, then its laptop as the second half of its address, muted: **Luigi**`@ubu1`. It
echoes how BobNet already writes agents (`name@laptop`, the Sessions tab's Agents table), so it needs
no legend and no icon.

```html
<b>Luigi</b><span class="lap" title="Runs on ubu1">@ubu1</span>
```

```css
/* BOB-44: a worker's laptop, after its name. Full name in the title and the detail row. */
.lap { color: var(--muted); font-weight: 400; font-size: 0.92em; display: inline-block; max-width: 20ch;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.lap.stale { color: var(--warn); }
@media (max-width: 600px) { .lap { max-width: 10ch; } }
```

- **No space** between the name and `@`: it is one address. In running text ("holds up Luigi@ubu1
  (build A)") it reads the same.
- **Long laptop names** (up to 32 characters, `SEGMENT` in `protocol/src/address.ts`): cut with an
  ellipsis at 20ch on a tablet and desktop, 10ch on a phone (`@casper-mac…`). The `title` holds the
  whole name, and the detail row and the Laptops cards always print it whole. The name before it is
  never cut for the mark: the mark gives way first.
- **Its laptop has gone quiet** (`staleReport`, no report for three heartbeats): the mark turns warn
  and reads `@ubu1 · no report 4 min` on a tablet and desktop; on a phone just `@ubu1` in warn, the
  minutes in its `title` (the Overview's stale line says them too). It explains why the line looks
  frozen, so it shows whatever the span rule below says.

## When it shows: only when the project spans laptops

The mark shows on a project's workers when **that project has run on more than one laptop in the
dashboard's window**: `laptopsOf(key).length > 1` (`app.js:1201`: the laptops of its supervisor's
boards and of its workers, active or ended in the last 24 h). Otherwise its lines stay exactly as
they are today.

Why per project, not always and not per broker:
- Casper's two laptops always both report, so "only when the broker sees two laptops" is "always":
  every Helix line would gain `@mbp-1` that says nothing.
- Per project, the mark appears the moment it means something, and then on **every** one of that
  project's worker lines, local ones too. So within a project a missing mark never means "the other
  laptop": either all its lines have one or the project runs on one laptop, which its Overview row
  already names (`helix · mbp-1 · lead poe`).
- In lists mixing projects (Working now, Needs you, Waits) each line follows its own project's rule.
  A line with no mark is in a one-laptop project; its project row says which.

Exceptions, shown always: a stale laptop's mark (above), and the places that print the laptop today
(next section, "already shows"). Those stay as they are.

## Every place a worker shows

Phone is 390px, desktop 1440px; tablet (1024px) follows desktop except where said. "Mark" means the
`.lap` span under the span rule.

### Overview

| Place | Today | With the mark |
|---|---|---|
| Working now, each line (`nowLine`) | `● Luigi build` / path / tokens | `● Luigi@ubu1 build`. Phone: same line; the 10ch cap keeps the tokens on it. |
| Working now, queued (`queuedLine`) | `2 queued: Luigi, Toad` | `2 queued: Luigi@ubu1, Toad@mbp-1`. A queued worker waits for **that** laptop's slot, so it matters most here. |
| Needs you, a permission (`permissionLine`) | meta `BobNet · BOB-44 · holds up Luigi (build A)` | `… holds up Luigi@ubu1 (build A)` |
| Needs you, a stale laptop's line (`staleLines`) | names the laptop | unchanged |
| Projects row, name cell (`projectRow`) | `mbp-1 · ubu1 · lead Mario · PO Peach` | unchanged: this is where a one-laptop project's laptop is named |
| Projects row, Open now (`… on it`) | `Luigi, Toad on it` | `Luigi@ubu1, Toad on it` per the rule (here both would carry it: same project) |

### Waits on you

| Place | Today | With the mark |
|---|---|---|
| A permission (`permItem`) | meta `Holds up Luigi (build A) · on ubu1` | already shows the laptop, always: unchanged. `Holds up Luigi (build A)` stays without the mark so the laptop isn't said twice. |
| A board wait (question, action, review) | names the asking agent from the board, not a worker | no mark: a question belongs to the project, not a laptop (Q-6, "it doesn't matter what machine the owner of the question is") |

### Feature page

| Place | Today | With the mark |
|---|---|---|
| Header, `● Luigi, Toad on it now` | names | `● Luigi@ubu1, Toad@mbp-1 on it now` |
| On it now, each line (`agentWho`) | `● Luigi build · working · 41k tokens` | `● Luigi@ubu1 build · …`. Phone: the line wraps after the name as it does today; the mark stays with the name (`white-space: nowrap` on the pair). |
| A session's agents, live and ended runs (`stepItem` → `agentWho`) | same | same as On it now. Ended runs take `laptop` from the board's `RunRecord`. |
| An agent's state, `waiting on Mario` (`agentState`, orchestrator-tier request) | the project's lead | for a remote-spawned worker, the spawner: `waiting on poe@mbp-1` (the spawner's laptop shown whenever it differs from the worker's). Needs `remote_from`, below. |
| Detail row (`agentDetail`) | `opus · high · ubu1 · worked 12 min · context …` | unchanged (laptop always, whole), plus a line `spawned by poe@mbp-1` under it when `remote_from` is set. Stop, Reset, Allow, Deny: unchanged; they already go to the laptop it runs on. |
| Run slot line (`runLine`) | `run slot on ubu1: land` | unchanged |
| Context per call chart, tooltip | role and run | add the mark to the run's name in the tooltip, per the rule |

### Roadmap (kanban, Backlog.md projects)

| Place | Today | With the mark |
|---|---|---|
| Agent tag on a card (`agentTag`) | detail line `opus · high · ubu1 · 12 min · 41k tokens` | already shows the laptop, always: unchanged |

### Status

| Place | Today | With the mark |
|---|---|---|
| Stuck, a run (`stuckRun`) | `Luigi's run on BOB-44 build A failed` / reason | meta gains `on ubu1 · ` before the reason; a lost run reads `on ubu1 · Running when its supervisor restarted; …` (a lost run is that laptop's restart, so the laptop is the useful part). Needs `laptop` on the stuck run entry, below. |
| Stuck, settled runs | as the run | same |
| Usage, by agent | `Luigi build · 1.2M` | **no mark**: it is a sum over runs, which may have run on both laptops; a laptop per row would be wrong for some of them |
| Usage, Running now | `● Luigi build · 41k so far` | `● Luigi@ubu1 build · 41k so far` |
| Done, sessions (`closed_by`) | who closed it | no mark: a closer, not a worker |

### Usage tab

| Place | Today | With the mark |
|---|---|---|
| Agents in the session, the role's laptops (`td .cp`) | `mbp-1, ubu1` | unchanged |

### Sessions tab (debugging)

| Place | Today | With the mark |
|---|---|---|
| Workers ended in the last 24 h (`workerCard`) | sub line has the laptop | unchanged, plus `· spawned by poe@mbp-1` when `remote_from` is set |
| Laptops cards | per laptop | unchanged. Optional: `2 from poe@mbp-1` in the meta when its workers have `remote_from` (Luigi's call; nice, not required) |
| Agents table | `name@laptop` | unchanged |

## Data: what exists and the two small additions

Exists: every live or 24 h-ended worker's laptop (the reporting supervisor), every pending request's
laptop, every board run's laptop, every slot run's laptop. That covers everything above except:

1. **`remote_from` on the worker snapshot** (`WorkerSnapshot`, `protocol/src/frames.ts`): the
   requester's address when a remote request spawned it, else null. The supervisor has it already
   (`spawned_by` in its store, set to the sender's address for a remote spawn). Only the address
   form; a local spawn's `"orchestrator"` or a lead's worker id isn't sent. Used by the detail row,
   the ended card and `waiting on poe@mbp-1`. **For Toad/ADR 0007**, which may name it differently.
2. **`laptop` on `StatusStuckRun`** (ADR 0005 §2): the run's `RunRecord.laptop`. **For Toad.** Until
   it is there, Stuck shows no laptop (no guessing from today's snapshots, which forget after 24 h).

## States

- **One laptop everywhere** (today): nothing changes on screen.
- **A project gains a remote worker:** all its worker lines gain the mark at the next snapshot; they
  keep it for 24 h after the last one ends (the snapshot window), then drop it.
- **A laptop goes quiet:** its workers' marks turn warn with the minutes, in every project, and the
  existing stale lines and Laptops card say the rest.
- **Laptop name 32 characters:** cut at 20ch / 10ch, whole in `title` and in the detail row.
- **Worker from a supervisor that hasn't sent `remote_from` yet** (older release): no spawner line,
  `waiting on` keeps the project's lead. Nothing breaks.

## Review

Daisy takes the criterion's screenshots on the build, phone (390px) and desktop (1440px): Overview
Working now and Needs you with a project spanning mbp-1 and ubu1 and another on one laptop; a feature
page with a remote worker's detail row open; a stale laptop's mark.
