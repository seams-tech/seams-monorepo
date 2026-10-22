# Private VoiceID engine

Native model checkpoint as of 2026-10-22. The portable engine coordinates one
bounded utterance through transcription and speaker adapters. It checks
continuity, deadlines, output correlation, enrollment changes, and result consumption.
Native Moonshine Tiny and ECAPA adapters process local fixture PCM.
Capture/storage adapters, enrollment collection, robot actions, wallet integration,
and a callable C host API remain unimplemented.

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
| First artifact | An embedded native shared library, built as `cdylib`. Step 3 defines host ownership below; concrete C layouts/exports follow the runtime shell. An `rlib` supports Rust composition and tests. No daemon or IPC service is introduced. |
| Speech backend | Moonshine 0.1.5, C ABI 30000, Tiny Streaming quantized models, and ONNX Runtime 1.23.2. The host supplies utterance boundaries. |
| Speaker backend | Full-waveform ECAPA ONNX export from the pinned SpeechBrain reference. CPU inference uses ONNX Runtime through `ort`. |
| Browser direction | Compile the portable engine for `wasm32-unknown-unknown`. Browser capture, storage, model execution, and host bindings are separately qualified adapters. |
| Package boundary | One unpublished private crate in `seams-monorepo/voiceId/engine`; the public wallet extension and private wallet provider remain outside this crate. |

The shared-library artifact currently has no VoiceID entry points. Its successful
build establishes packaging structure only. The Rust contracts are available to
private composition/tests; they are neither C ABI layouts nor a public Wallet API.

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
does **not** guarantee memory erasure. Protected persistence is a contract only;
no encryption backend or device key implementation exists yet.

### Native host boundary ownership

The future C binding owns an opaque engine/session handle and bounded request/result
handles. Its minimum responsibilities are session creation/closure, local capture
submission, polling owned results, cancellation, and explicit local enrollment
operations. Native capture adapters and host-supplied media enter the same validated
capture boundary; there is no second perception path.

Host input pointers are borrowed only during a submission call. The binding checks
lengths before allocation and copies accepted input into engine-owned buffers before
returning. Output memory remains engine-owned until an explicit release call; a host
may copy permitted output before release. Rust `Vec`, `String`, trait objects, and
enum layouts never cross C directly. Handles are scoped to one engine instance;
destroying it invalidates them and drains native readers before releasing buffers.

These are ownership/API responsibilities, with **no exported functions or fixed wire
layout in this checkpoint**. Concrete C declarations, enum tags, handle validation,
and panic/error translation follow the runtime shell so the binding exposes real
lifecycle operations. Browser bindings are separately implemented against the same
portable values. Wallet requests and wallet secrets stay outside both boundaries.

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

## Next checkpoint

The audio runtime and native reference-agreement journeys are implemented.
Next, add live capture, speech endpoint detection, native enrollment collection,
protected template storage, and the C host binding. Then complete wallet W0-W1 composition.

Keep unimplemented capabilities unavailable. Test doubles stay inside the
integration test; no production adapter returns placeholder identity success.

The [local architecture plan](../docs/voiceId-local-architecture-and-implementation-plan.md)
owns the implementation sequence. The
[macOS virtual capture-device plan](../docs/voiceId-macos-virtual-capture-device-plan.md)
owns authenticated capture emulation and the later STM32 substitution boundary. The
[wallet extension plan](../docs/voiceId-mpc-wallet-extension-plan.md) owns the
separate public contract and private provider.
