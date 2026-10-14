# Application-scoped multi-tenancy implementation plan

Status: proposed; implementation has not started.
Date: October 14, 2026.

## Outcome

Add an Application boundary around the existing organisation, membership, invitation,
and project services. A developer account owns the Application. Each Application's
users and account records remain isolated from other Applications and developer accounts.

Use the [Platform glossary](platform-glossary.md). This plan is documentation only.
It changes no code, schemas, credentials, or deployments.

```text
Developer account
└── Application                  new ownership and isolation boundary
    ├── Users
    └── Organisations            reuse existing account rules
        ├── Memberships
        └── Projects
            └── Project environments and resources remain product-owned
```

Application scope contains users and organisations. Project environments retain their
development/staging/production meaning. This slice adds no generic environment store,
environment API, or new environment permission model.

## Smallest implementation

There are three changes:

1. Store the Application's owner and its private storage namespace.
2. Bind the existing authentication flow and resulting session to that Application.
3. Construct existing account services with the resolved namespace and mount their
   supported operations behind application authentication.

Keep the current Worker, database, packages, account rules, and deployment structure.
Do not copy account services or introduce a universal tenancy framework.

## 1. Add the Application record

Store a stable `applicationId`, its developer account owner, an immutable storage
namespace, and active/suspended state. Resolve developer account ownership through
existing Console permissions. Creating or suspending an Application is a developer
administration operation; it creates no end-customer membership.

Allocate the namespace on the server. Enforce a unique Application-to-namespace
mapping and prevent overlap with developer storage. Callers cannot choose a namespace
or change an Application's owner. Application transfer and automatic imports are deferred.

Use one forward migration for the registry and any demonstrated constraint gaps.
Keep existing developer records, applied migrations, and stored identifiers unchanged.
`PlatformScopeV1.organizationId` and `projectId` still identify a developer account
and developer project. An Application is a separate entity.

## 2. Resolve application authority at the boundary

Reuse the existing verified-provider login and session implementation. Bind login
state and callback validation to the selected Application. Issue an application
session only after successful identity verification. Reuse signing infrastructure;
no separate authentication engine or per-application key hierarchy is required.
Start with the existing configured provider and login origin. Validate return
destinations against server configuration. Custom authentication domains are deferred.

An application session must carry an explicit application identity and distinct
purpose/audience from developer Console and product credentials. Reject expired,
revoked, foreign-application, and wrong-purpose credentials. A public `applicationId`
selects the login configuration and grants no authority by itself.

For an authenticated application request:

1. Verify the session and match any route application ID to its verified identity.
2. Resolve the active Application and its server-owned namespace.
3. Construct the required account services with that namespace and schema setup disabled.
4. Run the existing membership and operation permission checks in that scope.

Represent resolved application context separately from developer authority. Require
it when assembling application handlers. Keep parsed identity separate from verified
authority. Do not add optional `applicationId` fields or default-scope fallbacks.
Existing inner functions can retain their current inputs when their service instance
already binds them to the verified namespace.

Users and organisation memberships are application-scoped. Reuse existing provider
identity handling within that scope. The same provider subject can have independent
records in two Applications. Email equality grants no membership and cannot merge
records across Applications. Developer account membership never substitutes for an
application-user session or organisation membership.

## 3. Reuse the existing services

| Existing code                                            | Use in this change                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/console-server-ts/src/account/`                | Reuse profile and organisation operations through application-scoped service instances |
| `packages/console-server-ts/src/teamRbac/`               | Keep membership, invitation, last-owner, revocation, and project-access rules          |
| `packages/console-server-ts/src/orgProjectEnv/`          | Keep organisation and project persistence and lifecycle rules                          |
| `packages/console-server-ts/src/boundary/` and `router/` | Reuse provider verification, session handling, and request parsers                     |
| `packages/console-shared-ts/src/`                        | Add only the Application and authority contracts needed by these boundaries            |

Use the narrow factories required by each route. Do not instantiate the complete
billing and service-provisioning bundle for application account operations.
Reuse current roles and the permissions relevant to the mounted account routes.
Keep developer billing, Platform support, and private service ingress unavailable
through the application API.

Mount explicit application routes for login/session handling, organisations,
memberships, invitations, and projects in the existing Worker. Adapt existing
handlers where they assume developer scope. Do not publish every Console route.
Reuse an existing account journey to exercise these routes before adding a new UI.
A public SDK, embeddable components, application server credentials, and a separate
Application management dashboard are follow-up work.

## Isolation requirements

Existing namespace columns make reuse plausible. They do not establish that every
operation is safe. Audit the paths actually exposed by the application routes:

- Scope queries, joins, uniqueness, and foreign keys to the resolved namespace and
  relevant organisation/project. Fix only demonstrated gaps. Avoid duplicating
  `applicationId` across tables whose namespace constraints already enforce ownership.
- Remove default-organisation or unscoped lookup behaviour from the application path.
  An unknown Application or resource must not fall back to developer scope.
- Scope identity records, invitation tokens, idempotency keys, cache entries, and
  pagination cursors. A replay or cached result from Application A cannot serve B.
- Preserve scope through existing invitation delivery, audit, and background work
  used by these routes. Reject foreign targets without exposing their records.
- Apply existing live permission and revocation checks. Removed members, revoked
  sessions, suspended Applications, and archived projects cannot retain access.
- Treat organisation selection as request context. Verify membership for the target
  organisation on each request, including background browser requests and multiple tabs.
- Reuse current request limits and invitation protections. Key them by Application
  where necessary so one Application cannot consume another's allowance.

If a factory cannot preserve scope, fix that boundary before exposing it. A whole
account-stack rewrite is not a prerequisite. Developer Console behaviour stays on its
existing authenticated path and storage scope.

## Work outside this slice

[Console separation](feat-2-platform-console.md) and
[monthly postpaid billing](feat-3-platform-billing.md) remain independent plans.
This change adds no meters, payment flows, application billing, or payer selection API.

Keep Wallet and Satyr integrations unchanged. Do not create new application-to-Wallet
bindings, modify custody or signing, or add account calls to Wallet request paths.
Connecting application users and project environments to Wallet is a later integration
with its own ownership, permission, and request-budget checks.

The developer's business database also remains outside this feature. Application
code must enforce Seams' verified context when accessing its own records.

## Implementation and acceptance

1. **Trace and define.** Map the selected handlers to their factories and persistence
   operations. Define the minimal Application record and verified context. Record
   concrete scope gaps before proposing additional schema or helper changes.
2. **Implement in place.** Add the registry, application session binding, and scoped
   route assembly. Reuse the current factories and fix the identified gaps. Keep
   request-time schema setup disabled and deployment topology unchanged.
3. **Prove isolation.** Extend one composed E2E journey using real D1 and authentication.
   Use two Applications under one developer account and another under a different
   developer account. Reuse provider subjects, resource names, and idempotency keys
   across them. Verify legitimate access, then attempt cross-application reads,
   mutations, invitation acceptance, and replay. Check a developer credential against
   application routes, membership revocation, Application suspension, and recovery
   after a lost create response. Confirm existing developer account journeys still pass.

Read `tests/AGENTS.md`. Add no unit tests or source-text guards. Add focused type
fixtures for developer/application authority confusion, incomplete contexts, direct
construction, and broad spreads. Use existing checks for unsafe domain casts.

Save the command, source revision, migration identity, scoped results, and replay
receipts under `.artifacts/platform-multitenancy/`. Add browser evidence if the
implementation changes browser behaviour. Run narrow checks during implementation
and `pnpm check` after the shared authentication/persistence change. Run
`pnpm test:scripts` only if deployment scripts change. No Wallet latency campaign
is required while its runtime and request paths remain untouched.

Stage with isolated Applications before enabling developer accounts. Verify migration
and deployment prerequisites. Keep existing accounts out of automatic migration.
For rollback, stop new application admission and restore compatible artifacts while
preserving stored records. Report local validation and deployment separately.

## Completion criteria

- Every application request resolves authenticated application scope before accessing account data.
- Cross-application and developer/application access attempts fail at the relevant boundaries.
- Existing account rules and factories serve the new routes without duplicate implementations.
- Existing developer accounts, Wallet, and Satyr behaviour remain unchanged.
- One repeatable E2E demonstrates successful use, isolation, revocation, and retry safety.
