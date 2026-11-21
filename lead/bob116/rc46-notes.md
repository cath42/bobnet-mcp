# rc.46 (v2.0.0-rc.46): BOB-116 Remote Control names, BOB-117 timing asserts

Built and tagged by Mario (small supervisor change; Casper asked Mario to build it, 2026-11-21). Toad's consult
c_65a70329 (advisory): go, no protocol, broker or schema change. Supervisor-only; broker not deployed.

## What's in it (since rc.45)
- BOB-116 3872806: a worker's Remote Control session is named `<Role>@<laptop> <Proj>.r<release>.<feature#>.<kind><label>`,
  e.g. `Phelps@ubu1 Env.r1.16.bA`, `Bob@mbp-1 Land.r2.56.bA2`; `Env.16.bA` with no release; the address alone
  with no session. On a board-service project the spawn reads its feature's release with one board `get` after the
  join (as the role, the worker's ctx, at most 5 s); a failure only leaves the release out. The release is kept on
  the stored declared session (`release`, optional). It is a snapshot at the join: a feature moved to another
  release keeps the old name until its next spawn (Toad's note b). A Backlog.md project names no release.
- Retro now carries its label (`Land.41.retro1`): AC 5, "the label is appended as given".
- spawn_worker's description: a role's model and effort are defaults, set per task within max_effort.
- BOB-117: upgrade.test verify deadline gets a 30 s test timeout and 5 s bounds; protocol redact linearity 250 ms.
- Supervisor tests at the tag: 527.

## How each laptop gets it
- **mbp-1** (rc.45) and **ubu1** (rc.44): poe rolls it with `upgrade_supervisor {tag: "v2.0.0-rc.46"}` (from rc.42 on,
  Mario stops at the tag and the push). Right after a restart the ask may be refused "this supervisor is
  starting": transient, ask again. A live lead holds `when_idle`; Mario leaves his handoff first.
- **Check**: `supervisor@<laptop>` reports 2.0.0-rc.46 in `list_peers`; the next spawned worker's Remote Control
  session shows the new name.
