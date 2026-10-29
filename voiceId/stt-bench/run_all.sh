#!/bin/sh
# Run every model on the prepared cases, then score them.
# Usage: run_all.sh <report-name>   (for example stt-bench-2026-10-29)
set -u
bench=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python="$bench/.cache/.venv/bin/python"
report="$bench/reports/$1"
status=0

run() {
  if "$python" "$bench/run_model.py" "$@" >>"$bench/.cache/run_all.log" 2>&1; then
    echo "run done: $*"
  else
    echo "run FAILED: $*"
    status=1
  fi
}

run --model moonshine-tiny-streaming --language en
run --model moonshine-base --language en
run --model moonshine-medium-streaming --language en
run --model whisper-large-v3-turbo --language en
run --model moonshine-tiny-streaming --language ja
run --model moonshine-base --language ja
run --model whisper-large-v3-turbo --language ja
run --model moonshine-tiny-streaming --language en --vocabulary
run --model moonshine-medium-streaming --language en --vocabulary
run --model whisper-large-v3-turbo --language en --vocabulary
run --model whisper-large-v3-turbo --language ja --vocabulary

"$python" "$bench/score.py" --report "$report" && "$python" "$bench/summarize.py" "$report.json" || status=1
echo "all done: status $status"
exit "$status"
