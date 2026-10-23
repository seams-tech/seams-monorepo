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
`wallet-system:deploy:env-*` for Wallet runtime inputs. Review the matching
deployment instructions before applying secrets or deploying.

## Documentation and release baseline

The private applications pin published `@seams/wallet@0.21.0` and
`@seams/wallet-server@0.21.0`. The recovery CLI remains `0.20.0`. The wallet
iframe protocol is `16.0.0`. Recheck publication and deployment before updating pins.

Public docs live in `seams-wallet/apps/docs`. This repository publishes their
exact built revision at `https://wallet.seams.sh/docs/` and its staging counterpart.
The receipt is `/docs/seams-wallet-docs-artifact.json` on each Wallet site.
See the [documentation and operator index](docs/README.md) for ownership,
current Console procedures, hosted evidence, validation, and publication.

Build public docs in `seams-wallet`, then stage their committed revision with
`scripts/prepare-wallet-docs-source.mjs`. Never edit `.artifacts/wallet-docs`.
`pnpm docs:preview` serves that artifact without a second documentation source tree.
