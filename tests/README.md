# Private test workspace

Public Wallet lifecycle contracts, Rust vectors, and Wallet-owned browser tests live in
[`seams-wallet`](https://github.com/seams-tech/seams-wallet). This workspace covers
private Console composition and deployed product flows.

## Gates

- `pnpm test` runs the Console operating E2E cases on a fresh managed local stack.
- `pnpm test:console` runs the same browser suite directly.
- `pnpm test:relayer` runs focused private Console service and D1 checks.
- `pnpm check` runs lint, application and private fixture type checks, and the
  Console-core import boundary.
- `pnpm -C tests test:unit` remains available for existing focused private invariants.
  Do not add new unit tests. Prefer a medium-to-hard product E2E scenario that leaves
  repeatable evidence.

The managed Console suite owns local ports 4001, 4002, 4100, and 4101. Its launcher
refuses to run while another local Wallet stack owns those ports; stop the other stack
before running the suite.

## Three Console journeys

`pnpm -C tests test:console` type-checks and runs exactly three independent browser
tests. Each test creates its own organization, project, and environment through the
Console APIs; no journey consumes another journey's records. The owner journey
restores the shared login fixture's profile name even if its assertions fail.

| Journey                                          | Requested pages                                                  | Behavioral checks                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner sets up a working team and credential      | Account settings, Team members, API keys, Deployment status      | Onboarding and enabled navigation; profile save/reload; viewer invitation scope persisted, resend, revoke/reload; credential creation, one-time reveal, edit, rotation, revocation; deployment identity/origins and reload.                                                                                           |
| Owner funds and governs a sponsored operation    | Billing account, Invoices, Gas sponsorship, Policy engine, Audit | Zero-balance top-up link; checkout return origin; settlement and idempotent reconciliation; receipt download/reload; case-sensitive gas coverage publication and audit deep link; allowed/denied simulation; approval and publish; loaded versions; effective runtime snapshot and deletion.                          |
| Operator diagnoses and recovers a failed webhook | Webhooks, Observability, Audit                                   | Real local receiver returns 500 until explicitly recovered; signed payload and dead letter; incident search, level/window filters, detail expansion and empty results; replay of the same event to 200; persisted attempts and resolved dead letter; audit deep link and CSV export; endpoint-switch race protection. |

The billing, policy, and gas assertions live in `.journey.ts` helpers and register
no standalone tests. The former general route smoke is replaced by these explicit
page behaviors and the shared browser-error diagnostics.

External boundaries are controlled: checkout uses the existing local billing
provider; the webhook receiver is a real HTTP server; Deployment status uses a
schema-validated gateway projection containing the newly created environment and
publishable credential. The latter tests the page's integration contract, not a
Cloudflare cutover or canary. Policy decisions are simulated through the real
Console service; this suite does not broadcast a funded blockchain transaction.
The team flow verifies invitation management, not an invitee's identity-provider
login or invitation acceptance. “Operator” describes the recovery task; its local
fixture has owner permissions and does not assert restricted-role authorization.

Successful runs attach profile/team/deployment screenshots, credential hashes,
receipt PDF, policy screenshots, runtime snapshot JSON, webhook observations, and
audit CSV under `tests/test-results/`. Failing browser runs also retain a trace,
screenshot, and video. No raw credential or webhook signing secret is intentionally
included in the success artifacts.

Run one journey independently with, for example:

```sh
pnpm -C tests test:console --grep 'Operator diagnoses and recovers a failed webhook'
```

Implementation validation on 2026-09-28: Console test type-check and test discovery
pass (three tests). Browser execution is currently blocked before test setup by an
existing Wallet `workerd` listener on port 4100 (`environment_or_infrastructure_failure`).
The new assertions have not been browser-verified. In particular, the observability
correlation deliberately requires the actual webhook incident to be visible in the
selected scope; it does not seed a replacement incident or mock observability data.

## Existing Wallet composition cases

`e2e/linked-device.operating-path.test.ts` and
`e2e/intended-behaviours/tenant-root.rotation.contract.test.ts` encode distinct composed
product flows. They still import pre-split Wallet internals and are not part of the
default gate. Migrate them to supported package APIs before using `test:intended` as a
gate. The public Wallet lifecycle suite runs in `seams-wallet`.

## Test policy

A failure in a focused test must be classified against the current domain types and
owning product specification before editing code or fixtures. Preserve cross-language
wire, cryptographic, type-level, and persistence invariants that browser flows cannot
observe. Remove tests that only restate fixtures, inspect source text, or depend on
retired paths. E2E tests should exercise a meaningful user journey and save a
verifiable, repeatable artifact.
