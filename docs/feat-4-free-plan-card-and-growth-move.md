# Free plan card requirement and Growth move: implementation plan

Status: proposed; implementation has not started.
Date: October 21, 2026.

## Outcome

1. A developer organization uses the Free plan without a card for its first 60
   days. From day 60, production needs a card on file to continue.
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

### Card after 60 days

- Day 0 is the date the organization is created. For organizations that exist
  when this ships, day 0 is the release date, so each one gets the full 60 days.
- A card on file is not charged while usage stays inside the Free limits.
- From day 60 without a usable card, production is restricted:
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
- The Growth price version is pinned on the day of the move, for 12 months.
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
| Day 30, no card           | "Add a card by <date> to keep production running."            |
| Day 46, no card           | Same, 14 days before.                                         |
| Day 53, no card           | Same, 7 days before.                                          |
| Day 59, no card           | Same, 1 day before.                                           |
| Day 60, no card           | "Production is paused until you add a card."                  |
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
- Add a daily scheduled pass that finds accounts at day 30, 46, 53, 59, and 60
  without a usable card, and accounts at 80% or 100% of a Free limit.
- Record each sent notice with a unique key (account, notice kind, month or
  day). A retry must not send a second email.
- Show the matching banner in the Console billing pages and the dashboard.

### 5. Automatic move to Growth

- When an account with a usable card reaches 100% of a Free limit, change its
  plan to `growth` in one transaction. Pin the Growth price version and its
  12-month lock date in the same transaction.
- Send the move notice after the transaction commits.
- When a verified card arrives for an account in `free_limit_reached`, run the
  same move, then set the production state to `active`.
- Bill Growth through the feat-3 monthly close. Add no second billing path.

### 6. Acceptance

- Unit and relayer tests through the shared billing factories: the day-60
  transition, the 80% and 100% thresholds, the move with and without a card,
  duplicate events, and a card that expires.
- A staging run with Stripe test mode: create an organization, move its clock,
  pass day 60 without a card, add a test card, pass a Free limit, and check each
  email, banner, plan change, and production refusal.
- Check that recovery and key export work in every restricted state.

## Completion criteria

- An organization without a card can use production for 60 days, and then
  production pauses until a card is verified.
- Every notice in the table is sent once, at the right time, by email and
  banner.
- An organization with a card moves to Growth at the first Free limit, with no
  production stop, and its Growth price is pinned for 12 months.
- Development environments are never restricted and never counted.
- Recovery and key export stay open in every state.
- No new serial Console call or database round trip is on the registration,
  unlock, or signing path.

## Open decisions

1. **Clock start:** organization creation (this plan) or the first production
   activation. The second is fairer to teams that develop for a long time.
2. **Growth billing start:** pro rata from the day of the move (this plan) or
   from the next month. Privy starts billing the month after the move.
3. **Notice days:** 30, 46, 53, 59, and 60 are proposals.
4. **In-flight sessions at a stop:** whether a signing session that started
   before the stop can finish.
