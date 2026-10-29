"""Record one person at the bench, hands-free, for the speech-to-text bench.

Each run records one condition, for example `quiet` or `mixer`. The script
shows one phrase, beeps, and records a fixed window. No key is needed while
you record. Press Enter to pause after the current phrase; the pause menu can
record the last phrase again or stop. A second run with the same condition
resumes where the first stopped.

Recordings stay in the ignored `.cache/human/` folder. Never commit them.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import queue
import random
import re
import subprocess
import sys
import threading
import time
from math import gcd
from pathlib import Path

import numpy as np
import soundfile as sf

import corpus

SAMPLE_RATE = 16000
READ_SECONDS = 1.5
APPROVAL_SECONDS = 4.0
DICTATION_SECONDS = 8.0
ROOM_SECONDS = 3.0
BEEP = "/System/Library/Sounds/Tink.aiff"
UNRELATED_IDS = ("un01", "un02", "un03", "un04")
DICTATION_COUNT = 10
APPROVAL_SET = "human_approval_en_v2"
DICTATION_SET = "human_dictation_en"


def plan() -> list[dict]:
    """Fifty prompts: each phrase once, two near misses per phrase, four
    unrelated sentences and ten dictation sentences. Each near-miss kind
    appears six times."""
    prompts = []
    for index, phrase in enumerate(corpus.APPROVAL_EN_V2):
        prompts.append({"set": APPROVAL_SET, "itemId": f"{phrase.id}-correct", "reference": phrase.text,
                        "phraseId": phrase.id, "variant": "correct", "window": APPROVAL_SECONDS})
        for kind in (index % 4, (index + 2) % 4):
            variant, text = phrase.near_misses[kind]
            prompts.append({"set": APPROVAL_SET, "itemId": f"{phrase.id}-{variant}", "reference": text,
                            "phraseId": phrase.id, "variant": variant, "window": APPROVAL_SECONDS})
    for item_id, text in corpus.UNRELATED_EN:
        if item_id in UNRELATED_IDS:
            prompts.append({"set": APPROVAL_SET, "itemId": item_id, "reference": text, "phraseId": None,
                            "variant": "unrelated", "window": APPROVAL_SECONDS})
    for item in corpus.DICTATION_EN[:DICTATION_COUNT]:
        prompts.append({"set": DICTATION_SET, "itemId": item.id, "reference": item.text,
                        "keyTerms": list(item.key_terms), "window": DICTATION_SECONDS})
    return prompts


def merge_human_cases(cache: Path) -> int:
    """Rewrite `cases.jsonl` as the prepared cases plus every recorded case."""
    human = cache / "human" / "cases.jsonl"
    recorded = human.read_text(encoding="utf-8").splitlines() if human.exists() else []
    path = cache / "cases.jsonl"
    prepared = [line for line in path.read_text(encoding="utf-8").splitlines()
                if not json.loads(line)["set"].startswith("human_")]
    path.write_text("".join(line + "\n" for line in prepared + recorded), encoding="utf-8")
    return len(recorded)


class Microphone:
    def __init__(self, device: str | None) -> None:
        import sounddevice as sd

        self._sd = sd
        self.info = sd.query_devices(device, "input")
        self.device = self.info["index"]
        self.rate = int(self.info["default_samplerate"])

    def record(self, seconds: float, text: str) -> np.ndarray:
        frames = self._sd.rec(int(seconds * self.rate), samplerate=self.rate, channels=1, dtype="float32",
                              device=self.device)
        self._sd.wait()
        samples = frames[:, 0].astype(np.float64)
        if self.rate == SAMPLE_RATE:
            return samples
        divisor = gcd(SAMPLE_RATE, self.rate)
        from scipy.signal import resample_poly

        return resample_poly(samples, SAMPLE_RATE // divisor, self.rate // divisor)


class SyntheticVoice:
    """Dry run without a microphone: a macOS voice reads each prompt."""

    info = {"name": "macOS say (dry run)", "default_samplerate": SAMPLE_RATE}
    rate = SAMPLE_RATE

    def __init__(self, cache: Path) -> None:
        self._cache = cache

    def record(self, seconds: float, text: str) -> np.ndarray:
        from prepare import render_say

        window = np.zeros(int(seconds * SAMPLE_RATE))
        if text:
            speech = render_say(self._cache, "Samantha", text)[: len(window) - 4800]
            window[4800: 4800 + len(speech)] = speech
        return window + np.random.default_rng(len(text)).normal(0, 0.002, len(window))


def frame_db(samples: np.ndarray) -> np.ndarray:
    count = len(samples) // 160
    rms = np.sqrt(np.mean(samples[: count * 160].reshape(count, 160) ** 2, axis=1))
    return 20 * np.log10(np.maximum(rms, 1e-9))


def check_take(samples: np.ndarray, room_db: float) -> dict:
    levels = frame_db(samples)
    voiced = levels > room_db + 6
    speech_db = 10 * np.log10(np.mean(10 ** (levels[voiced] / 10))) if voiced.any() else None
    peak = float(np.max(np.abs(samples)))
    return {
        "peakDbfs": round(20 * np.log10(max(peak, 1e-9)), 1),
        "speechDbfs": None if speech_db is None else round(float(speech_db), 1),
        "roomDbfs": round(room_db, 1),
        "measuredSnrDb": None if speech_db is None else round(float(speech_db - room_db), 1),
        "voicedSeconds": round(float(voiced.sum()) * 0.01, 2),
        "clipped": peak >= 0.999,
    }


def show(lines: list[str]) -> None:
    sys.stdout.write("\033[2J\033[H" + "\n".join(lines) + "\n")
    sys.stdout.flush()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--condition", help="Room condition label in letters, for example quiet or mixer.")
    parser.add_argument("--device", help="Input device name or index. The default is the system input.")
    parser.add_argument("--list-devices", action="store_true", help="List input devices and stop.")
    parser.add_argument("--dry-run", action="store_true", help="Use a macOS voice instead of the microphone.")
    parser.add_argument("--merge-only", action="store_true", help="Only add recorded cases to cases.jsonl.")
    parser.add_argument("--cache", type=Path, default=Path(__file__).parent / ".cache")
    args = parser.parse_args()
    cache: Path = args.cache.resolve()
    if args.list_devices:
        import sounddevice as sd

        print(sd.query_devices())
        return
    if args.merge_only:
        print(f"{merge_human_cases(cache)} recorded cases in cases.jsonl")
        return
    if not args.condition or not re.fullmatch(r"[a-z]+(-[a-z]+)*", args.condition):
        raise SystemExit("--condition needs a label in lowercase letters, for example quiet or mixer")
    condition = args.condition
    folder = cache / "human" / condition
    folder.mkdir(parents=True, exist_ok=True)
    human_cases = cache / "human" / "cases.jsonl"
    recorded = [json.loads(line) for line in human_cases.read_text(encoding="utf-8").splitlines()] \
        if human_cases.exists() else []
    done = {case["caseId"] for case in recorded}

    prompts = plan()
    random.Random(f"bench-{condition}").shuffle(prompts)
    for prompt in prompts:
        prompt["caseId"] = f"{prompt['set']}-{prompt['itemId']}-owner__{condition}"
    pending = [prompt for prompt in prompts if prompt["caseId"] not in done]
    source = SyntheticVoice(cache) if args.dry_run else Microphone(args.device)

    commands: queue.Queue[str] = queue.Queue()
    threading.Thread(target=lambda: [commands.put(line.strip()) for line in sys.stdin], daemon=True).start()

    def beep() -> None:
        if not args.dry_run:
            subprocess.run(["afplay", BEEP], check=False)

    show([f"Condition: {condition}    Microphone: {source.info['name']}",
          f"{len(prompts) - len(pending)} of {len(prompts)} recorded.", "",
          "Stay quiet for three seconds. The room sound is recorded now."])
    room = source.record(ROOM_SECONDS, "")
    if not args.dry_run and not np.any(room):
        raise SystemExit("The microphone gives only silence. Allow microphone access for your terminal app in "
                         "System Settings > Privacy & Security > Microphone, then run the same command again.")
    room_db = float(np.median(frame_db(room)))
    sessions_path = cache / "human" / "sessions.json"
    sessions = json.loads(sessions_path.read_text()) if sessions_path.exists() else []
    sessions.append({"condition": condition, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                     "device": source.info["name"], "deviceRateHz": source.rate, "roomDbfs": round(room_db, 1),
                     "dryRun": args.dry_run, "macos": platform.mac_ver()[0]})
    sessions_path.write_text(json.dumps(sessions, indent=2) + "\n")

    last: dict | None = None
    warning = ""
    while pending:
        if not commands.empty():
            commands.get()
            show(["Paused.", "", "Enter      continue",
                  "r + Enter  record the last phrase again", "q + Enter  stop (run again later to resume)"])
            answer = commands.get()
            if answer == "q":
                break
            if answer == "r" and last is not None:
                (cache / last["path"]).unlink(missing_ok=True)
                recorded = [case for case in recorded if case["caseId"] != last["caseId"]]
                human_cases.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in recorded),
                                       encoding="utf-8")
                pending.insert(0, next(p for p in prompts if p["caseId"] == last["caseId"]))
                last = None
        prompt = pending[0]
        number = len(prompts) - len(pending) + 1
        header = f"[{number}/{len(prompts)}]  {condition}"
        show([header, "", "", f"     {prompt['reference']}", "", "", warning])
        time.sleep(0.2 if args.dry_run else READ_SECONDS)
        beep()
        if not args.dry_run:
            time.sleep(0.25)
        show([header, "", "", f"     {prompt['reference']}", "", "", "  ●  SPEAK NOW"])
        samples = source.record(prompt["window"], prompt["reference"])
        quality = check_take(samples, room_db)
        path = folder / f"{prompt['caseId']}.wav"
        sf.write(path, np.clip(samples, -1, 1).astype(np.float32), SAMPLE_RATE, subtype="PCM_16")
        case = {key: value for key, value in prompt.items() if key != "window"}
        case.update({"language": "en", "voice": "owner", "baseId": prompt["caseId"].split("__")[0],
                     "condition": condition, "noise": condition, "snrDb": None,
                     "path": str(path.relative_to(cache)),
                     "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                     "seconds": round(len(samples) / SAMPLE_RATE, 3), **quality})
        recorded = [c for c in recorded if c["caseId"] != case["caseId"]] + [case]
        human_cases.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in recorded),
                               encoding="utf-8")
        pending.pop(0)
        last = case
        if quality["voicedSeconds"] < 0.3:
            warning = "I could not hear the last phrase over the room sound. To record it again: Enter, then r + Enter."
        elif quality["clipped"]:
            warning = "The last phrase was too loud for the microphone. Step back a little."
        else:
            warning = ""

    total = merge_human_cases(cache)
    remaining = len(pending)
    show([f"Condition {condition}: {len(prompts) - remaining} of {len(prompts)} recorded."
          + (f" Run the same command again to record the other {remaining}." if remaining else " Done."),
          f"{total} recorded cases are in cases.jsonl. The recordings stay in {folder}."])


if __name__ == "__main__":
    main()
