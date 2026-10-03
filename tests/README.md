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

The isolated Console binding E2E runs independently of the browser stack:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts relayer/tenant-deployment-binding.e2e.test.ts --reporter=line
```

It uses the production Console Worker, a consumer Worker, a real local service
binding, and fresh local D1 on an ephemeral port. It verifies unavailable bindings,
concurrent correct/wrong-lane requests, fresh revision reads, removal, and D1
timing propagation. The shared binding factory supplies deployment records.
`console-binding-evidence.json` retains observations and migration/bundle hashes.
The consumer exercises the production resolver; this test does not run a signing
ceremony or establish regional latency. Local D1 omits region/primary metadata,
and the test requires those fields to remain absent rather than inventing placement.

The authenticated Console service preflight exercises the complete production
Console Worker initialization with its D1 schema and the installed Wallet package's
service client:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts relayer/console-service-auth.e2e.test.ts --reporter=line
```

It issues a credential through the Console D1 service, authenticates through a real
Worker service binding, and verifies malformed-key, origin, environment, rotation,
and revocation behavior. It also resolves the active project environment, rejects
an unprovisioned tenant root, and delivers the same wallet-created usage event twice:
one Console wallet projection persists, while registration remains excluded from
monthly active-wallet billing. It also replays verified registration projections
and rejects an organization/scope mismatch. Local random encryption/signing keys
and unusable Stripe placeholders satisfy composition configuration; an external-request guard
requires zero Wallet-runtime or network calls. No root is provisioned and no
signature is produced. `console-service-auth-evidence.json` records the fourteen
service responses, ten observations, migration and bundle/package hashes,
and zero external calls, without credential values. Hosted signing remains a
separate gate requiring a real active root and Gateway composition.

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

### Real regional Wallet composition

The lower-level regional HTTP/D1 composition also verifies expired device links:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_TEST_ARTIFACT_DIR=.artifacts/r152/link-expiry \
node tests/e2e/regional-session-routing.e2e.mjs
```

Its `regional-session-routing-evidence.json` includes `linkHttp.expiry`: six
unclaimed/prepared sessions across all three homes, real elapsed QR expiry,
foreign-ingress polling and replay, approval rejection, home-only terminal cleanup,
and rejected recreation after terminal-row removal. The same requests verify
expired shared proof nonce pruning while retaining fresh replay guards. Preparation
uses synthetic owner signer material. Terminal-row removal is injected directly;
this does not exercise a scheduled pruning job or server-process restart.

Run from the private repository against a built public Wallet candidate:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_INTENDED_SKIP_BUILD=1 \
node tests/scripts/run-regional-real.mjs
```

Omit `SEAMS_INTENDED_SKIP_BUILD` to build the public services. The public checkout's
`.env.local` supplies its existing intended-test settings. The wrapper allocates
and removes an isolated local role-state directory. Ports 4100–4106 and 4201–4202
must be available. This exercises real browser registration, linked-device
installation and NEAR/Tempo signing with three isolated signer D1 databases and
production Console placement. The three Gateways share one local Router role
stack. It does not measure geographic latency or independently placed Router roles.

`SEAMS_TEST_ARTIFACT_DIR` selects the evidence directory (default
`.artifacts/r152/regional-real`); each home subdirectory retains
`regional-real-evidence.json` with
home/foreign table counts, transient cleanup, retained receipts and request
paths/statuses without payloads or credentials. The matrix covers US→WEUR,
WEUR→APAC and APAC→US (wallet home → linked-device ingress). Each case first loses a real Router execution response and requires replay of
the same reservation. It then drops one successful activation reply (requiring identical activation replay), then
two successful final acknowledgement replies after cleanup commits, requires the
exact acknowledgement to replay with fresh device proofs, and verifies signing
and home-only installation/cleanup afterward. It also checks shared Console
bootstrap routing and final-proof retention, with empty signer nonce tables.
Use a fresh directory to preserve a previous run. The public intended harness also
supports `SEAMS_INTENDED_PERSIST_TRACE=1` with `SEAMS_INTENDED_TRACE_DIR`.

The `three real wallets` case registers US, WEUR and APAC owners concurrently in the same
Console/signer stores, then routes them through foreign ingress for locked-page
reload, passkey unlock, Ed25519/ECDSA key export, fresh-browser passkey recovery
and NEAR/Tempo signing. Recovery commits at home, loses its finalization reply,
then resets the client runtime. The durable journal must survive that reset,
replay the same operation and target, and clear after the successful reply.
Each consumed code is then submitted with a new reservation and must be rejected
as already used, including the browser's error message. Select it with
`--grep 'three real wallets'`. Its `mixed-homes/mixed-home-evidence.json` records
exact tenant scope, registration start/completion times with verified overlap,
established home assignments, per-wallet store counts and
request paths/statuses, including the successful finalization and replay at each
home. Key-export material is not included in this receipt. Set
`SEAMS_INTENDED_PERSIST_TRACE=1` and `SEAMS_INTENDED_TRACE_DIR` to retain the
per-owner journal and lifecycle assertions alongside it.

The `adds, uses and revokes` matrix exercises an added Email OTP method through
foreign ingress for every home (US→WEUR, WEUR→APAC, APAC→US). It verifies
addition, duplicate-add refusal, lock/reload, Email OTP unlock and NEAR/Tempo
signing, revocation, local refusal of the revoked method, and continued passkey
signing. `methods-<home>/method-active-evidence.json` and
`method-revoked-evidence.json` record home-only methods and authority state plus
forwarding metadata. The first successful finalization and revocation replies are
lost after commit; each must replay the same request/proof and committed result.
The receipts retain attempt/loss counts without recording those payloads.
Google proof verification uses the configured intended-test
token; OTP delivery uses the development D1 outbox. Refresh an expired token from
the public checkout with `node tests/scripts/ensure-intended-google-token.mjs`.

The `interrupted Google Email OTP` matrix starts with passkey wallets and
recovers each in a fresh browser through foreign ingress (US→APAC, WEUR→US,
APAC→WEUR). It loses the committed finalization reply, resets the client runtime,
and checks exact replay plus pending-journal retention and removal. It then
verifies an additive Email OTP authority, NEAR/Tempo signing, the shared Google
identity locator, home-only custody records and consumed-code rejection. Each case saves
`google-recovery-<home>/recovery-evidence.json`. The harness's direct budget
queries use the same regional transport as browser requests. Google tokens and
OTP delivery use the same configuration as the method lifecycle matrix.
After the consumed-code UI check, the recovered method unlocks again and signs
NEAR plus concurrent Tempo/Arc, retaining the budget-exhaustion assertion.
