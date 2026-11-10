# SDK 0.54.0 staging rollout

Date: November 8, 2026 (UTC).

Status: published to npm and deployed to staging. Production is not deployed.

Wallet, Wallet Server, and VoiceID are published as `0.54.0` under the npm `latest` tag.
Each npm package reports public revision `84939011d` (`release: prepare Wallet SDK 0.54.0`) as `gitHead`.

Private pin commit on `dev`: `efebc003`.
Private workflow fix on `dev`: `de647fd0`.
Private staging frontend revision: `de647fd0`.
Private `main` is still `5e4bb7c6` with the 0.53.0 pins.

| Check | Result | Evidence |
| --- | --- | --- |
| Private validation on dev (`efebc003`) | Passed | [Validation](https://github.com/seams-tech/seams-monorepo/actions/runs/42463546782) |
| Staging full stack (`efebc003`) | Backend, Console and activation passed; frontend failed 3 times | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/42464150380) |
| Staging frontend, `component=all` (`de647fd0`) | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/42465925429) |

## The Bun download failure

All three attempts of the frontend job in run `42464150380` failed at `Setup Bun` (`oven-sh/setup-bun@v2`).
The attempts ran from 08:50 to 08:57 UTC.
The action downloads `https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-linux-x64.zip`, and that URL returned HTTP 504.
From this Mac, the same URL still returned 504 at 09:07 UTC.
Other GitHub release downloads returned 200, and GitHub status showed no incident.

Classification: `environment_or_infrastructure_failure` (the GitHub release asset host for `oven-sh/bun`).
The failure blocked every frontend deployment, so the workflows no longer use that host.

Fix `de647fd0`: in `deploy-staging-frontend.yml` and `deploy-production-frontend.yml`, the `Setup Bun` step now runs `npm install --global bun@1.4.4` and `bun --version`.
Version 1.4.4 is the version that `setup-bun` selected.
The npm package `bun` takes its binary from `@oven/bun-linux-x64`, which is also on npm.
In run `42465925429`, the step took 3 seconds and printed `1.4.4`.
npm warned that the `bun` postinstall script is not yet in `allowScripts`; the binary worked.
If a later npm stops that script, `bun --version` fails in the same step.

No test or source guard reads these workflow steps.
`pnpm test:scripts` passed (53 tests).

No step of the frontend job calls Bun.
The public docs build is `vitepress build`, and no install script in `seams-wallet` calls Bun.
Only `packages/wallet/scripts/build/build-prod.sh` in `seams-wallet` uses Bun, and the frontend job does not run it.
The step is a candidate for deletion.

## Staging verification

The comparison covers every `.js` file under `dist/public/sdk` of the npm `@seams/wallet@0.54.0` tarball, including subfolders.
Each file's sha256 is compared with `https://<host>/sdk/<path>`.

| Live Wallet host | Before the deployment (09:10 UTC) | After the deployment (09:15 UTC) |
| --- | --- | --- |
| `staging.sign.seams.sh` | 19 of 171 | 171 of 171 |
| `staging.wallet.seams.sh` | 19 of 171 | 171 of 171 |

`staging.sign.seams.sh/wallet-assets.manifest.json` reports package version `0.54.0`.

The first check without a query string at 09:11 UTC found stale edge copies in the Tokyo colo.
`staging.sign.seams.sh` matched 19 of 171 and `staging.wallet.seams.sh` matched 165 of 171.
My baseline requests at 09:10:31 UTC put those copies in the cache.
The last Pages upload of the run ended at 09:10:43 UTC, after the baseline.
The cached copies were the 0.53.0 entry files and, on the sign host, the HTML fallback for new chunk names.
With a unique query string, both hosts matched 171 of 171 at 09:13 UTC.

The SDK `_headers` sets `Cache-Control: public, max-age=300, must-revalidate` on `/sdk/*`, and the origin applies it.
Cloudflare changes the value that browsers receive to `max-age=14400`, which is probably the zone browser cache setting.
A browser that loaded an unversioned SDK entry file before a deployment can keep it for up to 4 hours.
That is a risk for every deployment, not only this one.

The edge copies lived for the origin's 300 seconds.
At 09:15:46 UTC, without a query string, both hosts matched 171 of 171 again.

Docs:

- The staging docs preview `dev.seams-wallet-docs.pages.dev` serves a receipt with revision `84939011de1915bdf08723b5ef5d1e82146c383a`.
- `staging.wallet.seams.sh/docs/seams-wallet-docs-artifact.json` redirects to `docs.wallet.seams.sh`, the production docs host.
- That receipt still names `264c885a9`, the 0.53.0 release commit. The production frontend deploys it from `main`.

Recovery trust:

- Staging control plane `router-ab-tenant-root-control-plane-staging` serves version `13e0eb09-4a6c-48df-9042-d8ebf79bd8fc`, deployed at 08:46 UTC by run `42464150380`.
- Both trust bindings are `plain_text` and equal `~/.seams/recovery-trust-2026-10/bundle.json` and `snapshot.json`.
- The snapshot remains version 1 with zero revocation entries. This rollout did not change recovery trust.

## Left for production

- Private `main` needs the 0.54.0 pins (`efebc003`) and the workflow fix (`de647fd0`).
  Without the fix, the production frontend fails at `Setup Bun` while the GitHub download returns 504.
- Then run `deploy-live-demo.yml` and `deploy-production-mainnet-backend.yml` on `main`.
- After them, check `test.sign.seams.sh`, `sign.seams.sh` and `wallet.seams.sh`, and the receipt on `docs.wallet.seams.sh` (expected `84939011d`).

Not tested: a live registration or signature on staging after the frontend deployment, and branded browsers.
