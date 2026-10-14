# Shared account platform implementation plan

Status: Phases 1 through 4 and Phase 5 staging are implemented and validated.
Staging cutover and the deployed request-latency repair are complete.
Production platform migration is deferred by the user, pending the separate Wallet rollout.
Date: October 14, 2026.
October 14 architecture corrections are implemented locally; deployment remains pending.
See Phase 3 monthly capture and Phase 4 architecture corrections.

Implementation evidence: [Phase 1 contracts and inventory](shared-account-platform/phase-1.md).
Account composition evidence: [Phase 2 implementation](shared-account-platform/phase-2.md).
Shared billing scope: [Phase 3 implementation](shared-account-platform/phase-3.md).
Satyr integration scope: [Phase 4 implementation](shared-account-platform/phase-4.md).
Interface and cutover evidence: [Phase 5 implementation](shared-account-platform/phase-5.md).
Future integrations: [Service addition procedure](shared-account-platform/add-service.md).

## Terminology and scope

Use the [Platform glossary](platform-glossary.md). This plan covers developer
accounts, developer projects, developer account memberships, and developer billing.
“Organisation” in existing Platform code and stored fields maps to developer account.
Keep Wallet and Satyr native organisations, projects, and project environments
under their existing product owners. A terminology change adds no new account hierarchy,
API fields, or isolation guarantees.

## Implementation rules

This document specifies the first release. Requirements below take precedence over
illustrative examples. Implement one phase at a time and satisfy its exit conditions
before the next phase. Keep changes committed on `dev` in each owning repository.

Do not introduce a plugin framework, universal metadata schema, new identity
provider, shared service database, subscription engine, or replacement Satyr project
model. Do not rename packages merely to match the platform terminology.

Use existing factories, authentication, request parsers, durable delivery, and D1
transaction patterns. Choose local implementation details within these boundaries.
If an existing invariant conflicts with this specification, record the exact
conflict before changing behaviour. Do not weaken the invariant to complete a phase.

Production Satyr prices and developer account merges remain product decisions.
Use isolated test prices and separate developer accounts until those decisions exist.
These decisions do not block contract, migration, or E2E implementation.

## Purpose and decisions

Build one account platform for Seams, Satyr, and future services. Reuse the
existing Console core for developer accounts, developer users, account memberships, developer projects,
service access, and billing. Keep each service's operational data and execution
rules in its owning runtime.

The first release provides one billing account per developer account,
multiple developer projects, and independently enabled services. Developer users can belong
to several developer accounts. Each service can define several usage measures and
prices. Seams retains its current commercial behaviour during the transition.

Developer projects define resource ownership and cost attribution. Satyr's existing
projects remain work resources inside Satyr. They retain their personal/shared
access, Cases, briefs, references, and history controls.

Bind one Satyr native tenant to one developer project for the initial integration.
An existing Satyr native tenant cannot serve several developer projects. A second
instance requires a separate Satyr native tenant and successful isolation verification.

This plan defines the implementation defaults. Actual Satyr prices, new payment
terms, and developer account merges require explicit product decisions before use.
The implementation can proceed with test prices and separately identified accounts.

## Current implementation and constraints

Seams paths below are relative to `seams-monorepo`. Satyr paths are relative to
`/Users/pta/Dev/lowerarchy/satyr`.

| Area                | Current implementation                                                                     | Consequence                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Seams ownership     | `packages/console-server-ts/src/orgProjectEnv/{types,service,d1}.ts`                       | Developer account and developer project identity already have a shared package owner. Project creation also creates three environments. |
| Seams access        | `packages/console-server-ts/src/teamRbac/`                                                 | Reuse membership lifecycles and administrative permissions. Service content needs separate access checks.                               |
| Seams billing       | `packages/console-server-ts/src/billing/`                                                  | Reuse the ledger and payment flows. Replace the fixed resource price and developer-account-only usage attribution.                      |
| Seams composition   | `packages/wallet-console-server-ts/src/router/consoleComposition.ts`                       | The production composition still requires wallet services. Extract a usable account-only composition.                                   |
| Wallet reservations | `packages/wallet-console-server-ts/src/billingPrepaidReservations/`                        | Move reusable money reservation behaviour into shared billing. Keep wallet execution policy in Wallet.                                  |
| Satyr projects      | `packages/control-api/src/{projects,project-access}.ts`                                    | Projects contain work context and personal/shared access. They are distinct from developer projects.                                    |
| Satyr membership    | `services/platform/migrations-regional/0001_current_schema.sql`, `organisation_membership` | Membership includes `personId` and owner/admin/operator/viewer roles. Preserve service roles and person bindings.                       |
| Satyr lifecycle     | `services/platform/src/data/control-plane.ts`, `organisation-lifecycle.ts`                 | Onboarding carries development/production mode, activation, archive, and purge state. Keep this service lifecycle.                      |
| Satyr storage       | `services/platform/src/organisation-execution-scope.ts`                                    | Regional placement and write fences remain authoritative for Satyr operations.                                                          |
| Satyr disclosure    | `services/platform/src/projects/membership.ts` and `policy/information-flow/README.md`     | Project admission checks source access and retained history. Developer account membership cannot bypass these checks.                   |
| Satyr inference     | `services/platform/src/data/organisation-inference-selection.ts`, `workspace-ai-budget.ts` | Funding selection and token/time/tool limits are separate from developer billing balances.                                              |

The inspected Satyr code has execution budgets and provider usage records.
It does not establish a developer billing ledger equivalent to Seams billing.
Satyr's Stripe connection code serves commerce integrations and remains separately owned.

## Ownership model

```text
Developer account
  Developer users and developer account memberships
  Developer billing account
  Developer project
    Wallet service instance
      Wallet environments and operational resources
    Satyr service instance
      Satyr native tenant and regional placement
      Satyr work projects and Cases
      Commerce connections, workspaces, and agent sessions
```

A developer account identifies the buyer of Seams services. A developer project defines a
resource and cost boundary. A service instance binds an enabled service to that
project and its operational tenant.

The account platform owns shared developer records. Service runtimes own operational records.
Services communicate through versioned APIs and authenticated events. They do not
read another runtime's private tables or import its private implementation.

| Record                       | Owner                | Required meaning                                                                          |
| ---------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| Developer account            | Account platform     | Stable developer account identity, name, lifecycle, and ownership                         |
| Developer user identity      | Account platform     | Stable principal with verified identity-provider bindings                                 |
| Developer account membership | Account platform     | Current membership eligibility and account administration permissions                     |
| Developer project            | Account platform     | Developer account ownership, account-level visibility, name, and lifecycle                |
| Developer billing account    | Account platform     | Payment responsibility, currency, and ledger identity                                     |
| Project billing binding      | Account platform     | The billing account responsible for the project's charges                                 |
| Service instance             | Account platform     | Service identity, project ownership, requested access, and observed provisioning state    |
| Service tenant binding       | Integration boundary | Stable association between an instance and the service's native tenant identity           |
| Satyr native tenant          | Satyr                | Regional placement, operational lifecycle, integrations, inference choice, and workspaces |
| Satyr work project           | Satyr                | Work context, project roles, source restrictions, and Case membership                     |
| Service grants               | Owning service       | Permissions for its operations and resources                                              |

Keep one developer billing account per developer account in the first release. Give it its own
identifier and bind every developer project to it. Multiple payers, cross-developer-account
billing, project transfers, and multiple currencies remain outside this release.

### Identity and data rules

- Preserve existing operational IDs. Resolve platform IDs through explicit tenant
  bindings at request and persistence boundaries.
- Include the current Seams storage namespace when resolving an existing identity.
  An ID string alone does not establish ownership.
- Enforce unique tenant bindings within each service deployment. Reject attempts
  to bind the same service resource scope to another instance. Apply the
  service-specific scope rules below.
- Link existing users through verified identity-provider subjects or an explicit
  authenticated account-link flow. An email match alone cannot merge accounts.
- Keep service-specific fields in typed service tables. Avoid a shared metadata
  object containing optional fields for every product.
- Give every replicated field one authoritative owner. Local access projections
  carry an authority revision and cannot become independent membership writers.

### Binding keys and cardinality

The first release permits one instance per `(platformProjectId, serviceId)`.
Disable and re-enable reuse that instance and binding. Archived bindings remain
reserved for historical attribution. Rebinding and project transfer are unsupported.

| Service | Native resource scope                                            | Uniqueness constraint                          |
| ------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| Wallet  | Deployment, namespace, native organisation ID, native project ID | One instance per complete native project scope |
| Satyr   | Deployment and native organisation ID                            | One instance per native tenant                 |

Wallet already has several projects under one native organisation. The same
native organisation can therefore appear in several Wallet bindings. Every binding
must resolve its own project and environments. A native organisation-only uniqueness
constraint would break this existing model.

Store these bindings as distinct typed variants. Do not use nullable native project
fields to distinguish services. Resolve native environment and resource ownership
inside the Wallet adapter before accepting an operation or usage event.

Create one developer account for each unmapped source organisation. Import
Satyr into a dedicated developer project. Import Seams projects individually.
Keep account identities separate unless an explicit, verified mapping joins them.

### Environments and lifecycle

Remove environment creation from generic developer project creation. Wallet
provisioning creates its existing dev/staging/prod environments. Preserve their IDs,
keys, status semantics, and signing metadata during this move.

Move the Console environment `runtimeVersion` field into wallet-owned configuration.
The wallet adapter currently interprets this field as `signingRootVersion`.
Preserve stored signing identifiers and wire contracts exactly.

Complete the environment separation across `account`, `onboarding`, `apiKeys`,
session context, route definitions, persistence, and Console UI. These currently
carry environment fields or readiness checks. Moving project creation alone is insufficient.

Developer onboarding completes after developer account and developer project creation.
It requires no Wallet environment or API key. Wallet setup separately provisions
environments and preserves its existing live-environment billing gate.

Keep environment-scoped Wallet credentials and their wire behaviour in the Wallet
composition. Account authentication uses platform sessions. Satyr retains its current
service authentication. This release introduces no universal credential scope language.

Satyr keeps its organisation onboarding environment. Do not introduce a shared
`environmentId` until services have a demonstrated common isolation requirement.
Usage attribution requires a service instance. Service-local resource references
can additionally identify a wallet environment, Satyr Case, or agent session.

Keep account lifecycle and service lifecycle separate. Disabling one service stops
new work in that service while other services remain available. Accepted work must
follow the service's cancellation or completion rules. Its charges can still settle.

Account suspension revokes new work across services. Account archival requires
acknowledged service shutdown and preserves billing records. It does not directly
delete operational tables. Satyr retains its archive, restore, and purge procedures.

## Access contract

The account platform decides who belongs to a developer account and who can manage
projects, services, or payments. The service decides who can read its content or
perform an operational action.

A billing administrator can inspect costs without access to private Satyr chats.
A Satyr operator can execute an authorised workflow without access to payments.
Developer project visibility alone grants no access to Satyr work projects.
Admission also requires access to the specific service instance. Membership in
the developer account does not automatically admit a user to every Satyr native tenant.

At the service boundary, resolve the verified principal, developer account, developer project,
instance, and current account eligibility. Then apply the service's own grants.
Satyr must retain source access, history disclosure, capability, and approval checks.

Use the existing authentication mechanisms where possible. Any delegated assertion
must bind the issuer, audience, principal, scope, expiry, and authority revision.
Authenticate service usage producers and restrict each producer to its bound instances.
Never trust caller-supplied developer account or developer project IDs as authority.

Membership removal must invalidate service admission and ongoing disclosure where
the service already requires live access. Define and verify projection freshness
before release. If current authority cannot be established, reject new protected work.
Asynchronous membership delivery alone is insufficient proof of current access.

For the first release, check current platform eligibility synchronously before
protected service admission and before each existing Satyr disclosure boundary.
Do not cache positive eligibility between requests. An authority outage returns
`authority_unavailable` and releases no protected content or new execution.

Already accepted work follows its existing service lifecycle. Financial settlement
uses authenticated service authority and remains independent of the removed account member's
session. Restore and replay must recheck authority before protected disclosure.

### Role translation

| Source role or permission                                 | Platform grant                                                 | Service grant                                               |
| --------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| Seams OWNER                                               | Developer account owner                                        | Preserve existing Wallet authority within imported projects |
| Seams ADMIN                                               | Preserve explicit administrative permissions and project scope | Preserve existing Wallet authority                          |
| Seams MEMBER                                              | Membership plus existing project assignments                   | Preserve assigned Wallet access                             |
| Satyr owner, in a separately imported native organisation | Developer account owner                                        | Satyr owner on the bound instance                           |
| Satyr admin                                               | Membership and access to its imported developer project        | Satyr admin on that instance                                |
| Satyr operator or viewer                                  | Membership and access to its imported developer project        | Preserve the corresponding Satyr role                       |
| Existing billing permission                               | Same platform billing permission                               | No additional service content access                        |

Developer account ownership does not automatically create Satyr native tenant or work project ownership.
Only the migration mapping preserves existing owners. New service grants follow
the owning service's authorisation rules. Preserve its last-owner constraints.
An explicit account merge requires its own role mapping before migration.

The Platform owns developer account invitations and membership revocation. Satyr owns
instance roles and work project invitations. Adapt its existing invitation flows
to these owners without silently granting access to another service.

Keep Satyr's `personId` association and operational roles in Satyr. Retire its
independent organisation membership writer after migration. Existing Portal and
Slack flows must use the shared authority through the service boundary.

## Future service integration contract

Use an explicit service catalogue in application code. A service entry supplies
its stable `serviceId`, display information, contract version, supported usage
measures, and integration endpoints. Use ordinary typed functions and existing
transport helpers. A dynamic plugin loader or schema framework is unnecessary.

The initial catalogue contains `wallet` and `satyr`. Use version `1` for the
integration envelope. Reject unknown versions and unsupported operations at ingress.
Authenticate the producer separately from payload parsing.

Wallet Console automatically enables an absent Wallet service when an authorised
owner or developer-project administrator opens a Wallet product page. It uses the
existing enable command, retains its operation identity across reloads, and waits
for provisioning before showing the page. Shared account pages and project creation
remain product-neutral. Opening Wallet Console does not reverse a disabled or
archived service or bypass membership permissions. Failed setup offers a retry.
Each product owns its automatic onboarding. Satyr uses its separate application;
Wallet Console does not provision Satyr or expose a Project services page. Neither
product requires a manual enable screen. Keep the service lifecycle API for internal
provisioning, permissions, and deliberate administrative restrictions.

### Required operation payloads

These are semantic field names for the shared contract. Reuse existing types for
their validated values. Keep service-specific fields in explicit union branches.

| Operation                  | Required payload fields                                                                     | Required outcome                                               |
| -------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Provision or change state  | `version`, `operationId`, `instanceId`, `desiredRevision`, `command`, `binding`             | Accepted operation receipt or typed rejection                  |
| Report provisioning result | `version`, `operationId`, `instanceId`, `desiredRevision`, `result`                         | Matching revision applied, stale receipt recorded, or conflict |
| Check eligibility          | `version`, `instanceId`, `principal`, `action`                                              | Current authority revision and allowed scope, or denial        |
| Record usage               | `version`, `eventId`, `instanceId`, `meterId`, `occurredAt`, `quantity`, `unit`, `evidence` | Durable original charge outcome or typed rejection             |
| Reserve                    | `version`, `operationId`, `instanceId`, `executionId`, `requestedMinor`, `priceVersion`     | Reservation receipt or insufficient funds                      |
| Settle                     | `version`, `operationId`, `reservationId`, `executionId`, `settledMinor`, `evidence`        | Atomic charge and hold release, or conflict                    |
| Release                    | `version`, `operationId`, `reservationId`, `executionId`, `noChargeEvidence`                | Hold release or conflict                                       |

The authenticated producer supplies its authority through the transport. The server
resolves account and project scope from the instance or reservation. It does not
accept caller-selected billing accounts. Use UTC timestamps and validated integer
quantities for the initial meters.

Use separate principal variants for users and service automation. User requests
require verified identity and active eligibility. Automation requires an explicit
grant for its instance and action. Preserve Satyr's initiating actor and delegated
authority. A service credential cannot impersonate an arbitrary developer account member.

Evidence identifies a durable source record and its immutable digest. Satyr evidence
requires `sessionId`, `turnId`, terminal outcome, and the pinned funding selection.
Wallet execution evidence requires its execution reference and quote version.
Do not transport provider credentials, prompts, or private source text.

Keep an operation's receipt, canonical payload digest, and immutable scope together.
In-place changes to a reservation's account, instance, execution, or price are invalid.
Wire route names may follow the existing router conventions. Their methods, payloads,
error mapping, and authentication must be recorded before adapter implementation.

Provisioning uses a binding request union: `create_native_scope` or `attach_existing_scope`.
Creation requires the verified parent scope and service configuration. Attachment
requires the complete native scope and evidence of authority over that existing tenant.
Only the accepted service receipt supplies the final binding for a new scope.

### Provisioning and status

Provision commands carry an instance ID, verified scope, operation ID, and desired
configuration revision. Repeated commands return the same accepted operation.
Persist command delivery and acknowledgements so a process restart can resume work.

Represent provisioning, active, disabled, failed, and archived states as precise
discriminated unions. Active instances require a completed tenant binding and an
accepted provisioning receipt. Failed provisioning cannot grant service access.

Distinguish desired state from observed service state. Report an instance as ready
only after the service confirms its operational readiness. A service outage must
not convert an unknown state into a successful activation or archive.

| Command                | Allowed source state            | Required result                                                        |
| ---------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| Enable                 | No instance                     | Create provisioning state and an operation receipt                     |
| Enable                 | Disabled instance               | Provision the existing binding under a new desired revision            |
| Retry failed operation | Failed instance                 | Retry the recorded target and binding under a new operation            |
| Disable                | Provisioning or active instance | Deny new admission immediately and await the matching shutdown receipt |
| Archive                | Disabled instance               | Require completed service cleanup admission and preserve its binding   |
| Enable                 | Archived instance               | Reject with `instance_archived`                                        |

Keep desired revision and observed revision explicit in the lifecycle union.
An active receipt grants access only if it matches the latest desired revision.
Ignore stale receipts for state advancement and retain them for audit.
Repeated operation IDs with the same canonical payload return the original result.
The same ID with different contents returns `operation_conflict`.
Account or project suspension takes precedence over every instance state.

### Usage and pricing

A usage event identifies its producer, event ID, instance, meter, quantity, unit,
occurrence time, and service-local execution or resource reference. A meter defines
what is measured, such as monthly active wallets or completed agent runs.

Resolve developer account, developer project, and developer billing account from the authoritative instance
binding. Validate the event once at ingress. Reject unknown measures, invalid units,
invalid quantities, and producers without authority for that instance.

Deduplicate by producer, instance, and event identity. Reject conflicting reuse of
an event ID. Repeated delivery must not create another charge.

Persist an event receipt and its canonical payload digest with the charge outcome
in one account database transaction. The same transaction owns meter deduplication,
ledger postings, and any reservation settlement. A durable receipt cannot precede
the money mutation it acknowledges. Return the original result after a lost response.

Persist service usage in an outbox with its accepted execution evidence. Retry
delivery until the account platform records a terminal receipt. If execution and
outbox records use different stores, derive replay from the durable execution ID.
Never generate a fresh event ID after a worker restart.

Prepaid usage evidence includes its reservation ID. Usage delivery and explicit
settlement converge on one charge identified by instance, meter, and execution.
They cannot create separate debits for the same work. A settled reservation returns
its existing charge when the matching usage event arrives later. Monthly resource
charges use their existing developer-account/month/resource key and require no reservation.

Use `accepted` and `rejected` Result branches. Accepted outcomes distinguish
`charged` from `recorded_without_charge`. Rejections include `scope_forbidden`,
`meter_unknown`, `event_conflict`, and `price_unavailable`. Transient availability
failures remain retryable and cannot mark an event as permanently processed.

The service owns billable activity semantics. Shared billing applies a registered,
immutable price version and records the charge. A service can supply a trusted
execution quote through a separate typed contract for variable execution costs.
Product-user requests cannot submit authoritative charge amounts.

Preserve quantity, unit, price version, charge scope, source evidence, and amount on
each usage charge. Define fixed-precision arithmetic and rounding at the billing
boundary. Usage rates can require greater precision than final USD cents.

The first release uses USD and integer cents for posted charges. Keep Wallet's
existing quote calculation and rounding unchanged. Reject unsupported fractional
quantities and currencies at the new ingress. Add finer pricing precision only
with a separately specified meter and rounding rule.

Keep metering policy separate from charge attribution. Seams currently counts
active resources across a developer account and month. Preserve that scope during
migration, even when usage arrives through several project instances. Record the
accepted charge against its originating instance without charging the resource twice.

Define the time rule for each meter. Select prices by the documented occurrence
or accepted quote time. Late events and corrections retain the original policy.
Append corrections with links to prior charges. Do not rewrite settled history.

A service can combine recurring fees and measured usage. Implement a pricing
mechanism only when Seams or the selected Satyr plan requires it. The first
acceptance journey uses two actual mechanisms, including fixed-price measured usage
and quoted execution usage. It does not require speculative seat or tier engines.

### Initial meter specification

| Meter                                | Billable fact                                             | Scope and amount                                                                  |
| ------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Wallet monthly active resource       | Existing successful billable Wallet action rules          | Existing developer-account/month/resource scope, 300 USD cents once per UTC month |
| Wallet execution                     | Existing accepted execution receipt and pricing quote     | Preserve quote version, execution identity, and actual charge semantics           |
| Satyr completed turn, test plan only | A durable accepted terminal turn with outcome `completed` | One unit per instance/session/turn, one USD cent per unit                         |

For the Satyr test meter, failed or cancelled turns produce no completed-turn charge.
Internal retries, continuation deliveries, and replay of the same accepted turn
cannot produce another unit. Use the durable terminal acceptance timestamp and
session/turn identity. Model usage remains separate evidence with its funding source.

The test price is a Satyr service fee. It does not reimburse provider token cost.
Enable it only in isolated E2E accounts and never in non-test developer accounts. Do not
add developer subscriptions or token pass-through prices as part of this release.

### Payment and execution controls

Shared billing owns prepaid funds, balanced ledger postings, reservations, refunds,
payment reconciliation, and billing documents. Keep product execution permissions
and token/time/tool limits inside the service.

Reserve funds atomically before admitting prepaid execution. Account-wide available
funds must include reservations from every service. Settlement and release must
survive retries, worker restarts, and ambiguous execution outcomes.

Read posted balance and outstanding reservations inside the account transaction.
Remove `postedBalanceMinor` from reservation request authority. A value supplied
by a caller cannot authorise another reservation.

Admission requires `postedBalanceMinor - reservedMinor >= requestedMinor`.
Keep every balance mutation and reservation mutation in that same authority,
including refunds and manual debits. Settlement debits the account and removes
the hold atomically. Release removes the hold without a debit.

Reservations govern prepaid execution admission. The existing monthly Wallet
charge remains a metered debit and can exhaust the balance. Preserve that
behaviour. Do not promise that all recorded balances stay nonnegative.

An actual execution cost above its estimate still represents a financial obligation.
Preserve existing Wallet settlement behaviour and record the actual charge once.
Reject new reservations when available funds are insufficient. The fixed Satyr
test fee reserves one cent, so its settlement cannot exceed the accepted hold.

Use reservation states `reserved`, `indeterminate`, `settled`, and `released`.
Only reserved or reconciled indeterminate work can settle or release. A matching
terminal retry returns its receipt. A different terminal amount or outcome conflicts.
Preserve unresolved holds during outages. A terminal failure can still incur provider
cost, so failure alone is insufficient evidence for release.

Do not release a reservation solely because a timer elapsed when execution may
already have incurred cost. Reconcile the outcome before settlement or release.
Wallet and Satyr adapters supply their own execution receipts.

Satyr must carry its pinned inference funding source into usage records. Distinguish
developer-funded provider usage from platform-funded usage. Charge a Satyr service
fee only under an explicit plan. Preserve its rule against automatic funding fallback.

### Service addition procedure

To add a service, implement its provisioning and access adapter, own its data
migrations, register its meters and prices, and mount its UI routes. Add a composed
E2E journey with repeatable usage and billing evidence. Existing service schemas
should remain unchanged. Shared contract changes require a demonstrated common need.

## Code and deployment ownership

Keep the shared implementation in `packages/console-server-ts` and integration
contract types in `packages/console-shared-ts`. Extract the account router from
the wallet composition. Reuse the existing Worker deployment and database patterns.

Satyr consumes a versioned wire contract through an API client. Package and publish
only the required contract surface if both repositories need shared validation code.
Do not introduce cross-repository source imports or copy the billing implementation.

Keep wallet runtime adapters in `packages/wallet-console-server-ts`. Keep Satyr
adapters, tenant placement, and operational migrations in its repository. Account
platform deployment remains separately accountable for identity and money.

Expose developer account settings, account members, developer projects, enabled services, and
billing through the existing Console application. Keep product-specific operational
screens in Seams and Satyr. Satyr can open in the context of a platform instance
without sharing browser cookies or removing its session validation.

Billing screens show totals and breakdowns by project, service, and meter. Avoid
including private Case titles, source content, or sensitive resource labels in
billing events and documents. Use stable references where needed for reconciliation.

## Implementation sequence

### Phase 1 Define contracts and migration inventory

- Inventory developer accounts, native organisations, users, memberships, projects,
  payments, and service tenants in both systems. Record namespace and regional placement boundaries.
- Define platform scope, service instance state, tenant bindings, identity links,
  usage events, and billing attribution in the existing shared packages.
- Define migration mappings and invariants before changing schemas. Preserve
  balances, open reservations, memberships, signing identifiers, and tenant placement.
- Identify the accepted Satyr terminal-turn record that supplies the specified
  test meter. Document its exact fields and durable delivery path before coding.

Exit: reviewed contracts, exact ownership rules, and an executable migration design.
Resolve any account identity ambiguity without automatic developer account merges.

### Phase 2 Extract account composition and instance lifecycle

- Make account routes usable without wallet services.
- Add billing account identity, project billing bindings, service instances, and
  provisioning delivery through the existing persistence patterns.
- Move Wallet environment creation and signing configuration to Wallet ownership.
- Remove Wallet environment dependencies from account onboarding and sessions.
  Keep Wallet credentials and readiness inside the Wallet composition.
- Introduce the Wallet service adapter and bind existing projects and environments.

Exit: Seams works through the new composition with unchanged pricing and wallet
behaviour. An account-only deployment starts without wallet runtime dependencies.

### Phase 3 Generalise billing and reservations

- Replace the fixed resource price with versioned Wallet pricing definitions.
- Add meter scope, instance attribution, event deduplication, and charge evidence.
- Move reusable reservations to shared billing with atomic account-wide admission.
- Preserve payment references, refunds, disputes, open reservations, and historical
  documents. Add project and service breakdowns for attributable charges.

Exit: concurrent reservations cannot admit work beyond the available balance.
Replayed events and payment callbacks create no duplicate money entries.

### Phase 4 Connect Satyr

- Add authenticated provisioning, status, identity, membership, and usage adapters
  through Satyr's existing runtime boundaries.
- Bind a Satyr native tenant to one service instance. Preserve native project IDs,
  workspaces, regional placement, integration accounts, and inference authority.
- Move account membership authority to the Platform while retaining Satyr roles, person
  associations, source policy, project admission, and disclosure checks.
- Emit settled usage from durable execution evidence. Reconcile uncertain usage
  before billing or releasing funds.

Exit: one developer account can use both services and inspect consolidated charges.
Service disable and member revocation preserve Satyr's existing access invariants.

### Phase 5 Complete the interface and production cutover

- Add instance activation and status to the developer project interface.
- Complete cost breakdowns and service links in the shared Console.
- Rehearse migration, restart recovery, and restore on representative data.
- Cut over one bounded developer customer cohort at a time, with one authoritative writer
  for each cohort. Delete retired paths after reconciliation.

Exit: production records reconcile. The implementation removes old writers and
documents the service addition procedure alongside a working Satyr integration.

## Migration and historical records

Use explicit, rerunnable migrations at persistence boundaries. Keep operational
code on one final model. Do not add permanent compatibility branches or duplicate
membership and billing workflows.

Create a developer billing account for each existing Seams developer account. Bind its projects
and Wallet instances. Preserve provider references and the existing ledger history.
Determine current balances from the existing ledger without introducing duplicate credits.

Historical Seams charges may lack sufficient project evidence. Represent these
as developer-account-scoped historical charges through an explicit domain variant.
Display them as historical unattributed costs. Never assign them to an arbitrary
project. New service charges require instance attribution.

Import Satyr native tenants through explicit account and principal mappings. Preserve
service tenant IDs, native work projects, personal access, regional placement, and
archive deadlines. Do not infer developer account identity from native organisation names or email.

For each cohort, pause affected mutations and usage admission, drain or durably
record accepted work, snapshot state, migrate, verify, and switch the writer.
Durably retain payment callbacks and usage events during the pause, then replay
them through deduplication. Record the authority revision at the transition.

Before new writes, a failed verification can restore the snapshot. After new
writes, use a forward repair or a reconciled restore procedure. A blind restore
could lose charges, refunds, access revocations, or accepted executions.

Keep migration checkpoints, counts, unresolved identity mappings, ledger totals,
reservation totals, and tenant bindings as reviewable evidence. Retain snapshots
under existing backup policy. Remove temporary migration code after closure.

## Type constraints and acceptance evidence

Use discriminated unions, branch-specific builders, exhaustive switches, and
Result-style recoverable failures. Core functions accept validated narrow states.
Avoid optional identity, scope, authority, price, or lifecycle fields.

Add compile-time fixtures for invalid state combinations, direct construction,
broad spreads, and unsafe assertions that bypass builders. Use existing static
checks where applicable. TypeScript permits explicit unsafe assertions, so compiler
fixtures alone cannot establish their absence.

Place Seams type fixtures in `tests/typecheck/` and composed journeys in
`tests/e2e/console/`. Read each repository's test instructions before implementation.
Do not add unit tests or source snapshot tests for this work.

The main acceptance journey uses two developer accounts, two developer projects under
one developer account, Wallet and Satyr instances, and distinct finance/operator/private
project users. It must verify these behaviours:

| Scenario                                                                   | Required evidence                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Enable both services and retry provisioning after restart                  | One binding per native resource scope and accepted provisioning receipts      |
| Execute Wallet usage and Satyr work with different pricing mechanisms      | Raw usage, price versions, attributed charges, and a consolidated statement   |
| Deliver duplicate and conflicting usage events                             | One accepted charge and an explicit conflict result                           |
| Race reservations from both services against limited funds                 | Accepted reservations remain within available funds                           |
| Interrupt execution and reconnect the usage producer                       | Reconciled settlement or release without duplicate charge or lost reservation |
| Use developer-funded and platform-funded Satyr inference                   | Funding attribution matches the selected route and price policy               |
| Revoke a developer account member and attempt stale-session access         | New execution and protected disclosure are denied                             |
| Add a member to a restricted Satyr work project                            | Existing source/history checks still permit or reject the correct audience    |
| Disable Satyr while Wallet remains active                                  | New Satyr work stops and accepted work settles under its lifecycle rules      |
| Attempt cross-developer-account instance or usage substitution             | Authorisation rejects the foreign scope                                       |
| Migrate existing balances, refunds, reservations, and unattributed history | Before/after reconciliation preserves money and historical meaning            |

Also require these targeted cases in the owning phase's journey:

- Import two Wallet projects under the same native organisation and resolve both bindings.
- Complete account onboarding with no Wallet service, environment, or API key.
- Deliver an old activation receipt after disable and confirm that admission stays denied.
- Interrupt billing after commit but before acknowledgement, then replay the same event.
- Race a refund or debit with reservations and check the transactional admission result.
- Deny protected Satyr access during an account authority outage while preserving pending usage.
- Preserve Satyr private content when a platform owner lacks the service grant.

### Handoff gates

Before each phase, list the exact files, schema changes, and existing behaviour
that the phase will affect. Use this document's ownership table to limit scope.
After each phase, report the changed behaviour, actual validation commands, evidence
paths, and remaining failures. Do not mark a phase complete from type checks alone.

Before production cutover, record the final wire schemas, transaction boundaries,
role mappings, and restart procedures next to the implementation. Any deviation
from this plan needs an explicit rationale and review before dependent work proceeds.

Each run produces a machine-readable report, usage event records, ledger and
reservation reconciliation, and the resulting billing document. Record exact
commands, fixture versions, and expected outcomes. Include browser traces for
the UI and access steps. Exclude credentials and private source content.

Run the narrowest journey for each phase. Broaden checks when shared auth,
persistence, billing, or lifecycle changes require them. Run `pnpm check` for
Seams integration and `pnpm test:scripts` after deployment or script changes.
Use Satyr's type checks, onboarding closure checks, and relevant E2E commands
under its repository instructions. Record the actual commands in the evidence.

## Completion criteria

- One account authority serves both products with explicit user and tenant bindings.
- Shared billing records both services without duplicate charges or changed Seams prices.
- Satyr retains native work projects, source restrictions, placement, and operational lifecycle.
- Disabling a service does not disable unrelated services or erase unsettled obligations.
- A future service can integrate through documented contracts without adding fields
  to another service's domain models.
- Migration evidence reconciles ownership, access, balances, reservations, and usage.
- Retired account writers, billing paths, and temporary migration logic are removed.
- Satyr commercial prices receive explicit approval before developer charges begin.
