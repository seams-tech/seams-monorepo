# Application-scoped multi-tenancy implementation plan

Status: proposed; implementation has not started.
Date: October 14, 2026.

## Outcome

Let a developer account create an Application whose users can create or join
organisations, manage members, and work in projects with separate project environments.
Reuse existing account, membership, invitation, session, and project code.
Expose this capability through an application API and a small client integration.

Use the [Platform glossary](platform-glossary.md). This plan specifies future work.
Writing it does not change code, schemas, credentials, deployments, or product behaviour.

```text
Developer account
└── Application
    ├── Users
    └── Organisations
        ├── Memberships and roles
        └── Projects
            └── Project environments: development / staging / production
                └── Resources and optional Wallet bindings
```

**Application** is the outer scope for application identities and organisations.
**ProjectEnvironment** identifies a project's deployment and resource scope.
An environment name grants no authority. Do not introduce an `ApplicationEnvironment`
entity or use `PlatformTenant` as another name for this hierarchy.

This extends [Shared Account Platform](feat-1-shared-account-platform.md).
It does not require the [Console domain cutover](feat-2-platform-console.md).
[Monthly postpaid billing](feat-3-platform-billing.md) remains developer billing.
Charging an application's end customers is separate application billing and is outside this plan.

## First-release scope and boundaries

- One Application belongs to one developer account. Application transfer is deferred.
- Users belong to an Application and can hold memberships in several of its organisations.
  Developer account membership and organisation membership confer separate authority.
- Reuse owner, administrator, and member behaviour where it fits. Preserve last-owner
  protection, invitation expiry, verified-recipient checks, suspension, and revocation.
  Keep developer permissions such as Platform support and developer billing out of application roles.
- Organisations own projects. Projects own project environments. Scope application
  credentials, resource operations, and environment-specific grants explicitly.
- For the initial model, user identities and organisation memberships are application-wide.
  Project environments isolate deployment resources and credentials. Production access
  requires an explicit grant; development access alone must not authorise it.
  A developer requiring separate identity populations uses separate Applications.
- Keep business records in the developer's application. Seams supplies verified context
  and permissions; the application must apply them to its own queries and operations.
- Preserve Wallet custody, signing consent, native permissions, and existing request budgets.
  Keep Wallet optional. An account-only Application needs no Wallet runtime startup.
- Defer enterprise SSO/SCIM, custom role engines, arbitrary policy languages, cross-application
  identity federation, tenant transfers, and application billing. Add no plugin framework,
  generic service registry, new runtime service, or database solely for this feature.

## Reuse and ownership

Paths below are relative to `seams-monorepo`.

| Existing owner                                           | Reuse                                                                | Required boundary change                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/console-server-ts/src/account/`                | Profile and account lifecycle rules                                  | Separate developer account administration from application organisation operations                   |
| `packages/console-server-ts/src/teamRbac/`               | Memberships, roles, invitations, revocation versions, project grants | Require application scope for application-facing operations                                          |
| `packages/console-server-ts/src/orgProjectEnv/`          | Organisation and project persistence                                 | Resolve the application's storage scope before constructing services                                 |
| `packages/console-server-ts/src/boundary/` and `router/` | Provider verification, sessions, request parsing, authentication     | Add distinct application credentials and session authority                                           |
| `packages/console-shared-ts/src/`                        | Boundary parsers, Result unions, precise lifecycle contracts         | Add application-scoped contracts without changing existing developer record meanings                 |
| `apps/wallet-console/src/core/`                          | Shared account forms, navigation primitives, HTTP patterns           | Add Application management to the Platform composition; reuse end-user UI only through narrow inputs |
| `packages/wallet-console-server-ts/`                     | Hosted Wallet adapters and resource admission                        | Resolve optional application-to-Wallet bindings through existing product boundaries                  |

Current factories often accept `namespace`, `orgId`, and `actorUserId`. Some helpers
also support default organisations or project-only lookups. Those inputs do not
constitute a public application isolation boundary.

Reuse the current business rules and transactions. Extract only the shared rules
that cannot accept precise application context today. Avoid copying membership,
invitation, or billing services into a parallel implementation. Keep developer and
application authorization types distinct even where they use the same underlying logic.

## Application registry and persistence

Add an Application record with a stable `applicationId`, developer-account ownership,
lifecycle, permitted authentication configuration, and credential references.
Resolve ownership through the existing developer account permissions.

An Application is distinct from an existing developer project. The current
`PlatformScopeV1.organizationId` and `projectId` continue to identify a developer
account and developer project. Do not reinterpret them as end-customer identifiers.

Use the existing D1 database and migration workflow. Prefer reusing namespace-scoped
account stores through an immutable, server-owned Application-to-storage mapping.
Each Application must resolve to a unique partition that cannot overlap developer
account storage or another Application. Callers cannot supply or select that namespace.

Before choosing this storage reuse, trace every relevant query, join, unique key,
foreign key, and bulk operation. Prove that the resolved scope reaches each operation.
Add targeted application ownership columns or constraints where the existing schema
cannot express the required isolation. Namespace substitution alone is insufficient.

Required persistence invariants:

1. Application ownership is authoritative and cannot be changed by an end-user request.
2. Identity links are unique within `(applicationId, providerIssuer, providerSubject)`.
   The same verified person can have independent users in two Applications.
   Email equality cannot merge users or memberships across Applications.
3. Every organisation, membership, invitation, project, and project environment has
   an immutable application ownership chain. Cross-scope references fail at persistence boundaries.
4. Uniqueness, idempotency, and invitation redemption include the resolved application
   scope. A key or token replay in another Application cannot reuse an earlier result.
5. Developer rows retain their current identities and storage scope. New application
   records cannot become developer organisations through a fallback or missing field.

Keep applied migrations unchanged. Use forward migrations for new records and
constraints. Existing Wallet and Satyr deployments remain in their current scopes.
Import into an Application only through a separately reviewed, explicit mapping.

## Authentication and authorization

Keep three actors separate:

| Actor                         | Authority                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Developer Console session     | Manage Applications and credentials within an authorised developer account                                            |
| Application server credential | Perform explicitly granted application-management operations; never impersonate a user or authorise Wallet signatures |
| Application user session      | Act as a user within that Application and their current organisation/project grants                                   |

Reuse provider verification and session infrastructure. Start with the existing
verified-provider flow. Add application-specific issuer/audience checks, login
configuration, exact origins, callback destinations, and signing-key selection.
Keep raw provider tokens transient and retain only the required verified identity evidence.

Reuse credential hashing, rotation, revocation, and audit patterns. Application
server credentials remain server-only. Public application identifiers select login
configuration and grant no administrative authority. Existing Wallet credentials and
developer Console cookies must not authenticate the application-user API.

At each request boundary:

1. Verify the credential's purpose, issuer, audience, expiry, and application binding.
   Match any application ID in the route to that verified binding.
2. Resolve the current Application lifecycle and server-owned storage scope.
3. Resolve organisation membership and the requested permission. Verify the full
   parent chain for project and environment operations.
4. Build the narrow authorized context required by the operation. Core functions
   receive that context, never raw IDs with an optional application scope.

Use required fields, discriminated unions, branch-specific builders, and exhaustive
switches. Keep unauthenticated, developer, application-server, and application-user
states distinct. Keep parsed identity separate from verified authority. Do not permit
domain casts or broad object spreads to construct an authorized context.

Reuse current revocation versions and fresh authorization checks. Removed members,
revoked credentials, suspended Applications, and archived resources must reject new
protected operations. Existing sessions must not preserve grants that were removed.

The selected organisation is request context. A tab switch or URL change cannot
grant access or change another tab's authority. Validate the explicit target against
the caller's membership on every request. Avoid a browser-global active-organisation
cookie as the sole source of scope for background requests.

Scope caches, pagination cursors, exports, audit reads, queued work, and event delivery
by Application and their relevant child identities. Avoid cross-application existence
disclosure in errors. Recheck authority before deferred protected work or disclosure.
Keep accepted financial settlement independent of a user's later session state.

## Public API and client surface

Use explicit versioned routes in the existing Worker. The following route families
describe the proposed contract; they are not implemented endpoints.

| Surface                                              | Operations                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Developer Console `/console/applications`            | Create, list, configure, suspend, and inspect owned Applications; manage application credentials |
| Application authentication `/applications/v1/auth/*` | Authenticate an application user, inspect a session, and revoke a session                        |
| `/applications/v1/organizations`                     | List accessible organisations and create one when the application's policy permits it            |
| Organisation member and invitation routes            | Invite, accept, change permitted roles, remove membership, and inspect current access            |
| Organisation project routes                          | Create, list, update, and archive projects with existing lifecycle rules                         |
| Project environment routes                           | Manage environments and environment-specific resource access                                     |

Define a small fixed permission set for the first release. Application owners choose
whether users can create organisations. Require verified invitation acceptance and
atomically establish the initial owner. Replay of a create request must not leave
duplicate organisations, ownerless records, or extra memberships.

Expose typed request/response contracts, bounded lists, stable errors, and idempotent
mutations. Reuse existing invitation delivery and audit machinery. Do not publish
private provisioning, billing-settlement, or support endpoints as application APIs.
Apply request and invitation limits per Application and actor through existing
admission patterns. One Application must not consume another's allowance.

Prove the contract through one thin browser/server integration before publishing a
new SDK package. Reuse the existing organisation picker and member form behaviour
without importing the entire Console into customer applications. Keep the account
client independent of the Wallet SDK. Public package ownership and release paths
must be assigned explicitly before publication; private Console packages stay private.

## Optional Wallet integration and developer billing

Configure Wallet explicitly for an Application using a developer project owned by
the same developer account. This is a binding between existing concepts. It does
not make the Application and developer project the same entity.

Bind application users or organisation-owned Wallet resources through verified
identity and the existing Wallet provisioning flow. Resolve the application,
organisation, project, and project environment before accepting a binding. Reject
substitution of a wallet or environment from another Application or organisation.
An application project environment needs an explicit mapping to the native Wallet
environment. Matching names such as `production` do not establish that mapping.

Membership grants application permissions. Wallet ownership, consent, and signing
policy remain authoritative for signatures. Removing a member cannot transfer a
personal wallet. Developer account administration cannot imply custody of end-user wallets.
Preserve existing recovery and independently owned Wallet contracts.

Use existing Wallet admission points and capability checks. Do not add serial
Platform requests, schema setup, or awaited billing delivery to registration,
unlock, signing, or response paths. Ship the Wallet integration only after its
isolation checks and existing query/service-call budgets pass.

Seams charges the developer billing account. Derive its payer and existing service
instance from the authoritative Application binding. End-customer IDs provide
attribution only and cannot select another payer. Reuse durable usage events,
pricing versions, and the ledger. New billable meters require approved prices.
End customers' subscriptions, invoices, and payment methods remain outside this release.

## Implementation sequence

### 1. Prove scope and define contracts

Inventory current namespace handling, identity keys, sessions, membership checks,
default-scope helpers, and persistence constraints. Define the Application registry,
scope builders, actor types, fixed permissions, and versioned API contracts.
Record the smallest required migration and the existing factories each route will reuse.

Exit: developer and application authority cannot be confused in the types or storage
mapping. No application operation can fall back to developer scope.

### 2. Implement scoped account operations

Add the registry and required persistence constraints. Adapt existing account,
membership, invitation, and project factories to validated application contexts.
Add application sessions and credentials through existing authentication boundaries.
Preserve existing developer Console and first-party product behaviour.

Exit: two Applications can use the same organisation names, provider subjects,
and idempotency keys without sharing records or authority. Cross-scope references fail.

### 3. Add Console management and client integration

Add Application administration to the Platform Console composition. Build one
application-facing journey for login, organisation selection, invitations, projects,
and project environments. Add the optional Wallet binding through current adapters.
Use the same account contracts in browser and server integrations.

Exit: a developer can configure an Application and its users can complete the journey.
Account-only operation works without Wallet or Satyr runtime dependencies.

### 4. Acceptance and bounded rollout

Read `tests/AGENTS.md`. Use composed E2Es and type fixtures. Add no unit tests or
source-text guards. Test the real account persistence and authentication boundaries.

Use one journey with two developer accounts, two Applications under one account,
another Application under the second account, and overlapping verified identities.
Create multiple organisations and projects with development and production environments.

The journey must demonstrate:

- Organisation creation and invitation acceptance survive duplicate delivery and restart.
- A user switches between authorised organisations without affecting another browser tab.
- Foreign application credentials, developer sessions, organisation IDs, invitation
  tokens, project/environment IDs, cursors, and idempotency keys cannot cross scopes.
- Role changes, revocation, Application suspension, and resource archive reject stale
  authority. A development grant cannot access production resources.
- The same provider subject in two Applications remains two independent user contexts.
  Developer account membership alone grants no application-user access.
- Optional Wallet provisioning preserves ownership, environment isolation, signing
  permissions, and existing request costs. It never creates Satyr resources.
- Usage resolves to the correct developer billing account without duplicate charges.
  Developer Console and existing Wallet/Satyr journeys continue to pass.

Save commands, source revisions, schema versions, request results, database scope
checks, screenshots, traces, and relevant Wallet call counts under
`.artifacts/platform-multitenancy/`. Add static checks for invalid actor/scope
combinations, direct construction, broad spreads, and existing unsafe-cast escape hatches.

Run narrow checks per phase and `pnpm check` after shared auth or persistence changes.
Run `pnpm test:scripts` when deployment scripts change. Run public Wallet contracts
in `seams-wallet` only if that repository's behaviour changes. Classify failures
against current contracts before changing implementation or fixtures.

Stage with isolated developer accounts first. Verify prerequisite migrations and
deployments before a bounded opt-in release. Reuse existing runtime topology and
exact Wallet package releases. Do not migrate existing customers automatically.
On rollback, stop new application admissions and retain accepted billing delivery.
Deploy only artifacts that understand existing records; preserve financial history.
Report local validation, staging, and production separately.

## Completion criteria

- Application scope is mandatory from credential verification through persistence and deferred work.
- Developer accounts, organisations, projects, and project environments have distinct meanings and authorities.
- Existing account rules and transactions serve the new API without a parallel membership engine.
- Account-only Applications operate independently of product runtimes.
- Optional Wallet integration preserves custody, permissions, and request budgets.
- Acceptance evidence proves isolation, revocation, retry safety, and correct developer billing attribution.
- Public API publication, package release, and production deployment are reported separately from local implementation.
