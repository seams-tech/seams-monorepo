"""Transcribe every bench case with one model in this process.

Each model runs in its own process so that load time and peak memory belong to
that model alone. The output is one JSON line per case.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import resource
import time
from pathlib import Path

import numpy as np
import soundfile as sf

import corpus

WHISPER_REPO = "mlx-community/whisper-large-v3-turbo"
WHISPER_REVISION = "a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb"
MOONSHINE_MODELS = {
    "moonshine-tiny-streaming": "TINY_STREAMING",
    "moonshine-base": "BASE",
    "moonshine-medium-streaming": "MEDIUM_STREAMING",
}
MODELS = ("whisper-large-v3-turbo", *MOONSHINE_MODELS)


def tree_files(root: Path) -> list[dict]:
    files = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        files.append({"path": str(path.relative_to(root)), "bytes": path.stat().st_size, "sha256": digest})
    return files


class Whisper:
    def __init__(self, cache: Path, revision: str) -> None:
        import mlx.core as mx
        import mlx_whisper
        from huggingface_hub import snapshot_download

        self._mx = mx
        self._mlx_whisper = mlx_whisper
        self.root = Path(snapshot_download(WHISPER_REPO, revision=revision, cache_dir=cache / "hf"))
        self.identity = {"repo": WHISPER_REPO, "revision": revision, "runtime": "mlx-whisper 0.4.3",
                         "files": tree_files(self.root)}

    def transcribe(self, samples: np.ndarray, language: str, vocabulary: tuple[str, ...] | None) -> str:
        prompt = ", ".join(vocabulary) + "." if vocabulary else None
        result = self._mlx_whisper.transcribe(
            samples, path_or_hf_repo=str(self.root), language=language, temperature=0.0,
            condition_on_previous_text=False, initial_prompt=prompt, verbose=None)
        return result["text"].strip()

    def peak_bytes(self) -> int:
        return int(self._mx.get_peak_memory())


class Moonshine:
    def __init__(self, cache: Path, arch_name: str, language: str) -> None:
        import moonshine_voice as mv

        arch = mv.ModelArch[arch_name]
        root, arch = mv.get_model_for_language(language, arch, cache_root=cache / "moonshine")
        self._mv = mv
        self.root = Path(root)
        self.arch = arch
        self._transcriber = mv.Transcriber(root, arch)
        self.identity = {"arch": arch_name, "language": language, "runtime": "moonshine-voice 0.1.5",
                         "files": tree_files(self.root)}

    def transcribe(self, samples: np.ndarray, language: str, vocabulary: tuple[str, ...] | None) -> str:
        self._transcriber.set_keyterms(list(vocabulary) if vocabulary else None)
        transcript = self._transcriber.transcribe_without_streaming(samples.tolist(), 16000)
        return " ".join(line.text.strip() for line in transcript.lines if line.text.strip())

    def peak_bytes(self) -> int:
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=MODELS, required=True)
    parser.add_argument("--language", choices=("en", "ja"), required=True)
    parser.add_argument("--vocabulary", action="store_true",
                        help="Pass the shop vocabulary (Whisper prompt or Moonshine key terms) for dictation sets.")
    parser.add_argument("--set", dest="set_name", help="Run only this case set, for example approval_en_v2.")
    parser.add_argument("--whisper-revision", default=WHISPER_REVISION)
    parser.add_argument("--cache", type=Path, default=Path(__file__).parent / ".cache")
    args = parser.parse_args()
    cache: Path = args.cache.resolve()

    cases = [json.loads(line) for line in (cache / "cases.jsonl").read_text(encoding="utf-8").splitlines()]
    cases = [c for c in cases if c["language"] == args.language]
    if args.vocabulary:
        cases = [c for c in cases if c["set"].startswith("dictation")]
    if args.set_name:
        cases = [c for c in cases if c["set"] == args.set_name]
    if not cases:
        raise SystemExit("no cases match")
    vocabulary = (corpus.VOCABULARY_EN if args.language == "en" else corpus.VOCABULARY_JA) if args.vocabulary else None

    started = time.perf_counter()
    if args.model == "whisper-large-v3-turbo":
        model = Whisper(cache, args.whisper_revision)
    else:
        model = Moonshine(cache, MOONSHINE_MODELS[args.model], args.language)
    load_seconds = time.perf_counter() - started

    warm = np.asarray(sf.read(cache / cases[0]["path"], dtype="float32")[0])
    model.transcribe(warm, args.language, vocabulary)

    run_id = (f"{args.model}-{args.language}" + ("-vocab" if args.vocabulary else "")
              + (f"-{args.set_name}" if args.set_name else ""))
    runs = cache / "runs"
    runs.mkdir(exist_ok=True)
    total_audio = 0.0
    total_compute = 0.0
    with (runs / f"{run_id}.jsonl").open("w", encoding="utf-8") as handle:
        for case in cases:
            samples = np.asarray(sf.read(cache / case["path"], dtype="float32")[0])
            began = time.perf_counter()
            text = model.transcribe(samples, args.language, vocabulary)
            seconds = time.perf_counter() - began
            total_audio += case["seconds"]
            total_compute += seconds
            handle.write(json.dumps({"caseId": case["caseId"], "hypothesis": text, "computeSeconds": round(seconds, 4)},
                                    ensure_ascii=False) + "\n")

    summary = {
        "runId": run_id, "model": args.model, "language": args.language, "vocabulary": args.vocabulary,
        "set": args.set_name,
        "identity": model.identity, "host": {"macos": platform.mac_ver()[0], "machine": platform.machine()},
        "caseCount": len(cases), "loadSeconds": round(load_seconds, 2),
        "audioSeconds": round(total_audio, 1), "computeSeconds": round(total_compute, 1),
        "realTimeFactor": round(total_compute / total_audio, 4),
        "peakResidentBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "peakGpuBytes": model.peak_bytes(),
        "modelBytes": sum(f["bytes"] for f in model.identity["files"]),
    }
    (runs / f"{run_id}.summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "identity"}))


if __name__ == "__main__":
    main()
