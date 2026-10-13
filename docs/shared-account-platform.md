# Shared account platform implementation plan

Status: planned. Implementation and production migration have not started.
Date: October 13, 2026.

## Purpose and decisions

Build one account platform for Seams, Satyr, and future services. Reuse the
existing Console core for organisations, users, memberships, platform projects,
service access, and billing. Keep each service's operational data and execution
rules in its owning runtime.

The first release provides one billing account per platform organisation,
multiple platform projects, and independently enabled services. Users can belong
to several organisations. Each service can define several usage measures and
prices. Seams retains its current commercial behaviour during the transition.

Platform projects define resource ownership and cost attribution. Satyr's existing
projects remain work resources inside Satyr. They retain their personal/shared
access, Cases, briefs, references, and history controls.

Bind one Satyr tenant to one platform project for the initial integration.
An existing tenant cannot serve several platform projects. A second instance
requires a separate tenant and successful isolation verification.

This plan defines the implementation defaults. Actual Satyr prices, new payment
terms, and customer account merges require explicit product decisions before use.
The implementation can proceed with test prices and separately identified accounts.

## Current implementation and constraints

Seams paths below are relative to `seams-monorepo`. Satyr paths are relative to
`/Users/pta/Dev/lowerarchy/satyr`.

| Area                | Current implementation                                                                     | Consequence                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Seams ownership     | `packages/console-server-ts/src/orgProjectEnv/{types,service,d1}.ts`                       | Organisation and project identity already have a shared package owner. Project creation also creates three environments. |
| Seams access        | `packages/console-server-ts/src/teamRbac/`                                                 | Reuse membership lifecycles and administrative permissions. Service content needs separate access checks.                |
| Seams billing       | `packages/console-server-ts/src/billing/`                                                  | Reuse the ledger and payment flows. Replace the fixed resource price and organisation-only usage attribution.            |
| Seams composition   | `packages/wallet-console-server-ts/src/router/consoleComposition.ts`                       | The production composition still requires wallet services. Extract a usable account-only composition.                    |
| Wallet reservations | `packages/wallet-console-server-ts/src/billingPrepaidReservations/`                        | Move reusable money reservation behaviour into shared billing. Keep wallet execution policy in Wallet.                   |
| Satyr projects      | `packages/control-api/src/{projects,project-access}.ts`                                    | Projects contain work context and personal/shared access. They are distinct from platform projects.                      |
| Satyr membership    | `services/platform/migrations-regional/0001_current_schema.sql`, `organisation_membership` | Membership includes `personId` and owner/admin/operator/viewer roles. Preserve service roles and person bindings.        |
| Satyr lifecycle     | `services/platform/src/data/control-plane.ts`, `organisation-lifecycle.ts`                 | Onboarding carries development/production mode, activation, archive, and purge state. Keep this service lifecycle.       |
| Satyr storage       | `services/platform/src/organisation-execution-scope.ts`                                    | Regional placement and write fences remain authoritative for Satyr operations.                                           |
| Satyr disclosure    | `services/platform/src/projects/membership.ts` and `policy/information-flow/README.md`     | Project admission checks source access and retained history. Platform membership cannot bypass these checks.             |
| Satyr inference     | `services/platform/src/data/organisation-inference-selection.ts`, `workspace-ai-budget.ts` | Funding selection and token/time/tool limits are separate from customer money balances.                                  |

The inspected Satyr code has execution budgets and provider usage records.
It does not establish a customer money ledger equivalent to Seams billing.
Satyr's Stripe connection code serves commerce integrations and remains separately owned.

## Ownership model

```text
Platform organisation
  Users and organisation memberships
  Billing account
  Platform project
    Wallet service instance
      Wallet environments and operational resources
    Satyr service instance
      Satyr tenant and regional placement
      Satyr work projects and Cases
      Commerce connections, workspaces, and agent sessions
```

An organisation identifies the customer account. A platform project defines a
resource and cost boundary. A service instance binds an enabled service to that
project and its operational tenant.

The account platform owns shared records. Service runtimes own operational records.
Services communicate through versioned APIs and authenticated events. They do not
read another runtime's private tables or import its private implementation.

| Record                  | Owner                | Required meaning                                                                          |
| ----------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| Platform organisation   | Account platform     | Stable customer identity, account name, lifecycle, and ownership                          |
| User identity           | Account platform     | Stable principal with verified identity-provider bindings                                 |
| Organisation membership | Account platform     | Current membership eligibility and account administration permissions                     |
| Platform project        | Account platform     | Organisation ownership, account-level visibility, name, and lifecycle                     |
| Billing account         | Account platform     | Payment responsibility, currency, and ledger identity                                     |
| Project billing binding | Account platform     | The billing account responsible for the project's charges                                 |
| Service instance        | Account platform     | Service identity, project ownership, requested access, and observed provisioning state    |
| Service tenant binding  | Integration boundary | Stable association between an instance and the service's native tenant identity           |
| Satyr tenant            | Satyr                | Regional placement, operational lifecycle, integrations, inference choice, and workspaces |
| Satyr work project      | Satyr                | Work context, project roles, source restrictions, and Case membership                     |
| Service grants          | Owning service       | Permissions for its operations and resources                                              |

Keep one billing account per organisation in the first release. Give it its own
identifier and bind every platform project to it. Multiple payers, cross-organisation
billing, project transfers, and multiple currencies remain outside this release.

### Identity and data rules

- Preserve existing operational IDs. Resolve platform IDs through explicit tenant
  bindings at request and persistence boundaries.
- Include the current Seams storage namespace when resolving an existing identity.
  An ID string alone does not establish ownership.
- Enforce unique tenant bindings within each service deployment. Reject attempts
  to bind the same tenant to another project.
- Link existing users through verified identity-provider subjects or an explicit
  authenticated account-link flow. An email match alone cannot merge accounts.
- Keep service-specific fields in typed service tables. Avoid a shared metadata
  object containing optional fields for every product.
- Give every replicated field one authoritative owner. Local access projections
  carry an authority revision and cannot become independent membership writers.

### Environments and lifecycle

Remove environment creation from generic platform project creation. Wallet
provisioning creates its existing dev/staging/prod environments. Preserve their IDs,
keys, status semantics, and signing metadata during this move.

Move the Console environment `runtimeVersion` field into wallet-owned configuration.
The wallet adapter currently interprets this field as `signingRootVersion`.
Preserve stored signing identifiers and wire contracts exactly.

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

The account platform decides who belongs to an organisation and who can manage
projects, services, or payments. The service decides who can read its content or
perform an operational action.

A billing administrator can inspect costs without access to private Satyr chats.
A Satyr operator can execute an authorised workflow without access to payments.
Platform project visibility alone grants no access to Satyr work projects.
Admission also requires access to the specific service instance. Membership in
the platform organisation does not automatically admit a user to every Satyr tenant.

At the service boundary, resolve the verified principal, organisation, project,
instance, and current account eligibility. Then apply the service's own grants.
Satyr must retain source access, history disclosure, capability, and approval checks.

Use the existing authentication mechanisms where possible. Any delegated assertion
must bind the issuer, audience, principal, scope, expiry, and authority revision.
Authenticate service usage producers and restrict each producer to its bound instances.
Never trust caller-supplied organisation or project IDs as authority.

Membership removal must invalidate service admission and ongoing disclosure where
the service already requires live access. Define and verify projection freshness
before release. If current authority cannot be established, reject new protected work.
Asynchronous membership delivery alone is insufficient proof of current access.

The platform owns organisation invitations and membership revocation. Satyr owns
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

### Usage and pricing

A usage event identifies its producer, event ID, instance, meter, quantity, unit,
occurrence time, and service-local execution or resource reference. A meter defines
what is measured, such as monthly active wallets or completed agent runs.

Resolve organisation, project, and billing account from the authoritative instance
binding. Validate the event once at ingress. Reject unknown measures, invalid units,
invalid quantities, and producers without authority for that instance.

Deduplicate by producer, instance, and event identity. Reject conflicting reuse of
an event ID. Repeated delivery must not create another charge.

The service owns billable activity semantics. Shared billing applies a registered,
immutable price version and records the charge. A service can supply a trusted
execution quote through a separate typed contract for variable execution costs.
End-user requests cannot submit authoritative charge amounts.

Preserve quantity, unit, price version, charge scope, source evidence, and amount on
each usage charge. Define fixed-precision arithmetic and rounding at the billing
boundary. Usage rates can require greater precision than final USD cents.

Keep metering policy separate from charge attribution. Seams currently counts
active resources across an organisation and month. Preserve that scope during
migration, even when usage arrives through several project instances. Record the
accepted charge against its originating instance without charging the resource twice.

Define the time rule for each meter. Select prices by the documented occurrence
or accepted quote time. Late events and corrections retain the original policy.
Append corrections with links to prior charges. Do not rewrite settled history.

A service can combine recurring fees and measured usage. Implement a pricing
mechanism only when Seams or the selected Satyr plan requires it. The first
acceptance journey uses two actual mechanisms, including fixed-price measured usage
and quoted execution usage. It does not require speculative seat or tier engines.

### Payment and execution controls

Shared billing owns prepaid funds, balanced ledger postings, reservations, refunds,
payment reconciliation, and billing documents. Keep product execution permissions
and token/time/tool limits inside the service.

Reserve funds atomically before admitting prepaid execution. Account-wide available
funds must include reservations from every service. Settlement and release must
survive retries, worker restarts, and ambiguous execution outcomes.

Do not release a reservation solely because a timer elapsed when execution may
already have incurred cost. Reconcile the outcome before settlement or release.
Wallet and Satyr adapters supply their own execution receipts.

Satyr must carry its pinned inference funding source into usage records. Distinguish
customer-funded provider usage from platform-funded usage. Charge a Satyr service
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

Expose organisation settings, members, platform projects, enabled services, and
billing through the existing Console application. Keep product-specific operational
screens in Seams and Satyr. Satyr can open in the context of a platform instance
without sharing browser cookies or removing its session validation.

Billing screens show totals and breakdowns by project, service, and meter. Avoid
including private Case titles, source content, or sensitive resource labels in
billing events and documents. Use stable references where needed for reconciliation.

## Implementation sequence

### Phase 1 Define contracts and migration inventory

- Inventory deployed organisation, user, membership, project, payment, and tenant
  identities in both systems. Record namespace and regional placement boundaries.
- Define platform scope, service instance state, tenant bindings, identity links,
  usage events, and billing attribution in the existing shared packages.
- Define migration mappings and invariants before changing schemas. Preserve
  balances, open reservations, memberships, signing identifiers, and tenant placement.
- Select one Satyr usage measure and its non-production test price. Identify the
  existing flow that will emit authoritative usage.

Exit: reviewed contracts, exact ownership rules, and an executable migration design.
Resolve any account identity ambiguity without automatic customer merges.

### Phase 2 Extract account composition and instance lifecycle

- Make account routes usable without wallet services.
- Add billing account identity, project billing bindings, service instances, and
  provisioning delivery through the existing persistence patterns.
- Move Wallet environment creation and signing configuration to Wallet ownership.
- Introduce the Wallet service adapter and bind existing projects and environments.

Exit: Seams works through the new composition with unchanged pricing and wallet
behaviour. An account-only deployment starts without wallet runtime dependencies.

### Phase 3 Generalise billing and reservations

- Replace the fixed resource price with versioned Wallet pricing definitions.
- Add meter scope, instance attribution, event deduplication, and charge evidence.
- Move reusable reservations to shared billing with atomic account-wide admission.
- Preserve payment references, refunds, disputes, open reservations, and historical
  documents. Add project and service breakdowns for attributable charges.

Exit: two concurrent service producers cannot overspend the same available balance.
Replayed events and payment callbacks create no duplicate money entries.

### Phase 4 Connect Satyr

- Add authenticated provisioning, status, identity, membership, and usage adapters
  through Satyr's existing runtime boundaries.
- Bind a Satyr tenant to one platform instance. Preserve native project IDs,
  workspaces, regional placement, integration accounts, and inference authority.
- Switch organisation membership authority while retaining Satyr roles, person
  associations, source policy, project admission, and disclosure checks.
- Emit settled usage from durable execution evidence. Reconcile uncertain usage
  before billing or releasing funds.

Exit: one organisation can use both services and inspect consolidated charges.
Service disable and member revocation preserve Satyr's existing access invariants.

### Phase 5 Complete the interface and production cutover

- Add instance activation and status to the platform project interface.
- Complete cost breakdowns and service links in the shared Console.
- Rehearse migration, restart recovery, and restore on representative data.
- Cut over one bounded customer cohort at a time, with one authoritative writer
  for each cohort. Delete retired paths after reconciliation.

Exit: production records reconcile. The implementation removes old writers and
documents the service addition procedure alongside a working Satyr integration.

## Migration and historical records

Use explicit, rerunnable migrations at persistence boundaries. Keep operational
code on one final model. Do not add permanent compatibility branches or duplicate
membership and billing workflows.

Create a billing account for each existing Seams organisation. Bind its projects
and Wallet instances. Preserve provider references and the existing ledger history.
Determine current balances from the existing ledger without introducing duplicate credits.

Historical Seams charges may lack sufficient project evidence. Represent these
as organisation-scoped historical charges through an explicit domain variant.
Display them as historical unattributed costs. Never assign them to an arbitrary
project. New service charges require instance attribution.

Import Satyr tenants through explicit account and principal mappings. Preserve
service tenant IDs, native work projects, personal access, regional placement, and
archive deadlines. Do not infer customer identity from organisation names or email.

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

The main acceptance journey uses two organisations, two platform projects under
one organisation, Wallet and Satyr instances, and distinct finance/operator/private
project users. It must verify these behaviours:

| Scenario                                                                   | Required evidence                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Enable both services and retry provisioning after restart                  | One tenant binding per instance and accepted provisioning receipts            |
| Execute Wallet usage and Satyr work with different pricing mechanisms      | Raw usage, price versions, attributed charges, and a consolidated statement   |
| Deliver duplicate and conflicting usage events                             | One accepted charge and an explicit conflict result                           |
| Race reservations from both services against limited funds                 | Accepted reservations remain within available funds                           |
| Interrupt execution and reconnect the usage producer                       | Reconciled settlement or release without duplicate charge or lost reservation |
| Use customer-funded and platform-funded Satyr inference                    | Funding attribution matches the selected route and price policy               |
| Revoke an organisation member and attempt stale-session access             | New execution and protected disclosure are denied                             |
| Add a member to a restricted Satyr work project                            | Existing source/history checks still permit or reject the correct audience    |
| Disable Satyr while Wallet remains active                                  | New Satyr work stops and accepted work settles under its lifecycle rules      |
| Attempt cross-organisation instance or usage substitution                  | Authorisation rejects the foreign scope                                       |
| Migrate existing balances, refunds, reservations, and unattributed history | Before/after reconciliation preserves money and historical meaning            |

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
- Satyr commercial prices receive explicit approval before customer charges begin.
