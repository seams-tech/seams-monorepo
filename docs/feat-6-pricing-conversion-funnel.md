# Pricing conversion funnel

Status: implemented on `dev`, October 31, 2026. No production deployment occurred.
Billing rollout and Pro price approval remain separate gates.

## Built so far

The earlier implementation supplied embedded Google/GitHub sign-in, stored plan
intent, automatic organization/project setup, verified card setup, Growth/Pro
activation, prorated base charges, and Stripe collection. These paths remain in use.

The completion adds:

- A Free summary on the Wallet overview from day zero. It shows the actual Free
  limits, current production usage, card deadline, and links to billing and the
  integration guide. Default organization names link to account settings.
- Enterprise context in the existing contact modal. Both the main and closing
  Enterprise cards carry their source. The calculator also carries its inputs.
  The modal recomputes prices, keeps context separate from project details, and
  lets the visitor remove it. The mailto message and copy fallback include it.
- Console measurement through audit records and existing billing facts.
  [The report query](pricing-funnel-events.sql) produces a normalized event stream.
- A day-one Growth/Pro reminder through the existing email outbox. Retries reuse
  one outbox ID. Delivery rechecks the plan, card, membership, billing permission,
  and the visitor's choice to continue on Free.
- A plan page on the Wallet Console's authenticated origin. Existing visitors
  with a usable card confirm before activation. Visitors with multiple
  organizations select one before setup or billing.
- Stripe cancellation returns to the plan page with retry and Continue on Free.
  The pending intent survives Checkout. A verified return clears it.
- Initial organization creation resumes after a lost response. Automatic
  creation uses a stable ID and resumes an existing owned organization.
- Browser acceptance for the new paths and Stripe test-mode completion without
  a browser return. Each scenario writes JSON and screenshots.

## Recorded decisions

1. Growth starts when a card is verified for that purpose, or after explicit
   confirmation with a usable card. Its base price is USD 99 per month.
2. New paid-plan visitors sign in, receive automatic organization/project setup,
   then enter Stripe Checkout.
3. The marketing site does not track clicks. Console measurement starts at login.
4. The funnel supports Google and GitHub. Apple is outside this work.
5. Plan cards are the entry points. There are no separate hero buttons.
6. There is no price lock.
7. Pro is a real plan with the pinned `wallet-pro-v1` price. USD 399 per month and
   100,000 included users remain provisional until approved.
8. Free also uses automatic setup. The old two-field onboarding requirement no
   longer applies to pricing-card visitors.
9. The public contact endpoint belongs to feat-5. A mailto action cannot prove
   that an inquiry was sent, so it does not emit `contact_submit`.

## Current behavior

### Plan intent and authentication

The Console stores the plan, source, creation time, and project ID in
`sessionStorage` for one hour. It removes attribution parameters from the URL.
Only known plans, the known source, and a valid project ID are accepted.
Expired and future-dated records are rejected. Reloading or choosing the same
pending plan reuses its ID. An invitation takes precedence.

The SSO request carries normalized attribution. It grants no billing permission.
The server records successful identity exchange and creates the normal session.
The Google popup and GitHub redirect retain intent in the same tab.

### New visitors

Free creates “My organization” and “My first app”, then opens the Wallet overview.
Growth and Pro create the same records, then open Stripe setup-mode Checkout.
The organization stays on Free until the server verifies the card.

Checkout saves a card. The first base charge is prorated from activation until
the end of the UTC month. Collection occurs after the month.
The login page and Stripe custom text explain this timing.

The webhook and return reconciliation use the existing activation transaction.
A replay preserves the start date and cannot create a second base charge.
A lost browser return does not prevent webhook activation.

### Existing visitors

The flow reuses existing organizations. With multiple organizations, the visitor
selects one first. The plan page shows the selected organization in the Console
header. Switching context occurs before setup or billing.

A usable card requires an explicit Start Growth or Start Pro action.
An existing paid plan remains unchanged. Missing billing permission shows an
owner/administrator instruction, and the server refuses activation with HTTP 403.

A canceled or failed setup leaves the plan unchanged. The plan page offers
another attempt and Continue on Free. Continuing clears intent and records one
event for that attempt.

### Prices

Every locale displays USD, which matches the billing currency. The old fixed
Japanese-yen conversion is removed.

The calculator and contact modal share `estimate.ts` and `prices.ts`.
A paid-plan estimate always includes that plan's base fee. The calculator
separately identifies workloads covered by Free. An explicit paid start accrues
a base fee even for a workload that fits Free.

Growth uses 5,000 included active users, USD 0.004 per additional user, and USD
0.05 per 1,000 signatures above the pooled allowance. Pro uses 100,000 included
users, USD 0.0035 per additional user, and USD 0.04 per 1,000 excess signatures.
Both pools allow 300 signatures per active user. Estimates use a 30-day month.

Enterprise estimates use published floors. They are not a contract quote.

### Contact context

The current interface uses `#contact?plan=enterprise&src=…` on the Wallet site.
An Enterprise card supplies no calculator values. The calculator supplies
`users` and `per_day`.

The parser accepts one occurrence of each known field. Users must match a
calculator slider step. Signatures per day must be an integer from 1 through 50.
Invalid pairs produce no estimate. URL prices and unknown fields are ignored.
The context never supplies an email address and does not enter the editable
project details. Closing the modal discards the form.

### Day-one email

After automatic setup, a paid intent can queue one reminder for the creating
owner of a new Free organization. Availability starts 24 hours after organization
creation. The outbox's unique key prevents duplicate enqueue and delivery on
ordinary retries. The provider receives the same idempotency key on each attempt.

Before delivery, the dispatcher cancels a reminder when the organization has a
usable card, left Free, lost the recipient's active billing permission, or
recorded Continue on Free. The email links to the correct organization and plan.
It uses the existing `FREE_PLAN_NOTICE` family and needs no email schema migration.

## Measurement

[pricing-funnel-events.sql](pricing-funnel-events.sql) accepts one bound Console
namespace. It reads existing records and does not write to wallet operations.

| Step                            | Durable source and deduplication                                    |
| ------------------------------- | ------------------------------------------------------------------- |
| `console_login_view`            | Anonymous audit event, once per intent                              |
| `console_identity_created`      | First attributed identity without an organization, once per account |
| `console_signin_existing`       | Existing identity exchange, once per intent/account                 |
| `onboarding_org_created`        | Organization record and creation audit                              |
| `onboarding_project_created`    | First project record                                                |
| `card_setup_started`            | Persisted Checkout setup session                                    |
| `card_setup_canceled`           | Authenticated return event, once per intent/account                 |
| `card_verified`                 | Verified Checkout session, including webhook completion             |
| `growth_start`, `pro_start`     | First durable base charge for that organization/plan                |
| `growth_continue_free`          | Authenticated choice, once per intent/account                       |
| `organization_renamed`          | Existing update audit, with `was_default`                           |
| `first_production_registration` | First committed production active-user fact                         |
| `growth_move`                   | Existing automatic-move notice                                      |
| `contact_submit`                | Deferred to the public contact endpoint                             |

The report contains no IP address or email. Account IDs appear only after
authentication. A `plan_ready` audit joins attribution to the selected organization.
There is no third-party tracker.

The activation event uses the existing monthly active-user facts. For an imported
wallet, its first production activity can be an unlock. It therefore measures
first production activation, rather than proving a new wallet was created.

Historical identities without attributed events are not backfilled.
The report measures the first conversion to each paid plan. It is not a ledger
of every later downgrade and reactivation.

## Verification

Run the composed browser suite from the repository root:

```sh
pnpm -C tests exec playwright test -c playwright.config.ts \
  e2e/console/pricing-conversion.e2e.test.ts \
  e2e/console/pricing-contact.e2e.test.ts \
  e2e/console/google-sign-in.e2e.test.ts \
  e2e/console/console-session-csrf.e2e.test.ts \
  e2e/console/step-up-enrollment.e2e.test.ts \
  --reporter=line --output=../.artifacts/pricing-funnel-acceptance --timeout=240000
```

The Stripe scenario requires a test key in `STRIPE_API_SK` or the root
`.env.local`. It rejects live keys, fills hosted Checkout with test card 4242,
blocks the browser's success return, and replays completion through the existing
webhook service. That service verifies the card with Stripe. Test customers are
deleted after the scenario.

The remaining scenarios use real D1, production Console routes, and the browser
UI. External identity-provider responses are controlled. Email delivery uses the
capture provider. The funnel-only harness supplies account authority without
Wallet provisioning. The existing composed Wallet scenario separately verifies
the Free summary after Wallet setup, context switching, and invitation redemption:

```sh
pnpm -C tests exec playwright test -c playwright.config.ts \
  e2e/console/shared-account-wallet-activation.e2e.test.ts \
  --grep 'Separate consoles recover' --reporter=line \
  --output=../.artifacts/pricing-wallet-composition --timeout=240000
```

Verification on October 31: all seven funnel/auth scenarios passed together.
The composed Wallet scenario also passed. Console fixtures, type fixtures, both
server packages, and the Wallet app passed their type checks. Scoped lint passed.
Evidence includes screenshots, the event report, rendered email HTML, request
outcomes, and Stripe test object IDs.

## Dependencies and release gates

- Consume the billing completion in feat-3/feat-4. Its owner implements credit
  limits, consolidated collection, payment recovery, Free downgrade, and removal
  of the prepaid monthly-resource debit from Free/Growth/Pro.
- Before deployment, verify those billing acceptance results and migrations
  against the same revision. No monthly-resource prepaid balance should be
  required for covered plan usage. Gas sponsorship retains its separate charges.
- The billing chat is adding regional signing-credit commitments. Its Wallet
  runtime release, exact package adoption, and admission acceptance remain
  unresolved at this handoff. The funnel does not supply that runtime contract.
- Approve Pro pricing before production promotion.
- Deploy the existing paid-plan and collection migrations with the billing work.
- Keep the public contact endpoint and actual sent-inquiry measurement in feat-5.
- No production deployment, live customer charge, or external email was part of
  this acceptance run.
