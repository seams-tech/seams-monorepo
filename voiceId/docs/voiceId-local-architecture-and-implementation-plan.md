# Local VoiceID architecture and implementation plan

Date: 2026-09-14
Updated: 2026-09-16
Status: structure decisions, private Rust modules, domain types, and adapter
contracts are in place, with boundary and compile-fail tests.
The production runtime, host API, model adapters, and acceptance gates remain
unimplemented. The retained Python incremental Moonshine adapter is evaluation
code.

Related plans:

- [Legacy removal](voiceId-legacy-removal-plan.md)
- [macOS virtual capture device](voiceId-macos-virtual-capture-device-plan.md)
- [MPC wallet extension](voiceId-mpc-wallet-extension-plan.md)

## Product direction

VoiceID helps a robot determine who spoke a command, whether that person is
plausibly nearby, and whether the command can be attributed to that person in
the current conversation. Voice analysis and available visual analysis run on
the device. Raw audio, video, and biometric templates stay local.

The robot may accept a command while looking away from someone it recently
saw, when current speech and continuing scene evidence support that attribution.
Every command receives a fresh assessment. A remembered presence observation
never creates a general unlocked state.

### Confirmed decisions

- Local processing is the normal and complete command path; no hosted verifier
  or biometric-upload fallback is required.
- ZK is removed from the architecture and implementation queue. No proving
  subsystem is part of this plan.
- Combine voice with recent visual context when available. Looking directly
  at the speaker's mouth for every command is unnecessary.
- Treat unavailable, stale, contradictory, and ambiguous evidence explicitly.
- Keep perception, command authorization, and physical safety as separate
  responsibilities.
- Reuse useful audio components while replacing the old application lifecycle.
- Wallet signing is an optional consumer addressed by its own plan.
- Prototype the future authenticated hardware-capture boundary with a separate
  macOS virtual capture device. Its simulated and Mac protected-key assurances
  remain distinct from qualified hardware-protected capture.
- Develop the proprietary VoiceID engine and its provider implementation in
  `seams-monorepo/voiceId`; distribute versioned compiled native/WASM artifacts.
- Keep the optional wallet extension and its minimal public provider contract in
  `seams-wallet`. Public SDK development requires no proprietary VoiceID source.

### Proposed first delivery scope

Start with one enrolled owner, English commands, one controlled indoor setting,
one native device profile, and a small allowlist of low-risk robot interactions.
Other people can be present; they remain unknown participants and can cause
ambiguity. Simultaneous speech requires clarification rather than a best guess.

Use the existing Python package and model adapters as the evaluation baseline.
The production engine is Rust, with a native shared library as the first artifact
and explicitly provisioned runtime/model dependencies. The first development
host is the current Apple Silicon Mac. Moonshine's native C API is the selected
speech integration boundary; speaker/PAD backend choices and target-robot
qualification remain open.

Keep execution direct, with bounded model work. Introduce process separation
only where native-library isolation, cancellation, or the consumer boundary
requires it. A narrow public wallet extension is in scope for the integration;
a general plugin framework, model-service mesh, and multi-device synchronization
remain unnecessary. Browser WASM is a later, separately qualified delivery target.

The product-scope assumptions remain provisional. L0 records deployment hardware,
spoken language, action allowlist, and resource limits before they become release
requirements. The structure decisions below are settled for this scaffold.

## Guiding security principles

Recorded on 2026-09-16 following review of
[Apple Reference Image](https://security.apple.com/blog/apple-reference-image/)
(published 2026-09-15). Apple describes sensor-backed capture, protected processing,
bounded timestamps, and revocation for photographic provenance. The principles
below are VoiceID design decisions informed by that example. They preserve
local-only processing, the current MVP trust model, and the decision to exclude ZK.

### Separate capture integrity, human attribution, and intent

Evaluate three distinct claims: whether samples came through the expected
sensor/processing path, whether the enrolled person spoke nearby, and whether
that person authorized the exact command. A genuine microphone can capture a
loudspeaker replay; a genuine camera can capture a screen showing a synthetic
face. Sensor authentication leaves speaker, presentation-attack, visual/source
association, and operation-specific intent checks necessary. A signed capture
or a remembered presence observation never grants command authority by itself.

### State the capture trust boundary explicitly

The MVP trusts the configured OS, runtime, and acquisition path. Validated frame
formats, session identities, and timestamps provide consistency checks without
proving hardware origin. Preserve a future hardware-backed capture option only
when a selected platform demonstrates the required sensor and verification APIs.
Apple's photo design establishes no equivalent microphone or real-time
audiovisual capability for our targets.

If such a target is qualified, verify the original sensor evidence before
converting it into ordinary engine frames, and preserve its association through
preprocessing. Represent verified assurance through the responsible verification
boundary; a caller-provided `trusted` flag cannot establish it. Required assurance
must never silently downgrade when verification is unavailable. Hardware-backed
capture remains a later platform qualification, separate from MVP acceptance.

### Evaluate freshness using its worst-case bound

Use the common local monotonic timeline for offline conversational decisions.
Include capture-clock mapping error, relevant cross-sensor uncertainty, and
elapsed processing/queue time when evaluating evidence age. Recent presence is
eligible only when its worst-case age is inside the configured validity horizon;
its observed timestamp never refreshes because a model result arrived later.
If uncertainty prevents that conclusion, require fresh evidence or return an
explicit insufficient/degraded outcome under the selected profile.

`ClockMapping.maximum_error` must affect runtime eligibility checks. A timestamp
field or cryptographic signature alone cannot establish sufficiently recent
human presence. No network timestamp service is required for the local MVP.

### Preserve the processing chain and verify loaded artifacts

Keep captured windows, preprocessing, stage results, and attribution associated
with the same source and current enrollment version. Authenticated raw input
cannot protect a later substituted transcript or bypassed matcher. Each deployment
must state which parts of this processing chain its enforcement boundary protects.

At artifact-loading boundaries, verify the actual engine/model/configuration
artifacts against authenticated expected release identities using the existing
release mechanism. Verification must cover the bytes actually consumed by the
loader. Check the supported preprocessing, calibration, and policy
combination before admitting work; reject mismatches and invalidate affected work
on replacement. `ModelId`, `CalibrationId`, and `ProfileId` are metadata until
those checks exist. Artifact verification establishes what was loaded; resistance
to compromised execution requires separately qualified platform enforcement.

### Minimize disclosure and invalidate compromised or changed authority

Keep raw media, templates, embeddings, and full transcripts local. Consumers
receive only the information needed for the current decision. Avoid exporting
stable sensor identifiers or reusable biometric hashes as general identity claims.
Enrollment/device changes, capture discontinuities, and runtime/model/profile
replacement or withdrawal invalidate affected pending decisions and require
fresh assessment. Previously successful evidence cannot survive a change in the
conditions that made it eligible. The wallet extension owns remote device
revocation and operation admission; local robots require no online revocation
service or per-frame signing infrastructure.

These principles add no cloud inference, retained biometric evidence archive,
new attestation service, or ZK subsystem. Implement the runtime checks and
artifact-loader checks in their existing milestones; qualify stronger hardware
assurance separately when an actual deployment requires it.

## Structural checkpoint — 2026-09-15

Scaffolding steps 1 and 2, plus the domain/adapter contracts in step 3, are complete:

- Rust 2024 is the production language, in the private
  [`voiceId/engine` package](../engine/README.md). Python remains evaluation tooling.
- `aarch64-apple-darwin` is the first native development target. This selects a
  build/integration host; the actual robot, array, camera, and environment still
  require L0 qualification.
- The first deliverable is an embedded shared library (`cdylib`), with `rlib`
  output for Rust composition/testing. Step 3 specifies host API responsibilities
  and memory ownership; concrete C declarations and exports follow the runtime
  shell. No executable service or IPC protocol is being introduced.
- Moonshine stays a native dependency behind `adapters::native`. A standalone
  Rust link/load probe against the provisioned Moonshine 0.0.71 arm64 artifact
  returned C ABI version `20000`. Production stream integration and portable
  release packaging remain implementation work.
- Domain, runtime, utterance, presence, attribution, and enrollment logic remain
  portable. Native capture/storage/clock/model bindings are excluded from WASM.
  Browser model execution and platform adapters remain independently qualified
  work under L7; compiling the core does not compile Moonshine's C++ backend.
- The scaffold declares the eight module boundaries described below. Portable
  domain values and adapter traits are exposed for private Rust composition/tests.
  Capture/utterance identity, bounded media, partial/final text, explicit missing
  capability/identity/presence states, and atomic template replacement have contracts.
  There is no exported host API, placeholder identity success, runtime coordinator,
  concrete adapter, or wallet integration.

The [engine contract checkpoint](../engine/README.md#domain-and-adapter-contracts--step-3)
documents typed boundaries, ownership, limits, cancellation, and native host
responsibilities. Twelve boundary tests and seven compile-fail tests cover the
implemented value/type invariants. Step 4 adds runtime wiring and lifecycle tests;
real adapter implementations and concrete C exports follow. This progress does
not complete the hardware, model, calibration, or release gates in L0-L7.

## Repository, package, and release boundaries

| Surface | Owner and delivery |
| --- | --- |
| VoiceID engine, capture adapters, enrollment storage, attribution, model integration and calibration | Proprietary source and evaluation in `seams-monorepo/voiceId`. Ship compiled runtime artifacts and the model assets permitted by their licenses. |
| Private wallet provider implementation | Developed with VoiceID in `seams-monorepo`; adapts the engine to the public operation-approval contract. Released with the proprietary integration artifact. |
| Optional VoiceID wallet extension and provider contract | Public implementation in `seams-wallet`; owns wallet-facing types, boundary validation, cancellation, and approval-flow integration. |
| Wallet custody, challenge/operation binding, device credential verification and MPC | Existing public `seams-wallet` owners. VoiceID receives no wallet secret material. |
| Robot controller and private product composition | Consume the local engine or exact wallet/VoiceID releases. Robot safety remains independent of identity. |

The public extension depends on its public contract. The proprietary provider
implements that contract; the integrating runtime supplies an explicit provider.
The public SDK must build and test without access to the private repository,
model weights, or private release credentials. Avoid copying engine source into
`seams-wallet` or making the base SDK download models for users who do not enable
VoiceID. Choose the smallest optional module/package surface that fits existing
wallet conventions during W0 of the extension plan.

### Engine and consumer separation

The engine owns local perception and short-lived attribution state. A robot
adapter consumes operation-specific commands. A separate private wallet provider
uses the same engine with the wallet's fresh approval profile and the public
extension's request/result contract. Wallet challenges and transaction types
stay at that adapter boundary; ordinary robot conversations require no wallet.

Sensor acquisition stays in the local runtime's platform adapter. A browser host
may need to acquire media and supply timestamped frames to a local worker/WASM
instance. That device-local capture boundary is separate from the wallet approval
API, which carries no raw media, biometric templates, or model scores.

### Delivery targets

- **Native first:** ship an embedded Rust shared library with a narrow C host
  binding, initially developed on Apple Silicon macOS. Define ownership,
  cancellation, buffer lifetime, and host restart behavior at that boundary.
  Ship a tested artifact and explicit dependencies without requiring private source.
- **Browser WASM later:** reuse portable engine logic and qualified model assets
  behind the same wallet-facing contract. Implement browser capture, worker,
  permissions, and storage adapters explicitly. Benchmark actual supported
  browser/device profiles; unavailable microphone-array or visual capabilities
  remain unavailable in policy.

The retained Python/PyTorch/SpeechBrain/native adapters are not an established
WASM build pipeline. Evaluate model export, supported operators, streaming APIs,
runtime size, acceleration, and memory before selecting a WASM backend. Native
and WASM need separate qualification; neither target's measurements qualify the
other. Keep one production definition of attribution/policy behavior, with thin
platform adapters and shared behavioral scenarios. Retire replaced production
paths; retain Python only where it serves documented evaluation/reference work.

Release exact artifact versions with their target, public contract version,
model/calibration identity, integrity information, and required license notices
through the existing release/provenance mechanisms. Verify the supported
combination at load time and reject unsupported versions or missing required
capabilities. Provision assets explicitly; startup and inference remain offline.
No new release registry, compatibility shim, or model-download fallback is needed.

Proprietary source stays private. Distributed executables and model assets remain
inspectable; compiled delivery provides no guarantee of reverse-engineering
resistance or faithful execution on a compromised host. Wallet trust and device
key enforcement are specified separately in the extension plan.

## Runtime responsibilities

| Component | Responsibility and boundary |
| --- | --- |
| Native capture | Acquire timestamped audio frames and camera frames when available. Preserve audio channel layout and report device/clock discontinuities. |
| Utterance processing | Detect speech, stream transcription, identify utterance boundaries, and derive model input windows from the same captured source. |
| Voice analysis | Assess quality, speaker similarity, and presentation-attack signals independently. Preserve uncertainty and model/calibration identity. |
| Visual context | Detect/track people, associate an enrolled face where supported, and maintain short-lived last-seen context. Treat face matching as probabilistic evidence. |
| Spatial association | Relate audio direction to visual tracks using calibrated microphones, camera geometry, and robot pose where available. |
| Attribution | Associate the current utterance with a participant using current voice and temporal/spatial context. Reject contradictory or ambiguous associations. |
| Command interpretation and policy | Interpret a bounded command vocabulary, determine whether speech addresses the robot, and apply the locally configured action policy. |
| Robot adapter | Deliver an allowed, operation-specific command to the existing robot controller. The controller retains all physical safety checks. |

Keep the retained Python adapters and evaluation helpers in
`verifier/voiceid_verifier/`. Implement the production responsibilities as direct
modules in the private `engine/` Rust package. Reuse the retained model
knowledge, algorithms, and test cases; port or replace adapters according to
the selected backend. Avoid a naming-only migration or a second production
Python coordinator alongside the compiled engine.

## Capture and model execution

### Audio

Live input is timestamped PCM with a capture-session identity, sequence number,
sample rate, channel layout, and clock mapping validated at acquisition. Keep
array channels until source localization is complete. Derive mono/resampled
views only for models that need them. A mono microphone explicitly provides no
array-derived sound direction or distance estimate.

Use a bounded in-memory ring buffer. Define frame size, speech pre-roll,
endpointing, maximum utterance length, and retention horizon for the selected
device. On overflow, sequence gaps, device replacement, or clock reset, invalidate
affected observations and pending decisions. Do not silently stitch recordings
across discontinuities.

Transcription must use an actual incremental runtime API. Speaker and PAD models
may evaluate bounded speech windows when enough current audio is available;
they do not need to produce a result on every frame. Preserve shared capture and
utterance identities across all stages. A valid owner's earlier speech cannot
authorize a different speaker's command later in the same buffer. Insufficient
current speaker evidence requires a repeat or clarification.

Run independent stages concurrently where the hardware benefits. Bound queue
depth, work admission, and deadlines. A timed-out stage cannot later emit an
allowed command. Keep buffers alive until their final reader finishes; do not
zero memory while a timed-out native job still uses it. Test and document native
library copies and best-effort cleanup limits rather than promising complete
memory erasure.

The existing energy-based speech detector, ECAPA integration, and research
AASIST adapter are starting baselines. Their old recording lengths and
thresholds are not release settings for conversational commands. Moonshine's
old closed-set approval intent classifier is separate from the new robot
command vocabulary.

The retained Python Moonshine adapter now uses `create_stream()`, `start()`,
`add_audio()`, and `stop()` with partial snapshots and explicit finalization or
cancellation. Its offline evaluator feeds this same incremental path. It keeps
a fresh decoder per utterance for the existing cross-request isolation invariant;
decoder reuse needs separate qualification. Live capture, timestamp/utterance
coordination, and the compiled production binding remain L2 work. See the
[adapter contract](../verifier-spike/README.md#local-model-baselines).

### Video and spatial context

Retain a short, bounded in-memory frame history only where a temporal visual
check needs it. Prefer derived track observations for recent-presence memory.
Persist neither raw video nor continuous face observations by default.

An observation records its capture time, track identity, coordinate frame,
location uncertainty, and identity state. Map camera and microphone clocks to
one local monotonic timeline. Calibrate array direction against camera geometry
and account for robot/head movement. Unknown calibration or stale pose makes
spatial association unavailable.

Direction is a cue with uncertainty; it does not by itself establish distance,
speaker identity, or a live source. The robot's own speech, nearby loudspeakers,
television audio, reverberation, and head motion must be evaluated explicitly.
Use the robot's playback signal for self-speech suppression where the device
supports it. Do not allow synthesized robot speech to approve a command.

When a face is visible during the utterance, evaluate lightweight mouth-motion
and speech-timing consistency as an additional cue. A positive result may
influence policy only after calibration. Absence of concurrent mouth footage
does not invalidate a supported recent-visual-context path. Full lip reading
and photorealistic audiovisual spoof detection are outside the first scope.

## Temporal state and attribution

Use explicit domain states with required branch-specific data. Normalize raw
device events, model responses, persisted records, and local IPC once at their
boundaries. The production engine uses precise tagged variants and exhaustive
handling; Python evaluation follows the same state meanings. Public and private
TS boundaries follow the repository's discriminated-union and type-fixture
rules. Diagnostic scores describe the decision and never replace domain state.

| State | Required meaning |
| --- | --- |
| Sensor available / unavailable / faulted | Available includes capture profile and clock mapping. Other branches carry a reason and cannot manufacture observations. |
| Identity matched / unknown / ambiguous | Matched includes enrollment identity and version. Unknown and ambiguous cannot carry an authorized owner identity. |
| Visual track current / recent / expired / departed | Current/recent include observation time and location uncertainty. Recent additionally has a bounded validity deadline. Departed invalidates continuity immediately. |
| Attribution attributed / ambiguous / rejected / insufficient | Attributed identifies the current utterance, participant, supporting checks, capture session, and validity window. Other branches cannot become executable commands. |
| Command allowed / needs clarification / denied / no command | Allowed includes the exact command, utterance, attributed identity where required, policy version, and deadline. Other branches expose no execution handle. |

Presence is per participant. The validity horizon is calibrated for the target
environment, with an explicit maximum age. Seeing someone depart, losing track
identity at a crossing, changing capture sessions, restarting the process, or
receiving contradictory spatial evidence invalidates continuity early.
Confidence decay alone cannot override those invalidations.

Do not multiply voice, PAD, and visual scores as though they were independent
probabilities. Start with explicit calibrated eligibility gates and contradiction
rules; introduce learned fusion only if measured failure cases justify it.

### Intended interaction behavior

| Situation | Required behavior |
| --- | --- |
| Owner is visible and current voice/source evidence agrees | Attribute the utterance and evaluate the exact command under the allowlist. |
| Owner was recently seen; robot looks away; current speech and location remain consistent | Permit the calibrated recent-context path for allowed low-risk interactions. No new visual observation is invented. |
| Camera is absent, disabled, or its last observation expired | Use only an explicitly qualified audio-only policy. Restrict actions or request clarification; never claim visual confirmation. |
| Owner was seen leaving or another source contradicts the owner track | Invalidate recent context and reject/clarify the attribution. |
| Two people could be speaking, speech overlaps, or current audio is too short | Request a fresh utterance or visual reacquisition; do not select the nearest historical owner match. |
| Speech is background conversation, TV playback, or robot self-speech | Do not execute a command. Ambiguous addressedness requires clarification. |
| A model is missing, uncalibrated, overloaded, or past its deadline | Return the explicit degraded/insufficient state. Required checks cannot be skipped to obtain approval. |

The action allowlist and evidence requirements are configured locally by the
application owner. A caller or language model cannot label its own operation
low-risk. The initial recognizer may use a wake/address cue and a short
conversation context; neither makes unrelated later speech executable.

Emergency stop and protective pause remain available independently of owner
authentication. Identity never overrides the robot's safety controller.

## Enrollment, local storage, and privacy

- Enrollment requires deliberate local setup approval. Never enroll whoever
  happens to be near an unconfigured microphone.
- Gather sufficient varied, quality-controlled voice material and optional
  consented face samples. Bind the paired enrollment through the setup flow;
  simultaneous observation alone cannot assign an identity.
- Commit a template atomically only after its collection and stability checks
  pass. Re-enrollment or deletion invalidates dependent in-memory identities.
- Encrypt templates with a randomly generated key protected by the selected
  device's storage facilities. Bind ciphertext to enrollment identity, device,
  modality, and template/model version using authenticated metadata. Base64
  serialization provides no encryption.
- Keep enrollment replacement, deletion, and reset as explicit local operations.
  No automatic template learning from accepted commands in the MVP.
- Keep raw media in bounded RAM by default. Diagnostic capture is an explicit,
  consented, time/size-limited offline research operation. Ordinary logs exclude
  raw media, embeddings, and complete transcripts.
- Offline startup works after dependencies and models have been provisioned.
  Model downloading/updating is an explicit maintenance operation. Inference
  never silently downloads assets or calls a remote fallback.

The MVP trusts the local OS, runtime, and configured sensor acquisition path.
It evaluates physical replay and spoofing but does not claim resistance to a
fully compromised endpoint or prove sensor provenance. Trusted hardware and
sensor-path qualification are separate deployment decisions. Wallet use states
its stronger or additional assumptions in the extension plan.

## Implementation sequence and exit gates

### L0 — Fix the first device and experiment contract

- [ ] Select the actual robot/native host, OS, microphone channel access, camera,
      playback reference, and robot pose interface. Record unavailable features.
- [ ] Choose the first spoken language, owner setup, permitted commands, and supported
      audio-only behavior. Keep all initial actions low-risk.
- [ ] Set measurable latency, memory, buffer, and operating-environment budgets.
      As a starting experiment, propose warm p95 final attribution within
      500 ms of speech end and a 1 s decision deadline; confirm or revise from
      target-device measurements. These are targets, not inherited guarantees.
- [ ] Confirm licenses, local model availability, and setup consent.
- [x] Select Rust 2024, the Apple Silicon macOS development target, a shared
      library artifact, and the Moonshine C API boundary. Run a Rust native
      link/load spike against the provisioned evaluation artifact.
- [ ] Define the VoiceID C host API in scaffolding step 3. Demonstrate streaming
      model execution through the Rust adapter and record remaining model
      backend/packaging work before a full pipeline implementation.
- [ ] Record a candidate browser/WASM profile and feasibility questions for L7.
      Its delivery is independent of native MVP acceptance.

Exit: one concrete hardware profile, native packaging decision, and acceptance
contract. A development Mac alone cannot establish target-robot performance.

### L1 — Retain adapters and create precise local boundaries

Build on the retained adapters from the completed source cutover.

- [x] Scaffold the private engine's domain, runtime, utterance, presence,
      attribution, enrollment, adapters, and consumers modules. Isolate native
      bindings from the portable module build.
- [ ] Define capture, utterance, enrollment, stage-result, and command states.
- [ ] Decouple retained PCM adapters from HTTP and old enrollment/phrase DTOs.
- [ ] Preserve adapter, quality, aggregation, timeout, and cleanup tests.
- [ ] Add a deterministic timestamped event-replay test input without making it
      a production sensor source or an alternative authorization path.
- [ ] Implement the authenticated-capture domain and verifier according to the
      macOS virtual capture-device plan. Keep raw OS capture, simulated evidence,
      Mac protected-key evidence, and future hardware evidence distinct.
- [ ] Define engine/platform/consumer boundaries and coordinate the public
      wallet provider contract with W0. Keep wallet protocol types outside the
      perception core; wallet implementation does not block the robot slice.
- [ ] Establish compiled-engine tests against retained evaluation scenarios and
      select which Python helpers remain useful reference tooling.

Exit: model work and state tests run without the old TS application.

### L2 — Deliver the native audio vertical slice

- [ ] Capture real PCM continuously with bounded buffers and discontinuity handling.
- [ ] Exercise the audio slice through the separate macOS virtual capture device
      and its evidence verifier. Treat this as protocol emulation, not proof of
      hardware microphone origin.
- [ ] Implement actual streaming transcription and per-utterance speaker/quality/PAD
      assessment with independent states and bounded execution.
- [ ] Verify loaded model/preprocessing/calibration artifacts against authenticated
      expected release identities before admitting inference; reject mismatches.
- [ ] Add explicit local enrollment, protected template storage, and deletion.
- [ ] Interpret a small command set and expose local status plus a non-actuating
      command sink for testing. Missing calibration prevents restricted execution.
- [ ] Document one runtime invocation, test command, and offline smoke procedure.
- [ ] Exercise the audio slice through the selected compiled native artifact
      and host binding, with no dependency on private source at installation.

Exit: an enrolled owner can complete the audio slice on the selected device;
stale results, unknown speakers, self-speech, and overload cannot trigger the
test sink incorrectly. The old application has already been removed. This is an
interim audio milestone; the conversational visual-context MVP also requires
L3-L6.

### L3 — Add visual memory and source association

- [ ] Implement optional camera capture, person tracking, consented face matching,
      and bounded current/recent/expired/departed state.
- [ ] Implement microphone direction where supported, clock/geometry/pose mapping,
      and uncertainty-aware association with visual tracks.
- [ ] Apply worst-case evidence age, including clock-mapping uncertainty and
      processing delay; insufficient freshness requires reacquisition or an
      explicit outcome permitted by the selected degraded profile.
- [ ] Evaluate concurrent mouth-motion timing; represent unavailable or unqualified
      checks explicitly.
- [ ] Implement the interaction table, including looking away, leaving, track
      crossings, occlusion, sensor failure, and audio-only degradation.

Exit: deterministic tests and real captures demonstrate supported recent-context
attribution and early invalidation. Camera availability never becomes a hidden
requirement for starting the runtime.

### L4 — Integrate the robot command boundary

- [ ] Bind every allowed result to one command/utterance and a short deadline.
      Reject duplicates, changed commands, expired results, and old capture sessions.
- [ ] Add the bounded addressedness/conversation rules and clarification behavior.
- [ ] Connect the low-risk allowlist to the existing robot controller. Keep its
      independent safety and emergency paths intact.
- [ ] Invalidate pending decisions on lock, enrollment change, shutdown, and sensor
      discontinuity, plus runtime/model/profile replacement or withdrawal.
      Restart begins without remembered authority.

Exit: no consumer can turn generic presence or a stale successful model score
into execution through the supported API.

### L5 — Calibrate and qualify the complete local MVP

- [ ] Extend existing corpus tools with synchronized audio/video and track-event
      provenance. Preserve old measurements under their original profiles.
- [ ] Use development/calibration/evaluation partitions without subject/session
      leakage. Add consented independent human speakers; synthetic impostors
      alone cannot establish population accuracy.
- [ ] Measure command-level false attribution/execution, genuine completion,
      clarification/rejection rates, PAD errors, and visual association errors.
      Report sample counts, uncertainty, and results by capture/attack condition.
- [ ] Test recordings, live clones, loudspeakers near the owner, screen/photo face
      presentation, an owner nearby while another person speaks, overlapping
      speakers, short commands, noise, motion, and robot self-speech.
- [ ] Measure listening duration, endpointing, each model stage, fusion/policy,
      action dispatch, cold start, p50/p95/p99, peak RAM, and sustained resource use.
- [ ] Test network-disabled operation, device loss, clock/pose discontinuity,
      process/model failure, bounded overload, cancellation, and a sustained soak.
- [ ] Test clock-uncertainty and exact-expiry boundaries, delayed observations,
      artifact mismatches, and result invalidation during model/profile replacement.
- [ ] Fix acceptance thresholds before the held-out evaluation. Record the chosen
      model/capture/calibration versions in the existing provenance mechanism.

Exit: all declared hardware and degraded-mode profiles meet agreed numerical
acceptance criteria and the robot runbook is executable. Until criteria are
selected and measured, label the system experimental.

### L6 — Release the proprietary native package

- [ ] Build and publish a versioned artifact from `seams-monorepo` using the
      selected release mechanism. Include required runtime/model dependencies,
      integrity information, target profile, and license notices.
- [ ] Install on a clean supported host without private repository access. Test
      enrollment, inference, restart, and deletion with networking disabled
      after provisioning; verify privacy in ordinary logs and transport.
- [ ] Verify contract/version and capability handling, cancellation, pending
      result invalidation, and artifact loading through the actual host binding.
- [ ] Keep public contract tests independent of proprietary artifacts. Test the
      actual private provider with an exact public extension release when W1 is
      available; this wallet composition gate belongs to W1.

Exit: the native robot MVP is installable and qualified as a proprietary compiled
release. Wallet signing remains governed by its separate extension milestones.

### L7 — Qualify the browser WASM target

- [ ] Prove model/runtime portability and resource feasibility before building
      the browser integration. Record replacements and recalibration required
      by unsupported models or operators; leave unsupported profiles unavailable.
- [ ] Package the portable engine and model assets with the required browser
      capture/worker/storage adapters. Reuse the public provider contract.
- [ ] Integrate with the wallet-controlled runtime and its asset delivery where
      used for signing; define microphone/camera permission and lifecycle handling.
- [ ] Run shared attribution scenarios plus browser-specific permission loss,
      suspension, reload, cancellation, storage, privacy, and performance tests.
      Requalify biometric behavior for the actual browser capture profile.

Exit: a declared browser/device profile meets its own measured acceptance gates
and installs without private source. A WASM release alone establishes no new
server-recognized wallet factor. Native delivery does not depend on L7.

## Open decisions and dependencies

| Decision | Needed by |
| --- | --- |
| Actual device, array/channel access, camera, calibration and pose interfaces | L0; blocks hardware-specific capture/localization work. |
| Native structure | Selected: Rust 2024, Apple Silicon macOS development host, embedded shared library, Moonshine C API. Host API and real adapters remain steps 3/L2; release is L6. |
| Speaker/PAD inference backends and production robot profile | L0/L2 qualification; retained Python integrations remain evaluation baselines. |
| Exact public provider surface and release/version ownership | L1 with wallet W0; public contract in `seams-wallet`, private implementation in `seams-monorepo`. |
| Allowed commands and the required evidence for camera-present and audio-only operation | L0; blocks executable policy. |
| Face/tracking implementation and any mouth-motion check | L3; selected from target-device measurements and license review. |
| Recent-context horizon, continuity rules, thresholds, and acceptable error rates | Initial rules in L0/L3; frozen before L5 evaluation. |
| Device key protection and enrollment administration | L2; no claim of protected storage before implementation. |
| Authenticated capture encoding, signer, verifier, and virtual-device transport | M0-M3 in the macOS virtual capture-device plan; STM32 replacement is M4. |
| Multisubject corpus access and consent | L5; blocks biometric/security qualification. |
| Artifact delivery and redistributable model/runtime dependencies | L0 license/packaging review and L6 clean-host release test. |
| Browser/WASM model portability, capture, permissions and storage profile | L7; separately qualified after the native target. |

The wallet extension can be designed alongside this work. It cannot turn an
unqualified robot perception result into a financial authorization, and it is
not a prerequisite for the local MVP.
