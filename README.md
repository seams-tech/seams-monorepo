# Seams monorepo

Private Seams applications, Console management, and deployments. Wallet SDK,
Rust/WASM, CLI, runtime builds, and public documentation are owned by
[seams-wallet](https://github.com/seams-tech/seams-wallet).

## Applications and packages

- `apps/wallet-console`: Wallet Console frontend and product composition.
- `apps/seams-site`: company/product discovery site and current local Caddy setup.
- `packages/console-{server,shared}-ts`: product-neutral Console core.
- `packages/wallet-console-{server,shared}-ts`: private Wallet integration.
- `deployment/console`: Console deployment inputs.
- `deployment/wallet-system`: separately scoped Wallet-system deployment inputs.
- `scripts/local-wallet`: local Console/gateway composition using packaged Wallet assets.
- `tests`: Console and composed operating tests; remaining Wallet-only test transfer is pending.

The original `seams-sdk` repository is the historical archive. This repository
has fresh history and imports exact Wallet release versions.

## Development

`pnpm build` builds the private backends and applications. `pnpm type-check`
checks private production code. Wallet dependencies supply the static iframe,
WASM, prebuilt Workers, native local initializer, and signer migrations; no
Cargo toolchain or sibling source checkout is used here.

`pnpm site` starts the local frontends and previews the downloaded public docs
artifact at `.artifacts/wallet-docs`. `pnpm router` starts local Wallet Workers
and the private gateway. Local Console configuration must identify an
organization, project, and environment created through Console. Keep
human-edited local values in ignored `.env.local`; generated Wallet role files
belong to the local runtime and should not be edited manually.

Run both commands from this repository root in separate terminals. The Wallet
page is `http://localhost:4001/wallet`; Console is
`http://localhost:4001/dashboard`. For an existing Console environment, set
`SEAMS_LOCAL_CONSOLE_ORG_ID`, `SEAMS_LOCAL_CONSOLE_PROJECT_ID`, and
`SEAMS_LOCAL_CONSOLE_ENVIRONMENT_ID` in `.env.local`. Set
`SEAMS_LOCAL_CONSOLE_PUBLISHABLE_KEY` to that environment's publishable key to
reuse it locally. Its allowed origins must include `http://localhost:4001` and
`https://localhost:4002` (the hosted Wallet iframe). New publishable-key forms
prefill the application and hosted Wallet origins. Restart `pnpm router` after
changing `.env.local`.

Use `console:deploy:env-*` for Console inputs and
`wallet-system:deploy:env-*` for Wallet runtime inputs.
See the [full-stack deployment guide](docs/github-actions-storage.md#full-stack-deployment)
for one-command deployment, automatic activation, frontend scope, and health checks.

## Documentation and release baseline

Wallet, Wallet Server, and VoiceID use **0.34.0**.
The signed native recovery CLI **0.29.0** is available on GitHub.
Console uses the **0.29.0** installer.
The wallet iframe protocol is **21.0.0**. Exact SDK pins live in `package.json` and
`pnpm-lock.yaml`. See the public
[release notes](https://github.com/seams-tech/seams-wallet/blob/main/apps/docs/src/releases.md)
for SDK, CLI, and wallet iframe protocol versions.

Version 0.34.0 combines hosted authentication and configured external wallet connections.
Applications choose ordered primary and secondary wallet groups with `walletAlternatives`.
Device linking and recovery support collapsible, expanded, or hidden presentation.
Applications can replace the footer brand with their own logo.
The application SDK and isolated Wallet host must use the same iframe protocol.

Public docs live in `seams-wallet/apps/docs`. This repository publishes their
exact built revision at `https://wallet.seams.sh/docs/` and its staging counterpart.
The receipt is `/docs/seams-wallet-docs-artifact.json` on each Wallet site.
See the [documentation and operator index](docs/README.md) for ownership,
current Console procedures, hosted evidence, validation, and publication.

Build public docs in `seams-wallet`, then stage their committed revision with
`scripts/prepare-wallet-docs-source.mjs`. Never edit `.artifacts/wallet-docs`.
`pnpm docs:preview` serves that artifact without a second documentation source tree.
