# Refactor 123: product domains and unified wallet site deployment

Status: proposed implementation plan. No DNS, OAuth, runtime, or deployment changes are performed by this document.

## Objective

Combine wallet product content, public Wallet documentation, and the customer
dashboard on one wallet site. Its frontend release must deploy independently of
company-site, BakeryOS, Satyr, and iframe releases. Keep existing wallet custody
and signing behavior intact.

## Domain ownership

| Domain                        | Purpose                                         | Owner                                                           |
| ----------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `seams.sh`                    | Company site and product discovery              | Company frontend                                                |
| `wallet.seams.sh/`            | Wallet product landing page                     | Shared wallet frontend                                          |
| `wallet.seams.sh/dashboard/*` | Customer dashboard                              | Shared wallet frontend                                          |
| `wallet.seams.sh/docs/*`      | Public Wallet VitePress documentation           | Shared wallet frontend artifact; source owned by `seams-wallet` |
| `wallet.seams.sh/console/*`   | Console management API                          | Console Worker                                                  |
| `api.wallet.seams.sh`         | Public wallet API gateway; subsequent migration | Wallet Gateway                                                  |
| `sign.seams.sh`               | Hosted wallet iframe and signing UI             | Wallet hosting deployment                                       |
| `console.bakery.seams.sh`     | BakeryOS dashboard                              | BakeryOS deployment; reserved here                              |
| `console.satyr.seams.sh`      | Satyr dashboard                                 | Satyr deployment; reserved here                                 |

`api.wallet.seams.sh` is the public SDK entry point. The MPC router, derivers, and signing workers remain backend services behind the gateway with their existing service bindings. This change does not expose additional MPC endpoints or rename internal services, databases, tenants, key identifiers, or cryptographic domains.

The shared frontend origin also shares a browser trust boundary: keep marketing scripts and dependencies appropriate for an authenticated dashboard, and never expose session data to analytics. The Console Worker remains a separately deployed backend.

Retain `sign.seams.sh` and existing hosted-wallet paths. Reserve the other product console domains without deploying placeholder applications or implementing those products in this refactor.

## Current coupling to remove

- `scripts/deploy-frontend.mjs` builds the company site, console, docs, and wallet assets together, then copies the console into the site output under `/dashboard-static`.
- `apps/wallet-console/vite.config.ts` uses `/dashboard-static/` as its asset base.
- The company site's redirect rules and local Caddy configuration serve `/dashboard/*` and `/platform/*` through the console build.
- `apps/wallet-console/src/core/router/siteRouting.ts` uses `VITE_SITE_ORIGIN` when constructing links. Internal console navigation and company-site links need distinct meanings after the split.
- `deployment/wallet-system/targets.json` describes company-site, gateway, and
  iframe origins; `deployment/console/targets.json` owns the current Console
  origin. `consoleOriginFor()` in
  `packages/console-server-ts/scripts/gateway-deployment-config.mjs` still
  derives a console hostname by replacing the `api` label. That assumption
  cannot express moving the console before the gateway.
- Console OAuth availability currently comes from gateway provider options, while login exchange belongs to the Console Worker. Inventory both consumers before changing provider configuration.

## Decisions

1. Give the unified wallet site one Pages project, frontend build artifact, deployment workflow, concurrency group, and smoke check. Wallet marketing, dashboard, and public Wallet docs publish together. Retain the existing Console Worker as management API owner.
2. Serve `/console` and `/console/*` on `wallet.seams.sh` through the Console Worker. Redirect `/docs` to canonical `/docs/`, then serve `/docs/*` from the VitePress output, followed by exact frontend assets and wallet frontend routes. Route Console API traffic before all static handling and SPA fallback so API misses cannot become HTML. Confirm the exact Cloudflare routing arrangement in staging before production cutover.
3. Keep `/dashboard/*` and existing supported `/platform/*` routes during the hostname move. Serve the wallet product landing page at `/`; keep the dashboard at `/dashboard/*`. Defer route simplification.
4. Keep current gateway origins during the console cutover. Move the public wallet gateway to `api.wallet.seams.sh` in a separate phase after the console works.
5. Keep staging and production isolated. Add one explicit wallet-site origin to the existing deployment target model; do not create another manifest or infer product ownership from hostname string replacement. The proposed shared staging host is `wallet.staging.seams.sh`; verify DNS and certificate support before adopting them. Retain existing testnet/staging API hosts until their own migration is planned.
6. Keep local development at `http://localhost:4001/dashboard/*` and its existing callback. Local routing may proxy separate applications without requiring new local DNS names.

## Phase 1: inventory and explicit configuration

Before editing behavior, map every reference to company, console, API, and iframe origins: deployment targets and generated Worker configuration; frontend env parsing; OAuth options/exchange; cookies; CORS; CSP; iframe permissions; WebAuthn RP settings; invitation and recovery links; docs/examples; monitoring; and provider webhook URLs.

Record which production revision is actually deployed. Finish or cancel superseded releases deliberately before the cutover so an older queued release cannot restore the bundled console or old host configuration.

Extend the split deployment targets and their existing parser with a required
wallet-site origin and its deployment project reference. Derive same-origin
dashboard navigation and the `/console/*` API base from that value; avoid
duplicate independently configurable console and marketing origins. Preserve
lane-specific configuration. Parse it once into precise internal types;
replace `consoleOriginFor()` derivation where an explicit configured origin is
required, then remove the obsolete derivation helper once callers are migrated.

Distinguish these frontend inputs clearly: wallet-site origin, same-origin console API path, company-site origin, gateway URL, and wallet iframe origin. Reuse existing naming where its meaning remains accurate. Required origins must not become optional fallback chains that accidentally send traffic to another product.

Provision DNS/custom domains and confirm valid TLS for the wallet hostname before changing redirects or login settings. Use existing Cloudflare resources and tooling; do not assume an existing certificate covers every nested hostname.

## Phase 2: unified wallet frontend deployment

- Use `apps/wallet-console` as the starting dashboard implementation and integrate the existing `seams.sh/wallet` product page into one wallet frontend build. Keep one application entry and clear marketing/dashboard route ownership; avoid adding another app merely to combine their outputs. Use a root-relative asset base and deep-link fallback for frontend routes only.
- Move the public Wallet VitePress source and configuration into `seams-wallet`, configured with `base: '/docs/'`. Public CI produces an immutable, versioned static docs artifact. The private wallet-site release consumes an exact artifact and places it under the frontend output's `/docs/` tree; it does not check out or compile against the public source tree during deployment.
- Adapt the existing frontend deployment script with the smallest explicit wallet-site operation. Add a wallet-site release workflow following current environment, branch, credentials, artifact, and smoke conventions. Build only the dependencies actually needed by the wallet frontend.
- Keep company-site and wallet-site publication independent. Remove console copying from the company-site release after cutover; remove the old `/dashboard-static` mount and its supporting build/smoke assumptions.
- Configure `/console/*` to reach the Console Worker, including OPTIONS, errors, and unknown API paths. API responses must never become frontend HTML.
- Redirect `/docs` to `/docs/` and configure `/docs/*` as static VitePress output ahead of the wallet SPA fallback. Direct documentation deep links and asset requests must resolve within `/docs/` and must never enter dashboard authentication.
- Update internal navigation, home/product/docs links, API calls, and refresh behavior. Deploying the shared wallet frontend must not rebuild or republish the company site, private operational docs, iframe, or other products.
- Establish the shared site in staging and demonstrate the public landing page, a direct VitePress deep link, login, dashboard refresh on a deep link, and an authenticated management request before adding further validation machinery.

## Phase 3: authentication and origin cutover

Use `https://wallet.seams.sh/dashboard/login` as the production GitHub callback. Update the OAuth App setting and `SEAMS_GITHUB_OAUTH_CALLBACK_URL` in the deployment environment; keep runtime `GITHUB_OAUTH_CALLBACK_URL` naming. Update every deployed consumer of that configuration, including gateway provider discovery while it remains in use. Do not introduce a second independent OAuth configuration source.

Update Google authorized JavaScript origins and any redirect URIs used by the actual login flow. Add the new console origin to the exact backend CORS allowlists before switching the frontend. Verify credentialed requests and OPTIONS on both successful and rejected paths.

Scope console session cookies to `wallet.seams.sh` and appropriate API path with Secure/HttpOnly attributes and the intended SameSite policy. Avoid parent-domain cookies shared with BakeryOS, Satyr, or the company site. Same-site sibling domains still require CSRF protection: preserve or implement the existing request-origin/CSRF admission checks at the request boundary. Review the actual deployed cookie attributes rather than relying on defaults.

Existing sessions on another host require a fresh sign-in. Do not transfer cookies, tokens, or OAuth state between domains. An OAuth attempt started on the old origin cannot be blindly redirected with its code/state to the new origin because its browser state is origin-bound. During cutover, old callback requests should show a restart-sign-in path on the new console without forwarding authentication query parameters. Remove the old callback from provider configuration after outstanding attempts expire.

Console has not launched and has no existing passkeys. Initial Console passkey enrollment uses `wallet.seams.sh` as the RP ID and verifies the exact origin server-side. This cutover requires no Console credential migration or re-enrollment. Keep organization-scoped custody step-up and account-wide 2FA as separate authorization concepts.

Keep wallet passkeys and `sign.seams.sh` custody origins unchanged. Update iframe parent-origin permissions only where the moved console actually embeds it. Coordinate the future 2FA implementation with this refactor so production account passkeys start on the final origin.

## Phase 4: content and old-link cutover

Move existing wallet product content to `wallet.seams.sh` without redesigning it. First identify which routes are wallet marketing, interactive demos, shared docs links, or company content; move each according to its actual owner. Keep `seams.sh` as company/product discovery.

Publish wallet marketing, public Wallet docs, and dashboard in the same wallet
artifact established in Phase 2. Keep the company site in its own deployment.
Reuse existing components and move content without a redesign or separate
marketing/docs release workflows.

Update navigation, canonical URLs, sitemap entries, social metadata, docs/examples, and relevant invitation/email links. Redirect old wallet product URLs to their mapped destinations.

Redirect ordinary old dashboard deep links to the same path on `wallet.seams.sh`, with explicit handling for OAuth callbacks described above. Audit query parameters before preserving them; never forward auth codes or session tokens across hosts. Use temporary redirects during validation and permanent redirects once the mapping is confirmed. Redirects live at the old request boundary; do not retain a second hosted console implementation.

## Phase 5: optional public wallet API move

After the unified wallet site is stable, attach `api.wallet.seams.sh` to the existing production Wallet Gateway. Keep worker identities, private service bindings, D1 storage, and protocol identifiers unchanged.

Audit origin-bound semantics before aliasing: token issuer/audience validation, ceremony JWKS publication, WebAuthn origins, signed request URLs, CORS, CSP, and external integrations. A hostname move must not accidentally change a cryptographic or protocol identity. Change only the boundaries that actually depend on the public URL, with an explicit coordinated migration where required.

Update SDK deployment defaults, iframe gateway configuration, examples, webhook destinations where applicable, and monitoring. Support older SDK clients through a time-bounded old-host route to the same gateway implementation if necessary. Do not depend on HTTP redirects for authenticated POST traffic. State the client/version retirement criterion, then remove the obsolete host route and boundary allowances when it is satisfied.

Keep staging/testnet network separation explicit. This phase does not automatically rename those hosts or collapse multiple networks behind one ambiguous endpoint.

## Verification and acceptance

Demonstrate each operating path first. Then add focused behavior coverage to the top-level `tests/` workspace after reading `tests/AGENTS.md`; use shared factories for domain records. Update `docs/intended-behaviours.md` and relevant contracts with intentional lifecycle changes. Retire stale bundled-path guards instead of preserving obsolete layout assumptions.

- `wallet.seams.sh/` serves the public wallet landing page; `/dashboard/*` serves the dashboard. Both load the correct assets on direct navigation and refresh, and public pages do not require a console session.
- `/docs/*` serves the exact public Wallet VitePress artifact, including direct deep links and assets, without a Console session or `SeamsWebProvider`.
- `/console/*` reaches the Console Worker, including preflight and error cases. Unknown API routes do not return SPA HTML.
- Real Google and GitHub sign-in complete on the new host; sign-out, refresh, environment/organization switching, and authenticated API requests work.
- Old links reach the right product; old OAuth callbacks restart safely. No code, token, or cookie is forwarded across product domains.
- Cookies remain host-scoped to the wallet site. Disallowed origins cannot perform authenticated console mutations. Provider secrets stay server-side.
- Initial Console passkey enrollment uses `wallet.seams.sh` with exact origin verification. Hosted-wallet passkey/signing behavior remains valid on `sign.seams.sh`.
- One wallet frontend release publishes marketing, public Wallet docs, and dashboard together while leaving company-site, private operational docs, iframe, BakeryOS, and Satyr deployment versions unchanged; their releases leave the wallet frontend unchanged.
- The optional gateway move preserves signing and existing-client request behavior during its stated boundary migration.

Run the narrow affected checks first, then relevant auth/console lifecycle and deployment checks because origins and authentication are shared behavior. Test generated configuration through existing parsers/builders and meaningful smoke requests; avoid new source-text policy scripts.

## Release order and rollback

1. Inventory current deployments and host ownership; configure the initial Console RP ID as `wallet.seams.sh`.
2. Provision new domains/TLS and explicit deployment configuration.
3. Deploy and verify the unified staging wallet site, including `/docs/*` routing.
4. Prepare production API routing, provider origins/callbacks, and cookie policy; deploy the unified wallet site.
5. Verify production sign-in and management operations, then switch company-site navigation and old-route redirects.
6. Remove the company-site console publication path and obsolete wallet content after verifying their destinations in the shared wallet site.
7. Perform the public API migration separately when ready; retire old boundary routes against explicit criteria.

Rollback the shared wallet frontend to its previous known-good artifact on the new hostname whenever possible. If reverting a hostname cutover, coordinate OAuth callbacks, origins, redirects, and cookie expectations together, requiring fresh sign-in. Keep any Console passkeys enrolled after launch bound to `wallet.seams.sh`. Do not roll back signing storage, rotate custody material, or redeploy unrelated products merely to undo a frontend-domain move.

Deliver this as small reviewable slices. If a localized slice exceeds five files or introduces an architectural concept, first propose a smaller implementation. Done means wallet marketing, public Wallet docs, and dashboard share one verified wallet-site release path, agreed domains have clear owners, and the company release no longer publishes wallet content or the dashboard. Use `docs.wallet.seams.sh` only through a later plan if the documentation requires an independent deployment cadence.
