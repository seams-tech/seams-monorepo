# Platform-owned Console implementation plan

Status: proposed; implementation has not started.
Date: October 14, 2026.

## Outcome

Make the shared Console the Platform application. Wallet and Satyr integrate as
products inside platform organisations and projects. Preserve current account,
permission, billing, and product behaviour throughout the change.

Keep the three repositories:

- `seams-monorepo` owns Platform, its Console, and hosted product integration.
- `seams-wallet` owns public Wallet technology and its independently released packages.
- `satyr` owns the Agents product and its native operational interface.

This plan builds on [Shared Account Platform](feat-1-shared-account-platform.md).
It does not repeat the completed account, billing, service-instance, or private
Satyr binding work. Its approved application and composition moves supersede that
plan's restriction on renaming solely to match Platform terminology.

## Scope and constraints

- Work on `dev` in the main checkout. Commit each completed phase separately.
- Preserve public URLs, cookies, OAuth callbacks, Worker names, service-binding
  names, D1 identities, and persisted record formats.
- Add zero database calls or service calls to Wallet registration, unlock, signing,
  and response paths. Add no serial validation, awaited billing delivery, or schema
  setup to these paths. Preserve existing early dispatch and query budgets.
- Reuse existing handlers, account factories, permission checks, D1 transactions,
  and asynchronous provisioning and billing delivery.
- Remove replaced source paths and exports in the same phase. Update their callers.
  Do not add compatibility barrels, duplicate entrypoints, or legacy flags.
- Use explicit product imports and routes. Do not create a plugin framework,
  service registry, dependency container, or new configuration manifest.
- Keep shared packages free of Wallet imports. Existing boundary checks remain in force.
- Keep service-native data and permissions in their owning products. Platform
  membership does not bypass Satyr's native access restrictions.
- Do not introduce another runtime service or database solely for source ownership.
- Do not rename the GitHub repository, change domains, or take over the separate
  production Wallet rollout. Those are independent changes.

The previously committed service-binding changes and architecture fixes still
require their own deployment coordination. Record their actual rollout state
before any deployment under this plan.

## Current code and remaining coupling

| Area | Current owner | Required change |
| --- | --- | --- |
| Console frontend | `apps/wallet-console` | Make it the Platform app and separate its build from product surfaces. |
| Shared frontend | `src/core/dashboard`, `src/app` inside that app | Preserve useful structure; remove product assumptions from shared navigation and startup. |
| Wallet frontend | Existing `src/products/wallet` plus mixed routes and assets | Consolidate Wallet-specific pages in the existing product module. |
| Shared account and billing | `packages/console-server-ts`, `packages/console-shared-ts` | Keep these owners and their existing factories. |
| Hosted Console composition | `packages/wallet-console-server-ts/src/router/consoleComposition.ts` and `router/cloudflare/d1ConsoleServices.ts` | Move application assembly into the Platform application. Retain Wallet implementations in their package. |
| Production Console Worker | `packages/wallet-console-server-ts/src/router/cloudflare/d1ConsoleStagingWorker.ts` | Move the deployed entrypoint into the Platform application. |
| Private Satyr entrypoint | `packages/wallet-console-server-ts/src/router/cloudflare/satyrAccountPlatform.ts` | Move into Platform-owned composition without changing its binding contract. |
| Console deployment | `deployment/console`, `scripts/deploy-backend.mjs`, Console workflows | Preserve targets; remove unnecessary dependence on Wallet deployment configuration. |
| Frontend delivery | Console build also includes marketing, showcase, and `wallet-host` assets | Give each existing surface an explicit owner and build output. |

The account-only D1 bundle already exists. Shared packages already reject Wallet
imports. Project and service lifecycles already have separate contracts. Verify
these properties and use them; do not build parallel implementations.

## Target ownership

```text
apps/console/
  src/
    app/                    application assembly and explicit routes
    core/                   shared Platform UI, account state, and navigation
    products/
      wallet/               Wallet management pages
      satyr/                Satyr management UI only where needed
  worker/                   deployed Console entrypoint and service assembly

packages/console-server-ts/         shared account and billing implementation
packages/console-shared-ts/         shared contracts and parsers
packages/wallet-console-server-ts/  hosted Wallet adapters and product routes
packages/wallet-console-shared-ts/  Wallet management contracts

deployment/console/                 Console deployment targets
```

Keep the existing `core` directory where it expresses shared ownership. A cosmetic
rename to `platform` is unnecessary. Create a Satyr UI directory only when it owns
actual product-specific UI. The existing shared Services page can remain shared.

The application may import both shared and product packages. Shared packages must
not import the application or product packages. Product adapters may consume
shared contracts and narrow service interfaces.

Platform owns login, organisation and project selection, onboarding, members,
account settings, consolidated billing, and the service catalogue. Wallet owns
Wallet environments, credentials, sponsorship policy, and Wallet operations.
Classify audit, webhooks, and observability by their actual contracts; shared
infrastructure can remain shared while Wallet event definitions stay in Wallet.

Satyr retains its portal, Cases, workflows, commerce integrations, and agent
execution. Console exposes its enablement, account access, status, and product link.

## Phase 1 — Inventory and baseline

1. Map active frontend entrypoints, route assembly, backend composition, bindings,
   build outputs, and deployment scripts. Distinguish active code from obsolete copies.
2. Assign each mixed page, factory, and deployment input to Platform or a product.
   Record a source-to-destination table for files that need to move.
3. Trace shared account requests through the deployed Worker. Identify any eager
   Wallet setup, product configuration parsing, or product availability dependency.
4. Capture current E2E results and per-operation database and service-call counts.
   Include registration context, active-lineage resolution, Wallet settlement,
   shared onboarding, and Satyr account access.
5. Identify the current Console browser journey that will verify the shell move.
   Extend that journey only for behaviour it does not cover.

Exit: the ownership table, affected commands, deployment prerequisites, and baseline
artifacts are recorded. Each proposed extraction removes a demonstrated dependency.

## Phase 2 — Platform frontend application

1. Move `apps/wallet-console` to `apps/console` and rename its private workspace package.
   Update workspace references, aliases, local startup, CI, deployment scripts, test
   fixtures, asset paths, and documentation in the same change.
2. Keep shared shell and account pages in `core`. Move mixed Wallet management pages
   into the existing `products/wallet` module. Use the existing router to register
   product routes explicitly.
3. Make shared navigation organisation- and project-based. Show service-specific
   controls from service-instance state. Preserve existing route URLs and deep links.
4. Ensure shared login, account data, and billing render without Wallet SDK startup,
   Wallet RPC, or a Satyr request. Keep SDK initialization inside the relevant product
   flow. Use existing lazy-route patterns where they reduce shared startup work.
5. Separate Console, Wallet marketing/showcase, and hosted Wallet build inputs.
   Keep company marketing in `apps/seams-site`. Assign Wallet marketing and hosted
   assets to explicit Wallet build roots; create a separate app only if their actual
   build dependencies require it. Do not copy pages or merge independently owned
   surfaces to make the rename easier.

Exit: existing URLs and authentication flows work. A shared account journey loads
without either product runtime. Each surface builds independently with the same
public asset locations and hosted Wallet behaviour.

## Phase 3 — Platform Worker and composition

1. Move the Console Worker entrypoint and private `SatyrAccountPlatform` entrypoint
   into `apps/console/worker`. Keep their deployed names and binding exports stable.
   Keep frontend TypeScript and Vite inputs separate from Worker inputs.
2. Move application-level route assembly out of `wallet-console-server-ts`.
   Shared account requests construct only the shared dependencies they use.
   Product routes obtain existing Wallet adapters through explicit composition.
3. Keep product implementations in their current packages. Move genuinely shared
   email, authentication, or scheduled-job composition only where its current owner
   forces a product dependency. Preserve existing account service interfaces.
4. Preserve the Wallet internal service routes and their early dispatch before full
   Console assembly. Keep `ensureSchema: false` on request-time D1 construction.
5. Keep the private Satyr binding mandatory. Fix its service identity at the server
   entrypoint and its deployment identity in server configuration. Preserve signed
   user assertions and existing account permission checks. Public service ingress
   remains unavailable, and the retired service tokens remain absent.
6. Keep scheduled provisioning and billing retries independent of interactive
   requests. A product retry failure must not stop another product's scheduled work.

Exit: shared account routes work with product runtimes unavailable and unrelated
product configuration invalid. Wallet-specific operations retain their required
checks and fail appropriately when their own dependencies are unavailable. Existing
Wallet call counts do not increase.

## Phase 4 — Lifecycle and deployment ownership

1. Verify organisation and project creation use only Platform services. Keep Wallet
   environments and native Satyr tenant creation behind explicit service enablement.
   Fix only remaining violations; preserve completed Shared Account Platform behaviour.
2. Update Console build and deployment commands to the new application entrypoints.
   Retain `deployment/console` as the configuration owner. Extract Console-only
   renderer logic from the Wallet deployment script where necessary; reuse current
   deployment utilities and target files.
3. Preserve applied migration files, ordering, checksums, and D1 identities.
   Document shared and Wallet schema ownership. Change migration discovery only if
   a source move requires it, and prove the resulting ordered list is unchanged.
4. Keep exact public Wallet package versions. Platform deployment can consume a
   released Wallet version without publishing Wallet or deploying its runtime.
5. Update local combined development and private composed tests to the new source
   locations. Keep Satyr independently deployed and connected by the same binding.

Exit: Console frontend and backend can build and deploy independently of a Wallet
release or Satyr release. No new persistence migration is required for file moves.

## Phase 5 — Acceptance and rollout

Run the narrow checks after each phase. Run `pnpm check` after the full composition
change. Run `pnpm test:scripts` after deployment-script or workflow changes.
Use current E2Es and type fixtures; add no unit tests or new source-text guards.
Read `tests/AGENTS.md` before changing test code.

The composed acceptance journey must demonstrate:

1. A user signs in, creates an organisation and project, and manages members and
   billing while Wallet and Satyr runtimes are unavailable. No service enables itself.
2. Wallet enablement creates its existing resources. Disable and re-enable preserve
   the defined lifecycle and account records.
3. Satyr enablement completes through existing asynchronous provisioning. Its private
   binding accepts a permitted user and rejects stale, revoked, and foreign authority.
4. Product failure leaves shared account and billing pages usable. Unavailable
   product operations show their own failure without changing another product's state.
5. Existing deep links, session cookies, asset paths, and hosted Wallet flows survive
   the source moves. Browser screenshots and a trace show the final navigation.
6. Wallet query and service-call budgets remain at or below baseline. Billing capture
   stays in its existing transaction and delivery stays asynchronous.

Write repeatable evidence under `.artifacts/platform-console/`: exact commands,
source revisions, build hashes, route results, screenshots, traces, and before/after
call counts. Use separate output directories for concurrent test runners.
Classify failures against current contracts before changing implementation or fixtures.

Stage the candidate Console against existing bindings and schemas. Compare Wallet
latency on the same request cohort, SDK version, region, and deployment topology.
Reject unexplained latency increases; local call counts alone do not prove latency.

Production rollout remains separate from the deferred Wallet rollout. Before a
production deployment, verify prerequisite releases and migrations are applied.
Retain the previous deployable Console artifact for rollback. Roll back by deploying
that artifact; do not retain a second implementation in source or reverse shared data.

## Completion criteria

- The application and its deployed entrypoint have explicit Platform ownership.
- Shared pages and account routes have no product-runtime startup dependency.
- Wallet and Satyr retain their native data, permissions, and release boundaries.
- Existing URLs, bindings, persistence, and commercial behaviour remain intact.
- Replaced paths, duplicate composition, and obsolete build references are removed.
- Acceptance artifacts prove the requested behaviour and unchanged request costs.
- Report local validation, staging deployment, and production deployment separately.

Renaming the repository to `seams-platform` is optional follow-up work. It is not
required to complete this plan.
