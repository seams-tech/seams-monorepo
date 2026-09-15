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

The [private Rust engine scaffold](engine/README.md) now defines module ownership,
validated domain types, and adapter contracts with focused tests. Its first target
is an embedded native shared library on Apple Silicon
macOS, with Moonshine behind a C-ABI adapter and the portable core checked for
WASM. Runtime behavior, model integration, and the wallet extension remain
unimplemented. Nothing in this checkpoint authorizes robot actions or signing.

## Private engine

`engine/` is one unpublished Rust package with modules for domain values, runtime
coordination, utterances, presence, attribution, enrollment, adapters, and robot
consumers. Native adapter code has its own target-specific module. The public
wallet contract and private wallet provider will stay outside this crate.

The scaffold has no external dependencies, callable host API, or placeholder
verification behavior. See [engine checks and decisions](engine/README.md) for
native/WASM builds and the standalone Rust-to-Moonshine link/load probe.

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

The current file decoder converts imported media to mono 16 kHz PCM. It is for
fixtures and offline evaluation. The new live capture path must preserve
microphone-array channels until spatial processing finishes.

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

The next architecture step is the runtime shell and lifecycle tests. Domain and
adapter contracts now exist; native host ownership is specified, while concrete
C declarations/exports follow the runtime. L0 still owns the actual robot/sensor profile, permitted
actions, and measurable resource/error budgets. L1 coordinates the minimal public
provider contract with wallet W0; those wallet changes are a separate checkpoint.
