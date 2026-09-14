# VoiceID legacy removal plan

Date: 2026-09-14
Status: source cutover completed 2026-09-14. External service/data retirement
requires a separate inventory and explicit operation.

Related plans:

- [Local architecture and implementation](voiceId-local-architecture-and-implementation-plan.md)
- [MPC wallet extension](voiceId-mpc-wallet-extension-plan.md)

## Decision and scope

Replace the browser-recording/upload application with a local, continuous
VoiceID runtime. Preserve the useful audio model integrations, template math,
evaluation tooling, and consented recordings. Complete one source cutover; do
not maintain a second supported implementation, compatibility mode, or legacy
feature flag.

The removal concerns VoiceID-owned code and its direct repository wiring.
Wallet SDK and cryptographic code live in `seams-wallet` and remain outside this
cleanup. Cloud resources, enrolled data, credentials, and recordings require
separate inventory and explicit disposition before destructive operations.

The local plan governs the replacement product. The wallet plan governs its
later signing integration. The older MVP specification, tasks, and signing
profile describe the superseded design; they must not constrain the new domain
model. Existing browser results remain unable to authorize wallet signing.

## Execution record

The source cutover removed the browser client/demo, TypeScript service/shared
contracts, hosted deployment files, legacy guards/tests, Python HTTP/base64
boundary, workspace package wiring, and superseded MVP/signing documents. It
also removed placeholder speaker extraction and moved reusable bounded execution
out of the deleted HTTP application.

The retained tree contains local audio/model adapters, focused tests, evaluation
and corpus tooling, research references, the new plans, and Git-ignored fixtures.
The ignored fixture directory was archived before deletion work to:

```text
/Users/pta/Dev/rust/voiceId-private-backups/voiceId-fixtures-2026-09-14.tar.gz
SHA-256 eef7b8ea1780b803ec08ff1f31a92ab9476e1ad1a6d0055cb884c652cf9de131
```

The archive has owner-only permissions. Obsolete dependency and bytecode caches
were moved to the macOS Trash. No fixture media, model assets, research PDFs,
cloud resources, remote data, credentials, or wallet code were deleted.

Post-cutover validation passed 24 retained verifier tests, 96 evaluation-tool
tests, 30-file media validation, Python compilation, pnpm lockfile regeneration,
and local documentation-link checks. One evaluation test initially failed
because it inherited the removed pnpm working directory; its retained subprocess
now resolves the verifier path from the script location.

## Assessment baseline

The 2026-09-14 assessment found:

- Capture buffers complete recordings before upload.
- Decoding converts audio to mono before any spatial processing.
- Moonshine is invoked through a non-streaming transcription method.
- Verification state is organized around server-selected phrases and individual
  recording submissions.
- Camera tracking, sound localization, recent visual context, and robot command
  attribution have no implementation. The robot sidecar is a runbook.
- There is no implemented ZK subsystem to delete.
- Repository searches found no VoiceID runtime consumers in `apps/` or
  `packages/`. Workspace wiring and a shared source guard reference VoiceID.
  This does not establish whether external deployments or users exist.

The assessment passed 78 TypeScript tests, 55 Python verifier tests, 17 selected
evaluation-tool tests, TypeScript checking, and validation of 30 local fixture
media files. These are baseline observations, not validation of the replacement
runtime. Model-backed robot benchmarks were not rerun.

## Removal inventory

Paths in this document are relative to `voiceId/` unless stated otherwise.

| Target | Disposition at cutover |
| --- | --- |
| `client/` | Delete the upload client, browser recorder, E0 capability wrapper, and browser fixture-capture UI. Preserve existing recordings first. |
| `demo/` | Delete the old browser evidence lab. The new native runtime gets a minimal local command/status harness. |
| `server/` | Delete `VoiceIdService`, HTTP routes, development server, Cloudflare adapter, provider transport permutations, D1 lifecycle stores, and hosted template/configuration plumbing. Carry forward security invariants through new local implementations and tests. |
| `shared/` | Delete the old API DTOs, challenge/enrollment lifecycle, evidence tiers, capabilities, parsers, and prompt contract. Retained fixture tools already have Python boundaries; verify dependencies before removing their TS counterparts. |
| `verifier/voiceid_verifier/app.py` | Delete the JSON/HTTP application after bounded execution, deadlines, shared-input handling, and cleanup behavior have been carried into the local runtime where needed. |
| `verifier/voiceid_verifier/schemas.py` | Delete the old base64-media request protocol. Define only the new local input boundaries actually needed. |
| `deploy/aws/`, `deploy/cloudflare/` | Delete hosted-service packaging, Nitro bridge proposals, and deployment runbooks. Removing files does not deprovision services. |
| `deploy/robot-local/sidecar/README.md` | Replace the hosted-evidence sidecar proposal with an executable local deployment runbook once a target device works. |
| `scripts/assert*.mjs` | Delete the VoiceID-only guards for the removed browser/service/deployment architecture. The signing guard's prohibition on presence vocabulary is obsolete for the new product. Preserve valid security boundaries with behavior and type tests. |
| `scripts/devAll.mjs`, `scripts/devAllWithVerifier.mjs`, `scripts/smokePythonHttpApi.mjs` | Delete launchers and smoke tests for the removed processes and routes. |
| `tests/unit/`, `tests/type-fixtures/` | Remove coverage used solely by the deleted TS application. Transfer any continuing invariant to the owning replacement test before deleting its only useful coverage. |
| `docs/voiceId-mvp-1.md`, `docs/voiceId-mvp-1-tasks.md`, `docs/voiceId-signing-security-profile.md` | Delete after the new plans contain the retained requirements and active links have been updated. Git history retains the old design. |

## Preserve and adapt

| Asset | Work required |
| --- | --- |
| `embeddings.py`, `scoring.py` | Keep ECAPA extraction and cosine scoring as initial baselines. Keep PCM-level entry points; remove unused transport coupling. Speaker matching is separate from diarization and source association. |
| `pad.py` | Keep the pinned AASIST adapter and explicit accepted/rejected/uncertain states. Requalify short-command behavior and thresholds on the new capture profile. |
| `enrollment.py` | Keep quality-weighted aggregation and stability math. Remove the four-prompt ceremony dependency. Replace misleading encrypted-template naming: its encoding is base64 JSON, while the old actual encryption lives in the TS store. |
| `audio_quality.py` | Reuse useful quality/windowing helpers. Reassess the energy-based speech detector and short-utterance gates; do not inherit them as validated robot thresholds. |
| `audio_decode.py` | Retain bounded file decoding for offline imports/evaluation. Live microphone arrays keep their channels until spatial analysis; file decoding is outside the live capture path. |
| `moonshine.py` | Reuse model-loading knowledge and relevant tests. Replace batch transcription orchestration and the fixed approve/reject vocabulary with genuine stream lifecycle and consumer-specific interpretation. Test cross-utterance contamination explicitly. |
| `runtime.py` | Replace recording-oriented orchestration in place with the local runtime. Reuse independent model adapters without retaining the old HTTP protocol. |
| Python tests | Keep model adapter, aggregation, quality, decode, cleanup, and overload invariants that still apply. Split mixed tests in `test_schemas.py`; retire wire/HTTP assertions and transfer useful execution tests. |
| `verifier-spike/` | Keep model pinning, consented import, fixture validation, corpus freeze, calibration, and relevant model measurements. Adapt benchmark orchestration and resilience tests that currently call the HTTP app or old schema. Remove dead helpers and superseded release gates after callers move. |
| `fixtures/`, model assets/caches, experiment state | Preserve and inventory. The 30 local fixture recordings and their manifest are Git-ignored. Model assets and resumable experiment state may also exist outside Git or outside this directory. |
| `research/`, dated reports, provider research | Preserve as reference/evaluation material. Label historical measurements with their original hardware, corpus, and protocol; they do not qualify the new product. |
| `docs/voice-agent-gtm.md` | Preserve as separate proposed product work. It is not a runtime dependency or the authority for robot behavior. |
| `docs/voiceId-architecture-discussion-2026-09-13.md` | Preserve as discussion history. Link the new plans; its ZK exploration and old MVP gates are historical. |

Offline synthetic-corpus generators are evaluation tools, not a cloud inference
fallback. Keep them only while they serve a documented evaluation case. Preserve
their consent and resumable-operation records before retiring any campaign.
Do not run paid generation or upload human recordings as part of this cleanup.

## Repository and packaging cleanup

The proposed runtime stays in the existing Python package. No replacement
browser app or general-purpose TS SDK is needed for the robot MVP.

- Remove `voiceId/package.json` and `voiceId/tsconfig.json` once their TS
  consumers are gone. Document retained Python commands directly.
- Remove the `voiceId` entry from the repository's `pnpm-workspace.yaml` and
  `voiceId:demo` from the root `package.json` at the same cutover.
- Regenerate the pnpm lockfile through the package manager. Remove dependencies
  only when the remaining workspace no longer needs them.
- Remove obsolete VoiceID-specific entries from
  `tests/scripts/check-cloudflare-d1-runtime-boundaries.mjs`; retain unrelated
  Console and storage checks.
- Update `README.md`, `fixtures/README.md`, `verifier-spike/README.md`, retained
  packaging, and active document links. Remove `.dockerignore` if its only
  consumer was the deleted container build.
- Keep `verifier/pyproject.toml` and needed evaluation dependencies. Choose exact
  supported dependencies during the local hardware spike; add no duplicate
  configuration or model manifest.
- Any new private TypeScript integration tests belong in the repository's
  top-level `tests/` workspace. Wallet-owned tests belong in `seams-wallet`.

## Execution sequence

### D0 — Protect data and establish ownership

- [ ] Record tracked, untracked, and ignored VoiceID assets without exposing
      secrets or biometric contents in logs.
- [ ] Make a recoverable, access-controlled copy of irreplaceable local fixtures
      and experiment state; verify counts and checksums. Do not commit media.
- [ ] Check actual deployment configuration, consumers, and stored enrollments.
      Record an explicit retirement/export decision for any live service.
- [ ] Confirm that retained model and corpus usage has the required licenses
      and consent; record restrictions alongside existing provenance.

Exit: no planned source removal can silently destroy the only copy of useful
data or leave an unidentified live consumer without a transition decision.

### D1 — Isolate the reusable audio core

- [ ] Remove retained adapters' dependency on old request/response shapes.
- [ ] Transfer continuing tests from the old app before deleting their owner.
- [ ] Keep one implementation of each retained behavior; move or refactor it
      instead of copying it into a second runtime.
- [ ] Update evaluation callers to the new PCM-level boundaries.

Exit: retained adapters and their focused tests run without the browser, TS
service, D1, or Python HTTP application.

### D2 — Cut over the source tree

The user selected an immediate development cutover after D1. The repository has
no executable VoiceID application until local-plan L2 is implemented; robot
release still depends on the later local gates.

- [ ] Remove the targets in the removal inventory in a focused change set.
- [ ] Apply package, command, documentation, and shared-guard cleanup together.
- [ ] Remove old mocks, fixtures, exports, and configuration used exclusively
      by removed behavior. Preserve the separate biometric corpus assets.
- [ ] Replace the robot runbook as the real hardware integration becomes usable.

Exit: one local runtime entry point remains; no production route, import, or
launcher requires the old evidence application.

### D3 — Verify removal and close out

- [ ] Run the retained Python tests, fixture validation, and the new local
      behavioral tests using the commands established in L2.
- [ ] Run affected top-level guards/type checks only where shared wiring changed.
      Classify failures before changing tests or production behavior.
- [ ] Search executable sources and active configuration for removed routes,
      imports, deployment variables, and package scripts. Historical reports
      and this deletion inventory are expected to mention the former system.
- [ ] Check active document links and regenerate affected generated artifacts.
- [ ] Confirm the local smoke test works with networking disabled after models
      are provisioned. Verify there is no hidden cloud fallback.
- [ ] Record removed files, retained assets, verification results, and any live
      service/data retirement still awaiting explicit approval.

Completion means source and development-workflow cleanup is finished. It does
not certify biometric accuracy or authorize cloud/data destruction. A rollback
uses the previous revision plus preserved data, with no permanent compatibility
path in the new runtime.
