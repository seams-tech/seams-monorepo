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

Google and GitHub sign-in passed on both Console domains after provider origins
and callbacks were configured. Invitation acceptance, product setup, and an existing
Satyr workspace passed the recorded checks.

`satyr.seams.sh` remained a future custom-domain change in this record. The split
did not introduce a new account hierarchy, Worker, database, or universal UI framework.

## Full record

[Original plan, decisions, and deployment evidence](https://github.com/seams-tech/seams-monorepo/blob/5a449fbcb90fe015b63102819626adf070ff0c29/docs/feat-2-platform-console.md).
