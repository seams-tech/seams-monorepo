# Phase 1: contracts and migration inventory

Date: October 13, 2026. Contracts and the migration preflight are implemented.
The preflight reads a cohort and returns a proposed mapping. It does not apply a migration.

## Files and ownership

`packages/console-shared-ts/src/accountPlatform/` owns version 1 scope, tenant bindings,
instance states, identity links, usage, prices, reservation states, and operation contracts.
Parsers accept unknown boundary values. Validated scope, binding, usage, reservation
requests, and completed instance objects require their parser or branch builder.
Type fixtures reject direct construction, broad spreads, and invalid branch combinations.
The existing ESLint assertion restriction also covers these domain classes.

`packages/console-server-ts/src/accountPlatform/migration.ts` owns cohort parsing,
mapping checks, and restart reconciliation. `tests/e2e/console/shared-account-migration.e2e.test.ts`
exercises the preflight with persisted D1 data and existing billing services.
The three inventory SQL files in this directory contain read-only source queries.
Phase 1 changes no application schema or mounted route.

## Deployed inventory

Inventory used the D1 bindings from active Worker versions. Generated deployment
configuration has different production and staging database IDs. Cutover must resolve
the active bindings again before it selects a database.

| Source           | Active D1 database                     | Organisations |      Projects |  Environments |      Active owners |
| ---------------- | -------------------------------------- | ------------: | ------------: | ------------: | -----------------: |
| Seams production | `b928549b-8cd8-41db-9e66-36e95afbe295` |             1 |             1 |             3 |                  1 |
| Seams testnet    | `204147dd-23a6-43b7-9f40-d4f96eb986f2` |             3 |             3 |             7 |                  3 |
| Seams staging    | `802fa155-b740-4fc5-87fa-3c30e864d1f5` |             1 |             1 |             3 |                  1 |
| Satyr control    | `9c1e5467-2985-4ca9-8cb0-3b3b933249ef` |             1 | Service-owned | Service-owned | Regional authority |
| Satyr APAC       | `fe8a597e-b094-4229-8a70-139fa239c168` |             1 | Service-owned | Service-owned |                  1 |

Seams namespaces are `seams-production`, `seams-production-testnet`, and `seams-staging`.
The inventory found one testnet purchase. It found no ledger entries, open reservations,
refunds, disputes, or invoices in these deployed Console databases.
Provider references and principal IDs remain in the local evidence directory.

Satyr has one verified Google principal and one active owner with a person binding.
Its active placement is `production-apac`, epoch 1, production environment.
Its onboarding configuration version is 8 and its projection revision is 42.
Its pinned inference selection is `codex_subscription`.
Satyr's source account remains separate from every Seams source account.

The initial testnet inventory found `org_production_testnet` without an owner.
The user authorised assigning `n6378056@gmail.com` or deleting that organisation.
The repair preserved the organisation and its project. It used the verified Google
subject that matches an existing Seams principal. It added an active owner, an owner
audit event, and the owner anchor through the existing schema constraints.
The resulting owner-set and authorisation versions are both 1.
Every inventoried organisation now has an active owner.
The preflight rejects unresolved ownership with `owner_mapping_required`.

Local evidence is under `.artifacts/shared-account-platform/inventory/`:

- `*-current-records.json`: refreshed source identities, boundaries, counts, and references.
- `*-version.json`: deployed Worker binding evidence, when present.
- `testnet-owner-before.json` and `testnet-owner-after.json`: ownership reconciliation.
- `testnet-owner-repair.sql`: the guarded, explicitly authorised repair.
- `report.json`: the original read-only inventory, before the owner repair.

All inventory queries reported zero rows written. The owner repair is a separate mutation.

## Contract decisions

Platform scope requires namespace, organisation, project, and billing-account IDs.
Wallet binding uniqueness includes deployment, native namespace, organisation, and project.
Satyr binding uniqueness includes deployment and native organisation.
Each platform project permits one instance of each service. Archived bindings remain reserved.

An active instance requires a matching operation ID, instance ID, desired revision,
and accepted service receipt. A stale receipt cannot construct an active instance.
Desired disable immediately denies admission. Service confirmation controls shutdown completion.
Instance parsing does not grant authorisation. The account authority resolves scope from storage.

Identity links require a verified provider subject or an authenticated link receipt.
Email equality does not establish an identity link. User and automation principals are distinct.
An automation principal cannot supply a user's identity or session.

Usage ingress accepts integer quantities and explicit meter evidence. It rejects caller-supplied
amounts and billing-account IDs. Reservation ingress rejects caller-supplied posted balances.
Historical organisation charges have a distinct attribution variant without an instance.
Wallet monthly pricing remains 300 USD cents per organisation/month/resource.
Wallet execution keeps its accepted quote. Satyr test turns cost one cent in isolated accounts only.

## Transport contract for implementation

These paths reserve the version 1 wire surface. Phase 1 does not mount them.
Deployment bindings supply the destination origin. Caller payloads cannot select an origin.

| Receiver          | Method and path                                  | Payload                                              |
| ----------------- | ------------------------------------------------ | ---------------------------------------------------- |
| Service adapter   | `POST /account-platform/v1/provision`            | `ServiceProvisionCommandV1`                          |
| Service adapter   | `POST /account-platform/v1/status`               | Version, operation ID, instance ID, desired revision |
| Account authority | `POST /account-platform/v1/provisioning-results` | `AcceptedServiceReceiptV1`                           |
| Account authority | `POST /account-platform/v1/eligibility`          | `ServiceEligibilityRequestV1`                        |
| Account authority | `POST /account-platform/v1/usage`                | `PlatformUsageEventV1` wire shape                    |
| Account authority | `POST /account-platform/v1/reserve`              | `ReserveFundsRequestV1` wire shape                   |
| Account authority | `POST /account-platform/v1/settle`               | `SettleFundsRequestV1`                               |
| Account authority | `POST /account-platform/v1/release`              | `ReleaseFundsRequestV1`                              |

Authenticate the service transport before parsing its request. Resolve its allowed deployment
and instance bindings from server configuration and storage. Preserve the existing service
authentication mechanisms. A producer credential cannot substitute a user principal.
Eligibility requests must carry the authenticated user or an explicit automation grant.
Check current membership and service admission for every protected request.
Settlement uses service authority independently of the initiating user's session.

Use HTTP 400 for malformed envelopes, unsupported versions, and unsupported meters.
Use 401 for missing or invalid transport authentication and 403 for forbidden scope.
Use 409 for operation conflicts, stale transitions, and insufficient funds.
Return 503 for unavailable authority or durable storage. Keep these failures retryable.
Accepted outcomes use HTTP 200 and return the durable original receipt on matching replay.
The `accepted` and `rejected` bodies retain their typed result and error fields.

## Exact Satyr terminal evidence

The source is the Session actor's accepted checkpoint completion transaction.
The relevant Satyr files are under `services/platform/src/actors/`:

1. `agent-session.ts`, `finalizeAcceptedSessionCheckpoint`, reads accepted finalisation.
   It sets `completionId` to `finalize_${turnId}_${lastSequence}`.
   It sets `acceptedAt` to `checkpoint.blob.createdAt`.
2. The same method checks the current placement fence and accepted workspace receipt.
   It passes `completedAt: completion.acceptedAt` to `completeCanonicalCheckpointAndStream`.
3. `actor-journal.ts`, `commitCompletedSessionTurn`, uses `storage.transactionSync`.
   Its transaction commits the checkpoint and calls `completeSessionTurnStream` together.
4. `agent-session-turn-stream.ts` sets `session_turn_stream.state` to `complete` and
   `updated_at` to the accepted completion time. Matching terminal replay keeps the original record.

Meter evidence needs the actor's session ID, native organisation ID, turn ID, final stream
sequence, accepted completion ID and time, immutable checkpoint digest, and pinned model route.
The lifecycle contract supplies `modelRoute`. Its accepted checkpoint carries `modelRouteDigest`.
`started_at`, client timestamps, streamed text, and provider token counters cannot establish completion.
Only the accepted `completed` outcome produces one unit. Failed and cancelled outcomes produce zero.

Phase 4 must write its usage outbox in this same actor transaction. The event identity must
derive from instance/session/turn and remain stable through retry and restart.
Persist the original binding, reservation, funding selection, payload digest, and accepted timestamp.
The actor alarm retries delivery until the account authority returns a terminal receipt.
An account-authority outage retains the outbox and any unresolved hold.
There is no account billing outbox in the inspected Satyr code today.

## Migration procedure and checks

The executable preflight accepts a versioned cohort with explicit source scopes and target bindings.
It rejects missing inventory entries, duplicate native scopes, duplicate project/service bindings,
split source accounts, implicit account merges, inconsistent billing identities, ownerless sources,
and repeated Wallet environments. It compares source financial and membership checkpoints across
all Wallet projects belonging to one source organisation.

The planner preserves existing ledger identity and totals. It does not create an opening credit.
Satyr receives an empty billing account. Existing Satyr roles, person bindings, placement,
operational IDs, and source/history policy remain service-owned.
Checkpoint digests cover identity, membership, operations, money, payment references, and placement.

Before applying a cohort, pause its admissions and account mutations. Retain callbacks and accepted
work durably. Capture the source checkpoint and backup, then run the preflight.
Apply schema and explicit mappings at the persistence boundary. Compare counts, digests, ledger totals,
holds, owner mappings, signing identifiers, and placement before switching its authoritative writer.
Replay retained callbacks and usage through durable deduplication after the switch.
Before new writes, failed reconciliation permits restoration of the captured snapshot.
After new writes, use a reconciled restore or forward repair that retains subsequent events.
Remove the temporary migration runner after cohort closure.

## Validation and limits

The persistence rehearsal uses two Wallet projects, a separate synthetic Satyr tenant,
a settled and replayed payment, a refund, a monthly resource charge, and an unfinished reservation.
It then applies a manual debit, leaving a posted balance of -100 cents and a 75-cent hold.
After a worker restart, the source rows and migration plan reconcile exactly.
It rejects changed membership, missing ownership, conflicting bindings, implicit merges,
stale activation receipts, and injected charge authority.

Commands:

```sh
pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-migration.e2e.test.ts --reporter=line
pnpm -C tests type-check:console
pnpm -C tests type-check:fixtures
pnpm check
```

The rehearsal passed. Type checks and `pnpm check` passed, including 53 script tests and one skip.
The browser-oriented Console configuration required local ports already occupied by another runtime.
The standalone configuration above runs this persistence journey without those services.

Evidence is under `.artifacts/shared-account-platform/rehearsal/`: `report.json`, `cohort.json`,
`plan.json`, `usage-events.json`, `reconciliation.json`, and `statement.pdf`.
This proves preflight and restart preservation against current Wallet persistence.
It does not prove a target-schema migration, live Satyr billing, or UI access enforcement.
Those acceptance steps belong to phases 2–5.
