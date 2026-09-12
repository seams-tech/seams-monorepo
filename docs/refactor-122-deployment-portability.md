# Deployment Portability

Date created: August 5, 2026

Last reconciled: September 5, 2026 (R120/R121 authority, recovery boundaries,
snapshot evidence, and cutover lifecycle)

Status: active design plan. Refactors 120 and 121 supersede Refactor 102 as
the current tenant-root and root-recovery plans. Wallet custody, key identity,
device authority, and exact sessions follow their current contracts. Portability
must define its curve-specific server handoff and demonstrate the destination
wallet lifecycle; R102's retired validation backlog is no implementation gate.
The tenant-scoped backup format, managed recovery importer, production self-host
bootstrapper, Router A/B handoff ceremony, tenant cutover fence, and
source-independent restore path remain unimplemented. Refactor 130 is a bounded
same-account deployment demo and is not the production self-hosting product or
a migration destination.

[Refactor 122B](./refactor-122B-direct-migration.md) defines the guided deployment
and direct-transfer experience for cooperative migration. It consumes this
plan's canonical wallet payload, importer, deployment compiler, and cutover
contracts. Direct migration removes manual archive handling from the normal
flow; durable encrypted backups retain the source-unavailable recovery path.

## Decision Summary

1. The first supported self-host target is customer-owned Cloudflare
   infrastructure running Gateway, Router, Deriver A, Deriver B, SigningWorker,
   and the tenant-root control-plane Worker. The production account and
   transport profile must preserve Refactor 120's Deriver A/B administrative
   separation. Refactor 130's same-account topology is demo evidence and does
   not carry the managed production isolation claim.
2. Operators configure one small single-tenant deployment specification. A
   bootstrapper installs role-local operational secrets, public keys, bindings,
   stores, and a signed deployment manifest. Tenant-root shares are created
   inside the owning Derivers through Refactor 120's distributed ceremony.
3. Managed deployment environment variables, root shares, KEKs, API tokens,
   relayer keys, databases, and CI credentials never cross the tenant export
   boundary.
4. `TenantPortabilityPackageV1` is the durable encrypted backup containing the
   selected tenant's wallet inventory, credential metadata, encrypted recovery
   material, portable policy projections, and audit checkpoint. R122B delivers
   the same canonical wallet payload directly through destination-bound role
   envelopes; both delivery paths use the same verified domain importer.
5. Each wallet key carries a curve-specific portability capsule sufficient to
   hand one incomplete server participant from the managed deployment to the
   dedicated destination while preserving the owner's complementary holder
   material, public key, and address. The exact Ed25519 and ECDSA capsule
   protocols must be frozen before implementation.
6. The destination generates new deployment secrets and re-encrypts imported
   records under new role identities, KEKs, and epochs. Import never copies raw
   source rows into live destination stores. Owner-encrypted envelopes retain
   their authenticated inner bytes inside destination-owned storage wrappers.
7. `WalletId`, `WalletKeyId`, public keys, addresses, and customer-owned wallet
   origin remain stable. Source organization, project, environment, and storage
   identifiers map once at the import boundary.
8. Agent identities and desired Agent Wallet settings may move with the wallet.
   Active delegated-spend authorizations, budget reservations, replay claims,
   sessions, and presignatures do not. The owner reauthorizes Agent Wallets on
   the destination after activation.
9. Delivery is backup-first: customer-held encrypted portability backups and a
   tested restore into a fresh Seams-operated recovery destination precede the
   production self-host bootstrapper and managed-to-self-hosted cutover.
10. The preferred cutover provisions and validates destination lanes before the
   source is disabled. A previously downloaded current package provides the
   source-unavailable escape path.
11. The historical `SigningRootMigrationBundleV1` no longer exists in the
    repository. The [customer-owned wallet domain plan](./saas/self-hosted-migration.md)
    already points to this portability boundary. No compatibility importer
    enters the new migration path.
12. A self-hosted customer may later buy Seams-managed backup custody and a
    separately provisioned standby signing lane. That managed-continuity
    product is a follow-up protocol. It must preserve mandatory wallet-owner
    participation, explicit failover authorization, and one authoritative
    signing backend at a time.

## Dependencies And Authority

This plan consumes:

- [Refactor 100](./refactor-100-passkey-account-refactor.md) for portable
  encrypted owner custody, recovery envelope sets, credential replacement, and
  exact mixed-wallet identity continuity;
- [Refactor 101](./refactor-101-wallet-execution-lanes.md) for stable
  `WalletKey` identity and independently replaceable holder/server execution
  lanes;
- [Refactor 103E](./refactor-103E.md) for linked-device continuity and exact
  wallet-authority activation;
- [Refactor 104](./refactor-104-agent-id-spending.md) for agent identities,
  delegated authorizations, server-canonical budgets, replay state, and Agent
  Wallet projections;
- [Refactor 120](./refactor-120-rotate-tenant-secrets.md) for the authoritative
  per-tenant derivation-root boundary, operational-share refresh,
  independent-root deployment semantics, and production Deriver isolation;
- [Refactor 121](./refactor-121-tenant-derivation-root-security.md) for
  role-separated tenant-root recovery packages and exact-root disaster recovery.
  Its root restore is separate from this plan's wallet-data and signing-material
  portability; this plan must explicitly decide any composition;
- [Refactor 90](./refactor-90-modular-auth-capabilities-plan.md) for exact
  authorization resources, operation identity, atomic claims, fencing, audit,
  and prepared execution;
- [the canonical Router A/B deployment](./router-ab/deployment.md) for strict
  role boundaries, production artifacts, private stores, and fail-closed role
  configuration;
- the Ed25519 Yao and ECDSA Router A/B protocol documents for recovery, export,
  recipient provisioning, activation, signing, and identity verification.
- [Cloudflare self-hosted example](../examples/self-host-cloudflare-worker/refactor-150-cloudflare-self-hosted-wallets.md)
  for the bounded Cloudflare deployment demo whose proven public-package,
  onboarding, and doctor surfaces may later be promoted into this production
  product after an independent isolation review.

This plan owns:

- the tenant portability package and encryption boundary;
- managed multi-tenant export into a single-tenant package;
- single-tenant destination bootstrap and configuration compilation;
- deployment-local secret generation and recovery packaging;
- source and destination migration lifecycle, fencing, activation, rollback,
  and receipts;
- source-to-destination identity mapping;
- agent authorization behavior during deployment migration;
- product and SDK surfaces for backup, restore, and deployment cutover.

It does not redefine either signing protocol, lower the Router A/B role
separation requirements, or make development-only transports eligible for
production.

Refactor 102 is superseded and retained in Git history. Its
former lane-provisioning plan and vector backlog establish no current
portability guarantee or implementation prerequisite. Root share refresh,
active signing-share refresh, independent-root linking, and exact-root disaster
recovery retain their distinct scopes under Refactors 120 and 121.

## Goal

Allow a customer to leave the managed multi-tenant Seams deployment and run
the same wallets in a dedicated, single-tenant deployment without changing any
wallet public key or address.

```text
managed Seams deployment
  -> tenant-scoped encrypted portability package
       -> customer-owned deployment bootstrap
            -> fresh destination Router A/B secrets and stores
                 -> imported wallet keys and fresh execution lanes
                      -> verified identical public keys and addresses
```

`single tenant` means one customer or application tenant. The deployment may
serve many human users, Human Wallets, wallet keys, devices, and Agent Wallets.
The deployment customer operates the destination server participants. An
end-user wallet owner retains the complementary holder material. Tenant
administration alone never grants complete wallet-key export authority.

The customer experience should be:

```text
seams self-host init
seams self-host import customer.seams-backup
seams self-host verify
seams self-host activate
```

The operator supplies deployment identity, customer-owned origins, Cloudflare
authority, chain settings, and a backup recipient. They do not hand-author the
Router, Deriver A, Deriver B, and SigningWorker environment matrices.

## Product Portability Contract

### Wallet identity portability

The following identities remain byte-for-byte stable:

- `WalletId`;
- every active `WalletKeyId`;
- Ed25519 public keys and registered account bindings;
- secp256k1 threshold public keys and EVM addresses;
- wallet-key versions that identify the imported keys;
- the customer-owned wallet origin and RP ID when the customer keeps the same
  domain boundary.

Credential IDs, lane IDs, holder/server participants, share epochs, sessions,
and deployment epochs may change. The current custody and device contracts
treat these as replaceable access and execution state.

### Deployment portability

Deployment portability means the customer can:

- move from managed Seams into a customer-owned Cloudflare account;
- operate the Router A/B and tenant-root control-plane components without
  manually managing their internal configuration graph;
- restore from a customer-held package when the managed source is unavailable;
- move back to managed Seams or into another supported deployment through the
  same package and import protocol;
- verify public-key and address continuity independently before activation.

The first release supports the customer-owned Cloudflare profile. A future OCI
or Kubernetes profile must reuse the same transport-neutral protocol and
package boundary. It requires separately reviewed transport, storage, secret
manager, availability, and role-isolation adapters.

### Product delivery modes

Portability ships through three explicit product boundaries:

1. **Managed portability backup** — Seams creates a tenant-scoped encrypted
   package for a customer-controlled recipient and proves restoration into a
   fresh Seams-operated recovery destination.
2. **Customer-owned deployment** — the customer imports the same package into
   a supported self-hosted deployment, verifies wallet identity continuity,
   and completes the fenced cutover.
3. **Managed continuity for self-hosted deployments** — an optional future
   service in which Seams stores customer-encrypted recovery packages and runs
   a separately provisioned standby signing lane.

The managed-continuity service does not receive the customer's primary server
participant or any owner holder material. Its standby lane preserves the same
wallet public identity through a separately specified destination-authority
provisioning protocol and requires the wallet owner's complementary holder
material. Refactor 120's tenant-root refresh leaves that material unchanged.
Backup custody and standby signing use separate keys, stores, authorization,
operators, and audit trails.

Failover is an explicit fenced operation. A health check cannot activate the
standby lane, and active-active admission is outside the first continuity
product. A separate plan must define emergency approval, policy projection,
replay and nonce reconciliation, expiry, restoration, and standby-lane refresh
or revocation.

### Agent portability

Agent portability is part of wallet deployment migration. It is not a separate
wallet-key portability mechanism.

The package may retain:

- agent IDs and public identity keys;
- display metadata;
- declared custody bindings that remain valid in the destination environment;
- requested scope, budget, counterparty, expiry, and policy projections for
  owner review;
- completed audit evidence.

The package never activates those projections. The destination owner signs a
fresh delegated-spend authorization after wallet activation. This prevents a
mutable source budget, replay reservation, revocation epoch, or ambiguous
operation from silently acquiring authority in a new deployment.

## Current Architecture And Gaps

### Router A/B complexity

The wallet backend topology includes six deployed runtime artifacts:

```text
Gateway
Router
Deriver A
Deriver B
SigningWorker
Tenant-root control plane
```

Deriver A, Deriver B, and SigningWorker each have private storage and private
cryptographic material. Public encryption and verifying keys are distributed
to their peers. The Router carries public policy and routing material and must
remain unable to read private role state. Gateway owns product ceremonies,
wallet and credential metadata, authorization state, and its dedicated durable
store. The tenant-root control-plane Worker holds the routine issuer key and
coordinates with the Router-owned authoritative lifecycle Durable Object.
Gateway and the control plane hold no A/B root shares. Each Deriver also owns
its separate managed-backup storage.

The current Cloudflare deployment exposes this internal graph as a large set
of Worker bindings, database identifiers, key epochs, public keys, private
keys, KEKs, internal authentication values, JWT material, URLs, and CI
credentials. Those values are appropriate as generated role inputs. They are
an unsuitable operator-facing configuration surface.

The local development initializer already proves that a single command can
generate the role-specific configurations and reject wrong-role inputs. It is
development-only, writes local env files, and derives fixture material from one
seed. The production bootstrapper should reuse its branch-specific config
builders and validation shape while generating independent production secrets
and installing them directly into the destination secret manager.

### Multi-tenant source

The managed deployment serves many customers using shared deployment roles,
storage infrastructure, relayer infrastructure, CI authority, and operational
secrets. Refactor 120 gives each tenant a physically distinct derivation root
held through role-private A/B shares. Records carry wallet, account, project,
environment, and authorization scope through protocol and persistence
boundaries.

A tenant migration cannot export any shared deployment value. Copying a
managed D1 KEK, internal service secret, session issuer key, or relayer key
would expose or influence other tenants. Source tenant-root shares also remain
outside this portability package. Refactor 121 handles dedicated recovery
shares through its separate role-local root restore. Copying a managed D1
database would bypass boundary parsing and tenant-isolation guarantees.

The export ceremony must resolve one exact tenant and construct portable
per-wallet material through role-local code. Every source repository read is
tenant-scoped. Cross-tenant records cause the export to fail.

### Retired migration bundle

`SigningRootMigrationBundleV1` was the earlier project/environment migration
design. It is absent from the current repository and is not an input to this
plan. `TenantPortabilityPackageV1` is the only target wallet portability package.
The customer-owned wallet domain plan already retires shared-secret migration;
root disaster recovery remains a separate Refactor 121 operation.

### Customer-owned domain

The existing customer-owned domain plan remains the preferred browser path:

```text
hosted phase:     wallet.customer.example -> managed Seams
self-host phase:  wallet.customer.example -> customer deployment
```

Keeping the wallet origin and RP ID stable preserves passkeys and origin-bound
browser storage. A customer migrating from a Seams-owned RP ID cannot copy a
passkey private key. The user must authenticate through an existing recovery
factor, import the same wallet key, and enroll a credential under the new RP
ID. The wallet address still remains stable.

## Required Invariants

1. Migration preserves every imported wallet public key and address exactly.
2. The export is bound to one exact tenant, wallet-key manifest, source
   deployment, source epoch, package sequence, and creation time.
3. A package contains no source tenant-root share, role KEK, Worker secret,
   API token, CI credential, relayer private key, session signing key, internal
   service credential, raw database export, or other tenant's data.
4. The package contains no plaintext private key, root, holder share, recovery
   secret, PRF output, KEK, or agent private key at rest.
5. Package decryption requires a customer-controlled recovery recipient. A
   source operator cannot decrypt the completed customer-KMS branch.
6. Every protected item binds package ID, tenant, wallet, wallet key, curve,
   purpose, source epoch, schema version, and content digest in AEAD associated
   data.
7. Import parses and validates every item once. Core import and activation
   logic never accepts raw archive entries, source DB rows, partial records, or
   compatibility shapes.
8. The destination creates fresh deployment-local roots, role keys, KEKs,
   issuer keys, internal credentials, storage identities, and epochs.
9. Server-owned imported records are re-encrypted under destination role and
   deployment bindings before entering live stores. Opaque owner-encrypted
   envelopes retain their inner ciphertext and authenticated identity; only
   their destination storage wrappers change without owner participation.
10. Migration never joins the complete wallet private key in JavaScript, the
    Router, persistence code, the export coordinator, the destination
    bootstrapper, logs, or tenant-admin tooling.
11. A tenant package gives the destination only the incomplete server-side
    authority previously held by managed Seams. It does not contain the
    complementary owner holder material in a form the tenant administrator can
    open.
12. An explicit per-wallet owner export remains a separate Refactor 100/101
    operation. Only that branch may reconstruct complete key material inside a
    reviewed owner-controlled boundary.
13. The Ed25519 and ECDSA keys within one mixed wallet commit through one
    aggregate activation after every role-owned prepared receipt is durable.
    Public admission also requires the tenant routing checkpoint. Independent
    stores do not claim database atomicity. A tenant package may contain many
    independently staged wallets.
14. Destination signing remains disabled until each imported wallet proves
    public identity continuity and its server-participant handoff is activated.
15. Source mutation is fenced per tenant during the final cutover. Other
    managed tenants remain available.
16. New source operations fail after the cutover fence. Queued operations that
    have not crossed an irreversible boundary are cancelled.
17. `outcome_unknown` transactions are reconciled before final package and
    budget checkpoint creation.
18. Sessions, warm handles, presignatures, nonces, quotes, temporary grants,
    replay leases, and uncommitted budget reservations are disposable and are
    never imported.
19. The source disables and erases the migrated tenant's server participants
    after destination activation under the selected honest-erasure threat
    model. The migration receipt enumerates every revoked source participant.
20. Package import is idempotent for one package digest. A different package
    cannot overwrite an active destination deployment.
21. Failed staging has no signing authority. An audited abort may release the
    source fence only before the durable activation-start checkpoint. Once
    activation starts, failures require forward reconciliation and the source
    remains fenced, including when only some wallets have committed.
22. The package is treated as sensitive server-custody and tenant data.
    Download, replacement, and restore require fresh high-assurance tenant
    administration. Per-wallet owner recovery material retains its independent
    owner authorization and encryption boundary.
23. No legacy migration branch, old bundle parser, dual persistence model, or
    caller-selected deployment profile enters runtime core logic.

## Deployment And Tenant Domain Model

Deployment configuration is an exhaustive union:

```ts
type DeploymentTenantMode =
  | {
      kind: 'managed_multi_tenant_v1';
      deploymentId: DeploymentId;
      tenantResolution: 'signed_request_and_server_membership';
    }
  | {
      kind: 'self_hosted_single_tenant_v1';
      deploymentId: DeploymentId;
      tenantId: TenantId;
      projectId: ProjectId;
      environmentId: EnvironmentId;
      tenantResolution: 'fixed_deployment_tenant';
    };
```

Raw requests in either deployment normalize immediately into one required
`TenantContext`. Core wallet, policy, signing, and audit functions receive that
context and retain the same cross-tenant rejection behavior. The self-hosted
branch resolves exactly one configured tenant rather than deleting tenant
identity from domain records.

This avoids a second single-tenant implementation. It also keeps future
single-tenant-to-managed import symmetric.

## Tenant Portability Package

### Package shape

The downloadable artifact is one encrypted, authenticated archive:

```ts
type TenantPortabilityPackageV1 = {
  kind: 'tenant_portability_package_v1';
  packageId: PortabilityPackageId;
  sourceDeploymentId: DeploymentId;
  sourceTenantId: TenantId;
  packageSequence: PortabilityPackageSequence;
  publicSnapshot: PortabilityPublicSnapshotV1;
  recipient: TenantPortabilityRecipient;
  sourceContentDigestB64u: string;
  sourceContentAttestation: PortabilitySourceContentAttestationV1;
  encryptedPayloadB64u: string;
  ciphertextDigestB64u: string;
  createdAtMs: number;
};

type TenantPortabilityRecipient =
  | {
      kind: 'customer_kms_hpke_v1';
      recipientKeyId: CustomerRecoveryKeyId;
      algorithm: 'x25519_hkdf_sha256_chacha20poly1305';
      recipientPublicKeyB64u: string;
    }
  | {
      kind: 'customer_recovery_passphrase_v1';
      kdf: 'argon2id';
      saltB64u: string;
      memoryKiB: number;
      iterations: number;
      parallelism: number;
    };
```

`PortabilityPublicSnapshotV1` contains only the source epoch, package
predecessor digest, creation time, and opaque high-water marks used to compare
snapshots. Before verification these are untrusted display metadata. Wallet
counts, addresses, credential facts, policy data, audit contents, and human-readable
tenant data remain encrypted. The source tenant and deployment IDs are opaque
routing identities and are treated as sensitive metadata even though they are
visible in the envelope.

The customer-KMS branch is preferred for organizations and automated backups.
The passphrase branch is an explicit high-entropy recovery flow for customers
without a KMS. UI strength checks are advisory; the fixed minimum Argon2id
parameters are enforced by the package builder and parser.

The `customer_kms_hpke_v1` algorithm identifier is provisional. Phase 0 must
prove that each supported KMS or HSM can generate or import the required key,
keep the private operation inside its boundary, enforce the intended IAM and
approval policy, and decrypt through the restore coordinator. If direct
X25519 HPKE is unavailable, the plan selects one reviewed provider profile and
changes this branch before freezing V1. It does not add provider-specific
fallbacks to the frozen parser.

The source encrypts KMS packages directly to the customer's public key. For a
passphrase package, the trusted browser or local CLI generates an ephemeral
package keypair and the package data key. Source roles encrypt their fragments
to the ephemeral public key. The browser or CLI assembles the payload and wraps
the data key under the Argon2id-derived key. The passphrase, ephemeral private
key, and plaintext package data key never reach the managed backend.

The source attests the canonical source-content digest, package identity,
sequence, public snapshot, recipient branch and public parameters, and every
role-fragment digest before final wrapping. It does not attest the final outer
ciphertext. This distinction allows the browser or CLI to finish the
passphrase branch without asking the source to sign bytes it never receives.
After decryption, the importer recomputes the canonical source-content digest
and verifies it against the dedicated portability attestation trust root.
The digest is a canonical tree over the public manifest and role-declared
plaintext fragment digests. Each role authenticates its own fragment digest;
the export coordinator does not open role-private fragments to compute it.

The final ciphertext uses the canonical pre-encryption header as AEAD associated
data: package kind and identity, source identities, sequence, public snapshot,
recipient parameters, source-content digest and attestation, and creation time.
The encrypted payload and its ciphertext digest are excluded from that header.
The builder computes `ciphertextDigestB64u` after encryption; import recomputes
it and verifies AEAD authentication. This avoids a digest depending on an AEAD
tag that itself depends on the digest. Phase 0 freezes the complete recipient
envelope, including encapsulation, nonce, and wrapped-data-key fields for each
branch; the type sketch above is not yet a complete wire specification.
Only the outer version, opaque package identities, public freshness fields,
recipient parameters, ciphertext digest, and source-content attestation remain
visible. Tenant names, users, wallet addresses, credential metadata, and
policies live inside the ciphertext.

The portability attestation key is separate from session, deployment, and
service-signing keys. The package carries its attestation key ID and certificate
chain. Managed exports verify against a pinned Seams portability trust root.
Self-hosted exports require a source attestation authority enrolled through
authenticated tenant administration and retained in an offline trust bundle.
A package cannot introduce its own trusted authority. This enrollment is
required before claiming self-hosted-to-managed or self-hosted-to-self-hosted
portability. Rotation retains the public verification history required for
every supported backup; source-unavailable verification needs no source fetch.

### Encrypted payload

The decrypted payload contains required branches:

```ts
type TenantPortabilityPayloadV1 = {
  kind: 'tenant_portability_payload_v1';
  tenant: PortableTenantIdentityV1;
  walletOrigin: WalletOrigin;
  authorityScope: PortableWalletAuthorityScopeV1;
  walletManifest: readonly [PortableWalletV1, ...PortableWalletV1[]];
  credentialManifest: readonly PortableCredentialV1[];
  recoveryManifest: readonly PortableRecoveryFactorV1[];
  agentManifest: readonly PortableAgentIdentityV1[];
  proposedAgentWallets: readonly ProposedAgentWalletV1[];
  auditCheckpoint: PortabilityAuditCheckpointV1;
  sourceRevocationInventory: SourceRevocationInventoryV1;
  payloadDigestB64u: string;
};

type PortableWalletAuthorityScopeV1 = {
  kind: 'passkey_rp_v1';
  rpId: WebAuthnRpId;
};
```

`SourceRevocationInventoryV1` lists the exact source participants that a later
cooperative cutover must revoke. A periodic backup carries no claim that
revocation occurred. Only Phase G can produce a source revocation receipt.

Each `PortableWalletV1` requires a nonempty wallet-key manifest. Each wallet key
contains exactly one curve-specific `WalletKeyPortabilityCapsule`:

```ts
type WalletKeyPortabilityCapsule =
  | Ed25519WalletKeyPortabilityCapsuleV1
  | EvmWalletKeyPortabilityCapsuleV1;
```

The capsule is a server-participant handoff. It contains the managed server
participant's tenant-scoped, incomplete wallet material encrypted for the
customer package and bound to the owner holder commitment. The destination
re-encrypts it under its SigningWorker identity and storage KEK. It may refresh
the holder/server shares later through a separately authorized curve-specific
protocol. The handoff design must establish which destination operations are
supported; tenant-root refresh alone changes neither active participant.

The package also carries supported owner-encrypted custody and holder envelopes
as opaque ciphertext. Tenant administration cannot unwrap them. A stable RP ID
preserves credential authentication; eligibility must separately prove that the
retained owner material satisfies the handoff protocol. With a changed RP ID,
the owner completes a supported recovery flow and enrolls a destination
credential before that wallet becomes usable.

The Ed25519 and ECDSA protocol documents must define their server-handoff
capsules, owner-holder commitments, recipient keys, transcript digests,
activation receipts, and zeroization requirements. A generic
`privateKeyB64u` field is forbidden.

The wallet-key capsule must enumerate every retained holder/server pairing and
its destination binding. A wallet may have several devices or authorities;
copying one server participant cannot silently preserve them all. Eligibility
must identify which remain usable, which require owner re-enrollment, and which
are revoked. Phase 0 must also distinguish owner custody-seed envelopes from
lane-holder envelopes and prove which artifacts enable each recovery path.

### Credential material

The package may include:

- credential IDs and public keys;
- RP ID and wallet-origin bindings;
- backup eligibility and observed backup state;
- passkey-encrypted custody envelopes from Refactor 100;
- recovery-factor metadata and encrypted recovery envelopes;
- credential, lane, and revocation epochs needed to reject stale state.

The package cannot include a passkey private key because WebAuthn authenticators
do not export one. A stable RP ID lets the destination use the existing
credential. A changed RP ID requires recovery plus new credential enrollment.

### Explicit exclusions

The package excludes:

- source Router, Deriver, SigningWorker, Gateway, console, and CI env files;
- source deployment root shares and derivation roots;
- D1 KEKs, HPKE private keys, peer-signing keys, JWT private keys, HMAC secrets,
  API tokens, and Cloudflare account credentials;
- raw D1, Durable Object, Redis, Postgres, R2, SQLite, or log exports;
- relayer private keys and funded relayer accounts;
- active sessions, quotes, presignatures, replay entries, locks, leases, and
  caches;
- pending or ambiguous agent budget reservations;
- agent private identity keys held by external agent runtimes;
- source membership, SSO, API-key, and organization-admin credentials that are
  meaningful only in the managed control plane.

### Snapshot and freshness

One package represents one immutable snapshot. Its checkpoint records:

- highest included wallet, credential, recovery, lane, authorization, and audit
  sequence;
- source deployment and tenant epochs;
- completed-operation high-water marks;
- a consistent checkpoint of completed effects, with pending execution excluded;
- package predecessor digest when this replaces an older backup.

Creating a new wallet, adding a credential, rotating recovery, changing a
wallet key, or completing source-only administrative state makes an older
package stale for those changes. Managed Seams should support periodic package
creation encrypted directly to a customer KMS. Manual download remains
available for the passphrase branch.

Periodic backup creation does not freeze or revoke source authority. The
snapshot builder must prove that all included records describe one consistent
checkpoint; if it cannot, it retries without publishing a partial package.
The final cooperative cutover additionally requires zero unknown outcomes.

The destination reports the verified snapshot time and checkpoint. With the
source unavailable, newer activity and the existence of a later package are
unknown unless independently retained authenticated evidence establishes them.
Sequence and predecessor checks reject rollback relative to known evidence;
they cannot prove that the only package presented to a fresh destination is the
latest. Unknown post-snapshot chain activity requires reconciliation before
transaction submission resumes. Restored server participants still require the
corresponding wallet owners' holder material.

## Simplified Self-Hosted Router A/B

### First supported profile

The first profile is:

```text
router_ab_customer_cloudflare_single_tenant_v1
```

It deploys:

- Gateway, its dedicated wallet/auth/session store, and customer wallet origin
  routes;
- MPCRouter;
- the tenant-root control-plane Worker and Router-owned lifecycle Durable Object;
- Deriver A Worker and private D1;
- Deriver B Worker and private D1;
- separate A/B managed-backup stores and role-local key providers;
- SigningWorker, private D1, and required nonce/presignature state;
- authenticated private role transports selected by the reviewed production
  isolation profile;
- customer-owned logs, backups, and alert destinations.

Refactor 130 demonstrates the earlier five-artifact topology inside one
Cloudflare account.
That topology places the account administrator inside every role boundary and
is eligible only as demo evidence or an explicitly reduced-isolation profile.
The first production profile must preserve Refactor 120's independently
administered Deriver A/B boundary. Its cross-account transport, authentication,
deployment authority, and failure behavior require a production review before
the profile name and parser are frozen. Distinct Worker names, secrets, and D1
stores inside one account do not establish that boundary.

Administrative separation and cryptographic erasure are separate properties.
The deployment manifest records the selected R120 security profile.
`operational_rotation_v1` reports `cryptographic_erasure_unverified` when its
provider cannot prove key destruction. `managed_healing_v1` requires R120's
provider qualification and destruction evidence. Separate accounts alone do
not establish compromise healing.

### Operator-facing specification

The customer writes or confirms one specification:

```ts
type SelfHostedDeploymentSpecV1 = {
  kind: 'self_hosted_deployment_spec_v1';
  deploymentId: DeploymentId;
  tenantId: TenantId;
  projectId: ProjectId;
  environmentId: EnvironmentId;
  walletOrigin: WalletOrigin;
  rpId: WebAuthnRpId;
  allowedAppOrigins: readonly [AppOrigin, ...AppOrigin[]];
  cloudflareDeployment: SelfHostedCloudflareDeploymentProfile;
  networkConfiguration: SelfHostedNetworkConfiguration;
  relayerConfiguration: SelfHostedRelayerConfiguration;
  deploymentRecoveryRecipient: SelfHostedDeploymentRecoveryRecipient;
};
```

Cloudflare authentication is supplied to the bootstrap process through an
interactive or short-lived deployment credential. It is never serialized into
the specification, deployment manifest, or backup package.

`SelfHostedCloudflareDeploymentProfile` is frozen only after the production
account-isolation and cross-account transport review. It must require distinct
Deriver A and Deriver B administrative authorities. It cannot accept the
Refactor 130 same-account demo profile through a compatibility branch.

`SelfHostedDeploymentRecoveryRecipient` is distinct from
`TenantPortabilityRecipient`. Its configuration must require separate A/B KMS
or HSM recipients and restore authorities, plus the recipients for other
role-owned recovery material. A single recipient may not open both Derivers'
shares or the wrapping keys that recover them. A passphrase
branch requires a separate offline break-glass design and is not accepted by
the production bootstrap parser.

### Generated deployment state

The bootstrapper creates, installs, and validates:

| Owner         | Generated private state                                        | Generated public state                                                         |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Router        | internal service credential reference                          | issuer/audience, A/B and SigningWorker public keys, bindings, protocol digests |
| Deriver A     | role-local tenant-root share created by its ceremony, D1 KEK, envelope key, peer-signing key | envelope public key, peer verifying key, key epochs                            |
| Deriver B     | role-local tenant-root share created by its ceremony, D1 KEK, envelope key, peer-signing key | envelope public key, peer verifying key, key epochs                            |
| SigningWorker | D1 KEK, server-output key, nonce/presignature secrets          | server-output public key, worker identity, key epochs                          |
| Gateway       | session and ceremony issuer keys, customer route secrets       | JWKS, wallet origin, RP ID, allowed app origins                                |
| Tenant-root control plane | routine tenant-root issuer signing key | issuer verifying keys, tenant-root lifecycle references |

Operational key generation uses independent randomness per role. Tenant-root
creation runs inside the Derivers; the bootstrapper never receives both shares
or the joined root. Public state is written to a signed content-addressed
`DeploymentManifestV1`. Private state is installed
directly into the owning Worker secret binding or customer-selected secret
manager.

The compiler must also place the creation-grant authority, authoritative tenant
identity/lineage resolver, and Console-owned durable records required by R120.
It must name their owning artifact and private bindings explicitly. The routine
issuer consumes authoritative tenant identity and creation grants through these
boundaries. Reuse the current deployment configuration and ownership checks when
compiling the single-tenant profile.

The operator sees semantic resources and health results. Internal environment
variable names remain an implementation detail of the Cloudflare adapter.

### Bootstrap flow

```text
seams self-host init
  -> validate customer domain, RP ID, app origins, account authority
  -> provision independent role-local operational secrets
  -> create Gateway durable state plus the three role-private databases and
     required state namespaces, A/B backup stores, and key-provider bindings
  -> deploy reviewed content-addressed role artifacts
  -> install only each role's allowed secrets
  -> run Refactor 120 tenant-root creation through the control plane and Derivers
  -> derive and publish the signed public deployment manifest
  -> run wrong-role and opposite-store negative checks
  -> emit and verify role-separated deployment recovery artifacts
  -> zeroize bootstrap plaintext and temporary credentials
```

`seams self-host doctor` verifies:

- every role artifact and protocol digest;
- distinct A/B deploy identities, stores, KEKs, envelope keys, and peer keys;
- SigningWorker separation from both Derivers;
- public/private key agreement and key epochs;
- authenticated private-role reachability and public route exposure;
- private store schemas and encrypted round trips;
- customer origin, RP ID, related-origin, CORS, and iframe policy;
- backup recipient and restore drill status;
- zero Deriver calls during normal signing.

### Deployment recovery package

After bootstrap, the customer receives a
`SelfHostedDeploymentRecoveryPackageV1` manifest referencing independently
encrypted role artifacts and storage snapshots by digest. Each Deriver's
artifact has its own recipient, keys, restore authority, and one-role import
path. Neither bootstrap nor a recovery coordinator opens both role artifacts.

This package is never exported by managed multi-tenant Seams. It exists only
after the customer owns a dedicated deployment. It uses the dedicated
`SelfHostedDeploymentRecoveryRecipient`. Sealing two entries to one recipient
does not preserve role separation. Root restoration follows the applicable
R120/R121 lifecycle and verifies authoritative lineage and epoch evidence;
replaying an old storage snapshot cannot reactivate retired custody. Operational
epoch backups follow R120 retirement. Long-lived tenant-controlled root recovery
uses R121's dedicated recovery sharing and retains its stated clone and erasure
limitations.

Bootstrap must prove recovery of its initial operational state before the
production self-host profile ships in Phase 3. Phase 6 adds coordinated recovery
of wallet-bearing stores and recurring drills; it does not defer bootstrap
recovery correctness. Fresh signing sessions and nonce/presignature state are
created after restore.

The distinction is deliberate:

- `TenantPortabilityPackageV1` moves customer wallet state across deployments;
- `SelfHostedDeploymentRecoveryPackageV1` restores one customer-owned
  deployment and its freshly generated operational secrets.

## Multi-Tenant To Single-Tenant Normalization

### Identity mapping

The import preserves wallet-domain identities and records an explicit mapping
for control-plane identities:

```ts
type TenantImportIdentityMappingV1 = {
  kind: 'tenant_import_identity_mapping_v1';
  sourceDeploymentId: DeploymentId;
  sourceTenantId: TenantId;
  sourceProjectId: ProjectId;
  sourceEnvironmentId: EnvironmentId;
  destinationDeploymentId: DeploymentId;
  destinationTenantId: TenantId;
  destinationProjectId: ProjectId;
  destinationEnvironmentId: EnvironmentId;
  preservedWalletIds: readonly [WalletId, ...WalletId[]];
  mappingDigestB64u: string;
};
```

The destination may preserve customer-selected project and environment IDs if
they are valid and collision-free. Deployment IDs, storage IDs, role IDs,
participant IDs, lane IDs, sessions, and epochs are destination-owned.

### Data conversion

The source exports domain records through branch-specific builders. The
destination parser converts them into precise import records, verifies their
proofs, and writes new destination-native rows. There is no database copy,
schema replay, or shared persistence compatibility layer.

Every destination record receives:

- the fixed destination `TenantContext`;
- destination deployment, role, storage, and encryption bindings;
- fresh holder/server lane IDs and share epochs where required;
- an import receipt linking the source package digest and destination record
  digest;
- the preserved wallet and wallet-key identities.

The mapping applies to destination administration and storage. It never rewrites
identity bytes authenticated inside owner-encrypted envelopes, wallet-key slot
identifiers, or handoff proofs. Keep source provenance as immutable import
evidence. Any required change to an owner envelope's inner binding needs an
owner-authorized open-and-reseal ceremony; tenant administration cannot perform
it. Phase 0 must specify how fresh lane and participant identities bind the
retained holder before promising transparent first use.

### Derivation and signing roots

Each managed tenant has its own derivation root under Refactor 120. The source
keeps that root. The destination creates an independent tenant root through
Refactor 120's distributed A/B creation ceremony and uses it for future
destination derivation. Refreshing either deployment's root shares preserves
its logical root and leaves active wallet signing material untouched.

Existing wallet keys enter through their curve-specific server-handoff
capsules and destination activation ceremony. They do not require the
destination to inherit the source tenant root. The handoff protocol must bind
the imported wallet key, destination server participant, and retained owner
holder explicitly, then demonstrate signing and the supported destination
recovery, export, and authority-provisioning operations. A later owner-approved
signing-share refresh requires its own curve-specific protocol. Refactor 120's
root-share refresh supplies no replacement for that protocol.

Wallets whose current key material cannot produce a tenant-scoped portability
capsule are ineligible for address-preserving migration until they complete an
owner-authorized transition supported by the current custody and signing
protocols. The product reports this before export.

Refactor 121 restores the exact source root identity into a fresh custody
lineage. It does not restore wallet inventory, active signing material,
application routing, RP IDs, or wallet authorities. If this plan later composes
with that disaster-recovery path, it must preserve `TenantRootIdentityV1` and
keep the A/B recovery packages separate from the wallet-data archive. The
administrative identity mapping above cannot rebind a recovered root.

### R121 integration handoff — September 8, 2026

The implemented entry point is `seams derivation-root restore`: `start`, one
`share` operation per role, and `activate --session-file <path>`. Use the console
API destination URL. Activation persists its administration session before
sending; reuse that file to resume after bootstrap destruction. Commands and
operator handling are maintained in the [recovery runbook](./tenant-recovery-runbook.md).

Consume the existing contracts directly:

- [Restore state](../packages/shared-ts/src/tenant-root/tenantRootSecurityState.ts)
  distinguishes import, verification, activation and cleanup states. Preserve
  preactivation/postactivation cleanup branches and source-custody disposition.
- [Mounted routes](../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreWorkerRoute.ts)
  compose the existing [restore service](../packages/wallet-console-server-ts/src/tenantRootSecurity/restoreService.ts).
  Destination identity and fresh lineage are provisioned before restore.
- [Active-lineage lookup](../packages/wallet-console-server-ts/src/tenantRootSecurity/activeLineageD1.ts)
  resolves created and restored roots for security status and scheduling.
- [Canonical recovery fixtures](../crates/router-ab-core/tests/fixtures/tenant-root-recovery/)
  define the manifest, separate role packages and fixture trust bundle. These
  test roots are excluded from production release trust.

Local operating evidence covers mounted HTTP restore, staging cleanup,
interrupted activation, expiry cleanup retry, and new-wallet Ed25519 signing
before, during and after destination rotation. It does not prove migration of
existing wallet inventory or signing lanes. Production CLI release trust and
paying-tenant backup provisioning remain outstanding; the
[R121 delivery checklist](./refactor-121-remaining-steps.md) owns those gates.
R122 can use these interfaces now without duplicating the recovery protocol.

### Authentication and membership

The managed organization's SSO connections, API tokens, support access,
platform administrators, billing roles, and managed console memberships stay
at the source.

The self-hosted administrator bootstraps a new destination admin identity. The
package may carry proposed wallet-owner and display mappings for review. Each
destination membership is created through destination authentication and
explicit acceptance.

Existing wallet passkeys remain usable when the wallet origin and RP ID stay
stable. They prove wallet access; they do not automatically grant destination
deployment administration.

### Agent Wallets

During the final migration freeze, the source:

1. stops new agent requests for the migrating tenant;
2. reconciles committed and unknown operations;
3. commits completed budget use;
4. releases only definitive pre-execution failures;
5. fences delegated admission at the source cutover epoch, with permanent
   revocation after activation starts;
6. exports agent public identities, desired policies, remaining-budget
   projections, and audit evidence as inert records.

Periodic backups export inert projections without changing source admission.
Agent reconciliation and fencing are required before the first supported
cutover; Phase 5 adds management surfaces and audit presentation.

After destination wallet activation, the human reviews each proposed Agent
Wallet and signs a new destination authorization. The UI may preserve names and
show the previously remaining allocation, while clearly labeling it pending
until authorization completes.

## Migration Lifecycle

### State model

```ts
type DeploymentMigrationState =
  | {
      state: 'requested';
      migrationId: DeploymentMigrationId;
      sourceTenantId: TenantId;
      requestedManifestDigestB64u: string;
    }
  | {
      state: 'destination_prepared';
      migrationId: DeploymentMigrationId;
      destinationDeploymentId: DeploymentId;
      destinationManifestDigestB64u: string;
      importRecipientDigestB64u: string;
    }
  | {
      state: 'package_ready';
      migrationId: DeploymentMigrationId;
      packageId: PortabilityPackageId;
      packageDigestB64u: string;
      sourceSnapshotEpoch: number;
    }
  | {
      state: 'staged';
      migrationId: DeploymentMigrationId;
      stagedWalletManifestDigestB64u: string;
      continuityReceiptDigestB64u: string;
    }
  | {
      state: 'source_frozen';
      migrationId: DeploymentMigrationId;
      freezeEpoch: number;
      finalCheckpointDigestB64u: string;
    }
  | {
      state: 'destination_activating';
      migrationId: DeploymentMigrationId;
      preparedActivationDigestB64u: string;
      finalCheckpointDigestB64u: string;
      startedAtMs: number;
    }
  | {
      state: 'destination_active';
      migrationId: DeploymentMigrationId;
      activationReceiptDigestB64u: string;
      activatedAtMs: number;
    }
  | {
      state: 'source_revoked';
      migrationId: DeploymentMigrationId;
      sourceRevocationReceiptDigestB64u: string;
      completedAtMs: number;
    }
  | {
      state: 'aborted_before_activation';
      migrationId: DeploymentMigrationId;
      reason: DeploymentMigrationAbortReason;
      abortedAtMs: number;
    };
```

The source freeze authority durably records activation start before issuing
permission for the first destination wallet commit. That record binds the exact
package, destination manifest, final checkpoint, and immutable prepared
activation digest. It permanently closes source unfreeze for this migration.
This transition is `destination_activating`; partial wallet commits remain in that branch and
resume from role-owned receipts. There is no rollback branch after activation
starts. If its outcome is unknown, the source stays fenced until reconciled.

The lifecycle sketches reference authoritative journals. Their final builders
must require verified prior-state evidence and retain all immutable migration
bindings through those journals; a caller-supplied migration ID alone cannot
authorize a transition. Source-independent activation needs the same durable
partial-commit handling in its own journal, without claiming a source freeze.

Source-unavailable restore uses a separate state union because it cannot
produce a source fence or revocation receipt:

```ts
type SourceUnavailableRestoreState =
  | {
      state: 'requested';
      restoreId: SourceUnavailableRestoreId;
      packageId: PortabilityPackageId;
      packageDigestB64u: string;
    }
  | {
      state: 'destination_prepared';
      restoreId: SourceUnavailableRestoreId;
      destinationDeploymentId: DeploymentId;
      destinationManifestDigestB64u: string;
    }
  | {
      state: 'package_verified';
      restoreId: SourceUnavailableRestoreId;
      sourceContentDigestB64u: string;
      stagedWalletManifestDigestB64u: string;
      continuityReceiptDigestB64u: string;
    }
  | {
      state: 'destination_activating';
      restoreId: SourceUnavailableRestoreId;
      preparedActivationDigestB64u: string;
      startedAtMs: number;
    }
  | {
      state: 'destination_active';
      restoreId: SourceUnavailableRestoreId;
      activationReceiptDigestB64u: string;
      sourceRevocation: 'unacknowledged_source_unavailable';
      activatedAtMs: number;
    }
  | {
      state: 'aborted_before_activation';
      restoreId: SourceUnavailableRestoreId;
      reason: SourceUnavailableRestoreAbortReason;
      abortedAtMs: number;
    };
```

Cooperative migration functions require `DeploymentMigrationState`.
Source-independent restore functions require `SourceUnavailableRestoreState`.
Core functions do not accept a union of both lifecycles or optional source
fence and revocation fields.

### Phase A: eligibility and tenant approval

1. Resolve the exact managed tenant, wallet inventory, key families, origins,
   RP ID, active credentials, recovery factors, devices, and Agent Wallets.
2. Verify every active wallet key has a supported server-handoff capsule path
   and an owner-holder commitment that can be checked at the destination.
3. Resolve conflicting export, recovery, root-lifecycle, or migration operations.
   Inventory in-flight execution for final reconciliation at the source freeze.
4. Display the destination identity, origin, RP ID, wallet-key manifest,
   addresses, agent behavior, source revocation, and backup consequences.
5. Obtain fresh high-assurance export authorization covering the canonical
   migration request digest.

Periodic backup creation uses package-creation authority and the snapshot
contract. It requires no prepared destination, cutover approval, or source
revocation. Cooperative migration binds its selected backup to the destination
through the import and activation approvals; a reusable backup is not itself
permission to activate a particular deployment.

### Phase B: destination preparation

1. Bootstrap the dedicated single-tenant deployment.
2. Publish its signed deployment manifest and import recipient keys.
3. Run `self-host doctor` with no wallet state installed.
4. Bind the migration request to the destination manifest digest and recipient
   digest.

### Phase C: package construction

1. Begin one tenant-scoped export snapshot.
2. Ask each source role for only its tenant-scoped portable fragments.
3. Verify every fragment's tenant, wallet, wallet-key, role, curve, epoch,
   recipient, and transcript binding.
4. Construct public identities and manifests from canonical source records.
5. Encrypt the payload to the customer KMS recipient, or return encrypted role
   fragments for final passphrase wrapping inside the trusted browser or local
   CLI.
6. Sign the canonical source-content digest, public package header, recipient
   parameters, and role-fragment digests with the dedicated portability
   attestation key before final wrapping.
7. Deliver the package to the customer and require a successful decrypt-and-
   inventory verification before cutover can proceed.

The export coordinator handles ciphertext and public manifests. It cannot open
role-private fragments or receive raw role roots.

### Phase D: destination staging

1. Decrypt inside the local restore coordinator or customer KMS boundary.
2. Parse the package once and verify the source-content attestation, package
   sequence, predecessor, public snapshot, manifest, and payload digests.
3. Map source tenant scope into the fixed destination scope.
4. Import each incomplete server participant into a fresh destination
   participant identity and epoch while retaining the owner holder binding.
5. Re-encrypt server-owned material and storage wrappers under destination role
   KEKs and AAD, retaining opaque owner-envelope bytes and bindings.
6. Verify Ed25519 public keys, ECDSA threshold public keys, EVM addresses,
   material owners, key slots, participants, and imported lifecycle.
7. Verify the server share, owner holder commitment, and public identity
   relation through the curve-specific handoff proof.
8. Keep all imported server participants staged and incapable of serving
   public signing. Record a first-owner-use canary requirement for each wallet.

### Phase E: final source freeze

1. Increment the tenant migration fence epoch.
2. Reject new registration, signing, session issuance, recovery, export, agent,
   credential, device, and policy mutations for the migrating tenant. Coordinate
   with the tenant-root operation lock so creation, refresh, restore, and
   deletion cannot race the cutover. R120's derivation fence alone is insufficient
   because active signing bypasses the Derivers.
3. Allow already irreversible chain operations to settle.
4. Reconcile unknown outcomes and produce a zero-unknown-operation inventory.
5. Create the final audit and agent-budget checkpoint.
6. Confirm the staged destination still matches the exact final wallet-key
   manifest.

If mutable portable state changed after the package snapshot, generate a new
package. The destination discards the earlier staging records. The migration
fence permits only the exact authorized final-snapshot and reconciliation
operations; ordinary export remains fenced. A replacement package invalidates
earlier prepare receipts and activation approval, and must pass staging again.

### Phase F: activation and routing cutover

1. Obtain final tenant migration authority approval over the destination
   manifest, continuity receipt, source freeze receipt, and exact wallet-key
   manifest.
2. Prepare each destination wallet's complete mixed-key server manifest through
   role-owned activation journals adapted to the frozen handoff protocol. Every
   role records its prepared receipt while public signing remains disabled.
3. Durably record activation start at the source freeze authority and obtain
   its exact activation permission before committing any destination wallet.
   Resume this checkpoint idempotently if either side loses the response.
4. Commit one activation manifest per mixed wallet after all required role
   receipts read back successfully. Independent D1 stores do not claim database
   atomicity. Every public signing entry point requires both this aggregate
   commit and the tenant routing checkpoint; a committed wallet cannot bypass
   the tenant gate using an existing handle or internal signing route.
5. Commit the tenant routing checkpoint only after every selected wallet has a
   durable activation receipt. A failure leaves the tenant fenced and identifies
   the exact wallets requiring reconciliation.
6. Mint destination-native sessions only after that wallet's aggregate
   activation commits and the tenant routing checkpoint selects the destination.
7. Change customer-controlled DNS or edge routing while keeping the wallet
   hostname stable.
8. Run an administrative imported-state canary immediately. Run each wallet's
   transaction-free signing canary on its owner's first authenticated use.
9. Publish the destination activation receipt.

DNS propagation grants no signing authority. Cached source routes remain
fenced. A failed first-owner-use canary blocks that wallet and requires
destination repair; it cannot roll the tenant back to the source.

### Phase G: source revocation and cleanup

1. Revoke all migrated tenant execution lanes and server participants.
2. Disable source signing, recovery, export, agent, device, and session
   admission permanently for the migrated wallet-key manifest.
3. Retire tenant-scoped active signing material and service-held backups under
   each role's deletion procedure. Report deletion and provider erasure evidence
   separately; row deletion alone cannot prove cryptographic erasure.
4. Tombstone source records with the destination activation and migration
   receipt digests.
5. Retain the minimum audit and legal records required by policy, encrypted and
   incapable of signing.
6. Give the customer a source revocation receipt enumerating every affected
   wallet key, lane, participant, and epoch.

The receipt also records source tenant-root disposition and its lineage. Root
derivation admission for the migrated scope remains fenced. Whole-root deletion
uses the R120/R121 lifecycle only after verifying that no retained wallet scope
depends on it. Retained roots, service backups, and customer-held recovery or
portability copies must be named in the disposition; source lane revocation
does not erase them. Root deletion alone does not revoke active signing shares.

### Source-unavailable restore

A current customer-held package must be sufficient to restore the incomplete
managed server participants without the managed control plane. The customer:

1. bootstraps a destination deployment;
2. imports the latest available verified package through the explicit recovery
   branch and acknowledges its known checkpoint and unknown later activity;
3. proves control of the tenant package recovery recipient;
4. provisions fresh destination roles and imports the incomplete server
   participants;
5. verifies every public key, address, and owner-holder commitment;
6. activates server handoff through destination bootstrap authority, proof of
   the enrolled package recipient, and high-assurance tenant approval;
7. requires the normal wallet-owner holder proof before each wallet's first
   signature;
8. records that source revocation could not be acknowledged.

Phase 0 must freeze the destination bootstrap authority and offline trust
enrollment that make this approval independent of source SSO, API keys, and
live attestation-key retrieval. Use the same per-wallet and tenant admission
gates as cooperative migration, backed by the explicit source-unavailable
authorization branch. Reconcile chain state before enabling transaction
submission; no source budget or replay reservation acquires destination authority.

This path preserves wallet identity and restores the server half of
availability. The unavailable source and the new destination each possess, or
may possess, only an incomplete server participant. Neither can sign without
the wallet owner's holder material. No protocol can prove that an unavailable
source erased its old participant. The security claim remains bounded by the
original threshold topology and the source operator threat model. Chain-native
smart accounts may offer stronger signer replacement while keeping the account
address stable; those adapters require separate designs.

## Backup Package Security

The portability package contains the tenant's incomplete server custody and
sensitive account metadata. A party able to decrypt a current package may run
a competing server participant and attempt to interact with wallet owners. It
still lacks each owner's complementary holder material. The package is not a
complete-key export.

Required controls:

- fresh tenant-administrator verification and explicit migration consent;
- optional organization multi-approval policy;
- customer KMS or HSM recipient for managed automatic backups;
- high-entropy passphrase plus fixed Argon2id minimums for manual packages;
- encrypted-at-rest browser download with no analytics, logging, caching, or
  support upload path;
- one visible package fingerprint and wallet-address inventory;
- package replacement and stale-package warnings;
- wallet-owner notification of backup creation, restore, and destination
  activation;
- restore notifications and immutable audit evidence;
- no secret values in filenames, manifests, errors, logs, traces, or receipts;
- restore drills before the package is considered the customer's recovery
  source.

The source-content attestation proves the origin and canonical digest of the
source material before final wrapping. The final package AEAD authenticates the
canonical pre-encryption header and ciphertext assembled by the selected
recipient branch.
Neither replaces customer-controlled package encryption, wallet-owner holder
custody, or destination cryptographic verification.

## Public Product And CLI Surface

Managed dashboard:

```text
Create encrypted portability backup
Download backup
Configure customer KMS backup recipient
Verify backup fingerprint and wallet inventory
Restore backup into a fresh Seams recovery destination
Prepare self-host migration
Freeze and activate migration
Download source revocation receipt
```

Self-host CLI:

```text
seams self-host init
seams self-host doctor
seams self-host import <package>
seams self-host verify
seams self-host activate
seams self-host backup
seams self-host restore <deployment-recovery-package>
seams self-host status
```

The CLI prints resource identities, public digests, health, and next required
action. It never prints generated secrets. Automation receives the same precise
result union as the interactive CLI.

SDK management APIs:

```text
createTenantPortabilityPackage()
getTenantPortabilityPackageStatus()
verifyTenantPortabilityPackage()
createManagedRecoveryRestore()
getManagedRecoveryRestore()
createDeploymentMigration()
getDeploymentMigration()
freezeDeploymentMigrationSource()
activateDeploymentMigrationDestination()
getDeploymentMigrationReceipts()
```

Package creation and migration activation use separate authorization branches.
An ordinary wallet signing, recovery, device, or agent session cannot call
them.

## Failure And Rollback

| Failure point                              | Required outcome                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Destination bootstrap fails                | Source remains active; delete incomplete destination resources                            |
| Package construction fails                 | Source remains active; retain no partial downloadable package                             |
| Package decrypt or validation fails        | Destination remains empty or staged; source remains active                                |
| One wallet key fails continuity            | No key in that mixed wallet activates; discard that wallet's staging                      |
| Source changes after snapshot              | Invalidate staging and create a new package                                               |
| Source freeze fails                        | Destination remains staged; release the tenant fence only after proving no cutover effect |
| Failure before activation-start checkpoint | Destination remains staged; source may unfreeze through an audited abort after confirming activation never started |
| Activation start or a wallet commit has an unknown outcome | Keep source fenced; read back the activation journal and resume forward |
| Some wallets commit and another fails      | Keep all public destination admission gated by tenant routing; resume the remaining wallets |
| Destination activates and DNS fails        | Keep destination authoritative; repair routing without reactivating source signing        |
| Source revocation acknowledgement fails    | Destination remains authoritative; enter source-revocation incident procedure             |
| Unknown chain operation exists             | Keep source frozen and destination staged until reconciliation completes                  |

Migration state transitions and side effects are idempotent. Retrying one phase
uses the same operation and package digests. Replacing a stale package creates
new package-bound staging and approval evidence before activation starts.

## Implementation Phases

### Phase 0: freeze portability boundaries

- [ ] Freeze `TenantPortabilityPackageV1`, recipient branches, canonical CBOR
      encoding, complete encryption envelopes, pre-encryption AAD, signature
      domain, digest, and maximum package size.
- [ ] Freeze the source-content attestation, dedicated trust root, rotation
      history, and source-unavailable verification rules.
- [ ] Prove the selected customer KMS or HSM recipient profile end to end before
      freezing its algorithm identifier.
- [ ] Freeze exact tenant identity and wallet-key manifests.
- [ ] Specify Ed25519 server-participant handoff and owner-holder commitment
      capsules.
- [ ] Specify ECDSA server-participant handoff and owner-holder commitment
      capsules.
- [ ] Demonstrate the supported post-import wallet lifecycle under an
      independent destination tenant root and decide any separate Refactor 121
      restore composition.
- [ ] Decide which Refactor 100 owner-encrypted envelopes plus incomplete
      server-participant backups satisfy source-unavailable restore and which
      require new material.
- [ ] Freeze source-unavailable threat claims and erase assumptions.
- [ ] Freeze offline source-authority enrollment, destination bootstrap
      authorization, snapshot consistency, and rollback checks against known
      checkpoints. Define unknown post-snapshot activity explicitly.
- [ ] Freeze the activation-start checkpoint, source unfreeze authority, and
      per-wallet plus tenant admission gates, including partial activation.
- [ ] Specify owner-envelope preservation, retained device/holder pairings, and
      the required owner ceremonies for changed destination bindings.

### Phase 1: managed portability backup

- [ ] Add a server-canonical tenant export inventory.
- [ ] Add tenant-scoped role fragment builders and cross-tenant denial tests.
- [ ] Add customer-KMS and passphrase encryption branches with their distinct
      assembly paths.
- [ ] Add package sequence, predecessor, freshness, source-content attestation,
      and audit checkpoints.
- [ ] Add dashboard creation, download, fingerprint, replacement, and restore-
      drill status.
- [ ] Prove package and logs contain no deployment-local or cross-tenant secret.
- [ ] Keep the product unavailable until Phase 2 completes one destructive
      restore drill from the emitted artifact.

### Phase 2: managed recovery importer

- [ ] Add the strict package boundary parser and managed restore coordinator.
- [ ] Restore into a fresh Seams-operated recovery destination through the same
      destination-native record builders required by self-host import.
- [ ] Import each curve-specific capsule into fresh destination participants and
      stores without copying source rows or deployment secrets.
- [ ] Verify aggregate public-key and address continuity plus first-owner-use
      signing canaries.
- [ ] Demonstrate the promised recovery, export, and authority-provisioning
      operations under independent destination roots with the source unavailable.
- [ ] Exercise cooperative recovery and the bounded source-unavailable branch.
- [ ] Publish customer-visible backup freshness and restore-drill receipts.

### Phase 3: production single-tenant deployment compiler

- [ ] Add `SelfHostedDeploymentSpecV1` boundary parser.
- [ ] Promote only the public-package, deployment, and doctor evidence proven by
      Refactor 130; do not import its demo lifecycle into product core.
- [ ] Freeze and review the production Cloudflare account-isolation and
      cross-account transport profile required by Refactor 120.
- [ ] Provision independent operational keys through role-local bootstrap
      authority and run R120 tenant-root creation inside the Derivers.
- [ ] Compile one spec into Router, A, B, SigningWorker, Gateway, and tenant-root
      control-plane config branches, including the creation-grant authority,
      authoritative identity resolver, private stores, and A/B backup providers.
- [ ] Create customer-owned Cloudflare resources and install role-local secrets
      without plaintext env files.
- [ ] Emit and verify a signed content-addressed deployment manifest.
- [ ] Promote local init's wrong-role validation patterns into the production
      bootstrapper.
- [ ] Add `self-host doctor` and one complete empty-deployment smoke test.
- [ ] Verify the initial deployment recovery artifacts through separate A/B
      recipients and one-role restores before releasing the bootstrapper.

### Phase 4: self-host import and managed cutover

- [ ] Add the local restore coordinator and strict package boundary parser.
- [ ] Add source-to-destination tenant identity mapping.
- [ ] Import each curve-specific capsule into fresh destination lanes and
      stores.
- [ ] Verify aggregate public-key and address continuity.
- [ ] Add staged handoff-proof verification and first-owner-use signing
      canaries.
- [ ] Re-encrypt server material and storage wrappers under destination role
      KEKs and AAD; preserve authenticated owner-envelope bytes.
- [ ] Add tenant-scoped source fencing across signing, sessions, agents,
      registration, recovery, devices, and root lifecycle without pausing others.
- [ ] Add final package refresh after mutation detection.
- [ ] Add role-owned prepare receipts, per-wallet aggregate activation journals,
      activation-start permission, the tenant routing checkpoint, and source
      revocation receipts with root and backup disposition.
- [ ] Reconcile agent budgets and unknown operations before the first cutover;
      keep imported authorization proposals inert until owner approval.
- [ ] Integrate stable-domain DNS cutover checks.
- [ ] Add failure injection at every lifecycle transition.
- [ ] Add the separate source-unavailable restore lifecycle and stale-backup
      warnings.

### Phase 5: agent management, audit, and migration operations

- [ ] Add review surfaces for the inert agent identities and proposed Agent
      Wallet settings exported by the migration path.
- [ ] Add fresh destination delegated-spend authorization UX; keep the admission
      requirement enforced by the Phase 4 operating path.
- [ ] Export customer-visible migration audit evidence.
- [ ] Add notifications, source tombstones, retention, deletion, and incident
      procedures.

### Phase 6: destination disaster recovery

- [ ] Extend the Phase 3 role-separated deployment recovery manifest to
      consistent wallet-bearing storage snapshots under customer custody.
- [ ] Restore a destroyed single-tenant deployment with identical wallet
      identities, verified root custody, and fresh sessions and nonce state.
- [ ] Automate quarterly restore drills and backup-freshness reporting.

### Phase 7: managed continuity follow-up

- [ ] Write a separate plan for Seams-held encrypted backups and a separately
      provisioned standby signing authority for self-hosted customers.
- [ ] Preserve mandatory owner-holder participation; Seams never receives a
      server-server quorum or the customer's primary server participant.
- [ ] Define explicit emergency approval, one-active-backend fencing, policy and
      nonce reconciliation, expiry, return to primary, and standby refresh or
      revocation.
- [ ] Keep health-triggered automatic failover and active-active admission out
      of the first continuity product.

### Phase 8: provider-neutral deployment

- [ ] Define one production OCI transport and storage profile after the
      customer-owned Cloudflare profile passes migration drills.
- [ ] Preserve the same role config compiler and tenant package format.
- [ ] Review service-to-service authentication, private storage, secret
      manager, backup, scheduling, and availability independently.
- [ ] Keep local development adapters outside production artifacts.

## Validation

Static fixtures prove:

- managed and self-hosted deployment config branches cannot be combined;
- single-tenant requests always carry the fixed destination tenant context;
- portability packages require a nonempty wallet-key manifest;
- Ed25519 and ECDSA capsules cannot cross key families;
- raw private-key fields and complete-key export material cannot construct a
  tenant portability capsule;
- active authorization, session, presignature, replay, lease, or deployment
  secret fields cannot enter package records;
- a retired signing-root migration shape cannot enter the new importer;
- tenant portability and deployment recovery recipients cannot be interchanged;
- cooperative migration and source-unavailable restore states cannot enter each
  other's core functions;
- imported records require destination role, deployment, tenant, key, lane,
  participant, and epoch bindings.

Cryptographic tests prove:

- package tampering, truncation, reordering, wrong recipient, wrong package ID,
  wrong tenant, wrong wallet, wrong curve, wrong epoch, and wrong predecessor
  fail;
- customer-KMS and passphrase packages decrypt only through their exact branch;
- each decrypted payload matches its source-content attestation even when the
  passphrase branch completes final wrapping outside the source;
- ciphertext digests are computed after encryption and excluded from the AEAD
  header; changes to authenticated header fields fail verification;
- attestation verification succeeds from the pinned trust history with the
  source unavailable;
- wrong or weak Argon2id parameters fail parsing;
- cooperative and source-unavailable imports preserve keys without opening
  complete private keys in any deployment or tenant-admin component;
- imported server material remains cryptographically incomplete without the
  wallet owner's holder material;
- destination Ed25519 public keys, ECDSA public keys, and EVM addresses equal
  the package manifest exactly;
- destination handoff proofs bind every server participant to the preserved
  public key and owner-holder commitment;
- destination role records fail under source or opposite-role KEKs and AAD.

Tenant-isolation tests prove:

- exporting tenant A cannot read, count, infer, or package tenant B records;
- source tenant-root shares, shared KEKs, relayer keys, API tokens, and databases
  never appear in tenant packages;
- migration fencing blocks tenant A and leaves tenant B registration, signing,
  recovery, and agents available;
- a package cannot import over an unrelated or already active tenant;
- one fixed destination tenant cannot be selected through caller input.

Lifecycle tests prove:

- partial mixed-wallet staging never activates;
- partial role prepare or a missing aggregate activation receipt leaves the
  mixed wallet externally inactive;
- a committed wallet remains unavailable until the tenant routing checkpoint;
- lost activation-start responses and partial wallet commits cannot reopen
  source admission;
- mutation after snapshot invalidates staging;
- unknown execution outcomes block cutover;
- cooperative destination activation cannot precede source freeze and tenant
  migration authority approval;
- source-unavailable activation cannot construct or claim a source fence or
  revocation receipt;
- source unfreeze is available only before the durable activation-start checkpoint;
- source sessions and lanes fail after revocation;
- destination sessions require both that wallet's aggregate activation and
  the tenant routing checkpoint;
- retrying every phase is idempotent;
- Agent Wallet projections remain inactive until freshly authorized;
- offline backup restore reports the verified checkpoint and unknown later
  activity, rejecting rollback against independently retained newer evidence;
- periodic backups leave source sessions, agent authority, and signing active;
- opaque owner envelopes retain their authenticated bytes and require owner
  participation for any changed inner binding;
- independent-root imports support each promised wallet lifecycle operation,
  including retained-device use, with the source unavailable.

Operational tests prove:

- a new customer-owned Cloudflare deployment requires no manual role env or
  secret editing;
- one spec creates distinct Workers, stores, keys, bindings, and audit labels;
- `self-host doctor` detects shared A/B administrative authority, credentials,
  stores, or keys in the production profile;
- public manifests, diagnostics, and generated configuration contain no private
  material; recovery secrets appear only in their owning encrypted artifacts;
- deployment recovery cannot open both A/B roles through one recipient or
  restore authority and cannot reactivate retired root epochs;
- backup and restore succeed after complete destination resource deletion;
- normal Ed25519 and ECDSA signing makes zero Deriver calls;
- a complete managed-to-self-hosted cutover preserves all wallet addresses;
- the customer-owned wallet origin and RP ID continue to unlock existing
  credentials when kept stable.

## Non-Goals

- migrating managed platform operational secrets into customer infrastructure;
- copying source databases or retaining source persistence readers;
- making all current Router A/B environment variables customer-facing config;
- collapsing Deriver A, Deriver B, and SigningWorker private state into one
  runtime secret bag;
- promising cryptographic proof that an unavailable external source erased old
  material;
- exporting passkey private keys;
- preserving source sessions, presignatures, replay caches, or in-flight
  reservations;
- silently activating migrated Agent Wallet authorizations;
- active-active signing between customer and Seams backends;
- health-triggered activation of a Seams standby signing lane;
- implementing managed continuity inside the portability importer;
- supporting every cloud, orchestrator, database, KMS, and HSM in the first
  release;
- changing wallet public identities merely to simplify deployment;
- maintaining the old signing-root migration format or dual import paths.

## Decisions Required Before Implementation

- Freeze the server-participant handoff and owner-holder commitment capsule for
  Ed25519 wallet keys.
- Freeze the server-participant handoff and owner-holder commitment capsule for
  ECDSA wallet keys.
- Define and demonstrate the supported post-import wallet lifecycle under an
  independent destination tenant root. Decide explicitly whether a separate
  Refactor 121 exact-root restore is composed with any recovery branch.
- Freeze the source-content attestation key hierarchy, offline trust history,
  self-hosted source-authority enrollment, and passphrase assembly transcript.
- Freeze destination bootstrap authorization for source-unavailable restore.
- Specify the consistent backup checkpoint and the evidence available for
  offline rollback detection and post-snapshot chain reconciliation.
- Freeze the activation-start checkpoint and all source/destination admission
  paths, including unknown outcomes and partial mixed-wallet activation.
- Validate the first customer KMS or HSM recipient end to end and freeze its
  supported algorithm profile.
- Decide whether the passphrase package is available to organizations by
  default or requires an explicit policy override in favor of customer KMS.
- Define maximum acceptable backup age and which wallet changes require an
  immediate replacement package.
- Define the organization approval policy for package creation and destination
  activation.
- Select the first customer-owned Cloudflare bootstrap credential flow and its
  minimum API scopes.
- Freeze the production Cloudflare account-isolation and cross-account
  transport profile. The Refactor 130 same-account demo is not the default.
- Select the fresh Seams-operated recovery destination used by the backup-first
  release and define its tenant-isolation boundary.
- Assign the creation-grant authority, identity resolver, and Console-owned
  durable records to the self-host deployment artifacts and private bindings.
- Freeze role-separated deployment recovery recipients and the R120 erasure
  profile before releasing the production bootstrapper.
- Freeze destination relayer ownership, funding, and cutover behavior for each
  supported network.
- Define source tombstone retention and deletion evidence for regulated
  customers.
- Approve a separate managed-continuity plan before Seams stores self-hosted
  deployment backups or provisions standby signing lanes.
- Define the first OCI production target before making a provider-neutral
  self-hosting claim beyond customer-owned Cloudflare.
