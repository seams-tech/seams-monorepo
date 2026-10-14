# Phase 4: Satyr integration

Status: implemented and validated. The account integration is committed as `e3fc4397`.
The native Satyr integration is committed on its `dev` branch as `cf1b8bfe7`.
Production schema application and cohort cutover remain Phase 5 work.

## Account boundary

Account ingress lives in `console-server-ts/src/accountPlatform/`.
The shared D1 bundle exposes `serviceAccess` and `serviceMemberships`.
The Console Worker exposes a private `SatyrAccountPlatform` entrypoint through a Cloudflare service binding.
Its public fetch handler rejects `/account-platform/*` with 404 before database access.
The local Worker uses the same services and contracts.
Shared parsers live in `console-shared-ts/src/accountPlatform/`.
Type fixtures reject unsigned assertions, object spreads, and invalid principal combinations.

The private entrypoint fixes the service to Satyr and takes its deployment identity from server configuration.
User operations also require `X-Account-User-Assertion`, a compact Ed25519 JWS.
Its header is exactly `{alg:"EdDSA",typ:"JWT",kid}`.
The configured key, issuer, and audience must match.
Expiry must be in the future and at most 60 seconds away.
Only actual signature verification can construct `VerifiedAccountUserAssertionV1`.
Core access and membership methods require that verified type.

The signed payload has these exact fields:

```text
{version:1, issuer, audience, principal, nativePrincipalId,
 scope:{namespace, organizationId, projectId, billingAccountId},
 instanceId, action, expiresAt, authorityRevision}
```

`action` is `execute`, `disclose`, `restore`, or `replay`.
Each user principal contains a verified identity and one authority origin.
Each automation principal contains only `automationId` and `grantId`.

| Principal or origin   | Required fields                                                                                                                                   | Boundary condition                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| User identity         | `kind:verified_provider_subject`, `userId`, `issuer`, `subject`, `verificationReceiptId`                                                          | Current Satyr linking verifies Google issuer and subject independently.                           |
| Authenticated session | `kind:authenticated_session`, `nativeSessionId`                                                                                                   | Satyr verifies the current native session. Linking and membership mutations require this origin.  |
| Accepted execution    | `kind:accepted_execution`, `acceptedExecutionId`                                                                                                  | Satyr verifies the exact accepted execution before signing.                                       |
| Disclosure recipient  | `kind:disclosure_recipient`, `disclosureEvidenceId`                                                                                               | Only the `disclose` action is valid. Satyr verifies the exact recipient evidence.                 |
| Provider event        | `kind:authenticated_provider_event`, `provider:slack`, `nativeEventId`, `nativeIntegrationAccountId`, `nativeWorkspaceId`, `nativeExternalUserId` | Only `execute` is valid. Satyr verifies the signed provider event and native integration mapping. |
| Automation            | `kind:automation`, `automationId`, `grantId`                                                                                                      | The exact producer, native principal, instance, and persisted grant must match.                   |

The wire also defines authenticated account links.
This Satyr integration accepts its persisted verified Google subject mapping.
It does not infer a link from an email, service access, or an invented native session.
The account API verifies the provider token against the configured Satyr Google audience.
The token is transient and never enters link tables.
Provider verification receipts remain canonical across later logins.

Identity resolution returns the stored principal and current organisation authority revision.
The caller signs that returned principal and revision for its protected operation.
An initial link or resolution may use revision zero.
Resolution supplies identity context; protected admission requires a separate fresh eligibility check.

Eligibility reads the immutable instance, native binding, current organisation and project,
active membership, project assignment, and explicit instance grant on every protected request.
Desired enablement, an applied active receipt, and matching observed revision are required.
The signed scope, principal, native principal, action, and current authority revision must match.
No positive access cache replaces these reads.
Outages return `authority_unavailable` and release no protected content.
Producer settlement remains available after member removal or service disable.

## Account HTTP contract

Every account ingress operation uses `POST` and JSON through the required `ACCOUNT_PLATFORM` service binding.
Responses use `{kind:"accepted",value}` or `{kind:"rejected",error:{code,...}}` directly.
Responses set `Cache-Control: no-store`.
The paths below are relative to `/account-platform/v1`.
Every request body includes `version:1`.

| Path                                                  | Other body fields                                                                                                 | Accepted value                                                         | Authority                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/identity/link`                                      | `instanceId`, `googleIdToken`                                                                                     | `ServiceIdentityResolutionV1`                                          | Signed authenticated session; revision zero; independently verified Google token.                                |
| `/identity/resolve`                                   | `instanceId`                                                                                                      | `ServiceIdentityResolutionV1`                                          | Signed mapped user or explicit automation.                                                                       |
| `/eligibility`                                        | `instanceId`, `principal`, `action`                                                                               | `{authorityRevision,accessRevision,scope,instanceId,principal,action}` | Fresh signed principal and exact current revision.                                                               |
| `/memberships/list`                                   | `instanceId`                                                                                                      | `{memberships,invitations}`                                            | Eligible authenticated session with `disclose`; shared team read permission.                                     |
| `/memberships/invite`                                 | `instanceId`, `invitation`                                                                                        | `{invitation,token}`                                                   | Eligible authenticated session with `execute`; shared invitation permission.                                     |
| `/memberships/revoke`                                 | `instanceId`, `membershipId`                                                                                      | Membership with account permissions and project assignments            | Eligible authenticated session with `execute`; shared member-management permission.                              |
| `/invitations/accept`                                 | `instanceId`, `invitationId`, `token`                                                                             | Active shared membership                                               | Mapped authenticated session with `execute`; verified email, token, and exact service invitation grant.          |
| `/invitations/revoke`                                 | `instanceId`, `invitationId`                                                                                      | Shared invitation                                                      | Eligible authenticated session with `execute`; exact instance invitation grant and shared invitation permission. |
| `/instance-access/set`                                | `instanceId`, `membershipId`, `access:allowed\|revoked`                                                           | `{instanceId,membershipId,access,authorityRevision}`                   | Eligible authenticated session; owner or admin with `members.manage`.                                            |
| `/automation-grants/set`                              | `instanceId`, `automationId`, `grantId`, `nativePrincipalId`, `access:allowed\|revoked`, `expectedAccessRevision` | Mapping, scope, `authorityRevision`, and `accessRevision`              | Eligible authenticated session; owner or admin with `projects.manage`.                                           |
| `/fee-policy`                                         | `instanceId`                                                                                                      | `SatyrServiceFeePolicyV1`                                              | Producer bound to the Satyr instance.                                                                            |
| `/funds/reserve`                                      | `operationId`, `instanceId`, `executionId`, `requestedMinor`, `priceVersion`                                      | `{reservation,disposition}`                                            | Producer; current financial and price admission.                                                                 |
| `/funds/status`                                       | `reservationId`                                                                                                   | Reservation                                                            | Producer bound to its persisted instance.                                                                        |
| `/funds/indeterminate`                                | `operationId`, `reservationId`, `executionId`                                                                     | Reservation                                                            | Producer; preserves the unresolved hold.                                                                         |
| `/funds/settle`, `/funds/release`, `/funds/reconcile` | `kind`, `request`, `occurredAt`                                                                                   | Reservation                                                            | Satyr producer; sealed terminal evidence.                                                                        |
| `/usage`                                              | `eventId`, `instanceId`, `occurredAt`, `meterId`, `quantity`, `unit`, `evidence`                                  | Charged or recorded-without-charge receipt                             | Producer; registered price and durable source evidence.                                                          |

The reservation value contains its original `createdAt`.
Terminal delivery uses `FundsTerminalDeliveryV1`:

```text
{version:1, kind:"settle"|"release"|"reconcile", request, occurredAt}
```

The path and `kind` must match.
Settlement requests contain `operationId`, `reservationId`, `executionId`, `settledMinor`, `priceVersion`, and `evidence`.
Release requests replace the amount and price with `noChargeEvidence`.
Reconciliation requests contain a charged or no-charge `outcome`.
Each evidence object contains `sourceRecordId` and a SHA-256 `sourceDigest`.
The account service derives charge IDs, ledger replay keys, and resource attribution from the accepted reservation.
HTTP callers cannot supply SQL, a billing account, or a replacement charge ID.

Malformed bodies return 400. Scope, membership, and instance denials return 403.
Insufficient funds return 402. Financial or command conflicts return 409.
Shared team 401, 403, and 404 errors become `scope_forbidden` with 403.
Other shared team conflicts become `operation_conflict` with 409.
Unexpected authority failures return retryable `authority_unavailable` with 503.
Clients retain pending durable work after an unavailable response or an uncertain transport result.

## Account persistence and transactions

Core `0007_service_access.sql` and Wallet `0097_service_access.sql` add five tables:

| Table                                | Retained authority                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `platform_provider_identities`       | Immutable platform user/provider issuer/subject and first verification receipt; verified display metadata may refresh. |
| `platform_service_principals`        | Immutable instance/native-principal/platform-user/provider mapping.                                                    |
| `platform_instance_access`           | Explicit membership access, access revision, and revocation authority watermark.                                       |
| `platform_service_invitation_grants` | Exact account invitation/instance grant and its authorised issue revision.                                             |
| `platform_automation_grants`         | Immutable instance/automation/grant/native-principal mapping with mutable allowed or revoked access.                   |

Foreign keys and triggers enforce scope and identity immutability.
Mappings retain no native session ID or provider token.
An instance's initial authorised provision actor receives an explicit grant.
Membership removal revokes all grants for that membership, including missing grant rows.
It records a revocation watermark for every current instance in the organisation.

`authorityRevision` is the organisation's current authorisation version.
`accessRevision` identifies one instance grant generation.
A revoked-to-allowed user grant advances beyond every prior grant for that instance and platform user.
This also applies when invitation acceptance creates a replacement membership ID.
Automation regrant advances its exact grant's access revision.
Native Satyr acknowledges these revisions before protected work.
A changed revision triggers native project/history cleanup before admission.
Rejoining an account therefore cannot revive access retained from an earlier grant.

The existing team service owns invitation tokens, verified-email matching, account role assignment,
member removal, last-owner constraints, and its transaction guards.
The facade adds service invitation and instance grant checks.
Invitation acceptance and instance grant insertion are separate guarded D1 operations.
A crash between them grants no service access; matching acceptance can finish the grant on retry.
An accepted invitation linked to a removed or suspended membership is denied before generic acceptance.
An old invitation cannot cross a later revocation watermark or restore its revoked service grant.
Explicit rejoin requires a new authorised invitation or current explicit service regrant.

Explicit grant-set mutations check current authority revision and active scope inside their SQL mutation.
Triggers advance the organisation revision when grants change.
The returned revision comes from persisted state after the mutation.
Identity persistence and native provisioning each retain their own durable receipt.
Cross-service HTTP calls do not form a distributed database transaction.
Matching retry completes interrupted work through its original identity and receipt.

When usage supplies terminal evidence, terminal mutation, hold removal, ledger posting,
and the usage receipt share one D1 batch.
If a terminal already exists, usage verifies its immutable evidence and records the event and receipt in one batch.
Both delivery orders converge on the same instance/meter/execution charge.
Matching replay returns the original receipt; changed evidence, amount, price, or outcome conflicts.

## Satyr transport and native data

Satyr changes live in `/Users/pta/Dev/lowerarchy/satyr` on `dev`.
The versioned HTTP client uses existing Worker fetch patterns.
It imports no Seams private source and accesses no Seams tables.
Transport and native binding files live under `services/platform/src/account-platform/`.
Inbound provision/status operations mount through the existing gateway routing.
`env.ts`, `wrangler.jsonc`, and `scripts/worker-environment.mjs` own explicit deployment configuration.
Global D1 stores the immutable instance binding, principal links, and provisioning receipts.
Global, regional, and combined baselines have matching deployment patches under `services/platform/scripts/`.
Production cohort application remains a Phase 5 operation.

`bootstrapOrganisation` remains the native tenant creation boundary.
It requires an explicitly mapped verified owner.
Attachment retains the native organisation, person links, work projects, workspaces,
integrations, regional placement, and lifecycle deadlines.
Provisioning enablement remains separate from native operational readiness.

The outbound envelope is `{version:1,delivery,owner,ownerAssertion}`.
`delivery` retains `scope`, the original sealed `command`, producer `authority`, `payloadDigest`, and `requestedByUserId`.
`requestedByUserId` comes from the persisted account command actor.
`owner` includes the verified platform user, Google issuer and subject, verified email,
display name, verification receipt, platform membership, account acceptance receipt, and service grant.
The service grant is explicit instance access with its revision, or account-management authority.
Native bootstrap requires explicit instance access.
Account-management authority can deliver lifecycle work without creating a native content grant.

The account signs a fresh `ServiceProvisionOwnerAssertionV1` for each delivery attempt.
It binds purpose `satyr_provision_owner`, issuer, audience, operation, instance, requested user,
Google issuer and subject, canonical body digest, and expiry.
The digest covers `{version:1,delivery,owner}` before adding the signature.
The signature expires after 30 seconds; the durable command stores no expiring assertion.
Satyr independently verifies this proof and its configured provision bearer.

Satyr replies with `{kind:"accepted",value:{kind:"applied",receipt,owner}}`.
The returned owner has `nativePrincipalId`, `platformUserId`, `issuer`, `subject`, and `verificationReceiptId`.
The account verifies the exact receipt, command, immutable scope, deployment, and stored provider identity.
It records the immutable native owner mapping before acknowledging the platform receipt.
A lost response retries the original command with a fresh signature.
Native receipts preserve the same tenant and owner mapping.

## Satyr access and membership

The main authority hooks are `request-authority/index.ts` and `control/authorization.ts`.
Their callers include `authorization/access-grants/turn-authority.ts`,
`chat/turn-access.ts`, `chat/information-flow.ts`, `chat/conversation-disclosure.ts`,
`chat/portal-stream.ts`, and `slack/ingress-admission.ts`.
Final Slack output retains `actors/case-walking-path.ts` and `actors/case-conversation-sink.ts` checks.
Restore and replay retain `actors/agent-session.ts` and their existing disclosure owners.
Settled-history cursors cannot replace current platform eligibility.

Membership changes affect `data/control-plane.ts`, `control/routes/onboarding.ts`,
and `control/routes/sessions.ts`.
The account platform owns organisation invitations and revocation.
Satyr retains operational roles, `personId`, service grants, last-owner constraints,
work-project invitations, source policy, and retained-history checks.
The shared facade owns account invitation acceptance and member revocation.
Native `service_role_grant` retains operational roles and their accepted account receipt.
An account membership alone creates no native service role or content grant.
Provider callbacks cannot accept an invitation solely from an email match.

Account and Satyr role checks both apply:

| Account state                                                                | Account eligibility                                                                   | Native authority                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Active `OWNER` or `ADMIN` with allowed instance access                       | Passes the account project-assignment check.                                          | Current Satyr role, work-project grant, source policy, and disclosure rules still apply. |
| Active `MEMBER` with project `editor` and allowed instance access            | Permits execute, restore, disclose, and replay checks.                                | Current Satyr role and per-resource grants still apply.                                  |
| Active `MEMBER` with project `viewer` and allowed instance access            | Permits disclose and replay checks.                                                   | Current Satyr role and retained-history rules still apply.                               |
| Missing, suspended, or removed membership; missing project or instance grant | Denied.                                                                               | Native roles cannot override the denial.                                                 |
| Explicit active automation grant                                             | Requires the exact instance, native principal, automation ID, grant ID, and revision. | Native workflow, mailbox, WhatsApp, and resource-specific automation checks still apply. |

Satyr invitations retain the requested native role separately.
Native `admin` and `operator` invitations request account `MEMBER` with project `editor`.
Native `viewer` invitations request account `MEMBER` with project `viewer`.
The native role is applied only after shared token acceptance and fresh eligibility succeed.
Native operational administration does not automatically add account administration permissions.
Account invitation and removal operations use the existing owner/admin permission rules.
An account owner can manage requested invitation roles.
An account admin needs `members.manage` and can manage `MEMBER` invitations or targets.
Membership lists require an owner, or an admin with `members.manage` or `projects.manage`.
Instance grant changes require `members.manage`; automation grant changes require `projects.manage`.
Native and account final-owner constraints remain enforced by their respective owners.

The IFC integration guide already has concurrent edits.
Preserve those edits and add only the new account boundary documentation.
Preserve all unrelated Portal, Brain, and staged migration work in the Satyr checkout.
No agent may commit another task's staged changes.

## Satyr execution and billing

The financial hooks are `actors/agent-session.ts`, `actors/actor-journal.ts`,
and the existing `actor_outbox`.
Reserve before provider dispatch and retain the deterministic admission intent before its remote call.
Persist the accepted hold before execution.
Keep token, time, and tool budgets in their current Satyr owner.

`commitCompletedSessionTurnTransaction` commits the accepted checkpoint and terminal stream.
It must insert the terminal usage intent in that same SQLite transaction.
The completion ID remains `finalize_${turnId}_${lastSequence}`.
The accepted time remains `checkpoint.blob.createdAt`.
Usage identity derives from instance, session, and turn and survives restore.
The pinned model route supplies funding attribution; no current-selection lookup or funding fallback applies.

The existing outbox retains pending, dispatching, settled, reconciled, and indeterminate states.
Use it for money delivery and retain its export/relocation fences.
Actor recovery must retry pending money before any user-dependent protected-work admission.
Revocation or service disable cannot erase a final financial obligation.
Uncertain execution retains its hold until service evidence proves its outcome.

Satyr customer service fees remain unpriced until a product decision exists.
Its existing provider funding rules continue to apply.
The one-cent completed-turn fee is available only to explicitly isolated E2E accounts.
Represent these policies as distinct states; a failed price lookup cannot select free execution.

The fee-policy response contains `{version:1,instanceId,scope,policy}`.
`policy` is exactly one of these states:

```text
{kind:"customer_unpriced"}
{kind:"isolated_e2e_completed_turn", meterId:"satyr.completed_turn.test",
 priceVersion:"satyr-completed-turn-test-v1", currency:"USD", unitMinor:1}
```

The test policy requires both persisted isolated-account classification and its registered immutable price.
Customer accounts cannot use that price through reserve, explicit settlement, or usage delivery.
Completed turns use quantity one. Failed or cancelled turns use quantity zero and retain a durable receipt.
Satyr usage evidence includes session, turn, reservation, terminal outcome, source record, source digest,
and the accepted model route's funding selection and digest.
Customer funding selections remain OpenAI key, Anthropic key, Claude OAuth, or Codex subscription.
Platform funding remains `satyr_platform`.

## Configuration and restart procedure

Inbound account configuration is explicit:

| Account Worker                                 | Satyr Worker counterpart                                    |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `SATYR_DEPLOYMENT_ID`                          | `ACCOUNT_PLATFORM_DEPLOYMENT_ID`                            |
| `SATYR_ACCOUNT_ASSERTION_ISSUER`               | `ACCOUNT_PLATFORM_ASSERTION_ISSUER`                         |
| `SATYR_ACCOUNT_ASSERTION_AUDIENCE`             | `ACCOUNT_PLATFORM_ASSERTION_AUDIENCE`                       |
| `SATYR_ACCOUNT_USER_ASSERTION_KEY_ID`          | `ACCOUNT_PLATFORM_USER_ASSERTION_KEY_ID`                    |
| `SATYR_ACCOUNT_USER_ASSERTION_PUBLIC_JWK_JSON` | Public half of `ACCOUNT_PLATFORM_USER_ASSERTION_PKCS8_B64U` |
| `SATYR_GOOGLE_OIDC_CLIENT_ID`                  | Satyr's actual Google OIDC client audience                  |

Satyr requires the `ACCOUNT_PLATFORM` binding to the `SatyrAccountPlatform` named entrypoint.
Production targets `seams-sdk-d1-console`; local development targets `seams-sdk-d1-local`.
The request URL is an internal routing label. There is no public HTTP fallback or shared service token.
Both Workers must run in the same Cloudflare account.
Deploy the Console entrypoint before the Satyr binding, then remove the retired service secrets from both Workers.
The reverse provisioning transport retains its existing separate configuration.
The account ingress treats a partially configured deployment as an error.
Absent ingress configuration exposes no authenticated integration.
User assertion keys have a dedicated purpose; native session and Actor token secrets remain separate.

Outbound account provisioning uses `SATYR_SERVICE_ORIGIN`, `SATYR_PROVISION_TOKEN`,
`SATYR_PROVISION_PLACEMENT_CELL_ID`, `SATYR_PROVISION_ENVIRONMENT`, and `SATYR_DEPLOYMENT_ID`.
Its signing configuration is `ACCOUNT_PROVISION_ASSERTION_ISSUER`, `ACCOUNT_PROVISION_ASSERTION_AUDIENCE`,
`ACCOUNT_PROVISION_ASSERTION_KEY_ID`, and `ACCOUNT_PROVISION_ASSERTION_PRIVATE_JWK_JSON`.
Satyr configures the corresponding `ACCOUNT_PLATFORM_PROVISION_TOKEN` and
`ACCOUNT_PLATFORM_PROVISION_ASSERTION_{ISSUER,AUDIENCE,KEY_ID,JWK}` verification fields.

Recovery uses persisted commands and financial evidence:

1. Apply the reviewed forward schema before enabling the new writer for its cohort.
   Preserve instance bindings, principal mappings, membership history, grant revisions, receipts, holds, and native Actor storage.
2. Reconstruct the account bundle and authenticated transports from the same deployment configuration.
   Service-change requests dispatch only their own durable operation with `waitUntil`.
   Production and local schedulers resume pending operations. Failed deliveries receive a later retry time, so older failures cannot monopolise a batch.
3. Retry pending provisioning under its original operation ID, desired revision, payload digest, and scope.
   Each retry obtains current verified owner authority and signs a fresh envelope.
   An unavailable delivery stays pending. An acknowledged stale receipt stays auditable without advancing current state.
4. Recover Satyr's existing Actor outbox before new protected work.
   Replay the original accepted financial intent with producer credentials.
   A lost reply may follow a committed charge, so read or replay its original receipt.
5. Preserve reserved and indeterminate holds while execution outcome is unknown.
   Settle or release only from final service evidence. Elapsed time cannot prove a no-charge outcome.
6. Resolve the current canonical principal and authority revision again for user or automation admission.
   Acknowledge a changed access revision and complete native cleanup before releasing protected content.

The repeatable account Worker artifact builds with:

```sh
node tests/helpers/buildSharedAccountPlatformWorker.mjs
```

It bundles the real account ingress, D1 services, and forward migrations for the native composed journey.
Its fixture-only control routes remain outside the production Worker.
Schema or production ingress changes require rebuilding this artifact before rerunning native acceptance.

## Acceptance

The native composed journeys pass through the real account Worker, Satyr Worker, and Satyr Actor.
They cover platform-funded and customer-funded turns, customer-unpriced execution, lost replies,
restart, uncertain provider work, native cancellation, and settlement after member removal.
They also cover authority outages, foreign scope rejection, private projects, restricted sources,
service disable, invitation acceptance, role-change replay, revocation, and rejoin cleanup.
A separate automation journey verifies grant creation, revocation, stale command rejection,
explicit regrant, and refusal to reuse the old native access revision.

The organisation has separate Wallet and Satyr platform projects under one payer.
The resulting usage statement totals 303 USD cents: three Satyr test turns and one Wallet monthly resource.
Available credit is 1697 USD cents from the original 2000-cent credit.
Three reservations settled and one cancelled reservation released. No active hold remains.
All five ledger entries balance. Both PDF pages were rendered and inspected.
Satyr test prices remain limited to isolated E2E accounts.

The built account Worker SHA-256 is recorded when the native test runtime starts.
The report exporter rejects a current Worker that differs from the tested artifact.
It also rejects a failed run, an incomplete journey, signed tokens, and private source content.

```sh
# In seams-monorepo:
pnpm -C tests exec node helpers/buildSharedAccountPlatformWorker.mjs
pnpm -C tests exec playwright test -c playwright.config.ts 'e2e/console/shared-account-.*\.e2e\.test\.ts' e2e/console/shared-wallet-settlement.e2e.test.ts --reporter=line
pnpm check

# In Satyr, set this path to the artifact built above:
SATYR_ACCOUNT_WORKER_ARTIFACT=/Users/pta/Dev/rust/seams-monorepo/.artifacts/shared-account-platform/account-worker/index.mjs pnpm --filter satyr-edge exec vitest run --config vitest.e2e.config.ts tests/e2e/shared-account-platform.test.ts tests/e2e/shared-account-automation.test.ts --reporter=default --reporter=json --outputFile=../../output/shared-account-platform.json
node services/platform/tests/e2e/shared-account-platform-report.mjs output/shared-account-platform.json /Users/pta/Dev/rust/seams-monorepo/.artifacts/shared-account-platform/satyr /Users/pta/Dev/rust/seams-monorepo/.artifacts/shared-account-platform/account-worker/index.mjs
pnpm --filter satyr-edge check:test-types
SATYR_ACCOUNT_WORKER_ARTIFACT=/Users/pta/Dev/rust/seams-monorepo/.artifacts/shared-account-platform/account-worker/index.mjs pnpm --filter satyr-edge test
pnpm --filter satyr-edge test:onboarding-closure
pnpm lint:ifc-boundaries
pnpm --filter satyr-portal build
```

The native command passes two journeys. The account command passes ten journeys.
Main repository checks pass, including 53 script checks and one existing skipped check.
Satyr source/test types, onboarding closure, IFC checks, and the Portal build pass.
The required full Satyr suite passes 2372 tests across 372 files.
Three tests and two files retain their existing skips.
Retained protected-access fixtures use the same built account Worker through its HTTP contract.
The test command requires the explicit artifact path above.
It imports no private account source into the Satyr runtime.
No production schema or cohort cutover has started.

Evidence in `.artifacts/shared-account-platform/` includes:

- `satyr/{summary,native,financial,access,statement,vitest}.json`, `satyr/statement.pdf`, and rendered statement pages.
- `satyr-schema-patches.json`: fresh and previous-baseline schema probes, native role/person preservation,
  invitation reissue evidence, final-owner guards, and clean foreign keys.
- `phase-4-account-e2e.log`, `phase-4-check.log`, and the core/Wallet/UI build logs.
- Satyr's `output/shared-account-platform.json` also retains the independent automation journey.

The Portal browser journey checks an explicit acceptance action, an authority outage,
and a successful retry through its production UI and transport boundary.
Its fixture transport does not replace the separate native authority journeys.
The screenshot, trace, and report use `output/playwright/shared-account-portal-invitation*`.

Portal organisation creation links to the shared Console.
Invitation links keep their token in the URL fragment and the browser's session storage.
Google sign-in carries only the native organisation and invitation IDs in its return path.
Successful acceptance clears the transient token and the invitation URL.
Native D1 retains the shared acceptance receipt and the native role projection.

Automation commands require `expectedAccessRevision`.
Revision zero creates a grant or replays its first still-allowed result.
A state change requires the exact current revision in the same D1 statement.
An old revision-zero retry cannot undo a later revocation.
Satyr pins the returned access revision to the native workflow or binding revision.
A shared regrant cannot revive that old native revision.
A new native revision requires a new explicit grant through the authenticated control boundary.

## October 14 architecture corrections

Service-change responses contain the persisted pending state. They do not wait for provisioning
or drain the queue. Replaying a completed operation returns its current observed state.
The scheduler selects current pending operations by indexed retry time.
Core migration `0008_account_delivery.sql` and Wallet migration `0098_account_delivery.sql`
add that index and retry time. Apply the migration before deploying the updated worker.

Eligibility uses one joined D1 read for either a user or an automation principal.
That snapshot checks identity, service deployment, active lifecycle state, access, permissions,
and current authority revision. Principal comparison uses parsed fields without canonical hashes.

Service invitations and resends commit their invitation, email outbox entry, and service grant
in one D1 batch. A stale authority revision or unavailable instance aborts the whole batch.
The grant statement follows the invitation email statement so the email's existing insert guard
continues to refer to the invitation mutation.

Satyr discovery and command creation use configuration metadata only.
Signing credentials load when a Satyr operation is dispatched.
Unrelated Console routes do not construct the Satyr adapter.
Schedulers run Wallet provisioning, monthly delivery, and Satyr provisioning independently.
A Satyr configuration error is reported without preventing Wallet work.

Repeatable evidence is produced by `shared-account-authority.e2e.test.ts`,
`shared-account-wallet-activation.e2e.test.ts`, `shared-account-wallet-monthly-usage.e2e.test.ts`,
`shared-wallet-settlement.e2e.test.ts`, and `console-service-auth.e2e.test.ts`.
These local tests establish transaction behaviour and request counts. They do not establish
Japan-to-production network latency. These corrections require deployment and a controlled
latency comparison before any new production performance claim.
