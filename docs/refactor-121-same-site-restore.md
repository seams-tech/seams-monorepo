# R121: same-site recovery implementation plan

Date: September 10, 2026

Status: partially implemented as of September 11. Browser-approved restore access
and bundled holder commands are delivered and locally accepted against an empty
configured destination. Explicit CLI activation remains the operating path.
Active-root preflight/no-op, same-site destination routing, and dashboard
activation below remain deferred design proposals. See the
[R121 closeout](./refactor-121-remaining-steps.md) for current evidence and open gates.
The implementation-gap descriptions below retain the September 10 design baseline.

## Outcome

Recovery starts on the current Seams site and targets the selected organization,
project, and environment. Each holder runs one command from their recovery folder
and approves access in the dashboard. After both imports, an authorized owner
approves activation in the dashboard. Seams handles destination routing,
manifest registration, operation IDs, retries, and progress checks.

The existing active root remains intact. A verified backup matching that root
finishes successfully without importing or activating anything. A different
active root causes a refusal. Only an explicitly empty destination accepts imports.

### Scope and prerequisites

This first flow recovers derivation-root custody while the console control plane
remains available: organization/project records, owner accounts, authentication,
and the saved approval policy survive or have already been restored. Recovery of
the console's own database or owner access is a separate operator procedure.
An empty cryptographic destination can therefore still be administered by owners
through the existing site. Update the old restore-route assumption that an empty
destination necessarily has no console accounts.

Same-site recovery is not an in-place root replacement or a clone command. If the
selected environment already has an active root, preflight returns the matching
no-op or mismatch refusal. Do not silently route around it to another destination.

## Current implementation and gaps

- `crates/seams-cli/src/command.rs` and `run.rs` now contain a bundled `restore`
  command. It verifies a role package, registers the manifest, imports a share,
  and saves a private session and encrypted envelope for retries. It still uses
  bootstrap credentials and lacks the active-root preflight.
- `restoreService.ts` now permits exact-manifest registration replay while
  awaiting imports; a different manifest is refused. Six native restore drills
  and the focused server registration-replay test passed. These are component
  results, not evidence of the proposed browser flow.
- `restoreWorkerRoute.ts` constructs a destination from one configured identity
  and lineage. It returns unavailable when destination configuration is absent.
  Pointing commands at the current URL does not provision or resolve a destination.
- `restoreRoute.ts` authenticates bootstrap credentials and administration
  sessions. Existing enrollment browser approval is specific to recipient enrollment;
  it must not grant restore access unchanged.
- The dashboard still exposes protocol-level commands. Published CLI 0.2.3 does
  not include the bundled restore work in the current checkout.

## User flow

1. Open recovery for the selected organization/project/environment. Expand
   installation instructions only when needed. Copy the holder-specific command.
2. Run the command inside the extracted recovery folder. The CLI verifies public
   artifacts, opens the dashboard, and displays a confirmation code. The dashboard
   shows the exact scope, recovery set, and holder role before approval.
3. After approval, the server performs preflight. A matching active root produces
   green `This recovery backup matches the active root. No restore needed.` output.
   An empty destination proceeds; the CLI prompts for the local key passphrase
   only when a new encrypted import envelope is needed.
4. The dashboard shows which holder is still required, verifies both imports, then enables
   **Activate recovery**. Activation requires fresh verification and the applicable
   owner approval policy. The dashboard follows progress through completion.

Proposed command shape, to advertise only after release:

```sh
seams-wallet derivation-root restore --console-url <current-api> --dashboard-url <current-site> --environment <selected-environment> --role deriver-a
```

The dashboard fills these values from its existing configuration, using the same
API/dashboard URL parameters as browser-approved enrollment. Holder B receives
the corresponding role. This is one copyable command; no URLs are typed manually.
Local UI port 4001 and API port 4101 are different. Do not introduce `--site`
discovery, guess API origins, or derive an authority from a backup. Reuse existing
HTTPS and local-development origin validation. Dashboard approval always displays
and validates the API/request binding. The current unfinished bundled command's
`--destination` parameter is replaced at the CLI parsing boundary, with callers
updated together. Custom deployment onboarding is outside this first flow.

## Server authority and destination resolution

Resolve the full identity from the authenticated owner's selected scope. Treat
the CLI's environment and manifest identity as claims to compare, never authority
to choose another tenant. Bind access to the resolved identity digest, destination
fingerprint/lineage, manifest digest, recovery set, role, and restore session.
The pending approval request has no restore session yet. Those destination/session
bindings become required only in the approved-import branch; the matching-root
branch has no import capability or restore session. Model these as distinct types.

Add a narrow resolver around existing active-lineage and destination services.
Its result must distinguish active, empty, busy, and unavailable states. An active
result includes the authenticated root commitment; an empty result includes the
provisioned destination identity and lineage. Reads that fail or report incomplete
creation/destruction cannot become `empty`.

For the first delivery, reuse an explicitly provisioned empty destination behind
the current site. General automatic infrastructure provisioning is outside this
refactor. If no destination exists, show `Recovery destination is not ready` with
an operator-facing diagnostic; do not send the tenant to an example hostname.
The resolver must also select the destination's matching restore store, deriver
clients, and control-plane clients. Selecting a fingerprint without routing all
subsequent operations to that same backend is insufficient.

The current single configured destination must be matched against the authenticated
scope. Never reuse it for a different organization. Mount the same resolution and
authorization behavior in local and staging/hosted workers.

### Preflight contract

Verify the signed manifest against trusted roots before comparing commitments.
Use the existing manifest verifier and compare the complete identity digest.

| Destination | Verified backup comparison | Result |
| --- | --- | --- |
| Active | Same identity and stable root commitment | Successful no-op; no import session or root mutation |
| Active | Different identity | Refuse: backup belongs to a different scope |
| Active | Same identity, different commitment | Refuse: backup does not match this environment's active root |
| Empty | Identity matches provisioned destination | Start or resume the matching restore |
| Empty | Identity differs | Refuse without changes |
| Busy or unavailable | Any | Explain the blocker; no passphrase prompt or import |

A matching commitment alone does not prove that both derivers are healthy or that
signing works. Keep health reporting separate from the no-op result. Recheck
destination state and session binding when accepting imports and activation;
preflight cannot authorize overwriting a root activated concurrently.

## Browser-approved CLI access

Reuse the enrollment approval interaction and existing fresh-verification service,
but define restore-specific request states and authority. Do not stretch recipient
enrollment records into restore records or reuse a console login token as a CLI token.

The CLI starts a short-lived request containing public manifest bytes/digest,
claimed environment, and holder role. Return an unpredictable request ID, a polling
secret, expiry, polling interval, and a confirmation code. Limit request size,
creation rate, and polling. Store only a digest of the polling secret.

The browser reads and approves the request through the normal console guard.
Require organization ownership, exact scope matching, fresh server-verified
step-up, and an explicit confirmation-code comparison. Denial, cancellation, expiry,
and revoked membership must be visible outcomes. Concurrent approvals and polling
must not issue different restore sessions for the same request.

The server performs verified preflight during approval and hands the CLI either
the no-op outcome or scoped restore access. Import access permits only that
holder's operations and status for the approved manifest/session. It cannot
activate recovery. Keep bearer material out of URLs, browser storage, logs, and
audit fields; protect any persisted token using the existing secret-storage pattern.

After an approved empty-destination preflight, the server atomically starts or
joins the restore for the exact manifest and registers it. Both holders must join
the same session. Different manifests competing for the same destination produce
a conflict. Retries return the same prepared session. The CLI does not need a
separate permission to register arbitrary manifests. Persist enough state to
resume approval preparation after a crash before returning import access.

Keep approval states explicit: pending, denied, expired, preparing, no-op, ready
for import, and failed. An approval request is distinct from the shared restore
session. Polling delivers an existing result and cannot create additional sessions
or extend authorization. Denial/expiry races must have one durable winner.

Revalidate scope, membership, expiry, and destination/session binding when access
is spent. Persist resumable authority privately on the CLI. Expired access requires
browser reapproval while preserving the operation ID and encrypted retry envelope.
Choose one established capability delivery/storage pattern during Phase 2. Document
its token issuance, hash/encryption storage, retry delivery, and revocation behavior
before exposing it. Do not assume enrollment already provides a reusable bearer
token service: it currently delivers a recipient challenge instead.

## CLI orchestration

Complete the bundled command by replacing its bootstrap authentication with the
browser flow. Default files are `manifest.json`, `deriver-a.backup`, and
`deriver-a.key`, or the corresponding B files. Keep explicit file overrides for
nonstandard custody layouts. Never gather both private keys onto one device.

Order operations as follows: verify artifacts, request approval, await server
preflight and session preparation, validate the returned binding, obtain
the role import key, create or reuse the encrypted envelope, import, report status.
Print meaningful progress without invented percentages. Handle a matching active
root with a green success summary and exit zero; mismatches exit nonzero.

Review the existing deterministic operation-ID and checkpoint implementation
against server operation-ID constraints. Bind retry state to the actual resolved
destination, session, manifest, and role. An alias change, expired import key, or
different session must never reuse an envelope against another binding. Use atomic
private durable writes and exact replay handling for lost network responses.
Reapproval can preserve an envelope only when the server confirms the same live
restore session and import-key binding. A replaced session/key requires a fresh
bound operation and resealing with the local key; explain why another passphrase
prompt is needed. Query confirmed import status before demanding a missing key
file on a retry. An already accepted exact import succeeds without reopening it.

Do not auto-activate after the second holder imports. Print the server-confirmed
state: waiting for another holder, verifying imports, or ready for owner approval.
Two accepted uploads alone do not establish activation readiness. Direct the owner
to the dashboard. JSON output exposes precise states
without terminal colors or secrets. Replace obsolete bootstrap prompts and manual
operation-ID instructions once the browser path works; update all callers together.

## Dashboard and activation

Use the existing restore section and command component. Replace the six-command
list with the two holder commands and a single progress view. Installation is
expandable first-use help. Show the selected organization/environment prominently.

Model UI states as loading, awaiting approval, no restore needed, waiting for
holders, verifying imports, awaiting owner approvals, ready to activate,
activating, recovered, and failed/blocked. Preserve the
last confirmed state on a polling error and visibly mark the failed refresh.
Announce status changes accessibly and explain every disabled action.

Add browser activation to the existing activation service through an authenticated
route. The server resolves the restore session from scope, verifies fresh step-up,
enforces the applicable governance policy, and records the exact activation approval.
The browser never receives bootstrap credentials or the CLI's bearer token.

For two-owner approval, require two distinct eligible owners approving the same
activation operation. The surviving console's saved governance policy is the
authority for this first delivery. The current verified manifest descriptor does
not expose a governance policy, so do not assume the backup supplies it. Resolve
policy independently of the failed derivers. Missing policy is a setup error;
never silently fall back to one owner. Reuse existing approval-operation machinery
wherever its scope fits. Bind approvals to the destination/session, manifest,
activation operation, and policy revision; revalidate eligible owners and current
policy before execution. A policy change invalidates approvals collected under
the old policy. Key holders need not themselves be owners: an eligible owner can
approve a holder's scoped CLI request after comparing the confirmation code.

Reuse the existing activation trust-admission rules. When offline trust is an
allowed exception, display its exact limitation and collect explicit acknowledgment
as part of the activation approval. Never silently set the CLI's old
`acknowledgeOfflineTrust` flag on the user's behalf. If current trust is required
or admission fails, activation stays blocked with the reason shown.

Activation retries must resume the same operation. Show success only after verified
continuity, activation, and the applicable cleanup outcome have been confirmed.
Keep incomplete cleanup visible and distinguish it from a failed activation.

## Implementation boundaries

| Area | Existing code to extend |
| --- | --- |
| Destination resolution and mounting | `restoreWorkerRoute.ts`, `destinationBootstrapClient.ts`, active-lineage resolver, local and staging workers |
| Preflight and session preparation | `tenantRootRestoreManifestClient.ts`, `restoreService.ts`, `restoreD1.ts` |
| Browser authority and approval policy | `routeGuard.ts`, console route definitions/policy, step-up service, existing owner-approval operations; restore-specific request persistence |
| CLI orchestration and retry state | `crates/seams-cli/src/command.rs`, `run.rs`, `console.rs`, `output.rs` |
| Approval, progress, activation UI | `CliEnrollmentApproval.tsx` interaction pattern, `DerivationRootSecurityWorkspace.tsx`, `consoleDerivationRootApi.ts`, `derivationRootPresentation.ts` |

At each boundary, parse raw values once into branch-specific types. Keep pending
requests, approved import capabilities, matching-root results, and activation
authority distinct. Existing bootstrap-authenticated services may be used to
demonstrate intermediate server changes, but completing Phase 3 requires the real
browser path. No phase is complete solely because a mock returns its desired state.

## Implementation sequence and verification

**Phase 1 — server contracts and preflight.** First demonstrate that owner access,
saved policy, and a correctly routed empty destination can all be resolved without
the original derivers. Then implement destination resolution,
verified matching-root no-op, mismatch refusals, and exact-manifest session resumption.
Demonstrate these branches through mounted HTTP routes before expanding tests.

**Phase 2 — browser authorization.** Implement the restore request store, guarded
approval/denial, atomic shared-session preparation, scoped CLI access, and polling.
Specify token delivery/storage and add the required migration here. Demonstrate real browser approval
for the matching-root no-op without prompting for a recovery-key passphrase.

**Phase 3 — bundled holder import.** Connect the CLI to approval and preflight.
Demonstrate a role import into an isolated empty local destination, terminate the
CLI after envelope persistence, and rerun successfully with the same operation.

**Phase 4 — dashboard activation.** Add live progress and the activation action,
including approval-policy enforcement. Demonstrate both imports and explicit
activation through the current site. Then remove obsolete primary-flow instructions.

**Phase 5 — regression and release.** Extend authoritative lifecycle contracts,
native restore drills, focused service tests, and type fixtures for the new states.
Cover canceled/expired approval, changed owner access, cross-scope tokens, token
role misuse, different-manifest retry, lost responses, and concurrent activation.
Verify the restored root derives the expected keys and signs a test payload.

Use the existing local active root for the no-op test. Use isolated storage for
the empty-destination drill; never clear the user's working deployment to simulate
loss. Local backups use the local-trust CLI build. Production binaries continue
to pin production trust and must refuse local development certificates.
The isolated drill has its own complete routing and control-plane test profile,
with the same logical identity but no active root in that profile. Switch the local
site to that profile explicitly for the drill, then restore its original routing.
Never silently bypass the original profile's active root in ordinary recovery.

Only after the complete local flow passes: apply backend migrations and deploy
the server together with the browser approval page and activation UI needed by
the new CLI. Then build/sign/publish the CLI, verify installation and browser
approval using that published version, and switch the primary recovery instructions
to the new command. Keep unfinished commands out of the primary UI during rollout.
Choose the release
version at that point; 0.2.3 is already published. Record the exact revision,
commands, redacted outcomes, and remaining environment limitations in the R121
execution checklist. A passing component test is not a completed recovery drill.
