# Seams site development

This private application provides company and product pages. Public Wallet
documentation lives in `seams-wallet/apps/docs`. Local development consumes
published Wallet packages and a built public docs artifact.

## Complete local stack

Run these commands from the private repository root in separate terminals:

```sh
pnpm router
pnpm site
```

`pnpm router` starts packaged Wallet Workers and private Gateway composition.
`pnpm site` starts the frontends, Caddy, and public docs preview. Stage the docs
artifact at `.artifacts/wallet-docs` first. Follow the
[publication procedure](../../docs/README.md#build-preview-and-publish-public-documentation).

| Surface                 | Local URL                               |
| ----------------------- | --------------------------------------- |
| Company entry           | `http://localhost:4001`                 |
| Wallet page             | `http://localhost:4001/wallet`          |
| Wallet Console          | `http://localhost:4001/dashboard`       |
| Documentation preview   | `https://docs.localhost:4003/docs/`     |
| Isolated wallet service | `https://localhost:4002/wallet-service` |
| Gateway                 | `https://localhost:4101`                |

`pnpm -C apps/seams-site vite` runs only this app on port 4004. It does not
start the complete proxy, backend, Console, or documentation stack.

## Wallet assets and documentation

Current private pins are Wallet and Wallet Server 0.15.4. The iframe protocol
is 16.0.0. Caddy serves assets from the installed package. Update exact package
pins and the lockfile when consuming releases. SDK and Rust builds belong in
`seams-wallet`.

The app origin rejects `/sdk/*`, `/wallet-service`, and `/export-viewer` to detect
accidental app-hosted wallet assets. Keep these assets on the wallet origin.

`pnpm docs:preview` serves a static artifact on port 4006. It does not watch
sibling sources. Rebuild, commit, and restage the public docs to preview a new
revision. Never edit the generated copy.

## Production publication

The existing production frontend workflow selects company, Wallet site,
Console, or wallet-host surfaces. `wallet-site` includes public docs built from
the supplied full `wallet_revision`. Its receipt records that revision. Verify
staging before production through the corresponding frontend workflows.

After application changes, run:

```sh
pnpm -C apps/seams-site typecheck
pnpm -C apps/seams-site build
```

Check deep links from marketing and Console with the configured `VITE_DOCS_ORIGIN`.

## Wallet marketing languages

The Wallet marketing app in `apps/wallet-console` serves English at `/` and
Japanese at `/ja/`. The URL selects the language. The navbar and footer selectors preserve
query parameters and section anchors. Local development uses `/wallet` and
`/wallet/ja/` through Caddy.

The local Caddy process watches its configuration and reloads route changes.

Keep translations in `apps/wallet-console/src/marketing/i18n/catalog.ts`. Every
message requires English and Japanese text. Both languages use the same React
components. The Vite build emits language-specific HTML metadata and a sitemap.
Showcase frames receive the language through `?lang=ja`.

Documentation, Console, live SDK dialogs, and the SDK account-menu preview remain
in English. Translate SDK-owned
surfaces in `seams-wallet` and consume an exact release here.

To check a built marketing preview, run:

```sh
pnpm -C apps/wallet-console build:marketing
pnpm -C apps/wallet-console exec vite preview --host 127.0.0.1 --port 4018
# In another terminal:
node tests/e2e/wallet-marketing-i18n.e2e.mjs
```

The E2E scenario writes screenshots, a trace, and `result.json` under
`output/playwright/wallet-marketing-i18n/`.

## Dashboard inline modal scrolling

Keep one scroll host active while an inline modal is open. The backdrop owns
scrolling, and `.dashboard-main` stays scroll-locked. Extend the backdrop beyond
the visible frame to avoid exposing its boundary during elastic overscroll.
