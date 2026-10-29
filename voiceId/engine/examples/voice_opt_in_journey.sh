#!/bin/sh
# Opt-in voice model journey: refuse, interrupt, resume, verify, turn off.
# Usage: voice_opt_in_journey.sh <voiceid-host> <empty-voice-model-directory>
# Downloads the 874 MB default model once (it needs network) and deletes it at the end.
set -u
host=$1
dir=$2
if [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then echo "$dir is not empty" >&2; exit 1; fi
step() { echo; echo "## $*"; }
step "1. Status before opt-in"
"$host" voice status "$dir"
step "2. The person answers no"
echo no | "$host" voice on "$dir"
echo "files: $(ls "$dir" 2>/dev/null | wc -l | tr -d ' ')"
step "3. The person answers yes; the download is interrupted after 6 s"
(echo yes | "$host" voice on "$dir" 2>&1) & pid=$!
sleep 6; pkill -f "voiceid-host voice on $dir"; wait $pid 2>/dev/null
"$host" voice status "$dir"
step "4. The person turns voice on again; the download resumes"
started=$(date +%s)
echo yes | "$host" voice on "$dir" 2>&1
echo "seconds: $(( $(date +%s) - started ))"
"$host" voice status "$dir"
shasum -a 256 "$dir"/ggml-large-v3-turbo-q8_0.bin
ls -l "$dir"
step "5. The person turns voice off"
"$host" voice off "$dir"
"$host" voice status "$dir"
echo "files: $(ls "$dir" | wc -l | tr -d ' ')"
