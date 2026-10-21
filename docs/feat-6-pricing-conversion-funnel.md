# Pricing page conversion funnel: plan

Status: proposed; implementation has not started.
Date: October 21, 2026.

## Outcome

A visitor clicks a plan card on the pricing page (`apps/seams-site/src/pages/pricing/page.tsx`)
and arrives at the right next step, with the plan choice kept:

- **Free:** sign in with SSO, create the organization and first project, open the
  dashboard on the Free plan.
- **Growth:** the same sign-in and onboarding, then card setup in Stripe Checkout,
  then the dashboard with the card on file and the Growth move ready.
- **Enterprise:** the contact form, filled in with the plan and the calculator
  values.

Each step records one funnel event, so we can see where visitors stop.

Prices and limits come from [Wallet pricing and costs](wallet-saas/pricing.md).
The Free plan state, card setup, and the Growth move come from
[the Free plan card plan](feat-4-free-plan-card-and-growth-move.md).

## Current state

Facts from the code on `dev`, October 21, 2026:

- **Plan cards.** All three cards are links. Free and Growth go to `/docs/concepts/`,
  Enterprise goes to `/contact/`. The hero "Start building" also goes to
  `/docs/concepts/`. No link carries the plan.
- **Calculator.** `EnterpriseCalculator.tsx` keeps the user count and the
  signatures per day in React state. Its "Contact sales" link goes to `/contact/`
  without these values.
- **Contact page.** It opens a `mailto:` link and shows a copy box. feat-5 plans a
  real endpoint, `POST /console/public/sales-inquiries`, with Turnstile. That
  route refuses unknown fields.
- **Console sign-in.** `apps/wallet-console/src/core/dashboard/login/page.tsx` has
  two providers only: Google (an ID token from a popup) and GitHub (a full-page
  OAuth redirect to a fixed callback). Apple was decided for the Platform Console
  but is not built. There is no email sign-in.
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
- **Price lock.** The pricing page says Growth prices are fixed "for 12 months from
  sign-up". feat-4 pins the lock on the day of the move to Growth. These differ.
- **Analytics.** The company site and the Console have no analytics script.

## Evaluation of the starting idea

| Card       | Starting idea                                     | Verdict                                                        |
| ---------- | ------------------------------------------------- | -------------------------------------------------------------- |
| Free       | Create an account and sign in                     | Keep. Go to the Platform Console login, not to the docs.       |
| Growth     | Checkout first; the account is made after payment | Change. Sign in first, then card setup. See decisions 1 and 2. |
| Enterprise | The contact form                                  | Keep. Add the plan and the calculator values to the form.      |

The Free and Enterprise parts fit the code with small changes. The Growth part
does not fit. It needs a Stripe Customer before a billing account exists, it needs
account linking by email, and it would take no payment, because a Growth charge
cannot be made today.

## Decision 1: guest checkout or sign-in first

| Question                      | Guest checkout, account after payment                                                                                                                                                       | Sign-in first, then card setup (recommended)                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Stripe Customer               | Made before a billing account exists. It must move to the account later. feat-3 requires one persisted Customer per account, made by the server, never chosen by browser input.             | Made for the billing account by the existing route.          |
| Who owns the result           | Only the email that the visitor typed into Stripe. Stripe does not verify it.                                                                                                               | The SSO identity. Google and GitHub verify the email.        |
| Account linking               | Needed: link the paid checkout to an SSO account by email.                                                                                                                                  | Not needed.                                                  |
| Takeover risk                 | Yes. An attacker types a victim's work email and prepares an account that the victim later joins. Or an attacker signs in with an unverified provider email and claims a victim's checkout. | None added. Card setup runs inside an authenticated session. |
| Safe form of linking          | A claim link sent by email, opened before sign-in. That is an extra email step, and longer than one SSO click.                                                                              | —                                                            |
| Visitor steps before the card | Zero, but a claim email and a sign-in follow.                                                                                                                                               | One SSO click and two onboarding fields.                     |
| Abandon after Stripe          | A Customer and a card with no account. Cleanup work.                                                                                                                                        | An organization on Free. The feat-4 reminders follow up.     |
| New code                      | Public checkout route, orphan Customers, claim tokens, linking rules.                                                                                                                       | A stored intent and one billing panel. The routes exist.     |

**Recommendation: sign-in first.** SSO is one click, so the guest flow saves almost
nothing. It adds a takeover risk and a second Customer path that feat-3 forbids.

## Decision 2: what the Growth "checkout" charges today

**Recommendation: card setup only, with no first payment.**

- A first payment needs a Stripe payment-mode session or a Stripe subscription.
  feat-3 rules out a subscription engine, and feat-4 rules out a second billing
  path. The Platform ledger must own every charge.
- Growth charges start with the feat-3 monthly close. Until it exists, a Growth
  account accrues no collectable charge.
- Below 300 users, Growth gives nothing that Free with a card does not give.
  feat-4 already moves a Free account with a card to Growth at the first Free
  limit, with no stop. A $99 charge before that point buys nothing.

So the Growth funnel ends in a **Growth-ready** state: plan `free`, card on file,
and the automatic move at the first Free limit. The card page says "$0 today".

If we want Growth to start at once (for revenue or for the price lock), we need a
new operation that moves the plan on request. See open decision 1.

## Plan intent: how the choice travels

The plan choice is an **intent**, not a plan state. It routes the visitor. It does
not change what the account pays. The plan state stays the feat-4 state.

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
   at the dashboard (Free), or at card verification or "Continue on Free"
   (Growth).
5. **Precedence.** A pending invitation wins. If both exist, drop the intent: the
   inviting organization already has a plan.
6. **Server record.** Send `planIntent` with `POST /console/onboarding/organization`.
   Store it in that request's existing audit event only. It is for measurement. No
   code reads it to decide a price.

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
| 5    | Onboarding: first project   | Existing step. Creates the Development environment.                                                                                      |
| 6    | Dashboard overview          | Show a plan summary: Free, 300 users, 30,000 signatures, card needed by the day-30 date. Link to the docs quick start. Clear the intent. |

The plan summary is new. The feat-4 banners start only on day 16, so without it a
new account sees no plan on day 0.

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

| Step | Screen                              | What happens                                                                                                                                                                                                                     |
| ---- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Pricing page, Growth card           | Link to the Platform Console login with `plan=growth`.                                                                                                                                                                           |
| 2    | Console login                       | Store the intent. Show "Start on Growth: sign in, then add a card. $0 today."                                                                                                                                                    |
| 3    | Google popup or GitHub page         | SSO.                                                                                                                                                                                                                             |
| 4    | Onboarding: organization            | Existing step. Send `planIntent: 'growth'`. Show "Next: add a card" in the stepper.                                                                                                                                              |
| 5    | Onboarding: first project           | Existing step.                                                                                                                                                                                                                   |
| 6    | Billing account: Growth setup panel | New panel on `/dashboard/billing/account`. Text: "$0 today. You move to Growth, $99 a month, when you pass 300 users or 30,000 signatures. Growth prices are fixed for 12 months." Buttons: "Add a card" and "Continue on Free". |
| 7    | Stripe Checkout, setup mode         | Existing `POST /console/billing/card-setup`.                                                                                                                                                                                     |
| 8    | Billing account, return from Stripe | Existing reconcile call. On a verified card, show "You are ready for Growth" and "Open dashboard". Clear the intent.                                                                                                             |
| 9    | Dashboard overview                  | A new `growth_ready` banner: "Card on file. You move to Growth at the first Free limit, with no stop."                                                                                                                           |

The onboarding contract does not change: onboarding still ends when the
organization, project, and Development environment exist. The Growth panel comes
after it, and the login page sends the visitor there when the intent is `growth`.

`growth_ready` is a derived banner: plan `free` and a usable card. Add it to the
feat-4 evaluation. It needs no new stored state.

### Visitor who already has an account

The panel acts on the selected organization. It names that organization and links
to the organization switcher.

| Visitor state                                   | Result                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Signed in, organization on Free, no usable card | The Growth setup panel.                                                             |
| Signed in, Free with a usable card              | "You are ready for Growth." No Stripe step. Clear the intent.                       |
| Signed in, already on Growth                    | "You are on Growth since <date>. Prices fixed until <date>." Clear the intent.      |
| Signed in, on Enterprise                        | The dashboard. Drop the intent.                                                     |
| Signed in without billing permission            | "Ask an owner or a billing administrator to add a card." Clear the intent.          |
| Free account stopped at a limit or at day 30    | The panel, with the existing stop message. A verified card lifts the stop (feat-4). |
| Has an account, not signed in                   | SSO, then the rows above.                                                           |
| Signed in, no organization                      | Onboarding resumes, then the panel.                                                 |
| Pending invitation                              | The invitation. Drop the intent.                                                    |

### Failure and abandon paths

- **Card setup does not start** (Stripe or the route fails): show the error, "Try
  again", and "Continue on Free". Keep the intent.
- **Visitor cancels in Stripe:** Stripe returns with `card_setup=cancel`. Show the
  existing message, "Try again", and "Continue on Free".
- **Card declined or 3-D Secure fails:** Stripe shows the error on its page. If the
  visitor leaves there, the Checkout session expires and nothing is stored.
- **Redirect arrives before Stripe confirms:** the existing "Stripe has not
  confirmed the card yet" message. The webhook or the next reconcile completes it.
- **Visitor leaves at the panel or in Stripe:** the organization stays on Free with
  no card. The feat-4 reminders follow up. Add one email on day 1 for an
  organization with `planIntent: 'growth'` and no card: "Finish your Growth setup".
  Send it once, through the feat-4 notice keys.
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

### What to count

| Step                        | Event                           | Properties            | Source                             |
| --------------------------- | ------------------------------- | --------------------- | ---------------------------------- |
| Card click                  | `pricing_plan_click`            | `plan`, `src`         | Company site (see open decision 3) |
| Login page with an intent   | `console_login_view`            | `plan`, `src`         | Console                            |
| New identity                | `console_identity_created`      | `plan`, `provider`    | Console session exchange           |
| Existing identity signs in  | `console_signin_existing`       | `plan`, `provider`    | Console session exchange           |
| Organization created        | `onboarding_org_created`        | `plan`                | Existing audit event               |
| First project created       | `onboarding_project_created`    | `plan`                | Existing audit event               |
| Growth panel shown          | `growth_panel_view`             | `account_state`       | Console                            |
| Card setup started          | `card_setup_started`            | `plan`                | Existing route                     |
| Card setup canceled         | `card_setup_canceled`           | `plan`                | Return URL                         |
| Card verified               | `card_verified`                 | `plan`                | Existing reconcile or webhook      |
| Continue on Free            | `growth_continue_free`          | —                     | Console                            |
| First production wallet     | `first_production_registration` | `plan`                | feat-4 production MAU facts        |
| Move to Growth              | `growth_move`                   | `limit`               | Existing feat-4 move               |
| Contact page with an intent | `contact_view`                  | `src`, `has_estimate` | Company site                       |
| Inquiry sent                | `contact_submit`                | `src`, `spam_verdict` | feat-5 endpoint                    |
| Fallback used               | `contact_fallback`              | `reason`              | Company site                       |

### Rates to watch

- Free: click → login view → identity → organization → project → first
  production wallet.
- Growth: the same, then panel → card started → card verified, and "Continue on
  Free" as a share of panel views.
- Enterprise: click → contact view → inquiry sent → fallback share.
- Time from sign-up to the first production wallet, per plan intent. This is the
  activation measure.
- Share of Growth intents that reach a verified card within 7 days.

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
2. **Site links.** The Platform Console origin setting. Free and Growth cards and
   the hero "Start building" link to the login with an intent. The Enterprise card
   and the calculator link to the contact page with the context.
3. **Growth setup panel.** The panel and its account-state table, "Continue on
   Free", the `growth_ready` banner, and the day-1 "Finish your Growth setup"
   email. Reuse the feat-4 card-setup routes.
4. **Free plan summary** on the dashboard overview.
5. **Contact prefill.** The shared estimate module, the prefill rules, and the
   `mailto:` lines. After feat-5: the `context` field.
6. **Measurement.** The events in the table, from the existing audit events where
   they exist.
7. **Acceptance.** A browser test per funnel against the local Console, with
   Stripe test mode for the Growth card: new visitor, signed-in visitor, visitor
   without billing permission, Stripe cancel, and a reload in the middle. Check
   that an intent never changes the stored plan or a price. Check the `/dashboard`
   hop on the Wallet Console for a new identity, and fix or bypass it.

## Dependencies

- feat-4 released: the plan state, card setup, and the Growth move. They are on
  `dev` locally, not released.
- The prepaid `wallet.monthly_active_resource` charge must not apply to Free or
  Growth accounts before these funnels go live. Otherwise the page promises $0 and
  production charges $3 per resource. Check whether production registration needs
  a prepaid balance today.
- feat-3 monthly close, before any Growth account pays.
- feat-5, for the real contact endpoint. The Enterprise prefill works before it,
  through the `mailto:` body.

## Completion criteria

- Each card leads to its funnel, and the plan intent survives the Google popup,
  the GitHub redirect, and a reload in the same tab.
- A new Free visitor reaches the dashboard in one SSO click and two onboarding
  fields, and sees the Free plan on day 0.
- A new Growth visitor reaches a verified card and the `growth_ready` banner, and
  pays nothing on that day.
- A signed-in visitor never repeats onboarding and never gets a second
  organization from a card click.
- An intent never changes a stored plan, a price version, or a lock date.
- The contact form shows the plan and the estimate from the calculator, recomputed
  from the shared constants.
- Every step in the measurement table records one event.

## Open decisions

1. **Growth on request.** Keep the Growth-ready state (this plan), or add an
   operation that moves an account to Growth when the visitor asks. The second
   charges $99 a month from that day, once the feat-3 close exists, and starts the
   price lock at once.
2. **Price lock start.** The pricing page says "12 months from sign-up". feat-4
   pins the lock at the move to Growth. Change the page text to "from your move to
   Growth", or pin the lock at card setup for a Growth intent.
3. **Click counting on the company site.** The site has no analytics. Options:
   Cloudflare Web Analytics (no cookies, page views only), or a count at the
   Console login page only (no site event). The second loses visitors who never
   reach the login page.
4. **Apple sign-in.** It was decided for the Platform Console but is not built.
   Decide if it must ship before these funnels.
5. **Hero "Start building".** Send it to the Free funnel (this plan) or keep the
   docs link. The docs stay one click away from the dashboard.
