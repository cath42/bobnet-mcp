# BOB-121 design A: what Casper does on the dashboard, and a review of every view

Daisy, 2026-11-22. Covers BOB-121 AC1. Sources: Casper's three messages
(`lead/bob51/casper-dashboard-feedback.md`, quoted below in his words), BOB-121's criteria, and
today's dashboard (`packages/broker/public/`, v2 at `89c5f58`). Shots of today's views are in
`current/` (`node design/BOB-121/current/take.mjs`), at 390, 1024 and 1440. The proposal is
`spec.md` and `prototype/`.

## 1. The use cases, in Casper's words

| # | What Casper does | His words | View that serves it, proposed |
|---|---|---|---|
| U1 | Opens the dashboard and sees at a glance whether anything is wrong | "i like the overview" | **Overview**, his start page (unchanged role) |
| U2 | Sees who is running right now, on which project and laptop, and what each is doing | "i like being able to see who is running" | **Overview › Working now**, grouped by project; the project page's **Running now** |
| U3 | Sees each project's CI: running, failed, passed, the last run and when | "the CI status' (running, failed, passed, last run etc.) per project" | **Overview › CI**, a line per workflow; the project page's **CI** |
| U4 | Answers what holds work up first, then the rest when he has time | "i love the 'needs you'… the separation of blocked vs when you have time questions is great" | **Overview › Needs you** (both groups), and the **Needs you** page (was "Waits on you") |
| U5 | Trusts that what Needs you shows is still true | "we just cannot allow any of it to become stale" | **Needs you**: every item shows its age; a request leaves when answered, when its worker stops, or after a day; a quiet laptop has its banner; a freshness line says when each laptop last reported |
| U6 | Sees where each project stands: its release and how far along | "I like the projects as a glance view but not sure its working as intended" (Helix shows R1, 4 of 4) | **Overview › Projects**, with the true current release (ADR 0014 §4) |
| U7 | Opens one project for its details | "i'd want to click on a project and go to a project page with details about the project" | **Project page** (new), from any project name |
| U8 | Catches up after hours away | "The status was a great idea… lets keep it, it should work" | **Status** (unchanged; it must work) |
| U9 | Sees the plan: releases and their features, and closes a release | "the roadmap is… a good overview" | **Roadmap**, with no unexplained criteria count |
| U10 | Finds a feature and opens it | "Feature in current version always show 'this project has no backlog configured'" | **Features**: the board's features, by state, with a find box; each opens the **feature page** |
| U11 | Triages the backlog, sets his gates | "Triage is fine" | **Triage**, as it is |
| U12 | Keeps an eye on token spend, spots spikes in any project, compares Sonnet-low with Opus-high | "a graph per project rather than a filter and then show all of them… toggle factoring the model/effort" | **Usage**: one graph per project, all at once; **Weigh by model** (ADR 0014 §1) |
| U13 | Looks at a feature's sessions: who ran, what came out, review evidence | (Sessions: "i never look at… challenge me if you think otherwise") | **Feature page** (sessions, outcomes, runs with tokens, review evidence) |
| U14 | Answers a worker's question or permission whole, with a note | BOB-51 (AC14-16 here) | **Overview › Working now**, the agent's detail row (an AskUserQuestion whole); **Needs you** (a permission whole, a note with Allow, Answered from here today) |
| U15 | When something looks broken: is a laptop up, which agents are online, who is global admin | (none: the parts of Sessions that are not a project's) | **Laptops** page, reached from the header's "live · 2 laptops" and from a quiet laptop's banner. Not a tab |

The challenge Casper asked for on Sessions: I agree it goes as a tab. Its parts split three ways.
Two have homes in AC13: who ran and tokens per session go to the **project page**, and a session's
runs and evidence go to the **feature page**. The third is laptop and agent health: supervisor up,
slots, outbox, last cleanup, client versions, who is online, and the Rules for every project
(BOB-118). Neither page covers it, and the quiet-laptop banner links to it today. It moves to a
small **Laptops** page that is not a tab (U15). The message log ("who messaged whom") goes there
folded. **Casper decides whether it stays.**

## 2. Every current view: keep, merge, move, drop

Today's tabs: Overview, Waits on you, Status, Roadmap, Feature, Triage, Usage, Sessions, plus a
project `<select>` in the header and Rules (`#rules`, from Sessions).

| View today | Shots (`current/`) | What it is for | What's wrong at 390 / 1024 / 1440 | Verdict |
|---|---|---|---|---|
| **Overview** | `overview-*` | U1-U3, U6 | Needs you shows only "holds work up". The rest is one link ("8 more when you have time"), so the split Casper likes is half hidden. No age on any line, so he can't tell fresh from old. CI shows only running or failed lines, folded under Working now, and passed and last run never show. Working now is one flat list, not grouped by project. Projects at a glance takes the first open release (BOB-163), and a row opens the roadmap, not the project. On a phone, Show all and Answer are two full-width 44 px buttons under every item, so five items fill two screens. | **Keep** as the start page. Needs you shows both groups with ages. Working now is grouped by project. CI gets its own card with passed, last run and history. Projects use the true release and open the project page |
| **Waits on you** | `waits-*` | U4, U5, U14 | Works. The tab says "Waits on you" and the Overview says "Needs you" for the same list. A 1440 page is 1900 px of near-identical cards. | **Keep, renamed Needs you.** Same two groups, oldest first as today, every item with its age. Answered from here today adds decided permissions (BOB-51 AC2). The note goes with Allow (AC3) |
| **Status** | `status-*`, `status-project-*` | U8 | The design holds. AC7 says it doesn't work on production data (BOB-33 is Draft with open criteria); that is a build fix, not a design one. Its per-project digest overlaps the new project page. | **Keep as it is.** Status is "since I last looked", the project page is "where it stands now". Each Status project digest links to its project page |
| **Roadmap** | `roadmap-*` | U9 | The Criteria column sums the feature's own and its tasks' criteria ("94 of 184", "52 of 81"). A Done feature shows "58 of 62", which reads as not done, unexplained. Tasks "48 of 48 done" repeats it. | **Keep**, with one column, **Where it stands**, in words. Done: "done 21 Nov", no count. Open: "6 of 11 criteria and 5 of 14 tasks left". Ready: "8 criteria to meet". Draft: "no criteria yet". A done-but-unclosed release says so beside **Close R1** |
| **Feature** (no feature picked) | `feature-list-*` | U10 | Reads the laptop's Backlog.md report, which no project has any more, so it always says "This project has no backlog configured. Set backlog: { dir } for it in supervisor.yaml." | **Replace with Features**: the board's features of a project, filtered by state, with a find box. Never the Backlog.md empty state |
| **Feature page** (`#feature/<p>/<ref>`) | `feature-*` | U13 | Good. It already has the sessions chain, outcomes, run lines, context per call, tasks and history. A Done feature shows "5 of 9 criteria" with no word on what is open. | **Keep.** Each session card lists its runs (agent, model · effort, outcome, tokens; "unknown" for a lost run) and links to review evidence. A Done feature with unticked criteria names them in a fold. It takes Context per call from Usage |
| **Triage** | `triage-*` | U11 | Fine (Casper). | **Keep as it is** (AC10) |
| **Usage** | `usage-*` | U12 | It shows the header's one project, from the laptop report: a context-size chart and agents in the latest session. A spike in another project is invisible until he switches. Tokens are raw, and model and effort are only a label. | **Rebuild**: one daily graph per project, all on the page, each spike labelled. **Weigh by model** switches Raw and Sonnet-equivalent. Tap a day to see what made it. Context per call moves to the feature page, where the session is |
| **Sessions** | `sessions-*` | U13, U15 | "For debugging": session updates, workers ended, messages, laptops, agents. Casper never opens it. At 390 the updates and messages lists wrap a word per line (`sessions-390`). | **Drop the tab.** Who ran and tokens per session go to the project page. Runs, outcomes and evidence go to the feature page. Laptops, agents, rules and messages go to the Laptops page. `#sessions` lands on a project page with a toast that says where things went |
| Header project `<select>` | all | Picks the project Feature and Usage show | It only drives the two legacy views; the board views have their own project switch. | **Drop.** Every per-project view has its own BobNet / Helix switch, and Usage shows all |
| Nav at 390 | `*-390` | Reach every view | The tabs scroll sideways, so Triage, Usage and Sessions are off the screen with no hint they exist. | **Wrap the tabs onto two rows** on a phone, so all seven show |
| Rules (`#rules`) | (from Sessions) | Global admin (BOB-118) | Reachable only from the Sessions note. | **Move** to the Laptops page |

## 3. What Casper should look at

1. **Overview**: Needs you's two groups side by side with Working now and CI. Is this the start
   page he likes, better?
2. **A project page** (Helix with workers running, BobNet with nobody): is this "a project page
   with details"?
3. **Usage** with Weigh by model on: Helix's Fable day stands out more weighted than raw.
4. **Roadmap** and **Features**: no "58 of 62"; Features lists the board.
5. **Laptops**: the one place Sessions' leftovers went. Keep, or drop the messages?
