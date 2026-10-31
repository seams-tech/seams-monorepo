# Wallet marketing SEO acceptance — October 31, 2026

The six public marketing pages serve useful HTML before JavaScript runs. Staging and production pass the same browser acceptance scenario.

Implementation: `ce2e5e2576d9c62a84d718fa4f91dda097992041`, committed on `dev` and promoted to production `main`.
Public Wallet packages: `0.35.0`. Both deployed reports identify public docs revision `fafbd28d79102cdb996f6c89f226363fbd7efc0f`.
Both workflow reports record a clean source checkout and zero browser/hydration errors.
Concurrent billing and pricing-funnel changes were excluded from this release.

## Deployments

| Surface                    | Run                                                                                  | Result                                               |
| -------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Staging marketing          | [41192684727](https://github.com/seams-tech/seams-monorepo/actions/runs/41192684727) | Build, publish, smoke, and browser acceptance passed |
| Production marketing       | [41192873176](https://github.com/seams-tech/seams-monorepo/actions/runs/41192873176) | Build, publish, smoke, and browser acceptance passed |
| Staging Wallet settings    | [41192874944](https://github.com/seams-tech/seams-monorepo/actions/runs/41192874944) | Build, publish, and smoke passed                     |
| Production Wallet settings | [41193042136](https://github.com/seams-tech/seams-monorepo/actions/runs/41193042136) | Build, publish, and smoke passed                     |

The frontend workflows retain their browser evidence for one day. Downloaded copies remain under `output/playwright/wallet-marketing-seo/hosted-staging-run/` and `hosted-production-run/`.
Each report has response headers, source/docs revisions, screenshot files, and Playwright traces.

Report SHA-256 values:

- `hosted-staging-run/staging/result.json`: `5ba35240daeb226a35abc1185c0772ba0ae5d27359041fa21cbe06f5b57be74f`
- `hosted-production-run/production/result.json`: `e4e81dbfdbba5109e604cfdd2e3e4c9f31c1c8a466835ddbca7fe7a1d2cf42a6`

## Observed behavior

The scenario checks `/`, `/pricing/`, and `/features/`, plus their `/ja/` equivalents.
All six contain headings, product text, prices where applicable, navigation, canonical URLs, reciprocal language links, and structured data in the original response.
Japanese pricing and its English language link work with JavaScript disabled.

With JavaScript enabled, the calculator, contact dialog, and language selector work after hydration.
The 390-pixel pages and 320-pixel Japanese pricing page have no horizontal overflow.
Failed Wallet discovery produces the demo's unavailable state while public content and navigation remain usable.

Marketing and docs sitemaps, the public docs receipt, a real SDK worker asset, and the social preview resolve.
Known slash variants redirect permanently. Query strings do not enter canonical URLs. Unknown public URLs return HTTP 404.

Independent post-publication requests recorded these HTTP 200 responses in `published-surfaces.json`:

| Surface                                                                       | `X-Robots-Tag`         |
| ----------------------------------------------------------------------------- | ---------------------- |
| `wallet.seams.sh/` and `/docs/`                                               | No `noindex` directive |
| `staging.wallet.seams.sh/`                                                    | `noindex`              |
| `sign.seams.sh/`, `test.sign.seams.sh/`, `staging.sign.seams.sh/`             | `noindex`              |
| `console.wallet.seams.sh/dashboard/login`, `console.seams.sh/dashboard/login` | `noindex`              |
| `wallet.seams.sh/showcase/account/`                                           | `noindex`              |

Pages default-host and preview-host exclusions are emitted through Cloudflare's documented `_headers` patterns. This record contains no independent live preview-host request.

## Repeat the deployed acceptance

For production:

```sh
SEAMS_SEO_TARGET=production \
SEAMS_WALLET_SITE_ORIGIN=https://wallet.seams.sh \
SEAMS_WALLET_DOCS_REVISION=fafbd28d79102cdb996f6c89f226363fbd7efc0f \
pnpm -C tests exec node e2e/wallet-marketing-seo.e2e.mjs
```

For staging, use `SEAMS_SEO_TARGET=staging` and `https://staging.wallet.seams.sh`.
After a later docs release, use the exact revision selected by that deployment.
The runner verifies the served receipt against the requested revision.

Local artifact checks use Wrangler Pages serving, `artifact-staging` or `artifact-production`, the local origin, and `SEAMS_WALLET_CANONICAL_ORIGIN` for the built origin.
The successful local staging artifact used an older, explicitly identified public docs fixture. It proves artifact routing and does not qualify that fixture for publication.
A separate local production-artifact attempt timed out reading its sitemap, including after a local-server restart. It remains an `environment_or_infrastructure_failure` with an unresolved local cause. No application code was changed to repair it. Deployed production acceptance passed independently.

## Performance and search limits

`mobile-lab.json` records three cold pricing-page contexts per origin, a 390 × 844 viewport, 4× CPU slowdown, 150 ms latency, and 200,000 bytes/s downloads.
The sample occurs five seconds after the heading appears. Reduced motion is enabled.

| Observation                      | Production before publication | Local candidate     |
| -------------------------------- | ----------------------------- | ------------------- |
| Largest Contentful Paint samples | 2,880 / 2,448 / 2,460 ms      | 984 / 952 / 952 ms  |
| Resource transfer bytes          | 359,669 each                  | 305,118 each        |
| Cumulative Layout Shift          | About 0.000021 each           | About 0.000005 each |

Local and hosted transport differ. These are bounded lab observations, with no causal speed claim, field percentile, or Interaction to Next Paint result.

Search Console was not configured at the start of this work, as confirmed by the user.
Property verification and sitemap submission await the user's separate approval. Indexing coverage, search queries, organic attribution, and 28-day comparisons remain unavailable.
The proposed landing pages remain gated on distinct demand and original content. Existing features link to the relevant public guides.
