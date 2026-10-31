# SDK 0.36.0 owner-operation recovery rollout

Date: 2026-10-31

## Release scope

Wallet SDK, Wallet Server, and VoiceID advance together to `0.36.0`.
The Wallet iframe protocol advances to `22.0.0`.
The signed recovery CLI remains `0.29.0` and the wallet-management protocol remains `5`.

Owner NEAR operations distinguish `not_submitted`, `recovery_unavailable`, and
`unresolved`. Known transaction hashes and recovery identities survive errors.
Missing receipts do not prove non-submission. Broadcast and status requests have
a 30-second deadline. Confirmed reverts settle without another recovery call.
The example preserves hashes after reload and prevents replacement of unresolved operations.

Update application SDKs and hosted Wallet assets together. Clients using an older
iframe protocol require an SDK update before connecting to the new host.
The user excluded customer application source changes from this rollout.

## Source and verification

- SDK fixes: `seams-wallet` commits `1790df609` and `b6fa19d13`.
- Resolution record: `413da96d0`.
- SDK version preparation: `f5b125598b19b87faee2174e202e3a9540016c6f`.
- SDK release revision: `13d97fd3bab26fa60ee5e2f14b2bb2555049119e`.
- Application-owner and standard NEAR browser E2E scenarios passed.
- SDK build, type checks, documentation checks, and bloat checks passed locally.
- [Release workflow](https://github.com/seams-tech/seams-wallet/actions/runs/41203667360).
- [Release validation](https://github.com/seams-tech/seams-wallet/actions/runs/41203665904).

Lifecycle CI reuses the artifacts produced by its preceding build step. All
representative checks still run. This avoids a second full runtime build inside
the test runner.

The local owner E2E artifact is `seams-wallet/tests/.artifacts/application-auth/receipt.json`.
It records real MPC signatures against controlled RPC responses, including stalled
requests, unavailable iframe startup, receipt write failures, reload, and recovery
without rebroadcast. It does not establish the reported deposit's on-chain outcome.

## Deployment status

Publication and release validation succeeded. All three `0.36.0` package versions
were verified in npm after its processing delay. Staging and production remain pending.
Production follows successful staging validation.

Registry integrity values:

| Package | SHA-512 integrity |
| --- | --- |
| `@seams/wallet` | `sha512-Pab6ho+V24Vr7gg+8v7oxA1/Gixv8oFWNWtFHgkeOm68C3D8PUZTgmKTlo3BPcVZmbAwOSse/bD7HgMmqrWN7Q==` |
| `@seams/wallet-server` | `sha512-qoMPm9FOM6UKe5oBgLPxX+cV9spAlVDaa6KLBhAp8g2MgpNv0HOmNCWO1T1XyRsVavwG4uLya38gzXjfciLxHg==` |
| `@seams/voiceid` | `sha512-ieQFQMmLfrJzC4qJQLQil+plHaxlQ8yYKc6JwipsXegpKqdioS02IxlNt92aF2hxFsT5k3TcH1ZnQ6Qz7JoaeQ==` |

Before rollout, all three host manifests returned HTTP 200 with package `0.35.0`
and iframe protocol `21.0.0`:

- `https://staging.sign.seams.sh/wallet-assets.manifest.json`
- `https://test.sign.seams.sh/wallet-assets.manifest.json`
- `https://sign.seams.sh/wallet-assets.manifest.json`

The deployment tree uses private base `346f9b58` plus the exact SDK consumer pins
and this evidence record. Later billing commits `0e5d0001` and `60eed5e9` remain on
local `dev` and are excluded from this rollout. Their companion SDK billing commit
`cb81c010c` is also outside the published `0.36.0` revision.
Existing recovery trust and signed revocation history remain unchanged.
