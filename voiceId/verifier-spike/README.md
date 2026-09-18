# VoiceID Verifier Spike

Use this folder for offline model, corpus, calibration, fuzz, and resilience
evaluation. The former browser and HTTP verifier application has been removed.
Existing browser-recorded fixtures remain historical research inputs.

## Fixture Import

Capture fixtures in the browser demo, download the manifest and audio files,
then place them in the same directory. Validate the bundle before running model
comparisons:

```sh
python3 voiceId/verifier-spike/compare_models.py \
  --manifest voiceId/fixtures/voiceid-fixture-manifest.json
```

Use `--json` when a later model-comparison script needs a machine-readable
inventory.

Use `--report-template` to print the Markdown model-selection report scaffold
for the validated fixture set.

Run the local dependency-light spectral baseline before installing heavier model
packages:

```sh
python3 -m pip install -e voiceId/verifier-spike
python3 voiceId/verifier-spike/evaluate_spectral_baseline.py \
  --manifest voiceId/fixtures/voiceid-fixture-manifest.json \
  --check-media
```

The baseline decodes audio with `ffmpeg`, extracts MFCC/log-mel-style summary
embeddings with `numpy`, and scores each fixture against the owner enrollment
template with cosine similarity. It is a fixture and threshold sanity check, not
the production verifier model.

The recommended first pretrained model is SpeechBrain ECAPA-TDNN:

```sh
python3 -m pip install "speechbrain>=1.0.0" "torchaudio==2.6.*"
python3 voiceId/verifier-spike/evaluate_speechbrain_ecapa.py \
  --manifest voiceId/fixtures/voiceid-fixture-manifest.json \
  --check-media
```

Use `speechbrain/spkrec-ecapa-voxceleb` first because it has a simple embedding
API, is trained for speaker verification on VoxCeleb, and is lighter to wire
than pyannote or NeMo for this MVP spike.

The first ECAPA report is in `reports/speechbrain-ecapa-2026-06-11.md`.
Compare x-vector, pyannote, or NeMo only if ECAPA calibration, licensing, or
deployment constraints need another option.

The retained Python ECAPA adapter accepts decoded PCM for local and offline use.
The removed HTTP request protocol is not a supported runtime boundary.

Fixture manifest fields:

- `schemaVersion`
- `createdAt`
- `fixtureId`
- `audioFileName`
- `speakerLabel`
- `phraseLabel`
- `expectedRelation`
- `captureDevice`
- `durationMs`
- `environmentNotes`
- `capturedAt`
- `byteLength`
- `mimeType`

The loader rejects malformed manifests, duplicate fixture ids, duplicate audio
file names, path-like audio file names, missing audio files, and byte-length
mismatches.

## Reproducible Benchmark Boundary

The browser fixture bundle is an input-collection aid. Gate C experiments use
the stricter `voice_id_benchmark_manifest_v2` boundary from `benchmark.py`. It
requires immutable media hashes, an explicit provenance union for synthetic
generations or consented human captures, subject and session ids,
subject-disjoint partitions, case-specific metadata, expected intent,
challenge tokens, and complete capture profiles. Synthetic cohorts are reported
as fictional identities or owner-conditioned clones. Human FAR, FRR, and EER
stay suppressed until the evaluation partition contains a qualifying human
cohort.

```sh
PYTHONPATH=voiceId/verifier:voiceId/verifier-spike python3 -m unittest discover \
  -s voiceId/verifier-spike -p 'test_*.py'
python3 voiceId/verifier-spike/benchmark.py \
  --manifest voiceId/fixtures/voiceid-benchmark-manifest.json \
  --json-out voiceId/verifier-spike/reports/benchmark-inventory.json \
  --report-out voiceId/verifier-spike/reports/benchmark-inventory.md
```

`benchmark.py` writes paired JSON and Markdown inventory reports. It fails
measurement readiness until development, calibration, and evaluation data cover
every required case and presentation-attack class.

## Local model baselines

The approved local baseline manifest is
`voiceId/verifier-spike/model-manifest.json`. It records source revisions,
licenses, file sizes, per-file SHA-256 digests, and a canonical tree digest for
the Moonshine Tiny/Small F32 models, the native quantized Moonshine streaming
models, the closed-set intent model, SpeechBrain ECAPA, and the pinned upstream
AASIST source/config/checkpoint. Rebuild or verify
it against a model root with:

```sh
python3 voiceId/verifier-spike/model_manifest.py \
  --root /path/to/voiceid-models \
  --verify voiceId/verifier-spike/model-manifest.json
```

The native `moonshine-voice` runtime consumes the downloaded quantized
streaming directories. The Hugging Face F32 directories remain pinned and
verified in the manifest for a separate Transformers/ONNX comparison; passing
an F32 directory to the native runtime is rejected because its file format is
different.

The retained Moonshine adapter can use canonical mono 16 kHz float PCM. Set
`VOICEID_MOONSHINE_MODEL_PATH`,
`VOICEID_MOONSHINE_INTENT_MODEL_PATH`, and
`VOICEID_MOONSHINE_MODEL_ARCH=tiny_streaming` (benchmark Small only after Tiny
latency is measured). `MoonshineRecognizer.start_stream()` now opens a native
Moonshine stream. Feed canonical PCM with `add_audio()` as it arrives, then call
`finish()` to stop the stream and drain its final transcript. Each `add_audio()`
returns a partial snapshot; revisions replace the matching line instead of
appending duplicate text. Partial snapshots carry no phrase/intent decision.

The adapter accepts chunks of at most 1,600 mono 16 kHz samples (100 ms), requests
native updates every 500 ms of input audio, and caps one utterance at 30 seconds.
Shorter chunks are supported. These are bounded adapter defaults for evaluation;
target-device latency and resource qualification remain open.

Use the stream as a context manager or call `close()` on cancellation or a capture
discontinuity. Finishing, cancelling, or failing closes the stream and decoder;
subsequent calls cannot reuse that utterance. The existing cross-request isolation
invariant is preserved by allocating a fresh decoder per utterance. The decoder
stays open across that utterance's chunks. Decoder load time remains part of the
latency budget until reuse is independently qualified.

`analyze()` is the offline fixture entry point. It feeds bounded chunks through
the same incremental path, then evaluates the final transcript's phrase/intent.
There is no batch-transcription fallback. Fixture playback does not establish
real-time microphone latency. Python-owned input copies are zeroed after their
synchronous native call; upstream/native internal copies have separate lifetimes.
No microphone acquisition, sensor-clock integration, or production native/WASM
release is implemented by this adapter change.

## Synthetic corpus generation and freeze

`dia2-corpus-plan.json` and `elevenlabs-corpus-plan.json` are the concrete
subject-disjoint generation inputs. They include stable designed identities,
semantic approve/reject/cancel/repeat/unrelated cases, challenge errors,
generic synthesis, and owner-authorized conditioned attacks. Run them only in
the offline fixture pipeline:

```sh
python3 voiceId/verifier-spike/dia2_batch.py --help
python3 voiceId/verifier-spike/elevenlabs_batch.py --help
python3 voiceId/verifier-spike/import_consented_capture.py --help
python3 voiceId/verifier-spike/freeze_corpus.py --help
```

The Dia2 runner requires a durable state file and checkpoints each generated
fixture before moving to the next one. A rerun verifies completed WAV hashes
and resumes only from the next ordered job; an uncheckpointed final or pending
WAV stops the campaign for manual reconciliation:

```sh
python3 voiceId/verifier-spike/dia2_batch.py \
  --plan voiceId/verifier-spike/dia2-corpus-plan.json \
  --source-root /private/path/to/dia2 \
  --model-dir /private/path/to/Dia2-1B \
  --mimi-dir /private/path/to/mimi \
  --asset-dir /private/path/to/consented-assets \
  --output-dir /private/path/to/dia2-audio \
  --state /private/path/to/dia2-state.json \
  --manifest-out /private/path/to/dia2-manifest.json \
  --report-out /private/path/to/dia2-report.json
```

The ElevenLabs batch requires a durable `--state` file. A persistent campaign
binding prevents another state or plan from using the same output directory.
State writes are atomic and fsynced; generated audio uses a recoverable
pending-WAV protocol and a no-clobber final install. A rerun verifies every
completed artifact before skipping it:

```sh
python3 voiceId/verifier-spike/elevenlabs_batch.py \
  --plan voiceId/verifier-spike/elevenlabs-corpus-plan.json \
  --asset-dir /private/path/to/consented-assets \
  --output-dir /private/path/to/elevenlabs-audio \
  --state /private/path/to/elevenlabs-state.json \
  --manifest-out /private/path/to/elevenlabs-manifest.json \
  --report-out /private/path/to/elevenlabs-report.json
```

An ambiguous remote operation, such as a lost POST response, is recorded and
blocks automatic retry. Preserve the state and supporting account evidence; do
not delete or replace it. This runner has no audited adopt/abort operation for
a confirmed remote success or failure. The campaign therefore remains blocked
until such a recovery action is implemented. Starting another campaign can
duplicate paid work and requires an explicit operator decision.

The batch records resolved voice ids plus request/output hashes and emits
canonical 16 kHz WAV. The API key stays in the ignored root `.env.local`; the
runner reads `ELEVENLABS_API_KEY` from the process environment first and then
falls back to that file. Plans, state, and reports contain no API key.

The consented-capture importer copies a canonical owner WAV immutably and emits
one `consented_human_capture` manifest fragment. Corpus freezing validates each
fragment, copies audio with a second hash check, sorts partitions
deterministically, and emits a corpus tree digest.

For each of the three owner sessions, convert the recording to canonical mono
PCM16 at 16 kHz, then import it as a separate session and partition. Keep the
consent reference in the local manifest metadata; raw audio remains in the
private research corpus directory:

```sh
ffmpeg -i /private/path/session-1.m4a -ac 1 -ar 16000 -c:a pcm_s16le \
  /private/path/owner-corpus/session-1.wav

python3 voiceId/verifier-spike/import_consented_capture.py \
  --source-audio /private/path/owner-corpus/session-1.wav \
  --output-dir /private/path/owner-corpus/session-1 \
  --manifest-out /private/path/owner-corpus/session-1/manifest.json \
  --dataset-version voiceid-mvp1-v1 \
  --created-at 2026-07-31T00:00:00Z \
  --captured-at 2026-07-31T00:00:00Z \
  --fixture-id owner-session-1 \
  --audio-file-name owner-session-1.wav \
  --subject-id owner-1 \
  --session-id owner-session-1 \
  --partition development \
  --consent-reference owner-consent-2026-07-31 \
  --retention-class project-lifetime \
  --platform browser \
  --microphone macbook-pro-built-in \
  --room office \
  --distance-cm 60 \
  --language en \
  --accent en-jp \
  --noise-profile quiet
```

Repeat with unique session ids and capture dates for calibration and
evaluation. The importer rejects non-canonical audio and refuses to overwrite
an existing audio or manifest artifact. The owner sessions must contain the
same four guided prompts used by the enrollment ceremony; the stability input
is produced after the verifier has extracted its windows and embeddings.

The current Dia2 and ElevenLabs plans cover synthesis attacks. The dependency-free
augmentation runner adds deterministic replay, codec, noise, and room-response
variants from a validated source manifest. Each output is a canonical WAV with a
SHA-256 binding back to its source fixture in the transform report:

The pinned Dia2 1B path has one verified CUDA qualification run recorded in
`reports/dia2-one-job-2026-07-31.md`. That report is a generator and provenance
smoke result; it does not make the complete corpus measurement-ready.

```sh
python3 voiceId/verifier-spike/augment_corpus.py \
  --manifest /path/to/source-manifest.json \
  --output-dir /path/to/transformed-audio \
  --manifest-out /path/to/transformed-audio/manifest.json \
  --report-out /path/to/transforms-report.json \
  --created-at 2026-07-31T00:00:00Z \
  --seed 1
```

These variants are deterministic fixture coverage for the MVP attack classes;
their reports remain labeled synthetic or transformed. Dedicated
voice-conversion, splice, relay, and broader digital-injection campaigns are
deferred from this plan.

Run measurements and calibration from the frozen manifest:

```sh
python3 voiceId/verifier-spike/benchmark_moonshine.py --help
python3 voiceId/verifier-spike/calibrate_moonshine.py --help
python3 voiceId/verifier-spike/benchmark_ecapa.py --help
python3 voiceId/verifier-spike/benchmark_aasist.py --help
python3 voiceId/verifier-spike/benchmark_suite.py --help
```

The Moonshine report compares exact matching with the hybrid
all-fresh-tokens/any-order policy and preserves top/runner-up intent scores.
Calibration selects threshold and winning margin on the calibration partition,
then chooses Tiny or Small using held-out accuracy and runtime budgets. ECAPA
reports FAR, FRR, EER, confidence intervals, latency, and clone-attack
acceptance separately. AASIST calibrates independent reject/uncertain/accept
regions and reports APCER/BPCER by attack class and capture profile.

`benchmark_suite.py` runs all three adapters from one validated corpus invocation
and writes paired JSON and Markdown outputs. It binds the corpus and local
model manifests by SHA-256 and embeds the complete component reports. Run
`python3 voiceId/verifier-spike/benchmark_suite.py --help` for the required model paths and
output arguments.

After the suite and release-budget checker pass, freeze one calibration record
that binds the intent, speaker, PAD, capture-profile, and retry decisions to
the exact corpus and model manifests:

```sh
python3 voiceId/verifier-spike/freeze_calibration.py \
  --corpus-manifest /path/to/frozen/voiceid-benchmark-manifest.json \
  --suite /path/to/benchmark-suite.json \
  --budgets /path/to/frozen-budgets.json \
  --budget-check /path/to/budget-check.json \
  --model-manifest /path/to/model-manifest.json \
  --created-at 2026-07-31T00:00:00Z \
  --output /path/to/calibration-record.json
```

The command fails closed unless inventory readiness and the release-budget
check are both true. It does not turn synthetic results into human population
claims.

Once the three owner sessions are processed by the verifier, measure their
cross-day template stability with the offline stability boundary:

```sh
PYTHONPATH=voiceId/verifier python3 voiceId/verifier-spike/enrollment_stability.py \
  --input /path/to/owner-enrollment-stability-input.json \
  --output /path/to/enrollment-stability-report.json
```

The input contains only the research-side session/window measurements and
embeddings; the report records the input hash, leave-one-out stability,
cross-session similarity, usable-speech gates, and shortest reliable duration.
It also requires complete four-prompt coverage before a session is marked
reliable and carries the one-quality-retry policy into the requirements.
It does not expose these measurements through the production API.

Check candidate adapters for repeated-input, cross-input, and
failure-recovery stability with:

```sh
PYTHONPATH=voiceId/verifier python3 voiceId/verifier-spike/check_adapter_stability.py --help
```

The pinned Apple Silicon run is recorded in
[`reports/candidate-adapter-stability-2026-07-27.md`](reports/candidate-adapter-stability-2026-07-27.md).
Moonshine, ECAPA, and AASIST passed A-A-A, A-B-A, and post-inference A-FAIL-A.
The harness rejects empty Moonshine transcripts, malformed ECAPA embeddings,
unavailable AASIST decisions, indistinguishable A/B outputs, mutable model-tree
symlinks, and numeric tolerances above `1e-5`. This establishes deterministic
adapter behavior for those probes; it does not establish biometric accuracy or
PAD calibration.

Run the seeded malformed-media campaign separately from model benchmarks:

```sh
PYTHONPATH=voiceId/verifier python3 voiceId/verifier-spike/fuzz_media.py \
  --cases 64 \
  --seed 20260726 \
  --output /tmp/voiceid-media-fuzz.json
```

The campaign records only input hashes, sizes, outcomes, and latency. Expected
decoder rejections pass. Unexpected exceptions, duration-limit violations, or
p99 latency beyond the supplied budget fail the command.

After calibration freezes a dataset-specific budget file, enforce it against
the combined suite:

```sh
python3 voiceId/verifier-spike/check_benchmark_budgets.py \
  --suite /path/to/benchmark-suite.json \
  --budgets /path/to/frozen-budgets.json \
  --output /tmp/voiceid-budget-check.json
```

The strict budget boundary binds the dataset and model-manifest digest, then
checks phrase accuracy, FAR/FRR/EER-derived speaker accuracy, APCER/BPCER,
uncertainty or retry rates, p95/p99 latency, memory, corpus readiness, and PAD
attack-class readiness.

## Model Comparison

After fixture validation, the report template records candidate model ids,
preprocessing requirements, embedding dimension notes, threshold policy, same-user
score distribution, different-user score distribution, false accepts, false
rejects, and expected CPU latency.

The first baseline report is in `reports/spectral-baseline-2026-06-10.md`.
