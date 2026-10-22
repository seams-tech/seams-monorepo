# VoiceID

VoiceID is being rebuilt as a local, continuous identity and command-attribution
runtime. It will combine current speech with recent visual and spatial context
when available. Raw media, biometric templates, and inference stay on the local
device. ZK and hosted biometric verification are outside the selected design.

The proprietary engine and wallet provider will be developed here and shipped
as versioned compiled artifacts: native first, with WASM as a separately
qualified target. The optional public provider contract and wallet extension
belong in `seams-wallet`; its SDK can integrate VoiceID without private source.
The retained Python package is the evaluation baseline.

The former browser recording, upload service, HTTP verifier, hosted deployment,
and E0 evidence lifecycle were removed on 2026-09-14. Git history retains that
implementation. The reusable audio model adapters, enrollment aggregation,
evaluation tools, research material, and private local fixtures remain.

## Plans

- [Local architecture and implementation](docs/voiceId-local-architecture-and-implementation-plan.md)
- [MPC wallet extension](docs/voiceId-mpc-wallet-extension-plan.md)
- [Legacy removal record](docs/voiceId-legacy-removal-plan.md)
- [Architecture discussion history](docs/voiceId-architecture-discussion-2026-09-13.md)

The [private Rust engine](engine/README.md) now includes validated domain types,
adapter contracts, and a bounded audio runtime with a repeatable lifecycle journey.
Its first target is an embedded native shared library on Apple Silicon macOS.
Native Moonshine Tiny and ECAPA adapters process real local fixture PCM.
A macOS development host adds microphone acquisition, deliberate three-capture
enrollment, local Keychain storage, deletion, and exact spoken-command checks.
The macOS shared library exports ABI 1 for native consumers. A compiled C caller
verifies its lifecycle. The [browser prototype](browser/README.md) now connects
the wallet-owned review gate to the native engine through Chrome native messaging.
The real-model browser journey reaches the existing signing boundary.
Live microphone qualification and a funded testnet transaction remain open.
Engine results carry no robot or signing authority.

The first MVP assumes a user-controlled, authorized device. It checks the enrolled
speaker and explicit approval for one pending wallet operation under existing
authority. Spoof detection, visual confirmation, and authenticated capture are deferred.

## Private engine

`engine/` is one unpublished Rust package with modules for domain values, runtime
coordination, utterances, presence, attribution, enrollment, adapters, and robot
consumers. Native adapter code has its own target-specific module. The Chrome
host transports opaque perception bindings. Wallet operation construction,
authentication, and signing remain in the public Wallet repository.

The portable engine compiles for native and WASM targets. Native model adapters
use explicitly provisioned Moonshine and ONNX Runtime libraries with verified
model files. Inference runs without Python or network access. See
[engine checks and decisions](engine/README.md) for builds and the real-model journey.

## Retained source

`verifier/voiceid_verifier/` contains the local audio components retained for
adaptation:

- bounded offline audio decoding and quality/window analysis;
- SpeechBrain ECAPA speaker embeddings and cosine scoring;
- quality-weighted enrollment-template aggregation;
- the pinned AASIST research PAD adapter;
- incremental Moonshine transcription with bounded chunks, partial snapshots,
  finalization, cancellation, and offline phrase/intent evaluation;
- bounded stage execution used by resilience evaluation.

The file decoder converts imported media to mono 16 kHz PCM for offline evaluation.
The macOS wallet prototype also uses a mono path. Microphone-array spatial
processing remains a separate robot capability. That future path must preserve
channels until spatial processing finishes.

`verifier-spike/` contains consent/provenance, corpus, model-manifest,
calibration, benchmark, fuzz, and resilience tooling. Dated reports remain
historical measurements tied to their original hardware and datasets.

`fixtures/` contains Git-ignored biometric media. Do not commit or upload it.
See [the fixture guide](fixtures/README.md).

## Development checks

Run from the repository root:

```sh
PYTHONPATH=voiceId/verifier python3 -m unittest discover \
  -s voiceId/verifier -p 'test_*.py'

PYTHONPATH=voiceId/verifier:voiceId/verifier-spike python3 -m unittest discover \
  -s voiceId/verifier-spike -p 'test_*.py'

python3 voiceId/verifier-spike/compare_models.py \
  --manifest voiceId/fixtures/voiceid-fixture-manifest.json \
  --check-media
```

Heavy model benchmarks require their optional dependencies and locally
provisioned, checksum-verified model assets. Inference must not silently download
a model or use a remote fallback.

Use the [macOS local host](engine/README.md#macos-local-host) for deliberate enrollment
and voice checks. The next step is live enrollment and one reviewed NEAR testnet
transfer through the browser prototype. Native fixture replay, synthetic host
composition, a compiled C caller, and the native/browser bridge have repeatable
reports. Live recognition quality and resource budgets remain open.
L0 owns the MVP
microphone profile and measured resource/error budgets. L1 coordinates the minimal
public provider contract with wallet W0. Wallet W1 still needs the funded testnet
exercise and live capture qualification.
