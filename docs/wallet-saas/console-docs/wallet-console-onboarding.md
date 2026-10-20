# Console onboarding

Updated October 13, 2026.

## Product contract

Console onboarding creates an organization, its first project, and the default
Development environment. It completes when these records exist. Billing controls
access to live environments separately.

Wallet deployment activation is a separate operator action. Onboarding must not
create signing material, activate a deployment, or require an active deployment.
An empty deployment database must not cause project creation to fail.

## Requests and retries

- `POST /console/onboarding/organization` configures the organization and ensures
  its first owner membership.
- `POST /console/onboarding/project` requires an organization. It creates or
  resolves the requested project and its default `dev` environment. A new project
  returns HTTP 201. A replay that reuses both records returns HTTP 200.
- The browser generates one project ID for its onboarding draft and includes it
  in every project submission. The browser retains that ID across failed requests
  and reloads. The server resolves existing IDs within the caller's organization.
- A response lost after persistence must not create another project on retry.
- `GET /console/onboarding/state` derives progress from saved organization,
  project, and environment records. Reload resumes this saved progress.
- Unsupported methods on `/console/onboarding/project` return HTTP 405 with
  `Allow: POST`. A genuinely missing authorization policy remains a server error.

Successful onboarding selects the project and environment and opens the dashboard
overview. Console navigation is available before Wallet deployment activation.
The organization and project audit events describe the persisted changes.

## Deployment status

The existing Deployment status page reads the Gateway's deployment projection.
It validates successful responses with the shared projection decoder.

- HTTP 503 with `tenant_deployment_unavailable` shows **Deployment unavailable**
  and the selected environment ID. This response can mean missing or prepared
  admission, or invalid stored deployment data. It cannot establish whether the
  selected environment needs its first activation. An operator must check activation,
  deployment data, and Gateway configuration.
- A valid projection for a different environment shows **Gateway environment mismatch**
  and both environment IDs. An operator must check the assignment. This response
  does not establish the selected environment's deployment status on other Gateways.
- Other HTTP failures, connection failures, and invalid projections remain errors.
- A valid projection for the selected environment shows the active deployment and
  available audit evidence.

An owner can refresh deployment status after an operator completes activation.

SDK 0.15.4 registration still requires the selected environment's publishable
key and allowed application and wallet origins. Completing Console onboarding
does not establish Wallet deployment readiness. See [API credentials](api-keys.md)
and the [current public deployment guide](https://wallet.seams.sh/docs/deploy-and-operate/hosted-integration).
Only the existing protected workflow can authorize hosted activation. A Console
session does not grant that authority. Gateway and Wallet runtime admission checks
continue to enforce deployment readiness.

## Verification

The production Console Worker scenario in
`tests/relayer/console-onboarding.scenario.ts` runs inside the Console service-auth
E2E test with real D1 migrations. It creates an organization and project before any
activation, replays the project request, reads saved progress, verifies one project,
and checks that a Console session cannot authorize activation. The enclosing test
also exercises activation and durable credential changes and writes JSON evidence.

`tests/e2e/console/onboarding-recovery.operating.test.ts` exercises the browser with
real Console APIs. It interrupts a request before persistence, reloads the draft,
loses a reply after persistence, and retries with the same project ID. It checks
saved progress, unavailable discovery before and after an active projection,
deployment status transitions, and HTTP failures. It attaches JSON and screenshots.
Only external Gateway discovery responses are controlled in this browser scenario.
