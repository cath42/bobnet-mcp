# BOB-122 build A: plan (Mario, 2026-11-21)

The PO moves a feature into or out of a release through a 'release' grant field (Toad c_0201d124).

1. Luigi: broker store. New grant field `release`; setRelease (store.ts:1529) and create-with-release (store.ts:1209)
   check the grant, not ownerOnly; owner holds every grant. Feature goes last in its new release; event actor is the
   caller. order_releases and close_release stay ownerOnly. Refusal names the missing 'release' field. (AC1-3)
2. Luigi: board_write / MCP path reaches it (AC1 says "with board_write"); grants validation accepts 'release';
   dashboard Roadmap tab and Undo unchanged for the owner (dashboard test). (AC2)
3. Luigi: product/bobnet-grants.json gives Peach 'release'. (AC4, first half)
4. Toad: review + ADR 0003 addendum, "a grant, not a name". (DoD)
5. Mario: land on v2, deploy broker (standing go, window from poe), ask poe (admin) to apply Peach's grant; board_grants
   read after. (AC4, DoD)
6. Casper (board_ask): the 'release' grant for Helix, Athletic, Vitals POs. Not waited on. (AC4, second half)
7. Peach accepts.

BOB-125 / BOB-126 not folded in: separate supervisor work, would push past ~7 tasks and need an rc.
