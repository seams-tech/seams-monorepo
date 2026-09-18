# Refactor 127: immutable tenant deployment bindings and coordinated cutover

**Status:** In progress. The canonical contracts, insert-only persistence,
atomic compare-and-swap activation, cutover state store, signed semantic
readiness, public projection, and deployed Gateway/Wallet runtime resolution
are implemented. Authenticated, step-up-protected plan, status, tenant-root,
readiness, and activation operations now use production Console, Router, and
Wallet Runtime adapters. Setup admission is quiesced and drained before the
zero-ceremony readiness receipt is issued. Ceremony revision pinning in
`seams-wallet`, canary/retire/rollback operations, the cutover CLI, and the
safe readiness response projection remain delivery gates.

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

Expose the workflow through an authenticated Console operation and a CLI used
by deployment automation:

```text
pnpm tenant:cutover plan --lane production-testnet \
  --environment-id proj_example:dev

pnpm tenant:cutover status --operation tco_...
pnpm tenant:cutover activate --operation tco_...
pnpm tenant:cutover retire --operation tco_...
pnpm tenant:cutover rollback --operation tco_...
```

`plan` resolves organization and project identity from the target environment.
It does not accept separate organization and project overrides that can form
an inconsistent identity.

The workflow is:

1. **Inspect**
   - resolve the current active binding and target environment;
   - classify the target as empty, live-demo replaceable, or durable;
   - refuse a durable project move without a migration/restore receipt;
   - write the `planning` operation.
2. **Prepare tenant root**
   - reuse an exact active root when one already exists;
   - otherwise direct the operator through existing creation or restore;
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
   - display every old-to-new identity and endpoint change for approval.
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
   - expire the canary record explicitly.
9. **Retire**
   - wait until ceremonies pinned to the previous revision expire;
   - revoke its browser credential;
   - retain the immutable binding and audit records;
   - keep the old tenant root under its existing recovery and retention policy.

The workflow must be idempotent by operation ID. Retrying an uncertain
activation reads the durable operation and active pointer before performing
another write.

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
