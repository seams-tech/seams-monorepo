# SDK 0.40.0 owner-operation retirement rollout

Date: November 1, 2026 (JST).

Status: published and deployed to staging, production testnet, and production mainnet.

Wallet, Wallet Server, and VoiceID are published as `0.40.0`.
The Wallet iframe protocol is `23.0.0`.
The wallet-management protocol remains `5`, and the signed recovery CLI remains `0.29.0`.
This release adds no database migrations.

The release records signer key, nonce, reference block, and broadcast milestone before an owner NEAR operation broadcasts.
A finalized expiry with an unused nonce returns `retired` with proof of non-execution.
A used nonce or deleted key returns `retirement_available`.
`retire()` requires a fresh owner passkey approval in the Wallet origin.
Retirement never rebroadcasts and releases only the matching pending operation.
Hash-only receipts from SDK 0.39.0 and earlier remain unresolved until their validity period passes after the first recovery in SDK 0.40.0.

Public package revision: `830281125e361cea071a0957511e1f42093ccd63`.
Private deployment revision: `4d647ed9450fa4225fd9778fe35f177e37ab07d8`.
Staging, production testnet, and production mainnet used that exact private revision.
Each npm package reports the public revision as `gitHead`.
The published package integrity values match the retained release artifacts.

| Check | Result | Evidence |
| --- | --- | --- |
| Public Wallet validation | Passed | [Validation](https://github.com/seams-tech/seams-wallet/actions/runs/41275927697) |
| npm package publication | Passed | [Release](https://github.com/seams-tech/seams-wallet/actions/runs/41275937924) |
| Private validation on dev | Passed | [Validation](https://github.com/seams-tech/seams-monorepo/actions/runs/41281429706) |
| Staging full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41281616639) |
| Private validation on main | Passed | [Validation](https://github.com/seams-tech/seams-monorepo/actions/runs/41282368373) |
| Production testnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41282397303) |
| Production mainnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41282399461) |

The private frozen installation, lint, type checks, boundary checks, and 53 script checks passed against the published packages.
The public package checks, documentation build, protocol handshake, and owner-operation browser tests passed before publication.
The release validation also passed its representative Wallet lifecycle contracts.

| Live Wallet host | SDK | Iframe protocol |
| --- | --- | --- |
| `staging.sign.seams.sh` | `0.40.0` | `23.0.0` |
| `test.sign.seams.sh` | `0.40.0` | `23.0.0` |
| `sign.seams.sh` | `0.40.0` | `23.0.0` |

All 18 independent readiness checks passed across the three lanes.
The deployed NEAR owner-operation runtime asset matched the published Wallet package on every host.
Both documentation sites report the public release revision.

The staging and mainnet recovery trust bundles, signed revocation snapshots, and Console recovery certificates matched the current signed trust artifacts, protected GitHub inputs, and live Worker bindings before and after rollout.
Legacy lane deployment backup files contain earlier trust values. The rollout did not use them. Update those backup copies before any recovery-trust restoration exercise.

Live-chain retirement remains unverified because the first expiry requires about 25 hours.
The contract scenario uses real MPC signatures and a passkey with controlled RPC responses.
