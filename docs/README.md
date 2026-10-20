# Documentation and operator index

Baseline checked October 20, 2026: browser SDK and Wallet Server **0.15.4**,
CLI **0.15.0**, and wallet iframe protocol **16.0.0**. The public source also
contains prepared 0.15.5 UI changes. Check npm and deployed identity separately.

## Ownership and authority

| Material                                                        | Owner                                            | Use                                                              |
| --------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| Public installation, guides, examples, reference, release notes | `seams-wallet/apps/docs`                         | Current published integration contract                           |
| Wallet specifications and intended behavior                     | `seams-wallet/docs`                              | Architecture and lifecycle authority                             |
| Public package exports and contracts                            | Exact published package revision                 | Supported API and wire shapes                                    |
| Console behavior and deployment procedures                      | This repository                                  | Private composition and product operations                       |
| Deployment targets and values                                   | `deployment/console`, `deployment/wallet-system` | Environment and service assignments                              |
| Dated evidence                                                  | Each repository's `docs/evidence`                | Measurements scoped to their time and environment                |
| Proposals, refactor plans, archived documents                   | Their owning repository                          | Historical decisions or proposed work; confirm status before use |

Use [public release notes](https://wallet.seams.sh/docs/releases) for current
versions. Update each owning source page and link to it. Public Wallet
implementation and reference pages remain in `seams-wallet`.

## Console procedures

- [Onboarding](wallet-saas/console-docs/wallet-console-onboarding.md): organization,
  project, and Development environment creation. Activation remains separate.
- [API keys](wallet-saas/console-docs/api-keys.md): environment credentials and origins.
- [Bring your own authentication](wallet-saas/console-docs/byo-auth.md).
- [Account settings](wallet-saas/console-docs/account-settings.md).
- [Billing](wallet-saas/console-docs/wallet-billing.md).
- [Wallet database schema](wallet-saas/console-docs/wallet-db-schema.md).
- [CLI release procedure](wallet-cli-release.md).
- [Local/provider runtime qualification](../deployment/celld/README.md): retain
  its qualification limits when describing private infrastructure.

## Current hosted evidence

[The 0.15.4 comparison](evidence/registration-0154-staging-production-20261020.json)
measures resolved passkey proof to wallet readiness. Both environments use
published SDK packages, a local HTTPS parent, remote wallet iframe and Gateway,
and independently verified signatures. Each has three warm-ups and 15 baseline samples.

| Environment        | Baseline median | Warm-up handling                               |
| ------------------ | --------------: | ---------------------------------------------- |
| Staging testnet    |        2,052 ms | Three samples retained separately              |
| Production mainnet |        2,141 ms | Three retained separately; first took 6,769 ms |

These sequential cohorts use different tenant and network configuration. Their
89 ms difference does not establish an environment regression. All 15 production
baseline samples finished within 2,500 ms. That result is not a latency guarantee.
Historical 0.13 measurements used a different iframe topology and cannot isolate
an SDK version effect.

[Placement evidence](evidence/production-placement-20261020.json) shows why settings
cannot prove co-location. Inspect actual object hosts and database primaries.
APAC now requests `apac-se`. Existing addresses do not move when the hint changes.
Preserve dated JSON evidence as recorded.

## Build, preview, and publish public documentation

1. In `seams-wallet`, run the checks in `apps/docs/README.md`. Commit the source
   and record its full Git SHA.
2. Stage that exact built revision into an empty output directory:

   ```sh
   node scripts/prepare-wallet-docs-source.mjs \
     --checkout /absolute/path/to/seams-wallet \
     --revision <full-committed-sha> \
     --output .artifacts/wallet-docs
   pnpm docs:preview
   ```

3. Build the Wallet marketing surface:

   Supply the lane's public NEAR network, RPC, explorer, and session-persistence
   variables. For a local staging-artifact check:

   ```sh
   VITE_NEAR_NETWORK=testnet \
   VITE_NEAR_RPC_URL=https://rpc.testnet.near.org \
   VITE_NEAR_EXPLORER=https://testnet.nearblocks.io \
   VITE_SIGNING_SESSION_PERSISTENCE_MODE=sealed_refresh_v1 \
   pnpm deploy:frontend build --site staging --component wallet-site
   ```

4. Publish with the existing staging frontend workflow, `surface=wallet-site`,
   and the full `wallet_revision`. Use the production frontend workflow from
   its permitted production branch after staging verification.
5. Read `/docs/seams-wallet-docs-artifact.json` from both deployed sites. Compare
   its revision with the intended public SHA. Check installation, releases,
   server reference, search, deep links, and assets.

Production canonical and sitemap URLs use `https://wallet.seams.sh/docs`.
Staging documentation requests `noindex` through Pages headers. Console and
marketing links use the configured docs origin. A 403 leaves live verification
incomplete. A successful build does not establish what a deployed site serves.

Retain the previous exact docs artifact and source revision before publication.
Documentation rollback restores that artifact. It does not roll back Wallet
packages, database schemas, or custody Workers.

## Release checklist

- Check npm, source, hosted assets, backend roles, and CLI independently.
- Update public install instructions, examples, release notes, and affected references.
- Reconcile private operator guidance and website capability claims.
- Run example compilation, links, builds, and a substantial browser journey.
  Retain screenshots, proof results, versions, and repeatable commands.
- Run `pnpm test:scripts` after changing deployment scripts or workflows.
- Verify the deployed docs receipt and environment-specific routing.
- Keep completed changes committed on `dev` in both owning repositories.
