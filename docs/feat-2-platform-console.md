# Separate Platform and Wallet consoles

Status: implementation is committed on `codex/feat-2-platform-console`.
The staging backend and frontends are deployed. DNS and identity providers are configured.
Wallet Google and GitHub sign-in, account navigation, and the staging origin cutover pass.
Satyr staging and its private account connection are deployed.
Satyr Google sign-in and automatic setup pass. Invitation acceptance is implemented.
Live Satyr workspace entry passes. Setup completes without an automatic page reload.
Saved appearance applies before the first visible frame. The organisation list has one loading layout.
Production cutover remains pending.
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
- Platform accepts invitation links before the Dashboard membership check. Verified
  recipients can join an existing developer account without creating another account.
  Keep the invitation token and verified-email checks in the existing access service.

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
| Existing Console Worker                                 | `1b9dbae7-e518-4e33-916c-87dc638695c9` | Satyr account verification and public provisioning routing pass                 |
| Platform Pages project `seams-platform-console-staging` | `b7980093-1906-439c-bac7-f5375b4f3043` | Invitation acceptance loads on its custom hostname                              |
| Wallet Pages project `seams-console-wallet-staging`     | `607ce87f-6746-4b47-ad20-928e262dfacf` | Wallet invitation links open Platform; existing Wallet access remains available |

The first Wallet Pages project returned HTTP 522 for static files. The same artifact
serves successfully from the replacement project above. The staging CI mapping now
selects that replacement. Production deployments are unchanged.

The Worker retains the existing database, service bindings, secrets, and placement.
Its payload source revision is `e2f0aee77d0f95986f205532d9ae05fd233e9de5`.
Configuration revision `7ef775d307ae4c4591449c7bb82cceb04a88777a` adds public fetch routing
to Console. The latest deployment fixes Google verification and native provisioning for Satyr account setup.
It retains invitation redemption through the current hosted authentication boundary.
Secret bindings, database bindings, service bindings, placement, and
security origins match the previous deployment. No migration was required.
Worker version `53dbddce-d846-4c53-990e-0e5217c38e7b` provides rollback to
the state before invitation acceptance, with the Satyr connection and new origins intact.
The earlier Satyr connection added two separate provisioning secrets through the
existing configuration boundary. Version `606f4f0d-e5e5-4803-a83d-129c2773a56b`
remains available for rollback before that connection.
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

Frontend revision `6c1e149bf3ea8c95d201a5847185bfe6f158049d` introduced this fix.
Real Wallet Google sign-in opens the existing staging account and project. Wallet's
existing active instance and three environments are confirmed by read-only database
queries. New automatic provisioning is verified by the isolated browser journey.
Wallet-to-Platform navigation and the return link preserve the selected project.
A browser data reset is no longer required for this acceptance check.

The live Wallet GitHub exchange now has a redacted HTTP trace. Its callback returns
HTTP 200. The unscoped identity follows the account handoff, and Wallet keeps its
provider choices available on the next visit. Google sign-in restores the existing
Wallet project. The trace saves paths, methods, status codes, and timestamps only.

Platform now has an invitation acceptance page. Wallet invitation links redirect to
that page. A pending invitation stays in same-origin session storage through sign-in.
Its token is removed from the address before sign-in and cleared after acceptance
or when the recipient leaves. Provider callbacks remain fixed.

The existing hosted authentication boundary accepts both identity and organization
sessions for invitation redemption. The existing access service checks the recipient's
verified email, token, invitation state, and project grant. Acceptance issues an
organization session through the current signing code. No schema change is required.
The browser journey verifies a recipient with no developer account, wrong accounts,
invalid tokens, replay, revoked links, and preserved project access. It also confirms
that Platform acceptance sends no Wallet provisioning request.

Invitation acceptance is deployed from revision
`42e6693c7c7e6df8caa17cce01e8a71150441542`. The release snapshot uses a fresh
frozen-lockfile install of Wallet packages `0.10.2`. It excludes local package
overrides and unrelated working changes. Both builds and release type checks pass.
Five focused tests pass against the release snapshot, including the browser journey.
`pnpm check` also passes in the main checkout. Platform includes no Wallet SDK source.
Live checks verify the acceptance page, Wallet redirect, token removal from the
address, anonymous rejection, invalid-link rejection, and return to account settings.
Staging captures account emails locally. No external invitation message was sent.

Manual Satyr sign-in reached the callback after browser control was canceled.
An earlier callback then failed state validation. A fresh attempt passed Google
verification in Satyr but failed the Platform account link with `scope_forbidden`.
The private trace places that failure in Platform's Google verifier, after signed
request and body-digest checks passed.

The production account entrypoint passed the Worker's global `fetch` as an unbound
callback. The Google-key loader invokes that callback as an object method, which
causes an illegal-invocation error in workerd. The native provisioning transport
had the same wiring defect. Both callbacks now use the existing bound-fetch pattern.
Provider failures return `authority_unavailable`; invalid identities still fail closed.
Worker version `cc1a38b2-993c-446e-8bae-0204c2aec465` deploys this fix to staging.
Both Console readiness endpoints and native Satyr health return HTTP 200.
The temporary diagnostic logs are removed from the deployed bundle.

The new `satyr-account-worker.e2e.test.ts` runs the actual bundled production
entrypoint in workerd. It intercepts provider HTTP at the runtime boundary and
retains native global fetch. The journey verifies a provider outage, a rejected
identity mismatch, account/project creation, one Satyr provision, and replay.
It writes an artifact digest and sanitized results. Run it against the Worker bundle:

```sh
SEAMS_CONSOLE_WORKER_ARTIFACT=/absolute/path/to/d1ConsoleStagingWorker.js \
  pnpm -C tests exec playwright test -c playwright.config.ts \
  e2e/console/satyr-account-worker.e2e.test.ts --reporter=line
```

The journey fails against the previous bundle before Google receives a request.
It passes against the deployed fixed bundle and records one active Satyr instance.
The local workerd binary supports July 17, 2026. The live Worker uses July 18.
Fresh manual sign-in passes on the live Worker. Read-only staging records confirm
that Satyr linked the native identity to Platform after the fixed deployment.
The browser opened `/portal%20i`, which does not match a Portal page. Return to
organisations restored `/portal`, and the user selected an existing account and project.
The accepted setup operation completed after 274 seconds. Console and Satyr agree
on one active instance, one native organisation, and matching revision-one receipts.
The user confirmed organisation or workspace entry after refresh on October 15, 2026.
Paired live probes identified a Cloudflare routing fault. During an HTTP invocation,
Console's global fetch bypassed the same-zone Satyr Worker and returned HTTP 522.
The same awaited requests from its scheduled invocation reached Satyr and returned
HTTP 200 for health and HTTP 403 for unsigned provisioning. Adding
`global_fetch_strictly_public` to Console alone made both contexts reach Satyr.
Response hashes matched the public controls. Wallet Gateway and Runtime flags stay unchanged.
This verifies the measured routing fault; it does not identify every historical defer.
The final release removes the temporary probe endpoints and logs.
See [Cloudflare's public fetch routing flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public).

Portal setup completion now refreshes account state without reloading the document.
An already visible organisation needs no second session or organisation read.
The user confirmed one load and estimated about five seconds, down from about ten.
They later reported about 3.5 seconds with three loading layouts.
Saved appearance now applies in the document head before React starts. System mode
follows the browser setting. Account preferences remain authoritative after sign-in.
The browser journey verifies uncertain acceptance, operation replay, pending delivery,
workspace entry, and the first visible Dark frame. It passes against local builds
and published staging assets with mocked account APIs. Real account setup and
workspace entry were confirmed separately by the user.
The user also confirmed Dark mode starts without a Light flash.

The organisation list now uses one loading layout with its final heading and navigation.
Its page code loads with Portal. Validators and Portal code load together.
On return visits, remembered organisation identifiers start fresh authorised reads
alongside the session request. Authenticated memberships still select every displayed
organisation. A rejected early read cannot disclose a revoked organisation.
Live traces before this change measured about one second for the session, followed
by about 2.3 seconds for organisation details. The browser reproduction confirms
that the reads now overlap. It does not measure the user's final network latency.
A first visit without remembered identifiers still needs the session before organisation reads.

The user confirmed one layout but reported nine seconds after that release.
Slow requests entered through PDX; the earlier requests entered through NRT.
Read-only database probes place the global primary in HKG and both regional and account primaries in SIN.
Staging configuration revision `a54088ad53b54fe8860b1153d19401698016e31f` now requests
`aws:ap-southeast-1` placement. A live health response reports `cf-placement: remote-SIN`.
Application assets match the previous build. Existing bindings and access checks pass.
This is a deployment control for the location hypothesis. Its effect on authenticated
startup time still needs the user's refresh and matching request timings.

Satyr now serves its native Portal at `https://staging.satyr.seams.sh/portal`.
Its staging profiles use separate databases, queues, KV, archive storage, sessions,
encryption keys, and service-signing keys. The private account binding targets
`seams-sdk-d1-console-staging`, entrypoint `SatyrAccountPlatform`.
The existing `staging-console` GitHub environment holds the connection settings.
Satyr source revision `5eb4152e3064372d21f1a0036903c5606bafe478` includes the staging
profiles, regional recovery fixes, setup refresh, startup appearance, and overlapping reads. Its button says
Set up Satyr. The empty page explains automatic setup through project selection.
Native Worker version `5671d1bd-d0ce-4bde-b4ce-0bfd5aadb3ef` contains these changes and the staging placement hint.
The release uses committed source and excludes concurrent model edits. Containers
are unchanged. Native health and unauthenticated access checks pass.
The approved native Google redirect is saved on the existing Satyr Portal client:
`https://staging.satyr.seams.sh/v1/control/auth/google/callback`.
Browser protections remain unchanged.

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

1. Measure authenticated startup after the staging placement change. The user confirms
   one layout. The effect of the new execution location remains unmeasured.
2. Repeat the verified sequence for production after staging acceptance passes.
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
