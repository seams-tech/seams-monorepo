# Separate Platform and Wallet consoles

Status: implementation is committed on `codex/feat-2-platform-console`.
The staging backend and frontends are deployed. DNS and identity providers are configured.
Wallet Google and GitHub sign-in, account navigation, and the staging origin cutover pass.
Satyr staging and its private account connection are deployed.
Satyr's Google callback awaits approval. Invitation acceptance scope and production cutover remain pending.
Date: October 15, 2026.

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

Wallet automatic setup and the Wallet-only navigation change are deployed to staging.
Satyr's developer-account/project picker and automatic provisioning are deployed to
its isolated staging environment. Its existing private account onboarding endpoints
are available before browser acceptance. Record local acceptance and deployment separately.

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
   `console.staging.wallet.seams.sh`. Coordinate `staging.satyr.seams.sh` in Satyr's
   repository. Preserve existing Wallet API and signing staging origins.
3. Route each Console's allowed API paths to the existing Console Worker at the edge.
   Keep same-origin browser requests where practical. Add no server proxy hop.
   Remove any previous whole-host Worker binding on a frontend hostname before
   assigning its Pages CNAME. Preserve the Worker routes for the allowed API paths.
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

## Local implementation and rollout handoff — October 15, 2026

The existing workspace now has two explicit Console builds. The default Vite build
owns Wallet marketing and showcases. The hosted Wallet keeps its existing build.
No shared pages, Worker entrypoints, schema files, or public Wallet packages moved.

```sh
pnpm -C apps/wallet-console build:platform
pnpm -C apps/wallet-console build:wallet
pnpm -C apps/wallet-console build:marketing

node scripts/deploy-surface.mjs plan --site staging --component platform-console
node scripts/deploy-surface.mjs build --site staging --component platform-console
node scripts/deploy-surface.mjs plan --site staging --component wallet-console
node scripts/deploy-surface.mjs build --site staging --component wallet-console
```

Outputs are `apps/wallet-console/dist-platform`, `dist-wallet`, and `dist`.
`pnpm site` starts Platform at `http://localhost:4007`, Wallet through the existing
`http://localhost:4001/dashboard` route, and marketing through `/wallet`.
The existing local backend must be available. The managed Console acceptance
startup also starts both Console frontends.

The deployed Worker selects existing account services before Wallet configuration
construction. Billing retains its existing handlers, customer webhooks, balance
notifications, observability, and sponsored-spend summaries through narrow storage
composition. Wallet lifecycle mutations keep their existing product adapters.
Wallet internal early dispatch and scheduled delivery remain in place.

Console frontend targets live in `deployment/console/targets.json`. Existing account
stores remain separate by deployment lane. Production testnet retains its existing
API origin; staging and mainnet can use the new same-origin Worker routes. Product
links preserve the selected network, developer account, and developer project.
This change performs no account merge or data migration.

Local validation and evidence:

- `pnpm check` and `pnpm -C tests type-check:console`.
- The existing service-auth E2E now exercises account onboarding, members, and
  billing with invalid Wallet configuration and unavailable Satyr metadata.
- The browser journey builds both frontends, follows the Wallet-to-Platform link,
  checks project context, and recovers automatic Wallet setup after a lost reply.
- The extended journey reauthenticates an unscoped Wallet identity through the fixed
  GitHub callback. It preserves the requested project and network before environment
  selection. Development then selects Testnet through the existing environment rules.
  It also switches owned accounts, handles an incomplete previous account, rejects
  foreign selections on both Wallet pages and `/dashboard`, and preserves disabled state.
- Existing funds, usage, settlement, and Wallet request-budget E2Es remain applicable.
- `.artifacts/platform-console/` contains command logs, bundle hashes, screenshots,
  traces, the initial worktree snapshot, and Cloudflare prerequisite observations.
  The Platform JavaScript source maps contain no Wallet SDK source modules.

Staging rollout began on October 15, 2026. Protected Console credentials were
available in the existing local deployment file. Both staging Console Pages projects
now exist, and their project mappings are configured in the staging GitHub environment.
The active staging database backup and recovery bookmark were captured before applying
`0098_account_delivery.sql`. No migrations remain pending on that database.

The staging Wallet Console uses `console.staging.wallet.seams.sh`. Its hostname is
inside the existing Console security relying-party ID, `staging.wallet.seams.sh`.
The earlier `staging.console.wallet.seams.sh` hostname could not use those credentials.
Production retains `console.wallet.seams.sh`. Wallet signing relying-party IDs are unchanged.

Both custom domains are active. Their application HTML and account session smoke
checks pass. The API token cannot write DNS, so the records were configured through
the authenticated Cloudflare dashboard. The previous whole-host Worker binding on
`staging.console.seams.sh` was removed. Its `/console` API routes remain in place.
Google JavaScript origins and exact GitHub callbacks were saved in the existing clients.

Deployed staging artifacts:

| Component                                               | Version or deployment identifier       | Verified result                                                                 |
| ------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| Existing Console Worker                                 | `53dbddce-d846-4c53-990e-0e5217c38e7b` | Shared account readiness passes; private Satyr staging connection is configured |
| Platform Pages project `seams-platform-console-staging` | `acdc1857-26cd-417d-a2b1-d724959c6ced` | `/dashboard/login` returns HTTP 200 on its custom hostname                      |
| Wallet Pages project `seams-console-wallet-staging`     | `3132b4b2-426a-49d8-bf02-2648355e10ea` | Google sign-in opens the requested project on the Wallet hostname               |

The first Wallet Pages project returned HTTP 522 for static files. The same artifact
serves successfully from the replacement project above. The staging CI mapping now
selects that replacement. Production deployments are unchanged.

The Worker retains the existing database, service bindings, secrets, and placement.
Its source revision is `89b317ba60b72f6de03a9f21d74c6ac07fdfea30`. The latest Worker
deployment adds the Satyr connection through the existing configuration boundary.
The same payload, existing secret bindings, database bindings, service bindings,
and placement are preserved. Two separate provisioning secrets were added.
Worker version `606f4f0d-e5e5-4803-a83d-129c2773a56b` provides immediate rollback to
the state before the Satyr connection, with the new Console origins intact.
Compatible post-migration version
`5fce7e3c-ff91-488d-a880-7dc2b6eb2ac2` remains available. Keep migration `0098` applied.

Real Google sign-in opens the existing staging account on Platform. Its account
settings, members, billing account, and invoice pages load. GitHub sign-in on Platform
reaches initial account onboarding for the test identity. No developer account or
developer project was created during this check. Shared account access works without a Satyr connection.

The domain split exposed an unscoped-session loop that prevented Wallet
reauthentication. Wallet now keeps the provider choices available. Explicit sign-in
with a new identity still opens Platform onboarding. The fixed callback preserves
account and project hints in existing UI preferences. The destination resolves them
against authenticated account and project lists before Wallet setup can run.

Frontend revision `6c1e149bf3ea8c95d201a5847185bfe6f158049d` contains this fix.
Real Wallet Google sign-in opens the existing staging account and project. Wallet's
existing active instance and three environments are confirmed by read-only database
queries. New automatic provisioning is verified by the isolated browser journey.
Wallet-to-Platform navigation and the return link preserve the selected project.
A browser data reset is no longer required for this acceptance check.

The live Wallet GitHub exchange now has a redacted HTTP trace. Its callback returns
HTTP 200. The unscoped identity follows the account handoff, and Wallet keeps its
provider choices available on the next visit. Google sign-in restores the existing
Wallet project. The trace saves paths, methods, status codes, and timestamps only.

Satyr now serves its native Portal at `https://staging.satyr.seams.sh/portal`.
Its staging profiles use separate databases, queues, KV, archive storage, sessions,
encryption keys, and service-signing keys. The private account binding targets
`seams-sdk-d1-console-staging`, entrypoint `SatyrAccountPlatform`.
The existing `staging-console` GitHub environment holds the connection settings.
Satyr source revision `0fc42528e945d02e501a699a3ecbd456268318a7` includes the staging
profiles and regional recovery fixes. The release uses committed source and excludes
concurrent model edits. Native health and unauthenticated access checks pass.

Satyr validation includes 2,374 passing tests, backend and test type checks, Portal
and storefront builds, the shared-account onboarding E2E, and regional recovery.
The E2E JSON reports retain their checks and source artifact hashes. Other regional
journeys still need fixtures that establish current account-service eligibility.
Production profiles and deployments remain unchanged by this rollout.

Custody admin pages remain part of the deferred Wallet rollout. Their deployment
flag remains disabled. Keep live passkey verification with that rollout. This
Console change preserves the relying-party ID and verifies the configured security origin.

The domain split also exposed a broken Contact sales link. Both login builds now
link to the existing company page at `https://seams.sh/contact`.

Keep the deferred Wallet runtime rollout separate. No production cutover is implied
by a green local test or by this branch's deployment configuration.

## Staging configuration

These proxied CNAME records are configured in the existing `seams.sh` DNS zone:

| Name                     | Target                                     |
| ------------------------ | ------------------------------------------ |
| `staging.console`        | `seams-platform-console-staging.pages.dev` |
| `console.staging.wallet` | `seams-console-wallet-staging.pages.dev`   |

Google Cloud project `seams-501403` now allows these JavaScript origins on the existing
Seams Web (Staging) client. Its previous origins and client identity are preserved:

- `https://staging.console.seams.sh`
- `https://console.staging.wallet.seams.sh`

GitHub callback selection now follows only approved Console origins. This keeps
OAuth browser state on the initiating frontend. The same callback URI reaches the
server-side code exchange. Unapproved origins cannot select a new callback.

The existing Seams Wallet OAuth app owned by `seams-tech` now has these exact callbacks.
Wildcard matching remains disabled. Existing callbacks are preserved during acceptance:

- `https://staging.console.seams.sh/dashboard/login`
- `https://console.staging.wallet.seams.sh/dashboard/login`
- `https://staging.wallet.seams.sh/dashboard/login`

Remaining actions, in order:

1. Approve the prepared Google redirect on the existing Satyr Portal client:
   `https://staging.satyr.seams.sh/v1/control/auth/google/callback`.
   The browser confirmation policy requires approval before saving this new trusted
   destination. Then verify Google sign-in and automatic setup through Satyr's own app.
2. Resolve the pre-existing account invitation gap before accepting email links.
   Emails target `/dashboard/invitations/accept`, but both frontends lack that page.
   First-time recipients also need an identity-based redemption boundary.
   The user is deciding whether to include this work in the current rollout.
3. Repeat the verified sequence for production after staging acceptance passes.
   Confirm production Satyr's existing organizations and private account connection
   before releasing its account-service admission changes. Its current live Worker
   lacks the source configuration's `ACCOUNT_PLATFORM` binding.
   Deploy marketing redirects after both Console frontends pass readiness checks.
   Retire old callbacks and browser routes after their links and in-flight sign-in
   journeys no longer need them. The `all` command checks all project mappings before
   deploying Console frontends.

The active staging configuration now uses `CONSOLE_BASE_URL=https://staging.console.seams.sh`
and `CONSOLE_STEP_UP_ORIGIN=https://console.staging.wallet.seams.sh`.
`CONSOLE_STEP_UP_RP_ID=staging.wallet.seams.sh` is preserved. Keep old entrypoints
available until the remaining acceptance checks pass. Deployment evidence, screenshots, and pending actions are recorded
under `.artifacts/platform-console/rollout/`, including `report.json` and `signin-journey.json`.
