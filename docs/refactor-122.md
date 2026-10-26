# R122 — Hosted-to-self-hosted wallet portability

Status: proposed, October 26, 2026. Cross-deployment wallet migration has no
implementation or qualification.

R122 is the existing number for this work. The public Wallet docs already use it
for the customer deployment compiler, wallet inventory, signing-participant
handoff, and verified cutover. This plan owns the cross-repository delivery.
Public protocol and Wallet behavior belong in `seams-wallet`. Private Console
composition, deployment, and product acceptance belong in `seams-monorepo`.

## Product contract and first release

An assisted migration moves an existing hosted Wallet tenant to infrastructure
controlled by that tenant. It preserves each migrated wallet's public keys and
chain addresses. The tenant's users retain control of their wallet custody seeds.
The destination can register new wallets under fresh tenant derivation roots.

First, qualify a move from hosted Seams on Cloudflare to a separate,
customer-owned Cloudflare account. Both deployments use the same exact released
Worker, WASM, browser SDK, and Console package versions during transfer. Keep the
transfer protocol independent of the hosting provider. Qualify Google Cloud VMs
after this path works. Add AWS only after its browser, Console, storage-denial,
and operational gates pass.

The first release requires a reachable source and an owner-approved handoff for
each wallet. It ends live signing sessions and requires fresh authentication at
the destination. Source service continues for wallets that have not moved.
Tenant exit completes only after the inventory reconciles and the source has
no active wallets or in-flight ceremonies for that tenant.

The source and destination can have different organization, project,
environment, resource, and browser-origin identifiers. A signed mapping binds
those identities to one migration. Wallet IDs remain stable inside that mapping.
The customer creates new deployment credentials and API keys. Source deployment
credentials never enter the transfer package.

R121 tenant-root recovery remains an exact-root restore flow. Its packages do
not become wallet migration packages or accept destination identity rebinding.
User key export remains a separate user action. It does not establish continued
threshold signing in a self-hosted Seams deployment.

## Existing pieces and the missing boundary

- R190 runs the same Wallet handlers on Cloudflare and celld. Its recorded VM
  checks use fresh wallets. They do not qualify data migration.
- R121's native CLI verifies recovery artifacts and restores a tenant root into
  an approved empty destination. It carries no wallet inventory or lane shares.
- The regional relocation flow fences a wallet, transfers authorization and
  Router, Deriver, SigningWorker, and presign history, then verifies activation
  and cleanup. It assumes one Console directory, one tenant scope, and one
  admitted regional resource catalog.
- R127 provides immutable tenant deployment bindings and local atomic
  activation. Its production readiness adapter currently reports
  `migrationAuthorized: false`. An environment with durable wallets therefore
  needs a verified migration receipt before its replacement binding can activate.

Cross-deployment migration adds independent administrators, storage, runtime
object IDs, credentials, browser origins, and control planes. No single D1
transaction can change authority in both deployments. The migration protocol
must settle that boundary with durable, authenticated receipts.

## Required safety properties

1. Tenant administration approves the exact destination and inventory.
   Each wallet owner approves that wallet's handoff. Neither approval grants
   the other party's authority.
2. The operator package contains no wallet custody seed, assembled signing key,
   source credential, raw database, or tenant derivation-root share. Encrypt
   import material for its exact destination role.
3. Every import envelope binds the source scope, destination scope, wallet ID,
   move ID, ownership generation, release version, and content digest.
   Historical records retain their original authenticated identity and bytes.
   Boundary parsers reject ambiguous or changed envelopes and records.
4. The source drains admitted operations before sealing its inventory. Frozen
   source state rejects new signing, recovery, enrollment, and export writes.
   Exact terminal-result replay remains available.
5. The destination allocates its own Durable Object IDs. It verifies every
   participant and remains inactive while import is incomplete.
6. The source records permanent retirement for a migrated wallet before the
   destination accepts fresh execution. Use stored receipts to resolve a lost
   acknowledgement. A later failure cannot reactivate the old source by
   restoring an earlier snapshot or changing a routing pointer.
7. Imported history preserves consumption, replay, revocation, audit, and
   ownership facts. Incomplete operations either settle at the source or stay
   fenced. No transfer resets a signing budget or one-use presignature.
8. When the browser origin or relying-party ID changes, existing passkeys and
   wallet-origin storage require an explicit owner flow. The destination proves
   the same wallet public keys before it accepts a new factor. The operator
   never receives plaintext client material.

## Implementation sequence

### 1. Define behavior and the first hard acceptance scenario

Add the migration lifecycle to `seams-wallet/docs/intended-behaviours.md`.
Specify the source and destination states, owner and administrator approvals,
identity mapping, session invalidation, retries, failure outcomes, and return
move policy. Define the complete wallet inventory before writing an exporter.
Model each lifecycle phase with required identity and authority fields.
Use discriminated unions, exhaustive switches, and type fixtures that reject
invalid phase combinations and direct object construction.
Include authentication methods, recovery state, linked devices, sessions,
completed operations, audits, Router state, both Deriver roles, SigningWorker
material, and presign consumption. Mark each record as transferred, retained
at the source for audit, or invalidated by the move.

Write one composed E2E scenario in the private `tests/e2e/` workspace. It must
start with two isolated deployments and an existing mixed Ed25519/ECDSA wallet.
The E2E is the product contract. Keep narrow cryptographic vectors and type
fixtures in their owning public workspace. Do not add unit or source-text tests.

Exit: the spec and E2E name every state owner and every expected outcome.

### 2. Prepare and authenticate the destination

Extend the existing deployment scripts and native CLI with a deterministic
customer deployment command. It provisions the current role graph, private
storage, migrations, HTTPS ingress, backup policy, public wallet origin, and
browser credential. It reports the exact release and resource identities.
Use one released application implementation on both hosts.

Issue a destination identity document that binds the tenant, role endpoints,
browser origin, relying-party ID, release hashes, and one-use import keys.
The CLI verifies it over HTTPS and requires the tenant administrator to approve
its fingerprint. Keep recovery-signing authority separate from migration
authority. Only scoped migration grants can request source snapshots or target
imports.

Exit: a fresh wallet can register, recover, and sign on the isolated
destination before the team transfers a hosted wallet.

### 3. Export a bounded, signed wallet inventory

Add a tenant-scoped inventory journal to the private Console boundary. It
records a stable wallet count, source binding revision, destination identity,
and each wallet's transfer status. Reject new tenant registrations during final
inventory sealing. Keep unmigrated wallets on their hosted home.

Add deployment operations to the existing native CLI. It obtains scoped
administrator approval and produces a signed transfer intent. The intent
holds explicit identity mapping, wallet IDs, public key manifests, and bounded
record counts. Each frozen wallet later adds its participant digests and retry
cursors to an encrypted migration package. Transfer participants export typed
records from their current persistence owners.
Do not copy D1 files or Durable Object storage snapshots.

Exit: the destination checks package integrity, scope, release compatibility,
and inventory completeness without activating a wallet.

### 4. Handoff each wallet with its owner

Extend the current owner relocation approval to bind the exact source and
destination deployment identities. The owner unlocks the wallet in the hosted
origin and approves one move. The browser transfers or reseals client material
through a dedicated wallet-origin flow. A changed relying-party ID requires
factor enrollment at the destination. The destination checks public-key and
address parity before recording owner completion.

Adapt the regional freeze, snapshot, import, and verification commands at
request and persistence boundaries. Deriver A, Deriver B, Router,
SigningWorker, and the Gateway retain their separate authority. Each role
imports only its own material. New destination object IDs and tenant scope are
bound in the verified import receipt. Existing protocol code stays shared.

Exit: the destination holds a complete, inactive wallet. Its public keys and
addresses match the hosted wallet. The source remains the recorded authority,
and the wallet's fresh work stays fenced until cutover.

### 5. Retire source authority and activate destination authority

Use one operation ID with a durable journal in each control plane. The source
records the exact owner approval, frozen inventory, verified target receipt,
and permanent wallet retirement. The destination activates only when it
verifies that retirement receipt. Retain source tombstones and exact
terminal-result replay after cleanup. Retries use the same move ID and
receipts. Changed inputs fail.

Replace the R127 `migrationAuthorized` boolean with a parsed, exact migration
receipt at the readiness boundary. The receipt must prove complete inventory
coverage and source retirement for every wallet in a tenant-level cutover.
An empty environment still follows the existing empty-environment path.

During a gradual move, the hosted lookup returns a signed destination locator
for migrated wallets. The application and Wallet SDK select the destination
from that locator. The source serves unmigrated wallets. Delete transitional
routing after final tenant cutover and the maximum supported retry window.

Exit: one deployment can start new work for each wallet. A failed destination
activation leaves the source retired and the move resumable. Returning to the
source requires a new authorized transfer with a higher generation.

### 6. Qualify, release, and operate

Run the composed E2E with a passkey and Email OTP wallet that has both signing
curves, a linked device, a recovery code, and completed operation history.
Prove the same addresses and valid signatures after cutover. Prove fresh
recovery and device linking on the destination. Test source refusal, exact
old-result replay, and owner or destination substitution rejection.

Interrupt the run after source freeze, each participant import, verification,
source retirement, and destination activation. Restart both deployments and
repeat the same command. Check that at most one deployment accepts fresh
signing at every checkpoint. Store release hashes, inventory digests, public
addresses, signatures, receipts, fault positions, and commands in a repeatable
artifact. Exclude secrets and bearer tokens.

Qualify a staging transfer between separate Cloudflare accounts. Then run an
assisted customer canary and reconcile the full wallet inventory. Publish the
exact Wallet packages and signed CLI assets before updating private pins.
Update the public availability table and marketing claims only after the
deployed canary passes.
Qualify Google Cloud and AWS separately before naming either as a supported
migration destination.

Exit: a customer can repeat the runbook, finish every wallet, retire hosted
authority, and operate without the Seams-hosted wallet service.

## Repository ownership

- `seams-wallet` owns the Wallet protocol, native CLI, browser custody flow,
  Worker role import/export boundaries, public behavior spec, and public
  lifecycle contracts.
- `seams-monorepo` owns Console inventory and cutover, deployment scripts,
  exact package pins, the composed E2E, operator runbook, and product copy.
- Implement public contract changes first. Publish and consume exact package
  releases before claiming composed or deployed acceptance.

## Completion gates

- A complete tenant inventory has one terminal result per wallet. Every
  migrated wallet has matching public keys and addresses at the destination.
- Source and destination receipts prove one active execution authority per
  wallet, including across crashes, retries, partitions, and delayed replies.
- Fresh signing, recovery, linked-device enrollment, and key export work at
  the destination with the new browser origin and credentials.
- Source cleanup retains tombstones and required audit evidence. It never
  restores consumed material or accepts a lower ownership generation.
- The exact release, configuration, data digests, signatures, and E2E artifact
  accompany the qualification record. The record states its provider scope.
- The customer runbook covers trust setup, approval, progress, pause, retry,
  failure recovery, final inventory reconciliation, and source retirement.

R122 is complete for a hosting target only when these gates pass there. A
working fresh deployment, a root-recovery drill, or a regional wallet move
cannot satisfy the hosted-to-self-hosted migration claim alone.
