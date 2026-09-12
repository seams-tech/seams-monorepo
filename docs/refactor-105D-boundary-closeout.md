# Refactor 105D: Console Boundary Closeout

Date created: August 27, 2026

Last reconciled: September 12, 2026 (Phases 1-2 complete)

Status: planned. This plan executes the tree confirmation required by
[Refactor 105](./refactor-105-split-console.md) "Boundary Closeout And Final
Split" and removes the gaps it found. Refactor 105 Phase 7 remains blocked
until this plan's definition of done is met. R120 and R121 have landed
(`6f088d2dd` records R121 acceptance closeout). Refresh the inventory before
starting closeout. Preserve the landed launcher isolation, authoritative
environment identity resolution through the Console adapter/service binding,
and custody payload fixes when moving ownership. All four rotation contracts
now pass locally; hosted acceptance remains separate.

## R121 Additions To Closeout

The September 8 branch and working tree expand the historical gaps below:

- S1/S3: tenant-root creation, security, step-up and restore routes, scheduling,
  and audit belong to Wallet Console. Include them when removing product route
  declarations and vocabulary from Console core.
- S2: Console still must lose signer D1 access. Its R121 public identity,
  active-lineage and operation projections are legitimate Wallet Console data
  and must survive the move.
- S4: the Console Worker now sends its exact tenant-root operations through the
  private `WALLET_RUNTIME` control port. The Wallet Runtime alone holds the MPC
  Router, control-plane, Deriver, and internal-auth bindings and rejects any
  operation outside the declared set. The Console retains its separate grant
  authority without importing Wallet issuer or role secrets. Preserve this
  boundary through restore bootstrap and cleanup authorization changes.
- Keep the R121 security workspace in `products/wallet` and its registration in
  `app/`. Split Console-only models out of `packages/shared-ts/src/tenant-root`
  while preserving portable protocol contracts needed by the public runtime.

Use the final R121 tree to resolve exact paths. The current work includes
uncommitted restore and scheduler changes and is not an extraction inventory.

## Decision

The August 27, 2026 confirmation of the current tree against the Refactor 105
dependency and ownership rules found the package split, schema ownership, and
billing neutrality in place, and seven bounded gaps remaining. This plan closes
those gaps with ownership moves and static composition only. It changes no
route path, no customer-visible behavior, no schema semantics, and no wallet
runtime code.

What the confirmation verified as already correct:

- `console-server-ts` imports no Wallet package; its only workspace dependency
  is `console-shared-ts`. `wallet-console-server-ts` is the sole Console
  package depending on `@seams/wallet-server`.
- Console D1 table ownership is split and enforced by
  `tests/unit/consoleSchemaOwnership.unit.test.ts` (35 core + 34 wallet = 69
  composed); the core-only baseline
  `packages/console-server-ts/migrations/d1-console-core/0001_console_core_initial.sql`
  is asserted free of wallet table vocabulary.
- The Gateway Worker holds no `CONSOLE_DB` binding.
- Core billing is product-neutral: `active_resource_v1` metering,
  `PRODUCT_EXECUTION_DEBIT`, and `revenue_product_execution` postings carry a
  second product without schema redesign.
- `apps/wallet-console` has the `core/` + `products/wallet/` + `app/` static
  composition shape with no plugin framework.

## Verified Gap Inventory

Each gap is a violation of a named Refactor 105 rule. Paths are current as of
the confirmation date.

### S1. Wallet route declarations live in the core route table

`packages/console-server-ts/src/router/consoleRouteDefinitions.ts` declares
`console_wallets_*`, `console_policies_*`, `console_policy_*`,
`console_approvals_*`, `console_key_exports_*`, `console_runtime_snapshots_*`,
`console_gas_readiness_get`, and
`console_billing_usage_monthly_active_wallets` inside the core RBAC route
groups. Refactor 105 "Server Composition" requires wallet routes to be
declared and authorized in `wallet-console-server-ts` and mounted once by the
composition root. This is the largest multi-product blocker: a second product
would have to edit the core package to exist.

The mechanism for the fix already exists: the composed router
(`createCloudflareConsoleRouter.ts`) consumes a `routeDefinitions:
readonly ConsoleRouteDefinition[]` surface. Core stops being the aggregation
point; it becomes one contributor.

### S2. The Console Worker reads signer D1

`packages/wallet-console-server-ts/src/wallets/balances.ts` queries
`wallet_signers` through a `signerMetadataDatabase` binding
(`d1ConsoleServices.ts` `balanceReader`) to resolve signing addresses before
writing `wallet_balance_snapshots`. Refactor 105 dependency rule 9 requires
the Console Worker to receive no signer D1 binding. The
`wallet_index_multichain` migration widened the chain vocabulary while keeping
one address per wallet, so the projection does not contain both the NEAR and
EVM identities required by balance refresh.

### S3. Wallet vocabulary in core observability and audit

`packages/console-server-ts/src/observability/policy.ts` hardcodes
`sponsorship_prepaid_balance` components, the `APPROVAL` source,
`billing.sponsorship.blocked` and `approval.policy_publish.failed` event
types, and `/console/approvals/*` and `/console/sponsorship-spend-caps/*`
route families. `observability/adapters.ts` exports approval and sponsorship
event builders. `audit/types.ts` carries `APPROVAL` in the audit category and
evidence-reference unions. The core-only D1 baseline embeds `'APPROVAL'` in
the `observability_events.source` CHECK constraint. Refactor 105 "Ownership
Rules": product-specific event categories and meters are supplied by the
composed product.

### S4. Core owns wallet deployment wiring

`packages/console-server-ts/scripts/render-d1-gateway-config.mjs` resolves
`wallet-console-server-ts` Worker entrypoints, the composed migration
directory, and `@seams/wallet-server/package.json`. The core `package.json`
carries `d1:local:migrate:signer` and `d1:staging:signer-custody` scripts.
Composition wiring that names wallet artifacts belongs to the wallet
composition owner, not the product-neutral core package. (The stale
`.wrangler/generated/gateway.jsonc` is untracked; no repository action.)

The latest `dev` tree adds
`packages/console-server-ts/scripts/d1-local-migrate-signer.mjs`, which copies
and rewrites a signer migration for local `workerd`, and strengthens
`apply-remote-d1-migrations.mjs` with partial migration-fingerprint
checkpoints. The local compatibility adapter belongs to the generic Wallet
runtime. Remote application and checkpointing belong to private Wallet-system
deployment composition. Neither remains owned by Console core.

### F1. Frontend core pages import the wallet product

- `apps/wallet-console/src/core/dashboard/routes/audit/page.tsx:55` imports
  `listDashboardApprovals` from `@wallet-product/approvals/consoleApprovalsApi`
  to build its approvals directory.
- `apps/wallet-console/src/core/dashboard/routes/ops-cockpit/page.tsx:17`
  imports `approveDashboardApproval` / `rejectDashboardApproval` from the same
  module.

Refactor 105 dependency rule 6: core UI files cannot import Wallet product
files. The ops-cockpit page is destined for `apps/seams-admin` under
Refactor 99B; that later move does not excuse the import today.

### F2. Frontend core is product-aware and inverted against `app/`

- `apps/wallet-console/src/core/dashboard/page.tsx` and
  `core/dashboard/useDashboardUiPreferences.ts` import `@app/dashboardConfig`,
  inverting the composition direction and pulling every wallet page into
  core's module graph.
- `apps/wallet-console/src/core/dashboard/types.ts` hardcodes
  `/dashboard/wallets-list`, `/dashboard/policy-engine`, and
  `/dashboard/gas-sponsorship` into the core `DashboardRoute` union and
  `'operationsSecurity'` into `SidebarGroupKey`.
- Six core files import `@seams-internal/wallet-console-shared` for API-key
  scopes and the webhook event catalog
  (`routes/api-keys/{page.tsx,consoleApiKeysApi.ts}`,
  `routes/webhooks/{page.tsx,consoleWebhooksApi.ts,webhookEventCatalog.ts,CreateWebhookEndpointModal.tsx}`).
  Scope names and event categories are product-supplied vocabulary.

### F3. No boundary enforcement covers the frontend application

`tests/scripts/check-console-core-wallet-import-boundaries.mjs` scans only
`packages/console-server-ts/src` and `packages/console-shared-ts/src`. Nothing
enforces `apps/wallet-console/src/core` against `@wallet-product/*`, `@app/*`,
or `@seams-internal/wallet-console-*`, which is why F1 and F2 exist.

## Fix Plan

### Phase 1: Split the server route table (S1)

- [x] Reduce `createConsoleRouteDefinitions()` in `console-server-ts` to
      core-owned routes only. Keep `ConsoleRouteDefinition`,
      `ConsoleRouteRequirement`, and the RBAC group typing exported from the
      core package as the shared contract.
- [x] Add a wallet route-definition module in
      `wallet-console-server-ts/src/router/` declaring every wallet route id
      currently in the core table, using the same tuple/requirement types.
      Route ids, methods, and paths are byte-identical to today; only the
      declaring package changes.
- [x] Concatenate core and Wallet definitions at the route owner that mounts
      them. The base Cloudflare and Express routers expose core plus the Wallet
      routes they directly mount; the Console Worker and local D1 composition
      attach the complete surface including step-up and tenant-root routes.
      Reject duplicate route ids or method/path pairs at composition time.
- [x] Move `console_billing_usage_monthly_active_wallets` with the wallet
      definitions; the core billing routes keep only product-neutral ids.

Exit: `consoleRouteDefinitions.ts` contains no wallet, policy, approval,
key-export, runtime-snapshot, gas, or sponsorship route id; the composed
route surface serves the identical route set.

### Phase 2: Move product vocabulary out of core observability and audit (S3)

- [x] Make the core observability policy table core-only. Define the policy
      and builder contract types in core; move
      `sponsorship_prepaid_balance`, `APPROVAL`-sourced policies, the approval
      and sponsorship event builders, and the wallet route families into
      `wallet-console-server-ts`, registered through composition alongside the
      route definitions.
- [x] Split the audit unions: core keeps product-neutral members; the
      `APPROVAL` category and evidence-reference kind move to wallet-supplied
      values validated at the boundary.
- [x] Remove `'APPROVAL'` from the `observability_events.source` CHECK in the
      core-only baseline
      (`d1-console-core/0001_console_core_initial.sql`); the composed baseline
      in `wallet-console-server-ts/migrations/d1-console/` keeps it. Each
      fresh schema declares exactly its own constraint values. This edits the
      core-only reference baseline, which no deployment consumes; the deployed
      composed ledger is unchanged.
- [x] Extend `tests/unit/consoleSchemaOwnership.unit.test.ts` (or its
      vocabulary assertions) to cover `approval` in the core baseline.

Exit: `grep -ri "sponsorship\|approval" packages/console-server-ts/src
packages/console-server-ts/migrations` returns no product literal.

### Phase 3: Remove the Console Worker's signer D1 read (S2)

- [x] Confirm projection completeness for every signer family the refresh
      supports. The current one-address wallet index cannot supply both the
      NEAR account ID and EVM address without a new projection lifecycle.
- [x] Cross the gap with a typed Wallet Runtime control-port service-binding
      operation that returns only those two public identities;
      do not keep the D1 binding as a fallback.
- [x] Delete the `signerMetadataDatabase` balance-reader path from
      `d1ConsoleServices.ts`. The split Console Worker uses its existing
      `WALLET_RUNTIME` binding and carries no signer database.

Exit: the Console Worker has no signer D1 binding in generated configuration,
and balance refresh passes against the projection.

### Phase 4: Move composition wiring out of the core package (S4)

- [x] Move `render-d1-gateway-config.mjs` and private signer deployment scripts
      such as `d1:staging:signer-custody` into
      `wallet-console-server-ts/scripts/`. Replace `d1:local:migrate:signer`
      with a thin composition command that invokes the Wallet package. Update
      every caller that currently resolves `@seams/wallet-server` or
      `wallet-console-server-ts` through the core package.
- [x] Move the generic local `workerd` signer-migration adaptation behind an
      `@seams/wallet-server` command. Keep remote apply and fingerprint
      checkpointing in private Wallet-system composition, consuming the exact
      installed package migration manifest.
- [x] Keep only console-core-scoped D1 commands in
      `console-server-ts/package.json`.

The composed local/staging launchers, Wrangler configurations, deployment
renderers, and evidence tooling now live in `wallet-console-server-ts`. Console
and Wallet-system secret files are emitted by separate commands with disjoint
optional allowlists. The Wallet package owns the local signer-migration
compatibility adapter.

Exit: `packages/console-server-ts` contains no path, script, or command that
names a wallet package or signer artifact.

### Phase 5: Restore the frontend composition direction (F1, F2)

- [x] `core/dashboard/page.tsx` receives the sidebar groups, default route,
      and route lookups as props from `app/`; delete the `@app/dashboardConfig`
      imports from `core/`. `useDashboardUiPreferences` takes the group keys as
      an argument.
- [x] Remove the wallet route literals and `'operationsSecurity'` from
      `core/dashboard/types.ts`. Core declares its own route and group unions;
      the composed unions (core + wallet) live in `app/dashboardConfig.tsx`.
      Core components that handle arbitrary routes type them against the
      composed union supplied by `app/`, not a widened core type.
- [x] Replace the audit page's direct approvals import with a typed optional
      panel/data-source prop supplied by `app/` from the wallet product. Same
      for the ops-cockpit approval actions. This is static composition through
      the existing `app/` layer, not a registry: `app/dashboardConfig.tsx`
      already composes pages and now also composes these two product slots.
      The ops-cockpit page keeps its Refactor 99B destination; this phase only
      removes its product import.
- [x] Move the API-key scope and webhook event catalogs behind core-owned
      contract types: core pages render catalog data they are given; the
      wallet catalogs from `@seams-internal/wallet-console-shared` enter
      through `app/` composition. Core files import neither
      `@seams-internal/wallet-console-shared` nor `@wallet-product/*`.

Exit: `grep -rn "@app/\|@wallet-product\|wallet-console-shared"
apps/wallet-console/src/core` returns nothing.

### Phase 6: Enforce the boundary (F3)

- [x] Add `no-restricted-imports` zones to `eslint.config.mjs` (per the
      testing policy's preference for lint rules over new source-text guards): - `apps/wallet-console/src/core/**` may not import `@app/*`,
      `@wallet-product/*`, or `@seams-internal/wallet-console-*`; - `apps/wallet-console/src/products/**` may not import `@app/*`.
- [x] Land the lint rules in the same change set as the last Phase 5 fix so
      they are born green with no allowlist.
- [x] Re-run the Refactor 105 "Boundary Closeout And Final Split" checklist
      against the finished tree and record the result in that document's
      reconciliation note.

Exit: `pnpm check` fails on any new core-to-product, core-to-app, or
product-to-app import in `apps/wallet-console`.

Reconciliation: Phases 1–4 separated route, observability, signer-read, and
deployment ownership. Phase 5 now passes the composed routes, navigation,
approval integrations, and Wallet catalogs through `app/dashboardConfig.tsx`.
The core import scan is empty, the focused ESLint zones pass, and the Console
frontend type-check and production build succeed.

## Ordering And Independence

R120 and R121 source integration have landed. Refresh the
historical gap inventory, including the R121 control-port and migration scope.
Then Phases 1–4 (server) and Phase 5 (frontend) are independent and may proceed
in parallel. Phase 6 lands with or after Phase 5. Within the server work, Phase 1
before Phase 2 (the observability route families move with their routes);
Phases 3 and 4 are independent of both.

## Minimal Validation

- type-check and build the four Console packages and `apps/wallet-console`;
- `tests/unit/consoleSchemaOwnership.unit.test.ts` and the extended vocabulary
  assertions;
- `pnpm test:source-guards` (existing chain, unchanged scope) and the new
  lint zones via `pnpm check`;
- one composed Console flow exercising a core route and a wallet route through
  the recomposed route surface, plus one balance refresh against the
  projection;
- diff the generated Worker configuration to confirm the Console Worker lost
  its signer binding and gained nothing else.

No new test matrix, proof format, or duplicate lifecycle suite.

## Non-Goals

- renaming route paths (`/console/wallet/*`, `/dashboard/wallet/*`) — owned by
  [Refactor 105C](./refactor-105C.md);
- product entitlements, the product switcher's server-driven behavior, and
  per-product navigation filtering — Refactor 105C Phase 1;
- moving ops-cockpit/platform routes to `apps/seams-admin` — Refactor 99B;
- repository extraction, package renames, npm release — Refactor 105B;
- a product registry, manifest, dynamic loader, or generalized product SDK;
- generalizing policies, approvals, or sponsorship for a second product;
- changing wallet runtime, signer, custody, or billing behavior.

## Definition Of Done

- the core route table, observability policies, audit unions, core-only
  baseline, scripts, and frontend `core/` contain no wallet vocabulary or
  wallet imports;
- wallet routes, event policies, and UI slots are declared in wallet-owned
  modules and composed statically in the existing composition roots;
- the Console Worker configuration carries no signer D1 binding;
- lint zones enforce the frontend composition direction with no allowlist;
- the Refactor 105 closeout checklist passes against the current tree,
  unblocking Phase 7.
