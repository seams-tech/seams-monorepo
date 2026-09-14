# Product vision: Escrow-backed spending for embedded agents

Date created: June 20, 2026
Last revised: September 8, 2026

Status: draft direction; R130A–D define the first testnet/sandbox implementation.

## Intended flow

```text
User deposits stablecoins into their Seams wallet
  -> spends stablecoins directly, OR
  -> moves a chosen amount into escrow for card spending
  -> Seams verifies escrow deposit finality
  -> Seams credits card spending capacity once
  -> Airwallex handles card authorization and capture
  -> Seams reconciles card events and agent budgets
```

Satyr owns the embedded agent, shopping task, catalog/cart interaction, and order
presentation. Seams owns customer authority, escrow funding attribution, spending
capacity, agent budgets, exact approvals, and financial evidence. Airwallex is the
first card adapter. Seams aims to provide stablecoin-backed funding and settlement
across card providers over time.

The Seams wallet is the initial funding account. Users may spend its stablecoins
through existing wallet flows or choose “Move to card balance” to transfer a
selected amount into controlled escrow. Seams observes the escrow deposit; there
is no automatic sweep or new onchain merchant-payment engine in this plan.
Wallet deposits alone never credit cards, and escrowed funds are no longer
available for ordinary wallet spending. Identify the
customer's deposit and wait for the selected chain's finality rule before credit.

## First demo

Use one testnet stablecoin and escrow path, one card currency, one merchant, and
one Airwallex sandbox account. After escrow finality, credit a customer allocation
against available sandbox issuer funds using a labeled test conversion rate.
The issuer funding bridge is simulated; test tokens do not become real fiat.

The remaining wallet balance stays available for direct stablecoin spending.
The customer gives their agent a fixed budget, per-purchase limit, approval
threshold, and expiry. The agent proposes an immutable checkout. Seams admits or
blocks it, obtains exact customer approval where required, and atomically reserves
both agent budget and account capacity before invoking the sandbox card operation.

The demo checkout's Pay button calls the issued-card simulator by card ID through
the backend. Show authorization/capture, a receipt, and updated balances after
reload. Hosted acquiring checkout interoperability remains unverified and is
unnecessary for this proof. No PAN/CVV handling in Seams.

## Minimal model and guarantees

Keep funding credit, grant, and purchase records with exact customer bindings.
Preserve the commercial schema and configurable rail types, implementing only
`MerchantCheckout` and `AirwallexSandboxCard`. Normalize merchant/UCP data once;
full UCP support and a generic routing framework are deferred.

- A finalized escrow transfer credits once, enforced by a unique transfer identity
  and atomic ledger transition. Pending deposits cannot fund purchases.
- A grant allocates permission against shared capacity; it creates no money.
  Concurrent purchases reserve against both limits in one database transaction.
- An immutable purchase binds exact owner approval and one provider operation.
  Request retries cannot create a second payment or funding credit.
- Provider events apply once. Capture commits spend; definitive unpaid failures
  release holds; uncertain outcomes retain them. Refunds restore funding capacity
  without renewing agent budgets automatically.
- An app credential alone cannot authorize use of a shopper's funds. Customers
  retain grant administration and revocation through the owner surface.

Reuse existing operation claims, auth, audit, and UI patterns. Direct onchain
payment submission, signed-transaction persistence, nonce recovery, background
reconciliation services, and full dashboards are outside this flow.

## Plan ownership and completion

| Plan | Responsibility |
| --- | --- |
| [130A](refactor-130A-agent-expense-domain.md) | Escrow finality, one-time credits, grants, atomic reservations, and card accounting. |
| [130B](refactor-130B-agent-connections.md) | Authenticated backend access to the customer's agent and grant. |
| [130C](refactor-130C-agent-expense-console.md) | Deposit, capacity, budget, approval, demo checkout, and activity UI. |
| [130D](refactor-130D-airwallex-card-rail.md) | Airwallex sandbox issuing, payment simulation, and provider-event evidence. |

All four contribute to one operating proof. A/B/C alone do not complete a purchase.
Demonstrate deposit replay, concurrent spending limits, duplicate Pay/events,
ambiguous provider responses, and revoked reuse using the shared journey and
narrow focused checks. Read `tests/AGENTS.md` when implementing tests.

Production escrow custody, withdrawals, conversion, liquidity sourcing, issuer
funding agreements, and settlement obligations require later design and partner
agreement. Escrow finality alone does not establish live issuer liquidity.
The sandbox experiment keeps that bridge explicit while proving the user journey.

Related context: [Seams vision](vision.md),
[Claude commerce agents](https://claude.com/solutions/commerce), and
[longer-term card architecture](stablecoin-linked-virtual-card.md).
