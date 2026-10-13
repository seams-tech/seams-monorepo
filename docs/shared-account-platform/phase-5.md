# Phase 5: interface, migration rehearsal, and cutover

Status: interface and local migration rehearsal implemented and validated.
Production cutover remains pending. No production schema or service writer changed.
The source changes remain on `dev` in both repositories.

## Changed files and behaviour

The Console adds `/dashboard/services` as an account route.
It requires a platform project and works without a Wallet environment.
The existing project services API returns its configured service catalog and current instances.
Provisioning adapters supply the service links from their existing deployment configuration.
Wallet links to its Console operations. Satyr links to its native portal.
An unconfigured service shows its unavailable connection and cannot activate.

The page shows activation, active, disabled, failed, and archived states.
A pending shutdown remains distinct from a confirmed native shutdown.
Owner and authorised administrator actions use the existing provisioning command API.
The browser retains the operation ID and desired revision before submission.
A lost reply or browser reload resumes the original pending command.
Failed commands retry their original action at a new desired revision.
Archive requires a disabled instance and an explicit confirmation.
The archived binding remains permanent.

The generic client replaces `products/wallet/consoleWalletServiceApi.ts`.
`WalletServiceGate` uses the same client and preserves its existing setup flow.
The boundary validates the service, project, payer scope, revision, and applied receipt.
Type fixtures reject active enable operations and mixed shutdown states.
Billing already supplies project, service, and meter totals from Phase 3.
The services page links to those consolidated costs.

The existing Console environment pipeline now carries the complete Satyr connection.
Its protected values file supplies the fifteen fields documented in
`deployment/console/env/deployment-values.example.env`.
A partial group fails before the secrets file can be written.
No second configuration file or billing deployment was introduced.

Seams repository validation publishes the built acceptance Worker after its checks and account journeys pass.
Satyr CI checks out one exact commit from the public Seams repository.
It installs the locked dependencies and builds the same Worker in a separate checkout.
Native journeys consume only the built artifact and record its SHA-256 digest.
This path needs no additional access token or repository variables.

## Live snapshot rehearsal

Read-only captures used the actual Worker-bound databases:

| Source | Database ID | Source schema | Rehearsed result |
| --- | --- | --- | --- |
| Seams staging | `802fa155-b740-4fc5-87fa-3c30e864d1f5` | Through `0091` | Baseline `0092`, five account migrations, one Wallet binding |
| Seams production | `b928549b-8cd8-41db-9e66-36e95afbe295` | Through `0046` | Remaining baseline migrations, five account migrations, one Wallet binding |
| Seams testnet | `204147dd-23a6-43b7-9f40-d4f96eb986f2` | Through `0046` | Remaining baseline migrations, five account migrations, three Wallet bindings |
| Satyr global | `9c1e5467-2985-4ca9-8cb0-3b3b933249ef` | Current deployed schema | Shared binding, identity, receipt, and automation tables |
| Satyr APAC | `fe8a597e-b094-4229-8a70-139fa239c168` | Current deployed schema | Native role rename and shared acceptance metadata |

All five local clones migrated, restarted, and restored successfully.
All foreign keys pass after migration and restore.
Wallet attachment records the existing native state without creating environments or rotating credentials.
The rehearsal preserves source organisation, project, environment, membership, payment, ledger, refund,
dispute, invoice, and line-item values.
Only the account authorisation version advances when the explicit initial access grant is created.
The native role and person columns remain unchanged.
The rehearsal also compares every retained native table, including private source rows and their search row IDs.
Satyr retains placement cell `production-apac`, placement epoch 1, and its original fence.

The live sources contain no open financial reservations at capture time.
They therefore complement the Phase 3 journey with historical holds, refunds, disputes, and negative balances.
That journey proves migration and terminal reconciliation for those financial states.
The native Phase 4 journey proves accepted execution recovery and settlement after revocation.
A restored database must replay subsequent durable events before admission can resume.
The local snapshot restore above intentionally stops before new external writes.

D1 export rejects the regional Satyr database because it contains FTS5 search tables.
The read-only logical copy retains ordinary rows, virtual rows, row IDs, schema, and foreign keys.
It encodes text through hexadecimal SQL values to preserve zero bytes in native source keys.
Search rows and their source row IDs retain their original relationship.
This copy supports local rehearsal. A production restore uses a fresh D1 Time Travel bookmark after the cohort pause.
Cloudflare documents the [export limitation](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
and [Time Travel procedure](https://developers.cloudflare.com/d1/reference/time-travel/).

Satyr's role rename explicitly requires `PRAGMA legacy_alter_table = OFF`.
This rewrites foreign keys that name the retired membership table.
D1 documents this [rename behaviour](https://developers.cloudflare.com/d1/sql-api/sql-statements/).
Apply each patch through recorded migrations, with its receipt and DDL in one transaction.
Use Wrangler's existing `d1_migrations` boundary.
A matching retry reads the receipt and verifies the resulting schema.
Do not replay raw `ALTER TABLE` statements after an uncertain acknowledgement.

Private SQL captures and local database files remain outside the repository under the existing backup directory.
The public evidence contains counts and digests, with no credentials or private source content.

## Validation

```sh
pnpm check
pnpm -C tests type-check:console
pnpm -C apps/wallet-console build
pnpm -C tests exec playwright test -c playwright.config.ts 'e2e/console/shared-account-.*\.e2e\.test\.ts' e2e/console/shared-wallet-settlement.e2e.test.ts --reporter=line
SHARED_ACCOUNT_MIGRATION_SNAPSHOTS=/absolute/private/snapshot-directory pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-live-restore.migration.test.ts --reporter=line
```

The snapshot directory supplies `seams-staging.sqlite`, `seams-production.sqlite`,
`seams-testnet.sqlite`, `satyr-control.sqlite`, and `satyr-apac.sqlite` from the reviewed capture.
The test creates isolated migrated and restored copies beside those protected files.
It never opens a remote database for writes.

The browser journey uses the production Console UI, real account router, D1 services, and Wallet provisioner.
Its fixture supplies an owner session and a deliberate lost reply after durable acceptance.
It verifies the same activation operation on retry, reload recovery, the Wallet link, disable,
explicit archive confirmation, and the final archived state.
Native Satyr access and money checks remain the separate two-service journey from Phase 4.

Evidence:

- `.artifacts/shared-account-platform/restore/report.json`: per-table preservation hashes and migration receipts.
- `.artifacts/shared-account-platform/phase-5-source-restore.json`: four SQL snapshot restores and foreign-key checks.
- `.artifacts/shared-account-platform/phase-5-satyr-regional-restore.json`: regional logical restore, including search tables.
- `.artifacts/shared-account-platform/phase-5-satyr-time-travel.json`: read-only regional recovery bookmark.
- `output/playwright/shared-account-services/`: browser fixture source, command replay, report, screenshot, and trace.
- `.artifacts/shared-account-platform/phase-5-*.log`: actual checks and builds.

## Production cohort procedure

The production workflow permits only `main`.
Repository instructions require implementation commits on `dev`.
Promotion and the maintenance window must therefore be resolved before production dispatch.
The production source baseline also trails staging by several Wallet migrations.
The clone rehearsal validates their data transforms, while release checks must validate their deployed runtime composition.

Use one bounded organisation cohort and one authoritative writer for each transition.
Keep existing Seams organisations separate from the imported Satyr organisation.
The common verified Google subject does not merge their payers or tenants.
The imported native Satyr owner requires an explicit provider-subject mapping and audited source evidence.
Native roles become service projections only after the account membership and instance grant exist.
Never derive ownership from the email alone.

1. Resolve the current Worker versions, D1 bindings, namespaces, and verified owner mappings again.
   Reject any difference from the reviewed cohort mapping until its checkpoints are refreshed.
2. Pause affected account mutations and all service admission for that cohort.
   Verify the pause through the actual ingress paths, including Slack, automation, Wallet credentials, and native control requests.
   Code Mode's existing freeze covers scripts only. It cannot establish a complete Satyr admission pause.
3. Drain pre-cutover native turns that lack the new financial admission journal.
   Record accepted unresolved work and durable callbacks before any schema change.
   Preserve payment callbacks and usage producers throughout the pause.
4. Capture fresh database recovery bookmarks and private snapshots after the pause.
   Record owner, membership, identity, placement, signing, ledger, reservation, and provider-reference checkpoints.
5. Apply the reviewed baseline and feature migrations through their recorded transaction boundary.
   Attach each existing Wallet project with its unchanged native namespace and project ID.
   Apply global and regional Satyr patches through recorded migrations.
   Reconcile source counts, digests, foreign keys, owner mappings, ledger totals, and holds before any new admission.
6. Provision the production connection with separate user-assertion and owner-proof keys.
   Configure both service bearers and the native Google audience through the existing protected environment pipelines.
   Keep all production organisations outside `billing_isolated_test_accounts`.
7. Import the reviewed Satyr account as a separate payer and platform project.
   Deliver the exact authenticated attachment command and acknowledge its immutable native binding.
   Preserve native role, person, project, source, history, placement, and lifecycle state.
8. Deploy the paired account and service release while the cohort remains paused.
   Confirm one writer for account membership, one writer for money, and native service projections only.
   Remove all prior independent invitation or auto-accept writers with the replacement release.
9. Replay retained callbacks and terminal usage with their original identifiers.
   Reconcile every hold and receipt. Preserve unresolved holds without a timer-based release.
   Test allowed and denied access through the production ingress before resuming admission.
10. Record the final authority revision and release the cohort pause.
    Capture production reconciliation and billing evidence before starting another cohort.
    Remove the temporary mapping runner after cohort closure.

Before new writes, restore the paused cohort's snapshots if reconciliation fails.
After new writes, retain those events and use forward repair or a reconciled restore.
A blind restore can erase charges, refunds, access revocations, or accepted executions.
Current production cutover evidence remains absent until these steps run against the live cohort.

The read-only production preflight authenticated the existing native owner and administration credential.
All six registered sessions report sleeping state, no pending work, and ready quiescence.
This observation does not freeze admission. Repeat it within the actual cohort pause.
Separate signing key pairs and service bearers are prepared in the protected backup directory.
Their public fingerprints and origin checks are in `phase-5-connection-preflight.json`.
No production secret changed during this preparation.
