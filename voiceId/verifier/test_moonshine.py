from __future__ import annotations

import unittest
from dataclasses import dataclass
from typing import Callable

from voiceid_verifier.moonshine import (
    MAXIMUM_STREAM_SAMPLES,
    STREAM_CHUNK_SAMPLES,
    MoonshineRecognizer,
    MoonshineTranscriptStream,
    normalize_transcript,
)


@dataclass(frozen=True)
class FakeLine:
    text: str
    line_id: int = 1
    start_time: float = 0.0
    is_complete: bool = True


@dataclass(frozen=True)
class FakeTranscript:
    lines: tuple[FakeLine, ...]


@dataclass(frozen=True)
class FakeMatch:
    canonical_phrase: str
    similarity: float


@dataclass(frozen=True)
class FakeEvent:
    line: FakeLine


@dataclass(frozen=True)
class FakeErrorEvent:
    error: Exception


class FakeStream:
    def __init__(self, transcriber: FakeTranscriber) -> None:
        self.transcriber = transcriber
        self.listeners: list[Callable[[FakeEvent | FakeErrorEvent], None]] = []
        self.started = False
        self.stopped = False
        self.closed = False
        self.samples: list[float] = []

    def add_listener(self, listener: Callable[[FakeEvent | FakeErrorEvent], None]) -> None:
        self.listeners.append(listener)

    def start(self) -> None:
        self.started = True

    def add_audio(self, samples: list[float], sample_rate: int) -> None:
        if not self.started or self.stopped or self.closed:
            raise RuntimeError("native stream is inactive")
        self.transcriber.sample_references.append(samples)
        self.transcriber.last_sample_rate = sample_rate
        self.samples.extend(samples)
        self.emit_transcript(self.transcriber.transcript_for_audio(self.samples))

    def stop(self) -> FakeTranscript | None:
        self.stopped = True
        try:
            transcript = self.transcriber.transcript_for_audio(self.samples)
            self.emit_transcript(transcript)
            return transcript
        except Exception as error:
            self.emit(FakeErrorEvent(error))
            return None

    def emit_transcript(self, transcript: FakeTranscript) -> None:
        for line in transcript.lines:
            self.emit(FakeEvent(line))

    def emit(self, event: FakeEvent | FakeErrorEvent) -> None:
        for listener in self.listeners:
            listener(event)

    def close(self) -> None:
        self.closed = True
        self.listeners.clear()
        self.samples.clear()


class FakeTranscriber:
    stream_type = FakeStream

    def __init__(self, *args: object, **kwargs: object) -> None:
        self.closed = False
        self.last_sample_rate: int | None = None
        self.sample_references: list[list[float]] = []
        self.streams: list[FakeStream] = []

    def create_stream(self) -> FakeStream:
        stream = self.stream_type(self)
        self.streams.append(stream)
        return stream

    def transcript_for_audio(self, samples: list[float]) -> FakeTranscript:
        if len(samples) == 0:
            return FakeTranscript(lines=())
        return FakeTranscript(lines=(FakeLine("Please approve this transfer"),))

    def close(self) -> None:
        self.closed = True


class EmptyTranscriber(FakeTranscriber):
    def transcript_for_audio(self, samples: list[float]) -> FakeTranscript:
        return FakeTranscript(lines=())


class InspectingTranscriber(FakeTranscriber):
    instances: list[InspectingTranscriber] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self.instances.append(self)


class StatefulTranscriber(FakeTranscriber):
    instances: list[StatefulTranscriber] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self.instances.append(self)
        self.previous_signature: float | None = None

    def transcript_for_audio(self, samples: list[float]) -> FakeTranscript:
        signature = samples[0]
        contaminated = (
            self.previous_signature is not None
            and self.previous_signature != signature
        )
        self.previous_signature = signature
        suffix = " contaminated" if contaminated else ""
        return FakeTranscript(
            lines=(FakeLine(f"Please approve this transfer{suffix}"),)
        )


class FailingTranscriber(FakeTranscriber):
    instances: list[FailingTranscriber] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self.instances.append(self)

    def transcript_for_audio(self, samples: list[float]) -> FakeTranscript:
        raise RuntimeError("injected transcription failure")


class FakeIntentRecognizer:
    def __init__(self, *args: object, **kwargs: object) -> None:
        self.registered: list[str] = []

    def register_intent(self, canonical_phrase: str) -> None:
        self.registered.append(canonical_phrase)

    def get_closest_intents(self, utterance: str, tolerance_threshold: float) -> list[FakeMatch]:
        if not self.registered:
            return []
        canonical_phrase = next(
            (phrase for phrase in self.registered if phrase.startswith("approve")),
            self.registered[0],
        )
        return [FakeMatch(canonical_phrase=canonical_phrase, similarity=0.91)]


class MoonshineRecognizerTest(unittest.TestCase):
    def test_uses_canonical_pcm_and_separates_semantic_intent_from_exact_phrase(self) -> None:
        recognizer = MoonshineRecognizer(
            model_path="tiny",
            model_arch="tiny_streaming",
            intent_model_path="intent",
            transcriber_factory=FakeTranscriber,
            intent_factory=FakeIntentRecognizer,
        )
        result = recognizer.analyze(
            [0.1, -0.1],
            expected_phrase="approve transfer",
            intent_name="approve",
            challenge_tokens=("approve", "transfer"),
        )

        self.assertEqual(result.sample_rate_hz, 16000)
        self.assertEqual(result.intent.kind, "accepted")
        self.assertEqual(result.intent.intent, "approve")
        self.assertEqual(result.phrase.kind, "accepted")
        self.assertEqual(result.transcript, "please approve this transfer")
        self.assertNotEqual(result.phrase.expected_normalized, result.phrase.spoken_normalized)
        self.assertEqual(normalize_transcript("Approve, transfer!"), "approve transfer")

    def test_empty_transcript_is_uncertain_and_not_an_intent_rejection(self) -> None:
        recognizer = MoonshineRecognizer(
            model_path="tiny",
            model_arch="tiny_streaming",
            intent_model_path="intent",
            transcriber_factory=EmptyTranscriber,
            intent_factory=FakeIntentRecognizer,
        )
        result = recognizer.analyze(
            [0.1],
            expected_phrase="approve transfer",
            intent_name="approve",
            challenge_tokens=("approve", "transfer"),
        )

        self.assertEqual(result.phrase.kind, "uncertain")
        self.assertEqual(result.intent.kind, "uncertain")

    def test_accepts_fresh_challenge_tokens_in_any_order(self) -> None:
        recognizer = MoonshineRecognizer(
            model_path="tiny",
            model_arch="tiny_streaming",
            intent_model_path="intent",
            transcriber_factory=ReorderedTokenTranscriber,
            intent_factory=FakeIntentRecognizer,
        )

        result = recognizer.analyze(
            [0.1],
            expected_phrase="approve this request maple eight star",
            intent_name="approve",
            challenge_tokens=("maple", "eight", "star"),
        )

        self.assertEqual(result.phrase.kind, "accepted")
        self.assertEqual(result.intent.kind, "accepted")

    def test_rejects_semantically_correct_utterance_missing_a_fresh_token(self) -> None:
        recognizer = MoonshineRecognizer(
            model_path="tiny",
            model_arch="tiny_streaming",
            intent_model_path="intent",
            transcriber_factory=MissingTokenTranscriber,
            intent_factory=FakeIntentRecognizer,
        )

        result = recognizer.analyze(
            [0.1],
            expected_phrase="approve this request maple eight star",
            intent_name="approve",
            challenge_tokens=("maple", "eight", "star"),
        )

        self.assertEqual(result.phrase.kind, "rejected")
        self.assertEqual(result.intent.kind, "accepted")

    def test_zeroes_the_transcriber_pcm_copy_after_every_terminal_result(self) -> None:
        InspectingTranscriber.instances.clear()
        recognizer = MoonshineRecognizer(
            model_path="tiny",
            model_arch="tiny_streaming",
            intent_model_path="intent",
            transcriber_factory=InspectingTranscriber,
            intent_factory=FakeIntentRecognizer,
        )

        result = recognizer.analyze(
            [0.1, -0.2, 0.3],
            expected_phrase="approve transfer",
            intent_name="approve",
            challenge_tokens=("approve", "transfer"),
        )

        self.assertEqual(result.phrase.kind, "accepted")
        sample_references = InspectingTranscriber.instances[-1].sample_references
        self.assertEqual(len(sample_references), 1)
        self.assertTrue(
            all(value == 0.0 for value in sample_references[0])
        )
        self.assertEqual(len(InspectingTranscriber.instances), 2)
        self.assertTrue(
            all(transcriber.closed for transcriber in InspectingTranscriber.instances)
        )

    def test_uses_a_fresh_native_transcriber_handle_for_every_request(self) -> None:
        StatefulTranscriber.instances.clear()
        recognizer = MoonshineRecognizer(
            model_path="tiny",
            model_arch="tiny_streaming",
            intent_model_path="intent",
            transcriber_factory=StatefulTranscriber,
            intent_factory=FakeIntentRecognizer,
        )

        first_a = recognizer.analyze(
            [0.1],
            expected_phrase="approve transfer",
            intent_name="approve",
            challenge_tokens=("approve", "transfer"),
        )
        recognizer.analyze(
            [-0.1],
            expected_phrase="approve transfer",
            intent_name="approve",
            challenge_tokens=("approve", "transfer"),
        )
        second_a = recognizer.analyze(
            [0.1],
            expected_phrase="approve transfer",
            intent_name="approve",
            challenge_tokens=("approve", "transfer"),
        )

        self.assertEqual(first_a, second_a)
        self.assertEqual(len(StatefulTranscriber.instances), 4)
        self.assertTrue(
            all(transcriber.closed for transcriber in StatefulTranscriber.instances)
        )

    def test_closes_the_handle_and_zeroes_pcm_after_transcription_failure(self) -> None:
        FailingTranscriber.instances.clear()
        recognizer = MoonshineRecognizer(
            model_path="tiny",
            model_arch="tiny_streaming",
            intent_model_path="intent",
            transcriber_factory=FailingTranscriber,
            intent_factory=FakeIntentRecognizer,
        )

        with self.assertRaisesRegex(RuntimeError, "injected transcription failure"):
            recognizer.analyze(
                [0.1, -0.2],
                expected_phrase="approve transfer",
                intent_name="approve",
                challenge_tokens=("approve", "transfer"),
            )

        self.assertEqual(len(FailingTranscriber.instances), 2)
        self.assertTrue(
            all(transcriber.closed for transcriber in FailingTranscriber.instances)
        )
        self.assertTrue(
            all(value == 0.0 for value in FailingTranscriber.instances[-1].sample_references[0])
        )

    def test_registers_the_closed_intent_set_once_and_reuses_it(self) -> None:
        recognizer = MoonshineRecognizer(
            model_path="tiny",
            model_arch="tiny_streaming",
            intent_model_path="intent",
            transcriber_factory=FakeTranscriber,
            intent_factory=FakeIntentRecognizer,
        )
        intent_recognizer = recognizer._intent_recognizer
        initially_registered = tuple(intent_recognizer.registered)

        first = recognizer.analyze(
            [0.1],
            expected_phrase="approve transfer",
            intent_name="approve",
            challenge_tokens=("approve", "transfer"),
        )
        second = recognizer.analyze(
            [0.1],
            expected_phrase="approve transfer",
            intent_name="approve",
            challenge_tokens=("approve", "transfer"),
        )

        self.assertEqual(first, second)
        self.assertEqual(tuple(intent_recognizer.registered), initially_registered)
        self.assertEqual(len(initially_registered), 5)

    def test_rejects_intents_outside_the_closed_set(self) -> None:
        recognizer = MoonshineRecognizer(
            model_path="tiny",
            model_arch="tiny_streaming",
            intent_model_path="intent",
            transcriber_factory=FakeTranscriber,
            intent_factory=FakeIntentRecognizer,
        )

        with self.assertRaisesRegex(ValueError, "closed intent set"):
            recognizer.analyze(
                [0.1],
                expected_phrase="transfer funds",
                intent_name="transfer_funds",
                challenge_tokens=("transfer", "funds"),
            )


class ReorderedTokenTranscriber(FakeTranscriber):
    def transcript_for_audio(self, samples: list[float]) -> FakeTranscript:
        return FakeTranscript(
            lines=(FakeLine("Please approve this request. Star maple eight."),)
        )


class MissingTokenTranscriber(FakeTranscriber):
    def transcript_for_audio(self, samples: list[float]) -> FakeTranscript:
        return FakeTranscript(
            lines=(FakeLine("Please approve this request. Maple star."),)
        )


class FinalTailStream(FakeStream):
    def stop(self) -> FakeTranscript:
        self.stopped = True
        transcript = FakeTranscript(
            lines=(FakeLine("this transfer", line_id=2, start_time=1.0),)
        )
        self.emit_transcript(transcript)
        return transcript


class RevisingTranscriber(FakeTranscriber):
    stream_type = FinalTailStream

    def transcript_for_audio(self, samples: list[float]) -> FakeTranscript:
        if len(samples) == 1:
            return FakeTranscript(lines=(FakeLine("please approve", is_complete=False),))
        return FakeTranscript(lines=(FakeLine("please reject"),))


class StopErrorStream(FakeStream):
    def stop(self) -> None:
        self.stopped = True
        self.emit(FakeErrorEvent(RuntimeError("injected final decode failure")))


class StopErrorTranscriber(FakeTranscriber):
    stream_type = StopErrorStream


class NoFinalResultStream(FakeStream):
    def stop(self) -> None:
        self.stopped = True


class NoFinalResultTranscriber(FakeTranscriber):
    stream_type = NoFinalResultStream


class IncompleteTranscriber(FakeTranscriber):
    def transcript_for_audio(self, samples: list[float]) -> FakeTranscript:
        return FakeTranscript(lines=(FakeLine("unfinished", is_complete=False),))


class FailingStartStream(FakeStream):
    def start(self) -> None:
        raise RuntimeError("injected start failure")


class FailingStartTranscriber(FakeTranscriber):
    stream_type = FailingStartStream


class FailingCreateTranscriber(FakeTranscriber):
    def create_stream(self) -> FakeStream:
        raise RuntimeError("injected create failure")


class FailingCloseStream(FakeStream):
    def close(self) -> None:
        super().close()
        raise RuntimeError("injected close failure")


class FailingCloseTranscriber(FakeTranscriber):
    stream_type = FailingCloseStream


class MoonshineTranscriptStreamTest(unittest.TestCase):
    def test_revises_partial_lines_and_drains_the_final_tail_on_the_same_stream(self) -> None:
        transcriber = RevisingTranscriber()
        with MoonshineTranscriptStream(transcriber) as stream:
            first_chunk = [0.1]
            first = stream.add_audio(first_chunk)
            native_stream = transcriber.streams[0]
            self.assertEqual(first.kind, "partial")
            self.assertEqual(first.text, "please approve")
            self.assertEqual(first_chunk, [0.1])
            self.assertFalse(native_stream.stopped)
            self.assertFalse(transcriber.closed)
            self.assertEqual(transcriber.sample_references[0], [0.0])

            second = stream.add_audio([0.2])
            self.assertEqual(second.kind, "partial")
            self.assertEqual(second.text, "please reject")
            final = stream.finish()

        self.assertEqual(final.kind, "final")
        self.assertEqual(final.text, "please reject this transfer")
        self.assertEqual(transcriber.last_sample_rate, 16000)
        self.assertEqual(len(transcriber.streams), 1)
        self.assertTrue(native_stream.stopped)
        self.assertTrue(native_stream.closed)
        self.assertTrue(transcriber.closed)
        self.assertEqual(stream._lines, {})
        with self.assertRaisesRegex(RuntimeError, "finished"):
            stream.finish()
        with self.assertRaisesRegex(RuntimeError, "finished"):
            stream.add_audio([0.1])

    def test_offline_analysis_feeds_bounded_chunks_through_one_stream(self) -> None:
        InspectingTranscriber.instances.clear()
        recognizer = MoonshineRecognizer(
            model_path="tiny",
            model_arch="tiny_streaming",
            intent_model_path="intent",
            transcriber_factory=InspectingTranscriber,
            intent_factory=FakeIntentRecognizer,
        )
        samples = [0.1] * (STREAM_CHUNK_SAMPLES * 2 + 3)
        result = recognizer.analyze(
            samples,
            expected_phrase="approve transfer",
            intent_name="approve",
            challenge_tokens=("approve", "transfer"),
        )

        transcriber = InspectingTranscriber.instances[-1]
        self.assertEqual(result.phrase.kind, "accepted")
        self.assertEqual(len(transcriber.streams), 1)
        self.assertEqual(
            [len(chunk) for chunk in transcriber.sample_references],
            [STREAM_CHUNK_SAMPLES, STREAM_CHUNK_SAMPLES, 3],
        )
        self.assertTrue(
            all(value == 0.0 for chunk in transcriber.sample_references for value in chunk)
        )
        self.assertTrue(all(value == 0.1 for value in samples))

    def test_cancel_discards_pending_text_without_draining_or_allowing_reuse(self) -> None:
        transcriber = FakeTranscriber()
        stream = MoonshineTranscriptStream(transcriber)
        stream.add_audio([0.1])
        native_stream = transcriber.streams[0]
        listener = native_stream.listeners[0]
        stream.close()
        stream.close()
        listener(FakeEvent(FakeLine("late result")))

        self.assertFalse(native_stream.stopped)
        self.assertTrue(native_stream.closed)
        self.assertTrue(transcriber.closed)
        self.assertEqual(stream._lines, {})
        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            stream.finish()
        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            stream.add_audio([0.1])

    def test_finishing_without_audio_closes_the_stream(self) -> None:
        transcriber = FakeTranscriber()
        stream = MoonshineTranscriptStream(transcriber)
        with self.assertRaisesRegex(ValueError, "must not be empty"):
            stream.finish()
        self.assertFalse(transcriber.streams[0].stopped)
        self.assertTrue(transcriber.streams[0].closed)
        self.assertTrue(transcriber.closed)

    def test_invalid_audio_fails_before_native_ingestion_and_closes_the_stream(self) -> None:
        invalid_chunks = (
            [],
            [float("nan")],
            [float("inf")],
            [1.1],
            [0.0] * (STREAM_CHUNK_SAMPLES + 1),
        )
        for chunk in invalid_chunks:
            with self.subTest(length=len(chunk)):
                transcriber = FakeTranscriber()
                stream = MoonshineTranscriptStream(transcriber)
                with self.assertRaises(ValueError):
                    stream.add_audio(chunk)
                self.assertEqual(transcriber.sample_references, [])
                self.assertTrue(transcriber.closed)
                with self.assertRaisesRegex(RuntimeError, "failed"):
                    stream.finish()

    def test_utterance_budget_overflow_invalidates_preceding_partial_text(self) -> None:
        transcriber = FakeTranscriber()
        stream = MoonshineTranscriptStream(transcriber)
        for _ in range(MAXIMUM_STREAM_SAMPLES // STREAM_CHUNK_SAMPLES):
            stream.add_audio([0.1] * STREAM_CHUNK_SAMPLES)
        self.assertEqual(stream._sample_count, MAXIMUM_STREAM_SAMPLES)
        with self.assertRaisesRegex(ValueError, "maximum duration"):
            stream.add_audio([0.1])
        self.assertEqual(stream._lines, {})
        self.assertTrue(transcriber.closed)

    def test_final_decode_failure_never_returns_the_preceding_partial_result(self) -> None:
        cases = (
            (StopErrorTranscriber, "injected final decode failure"),
            (NoFinalResultTranscriber, "without a final transcript"),
            (IncompleteTranscriber, "incomplete final transcript"),
        )
        for transcriber_type, message in cases:
            with self.subTest(transcriber=transcriber_type.__name__):
                transcriber = transcriber_type()
                stream = MoonshineTranscriptStream(transcriber)
                self.assertEqual(stream.add_audio([0.1]).kind, "partial")
                with self.assertRaisesRegex(RuntimeError, message):
                    stream.finish()
                self.assertTrue(transcriber.streams[0].closed)
                self.assertTrue(transcriber.closed)
                self.assertEqual(stream._lines, {})

    def test_native_initialization_failure_closes_allocated_handles(self) -> None:
        for transcriber_type in (FailingCreateTranscriber, FailingStartTranscriber):
            with self.subTest(transcriber=transcriber_type.__name__):
                transcriber = transcriber_type()
                with self.assertRaisesRegex(RuntimeError, "injected"):
                    MoonshineTranscriptStream(transcriber)
                self.assertTrue(transcriber.closed)
                self.assertTrue(all(stream.closed for stream in transcriber.streams))

    def test_native_close_failure_still_closes_the_decoder(self) -> None:
        transcriber = FailingCloseTranscriber()
        stream = MoonshineTranscriptStream(transcriber)
        stream.add_audio([0.1])
        with self.assertRaisesRegex(RuntimeError, "injected close failure"):
            stream.finish()
        self.assertTrue(transcriber.closed)
        with self.assertRaisesRegex(RuntimeError, "failed"):
            stream.finish()


if __name__ == "__main__":
    unittest.main()
