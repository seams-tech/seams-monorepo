# Contact form endpoint: implementation plan

Status: proposed; implementation has not started.
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
- **Turnstile (decision):** a Cloudflare Turnstile token, checked on the server,
  stops most bots. It adds a third-party script to the page. See open decision 1.
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
- **Organization (decision):** create one reserved platform organization in the
  migration, with no members, and attach inquiry rows to it. The dispatcher, the
  retries, and the delivery log then work with no change. An organization with no
  members does not show in any account's organization list. See open decision 2.
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
- An end-to-end test of the contact page against the local Console, with the
  capture email provider.

## Open decisions

1. **Turnstile:** add it now (stronger, one third-party script), or start with
   the honeypot, fill time, and rate limits only.
2. **Organization for the outbox:** a reserved platform organization (this plan),
   or a separate delivery state on the inquiry table with its own claim loop. The
   second keeps `organizations` clean but duplicates the retry logic.
3. **Production routing:** the company site must reach the Console API. Either
   proxy `/console/public/*` from the company site, or call the Wallet site origin
   with CORS for the company site origin only.
4. **Retention:** 180 days is a proposal.
