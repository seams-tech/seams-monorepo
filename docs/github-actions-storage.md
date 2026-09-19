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
The combined cleanup reclaimed 2,610,443,207 bytes; listed unexpired artifacts
across both repositories now total 483,617,940 bytes (about 461 MiB).

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

The workflow changes require merging in their respective repositories before
they affect new runs. Validate them with `actionlint` and the focused deployment
command tests. A subsequent private artifact upload is the verification of quota
recovery, rather than a cache-backed deployment.

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
