# Phase 5: interface, migration rehearsal, and cutover

Status: interface, migration rehearsal, and staging cutover completed.
The request-path regression found after cutover is fixed and deployed.
Hosted Console traces confirm recovery to the pre-feature baseline; broader Wallet rollout remains separate.
Production cutover is deferred by the user. No production schema or service writer changed.
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

The shared service API uses `/account-platform/v1/*` on the existing Console origin.
The Console route renderer publishes that path beside `/console/*`.
Console deployments disable their `workers.dev` addresses.
The prepared Satyr connection therefore uses `https://wallet.seams.sh` for the account authority.

Seams repository validation publishes the built acceptance Worker after its checks and account journeys pass.
Satyr CI checks out one exact commit from the public Seams repository.
It installs the locked dependencies and builds the same Worker in a separate checkout.
Native journeys consume only the built artifact and record its SHA-256 digest.
This path needs no additional access token or repository variables.

## Staging cutover

Staging resumed admission on October 13, 2026, at 22:04 JST.
The cohort contains one existing organisation, one project, and one active Wallet instance.
Its native namespace is `seams-staging`; its project remains `proj_mv5fzezy_4ztf60`.

The cutover paused new admission, captured a fresh D1 recovery bookmark and snapshot,
and restored that snapshot locally before applying migrations `0092` through `0097`.
The attachment operation was replayed successfully against the same existing Wallet project.
Reconciliation checked 98 source tables and found no foreign-key violations.
Existing owner membership, environments, credentials, and retained financial rows matched their source checkpoints.
The initial instance grant advanced the account authorisation revision.

Console version `6f366df9-79c3-4ef0-b739-e66a75e7c21f` replaced `bc4dfcaf-9a56-474b-a73d-54805138b76c`.
The Worker retained all 43 bindings and its Singapore placement.
The temporary pause entrypoint was removed before admission resumed.
The frontend deployment is `897b6629.seams-wallet-site-staging.pages.dev`, also served at `staging.wallet.seams.sh`.
Wallet backend and SDK versions remained `0.9.4` during this cutover.

The actual Google owner signed in and opened the deployed services page.
Owner access passed; an invalid session returned 401 and a foreign organisation returned 403.
An unsigned Stripe callback returned `invalid_stripe_signature`.
Staging has no Satyr connection, so its service page correctly prevents Satyr activation.
The native two-service journeys remain separate evidence from the live staging cohort.

Evidence is retained in `.artifacts/shared-account-platform/phase-5-staging-*.json` and matching logs.
The deployed services screenshot is `output/playwright/shared-account-services/staging-services.png`.
Private snapshots, recovery metadata, and the original Worker modules remain in the protected backup directory.

The post-cutover performance investigation found 16 serial schema-initialisation calls during request handler construction.
Commit `32e8bc47` makes billing respect the existing `ensureSchema: false` setting.
The fix passes repository checks and all ten account journeys, including a migrated-runtime schema prohibition.
CI run `38412078041` also passed.
The schema and request-path fixes deployed together at 23:38 JST in Console version
`3580ab34-1102-46a9-9feb-86ce042ea67f`, from source `00eaecb6`.
The publication preserved all 43 bindings and Singapore placement. Wallet remained at `0.9.4`.
Hosted Console verification is recorded below; source checks alone do not establish recovered latency.
The credential fix folds service admission into the existing indexed credential lookup.
Environment resolution uses one indexed query across projects.
The production Worker E2E records four D1 calls and five statements for setup, matching the pre-feature baseline.
Provisioning and monthly-usage retries run from the scheduler instead of request construction.
The ten shared-account journeys pass with these changes.
Hosted timing remains the release gate; matching query counts alone does not establish recovered latency.
The first repaired run completed 30 Japan-entry registrations and verified first signatures.
Its respond median was 341 ms, below the affected 650 ms but above the afternoon baseline of 226 ms.
Its post-passkey median was 2,458 ms; custody and finalization were also slower than the afternoon run.
This run therefore does not close the latency gate.
Console CI subsequently deployed the same commit as `d3e6f3f8-5944-4fa9-8a6c-d3d071507be9`;
the evidence separates both serving versions. Bindings and placement remained identical.
Evidence: `.artifacts/r155h-singapore-anchor/shared-account-astra-fixed-094/console-latency.json`.

Commit `2a443822` dispatches the internal active-lineage operation before full Console construction.
The extracted handler keeps one copy of the existing wire parser and resolver.
The Worker E2E covers missing and conflicting lineage, invalid method/body/origin, and unavailable Console configuration.
It records one D1 call with two statements for successful lookup, and no calls for rejected requests.
Repository checks and the Console build passed.
Console version `607a3d66-18f4-46a3-b490-035bde05634a` deployed this change at 23:45 JST.
Bindings and placement stayed unchanged. The attempted repeat run encountered `EADDRINUSE` on the local harness port.
It completed no wallets and supplies no valid end-to-end comparison.

The separate ongoing `pre0100-094-c` run supplies confirmation without competing for its local harness.
Its first-fix version `d3e6f3f8` records 29 lineage spans: median 24 ms wall time and 8 ms CPU.
The pre-feature baseline records 25.5 ms wall time and 7 ms CPU over 98 spans.
This confirms recovery of the demonstrated Console request-path regression.
The direct-lineage follow-up also serves successfully; its initial four spans have median 18 ms wall time and 5 ms CPU.
These are interim server spans, not a claim that every end-to-end stage has identical latency.
Evidence: `.artifacts/shared-account-platform/respond-claude-confirmation.json`.

## Live snapshot rehearsal

Read-only captures used the actual Worker-bound databases:

| Source           | Database ID                            | Source schema           | Rehearsed result                                                              |
| ---------------- | -------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| Seams staging    | `802fa155-b740-4fc5-87fa-3c30e864d1f5` | Through `0091`          | Baseline `0092`, five account migrations, one Wallet binding                  |
| Seams production | `b928549b-8cd8-41db-9e66-36e95afbe295` | Through `0046`          | Remaining baseline migrations, five account migrations, one Wallet binding    |
| Seams testnet    | `204147dd-23a6-43b7-9f40-d4f96eb986f2` | Through `0046`          | Remaining baseline migrations, five account migrations, three Wallet bindings |
| Satyr global     | `9c1e5467-2985-4ca9-8cb0-3b3b933249ef` | Current deployed schema | Shared binding, identity, receipt, and automation tables                      |
| Satyr APAC       | `fe8a597e-b094-4229-8a70-139fa239c168` | Current deployed schema | Native role rename and shared acceptance metadata                             |

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

On 2026-10-13, the user scoped this task to shared-account staging.
The separate production Wallet rollout remains outside this task.
Production shared-account cutover requires that rollout first.

The production workflow permits only `main`.
Repository instructions require implementation commits on `dev`.
Promotion and the maintenance window must therefore be resolved before production dispatch.
Release checks must validate the deployed runtime composition and migrations.

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
