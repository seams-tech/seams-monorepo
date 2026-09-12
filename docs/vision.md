# Seams product vision

Date created: August 26, 2026
Last revised: September 8, 2026

Status: draft product direction; the escrow-to-card demo remains planned.

## Vision

Seams gives embedded AI agents budgets backed by stablecoin funding and enforces
those budgets through card purchases. The longer-term goal is to provide the
stablecoin funding and settlement layer for Airwallex and other card providers.

```text
User deposits stablecoins into their Seams wallet
  -> spends stablecoins directly, OR
  -> moves a chosen amount into escrow for card spending
  -> Seams verifies escrow deposit finality
  -> Seams credits card spending capacity once
  -> Airwallex handles card authorization and capture
  -> Seams reconciles card events and agent budgets
```

Satyr supplies the embedded agent and shopping experience. Seams supplies escrow
funding accounting, customer authorization, budgets, approvals, and reconciliation.
Card partners supply issuing and card-network processing. Live responsibilities
and liquidity arrangements require partner agreement.

## Customer experience

A shopper or business signs in, creates an agent through Satyr, and funds their
Seams wallet. They can spend stablecoins directly or move a selected amount into
escrow through “Move to card balance.” After escrow finality, the app shows
available card spending capacity. The remaining wallet balance stays spendable;
the escrowed amount cannot be spent again from that wallet. The customer grants a budget, per-purchase limit, approval threshold, and
expiry. The agent proposes purchases; the customer approves exceptions within the
hard limits, inspects outcomes, and can revoke authority.

Wallet funds, escrow backing, card capacity, and agent budget are distinct values.
Multiple agents can share account capacity, with atomic reservations preventing
overspending. A merchant's app credential cannot authorize spending shopper funds.

## First implementation

[R130A](refactor-130A-agent-expense-domain.md) implements finalized-deposit credits
and bounded purchase accounting. [R130B](refactor-130B-agent-connections.md) exposes
that through the app backend. [R130C](refactor-130C-agent-expense-console.md) presents
the journey, and [R130D](refactor-130D-airwallex-card-rail.md) provides the required
Airwallex sandbox adapter. Together they prove one escrow deposit through one demo
card purchase and durable outcome.

Keep typed commercial intent and rail configuration with one `MerchantCheckout`
and one `AirwallexSandboxCard` variant. Use one testnet token, chain, merchant,
card currency, and provider account. The user submits the escrow transaction;
Seams does not build an onchain merchant-payment engine.

Real testnet deposits back a simulated issuer-funding bridge. The demo checkout
invokes Airwallex issued-card authorization/capture simulation and clearly labels
its sandbox behavior. No real cash pool, live conversion, or production launch is
required. Seams must still credit each deposit once and reconcile each card
transition once.

Broader rails, automated withdrawals, production treasury, full dashboards, and
additional transports follow evidence from this flow. Discovery, catalogs, agent
orchestration, and merchant order operations stay with Satyr and the host app.

See [the product plan](product-vision.md) for the scope and completion criteria.
