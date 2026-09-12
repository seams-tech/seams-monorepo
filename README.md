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

Use `console:deploy:env-*` for Console inputs and
`wallet-system:deploy:env-*` for Wallet runtime inputs. Review the matching
deployment instructions before applying secrets or deploying.

## R105 release handoff

The current working tree targets Wallet packages `0.5.0`. Their first npm
publication and the final registry lockfile remain blocked on npm access.
Private application builds were verified with locally packed public artifacts.
CI/test ownership changes also await approval; this working tree is not yet
ready for a clean registry install, full test run, commit, or deployment.
See [R105B](docs/refactor-105B-github-split.md) for the exact remaining work.

Domain and shared wallet-site publication changes are coordinated separately
under [R123](docs/refactor-123-domains.md).
