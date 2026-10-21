# Contact form endpoint: implementation plan

Status: proposed; implementation has not started. Decided on October 21, 2026:
Turnstile from the start, and a reserved platform organization for the outbox.
Date: October 21, 2026.

## Outcome

A visitor sends the contact form on the company site, and the inquiry reaches
`sales@seams.sh` without an email app on the visitor's computer. The Console
server stores each inquiry, sends it through the existing Console email outbox,
and refuses abuse with a rate limit and spam checks.

## Current state

- The contact page (`apps/seams-site/src/pages/contact/page.tsx`) opens a
  `mailto:` link. Since `21b691b8`, it also shows the prepared message with copy
  buttons, because a `mailto:` link does nothing without an email app.
- No Console route accepts a request without a session. Every route in
  `packages/console-server-ts/src/router/consoleRouteDefinitions.ts` has a
  session requirement.
- Each row of `console_email_outbox` belongs to an organization: `org_id` is in
  the primary key, with a foreign key to `organizations`. An anonymous visitor
  has no organization.
- The Resend provider sets one fixed `replyTo` for all mail
  (`packages/console-server-ts/src/email/providers.ts`). It cannot set a reply-to
  address per message.
- Useful patterns already exist: a counter table per time window
  (`observability_ingest_windows` in `observability/d1.ts`), a SHA-256 hash of
  `cf-connecting-ip` (`wallet-console-server-ts/src/tenantRootSecurity/`), and the
  table rebuild that added `FREE_PLAN_NOTICE` to the outbox (migration `0010`).
- In production, the Console API is served at the Wallet site origin
  (`scripts/deploy-surface.mjs`). The company site does not proxy `/console/*`.
  Locally, Caddy proxies `/console/*` on `localhost:4001`.

## Design

### 1. Public route

- Add `POST /console/public/sales-inquiries`.
- Add a route requirement `public` to `ConsoleRouteRequirement`. Extend the route
  policy test so that it lists every public route by name. A new public route
  then fails the test until someone adds it on purpose.
- The route reads no session and sets no cookie.
- Request body: `name`, `email`, `company`, `details`, the spam fields from step 4,
  and a `requestId` (random, from the page) for idempotent retries.

### 2. Validation

- Trim every field. Refuse control characters.
- Limits: name 1–120 characters, company 1–160, details 10–4,000, email up to 254
  and with one `@`.
- Refuse an unknown field. Return `400 invalid_request` with the field name.

### 3. Storage

- New table `console_sales_inquiries` in a forward migration (`0011`):
  `namespace`, `id`, `request_id` (unique), `name`, `email`, `company`, `details`,
  `source_hash`, `spam_verdict` (`clean`, `held`), `created_at_ms`.
- `source_hash` is an HMAC of `cf-connecting-ip` with a server secret, not a
  plain hash. Store no raw IP address and no user agent.
- Delete rows after 180 days in the existing scheduled Console work.
- Write the inquiry and its outbox row in one D1 batch.

### 4. Spam protection

- **Honeypot:** a hidden `website` field. A filled value gives `held`.
- **Fill time:** the page sends the time it rendered the form. Less than 3
  seconds gives `held`. This is a weak signal only, because a client can lie.
- **Content:** more than 3 links in `details` gives `held`.
- **Turnstile (decided):** the contact page renders a Cloudflare Turnstile
  widget and sends its token with the form. The route checks the token with
  Turnstile's `siteverify` API, with the `remoteip` and the expected hostname,
  before it validates anything else. A missing or failed token gives
  `403 turnstile_failed`, and the page shows the `mailto:` fallback.
  - The site key is a seams-site build variable (`VITE_TURNSTILE_SITE_KEY`). The
    secret is a Console Worker secret (`TURNSTILE_SECRET_KEY`).
  - Local and test runs use Cloudflare's published test keys, in `env.example`
    and the Console dev variables.
  - The widget loads a script from `challenges.cloudflare.com`. Load it only on
    the contact page.
- A `held` inquiry is stored but not emailed. The response is the same as for a
  `clean` one, so a bot learns nothing.

### 5. Rate limit

Use a counter table per window, like `observability_ingest_windows`:

| Key           | Limit            | Over the limit                |
| ------------- | ---------------- | ----------------------------- |
| `source_hash` | 3 per 10 minutes | `429 rate_limited`            |
| `source_hash` | 10 per day       | `429 rate_limited`            |
| Email address | 3 per day        | `429 rate_limited`            |
| All inquiries | 200 per day      | Store as `held`, do not email |

A Cloudflare WAF rate-limit rule on the path can add a first layer at the zone.

### 6. Email through the outbox

- Add a `SALES_INQUIRY` template family, with a table rebuild like migration
  `0010`.
- **Organization (decided):** the migration creates one reserved platform
  organization with no members, and inquiry outbox rows belong to it. The
  dispatcher, the retries, and the delivery log then work with no change.
  - An organization with no members does not show in any account's organization
    list.
  - Fill its required columns the same way account creation does. Give it a
    fixed id in a shared constant, so code never looks it up by name.
  - Exclude it from the Platform support organization search and from billing
    and usage work.
- Recipient: `sales@seams.sh`. Subject: "Sales inquiry from <name> at <company>".
  The body holds the four fields and the inquiry id.
- Reply-to: the visitor's address, so sales can answer with one click. This needs
  a per-message `replyTo` in the provider request.

### 7. Contact page

- Post JSON to the route. On success, show "Thank you. We will reply by email."
- On a network error or a `5xx`, show the current `mailto:` link and copy box, so
  the visitor can still send the message.
- On `429`, ask the visitor to try again later or to write to `sales@seams.sh`.

### 8. Tests

- Unit tests for validation, the spam verdict, and the rate-limit windows,
  through shared factories.
- A D1 test: one request creates one inquiry and one outbox row; a retry with the
  same `requestId` creates nothing new; a `held` inquiry creates no outbox row.
- The route policy test with the new `public` requirement.
- Turnstile checks with a stubbed `siteverify`: a valid token, a failed token, a
  missing token, and a wrong hostname.
- A test that the reserved organization has no members and does not appear in
  organization lists, support search, or billing work.
- An end-to-end test of the contact page against the local Console, with the
  capture email provider.

## Decisions

- **Turnstile from the start** (October 21, 2026). Bots are the main abuse risk
  for a public form, and the honeypot and fill time are weak signals.
- **Reserved platform organization for the outbox** (October 21, 2026). It reuses
  the dispatcher, the retries, and the delivery log, with no second claim loop.

## Open decisions

1. **Production routing:** the company site must reach the Console API. Either
   proxy `/console/public/*` from the company site, or call the Wallet site origin
   with CORS for the company site origin only.
2. **Retention:** 180 days is a proposal.
