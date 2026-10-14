# Separate Platform and Wallet consoles

Status: Wallet automatic setup and removal of Project services are implemented locally.
Separate frontend builds, account-route isolation, and domain cutover remain planned.
Date: October 14, 2026.

## Outcome

Build two Console frontends from the existing `apps/wallet-console` workspace.
Give each frontend its own entrypoint, route composition, build output, and domain.
Reuse the current shared UI, session, HTTP, and account code. Keep Satyr separate.

| Target domain             | Experience                                                                 | Source owner                                      |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| `console.seams.sh`        | Developer accounts, developer projects, account members, developer billing | Platform entrypoint in `apps/wallet-console`      |
| `console.wallet.seams.sh` | Wallet environments, credentials, sponsorship, and operations              | Wallet entrypoint in `apps/wallet-console`        |
| `satyr.seams.sh`          | Agents, Cases, workflows, and integrations                                 | Existing Satyr frontend in the `satyr` repository |

These are target domains, not a statement of current deployment. Current production
Console configuration uses `wallet.seams.sh`. Wallet marketing remains there.
Preserve `api.wallet.seams.sh`, `sign.seams.sh`, and Wallet passkey relying-party IDs.

This plan builds on [Shared Account Platform](feat-1-shared-account-platform.md).
[Monthly postpaid billing](feat-3-platform-billing.md) is a separate feature.

## Terminology and scope

Use the [Platform glossary](platform-glossary.md). Console account pages administer
developer accounts and developer projects. Satyr retains its native organisations,
users, and work projects. Existing routes, UI labels, identifiers, and storage names
remain unchanged by this documentation update. Project environments retain their
development/staging/production meaning.

## Reuse the existing structure

The dashboard already accepts a route composition. Wallet pages already depend on
shared components, session state, and HTTP code in `core`. Keep that code together.
The following entrypoint directories are illustrative; use the existing naming patterns.

```text
apps/wallet-console/
  src/
    app/
      platform/           Platform entrypoint and account route composition
      wallet/             Wallet entrypoint and product route composition
    core/                 Existing shared shell, UI, session, HTTP, account pages
    products/wallet/      Existing Wallet management pages
  Separate outputs:       Platform Console, Wallet Console, existing product assets

packages/console-server-ts/         Existing account and billing services
packages/console-shared-ts/         Existing shared contracts
packages/wallet-console-server-ts/  Existing Console Worker and Wallet integration
packages/wallet-console-shared-ts/  Existing Wallet contracts

deployment/console/                 Existing backend configuration
satyr/                             Separate repository, portal, and runtime
```

Keep the existing workspace and package names. Do not create `apps/console`, move
shared pages, extract a UI package, or build a new universal shell. Both compositions
can reuse the current shell with different routes and navigation.

Keep the Console Worker, `SatyrAccountPlatform`, and backend composition in their
current files. No schema relocation, migration discovery change, additional Worker,
or additional database is required.

## Product behaviour

- Platform owns developer account administration and developer billing. Keep one canonical page
  per account operation and mount it only in the Platform composition after cutover.
- Wallet remains a dedicated product console. Link shared account actions to Platform.
  Remove their local route registrations after the destination is available.
- Satyr retains its own frontend, native data, roles, and operational permissions.
  Developer account membership never bypasses Satyr content restrictions.
- Each product sets itself up through its own authenticated frontend. An authorised
  Wallet visit provisions an absent Wallet instance through the existing API. Satyr
  must use its own onboarding flow for the equivalent integration.
- Creating a developer account or developer project alone provisions neither product.
  Opening Wallet never provisions Satyr. Neither product needs a manual enable screen.
- Preserve deliberately disabled and archived states. Retry and reload must reuse
  accepted provisioning operations. Keep Project services absent from Wallet navigation.
- Product links may carry developer account and developer project identifiers. The destination checks
  access. URL identifiers grant no authority and must never contain session tokens.

Wallet automatic setup and the Wallet-only navigation change are committed locally.
Satyr's developer-account/project picker and automatic provisioning are implemented locally in
its own repository. Deploy the new private account onboarding endpoints before the
Satyr client. Record local acceptance and deployment separately.

## Step 1 — Separate the frontend builds

1. Add a Platform entrypoint and composition beside the Wallet entrypoint. Use explicit
   page imports and the existing router. Keep shared implementations in `core`.
2. Give each build explicit inputs and a separate output directory. A second HTML
   entry in one combined build does not establish independent deployment.
3. Ensure Platform startup excludes Wallet SDK initialisation, Wallet RPC, and Satyr
   requests. Scope showcase-only dependency resolution to showcase builds.
4. Preserve independent marketing, showcase, and hosted Wallet outputs and public
   asset paths. Keep company marketing in `apps/seams-site`. Do not copy pages or
   create another frontend workspace solely to change ownership labels.
5. Update existing build, local startup, CI, and deployment commands only where needed
   to select an output. Reuse current deployment utilities and configuration files.

Exit: both Console outputs build independently and display their intended routes.
Platform account pages load with both product runtimes unavailable. Current public
origins and shared account links remain usable until the domain cutover.

## Step 2 — Isolate account requests inside the existing Worker

The current handler constructs Wallet configuration and adapters before ordinary
Console requests. Fix that dependency where it exists, without moving the Worker.

```text
Existing Console Worker
  Existing Wallet internal early dispatch
  Shared account routes -> existing account-only services
  Wallet product routes -> existing Wallet services, constructed when needed
```

1. Trace shared requests through early dispatch, configuration parsing, authentication,
   and readiness checks. Remove only demonstrated product dependencies.
2. Select the existing account-only factory and router for shared routes. Construct
   Wallet services only for routes that need them. Reuse current route definitions,
   authentication, sessions, and permission checks.
3. Preserve Wallet early dispatch and required product checks. Keep `ensureSchema: false` during requests. Add no database calls, serial service calls, or awaited
   billing delivery to registration, unlock, signing, and response paths.
4. Preserve the private Satyr binding, its server-owned identity, signed user assertions,
   and public-ingress rejection. Keep scheduled provisioning and billing delivery
   independent of interactive requests and other products' retry failures.

Exit: shared account requests succeed with unrelated Wallet configuration invalid
and product runtimes unavailable. Wallet routes still reject invalid Wallet dependencies.
Affected Wallet query and service-call budgets do not increase.

## Step 3 — Validate the changed behaviour

Use existing E2Es and type fixtures. Read `tests/AGENTS.md` before changing tests.
Extend a journey only for missing behaviour. Add no unit tests or source-text guards.

| Change                                          | Required evidence                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Separate frontend outputs                       | Build both outputs and inspect their route compositions                                                |
| Shared UI and navigation                        | Browser journey through login, account pages, Wallet pages, and product links                          |
| Account-route isolation                         | Shared requests with invalid product configuration and unavailable runtimes                            |
| Changed Worker dispatch or service construction | Existing E2Es and call budgets for the affected Wallet paths                                           |
| Automatic product setup                         | Provision, lose a reply, reload, and recover without duplicate resources or cross-product provisioning |
| Domain routing and authentication               | Deployed staging journey across the target origins                                                     |

Run narrow checks while implementing. Run `pnpm check` for the shared backend change
and `pnpm test:scripts` when deployment scripts or workflows change. Classify failures
against current contracts before changing code or fixtures.

Keep repeatable commands, source revisions, build identifiers, screenshots, traces,
and relevant request results under `.artifacts/platform-console/`. Reuse prior evidence
when its implementation and deployment assumptions remain valid.

A frontend-only change needs no broad Wallet latency campaign. If Worker construction,
dispatch, or network routing changes, check the affected paths. Compare staging latency
under matching traffic and deployment conditions when those changes can affect it.
An unchanged filename does not prove unchanged request cost.

Exit: the changed journeys pass and relevant artifacts explain the result. Do not
repeat the completed account, billing, and migration acceptance work without cause.

## Step 4 — Stage and cut over the domains

1. Confirm the actual deployment state of earlier account-platform fixes and bindings.
   Keep this rollout separate from the deferred production Wallet rollout.
2. Deploy the two frontend outputs to `staging.console.seams.sh` and
   `staging.console.wallet.seams.sh`. Coordinate `staging.satyr.seams.sh` in Satyr's
   repository. Preserve existing Wallet API and signing staging origins.
3. Route each Console's allowed API paths to the existing Console Worker at the edge.
   Keep same-origin browser requests where practical. Add no server proxy hop.
   Satyr retains its native backend and private account binding.
4. Configure exact allowed origins, OAuth callbacks, cookie settings, invitation and
   email links, product links, and validated return destinations. Shared identity
   does not imply shared cookies. Do not broaden cookies to `.seams.sh` or introduce
   a new single-sign-on protocol. Test required reauthentication explicitly.
5. Verify access at each destination, including revoked and foreign project selections.
   Test Wallet automatic setup and Satyr's own onboarding separately. Preserve binding
   names and logical assertion issuers/audiences unless a coordinated change requires it.
6. Deploy to the agreed production domains after staging passes. Redirect old browser
   account and Wallet links to their correct destinations at the request boundary.
   Do not redirect state-changing API calls or keep duplicate page implementations.
   Record removal criteria for temporary transition rules.

Keep previous frontend and backend artifacts and edge configuration available for
rollback. Restore compatible artifacts and routes without reversing shared data.
Preserve exact released Wallet package versions throughout. Deploying Console must
not require publishing Wallet or deploying either product runtime.

Exit: Platform, Wallet, and Satyr have separate browser frontends at their agreed
domains. Shared account pages work independently of product runtimes. Existing Wallet
signing, asset locations, permissions, persistence, and commercial behaviour remain intact.
Report local validation, staging deployment, and production deployment separately.
