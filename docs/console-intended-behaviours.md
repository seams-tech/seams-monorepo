# Console Intended Behaviours

Status: source-of-truth behavioural contract.

## Account onboarding

Any verified Google or GitHub account can create an organization without a sales
approval or pre-existing membership. Google accounts require a verified email;
GitHub identity verification resolves a verified email from the provider.
A new account receives an identity session with no organization permissions.
Sign-in sends this account to `/dashboard/onboarding` to create its organization.
The login page contains provider sign-in only. Reloading or opening another dashboard
route with an identity session returns to onboarding. Once organization creation
succeeds, the scoped session continues into the existing project setup flow.
Completing project setup selects the new project and environment and opens
`/dashboard/overview` directly, without an onboarding completion screen.
Organization creation uses the shared Account service and grants its creator
owner membership. Returning accounts resolve their current memberships from storage.
Pricing tiers and billing entitlements are independent of this signup permission.

A selected project/environment must belong to the authenticated organization and
be authorized for that member. Selection issues a scoped session before loading
wallet or derivation-root views. Identity-only sessions cannot select environments.

Local development uses the same provider verification, creation, membership, and
session paths. Startup applies migrations and creates infrastructure only. It does
not create customer organizations, projects, environments, memberships, or API keys.
Isolated test fixtures create their resources through these APIs in separate storage.

Behavioral coverage: `tests/unit/hostedConsoleAuth.unit.test.ts`,
`tests/relayer/console-account-router.test.ts`, and
`tests/relayer/console-d1-adapters.test.ts` (Account adapter contracts).

## Webhook test events

Members with webhook edit permission can send a `webhook.test` event to one active
endpoint in their organization using **Send test event**. The test bypasses event
category subscriptions and carries a synthetic payload with `test: true`; it does
not require a wallet or policy operation. Disabled endpoints reject the request.

Test events use the normal signing, delivery, attempt recording, and replay paths.
The dashboard shows the delivery response and reports success only when the
receiver accepts the event.

Behavioral coverage: `tests/relayer/console-d1-adapters.test.ts` (test delivery,
endpoint isolation, disabled endpoints, and replay) and
`tests/relayer/console-router.test.ts` (test route permissions).
