"""Measure the memory and CPU that Whisper turbo with MLX holds on this Mac.

Usage: mlx_resources.py <bench cache folder> <MLX model snapshot folder>
Transcribes 60 clean English approval phrases one at a time, then idles for 20 s.
"""
import json
import os
import resource
import subprocess
import sys
import time
from pathlib import Path

import mlx.core as mx
import mlx_whisper
import soundfile as sf

cache = Path(sys.argv[1])
model = sys.argv[2]
MIB = 2**20


def rss_mb() -> int:
    return round(int(subprocess.check_output(["ps", "-o", "rss=", "-p", str(os.getpid())])) / 1024)


def cpu_seconds() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return usage.ru_utime + usage.ru_stime


def mlx_mb() -> dict:
    return {"active": round(mx.get_active_memory() / MIB), "cache": round(mx.get_cache_memory() / MIB)}


def transcribe(case: dict) -> None:
    audio, _ = sf.read(cache / case["path"], dtype="float32")
    mlx_whisper.transcribe(audio, path_or_hf_repo=model, language="en", temperature=0.0,
                           condition_on_previous_text=False)


cases = [json.loads(line) for line in (cache / "cases.jsonl").read_text().splitlines()]
cases = [c for c in cases if c["language"] == "en" and c["set"] == "approval_en_v2" and c["condition"] == "clean"][:60]

report = {"rss_before_load_mb": rss_mb()}
start = time.perf_counter()
transcribe(cases[0])
report["load_and_first_s"] = round(time.perf_counter() - start, 2)
report["peak_mb"] = round(mx.get_peak_memory() / MIB)

cpu_start, wall_start, seconds = cpu_seconds(), time.perf_counter(), []
for case in cases:
    start = time.perf_counter()
    transcribe(case)
    seconds.append(time.perf_counter() - start)
wall, cpu = time.perf_counter() - wall_start, cpu_seconds() - cpu_start
seconds.sort()
report |= {
    "commands": len(cases),
    "audio_s": round(sum(c["seconds"] for c in cases), 1),
    "wall_s": round(wall, 1),
    "p50_s": round(seconds[len(seconds) // 2], 2),
    "max_s": round(seconds[-1], 2),
    "cpu_s": round(cpu, 1),
    "cpu_cores_while_busy": round(cpu / wall, 2),
    "mlx_mb_after_commands": mlx_mb(),
}

cpu_start = cpu_seconds()
time.sleep(20)
report["idle_cpu_percent_of_one_core"] = round((cpu_seconds() - cpu_start) / 20 * 100, 2)
report["idle_rss_mb"] = rss_mb()
mx.clear_cache()
report["mlx_mb_after_clear_cache"] = mlx_mb()
report["machine_load"] = [round(value, 1) for value in os.getloadavg()]
print(json.dumps(report, indent=2))
