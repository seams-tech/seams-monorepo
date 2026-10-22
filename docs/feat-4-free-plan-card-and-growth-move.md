# Free plan card requirement and Growth move: implementation plan

Status: phases 1–5 implemented on `dev`; signature counts and the SDK code wait for a
seams-wallet release. See [Implementation status](#implementation-status).
Date: October 21, 2026.

## Outcome

1. A developer organization uses the Free plan without a card for its first 30
   days. From day 30, production needs a card on file to continue.
2. Before an organization goes over the Free limits, we warn it that it will
   move to Growth. With a card on file, the move is automatic. Without a card, the
   hard stop applies.

The prices and limits come from [Wallet pricing and costs](wallet-saas/pricing.md):
Free covers 300 production MAU and 30,000 production signatures a month. Growth
is $99 a month with 5,000 MAU, then $0.004 per MAU.

## Dependencies

- [Monthly postpaid Platform billing](feat-3-platform-billing.md), phase 1:
  the Stripe Customer mapping, card setup through Stripe Checkout in setup mode,
  and the verified "usable payment method" state. This plan reuses them and adds
  no second card flow.
- Production-only metering: MAU and signature counts per billing account and UTC
  month, with Development environments excluded. The current Wallet meter
  (`wallet.monthly_active_resource`, $3 per resource) does not count users or
  signatures. Phase 2 below adds the counts.
- The existing Console email outbox (`packages/console-server-ts/src/email/`)
  and the existing scheduled Console work.

## Rules

### Card after 30 days

- Day 0 is the date the organization is created. For organizations that exist
  when this ships, day 0 is the release date, so each one gets the full 30 days.
- A card on file is not charged while usage stays inside the Free limits.
- From day 30 without a usable card, production is restricted:
  - New sign-ups and new signatures stop in production environments.
  - Recovery and key export stay open, with rate limits.
  - Development environments keep working. They run on testnet only.
  - The Console stays open for payment setup, settings, and data export.
- When a usable card is verified, the restriction ends at once.
- An expired or removed card has the same effect as no card. Use the same
  restriction and the same reminders.

### Warnings and the move to Growth

| Event                            | Card on file                                       | No card                                        |
| -------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| 80% of a Free limit in the month | Notice: "You will move to Growth at the limit."    | Notice: "Add a card before the limit."         |
| 100% of a Free limit             | Move to Growth at once. No stop. Notice with price | Hard stop in production. Notice: "Add a card." |
| Card added after a hard stop     | —                                                  | Move to Growth at once. Production resumes.    |

- A Free limit is 300 MAU or 30,000 signatures, whichever comes first.
- Send each notice once per threshold per month.
- The move records the Growth price version (`wallet-growth-v1`). Growth has no
  price lock.
- Growth charges start on the day of the move. The month of the move is charged
  pro rata. See open decision 2.
- An organization stays on Growth until an owner switches it back. An owner can
  switch back at the start of a month if the previous month stayed inside the Free
  limits.

### Notices

Every notice goes to organization owners and billing administrators, both as an
email and as a Console banner. The banner stays until the condition ends.

| Day or event              | Message                                                       |
| ------------------------- | ------------------------------------------------------------- |
| Day 16, no card           | "Add a card by <date> to keep production running."            |
| Day 23, no card           | Same, 7 days before.                                          |
| Day 29, no card           | Same, 1 day before.                                           |
| Day 30, no card           | "Production is paused until you add a card."                  |
| 80% of a Free limit       | As in the table above.                                        |
| Move to Growth            | "Your organization moved to Growth: $99 a month from <date>." |
| Hard stop at a Free limit | "Production sign-ups or signing are paused. Add a card."      |

## Implementation phases

### 1. Plan state and the card clock

- Add a persisted plan state per billing account: `free`, `growth`, or
  `enterprise`, with the plan start date and the pinned price version. Use a
  forward migration. Keep existing records.
- Add the Free start date (day 0). Backfill existing organizations with the
  release date.
- Derive "card ready" from the feat-3 payment-method state. Do not store a
  second copy.
- Add one derived production state per billing account: `active`,
  `card_required`, or `free_limit_reached`. Compute it in scheduled work and on
  verified card events. Persist it.

### 2. Production MAU and signature counts

- Count production MAU and production signatures per billing account and UTC
  month. Exclude Development environments.
- Feed the counts from the existing durable usage outbox. Do not add Console
  calls to the registration, unlock, or signing request paths.
- Keep the counts idempotent. A replayed usage event must not count twice.

### 3. Enforcement in production

- Read the persisted production state inside the existing admission operations
  for registration and signing. Add no new serial database round trip on these
  paths. Verify the Wallet query budgets.
- In `card_required` and `free_limit_reached`, refuse new sign-ups and new
  signatures in production with a stable error code that the SDK can show.
- Keep recovery and key export open in every state. Apply their existing rate
  limits; tighten them only if we find abuse.
- Do not apply the restriction to Development environments.

### 4. Notices

- Add Console email templates for each notice in the table above.
- Add a daily scheduled pass that finds accounts at day 16, 23, 29, and 30
  without a usable card, and accounts at 80% or 100% of a Free limit.
- Record each sent notice with a unique key (account, notice kind, month or
  day). A retry must not send a second email.
- Show the matching banner in the Console billing pages and the dashboard.

### 5. Automatic move to Growth

- When an account with a usable card reaches 100% of a Free limit, change its
  plan to `growth` in one transaction. Record the Growth price version in the
  same transaction.
- Send the move notice after the transaction commits.
- When a verified card arrives for an account in `free_limit_reached`, run the
  same move, then set the production state to `active`.
- Bill Growth through the feat-3 monthly close. Add no second billing path.

### 6. Acceptance

- Unit and relayer tests through the shared billing factories: the day-30
  transition, the 80% and 100% thresholds, the move with and without a card,
  duplicate events, and a card that expires.
- A staging run with Stripe test mode: create an organization, move its clock,
  pass day 30 without a card, add a test card, pass a Free limit, and check each
  email, banner, plan change, and production refusal.
- Check that recovery and key export work in every restricted state.

## Completion criteria

- An organization without a card can use production for 30 days, and then
  production pauses until a card is verified.
- Every notice in the table is sent once, at the right time, by email and
  banner.
- An organization with a card moves to Growth at the first Free limit, with no
  production stop, and its Growth price version is recorded.
- Development environments are never restricted and never counted.
- Recovery and key export stay open in every state.
- No new serial Console call or database round trip is on the registration,
  unlock, or signing path.

## Open decisions

1. **Clock start:** organization creation (this plan) or the first production
   activation. The second is fairer to teams that develop for a long time.
2. **Growth billing start:** pro rata from the day of the move (this plan) or
   from the next month. Privy starts billing the month after the move.
3. **Notice days:** 16, 23, 29, and 30 are proposals.
4. **In-flight sessions at a stop:** whether a signing session that started
   before the stop can finish.

## Implementation status

Implemented on `dev` (October 21, 2026), with the proposed defaults for every open
decision:

- **Card setup (minimum of feat-3 phase 1).** One persisted Stripe Customer per
  billing account, card setup through Checkout in setup mode, verification by a
  server-side Stripe lookup (never by the redirect), the card as the Customer's
  invoice default, and removal from `payment_method.detached`. Routes:
  `GET /console/billing/plan`, `POST /console/billing/card-setup`,
  `POST /console/billing/card-setup/reconcile`. Code:
  `packages/console-server-ts/src/billing/freePlan.ts`, `freePlanD1.ts`,
  `freePlanSchema.ts`.
- **Plan state and card clock.** Migration `0010` (Console core) and `0101` (Wallet
  Console) add the plan, the card clock, the production state, verified cards, usage
  counts, and sent notices. Existing billing accounts start on the release date.
- **Production MAU.** Registration completion and each session publication append one
  outbox fact per established wallet and UTC month, in `prod` environments only, to
  their existing batch. The scheduled delivery counts each fact once.
- **Enforcement.** The atomic registration reservation refuses new production
  sign-ups with `production_paused` while the persisted state is not `active`. The
  check adds no statement on the success path. Unlock, recovery, and key export do
  not read the state.
- **Notices and banners.** One `FREE_PLAN_NOTICE` email family, each notice keyed
  once per account; banners on the billing page and the dashboard.
- **Growth move.** One D1 batch records the prorated first-month base charge,
  changes the plan, and pins `wallet-growth-v1`. The move notice queues only
  when the plan change commits.
- **No price lock.** Migrations `0011` (Console core) and `0103` (Wallet Console)
  remove the 12-month lock date, its check, and its trigger. The lock was never a
  pricing decision.
- **Test.** `tests/e2e/console/shared-account-free-plan.e2e.test.ts`.
- **Signing stop.** The Console pushes each production lane's decision to its regional
  Wallet runtimes, which install it as the project's normal-signing policy. Signing
  admission already reads that policy and refuses with `project_policy_rejected`.
  Recovery and key export do not read it. Migration `0102` records the last push.
- **Signature counts.** seams-wallet migration `0082` records each successful
  signature in the statement that completes its operation. The Gateway's scheduled
  work sends the rows to the Console, which counts each signing operation once.
- **SDK error code.** seams-wallet keeps the server's code on a refused setup, so the
  SDK reports `production_paused`.

Not built yet:

- **seams-wallet release.** Signature counts and the SDK code need an
  `@seams/wallet-server` and `@seams/wallet` release with seams-wallet `b5f523cb` and
  `e7e289ad`, and the private pins moved to it. Deploy the private Gateway only with
  that release; without migration `0082` its scheduled delivery fails.
- **In-flight signatures at a stop.** A signature prepared before the stop cannot be
  finalized after it (open decision 4).
- **Growth charges.** The plan and price are persisted, but the feat-3 monthly close
  that bills them does not exist. The existing `wallet.monthly_active_resource`
  prepaid charge still applies.
- **Switch back to Free**, the Stripe test-mode staging run, and the existing credit
  purchase flow's own Stripe Customer creation, which does not use the persisted
  mapping.
