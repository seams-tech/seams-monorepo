"""Transcribe bench cases with Whisper turbo on Workers AI, through the probe Worker.

Start the probe first (it runs on Cloudflare's network, not on this Mac):

    npx wrangler dev --remote --config workers-ai-probe/wrangler.jsonc --port 8787

The output has the same shape as run_model.py, so score.py reads it. Each case's
computeSeconds is the round trip from this Mac: upload, Worker, Workers AI and
the answer. aiMs is the time inside the Worker around the AI call; colo is the
Cloudflare location of the Worker. Use --workers 1 for latency; parallel runs
are for accuracy only.
"""

from __future__ import annotations

import argparse
import base64
import json
import platform
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import corpus

MODEL = "@cf/openai/whisper-large-v3-turbo"


def transcribe(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    for attempt in range(4):
        request = urllib.request.Request(url, data=data, headers={"content-type": "application/json",
                                                                   "user-agent": "stt-bench/1"})
        began = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                answer = json.loads(response.read())
            return {**answer, "seconds": time.perf_counter() - began, "attempts": attempt + 1}
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last = error
            body = error.read().decode(errors="replace")[:200] if isinstance(error, urllib.error.HTTPError) else ""
            print(f"retry {attempt + 1}: {error} {body}", flush=True)
            time.sleep(2 ** attempt)
    raise SystemExit(f"Workers AI request failed after 4 attempts: {last}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://localhost:8787")
    parser.add_argument("--language", choices=("en", "ja"), required=True)
    parser.add_argument("--set", dest="set_name", required=True)
    parser.add_argument("--vocabulary", action="store_true", help="Pass the shop vocabulary as initial_prompt.")
    parser.add_argument("--no-vad", action="store_true", help="Leave vad_filter off (Plan 82 turns it on).")
    parser.add_argument("--beam-size", type=int, help="Workers AI beam_size (model default 5).")
    parser.add_argument("--condition", help="Run only these conditions, comma-separated.")
    parser.add_argument("--workers", type=int, default=6, help="Parallel requests; 1 for latency.")
    parser.add_argument("--tag", help="Suffix for the run id, for example latency.")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--cache", type=Path, default=Path(__file__).parent / ".cache")
    args = parser.parse_args()
    cache = args.cache.resolve()

    cases = [json.loads(line) for line in (cache / "cases.jsonl").read_text(encoding="utf-8").splitlines()]
    cases = [c for c in cases if c["language"] == args.language and c["set"] == args.set_name]
    if args.condition:
        cases = [c for c in cases if c["condition"] in args.condition.split(",")]
    cases = cases[: args.limit]
    if not cases:
        raise SystemExit("no cases match")
    vocabulary = (corpus.VOCABULARY_EN if args.language == "en" else corpus.VOCABULARY_JA) if args.vocabulary else None
    prompt = ", ".join(vocabulary) + "." if vocabulary else None
    vad = not args.no_vad

    def run(case: dict) -> dict:
        audio = base64.b64encode((cache / case["path"]).read_bytes()).decode()
        answer = transcribe(args.url, {"audio": audio, "language": args.language, "initial_prompt": prompt,
                                       "vad_filter": vad, "beam_size": args.beam_size})
        if "error" in answer:
            raise SystemExit(f"{case['caseId']}: {answer['error']}")
        return {"caseId": case["caseId"], "hypothesis": answer["text"].strip(),
                "computeSeconds": round(answer["seconds"], 4), "aiMs": answer["aiMs"], "colo": answer["colo"],
                "attempts": answer["attempts"]}

    run(cases[0])  # warm the probe
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        outputs = list(pool.map(run, cases))

    run_id = (f"workers-ai-whisper-large-v3-turbo-{args.language}" + ("-vocab" if args.vocabulary else "")
              + ("-novad" if args.no_vad else "") + (f"-beam{args.beam_size}" if args.beam_size else "")
              + f"-{args.set_name}"
              + (f"-{args.condition.replace(',', '+')}" if args.condition else "")
              + (f"-{args.tag}" if args.tag else "") + (f"-first{args.limit}" if args.limit else ""))
    runs = cache / "runs"
    runs.mkdir(exist_ok=True)
    with (runs / f"{run_id}.jsonl").open("w", encoding="utf-8") as handle:
        for output in outputs:
            handle.write(json.dumps(output, ensure_ascii=False) + "\n")
    seconds = sorted(o["computeSeconds"] for o in outputs)
    ai = sorted(o["aiMs"] for o in outputs)

    def pct(values: list, p: float) -> float:
        return values[min(len(values) - 1, int(round(p * (len(values) - 1))))]

    total_audio = sum(c["seconds"] for c in cases)
    summary = {
        "runId": run_id, "model": "workers-ai-whisper-large-v3-turbo", "language": args.language,
        "vocabulary": args.vocabulary, "set": args.set_name,
        "identity": {"model": MODEL, "runtime": "Workers AI binding, probe Worker through wrangler dev --remote",
                     "vadFilter": vad, "beamSize": args.beam_size or 5, "parallelRequests": args.workers,
                     "files": []},
        "host": {"macos": platform.mac_ver()[0], "machine": platform.machine()},
        "caseCount": len(cases), "loadSeconds": 0.0, "audioSeconds": round(total_audio, 1),
        "computeSeconds": round(sum(seconds), 1), "realTimeFactor": round(sum(seconds) / total_audio, 4),
        "peakResidentBytes": 0, "peakGpuBytes": 0, "modelBytes": 0,
        "roundTripSeconds": {"p50": pct(seconds, 0.5), "p95": pct(seconds, 0.95), "max": seconds[-1]},
        "aiMs": {"p50": pct(ai, 0.5), "p95": pct(ai, 0.95), "max": ai[-1]},
        "colos": sorted({o["colo"] for o in outputs if o["colo"]}),
        "retriedRequests": sum(o["attempts"] > 1 for o in outputs),
    }
    (runs / f"{run_id}.summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "identity"}))


if __name__ == "__main__":
    main()
