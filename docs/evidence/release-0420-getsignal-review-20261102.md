# SDK 0.42.0 GetSignal review rollout

Date: November 2 and 3, 2026 (UTC).

Status: published and deployed to staging, production testnet, and production mainnet.

Wallet, Wallet Server, and VoiceID are published as `0.42.0` under the npm `latest` tag.
`0.42.0-rc.1` stays under the `next` tag and was the pre-release for GetSignal.
This release adds no database migrations.

The release answers the GetSignal requests of November 2.
`prepareOwnerTransaction` accepts `review`, so an owner NEAR transaction shows the review modal.
`review.origin` takes a rectangle, and the review modal opens from it.
`review.onVisible({ stage, rect })` reports when the review is visible.
The first wallet session read is discarded when it does not answer the selected wallet.
The export keys drawer is visible again; 0.39.0 to 0.41.1 hid it.

Public package revision: `87f81f8cd`.
Private staging revision: `08edeb58`.
Private production revision: `c73c8ce2c33b403337e7fbbd4ec5a8866ae20bfe`.
The pin commit on each branch changes only the package pins.
Each npm package reports the public revision as `gitHead`.

| Check | Result | Evidence |
| --- | --- | --- |
| Public Wallet validation | Passed | [Validation](https://github.com/seams-tech/seams-wallet/actions/runs/41469412776) |
| Public docs build | Passed | [Build](https://github.com/seams-tech/seams-wallet/actions/runs/41469412711) |
| npm package publication | Passed | [Release](https://github.com/seams-tech/seams-wallet/actions/runs/41469454112) |
| Private validation on dev | Passed | [Validation](https://github.com/seams-tech/seams-monorepo/actions/runs/41489138567) |
| Staging full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41490595241) |
| Private validation on main | Passed | [Validation](https://github.com/seams-tech/seams-monorepo/actions/runs/41490593869) |
| Production testnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41493262552) |
| Production mainnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41570000316) |

The first publish attempt failed at the validation gate on a GitHub API error (`HTTP 500`); the rerun of the failed job passed.

| Live Wallet host | JavaScript files that match the npm package |
| --- | --- |
| `staging.sign.seams.sh` | 166 of 166 |
| `test.sign.seams.sh` | 166 of 166 |
| `sign.seams.sh` | 166 of 166 |

The comparison covers every `.js` file under `dist/public/sdk`, including subfolders.

Both `staging.wallet.seams.sh/docs/` and `wallet.seams.sh/docs/` report public revision `ebe1e78c9` in their receipts.
That revision updates the docs site to 0.42.0 after the release commit.

The production testnet run deploys the production frontend, so `sign.seams.sh` served 0.42.0 from 17:55 UTC on November 2.
The mainnet run started at 03:04 UTC and ended at 03:15 UTC on November 3.
For about nine hours before it, the 0.42.0 SDK ran against mainnet Workers from the 0.41.1 private revision.
`@seams/wallet-server` has only version changes since 0.41.1, and both packages have the same unpacked size.
The mainnet run also deploys the production frontend; after it, `sign.seams.sh` still matched npm on 166 of 166 files.

After the mainnet run, control-plane version `053fb85e-e168-4f3f-921d-dc8a1d2b9918` holds recovery trust bindings that equal the signed `bundle.json` and `snapshot.json`.
The snapshot remains version 1 with zero revocation entries.
This rollout did not change recovery trust.

The staging run deployed private `dev`, which also holds home page changes from other sessions.
Private `main` holds only the pins, so `seams.sh` did not get those changes.

The GetSignal lane was not deployed.

Not tested: a live signature through `sign.seams.sh`, the export drawer on a production host, a review in GetSignal's own application, and branded Chrome and Safari.
