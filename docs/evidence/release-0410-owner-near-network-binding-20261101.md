# SDK 0.41.0 owner-operation network binding rollout

Date: November 1, 2026 (JST).

Status: published and deployed to staging, production testnet, and production mainnet.

Wallet, Wallet Server, and VoiceID are published as `0.41.0`.
The Wallet iframe protocol remains `23.0.0`, because the new field is optional.
The wallet-management protocol remains `5`, and the signed recovery CLI remains `0.29.0`.
This release adds no database migrations.

The release answers `seams-tech/seams-wallet#59`.
The owner NEAR binding now holds the NEAR network instead of the RPC URL.
A record from SDK 0.40.0 or earlier opens only under the RPC URL that wrote it, and then moves to the network binding.
Recovery refuses an RPC whose `chain_id` differs from the bound network.
An `unresolved` state now carries the optional `retirementWait` field with the final block height, the last accepted block height, and the submission evidence.

Public package revision: `7dbdfc1d5185b9d0790f1716212e3f8907781426`.
Private deployment revision: `255f1b522af1939c1d04fb3bb4b88b6742116110`.
Staging, production testnet, and production mainnet used that exact private revision.
Each npm package reports the public revision as `gitHead`.

| Check | Result | Evidence |
| --- | --- | --- |
| Public Wallet validation | Passed | [Validation](https://github.com/seams-tech/seams-wallet/actions/runs/41306450149) |
| npm package publication | Passed | [Release](https://github.com/seams-tech/seams-wallet/actions/runs/41306460465) |
| Private validation on dev | Passed | [Validation](https://github.com/seams-tech/seams-monorepo/actions/runs/41311371843) |
| Staging full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41312103230) |
| Private validation on main | Passed | [Validation](https://github.com/seams-tech/seams-monorepo/actions/runs/41313124833) |
| Production testnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41313876984) |
| Production mainnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41313879436) |

The private frozen installation, lint, type checks, boundary checks, and 53 script checks passed against the published packages.

| Live Wallet host | Iframe protocol | Files that match the npm package |
| --- | --- | --- |
| `staging.sign.seams.sh` | `23.0.0` | 148 of 148 |
| `test.sign.seams.sh` | `23.0.0` | 148 of 148 |
| `sign.seams.sh` | `23.0.0` | 148 of 148 |

Both `staging.wallet.seams.sh/docs/` and `wallet.seams.sh/docs/` report the public release revision in their receipts.

After the rollout, the staging and mainnet control-plane Workers held recovery trust bindings that equal the signed `bundle.json` and `snapshot.json`.
The protected GitHub inputs for both lanes equal the same two files.
`staging.console.seams.sh` and `console.seams.sh` serve the same bundle byte for byte.
The snapshot remains version 1 with zero revocation entries.
This rollout did not change recovery trust. The Console recovery certificates were not compared in this rollout.
The trust comparison ran only after the rollout.

The GetSignal lane was not deployed.
`getsignal.console.seams.sh` answers `recovery_trust_unavailable`, and its control-plane Worker has no recovery trust bindings. That Worker version dates from October 31, 2026.

The `application handoff` contract case passed twice with the fix.
With the RPC URL back in the binding, the case failed with `recovery_unavailable`. This negative control stopped at that step, so the release of the pending guard after an RPC change rests on code reading.
Live-chain retirement remains unverified.
