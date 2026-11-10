"""Transcribe bench cases with Deepgram Nova-3 or Flux on Workers AI, through the probe Worker.

Start the probe first, as for workers_ai_run.py. The output has the same shape as
run_model.py, so score.py reads it.

Nova-3 takes the whole utterance over HTTP, like Whisper. computeSeconds is the round
trip from this Mac.

Flux takes a live stream and decides itself when a turn ends. This driver sends the
audio in 80 ms chunks at real time, as a microphone does, then sends silence until
Flux ends the turn. computeSeconds is the time from the end of the file to the last
EndOfTurn; speechEndSeconds adds the silence at the end of the file. Flux therefore
includes its own wait for silence, and Nova-3 and Whisper do not.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import platform
import time
import urllib.parse
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import websockets

import corpus
from workers_ai_run import transcribe

MODELS = {"nova-3": "@cf/deepgram/nova-3", "flux": "@cf/deepgram/flux"}
CHUNK_FRAMES = 1280  # 80 ms at 16 kHz, the Flux recommendation
CHUNK_SECONDS = CHUNK_FRAMES / 16000
SILENCE_LIMIT_SECONDS = 7.0  # past the default eot_timeout_ms of 5 s
SPEECH_RMS = 0.01  # of full scale, in a 20 ms frame


def read_pcm(path: Path) -> bytes:
    with wave.open(str(path), "rb") as handle:
        if (handle.getframerate(), handle.getnchannels(), handle.getsampwidth()) != (16000, 1, 2):
            raise SystemExit(f"{path}: expected 16 kHz mono PCM_16")
        return handle.readframes(handle.getnframes())


def trailing_silence(pcm: bytes) -> float:
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
    frame = 320
    for end in range(len(samples), frame, -frame):
        if np.sqrt(np.mean(samples[end - frame : end] ** 2)) > SPEECH_RMS:
            return (len(samples) - end) / 16000
    return 0.0


async def flux_case(url: str, pcm: bytes) -> dict:
    turns: dict[int, str] = {}
    last_update = ""
    open_turn = False
    audio_end = last_eot = eager = None
    events = 0
    connecting = time.perf_counter()

    async with websockets.connect(url, user_agent_header="stt-bench/1", max_size=None) as socket:
        connect_seconds = time.perf_counter() - connecting
        colo = socket.response.headers.get("x-probe-colo")

        async def receive() -> None:
            nonlocal last_update, open_turn, last_eot, eager, events
            async for message in socket:
                data = json.loads(message)
                if data.get("type") == "Connected":
                    continue
                if data.get("type") != "TurnInfo":
                    raise RuntimeError(f"unexpected Flux message: {message[:200]}")
                events += 1
                kind = data.get("event")
                if kind in ("StartOfTurn", "TurnResumed"):
                    open_turn = True
                elif kind == "EndOfTurn":
                    turns[data.get("turn_index", len(turns))] = data.get("transcript", "")
                    open_turn = False
                    last_eot = time.perf_counter()
                elif kind == "EagerEndOfTurn" and eager is None:
                    eager = time.perf_counter()
                if data.get("transcript"):
                    last_update = data["transcript"]

        receiver = asyncio.create_task(receive())
        began = time.perf_counter()
        step = CHUNK_FRAMES * 2
        chunks = [pcm[i : i + step] for i in range(0, len(pcm), step)]
        for index, chunk in enumerate(chunks):
            await asyncio.sleep(max(0.0, began + (index + 1) * CHUNK_SECONDS - time.perf_counter()))
            if receiver.done():
                receiver.result()
            await socket.send(chunk)
        audio_end = time.perf_counter()

        silence = bytes(step)
        index = 0
        while time.perf_counter() - audio_end < SILENCE_LIMIT_SECONDS:
            if receiver.done():
                receiver.result()
            waited = time.perf_counter() - audio_end
            if waited > 0.3 and not open_turn and last_eot:
                break
            index += 1
            await asyncio.sleep(max(0.0, audio_end + index * CHUNK_SECONDS - time.perf_counter()))
            await socket.send(silence)
        streamed = time.perf_counter() - began
        ended_by_flux = not open_turn and last_eot is not None
        if not ended_by_flux:
            await socket.send(json.dumps({"type": "CloseStream"}))
            try:
                await asyncio.wait_for(receiver, 5)
            except (asyncio.TimeoutError, websockets.ConnectionClosed):
                pass
        receiver.cancel()

    text = " ".join(turns[k] for k in sorted(turns) if turns[k].strip())
    if not text or (not ended_by_flux and last_update not in text):
        text = (text + " " + last_update).strip()
    return {"hypothesis": text.strip(), "turns": len(turns), "endedByFlux": ended_by_flux,
            "eotSeconds": None if last_eot is None else last_eot - audio_end,
            "eagerSeconds": None if eager is None else eager - audio_end,
            "streamedSeconds": streamed, "connectSeconds": connect_seconds, "colo": colo, "events": events}


def pct(values: list, p: float) -> float | None:
    return values[min(len(values) - 1, int(round(p * (len(values) - 1))))] if values else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", choices=sorted(MODELS), required=True)
    parser.add_argument("--url", default="http://localhost:8787")
    parser.add_argument("--language", choices=("en", "ja"), required=True)
    parser.add_argument("--set", dest="set_name", required=True)
    parser.add_argument("--vocabulary", action="store_true", help="Pass the shop vocabulary as keyterm.")
    parser.add_argument("--eot-threshold", help="Flux eot_threshold (model default 0.7).")
    parser.add_argument("--eager-eot-threshold", help="Flux eager_eot_threshold (off by default).")
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
    vocabulary = (corpus.VOCABULARY_EN if args.language == "en" else corpus.VOCABULARY_JA) if args.vocabulary else []

    def run_nova(case: dict) -> dict:
        audio = base64.b64encode((cache / case["path"]).read_bytes()).decode()
        answer = transcribe(f"{args.url}/nova-3", {"audio": audio, "language": args.language,
                                                   "keyterm": vocabulary or None})
        if "error" in answer:
            raise SystemExit(f"{case['caseId']}: {answer['error']}")
        return {"caseId": case["caseId"], "hypothesis": answer["text"].strip(),
                "computeSeconds": round(answer["seconds"], 4), "aiMs": answer["aiMs"], "colo": answer["colo"],
                "attempts": answer["attempts"]}

    query: list[tuple[str, str]] = [("keyterm", term) for term in vocabulary]
    if args.eot_threshold:
        query.append(("eot_threshold", args.eot_threshold))
    if args.eager_eot_threshold:
        query.append(("eager_eot_threshold", args.eager_eot_threshold))
    ws_url = args.url.replace("http", "ws", 1) + "/flux?" + urllib.parse.urlencode(query)

    async def run_flux(case: dict, gate: asyncio.Semaphore) -> dict:
        pcm = read_pcm(cache / case["path"])
        async with gate:
            for attempt in range(4):
                try:
                    result = await asyncio.wait_for(flux_case(ws_url, pcm), case["seconds"] + 30)
                    break
                except (OSError, asyncio.TimeoutError, websockets.WebSocketException, RuntimeError) as error:
                    print(f"retry {attempt + 1} {case['caseId']}: {error!r}", flush=True)
                    await asyncio.sleep(2 ** attempt)
            else:
                raise SystemExit(f"{case['caseId']}: Flux failed after 4 attempts")
        silence = trailing_silence(pcm)
        eot = result["eotSeconds"]
        return {"caseId": case["caseId"], "hypothesis": result["hypothesis"],
                "computeSeconds": round(eot if eot is not None else result["streamedSeconds"] - case["seconds"], 4),
                "speechEndSeconds": None if eot is None else round(eot + silence, 4),
                "eagerSpeechEndSeconds": (None if result["eagerSeconds"] is None
                                          else round(result["eagerSeconds"] + silence, 4)),
                "trailingSilence": silence, "turns": result["turns"], "endedByFlux": result["endedByFlux"],
                "streamedSeconds": round(result["streamedSeconds"], 3),
                "connectSeconds": round(result["connectSeconds"], 3), "colo": result["colo"], "attempts": attempt + 1}

    async def run_all_flux() -> list[dict]:
        gate = asyncio.Semaphore(args.workers)
        return await asyncio.gather(*(run_flux(case, gate) for case in cases))

    if args.model == "nova-3":
        run_nova(cases[0])  # warm the probe
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            outputs = list(pool.map(run_nova, cases))
        colos = sorted({o["colo"] for o in outputs if o["colo"]})
    else:
        outputs = asyncio.run(run_all_flux())
        colos = sorted({o["colo"] for o in outputs if o["colo"]})

    run_id = (f"workers-ai-{args.model}-{args.language}" + ("-vocab" if args.vocabulary else "")
              + (f"-eot{args.eot_threshold}" if args.eot_threshold else "")
              + (f"-eager{args.eager_eot_threshold}" if args.eager_eot_threshold else "")
              + f"-{args.set_name}"
              + (f"-{args.condition.replace(',', '+')}" if args.condition else "")
              + (f"-{args.tag}" if args.tag else "") + (f"-first{args.limit}" if args.limit else ""))
    runs = cache / "runs"
    runs.mkdir(exist_ok=True)
    with (runs / f"{run_id}.jsonl").open("w", encoding="utf-8") as handle:
        for output in outputs:
            handle.write(json.dumps(output, ensure_ascii=False) + "\n")
    seconds = sorted(o["computeSeconds"] for o in outputs)
    total_audio = sum(c["seconds"] for c in cases)
    summary = {
        "runId": run_id, "model": f"workers-ai-{args.model}", "language": args.language,
        "vocabulary": args.vocabulary, "set": args.set_name,
        "identity": {"model": MODELS[args.model], "runtime": "Workers AI binding, probe Worker through wrangler dev --remote",
                     "mipOptOut": True, "smartFormat": args.model == "nova-3", "eotThreshold": args.eot_threshold,
                     "eagerEotThreshold": args.eager_eot_threshold, "parallelRequests": args.workers, "files": []},
        "host": {"macos": platform.mac_ver()[0], "machine": platform.machine()},
        "caseCount": len(cases), "loadSeconds": 0.0, "audioSeconds": round(total_audio, 1),
        "computeSeconds": round(sum(seconds), 1), "realTimeFactor": round(sum(seconds) / total_audio, 4),
        "peakResidentBytes": 0, "peakGpuBytes": 0, "modelBytes": 0,
        "roundTripSeconds": {"p50": pct(seconds, 0.5), "p95": pct(seconds, 0.95), "max": seconds[-1]},
        "colos": colos, "retriedRequests": sum(o["attempts"] > 1 for o in outputs),
    }
    if args.model == "flux":
        speech = sorted(o["speechEndSeconds"] for o in outputs if o["speechEndSeconds"] is not None)
        eager = sorted(o["eagerSpeechEndSeconds"] for o in outputs if o["eagerSpeechEndSeconds"] is not None)
        summary["speechEndSeconds"] = {"p50": pct(speech, 0.5), "p95": pct(speech, 0.95), "max": speech[-1] if speech else None}
        summary["eagerSpeechEndSeconds"] = {"p50": pct(eager, 0.5), "p95": pct(eager, 0.95), "count": len(eager)}
        connect = sorted(o["connectSeconds"] for o in outputs)
        summary["connectSeconds"] = {"p50": pct(connect, 0.5), "p95": pct(connect, 0.95), "max": connect[-1]}
        summary["streamedAudioSeconds"] = round(sum(o["streamedSeconds"] for o in outputs), 1)
        summary["splitIntoTurns"] = sum(o["turns"] > 1 for o in outputs)
        summary["notEndedByFlux"] = sum(not o["endedByFlux"] for o in outputs)
    (runs / f"{run_id}.summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "identity"}))


if __name__ == "__main__":
    main()
