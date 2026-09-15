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

1. **Airwallex card payments:** the first path for broad merchant purchasing.
   Complete the wallet-funded sandbox card journey, including exact approval,
   authorization/capture, receipts, and reconciliation.
2. **Wise transfers:** add owner-connected Wise accounts and Japan-relevant
   payment proposals with recipient, quote, currencies, fees, and source debit.
3. **Traditional bank transfers:** add one selected banking integration and
   approved beneficiaries through the same proposal and approval services.

Deliver these in order. Wise and bank integrations use their own funding sources
and need no Seams escrow deposit. Add their provider-specific state and UI as each
phase is implemented.

Japan is a target market. Airwallex's
[Japan card page](https://www.airwallex.com/ja-jp/spend-management/cards) currently
states that corporate cards and global accounts are unavailable there. Keep
Airwallex first while confirming issuing eligibility for the actual business.
R130D requires verification of Wise's Japan transfer and API capabilities.

## One owner and agent experience

```text
Connect an account -> grant agent authority -> propose a payment
  -> check policy -> approve exact terms when required
  -> separately authorize execution -> reconcile -> inspect the result
```

For example, an owner gives a procurement agent a $1,000 grant, a $200 per-payment
limit, approved suppliers, an expiry date, and an approval threshold of $50. The
agent proposes an $80 supplier payment. Console shows the funding account,
recipient, total debit including fees, delivery amount, and payment reference.
The owner approves those exact terms. A separately authorized execution rechecks
the grant and funds before submitting the payment.

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
with Airwallex cards.

## Wallet and card funding

The Airwallex sandbox path uses an owner-initiated transfer of testnet stablecoins
from the Seams wallet to controlled escrow. Finalized deposits credit card capacity
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

| Plan                                                                       | Responsibility                                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [R130A](../../../seams-wallet/docs/refactor-130A-agent-expense-domain.md)  | Funding accounts, grants, payment proposals, exact approvals, admission, and accounting. |
| [R130B](../../../seams-wallet/docs/refactor-130B-agent-connections.md)     | Authenticated agent connections and scoped proposal/status/execution tools.              |
| [R130C](../../../seams-wallet/docs/refactor-130C-agent-expense-console.md) | Console and embedded account, agent, proposal, approval, and activity views.             |
| [R130D](../../../seams-wallet/docs/refactor-130D-airwallex-card-rail.md)   | Airwallex cards first, Wise second, then traditional bank adapters and their evidence.   |

First complete the Airwallex wallet-to-card sandbox journey through one agent
integration and owner approval flow. Then add Wise proposals, followed by one
traditional banking integration. Each phase has its own completion criteria;
later integrations do not delay the first card milestone.

Report transfer execution support separately for each adapter. Confirm account
access, Japan eligibility, and supported test capabilities before claiming an
integration works. A working proposal cannot establish execution availability.
Live funds movement, autonomous scheduling, and hosting full business agents are
subsequent work. The first deliverable is a usable, durable card-payment workflow
with explicit human authority and software-enforced admission.
