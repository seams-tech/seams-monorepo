# SDK 0.41.1 token transfer review rollout

Date: November 2, 2026 (JST).

Status: published and deployed to staging, production testnet, and production mainnet.

Wallet, Wallet Server, and VoiceID are published as `0.41.1`.
The Wallet iframe protocol remains `23.0.0`.
The wallet-management protocol remains `5`, and the signed recovery CLI remains `0.29.0`.
This release adds no database migrations.

The release answers `seams-tech/seams-wallet#60`.
A single NEAR `ft_transfer` or `ft_transfer_call` now headlines the token amount instead of `1 yoctoNEAR`.
An ERC-20 `transfer` headlines the token amount when the contract is on the wallet's list for that chain.
The "Transaction details" scrollbar now follows the dark and light themes.
Review modals show artwork for BTC, ETH, stNEAR, NEAR, USDC, USDT, SOL, ZEC, and listed wrapped forms.
Only native assets and tokens on the wallet's own lists reach branded artwork.
Tempo modals did not change.

Public package revision: `6653d667bb3b16632062e15c17f8b8cece41f501`.
Private deployment revision: `e299d3ae253b52e93b68d5d76f82f3df425b4d50`.
Staging, production testnet, and production mainnet used that exact private revision.
Each npm package reports the public revision as `gitHead`.

| Check | Result | Evidence |
| --- | --- | --- |
| Public Wallet validation | Passed | [Validation](https://github.com/seams-tech/seams-wallet/actions/runs/41401230033) |
| npm package publication | Passed | [Release](https://github.com/seams-tech/seams-wallet/actions/runs/41401287682) |
| Private validation on dev | Passed | [Validation](https://github.com/seams-tech/seams-monorepo/actions/runs/41410043001) |
| Staging full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41411073272) |
| Private validation on main | Passed | [Validation](https://github.com/seams-tech/seams-monorepo/actions/runs/41412793837) |
| Production testnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41413755910) |
| Production mainnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41417869816) |

The private frozen installation, lint, type checks, boundary checks, and 53 script checks passed against the published packages.

| Live Wallet host | JavaScript files that match the npm package |
| --- | --- |
| `staging.sign.seams.sh` | 166 of 166 |
| `test.sign.seams.sh` | 166 of 166 |
| `sign.seams.sh` | 166 of 166 |

The comparison covers every `.js` file under `dist/public/sdk`, including subfolders.
The 0.41.0 record counted 148 files, and its method is not recorded, so the two counts are not comparable.

Both `staging.wallet.seams.sh/docs/` and `wallet.seams.sh/docs/` report the public release revision in their receipts.

The production testnet run deploys the production frontend, so `sign.seams.sh` served 0.41.1 before the mainnet backend run.
For about 25 minutes, the 0.41.1 SDK ran against mainnet Workers built from the 0.41.0 private revision.
The mainnet run started at 18:05 JST and ended at 18:18 JST.

After the rollout, the staging and mainnet control-plane Workers held recovery trust bindings that equal the signed `bundle.json` and `snapshot.json`.
`staging.console.seams.sh` and `console.seams.sh` serve `bundle.json` byte for byte.
The snapshot remains version 1 with zero revocation entries.
This rollout did not change recovery trust.

The GetSignal lane was not deployed.
`getsignal.console.seams.sh` answers `recovery_trust_unavailable`.

The modal passed a local render of 26 cases in Chromium, WebKit, and Firefox.
The signing flow changes passed only the type check.
A live signature through `sign.seams.sh` was not tested.
The Japanese text has no external review.

The public wallet UI suite had 5 failures in 98 cases on the release code.
The same cases fail on an unchanged export, so this release did not cause them: `wallet-ui/confirm-content.browser.test.ts` "tree replacement and removal release content height clamps" in Chromium and WebKit, and `wallet-ui/confirmation-mount.browser.test.ts:722` in three WebKit cases.
