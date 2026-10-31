# v0.37.0 release preparation

Status: publication and deployment authorized on November 1, 2026 (JST).
Package publication and full Wallet validation passed. Deployment is pending.

The `0.37.0` candidate includes the published `0.36.0` recovery work, hosted billing admission, and
Wallet-owned VoiceID enrollment records. A version change does not establish
production readiness or API stability.

## Source scope

- Wallet billing admission: `cb81c010c`, with earlier error handling in `bd393832c`.
- VoiceID record ownership: `925c4ada7`.
- Console billing, invoices, and billing rules: `0e5d0001` and `60eed5e9`.
- Wallet, Wallet Server, and VoiceID candidate versions: `0.37.0`.
- Pinned public release revision: `b2f0053c7d3503363970bac561d4c723062bb524`.
- [Wallet validation](https://github.com/seams-tech/seams-wallet/actions/runs/41213492500).
- [Package release](https://github.com/seams-tech/seams-wallet/actions/runs/41213492804).
- Wallet iframe protocol: `22.0.0`, unchanged from `0.36.0`.
- Wallet-management protocol: `5`. Signed recovery CLI: `0.29.0`.

All three `0.37.0` package versions were verified in npm after its processing delay.
Console consumers use exact `0.37.0` versions and the regenerated lockfile.

## Billing contract

Production registration, login, or session refresh counts a user once per UTC
calendar month. A newly billable login must fit the available credit. Repeated
logins add no MAU charge. Recovery and key export remain available.
Signing reserves credit before execution. Unknown outcomes retain their commitment.
Monthly invoices combine plan fees and usage. The Console billing pages explain
these rules and the payment recovery process.

## Validation evidence

Billing acceptance evidence is in `.artifacts/platform-billing/` in this repository.
It includes credit races, replay, restart, monthly collection, payment recovery,
late usage, Free downgrade, and real Stripe test-mode acceptance.
Wallet signing admission evidence is in `.artifacts/signing-credit/` in seams-wallet.
Earlier validation logs are in `.artifacts/release-100/` there. The final version's
package and documentation checks are in `.artifacts/release-0370-final/`.
Sequential package builds, full TypeScript checks, signing-credit acceptance,
documentation builds, packed-package checks, and the bloat check passed locally.
Worker and WASM artifacts were reused by the package build. The clean production
build and full lifecycle CI remain release gates.

The initial preparation ran builds and type checks concurrently. VoiceID type
checks failed during that run, then passed after the build finished. Candidate
validation must build first and run type checks afterward.

## Remaining release gates

- Apply Wallet migration `0088` and Console migrations `0018`/`0019` or the Wallet
  Console mirrors `0114`/`0115` through an authorized staging rollout.
- Verify billing end to end in staging, including exhausted-credit login refusal,
  signing commitments, monthly invoices, failed payment, and recovery access.
- Resolve provisional Pro pricing, tax treatment, Stripe retry settings, and
  production credit approvals before production billing activation.

These gates remain pending. No production readiness claim is made by this record.

Deployment does not approve production credit limits or convert customer accounts
to postpaid. Those account-level billing approvals remain separate.

Before a future 1.0 release, review the public API and define its stable
compatibility policy. Version 0.37.0 does not make that stability commitment.
