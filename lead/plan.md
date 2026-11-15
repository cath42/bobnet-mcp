# Plan (Mario)

Updated 2026-11-15 00:31Z, after the rc.28 restart. Live: v2.0.0-rc.28 (v2 15fb27e, BOB-11..13).
Broker not deployed since BOB-12; the deploy is Casper's.

## Running
- Toad (w_39a3303d): review of e74a747, the Backlog.md import; plus what dotted ids would change.
- Peach (w_bf298cca): done, 9e6c4d1 (product/requirements/migration.md "Import answers").
- Luigi (w_92cfd796): BOB-2 §7, questions and answers, service side; then the 60 s wait test (#12).

## Next, in order
0. Luigi, after §7: the import appends each item's references to its notes as a "References:"
   list (Peach, product/requirements/migration.md "Import answers"; BOB-14 #6). Helix's answers
   wait on Picard and may add more.
   Also the supervisor: a message injected mid-turn never gets inbox consumed_by, so it reaches
   the role's next worker again (poe's check 3 after rc.28; worker.ts taken()). Told poe.
1. BOB-2: close_release and undo; step 4 view data; CI (POST /v1/runs, the gh adapter).
2. BOB-14, the pilot: broker deploy (Casper), `--post`, then `board: service` in bobnet's config.
3. BOB-9, Helix, at Picard's date.

## Waiting on Casper
- The broker deploy: migrations 6 and 7, the Board DO (wrangler migration v2, Board migration 1).
- Task ids on import: flat renumbering with the old id as an alias, or dotted ids kept. Mario
  leans dotted. If dotted: Toad amends ADR 0001 §2 and ItemRef, Luigi changes store and import
  before BOB-9.
