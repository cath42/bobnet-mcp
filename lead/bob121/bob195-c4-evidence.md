# BOB-195 c4: ships broker first, then the rc; which laptops restarted

Mario, 2026-11-26.

- Broker first: deployed from b497ec1 at 2026-11-26 05:50Z, version e2188d27-0f9d-4f3b-977f-2e5e496baef2
  (carries `ctx_even`, built in D).
- Then the rc: v2.0.0-rc.56 tagged on aeb3dfb after that deploy; poe rolled it.
- Restarted: **mbp-1** on rc.56 since 08:51Z (poe); **ubu1** on rc.56 (list_peers, 2026-11-26: supervisor@ubu1
  and every ubu1 role report `@bobnet/supervisor 2.0.0-rc.56`; supervisor@mbp-1 the same).
- A worker run shows calls: `list_workers all, project helix, since 08:51Z` lists Bob's LAND-57 workers on
  mbp-1 with per-call ctx, e.g. w_b50f0d14 (changesets, LAND-163) 147 points 38,961 to 384,992;
  w_2d521527 (web-bff, LAND-165) 128 points; w_9db166de (Riker) 26 points; live lead Bob w_db8f4d27 running.
