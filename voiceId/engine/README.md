# Private VoiceID engine

Browser/native checkpoint as of 2026-10-23. The portable engine coordinates one
bounded utterance through transcription and speaker adapters. It checks
continuity, deadlines, output correlation, enrollment changes, and result consumption.
Native Moonshine Tiny and ECAPA adapters process local fixture PCM.
The macOS development host adds capture, enrollment collection, Keychain storage,
deletion, and command checks. ABI 1 exposes those engine lifecycles to a native
C caller. The development executable also hosts one Chrome native-messaging
connection. The [browser prototype](../browser/README.md) reaches the wallet's
existing signing boundary with real native models and synthetic speech. It also
confirms a funded NEAR testnet transfer. A relocatable package now includes the
host, shared library, runtime assets, extension, and installer.
Live microphone qualification, clean-Mac installation, and robot actions remain open.

The first MVP assumes a user-controlled, authorized device. It uses speaker
matching and local approval of one exact wallet operation under existing authority.
PAD, visual confirmation, and authenticated capture are outside this MVP.

The planned
[macOS virtual capture device](../docs/voiceId-macos-virtual-capture-device-plan.md)
will emulate the future STM32 authenticated-capture boundary in a separate process.
It does not change this crate into a service and does not make ordinary `AudioCapture`
implementations implicitly trusted. Authenticated evidence, verifier-owned provenance,
and assurance-aware admission remain unimplemented contract work.

## Structure decisions

| Decision | Selected direction |
| --- | --- |
| Production language | Rust, edition 2024. Keep the existing Python package as evaluation/reference tooling. |
| First native host | The current Apple Silicon macOS development host, `aarch64-apple-darwin`. Target-robot hardware and sensor qualification remain open. |
| First artifact | An embedded native shared library, built as `cdylib`, plus the development CLI. An `rlib` supports Rust composition and tests. Chrome owns each stdio host process. |
| Speech backend | Moonshine 0.1.5, C ABI 30000, Tiny Streaming quantized models, and ONNX Runtime 1.23.2. The host supplies utterance boundaries. |
| Speaker backend | Full-waveform ECAPA ONNX export from the pinned SpeechBrain reference. CPU inference uses ONNX Runtime through `ort`. |
| Browser direction | The prototype uses Chrome native messaging on macOS. The portable engine also compiles for `wasm32-unknown-unknown`; browser model execution remains separate work. |
| Package boundary | One unpublished private crate in `seams-monorepo/voiceId/engine`. Its Chrome host transports opaque perception bindings. Wallet operation construction, authentication, and signing remain in the public Wallet repository. |

Native model paths resolve from the metadata file's directory. The loader verifies
each model and library before inference. The package uses relative asset paths.

The shared library exports the macOS [C API](include/voiceid.h).
Its native C journey links only the compiled library and this header.
The Rust contracts remain separate from C layouts and the public Wallet API.

The real-model journey replaces the earlier link/load probe. Python provisions
assets, exports ECAPA, and prepares reference inputs. The Rust executable loads
verified local libraries and performs all inference without Python. Clean-machine
distribution and live recognition qualification remain open. Package required
native libraries and license notices through the release workflow.

Rust's [`cdylib` output](https://doc.rust-lang.org/reference/linkage.html) supports
the native library boundary. The
[`wasm32-unknown-unknown` target](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)
requires explicit host adapters for operating-system facilities. The native
Moonshine C++ library is excluded from that target; browser model integration
requires separate work and does not follow from compiling the Rust modules.

## Module ownership

| Module | Responsibility | Dependency boundary |
| --- | --- | --- |
| `domain` | Shared capture, utterance, enrollment, observation, and attribution values | No models, device access, application policy, or wallet types. |
| `runtime` | Session lifecycle, bounded work, deadlines, cancellation, and coordination | Uses domain-facing contracts; receives implementations at composition time. |
| `utterance` | Segmentation and association of transcript/voice-stage results | No model loading or command execution. |
| `presence` | Short-lived participant context and continuity invalidation | Consumes observations; no camera access or authorization. |
| `attribution` | Associate observations with the current speaker/utterance | No robot control or wallet signing. |
| `enrollment` | Template modalities, versioned enrollment records, validated replacement requests | Device storage and model extraction stay behind adapters; collection/approval lifecycle follows later. |
| `adapters` | Capture, storage, transcription, speaker, and visual contracts | Native implementations stay under `adapters::native`, excluded on WASM targets. Clock/cancellation contracts live in `runtime`. |
| `consumers` | Robot command interpretation, action policy, controller handoff | Safety belongs to the robot controller; wallet protocol types stay outside the crate. |

The first six modules stay portable. Model-specific values are normalized at
adapter boundaries. Consumers use engine results; perception never depends on
consumer policy. The composition entry point supplies adapters to `AudioRuntime`.
Domain and adapter contracts are exposed through documented Rust
modules. Unsafe code is denied outside narrowly scoped native ABI bindings.
The native module exposes safe Rust constructors and owned handles.

The local plan's [guiding security principles](../docs/voiceId-local-architecture-and-implementation-plan.md#guiding-security-principles)
govern runtime and adapter implementation, including bounded freshness, artifact
verification, and the distinction between capture integrity and human intent.

## Domain and adapter contracts — step 3

- `domain`: distinct capture/enrollment/model/profile identities; epoch-bound,
  half-open time ranges; available/unavailable/failed states; capture profiles
  and clock mappings; owned timestamped audio/video frames. PCM preserves source
  channels. The initial portable video format is contiguous RGB8; acquisition
  adapters own platform-specific conversion.
- `utterance`: session-scoped utterance identity, bounded mono
  model windows, distinct partial/final transcripts, explicit no-speech completion,
  and source-bound calibrated speaker verdicts. Partial text is a replaceable
  full snapshot. Finalizing consumes the decoder; dropping it cancels it.
- `presence`: track identity, capture time, location with uncertainty or explicit
  spatial unavailability, and current/recent/expired/departed/invalidated states.
  Recent context retains its original timestamp and a configured maximum horizon.
- `attribution`: attributed/ambiguous/rejected/insufficient outcomes. Only the
  attributed branch carries identity, supporting gates, profile, and validity.
  It has no public success constructor. The runtime implements audio-only speaker
  attribution. There is no command execution handle or reusable unlocked state.
- `enrollment`: required voice and explicit optional face enrollment, bounded
  model/version-specific template bytes, and same-identity advancing replacement.
  The store contract provides atomic create/compare-and-replace/delete with
  authenticated device binding, explicit conflicts, and uncertain-commit handling.

Traits exist only at substitution boundaries: `AudioCapture`, `VideoCapture`,
`Transcriber`/`TranscriptStream`, `SpeakerMatcher`,
`VisualAnalyzer`, `TemplateStore`, `Clock`, and `Cancellation`. No implementation
returns placeholder identity success. Model verdicts describe calibrated gates;
they do not prove physical liveness or trusted sensor origin.

## Audio runtime lifecycle — step 4

`AudioRuntime` owns one decoder, one bounded mono buffer, and at most one pending
result. `begin` allocates an utterance identity and fixes its deadline. `push`
accepts contiguous 16 kHz mono frames captured after the attempt began. The host
owns capture and speech endpoint detection. The runtime performs no resampling.

`finish` consumes the decoder and assesses the complete captured window against
the current enrollment. It checks transcript and speaker source identities,
model/calibration revisions, text bounds, and work eligibility. Silence yields
an insufficient outcome without calling the speaker matcher. PAD has no runtime
contract, field, bypass flag, or passing placeholder.

`take_result` rechecks the deadline and releases the result once. Evidence expiry
uses the first sample's time plus the configured maximum age, reduced by capture
clock uncertainty. Passing a later work deadline cannot extend an attempt.
Partial snapshots never become finalized results.

Cancellation, enrollment reload/deletion, and close discard pending work.
Capture gaps and clock discontinuities stop the session. `restart` requires a
different capture epoch and preserves increasing utterance sequences. The host
must generate a fresh epoch on every restart. A submission for an older utterance
cannot modify a newer attempt. New model/profile configuration requires a new runtime.

Calls are synchronous. Native adapters must retain inputs until their readers
finish, even after cancellation. The host drives finalization, cancellation,
result consumption, and shutdown. No background scheduler or worker queue exists.
Exported perception results remain subject to their validity and the consumer's
operation checks. They carry no wallet signing authority.

The runtime journey uses generated PCM and deterministic model doubles. It
qualifies orchestration and resource cleanup. It does not qualify real models,
microphone latency, biometric accuracy, protected storage, or wallet integration.

### Ownership, limits, and cancellation

| Boundary | Contract |
| --- | --- |
| Acquisition | Transfer owned, validated frames. Preserve session, per-stream sequence, format, and source time. Discontinuity ends the stream and requires a fresh epoch. |
| Model input | Borrow immutable media/templates for a synchronous call. A worker must retain every input until native readers finish, including after cancellation. No implicit `Send`/`Sync` assumption is imposed on backends. |
| Stage output | Return owned results bound to the input epoch/utterance/interval or camera frame stamp. Adapters normalize native output; runtime checks correlation, continuity, enrollment version, and freshness before consumption. |
| Bounds | Local profiles supply sample/byte/track/text limits and maximum window/presence durations. Constructors enforce per-value limits; adapters/runtime must also enforce cumulative stream, queue, retained-frame, and utterance limits. No production limits are invented here. |
| Cancellation | Every potentially blocking call requires a clock, exclusive deadline, and cancellation view. Check before work, between interruptible chunks, and after completion. Late results are discarded; cancellation never frees memory still read by native code. |
| Persistence | Check cancellation before the atomic commit point. Committed writes return success. Uncertain commit status invalidates in-memory evidence and requires authenticated reload. The coordinator must serialize mutation and evidence invalidation. |

Media, transcripts, and plaintext templates deliberately lack `Debug` and `Clone`.
Borrowed data cannot outlive its owner through these safe Rust contracts. Explicit
backend copies remain possible; their bounded lifetime and cleanup must be tested
when implemented. Dropping a buffer currently releases allocation ownership and
does **not** guarantee memory erasure. The macOS prototype stores ECAPA templates
in the user's encrypted login Keychain. It disables iCloud synchronization.
Its random local device identifier is storage metadata. Wallet-authorized device
binding remains W0 work. The prototype makes no hardware-attestation claim.

### Native C boundary ownership

The macOS [header](include/voiceid.h) defines ABI 1. Call `voiceid_abi_version()`
before opening a session. The API owns model/session/request state behind numeric
handles. The registry accepts four sessions per OS thread. A handle works only
on its creating thread. Closing invalidates all requests owned by that session.
Handle allocation uses a random initial value and never wraps or reuses values
during the library lifetime.

`voiceid_open_v1` verifies model metadata and acquires the enrollment namespace's
exclusive process lease. It opens no microphone. The consumer supplies canonical
mono 16 kHz PCM. The CLI's CoreAudio path and C submissions use the same runtime,
transcriber, speaker matcher, enrollment gates, and protected store.

Begin an attempt before acquiring its first sample. Map source timestamps to
`voiceid_now_v1`'s monotonic epoch. Submit contiguous chunks of at most 1,600 samples,
then finish and take once. Timeout is 250–30,000 ms. The cumulative limit is
160,000 samples. Cancellation, expiry, deletion, close, and discontinuity prevent
result reuse. A stopped capture requires closing and reopening the session.

The host owns every input and output buffer. The boundary checks lengths and
alignment before copying accepted input. The caller must supply valid allocations
for those lengths. A result uses 24 caller-owned bytes. It contains the request
identity, expiry, speaker outcome, and exact command. It exports no transcript,
template, embedding, Rust allocation, or borrowed pointer. Failures clear outputs.
An invalid output pointer cannot consume a pending result.

Deliberate enrollment has one request handle and three non-overlapping captures.
Each capture passes the same speech collector and native embedding gate.
The third consistent capture commits the template. Setup expires after 90 seconds.
Cancellation discards partial setup. Deletion first invalidates pending work.
Empty-namespace cleanup consumes its session and removes only empty device metadata.

All calls are synchronous. Use one dedicated native thread and send cancellation
between work calls. Native calls retain inputs until their readers finish.
The consumer must recheck its own cancellation before using a returned result.
Contained Rust panics clear the current thread's registry and return an error.
Close every session before unloading the library.

These results describe perception. The wallet consumer owns the exact presented
operation, existing authority, and operation-bound approval lifecycle. Native result
delivery alone grants no signing permission. Browser origin/transport integration
remains a separate boundary.

## Checks

Per the repository's Rust-command instructions, run from the sibling
`seams-wallet` directory with the private manifest explicitly selected:

```sh
cargo fmt --manifest-path ../seams-monorepo/voiceId/engine/Cargo.toml -- --check
cargo clippy --offline --locked --manifest-path ../seams-monorepo/voiceId/engine/Cargo.toml --all-targets -- -D warnings
cargo test --offline --locked --manifest-path ../seams-monorepo/voiceId/engine/Cargo.toml
cargo build --offline --locked --manifest-path ../seams-monorepo/voiceId/engine/Cargo.toml --release --target aarch64-apple-darwin
cargo build --offline --locked --manifest-path ../seams-monorepo/voiceId/engine/Cargo.toml --release --target wasm32-unknown-unknown
```

The portable modules have no model dependencies. Native-only dependencies provide
dynamic loading, ONNX inference, JSON boundaries, and SHA-256 artifact checks.
Cargo does not download model assets or ONNX Runtime libraries during a build.
Artifacts remain under this crate's ignored `target/` directory. These commands
do not modify Wallet source or its Cargo lockfiles. The current 12 boundary tests
cover media limits/format, epoch binding, text finality, presence horizon, visual
correlation, template replacement, and work eligibility. Eight compile-fail tests
check invalid state/result construction, premature/reused transcript handling, and media
logging/copying. The runtime journey exercises complete attempts, rejection,
ambiguous/insufficient evidence, cancellation, version changes, malformed/late
outputs, bounded admission, capture loss, restart, and decoder cleanup.

Repeat the journey from `seams-wallet`:

```sh
cargo test --offline --locked --manifest-path ../seams-monorepo/voiceId/engine/Cargo.toml --test runtime_journey -- --nocapture
```

It writes `voiceId/engine/target/runtime-lifecycle.e2e.json`, with named outcomes
and explicit test-double provenance. The report contains no media, embeddings,
or transcripts. The ignored artifact is regenerated by the command.

## Native model journey

Follow the [provisioning and replay procedure](../verifier-spike/README.md#native-rust-model-journey)
to generate private inputs and run `examples/native_models_journey.rs`.
The journey compares canonical transcript hashes, ECAPA embedding direction,
speaker scores, and runtime outcomes with independent Python model calls.
It checks cancellation/restart recovery, old-epoch rejection, and modified-model rejection.

Moonshine receives at most 1,600 source samples per call and updates after each
8,000 source samples. Finalization appends one zero block and aligns the total
to 1,280 samples. This preserves the final source samples in Moonshine's block
ingestion. Model padding does not extend the captured source interval.
The selected profile disables internal VAD. The host owns speech boundaries.
The model identity commits to assets, libraries, and preprocessing settings.
Moonshine's [ingestion loop](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/core/transcriber.cpp#L1286-L1323)
requires complete blocks. Its [stop/drain path](https://github.com/moonshine-ai/moonshine/blob/v0.1.5/core/transcriber.cpp#L698-L858)
retains pending audio for final transcription.

The ECAPA export includes the original filterbank, full-utterance mean normalization,
and embedding network. It accepts one variable-length mono 16 kHz waveform.
The journey requires embedding cosine agreement of at least `0.99999` and a
speaker-score difference of at most `0.001`. The development acceptance threshold
of `0.6` and simple sample-count/RMS gates lack population qualification.

The report separates original recordings from derived boundary prefixes.
Enrollment uses a Python reference mean from three owner enrollment recordings.
Native enrollment collection remains open. Accelerated fixture replay does not
measure live capture latency or establish recognition quality. Overlap detection,
PAD, wallet signing, and protected storage remain outside this journey.

The initial native comparison used 160-sample final padding and implicit Python
updates. Review found two faults in that comparison:

| Candidate cause | Evidence and decision |
| --- | --- |
| Incorrect C structure layout or resource lifetime | Installed ABI sizes/offsets and owned-handle cleanup match the pinned C declarations. No defect found in those paths. |
| Final source samples remain outside a complete model block | The upstream loop consumes only complete 1,280-sample blocks. Finalization now aligns the total after one zero block. |
| Python padding triggers an extra partial decode | Explicit source-sample updates now match Rust. Padding causes no partial update before stop. |
| Random model output | The earlier output differences do not prove randomness. That claim remains unestablished. |

Measured: canonical transcripts agree for all journey cases. Embeddings and
speaker scores agree within the report's declared bounds. The network-denied
executable completes cancellation/restart and model-corruption scenarios.

Inferred: the corrected profile feeds every real source sample to the model.
The ingestion code and block alignment support that conclusion.

Unknown: recognition accuracy, live endpoint behavior, and live latency.
The next local-host checkpoint must measure these with consented microphone
attempts and known spoken commands on the selected Mac.

## macOS local host

`voiceid-host` supplies one explicitly activated local flow. It never opens the
microphone during startup, status, or device inspection. Enrollment and command
checks start capture only after the user presses Enter. Dropping capture stops
the stream. The host stores a voice template after three consistent captures.
It writes no microphone recording or transcript file.

Build from the separate `seams-wallet` directory. Use the selected checkout's
absolute path, including its worktree path when applicable:

```sh
voiceid_repo=/absolute/path/to/selected/seams-monorepo
cargo build --offline --locked --release --bin voiceid-host \
  --manifest-path "$voiceid_repo/voiceId/engine/Cargo.toml"
voiceid_host="$voiceid_repo/voiceId/engine/target/release/voiceid-host"
voiceid_models="$voiceid_repo/voiceId/verifier-spike/.cache/native-models/native-inputs.json"
"$voiceid_host" devices
"$voiceid_host" enroll "$voiceid_models"
"$voiceid_host" check "$voiceid_models"
"$voiceid_host" status
"$voiceid_host" delete
```

Use the [existing provisioning procedure](../verifier-spike/README.md#native-rust-model-journey)
to create model metadata first. The host reads only model paths, hashes, and
speaker settings. It ignores research templates and fixture cases.

For enrollment, read a sentence for three to six seconds after each prompt.
The collector requires two seconds of voiced frames per capture. All three
speaker embeddings must have pairwise similarity of at least `0.6`.
This is a development gate with no population-calibration claim.

For a command check, say **“I approve this operation”** or **“I cancel this operation.”**
The host requires a matched speaker and the exact final phrase. Extra words,
contradictory commands, and unrecognized speech produce no recognized command.
The displayed result performs no wallet action.

CPAL acquires the default microphone format. The adapter accepts float PCM at
16, 44.1, or 48 kHz with up to eight channels. It averages channels, resamples
through Rubato, removes filter delay, and emits 160-sample mono frames at 16 kHz.
The inspected Mac profile is 48 kHz mono float. Acquisition requests its current rate.
The audio callback performs no model inference or Keychain work.

A 640 ms queue bounds capture output. Overflow, device errors, and source-clock
steps above 2 ms invalidate capture. The host brackets CPAL's stream clock with
local monotonic reads before starting acquisition. The 25 ms absolute clock bound
remains an engineering assumption for live qualification.

The collector retains 200 ms of pre-roll and ends after 800 ms of quiet audio.
Its RMS threshold is `0.006`. Command capture requires half a second of voiced
frames. Ten seconds is the maximum collected utterance. These settings require
live evaluation in quiet and noisy rooms.

The Keychain store holds an exclusive application-namespace lease throughout
each host operation. Another VoiceID process receives a conflict while it is held.
This serializes reads, replacement, deletion, capture, and result consumption.
The expected enrollment version also enters the Security query. The login
Keychain API alone does not establish an atomic conditional update.
[Apple's implementation](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_keychain/lib/SecItem.cpp#L5017-L5113)
searches for items before mutating their handles.

Lease files contain no template or device key. They remain under
`~/Library/Application Support/Seams/VoiceID/locks/` so their inodes stay stable.
All VoiceID hosts must use this store boundary. Direct OS administration remains
inside the trusted-device assumption.

### Repeatable host journey

Run from `seams-wallet`, with the variables above:

```sh
cargo build --offline --locked --release --lib --example local_host_journey \
  --manifest-path "$voiceid_repo/voiceId/engine/Cargo.toml"
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  "$voiceid_repo/voiceId/engine/target/release/examples/local_host_journey" \
  "$voiceid_models" "$voiceid_repo/voiceId/engine/target/local-host.e2e.json"
```

The journey uses macOS `say` voices and `ffmpeg` to create known synthetic speech.
It runs the production normalizer, collector, real models, and a disposable
Keychain namespace. A child process checks exclusive namespace admission.
The journey checks enrollment consistency, approve/cancel recognition, extra-word
rejection, a different speaker, single result consumption, advancing/stale versions,
cancelled/expired mutations, deletion, capture gaps, and callback bounds.
It removes its Keychain items and preserves completed cases when a later step fails.

The same command compiles a C11 caller with strict compiler warnings, links the
release library, and replays the synthetic media with real elapsed time.
Its ten named scenarios cover C layout, bounds, thread/namespace ownership,
enrollment, cancellation, approve/cancel recognition, speaker/extra-word rejection,
expiry, single consumption, capture gaps, close/reopen, and deletion.
The combined report records library/header hashes and the C caller's outcomes.

The [dated host report](../verifier-spike/reports/local-host-2026-10-23.json)
contains outcomes, model identities, and synthetic PCM hashes. It contains no
media, embeddings, or transcript text. Synthetic replay does not establish live
microphone timing, human recognition accuracy, or spoof resistance.

The imperative phrase “approve this operation” produced “approved this operation”
in both native replay and an unchanged Python control on full source audio.
The first-person phrase matched in the reference control and native journey.
This supports the selected phrase. It does not establish a population accuracy rate.

## Next checkpoint

The runtime, native models, local host flows, and C boundary are implemented.
Next, complete a deliberate live user journey and measure capture timing, endpoint
behavior, and command recognition. Wallet W0 must select the native-consumer bridge
before W1 gates signing under existing device/session authority.

Keep unimplemented capabilities unavailable. Test doubles stay inside the
integration test; no production adapter returns placeholder identity success.

The [local architecture plan](../docs/voiceId-local-architecture-and-implementation-plan.md)
owns the implementation sequence. The
[macOS virtual capture-device plan](../docs/voiceId-macos-virtual-capture-device-plan.md)
owns authenticated capture emulation and the later STM32 substitution boundary. The
[wallet extension plan](../docs/voiceId-mpc-wallet-extension-plan.md) owns the
separate public contract and private provider.
