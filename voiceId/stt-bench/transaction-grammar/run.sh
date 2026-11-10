#!/bin/sh
# Refactor 210 Gate STT-1: Aurora and Citrinet INT8 on the spoken-intent
# transaction grammar, synthetic speech only.
#
# Usage, from voiceId/stt-bench:
#   transaction-grammar/run.sh <work-dir> <report-name>
# <work-dir> holds the build, audio and per-case files; keep it outside the
# repository. The report lands in reports/<report-name>.json.
set -eu
work=$1
name=$2
assets=../../../seams-wallet/packages/voiceid/assets
text="cargo run --release --offline --quiet --manifest-path transaction-grammar/grammar/Cargo.toml --target-dir $work/target --"
infer="cargo run --release --offline --quiet --manifest-path transaction-grammar/infer/Cargo.toml --target-dir $work/target --"

$text corpus 210 "$work/corpus.json"
python3 transaction-grammar/make_audio.py "$work/corpus.json" "$work/audio" "$work/cases.jsonl"
for model in aurora citrinet; do
  $infer $model "$assets/$model-int8.onnx" "$work/corpus.json" "$work/cases.jsonl" "$work/scores-$model.jsonl" 8
  $text decide "$work/corpus.json" "$work/scores-$model.jsonl" "$work/decisions-$model.jsonl"
done
python3 transaction-grammar/score.py "reports/$name.json" "corpus=$work/corpus.json" \
  "aurora=$work/decisions-aurora.jsonl" "citrinet=$work/decisions-citrinet.jsonl"
# Every transcript stays in $work/decisions-<model>.jsonl.
