# Phase 2: account composition and service lifecycle

Status: implemented and validated. Production schema deployment and cohort cutover remain pending.

## Current implementation boundary

The first change adds durable billing identities and service provisioning to the shared
Console package. It affects these files:

- `packages/console-shared-ts/src/accountPlatform/instances.ts`: validated provisioning commands and receipts.
- `packages/console-server-ts/src/accountPlatform/schema.ts`: account bindings, instances, operations, and receipts.
- `packages/console-server-ts/src/accountPlatform/d1.ts`: transactional state changes and delivery recovery.
- `packages/console-server-ts/src/accountPlatform/types.ts`: persisted instance and delivery results.
- `tests/e2e/console/shared-account-instances.e2e.test.ts`: concurrent commands, restart, stale receipts, and isolation evidence.

New tables identify each organisation's billing account, bind projects, preserve typed
Wallet and Satyr tenant scopes, and retain provisioning commands and acknowledgements.
Existing ledger accounts retain their chart-of-accounts meaning.
The new billing identity does not replace or copy ledger entries.

Existing organisation membership authorises account administration. The mutation transaction
must reject a membership or authorisation revision that changed after the access check.
Platform membership alone does not grant access to Satyr content.

## Account composition

`packages/console-server-ts/src/router/cloudflare/` owns the account router, D1 composition,
and shared account, membership, project, audit, and billing handlers.
`createCloudflareD1AccountServiceBundle` builds these services from account D1 storage.
`createAccountConsoleRouter` requires account authentication, sessions, services, and readiness.
It needs no Wallet runtime, Wallet environment service, or Wallet credentials.

The Wallet Cloudflare router mounts these same handlers and adds Wallet routes.
It no longer contains a second implementation of account onboarding or billing endpoints.
Wallet billing callbacks supply product history and telemetry through typed ports.
The existing production Worker composes the shared account services with Wallet services.
It resumes pending provisioning through service authority after construction.

The core route table owns service management:

- `GET /console/projects/:projectId/services` lists visible instances.
- `POST /console/projects/:projectId/services/:serviceId/enable` requests activation.
- `POST /console/projects/:projectId/services/:serviceId/disable` denies new admission.
- `POST /console/projects/:projectId/services/:serviceId/archive` requests final shutdown.

Change requests contain only `operationId` and `desiredRevision`.
The server resolves the payer, scope, deployment, binding, and service configuration.
The Console ingress does not accept native tenant claims or attachment evidence.
Attachment belongs to the reviewed migration boundary.

## Persistence and provisioning

Core migration `0004_account_platform.sql` and Wallet migration `0093_account_platform.sql`
add `organization_billing_accounts`, `project_billing_bindings`, `platform_service_instances`,
`wallet_service_bindings`, `satyr_service_bindings`, `platform_provision_operations`, and
`platform_provision_receipts`.
Each organisation has one payer. Each project has one immutable payer binding.
Each project permits one instance per service.
Native binding uniqueness follows each service's complete native scope.
Archived instances retain their bindings and financial attribution.

A command transaction checks current account authority, persists the immutable command,
and advances the instance's desired revision together.
The operations table also serves as the durable delivery outbox.
Matching retries reuse the operation. Changed contents conflict.
The receipt transaction records the final binding, receipt, disposition, and observed state.
An old receipt remains auditable. It cannot advance the latest desired state.
Receipt replay retains its original `applied` or `stale` disposition.

Wallet availability changes check the same platform scope and desired revision inside D1.
Delayed activation cannot change environments after a newer disable command.
Native credential admission reads the current binding and active account/project/instance state.
Both secret keys and publishable keys lose admission immediately after desired disable.
This check also applies to native project/environment resolution.
An unbound native scope fails admission. There is no runtime compatibility bypass.

Existing source projects must receive their explicit bindings before deploying this admission change.
The production cutover procedure in the feature plan owns that transition.
Source schema history remains at the persistence boundary until cohort migration closes.
Historical baseline SQL can contain retired Wallet tables. The new account runtime creates no Wallet resources.

## Wallet environment and credential ownership

`packages/wallet-console-server-ts/src/environments/` owns environment types, persistence,
default provisioning, availability, request parsing, and Wallet billing readiness.
Generic `ConsoleOrgProjectService.createProject` creates a platform project only.
The Wallet adapter provisions development, staging, and production environments during activation.
The positive prepaid balance gate still controls live environments.

Native environment IDs and stored `runtime_version` values remain unchanged.
The Wallet domain names that value `signingRootVersion`.
The Wallet route boundary preserves the existing `runtimeVersion` wire field.
Provisioning reuses native project/key rows and preserves archived environments.
Explicit native bindings also support platform and native project IDs that differ.

Environment credentials moved from `console-server-ts/src/apiKeys/` into
`wallet-console-server-ts/src/apiKeys/`.
Their stored rows, secret formats, scopes, rotation rules, and origin restrictions remain unchanged.
Wallet request headers carry the selected project and environment.
Account sessions carry account membership and project visibility.
The account environment-selection endpoint and its session fields were removed.

Wallet attachment evidence identifies the existing native project and the digest of its immutable identity.
`walletProjectAttachmentEvidence` creates that evidence from the native project record.
The adapter checks it against the owning source before applying an attachment.
The migration operator supplies the reviewed principal and account mapping separately.

## Interface

Account onboarding and settings no longer depend on Wallet readiness.
The project interface offers explicit Wallet activation.
An uncertain activation response retains the same operation ID and revision for retry.
The UI requires a current accepted receipt and matching selected organisation/project scope.
A foreign instance cannot mount a Wallet page.
Wallet environment selection remains local product context and appears on Wallet request headers.

The UI boundary journey uses real account-router fixture responses and the production state builders.
It verifies uncertain delivery, matching retry, native environment selection, and foreign scope rejection.
Its browser trace is `output/playwright/shared-account-ui-trace.zip`.
The report, screenshots, and replay scripts use the `shared-account-*` names in that directory.

## Account onboarding and deletion

Account onboarding requires an organisation and an active platform project.
The account state, organisation list, context switch, and session response carry no Wallet environment.
The onboarding service reads no API keys, Wallet environments, or live-environment billing readiness.
Wallet composition owns those operational checks.
The onboarding state uses `currentStep` to distinguish the organisation, project, and complete states.
A complete state requires both the organisation and the selected project.

The existing `organization_memberships_last_owner_delete` trigger blocked deletion of an empty organisation.
Its final-owner check also ran during the organisation's membership cascade.
Forward migrations `0003_organization_deletion.sql` and `0092_organization_deletion.sql` restrict this check to a parent organisation that still exists.
Direct removal of the final owner remains prohibited.
An empty organisation can disappear with its owner membership in one transaction.

D1 account deletion removes empty project billing bindings, the organisation billing identity, billing configuration, and the organisation in one batch.
Existing foreign-key cascades remove projects and memberships.
The transaction requires the same owner and authority revision used by the access check.
Database triggers preserve billing history and other current members during concurrent changes.
The Wallet migration also preserves wallet inventory and reservation history.
Service bindings remain protected by the platform's deletion guard and foreign keys.

The account onboarding journey uses two organisations, three projects, and an invited member.
It verifies project-restricted authentication, context switching, durable restart, member revocation, and foreign-organisation denial.
It also verifies that account onboarding creates zero Wallet environments and zero API keys.
Evidence is written to `.artifacts/shared-account-platform/onboarding/`.
Run it with `pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-onboarding.e2e.test.ts --reporter=line`.

The same HTTP journey found an existing suspension response defect.
D1 trigger effects inflated `meta.changes`, causing a successful suspension to report failure.
Suspension now uses `UPDATE ... RETURNING id` as its transaction receipt.
Concurrent suspension returns one success and one conflict.
The suspended member's stale session immediately receives 403.

## Validation and evidence

The complete shared-account batch passed: six persistence and HTTP E2E journeys, 30.3 seconds.
The retained Console service-binding journey and Wallet activation journey also passed together.
The Wallet environment and activation journeys passed again after readiness moved into Wallet.
`pnpm check` passed, including type fixtures, import boundaries, and 53 script tests with one skip.
Core package, Wallet package, and Console application builds passed.
The application build retains its existing chunk-size warning.

Commands:

```sh
pnpm -C tests exec playwright test -c playwright.config.ts 'e2e/console/shared-account-.*\.e2e\.test\.ts' --reporter=line
pnpm check
pnpm -C packages/console-server-ts build
pnpm -C packages/wallet-console-server-ts build
pnpm -C apps/wallet-console build
```

Local Miniflare and offline HTTP test servers need local socket permission.
Sandboxed runs failed with `listen EPERM`. The same checks passed with that permission.
No production deployment occurred during these tests.

Evidence directories under `.artifacts/shared-account-platform/` are `instances`, `onboarding`,
`account-router`, `wallet-environments`, `wallet-activation`, and `rehearsal`.
They contain machine-readable reports and before/after persistence evidence.
The account-router journey also exports a purchase receipt PDF and its digest.
The migration rehearsal retains its billing statement and signed balance/hold reconciliation.

Phase 3 must replace caller-supplied reservation balances, prevent timer-only hold release,
generalise attributed usage, and unify settlement. Phase 4 must connect Satyr's runtime and grants.
Phase 5 must apply and reconcile bounded production cohorts before activating the new writer.
