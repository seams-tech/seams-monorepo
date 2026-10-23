# Tenant-root recovery trust operations

Read this file before you restore recovery trust settings or rotate a recovery signer.

## Current authority

The recovery trust bundle holds the public root key that Wallet recovery verifiers trust.
Wallet CLI pins it in `seams-wallet/crates/seams-cli/trust/recovery-trust-bundle.json`.
The current root is `seams-recovery-root-production-2026-10`, with public fingerprint
`010e1a5aeadb6afb`. The bundle has one root and no rotation bridge.

On 2026-10-23, the prelaunch recovery root was replaced with a new Ed25519 root.
The owner chose to discard prelaunch recovery history. Recovery packages and signer
certificates issued under the old root do not verify under the new CLI pin. Existing
wallet records remain in D1; this change did not delete them. Do not attempt to
restore one of their old recovery packages with the new root.

The root signs certificates for Deriver A, Deriver B, and the control plane. These
signers issue tenant-root recovery artifacts. The root also signs revocation
snapshots. The snapshot records retired or compromised recovery signer keys.
A rotation bridge requires signatures from both the old and new root keys.

The bundle is public trust data. The certificates and snapshot carry signatures.
The root's **private recovery signing key** issues those signatures. It does not
sign ordinary wallet transactions. Runtime Workers receive public trust data,
never this private key. The recovery signing key is distinct from the CLI release
signing key and from every tenant root.

## Backups and deployed settings

The private key is saved in `~/.seams/recovery-signing-2026-10.env` with mode `0600`.
The `~/.seams` directory has mode `0700`. This file contains
`SEAMS_RECOVERY_SIGNING_KEY` and `SEAMS_RECOVERY_SIGNER_KEY_ID`. Never print,
commit, or pass the key to a runtime Worker. The protected `recovery-signing`
GitHub environment in `seams-tech/seams-monorepo` holds the same two values.
Its [signing run] produced a snapshot that verifies against the new CLI pin.
GitHub does not return the private value after storage.

[signing run]: https://github.com/seams-tech/seams-monorepo/actions/runs/39909176129

Public signed records and their SHA-256 manifest are in
`~/.seams/recovery-trust-2026-10/` with mode `0700` for the directory and `0600`
for the files. `bundle.json` holds the public root. `snapshot.json` is the
workflow-signed version 1 snapshot with zero revocation entries. The staging and
production certificate files bind the current signer keys in those lanes.
`manifest.json` records the source signing run and file hashes. The local
signer and an independent Ed25519 verifier accepted all seven signed records.

The following local deployment backups contain the public bundle, signed snapshot,
and lane-specific certificates:

| Lane | Control-plane backup | Console backup | GitHub environments |
| --- | --- | --- | --- |
| Staging testnet | `~/.seams/staging-deployment.env` | `~/.seams/console/staging-testnet-deployment.env` | `staging-tenant-root-control-plane`, `staging-console` |
| Production mainnet | `~/.seams/production-deployment.env` | `~/.seams/console/production-mainnet-deployment.env` | `production-tenant-root-control-plane`, `production-console` |

The four deployment files also contain unrelated secrets. Parse only the needed
values; do not execute or print an entire file. Their pre-rotation copies are in
`~/.seams/backups/recovery-root-prelaunch-20261023/`.

On 2026-10-23, two AES-256 ZIP backups were verified in `~/Documents`:

- `seams-secrets-recovery-bundle-20261023T071808Z-aes256.zip` contains all 1,234
  files under `~/.seams` and the owner-supplied Cloudflare, R2, and NEAR values.
  Its SHA-256 is `ee3e2e5ea97e6ab616540a29672b26d54f3863d5a9aedd87c7465db56d93a9fe`.
- `seams-current-deployment-secrets-20261023T085337Z-aes256.zip` contains 19
  current deployment files and the same owner-supplied values. It excludes
  historical backups, database dumps, old environment files, and local Docker
  state. Its SHA-256 is `8cb747590fd3157204ae86cfad7f7e02fa663e6108bcac446068842e906fbc56`.

The ZIP passwords differ. Store them separately in a password manager. They are
absent from the ZIPs and this repository. Verify a ZIP's SHA-256 and its encrypted
`BACKUP-MANIFEST.json` before using a restored file. The owner-supplied values
were archived as given; their current validity was not checked. GitHub-only
write-only secrets, including `SEAMS_RELEASE_SIGNING_KEY`, are absent from both
ZIPs. These archives cannot recreate every GitHub environment secret.

The control-plane environment variables are
`ROUTER_AB_TENANT_ROOT_RECOVERY_TRUST_BUNDLE_JSON` and
`ROUTER_AB_TENANT_ROOT_RECOVERY_TRUST_SNAPSHOT_JSON`. Their deployed Worker
bindings omit the `ROUTER_AB_` prefix. Console uses
`TENANT_ROOT_RECOVERY_CERTIFICATES_JSON`. Staging testnet and production mainnet
require these settings. Production testnet does not require the trust bundle or
snapshot.

Before any restore, compare the candidate bundle with the Wallet CLI pin. Verify
the snapshot's canonical JSON and Ed25519 signature against that bundle. Compare
its version and every revocation entry with the latest signed artifact and the
deployed snapshot. Never replace a newer snapshot with an older one. Never use
an empty snapshot to erase later revocations. Verify every certificate against
the lane's current signer keyset. After deployment, compare live Worker bindings
with the verified files byte for byte.

## Deployment record

The new public CLI trust pin and version 0.21.0 are in `seams-wallet` commit
`2c98a28b46cd0024377cdfcb917c6309a49d64f0`. Its [native build] and
the private [release-signing run] passed. The [GitHub release] and npm package
`@seams/wallet-cli@0.21.0` are public. A fresh npm install ran the signed native
CLI and reported version 0.21.0.

[native build]: https://github.com/seams-tech/seams-wallet/actions/runs/39909039762
[release-signing run]: https://github.com/seams-tech/seams-monorepo/actions/runs/39909273330
[GitHub release]: https://github.com/seams-tech/seams-wallet/releases/tag/seams-cli-v0.21.0

Staging control-plane and Console deployed with the new public trust data.
The [staging activation] and [updated staging activation] passed their health
checks. Both public staging Console domains served a recovery trust bundle
that matched `bundle.json` exactly after the GET relay fix deployed. The
staging [Wallet Console], [Wallet site], and [Wallet host] deployments passed.

The [production-testnet rollout] passed backend, Console, cutover, and smoke
checks. Production testnet does not require a recovery trust bundle. The
mainnet [backend deployment], [Console backend deployment], and [activation]
passed. The live mainnet control-plane bundle and snapshot matched their
saved signed files byte for byte. Both public mainnet Console domains served
the new bundle exactly. The Wallet site, Wallet Console, and both production
Wallet hosts passed their frontend deployment checks: [production site],
[production Console], and [production hosts].

All deployment workflows used private repository commit
`50e351dde25b5bcf3fc1f1aaa19fc830dc7b7572`. Mainnet signer certificates
were checked against each active role's public key before deployment. A
read-only query found no pending tenant-root operations or recovery-generation
steps in the mainnet Console D1 database before the rollout.

[staging activation]: https://github.com/seams-tech/seams-monorepo/actions/runs/39911004361
[updated staging activation]: https://github.com/seams-tech/seams-monorepo/actions/runs/39912377307
[Wallet Console]: https://github.com/seams-tech/seams-monorepo/actions/runs/39912979576
[Wallet site]: https://github.com/seams-tech/seams-monorepo/actions/runs/39913113665
[Wallet host]: https://github.com/seams-tech/seams-monorepo/actions/runs/39913261823
[production-testnet rollout]: https://github.com/seams-tech/seams-monorepo/actions/runs/39913409945
[backend deployment]: https://github.com/seams-tech/seams-monorepo/actions/runs/39914391000
[Console backend deployment]: https://github.com/seams-tech/seams-monorepo/actions/runs/39914780797
[activation]: https://github.com/seams-tech/seams-monorepo/actions/runs/39915083523
[production site]: https://github.com/seams-tech/seams-monorepo/actions/runs/39914426200
[production Console]: https://github.com/seams-tech/seams-monorepo/actions/runs/39915114320
[production hosts]: https://github.com/seams-tech/seams-monorepo/actions/runs/39914666899

## Future signer operations

The signing workflow is `.github/workflows/sign-recovery-trust.yml`. It uses the
protected `recovery-signing` environment. To issue a new certificate or
revocation snapshot, start from the latest signed snapshot and preserve its
revocation entries. Verify the output against the CLI pin before updating any
deployment values.

If the private root key is lost, existing artifacts stay verifiable. A new
revocation or bridge from this root cannot be signed. The file in `~/.seams`
meets the requested local backup requirement. An encrypted off-device copy is
still needed for recovery from loss of this computer. Keep that copy separate
from ordinary deployment environment files.
