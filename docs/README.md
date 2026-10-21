# Documentation and operator index

Public SDK guides and release status live in `seams-wallet/apps/docs`.
Wallet contracts live in its numbered specifications and intended behaviors.
This repository owns Console procedures and deployment.

## Console procedures

[Console split history](feat-2-platform-console.md) records the completed separation
of Platform and Wallet entry points and the reasons for that design.

- [Onboarding](wallet-saas/console-docs/wallet-console-onboarding.md): organization,
  project, and Development environment creation. Activation remains separate.
- [API keys](wallet-saas/console-docs/api-keys.md): environment credentials and origins.
- [Bring your own authentication](wallet-saas/console-docs/byo-auth.md).
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
- [Wallet database schema](wallet-saas/console-docs/wallet-db-schema.md).
- [CLI release procedure](wallet-cli-release.md).
- [Local/provider runtime qualification](../deployment/celld/README.md): retain
  its qualification limits when describing private infrastructure.

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
