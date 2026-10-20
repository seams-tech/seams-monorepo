# Documentation refresh verification — October 20, 2026

The public documentation source is committed as
`1aef907786031bb5043d581ccb47382507c9ae1b` on `seams-wallet/dev`.
The private documentation, links, preview path, and staging headers belong to
the containing `seams-monorepo/dev` commit.

## Release baseline

The npm check returned Wallet and Wallet Server **0.15.4**, with CLI **0.15.0**.
Both SDK publications identify source revision
`77abcda17789eb9ecfd00f927d71b17fb8a4d8f0`. Their iframe protocol is **16.0.0**.
Prepared 0.15.5 UI changes remain explicitly separate from the published baseline.

## Results

| Check                                                                           | Result                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Public documentation type check                                                 | Passed                                                       |
| Fourteen compiled examples against installed npm 0.15.4, without source aliases | Passed with strict TypeScript checking                       |
| Internal Markdown links and fragments                                           | Passed                                                       |
| Raw code-fence classification                                                   | Passed; runnable snippets use two new compiled example files |
| VitePress production build                                                      | Passed; 82 HTML pages                                        |
| Built `/docs/` links and assets                                                 | All referenced local paths resolve                           |
| Sitemap                                                                         | 81 production URLs under `/docs/`; excludes 404              |
| Public bloat ratchet                                                            | Passed without changing its baseline                         |
| Private `pnpm check`                                                            | Passed, including 53 deployment-script checks                |
| Private `pnpm build`                                                            | Passed for backends and both applications                    |
| Combined staging Wallet-site build                                              | Passed with the exact public source receipt                  |
| Staging Pages headers                                                           | `/docs/*` requests `noindex, nofollow`                       |
| Published CLI version command                                                   | Returned `seams-wallet 0.15.0`                               |
| Existing protocol-cutover lifecycle E2E                                         | Passed in 35.4 seconds                                       |

The lifecycle E2E checks unsupported protocol rejection before parsing,
an upgrade message, reload, registration, discarded setup-response replay,
concurrent setup replay, completion durability, and verified Tempo/Arc signatures.
Its generated `wallet-protocol-cutover.json` is retained without alteration.

Browser inspection covered desktop, a 390×844 viewport, dark mode, mobile
navigation, release/server pages, search, page copying, and a rendered architecture
diagram. Search for `authorization renewal` returns the new 0.15.1 section.
Page width equals viewport width at 390 and 1440 pixels. The copy control reports
`Copied`. The architecture page renders one Mermaid SVG and leaves no raw diagram.

## Reproduction

In `seams-wallet`:

```sh
pnpm -C apps/docs type-check
pnpm -C apps/docs check:links
node apps/docs/scripts/check-code-fences.mjs
pnpm -C apps/docs build
pnpm report:bloat --check
npx --yes @seams/wallet-cli@0.15.0 version
```

The lifecycle check uses existing prebuilt Workers and the private checkout's
installed published browser SDK. Choose free ports and a fresh runtime directory:

```sh
SEAMS_INTENDED_SKIP_BUILD=1 \
SEAMS_INTENDED_WALLET_DIST_ROOT=/absolute/path/to/seams-monorepo/node_modules/@seams/wallet/dist \
SEAMS_INTENDED_APP_URL=http://localhost:7081 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:7082 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:6980 \
SEAMS_LOCAL_PORT_OFFSET=2880 \
SEAMS_INTENDED_ROUTER_AB_ROOT=$(mktemp -d /tmp/seams-docs-check.XXXXXX) \
pnpm -C tests exec playwright test -c playwright.wallet-intended.ci.config.ts \
  e2e/intended-behaviours/passkey.registration.contract.test.ts \
  --grep 'wallet protocol rejection' --reporter=line
```

In `seams-monorepo`, use the [staging build procedure](../README.md#build-preview-and-publish-public-documentation), then run:

```sh
pnpm check
pnpm build
pnpm exec tsc --noEmit -p .artifacts/docs-refresh/published-consumer/tsconfig.json
```

The isolated consumer contains copies of all 14 documentation example source
files and resolves the private checkout's installed npm packages. It has no
workspace `paths` aliases and enables strict checking with `skipLibCheck: false`.

## Retained artifacts and limits

Private `.artifacts/docs-refresh/` contains the combined staging site, previous
public-docs artifact, isolated consumer, screenshots, lifecycle proof, and check
logs. The staged public artifact is `.artifacts/wallet-docs`; its receipt matches
the public source SHA above. The combined site is frozen separately so later
application builds cannot invalidate its browser evidence.

An initial lifecycle attempt encountered an occupied port. A second attempt
encountered changing local SDK build output. Both were infrastructure failures.
The passing run used separate ports and the installed published distribution.
No production behavior or stale fixture was changed to accommodate those failures.

The sitemap, footer, breadcrumb, favicon, and local preview path defects were
documentation-site regressions and were corrected in the owning source.

This change builds and verifies local publication artifacts. It does not deploy
services or publish npm packages. Earlier direct requests to the live docs
returned HTTP 403, so live content identity remains unverified. Staging and
production publication must use the existing workflows and verify the exact
source receipt after deployment.
