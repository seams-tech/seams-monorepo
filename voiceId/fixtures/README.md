# VoiceID fixtures

This directory contains local research fixture bundles. Raw voice clips are
biometric data, so `.gitignore` excludes captured artifacts by default. The
legacy browser capture UI has been removed; new captures must use an explicit,
consented offline research procedure until the native capture flow is implemented.

Do not commit, upload, or log the media. Keep the manifest with the files and
preserve any consent and provenance records in their approved private location.

## Validate the current bundle

Run from the repository root:

```sh
python3 voiceId/verifier-spike/compare_models.py \
  --manifest voiceId/fixtures/voiceid-fixture-manifest.json

python3 voiceId/verifier-spike/compare_models.py \
  --manifest voiceId/fixtures/voiceid-fixture-manifest.json \
  --check-media
```

Add `--json` for machine-readable inventory or `--report-template` for the
model-comparison report scaffold. Media validation requires `ffprobe`.

The loader rejects malformed manifests, duplicate fixture IDs, duplicate or
path-like audio names, missing media, and byte-length mismatches.

## Reproducible benchmark corpus

The stricter `voice_id_benchmark_manifest_v2` boundary is defined by
`verifier-spike/benchmark.py`. It binds each case to immutable media hashes,
consented-human or synthetic provenance, subject and session identities,
subject-disjoint partitions, expected behavior, and a complete capture profile.
Synthetic cohorts cannot establish human population FAR, FRR, or EER.

Run the evaluation-tool contracts with:

```sh
PYTHONPATH=voiceId/verifier:voiceId/verifier-spike python3 -m unittest discover \
  -s voiceId/verifier-spike -p 'test_*.py'
```

See [the evaluation guide](../verifier-spike/README.md) for corpus generation,
freeze, calibration, model benchmarks, PAD evaluation, fuzzing, and resilience
commands.

## Retention

Keep fixture bundles local unless every recorded person explicitly agreed to
the intended sharing. Raw media remains local or in a separately approved,
encrypted research store. Delete stale captures through an explicit research
retention decision; do not couple deletion to source-code cleanup.
