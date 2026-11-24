# BOB-121, builds C and D: live check, 2026-11-23 19:20 CST (Mario)

Broker 3b7252ed, deployed by poe from 8630fe415c0d (clean tree). rc.55 on ubu1 (18:02Z) and mbp-1 (ready 01:12:51Z
2026-11-24); the broker that takes its `models` (a6af01fb, from 9fde1b9) was deployed before either.

## Seen

| What | How |
|---|---|
| Both laptops reconnected, on rc.55 | `list_peers`: every current role of mbp-1 and ubu1 registers `@bobnet/supervisor` 2.0.0-rc.55 |
| Board reads and `weighted` work | `board_list`, `board_get` on bobnet, helix and vitals; build D's session reads `weighted` 45768178 |
| Helix's release, for 179 c3 | R0, R1 closed; R2 open, **6 of 11** features done (the criterion's "1 of 6" is out of date); R3 on are planned. The current release by ADR 0014 §4 is R2, and no release is `done_unclosed` |
| BOB-193 | `board_list` answers "No project sandbox" and "No project alexa-mcp"; 8630fe4's app.js has the guard (`projects()`, line 205: a row not in the service's list is skipped); Vitals' R3 (Voice: Vitals as an Alexa skill) is listed, planned, 0 of 3 |
| The order of deploy and rc, for 162 c2 and 173 c4 | broker a6af01fb ~17:5xZ, ubu1 rc.55 18:02Z, mbp-1 rc.55 01:12:51Z |

Commits: 176 c16 is 93311ab (with tests, inside 8630fe4).

## Not seen

- No page was seen: the dashboard answers 302 to its sign-in. The served app.js wasn't read: the guard is from the commit.
- 179 c3 on screen, 176 c5 (a permission allowed with a note on each laptop, and the two log lines) and 176 c6 (Answered
  from here today, from mbp-1's real report) need a person. Queued; Casper isn't asked.
- A run of rc.55 that ended with `models` (BOB-173): no read gives `run_models`.
- 195 c4: `callsOf` isn't in rc.55. It rides rc.56, with the broker already live.

## From poe (m_673bf51b, 19:15 CST)

- wrangler for 3b7252ed: "Uploaded 3 files". Their names weren't kept, and the served files can't be compared here (sign-in).
- mbp-1's supervisor.log after "supervisor ready": nothing about models or a refused frame. At 01:12:50Z, before it, two
  "board reports wait" (run_end, not_hosted: the old Bob's and Mario's ends, seq 7099 and 7100), as at earlier restarts;
  whether they were delivered later isn't known. ubu1's log wasn't read.
