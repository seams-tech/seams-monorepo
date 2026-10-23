# Separate Platform and Wallet consoles

Status: implemented and deployed to staging and production, recorded October 17, 2026.

## Why

Shared developer-account pages and Wallet operations needed separate navigation,
release outputs, and domains without duplicating identity, billing, or shared UI.

## What changed

- Built Platform and Wallet entry points from the existing `apps/wallet-console` workspace.
- Reused shared session, HTTP, account, billing, and shell code.
- Served developer accounts, projects, memberships, and billing at `console.seams.sh`.
- Served Wallet environments, credentials, sponsorship, and operations at `console.wallet.seams.sh`.
- Preserved Wallet API/passkey origins and existing Gateway/runtime versions.
- Kept Satyr's native portal separate while connecting its approved Platform account and project.

## Recorded acceptance and limits

### Wallet sign-in and onboarding (October 23, 2026)

Each Console origin owns a host-only session cookie. Wallet sign-in and initial
organization/project setup stay on the Wallet Console origin. The shared onboarding
page serves both consoles. A signed-in identity without an organization resumes
onboarding and clears any previous account's selected organization and project.
Organization creation upgrades that identity to a workspace session. Existing
Platform sessions remain separate.

The browser contract is `tests/e2e/console/identity-onboarding.e2e.test.ts`. Run it
against the local Wallet Console with a fresh identity-only session cookie supplied
as `SEAMS_HANDOFF_IDENTITY_COOKIE`. The fixture user ID must start with
`github:handoff-`. Set `SEAMS_HANDOFF_APP_ORIGIN` when the local Console uses a port
other than 4001. Run:

```sh
pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/identity-onboarding.e2e.test.ts
```

The test uses real Console APIs, creates a local test organization and project,
and saves `evidence.json` and `workspace.png` in its test-results directory.

### Deleting the current or last workspace

An owner can delete the currently selected organization, including their last one.
Successful deletion clears the current session cookie and returns the browser to
sign-in. The browser clears the deleted organization and project selection.

Deletion removes projects and unused local Wallet provisioning records in one D1
transaction. It retains organizations with other members, wallets, money, billing
history, native principals, usage, or non-initial service access grants. Remote,
non-Wallet, and unfinished service instances also block deletion. A service-state
change during the checks returns HTTP 409 before any cleanup occurs.

The identity-onboarding browser contract now creates and deletes its last workspace.
The shared-account-onboarding D1 contract checks retained history and a concurrent
provisioning change. Both produce evidence artifacts.

### Original split acceptance

Google and GitHub sign-in passed on both Console domains after provider origins
and callbacks were configured. Invitation acceptance, product setup, and an existing
Satyr workspace passed the recorded checks.

`satyr.seams.sh` remained a future custom-domain change in this record. The split
did not introduce a new account hierarchy, Worker, database, or universal UI framework.

## Full record

[Original plan, decisions, and deployment evidence](https://github.com/seams-tech/seams-monorepo/blob/5a449fbcb90fe015b63102819626adf070ff0c29/docs/feat-2-platform-console.md).
