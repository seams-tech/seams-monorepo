# SDK 0.36.0 owner-operation recovery rollout

Date: 2026-10-31

Status: complete. Final live checks passed at 23:45 JST on October 31, 2026.

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
were verified in npm after its processing delay.

- Isolated consumer revision: `adb02b115973136773ea59f8b4926f23953e5baa`.
- Frozen installation and full private backend/frontend type checks passed against an archive of that exact revision.
- [Staging deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41208660853) passed from that revision, including backend and Console readiness.
- The staging host manifest returned HTTP 200 with package `0.36.0` and protocol `22.0.0`.
- [Private repository validation](https://github.com/seams-tech/seams-monorepo/actions/runs/41208660598) passed for the same revision.
- Production promotion revision: `b4787ea2f26bc00eedbe8464e95be7ef764ae6da`.
- The promotion preserves the existing main-only commit. Its file tree is identical to verified staging: `10cb5e77650e42dfd7daff3abc8e614b958f9a23`.

Production deployment status:

- [Production testnet](https://github.com/seams-tech/seams-monorepo/actions/runs/41210007064): passed, including activation, backend/Console smoke checks, frontend deployment, and marketing acceptance.
- [Production mainnet](https://github.com/seams-tech/seams-monorepo/actions/runs/41210009233): passed, including activation, readiness, frontend deployment, and marketing acceptance.
- [Seams-hosted GetSignal runtime retry](https://github.com/seams-tech/seams-monorepo/actions/runs/41210485627): passed, including resource preflight, runtime deployment, activation, and readiness.

Final independent verification:

| Hosted assets | HTTP status | SDK | Iframe protocol |
| --- | --- | --- | --- |
| `staging.sign.seams.sh` | 200 | `0.36.0` | `22.0.0` |
| `test.sign.seams.sh` | 200 | `0.36.0` | `22.0.0` |
| `sign.seams.sh` | 200 | `0.36.0` | `22.0.0` |

All 23 live readiness checks passed on their first attempt. They covered the
staging, production-testnet, production-mainnet, and GetSignal Gateways, both
signing protocol health endpoints, ceremony public keys, and the three public
Console readiness endpoints. The generated local evidence is
`.artifacts/sdk0360-final-readiness.json`.

The initial GetSignal run `41210011649` stopped at its preflight. Its shared
onboarding test omitted the browser `Origin` header on authenticated mutations.
The production Console correctly rejected those requests with `origin_forbidden`.
Classification: `valid_test_needs_update`. No production origin policy changed.

Release successor `51c3bb589358e9a0943757f003a398320abb3bc4` changes only
`tests/relayer/console-onboarding.scenario.ts`. The corrected Console service-auth
E2E passed against the isolated release tree in 10.6 seconds. GetSignal deployed
from this test-only successor; testnet and mainnet used `b4787ea2`.

Initial runs `41209763047`, `41209765281`, and `41209767744` were accidentally
dispatched against the previous main revision after the ancestry check failed.
They were cancelled before deployment or migration commands ran. The corrected
runs above use the verified promotion revision.

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
The consumer update is retained locally by `d6254c69` and merge `181ff4b9`.
Remote `main` retains the deployed test-only successor. Final evidence is a
documentation-only successor on remote `dev`. Do not promote local `HEAD`, which
also contains the unrelated billing work.
Existing recovery trust and signed revocation history remain unchanged.
