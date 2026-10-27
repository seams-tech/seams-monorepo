# Private test workspace

Public Wallet lifecycle contracts, Rust vectors, and Wallet-owned browser tests live in
[`seams-wallet`](https://github.com/seams-tech/seams-wallet). This workspace covers
private Console composition and deployed product flows.

## Wallet component showcase

The wallet marketing page owns the canvas in `apps/wallet-console/src/pages/wallet/`.
The Seams homepage does not mount it. One four-item list contains authentication,
the installed SDK transaction modal, prediction-market checkout, and account controls.
The top selector and bottom dots select the same item. Previous and next cycle
through all four, wrapping at either end. Staggered positions produce diagonal transitions.
Static unlock, recovery, payment, and receipt cards fill the background. They remain
faded, inert, and hidden from assistive technology, and never enter the selectable list.

On a visible desktop canvas, the cursor runs the preview's local action, shows its
result, then resets for replay. Hover, keyboard focus, and an offscreen canvas pause it. Reduced-motion and touch modes use
manual controls. Automatic playback never moves focus or connects a real wallet.
Manual results remain visible until the user returns or selects another component.
The prediction-market approval bounds its transaction-details scroller to the height
provided by its host. Expansion, collapse, and nested raw-data changes keep approval
controls visible. The scenario records these transitions as per-frame JSON evidence.
The two installed SDK examples use their existing sample-data pages and run only
when selected. Both retain the signing,
broadcast, confirmation, and receipt lifecycle. The canvas is flush with the page dividers and uses monochrome
controls, with round previous/next buttons and a dot selector.

Embedded previews accept `backdrop="dimmed" | "none"`; standalone demo pages default
to dimmed. The canvas passes `none` so the native dialog's tint does not end at the
iframe boundary. This changes only the backdrop paint, preserving modality and dismissal.

With the local frontend running, execute from the repository root:

```sh
node tests/e2e/wallet-component-showcase.e2e.mjs
```

The default page is `http://localhost:4001/wallet`. Set `SEAMS_WALLET_SITE_ORIGIN`
to test another wallet page URL. Screenshots, `result.json`, and `trace.zip` go to
`.artifacts/wallet-component-showcase/`.

The VoiceID preview selects a phrase for each approval and avoids consecutive repeats.
Its six SDK-supported phrases include “No crying in the casino.” The review, voice
prompt, and receipt use the theme selected in the hero demo: Paper, Carbon, Pastel,
or Pastel Dark. It previews a simulated 2.5 NEAR transfer from `alex.near` to `shop.near`,
with a NEAR transaction ID and a Nearblocks link. The voice capture remains simulated.
VoiceID and transaction receipts minimize into a toast in 240 ms.

Run `node tests/e2e/wallet-voiceid-showcase.e2e.mjs` to check all four themes, prompt
cancellation, phrase changes, receipts, and mobile layouts. Screenshots, `result.json`,
and `trace.zip` go to `.artifacts/wallet-voiceid-showcase/`.

Authentication completion cards retain the selected theme for their surface, text,
buttons, and checkmark. Receipt status icons use the theme's primary text color so
they remain visible when Carbon uses dark button fills. Completed progress labels
and bars also use primary text color in dark themes.

Run `node tests/e2e/wallet-showcase-themes.e2e.mjs` to check registration, reset,
the Next transition, and receipt contrast across all four themes and narrow screens.
Screenshots, contrast measurements in `result.json`, and `trace.zip` go to
`.artifacts/wallet-showcase-themes/`.

## Public site navigation

Pricing plan links select the card named by the URL fragment. Each card has a
distinct grain gradient. Hover and keyboard focus reveal a card's gradient while
the selected plan remains highlighted. The Growth card is highlighted by default.
Desktop plan links frame the plans section with its heading visible below the
navbar. On mobile, links bring the chosen stacked card into view.
Reduced-motion mode removes the fade, and touch input does not produce hover states.
Each entire plan card is one link to its action, with a pointer cursor, a visible
keyboard focus outline, and a black action button. Clicking card padding or using
Enter follows the same destination as tapping the card on a touch screen.
All pricing action buttons use the shared Stripe-style arrow. Hovering a plan or
banner card animates its button arrow. Touch input keeps the resting arrow, and
reduced-motion mode removes the transition.

The wallet marketing app owns the wallet and pricing pages. Company and contact pages
belong to the company site. Wallet links use document navigation and the configured
company origin. Deployed wallet hosts redirect existing company URLs to the company
site. The company site redirects `/pricing/` and `/ja/pricing/` to Wallet pricing until
it has its own pricing page. Pricing anchors scroll after the page loads, including on
refresh.

Run `node tests/e2e/site-documentation-links.e2e.mjs` to check documentation links
from the homepage, wallet, pricing, and company pages. It checks every linked docs
destination, desktop navigation, mobile keyboard navigation, and refresh. Evidence
goes to `output/playwright/site-documentation-links/`. `SEAMS_DOCS_ORIGIN` sets
the docs base URL, including `/docs/`.

## Gates

- `pnpm test` runs the Console operating E2E cases on a fresh managed local stack.
- `pnpm test:console` runs the same browser suite directly.
- `pnpm test:relayer` runs focused private Console service and D1 checks.
- `pnpm check` runs lint, application and private fixture type checks, the
  Console-core import boundary, and the script tests.
- `pnpm test:scripts` runs the script tests alone: every
  `unit/*.script.unit.test.ts` file (deployment and local scripts).
  They are offline. The unit run ignores `*.script.unit.test.ts`, so this command
  is how they stay visible. A new script test file joins the command by name.
- `pnpm -C tests test:unit` remains available for existing focused private invariants.
  Do not add new unit tests. Prefer a medium-to-hard product E2E scenario that leaves
  repeatable evidence.

The managed Console suite owns local ports 4001, 4002, 4100, and 4101. Its launcher
refuses to run while another local Wallet stack owns those ports; stop the other stack
before running the suite.

## TypeScript compiler

Application checks, type fixtures, and declaration builds use the exact `tsrs` version
in the root `package.json`. The root `typescript` dependency supplies the JavaScript
API required by ESLint and the declaration comparison below. Project checks use `tsrs`.
Vite and Rolldown still produce application JavaScript.

The compiler comparison checks ten project configurations, including existing fixtures
that reject invalid domain states. It compares checked source files and generated
declarations. Record property order may differ. Overload and signature order must match.
Declaration maps must have the same metadata, including source paths. Their encoded
position mappings may differ when generated property positions change.

Run this comparison from the repository root:

```sh
npm install --prefix .artifacts/typescript-reference --ignore-scripts --no-audit --no-fund typescript@7.0.2
node tests/e2e/typescript-compiler-comparison.e2e.mjs \
  --reference .artifacts/typescript-reference/node_modules/typescript/bin/tsc \
  --candidate node_modules/.bin/tsrs
```

For the upstream version matched to this tsrs release, install
`typescript@7.1.0-dev.20260930.4` in the reference directory and repeat the command.
The comparison runs serially with default compiler workers. It excludes one warmup
and records three samples per project. Run it without concurrent builds or tests.
Linux requires GNU `/usr/bin/time`; macOS uses its bundled `/usr/bin/time`.
Logs, declarations, source manifests, elapsed times, and peak resident memory go to
`.artifacts/typescript-compiler-comparison/result/`. A failed comparison exits nonzero
and retains `result.json` for diagnosis. A successful comparison prints `Verified`.

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

Its `regional-session-routing-evidence.json` includes `linkHttp.expiry`: eight
unclaimed/prepared sessions across all four homes, real elapsed QR expiry,
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
installation and NEAR/Tempo signing with four isolated signer D1 databases and
production Console placement. The four Gateways share one local Router role
stack. It does not measure geographic latency or independently placed Router roles.

`SEAMS_TEST_ARTIFACT_DIR` selects the evidence directory (default
`.artifacts/r152/regional-real`); each home subdirectory retains
`regional-real-evidence.json` with
home/foreign table counts, transient cleanup, retained receipts and request
paths/statuses without payloads or credentials. The matrix covers US→WEUR,
WEUR→APAC, APAC→US and OC→APAC (wallet home → linked-device ingress). Each case first loses a real Router execution response and requires replay of
the same reservation. It then drops one successful activation reply (requiring identical activation replay), then
two successful final acknowledgement replies after cleanup commits, requires the
exact acknowledgement to replay with fresh device proofs, and verifies signing
and home-only installation/cleanup afterward. Each of those three lost activation
or acknowledgement replies now follows a restart of Gateway/Console, its D1 runtime
and all five role Workers. New processes reopen the same databases before the
lost reply reaches the client. Test observations and fault counters survive in
the driver; production handlers reload from D1. The Router replay is proved before activation, with no
further source-material execution after any restart. Per-home `restart-evidence.json`
records each commit point, status, Gateway process replacement and role supervisor
generation with old/new worker PIDs. It also checks shared Console
bootstrap routing and final-proof retention, with empty signer nonce tables.
Use a fresh directory to preserve a previous run. The public intended harness also
supports `SEAMS_INTENDED_PERSIST_TRACE=1` with `SEAMS_INTENDED_TRACE_DIR`.

The `four real wallets` case registers US, WEUR, APAC and OC owners concurrently in the same
Console/signer stores, then routes them through foreign ingress for locked-page
reload, passkey unlock, Ed25519/ECDSA key export, fresh-browser passkey recovery
and NEAR/Tempo signing. Each recovery commits at home, stops the Gateway/Console
process and its D1 runtime, restarts all five role Workers, and reopens the same
five D1 databases in a new process before losing its finalization reply.
It then resets the client runtime. The durable journal must survive that reset,
replay the same operation and target, and clear after the successful reply.
Each consumed code is then submitted with a new reservation and must be rejected
as already used, including the browser's error message. Select it with
`--grep 'four real wallets'`. Its `mixed-homes/mixed-home-evidence.json` records
exact tenant scope, registration start/completion times with verified overlap,
established home assignments, per-wallet store counts and
request paths/statuses, including the successful finalization and replay at each
home. Key-export material is not included in this receipt. Set
`SEAMS_INTENDED_PERSIST_TRACE=1` and `SEAMS_INTENDED_TRACE_DIR` to retain the
per-owner journal and lifecycle assertions alongside it.
After all four Gateway/Console and role restarts, every recovered wallet unlocks
and signs NEAR/Tempo again. `mixed-homes/restart-evidence.json` records the four linked process
replacements, role supervisor generations and foreign-ingress routes.

The `adds, uses and revokes` matrix exercises an added Email OTP method through
foreign ingress for every home (US→WEUR, WEUR→APAC, APAC→US, OC→APAC). It verifies
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

The `interrupted Google Email OTP` matrix starts with passkey-founded and
Email OTP-founded wallets, then recovers each in a fresh browser through foreign ingress (US→APAC, WEUR→US,
APAC→WEUR, OC→APAC). After finalization commits, it stops the Gateway/Console child process
and its D1 runtime, restarts all five role Workers, then starts a fresh process
over the same five D1 databases.
It loses the committed finalization reply, resets the client runtime, and checks
exact replay plus pending-journal retention and removal. It then
verifies an additive Email OTP authority, NEAR/Tempo signing, the shared Google
identity locator, home-only custody records and consumed-code rejection. Each case saves
`google-recovery-<founding-method>-<home>/recovery-evidence.json`. The receipt
records the founding method and checks its retained registration authority, the
added recovery authority, and the shared active registration offer for Email OTP
founders. Select only those cases with `--grep 'email_otp-founded'`. The harness's direct budget
queries use the same regional transport as browser requests. Google tokens and
OTP delivery use the same configuration as the method lifecycle matrix.
Each `restart-evidence.json` records distinct process IDs and successful old-process
exit. Only test observations and fault counters cross the restart; Gateway and Console objects
are rebuilt from persisted D1 state. The role supervisor handles `SIGUSR2` by
restarting its five owned Worker process groups over their existing D1/DO storage.
It atomically publishes `.runtime/role-workers.ready` with a new generation and
worker PIDs after readiness checks pass. The driver verifies these receipts; no
identity initialization, migration or tenant provisioning runs during restart.
These controlled restarts follow commit; crash recovery during a transaction is
a separate case.
Temporary databases are removed when the scenario closes.
After the consumed-code UI check, the recovered method unlocks again and signs
NEAR plus concurrent Tempo/Arc, retaining the budget-exhaustion assertion.

### Console publishable-key authentication with delayed telemetry

Run `node tests/e2e/console-publishable-auth.scenario.mjs` from the repository root.
This local composition scenario uses the Console operation handler, production key
service and real Miniflare D1. It holds usage writes while authentication returns,
completes writes out of order, revokes the key, and checks wrong-origin and
wrong-environment rejection. A failed telemetry write remains observable without
rejecting successful authentication.

Evidence: `.artifacts/console-publishable-auth/evidence.json`. The artifact contains
principal identifiers and results, with no API-key secrets.
