# Refactor 121: remaining delivery steps

Updated: September 11, 2026

Branch integration: `claude/refactor-121-derivation-root-security` → `dev`

This is the single execution checklist. The
[main plan](./refactor-121-tenant-derivation-root-security.md) defines the product
and security contracts; the [runbook](./tenant-recovery-runbook.md) contains
operating procedures. Track demonstrated outcomes here. Do not maintain a
second checklist or estimated engineering-completion percentage.

## Closeout and R105 handoff — September 11

R121's local tenant journey is delivered and manually accepted. Source changes
are integrated in `dev`; this closes the feature implementation work. Automated
wallet-continuity acceptance now passes. Hosted recovery acceptance remains open below.
This dated closeout supersedes the older scope, release, and pending-local-work
statements retained in the historical entries.

### Completed

- [x] Enroll both public wrapper keys through CLI/browser approval, prove control,
      and commit the pair only after both enrollments complete.
- [x] Create a recovery backup and save a verified recovery ZIP containing the
      encrypted packages, manifest, and local private wrapper key files. The owner
      demonstrated this flow with the published 0.4.0 CLI.
- [x] Keep completed setup commands visible with reduced opacity and syntax
      highlighting; clarify wrapper-key terminology and simplify approval dialogs.
- [x] Restore both holders into the local empty destination, approve access with
      a passkey, and explicitly activate recovery. The owner observed
      `SUCCESS: Recovery activated` and active lineage metadata.
- [x] Complete local operational-share rotation through the dashboard. The owner
      confirmed share version 4 with both Derivers healthy.
- [x] Implement rotation cooldowns of one minute locally and ten minutes in hosted
      configuration, resumable rotation, and clearer recovery/activation results.
- [x] Release wrapper-key naming and console discovery in CLI 0.4.0. Setup uses
      `--wrapping-key-file`, defaulting to `./deriver-a-wrapper.key` or the B role.
      The dashboard URL is discovered from the console.
- [x] Commit the integrated recovery/restore/rotation changes (`17403318b`) and
      wallet-continuity E2E scenarios (`f3363c033`).
- [x] Fix isolated launcher configuration and resolve runtime environment keys to
      authoritative Console environment IDs before exact tenant-root lookup.
- [x] Preserve explicit null fields at the WASM EVM commit boundary and validate
      Tempo recovery targets without the EVM-only namespace field.
- [x] Pass all four rotation E2Es independently, including original-key signing
      after cold unlock and recovery with a code issued before rotation.

### Outstanding verification and follow-up

- [ ] Verify the final hosted revision and complete staging/production recovery
      backup, replacement, restore, and rotation acceptance with intended owners.
      Earlier deployments and local owner acceptance do not establish this gate.
- [ ] Retain the separate provider/source-retirement limits and actual-cost
      follow-up already documented below. No new erasure or revocation claim is made.

| E2E scenario | September 11 result |
| --- | --- |
| Signing while Deriver A is stopped | Passed (43.0s) |
| Warm Tempo and Arc/EVM signing after rotation | Passed (45.4s) |
| Cold unlock after rotation | Passed (45.3s) |
| Recovery code issued before rotation | Passed (44.8s) |

Fix commits: `5dfb89356` (launcher isolation), `4ebff154c` (environment
identity resolution), and `74b8fc835` (custody payload boundaries).

These results supersede the initial registration failures. Each scenario ran
against a fresh isolated local stack. The original public keys and addresses
remain the signature-verification oracle; no rotation assertions were relaxed.
Logs: `/tmp/rotation-fixed-e2e-2.log`, `/tmp/rotation-fixed-warm.log`,
`/tmp/rotation-fixed-cold.log`, and `/tmp/rotation-recovery-final.log`.

Focused launcher/lineage tests (7), the ECDSA add-signer lifecycle test, Rust
custody wire fixtures, intended-suite TypeScript checks, and Wallet Console
TypeScript checks also pass. The wallet SDK/WASM and wallet server builds pass.
Temporary test services were stopped. These are local results; this closeout
does not claim a new staging or production deployment.

### R105 integration notes

- Preserve Wallet ownership of tenant-root creation/security/restore routes,
  custody adapters, active-lineage lookup, scheduler, dashboard, and CLI.
  Relevant paths are `packages/wallet-console-server-ts/src/tenantRootCreation`,
  `tenantRootSecurity`, and the Wallet dashboard under `apps/seams-console/src/products/wallet`.
  Generic Console authentication and environment records remain Console-owned.
- Keep the public native CLI and npm launcher available through the repository
  split. `packages/seams-cli` is now 0.4.0; its signed native assets still come from
  `seams-tech/seams-sdk`. Publish the replacement launcher/assets from the public
  Wallet repository before changing old-repository visibility. Preserve release
  signature verification, runtime recovery trust, and cached offline execution.
- Rotation/backup cooldowns are separate from provider destruction.
  `tenant_root_google_kms.rs` still validates a 24-hour (`86400s`) KMS destruction
  schedule; the one-minute/ten-minute action cooldowns do not prove faster erasure.
- Preserve browser-approved, destination-bound restore access, OS-trusted HTTPS,
  separate role imports, durable session retry, and fresh activation step-up.
  Browser approval alone is not restore activation. The demonstrated destination
  was empty; active-root replacement is not accepted by this evidence.
- **Launcher isolation fixed:** the skip-env-file flag now respects `process.env`
  for no-argument launches. Preserve this behavior when moving the launcher.
- **Registration identity resolution fixed:** runtime scopes use environment keys
  such as `dev`; tenant-root records use the authoritative Console environment ID.
  `tenantRootSecurity/runtimeLineage.ts` resolves active environment records through
  the existing Console adapter/service binding before an exact root lookup.
  Preserve this boundary through the split. No fallback root search was added.
- Preserve explicit null serialization in the WASM EVM commit payload and the
  chain-specific recovery target parser. Both mismatches blocked real lifecycle
  flows and are covered by the successful rotation contracts.
- The four behavioral contracts live in
  `tests/e2e/intended-behaviours/tenant-root.rotation.contract.test.ts` with their
  spec in `docs/intended-behaviours.md`. All four now pass locally. Preserve them
  and the existing root/PRF invariance vectors during the split.

## Historical acceptance gates — September 10

This section owns current delivery scope. Dated rollout and provider entries
below retain their historical evidence and may describe blockers resolved by a
later entry. Publication was rechecked on September 10: GitHub Releases and the
npm `latest` tag both identify version 0.2.4. That release includes the bundled
restore command. The subsequent final-import response-loss fix is in the local
checkout and rebuilt local CLI; it has not been published to npm.

### Current scope: bundled CLI only

The same-site/browser-approval design is deferred. Keep existing destination and
bootstrap authentication, empty-destination enforcement, and explicit CLI activation.

- [x] Bundle offline verification, start/resume, manifest registration, and one
      holder import into `derivation-root restore --destination URL --role ROLE`.
- [x] Default backup filenames; allow the encrypted key path through `--key-file`.
      Save private session and encrypted retry envelope automatically.
- [x] Verify both bundled holder imports and explicit activation in the native drill.
      Six restore drills pass, including saved-envelope retry without rereading the key.
- [x] Demonstrate a real local empty-destination restore through the Console API,
      Rust Workers, and persistent D1/DO storage. `recovery-local-drill.mjs` restores
      the expected root, recovers a lost final-import response without rereading
      the key, verifies activation and cleanup receipts, refuses consumed bootstrap
      access, and survives restart. This is fixture evidence, not a restore of the
      user's original files.
- [x] Provide `pnpm recovery:local --manifest PATH` to build the local CLI, verify
      packages, provision isolated destination storage and bootstrap authority,
      apply migrations, and print commands with private credential-file input.
- [x] Publish version 0.2.4 containing the bundled command and update dashboard
      instructions. A later release is needed to distribute the response-loss fix.

### Enrollment, backup, and hosted acceptance

- [x] Publish the native CLI and npm launcher. The current releases are
      [seams-cli-v0.2.3](https://github.com/seams-tech/seams-sdk/releases/tag/seams-cli-v0.2.3)
      and [`@seams/wallet-cli@0.2.3`](https://www.npmjs.com/package/@seams/wallet-cli/v/0.2.3).
      Version 0.1.1 supplied the recorded tarball execution/signature verification;
      the September 10 registry check establishes current publication only.
      The old `@seams/cli` package was unpublished.
- [x] Verify `npx @seams/wallet-cli --help` by package name. Recorded version
      0.1.1 execution completed after npm metadata became available.
- [x] Demonstrate local browser approval and CLI proof confirmation for both test keys.
- [x] Commit the staged pair, create a backup, download both packages and manifest,
      verify with the CLI, and confirm page state after reload. Completed in the
      September 11 local owner journey; hosted acceptance is tracked separately.
- [ ] Retain the complete approval/enrollment/commit/backup contract and focused
      scope, revocation, expiry and confirmation replay checks.
- [x] Integrate the enrollment backend and final dashboard changes into `dev`.
- [ ] Verify staging trust/configuration and ceremony, then verify the production
      page with the intended key holders on the final hosted revision.
- [ ] Complete production backup/replacement recovery acceptance. Preserve the
      distinction between local restore evidence and production acceptance.

KMS destruction was confirmed on September 9 for the recorded recovery-set and
provider-drill keys. Permanent decrypt failure was exercised with separate
provider-drill ciphertext. Operational-share erasure and complete source
retirement remain unverified. Actual cost evidence is still unavailable. TOTP
custody approval remains R118 work.

## Current position

- **Rotation and scheduling work locally.** The dashboard, step-up, tenant
  isolation, cooldown, replay, process-crash resumption, signing continuity,
  fixed scheduler, health, and audit behavior have operating evidence. Hosted
  production-session and physical-passkey verification remain a rollout gate.
- **Recovery foundations exist.** Governance, recipient proof, artifacts,
  trust verification, backup lifecycle, persistence, native CLI, and dashboard
  states are implemented. The mounted local HTTP flow uses live KMS to enroll
  recipients, create packages, resume after reload, and serve separate downloads.
  Production trust and the earlier backend/frontend rollout are complete.
  The current browser-approved enrollment/pair-commit flow and final dashboard
  changes still require integration, staging deployment, and hosted acceptance.
- **Restore activates and cleans up locally.** The five Workers now complete
  separate imports, forward refresh, epoch-one activation, bootstrap destruction,
  both role cleanup receipts, and staged-material clearing. Lost activation
  responses and partial cleanup replay preserve the original evidence. Restore
  is mounted in both console Workers. The complete local HTTP path now covers
  bootstrap, start, manifest registration, both role imports/replays, activation,
  status, and destroyed-bootstrap refusal. Security status and scheduler
  enumeration include the restored root. Dashboard status now carries the
  completed restore and its source disposition. A fresh app-scoped restore now
  registers an Ed25519 wallet and verifies normal signatures before, during, and
  after rotation. The restored-root status is visible in the live dashboard independently of backup provisioning.
- **Production signing keys and CLI publication are delivered.** Separate GitHub environments
  hold recovery and release keys, each restricted to `main`. The workflow builds
  Unix assets, checksums, SBOM, and provenance and rejects repository test roots.
  The current published CLI is 0.2.3 for macOS/Linux; Windows is deferred. The
  bundled restore change remains in the checkout. Historical release validation
  and CI results below apply to the specific revisions they name.
- **Hosted infrastructure has rollout evidence.** Backend/frontend deployments
  succeeded September 8–9, and the authenticated production page showed an
  explicit unprovisioned state. This does not establish tenant provisioning or
  recovery acceptance. September 10 staging trust configuration is provisioned;
  its deployment and ceremony remain open.

The following sections retain completed operating evidence and dated delivery
history. Their old deployment waits, publication versions, and provider deadlines
are superseded by the current acceptance gates and later dated outcomes.

## 1. Completed restore operating-path evidence

- [x] Complete role-local cleanup, Router coordination, and the console wire.
      Preactivation cleanup uses the existing signed cleanup-grant primitive,
      validates its exact destination/session authority, deletes staged role
      material, and persists a replayable closure receipt. Preserve the bootstrap
      credential on expiry. Add the A/B cleanup migration (`0009`) and update the
      existing revision manifest with it.
- [x] Carry the original canonical `activation_receipt_b64u` from the Router
      into console persistence. Postactivation cleanup uses that receipt and prior
      partial evidence, retries outstanding work, and destroys bootstrap authority
      after activation. Keep preactivation and postactivation branches distinct.
      Implement the canonical TypeScript grant signer and `cleanupSession` client
      with required destination/session scope.
- [x] Mount restore inside `HostedConsoleAuthHandler`, before generic routing,
      in `d1LocalDevWorker.ts` and `d1ConsoleStagingWorker.ts`. Wire existing D1
      stores, manifest/control-plane clients, destination identity and fresh
      lineage, bootstrap authority, cleanup issuer, trust, and readiness. Custody
      mounting waits for its real provider.

Implementation also fixes three failures found by the operating run: activation
compared refreshed commitments against imported commitments; promotion omitted
the pending operational role row; and the console rejected the native
`destroyed` bootstrap status. Postactivation cleanup can resume a pending role
using the original signed restore decision.

## 2. Completed bootstrap restore delivery evidence

- [x] Demonstrate normal signing from the restored destination using its active
      lineage. A native fixture with a valid app tenant identity completed the
      mounted HTTP restore path. The existing browser signing/rotation scenario
      then registered an Ed25519 wallet and cryptographically verified three NEAR
      signatures: before rotation, while a stopped Deriver held rotation pending,
      and after rotation. The stable root commitment is unchanged at epoch two;
      this tenant scope has no creation grant. This proves local Ed25519 signing,
      with fixture trust and an explicitly unverified source-retirement disposition.
- [x] Connect security-status reads to the shared active-root lookup. Activation
      evidence and completed restore sessions now retain the manifest's proved
      root commitment after staged material is cleared. A live native Router
      read matches that commitment and the restored lineage, without a creation
      grant. Local and hosted status/manual-rotation composition use this lookup.
      The same validated active record now reaches dashboard status; it no longer
      reports `restore: null` for a restored root.
- [x] Include restored roots in scheduler enumeration. Migration `0040` retains
      public logical identity in D1 at verified-manifest registration. The
      boundary checks its canonical digest and organization against the restore
      scope. Enumeration validates the identity digest, uses the retained root
      commitment, and rejects duplicate active identities. A live restored root
      remains enumerable after its staged manifest is cleared.
- [x] Make CLI activation resumable after a process restart. `restore activate`
      now requires `--session-file`, durably writes an owner-only administration
      session before dispatch, and reuses it without reading bootstrap credentials
      on retry. The CLI drill confirms reuse and cross-destination refusal. Session
      expiry remains enforced by the destination.
- [x] Exercise preactivation expiry with staged material and recover a lost cleanup
      response. Fixed a dead end where `cleanup_incomplete/pre_activation` could
      never retry: it now retains the deadline and destination fingerprint, and
      status/start retry cleanup with a session-scoped D1 compare-and-swap. Native
      A/B cleanup receipts replay exactly after reloading D1; direct role-store
      reads show both import private keys and imported shares cleared. Bootstrap
      authority remains usable and the mounted HTTP route starts a fresh session.
      The drill advances the service clock to the 24-hour deadline; native grant
      verification and cleanup use real time.
- [x] Exercise interrupted role activation. A temporary local service proxy refused
      Deriver A's activation request while forwarding the remaining protocol calls.
      Native D1 then showed A pending, B active, and bootstrap destroyed. The mounted
      activation retry completed A and cleanup using the same activation decision
      and bootstrap-destruction receipt. No production fault flag was added.

Completed operating evidence (local scratch artifacts; fixture trust):

| Outcome | Evidence |
| --- | --- |
| Full mounted HTTP restore, replay, cleanup and scheduler lookup | `/tmp/r121-complete-http-restore-evidence.json` |
| Restored-wallet signing before, during and after rotation | `/tmp/r121-restored-normal-signing-evidence.json` |
| Expiry cleanup retry and cleared native staged material | `/tmp/r121-expiry-cleanup-proof.json` |
| Interrupted role activation resumes the original decision | `/tmp/r121-interrupted-activation-evidence.json` |

The expiry drill advances the service clock; native cleanup uses real time.
Source networking was not instrumented and source retirement remains explicitly
unverified. These results do not establish production trust or provider delivery.
Reuse the existing scratch scenarios only when their behavior changes. Do not
repeat completed scenarios as a separate progress gate.

Targeted Rust, TypeScript, persistence, route and CLI checks passed for the
implemented changes. The unrelated unit-typecheck baseline remains
`tests/unit/helpers/syncAccountResponse.fixtures.ts:41` TS4094; it is outside R121.

## 3. Completed initial CLI and dashboard evidence

- [x] Enforce signed revocation snapshots in the native destination. The control
      plane consumes optional `TENANT_ROOT_RECOVERY_TRUST_SNAPSHOT_JSON` from its
      existing Env configuration and rechecks it during restore operations.
      The same manifest submitted to the rebuilt native Worker's private HTTP
      endpoint returned `200 / valid_at_trust_snapshot` under ordinary signer
      retirement and `400 / invalidBefore` under compromise revocation.
      `/tmp/r121-snapshot-http-evidence.json` records this fixture-trust drill;
      it establishes no live-freshness or production-trust claim. The focused
      native test, WASM check and local Worker build pass.
- [x] Cover retained-source disposition and interrupted-download recovery.
      The existing restore-service scenario verifies that activation retains the
      source in the custody model, records the acknowledging actor/time, and
      clears destination staging. The native CLI interrupted-response scenario
      proves that a failed response leaves no output file and a retry installs
      and verifies the package. These satisfy the corresponding behavioral
      acceptance checks. Repeating the full restore for a disposition label or
      adding a separate socket-fault rig is unnecessary. Live source destruction
      and permanent decrypt failure remain required with provider delivery in
      step 4; no retirement claim follows from these local results.
- [x] Deliver the restored-root dashboard status independently of backup
      provisioning. Generated commands use the configured console API and required
      activation session file; interrupted activation offers the resume command.
      Source disposition uses plain language and custody lineage supports full-value
      accessible naming and copying. The live restored-root page was exercised with
      keyboard focus/copy, reduced motion, 320 CSS-pixel reflow and actual 200%
      browser zoom. Console compilation and all 10 presentation tests pass.
- [x] Provision separate production recovery and release signing authorities.
      GitHub environments `recovery-signing` and `release-signing` hold distinct
      private keys and permit only `main`. Compiled public pins replace fixture
      roots. Dedicated workflows build the signing tools before exposing keys,
      and limit signing to typed recovery trust artifacts or release manifests.
      Private keys were never written to local files. The shipped CLI rejects
      fixture authorities; internal tests supply explicit fixture trust.
- [x] Merge implementation and clear CI. [PR #100](https://github.com/seams-tech/seams-sdk/pull/100)
      merged as `03395aa96ecea06bf7bba9e2475e93ec014a0b36`. All scheduled PR jobs
      passed: Router core/adapters/entrypoints, optimized startup, recovery-core
      and CLI tests, threshold signing, lint/types/Rust/architecture, documentation,
      browser motion, signer parity, and console operating paths. The manual-only
      constant-time codegen job was skipped as configured. Fixed stale migration
      and fixture-key expectations, a `Record` lint false positive, the cold
      optimized-build timeout, and a browser-round-trip race in the one-frame test.
      Evidence: [repository CI](https://github.com/seams-tech/seams-sdk/actions/runs/34168561287)
      and [Router CI](https://github.com/seams-tech/seams-sdk/actions/runs/34168561284).
- [x] Publish the signed macOS/Linux CLI v0.1.0 release.
      [Release](https://github.com/seams-tech/seams-sdk/releases/tag/seams-cli-v0.1.0)
      was built from `03395aa96ecea06bf7bba9e2475e93ec014a0b36` by
      [workflow 34171347253](https://github.com/seams-tech/seams-sdk/actions/runs/34171347253).
      All three binaries and the SBOM were downloaded after publication and
      verified using the published macOS ARM64 binary against the production
      release root. Production recovery trust signing is also demonstrated: the A/B/control-plane certificates and version-one revocation snapshot were signed in the separate recovery environment and verified against the published CLI pin.

Hosted rotation rollout can proceed independently after production-session,
physical-passkey and environment-binding checks.
Do not repeat the already-proven local rotation and scheduler scenarios unless
shared behavior changes.

Native screen-reader verification is excluded by the owner's delivery decision.
Keep the completed keyboard, accessibility-tree, reflow, zoom, and reduced-motion
evidence; a separate VoiceOver session is not a release gate.

## 4. Paying-tenant backup evidence and remaining acceptance

Google Cloud project `seams-501403` now has separate `global/r121-recovery-a`
and `global/r121-recovery-b` keyrings. The existing role service accounts have
only the corresponding ring’s retention permissions. Production GitHub keyring
variables and the deployment forwarding are configured. Existing operational
keys retain their original 30-day destruction settings.

**Native generation works over HTTP with live KMS.** Both copied Deriver Workers
completed prepare → contribute → derive → prove → package against the existing
restored fixture. They produced fresh recovery shares with the same stable root,
matching descriptors, and two 853-byte tenant-encrypted packages. D1 migration
`0010` retains KMS ciphertext and public manifest metadata; both roles cleared
temporary replay material and returned identical stored metadata on retry.
The live run exposed and fixed an overlong Google key identifier: base64url now
encodes the complete digest within the provider’s 63-character limit.
Evidence: `/tmp/r121-kms-native/evidence.json` and the retained round artifacts in
`/tmp/r121-kms-native/generation.json`. This proves local native execution with
fixture issuer trust and live Google KMS, not hosted custody or production trust.

The separate provider drill proved own-role encrypt/decrypt and opposite-role
HTTP 403 refusal. Its synthetic keys are scheduled for destruction on September
9 around 00:12 UTC (09:12 JST). Decrypt already fails while scheduled; permanent
destruction remains unverified until Google reports `DESTROYED`.
Evidence: `/tmp/r121-kms-provider-evidence.json`.

**Independent download authorization works over HTTP.** Fresh, operation-specific
issuer grants downloaded both stored packages after the generation authorization
expired. Both digests and lengths matched, responses use `Cache-Control: no-store`,
and a role-A grant was rejected by role B. The native access route also implements
closure before KMS destruction scheduling; that operation still needs its operating
run. Evidence: `/tmp/r121-kms-native/access-evidence.json`. Downloaded fixture
packages are retained locally for manifest verification.

**Native manifest assembly works over HTTP.** The control plane reconstructs the
same descriptor from issuer-authorized context and both role proofs, binds the
actual downloaded packages, and verifies certificates against its local trust
roots before returning the signed manifest. The 3,409-byte manifest verified both
package digests, rejected a modified package, and replayed identically. Evidence:
`/tmp/r121-kms-native/manifest-evidence.json`. Certificate trust remains fixture-only;
production certificate issuance and published-CLI verification remain outstanding.

**Recipient enrollment works through the console service and native client.**
Both roles opened native HPKE challenges, confirmed through the core recipient
implementation, persisted their server-only verifier in SQLite, refused replay,
and committed distinct fingerprints. Migration `0041` replaces pending challenges
from the unmounted custody path with records that require a verifier. The public
response excludes that verifier. Evidence: `/tmp/r121-kms-native/recipient-console-evidence.json`;
the direct native proof run also rejected modified confirmations. All 31 affected
recipient/custody tests pass across the initial run and the focused persistence
recheck. Server type checking passes with declaration emission disabled; ordinary
declaration checking hits an unrelated staging Ed25519 export-portability error.

**Native generation and access issuance work from authoritative state.** The issuer
reads the Router's verified active receipt and lifecycle revision, refuses stale
enrollment revisions, and issues separate A/B generation commands. Recipients
were enrolled at the saved Router's actual revision (`3`), then the complete native
reshare produced set `3qTR9uam1Q2QlihsGC9bwg`. Native-issued fresh grants downloaded
both 853-byte packages, and native manifest assembly verified them. Destruction
grant replay also passed. Evidence: `/tmp/r121-kms-native/coordinated-evidence.json`.
The durable console adapter now owns this orchestration. Migration `0042` journals
commands and public protocol results under the exact tenant/set scope, binds each
step to its request digest, and closes the journal before cleanup. Package bytes
remain transient. A lost B-derive response left six completed journal entries;
a reconstructed adapter resumed the same set, made the backup ready, and served
both packages and its manifest. Completed replay made no further Deriver calls.
Evidence: `/tmp/r121-kms-native/adapter-generation-evidence.json` (set
`40O0PlZnSbFyBtkcS0mizA`). The same-ID resume transition, custody service, and route
checks pass (30 tests); server type checking passes with declaration emission
disabled. Custody is mounted in both Workers. Its source-retirement callback invokes native signed role retirement.

**Native cleanup closed the earlier set.** Set `On-yCFVG7SlQAJ21DniJUA` now refuses
fresh downloads, and both D1 rows have cleared temporary material and retained
ciphertext. Google scheduled its A/B version destruction for September 9 at
01:36:48/01:36:51 UTC (10:36 JST). The September 9 follow-up below records
the final `DESTROYED` outcome.
Evidence: `/tmp/r121-kms-native/destruction-evidence.json` and
`/tmp/r121-kms-native/destruction-d1-evidence.json`.

**Source-lineage retirement works on isolated role database copies.** The native
issuer reads the authoritative active receipt and signs distinct A/B commands.
Migration `0011` persists the retirement barrier and deletes live role material
atomically; subsequent writes for that lineage fail. A revision/epoch compare
protects a concurrent rotation. Both role endpoints returned identical replay
results. D1 inspection confirmed zero remaining role shares for the named lineage,
refused reinsertion, and preserved the other lineage and original drill stores.
The console adapter now invokes these native endpoints without an injected callback.
Evidence: `/tmp/r121-kms-native/source-retirement-evidence.json` and
`source-retirement-d1-evidence.json`. The SQL compare-and-swap drill
(`source-retirement-cas-evidence.json`) preserves a concurrently revised active
row and installs no retirement barrier; an unchanged row retires successfully.
Native and console compilation and the focused revision-manifest contract pass.
The destination digest in this drill is
synthetic. Operational KMS keys are shared across lineages, so provider destruction
remains unverified; this does not establish complete source retirement.

**Mounted console custody works with live KMS.** Both Workers use the same
request-scoped adapter after the existing authorization guard. Status reads include
persisted governance and backup state. The app-scoped local HTTP run enrolled
both recipients, committed the pair, created a set, resumed that exact set after a
Worker reload, reported `ready`, and separately served the manifest and both role
packages. Set: `PigAtrzz7BSYgs5z8nTqwg`. Evidence:
`/tmp/r121-custody-mounted/http-evidence.json`. This run uses fixture trust and a
synthetic local step-up admission; it does not prove the hosted physical-passkey gate.
The 14 existing custody-route checks and server type checking pass.

An initial fixture omitted its native trust bundle. Finalization refused, closed
both packages, and scheduled their KMS keys for destruction on September 9 at
03:08:50 UTC. The failed fixture remains preserved; evidence is
`/tmp/r121-custody-mounted/failed-trust-cleanup-evidence.json`.

Deployment must supply `TENANT_ROOT_RECOVERY_CERTIFICATES_JSON` with `a`, `b`, and
`controlPlane` certificate chains plus `TENANT_ROOT_CONTROL_PLANE`, `DERIVER_A`, and
`DERIVER_B` service bindings. Native control-plane trust configuration must match.
The isolated successful console is on 4340, with Router/A/B/control plane on
4322/4323/4324/4325 and registry `/tmp/r121-custody-mounted/registry`.

**Production trust is provisioned.** All three certificate chains, the pinned
trust bundle, and signed revocation snapshot are installed and read back from the
appropriate GitHub environments. Signing runs: 34184467805, 34184651221,
34184764246, and 34184937949. PR #101 carries the native service bindings and
fails early if control-plane trust is absent.

**The dashboard now shows the mounted backup.** Removed the obsolete demo-only
recovery gate. The local preview at http://127.0.0.1:5176/dashboard/derivation-root
shows `Recovery backup ready`, both recipient fingerprints, separate downloads,
and the replacement action, using the actual local service state. Its two existing
reflow/status checks pass. This preview uses isolated fixture authentication and
trust; production verification remains a separate rollout step.

PRs #101 and #102 are merged. Production control-plane deployment
[34193815294](https://github.com/seams-tech/seams-sdk/actions/runs/34193815294)
succeeded. Backend run 34194337695 is approved and running. All seven backend
component preflights passed against the actual GitHub environment inventories.

At this September 8 checkpoint, backend/frontend deployment and permanent
destruction were pending. Later dated entries record those outcomes. Production
backup/CLI/replacement acceptance remains open in the current checklist.
The isolated Router (4312) and control plane (4315) use
`WRANGLER_REGISTRY_PATH=/tmp/r121-kms-native/registry`, preserving the original Router
namespace identity without changing the running app Router's registry. The KMS branch is not deployed. Preserve the isolated Workers on
ports 4313/4314 and `/tmp/r121-kms-native` for the next operating step.

- [x] Provision the agreed Google-generated SOFTWARE retention key per
      recovery-set/role pair, with isolated role access and a 24-hour destruction
      delay. Implement create/wrap/open/destruction; mounted local generation and
      the September 9 provider outcomes demonstrate the lifecycle.
- [x] Confirm the named recovery-set key versions are `DESTROYED`, and verify
      permanent decrypt failure for the separate provider-drill ciphertext using
      its original role credentials and AAD. Native recovery-set ciphertext and
      shared operational keys are outside that decrypt evidence.
- [ ] Record actual charged retention cost when billing evidence is available.
- [x] Mount custody with real provider/control-plane adapters in both Workers.
      Demonstrate authenticated local HTTP enrollment, package generation,
      restart resumption, ready status, and separate artifact downloads.
- [ ] Complete the dashboard enrollment → package creation → separate role
      downloads → published-CLI verification → replacement path with production
      trust, including the remaining backup UI accessibility checks.
      Verify the promised retention destruction
      and explicit source-retirement behavior; report incomplete evidence accurately.
- [x] Record the R122 integration handoff with the implemented CLI entry point,
      status and operation contracts, canonical fixtures, demonstrated local restore
      boundary, and outstanding production gates. It is in the existing
      [R122 plan](./refactor-122-deployment-portability.md#r121-integration-handoff--september-8-2026).
      Keep portability implementation in R122.

The owner authorized KMS backup integration on September 8. Local recovery
controls use live Google KMS, and the recorded September 9 key destruction is
complete. Full R121 remains open for the current bundled restore delivery,
enrollment/dashboard rollout, production backup/replacement acceptance, and
actual cost evidence.

## Provider follow-up — September 8

Google reports the earlier native recovery set's A/B versions as
`DESTROY_SCHEDULED`, with deadlines September 9 at 01:36:48/01:36:51 UTC.
The failed mounted fixture's later deadline is 03:08:50 UTC. A one-time follow-up
is scheduled for September 9 at 12:30 Asia/Tokyo (03:30 UTC), after these deadlines,
to check permanent destruction and retained-ciphertext decryption failure.

Billing is enabled for `seams-501403`. The project currently exposes no BigQuery
datasets for querying billing export; actual charged cost is still unverified.
No estimate or zero-cost claim substitutes for that evidence.

PR #103 is merged into dev, including the committed Claude branch and the remaining
tracked local edits. Dev and origin/dev were synchronized at `b1670995f`.
Backend deployment 34194337695 is building. A waiting command dispatches frontend
only if backend succeeds. Production backup/CLI/replacement evidence remains open.

## Historical branch-integration checkpoint — September 8

This checkpoint predates the current bundled restore and enrollment scope.
Its former completion count is retired; the current acceptance gates above own
remaining work. Native screen-reader verification remains explicitly excluded.

The integration checkout at `/tmp/seams-r121-dev-integration` combines the Claude
branch's committed console changes, delivered R121 work from main, and dev's
dashboard redirect. Preserve the newer page-state union and migration `0011`.
The focused Rust cutover checks pass (10); the dashboard reflow/status checks pass
(2) after updating their mock to the current active-status API result.

The shared checkout contains uncommitted work outside this integration. Preserve
it. Completion follows the current acceptance gates above.

## Production rollout blocker — September 8, 08:21 UTC

Run 34199826460 passed build, all seven preflights, migrations, and deployment of
Signing Worker, both Derivers, Router, and Wallet Runtime. Console code uploaded,
but route configuration failed with Cloudflare authentication error 10000 on
`/zones/6225112eeb9bfd3d4f3753467bf1650d/workers/routes`. Gateway was skipped.
The supplied production token also returned HTTP 403 on a direct read of that
endpoint. The production-gateway deployment token needs zone Worker Routes
permission for seams.sh. After the owner corrects the token, retry failed jobs in
this run to reuse the successful build and deployments. Do not dispatch frontend
until the backend run completes. No production custody verification is claimed.

September 8, 12:24 UTC rollout update: the corrected account token unblocked
Console and Gateway deployment in run 34199826460. All component uploads passed;
the final smoke failed because it probed Console `/readyz` instead of
`/console/readyz`, and Console router composition omitted configured CORS origins.
Live `/console/readyz` returned 200. PR #106 fixes both issues; Console build and
focused hostedConsoleAuth test passed. New backend run 34225900177 deploys main
7231caa. Frontend still awaits backend success. PR #105 and #106 fixes are now
also applied to dev. Production acceptance and September 9 provider evidence
remain open.

September 8, 13:12 UTC: backend run 34225900177 completed successfully, including
all final smoke checks. Frontend run 34230514740 was dispatched once on the same
main revision 7231caa and is in progress. Production backup/CLI/replacement
acceptance and the September 9 KMS destruction/cost follow-up remain open.

September 8, 13:50 UTC: frontend run 34230514740 succeeded after restoring account
Pages Write permission. Backend run 34225900177 and frontend now both deploy main
7231caa successfully. The production derivation-root dashboard URL returns HTTP
200; this confirms page availability, not authenticated recovery acceptance.
The remaining production ceremony needs the authenticated owner to confirm tenant
scope, perform physical passkey step-up, and arrange separate A/B key holders.
Prepared instructions: /Users/pta/.seams/r121-production-verification/README.md.
Deployment monitoring is complete; September 9 03:30 UTC provider verification is
retained. R121 remains open for the production ceremony and provider evidence.

September 8, 14:52 UTC: frontend run 34240128738 passed after PR #107 corrected
provider discovery to use the API host. Production browser verification confirmed
an enabled `Continue with Google` button at /dashboard/login. GitHub remains
unconfigured. No user credentials or passkeys were exercised; authenticated
production recovery acceptance remains open. Deployment polling is complete;
the September 9 03:30 UTC provider follow-up is retained.

September 9, 02:52 UTC: backend run 34301627068 succeeded after PR #109. Live
GET /console/tenant-root/security/status now returns the configured
Access-Control-Allow-Origin https://seams.sh and Allow-Credentials true even on
401, preserving authentication while fixing the browser CORS blocker. Owner
confirmed Google dashboard login after PR #108 corrected the test Console hostname.
Authenticated recovery-page/backup/CLI/replacement verification remains open.
Provider destruction/cost follow-up is retained for 03:30 UTC today.

September 9, 03:31 UTC provider follow-up: Google KMS reports all four role key
versions for recovery sets On-yCFVG7SlQAJ21DniJUA and lRjuBSnjLHwIQ88lzS9euw as
DESTROYED. Evidence: /tmp/r121-kms-final-destruction.json. Both separate provider-drill
role keys are also DESTROYED; decrypting their retained ciphertext with the original
role credentials and AAD returns FAILED_PRECONDITION / KEY_DESTROYED (HTTP 400).
Evidence: /tmp/r121-kms-final-provider-drill.json. These decrypt checks use synthetic
provider-drill ciphertext, not the native recovery-set ciphertext. No additional or
shared operational keys were destroyed. Actual charged cost remains unverified:
`bq ls --project_id=seams-501403 --format=json` exposes no billing-export dataset;
this is unavailable evidence, not zero cost. Production provisioning and recovery
acceptance remain open. PR #110 deploys the existing unprovisioned empty state;
backend run 34306896947 is still in progress.

September 9 rollout completion: backend 34306896947 and frontend 34309392467
succeeded. Verified the authenticated production recovery page in the owner's
Chrome session: it now displays “No derivation root is provisioned for this
environment.” The former 502 is handled as an explicit unprovisioned state.
This confirms the deployed empty state; production provisioning, separate-holder
enrollment, backup/download/CLI verification, and replacement acceptance remain
open. Deployment polling is paused because no deployment is pending. Scheduled
KMS destruction is confirmed above; actual charged cost evidence remains unavailable.

September 9 creation UI: dev bc72125aa / PR #111 adds Create derivation root
to the unprovisioned page for owners and administrators with projects.manage.
The authenticated creation endpoint owns tenant scope and root material; the UI
retains an environment-scoped operation ID across reloads and retries and blocks
duplicate clicks. Console type-check and Vite build passed. Production frontend
run 34315607335 deploys main c7d31fc4. Owner acceptance: create from the security
page, confirm active metadata, refresh and confirm the same root. No production
root has been created by this UI yet; recovery acceptance remains open.

## Staging recovery configuration — September 10

The staging gateway now holds signed certificates for Deriver A, Deriver B and
control-plane keys. Signing runs 34382542930, 34382726213 and 34382550352 succeeded;
the signed artifacts were installed as TENANT_ROOT_RECOVERY_CERTIFICATES_JSON and
read back successfully. Staging control-plane variables hold the pinned recovery
trust bundle and the existing signed revocation snapshot, preserving its history.
Commit ea42875f3 wires these values into staging deployment and preflight. These
are configuration preparations; staging has not been deployed or accepted.

Deployment script syntax and diff checks pass. The deployment test file passed
22 cases; its production manifest generator still fails because the supplied
workflow inputs omit VITE_DASHBOARD_DERIVATION_ROOT_ENABLED. Setting the process
environment did not resolve the generator's input contract. That unrelated failure
was left unchanged rather than weakening the deployment check.

Local Workers are ready (7/7 services). Local key commitment, backup creation,
download and verification still require acceptance. No hosted rollout is claimed.

## Unified CLI recovery — September 11, 2026

The tenant path uses `seams-wallet` for enrollment, offline checks, import and
activation. The dashboard supplies console, environment and destination values.
Enrollment obtains the deployment authority over verified HTTPS; `trust connect`
performs the same trust setup from a downloaded manifest on another device.
The CLI retains public trust per HTTPS origin and logical identity, checks root continuity on
updates, and uses OS HTTPS verification. ZIP contents never establish trust by
themselves. The release-signing root stays compiled into the launcher.

Restore access uses a short-lived browser request. An authenticated owner with
fresh, session-bound step-up approves the displayed code and destination. The
console exchanges its server-held bootstrap credential, verifies the returned
identity, and releases a destination-bound session only to the matching polling
secret. Owner and environment validity are checked again at polling. Approval
and denial are audited without credentials. The dashboard shows unavailable
access explicitly instead of displaying unusable restore commands.

Local Workerd receives the operating system's trusted CA certificates through
its runtime configuration. The native CLI needs no special executable or CA
argument. The local approval-table migration is applied. The standard release
candidate has passed the actual Workers import/activation/restart drill,
including a lost second-import response; both ZIP modes and approval binding
checks pass. The launcher has also run a signed release with network access
disabled after its first verified download.

PR #121 is merged. Signed GitHub release `seams-cli-v0.2.5` was published by
workflow 34516520229. Its downloaded Apple Silicon binary passed the real Workers
restore drill without SSL_CERT_FILE (evidence: `.local/recovery-drill-1789066415512`).
The 0.2.5 launcher also ran offline after its verified download.

Remaining acceptance work: publish the npm 0.2.5 package after authentication,
complete the live dashboard's passkey-backed backup
ceremony, configure its empty destination, and execute the displayed holder and
activation commands. This acceptance has not yet passed. PR #121 isolates the
CLI release from unrelated application work. Production rollout and promotion
to npm `latest` follow tenant-flow acceptance.
