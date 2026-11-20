# BOB-65 AC 10: build A acceptance on the real broker (Mario, 2026-11-20)

Both laptops on v2.0.0-rc.40 (32b6717): mbp-1 ready 17:24:14Z (pid 61029, orchestrator poe), ubu1 ready
17:26:02Z (list_peers: supervisor@ubu1 and every ubu1 role at 2.0.0-rc.40). Driven by poe@mbp-1 through its
supervisor MCP, under the temporary grant on ubu1 `supervisor@mbp-1: { spawn: { athletic: [reviewer] } }`.

## Run 2 (bob65-ac10b): passed

1. `spawn_worker` laptop `ubu1`, project athletic, role reviewer, session `ENV-16 review bob65-ac10b`
   -> `w_ba489dd1`, state running, started 17:26:40.903Z, spawn_req `m_a4fc0f24-fb8a-420d-82d0-d2335774fbcc`.
2. Joins the session, run report: athletic board, session ENV-16 review bob65-ac10b, run `w_ba489dd1`, laptop ubu1,
   outcome done, ended 17:26:57.717Z, tokens in 1492 / out 987 / cache read 69723 / cache write 16175, calls 3,
   remote_url kept, tasks [ENV-16].
3. Done notice to poe@mbp-1 (supervisor@mbp-1, 17:26:57.939Z, m_0e19a886), verbatim:
   "Reviewer (w_ba489dd1, athletic/reviewer) on ubu1 done: BOB-65 AC 10 smoke test done; handoff in worker_summary."
4. `worker_summary {id: "w_ba489dd1", laptop: "ubu1"}` (as_of 17:27:01.254Z), no file read on mbp-1:
   state done, errors 0, files_changed ["/home/ct/.local/state/bobnet/handoffs/athletic/w_ba489dd1.md"], handoff_text:

   ```
   BOB-65 AC 10 handoff from athletic/reviewer on ubu1
   d5ef7df ENV-2 fixes close: ENV-2.1 to ENV-2.7 Done (#779)
   b39e4ea ENV-2.2–2.7: ENV-2 review fixes, one batch (apps, services, database, qa, design, ops) (#778)
   d9e321d ENV-2.1: Casper's 2026-11-07 rulings and the ENV-2 process-lens fixes (#771)
   /home/ct/Code/athletic

   Task done: BOB-65 AC 10 cross-laptop smoke test. Ran git log and pwd.
   Files changed: none (this handoff only).
   Decisions made: none.
   Open questions: none.
   Next step: none; smoke test complete.
   ```

## Run 1 (bob65-ac10, rc.39, 16:50Z): failed on the handoff half

`w_3d90e7c3` joined session ENV-16 review bob65-ac10 with its run report (join half held), but the notice said
"no handoff file" and handoff_text was null. Root cause (poe@ubu1, confirmed in code): `config.ts`
`state_dir: path.default("~/.local/state/bobnet")`. zod 4 `.default()` skips the `.transform(expand)`, so a laptop
without `state_dir` (ubu1) ran from `/home/ct/~/.local/state/bobnet` and `handoffOf` missed every handoff.
Fix: Luigi 28f4cc0 (`.prefault` + test), released as rc.40. poe@ubu1 moved the db, logs and status.json into the
real state dir before the restart. mbp-1 sets `state_dir` explicitly and was not affected.

Leftover: three ubu1 rows spawned under rc.39 (w_dddeb3ec, w_3d90e7c3, w_6b7a9969) stored a literal `~/` handoff
path. poe@ubu1 fixes them with a one-off UPDATE after a db backup. There is no code change: rc.40 stores expanded
paths, as run 2 shows.
