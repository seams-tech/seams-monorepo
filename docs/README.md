# Documentation and operator index

Public SDK guides and release status live in `seams-wallet/apps/docs`.
Wallet contracts live in its numbered specifications and intended behaviors.
This repository owns Console procedures and deployment.

## Deployment

Use the [full-stack deployment guide](github-actions-storage.md#full-stack-deployment)
for staging, production testnet, and production mainnet.
It covers one-command deployment, configuration, frontend scope, automatic tenant activation, health checks, and retries.

## Console procedures

[Console split history](feat-2-platform-console.md) records the completed separation
of Platform and Wallet entry points and the reasons for that design.

- [Onboarding](wallet-saas/console-docs/wallet-console-onboarding.md): organization,
  project, and Development environment creation. Activation remains separate.
- [API keys](wallet-saas/console-docs/api-keys.md): environment credentials and origins.
- [Bring your own authentication](wallet-saas/console-docs/byo-auth.md): private
  Console configuration and links to the public integration guides.
- [Account settings](wallet-saas/console-docs/account-settings.md).
- [Billing](wallet-saas/console-docs/wallet-billing.md).
- [Pricing and costs](wallet-saas/pricing.md): the proposed MAU price with a
  pooled signature allowance, and the measured Cloudflare cost behind it.
- [Free plan card and Growth move](feat-4-free-plan-card-and-growth-move.md):
  the plan for the 30-day card requirement and the warnings before a Growth move.
- [Contact form endpoint](feat-5-contact-form-endpoint.md): the plan to store
  contact inquiries and email them to sales through the Console outbox.
- [Pricing conversion funnel](feat-6-pricing-conversion-funnel.md): the plan for
  the steps after a pricing card click: sign-in, onboarding, card setup, and the
  contact form.
- [Wallet SEO implementation](wallet-seo-plan.md): build rendering, crawl rules,
  search content, deployment checks, and outcome measurement.
- [Wallet database schema](wallet-saas/console-docs/wallet-db-schema.md).
- [PostgreSQL and Hyperdrive preparation](future-plan-wallet-postgresql-preparation.md): a
  potential latency upgrade, remaining storage ports, and required hosted evidence.
- [CLI release procedure](wallet-cli-release.md).
- [Refactor 200 — Cloudflare account migration](refactor-200.md): move all Wallet
  infrastructure into the dedicated Seams account with fresh application state.
- [Local/provider runtime qualification](../deployment/celld/README.md): retain
  its qualification limits when describing private infrastructure.

## Site

- [Ink drawing style](drawing-style.md): how the site's brush drawings look and
  move, the draw-in timing, and the checks for a new drawing.

## Concept plans

- [Refactor 210 — voice intents](refactor-210-voice-intents.md): Speak-to-Sign
  and the spoken multisig with OutLayer. Speak-to-Sign runs on testnet: a TEE
  verifier signs a verdict, and the Wallet pays from the owner's own account
  after it checks the verdict. The shared vault design is retired (2026-11-09).
  The spoken multisig is a plan only.

## Historical feature records

- [BYO authentication](refactor-201-BYO-auth.md): 0.28 and 0.29 implementation and release evidence.
- [VoiceID transaction confirmations](voiceid-transaction-confirmation-plan.md):
  October 2026 experiments, 0.26.0 release evidence, and deferred design.

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

4. Publish Wallet-site and documentation updates through the existing frontend workflows:

   ```sh
   gh workflow run deploy-staging-frontend.yml --ref dev -f lane=staging-testnet
   gh workflow run deploy-production-frontend.yml --ref main -f lane=production-mainnet
   ```

   Select `wallet-docs` to publish documentation. Select `wallet-site` to
   publish Wallet marketing and its redirects. The production `all` deployment
   also updates the legacy docs redirect.
   Full-stack calls still deploy all frontend surfaces.
   Each run checks out public `seams-wallet/main`, verifies its browser SDK version
   matches the site's installed release, and records the exact docs source SHA.
   Documentation corrections can therefore publish between SDK package releases.

5. Read `https://docs.wallet.seams.sh/seams-wallet-docs-artifact.json`. Compare
   its revision with the committed docs source SHA from that run. Check installation,
   releases, server reference, Google SSO, search, deep links, and assets.

Production canonical and sitemap URLs use `https://docs.wallet.seams.sh`.
The `seams-wallet-docs` Pages project serves the root-path docs artifact. Its
`docs.wallet.seams.sh` custom domain is the production host. The Wallet site
redirects `/docs/*` to the production docs host. `docs.seams.sh` is kept for the
docs of other Seams products: no Wallet deployment writes to it, and it does not
redirect to the Wallet docs. Until those docs exist, its `seams-docs` Pages
project answers 404 for every path. Staging docs requests `noindex` through Pages headers. Console and marketing
links use the configured docs origin. A 403 leaves live verification incomplete.
A successful build does not establish what a deployed site serves.

### Docs host cutover

1. Create the `seams-wallet-docs` Pages project. Set `main` as its production
   branch. Do not connect the project to a Git repository.
2. Set `CF_PAGES_PROJECT_WALLET_DOCS=seams-wallet-docs` in the staging and
   production GitHub environments.
3. Add the `docs.wallet.seams.sh` Pages custom domain. Cloudflare must create
   the required DNS record. This action needs user approval.
4. Deploy `wallet-docs` to staging. The `dev` branch uses its Pages preview
   host and returns `X-Robots-Tag: noindex`.
5. Deploy `wallet-docs` to production. Then deploy `wallet-site`. The
   production `all` surface performs those steps in that order.
6. Check `docs.wallet.seams.sh/guides/transaction-review` and the root sitemap.
   Check `wallet.seams.sh/docs/guides/transaction-review` with redirects
   disabled.

Keep the `docs.seams.sh` custom domain, its DNS record and the `seams-docs`
Pages project for the other products. Request approval before you remove any
of them.

The current SDK target is **0.35.0**, with iframe protocol **21.0.0** and recovery CLI **0.29.0**.

An earlier October 30, 2026 documentation refresh targeted SDK **0.28.0** and iframe protocol **18.0.0**.
Public docs source `5193e12ab7359cc8f6607e8447dc5444e763c18a` passed its build and link checks.
The [staging publication](https://github.com/seams-tech/seams-monorepo/actions/runs/40915268527)
and [production publication](https://github.com/seams-tech/seams-monorepo/actions/runs/40915719280) passed.
Live checks verified six English/Japanese pages and the source receipt on each site.
Results and the previous release artifact are in `.artifacts/docs-0.28-refresh/`.

Documentation responses use `Cache-Control: no-transform` to preserve inline package versions.
Without it, Cloudflare email obfuscation rewrites strings such as `wallet-server@0.28.0`.
See [Cloudflare's transformation controls](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/).

Retain the previous exact docs artifact and source revision before publication.
Documentation rollback restores that artifact. It does not roll back Wallet
packages, database schemas, or custody Workers.
