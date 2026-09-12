# Refactor 105 Phase 0: Historical Ownership Inventory

Date frozen: August 18, 2026

Current addenda reconciled: September 12, 2026

Status: historical snapshot. It records the pre-closeout classification and is
not an extraction manifest or evidence that the current tree satisfies the
Refactor 105 boundary. Refactor 105B Phase 0 must regenerate and reconcile the
current route, service, schema, test, workflow, and path inventory before it
freezes an extraction reference. The repository destination addendum below is
the current ownership decision.

This is the checked-in ownership matrix required by
[refactor-105-split-console.md](./refactor-105-split-console.md) Phase 0. Every
current route, service, table, migration, scheduled job, environment binding,
UI route, event category, and relevant test is assigned to exactly one owner:

- `console-core` — product-neutral customer control plane;
- `wallet-console` — hosted wallet administration (future
  `wallet-console-shared-ts` / `wallet-console-server-ts`);
- `mpc-admin` — Refactor 99B operator plane (no package or `/admin` Worker
  exists yet; these assignments are forward-looking);
- `composition` — deployed/local wiring that may import both sides.

Items marked `MIXED` carry both core and Wallet vocabulary today; their split
is named inline and executes in Phases 1-2 (contracts/services) or Phase 6
(schema).

## Baseline

- Console D1 baseline: `packages/console-server-ts/migrations/d1-console/0001_console_d1_initial.sql`
  — 49 tables (clean-slate consolidation, August 17).
- Signer D1 baseline: `packages/wallet-server/migrations/d1-signer/0001_signer_d1_initial.sql`
  — 52 tables.
- The legacy inbound-email recovery paths removed by R111 are absent from this
  tree; they are not inventoried. No Refactor 113/114 implementation has
  landed.
- `apps/seams-admin` and `platform-admin-server-ts` (Refactor 99B) do not
  exist yet; the Gateway still serves the routes destined for them.
- Concurrent R103 zero-prompt work is in flight in
  `packages/wallet/src/SeamsWeb/operations/devices/`, `registration.ts`, and
  the linked-device tests. Those files are Wallet-runtime owned and outside
  every boundary this inventory freezes; Phase 0-3 does not touch them.

## Workspace Packages And Applications

| Path                         | Owner        | Notes                                                                                                                                          |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/console-shared-ts` | console-core | MIXED: wallet vocabulary moves to `wallet-console-shared-ts` in Phase 1 (see vocabulary inventory)                                             |
| `packages/console-server-ts` | console-core | MIXED: wallet services move to `wallet-console-server-ts` in Phase 2 (see service inventory)                                                   |
| `packages/wallet`            | wallet       | public `@seams/wallet`; renamed `packages/wallet` in Phase 7                                                                                   |
| `packages/wallet-server`     | wallet       | public `@seams/wallet-server`; renamed `packages/wallet-server` in Phase 7                                                                     |
| `packages/shared-ts`         | wallet       | shared browser/server contracts consumed by the Wallet packages (see shared-ts note)                                                           |
| `apps/seams-site`            | MIXED        | historical state: company marketing + wallet content + demos; Wallet landing and `/dashboard/*` move to `apps/wallet-console`                   |
| `apps/docs`                  | composition  | historical mixed docs host; public Wallet VitePress source moves to `seams-wallet`, while private operational documentation stays private      |
| `crates/*`, `wasm/*`         | wallet       | signer runtime and protocol crates                                                                                                             |

## Console D1 Tables (49)

Owner `wallet-console` tables move with Phase 2 services and get their own
schema section in Phase 6. `MIXED` core tables stay core with their Wallet
vocabulary (CHECK catalogs, enum values) relocated to Wallet Console
validation.

| #   | Table                                   | Owner          | Notes                                                                        |
| --- | --------------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| 1   | `api_keys`                              | console-core   | MIXED: wallet/signing scope CHECK catalog moves to Wallet Console validation |
| 2   | `approvals`                             | wallet-console | wallet approval payloads                                                     |
| 3   | `audit_events`                          | console-core   | MIXED: wallet event vocabulary in payloads/categories                        |
| 4   | `audit_evidence`                        | console-core   | MIXED: wallet evidence details                                               |
| 5   | `billing_accounts`                      | console-core   |                                                                              |
| 6   | `billing_credit_purchases`              | console-core   |                                                                              |
| 7   | `billing_disputes`                      | console-core   |                                                                              |
| 8   | `billing_ledger_entries`                | console-core   | MIXED: wallet usage enums in posting vocabulary                              |
| 9   | `billing_ledger_postings`               | console-core   | MIXED: wallet usage enums                                                    |
| 10  | `billing_monthly_active_resources`      | console-core   | product-neutral active-resource meter                                        |
| 11  | `billing_prepaid_reservation_summaries` | wallet-console | decided in Phase 2: no non-wallet caller; moved with sponsorship             |
| 12  | `billing_prepaid_reservations`          | wallet-console | decided in Phase 2: moved with sponsorship                                   |
| 13  | `billing_refunds`                       | console-core   |                                                                              |
| 14  | `billing_stripe_post_processing_outbox` | console-core   |                                                                              |
| 15  | `console_email_deliveries`              | console-core   |                                                                              |
| 16  | `console_email_outbox`                  | console-core   |                                                                              |
| 17  | `environments`                          | console-core   |                                                                              |
| 18  | `invoice_line_items`                    | console-core   |                                                                              |
| 19  | `invoices`                              | console-core   |                                                                              |
| 20  | `key_exports`                           | wallet-console |                                                                              |
| 21  | `observability_event_dedup`             | console-core   | MIXED: fleet/platform slices move to mpc-admin under R99B                    |
| 22  | `observability_events`                  | console-core   | MIXED: same                                                                  |
| 23  | `observability_ingest_windows`          | console-core   | MIXED: same                                                                  |
| 24  | `observability_request_rollups_minute`  | console-core   | MIXED: same                                                                  |
| 25  | `organization_admin_permissions`        | console-core   |                                                                              |
| 26  | `organization_invitations`              | console-core   |                                                                              |
| 27  | `organization_memberships`              | console-core   |                                                                              |
| 28  | `organization_owner_events`             | console-core   |                                                                              |
| 29  | `organizations`                         | console-core   |                                                                              |
| 30  | `policies`                              | wallet-console |                                                                              |
| 31  | `policy_assignments`                    | wallet-console |                                                                              |
| 32  | `policy_versions`                       | wallet-console |                                                                              |
| 33  | `project_member_access`                 | console-core   |                                                                              |
| 34  | `projects`                              | console-core   |                                                                              |
| 35  | `runtime_snapshot_outbox`               | wallet-console |                                                                              |
| 36  | `runtime_snapshots`                     | wallet-console |                                                                              |
| 37  | `sponsored_call_records`                | wallet-console |                                                                              |
| 38  | `sponsorship_pricing_rules`             | wallet-console |                                                                              |
| 39  | `sponsorship_spend_cap_reservations`    | wallet-console |                                                                              |
| 40  | `sponsorship_spend_cap_windows`         | wallet-console |                                                                              |
| 41  | `stripe_webhook_events`                 | console-core   |                                                                              |
| 42  | `user_backup_emails`                    | console-core   |                                                                              |
| 43  | `user_profiles`                         | console-core   |                                                                              |
| 44  | `wallet_index`                          | wallet-console |                                                                              |
| 45  | `webhook_attempts`                      | console-core   | delivery transport                                                           |
| 46  | `webhook_dead_letters`                  | console-core   | delivery transport                                                           |
| 47  | `webhook_deliveries`                    | console-core   | delivery transport                                                           |
| 48  | `webhook_endpoint_categories`           | console-core   | MIXED: wallet event category catalog moves to Wallet Console validation      |
| 49  | `webhook_endpoints`                     | console-core   |                                                                              |

Wallet Console total: 14 tables (`wallet_index`, `key_exports`, `policies`,
`policy_versions`, `policy_assignments`, `approvals`, `runtime_snapshots`,
`runtime_snapshot_outbox`, four sponsorship tables, `sponsored_call_records`,
and both prepaid-reservation tables per the Phase 2 caller decision). Console
core total: 35, including the generic active-resource billing meter.

Phase 6 cutover (landed): the composed baseline is now
`packages/wallet-console-server-ts/migrations/d1-console/0001_wallet_console_initial.sql`
(core section + wallet section, one owner per section); the fresh Console-core
schema is
`packages/console-server-ts/migrations/d1-console-core/0001_console_core_initial.sql`.
`tests/unit/consoleSchemaOwnership.unit.test.ts` holds both fresh schemas to
exactly these ownership sets. The old `0001_console_d1_initial.sql` is
deleted; both files apply the identical 49-table schema for the single
`wallet-console` D1 retained during R105.

## Signer D1 Tables (52)

All 52 tables in the canonical signer baseline are Wallet runtime ownership
and stay packaged with the Wallet server (`@seams/wallet-server` after Phase
7). Verified against the retired-surface list: the baseline contains no
`app_session`, `authorization_session`, or legacy inbound-email recovery
table. `authorization_wallet_session_quotas`, `opaque_wallet_session_tokens`,
and `verified_owner_proof_consumptions` are current R107 opaque-session state,
not retired surfaces. The `email_otp_*` tables are the current OTP auth
factor; the old inbound-email recovery flow has been deleted.

`authorization_wallet_session_quotas`, `authorized_operation_audit_events`,
`authorized_operations`, `email_otp_auth_states`, `email_otp_challenges`,
`email_otp_grants`, `email_otp_rate_limits`,
`email_otp_registration_attempts`, `email_otp_unlock_challenges`,
`email_otp_wallet_enrollments`, `hosted_wallet_session_exchange_codes`,
`identity_links`, `lane_cas_guard`, `lane_effect_journal`, `lane_enrollments`,
`lane_locks`, `lane_product_epochs`, `lane_protocol_operations`,
`lane_receipts`, `linked_device_custody_transfers`,
`linked_device_owner_auth_bindings`,
`linked_device_owner_planning_snapshots`,
`linked_device_provisioning_records`, `linked_device_request_proof_nonces`,
`linked_device_session_cas_guard`, `linked_device_session_transcripts`,
`linked_device_sessions`, `linked_device_source_handoffs`,
`linked_device_target_commit_reservations`,
`linked_device_target_credentials`,
`linked_device_target_deployment_descriptors`,
`linked_device_wallet_session_authorizations`,
`linked_device_wallet_session_quotas`, `near_public_keys`,
`opaque_wallet_session_tokens`, `registration_ceremony_cas_guard`,
`registration_ceremony_records`, `reusable_wallet_sessions`,
`router_ab_normal_signing_admission_records`,
`router_ab_yao_capability_replacements`,
`router_ab_yao_versioned_json_cas_guard`,
`router_ab_yao_versioned_json_records`, `vault_proxy_secrets`,
`verified_owner_proof_consumptions`,
`verified_wallet_operation_evidence_sets`, `wallet_auth_methods`,
`wallet_ecdsa_pending_session_activations`, `wallet_signers`, `wallets`,
`webauthn_authenticators`, `webauthn_challenges`,
`webauthn_credential_bindings`.

The role-private storage migrations under
`crates/router-ab-cloudflare/migrations/` (deriver-a, deriver-b,
signing-worker) are Wallet runtime ownership and move to the public repository.
After R120 merges, this includes each Deriver's tenant-root role-share and
command-replay migrations.

## Boundary Guard

`tests/scripts/check-console-core-wallet-import-boundaries.mjs`
(`pnpm -C tests run check:console-core-wallet-import-boundaries`, part of
`test:source-guards`) forbids every `@seams/wallet`, `@seams/wallet-server`,
`@seams/wallet`, `@seams/wallet-server`, or relative Wallet-source import in
`packages/console-server-ts/src` and `packages/console-shared-ts/src`, beyond
a temporary allowlist of the 80 inventoried pre-split imports (79 files x
`@seams/wallet-server/cloud-host` x
`@seams/wallet-server/wasm/signer`). Allowlist entries may only be deleted;
stale entries fail the guard. `console-shared-ts` has zero entries and must
stay clean.

## Console Routes And Services

The authoritative route table is
`packages/console-server-ts/src/router/consoleRouteDefinitions.ts` (113
declared routes with RBAC requirements), mirrored 1:1 by the Express router
(`src/router/express/createConsoleRouter.ts`) and the Cloudflare router
(`src/router/cloudflare/createCloudflareConsoleRouter.ts`). Three routes are
undeclared: `/console/healthz`, `/console/readyz`, and the signature-verified
`POST /console/billing/stripe/webhook`.

Route-group ownership:

| Route group                                                                                                                       | Owner                  | Notes                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| session, account, org/project/env, memberships, invitations, onboarding, isolation                                                | console-core           |                                                                                                                                                            |
| api-keys lifecycle                                                                                                                | console-core           | scope catalog values are wallet vocabulary (Phase 1)                                                                                                       |
| audit, audit exports                                                                                                              | console-core           |                                                                                                                                                            |
| webhooks CRUD/deliveries/replay                                                                                                   | console-core           | category catalog is mixed                                                                                                                                  |
| billing overview/invoices/refunds/checkout                                                                                        | console-core           | `GET /console/billing/usage/monthly-active-wallets` is a wallet-console meter                                                                              |
| observability summary/events/timeseries/services                                                                                  | console-core           | tenant-scoped reads                                                                                                                                        |
| wallets, wallets/search, wallets/:id                                                                                              | wallet-console         |                                                                                                                                                            |
| policies (CRUD/versions/assignments/simulate/publish)                                                                             | wallet-console         |                                                                                                                                                            |
| key-exports                                                                                                                       | wallet-console         |                                                                                                                                                            |
| approvals                                                                                                                         | console-core mechanism | current operation types (`POLICY_PUBLISH`, `KEY_EXPORT`) are both wallet-console; payload vocabulary moves, queue mechanism stays                          |
| runtime-snapshots                                                                                                                 | wallet-console         |                                                                                                                                                            |
| insights (`/console/policy/coverage`, `/console/gas/readiness`, `/console/export/governance`)                                     | wallet-console         |                                                                                                                                                            |
| `platform.support` routes (ops-cockpit summary, `/console/platform/billing/*`, usage-event/invoice-generate/adjustment admin ops) | mpc-admin              | leaves customer Console under R99B                                                                                                                         |
| `/console/auth/google`, `/console/auth/github`, `/console/auth/revoke`                                                            | console-core           | currently implemented in the composed worker entrypoint (`d1RouterApiStagingWorker.ts` `HostedConsoleAuthHandler`); moves to the Console Worker in Phase 4 |

Router-API relay routes owned by this package (registered as
`RouterApiRouteExtension`s in `src/router/routeExtensions.ts`, mounted by the
Wallet Gateway): `GET /v1/wallets`, `GET /v1/wallets/search`,
`GET /v1/wallets/:id`, `POST /signed-delegate`,
`POST /sponsorships/evm/call` — all wallet-console.

### Service bag

`ConsoleRouterOptions` (`src/router/console.ts:46`) is the broad optional bag
the plan retires: ~25 service fields, every one optional/nullable, plus a
discriminated tenant-storage pair. Phase 1 replaces it with exact
`createConsoleCoreRouter` / `createWalletConsoleRouter` required-input
compositions.

### Service modules

| Modules (under `packages/console-server-ts/src/`)                                                                                                                                                                                                                                                                                                                              | Owner                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `orgProjectEnv/`, `teamRbac/`, `account/`, `apiKeys/`, `audit/`, `auditExports/`, `email/` (+`otp/`), `webhooks/`, `billing/` (ledger, Stripe, PDF, readiness, adjustments, credit packs), `enterpriseIsolation/`, `onboarding/`, `observability/`, `shared/requestParse.ts`                                                                                                   | console-core                                                                                                                                                                               |
| `wallets/`, `policies/`, `gasSponsorship/`, `sponsorship/`, `sponsorshipSpendCaps/`, `sponsorshipPricing/`, `sponsoredCalls/`, `billingPrepaidReservations/`, `runtimeSnapshots/`, `keyExports/`                                                                                                                                                                               | wallet-console                                                                                                                                                                             |
| `router/routerApiWallets.ts`, `routerApiSignedDelegate.ts`, `routerApiSponsoredEvmCall.ts`, `sponsorshipRuntime.ts`, `sponsorshipExecution.ts`, `sponsorshipBillingEvents.ts`, `sponsorshipSpendCapObservability.ts`, `runtimeSnapshotPayload.ts`, `policyPresentation.ts`, `consoleInsights.ts`, `routerApiKeyAuth.ts`                                                        | wallet-console (routerApiKeyAuth is the CC/WC auth boundary)                                                                                                                               |
| `router/opsCockpitSummary.ts`, `router/platformBilling.ts`                                                                                                                                                                                                                                                                                                                     | mpc-admin                                                                                                                                                                                  |
| `router/console.ts`, `consoleAuth.ts`, `consoleAppSessionAuth.ts`, `consoleSessionContext.ts`, `consoleRouteDefinitions.ts`, `consoleRouteSurface.ts`, `consoleRoutePolicy.ts`, `consoleAuditMetadata.ts`, `consoleObservabilityHooks.ts`, `routeExtensions.ts`, `stripePostProcessing.ts`, both `createC*Router.ts` assemblies, `express-adaptor.ts`, `cloudflare-adaptor.ts` | composition (route/auth mechanism is console-core; wallet route mounting separates in Phase 2)                                                                                             |
| `router/cloudflare/` workers (`d1LocalDevWorker.ts`, `d1RouterApiStagingWorker.ts`, `d1ConsoleStagingWorker.ts`, `d1RouterApiWorker.ts`, `d1ConsoleServices.ts`, `d1StagingSession.ts`, `tenantStorageRoute.ts`, `cloudflareConsole.types.ts`, `cron.ts`)                                                                                                                      | composition (the composed-worker files carry the bulk wallet imports; the console-only staging worker is the Phase 4 Console Worker seed)                                                  |
| `packages/wallet-server/src/router/cloudflare/runtime/routerAbServiceBindings.ts`                                                                                                                                                                                                                                                                                              | wallet; generic typed dispatch between the Wallet Gateway, MPC Router, and Signing Worker                                                                                                  |
| `packages/wallet-server/src/router/cloudflare/runtime/ed25519SessionAdapter.ts`, `sessionAdapterRuntime.ts`                                                                                                                                                                                                                                                                    | wallet; Ed25519 Wallet-session signing and shared JWT/cookie primitives                                                                                                                    |
| `packages/wallet-server/src/router/cloudflare/runtime/cloudflareSignerWasm.ts`                                                                                                                                                                                                                                                                                                 | wallet; signer Wasm module loader used by Wallet Worker compositions                                                                                                                       |
| `packages/wallet-server/src/router/cloudflare/runtime/walletConsoleOps.ts`, `walletConsoleOpsClient.ts`                                                                                                                                                                                                                                                                        | wallet; exact Gateway-side protocol and client for the private Wallet Console service binding                                                                                              |
| `packages/wallet-server/src/router/cloudflare/runtime/walletGateway.ts`                                                                                                                                                                                                                                                                                                        | wallet; Gateway router assembly, normal-signing admission store, and exact Wallet Console relay route/proxy contract                                                                       |
| `packages/wallet-server/src/hosted-wallet-gateway.ts`                                                                                                                                                                                                                                                                                                                          | wallet; complete hosted Gateway composition for auth, sessions, signer D1, Router A/B, tenant roots, recovery/export, and direct Yao operations; provider delivery is injected by the host |
| `packages/wallet-server/src/hosted-wallet-gateway-worker.ts`                                                                                                                                                                                                                                                                                                                   | wallet; provider-neutral deployable Worker entrypoint for the public hosted Gateway composition                                                                                            |
| `packages/wallet-server/src/local-hosted-wallet-gateway-worker.ts`, `router/cloudflare/runtime/staticWalletConsoleBinding.ts`                                                                                                                                                                                                                                                  | wallet; Console-free local Gateway host and fixed deployment registry implementing the exact Wallet Console binding protocol                                                               |
| `packages/wallet-server/src/router/cloudflare/runtime/walletRuntimeOps.ts`, `walletRuntimeOpsHandler.ts`, `walletControlOps.ts`                                                                                                                                                                                                                                                | wallet; exact Console-to-Wallet runtime operations and tenant-root control binding allowlist/dispatcher                                                                                    |
| `packages/wallet-server/src/router/cloudflare/runtime/walletConsoleTenantRootLineage.ts`                                                                                                                                                                                                                                                                                       | wallet; resolves runtime scope through the Console environment/active-lineage binding without Console database access                                                                      |
| `packages/wallet-server/src/router/cloudflare/runtime/routerAbPrewarm.ts`                                                                                                                                                                                                                                                                                                      | wallet; authenticated Gateway-to-Router scheduled prewarm operation and response boundary                                                                                                  |
| `packages/wallet-server/src/router/cloudflare/runtime/tenantRootCreationGrant.ts`                                                                                                                                                                                                                                                                                              | wallet; canonical tenant-root creation grant encoding, signing, and digest primitives used by Console-hosted and self-hosted issuers                                                       |
| `packages/wallet-server/src/router/cloudflare/runtime/environment.ts`                                                                                                                                                                                                                                                                                                          | wallet; generic normalized Worker environment and CSV boundary readers shared by hosted and self-host compositions                                                                         |
| `crates/router-ab-cloudflare/scripts/bootstrap-local-tenant-root.mjs`                                                                                                                                                                                                                                                                                                          | wallet; local-only direct tenant-root bootstrap for the public role-worker stack, with no Console route or database dependency                                                             |

### Scheduled jobs

Factory `createCloudflareCron` (`src/router/cloudflare/cron.ts:430`), wired
into both staging workers' `scheduled` handlers (none locally):

| Job                                                | Owner          |
| -------------------------------------------------- | -------------- |
| `billingMonthlyFinalization` (`billing/d1.ts`)     | console-core   |
| `webhookRetryDispatch` (`webhooks/d1.ts`)          | console-core   |
| `consoleEmailDispatch` (`email/d1.ts`)             | console-core   |
| `runtimeSnapshotOutbox` (`runtimeSnapshots/d1.ts`) | wallet-console |

Inline (non-cron) outbox drain: Stripe post-processing dispatch from the
webhook route in both routers — console-core.

### console_session_v1

Issued by `issueConsoleSession` in `d1RouterApiStagingWorker.ts`, with claims
kind `console_session_v1`; parsed by the private adapter in
`d1StagingSession.ts`, which rejects every other kind and resolves current
RBAC state through `organizationAccess.lookupAuthorization`. Context-switch
re-issuance lives in `consoleSessionContext.ts`. The Ed25519 Wallet-session
signer is now public Wallet runtime; Console HMAC issuance and Console
authorization remain private. Owner: console-core.

### Signer deployment composition

Local and staging D1 composition now lives in
`packages/wallet-console-server-ts`. The generic local `workerd` signer
migration adapter is exposed by `packages/wallet-server`; remote migration,
custody, restore, evidence, and release operations remain private Wallet-system
composition. `packages/console-server-ts` contains no Wallet deployment command
or signer artifact path.

## Gateway Route Surface And Worker Bindings

### Worker entrypoints

| Entrypoint                                            | File (`packages/console-server-ts/src/router/cloudflare/`) | Owner        |
| ----------------------------------------------------- | ---------------------------------------------------------- | ------------ |
| deployed combined gateway                             | `d1RouterApiWorker.ts` (re-export of the staging worker)   | composition  |
| combined gateway impl (`fetch` + `scheduled`)         | `d1RouterApiStagingWorker.ts`                              | composition  |
| local dev combined worker (`fetch` only, no cron)     | `d1LocalDevWorker.ts`                                      | composition  |
| console-only worker (the Phase 4 Console Worker seed) | `d1ConsoleStagingWorker.ts`                                | console-core |

Console dispatch: `dispatchHostedGatewayRequest`
(`d1RouterApiStagingWorker.ts:856`) sends `/console/*` to the console handler
and everything else to the Router API handler. The generic
`/session/exchange` route no longer exists anywhere in source — customer
Console auth is already the exact `POST /console/auth/google`,
`POST /console/auth/github`, `POST /console/auth/revoke` set
(`HostedConsoleAuthHandler`, `d1RouterApiStagingWorker.ts:394-431`),
instantiated in both combined workers. Phase 4 moves those routes to the
Console Worker rather than creating them. Stale `/session/exchange`
references survive only in docs/READMEs/env examples and one dead test
(`tests/unit/cloudflareD1ConsoleServices.unit.test.ts:875-919` expects
routing behavior the local worker no longer has).

### Route namespaces served by the combined gateway

| Namespace                                                                                                                                                                                                                                        | Owner                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `/healthz`, `/readyz`, `/.well-known/*`, `/auth/*`, `/near/public-keys`, `/sync-account/*`, `/wallet/*`, `/wallets/*`, `/webauthn/*`, `/wallet-session/seal/*`, `/router-ab/*`, `/internal/gateway/device-linking/v1/*`, `/relay/*` (local only) | wallet (defined in `packages/wallet-server/src/router/`) |
| `/signed-delegate`, `/v1/wallets*`, `/sponsorships/evm/call` (route extensions mounted into the Router API handler)                                                                                                                              | wallet-console                                           |
| `/console/*` (~75 routes + `/console/auth/*`)                                                                                                                                                                                                    | console (Phase 4: leaves the Gateway)                    |

No `/admin/*` surface exists yet (R99B).

### Combined gateway bindings

Declared in `wrangler.d1-local.toml`, `wrangler.d1-staging-gateway.toml`, and
`scripts/render-d1-gateway-config.mjs`:

| Binding                        | Type                                               | Owner                                      |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------ |
| `CONSOLE_DB`                   | D1 `wallet-console`                                 | console (Phase 4 removes from the Gateway) |
| `SIGNER_DB`                    | D1 `seams-signer`                                  | wallet                                     |
| `MPC_ROUTER`, `SIGNING_WORKER` | service bindings to the private Router A/B Workers | wallet                                     |

No KV. No live Durable Objects on the gateway — `wrangler.d1-staging-gateway.toml`
carries create-then-delete migration tags for `ThresholdStoreDurableObject`
and `RouterApiRuntimeDurableObject` whose source classes still exist in
`sdk-server-ts` (dead-binding freeze candidates). Signer Wasm is not a
wrangler binding; the public Wallet runtime loads its packaged signer module
directly. The only live DO in the system is
`RouterAbSigningWorkerPresignSessionDurableObject` on the wallet-owned
`router-ab-signing-worker`.

Secrets: `CONSOLE_SESSION_HMAC_SECRET`, `STRIPE_API_SK`,
`GITHUB_OAUTH_*`, `STRIPE_WEBHOOK_SECRET` are
console-owned; `ACCOUNT_ID_DERIVATION_SECRET`,
`ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET`, `ROUTER_AB_CEREMONY_JWT_PRIVATE_JWK`,
`LINKED_DEVICE_*`, `RELAYER_PRIVATE_KEY`, `SPONSORED_EVM_EXECUTORS_JSON` are
Wallet-system-owned (`scripts/deployment-targets.mjs`). Console reaches the
declared tenant-root operations through its private `WALLET_RUNTIME` binding
and receives none of those credentials or direct role bindings.

The gateway `scheduled()` handler runs the console email cron
(console-owned; Phase 4 moves it) in parallel with the wallet-owned
Router A/B prewarm poster. The private Router A/B Workers
(`crates/router-ab-cloudflare/`: mpc-router, deriver-a, deriver-b,
signing-worker with their role-private D1s) are wholly wallet-owned.

Stale artifact: the gitignored on-disk
`packages/console-server-ts/.wrangler/generated/gateway.jsonc` declares live
DO bindings and a `SIGNING_ROOT_KEK_PRODUCTION_R1` secrets-store entry that
the current generator no longer emits — untracked, ignore.

## cloud-host Import Inventory

`packages/console-server-ts` imports `@seams/wallet-server` from 81 source files
(235 imports + 9 re-exports). Every specifier is
`@seams/wallet-server/cloud-host`. `console-shared-ts` has zero.

By domain (Phase 1 target from the plan's ownership table):

| Domain                       | Files      | Symbols (representative)                                                                                                                                                                                                                                                                                                                                                                                                                                         | Phase 1 disposition                                                                                                                                                                                 |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| random-ID / base64url / hash | ~40        | `secureRandomBase36`, `secureRandomBase64Url`, `base64UrlEncode/Decode`, `sha256Bytes`, `keccak256Bytes`                                                                                                                                                                                                                                                                                                                                                         | pass-through re-exports of `@seams-internal/shared-ts` (`packages/wallet-server/src/cloud-host.ts:133-178`); repoint to shared-ts or a Console-owned Web Crypto module                              |
| D1 types / SQL parsing       | 20         | `D1DatabaseLike`, `D1Row`, `queryD1All/One`, `formatD1ExecStatement`, `d1Integer/Number/ChangedRows`, `parseD1Json*Column`                                                                                                                                                                                                                                                                                                                                       | Console-owned D1 boundary module                                                                                                                                                                    |
| logger                       | 14         | `Logger`, `NormalizedLogger`, `RouterLogger`, `NormalizedRouterLogger`, `normalizeLogger`, `coerceRouterLogger`                                                                                                                                                                                                                                                                                                                                                  | Console-owned minimal logger contract                                                                                                                                                               |
| normalization                | 9          | `normalizeCorsOrigin`, `normalizeSourceIp`, `normalizeBoundedPositiveInteger`, `resolveSourceIp*`                                                                                                                                                                                                                                                                                                                                                                | mostly shared-ts pass-throughs; source-IP helpers live in wallet router auth and need a Console-owned copy                                                                                          |
| session adapter              | 7          | `SessionAdapter`, `SessionClaims`, `SessionService`                                                                                                                                                                                                                                                                                                                                                                                                              | Console-owned session contract (`consoleSessionContext.ts`, `consoleAppSessionAuth.ts`, `console.ts`, `express/createConsoleRouter.ts`, `cloudflare/d1StagingSession.ts`, both dev/staging workers) |
| HTTP helpers                 | ~14        | `routeJson`, `readJson`, `toFetchRouteResponse`, `RouteDefinition`, `CfEnv`, `FetchHandler`, `ScheduledHandler`                                                                                                                                                                                                                                                                                                                                                  | Console router transport module                                                                                                                                                                     |
| host composition             | ~14        | `RouterApiKeyAuthAdapter`, `RouterApiUsageMeterAdapter`, `CloudflareD1RouterApiAuthService`, tenant-storage routing, `CloudflareD1EmailOtpDeliveryProvider*`, route policy/metering                                                                                                                                                                                                                                                                              | Wallet Console package or composition root                                                                                                                                                          |
| wallet domain                | 9 + barrel | signer Wasm secp256k1/EIP-1559 ops (`sponsorship/evmWorkerSignerWasm.ts`, `evmRelay.ts`), NEAR delegate actions (`sponsorship/near.ts`, `nearExecutionAdapter.ts`), bulk RouterAb/Yao/linked-device/signing composition (`router/cloudflare/d1LocalDevWorker.ts`, `d1RouterApiStagingWorker.ts`), signer storage targets (`tenantStorageRoute.ts`, `cloudflareConsole.types.ts`, `d1ConsoleServices.ts`), signer worker env re-exports (`cloudflare-adaptor.ts`) | Wallet Console package or Wallet Gateway                                                                                                                                                            |

Concentration: `d1LocalDevWorker.ts` and `d1RouterApiStagingWorker.ts` carry
roughly 85% of the wallet symbol imports; those two plus the four
`sponsorship/*` files isolate nearly the entire wallet coupling.

The exact per-file allowlist is the temporary list inside
`tests/scripts/check-console-core-wallet-import-boundaries.mjs`.

## console-shared-ts Wallet Vocabulary

Five source files; all real consumers use per-module subpath exports, so the
subpaths (not the barrel) are the breaking surface.

| File                                   | Verdict     | Phase 1 disposition                                                                                                                                                                                        |
| -------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/gasSponsorshipSpendCapTargets.ts` | pure wallet | moves wholesale to `wallet-console-shared-ts` (NEAR spend-cap chain-id sentinels)                                                                                                                          |
| `src/gasSponsorshipChains.ts`          | pure wallet | moves wholesale (chain matrix: NEAR/Ethereum/Arc Circle/Tempo)                                                                                                                                             |
| `src/organizationIdentity.ts`          | pure core   | stays                                                                                                                                                                                                      |
| `src/apiKeyScopes.ts`                  | MIXED       | catalog contents are 100% wallet scopes (`accounts.create`, `wallets.read`, `wallets.auth_methods.create`, `wallets.signers.create`) and move; core keeps the generic `ApiCredentialScopeOption` machinery |
| `src/webhookEventCategories.ts`        | MIXED       | categories `wallet`, `policy`, `tx`, `session` move; `auth`, `billing` and the normalizer machinery stay, re-parameterized over a composed catalog                                                         |

Wallet billing inputs are normalized into the generic active-resource and
product-execution vocabulary in `src/billing/*`. Policy payloads, approval
vocabulary, key-export contracts, and sponsorship contracts live in the
Wallet Console packages.

The reconciled role-based `repository-split.json` assigns Console core, Wallet
Console integration, and the hosted docs application to the private
`seams-monorepo`; it assigns the two Wallet packages and required Rust/Wasm to
the public `seams-wallet` output.

## UI Routes

`apps/seams-site` has no react-router; the route table is a `switch` in
`src/app/App.tsx` with dashboard sub-routes declared in
`src/pages/dashboard/dashboardConfig.tsx`.

| Route                                                                                                                                                                                              | Owner                                         | Notes                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/home2`, `/wallet`, `/ecommerce`, `/pricing`, `/company`, `/contact`, not-found                                                                                                              | seams-site (marketing)                        | `/pricing` CTA links to `/dashboard/login` — cross-app URL after Phase 5                                                                 |
| `/near-login`, `/__intended-e2e`, `src/flows/demo/**` (mounted in marketing sections)                                                                                                              | seams-site (wallet demos / intended examples) |                                                                                                                                          |
| `/dashboard/login`                                                                                                                                                                                 | console-core                                  | with `src/shared/auth/` OAuth helpers                                                                                                    |
| `/dashboard/account-settings`, `/dashboard/team-members`, `/dashboard/api-keys`, `/dashboard/webhooks`, `/dashboard/audit`, `/dashboard/billing/*`, `/dashboard/invoices`, `/dashboard/onboarding` | console-core                                  | move to `apps/wallet-console` `core/`                                                                                                     |
| `/dashboard/overview`                                                                                                                                                                              | console-core                                  | MIXED: renders `OpsCockpitPage` + `consoleOpsCockpitApi`; the tenant overview stays, the ops-cockpit slices move to mpc-admin under R99B |
| `/dashboard/observability`                                                                                                                                                                         | console-core                                  | tenant-scoped; fleet/platform slices → mpc-admin                                                                                         |
| `/dashboard/wallets-list`, `/dashboard/gas-sponsorship`, `/dashboard/policy-engine` (+ page-less `routes/approvals/consoleApprovalsApi.ts`, `routes/wallets/consoleWalletApi.ts`)                  | wallet-console                                | move to `apps/wallet-console` `products/wallet/`                                                                                          |
| `/platform/billing`, `/platform/*` (gated on `platformSupport`)                                                                                                                                    | mpc-admin                                     |                                                                                                                                          |
| Dashboard shell (`page.tsx`, `consoleSession.tsx`, `consoleHttp.ts`, layout, components, icons, drafts, utils)                                                                                     | console-core                                  | moves wholesale                                                                                                                          |

Cross-boundary UI leaks to fix in Phase 5:

- core pages importing wallet APIs: `routes/audit/page.tsx` and
  `routes/ops-cockpit/page.tsx` import `consoleApprovalsApi`;
  `consoleBillingApi.ts` embeds the `active_resource_v1` monthly-active-wallets metric
  and endpoint.
- SDK/theme coupling: `SeamsWebProvider` wraps every route including
  `/dashboard/*` (`src/context/frontendRuntime.tsx`, `src/app/App.tsx`;
  only `/near-login` escapes); `App.tsx` bridges `--w3a-*` theme tokens from
  `@seams/wallet/react` onto the document; direct dashboard imports are
  `layout/DashboardTopbar.tsx` (`MoonIcon`/`SunIcon`) and
  `routes/gas-sponsorship/consoleGasSponsorshipApi.ts` (`keccak256Bytes` from
  `@seams/wallet/advanced`); global hooks `useBodyLoginStateBridge` /
  `useExportKeyCancelToast` mount on dashboard routes too.
- no key-export dashboard page exists (key export appears only in the wallet
  demo profile settings).

## Tests

Console operating paths run under `tests/playwright.console.config.ts` against
the managed Caddy, Console frontend, local Cloudflare worker, and D1 stack.
Focused unit and integration tests retain their owning shared configurations.
Refactor 117 has replaced the three mocked dashboard browser files with five
real-service Console operating tests and added the `pnpm test:console` CI gate.

Credential-free Wallet intended-behaviour tests now run case-by-case through
`tests/scripts/run-wallet-intended-isolated.mjs`, giving each case fresh
signer-only D1 and Wallet role state. Its public manager starts the static
Gateway, five Wallet role Workers, independent test-app origin, and Wallet
asset origin. It starts no Console, company site, Caddy, or Console D1. The
Console Playwright config continues to use the private composed manager.
Google-token recovery and the R121 Console tenant-root rotation contract stay
outside the public credential-free suite.
The public test workspace also owns the compile-time fixtures for committed
signer packages, delegated authority, device-linking activation, Wallet-session
tenant-root composition, tenant-root identity resolution, and restore state.
Console auth, operation-trigger, security dashboard, and CLI-enrollment type
fixtures remain private.

| Group                                                       | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Owner          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| dashboard UI                                                | `tests/e2e/console/*.operating.test.ts`; `tests/unit/dashboard.*` (4 files)                                                                                                                                                                                                                                                                                                                                                                                                 | console-core   |
| console server/router                                       | `tests/unit/router.consoleRouteSurface.unit.test.ts`, `cloudflareD1ConsoleServices.unit.test.ts`, `consoleApiKeys.secretFormat.unit.test.ts`, `consoleServer.stripeBillingProvider.unit.test.ts`, `githubOAuth.unit.test.ts`                                                                                                                                                                                                        | console-core   |
| sponsorship (wallet feature implemented in console package) | `tests/unit/sponsorship.*.unit.test.ts`, `sponsorshipPricing.d1.unit.test.ts`, `router.sponsoredEvmCallCloudflare.unit.test.ts`                                                                                                                                                                                                                                                                                                                                             | wallet-console |
| mixed — split later                                         | `tests/scripts/start-intended-services.mjs`; `tests/unit/packageExports.contract.unit.test.ts`, `frontendRuntimeState.unit.test.ts`, the `d1Staging*`/`d1LocalDev*`/`d1HostedGatewayRouting`/`migrationFingerprint`/`signingRootScope`/`intendedYaoFault` script tests (import console-server-ts while testing wallet/signer behavior), OTP provider tests, shared fixtures (`tests/helpers/sqliteD1.ts`, staging fixtures) | composition    |
| Wallet suites                                               | `tests/wallet-iframe/`, `tests/lit-components/`, credential-free Wallet lifecycle contracts, Wallet relayer/unit families, `tests/scripts/run-wallet-intended-isolated.mjs`, and `playwright.wallet-intended*.config.ts`                                                                                                                                                                                                                                                    | wallet         |

Boundary guards needing updates at each split: `tests/scripts/check-signer-console-module-boundaries.mjs`, `check-workspace-package-boundaries.mjs`, and the new `check-console-core-wallet-import-boundaries.mjs`.

Site pricing/theme tests and Console-in-the-loop deployment tests remain private.
Wallet-only tests move with their implementation; shared fixtures must expose only
Wallet dependencies in the public repository. Tests used solely by the retired
Node relay are removed.

## Local Runtime Classification

`pnpm router` (`scripts/local-wallet/dev-local-workers.mjs`) is the
composed private development runtime: it prepares env/config, applies private
Router A/B D1 migrations, starts the five packaged Wallet workers (:4102-:4106),
and spawns `pnpm gateway:server` (which applies Console + signer D1 migrations
via `d1:local:prepare`, then serves the combined local Worker on :4100).
`pnpm site` supplies the Caddy HTTPS proxy on :4101. The legacy Node relay
`apps/web-server` and the unused `.router-ab-local/` directory have been retired.
Ownership split for the public/private
repositories:

| Piece                                                                                                                                                                                | Owner                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router A/B Worker and `router_ab_local_*` source, role-private D1 schema, and generic runtime behavior                                                                               | wallet (public local reference runtime)                                                                                                                        |
| Strict local role config and peer-key utilities (`router-ab-cloudflare/scripts/prepare-local-runtime-config.mjs`, `local-key-material.mjs`)                                          | wallet; public role-worker startup inputs with no Console identity dependency                                                                                  |
| `router-ab-cloudflare/scripts/start-local-role-workers.mjs`                                                                                                                          | wallet; supervises the five Wallet role Workers and applies only their role-private D1 migrations                                                              |
| Combined local worker (`d1LocalDevWorker.ts`), console+signer migration chaining (`d1:local:prepare`), Caddy topology, `gateway:server`, seeding (`seed-intended-local-console.mjs`) | composition (private composed development)                                                                                                                     |
| Current `start-intended-services.mjs` manager                                                                                                                                        | composition until split; its Console startup/readiness/seeding moves private and its Wallet runtime/startup path becomes the public intended-behaviour manager |
| State-preserving startup (canonical-schema SHA check renames drifted state; `router:reset` renames, never deletes; `d1:local:reset` is the explicit destructive command)             | split: the Wallet-only local runtime keeps the preserve/reset semantics per the plan; the console halves move with composition                                 |

`packages/shared-ts` (`@seams-internal/shared-ts`) is consumed exclusively by
the Wallet packages and tests via the `@shared/*` alias (446 files in
`sdk-web`, 280 in `sdk-server-ts`, ~140 in `tests/`; zero console
importers) — it is Wallet-owned and goes to the public repository. The
console analogue is `console-shared-ts`.

## Deployment Secret And Environment Generation

The private deployment tooling now has two explicit authorities:

- `deployment/console/targets.json` and
  `scripts/console-deployment-environment.mjs` own Console Worker, D1, origin,
  session, OAuth, email, webhook, billing, and grant-authority values;
- `deployment/wallet-system/targets.json` and the Wallet-system generator own
  Wallet Gateway, Runtime, signer, Router A/B, tenant-root control-plane,
  protocol, and network values;
- the root `console:deploy:*` and `wallet-system:deploy:*` commands write
  separate manifests and GitHub environments. The former paired manifest,
  shared generation ID, generic `product` component, combined rotation, and
  cross-generation verification have been removed;
- Console and Wallet-system backend deployment use separate workflows and
  narrow environment inputs;
- Console reaches an exact allowlisted tenant-root control surface through its
  private `WALLET_RUNTIME` binding; direct role bindings and Wallet internal
  authentication remain inside the Wallet-system deployment;
- `deploy-frontend.mjs` currently composes the site, docs, Wallet Pages, and the
  mounted Console build.

The two explicit private pipelines are:

| Pipeline      | Owns                                                                                                                                                                                                                                                         | Must never write                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Console       | Console Pages/Worker/D1, Console session and OAuth secrets, Console email/webhook/billing inputs, Console routes and origins                                                                                                                                 | Wallet Gateway/Runtime, hosted Wallet, signer, Router A/B, root-share, ceremony, signing-session, or relayer values |
| Wallet system | Wallet Gateway/Runtime, hosted Wallet Pages, signer D1, Router A/B workers and role D1s, R120 tenant-root control plane, protocol keys, root shares, role-sealing/backup/creation keys, ceremony/signing-session material, relayer and Wallet-network values | Console D1, Console session/OAuth/email/webhook/billing values, Console Pages/Worker, or Console routes             |

Each pipeline receives its own target file, generator, protected GitHub
environments, update/rotation command, backup output, and deploy workflow. A
shared read-only handoff may contain public origins, network names, service
binding names, and deployed artifact versions. It contains no secret and grants
neither pipeline write access to the other's environments.

Within the Wallet-system pipeline, R120 keeps independent protected
environments for the tenant-root control plane, Router, Deriver A, Deriver B,
and Signing Worker. The issuer private key belongs only to the control-plane
Worker. Each Deriver owns distinct online-sealing, managed-backup, and
role-creation keys. The Signing Worker receives none of those authorities.

## September 2 Pre-R105 Addendum

R105 starts from `dev` only after Refactor 120 completes and merges. Phase 0
must regenerate this inventory from that merged commit. The current R120 branch
is implementation input rather than a valid extraction reference.

The latest `dev` commits add two migration details that the final inventory
must classify:

- `packages/wallet-server/scripts/d1-local-migrate-signer.mjs` copies and
  adapts a signer migration for local `workerd` behind the Wallet package
  command. Console owns no signer migration transformation.
- `packages/wallet-console-server-ts/scripts/apply-remote-d1-migrations.mjs`
  checkpoints migration fingerprints after each successful file. Remote
  application is private Wallet-system orchestration and consumes the exact
  migration manifest, heads, and fingerprints shipped by the installed
  `@seams/wallet-server` version.

R120 adds the following ownership:

- public Wallet implementation: tenant-root protocol and lifecycle source,
  the generic tenant-root control-plane/Router/Deriver runtime, role-private
  Deriver schemas and migrations, generic key-generation primitives, tests,
  and typed binding contracts;
- private monorepo: all existing and R120 production/staging workflows, real
  targets and Worker names, provider configuration, role secrets, target/apply
  wrappers, architecture-selection evidence, rollout/rollback records, and
  operational plans;
- npm release boundary: `@seams/wallet-server` ships prebuilt Worker/Wasm
  artifacts plus a manifest naming the exact control-plane, Router, Deriver,
  and Signing Worker artifacts and all migration heads/fingerprints. Private
  deployment consumes that manifest without Cargo or public source access.

## Current Repository Destination Addendum

September 8 supersedes the earlier pre-R120 snapshot. `dev` includes completed
R120, R123 boundary cleanup, and removal of legacy `PRF.second` derivation.
R121 is in active branch/working-tree development. Its remaining-steps ledger
reports locally demonstrated rotation/scheduling and restore activation/cleanup;
hosted verification, recovery browser delivery, real retention provisioning,
and production release trust remain incomplete. Merge the source integration
before freezing the R105 extraction commit; deferred provider/release work keeps
its R121 owner.

Additional ownership to reconcile from the final tree:

| Surface                                                                                                                                                  | Destination                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/wallet-console/src/products/wallet/derivation-root`, Wallet Console security/creation routes, scheduler, audit, operation and restore D1 migrations | Private Wallet Console                                                                                      |
| `crates/seams-cli`, `crates/seams-recovery-core`, generic recovery protocol and role-private restore migrations                                          | Public Wallet implementation; native binary artifacts supplement npm                                        |
| `packages/shared-ts/src/tenant-root`                                                                                                                     | Split portable protocol/CLI contracts from private Console governance and presentation models by consumer   |
| `.github/workflows/release-seams-cli.yml`, production signing authority                                                                                  | Private release publisher consuming public CI build artifacts                                               |
| Generic recovery/CLI instructions in `docs/tenant-recovery-runbook.md`                                                                                   | Public documentation; split out private provider and operating procedures                                   |
| R120 KMS/R2 credentials and R121 deferred retention provider configuration                                                                               | Private Wallet-system role environments, separate from Console grants and CLI release signing               |
| Current `seams.sh/wallet` page and owned assets                                                                                                          | Private wallet frontend composition in `apps/wallet-console`, published at `wallet.seams.sh/`                |
| Public Wallet VitePress source and configuration                                                                                                         | Public `seams-wallet`; configure `base: '/docs/'` and emit a versioned static artifact                      |
| Wallet docs publication at `wallet.seams.sh/docs/*`                                                                                                      | Private wallet-site workflow consumes the exact public artifact and assembles it in the shared Pages output |
| `voiceId/` experimental evidence lab                                                                                                                     | Private monorepo; independent of the public Wallet SDK and excluded from extraction                         |

R121 public tenant-root metadata and journals are valid Wallet Console storage.
Root shares and role wrapping keys are excluded. The composed Console Worker
now reaches the exact tenant-root operations through the narrow Wallet Runtime
control port and carries neither broad role bindings nor the Wallet internal
service credential.

- The fresh private `seams-tech/seams-monorepo` repository keeps Console, Admin, future products,
  the private operational portion of `apps/docs`, deployment topology,
  environment and provider configuration,
  secrets, operational runbooks, every staging/production workflow, and the
  private composed test/runtime harness.
- The historical `seams-tech/seams-sdk` repository is preserved as an archive.
- One fresh-history public `seams-tech/seams-wallet` repository owns
  `@seams/wallet`, `@seams/wallet-server`, required shared code, Rust/Wasm,
  signer migrations, public Wallet tests, Wallet VitePress source under
  `docs/`,
  `examples/seams-auth-menu`, the local-only `examples/wallet-console-lite`
  playground defined by Refactor 105E, and the generic self-host/runtime
  example.
- Current deployment/local scripts are not moved by directory assumption.
  Generic Wallet behavior is re-expressed in the public runtime; Console,
  environment, provider, and deployment orchestration remains private.
- Private deployment is split into Console and Wallet-system pipelines. Each
  pipeline owns disjoint GitHub environments and secret/variable names, and no
  command generates or applies both ownership sets.
- `tests/playwright.console.config.ts`, its five real-service operating paths,
  and the Console/composed half of the managed service stack remain private.
  The isolated Wallet runner, credential-free lifecycle cases, and public
  manager now move together; their web-server command starts only the generic
  Wallet runtime and two test origins.
- Rust crates remain co-located implementation inputs with `publish = false`.
  Refactor 105 publishes no crate and creates no Rust repository.
- The private monorepo deploys exact-pinned npm artifacts and has no Cargo,
  `wasm-pack`, Git, sibling-checkout, or source-path fallback for Wallet builds.
- The private wallet-site release exact-pins the public docs artifact and
  publishes marketing, dashboard, and `/docs/*` together. `/console/*` is
  dispatched to the Console Worker before static or SPA fallback.
