# Reporting CI runs to BobNet

Any CI, anywhere, reports its runs with two calls: one when a run starts and one when it ends (ADR
0001 §10). BobNet ties each run to the agent whose land pushed its commit, so the dashboard shows
"waiting on CI" on that agent and the run on its session. A run on a commit no agent pushed shows on
its project only.

## The token

A CI system gets its own Cloudflare Access service token, never a laptop's. Casper adds the token
to the broker's Access application, as for a laptop (README, set up step 1), or Access refuses its
requests before the Worker sees them. Then he adds it to the broker's secrets as a JSON map of the
token's client ID to the source name its runs are recorded under:

```sh
wrangler secret put CI_TOKENS_GITHUB   # {"<client-id>.access": "github-actions"}
```

Every `CI_TOKENS` and `CI_TOKENS_<NAME>` secret is merged, like `LAPTOP_TOKENS`. The source comes
from the token. A body that names another source is refused. `slot` is the run slots' own source,
so a token mapped to it is refused. A CI token may post runs and nothing else: no socket, no board
reads, no export.

## The call

`POST /v1/runs`, with the token's two Access headers and a JSON body:

| Field | |
|---|---|
| `external_id` | The run's id in its CI, unique per source: one per job that reports, so two jobs never share one. Include the attempt for a re-run: `123-2`. Required. |
| `name` | Workflow and job, as the dashboard shows it. Required. |
| `status` | `queued`, `running`, `passed`, `failed` or `cancelled`. Required. |
| `project` | The BobNet project key. Leave it out when `repo` is one project's repo. |
| `repo` | `owner/name`, as the project's repos list it. |
| `branch`, `sha` | The commit it ran on. `sha` is the full 40 characters, which is what ties it to a push. |
| `url` | The run's page. |
| `started_at`, `ended_at` | ISO 8601 times. |

The two calls have the same `external_id` and may arrive in either order. A run's project is fixed by
its first call. Once it has ended (`passed`, `failed`, `cancelled`), a later `queued` or `running`
changes nothing, though a field it lacked is still filled in. The reply is
`{"ok": true, "ref": "github-actions 123-1", "tied": "w_…"}`, where `tied` is the worker or null.
Errors are `{"ok": false, "code", "message"}` with 400, 403 or 409.

```sh
curl -sf https://<broker>/v1/runs \
  -H "CF-Access-Client-Id: $BOBNET_CI_ID" -H "CF-Access-Client-Secret: $BOBNET_CI_SECRET" \
  -H "content-type: application/json" \
  -d '{"external_id":"123-1","name":"CI / test","repo":"cath42/helix","sha":"<40 hex>","status":"running"}'
```

## GitHub Actions

Put a step first and one last in each job that reports. The last one runs on failure and cancel too.
The `external_id` names the job, since a workflow run's id is every job's: with one id, the first job
to end makes the run final and a later job's failure is dropped. In a matrix, add
`-${{ strategy.job-index }}` to it as well.

```yaml
- name: Report to BobNet
  run: |
    curl -sf "$BOBNET_URL/v1/runs" \
      -H "CF-Access-Client-Id: ${{ secrets.BOBNET_CI_ID }}" -H "CF-Access-Client-Secret: ${{ secrets.BOBNET_CI_SECRET }}" \
      -H "content-type: application/json" \
      -d '{"external_id":"${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}","name":"${{ github.workflow }} / ${{ github.job }}",
           "repo":"${{ github.repository }}","branch":"${{ github.ref_name }}","sha":"${{ github.sha }}",
           "url":"${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
           "status":"running","started_at":"'"$(date -u +%FT%TZ)"'"}' || true

# ... the job's steps ...

- name: Report to BobNet
  if: always()
  run: |
    case "${{ job.status }}" in success) s=passed;; cancelled) s=cancelled;; *) s=failed;; esac
    curl -sf "$BOBNET_URL/v1/runs" \
      -H "CF-Access-Client-Id: ${{ secrets.BOBNET_CI_ID }}" -H "CF-Access-Client-Secret: ${{ secrets.BOBNET_CI_SECRET }}" \
      -H "content-type: application/json" \
      -d '{"external_id":"${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}","name":"${{ github.workflow }} / ${{ github.job }}",
           "repo":"${{ github.repository }}","sha":"${{ github.sha }}","status":"'"$s"'","ended_at":"'"$(date -u +%FT%TZ)"'"}' || true
```

`|| true` keeps a BobNet outage from failing the build.

A project on GitHub Actions doesn't need this at all once its supervisor reports its runs from
`gh run list` (the gh adapter, ADR 0001 §10). That needs no secret in GitHub. Don't do both on one
repo: the adapter records a run per workflow run and the token one per job, so each run would count
twice.
