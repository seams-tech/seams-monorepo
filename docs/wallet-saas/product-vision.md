# Product vision: Agent-driven business payments

Date created: June 20, 2026
Last revised: September 15, 2026

Status: proposed direction. R130A–D define the implementation plan; connected
payment integrations and their execution capabilities still require verification.

## The product

Seams lets people give agents bounded authority to prepare and carry out business
payments. Humans connect funding accounts, establish spending rules, and approve
payments when required. Agents propose the recipient, amount, and business purpose.
Seams checks authority, preserves the exact approved terms, and tracks the outcome.

Wallet Console is the human control surface. Agent runtimes and embedded apps
connect through scoped backend tools. Seams Wallet supplies wallet authentication,
custody, and onchain execution for the flows that need them.

## Priorities

1. **Wise business payments:** support Japanese companies first. Connect an
   eligible Wise business account and deliver transfer proposals, exact human
   approvals, and durable status. Verify automated transfer execution and Wise
   debit card API access as separate capabilities.
2. **Airwallex card payments:** add broad merchant purchasing for eligible
   account/issuing programs. Complete the wallet-funded sandbox card journey,
   including approval, authorization/capture, receipts, and reconciliation.
3. **Traditional bank transfers:** add one selected banking integration and
   approved beneficiaries through the same proposal and approval services.

Support for Japanese companies is a launch requirement. Prove the Japanese
company can own and use the source account for the selected payment flow. Wise
and bank integrations use their own funds and require no Seams escrow deposit.
Add provider-specific state and UI as each phase is implemented.

Wise supports [Japanese business accounts](https://wise.com/help/articles/2972549/how-do-i-verify-my-japanese-business)
and [business debit cards](https://wise.com/help/articles/2935775/can-my-business-get-a-wise-card),
subject to eligibility and verification. The account-owning representative must
reside in Japan. Standard business API tokens cannot fund transfers for Japanese
accounts. The first milestone therefore centers on proposals and human approvals;
automatic execution requires confirmed broader access. Wise card APIs also require
separate verification. [Wise API access](https://docs.wise.com/guides/developer/auth-and-security/personal-api-token)

Airwallex's [Japan card offering](https://www.airwallex.com/ja-jp/spend-management/cards)
currently excludes Japanese corporate card issuance. Keep it as a later option
for verified eligible programs; Japanese business support must work independently.

## One owner and agent experience

```text
Connect an account -> grant agent authority -> propose a payment
  -> check policy -> approve exact terms when required
  -> separately authorize execution -> reconcile -> inspect the result
```

For example, a Japanese business owner gives a procurement agent a ¥100,000 grant,
a ¥20,000 per-payment limit, approved suppliers, an expiry date, and an approval
threshold of ¥5,000. The agent proposes a supported Wise supplier transfer with
a total debit of ¥8,000. Console shows the funding account,
recipient, total debit including fees, delivery amount, and payment reference.
The owner approves those exact terms. Console shows any action required in Wise.
Where execution access has been verified, a separately authorized execution
rechecks the grant and funds before submitting the payment.

A proposal can be useful before execution is enabled. Preparing or approving it
moves no money. Proposal-only agent access cannot submit payments. Owners can
inspect proposed, approved, submitted, pending, completed, failed, and unresolved
payments without confusing an approval with a completed transfer.

## Responsibilities

| Component                           | Responsibility                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Account owner and authorized humans | Connect accounts, enroll recipients and agents, grant authority, approve exceptions, revoke access.                                       |
| Agent runtime or host app           | Conversation, task planning, invoice/purchase context, and payment proposals.                                                             |
| Seams payment services              | Account/agent bindings, grants, exact approvals, budget reservations, durable payment identity, provider integration, and reconciliation. |
| Wallet Console                      | Accounts, agents, payment proposals, approvals, execution status, and financial activity.                                                 |
| Seams Wallet                        | Wallet authentication, custody, signing, and onchain execution.                                                                           |
| Bank/payment provider               | Account capabilities, payment processing, authoritative outcomes, and provider-enforced controls.                                         |

A business/customer's account ownership is distinct from a Console tenant, an
integrator credential, and an agent identity. Enrollment binds them explicitly.
Provider credentials stay in private adapters; agent credentials stay in the
integrator backend. Neither belongs in model context.

## Financial rules

- A grant allocates permission against a funding account. It creates no money.
- Approval binds account, recipient/destination, operation/provider, amounts,
  fees, conversion terms, and reference. Changed terms need a new proposal and
  any required approval. Approval cannot exceed hard grant limits.
- Admission checks current authority and atomically reserves Seams account
  capacity and agent budget. Competing agents share the same account boundary.
- External account balances remain provider-owned observations. Local reservations
  cannot prevent spending through other channels; execution rechecks availability
  and handles provider rejection and subsequent outcomes.
- One proposal has one durable execution identity. Retries and duplicate events
  cannot produce additional payments or repeat accounting effects.
- Unknown payment outcomes retain their claims until reconciled. Confirmed returns
  restore applicable funds without automatically renewing consumed agent budget.
- Revocation blocks new admissions. Accepted payments retain their reconciliation
  history and follow the provider's cancellation or return semantics.

Operation and provider remain separate concepts: Wise can execute bank transfers.
Implement concrete supported combinations around the shared services, beginning
with Wise transfers for Japanese business accounts. Wise is also the first card
candidate to validate for these businesses; debit card availability alone cannot
establish agent card issuance or automated spending controls.

## Account and card funding

The first Wise path spends from the business's Wise account. Its balance, Seams
reservations, and agent grants have distinct meanings. Account connection creates
no funds, and unavailable balance evidence blocks automatic execution.

The later Airwallex sandbox path uses an owner-initiated transfer of testnet
stablecoins from the Seams wallet to controlled escrow. Finalized deposits credit card capacity
once, after confirmed sandbox funding evidence. The fiat bridge is explicitly
simulated. Ordinary wallet balances and platform billing credits cannot create
card capacity or fund a connected Wise or bank account.

The sandbox proof covers wallet funding, bounded card spending, and reconciliation.
Production custody, conversion, issuer liquidity, and settlement need separate
implementation and provider agreements.

## Delivery

The plans are maintained in the sibling `seams-wallet` repository. Hosted business
payment services, provider operations, Console UI, and composed tests belong in
this private repository; reusable Wallet contracts remain in `seams-wallet`.

| Plan                                                                        | Responsibility                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [R130A](../../../seams-wallet/docs/refactor-130A-agent-expense-domain.md)   | Funding accounts, grants, payment proposals, exact approvals, admission, and accounting.                    |
| [R130B](../../../seams-wallet/docs/refactor-130B-agent-connections.md)      | Authenticated agent connections and scoped proposal/status/execution tools.                                 |
| [R130C](../../../seams-wallet/docs/refactor-130C-agent-expense-console.md)  | Console and embedded account, agent, proposal, approval, and activity views.                                |
| [R130D](../../../seams-wallet/docs/refactor-130D-wise-and-payment-rails.md) | Wise first for Japanese businesses, eligible Airwallex cards second, then bank adapters and their evidence. |

First complete the Japanese business Wise account, transfer proposal, and exact
approval journey through one agent integration. Record execution permissions,
provider action requirements, and card API eligibility explicitly. Then add the
eligible Airwallex sandbox card journey and one traditional banking integration.
Each phase has its own completion criteria; later integrations do not delay Wise.

Report transfer execution support separately for each adapter. Confirm account
access, Japan eligibility, and supported test capabilities before claiming an
integration works. A working proposal cannot establish execution availability.
Live funds movement, autonomous scheduling, and hosting full business agents are
subsequent work. The first deliverable is a usable Wise payment-proposal and
approval workflow for Japanese companies, with durable status, explicit human
authority, and software-enforced admission wherever execution is enabled.
