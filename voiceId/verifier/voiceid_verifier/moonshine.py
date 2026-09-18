from __future__ import annotations

import math
import re
import threading
from collections import Counter
from dataclasses import dataclass
from typing import Any, Callable, Literal, Mapping, Sequence

from voiceid_verifier.audio_decode import MAXIMUM_DECODE_DURATION_MS, zero_float_sequence


CANONICAL_SAMPLE_RATE_HZ = 16000
STREAM_UPDATE_INTERVAL_SECONDS = 0.5
STREAM_CHUNK_SAMPLES = 1600
MAXIMUM_STREAM_SAMPLES = CANONICAL_SAMPLE_RATE_HZ * MAXIMUM_DECODE_DURATION_MS // 1000
MODEL_ARCHES = {
    "tiny_streaming": 2,
    "small_streaming": 4,
}
DEFAULT_INTENT_PHRASES = {
    "approve": "approve this request",
    "reject": "reject this request",
    "cancel": "cancel this request",
    "repeat": "repeat the challenge",
    "unrelated": "unrelated statement",
}


MoonshinePhraseKind = Literal["accepted", "uncertain", "rejected"]
MoonshineIntentKind = Literal["accepted", "uncertain", "rejected"]


@dataclass(frozen=True)
class MoonshinePhraseDecision:
    kind: MoonshinePhraseKind
    expected_normalized: str
    spoken_normalized: str
    confidence: float
    reason: str | None

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "expectedNormalized": self.expected_normalized,
            "spokenNormalized": self.spoken_normalized,
            "confidence": self.confidence,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class MoonshineIntentDecision:
    kind: MoonshineIntentKind
    intent: str | None
    canonical_phrase: str | None
    confidence: float
    runner_up_intent: str | None
    runner_up_confidence: float
    reason: str | None

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "intent": self.intent,
            "canonicalPhrase": self.canonical_phrase,
            "confidence": self.confidence,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class MoonshineSpeechAnalysis:
    transcript: str
    phrase: MoonshinePhraseDecision
    intent: MoonshineIntentDecision
    sample_rate_hz: int

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": "speech_analysis",
            "requestId": "embedded",
            "transcript": self.transcript,
            "phrase": self.phrase.to_json(),
            "intent": self.intent.to_json(),
            "sampleRateHz": self.sample_rate_hz,
        }


@dataclass(frozen=True)
class MoonshineTranscript:
    kind: Literal["partial", "final"]
    text: str


@dataclass(frozen=True)
class MoonshineTranscriptLine:
    line_id: int
    start_time: float
    text: str
    is_complete: bool


class MoonshineTranscriptStream:
    """Own one bounded utterance and its native decoder until finish or close."""

    def __init__(self, transcriber: Any) -> None:
        self._transcriber = transcriber
        self._lock = threading.Lock()
        self._state: Literal["active", "finished", "cancelled", "failed"] = "active"
        self._sample_count = 0
        self._lines: dict[int, MoonshineTranscriptLine] = {}
        self._error: Exception | None = None
        try:
            self._stream = transcriber.create_stream()
        except BaseException:
            transcriber.close()
            raise
        try:
            self._stream.add_listener(self._on_event)
            self._stream.start()
            self._raise_stream_error()
        except BaseException:
            self._close_locked("failed")
            raise

    def __enter__(self) -> MoonshineTranscriptStream:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def add_audio(self, samples: Sequence[float]) -> MoonshineTranscript:
        with self._lock:
            self._require_active()
            audio_chunk: list[float] = []
            try:
                if not 0 < len(samples) <= STREAM_CHUNK_SAMPLES:
                    raise ValueError(
                        f"audio chunks must contain 1-{STREAM_CHUNK_SAMPLES} samples"
                    )
                if self._sample_count + len(samples) > MAXIMUM_STREAM_SAMPLES:
                    raise ValueError("utterance exceeds the maximum duration")
                audio_chunk = list(samples)
                if any(not math.isfinite(value) or abs(value) > 1 for value in audio_chunk):
                    raise ValueError("PCM samples must be finite values between -1 and 1")
                self._stream.add_audio(audio_chunk, sample_rate=CANONICAL_SAMPLE_RATE_HZ)
                self._raise_stream_error()
                self._sample_count += len(audio_chunk)
                return MoonshineTranscript(kind="partial", text=self._text())
            except BaseException:
                self._close_locked("failed")
                raise
            finally:
                zero_float_sequence(audio_chunk)

    def finish(self) -> MoonshineTranscript:
        with self._lock:
            self._require_active()
            try:
                if self._sample_count == 0:
                    raise ValueError("canonical PCM samples must not be empty")
                # Moonshine stop() drains the tail but reports some errors as events.
                result = self._stream.stop()
                self._raise_stream_error()
                if result is None:
                    raise RuntimeError("Moonshine stream stopped without a final transcript")
                for line in result.lines:
                    self._record_line(line)
                if any(not line.is_complete for line in self._lines.values()):
                    raise RuntimeError("Moonshine stream returned an incomplete final transcript")
                transcript = MoonshineTranscript(kind="final", text=self._text())
            except BaseException:
                self._close_locked("failed")
                raise
            self._close_locked("finished")
            return transcript

    def close(self) -> None:
        with self._lock:
            if self._state == "active":
                self._close_locked("cancelled")

    def _require_active(self) -> None:
        if self._state != "active":
            raise RuntimeError(f"Moonshine stream is {self._state}")

    def _raise_stream_error(self) -> None:
        if self._error is not None:
            raise self._error

    def _on_event(self, event: Any) -> None:
        if self._state != "active":
            return
        try:
            error = getattr(event, "error", None)
            if error is not None:
                raise error
            self._record_line(event.line)
        except Exception as error:
            # The upstream listener dispatcher swallows raised callback errors.
            if self._error is None:
                self._error = error

    def _record_line(self, line: Any) -> None:
        try:
            self._lines[line.line_id] = MoonshineTranscriptLine(
                line_id=line.line_id,
                start_time=line.start_time,
                text=line.text.strip(),
                is_complete=line.is_complete,
            )
        finally:
            audio_data = getattr(line, "audio_data", None)
            if audio_data is not None:
                zero_float_sequence(audio_data)

    def _text(self) -> str:
        lines = sorted(self._lines.values(), key=transcript_line_order)
        return " ".join(line.text for line in lines if line.text)

    def _close_locked(
        self,
        state: Literal["finished", "cancelled", "failed"],
    ) -> None:
        self._state = state
        self._lines.clear()
        self._error = None
        try:
            try:
                self._stream.close()
            finally:
                self._transcriber.close()
        except BaseException:
            self._state = "failed"
            raise


def transcript_line_order(line: MoonshineTranscriptLine) -> tuple[float, int]:
    return line.start_time, line.line_id


class MoonshineRecognizer:
    """Stream local speech; evaluate completed fixture utterances for phrase/intent."""

    def __init__(
        self,
        *,
        model_path: str,
        model_arch: str,
        intent_model_path: str,
        intent_threshold: float = 0.8,
        intent_margin: float = 0.1,
        intent_phrases: Mapping[str, str] | None = None,
        transcriber_factory: Callable[..., Any] | None = None,
        intent_factory: Callable[..., Any] | None = None,
    ) -> None:
        if model_arch not in MODEL_ARCHES:
            raise ValueError("model_arch must be tiny_streaming or small_streaming")
        if not 0 <= intent_threshold <= 1:
            raise ValueError("intent_threshold must be between 0 and 1")
        if not 0 <= intent_margin <= 1:
            raise ValueError("intent_margin must be between 0 and 1")
        factories = load_moonshine_factories(transcriber_factory, intent_factory)
        self._transcriber_factory = factories.transcriber
        self._model_path = model_path
        self._model_arch_value = model_arch_for_constructor(
            model_arch,
            transcriber_factory,
        )
        readiness_transcriber = self._new_transcriber()
        readiness_transcriber.close()
        self._intent_recognizer = factories.intent(
            intent_model_path,
            threshold=intent_threshold,
            model_variant="q4",
        )
        self._intent_threshold = intent_threshold
        self._intent_margin = intent_margin
        self._intent_phrases = dict(intent_phrases or DEFAULT_INTENT_PHRASES)
        validate_intent_phrases(self._intent_phrases)
        for canonical_phrase in self._intent_phrases.values():
            self._intent_recognizer.register_intent(canonical_phrase)
        self._lock = threading.Lock()

    def analyze(
        self,
        samples: Sequence[float],
        *,
        expected_phrase: str,
        intent_name: str,
        challenge_tokens: Sequence[str],
    ) -> MoonshineSpeechAnalysis:
        with self._lock:
            return self._analyze_locked(
                samples,
                expected_phrase=expected_phrase,
                intent_name=intent_name,
                challenge_tokens=challenge_tokens,
            )

    def _analyze_locked(
        self,
        samples: Sequence[float],
        *,
        expected_phrase: str,
        intent_name: str,
        challenge_tokens: Sequence[str],
    ) -> MoonshineSpeechAnalysis:
        if len(samples) == 0:
            raise ValueError("canonical PCM samples must not be empty")
        if expected_phrase.strip() == "" or intent_name.strip() == "":
            raise ValueError("expected_phrase and intent_name must be non-empty")
        if intent_name not in self._intent_phrases:
            raise ValueError("intent_name must belong to the closed intent set")
        normalized_challenge_tokens = tuple(
            normalize_transcript(token)
            for token in challenge_tokens
        )
        if len(normalized_challenge_tokens) == 0 or any(
            token == "" or " " in token
            for token in normalized_challenge_tokens
        ):
            raise ValueError("challenge_tokens must contain normalized non-empty tokens")
        raw_transcript = self._transcribe(samples)
        transcript = normalize_transcript(raw_transcript)
        spoken_normalized = transcript
        expected_normalized = normalize_transcript(expected_phrase)
        matches = self._intent_matches(transcript)
        phrase = build_phrase_decision(
            expected_normalized=expected_normalized,
            spoken_normalized=spoken_normalized,
            challenge_tokens=normalized_challenge_tokens,
        )
        intent = build_intent_decision(
            intent_name,
            matches,
            self._intent_threshold,
            self._intent_margin,
            self._intent_phrases,
        )
        return MoonshineSpeechAnalysis(
            transcript=transcript,
            phrase=phrase,
            intent=intent,
            sample_rate_hz=CANONICAL_SAMPLE_RATE_HZ,
        )

    def _transcribe(self, samples: Sequence[float]) -> str:
        with self.start_stream() as stream:
            for offset in range(0, len(samples), STREAM_CHUNK_SAMPLES):
                end = min(offset + STREAM_CHUNK_SAMPLES, len(samples))
                chunk = [samples[index] for index in range(offset, end)]
                try:
                    stream.add_audio(chunk)
                finally:
                    zero_float_sequence(chunk)
            return stream.finish().text

    def start_stream(self) -> MoonshineTranscriptStream:
        return MoonshineTranscriptStream(self._new_transcriber())

    def _new_transcriber(self) -> Any:
        return self._transcriber_factory(
            self._model_path,
            model_arch=self._model_arch_value,
            update_interval=STREAM_UPDATE_INTERVAL_SECONDS,
        )

    def _intent_matches(self, transcript: str) -> Sequence[Any]:
        if transcript == "":
            return ()
        return self._intent_recognizer.get_closest_intents(
            transcript,
            tolerance_threshold=self._intent_threshold,
        )


@dataclass(frozen=True)
class MoonshineFactories:
    transcriber: Callable[..., Any]
    intent: Callable[..., Any]


def load_moonshine_factories(
    transcriber_factory: Callable[..., Any] | None,
    intent_factory: Callable[..., Any] | None,
) -> MoonshineFactories:
    if transcriber_factory is not None and intent_factory is not None:
        return MoonshineFactories(transcriber_factory, intent_factory)
    if transcriber_factory is not None or intent_factory is not None:
        raise ValueError("transcriber_factory and intent_factory must be provided together")
    try:
        from moonshine_voice import IntentRecognizer, Transcriber
    except ImportError as exc:
        raise RuntimeError("moonshine-voice is required for Moonshine recognition") from exc
    return MoonshineFactories(Transcriber, IntentRecognizer)


def model_arch_for_constructor(model_arch: str, transcriber_factory: Callable[..., Any] | None) -> Any:
    if transcriber_factory is not None:
        return MODEL_ARCHES[model_arch]
    from moonshine_voice import ModelArch

    return ModelArch(MODEL_ARCHES[model_arch])


def normalize_transcript(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def validate_intent_phrases(intent_phrases: Mapping[str, str]) -> None:
    if len(intent_phrases) == 0:
        raise ValueError("intent_phrases must not be empty")
    normalized_phrases = tuple(
        normalize_transcript(phrase)
        for phrase in intent_phrases.values()
    )
    if any(name.strip() == "" for name in intent_phrases):
        raise ValueError("intent names must be non-empty")
    if any(phrase == "" for phrase in normalized_phrases):
        raise ValueError("canonical intent phrases must be non-empty")
    if len(set(normalized_phrases)) != len(normalized_phrases):
        raise ValueError("canonical intent phrases must be unique")


def build_phrase_decision(
    *,
    expected_normalized: str,
    spoken_normalized: str,
    challenge_tokens: Sequence[str],
) -> MoonshinePhraseDecision:
    if spoken_normalized == "":
        return MoonshinePhraseDecision(
            kind="uncertain",
            expected_normalized=expected_normalized,
            spoken_normalized=spoken_normalized,
            confidence=0.0,
            reason="transcript_unavailable",
        )
    expected_counts = Counter(challenge_tokens)
    spoken_counts = Counter(spoken_normalized.split())
    matched_count = sum(
        min(expected_count, spoken_counts[token])
        for token, expected_count in expected_counts.items()
    )
    expected_count = sum(expected_counts.values())
    coverage = matched_count / expected_count
    if coverage == 1:
        return MoonshinePhraseDecision(
            kind="accepted",
            expected_normalized=expected_normalized,
            spoken_normalized=spoken_normalized,
            confidence=coverage,
            reason=None,
        )
    return MoonshinePhraseDecision(
        kind="rejected",
        expected_normalized=expected_normalized,
        spoken_normalized=spoken_normalized,
        confidence=coverage,
        reason="phrase_mismatch",
    )


def build_intent_decision(
    expected_intent: str,
    matches: Sequence[Any],
    threshold: float,
    margin: float,
    intent_phrases: Mapping[str, str],
) -> MoonshineIntentDecision:
    if not matches:
        return MoonshineIntentDecision(
            kind="uncertain",
            intent=None,
            canonical_phrase=None,
            confidence=0.0,
            runner_up_intent=None,
            runner_up_confidence=0.0,
            reason="intent_unavailable",
        )
    match = matches[0]
    canonical_phrase = str(getattr(match, "canonical_phrase", ""))
    confidence = float(getattr(match, "similarity", 0.0))
    runner_up_confidence = (
        float(getattr(matches[1], "similarity", 0.0))
        if len(matches) > 1
        else 0.0
    )
    matched_intent = intent_name_for_canonical_phrase(canonical_phrase, intent_phrases)
    runner_up_intent = (
        intent_name_for_canonical_phrase(
            str(getattr(matches[1], "canonical_phrase", "")),
            intent_phrases,
        )
        if len(matches) > 1
        else None
    )
    if confidence < threshold or confidence - runner_up_confidence < margin:
        return MoonshineIntentDecision(
            kind="uncertain",
            intent=matched_intent,
            canonical_phrase=canonical_phrase or None,
            confidence=confidence,
            runner_up_intent=runner_up_intent,
            runner_up_confidence=runner_up_confidence,
            reason="intent_low_confidence",
        )
    if matched_intent == expected_intent:
        return MoonshineIntentDecision(
            kind="accepted",
            intent=expected_intent,
            canonical_phrase=canonical_phrase,
            confidence=confidence,
            runner_up_intent=runner_up_intent,
            runner_up_confidence=runner_up_confidence,
            reason=None,
        )
    return MoonshineIntentDecision(
        kind="rejected",
        intent=matched_intent,
        canonical_phrase=canonical_phrase or None,
        confidence=confidence,
        runner_up_intent=runner_up_intent,
        runner_up_confidence=runner_up_confidence,
        reason="intent_mismatch",
    )


def intent_name_for_canonical_phrase(
    canonical_phrase: str,
    intent_phrases: Mapping[str, str],
) -> str | None:
    for intent_name, phrase in intent_phrases.items():
        if phrase == canonical_phrase:
            return intent_name
    return None
