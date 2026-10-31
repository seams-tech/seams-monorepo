# v1.0.0 release preparation

Status: candidate source preparation. Publication and deployment are disabled.

The user selected `1.0.0` after initially requesting `0.37.0`. This candidate
includes the published `0.36.0` recovery work, hosted billing admission, and
Wallet-owned VoiceID enrollment records. A version change does not establish
production readiness or API stability.

## Source scope

- Wallet billing admission: `cb81c010c`, with earlier error handling in `bd393832c`.
- VoiceID record ownership: `925c4ada7`.
- Console billing, invoices, and billing rules: `0e5d0001` and `60eed5e9`.
- Wallet, Wallet Server, and VoiceID candidate versions: `1.0.0`.
- Wallet iframe protocol: `22.0.0`, unchanged from `0.36.0`.
- Wallet-management protocol: `5`. Signed recovery CLI: `0.29.0`.

Console consumers remain pinned to published `0.36.0`. Update their exact versions
and lockfile only after the new packages are published and verified.

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
Candidate build and validation logs are in `.artifacts/release-100/` there.
Sequential package builds, full TypeScript checks, signing-credit acceptance,
documentation builds, packed-package checks, and the bloat check passed locally.
Worker and WASM artifacts were reused by the package build. The clean production
build and full lifecycle CI remain release gates.

The initial preparation ran builds and type checks concurrently. VoiceID type
checks failed during that run, then passed after the build finished. Candidate
validation must build first and run type checks afterward.

## Remaining release gates

- Review the public API surface and define the stable compatibility policy.
  The iframe protocol changed repeatedly before this candidate. Confirm the
  supported client/host upgrade policy before promising a stable public API.
- Run the full release CI and representative Wallet lifecycle acceptance on the
  exact candidate revision. Local focused billing checks do not replace this gate.
- Publish packages only after authorization. Verify package identities and adopt
  exact versions in Console consumers.
- Apply Wallet migration `0088` and Console migrations `0018`/`0019` or the Wallet
  Console mirrors `0114`/`0115` through an authorized staging rollout.
- Verify billing end to end in staging, including exhausted-credit login refusal,
  signing commitments, monthly invoices, failed payment, and recovery access.
- Resolve provisional Pro pricing, tax treatment, Stripe retry settings, and
  production credit approvals before production billing activation.

These gates remain pending. No production readiness claim is made by this record.
