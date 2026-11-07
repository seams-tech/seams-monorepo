"""Synthesize the transaction-grammar corpus with macOS `say`.

Each correct text is read by every voice at every rate. Each near-miss text
is read twice, by two (voice, rate) pairs in rotation. `say` writes AIFF;
ffmpeg resamples it to raw little-endian f32 mono 16 kHz. `txg-infer` trims,
levels to -26 dBFS and pads, as `prepare.py` does.

Usage: python3 make_audio.py <corpus.json> <audio-dir> <cases.jsonl>
Standard library only.
"""

import hashlib
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# The English dictation voices of corpus.py (VOICES_DICTATION_EN).
VOICES = ("Samantha", "Daniel", "Karen", "Moira", "Rishi", "Tessa")
RATES = (160, 210)  # words per minute
PAIRS = [(v, r) for v in VOICES for r in RATES]
NEAR_MISS_READINGS = 2


def synthesize(job):
    path, voice, rate, text = job
    if path.exists():
        return
    aiff = path.with_suffix(".aiff")
    subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", str(aiff), text], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(aiff), "-ac", "1", "-ar", "16000",
                    "-f", "f32le", str(path)], check=True)
    aiff.unlink()


def main():
    corpus_path, audio_dir, cases_path = map(Path, sys.argv[1:4])
    corpus = json.loads(corpus_path.read_text())
    audio_dir.mkdir(parents=True, exist_ok=True)
    cases, jobs = [], []
    rotation = 0

    def add(request_id, role, miss_kind, text, voice, rate):
        key = hashlib.sha256(f"{voice}\n{rate}\n{text}".encode()).hexdigest()[:16]
        path = audio_dir / f"{voice}-{rate}-{key}.f32"
        cases.append({"caseId": f"{request_id}-{role}-{miss_kind or 'correct'}-{voice}-{rate}",
                      "requestId": request_id, "role": role, "missKind": miss_kind, "text": text,
                      "voice": voice, "rate": rate, "audio": str(path)})
        jobs.append((path, voice, rate, text))

    for request in corpus["requests"]:
        for voice, rate in PAIRS:
            add(request["id"], "correct", None, request["spoken"], voice, rate)
        for miss in request["nearMisses"]:
            for _ in range(NEAR_MISS_READINGS):
                voice, rate = PAIRS[rotation % len(PAIRS)]
                rotation += 1
                add(request["id"], "near_miss", miss["kind"], miss["text"], voice, rate)

    unique = list({job[0]: job for job in jobs}.values())
    with ThreadPoolExecutor(max_workers=8) as pool:
        for index, _ in enumerate(pool.map(synthesize, unique), 1):
            if index % 500 == 0:
                print(f"audio {index}/{len(unique)}", flush=True)
    with cases_path.open("w") as out:
        for case in cases:
            out.write(json.dumps(case) + "\n")
    print(f"cases: {len(cases)} ({len(unique)} audio files)")


if __name__ == "__main__":
    main()
