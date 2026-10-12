# R155F staging review and deployment preparation

Date: October 12, 2026, Asia/Tokyo.
Status: deployed and activated on staging; fresh NEAR registration and signing verified.
The preparation below preceded the deployment record at the end of this document.

## Reviewed candidate

- Public `dev` / `main`: `31f41eb9`, prepared as 0.9.1. Public validation passed.
- Private backend build source: `bc5a42b`, using exact published Wallet packages 0.9.0.
- Private review tip: `ad869fd`. Its changes after `bc5a42b` affect tests only.
  The Console E2E passed again on this tip.
- The 0.9.1 public change restores two frontend build entries. Wallet-server
  source and custody code are unchanged from 0.9.0; only its package version changes.
  The separate 0.9.1 publication was running when this preparation was recorded.

The review covered R155F registration snapshots, deterministic setup retries,
immutable lifecycle decisions, wallet/session commits, Console transaction guards,
and deployment integration. No blocking defect was found in those reviewed paths.
This is not a new audit of every change included in the 0.9.x release.

## Verification

- Both existing backend build commands pass for `staging-testnet`:
  `wallet-system` and `console`. Wrangler ran in dry-run mode.
- Thirteen output files have recorded hashes: Console, Gateway and Runtime
  bundles, plus the entry and WASM for each of five custody components.
- `relayer/console-service-auth.e2e.test.ts` passes on the current private tip.
  Its evidence verifies one-call registration mutations, exact replay, rejection
  of retired writers without partial writes, and an empty transaction-guard table.
- Existing R155F evidence covers the combined public and composed registration
  scenarios and the hosted comparison. Those suites were not all repeated here.
- Read-only Cloudflare inspection found all 14 serving versions unchanged from
  Claude's final snapshot. None of the five excluded versions below is serving.

Local evidence is in `.artifacts/r155f-staging-review-20261012/`:
`build-evidence.json`, the two build logs, `console-service-auth-evidence.json`,
`live-staging-readback.json`, and `live-d1-readback.json`.

## Recovered staging keys

The live custody keys exist outside the repositories in:
`~/.seams/backups/staging-r152-regenerated-20261004-v3.json`.
Role-specific backups in the same directory also contain the matching encryption keys.

All ten X25519 encryption keys reproduce the serving public keys. The two Deriver
creation signing seeds and the control-plane issuer seed also reproduce the
serving verification keys. The existing deployment validators accept those three
signing seeds with the live keysets. No key regeneration is required.

GitHub staging variables still describe a different custody key set. The prepared
`github-staging-key-update-plan.json` lists **13 secret updates and 29 public-variable
updates** across six staging environments. It contains secret names and references
to the protected backup, never secret values. Gateway key variables come from the
verified role keys because the serving Gateway embeds its configuration.

Apply only the selected custody values. The historical manifest contains old
deployment settings and must not be uploaded wholesale. Preserve current database
IDs, placement, unrelated secrets, and the current configuration format. Opaque
shared-service and session secrets cannot be compared through Cloudflare readback;
this key check does not establish their values. Retired peer-signing keys are excluded.

## Database and version constraints

All packaged Console, regional Gateway, and Signing Worker migrations are applied.
Console migration `0091_console_deployment_write_checks.sql` is present and its
guard table has zero rows. Both Deriver databases still need
`0019_wallet_object_addresses.sql`, which renames `pair_object_name` to `pair_object_id`.
Coordinate that schema change with the role upgrade and staging wallet-discard scope.

The five custody Workers currently serve their latest uploads. Console and the
eight Gateway/Runtime Workers do not. Any secret-write operation must account for
that state; a comparison upload is not evidence of what is serving.

Never deploy these known wrong-key versions:
`a748af0b`, `e05b2a4b`, `cf939b37`, `dbf17a5b`, `7af2271e`.
Do not run historical comparison restorers after the real deployment. A rollback
must pair a compatible Worker version with its schema and current database bindings.

## Deployment sequence

1. Recheck the source revisions and serving versions. Apply the prepared staging
   key updates, preserving unrelated configuration. Verify public values afterward.
2. Finish the separate 0.9.1 publication and private dependency-pin update if deploying
   the frontend too. The prepared 0.9.0 backend builds successfully; the 0.9.0
   frontend lacks two modules. Rebuild if the selected revision or lockfile changes.
3. Capture current rollback state. Use the existing Console and staging backend
   workflows in their defined order. Apply the two Deriver migrations with the
   custody upgrade. Temporary staging unavailability is expected during activation.
4. Activate the existing staging tenant. Verify fresh NEAR registration, an
   independently checked first signature, regional routing, and exact retry.
   Record the actual serving versions and database bindings after activation.

## Deployment and acceptance — October 12

The verified custody values were synchronized: 13 GitHub secrets and 29 public
variables across six staging environments. All deployed public key bindings match
the verified set. Unrelated secrets and database IDs were preserved.

The coordinated backend uses private revision `bc5a42b` and published Wallet
packages **0.9.0**. The 0.9.1 packaging release completed separately. No frontend
or production deployment was performed here.

- [Console deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/38207543434): passed.
- [Backend deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/38207556313):
  all components deployed. Its final readiness check failed before tenant activation
  because the Gateway returned `tenant_deployment_unavailable`.
- [Tenant activation](https://github.com/seams-tech/seams-monorepo/actions/runs/38208005317):
  passed, including the subsequent readiness check.
- All 14 Workers serve their new versions. Both Deriver databases contain migration
  `0019_wallet_object_addresses.sql`. Every database binding retains its prior ID.
- Three fresh NEAR-only implicit wallets registered and signed without funding.
  Independent Node Ed25519 verification accepted all three NEP-413 signatures.
  Changes to the message, recipient, nonce or callback URL invalidated each signature.

| Acceptance workload, three wallets | Median | Range |
| --- | ---: | ---: |
| Registration, including automation | 5.399 s | 5.349–6.189 s |
| Registration to verified signature, including automation | 6.862 s | 6.820–8.453 s |

These are deployment acceptance samples, without a discarded warm-up or control.
They do not establish a performance gain or regression. R155G owns the next controlled
comparison. The current built SDK uses the 0.9.2 packaging candidate and the same wire
protocol. Browser assets were served locally under staging origins. An initial attempt
with an older frozen SDK failed at setup with `wallet_protocol_mismatch`; that attempt
created no wallet and is excluded from the timings.

Evidence: `.artifacts/r155f-staging-deploy-20261012/`. It includes the configuration
update journal, before/after Worker versions and bindings, migration readback, workflow
results, browser artifacts, independent proof verifier and `acceptance-summary.json`.
The deployed state replaces the old comparison restore targets. Do not run old restore drivers.
