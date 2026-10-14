# Separate Platform and Wallet consoles

Status: implementation is committed on `codex/feat-2-platform-console`. The staging backend and frontend artifacts are deployed.
Staging DNS, identity-provider acceptance, and production cutover remain pending.
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
   `console.staging.wallet.seams.sh`. Coordinate `staging.satyr.seams.sh` in Satyr's
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

The available Cloudflare credentials can deploy Workers and Pages, but DNS creation
returns HTTP 403. Custom domains are registered and await DNS validation. Google
JavaScript origins also require configuration. Existing login and Console security
origins remain active while those prerequisites are incomplete.

Deployed staging artifacts:

| Component                                               | Version or deployment identifier       | Verified result                                                                |
| ------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| Existing Console Worker                                 | `bfb78906-3e0a-4a18-8986-6de9e7f8aabe` | Health and readiness return HTTP 200; unauthenticated session returns HTTP 401 |
| Platform Pages project `seams-platform-console-staging` | `0f2bcca5-2907-41d3-a223-cb824dd4f3b5` | `/dashboard/login` returns HTTP 200 on its Pages hostname                      |
| Wallet Pages project `seams-console-wallet-staging`     | `ad6ef66e-4243-46e1-a335-b2475f0983b0` | `/dashboard/login` returns HTTP 200 on its Pages hostname                      |

The first Wallet Pages project returned HTTP 522 for static files. The same artifact
serves successfully from the replacement project above. The staging CI mapping now
selects that replacement. Both custom domains remain pending DNS validation.

The Worker retains the existing database, service bindings, secrets, and placement.
Its source revision is `89b317ba60b72f6de03a9f21d74c6ac07fdfea30`. After migration
`0098`, use compatible Worker version `5fce7e3c-ff91-488d-a880-7dc2b6eb2ac2` as the
rollback baseline. Keep migration `0098` applied during rollback.

Finish the DNS and provider actions below, then run both frontend `smoke` commands.
Verify real sign-in, reauthentication, context selection, rejected foreign access,
billing, and Wallet automatic setup on the custom staging domains.
Coordinate Satyr onboarding acceptance separately when its private connection is configured.
Repeat the verified sequence for production after staging acceptance passes.
Deploy marketing redirects only after both Console frontends pass readiness checks.
The `all` command checks all project mappings before deploying Console frontends.

Keep the deferred Wallet runtime rollout separate. No production cutover is implied
by a green local test or by this branch's deployment configuration.

## Remaining staging actions

Add these proxied CNAME records in the existing `seams.sh` DNS zone:

| Name                     | Target                                     |
| ------------------------ | ------------------------------------------ |
| `staging.console`        | `seams-platform-console-staging.pages.dev` |
| `console.staging.wallet` | `seams-console-wallet-staging.pages.dev`   |

In Google Cloud project `seams-501403`, add these Authorized JavaScript origins to
the existing web OAuth client. Keep its current origins and client identity:

- `https://staging.console.seams.sh`
- `https://console.staging.wallet.seams.sh`

GitHub callback selection now follows only approved Console origins. This keeps
OAuth browser state on the initiating frontend. The same callback URI reaches the
server-side code exchange. Unapproved origins cannot select a new callback.

In the existing GitHub OAuth app, register or verify these exact callback URLs.
Keep the current callback available during acceptance:

- `https://staging.console.seams.sh/dashboard/login`
- `https://console.staging.wallet.seams.sh/dashboard/login`

After DNS and both identity providers are configured, verify both custom domains and
sign-in. Change the Console base URL and security origin to their generated cutover
values, then verify Console passkey step-up and account email links.
Keep the current staging entrypoints until acceptance passes. Production remains unchanged.

The available Cloudflare token cannot write these DNS records. Provider settings also
remain unverified. These external prerequisites block full staging acceptance.
Deployment evidence and pending actions are recorded in
`.artifacts/platform-console/rollout/report.json`.

Staging has no configured Satyr account-service identity or provisioning connection.
Native Satyr onboarding acceptance requires that separate connection and deployment.
Shared account access must continue to work while Satyr is unavailable.
