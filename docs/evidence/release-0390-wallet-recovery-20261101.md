# SDK 0.39.0 recovery and modal rollout

Date: November 1, 2026 (JST).

Status: published and deployed to staging, production testnet, and production mainnet.

Wallet, Wallet Server, and VoiceID are published as `0.39.0`.
The Wallet iframe protocol remains `22.0.0`, the wallet-management protocol remains `5`, and the signed recovery CLI remains `0.29.0`.
This release adds no database migrations.

Loading wallet surfaces preserve page clicks and typing until visible content is ready.
Owner NEAR recovery runs without a modal or an approval queue reservation.
It uses a fixed 35-second transport deadline and queries current transaction status without waiting for execution.
Unknown outcomes retain the canonical operation ID and known hash without rebroadcast.
This release does not add historical receipt retirement or treat `UNKNOWN_TRANSACTION` as proof of non-submission.

Public package revision: `e9fd3572255460289f7d801820c46e2b8105103d`.
Private deployment revision: `89b5ad8ec0bcca393195202d5d4bd8289a43006f`.
Staging and both production deployments used that exact private revision.
All three npm package records report the public revision as `gitHead`.
Their SHA-512 integrity values match the archives retained by the publication workflow.

| Check | Result | Evidence |
| --- | --- | --- |
| Public Wallet release validation | Passed | [Validation](https://github.com/seams-tech/seams-wallet/actions/runs/41227632085) |
| npm publication | Passed | [Release](https://github.com/seams-tech/seams-wallet/actions/runs/41227674066) |
| Private repository validation | Passed on dev and main | [Dev](https://github.com/seams-tech/seams-monorepo/actions/runs/41234290100), [main](https://github.com/seams-tech/seams-monorepo/actions/runs/41235314358) |
| Staging full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41234318541) |
| Production testnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41235342912) |
| Production mainnet full stack | Passed | [Deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/41235345360) |

The private frozen installation, lint, type checks, boundary checks, and 53 script checks passed against the published packages.
The local SDK package checks, 32 representative browser tests, and 149 existing tests also passed before publication.

| Live Wallet host | SDK | Iframe protocol |
| --- | --- | --- |
| `staging.sign.seams.sh` | `0.39.0` | `22.0.0` |
| `test.sign.seams.sh` | `0.39.0` | `22.0.0` |
| `sign.seams.sh` | `0.39.0` | `22.0.0` |

All 18 independent readiness checks passed across the three lanes.
Two served SDK assets per host matched the published package byte for byte, including the NEAR recovery runtime.
Both documentation sites report the public release revision.
The staging and mainnet recovery trust bundles, signed revocation snapshots, and Console recovery certificates remained byte-for-byte unchanged.
Deployment inputs were checked against the live records before rollout.

Local verification evidence is under `.artifacts/release-0390/`:

- `npm-packages.json` and `package-archives.json` record source revisions and package integrity.
- `public-validation.json`, `publication.json`, and the deployment JSON files retain workflow results.
- `frozen-install.log` and `check.log` retain private consumer validation.
- `recovery-inputs-verified.json` and the lane-specific recovery snapshots retain preservation checks.
- `staging-verification.json` and `final-verification.json` record live versions, asset hashes, documentation revisions, and readiness results.

The release retained the existing package-age policy.
The prior version's existing exception was used only while updating the old lockfile, then removed.
The committed exceptions cover only the three `0.39.0` packages.
