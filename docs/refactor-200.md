# Refactor 200 — Seams Wallet Cloudflare account migration plan

Create fresh Seams infrastructure in the Cloudflare account owned by `seamsadmin@gmail.com`.
Move traffic from the account identified as `n63878056@gmail.com`.
Remove the source Seams resources after verification to isolate future Cloudflare billing.

Existing wallets, organisations, projects, sessions, signing material, and application records can be discarded.
Create empty destination storage and new deployment keys.
Keep the public hostnames and the current application behaviour.
Use a planned maintenance window for the account and domain cutover.

Status: proposed plan, October 21, 2026. No Cloudflare resources changed.
The inventory below comes from repository configuration and the installed `@seams/wallet-server@0.15.6` package.
Phase 1 must reconcile it against both live Cloudflare accounts before execution.

## Scope and completion conditions

- Move all three lanes: `staging-testnet`, `production-testnet`, and `production-mainnet`.
- Recreate all four wallet regions: `US`, `WEUR`, `APAC`, and `OC`.
- Include Console, Gateways, Wallet Runtime, Router, Deriver A, Deriver B, and SigningWorker.
- Include the tenant-root control plane, Durable Objects, D1, R2, Pages, DNS, certificates, secrets, and scheduled work.
- Include all deployed benchmarks, diagnostic Workers, and resources absent from checked-in targets.
- Recreate any additional Seams service found during the live inventory.
- Preserve unrelated workloads and their credentials in the source account.

The migration is complete when every retained Seams resource belongs to the destination account.
Every regional product flow must pass there.
The source account must have no active Seams traffic, scheduled work, storage, or Seams-only subscriptions.
Record residual charges from earlier usage separately from new usage.

Cloudflare account ownership uses account IDs.
Record both IDs before execution and require the destination ID for every destination command.
Changing a login email or inviting another administrator does not accomplish this resource migration.
Check the source email against the account ID because Console support addresses use a different spelling, `n6378056@gmail.com`.

## Resource inventory

### Backend resources

These counts describe the configured baseline. They exclude diagnostic and benchmark resources.

| Resource                                   | Per lane | All three lanes | Destination action                          |
| ------------------------------------------ | -------: | --------------: | ------------------------------------------- |
| Regional Gateway Workers                   |        4 |              12 | Recreate with regional service bindings     |
| Regional Wallet Runtime Workers            |        4 |              12 | Recreate with regional signer D1 bindings   |
| Console Workers                            |        1 |               3 | Recreate with all regional bindings         |
| Router, A, B, SigningWorker, control plane |        5 |              15 | Recreate the complete service graph         |
| **Total backend Workers**                  |   **14** |          **42** | Preserve role separation                    |
| Console D1 databases                       |        1 |               3 | Create empty and apply Console migrations   |
| Regional signer D1 databases               |        4 |              12 | Create empty and apply signer migrations    |
| Role-private D1 databases                  |        3 |               9 | Create A, B, and SigningWorker storage      |
| **Total D1 databases**                     |    **8** |          **24** | Replace every source database ID            |
| Durable Object namespaces                  |        6 |              18 | Create through their owning Workers         |
| Deriver backup R2 buckets                  |        2 |               6 | Create empty with separate A and B bindings |

`deployment/wallet-system/targets.json` defines Gateway names.
Wallet Runtime names replace `gateway` with `wallet-runtime` in each regional Gateway name.
The APAC Gateway also serves as the public ingress in each lane.

The shared Console database must have the same destination ID in both target files.
Its current names are `seams-console-sin-candidate-20261014`, `seams-console-testnet-sin`, and `seams-console`.
The dated staging name can become `seams-console-staging-sin` in the destination.
Use the final name consistently in targets, manifests, and bindings.

### Regional placement

Worker placement, D1 placement, and Durable Object placement are separate settings.
Check all three for each region.

| Wallet region | Gateway and Runtime placement | D1 creation hint | Wallet and presign DO hint |
| ------------- | ----------------------------- | ---------------- | -------------------------- |
| `US`          | `aws:us-east-1`               | `enam`           | `enam`                     |
| `WEUR`        | `aws:eu-west-2`               | `weur`           | `weur`                     |
| `APAC`        | `aws:ap-southeast-1`          | `apac`           | `apac-se`                  |
| `OC`          | `aws:ap-southeast-2`          | `oc`             | `oc`                       |

The three private D1 databases in each lane require a primary in `SIN`, the Singapore data centre.
Deployment preflight enforces this requirement through `d1PrimaryColo`.
Create them with `apac`, then check primary query metadata before deployment.
A location hint cannot guarantee Singapore.
Keep this check and resolve a placement mismatch before proceeding.

The staging Console primary currently serves from Singapore.
Preserve that placement when recreating its database.
Measure the other Console primaries during inventory and preserve their required placement.
Record primary location and read-replication settings for all 24 destination databases.
Use a primary-served query when checking location.
Replica metadata alone does not establish primary placement.

Cloudflare treats location hints as preferences.
Jurisdiction restrictions are separate controls and require explicit preservation when present.
See [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/).

### Durable Object ownership

| Owning Worker | Classes created per lane                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Router        | `RouterAbTenantRootCreationDurableObject`, `RouterAbRouterWalletDurableObject`                 |
| Deriver A     | `RouterAbDeriverAWalletDurableObject`                                                          |
| Deriver B     | `RouterAbDeriverBWalletDurableObject`                                                          |
| SigningWorker | `RouterAbSigningWorkerWalletDurableObject`, `RouterAbSigningWorkerPresignSessionDurableObject` |

The control plane and both derivers bind the Router's creation namespace externally.
They do not own additional copies of that namespace.

Regional wallet objects share these class namespaces.
Authenticated wallet-home metadata supplies their placement hints when the system creates objects.
Recreate all namespaces and preserve this regional routing behaviour.
New registrations must allocate destination object IDs.
Discard source object IDs, relocation records, alarms, and signing state.

Only the first location hint for an object takes effect.
Use a new wallet for each regional verification flow.
Check requested placement and observed host location separately.
See [Durable Object data location](https://developers.cloudflare.com/durable-objects/reference/data-location/).

### Frontends and public hostnames

Create destination Pages projects for every configured surface.
The baseline has five staging deployments and six production deployments, with separate testnet and mainnet wallet hosts.
Resolve actual project names and any project sharing from GitHub environment values during inventory.
Choose available destination project names and update the existing `CF_PAGES_PROJECT_*` values.

| Surface                           | Staging                           | Production                                        |
| --------------------------------- | --------------------------------- | ------------------------------------------------- |
| Company site                      | `staging.seams.sh`                | `seams.sh`                                        |
| Wallet site and public docs       | `staging.wallet.seams.sh`         | `wallet.seams.sh`                                 |
| Wallet host                       | `staging.sign.seams.sh`           | `test.sign.seams.sh`, `sign.seams.sh`             |
| Platform Console                  | `staging.console.seams.sh`        | `console.seams.sh`                                |
| Wallet Console                    | `console.staging.wallet.seams.sh` | `console.wallet.seams.sh`                         |
| Gateway                           | `staging.api.wallet.seams.sh`     | `test.api.wallet.seams.sh`, `api.wallet.seams.sh` |
| Dedicated testnet Console backend | —                                 | `test.console.seams.sh`                           |

Preserve Console path routes on the site and Console hosts.
DNS records alone do not recreate those routes.
Inventory redirects, additional hostnames, and certificate coverage from the live zone.

## Phase 1 — Record the complete source inventory

1. Identify source and destination account IDs through Cloudflare account access.
2. Export all source Workers, their versions, settings, bindings, routes, domains, placement, limits, and cron schedules.
3. Export all DO namespaces with their owning Workers, classes, storage types, and external references.
4. Export all D1 databases with IDs, locations, replication settings, and migration state.
5. Export R2 bucket settings, locations, jurisdictions, lifecycle rules, public access, domains, and event notifications.
6. Export Pages projects, domains, build settings, deployment methods, variables, and secret names.
7. Export the `seams.sh` zone, registrar details, DNSSEC state, certificates, and zone settings.
8. Export relevant WAF, redirect, cache, rate-limit, Access, Tunnel, and email-routing configuration when present.
9. Enumerate KV, Queues, Workflows, Secrets Store, Analytics Engine, and other enabled products for additional Seams dependencies.
10. Record account subscriptions, Seams usage, renewal dates, quotas, and invoice delivery settings.
11. Inspect deployment credentials in both repositories, GitHub environments, organisation secrets, local files, and other deployment machines.
12. Assign every discovered Seams resource a destination resource and record its dependencies.

Inspect the full account inventory before filtering by names.
Shared resources and renamed Workers can have names without a `seams` prefix.
Record any shared dependency that must be separated before deletion.

The public repository contains Yao benchmarks, transport probes, fault scenarios, hosted fixtures, and ML-DSA experiments.
Move all deployed experiments and their companion Workers together.
Inspect embedded peer URLs and any intentional cross-account topology.
Do not omit deployed experiments because their configurations look old.
Preserve historical evidence files and the configuration needed to reproduce retained experiments.

Use a private evidence directory such as `.artifacts/cloudflare-account-migration-20261021/`.
Record source ID, destination ID, lane, role, region, dependencies, and disposition for every resource.
Reuse this inventory as the deletion checklist.
Store secret values only in the existing protected deployment files or secret manager.

**Exit condition:** every source Seams resource and shared dependency has a recorded disposition.

## Phase 2 — Prepare the dedicated account and billing

1. Verify the `seamsadmin@gmail.com` account and enable multi-factor authentication.
2. Store recovery codes and administrator access through the team's existing secure process.
3. Configure the Seams billing profile, payment method, invoice address, and budget alerts.
4. Enable the required Workers, D1, DO, R2, Pages, and other inventoried services.
5. Check quotas against the complete inventory, including deployed experiments and temporary verification resources.
6. Create destination-scoped deployment tokens using the existing Console and Wallet authority separation.
7. Configure the destination Workers subdomain and record its new `workers.dev` suffix.
8. Prepare the destination DNS zone and copy required zone settings.

Use the explicit destination account ID even when Wrangler can discover only one account.
Keep source credentials separate for inventory and later removal.
Use fresh protected values files so old private D1 IDs and account credentials cannot enter destination preparation.
Check shell variables because the Wallet preparation command gives them precedence over values files.

**Exit condition:** the destination account can create every required resource with Seams billing attached.

## Phase 3 — Prepare fresh storage, keys, and deployment support

### Storage and configuration

1. Create the three Console databases, twelve regional signer databases, and nine private databases in the destination account.
2. Apply creation hints and any required jurisdiction settings from the inventory.
3. Check primary locations before accepting their IDs.
4. Replace Console and regional D1 IDs in `deployment/wallet-system/targets.json`.
5. Replace the matching Console IDs in `deployment/console/targets.json`.
6. Supply destination private D1 IDs through the existing `ROUTER_AB_*_PRIVATE_D1_ID` variables.
7. Create the six R2 buckets with the final names from the packaged deriver manifests.
8. Apply complete migration sets to the empty databases through the existing deployment commands.

Wallet environment preparation can create or discover the three private D1 databases.
It reads Console and regional signer database IDs from checked-in targets.
Console environment preparation also reads its target database directly.
Neither preparation command provisions the complete storage inventory.
Allocate that storage before generating manifests.

Copy no application rows, R2 recovery objects, pre-signature pools, sessions, or old organisation records.
Keep migration history and required system bootstrap data produced by the normal migration process.
Regenerate deployment files and artifacts after target changes.
Do not edit generated configurations or installed package files by hand.

### Keys and external dependencies

Generate fresh Wallet and Console manifests once per lane through their existing preparation commands.
Initialized targets require the existing explicit `--rotate` option for Wallet identity replacement.
Keep each generated manifest and apply that same generation throughout its lane.
Do not regenerate keys when resuming a failed deployment.

Replace internal service credentials, ceremony signing keys, online wrapping keys, encryption keys, and session-sealing keys.
Replace Console session, invitation, webhook-encryption, and grant-signing keys.
Update every corresponding public key, keyset, identifier, and verifier from the same generation.
Carry the Console manifest's grant-authority public handoff into Wallet configuration.
Keep the existing separation between signing roles.

Reissue recovery certificates and trust snapshots when their deployment authorities change.
Staging and mainnet require these trust artifacts.
Keep the offline recovery trust authority in its existing protected signing workflow.
An account migration alone does not require replacing the SDK's pinned recovery trust root.

Cloudflare does not reveal stored secret values through Wrangler or its dashboard.
Recover required external values from their authoritative store or issue replacement credentials.
See [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

| External dependency               | Required action                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mainnet Google Cloud KMS          | Preserve A/B key separation and provider bindings. Issue credentials for destination Workers where needed.                                                    |
| NEAR relayers and EVM sponsors    | Preserve or replace funded service identities deliberately. Check balances and network configuration.                                                         |
| Google OIDC and GitHub OAuth      | Preserve final callback origins. Reconfigure credentials only where account ownership or temporary origins require it.                                        |
| Resend                            | Install Wallet and Console credentials. Preserve sender verification and all email DNS records.                                                               |
| Stripe                            | Install the required credentials and webhook secret. Check old recurring subscriptions and pending webhook deliveries before discarding organisation records. |
| Satyr connection, when configured | Update necessary service assertions and provisioning credentials. Preserve unrelated Satyr infrastructure.                                                    |

Cloudflare migration does not transfer ownership or billing for Google Cloud, Stripe, Resend, or blockchain accounts.
Deleting Cloudflare wallet records does not delete on-chain accounts or move their funds.

### Fresh-account deployment gap

Add fresh-account bootstrap support to the existing deployment scripts before execution.
Current deployment order assumes that the Router and its namespaces already exist.
It fails against an empty destination account.

The service graph contains several cycles:

- Router calls the control plane, which binds the Router's creation DO.
- Deriver A and Deriver B call each other and bind the Router's creation DO.
- Console calls regional Gateways and Runtime Workers, which call Console.
- Each regional Gateway binds every regional Gateway.

Extend the existing inert-Worker bootstrap pattern to reserve absent service target names.
An inert Worker returns HTTP 503 and has no public routes or scheduled work.
Then deploy the real Router with its namespace declarations before any external DO consumer.
Use the pinned package's existing DO migration syntax and class ownership.

Prepare generated deployment configurations without public routes and cron triggers for the preparation stage.
The standard deployment currently attaches these automatically.
Also defer Pages domain attachment until the destination zone can serve the domains.
Keep these changes in deployment orchestration and generated deployment configuration.
Do not add runtime compatibility paths, duplicate applications, or another infrastructure framework.

Keep writes gated until the fresh tenant deployment becomes active.
Retired tenant IDs in checked-in targets must never activate against the empty destination.
Use the existing inactive-deployment and activation flow for this stage.
Replace recorded organisation, project, and environment IDs after creating the destination tenant.

**Exit condition:** storage, keys, public verifiers, and a repeatable empty-account bootstrap are ready for every lane.

## Phase 4 — Deploy the destination without public traffic

Prepare all three lanes before moving the shared `seams.sh` zone.
Use staging to verify deployment support first.

For each lane:

1. Build exact pinned Wallet packages and private application artifacts once.
2. Apply Console, signer, and private D1 migrations.
3. Reserve absent service target names with inert Workers.
4. Deploy the real Router and its two owned DO namespaces without public routes.
5. Deploy SigningWorker, both derivers, and the control plane with destination bindings and secrets.
6. Deploy all four Wallet Runtime Workers.
7. Deploy all four Gateway Workers.
8. Deploy Console with its complete regional bindings.
9. Deploy the final Router configuration after all real peers exist.
10. Deploy every Pages surface to its destination project without moving public domains.
11. Deploy all inventoried benchmark and diagnostic resources with their destination dependencies.
12. Compare destination bindings and settings against the inventory.

The two derivers and SigningWorker create their own namespaces through their normal deployments.
External references must point to the destination Router's namespace.
DO namespace transfers between Workers operate within one account.
Create fresh destination namespaces for this reset.
See [DO namespace lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/).

Verify internal services through a temporary authenticated Worker in the destination account when public routes are unavailable.
Check Pages assets through destination preview URLs.
Use final public origins for full authentication and wallet tests after domain cutover.
Remove the temporary verifier when verification finishes.

**Exit condition:** all destination resources exist, migrations pass, and every final service target contains real application code.

## Phase 5 — Move domains and activate fresh tenants

### Domain preparation

Move the `seams.sh` Cloudflare zone into the dedicated account for complete Cloudflare isolation.
Preserve unrelated DNS records and establish ownership for any shared zone settings before the move.
Check all dependent hostnames because one zone change affects staging and production together.

If another registrar owns the domain, prepare the destination zone and change nameservers at that registrar.
Handle DNSSEC by removing the old delegation signer record before the nameserver change.
Enable destination DNSSEC after delegation stabilises and publish its new signer record.
Export DNS records explicitly because automatic discovery can copy Cloudflare proxy addresses.
Recreate zone rules and certificates.
See [moving a domain between accounts](https://developers.cloudflare.com/fundamentals/manage-domains/move-domain/).

If Cloudflare Registrar owns the domain, use its inter-account registration process.
Both accounts must confirm the move.
The destination then owns renewal billing, and other zone configuration requires recreation.
Confirm transfer eligibility before scheduling the maintenance window.
See [Registrar account transfer](https://developers.cloudflare.com/registrar/account-options/inter-account-transfer/).

### Cutover order

1. Pause Seams deployment automation and account configuration changes.
2. Place source Seams entry points into maintenance and drain active requests.
3. Disable source Seams cron schedules, event consumers, and queued external deliveries where applicable.
4. Prevent source DO alarms and direct Worker URLs from continuing application work.
5. Move DNS delegation or complete the Registrar account transfer.
6. Remove conflicting source Worker and Pages domain associations.
7. Attach destination Worker domains, Console path routes, and Pages domains.
8. Check certificates, DNS resolution, route precedence, email records, and required zone rules.
9. Create the fresh Seams administrator, organisations, projects, and environments through Console.
10. Activate each new environment through the protected deployment workflow and its resource verification.
11. Verify staging, then production testnet, then production mainnet.
12. Enable destination scheduled work after its owning lane passes verification.
13. Resume ordinary deployment automation after all public entry points pass.

Source DO alarms require explicit handling because disabling cron triggers does not stop object alarms.
Use a source-only teardown deployment or remove the source namespaces when rollback is no longer required.
Keep source writes fenced throughout the maintenance window.

Pages domain attachment must precede final DNS validation.
A CNAME record alone does not configure the Pages domain.
Check certificate coverage for nested Console and Gateway hostnames.
See [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

Preserve the existing protected activation paths:

- Staging and mainnet use their backend workflows. Production testnet uses `deploy-live-demo.yml`.
- Each workflow reads the environment ID from `deployment/wallet-system/targets.json`, deploys Wallet and Console, activates the tenant, and checks readiness.
- `pnpm tenant:cutover` runs inside the protected GitHub workflow because it requires GitHub OIDC authentication.

Restore marketing, docs, and Console access before public wallet registration where needed for administrator provisioning.
Keep wallet entry points gated until resource challenges and tenant activation pass.

**Exit condition:** final public hostnames serve the destination account and fresh tenant activation succeeds in every lane.

## Phase 6 — Verify behaviour and retain repeatable evidence

Use a new organisation and wallet for each lane and home-region combination.
The minimum regional matrix contains twelve fresh wallet scenarios.
Extend existing deployed E2E tooling where it lacks a required flow.
Keep Wallet lifecycle contracts in `seams-wallet` and composed product tests in this repository.

Each regional scenario must:

1. Create or select its fresh Console organisation, project, and activated environment.
2. Register a wallet through the deployed browser flow.
3. Check the selected home region and its destination signer D1 database.
4. Check destination Router, A, B, SigningWorker, and presign object allocation and placement events.
5. Complete Ed25519 and ECDSA signing through the deployed services.
6. Verify signatures independently and reject an altered signed message.
7. Unlock a new browser session and sign again.
8. Exercise factor addition and recovery with fresh test wallets through the existing supported flows.
9. Exercise tenant-root managed backup creation and recovery, including mainnet KMS access.
10. Check Console persistence, project origin restrictions, email delivery mode, and scheduled work.

Use unfunded canary wallets and bounded sponsored operations for mainnet verification.
Record transaction hashes only when a scenario deliberately broadcasts a transaction.
Check actual product behaviour through the final public hostnames.

Also verify every frontend, hosted SDK asset manifest, public docs revision, OAuth callback, and configured webhook.
Check allowed and rejected browser origins.
Confirm that internal Workers remain inaccessible without their required authentication.
Confirm that old sessions and API credentials fail against the destination.

The existing `pnpm router:deploy:browser-evidence` command writes deployed browser evidence.
Its current flow covers Ed25519 prepare/finalize requests and browser-origin behaviour.
It needs a fresh flow module or fresh request material and does not cover this complete migration matrix.
Use it as one part of the acceptance run.

Retain these private artifacts:

- Source and destination resource inventories with a complete mapping.
- Deployed version IDs, package versions, Git revisions, and artifact digests.
- Migration heads and primary-location query metadata for every D1 database.
- DO namespace ownership, placement requests, and observed host events for every tested region.
- E2E results, browser traces, independent signature checks, and redacted operation identifiers.
- DNS, domain, certificate, cron, email, webhook, and backup verification results.
- A repeatable command or documented procedure for every acceptance scenario.
- Billing evidence before migration and after source removal.

Run `pnpm test:scripts` after implementing changes to deployment scripts or workflows.
Run the applicable type checks and existing boundary checks if those changes affect shared state or interfaces.
Classify any existing test failure under the repository testing policy before repairing it.
Create no new unit tests or source-text policy guards for this migration.

**Exit condition:** all required scenarios pass with reproducible evidence and no source-account runtime dependency.

## Phase 7 — Remove source resources and close billing

After acceptance, remove source Seams resources from the reconciled inventory:

1. Remove entry routes, custom domains, scheduled triggers, event consumers, and obsolete deployment hooks.
2. Remove external DO bindings before deleting their owning namespaces.
3. Delete source Seams DO namespaces and their stored objects through the supported lifecycle procedure.
4. Delete source Seams Workers, including retired experiments and diagnostic services.
5. Delete source Seams D1 databases, including retired migration copies and regional databases.
6. Empty and delete source Seams R2 buckets, including incomplete multipart uploads where present.
7. Delete source Seams Pages projects after domain reassignment succeeds.
8. Delete other inventoried Seams storage, queues, secrets, analytics resources, and account integrations.
9. Revoke source Seams deployment tokens and replace local default credentials on deployment machines.
10. Remove source account IDs, storage IDs, peer URLs, and obsolete tenant identities from active deployment inputs.
11. Cancel Seams-only subscriptions and remove obsolete zone plans or add-ons.
12. Preserve subscriptions and credentials still required by unrelated source workloads.

Check the complete source account inventory again after deletion.
An idle Worker or detached hostname does not prove that its storage and scheduled work disappeared.
Retain deletion results for all mapped resources.

Cloudflare subscription cancellation requires an explicit billing action.
Domain changes do not cancel subscriptions.
Cancellations generally apply at the billing-period boundary, and earlier usage can appear on later invoices.
See [Cloudflare subscription cancellation](https://developers.cloudflare.com/billing/manage/cancel-subscription/).

Check new Seams usage under the destination account after cutover.
Check source usage after reporting delays, then reconcile the next invoice.
Record any shared source subscription that remains and its unrelated owner.
Do not claim zero historical charges merely because new Seams usage stops.

**Exit condition:** the deletion evidence covers every mapped source resource and Seams-only renewal.
Future Seams usage belongs to the dedicated account.

## Failure handling

Before domain cutover, keep the source deployment available while repairing the destination.
Do not delete source resources during preparation.

After cutover, prefer repairing the destination while entry points remain in maintenance.
If traffic must return to the source, stop destination writes first.
Any wallets or organisations created in the destination then become another discarded dataset.
Never merge private signing storage or restore consumed signing material between accounts.
DNS and certificate changes can delay traffic restoration.

After source namespace or storage deletion, restoring the old service state is outside this reset plan.
Recovery means rebuilding a fresh service from the recorded artifacts and keys.

## Implementation locations and execution gates

| Location                                                                 | Required work                                                                                 |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `deployment/wallet-system/targets.json`                                  | Replace destination storage IDs and final tenant metadata                                     |
| `deployment/console/targets.json`                                        | Keep Console database targets consistent with Wallet targets                                  |
| `scripts/deploy-backend.mjs`                                             | Extend service-name bootstrap and support preparation without public routes or scheduled work |
| `packages/wallet-console-server-ts/scripts/render-d1-gateway-config.mjs` | Render the preparation configuration through the existing path                                |
| `scripts/deploy-surface.mjs`                                             | Permit Pages upload before final domain attachment                                            |
| Existing Wallet and Console environment commands                         | Generate and apply fresh protected manifests with destination account inputs                  |
| `.github/workflows/deploy-*.yml` and GitHub environments                 | Supply destination credentials and preserve protected activation                              |
| `seams-wallet` benchmark configurations and deployment inputs            | Recreate deployed experiments and replace account-specific peer origins                       |
| Existing E2E tooling                                                     | Cover the regional acceptance matrix and write repeatable evidence                            |

Update every existing deployment environment that holds Cloudflare credentials.
Backend prefixes are `staging`, `production-testnet`, and `production` for mainnet.
Each prefix has `gateway`, `mpc-router`, `deriver-a`, `deriver-b`, `signing-worker`, and `tenant-root-control-plane` environments.
Also update the three Console environments, both frontend environments, and `production-live-demo`.
Check repository, organisation, benchmark, and other environment scopes during inventory.

Commit implementation work on `dev` in the main checkouts.
Use the established release process to promote the reviewed revision to `main` for production deployment.
Preserve existing branch restrictions and environment protection rules.
Pin exact public package releases if the migration requires public source changes.

The execution gates are:

1. **Inventory complete:** account IDs, domain ownership, all resources, and all shared dependencies recorded.
2. **Destination ready:** billing, quotas, storage placement, secrets, and bootstrap support verified.
3. **Cutover ready:** every lane deployed, domains prepared, maintenance controls ready, and source writes can be fenced.
4. **Acceptance complete:** regional product scenarios and public entry points pass with retained evidence.
5. **Billing isolated:** source removal and Seams-only subscription cancellation verified.
