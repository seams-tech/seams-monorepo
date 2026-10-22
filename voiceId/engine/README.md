# Private VoiceID engine

Audio runtime checkpoint as of 2026-10-22. The portable engine coordinates one
bounded utterance through injected transcription and speaker adapters. It checks
continuity, deadlines, output correlation, enrollment changes, and result consumption.
There is no concrete model/capture/storage adapter, enrollment collection,
robot action, wallet integration, or callable C host API yet.

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
| Speech backend | Moonshine's native C API behind an adapter, starting with the existing 0.0.71 evaluation artifact. Native dependencies include its matching ONNX Runtime library. |
| Browser direction | Compile the portable engine for `wasm32-unknown-unknown`. Browser capture, storage, model execution, and host bindings are separately qualified adapters. |
| Package boundary | One unpublished private crate in `seams-monorepo/voiceId/engine`; the public wallet extension and private wallet provider remain outside this crate. |

The shared-library artifact currently has no VoiceID entry points. Its successful
build establishes packaging structure only. The Rust contracts are available to
private composition/tests; they are neither C ABI layouts nor a public Wallet API.

The Rust link/load probe in
[`../verifier-spike/moonshine_link_probe.rs`](../verifier-spike/moonshine_link_probe.rs)
passed against the installed arm64 Moonshine library on 2026-09-15, reporting
C ABI version `20000`. It executes independently of Python. The library directory
from the Python installation was used only as an already provisioned source of
native binaries. No runtime dependency on the Python interpreter was added.

That probe establishes native linking and loading. It does not establish Rust
streaming inference, Tiny Streaming accuracy/latency, clean-machine distribution,
or robot performance. Implement and qualify the real adapter later, then package
the required native libraries and license notices through the chosen release
workflow. Avoid embedding developer-machine paths in production artifacts.

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
modules; native bindings and consumer implementation stay private. Unsafe code
is denied; any future FFI exception must be narrowly scoped and reviewed in the
native adapter or host binding.

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

The manifest has no dependencies on Wallet, Python, Moonshine, or model assets.
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

To repeat the optional native link/load probe from that same directory, set the
native library directory to an explicitly provisioned Moonshine 0.0.71 artifact:

```sh
voiceid_moonshine_lib_dir=/absolute/path/to/provisioned/moonshine
voiceid_probe_dir=$(mktemp -d /tmp/voiceid-native-link.XXXXXX)
rustc --edition=2024 ../seams-monorepo/voiceId/verifier-spike/moonshine_link_probe.rs \
  -L "native=$voiceid_moonshine_lib_dir" \
  -C "link-arg=-Wl,-rpath,$voiceid_moonshine_lib_dir" \
  -o "$voiceid_probe_dir/moonshine-link-probe"
"$voiceid_probe_dir/moonshine-link-probe"
```

This macOS development probe requires `libmoonshine.dylib` and its matching
`libonnxruntime.1.23.2.dylib`. It remains outside the dependency-free scaffold.

## Next checkpoint

Step 4's audio runtime and lifecycle journey are implemented. Next, stream real
fixture PCM through a native Rust Moonshine adapter and qualify a native speaker
backend against the retained Python reference. Then add live capture, protected
enrollment, the C host binding, and wallet W0-W1 composition.

Keep unimplemented capabilities unavailable. Test doubles stay inside the
integration test; no production adapter returns placeholder identity success.

The [local architecture plan](../docs/voiceId-local-architecture-and-implementation-plan.md)
owns the implementation sequence. The
[macOS virtual capture-device plan](../docs/voiceId-macos-virtual-capture-device-plan.md)
owns authenticated capture emulation and the later STM32 substitution boundary. The
[wallet extension plan](../docs/voiceId-mpc-wallet-extension-plan.md) owns the
separate public contract and private provider.
