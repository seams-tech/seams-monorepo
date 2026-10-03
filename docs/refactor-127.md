# Refactor 127: immutable tenant deployment bindings and coordinated cutover

**Status:** In progress. The canonical contracts, insert-only persistence,
atomic activation, semantic readiness, public projection, production adapters,
repository cutover command, protected live-demo workflow, and automatic
onboarding hook are implemented. Browser cutover controls have been removed.
Owners retain a read-only status and audit view. Ceremony revision pinning in
`seams-wallet` and explicit retirement/rollback remain delivery gates.

## Decision

Represent every deployed Wallet tenant with one immutable, versioned
`TenantDeploymentBindingV1`. The binding joins the exact deployment lane,
product environment, tenant identity, active tenant-root lineage, browser
credential, browser origins, public endpoints, and runtime policy into one
canonical record.

Persist bindings as insert-only Console records. Each deployment lane has one
small compare-and-swap active-binding pointer. A cutover prepares and verifies
a complete replacement binding, then changes that pointer in one D1
transaction. New registration and recovery setup reads the active binding.
Every created ceremony, wallet runtime record, and signed Router request keeps
the binding revision that authorized it.

Development always means Testnet. Production always means Mainnet. Model this
as a discriminated union so an invalid environment/network combination cannot
be constructed.

Tenant-root creation or restore and credential issuance happen before a
binding becomes eligible for activation. They remain their existing security
operations. The cutover coordinator observes their durable results and builds
the binding only when all required state exists and agrees.

Remove the current independent tenant identity sources after the migration:

- `SEAMS_STAGING_ORG_ID`, `SEAMS_STAGING_PROJECT_ID`, and
  `SEAMS_STAGING_ENV_ID` stop controlling live tenant resolution;
- frontend `VITE_*_SEAMS_PROJECT_ENVIRONMENT_ID` and
  `VITE_*_SEAMS_PUBLISHABLE_KEY` stop controlling live Wallet registration;
- `deployment/wallet-system/targets.json` retains infrastructure topology and
  the expected active binding revision, without duplicating the binding
  fields;
- API-key origin changes and browser-key rotation create a replacement binding
  instead of mutating the credential used by an active binding.

The first release supports replacing an empty environment and the live-demo
environment. A tenant with durable user wallets requires an explicit wallet
data migration or restore receipt before activation. The coordinator must
refuse an ordinary project-ID cutover when the source environment owns durable
wallets.

## Problem and current cause

The current system represents one tenant across several independently mutable
surfaces:

| Concern                         | Current source                                          | Runtime consequence                                                 |
| ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| Desired tenant identity         | `deployment/wallet-system/targets.json`                 | Changes repository intent only.                                     |
| Gateway tenant identity         | Generated Worker variables                              | Keeps the previous identity until Gateway redeploys.                |
| Active tenant root              | Console D1 plus Router/Deriver state                    | Resolves by the complete tenant identity.                           |
| Browser credential              | Console D1                                              | Belongs to one project environment and has its own allowed origins. |
| Wallet-site environment and key | GitHub environment variables compiled into the frontend | Can move before or after the backend.                               |
| Router policy                   | Generated Worker configuration                          | Can identify another environment generation.                        |
| Deployment completion           | Separate backend and frontend workflows                 | Either surface can complete alone.                                  |

This permits a valid but unusable state. During the production-testnet project
change that motivated R127:

1. the new project environment existed;
2. the new environment had an active tenant root;
3. the browser used a credential for the new environment;
4. the live Gateway still held the previous organization, project, and
   environment variables;
5. registration setup persisted part of its state with the old outer tenant
   scope while its runtime policy named the new environment;
6. Ed25519 registration failed with `Ed25519 tenant root is not active`.

The health check still passed. It proved that Ed25519 support and service
bindings were configured. It did not run the exact active-lineage lookup for
the tenant selected by registration.

The configuration generators validate consistency inside one generated
document. They do not compare repository intent, the current Cloudflare Worker
version, GitHub frontend variables, the active tenant root, and the browser
credential as one deployed state. There is no durable cutover operation,
activation barrier, or rollback receipt.

## Goals

R127 must provide these properties:

1. One canonical binding describes the tenant used by a deployment lane.
2. A binding is complete and immutable once persisted.
3. New registration observes one active binding revision at a time.
4. Ceremony execution uses the revision captured by setup, including across a
   later activation.
5. Tenant-root lookup, credential authorization, Router policy, and public
   Wallet configuration all derive from the same binding.
6. Activation is impossible until an exact semantic readiness check succeeds.
7. Every cutover emits a durable, auditable receipt.
8. Rollback has explicit safety rules and cannot silently split durable tenant
   state.
9. The old static tenant variables and duplicate frontend variables are
   deleted after the migration.

## Non-goals

R127 does not:

- move tenant-root key material or create a conversion between tenant-root
  identities;
- move wallets between projects automatically;
- copy a publishable credential to another environment;
- replace the existing tenant-root creation, backup, restore, or approval
  ceremonies;
- rotate Router, Deriver, signing-worker, or signing-session cryptographic
  deployment identities;
- redesign general API credential management;
- make Cloudflare Worker deployment transactional;
- introduce a second tenant-root lifecycle beside the current grant and
  security-state records.

## Canonical domain model

### Environment and network pairing

Use one union for the product environment. Do not accept independent strings
in core cutover logic.

```ts
type TenantDeploymentModeV1 =
  | {
      readonly kind: 'development_testnet_v1';
      readonly environment: 'development';
      readonly network: 'testnet';
    }
  | {
      readonly kind: 'production_mainnet_v1';
      readonly environment: 'production';
      readonly network: 'mainnet';
    };
```

Staging and production-testnet are deployment lanes. They can both host a
`development_testnet_v1` product environment. A lane name never changes the
network or product-environment meaning.

### Immutable binding

All fields are required. Use branded, boundary-parsed identifiers in the
implementation rather than the illustrative `string` aliases below.

```ts
type TenantDeploymentBindingV1 = {
  readonly kind: 'tenant_deployment_binding_v1';
  readonly schemaVersion: 1;
  readonly revision: TenantDeploymentBindingRevision;
  readonly deploymentLane: DeploymentLaneId;
  readonly mode: TenantDeploymentModeV1;
  readonly tenant: {
    readonly namespace: TenantStorageNamespace;
    readonly organizationId: OrganizationId;
    readonly projectId: ProjectId;
    readonly environmentId: ProjectEnvironmentId;
  };
  readonly tenantRoot: {
    readonly identityDigestB64u: TenantRootIdentityDigestB64u;
    readonly custodyLineageId: TenantRootCustodyLineageId;
    readonly signingRootId: SigningRootId;
    readonly signingRootVersion: SigningRootVersion;
  };
  readonly browserCredential: {
    readonly credentialId: PublishableCredentialId;
    readonly publishableKey: PublishableCredentialValue;
    readonly expiresAtMs: UnixEpochMilliseconds | null;
    readonly allowedOrigins: readonly [BrowserOrigin, ...BrowserOrigin[]];
    readonly quotaPolicy: PublishableCredentialQuotaPolicyV1;
  };
  readonly surfaces: {
    readonly applicationOrigin: BrowserOrigin;
    readonly hostedWalletOrigin: BrowserOrigin;
    readonly gatewayOrigin: HttpsOrigin;
    readonly relyingPartyId: WebAuthnRelyingPartyId;
  };
  readonly runtimePolicyDigestB64u: RuntimePolicyDigestB64u;
  readonly createdAtMs: UnixEpochMilliseconds;
};
```

`revision` is the base64url SHA-256 digest of the canonical encoded binding
body, prefixed with `tdb_`. The body excludes only the `revision` field. The
parser recomputes the digest and rejects a mismatch. Canonical encoding must
define field order, UTF-8 encoding, array order, and integer representation.

Canonicalize `allowedOrigins` by exact origin parsing, lowercase hostnames,
default-port removal, deduplication, and lexical ordering. Require both
`applicationOrigin` and `hostedWalletOrigin`. Reject paths, queries,
fragments, wildcards, and trailing-slash variants at the boundary.

The browser credential value is intentionally public and already ships to
browsers. Never log it or include it in an audit event. The durable binding may
retain it so runtime configuration has one source. Audits use the credential
ID and binding revision.

The binding contains references and digests for a tenant root. It never
contains a wallet custody seed, owner signing root, lane holder share, wrapper
key, or other key material.

### Active pointer

The active pointer is mutable deployment state. The binding remains immutable.

```ts
type ActiveTenantDeploymentBindingV1 = {
  readonly kind: 'active_tenant_deployment_binding_v1';
  readonly deploymentLane: DeploymentLaneId;
  readonly revision: TenantDeploymentBindingRevision;
  readonly previousRevision: TenantDeploymentBindingRevision | null;
  readonly activationSequence: number;
  readonly activatedAtMs: UnixEpochMilliseconds;
};
```

Activation uses compare-and-swap on `activationSequence` and the expected
current revision. Concurrent or stale activation attempts fail without
changing the pointer.

### Cutover operation

The cutover coordinator persists a separate operation state. It must use a
discriminated union with branch-specific required fields. Core functions
accept only the branch they can advance.

```ts
type TenantDeploymentCutoverV1 =
  | {
      readonly kind: 'planning';
      readonly operationId: TenantDeploymentCutoverId;
      readonly deploymentLane: DeploymentLaneId;
      readonly targetIdentity: TenantRootIdentityV1;
      readonly expectedActiveRevision: TenantDeploymentBindingRevision | null;
    }
  | {
      readonly kind: 'awaiting_tenant_root';
      readonly operationId: TenantDeploymentCutoverId;
      readonly targetIdentity: TenantRootIdentityV1;
      readonly expectedActiveRevision: TenantDeploymentBindingRevision | null;
    }
  | {
      readonly kind: 'awaiting_browser_credential';
      readonly operationId: TenantDeploymentCutoverId;
      readonly targetIdentity: TenantRootIdentityV1;
      readonly activeTenantRoot: ActiveTenantRootReferenceV1;
      readonly expectedActiveRevision: TenantDeploymentBindingRevision | null;
    }
  | {
      readonly kind: 'ready';
      readonly operationId: TenantDeploymentCutoverId;
      readonly binding: TenantDeploymentBindingV1;
      readonly readinessReceipt: TenantDeploymentReadinessReceiptV1;
      readonly expectedActiveRevision: TenantDeploymentBindingRevision | null;
    }
  | {
      readonly kind: 'active';
      readonly operationId: TenantDeploymentCutoverId;
      readonly binding: TenantDeploymentBindingV1;
      readonly activationReceipt: TenantDeploymentActivationReceiptV1;
    }
  | {
      readonly kind: 'failed';
      readonly operationId: TenantDeploymentCutoverId;
      readonly failedPhase: TenantDeploymentCutoverPhaseV1;
      readonly failure: TenantDeploymentCutoverFailureV1;
    };
```

Do not persist a partial binding. The `ready` branch is the first state that
contains one. Root and credential references are constructed from their
canonical stores after those stores report exact readiness.

## Persistence and ownership

Add three Console D1 tables:

1. `tenant_deployment_bindings`
   - primary key: `(deployment_lane, revision)`;
   - insert-only canonical JSON plus indexed identity fields;
   - an attempted update or a same-revision/different-body insert fails.
2. `active_tenant_deployment_bindings`
   - primary key: `deployment_lane`;
   - current revision, previous revision, activation sequence, and timestamp;
   - updated only by the activation compare-and-swap transaction.
3. `tenant_deployment_cutovers`
   - primary key: `operation_id`;
   - exact operation-state JSON, revision, timestamps, initiator, and terminal
     receipt;
   - transitions through a service that accepts the narrow source branch.

Console owns binding construction, activation, and audit. Gateway and Wallet
Runtime read bindings through the existing Console service-binding boundary.
Router and signing services receive the binding revision and exact tenant
scope through signed requests. They must not read an independently configured
tenant identity.

Add boundary parsers in `packages/wallet-console-shared-ts`. Export precise
types from the parser result. Raw D1 rows, JSON, Worker variables, route
bodies, and CLI input must not enter core services.

Add type fixtures proving that these states fail to compile:

- Development paired with Mainnet;
- Production paired with Testnet;
- a binding without a credential, active root, runtime-policy digest, or
  required origin;
- a `ready` operation containing partial root or credential state;
- mutation of a persisted binding;
- activation without the expected current revision;
- a ceremony record without a binding revision.

## Runtime resolution

### Gateway and Wallet Runtime

For setup operations, resolve the active binding once at request admission.
Pass that parsed binding through the complete operation. Do not re-read the
active pointer midway through a request.

Persist `tenantDeploymentBindingRevision` on every registration ceremony
record. Ceremony execute and finalize resolve that immutable revision rather
than the lane's current pointer. This lets a ceremony that started before a
cutover finish against its original tenant until its existing expiry.

Persist the revision on durable wallet runtime policy and capability records.
Existing operations use the binding captured by their durable state. New
project environments cannot discover wallets belonging to a previous binding
through the active pointer.

Remove static tenant identity from the Gateway's registration composition.
Infrastructure configuration remains static: D1 database bindings, Worker
service bindings, resource names, compatibility dates, and cryptographic
deployment identity stay in generated Worker configuration.

### Router and tenant-root lookup

Include these claims in the Gateway-signed ceremony authorization:

- tenant deployment binding revision;
- namespace;
- organization ID;
- project ID;
- environment ID;
- tenant-root identity digest;
- custody lineage ID;
- runtime-policy digest.

Router validates the claims against the exact binding supplied by the trusted
Console service boundary. Tenant-root lookup uses the binding's canonical
tenant identity and root reference. A mismatch is a typed
`tenant_deployment_binding_mismatch` failure and must never degrade to
`tenant root is not active`.

### Browser configuration

Expose a public projection at a stable Gateway endpoint such as:

```text
GET /.well-known/seams-tenant-deployment.json
```

The response contains the active revision, mode, project environment ID,
publishable key, required origins, hosted Wallet origin, Gateway origin, and
relying-party ID. It excludes organization IDs, root lineage details, internal
policy documents, and all secrets.

The Wallet site loads and parses this document before constructing its Wallet
client. Cache it by revision with bounded HTTP caching and ETag support. A
refresh that observes another revision reconstructs the client before it
starts a new operation. An operation already in progress retains its captured
revision.

Delete build-time project-environment and publishable-key variables once the
public projection is live on every production surface. The frontend build
keeps stable lane Gateway origins so it can locate the public projection.

### API credential behavior

A publishable credential referenced by an active or retained binding is
immutable in every registration-relevant field:

- environment identity;
- allowed origins;
- quota policy;
- expiry;
- active/revoked state.

Changing one of these fields creates a replacement credential and a new
binding revision. Revoking a credential referenced by the active binding is
blocked until another binding is active. Retained credentials can be revoked
after all ceremonies using their binding have expired and the retirement
receipt is complete.

Display-name changes may remain metadata-only if they do not alter the
canonical credential record or its authorization behavior.

## Semantic readiness

Add one internal readiness service that accepts a fully parsed candidate
binding and exercises the production resolution boundaries without creating a
wallet:

1. verify that the target organization, project, and environment exist and
   have the binding's mode;
2. resolve the active tenant-root lineage through the same Console lookup used
   by registration;
3. ask Router for the status of the exact root identity and lineage;
4. verify the browser credential's stored hash, status, environment, origins,
   quota policy, and expiry;
5. verify that the runtime-policy digest matches Router policy;
6. verify that the Gateway, hosted Wallet, application, and relying-party
   origins agree;
7. verify that every relevant service understands the candidate binding
   schema and revision;
8. count durable wallets and in-flight ceremonies in the source and target
   environments;
9. persist one readiness receipt covering every checked digest and count in
   the versioned cutover record.

The receipt expires after a short bounded interval. Activation requires an
unexpired receipt whose candidate revision and expected active revision match
the current operation. The atomic activation transition also requires the
exact ready cutover record revision, so readiness does not need a separate
signing secret.

Extend `/readyz` with a safe deployed-state projection:

```json
{
  "ok": true,
  "tenantDeployment": {
    "revision": "tdb_...",
    "mode": "development_testnet_v1",
    "registrationReady": true
  }
}
```

`registrationReady` runs the same root-lineage, credential, and runtime-policy
checks for the currently active binding. A missing active root or inconsistent
binding makes readiness fail. A global `thresholdEd25519.configured` flag is
insufficient evidence for registration readiness.

## Coordinated cutover workflow

Expose the workflow through one repository command used by deployment
automation:

```text
pnpm tenant:cutover --lane production-testnet \
  --environment-id proj_example:dev
```

The provisioning command accepts only the deployment lane and environment ID. The Console
resolves organization and project identity from the target environment. It
does not accept separate organization, project, root, credential, or origin
overrides that can form an inconsistent deployment.

The production command runs only in `.github/workflows/deploy-live-demo.yml`.
The job uses the protected `production-live-demo` GitHub environment and a
short-lived GitHub OIDC token scoped to that workflow, repository, environment,
branch, and audience. No cutover signing secret or readiness HMAC environment
variable exists.

For historical bindings that lack a D1 home, the explicit operator command is:

```text
pnpm tenant:cutover adopt-home --lane production-testnet \
  --revision tdb_RECORDED_PREVIOUS_REVISION --activation-sequence 1 \
  --operation-id tco_STABLE_OPERATOR_OPERATION
```

This calls `/internal/tenant-deployment/v1/adopt-home` under the same protected
OIDC scope. Obtain the exact revision and sequence from the active Console
record. The namespace must already be inventoried and reserved to its current
account/database; the request cannot supply a home override. Adoption preserves
the original binding, root and credential, creates a deterministic replacement,
runs production readiness, activates through the existing compare-and-swap,
then runs the registration setup canary. Readiness reads only historical ownership
scope from persistence; ordinary runtime readers continue to reject old bindings.

Repeat the exact command after an interrupted request. Pending attempts get fresh
readiness. An activated attempt repeats the canary and retains its activation
sequence. Canary failure returns an error even though activation is durable;
reuse the same operation ID to finish verification. A changed active pointer or
reused operation naming another cutover is rejected. Successful canary attempts
append audit events, so retries can produce multiple verification events for one
activation.

This flow is locally verified with the production Console Worker, D1 and
readiness adapter; external custody, inventory and canary responses are controlled
in the E2E. It is not wired into the automatic deployment job yet. Before rollout,
verify physical Worker/database bindings and coordinate adoption with consumer
deployment: the new ordinary decoder rejects the historical active binding, and
the existing workflow smokes readiness before cutover. Do not run that unchanged
deployment sequence against historical bindings. Local evidence and reproduction
are in `.artifacts/r152/operator-home-adoption-20261002/` and
`tests/relayer/tenant-home-adoption-operator.e2e.test.ts`.

The read-only provider checkpoint is available separately:

```text
pnpm tenant:verify-d1-bindings --lane production-testnet \
  --output .artifacts/d1-binding-checkpoint-UNIQUE_RUN.json
```

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the operator environment.
The token needs permission to read Worker deployments and versions. The command
reads the existing lane manifest, inspects `SIGNER_DB` on every version in the
current Gateway and Wallet Runtime deployments, and rereads both deployment
IDs and traffic weights. Missing bindings, duplicate names, wrong databases,
malformed weights, denied reads and changed deployments fail the checkpoint.
Only the selected D1 binding and deployment/version IDs are retained; unrelated
bindings and secrets are excluded. The output path must be new, and a failure
records `status: failed`. An interrupted run retains `status: checking`.

`provider_bindings_match` records provider configuration agreement at that time.
It does not compare the Console reservation, perform the fresh D1/runtime
challenge, authorize activation, or account for other reachable older versions
and internal/admin routes. Those are still rollout gates. Provider API semantics:
[current deployment ordering](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/),
[version resources](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/),
and [D1 binding IDs](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/#bindings).

The combined provider/runtime checkpoint uses the protected OIDC workflow:

```text
pnpm tenant:cutover verify-resource --lane production-testnet
```

This operation needs Worker deployment/version read and D1 query permissions as
well as the existing GitHub OIDC scope. It first verifies the actual provider
bindings, requiring one serving version at 100% for each writer. It then writes
one random, five-minute challenge directly through
the configured database UUID. Console reads its immutable namespace reservation,
then asks Gateway and Wallet Runtime to read the challenge through their actual
`SIGNER_DB` bindings. The expected proof is omitted from these private requests;
only namespace and challenge ID are sent. Both observations must match the
reservation, proof and validity window. Each writer reports its own Cloudflare
version metadata ID, which must match the provider's serving version. Missing
version metadata fails verification. After the runtime reads, the CLI repeats
provider verification and rejects changes to deployments, versions or weights.
The challenge must still be fresh when this final check completes. A successful
single-version run performs twelve provider GETs, one challenge INSERT and one
DELETE. The returned `tenant_d1_home_checkpoint_v1` includes both provider check
times, serving deployments and the answering versions, excludes the proof and
retains `activationAuthorized: false`.

The standalone read-only provider command supports gradual rollouts. The combined
command rejects them before writing a challenge because one request cannot
establish runtime coverage of every serving version.

The CLI deletes its exact challenge in `finally`, including when an INSERT
committed but its response was lost. Process termination can leave an expired
row; expiry rejects verification but does not itself delete data. Public requests
to the writer challenge path return 404. The handler works before binding
adoption and does not initialize homes or touch custody/session records.

Both provisioning and `adopt-home` now run this combined check automatically and
submit its checkpoint to the OIDC-protected Console route. The protected workflow
supplies its existing Cloudflare account/token secrets to the cutover step. Console
accepts provider evidence only from that operator authority; the JSON receipt is
not an independently signed Cloudflare attestation. Browser onboarding can reuse
an active deployment; a new hosted activation requires operator verification.

Console migration `0050_tenant_deployment_home_verification.sql` stores the parsed
verification in the immutable activation row. A unique challenge-ID index makes
consumption atomic with the active-pointer and cutover transition: another operation
cannot reuse the proof. Activation checks the reserved home, lane and expiry, with
a database-clock expiry check in the transaction. That check conservatively requires
validity beyond the current one-second SQLite clock bucket. Completed activation
retries return the recorded result after expiry when the original evidence and
active pointer still match. Expiry does not invalidate an already active deployment.

The Gateway sends its version identity for request and scheduled-work admission;
Wallet Runtime does so for bound wallet requests. Console joins the activation
evidence into the existing binding query and rejects unattested or different
versions. This adds no signing/unlock D1 roundtrip. Deploying new Worker versions
with unchanged wallet configuration requires a fresh activation; the operator
provisioning path refreshes that activation while preserving the binding, custody
and credential. Historical binding conversion remains at the adoption boundary.

The local combined development Worker owns its bootstrap authority and records a
distinct local verification. The database accepts it only for development bindings.
The hosted operator boundary rejects local proofs, and split hosted writer admission
requires Cloudflare evidence. Before admission, the private challenge and readiness
inspection only read `SIGNER_DB`. The private custody-control handler forwards an
allowlisted operation to Router/control-plane/Deriver service bindings with internal
service authentication; it does not access `SIGNER_DB`. It must remain reachable
for first-tenant creation and cutover preparation. This review covers the pinned
Wallet Server 0.7.3 handler and the canonical split Worker entrypoints; privileged
administrative writers and previously deployed code still require inventory.

Rollout prerequisites: Console migration 0050, signer migration
`0042_deployment_resource_challenges.sql` (after the ordered earlier migrations), the
new private Console `WALLET_GATEWAY` service binding, the challenge endpoint and
`CF_VERSION_METADATA` binding on both writers. The renderer supplies that metadata
binding. The migration currently lives in `seams-wallet` source and is absent
from the pinned `@seams/wallet-server` 0.7.3 release. Publish/consume the exact new
package release before the normal migration pipeline can apply it. The local
acceptance test deliberately reads this source migration and records its hash.
The version admission check rejects a later different serving version when it
uses these entrypoints. It cannot constrain privileged replacement code that
ignores the checks or establish coverage of other administrative writer paths.
A copied database receiving the fresh challenge can answer it, so runtime proof
alone cannot establish the provider resource or prevent a second writer.

The protected production-testnet workflow now installs exact dependencies and
requires the packaged signer challenge migration before authorizing deployment.
The currently pinned Wallet Server 0.7.3 fails this preflight, so it cannot begin
this rollout. After that dependency is updated, the workflow deploys Console and
the complete Wallet runtime, obtains fresh resource verification, activates the binding
and runs its canary, then smokes Wallet and Console. A missing binding (503) fails
Wallet smoke; propagation retries retain the existing three-minute budget.

The production-testnet backend workflow is reusable only. Console's standalone
dispatch offers the other lanes. Both production-testnet deployment CLI commands
route through the protected coordinator and require the live-demo environment ID:

```sh
pnpm wallet-system:deploy --lane production-testnet --environment-id <environment-id>
pnpm console:deploy --lane production-testnet --environment-id <environment-id>
```

Both commands deploy Console and Wallet together. Staging and production-mainnet
retain their existing dispatch routes; this change does not add operator activation
authority for those lanes. New writer versions fail closed until activation;
this sequence does not establish zero-downtime rollout. Hosted validation remains
pending. Local evidence is in `.artifacts/r152/coordinated-rollout-20261002/`.

Before upgrading the SDK pin, exercise the packed Wallet Server candidate through
the same composed home-verification E2E. Set `SEAMS_WALLET_SERVER_CANDIDATE` to an
absolute extracted package directory. The test resolves the candidate's public
exports, bundles its JavaScript into the three private Workers, applies its
packaged signer migrations and records package/manifest hashes and bundle inputs.
It rejects accidental imports from the installed Wallet Server package. With no
candidate selected, the development scenario retains the installed SDK plus source
migrations and labels that combination explicitly in its evidence.

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/absolute/path/to/extracted/package \
  pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-home-challenge.e2e.test.ts --reporter=line
```

The local Worker obtains presign configuration from the SDK's existing parser,
with participant IDs 1 and 2. This removes its dependency on the retired `nodeRole`
field. Candidate and installed-SDK type checks must both pass before changing the
exact dependency pin. Package acceptance does not authorize npm publication or
infrastructure deployment.

The workflow is:

1. **Inspect**
   - resolve the current active binding and target environment;
   - classify the target as empty, live-demo replaceable, or durable;
   - refuse a durable project move without a migration/restore receipt;
   - write the `planning` operation.
2. **Prepare tenant root**
   - reuse an exact active root when one already exists;
   - otherwise create it through the existing grant and Router protocol;
   - record only the resulting identity digest and active lineage reference.
3. **Prepare browser credential**
   - issue a new environment-scoped publishable credential;
   - derive required origins from the target surfaces;
   - retain the browser-safe value for the final binding;
   - never reuse the source environment's credential.
4. **Build candidate**
   - resolve the runtime policy and its digest;
   - construct and canonicalize the complete binding;
   - persist it with insert-only semantics.
5. **Verify candidate**
   - run semantic readiness;
   - store the readiness receipt in the versioned cutover record;
   - record every old-to-new identity and endpoint change in the operation.
6. **Quiesce setup**
   - stop admitting new setup operations for the lane;
   - allow existing ceremonies to remain pinned to their binding revision;
   - wait for the bounded setup-admission drain, without waiting for unrelated
     wallet sessions.
7. **Activate**
   - compare-and-swap the active pointer;
   - emit the activation audit and receipt in the same D1 transaction;
   - resume setup admission.
8. **Canary**
   - fetch the public binding projection from the deployed Wallet origin;
   - authorize with its publishable credential from both required origins;
   - create one short-lived canary setup record;
   - prove that the record, signed authorization, Router policy, and root
     lineage carry the activated revision;
   - retain its bounded expiry and response digest in the activation audit receipt.
9. **Retire**
   - wait until ceremonies pinned to the previous revision expire;
   - revoke its browser credential;
   - retain the immutable binding and audit records;
   - keep the old tenant root under its existing recovery and retention policy.

The workflow must be idempotent by operation ID. Retrying an uncertain
activation reads the durable operation and active pointer before performing
another write.

### Tenant onboarding

Initial deployment binding creation is part of project onboarding. After the
development environment and its initial runtime snapshot exist, the onboarding
service calls the same provisioner used by `tenant:cutover`. It automatically
resolves the project, creates or reuses the tenant root, issues the scoped
publishable key from repository-derived origins, verifies all runtime surfaces,
activates the immutable binding, runs the registration canary, and stores the
audit receipt. Onboarding does not complete when provisioning fails.

Retrying onboarding for an environment whose identity and runtime surfaces
already match the active binding reuses that binding. It does not mint another
credential or create another registration canary.

Tenants never enter root identifiers, credential values, origins, or binding
fields. The Console has no browser mutation route for deployment state. The
owner-only Deployment status page reads the public active projection and the
activation audit event; all other roles do not see the navigation item.

## Deployment integration

Change the deployment system around the active revision:

- `deployment/wallet-system/targets.json` declares infrastructure topology and
  `expectedActiveTenantBindingRevision` for each provisioned lane.
- backend and frontend workflows run a preflight that compares the expected
  revision with Console D1 and the Gateway public projection;
- backend deploys fail when a generated Worker still contains a static tenant
  identity source;
- frontend deploys fail when their built assets contain a project environment
  ID or publishable key;
- backend smoke requires `registrationReady: true` for the expected revision;
- wallet-site smoke fetches the public projection and confirms the same
  revision;
- deployment receipts record Git commit, Worker version, Pages deployment,
  binding revision, and readiness-receipt digest.

This leaves code and infrastructure deployment independent from tenant
activation while making their agreement verifiable. A normal code deployment
does not change the active tenant. A tenant cutover does not require rebuilding
the Wallet site.

## Existing ownership to preserve

| Responsibility                                | Existing owner                                                               | R127 change                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Deployment topology and resource identities   | `scripts/deployment-targets.mjs` and `deployment/wallet-system/targets.json` | Retain infrastructure ownership; replace duplicated tenant fields with the expected active binding revision. |
| Gateway Worker rendering                      | `packages/wallet-console-server-ts/scripts/render-d1-gateway-config.mjs`     | Render infrastructure only; remove live tenant identity variables.                                           |
| Active tenant-root grants and identity lookup | `packages/wallet-console-server-ts/src/tenantRootCreation`                   | Remain authoritative; expose an exact active-root reference to the binding builder.                          |
| Tenant-root security status                   | `packages/wallet-console-server-ts/src/tenantRootSecurity`                   | Remain authoritative; participate in semantic readiness.                                                     |
| API credentials                               | Console credential service and D1 store                                      | Add immutable credential attachment and replacement-on-change behavior.                                      |
| Registration ceremony persistence             | `@seams/wallet-server` signer D1 implementation                              | Add required binding revision and resolve execution by captured revision.                                    |
| Router root and policy checks                 | `@seams/wallet-server` Router A/B runtime                                    | Verify binding revision and exact root/policy claims.                                                        |
| Wallet-site configuration                     | `apps/wallet-console` and hosted Wallet bootstrap                            | Load the public binding projection and remove build-time tenant values.                                      |
| Deployment workflows                          | `.github/workflows` and `scripts/deploy-*.mjs`                               | Validate one binding revision and record it in deployment receipts.                                          |

If public Wallet or wallet-server contracts change, implement their normative
types and behavior in `seams-wallet`, publish an exact package release, and
consume that release here. Keep Console composition, deployment coordination,
and production acceptance tests in this repository.

## Migration and legacy removal

Migration is a boundary-only import followed by deletion of the old paths.

1. Add the binding schema, parsers, tables, service, and readiness checks
   without changing active runtime selection.
2. Import one binding for each provisioned lane from:
   - the checked-in deployment target;
   - the live Worker configuration;
   - the active tenant-root record;
   - the active browser credential;
   - the live Router policy.
3. Refuse import when those sources disagree. Produce a report that names each
   mismatch without printing credential values.
4. Activate the imported revision only after semantic readiness passes.
5. Switch Gateway and Wallet Runtime to active-binding resolution.
6. Add binding revisions to all newly created ceremony and runtime records.
7. Let records created before the cutover finish through a boundary parser
   that assigns the one imported revision only when their complete tenant
   scope matches it. Reject ambiguous records.
8. Switch Wallet surfaces to the public binding projection.
9. Remove static tenant identity and build-time browser-credential variables,
   their readers, generators, validation branches, fixtures, and documentation.
10. Remove the pre-R127 record parser after the maximum ceremony and session
    lifetime has elapsed and deployed storage contains no eligible old record.

Do not retain dual runtime lookup, fallback project IDs, or a frontend fallback
key after migration.

## Failure and rollback rules

- Failure before activation leaves the active binding unchanged. The candidate
  credential may be revoked and the unused binding retained for audit.
- An uncertain activation reads the active pointer and operation receipt. It
  never guesses whether the compare-and-swap committed.
- Canary failure closes setup admission for the new revision and initiates the
  rollback decision.
- Automatic rollback is allowed only when the new revision has created no
  non-canary durable wallet state.
- When durable state exists, fail closed and require an explicit remediation
  operation. Moving the active pointer alone would create a split tenant.
- Rollback is another compare-and-swap activation of the previous immutable
  binding and emits its own receipt.
- In-flight ceremonies remain pinned to their captured revisions until expiry
  or explicit cancellation.
- A previous credential stays active until all ceremonies using its binding
  are terminal.
- Tenant roots are never deleted by rollback. Their existing retirement,
  backup, and recovery governance remains authoritative.

## Audit and observability

Record these identifiers on every cutover and registration diagnostic:

- cutover operation ID;
- deployment lane;
- binding revision;
- previous binding revision;
- credential ID;
- tenant-root identity digest;
- custody lineage ID;
- runtime-policy digest;
- activation sequence;
- deployment receipt identifiers.

Do not log publishable-key values, secret key values, root material, wallet
custody seeds, owner signing roots, lane holder shares, ceremony payloads, or
full registration request bodies.

Add categorical metrics for:

- readiness outcome and failed invariant;
- binding-resolution source and latency;
- setup admitted, quiesced, or revision mismatch;
- ceremony revision age at execute time;
- activation, rollback, and retirement outcome;
- deployed revision drift across Gateway and Wallet surfaces.

Alert when:

- repository expected revision differs from Console active revision;
- Gateway readiness reports another revision;
- Wallet public projection reports another revision;
- an active binding's credential or root becomes inactive;
- registration sees a tenant identity or runtime-policy mismatch.

## Delivery phases

### 1. Define binding contracts and static rejection

- Add the canonical types, parsers, encoder, revision digest, and type fixtures.
- Add focused unit tests for environment/network pairing and origin
  canonicalization.
- Add source checks or typed configuration checks proving new core code cannot
  accept independent tenant identity strings.
- Document the public and internal binding projections.

**Gate:** invalid combinations and partial bindings fail at parse time or
compile time; canonical round trips and revision recomputation pass.

### 2. Add immutable persistence and cutover state

- Add Console D1 migrations for bindings, active pointers, and cutovers.
- Implement insert-only binding storage and compare-and-swap activation.
- Implement branch-specific operation transitions and audit receipts.
- Add concurrency tests for duplicate preparation, racing activation, and
  uncertain-result retry.

**Gate:** one lane cannot have two active revisions, and an existing binding
body cannot change.

### 3. Build semantic readiness

- Compose current project/environment, tenant-root, credential, Router-policy,
  and origin services behind one readiness service.
- Add the safe readiness projection to `/readyz`.
- Add behavior tests reproducing the old-Gateway/new-root incident.
- Require exact typed mismatch failures.

**Gate:** the incident configuration fails readiness before registration and a
fully aligned candidate passes.

### 4. Pin registration and runtime state to revisions

- Add binding revision to setup, ceremony persistence, signed Router claims,
  runtime policy, and relevant capability records.
- Resolve execute/finalize by captured revision.
- Add bounded compatibility parsing for exact pre-R127 records.
- Release the required `seams-wallet` package version and consume it here.

**Gate:** a ceremony created before activation completes against its original
binding, while a later setup uses the new revision.

### 5. Replace runtime tenant configuration

- Make Gateway and Wallet Runtime resolve the active binding through Console.
- Remove tenant identity from their live static composition.
- Add the public `.well-known` projection and Wallet bootstrap parser.
- Remove build-time environment ID and publishable-key reads from the Wallet
  site.

**Gate:** changing the active pointer changes new registration configuration
without a Worker or Pages rebuild, and all in-flight operations remain pinned.

### 6. Implement the coordinated operator workflow

- Add plan, status, activate, retire, and rollback commands.
- Integrate existing tenant-root creation/restore and credential issuance.
- Add quiescence, readiness receipt, canary, and retirement steps.
- Surface the same operation state in Console with explicit approval at
  activation.

**Gate:** an empty development environment can move to a new project through
one resumable operation with a complete audit receipt.

### 7. Integrate deployment verification and remove legacy paths

- Store only expected binding revisions in deployment targets.
- Add backend and frontend revision preflight and smoke checks.
- Import and activate current lane bindings.
- Delete static tenant variables, frontend tenant variables, duplicate
  generators, fallbacks, fixtures, and documentation.
- Remove the pre-R127 record parser after its bounded lifetime.

**Gate:** repository validation rejects every duplicate live tenant identity
source, and production deployment proves one binding revision end to end.

## Verification matrix

| Scenario                                          | Required result                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| Development binding names Mainnet                 | Parser rejects it.                                                         |
| Production binding names Testnet                  | Parser rejects it.                                                         |
| Target environment has no active root             | Cutover remains `awaiting_tenant_root`; activation is unavailable.         |
| Root identity digest belongs to another project   | Readiness returns a typed identity mismatch.                               |
| Browser credential belongs to another environment | Readiness rejects the candidate.                                           |
| Hosted Wallet origin is absent                    | Binding construction rejects the candidate.                                |
| Runtime-policy digest differs                     | Readiness rejects the candidate before setup.                              |
| Live Gateway exposes another revision             | Deployment and cutover preflight fail.                                     |
| Two operators activate concurrently               | One compare-and-swap succeeds; the other receives a stale-revision result. |
| Activation response is lost                       | Retry returns the committed receipt without another activation.            |
| Ceremony starts before activation                 | Execute uses the captured previous revision.                               |
| Setup starts after activation                     | Setup uses the new revision everywhere.                                    |
| Canary fails before durable wallet creation       | Setup closes and safe rollback can restore the previous pointer.           |
| Durable wallet exists under the new revision      | Automatic rollback is refused.                                             |
| Source project contains durable wallets           | Ordinary cutover is refused without a migration/restore receipt.           |
| Active credential edit is attempted               | Console requires replacement credential plus a new binding.                |
| Old static tenant variables remain configured     | They have no runtime reader and repository validation fails.               |

## Rollout

Roll out in this order:

1. local development lane;
2. staging-testnet with synthetic roots and credentials;
3. production-testnet development environment;
4. production-mainnet only after the previous lane has completed one cutover,
   rollback drill, and retirement cycle.

Before each production activation, export the current active binding and
activation receipt, confirm tenant-root recovery readiness, and confirm that
the previous credential remains available for the ceremony drain interval.

The first production-testnet cutover should use the environment created during
the incident that motivated R127. Its acceptance evidence must show that the
same binding revision appears in the public projection, setup record, Router
authorization, active root lookup, readiness output, and deployment receipt.

## Completion criteria

R127 is complete when:

- every provisioned lane has one active immutable binding;
- Development/Testnet and Production/Mainnet are enforced by types and
  boundary parsers;
- tenant root, credential, origins, endpoints, and runtime policy are verified
  before activation;
- new setup and all durable ceremony state carry a binding revision;
- in-flight ceremonies survive a cutover through revision pinning;
- Wallet surfaces load their public tenant configuration from the Gateway;
- backend readiness checks the exact active tenant root and credential;
- one resumable cutover operation performs preparation, verification,
  activation, canary, retirement, and safe rollback;
- deployment smoke proves the same binding revision across Console, Gateway,
  Router, and Wallet surfaces;
- active credential mutation is replaced by copy-on-write credential and
  binding rotation;
- static tenant identity variables and build-time browser tenant variables,
  readers, fallbacks, fixtures, and documentation are deleted;
- the production-testnet incident is preserved as an end-to-end regression
  test.

### October 3: resource-set activation contract

The current candidate replaces binding `home` with canonical `resources` and
accepts `resourceCheckpoints` at the protected cutover boundary. Each physical
resource needs its own fresh Gateway/Wallet Runtime proof. Writer admission now
matches role, version, account and database; a configured regional catalog must
match the active set before Console can reserve wallet homes.

Console migration 0054 retires active deployment pointers and unfinished cutovers
so the new contract requires fresh activation. It preserves activation history
and consumed challenge IDs, removes singular resource columns, and atomically
consumes every challenge in an activation. This migration has only been exercised
locally; no hosted state has been reset.

The regional renderer, complete-set operator challenge collection, regional
readiness inspection, and admission renewal for changed serving versions remain
unfinished. The current one-resource operator collector cannot activate the
three-resource hosted catalog. Deployment and release remain held until these
paths are replaced and the composed hosted flow is verified.

### October 3: deployment writer renewal

Explicit protected activation now renews writer admission even when the tenant and
public URLs are unchanged. The provisioner validates the entire resource-proof set
and adopts the existing managed browser credential. Reuse-only onboarding remains
a read-only lookup. Root/credential failures release unfinished cutovers; cleanup
preserves an active credential when the activation committed before its reply was
lost. The new `tenant-deployment-renewal.e2e.test.ts` exercises six-writer replacement,
partial proofs, outage/retry, revoked credentials and lost-reply recovery against
real local D1 persistence.

The final renewal E2E passed in 8.7s; its retained receipt is
`.artifacts/r152/deployment-renewal-20261003/deployment-renewal-evidence.json`
(SHA-256 `d8b232d65474ddeed1431fd2340453b0ca60494ad99f64b09dd4f98d42f1139b`).
The canary authenticates a real persisted key against a controlled HTTP fixture;
provider/Router evidence is controlled and no hosted latency claim follows.
Regional rendering, all-backend proof collection and regional readiness remain
unfinished. Deployment and the 0.8.0 release remain held.

### October 3: regional readiness composition

Hosted Console readiness uses the catalog's three resources through required
`WALLET_RUNTIME_US`, `WALLET_RUNTIME_WEUR` and `WALLET_RUNTIME_APAC` bindings.
Every response must identify its expected physical resource. Readiness requires
exact candidate-set coverage, totals wallet/ceremony counts across regions, and
fails when any regional inspection fails. `WALLET_RUNTIME` still serves existing
control/shared operations while their remaining routing work is pending.

Three focused E2Es passed in 45.5s, including three real local Runtime Workers and
separate signer D1s. An APAC ceremony/outage blocks renewal; wrong-resource and
incomplete-coverage checks reject invalid readiness. Receipt and logs are retained
under `.artifacts/r152/regional-readiness-20261003/`; the public R152 results document
records its SHA-256 and fixture limits. No hosted measurement or deployment occurred.
The regional renderer and complete-set operator proof collector remain required
before deployment; 0.8.0 remains held.

### October 3: explicit regional challenge resources

Protected resource verification now requires `{ deploymentLane, resource,
challengeId, expectedProof }`. Console validates namespace/catalog membership and
uses the resource's fixed regional Gateway/Runtime pair. Its singular Gateway
challenge binding and `SEAMS_D1_HOME_*` settings are retired; operator requests and
provider receipts identify the physical `resource` explicitly.

One Console verifies three local signer D1s and six writer versions in the expanded
challenge E2E. Cross-resource, unlisted and foreign-namespace requests fail. Three
focused E2Es passed in 21.6s, with receipt/logs under
`.artifacts/r152/regional-resource-challenges-20261003/`. Canonical regional targets,
rendered service bindings and complete-set operator collection remain unfinished;
no hosted deployment or release occurred.

### October 3: regional configuration and complete-set operator collection

The canonical Gateway deployment schema is now version 5: explicit US/WEUR/APAC
resources, an ingress region, and an allocated/pending signer-D1 branch. The
existing APAC resource IDs and public ingress names remain configured. US/WEUR
allocations remain pending in each lane; no new live UUIDs or allocations were
invented. These are configured placement hints, not a new provider locality
measurement. Schema 4 and singular signer-resource configuration are rejected.

The renderer requires `--region US|WEUR|APAC` for Gateway and Wallet Runtime and
renders one shared Console. All seven configurations receive the catalog; Console
receives six regional bindings, Gateways receive three named `WalletHomeGateway`
bindings, and each regional writer pair binds its own signer D1 with matching
placement. Only the ingress Gateway receives the public custom domain. Existing
shared/control Runtime calls retain the ingress Runtime pending their routing
refactor. Pending allocations block rendering, deployment preflight and proof
collection. Migration/deployment commands iterate all three signer resources and
writer pairs while retaining packaged migration fingerprint checks.

The operator now returns three fresh resource checkpoints. It checks serving
versions and physical bindings for all six writers before challenges, rechecks the
complete set after challenges, rejects any drift/expiry, and passes the full proof
array to protected activation. Every challenge is cleaned up, including an INSERT
that commits before its response is lost. A third-region lost-response scenario
verifies zero challenge rows remain in all three databases. The composed D1
activation test uses all three actual CLI-collected proofs; synthetic extra-region
activation proofs were removed.

Four focused E2Es passed in **22.6s**, covering seven rendered configurations,
pending-allocation refusal, provider binding failures/rollout drift, local
Worker/D1 challenges and complete-set activation. Targeted candidate-backed
TypeScript, lint and formatting checks passed. Ten existing deployment-target
behavior checks passed; an unrelated source-text guard expecting SES workflow
secrets still fails against the current Resend workflow and was left unchanged.
The old single-region placement test was replaced by the regional rendering E2E.

Repeat from the private repository:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/regional-deployment-config.e2e.test.ts \
  relayer/tenant-d1-provider-bindings.e2e.test.ts \
  relayer/tenant-deployment-binding.e2e.test.ts \
  relayer/tenant-home-challenge.e2e.test.ts --reporter=line
```

Evidence is retained in the private repository under
`.artifacts/r152/regional-deployment-set-20261003/`, including command logs,
`tsconfig.json`, deployment plan, receipts and `receipt-index.json`:

| Receipt | SHA-256 |
| --- | --- |
| `regional-deployment-config-evidence.json` | `062787fae71a892ba7fe84849aa090c86ecc470ff164fde6f601ede3e6c1f9f6` |
| `runtime-resource-challenge-evidence.json` | `88288f58f26b2e1ac5dcfa2e5a6888eff273315d32d26332a910e80811605bab` |
| `combined-home-checkpoint.json` | `a6914728dd3e29eabd5ef647c35732f240b8342d124e7beb7f335218c5a840f9` |

Provider HTTP and resource allocations are controlled test fixtures. These results
prove local composition and operator behavior; no hosted timing was measured.
Before hosted rollout, allocate/verify US and WEUR resources, bootstrap the new
service-binding targets, and inspect the frozen deployment plan. The ordinary
update order assumes targets already exist and does not bootstrap mutual service
bindings. Shared identity/session/recovery routing, internal/deferred enforcement,
expiry reconciliation and hosted travel/concurrency tests remain open. No remote
deployment, schema reset or package publication occurred; 0.8.0 remains held.

### October 3: opaque session and exchange routing

Console migration 0055 adds a tenant-scoped digest-to-wallet index. Gateway hashes
opaque primary/hosted credentials and exchange codes, resolves their wallet home,
and forwards through the existing fixed regional binding. Explicit wallet paths
must agree with the session wallet. Unknown credentials return 401; directory
outages return 503. The home-local authorization store still owns validity,
expiry, exchange consumption and revocation.

Only an admitted writer at the wallet's physical home can publish a locator.
Primary credentials (including linked-device activation) now share one preparation
path. Direct credential and exchange locators publish before local persistence;
a failed local commit can leave an inert locator. Hosted child credentials publish
after successful home-local exchange consumption and before returning the token.
If that publication fails, the caller receives no token and needs a fresh exchange;
the parent session remains usable. This is fail-closed ordering across two D1s,
with no distributed atomicity claim. Expired locators remain routable so the home
can apply current lifecycle rules; expiry metadata alone grants no authority.

The three-region Worker/D1 scenario passes with 12 digest-only locators. It checks
remote ingress, one winning concurrent exchange redemption, wrong-home publication,
wallet/token disagreement, publication outage, retirement of primary and child
credentials, and continued access by a second device of the same wallet. It uses
the production authorization preparation and local commit statements used by linked
devices; the complete device-linking ceremony is outside this test. Three existing
directory/challenge/activation E2Es also pass (25.3s). SDK build, public and
candidate-backed private type checks, focused lint and public bloat checks pass.

Remaining: passkey/external-identity/recovery/delivery lookup and shared uniqueness;
direct Yao, Runtime and deferred home enforcement; expiry/fresh-attempt handling;
verified regional allocations and service-target bootstrap; hosted concurrency and
travel acceptance. The replacement remains incomplete and 0.8.0 remains held.
No hosted deployment, reset, publication or geographic measurement occurred.

Repeatable evidence and commands are recorded in the public
`docs/refactor-152-results.md`, “opaque session and exchange routing evidence”.
Local receipt: `.artifacts/r152/session-routing-20261003/regional-session-routing-evidence.json`,
SHA-256 `4046e52174715aff31d8ac19545db4adc4f7d4bbff32c518326c96fe2d36398f`.

### October 3: direct registration continuation placement

Gateway resolves both direct Yao registration routes by their existing ceremony
locator before regional service construction. Initial registration credentials
and later Wallet Sessions reach the ceremony's reserved/established home; a
session for another wallet is rejected. Malformed/unknown/cancelled ceremonies
fail closed, and directory outages return `wallet_home_unavailable` with 503.
Protocol proof validation remains in the home handler. No new index or wire field.

The local directory E2E passed (9.4s), with 12 simulated continuation effects in
exactly their assigned regional D1s. The session composition also passed, including
six cross-wallet ceremony rejections. Type checks and lint passed. Receipt hashes,
repeat commands and test limits are in the public `refactor-152-results.md` direct
registration checkpoint; evidence is retained in
`.artifacts/r152/direct-registration-routing-20261003/`.
Direct recovery/export and remaining shared/internal/deferred routes are still open.
Release 0.8.0 remains held; no hosted deployment or latency measurement occurred.

### October 3: recovery code and operation routing

Console migration 0056 owns immutable, tenant-scoped `wallet_recovery_routes`:
`code` contains the existing contextual recovery-code digest; `operation` contains
the server-issued recovery operation ID. Neither stores a recovery code, custody
secret, envelope, factor proof or credential. Publication requires the admitted
writer at the wallet's exact physical home. A conflicting code anywhere in a
submitted set prevents all new claims in that set. Identical retries are accepted.

The public custody commit store publishes code routes before registration and
rotation's existing local atomic batches. Successful publication followed by a
failed local CAS can leave inert metadata. Rotation/consumption removes or changes
home-local usable material; shared lookup metadata alone cannot make a code usable.
Old route entries remain bound to their original wallet. A scoped disposable-data
reset must include this table alongside homes and session locators. No legacy
namespace routing or migration fallback was added.

Preparation publishes its operation ID after reserving the code and before exposing
the prepared operation. A publication outage returns a distinct `routing_unavailable`
result, rendered as HTTP 503 `wallet_home_unavailable`. An interrupted attempt can
retain its existing local hold until the reservation timeout; this change adds no
cross-D1 transaction or rollback. Subsequent local attempt/proof checks remain
mandatory even when a shared operation route exists.

| Route | Home lookup |
| --- | --- |
| `/wallets/recovery/prepare` | Decode transiently, derive the existing contextual digest, zero the decoded bytes, resolve shared code route |
| `/wallets/recovery/finalize`, `google/verify`, `email-otp/verify`, `email-otp/release`, `google-email-otp/finalize` | Shared recovery operation ID; reject a supplied wallet ID that differs |
| `/wallets/recovery/read`, `rotate`, `acknowledge-backup` | Scoped wallet ID from the request body |

An accompanying session must resolve to the same wallet. Unknown recovery lookup
and home-local absent/retired codes use the generic recovery-code refusal. Home
proof verification remains authoritative. Direct Yao recovery/export lifecycle IDs
are a separate remaining lookup seam, as are passkey/provider uniqueness, delivery,
internal/deferred enforcement, expiry/fresh attempts and hosted acceptance.

The local three-region session/recovery E2E and focused composition checks pass.
Canonical custody registration and rotation commits are exercised with synthetic
ciphertext; full recovery ceremonies and hosted latency remain unverified. See the
public `refactor-152-results.md` recovery checkpoint for commands and limitations.
Evidence: `.artifacts/r152/recovery-routing-20261003/`; receipt SHA-256
`e0049be9472103d6b256fb1e62b8c1cd3ca2bae470ec5a5402346172c716c104`.
No hosted deployment or publication; 0.8.0 stays held.

### October 3: direct Yao wallet-identity entry routing

The Gateway resolves recovery bootstrap/admission/status and export admission
through the existing scoped wallet directory before constructing local services.
Their request wallet and any Wallet Session must agree. Twelve route/home cases
passed through regional Worker transports and Console D1; malformed/unknown IDs,
conflicting sessions and directory outages fail closed. Terminal protocol execution
is controlled; this is routing evidence only. The public R152 results doc records
the repeat command and receipt hash under `yao-entry-routing-20261003`.

Opaque lifecycle continuations and wallet-less linked-device QR coordination remain
open, along with shared identity, internal/deferred enforcement, terminal cleanup
and hosted acceptance. No deployment or 0.8.0 publication occurred.

### October 3: opaque Yao lifecycle routing

Recovery execute/activate now extract `binding.lifecycle.lifecycle_id`; export
execute extracts `protocol.binding.ceremony.lifecycle.lifecycle_id`. The Gateway
resolves the scoped operation-kind/ID before constructing regional services, checks
any Wallet Session against the same wallet, and repeats lookup at the receiving
home. Unknown routes return 404, malformed IDs 400, conflicts 403 and lookup outages
503. The home still owns full protocol authorization, expiry and one-use state.

The public recovery handler publishes after successful authorization and admission
preparation, before the prepared claim is committed or backend admission runs.
The export handler publishes after its existing atomic authorization commit and
before backend admission. Publication conflicts return 409 `wallet_home_conflict`;
outages return 503 `wallet_home_unavailable`. An export publication failure can leave
an authorized local record; its existing exact-request replay handles retry. There
is no cross-D1 transaction. A later local/backend failure can leave inert route
metadata; the locator alone grants no authority and is never reassigned.

Console migration 0057 consolidates recovery code/operation and Yao lifecycle
locators into `wallet_routes`, preserving existing claims and dropping the former
`wallet_recovery_routes` table and its triggers. The single immutable store and
service endpoints replace the recovery-only implementation; no compatibility
endpoint remains. Only the admitted writer at the wallet's physical home can
publish. Scoped reset must include `wallet_routes` with homes and session locators.

Remaining: shared passkey/provider uniqueness and lookup, pre-wallet linked-device
coordination and approved delivery, internal/deferred home enforcement, terminal
expiry/fresh attempts, cleanup and full hosted acceptance. Release 0.8.0 stays held.

### October 3: passkey challenge and explicit-wallet authentication routing

The Gateway now resolves `/auth/passkey/options` from `user_id`, passkey
`/wallet/unlock/challenge` from `userId`, and both corresponding verification
routes from the opaque challenge ID. Email OTP unlock challenge/verify plus
`/wallet/email-otp/challenge` and `factor-release` resolve the supplied `walletId`.
Any Wallet Session and any supplied wallet ID must agree with the resolved home.
Existing home-local proof, active-method, enrollment, expiry and consumption checks
remain authoritative.

The actual D1 WebAuthn service publishes a `passkey_challenge` locator after finding
an active credential and before writing/exposing its local login challenge.
Migration 0058 adds this kind to the existing immutable `wallet_routes` index,
preserving all claims and leaving no parallel table or compatibility endpoint.
Publication conflicts return 409; outages return 503 through both public challenge
handlers. A later local-write failure may leave inert metadata, which grants no
authority. Consumed/expired challenges retain their home route and fail in the local
store. Route retention/cleanup remains part of terminal-state work.

Review found the public auth parser accepted repeated/trailing slashes while home
dispatch used exact paths. It now requires canonical paths; the regional E2E checks
both aliases return 404 without creating challenges. No alias fallback remains.

This closes challenge-based passkey entry routing, not global credential/provider
uniqueness, provider discovery or full hosted unlock acceptance. Shared identity,
pre-wallet linked-device coordination, internal/deferred home enforcement, terminal
reconciliation/cleanup and hosted lifecycle/travel verification remain open.

### October 3: explicitly selected Google login

`/auth/google/verify` with `account_mode: login` and `wallet_id` now resolves that
wallet's scoped home before constructing regional services. Invalid selections and
register-mode selections are rejected; directory outages and conflicting Wallet
Sessions fail closed. Provider token verification remains in the home handler.
Requests without `wallet_id` retain their separate discovery/registration path,
whose shared authority remains unfinished.

Review found `resolveLoginSession` could fall back from a mismatched selected
wallet to another locally linked/discovered wallet, or to registration after a
miss. It now returns the precise `wallet_identity_mismatch` failure, with required
selected-wallet and verified-provider fields. The new branch rejects registration
fields and mismatched mode/code combinations in type fixtures. An explicit
selection never silently changes wallet identity.

The three-home composition uses the production request parser, resolver, D1
identity store and D1 enrollment store. Valid selections succeed through foreign
ingress; another valid account/wallet in the same home cannot substitute for the
selection. Missing enrollment fails without registration; session conflicts and
outages are rejected. Google token verification and enrollment ciphertext are
controlled fixtures. Shared provider/credential uniqueness, discovery, linking,
internal/deferred enforcement, terminal cleanup and hosted acceptance remain open.

### R152 shared identity checkpoint — October 3

Hosted Gateway identity operations now use the authenticated Console service and
its shared `identity_links` table (migration 0059). The existing public D1 identity
store supplies claim/move/unlink behavior. Scope comes from admitted writer context.
Three-region composition verifies competing claims, common reads, project isolation,
move restrictions and fail-closed outages; Google selected-wallet resolution uses
the shared store. Receipt: `.artifacts/r152/shared-identity-20261003/regional-session-routing-evidence.json`.
Apply migration 0059 before deploying this candidate. No deployment occurred.
Provider discovery forwarding, shared offers/limits/credential uniqueness,
linked-device coordination, internal/deferred routing and hosted acceptance remain
open; release 0.8.0 stays held.

### R152 verified Google discovery — October 3

Login without `wallet_id` now verifies the Google token before reading the shared
provider mapping and dispatching to its wallet home. Both endpoints use the same
production proof verifier, with no generic identity-link side effect during
routing. The regional composition uses real RSA verification with fixture JWKS;
shared identity and home lookups use production Console/D1 services. New-account
registration offers, credential uniqueness, rate limits, linking and remaining
internal enforcement are still open. No deployment or release occurred.

### R152 shared Google registration offers — October 3

Gateway registration-attempt operations now use Console `/registration-offer` and
migration 0060. Apply the migration before deploying this candidate. Scope comes
from admitted writer context; supplied runtime scope must match it. Concurrent
regional creation returns one offer; retries and sequential restarts share state.
Pending-only updates reject stale writes after abandonment and do not recreate
missing records. Regional offer tables remain unused in composition. Receipt:
`.artifacts/r152/shared-offers-20261003/regional-session-routing-evidence.json`.
Candidate-selection, concurrent restart/completion, expiry/reservation cleanup,
shared limits/credential uniqueness and hosted acceptance remain open. No deployment
or release occurred.

### R152 immutable Google candidate claims — October 3

Console migration 0061 (signer equivalent 0043) adds the registration-intent digest
claim. Candidate selection is an atomic operation exposed through the authenticated
offer service. Competing candidates/intents, stale selection writes and restart of
a claimed offer are rejected; identical retries succeed. The SDK authority path
claims only after proof, runtime-scope and duplicate-method validation. The regional
composition verifies claim contention, not complete custody registration. Identity
publication/offer completion races, expiry and home reconciliation remain open.
No deployment or release occurred.

### R152 atomic registration completion — October 3

Console offer completion now batches the identity link and offer activation in its
own D1 authority, followed by an acknowledgement lookup. Failed activation rolls
back identity publication. The public resolver uses the same store command in
hosted and standalone composition; sequential linking/finalization was removed.
Completed offers survive pending-offer expiry cleanup for retry. Regional custody
commit remains a separate database boundary requiring reconciliation with shared
completion, expiry and wallet-home reservation. Receipt:
`.artifacts/r152/registration-completion-20261003/regional-session-routing-evidence.json`.
No deployment, reset or release occurred.

### R152 completion after offer expiry — October 3

Post-wallet-commit completion carries the original intent digest. Console verifies
the claim and requires the authenticated writer to match the assigned wallet home.
Expired claims survive pending cleanup; normal expired completion remains rejected.
The regional composition simulates the interruption with a retained claim and real
home reservation. Full custody crash/replay and terminal claim/home cleanup remain
open. No deployment or release occurred.

### R152 claimed-offer cleanup audit — October 3

Removed unrestricted shared-offer deletion and confined malformed-record deletion
to unclaimed rows. Expired pending claims remain visible to wallet allocation.
The composed scenario rejects the removed command, preserves the record and then
completes through its original intent/home writer. Full terminal home/custody
reconciliation remains open. No deployment or release occurred.

### R152 terminal cleanup and shared limits — October 3

Console migrations 0062 and 0063 enforce terminal offer cleanup and store shared
Email OTP counters. Only the assigned writer can finish a home; active Google
offers prevent cancellation. Four policy scopes each admitted three of six
concurrent regional requests, with project isolation and outage rejection verified.
Persistent home-directory E2E also passed. Evidence is retained under
`.artifacts/r152/shared-limits-20261003/`. Deploy these migrations with the matched
SDK/Console candidate after the remaining release gates pass. Full custody replay,
passkey uniqueness, linked devices and hosted verification remain open.
No deployment, reset or release occurred.

### R152 shared passkey reservation — October 3

Console migration 0064 reserves scoped RP/credential ownership for a wallet, gated
by its assigned writer. The matched SDK candidate calls it before registration,
add-method, recovery and linked-device binding writes. Regional composition proved
one owner under contention, retained claims after interrupted writes, safe retry,
foreign-writer rejection and outage rejection. Claims do not authenticate users.
Credential discovery publication, terminal reconciliation and full hosted lifecycle
acceptance remain open. Receipt: `.artifacts/r152/passkey-claims-20261003/`.
No deployment or release occurred.

The matched public candidate also passed all 13 isolated passkey registration
contracts via `pnpm --dir tests test:intended:representative`. Logs and JSON artifacts
are retained beside the regional claim receipt. These local lifecycle contracts
supplement the regional composition; hosted acceptance remains outstanding.

### R152 terminal claims and account sync — October 3

Migration 0065 prevents cancellation after passkey ownership is claimed. The service
returns a home conflict while retaining the claim/home for reconciliation; claim
and cancellation races cannot both succeed. Known-wallet account sync now publishes
and resolves home-bound challenges. Wallet-less hosted sync returns explicit 503
until discovery is implemented. Nine terminal ordering/race cases, regional sync
travel/conflict/outage checks and persistent-directory E2E passed. Evidence:
`.artifacts/r152/passkey-terminal-sync-20261003/`. No deployment or release occurred.

### R152 shared discovery challenges — October 3

Console migration 0066 adds shared sync challenges and consumption tombstones.
Gateway discovery resolves RP/credential claims to a home; consumption is restricted
to that home's admitted writer. The SDK home verifier still requires committed
binding, active method and WebAuthn proof. The temporary wallet-less unavailable
branch and hosted local sync challenge writes are removed. Typed errors preserve
503 handling across separately bundled SDK entry points.

Regional composition passed travel, replay, expiry, project isolation, outages and
uncommitted-binding rejection. The local unlock/export/signing browser contract
passed. Evidence: `.artifacts/r152/passkey-discovery-20261003/`. Full hosted proof
verification and remaining R152 lifecycle gates remain open; no release or deployment
occurred. Include this table in scoped resets and expired-row cleanup.

### October 3: regional discovery proof acceptance

The R152 composition now verifies real ES256 sync assertions against shared
single-use challenges and regional authenticators. It covers known-wallet and
wallet-less travel, concurrent consumption, forged signatures, wrong signed origins,
wrong challenges, and revocation after challenge issuance while the shared claim
remains. Evidence is in `.artifacts/r152/discovery-signature-20261003/` and the
public `docs/refactor-152-results.md` records its checksum and limitations.

This is local service composition. Expected origin and signer-manifest lookup are
fixture inputs; full browser discovery/session bootstrap and live timing remain
open. Linked-device pre-wallet coordination, durable terminal reconciliation and
internal/deferred enforcement still block release 0.8.0.

### October 3: shared linked-device request proofs

Console migration 0067 adds tenant-scoped linked-device request-proof nonces. Hosted
Gateway composition supplies the shared port to the SDK verifier; standalone SDK
composition retains local persistence. Three-region composition verifies real signed
proof contention, replay, lost acknowledgement, invalid signature, expiry, project
isolation and outage recovery. The create route returns 503 while Console authority
is unavailable; hosted regional nonce tables remain empty. Evidence and validation
logs: `.artifacts/r152/device-proof-nonces-20261003/`; the public R152 results document
records its SHA-256. Include this table in scoped operational reset inventories.

QR session creation/polling and owner-home handoff remain unimplemented. This checkpoint
closes replay-authority work only. Release 0.8.0 remains held.

### October 3: linked-session home binding

Migration 0068 extends immutable lifecycle routes with `linked_device`. The SDK
publishes after owner authorization and before the regional claim CAS; Gateway
continuations resolve this binding, including nested Email OTP and source execution.
Three-region composition covers competing owners, denied authorization, publication
outage, lost replies, cancellation retention, project isolation and traveling routes.
Evidence: `.artifacts/r152/link-home-20261003/`; checksum and limitations are in the
public R152 results document. Shared unclaimed QR coordination and crash-safe local
installation remain open. Release 0.8.0 remains held.

### October 3: shared linked-device bootstrap and home import

Migration 0069 adds shared QR bootstrap state. Its claim transaction publishes the
linked-device route and winning claim together, replacing the preceding separate
publication step. Generic route publication now rejects linked-device locators.
The matched SDK candidate needs signer migration 0044: a durable import receipt
commits with the home session and claim transcript and survives session cleanup.
Include both tables in scoped operational reset inventories; shared terminal
snapshots and import receipts must not be removed by ordinary expiry cleanup.

Local three-home composition covers shared creation/polling, competing owners,
claim/cancel races, transactional rollback, lost replies, failed import recovery,
foreign-home rejection and cleanup without resurrection. Evidence is recorded in
`.artifacts/r152/bootstrap-20261003/` and the public R152 results document. Owner
permission and subsequent device actions remain controlled in this composition;
complete approval/delivery/authority installation, terminal reservation
reconciliation, internal/deferred routing and hosted latency remain open. Release
0.8.0 remains held. No infrastructure was deployed.
