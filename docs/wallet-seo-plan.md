# Wallet SEO implementation plan

Status: initial focused changes implemented; broader work deferred. Date: October 26, 2026. Scope: `seams-monorepo`.

October 26 implementation: clearer English and Japanese homepage titles, generated
robots.txt and 404.html, showcase exclusions, and deployment-specific indexing headers.
Staging and Console responses receive noindex. Production marketing remains indexable.
The assembled robots file includes the docs sitemap when that artifact contains it.
Cloudflare Pages uses the top-level 404.html to disable its implicit SPA fallback.
Deployed HTTP behavior still requires verification.

Validation: all 53 existing script checks passed. Build and typecheck could not complete
because the demo imports external-near exports absent from the installed Wallet package.
No production deployment or live acceptance run occurred.
Build rendering, new landing pages, analytics, and performance refactors remain deferred
under the request to keep this pass small.

Make Wallet marketing pages readable in the first HTML response. Then improve search coverage for developers evaluating embedded wallets.
Keep the existing Vite, React, translation, and deployment paths.

The assumed audience is developers and product teams choosing a Wallet SDK.
The primary outcome is qualified visits that lead to documentation, Console sign-up, and product activation.
Search volume, current rankings, and conversion baselines remain unknown.

**1. Current evidence and ownership**

| Finding | Source | Consequence |
| --- | --- | --- |
| The build emits six marketing pages: home, pricing, and features in English and Japanese. | `apps/wallet-console/vite.config.ts` | Extend this build path. |
| Titles, descriptions, canonical URLs, language alternatives, and a sitemap already exist. | The same Vite configuration | Preserve these features and check their deployed output. |
| The HTML entry has an empty root. React renders the page after loading JavaScript. | `apps/wallet-console/index.html`, `src/app/main.tsx` | Render public page content during the build. |
| Routing and translation modules read browser globals at import time. | `src/marketing/WalletMarketingRoute.tsx`, `src/marketing/i18n/browser.ts` | Pass page and locale into the render tree before adding build rendering. |
| Unknown paths resolve to the home page in the marketing parser. | `src/marketing/i18n/locale.ts` | Add an explicit unknown-route result and check real HTTP 404 behavior. |
| The English homepage title is only “Seams Wallet.” | `src/marketing/i18n/catalog.ts` | Describe the product category in the title. |
| The deployment script explicitly adds staging `noindex` only under `/docs/*`. | `scripts/deploy-surface.mjs` | Check all surface headers and apply a complete staging policy. |
| Public documentation comes from an exact `seams-wallet` revision. | `docs/README.md`, `scripts/deploy-surface.mjs` | Preserve that ownership and artifact publication path. |
| Marketing and both Console builds share a public asset directory. | `apps/wallet-console/vite.console.config.ts` | Generate crawl rules per deployment surface. |

Source paths beginning with `src/` in this table are relative to `apps/wallet-console`.

Live checks of the homepage, pricing, features, robots file, sitemap, docs, and an unknown path returned HTTP 403 from this environment.
This does not establish that Googlebot receives HTTP 403.
Production response bodies, crawl rules, indexing, and performance remain unverified.
Confirm them through Search Console and an accessible deployed endpoint before release.

**2. P0: Establish the baseline and URL policy**

Use `https://wallet.seams.sh/` as the marketing origin, consistent with deployment configuration.
Keep public documentation under `/docs/` and Console applications on their configured origins.
A canonical URL identifies the preferred address for a page.

- Record response status, redirects, content type, canonical URL, indexing headers, title, and heading for each public route.
- Check the company site's Wallet and pricing redirects, including existing language routes.
- Use permanent redirects for confirmed permanent marketing moves. Preserve authentication redirects and their security behavior.
- Confirm Search Console ownership. Export available query, page, country, device, and indexing data for the previous 28 days.
- Separate branded queries from category queries. Keep English and Japanese results separate.
- Check access restrictions with the operator if production remains inaccessible. Do not infer a crawler block from this environment's failure.

Acceptance: record the accessible production baseline and unresolved access limits before claiming a live SEO defect.
Missing Search Console access does not block local implementation.

**3. P0: Render marketing content during the build**

Build rendering produces page HTML before a visitor requests it.
React hydration attaches interactions to that existing HTML in the browser.
Google recommends server rendering or prerendering because some crawlers cannot run JavaScript.
See [Google's JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

Implementation targets:

- Extend `apps/wallet-console/vite.config.ts` and its existing page enumeration.
- Add one marketing render entry using the existing React server-rendering API.
- Update `src/app/main.tsx`, `src/app/App.tsx`, and `src/marketing/WalletMarketingRoute.tsx` for hydration.
- Refactor `src/marketing/i18n/browser.ts` and page translation access to receive an explicit locale.
- Adapt the existing wallet, pricing, and features components for build rendering.

Implementation rules:

- Parse the URL once at the application boundary. Pass a required page and locale through the marketing render tree.
- Represent known and unknown routes with distinct union branches. Use exhaustive switches.
- Reuse the current page and locale types. Keep route generation, metadata, and sitemap enumeration consistent without a second route manifest.
- Render headings, product explanations, pricing summaries, navigation, footer links, and calls to action in HTML.
- Render the same content for visitors and crawlers. Remove the replaced empty-shell path for these public pages.
- Keep wallet operations, browser storage, network discovery, and signing initialization outside build rendering.
- Isolate interactive demos and showcases behind stable placeholders. Load them after hydration or user interaction.
- Give the build renderer and initial browser render identical content. Reserve dimensions for interactive areas to prevent layout movement.
- Keep visible product text outside demo iframes so visitors can read it when a demo fails.

Acceptance: all six existing pages contain their main text and working navigation with JavaScript disabled.
With JavaScript enabled, language switching, pricing interactions, contact controls, and demos still work without hydration errors.

**4. P0: Complete crawl rules and HTTP behavior**

Extend `scripts/deploy-surface.mjs` at the existing artifact assembly boundary.
Apply rules after composing marketing, docs, and SDK artifacts so later copies cannot overwrite them.

- Generate a production `robots.txt` that permits public marketing and docs resources.
- Include the marketing sitemap and the actual sitemap emitted by the docs artifact. Inspect its location before writing the reference.
- Keep `/sitemap.xml` as the existing marketing sitemap. A new sitemap hierarchy is unnecessary for this page count.
- Include only canonical, indexable pages that return HTTP 200. Add modification dates only when they reflect content changes.
- Apply `noindex` to staging HTML, preview deployments, Console HTML, wallet-service HTML, and standalone showcases.
- Check host-specific preview behavior with the existing hosting configuration. Reuse existing deployment target state.
- Keep production marketing and docs indexable. Avoid a shared header file that accidentally excludes them.
- Preserve access controls for private data. Indexing directives do not provide authorization.
- Emit a useful `404.html` and serve unknown public routes with HTTP 404.
- Preserve `/docs/`, SDK asset paths, and documented Console redirects when changing fallback routing.
- Normalize known slash variants with one permanent redirect. Remove query parameters from canonical URLs while preserving navigation behavior.

Allow crawlers to retrieve pages that must expose `noindex`.
A robots disallow rule can prevent the crawler from seeing that directive.
See [Google's indexing exclusion guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

Acceptance: verify statuses and headers through deployment-equivalent serving and staging.
A Vite preview alone cannot prove hosting redirect or header behavior.
Confirm production responses again after publication.

**5. P1: Improve the existing pages before adding more URLs**

| Page | Search intent hypothesis | Content change |
| --- | --- | --- |
| `/` | Embedded wallet SDK, passkey wallet SDK | Explain the audience, integration model, supported capabilities, and next step. |
| `/features/` | Wallet authentication, recovery, self-hosting | Explain each capability, its limits, and its documentation link. |
| `/pricing/` | Embedded wallet pricing | Explain plans, usage units, included limits, and billing conditions with visible text. |
| Japanese equivalents | Corresponding Japanese developer searches | Use natural Japanese terminology and independently reviewed copy. |

These phrases are hypotheses. Validate them with search results and Search Console data before committing to new pages.
Assign one primary purpose to each URL to reduce overlapping content.

- Update the existing catalogs and page components. Keep English and Japanese fields required.
- Proposed English homepage title: “Embedded Wallet SDK with Passkeys | Seams.” Validate this against released capabilities.
- Give each page a useful description, one clear main heading, and descriptive links to the next step.
- Preserve self-referencing canonical URLs for each language.
- Keep reciprocal `hreflang` links, which identify equivalent language versions, and the existing English default.
- Add shared social preview images and image metadata to the existing head generation.
- Add minimal JSON-LD, a machine-readable description of the organization and page, using facts visible on the site.
- Keep organization identity consistent with the company site. Add breadcrumbs only where a visible page hierarchy exists.
- Avoid unverified ratings, customer counts, certifications, performance promises, or pricing claims.

Language alternatives must identify equivalent pages in both directions.
See [Google's localized-page guidance](https://developers.google.com/search/docs/specialty/international/localized-versions).
Structured data can help describe content, but it does not guarantee enhanced search results.
See [Google's structured-data guidance](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data).

**6. P1: Add a small set of useful landing pages**

After the existing pages pass acceptance, evaluate these proposed routes in order:

1. `/passkey-wallets/`: explain passkey access, device linking, recovery, and implementation limits.
2. `/self-hosted-wallets/`: explain deployment ownership, operating requirements, and the hosted service comparison.
3. `/wallet-security/`: explain custody, signing responsibilities, recovery assumptions, and links to public technical evidence.

Add only pages supported by distinct visitor questions and enough original material.
Use the existing React components, catalogs, and route types.
Publish Japanese equivalents only after reviewing the full translation.
Connect each page to the homepage or features page, the relevant public guide, and an existing conversion path.

Verify all security claims against the released Wallet behavior and public documentation.
Use the repository's custody vocabulary consistently.
Publish only public evidence. Internal plans and private audit notes are not public proof.

Public tutorials and SDK references remain in `seams-wallet/apps/docs`.
Handle documentation additions as a separate change in that repository, then consume its exact artifact here.
Do not copy SDK guides into this repository or edit generated docs.
Defer competitor comparisons until their claims can be sourced and maintained.

**7. P1: Reduce the cost of the public page**

Measure mobile loading before choosing optimizations.
Inspect the marketing entry's dashboard styles, toast dependencies, Wallet styles, font weights, and showcase modules.
Remove unnecessary imports and defer expensive demo code where measurements justify it.
Keep primary text and navigation available independently of the live wallet service.

Reserve image and iframe dimensions. Load below-the-fold media lazily.
Keep essential above-the-fold content available immediately.
Preserve keyboard behavior, reduced-motion support, and the existing visual design.

Use these field targets at the 75th percentile when enough real-user data exists:

- Largest Contentful Paint, the main content loading metric: at most 2.5 seconds.
- Interaction to Next Paint, the response-time metric: at most 200 milliseconds.
- Cumulative Layout Shift, the visual stability metric: at most 0.1.

Use repeatable mobile lab runs during development. Report field results separately when available.
See [Google's Core Web Vitals guidance](https://developers.google.com/search/docs/appearance/core-web-vitals).

**8. Acceptance scenario and repeatable evidence**

Add `tests/e2e/wallet-marketing-seo.e2e.mjs` using the existing standalone Playwright E2E pattern.
Reuse relevant behavior from `site-documentation-links.e2e.mjs` and `wallet-marketing-unavailable.e2e.mjs`.
Add no unit tests or source-text guards.

Exercise this scenario against the assembled artifact and then staging:

1. Fetch all six marketing URLs and inspect the original response HTML.
2. Open the Japanese pricing page with JavaScript disabled. Read its plan summary and follow its English language link.
3. Check each page's canonical URL, language alternatives, title, description, crawl directives, and sitemap entry.
4. Follow a documentation link and verify the docs artifact revision against the selected public commit.
5. Enable JavaScript and simulate failed wallet discovery. Confirm that public content, navigation, and pricing remain usable.
6. Exercise a pricing control and language switching on desktop and mobile. Check for hydration errors and horizontal overflow.
7. Check a slash redirect, a query-bearing URL, and an unknown URL. Verify the expected HTTP response and canonical destination.
8. Check staging exclusions and production-intended artifact rules separately. Confirm that docs and SDK asset routes still resolve.

Write evidence under `output/playwright/wallet-marketing-seo/`.
Include `result.json`, fetched HTML, relevant response headers, screenshots, and `trace.zip`.
Record the command, application commit, docs revision, tested origin, and route outcomes.
Write failure evidence before closing the browser.
The result must distinguish artifact checks, staging checks, and production checks.

Run the narrow checks for the files changed:

```sh
pnpm -C apps/wallet-console typecheck
pnpm -C apps/wallet-console build:marketing
pnpm -C tests exec node e2e/wallet-marketing-seo.e2e.mjs
```

The proposed E2E command requires the implemented runner and a configured artifact server or deployed target.
Document its required origin settings when adding it.
Run `pnpm test:scripts` after deployment script or workflow changes.
Run company typecheck and build if company pages change.
Extend the existing frontend smoke checks and workflows to retain the E2E artifact.
Classify existing failures under `AGENTS.md` before changing code to repair them.

**9. Delivery order and measurement**

| Change set | Deliverable | Completion gate |
| --- | --- | --- |
| A | Baseline and build-rendered existing pages | Useful HTML without JavaScript; interactions survive hydration. |
| B | Crawl rules, HTTP statuses, and deployment checks | Artifact and staging evidence proves route behavior and indexing policy. |
| C | Metadata, copy, links, and measured performance fixes | Both languages pass the public-page E2E scenario. |
| D | Validated landing pages | Each page answers a distinct question and links to public evidence. |
| E | Production inspection and outcome review | Record actual indexing and search performance after publication. |

Keep implementation commits on `dev`. Use the existing staging and production publication process.
Retain the previous frontend artifact and exact docs revision for rollback.
Treat Search Console verification, sitemap submission, and production publication as explicit operator steps in the release checklist.

Measure indexing coverage, non-branded impressions, clicks, click-through rate, and landing pages by language.
Compare equal 28-day periods after publication. Account for indexing delay and sparse traffic.
Set growth targets after the baseline exists. Do not promise rankings or a fixed indexing date.

Coordinate sign-up and activation measurement with `docs/feat-6-pricing-conversion-funnel.md`.
That plan records incomplete measurement work and a decision against company-site click tracking.
Keep this SEO work independent of a new analytics provider or database schema.
Use available Console outcomes, and state when organic attribution is unavailable.
Cross-origin attribution requires a separate bounded design if the existing funnel cannot support it.

Implementation is complete when the intended public pages pass deployed acceptance and the measurement baseline is recorded.
Search growth remains an outcome to assess after release.
