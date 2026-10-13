# Phase 3: shared billing and reservations

Status: implemented and validated. Phase 2 validation and commit `7efe5fc` precede this phase.

## Files, schemas, and behaviour

Shared reservation state moves from `wallet-console-server-ts/src/billingPrepaidReservations/`
into `console-server-ts/src/billingPrepaidReservations/`.
Wallet retains quote calculation and execution outcome interpretation.
Shared billing owns posted funds, holds, terminal receipts, and their atomic ledger mutation.
The account-platform scope and immutable instance binding determine the payer.

The affected Wallet callers are `sponsorship/prepaidBalance.ts`,
`router/sponsorshipExecution.ts`, `router/routerApiSignedDelegate.ts`, and their D1 composition.
Core `billing/d1.ts` owns the refund admission change and its ledger writes.
New usage and pricing implementation belongs to the shared billing package.
Shared usage contracts and type fixtures remain in `console-shared-ts/src/accountPlatform/`
and `tests/typecheck/`.
Console billing API parsers and billing pages will display project, service, and meter totals.
They will show historical charges without an instance as unattributed organisation costs.
They will also show generic funds and hold totals from the shared authority.

Forward migrations will replace caller balance authority, persist reservation reconciliation
and terminal evidence, and add instance/meter/price usage receipts and attribution.
Existing balances, reservation IDs, payment references, replay keys, and historical meaning must survive.
Temporary source-shape conversion belongs only to an explicit persistence migration.

The core forward migrations are `0005_funds_authority.sql` and
`0006_billing_usage_attribution.sql`.
Wallet applies the matching `0094` and `0095` migrations, plus its `0096` monthly outbox.
Migration `0094` validates every unresolved source hold before it renames the source table.
It preserves all original rows in immutable `billing_reservation_history`.
It imports open holds as indeterminate with their original IDs, amounts, source keys, and times.
The imported quote marker states that the old record lacks a proved quote version.
No migration inserts an opening credit or rewrites existing payment references.

## Transaction decisions

D1 remains the one financial authority. Reservation admission reads actual liability postings,
all unresolved holds, and pending refunds inside its transaction.
Caller-supplied `postedBalanceMinor` cannot authorise work.
Refund admission must account for outstanding holds in the same authority.
Metered debits and accepted execution costs may still produce negative posted balances.

Settlement must debit money and remove the matching hold together.
Wallet EVM execution already uses a D1 batch for its reservation, debit, execution record,
and notifications. Its guarded transaction pattern supplies the starting implementation.
NEAR currently performs these writes separately and has a crash gap.
Both paths must use the shared settlement primitive with their existing execution identities.
Wallet execution replay retains its organisation scope.
A partial unique index prevents two Wallet projects from admitting the same native execution.
Wallet replay also requires the original environment before it returns an execution record.
Satyr execution identity remains scoped to its instance and meter.

A timer can request reconciliation. It cannot release unresolved execution funds.
Reserved and indeterminate states retain their holds until service evidence proves settlement or release.
Matching terminal replay returns the original receipt. Changed amounts, prices, evidence, or outcomes conflict.

The Phase 1 reservation parser required at least one cent.
Existing Wallet quotes can be zero when a configured fee or ratio is zero.
The parser now accepts zero-cent reservations to preserve that behaviour.
These reservations retain durable identities and terminal receipts without zero ledger postings.

Satyr's one-cent test price uses a persisted isolated-account classification.
Funds admission, explicit settlement, and usage delivery use the same price eligibility rule.
Customer accounts cannot reserve or settle under this test price.
Authenticated terminal usage can reconcile an indeterminate hold with its final service evidence.

Monthly Wallet usage retains its organisation/month/resource key and 300-cent debit.
New events retain their originating instance and canonical payload digest.
Zero-charge events require durable receipts even though the ledger forbids zero postings.
Historical charges without project evidence remain explicitly organisation-scoped.

## Wallet monthly producer

Successful EVM calls capture monthly usage in the execution settlement transaction.
The producer uses the admitted instance, canonical Wallet ID, source record, occurrence time,
and existing execution evidence digest. Reconciliation captures usage when an unknown outcome
becomes successful. Exact execution replays create no additional fact.
The request adds one insert to its existing D1 batch and no database round trip or awaited hash.
The local comparison measured 19 database calls before and after a successful zero-quote settlement.
Statement count changes from 27 to 28. The settlement E2E enforces the 19-call budget.
Evidence: `.artifacts/shared-account-platform/request-budget/comparison.json`.
This count does not establish production network latency.

`WalletMonthlyUsageAdapter` delivers these immutable facts from the scheduler.
Wallet migration `0098_account_delivery.sql` indexes pending facts and removes the redundant
outbox payload digest. Shared billing retains ownership of canonical event digests.
Delivered history remains immutable and does not participate in pending scans.
Retries after service disable or archive preserve the original instance and UTC month.

The billable actions remain transfer, swap, approve, and contract call.
Registration, failed calls, simulations, and internal execution retries produce no new monthly fact.
The production hook covers successful `evm` / `evm_call` settlement.
NEAR and other execution paths remain unsupported for this meter until they supply authoritative
success evidence and a canonical Wallet ID. The producer does not infer historical activity.

## Acceptance

The composed journey must race Wallet and Satyr test reservations against one limited balance.
It must also race a refund or debit with admission, interrupt settlement after commit,
replay duplicate and conflicting events, restart storage, and preserve unresolved holds.
It must produce raw usage, reservation and ledger reconciliation, price versions, a report,
and a billing document. Satyr pricing remains isolated test pricing only.

## Validation and evidence

The final composed run passes all ten shared-account journeys.
It includes the six Phase 1/2 journeys and four financial journeys:
shared funds, shared usage, the Wallet monthly producer, and Wallet settlement.
The retained billing provider, refund, dispute, migration, and history checks pass 26 tests.
`pnpm check` passes with 53 script checks and one existing skipped check.
Core, Wallet server, and Console UI builds pass.
The UI build retains its existing bundle-size warning.

```sh
pnpm -C tests exec playwright test -c playwright.config.ts 'e2e/console/shared-account-.*\.e2e\.test\.ts' e2e/console/shared-wallet-settlement.e2e.test.ts --reporter=line
pnpm -C tests exec playwright test -c playwright.relayer.config.ts console-billing.service.test.ts console-billing.d1.test.ts console-sponsored-calls.history.test.ts --reporter=line
pnpm check
pnpm -C packages/console-server-ts build
pnpm -C packages/wallet-console-server-ts build
pnpm -C apps/wallet-console build
```

Machine evidence is under `.artifacts/shared-account-platform/`:

- `phase-3-report.json`, `phase-3-e2e.log`, `phase-3-check.log`, and the build logs.
- `funds/` preserves source holds, migration rollback, financial races, and restart evidence.
- `usage/` contains raw events, receipts, charges, balanced postings, and before/after snapshots.
- `wallet-monthly-usage/` contains the selected activity outbox and native evidence checks.
- `wallet-settlement/` contains EVM/NEAR execution records, uncertainty, and quote reconciliation.

The shared usage statement totals 681 cents for October.
It attributes 642 cents to Wallet and two cents to the isolated Satyr test meter.
It retains 37 cents as historical organisation costs.
The late September event remains a separate 300-cent charge.
The final posted balance is 1019 cents with no unresolved holds.
The statement PDF and its SHA-256 digest are repeatable outputs of the journey.
Both rendered pages were checked; long charge IDs wrap within the page.

Browser reports, replays, screenshots, and the valid trace archive live under `output/playwright/`.
`shared-account-costs-report.json` verifies finance-only access, all cost groups, and no Wallet requests.
`shared-account-wallet-costs-report.json` verifies native environment headers and Wallet history queries.
The common billing page uses account authority and server onboarding state.
Wallet history and reconciliation remain on the Wallet gas sponsorship page.

There are no remaining Phase 3 validation failures.
Native Satyr execution, live access integration, and production migration remain in Phases 4 and 5.
