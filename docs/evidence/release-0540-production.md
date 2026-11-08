# SDK 0.54.0 production rollout

Date: November 8, 2026 (UTC).

Status: deployed to production testnet and production mainnet. The owner approved the production deployment on November 8, 2026 ("Yes, deploy production").

Wallet, Wallet Server, and VoiceID `0.54.0` come from public revision `84939011d` (`release: prepare Wallet SDK 0.54.0`).
The staging rollout is in `docs/evidence/release-0540-staging.md`.

Private `main` moved from `5e4bb7c6` (0.53.0 pins) to `c9165220`.
`c9165220` holds only the 0.54.0 pins and the Bun workflow fix, as for 0.53.0.
It was built on `5e4bb7c6` from a temporary index and pushed by SHA as a fast-forward.
The other commits on private `dev` did not go to `main`.

| Check | Result | Evidence |
| --- | --- | --- |
| Private validation on main (`c9165220`) | Passed, 09:29 to 09:37 UTC | [Validation](https://github.com/seams-tech/seams-monorepo/actions/runs/42467396088) |
| Production testnet full stack, `deploy-live-demo.yml` (`c9165220`) | Passed, 19 of 19 jobs, 09:37 to 09:49 UTC | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/42467997652) |
| Production mainnet full stack, `deploy-production-mainnet-backend.yml` (`c9165220`) | Passed, 17 of 17 jobs, 09:49 to 10:00 UTC | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/42468834512) |

Each full-stack run deployed the backend, the Console, the tenant activation and the production frontend.
The runs went one at a time, because both deploy the production frontend.

## The main commit

`c9165220` changes exactly 11 paths, and each path takes its blob from private `dev`:

- The 9 paths of `efebc003`: seven manifests, `pnpm-lock.yaml` and `pnpm-workspace.yaml`.
- The 2 paths of `de647fd0`: `deploy-production-frontend.yml` and `deploy-staging-frontend.yml`.

Before the build, each of the 11 files on `5e4bb7c6` was equal to its `dev` version before `efebc003` or `de647fd0`.
`git diff 5e4bb7c6 c9165220` lists only these 11 paths.

The production frontend jobs installed Bun from npm, and both passed.

## Production verification

The comparison covers every `.js` file under `dist/public/sdk` of the npm `@seams/wallet@0.54.0` tarball, including subfolders.
Each file's sha256 is compared with `https://<host>/sdk/<path>`.
The baseline used a unique query string, so it put no old copies in the edge cache.

| Live Wallet host | Before (09:30 UTC, query string) | After testnet (09:49 UTC) | After mainnet (10:00 UTC) |
| --- | --- | --- | --- |
| `test.sign.seams.sh` | 19 of 171 | 171 of 171 | 171 of 171 |
| `sign.seams.sh` | 19 of 171 | 171 of 171 | 171 of 171 |
| `wallet.seams.sh` | 19 of 171 | 171 of 171 | 171 of 171 |

Each check after a run ended was made twice: without a query string and with one. Both gave the same result.

`deploy-live-demo.yml` also moved `sign.seams.sh` and `wallet.seams.sh` to 0.54.0, 11 minutes before the mainnet backend run started.

`/wallet-assets.manifest.json` on `test.sign.seams.sh` and `sign.seams.sh` reports package version `0.54.0` and iframe protocol `23.0.0`.

Docs:

- `docs.wallet.seams.sh/seams-wallet-docs-artifact.json` names revision `84939011de1915bdf08723b5ef5d1e82146c383a`.
- `wallet.seams.sh/docs/seams-wallet-docs-artifact.json` redirects to that receipt.
- The path `docs.wallet.seams.sh/docs/seams-wallet-docs-artifact.json` returns 404. The receipt is at the root of the docs host.

Recovery trust:

- Mainnet control plane `router-ab-tenant-root-control-plane` serves version `f306f36c-9f7c-4de6-86f9-1b6edd85dfef`, deployed at 09:52 UTC by run `42468834512`. Before the run it served `737dd36b`.
- Both trust bindings are `plain_text` and equal `~/.seams/recovery-trust-2026-10/bundle.json` and `snapshot.json`.
- The snapshot remains version 1 with zero revocation entries. This rollout did not change recovery trust.
- Testnet control plane `router-ab-tenant-root-control-plane-testnet` serves version `777a4006-ddaa-4076-9335-9ea7e48ca54d`, deployed at 09:40 UTC by run `42467997652`. It has no recovery trust bindings, before and after this rollout.

## Not done

- No live registration or signature on production after the deployment.
- No branded browser check.
- The GetSignal lane was not touched. It no longer exists.
