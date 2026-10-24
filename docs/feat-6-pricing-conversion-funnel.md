# Pricing page conversion funnel: plan

Status: partly built on `dev` (October 22, 2026); see [Built so far](#built-so-far).
Decisions recorded on October 21 and 22, 2026: see [Decisions](#decisions).
Date: October 21, 2026.

## Built so far

Built on October 22, 2026, with a Pro plan added (decision 7). Not deployed.

- **Sign-in dialog (October 23, 2026).** A click on the Free, Growth or Pro card, or on a
  closing-banner card, opens a dialog on the pricing page. The dialog frames the Wallet
  Console login page (`/dashboard/login?plan=…&src=pricing_card&embed=1`), so the
  session is made on the dashboard's host. The frame signs in, does the automatic setup,
  and asks the page to open Stripe or the dashboard in the whole tab
  (`apps/wallet-console/src/core/dashboard/login/embeddedSignIn.ts`). GitHub refuses
  frames, so the dialog runs GitHub in a popup window. The card link without the dialog
  is the full Wallet Console login page. The company build gets
  `VITE_WALLET_CONSOLE_ORIGIN`, and the Console build gets `VITE_COMPANY_SITE_ORIGIN`,
  from `deployment/console/targets.json`; local development uses `http://localhost:4001`
  for both.
- **Why not the Platform Console.** Until October 23 the cards opened the Platform
  Console login. Each Console host calls the Console API on its own origin, and the
  session cookie is host-only. After Stripe, the plan page sent the visitor to the
  Wallet Console overview, which had no session, so the visitor signed in a second time.
- **Plan intent.** The Console login page (Wallet and Platform) keeps the plan, the source, the
  time, and a project id in sessionStorage (`seams.console.pendingPlanIntent`, one
  hour), removes the parameters from the URL, and shows the plan and its price above the sign-in
  buttons. A pending invitation wins and drops the intent.
- **Automatic setup.** After sign-in with an intent, the login page creates the
  organization ("My organization") and the first project ("My first app") with the
  intent's project id. A Growth or Pro intent on a Free organization without a card
  then goes straight to Stripe; every other intent opens the Wallet Console overview
  (the plan page on the Platform Console). New identities create their
  organization through `POST /console/account/organizations`, not through
  `POST /console/onboarding/organization`, so `planIntent` is not sent to the server yet.
- **Stripe return.** The Wallet Console login asks for card setup with
  `{ startPlan, returnTo: 'dashboard' }`. Stripe then returns to the Wallet Console
  overview, which verifies the card and shows the started plan; a cancel returns to the
  pricing page. Before Stripe opens, the login page stores the new organization and
  project as the dashboard selection. A Free intent, or one that needs no card, opens
  the overview at once.
- **Plan page.** `/dashboard/billing/plan` on the Platform Console shows Free, Growth
  and Pro with the current plan and this month's usage. With a usable card the owner
  confirms the start. A plan start from the plan page returns there from Stripe.
- **Local runs.** Without `STRIPE_API_SK`, the local router uses simulated Stripe: the
  card setup returns at once with a verified test card, so no Stripe page shows.
- **Plan start on the server.** `POST /console/billing/card-setup` accepts
  `{ startPlan: 'growth' | 'pro' }` (the plan's `purpose` above). The setup session
  stores `start_plan`, and the verified card starts the plan in the same D1 batch.
  `POST /console/billing/plan/start { plan }` starts a plan with the card on file. Both
  start only from `free`, need `billing.manage`, and never start twice. An explicit
  start queues no notice email. Migrations 0013 (Console core) and 0105 (Wallet
  Console) add `pro` and the `start_plan` column.
- **Base-fee accounting.** A Growth or Pro start records the first UTC month's
  prorated base charge in the same D1 transaction as plan activation. Later
  months accrue once through the scheduled plan pass or monthly finalization.
  The charge uses the plan's pinned price version. Migrations 0014 and 0107 add
  the accrual table.
- **Stripe base-fee collection.** The daily monthly-close job finds due base
  charges. It creates one automatic-collection Stripe invoice with one base-fee
  line for each organization and UTC month. D1 stores the Stripe invoice ID and
  collection status. A retry checks the same invoice before taking another
  action. If an unlinked attempt passes Stripe's idempotency window, the job
  lists that customer's invoices and matches the exact charge key. It links one
  valid invoice or creates a new one only after a complete search finds none.
  An open invoice stays pending until Stripe reports payment. Void and
  uncollectible invoices remain visible to each monthly-close pass. Migrations
  0015 and 0108 add the collection table.
- **Not built:** the Free plan summary on the overview, the contact prefill,
  measurement events, the day-1 email, and the acceptance browser test.

## Outcome

A visitor clicks a plan card on the pricing page (`apps/wallet-console/src/pages/pricing/page.tsx`)
and arrives at the right next step, with the plan choice kept:

- **Free:** sign in with SSO, create the organization and first project, open the
  dashboard on the Free plan.
- **Growth:** sign in with SSO, then go straight to Stripe Checkout. The Console
  creates the organization and the first project with default names on the way.
  Growth starts when Stripe confirms the card.
- **Enterprise:** the contact form, filled in with the plan and the calculator
  values.

Each Console step records one funnel event, so we can see where visitors stop.

Prices and limits come from [Wallet pricing and costs](wallet-saas/pricing.md).
The Free plan state, card setup, and the Growth move come from
[the Free plan card plan](feat-4-free-plan-card-and-growth-move.md).

## Current state

Facts from the code on `dev`, October 21, 2026:

- **Plan cards.** All three cards are links. Free and Growth go to `/docs/concepts/`,
  Enterprise goes to `/contact/`. No link carries the plan. The hero buttons were
  removed in `f68933d3`, so the cards are the only plan entry.
- **Calculator.** `EnterpriseCalculator.tsx` keeps the user count and the
  signatures per day in React state. Its "Contact sales" link goes to `/contact/`
  without these values.
- **Contact page.** It opens a `mailto:` link and shows a copy box. feat-5 plans a
  real endpoint, `POST /console/public/sales-inquiries`, with Turnstile. That
  route refuses unknown fields.
- **Console sign-in.** `apps/wallet-console/src/core/dashboard/login/page.tsx` has
  two providers: Google (an ID token from a popup) and GitHub (a full-page OAuth
  redirect to a fixed callback). There is no email sign-in.
- **Session resume.** The login page reads the Console session first. A signed-in
  visitor goes to `/dashboard` at once. An identity with no organization goes to
  `/dashboard/onboarding`, but only in the Platform Console build. The Wallet
  Console build does not send it there.
- **Two Console origins.** Onboarding and billing are Platform Console routes
  (`console.seams.sh`). The site's `/dashboard` link redirects to the Wallet
  Console origin (`scripts/deploy-surface.mjs`). The company site has no setting
  for the Platform Console origin.
- **A stored intent already exists.** A pending team invitation is read from the
  URL, kept in `sessionStorage` (`seams.console.pendingInvitation`), and removed
  from the URL before the OAuth redirect
  (`apps/wallet-console/src/core/dashboard/routes/invitations/invitation.ts`).
  The login page then routes to the invitation. This plan copies that pattern.
- **Onboarding.** `POST /console/onboarding/organization`, then
  `POST /console/onboarding/project` with a browser-generated project id. Reload
  resumes from saved records. Onboarding ends on the dashboard overview.
- **The billing account comes with the first project.** `bindProjectBilling`
  (`packages/console-server-ts/src/accountPlatform/d1.ts`) creates the row in
  `organization_billing_accounts`. Onboarding calls it when it creates the first
  project. Card setup refuses an organization without this row
  (`billing_account_missing`). So Stripe can open only after the first project
  exists.
- **Organization rename exists.** `PATCH /console/account/organizations/:orgId`.
- **Plan state (feat-4, local, not released).** Each billing account has a plan:
  `free`, `growth`, or `enterprise`. New accounts start on `free`. There is no
  operation that moves an account to Growth on request. The only move is the
  automatic move at a Free limit when a usable card is on file.
- **Card setup (feat-4).** `POST /console/billing/card-setup` creates a Stripe
  Checkout session in setup mode for the account's one Stripe Customer. Stripe
  returns to `/dashboard/billing/account?card_setup=success&checkout_session_id=…`.
  The page calls `POST /console/billing/card-setup/reconcile`, which verifies the
  card with a server-side Stripe lookup. Only owners and billing administrators
  can start it.
- **Growth charges.** The plan and the price version (`wallet-growth-v1`) are
  stored, but nothing bills them. The feat-3 monthly close does not exist. The
  prepaid `wallet.monthly_active_resource` meter ($3 per resource) still applies.
- **No price lock.** Growth has no fixed-price period. Migrations 0011 (Console core)
  and 0103 (Wallet Console) removed the feat-4 lock date.
- **Analytics.** The company site and the Console have no analytics script. We do
  not track clicks on the company site.

## Evaluation of the starting idea

| Card       | Starting idea                                     | Verdict                                                                 |
| ---------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| Free       | Create an account and sign in                     | Keep. Go to the Platform Console login, not to the docs.                |
| Growth     | Checkout first; the account is made after payment | Change the order: sign in first, then straight to Checkout. Decision 1. |
| Enterprise | The contact form                                  | Keep. Add the plan and the calculator values to the form.               |

The Free and Enterprise parts fit the code with small changes. The Growth part
needs one change of order. Checkout before an account needs a Stripe Customer
before a billing account exists, and account linking by email.

## Decision 1: guest checkout or sign-in first

| Question                      | Guest checkout, account after payment                                                                                                                                                       | Sign-in, then straight to Checkout (recommended)             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Stripe Customer               | Made before a billing account exists. It must move to the account later. feat-3 requires one persisted Customer per account, made by the server, never chosen by browser input.             | Made for the billing account by the existing route.          |
| Who owns the result           | Only the email that the visitor typed into Stripe. Stripe does not verify it.                                                                                                               | The SSO identity. Google and GitHub verify the email.        |
| Account linking               | Needed: link the paid checkout to an SSO account by email.                                                                                                                                  | Not needed.                                                  |
| Takeover risk                 | Yes. An attacker types a victim's work email and prepares an account that the victim later joins. Or an attacker signs in with an unverified provider email and claims a victim's checkout. | None added. Card setup runs inside an authenticated session. |
| Safe form of linking          | A claim link sent by email, opened before sign-in. That is an extra email step, and longer than one SSO click.                                                                              | —                                                            |
| Visitor steps before the card | Zero, but a claim email and a sign-in follow.                                                                                                                                               | One SSO click. The Console sets up the rest.                 |
| Abandon after Stripe          | A Customer and a card with no account. Cleanup work.                                                                                                                                        | An organization on Free. The feat-4 reminders follow up.     |
| New code                      | Public checkout route, orphan Customers, claim tokens, linking rules.                                                                                                                       | A stored intent, automatic setup, and the Growth start.      |

**Recommendation: sign-in first, then straight to Checkout.** SSO is one click, so
the guest flow saves almost nothing. It adds a takeover risk and a second Customer
path that feat-3 forbids.

## Decision 2: Growth starts at once

Decided October 21, 2026: the "card on file, move at the limit" state belongs to the
Free plan only. A Growth click starts Growth, at $99 a month, when Stripe confirms
the card. There is no "Growth-ready" state.

### Growth start operation

Add one server operation that starts Growth on request. It runs the same statement
as the feat-4 automatic move: it changes the plan to `growth` and records the
price version `wallet-growth-v1`. It queues the move notice only if that statement
commits.

Two entry points use it:

1. **Card setup with a purpose.** `POST /console/billing/card-setup` accepts
   `purpose: 'growth_start'`. The server stores the purpose with the setup
   session. When the server verifies that setup (reconcile or webhook), it starts
   Growth in the same transaction. Growth then starts even if the browser never
   returns from Stripe.
2. **Start with the card on file.** `POST /console/billing/plan/growth`, for an
   account that already has a usable card. It needs no Stripe step.

Rules:

- Only owners and billing administrators can start Growth. These are the same
  permissions as card setup.
- Start Growth only from `free`. On `growth`, return the current plan. On
  `enterprise`, refuse.
- A Free account that is stopped at a limit or at day 30 can start Growth. The
  verified card lifts the stop, as in feat-4.
- A replayed verification or a repeated request must not start Growth twice or
  move the start date.

### What Checkout charges

Checkout stays in setup mode. It saves the card and charges nothing on that day.

- A first payment at Checkout needs a Stripe payment-mode session or a Stripe
  subscription. feat-3 rules out a subscription engine, and feat-4 rules out a
  second billing path. The Platform ledger must own every charge.
- $99 a month accrues from the Growth start date. The feat-3 monthly close
  collects it. The first month is pro rata (the feat-4 default).
- The login page and the Stripe page must say this before the visitor enters a
  card: "Growth: $99 a month from today. We charge your card after each month."
  Check that Stripe's `custom_text` works in setup mode.
- Until the feat-3 close exists, Growth accounts accrue charges that nothing
  collects. See open decision 2.

## Plan intent: how the choice travels

The plan choice is an **intent**. It routes the visitor. Only the Growth start
operation changes the plan, and only after a verified card.

1. **Site link.** Free and Growth cards link to the Platform Console login:
   `<platform console origin>/dashboard/login?plan=free&src=pricing_card` (or
   `plan=growth`). Link to the Platform Console origin directly. The site's
   `/dashboard` redirect goes to the Wallet Console, which does not open
   onboarding for a new identity.
2. **Site setting.** Add the Platform Console origin to the seams-site build
   configuration, next to the existing Wallet origins. Take the value from the
   same source as `consoleSite.platformOrigin` in `scripts/deploy-surface.mjs`.
3. **Login page.** Read `plan` and `src`. Accept only `free` or `growth`, and only
   a known `src`. Store `{ plan, src, savedAtMs }` in `sessionStorage` under
   `seams.console.pendingPlanIntent`. Remove both parameters from the URL. This is
   the invitation pattern. The value survives the GitHub redirect in the same tab
   and the Google popup.
4. **Expiry.** Ignore an intent older than one hour. Clear it when the funnel ends:
   at the dashboard (Free), or at the Growth start or "Continue on Free" (Growth).
5. **Precedence.** A pending invitation wins. If both exist, drop the intent: the
   inviting organization already has a plan.
6. **Server record.** Send `planIntent` with `POST /console/onboarding/organization`.
   Store it in that request's existing audit event. It is for measurement. The
   card-setup `purpose` is the only server input that starts Growth.

Why not only a URL parameter: the GitHub callback URL is fixed, so a parameter is
lost at the OAuth redirect. Why not a server field before sign-in: there is no
identity to attach it to.

## Free funnel

### Steps and screens

| Step | Screen                      | What happens                                                                                                                             |
| ---- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Pricing page, Free card     | Link to the Platform Console login with `plan=free`.                                                                                     |
| 2    | Console login               | Store the intent. Show "Start on the Free plan" above the provider buttons.                                                              |
| 3    | Google popup or GitHub page | SSO. A new identity gets `console_identity_v1`.                                                                                          |
| 4    | Onboarding: organization    | Existing step. Send `planIntent: 'free'`.                                                                                                |
| 5    | Onboarding: first project   | Existing step. Creates the Development environment and the billing account.                                                              |
| 6    | Dashboard overview          | Show a plan summary: Free, 300 users, 30,000 signatures, card needed by the day-30 date. Link to the docs quick start. Clear the intent. |

The plan summary is new. The feat-4 banners start only on day 16, so without it a
new account sees no plan on day 0.

The Free plan keeps the feat-4 rules: a card after 30 days, and with a card on
file, the automatic move to Growth at the first Free limit.

### Visitor who already has an account

| Visitor state                                       | Result                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| Signed in to the Console                            | The login page resumes the session and opens the dashboard. Clear the intent. |
| Has an account, not signed in                       | SSO, then the dashboard. Clear the intent.                                    |
| Signed in, but no organization (onboarding stopped) | Onboarding resumes from saved records, with the intent.                       |
| Organization on Growth or Enterprise                | The dashboard. No change to the plan.                                         |
| Pending invitation                                  | The invitation. Drop the intent.                                              |

Do not create a second organization for a Free click. A visitor who wants another
free organization uses the existing "create organization" path.

### Failure and abandon paths

- **SSO popup closed, or the provider refuses:** stay on the login page with the
  existing error. The intent stays for a retry.
- **GitHub state mismatch or a provider that is not configured:** the existing
  messages.
- **Onboarding request fails:** the existing retry keeps the same project id.
- **Visitor leaves after sign-in:** the next sign-in resumes onboarding. In a new
  tab the intent is gone, and the visitor gets the Free path, which is the default.
- **Visitor leaves after onboarding:** the account is on Free. The feat-4 card
  reminders on day 16, 23, and 29 follow up.

## Growth funnel

### Steps and screens

| Step | Screen                              | What happens                                                                                                                                                     |
| ---- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Pricing page, Growth card           | Link to the Platform Console login with `plan=growth`.                                                                                                           |
| 2    | Console login                       | Store the intent. Show "Start Growth: $99 a month. Sign in, then add a card."                                                                                    |
| 3    | Google popup or GitHub page         | SSO.                                                                                                                                                             |
| 4    | "Setting up your organization"      | Automatic setup: create the organization and the first project with default names, with `planIntent: 'growth'`. No form. This also creates the billing account.  |
| 5    | Stripe Checkout, setup mode         | `POST /console/billing/card-setup` with `purpose: 'growth_start'`, then a redirect to Stripe. Stripe's custom text repeats the price.                            |
| 6    | Billing account, return from Stripe | The existing reconcile call. The server verifies the card and starts Growth in the same transaction. Show "Growth started" and the start date. Clear the intent. |
| 7    | Dashboard overview                  | The existing feat-4 `growth_move` banner. A prompt to name the organization, with the rename route. A link to the docs quick start.                              |

Automatic setup:

- **Organization name:** the email domain for a work address (`acme.com` gives
  "Acme"). Otherwise the display name ("Pat's organization"). The visitor renames
  it on the dashboard.
- **Project name:** "My first app". The project creates the Development
  environment, as in normal onboarding.
- The browser generates the project id once and keeps it in the onboarding draft,
  so a retry or a reload creates no second project.
- Onboarding still completes when the organization, project, and Development
  environment exist. Only the form is skipped.

The Growth start screen is a fallback only. It shows for the cases in the
next table, and after a Stripe cancel.

### Visitor who already has an account

The funnel acts on the selected organization. Screens name that organization and
link to the organization switcher.

| Visitor state                                | Result                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Signed in, one organization, Free, no card   | Straight to Stripe with `purpose: 'growth_start'`.                                                                          |
| Signed in, Free with a usable card           | Confirm screen: "Start Growth: $99 a month from today", card brand and last four. Then `POST /console/billing/plan/growth`. |
| Signed in, more than one organization        | Choose the organization first. Then the rows above.                                                                         |
| Signed in, already on Growth                 | "You are on Growth since <date>." Clear the intent.                                                                         |
| Signed in, on Enterprise                     | The dashboard. Drop the intent.                                                                                             |
| Signed in without billing permission         | "Ask an owner or a billing administrator to start Growth." Clear the intent.                                                |
| Free account stopped at a limit or at day 30 | Straight to Stripe. The verified card lifts the stop and starts Growth.                                                     |
| Has an account, not signed in                | SSO, then the rows above.                                                                                                   |
| Signed in, no organization                   | Automatic setup, then Stripe.                                                                                               |
| Pending invitation                           | The invitation. Drop the intent.                                                                                            |

### Failure and abandon paths

- **Automatic setup fails:** show the error and "Try again". The retry reuses the
  same project id. After two failures, offer the normal onboarding form.
- **Card setup does not start** (Stripe or the route fails): the Growth start
  screen, with the error, "Try again", and "Continue on Free". Keep the intent.
- **Visitor cancels in Stripe:** Stripe returns with `card_setup=cancel`. The
  Growth start screen, with "Try again" and "Continue on Free".
- **Card declined or 3-D Secure fails:** Stripe shows the error on its page. If the
  visitor leaves there, the Checkout session expires and nothing is stored.
- **Redirect arrives before Stripe confirms:** "Stripe has not confirmed the card
  yet." The webhook or the next reconcile verifies the card and starts Growth.
- **Visitor leaves in Stripe:** the organization stays on Free with no card, and
  with the default names. The feat-4 reminders follow up. Add one email on day 1
  for an organization with `planIntent: 'growth'` and no card: "Finish starting
  Growth". Send it once, through the feat-4 notice keys.
- **"Continue on Free":** clear the intent, open the dashboard. Record the event.

## Enterprise funnel

### Steps and screens

| Step | Screen                                   | What happens                                                                                           |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1a   | Pricing page, Enterprise card            | Link to `/contact/?plan=enterprise&src=pricing_card`.                                                  |
| 1b   | Pricing page, calculator "Contact sales" | Link to `/contact/?plan=enterprise&src=pricing_calculator&users=100000&per_day=10`.                    |
| 2    | Contact page                             | Show "Enterprise plan" above the form. Show a read-only line with the estimate, if values are present. |
| 3    | Submit                                   | Before feat-5: the `mailto:` body. After feat-5: the endpoint, with a `context` field.                 |
| 4    | Thank-you state                          | "Thank you. We will reply by email." Or the `mailto:` fallback.                                        |

### Prefill rules

- Accept `users` only if it is one of the calculator's `USER_STEPS`. Accept
  `per_day` only as a whole number from 1 to 50. Drop any other value.
- Recompute the estimate on the contact page from the same constants. Do not take
  prices from the URL. Move the constants and `estimate()` to one module that both
  pages import.
- Do not put the estimate into the editable "Project details" text. Show it as a
  separate line. The visitor can remove it with one control.
- Before feat-5, add the context lines to the `mailto:` body and the copy box:
  plan, users, signatures per day, Growth price, Enterprise floor, source.
- feat-5 change: add an optional `context` object to the request body:
  `{ plan: 'enterprise', source, users?, signaturesPerDay? }`, validated with the
  same rules. Put it in the sales email. Without this change, the route refuses the
  field.
- The Enterprise card carries no calculator values. The calculator state lives
  only in the calculator. Lift it to the page only if sales asks for it.

### Visitor who already has an account

The company site cannot read the Console session, because it is on another origin.
The contact form does not change for a signed-in visitor. Do not prefill an email
from the Console.

### Failure and abandon paths

- **Turnstile fails or the endpoint returns `5xx`:** the feat-5 `mailto:` fallback,
  with the context lines.
- **`429`:** the feat-5 "try again later" message.
- **Visitor leaves the form:** nothing is stored. Do not keep a draft.
- **Wrong or edited URL values:** drop them. Show the form without an estimate.

## Measurement

We do not track clicks on the company site. Counting starts at the Console login
page. For Enterprise, it starts at the sent inquiry.

### What to count

| Step                       | Event                           | Properties            | Source                        |
| -------------------------- | ------------------------------- | --------------------- | ----------------------------- |
| Login page with an intent  | `console_login_view`            | `plan`, `src`         | Console                       |
| New identity               | `console_identity_created`      | `plan`, `provider`    | Console session exchange      |
| Existing identity signs in | `console_signin_existing`       | `plan`, `provider`    | Console session exchange      |
| Organization created       | `onboarding_org_created`        | `plan`, `automatic`   | Existing audit event          |
| First project created      | `onboarding_project_created`    | `plan`, `automatic`   | Existing audit event          |
| Card setup started         | `card_setup_started`            | `purpose`             | Existing route                |
| Card setup canceled        | `card_setup_canceled`           | `purpose`             | Return URL                    |
| Card verified              | `card_verified`                 | `purpose`             | Existing reconcile or webhook |
| Growth started             | `growth_start`                  | `entry`               | Growth start operation        |
| Continue on Free           | `growth_continue_free`          | —                     | Console                       |
| Organization renamed       | `organization_renamed`          | `was_default`         | Existing rename route         |
| First production wallet    | `first_production_registration` | `plan`                | feat-4 production MAU facts   |
| Automatic move to Growth   | `growth_move`                   | `limit`               | Existing feat-4 move          |
| Inquiry sent               | `contact_submit`                | `src`, `spam_verdict` | feat-5 endpoint               |

### Rates to watch

- Free: login view → identity → organization → project → first production
  wallet.
- Growth: login view → identity → card started → card verified → Growth started,
  and "Continue on Free" as a share of card starts.
- Enterprise: inquiries per source (card or calculator).
- Time from sign-up to the first production wallet, per plan. This is the
  activation measure.
- Share of Growth intents that start Growth within 7 days.

### Rules

- Count on the server where the step is a server request. Use no third-party
  tracker in the Console.
- Store no IP address and no email in a funnel event. Use the account id only
  after sign-in.
- Keep event writes off the registration, unlock, and signing paths. Use the
  existing audit events and the outbox.

## Implementation phases

1. **Plan intent in the Console.** Login page parameters, the stored intent, the
   precedence rules, the `planIntent` audit field, routing after sign-in, and the
   login text per intent. Unit tests for parsing, expiry, and precedence.
2. **Site links.** The Platform Console origin setting. Free and Growth cards link
   to the login with an intent. The Enterprise card and the calculator link to the
   contact page with the context.
3. **Growth start operation.** The card-setup `purpose`, the start inside the
   verification transaction, `POST /console/billing/plan/growth`, and the rules in
   Decision 2. Tests through the shared billing factories: start once, replay,
   stopped account, Enterprise refusal, missing permission.
4. **Growth funnel screens.** Automatic setup, the straight redirect to Stripe,
   the Stripe custom text, the confirm screen, the fallback screen with "Continue
   on Free", the rename prompt, and the day-1 email.
5. **Free plan summary** on the dashboard overview.
6. **Contact prefill.** The shared estimate module, the prefill rules, and the
   `mailto:` lines. After feat-5: the `context` field.
7. **Measurement.** The events in the table, from the existing audit events where
   they exist.
8. **Acceptance.** A browser test per funnel against the local Console, with
   Stripe test mode for Growth: new visitor, signed-in visitor with and without a
   card, more than one organization, no billing permission, Stripe cancel, a
   reload during automatic setup, and a lost Stripe return (the webhook starts
   Growth). Check the `/dashboard` hop on the Wallet Console for a new identity,
   and fix or bypass it.

## Dependencies

- feat-4 released: the plan state, card setup, and the Growth move. They are on
  `dev` locally, not released.
- The prepaid `wallet.monthly_active_resource` charge must not apply to Free or
  Growth accounts before these funnels go live. Otherwise the page promises one
  price and production charges $3 per resource. Check whether production
  registration needs a prepaid balance today.
- feat-3 monthly close, to collect Growth charges. See open decision 2.
- feat-5, for the real contact endpoint. The Enterprise prefill works before it,
  through the `mailto:` body.

## Completion criteria

- Each card leads to its funnel, and the plan intent survives the Google popup,
  the GitHub redirect, and a reload in the same tab.
- A new Free visitor reaches the dashboard in one SSO click and two onboarding
  fields, and sees the Free plan on day 0.
- A new Growth visitor reaches Stripe after one SSO click and no form, and is on
  Growth when Stripe confirms the card, also if the browser never returns.
- Growth starts only from a verified card or an explicit confirm, never from the
  intent alone, and never twice.
- A signed-in visitor never repeats onboarding and never gets a second
  organization from a card click.
- The contact form shows the plan and the estimate from the calculator, recomputed
  from the shared constants.
- Every step in the measurement table records one event.

## Decisions

Recorded October 21, 2026:

1. **Growth starts at once.** The "card on file, move at the limit" state is for
   the Free plan only. A Growth click starts Growth at $99 a month.
2. **Sign-in, then straight to Checkout** for Growth, with automatic setup of the
   organization and the first project.
3. **No click tracking on the company site** for now.
4. **Google and GitHub first.** Apple sign-in is not needed for these funnels.
5. **No hero buttons.** They were removed in `f68933d3`. The plan cards are the
   only entry.
6. **No price lock.** Growth has no 12-month fixed-price period. It was never
   decided. The pricing page and the pricing document no longer state it. The
   feat-4 lock date, its email text, and its API field must go.
7. **Pro is a real plan** (October 22, 2026). It starts like Growth, from a verified
   card. Its price is a placeholder until approved: `wallet-pro-v1`, $399 a month with
   100,000 users included.
8. **Every plan card goes to the plan page** (October 22, 2026). Free, Growth and Pro
   all sign in, get the automatic setup, and open the plan page. Free does not show
   the onboarding form.

## Open decisions

1. **Monthly collection.** Base fees accrue durably. The monthly close must
   collect them before the paid funnel is deployed.
2. **Default organization name.** The email domain and the display name are a
   proposal.
