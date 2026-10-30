"""Can an audio-text embedding check a spoken approval phrase? EmbeddingGemma 2 on the approval set.

An embedding model gives a vector, not a transcript, so the strict word match cannot apply.
This probe scores each recording by cosine similarity to the displayed phrase and reports:

- threshold: accept when the similarity to the displayed phrase passes one global threshold.
  The threshold is the lowest that accepts no near miss and no unrelated sentence.
- decoys: accept when the displayed phrase beats its four near-miss texts and the other
  phrases of the set by a margin. The decoys are the exact near-miss sentences that were
  spoken, so this is a best case that a real verifier cannot reach.
- speaker: for each clean correct recording, is the nearest other recording the same voice
  or the same phrase? A speaker model needs the same voice.

Thresholds and margins are chosen on the scored data itself, so the rates are optimistic.
Run with the separate venv: .cache/.venv-embed/bin/python embedding_probe.py
"""

from __future__ import annotations

import argparse
import json
import platform
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf

import corpus

MODEL_ID = "google/embeddinggemma-2"
MODEL_REVISION = "f9972ac22e696a105c482202646979e33e4b5a1e"
PROMPTS = {"document": "Document", "similarity": "SentenceSimilarity", "none": None}


def band(case: dict) -> str:
    return "clean" if case["snrDb"] is None else f"{case['snrDb']} dB"


def load_model(cache: Path, device: str):
    import torch
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(MODEL_ID, revision=MODEL_REVISION, device=device, cache_folder=str(cache / "hf"),
                               model_kwargs={"dtype": torch.float32}, config_kwargs={"vision_config": None})


def embed_audio(model, cache: Path, cases: list[dict], store: Path) -> tuple[np.ndarray, list[float]]:
    if store.exists():
        saved = np.load(store, allow_pickle=False)
        if saved.shape[0] == len(cases):
            return saved, []
    vectors, seconds = [], []
    for index, case in enumerate(cases):
        samples, rate = sf.read(cache / case["path"], dtype="float32")
        if rate != 16000:
            raise SystemExit(f"{case['caseId']}: {rate} Hz, expected 16000")
        started = time.perf_counter()
        vector = model.encode([{"array": samples, "sampling_rate": rate}], normalize_embeddings=True)[0]
        seconds.append(time.perf_counter() - started)
        vectors.append(vector)
        if index % 200 == 0:
            print(f"audio {index}/{len(cases)}", flush=True)
    matrix = np.stack(vectors).astype(np.float32)
    np.save(store, matrix)
    return matrix, seconds


def texts() -> tuple[list[str], dict[str, int], dict[str, list[int]]]:
    """All candidate texts, the index of each displayed phrase, and each phrase's near-miss indexes."""
    items, displayed, near = [], {}, defaultdict(list)
    for phrase in corpus.APPROVAL_EN_V2:
        displayed[phrase.id] = len(items)
        items.append(phrase.text)
        for _, text in phrase.near_misses:
            near[phrase.id].append(len(items))
            items.append(text)
    return items, displayed, near


def rate(values: list[bool]) -> float:
    return round(100 * sum(values) / len(values), 1) if values else 0.0


def by_band(cases: list[dict], accepted: list[bool], variant: str | None) -> dict:
    groups = defaultdict(list)
    for case, ok in zip(cases, accepted):
        if variant is None or case["variant"] == variant:
            groups[band(case)].append(ok)
    return {key: {"accepted": sum(values), "of": len(values), "percent": rate(values)}
            for key, values in sorted(groups.items(), key=lambda item: (item[0] != "clean", item[0]))}


def score(cases: list[dict], audio: np.ndarray, text: np.ndarray, displayed: dict, near: dict) -> dict:
    phrase_ids = list(displayed)
    similarity = audio @ text.T
    correct = [case["variant"] == "correct" for case in cases]

    def target(index: int) -> float:
        case = cases[index]
        if case["variant"] == "unrelated":
            return max(similarity[index, displayed[pid]] for pid in phrase_ids)
        return similarity[index, displayed[case["phraseId"]]]

    targets = np.array([target(index) for index in range(len(cases))])
    negatives = targets[~np.array(correct)]
    positives = targets[np.array(correct)]
    threshold = float(negatives.max())
    accepted = [bool(value > threshold) for value in targets]
    order = np.argsort(np.concatenate([positives, negatives]))
    ranks = np.empty(len(order))
    ranks[order] = np.arange(1, len(order) + 1)
    auc = (ranks[: len(positives)].sum() - len(positives) * (len(positives) + 1) / 2) / (len(positives) * len(negatives))

    margins = []
    for index, case in enumerate(cases):
        pid = case["phraseId"]
        if pid is None:
            margins.append(max(similarity[index, displayed[p]] - max(
                similarity[index, j] for j in near[p] + [displayed[q] for q in phrase_ids if q != p])
                for p in phrase_ids))
            continue
        decoys = near[pid] + [displayed[q] for q in phrase_ids if q != pid]
        margins.append(similarity[index, displayed[pid]] - max(similarity[index, j] for j in decoys))
    margins = np.array(margins)
    top = [bool(value > 0) for value in margins]
    safe_margin = max(0.0, float(margins[~np.array(correct)].max()))
    safe = [bool(value > safe_margin) for value in margins]

    variants = sorted({case["variant"] for case in cases})
    return {
        "threshold": {
            "value": round(threshold, 4), "auc": round(float(auc), 4),
            "correctAccepted": by_band(cases, accepted, "correct"),
            "meanSimilarity": {variant: round(float(np.mean([t for t, c in zip(targets, cases)
                                                             if c["variant"] == variant])), 4) for variant in variants},
        },
        "decoys": {
            "topOne": {variant: rate([ok for ok, c in zip(top, cases) if c["variant"] == variant])
                       for variant in variants},
            "zeroFalseAcceptMargin": round(safe_margin, 4),
            "correctAcceptedAtThatMargin": by_band(cases, safe, "correct"),
        },
    }


def speaker_check(cases: list[dict], audio: np.ndarray) -> dict:
    clean = [index for index, case in enumerate(cases) if case["variant"] == "correct" and case["snrDb"] is None]
    if len(clean) < 2:
        return None
    same_voice = same_phrase = 0
    voice_pairs, phrase_pairs = [], []
    for left in clean:
        best, best_index = -2.0, None
        for right in clean:
            if right == left:
                continue
            value = float(audio[left] @ audio[right])
            if cases[left]["voice"] == cases[right]["voice"]:
                voice_pairs.append(value)
            elif cases[left]["phraseId"] == cases[right]["phraseId"]:
                phrase_pairs.append(value)
            if value > best:
                best, best_index = value, right
        same_voice += cases[best_index]["voice"] == cases[left]["voice"]
        same_phrase += cases[best_index]["phraseId"] == cases[left]["phraseId"]
    return {"recordings": len(clean), "nearestIsSameVoice": same_voice, "nearestIsSamePhrase": same_phrase,
            "meanSameVoiceOtherPhrase": round(float(np.mean(voice_pairs)), 4),
            "meanOtherVoiceSamePhrase": round(float(np.mean(phrase_pairs)), 4)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cache", type=Path, default=Path(__file__).parent / ".cache")
    parser.add_argument("--device", default="mps")
    parser.add_argument("--limit", type=int, help="Score only the first cases, for a smoke run.")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    cases = [json.loads(line) for line in (cache / "cases.jsonl").read_text(encoding="utf-8").splitlines()]
    cases = [case for case in cases if case["set"] == "approval_en_v2"][: args.limit]

    started = time.perf_counter()
    model = load_model(cache, args.device)
    load_seconds = time.perf_counter() - started
    folder = cache / "embeddinggemma2"
    folder.mkdir(exist_ok=True)
    suffix = f"-{args.limit}" if args.limit else ""
    audio, seconds = embed_audio(model, cache, cases, folder / f"approval_en_v2{suffix}.npy")
    items, displayed, near = texts()

    results = {}
    for name, prompt in PROMPTS.items():
        text = model.encode(items, prompt_name=prompt, normalize_embeddings=True) if prompt else \
            model.encode(items, normalize_embeddings=True)
        results[name] = score(cases, audio, np.asarray(text, dtype=np.float32), displayed, near)

    report = {
        "model": MODEL_ID, "revision": MODEL_REVISION, "dtype": "float32", "device": args.device,
        "loaded": "text and audio encoders", "cases": len(cases),
        "machine": f"{platform.machine()} macOS {platform.mac_ver()[0]}",
        "loadSeconds": round(load_seconds, 1),
        "audioEncodeMs": {"mean": round(1000 * float(np.mean(seconds)), 1),
                          "p95": round(1000 * float(np.percentile(seconds, 95)), 1)} if seconds else None,
        "textPrompts": results,
        "speaker": speaker_check(cases, audio),
    }
    text = json.dumps(report, indent=2)
    print(text)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
