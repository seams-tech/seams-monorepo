# Tenant-root recovery trust operations

Read this file before you restore recovery trust settings or rotate a recovery signer.

## Purpose

The recovery trust bundle holds the public root key that Wallet recovery verifiers trust.
The current bundle has one root and no rotation bridges. Wallet CLI pins this bundle in
`seams-wallet/crates/seams-cli/trust/recovery-trust-bundle.json`.

The root signs certificates for the two Derivers and the control plane. These three
signers sign tenant-root recovery artifacts. The root also signs a revocation snapshot.
The snapshot records retired or compromised recovery signer keys. A root-rotation
bridge requires signatures from both the old and new root keys.

The bundle is public trust data. The certificates, snapshot, and any rotation bridges
carry signatures. The root's **private recovery signing key** issues those signatures.
It does not sign ordinary wallet transactions. Runtime Workers receive public trust
data, never this private key. The recovery signing key is distinct from the CLI
release signing key and from every tenant root.

Current recovery verification needs the public bundle and signed records. Future
certificate issuance, signer revocation, or bridged root rotation needs the private
recovery signing key. If that key is lost, existing records remain verifiable. A new
revocation or a bridge from the current root cannot be signed.

## Backups and deployed settings

These local deployment backups contain the public bundle and signed snapshot:

| Lane | Backup | GitHub environment |
| --- | --- | --- |
| Staging testnet | `~/.seams/staging-deployment.env` | `staging-tenant-root-control-plane` |
| Production mainnet | `~/.seams/production-deployment.env` | `production-tenant-root-control-plane` |

Each backup stores the public records under names ending in
`ROUTER_AB_TENANT_ROOT_RECOVERY_TRUST_BUNDLE_JSON` and
`ROUTER_AB_TENANT_ROOT_RECOVERY_TRUST_SNAPSHOT_JSON`. The values are JSON text inside
quoted environment-file values. Parse the outer quoting and then parse the JSON.
Do not execute or print the whole environment file. It also contains other deployment
values.

The GitHub environment variables use those two `ROUTER_AB_...` names. The deployed
control-plane Worker bindings omit the `ROUTER_AB_` prefix. Current deployment policy
requires both bindings in staging testnet and production mainnet. Production testnet
does not require them.

Before any restore, compare the candidate bundle with the Wallet CLI pin. Verify the
snapshot's canonical JSON and Ed25519 signature against the bundle's current root.
Compare its version and complete revocation entries with the latest signed artifact
and deployed snapshot. Never replace a newer snapshot with an older one. Never use
an empty snapshot to erase revocation history. After deployment, read the Worker
bindings and compare them byte for byte with the verified files.

On 2026-10-23, both backups contained the same canonical bundle and signed snapshot.
The bundle matched the CLI pin. Snapshot version 1 records an `issuedAt` value of
2026-09-08T03:51:10.365Z. It had zero revocation entries and passed signature
verification. These facts describe that checkpoint. Verify whether a later
snapshot exists before every future restore.

The GitHub staging and mainnet trust variables held invalid two-byte values before
the Wallet 0.21.0 rollout. The rollout restored the verified backup values. A live
Worker readback matched each backup. The rollout then passed [staging activation],
[production-testnet cutover], and [mainnet activation]. The Wallet site, Console,
and host deployment smoke tests also passed.

[staging activation]: https://github.com/seams-tech/seams-monorepo/actions/runs/39893914984
[production-testnet cutover]: https://github.com/seams-tech/seams-monorepo/actions/runs/39895678604
[mainnet activation]: https://github.com/seams-tech/seams-monorepo/actions/runs/39897232098

## Private signing key status

The signing workflow is `.github/workflows/sign-recovery-trust.yml`. It expects
`SEAMS_RECOVERY_SIGNING_KEY` and `SEAMS_RECOVERY_SIGNER_KEY_ID` in the protected
`recovery-signing` GitHub environment. That environment did not appear in the
repository environment list on 2026-10-23. A targeted search found no identifiable
private recovery signing-key backup under `~/.seams`. This finding does not prove
that the key is lost. Find the original key and verify its protected backup before
issuing another certificate or revocation snapshot. A bridged root rotation also
needs the original key.

Keep any private-key backup encrypted and access-controlled. Do not place the key in
this repository, a runtime Worker, or an ordinary deployment environment file.
Do not substitute the separate CLI release signing key. If the original recovery
signing key cannot be recovered, plan a new trust root and a Wallet release. The
old root cannot sign a continuity bridge after its private key is lost.
