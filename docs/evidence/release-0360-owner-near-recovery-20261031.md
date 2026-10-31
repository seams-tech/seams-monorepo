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
The customer application update needs its deployed source revision. The currently
available `get-signal/signal-watch-analytics` wallet branch uses SDK `0.24.0` and
does not contain the reported `0.34` owner-operation integration.

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

Publication and deployment are pending. Record the exact package versions,
consumer revision, deployment workflow results, and served host manifests below
after verification. Production follows successful staging validation.

Before rollout, all three host manifests returned HTTP 200 with package `0.35.0`
and iframe protocol `21.0.0`:

- `https://staging.sign.seams.sh/wallet-assets.manifest.json`
- `https://test.sign.seams.sh/wallet-assets.manifest.json`
- `https://sign.seams.sh/wallet-assets.manifest.json`

Active uncommitted billing and session work is excluded from the release revisions.
Existing recovery trust and signed revocation history remain unchanged.
