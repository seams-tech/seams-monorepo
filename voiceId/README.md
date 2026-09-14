# VoiceID

VoiceID is being rebuilt as a local, continuous identity and command-attribution
runtime. It will combine current speech with recent visual and spatial context
when available. Raw media, biometric templates, and inference stay on the local
device. ZK and hosted biometric verification are outside the selected design.

The former browser recording, upload service, HTTP verifier, hosted deployment,
and E0 evidence lifecycle were removed on 2026-09-14. Git history retains that
implementation. The reusable audio model adapters, enrollment aggregation,
evaluation tools, research material, and private local fixtures remain.

## Plans

- [Local architecture and implementation](docs/voiceId-local-architecture-and-implementation-plan.md)
- [MPC wallet extension](docs/voiceId-mpc-wallet-extension-plan.md)
- [Legacy removal record](docs/voiceId-legacy-removal-plan.md)
- [Architecture discussion history](docs/voiceId-architecture-discussion-2026-09-13.md)

The replacement native runtime and wallet integration are not implemented yet.
The retained code is an evaluation baseline and does not authorize robot actions
or wallet signing.

## Retained source

`verifier/voiceid_verifier/` contains the local audio components retained for
adaptation:

- bounded offline audio decoding and quality/window analysis;
- SpeechBrain ECAPA speaker embeddings and cosine scoring;
- quality-weighted enrollment-template aggregation;
- the pinned AASIST research PAD adapter;
- Moonshine model-loading and speech-analysis experience;
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

The next implementation step is L0 in the local plan: select the actual native
device, microphone/camera interfaces, robot pose/playback signals, command
allowlist, and measurable resource/error budgets.
