# BOB-44 / BOB-71: the laptop mark, checked against the spec

Daisy, 2026-11-21. Build: b2bc9af (data 8a0e9a7) on v2. Spec: `design/BOB-44/laptop-mark.md`.
Checked against the ten shots `packages/broker/test-ui/shots/bob44-*-{390,1440}.png`, the dashboard code
(`nowLine`, `spawnedLine`, `waitsOnName`, `workerCard`, the `.lap` CSS) and the UI tests under "the laptop
mark (BOB-44…)".

**Verdict: pass, with one minor fix (F1, phone only).** F1 can land after or alongside the deploy. It does
not hold up AC 1.

## Per acceptance criterion

| AC | Verdict | What I saw |
|---|---|---|
| 1. Mark everywhere the spec says; the spawner reads `poe@mbp-1` | **Pass** (F1 minor) | Overview: BobNet (mbp-1 + ubu1) has the mark on every line, local Mario@mbp-1 included. Helix (mbp-1 only) has none: Howard and Marvin are bare, and its row says "Howard, Marvin on it". This is the per-project rule as specced. The queued line reads "Peach@ubu1". Needs you: "holds up Toad@ubu1". The mark is muted with no space and the name is never cut. Feature page: the header reads "● Luigi@ubu1 on it now", and On it now, the session's agent line and the task chips all carry it. The detail row keeps "ubu1" whole and adds "spawned by poe@mbp-1" under it. "waiting on poe@mbp-1" is on Daisy's line. Stale: "@ubu1 · no report 4 min" in warn on desktop, "@ubu1" in warn on a phone. Every ubu1 worker gets it, and the queued line too. Running now in Status has no mark for Helix, which is right: its laptopsOf is one laptop. |
| 2. A stuck run shows its laptop | **Pass** | "on mbp-1 · pnpm test exited 1". The lost run reads "on ubu1 · Running when its supervisor restarted; nobody has started it again." The stopped run from an older broker shows no laptop and no stray separator. It reads well on 390. |
| 3. Old supervisor: no spawner, nothing breaks | **Pass** | `spawnedLine` returns nothing without `remote_from`/`remote_by`, and `waitsOnName` falls back to the lead. Tested in "says who spawned it under the detail row, and nothing for an older supervisor's worker (AC 3)" and "…an older supervisor's worker waits on the lead as before". In the overview shots Toad@ubu1 is that worker and renders normally. |
| 4. Toad's sign-off, deploy, production shot | not mine | Mario's. After the deploy I'll check the production shot against this file if asked. |

## Fix

**F1 (minor, phone): a wrapped role hangs under the dot.** On 390, when the state on the right is long
("waiting on poe@mbp-1 · 400k tokens", "waiting on a permission · …"), the role wraps onto a second
line. That line starts at the card's left edge, under the dot, not under the name (`bob44-overview-390`,
Daisy; `bob44-overview-stale-390`, Daisy and Toad). The mark's few characters are what tip it over.
- The wrapped role should line up with the name and the path line below it. Give the who cell a hanging
  indent equal to the path's 14px:

```css
.now-list .l-who { padding-left: 14px; text-indent: -14px; }
```

- Check it in `bob44-overview-390` and `bob44-overview-stale-390`. Desktop doesn't change.

## Departures, ruled

| Departure | Ruling |
|---|---|
| "waiting on poe@mbp-1" only for a v: 2 worker (with `remote_by`); a v-less remote spawn keeps "waiting on <lead>" | **Accept.** The spec's intent is "who answers this worker's requests". Per ADR 0007 §9, a v-less remote spawn's requests go to the target's own orchestrator, so naming poe there would be wrong. Leaving the spawner's laptop off when it equals the worker's is also right; the spec says "whenever it differs". |
| The mark on the task list's agent chips | **Accept.** They are worker lines on the feature page, and the spec's rule is "every place a worker shows". It reads cleanly in the chips (`bob44-feature-detail`). I'll fold it into the spec's table. |
| Context per call: the mark on the Agent column and the per-agent tooltip only when all of that agent's runs in the session share one laptop; none on the whole-session series | **Accept.** It is the same reasoning as Usage by agent: a sum over runs can't carry one laptop. It is also stricter than the spec's "per the rule", and correctly so. |
| No optional Laptops-card "2 from poe@mbp-1" | **Accept.** It was optional. The ended card's "· spawned by …" and the detail row cover who spawned what. |
| Roadmap row's "● … on it now" gets the mark | **Accept.** It is the same line as the feature header. |
| Stale minutes as their own `.lap-age` span, hidden on a phone | **Accept.** It keeps the 20ch cut from eating the minutes, and the phone behaviour matches the spec (minutes in the title). |
| `.who-at` instead of the spec's pair wrapper; `.who b` margin zeroed inside it | **Accept.** It is a naming clash only. The pair stays nowrap as specced. |
| Lost run's wording "its supervisor restarted" | **Accept.** That is the spec's wording. |
| Shots at 390 and 1440 only | **Accept** for this check. The criterion asks for phone and desktop, and tablet follows desktop. |
