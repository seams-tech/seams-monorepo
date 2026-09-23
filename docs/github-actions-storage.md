# GitHub Actions storage and deployment recovery

## Findings on 2026-09-19

The mainnet build in run `35437596819` failed during artifact upload with
`Artifact storage quota has been hit`. The organization uses GitHub Free and has
an Actions budget of $0 with further paid usage blocked.

The artifact inventory showed:

| Repository           | Unexpired artifacts | Listed size before cleanup |
| -------------------- | ------------------: | -------------------------: |
| Archived `seams-sdk` |                 218 |        2,853,133,260 bytes |
| `seams-wallet`       |                 160 |          240,927,887 bytes |
| `seams-monorepo`     |                   0 |                    0 bytes |

Expired artifact metadata was excluded. The September billing report attributes
most accrued storage to `seams-sdk`, including usage from before its archive.
Accrued GB-hours and currently retained bytes are different measurements.

Cleanup deleted 32 superseded `backend-build-staging-testnet` and
`backend-build-production-mainnet` artifacts from the archived repository,
reclaiming 2,542,383,675 bytes. The newest build for each lane was retained:
artifact IDs `10300137576` and `10093491582`. The archived repository now lists
186 unexpired artifacts totaling 310,749,585 bytes. Release assets, package
versions, recovery artifacts, and workflow logs were preserved.

Applying the new retention ages to completed Wallet runs removed another 78
intermediate local-tool and ordinary documentation artifacts, reclaiming
68,059,532 bytes. Versioned release docs and CLI artifacts were retained.
The combined cleanup reclaimed 2,610,443,207 bytes; immediately afterward, listed
unexpired artifacts across both repositories totaled 483,617,940 bytes (about
461 MiB). Subsequent successful public documentation builds add to that inventory.

GitHub documents a [6–12 hour artifact usage update window](https://docs.github.com/en/billing/concepts/product-billing/github-actions#example-artifact-storage-cost-calculation).
Deleting artifacts stops future storage accrual; it does not erase storage
already accrued this billing cycle. Successful artifact upload still needs to
be verified after reconciliation. If uploads remain blocked, inspect the
organization billing usage and Actions budget before further deletion. Raising
the spending cap requires the account owner's decision; it was left at $0.

## Retention and handoff policy

- Production backend and Console build caches are temporary job-to-job handoffs.
  Use a key scoped to the workflow run and attempt, restore the exact key with
  `fail-on-cache-miss`, and delete it after all consumers finish. Mainnet now
  follows the existing testnet pattern. Console gains the same cleanup.
- Rerun the whole deployment workflow after a failure. A new attempt rebuilds
  its payload; a failed-jobs-only rerun cannot restore a previous attempt's key.
- Staging backend artifacts use compression level 6 and are deleted by the
  uploaded artifact ID after every consumer finishes. A one-day retention limit
  bounds storage if cleanup is interrupted. Their previous retention was 30 days
  with compression disabled.
- In `seams-wallet`, intermediate local-tool artifacts expire after one day and
  ordinary documentation builds after seven days. Versioned release docs retain
  their existing 90-day lifetime; CLI release inputs retain their existing
  30-day lifetime.
- Actions caches have a separate storage allowance. Deleting dependency caches
  does not release artifact quota. Keep using the deployment handoff while the
  artifact quota reconciles; it does not prove the artifact quota is resolved.

The retention changes are merged in [Wallet PR 5](https://github.com/seams-tech/seams-wallet/pull/5)
and [monorepo PR 23](https://github.com/seams-tech/seams-monorepo/pull/23).
Mainnet deployment `35443614586` successfully consumed its exact build cache and
deleted it after deployment. The cache inventory confirms that run's key is gone.
At 13:14 UTC, a [private upload probe](https://github.com/seams-tech/seams-monorepo/actions/runs/35445137780)
still failed to upload a 20-byte file with `Artifact storage quota has been hit`.
The cleanup had occurred around 11:00–11:10 UTC, within GitHub's stated
reconciliation window. The probe created no artifact; its temporary PR was
closed without merging, and its branch was deleted. Quota recovery is still
unverified. Retry a private upload after reconciliation, then inspect billing
usage if the same failure persists. Successful public uploads do not establish
that private artifact uploads are available.

## Mainnet availability is a separate issue

Run `35437876267` deployed the Wallet services from release `0.5.24`, then failed
all five Gateway smoke checks with HTTP 500. Live Worker logs identified
`active tenant deployment lookup failed with HTTP 404` from the private
`WALLET_CONSOLE` binding. Mainnet Console still served the older `7ab2065`
revision without that endpoint.

[Console deployment `35438878364`](https://github.com/seams-tech/seams-monorepo/actions/runs/35438878364)
deployed the current `d64ec200` revision and completed successfully. Console
readiness is HTTP 200. Gateway smoke now passes the explicitly supported
bootstrap response, HTTP 503 `tenant_deployment_unavailable`, on all five routes.
This means infrastructure is deployed and awaiting activation; wallets remain
unavailable on mainnet.

Read-only D1 inspection found no tenant bindings or active pointer. The
`Seams Wallet` project's production environment `proj_mu6auwge_v8ulud:prod` is
disabled; its development environment is active. Confirm the production target,
then enable and provision it through the supported Console and protected
cutover flow. The current protected live-demo workflow targets production-testnet;
do not reuse its development environment as a mainnet binding or insert an
active pointer directly in D1.

For releases that change the Gateway/Console protocol, deploy the matching
Console revision as part of the coordinated release. After provisioning, require
HTTP 200 and semantic tenant readiness before describing mainnet as healthy.
Testnet signing measurements on `0.5.24` can proceed while mainnet activation is
being resolved.

The unavailable public discovery response also lacked CORS headers. Browsers
could not inspect its HTTP 503 status, so the optional mainnet configuration
prevented `wallet.seams.sh` from loading its available testnet demo. [PR 24](https://github.com/seams-tech/seams-monorepo/pull/24)
now exposes that public, non-cacheable unavailable response to browser callers.
[Deployment `35443614586`](https://github.com/seams-tech/seams-monorepo/actions/runs/35443614586)
passed, and a fresh browser reload verified startup without interception.
Mainnet still needs a supported credit/activation path; its ledger balance is $0.
Stripe sandbox checkout has not been treated as production payment or used to
bypass the existing billing guard.

## Production signing placement

Live `0.5.24` Tempo measurements found 9.76–10.55-second empty-pool signing and
3.34–5.63-second cached signing before the placement change. A read-only D1 probe
reported the gateway primary in Singapore (`SIN`) and the signing-worker private
primary in Osaka (`KIX`). The gateway targets Singapore; the signing worker had
no placement policy and executes multiple sequential primary operations.

The production-testnet signing worker now targets `aws:ap-northeast-3`, near its
existing private database. The target is stored in its existing resource entry
in `deployment/wallet-system/targets.json` and rendered into the selected Wrangler
environment. Other lanes retain their existing placement. Bindings and key
material were unchanged in the live comparison. [Cloudflare placement documentation](https://developers.cloudflare.com/workers/configuration/placement/)
describes how service-bound workers can be placed near their backend services.

Three subsequent cached Tempo signatures took 2.46, 2.58, and 2.80 seconds, including
one exact-operation step-up. Empty-pool samples still took 7.88–13.35 seconds;
foreground generation accounted for 5.32–9.93 seconds. These small samples show
an improvement in the cached path and a remaining generation bottleneck. They
do not establish a production p95. See the canonical
[optimization plan](https://github.com/seams-tech/seams-wallet/blob/main/docs/optimization-10.md)
for cohort details and remaining acceptance work.

[PR 25](https://github.com/seams-tech/seams-monorepo/pull/25) merged the placement
configuration. Standard testnet [deployment `35444951877`](https://github.com/seams-tech/seams-monorepo/actions/runs/35444951877)
then completed successfully. A fresh Cloudflare settings read confirmed the
placement survived deployment, all five live Gateway smoke routes returned
HTTP 200, and the run's temporary build cache was removed. The measurements
above belong to the earlier placement comparison; they were not repeated
against this subsequent deployment.

## Production-testnet Deriver placement

The production-testnet Deriver databases were both provisioned with the D1
`apac` location hint, yet Cloudflare placed Deriver A in Singapore (`SIN`) and
Deriver B in Seoul (`ICN`). The databases must remain separate for share
isolation. Their different metros added network latency to the dependent A/B
rounds of every Yao ceremony.

The `apac` value is only a broad creation hint. It cannot select Tokyo or
guarantee that related databases share a metro. A successful provisioning run
therefore does not establish correct placement. For each new or replacement
Deriver database, execute a remote primary query and inspect the returned
metadata:

```sh
pnpm exec wrangler d1 execute <database-name> \
  --remote \
  --json \
  --command "SELECT 1 AS ready"
```

Require `meta.served_by_primary` to be `true`. The two
`meta.served_by_colo` values must match before activating the databases. If they
do not match, create a replacement and verify it while it is still empty.
[Cloudflare's D1 data location documentation](https://developers.cloudflare.com/d1/configuration/data-location/)
describes location hints as best effort.

On 2026-09-23, both production-testnet databases were migrated to verified
Tokyo (`NRT`) primaries. Both Deriver Workers now target
`aws:ap-northeast-1` in `deployment/wallet-system/targets.json`. The Worker
placement follows the verified database metro; changing Worker placement alone
does not relocate D1. [PR 41](https://github.com/seams-tech/seams-monorepo/pull/41)
records the committed placement change.

The live migration used this sequence:

1. Create candidate D1 databases and use the remote query above to verify both
   candidates report `NRT`.
2. Keep the existing Deriver databases active and export them to protected
   temporary storage.
3. Import each export into its role-matched replacement and verify migrations
   and application row counts.
4. Deploy each Deriver with the replacement database ID and
   `aws:ap-northeast-1` placement.
5. Update the production-testnet GitHub environment variables
   `ROUTER_AB_DERIVER_A_PRIVATE_D1_ID` and
   `ROUTER_AB_DERIVER_B_PRIVATE_D1_ID`, plus the protected local deployment
   values.
6. Export the old databases again and compare normalized snapshots with the
   pre-cutover exports. The snapshots matched, confirming that no concurrent
   writes were omitted.
7. Confirm the active Worker versions, D1 bindings, placement, and public
   health. Retain the former databases until ceremony benchmarks and rollback
   confidence are complete.

[Custom Regions](https://blog.cloudflare.com/custom-regions/) does not solve
this D1 placement problem. It controls eligible traffic processing and Worker
execution in a chosen region; D1 primary placement remains governed by D1's
separate location system.
