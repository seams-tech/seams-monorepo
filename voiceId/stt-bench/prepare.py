"""Build the bench audio: bakery speech, public human speech and kitchen noise.

Downloads are pinned and hash-checked. Mixed audio is written to the ignored
cache with a case list that names every input and its SHA-256.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import platform
import subprocess
import tarfile
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf

import corpus
from record import merge_human_cases

SAMPLE_RATE = 16000
SPEECH_LEVEL_DBFS = -26.0
PAD_SECONDS = 0.3
FLEURS_REVISION = "70bb2e84b976b7e960aa89f1c648e09c59f894dd"
FLEURS_COUNT = 60
DEMAND_RECORD = "https://zenodo.org/api/records/1227121/files/{name}_16k.zip/content"
NOISES = {
    # DEMAND environment, its Zenodo MD5, and what it stands for at the bench.
    "kitchen": ("DKITCHEN", "7ffbf52d7f4699f96927846103dc8788"),
    "cafe": ("PCAFETER", "99927d148128254141a9417d051510bb"),
    "motor": ("DWASHING", "7e5ee9437ce9409c5f9a779b6212a240"),
}
SNR_DB = (10, 5, 0)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url: str, target: Path, md5: str | None = None) -> Path:
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(target.suffix + ".part")
        # Zenodo closes long transfers early; curl resumes them.
        subprocess.run(["curl", "-sSL", "--fail", "--retry", "20", "--retry-all-errors", "-C", "-",
                        "-o", str(partial), url], check=True)
        partial.rename(target)
    if md5 is not None:
        digest = hashlib.md5()
        with target.open("rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
        if digest.hexdigest() != md5:
            raise SystemExit(f"MD5 mismatch for {target}")
    return target


def load_noise(cache: Path, key: str) -> tuple[np.ndarray, dict]:
    name, md5 = NOISES[key]
    archive = download(DEMAND_RECORD.format(name=name), cache / "downloads" / f"{name}_16k.zip", md5)
    with zipfile.ZipFile(archive) as bundle:
        member = next(m for m in bundle.namelist() if m.endswith("ch01.wav"))
        data = bundle.read(member)
    samples, rate = sf.read(io.BytesIO(data), dtype="float32")
    if rate != SAMPLE_RATE:
        raise SystemExit(f"{name} is {rate} Hz")
    return samples, {"environment": name, "zipMd5": md5, "member": member, "memberSha256": sha256_bytes(data)}


def fleurs_cases(cache: Path, language: str) -> list[dict]:
    from huggingface_hub import hf_hub_download

    tsv = hf_hub_download("google/fleurs", f"data/{language}/dev.tsv", repo_type="dataset",
                          revision=FLEURS_REVISION, cache_dir=cache / "hf")
    archive = hf_hub_download("google/fleurs", f"data/{language}/audio/dev.tar.gz", repo_type="dataset",
                              revision=FLEURS_REVISION, cache_dir=cache / "hf")
    rows: list[dict] = []
    seen: set[str] = set()
    with open(tsv, encoding="utf-8") as handle:
        for row in csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE):
            sentence_id, file_name, raw = row[0], row[1], row[2]
            if sentence_id in seen:
                continue
            seen.add(sentence_id)
            rows.append({"sentenceId": sentence_id, "fileName": file_name, "text": raw})
            if len(rows) == FLEURS_COUNT:
                break
    wanted = {row["fileName"]: row for row in rows}
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            name = Path(member.name).name
            if name in wanted:
                data = bundle.extractfile(member).read()
                samples, rate = sf.read(io.BytesIO(data), dtype="float32")
                if rate != SAMPLE_RATE:
                    raise SystemExit(f"FLEURS {name} is {rate} Hz")
                wanted[name]["samples"] = samples
                wanted[name]["sourceSha256"] = sha256_bytes(data)
    missing = [name for name, row in wanted.items() if "samples" not in row]
    if missing:
        raise SystemExit(f"FLEURS files missing: {missing[:3]}")
    return rows


def render_say(cache: Path, voice: str, text: str) -> np.ndarray:
    key = sha256_bytes(f"{voice}\n{text}".encode())[:16]
    target = cache / "say" / f"{voice}-{key}.wav"
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["say", "-v", voice, "-o", str(target), f"--data-format=LEI16@{SAMPLE_RATE}", text],
                       check=True)
    samples, rate = sf.read(target, dtype="float32")
    if rate != SAMPLE_RATE:
        raise SystemExit(f"say wrote {rate} Hz")
    return samples


def frame_rms(samples: np.ndarray, frame: int = 160) -> np.ndarray:
    count = len(samples) // frame
    framed = samples[: count * frame].reshape(count, frame)
    return np.sqrt(np.mean(framed**2, axis=1) + 1e-12)


def trim_and_level(samples: np.ndarray) -> np.ndarray:
    rms = frame_rms(samples)
    active = rms > rms.max() * 10 ** (-40 / 20)
    indices = np.flatnonzero(active)
    start = max(0, (indices[0] - 5) * 160)
    end = min(len(samples), (indices[-1] + 6) * 160)
    speech = samples[start:end].astype(np.float64)
    speech_rms = frame_rms(speech)
    level = np.sqrt(np.mean(speech_rms[speech_rms > speech_rms.max() * 10 ** (-40 / 20)] ** 2))
    return speech * (10 ** (SPEECH_LEVEL_DBFS / 20) / level)


def mix(speech: np.ndarray, noise: np.ndarray | None, snr_db: float | None, seed_text: str) -> np.ndarray:
    pad = int(PAD_SECONDS * SAMPLE_RATE)
    padded = np.concatenate([np.zeros(pad), speech, np.zeros(pad)])
    if noise is None:
        return padded
    seed = int(sha256_bytes(seed_text.encode())[:8], 16)
    offset = np.random.default_rng(seed).integers(0, len(noise) - len(padded))
    segment = noise[offset: offset + len(padded)].astype(np.float64)
    speech_power = (10 ** (SPEECH_LEVEL_DBFS / 20)) ** 2
    noise_power = np.mean(segment**2)
    gain = np.sqrt(speech_power / (noise_power * 10 ** (snr_db / 10)))
    mixed = padded + gain * segment
    peak = np.max(np.abs(mixed))
    return mixed * (0.99 / peak) if peak > 0.99 else mixed


def base_utterances(cache: Path) -> tuple[list[dict], dict]:
    bases: list[dict] = []
    for item in corpus.DICTATION_EN:
        for voice in corpus.VOICES_DICTATION_EN:
            bases.append({"set": "dictation_en", "language": "en", "itemId": item.id, "voice": voice,
                          "reference": item.text, "keyTerms": list(item.key_terms),
                          "samples": render_say(cache, voice, item.text)})
    for set_name, bank in corpus.APPROVAL_BANKS.items():
        for phrase in bank:
            variants = (("correct", phrase.text),) + phrase.near_misses
            for voice in corpus.VOICES_APPROVAL_EN:
                for variant, text in variants:
                    bases.append({"set": set_name, "language": "en", "itemId": f"{phrase.id}-{variant}",
                                  "voice": voice, "reference": text, "phraseId": phrase.id, "variant": variant,
                                  "samples": render_say(cache, voice, text)})
        for item_id, text in corpus.UNRELATED_EN:
            for voice in corpus.VOICES_APPROVAL_EN:
                bases.append({"set": set_name, "language": "en", "itemId": item_id, "voice": voice,
                              "reference": text, "phraseId": None, "variant": "unrelated",
                              "samples": render_say(cache, voice, text)})
    for item in corpus.DICTATION_JA:
        for voice in corpus.VOICES_JA:
            bases.append({"set": "dictation_ja", "language": "ja", "itemId": item.id, "voice": voice,
                          "reference": item.text, "keyTerms": list(item.key_terms),
                          "samples": render_say(cache, voice, item.text)})
    sources = {}
    for language, set_name in (("en_us", "fleurs_en"), ("ja_jp", "fleurs_ja")):
        rows = fleurs_cases(cache, language)
        sources[set_name] = {"dataset": "google/fleurs", "revision": FLEURS_REVISION, "split": "dev",
                             "license": "CC-BY-4.0", "files": {r["fileName"]: r["sourceSha256"] for r in rows}}
        for row in rows:
            bases.append({"set": set_name, "language": language[:2], "itemId": row["sentenceId"],
                          "voice": "human", "reference": row["text"], "samples": row["samples"]})
    return bases, sources


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=Path(__file__).parent / ".cache")
    args = parser.parse_args()
    cache: Path = args.cache.resolve()
    audio_dir = cache / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    noises = {}
    noise_sources = {}
    for key in NOISES:
        noises[key], noise_sources[key] = load_noise(cache, key)
    bases, fleurs_sources = base_utterances(cache)

    conditions = [("clean", None, None)] + [(f"{key}{snr}", key, snr) for key in NOISES for snr in SNR_DB]
    cases = []
    for base in bases:
        speech = trim_and_level(base["samples"])
        base_id = f"{base['set']}-{base['itemId']}-{base['voice']}"
        for condition, noise_key, snr in conditions:
            mixed = mix(speech, noises.get(noise_key), snr, f"{base_id}|{condition}")
            path = audio_dir / f"{base_id}__{condition}.wav"
            sf.write(path, mixed.astype(np.float32), SAMPLE_RATE, subtype="PCM_16")
            case = {key: value for key, value in base.items() if key != "samples"}
            case.update({"caseId": f"{base_id}__{condition}", "baseId": base_id, "condition": condition,
                         "noise": noise_key, "snrDb": snr, "path": str(path.relative_to(cache)),
                         "sha256": sha256_file(path), "seconds": round(len(mixed) / SAMPLE_RATE, 3)})
            cases.append(case)

    with (cache / "cases.jsonl").open("w", encoding="utf-8") as handle:
        for case in cases:
            handle.write(json.dumps(case, ensure_ascii=False) + "\n")
    # Keep the cases that record.py added; their audio is not regenerated.
    recorded = merge_human_cases(cache)
    manifest = {
        "schemaVersion": "stt_bench_inputs_v1",
        "host": {"macos": platform.mac_ver()[0], "machine": platform.machine()},
        "sampleRateHz": SAMPLE_RATE,
        "speechLevelDbfs": SPEECH_LEVEL_DBFS,
        "padSeconds": PAD_SECONDS,
        "conditions": [{"id": c, "noise": n, "snrDb": s} for c, n, s in conditions],
        "noise": {"dataset": "DEMAND", "record": "https://zenodo.org/records/1227121", "license": "CC-BY-4.0",
                  "environments": noise_sources},
        "humanSpeech": fleurs_sources,
        "syntheticSpeech": {"engine": "macOS say", "voicesDictationEn": corpus.VOICES_DICTATION_EN,
                            "voicesApprovalEn": corpus.VOICES_APPROVAL_EN, "voicesJa": corpus.VOICES_JA},
        "caseCount": len(cases),
        "recordedCaseCount": recorded,
        "casesSha256": sha256_file(cache / "cases.jsonl"),
    }
    (cache / "inputs-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"{len(bases)} utterances, {len(cases)} cases")


if __name__ == "__main__":
    main()
