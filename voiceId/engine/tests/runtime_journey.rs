//! Engine lifecycle journey with generated PCM and explicit deterministic model doubles.
//! This qualifies coordination, not microphone capture, biometric accuracy, or wallet signing.

mod support;

use std::cell::Cell;
use std::fmt::Write;
use std::num::{NonZeroU16, NonZeroU32, NonZeroUsize};
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use voiceid_engine::adapters::{AdapterError, SpeakerMatcher, Transcriber, TranscriptStream};
use voiceid_engine::attribution::{
    AttributionOutcome, InsufficientReason, RejectionReason, SupportingGate,
};
use voiceid_engine::domain::{
    AudioFormat, AudioFrame, Availability, CalibrationId, CaptureReady, CaptureSessionId,
    CaptureTime, ClockMapping, Discontinuity, FailureReason, FrameStamp, IdentityMatch, InputError,
    ModelId, ProfileId, TimeRange, UnavailableReason,
};
use voiceid_engine::enrollment::{EnrollmentRecord, EnrollmentState};
use voiceid_engine::runtime::{
    AudioProfile, AudioRuntime, Cancellation, Clock, RuntimeStatus, StopReason, WorkContext,
    WorkError,
};
use voiceid_engine::utterance::{
    Assessment, FinalTranscript, PartialTranscript, SpeakerVerdict, SpeechWindow,
    TranscriptOutcome, UtteranceId, UtteranceSpan,
};

const SESSION: CaptureSessionId = CaptureSessionId([1; 16]);
const RESTARTED_SESSION: CaptureSessionId = CaptureSessionId([2; 16]);
const TRANSCRIPTION_MODEL: ModelId = ModelId([6; 32]);
const SPEAKER_MODEL: ModelId = ModelId([1; 32]);
const CALIBRATION: CalibrationId = CalibrationId([2; 32]);

#[derive(Clone)]
struct Timeline {
    now: Rc<Cell<CaptureTime>>,
    cancelled: Rc<Cell<bool>>,
}

impl Timeline {
    fn new() -> Self {
        Self {
            now: Rc::new(Cell::new(time(SESSION, 100))),
            cancelled: Rc::new(Cell::new(false)),
        }
    }

    fn context(&self, deadline_ms: u64) -> WorkContext<'_> {
        WorkContext {
            deadline: time(self.now.get().session, deadline_ms),
            clock: self,
            cancellation: self,
        }
    }

    fn advance(&self, milliseconds: u64) {
        let current = self.now.get();
        self.now.set(CaptureTime {
            session: current.session,
            elapsed: current.elapsed + Duration::from_millis(milliseconds),
        });
    }
}

impl Clock for Timeline {
    fn now(&self) -> CaptureTime {
        self.now.get()
    }
}

impl Cancellation for Timeline {
    fn is_cancelled(&self) -> bool {
        self.cancelled.get()
    }
}

#[derive(Clone, Copy)]
enum TranscriptCase {
    Speech,
    Silence,
    WrongPartialSource,
    WrongFinalModel,
    RepeatedRevision,
    CancelDuringPush,
    Discontinuity,
    Unavailable,
}

#[derive(Clone, Copy)]
enum SpeakerCase {
    Owner,
    Unknown,
    Overlap,
    Insufficient,
    OldEnrollment,
    WrongSource,
    WrongModel,
    WrongCalibration,
    Late,
}

struct TestTranscriber {
    case: Rc<Cell<TranscriptCase>>,
    live_decoders: Rc<Cell<usize>>,
    timeline: Timeline,
}

struct TestStream {
    id: UtteranceId,
    case: TranscriptCase,
    input: TestStreamInput,
    revision: u64,
    live_decoders: Rc<Cell<usize>>,
    timeline: Timeline,
}

enum TestStreamInput {
    Empty,
    Captured(UtteranceSpan),
}

impl Transcriber for TestTranscriber {
    type Stream = TestStream;

    fn availability(&self) -> Availability<()> {
        match self.case.get() {
            TranscriptCase::Unavailable => Availability::Unavailable(UnavailableReason::Missing),
            _ => Availability::Available(()),
        }
    }

    fn start(
        &mut self,
        id: UtteranceId,
        work: &WorkContext<'_>,
    ) -> Result<Self::Stream, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        self.live_decoders.set(self.live_decoders.get() + 1);
        Ok(TestStream {
            id,
            case: self.case.get(),
            input: TestStreamInput::Empty,
            revision: 0,
            live_decoders: Rc::clone(&self.live_decoders),
            timeline: self.timeline.clone(),
        })
    }
}

impl TranscriptStream for TestStream {
    fn push(
        &mut self,
        chunk: &SpeechWindow,
        work: &WorkContext<'_>,
    ) -> Result<PartialTranscript, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        match self.case {
            TranscriptCase::CancelDuringPush => self.timeline.cancelled.set(true),
            TranscriptCase::Discontinuity => {
                return Err(AdapterError::Discontinuity(Discontinuity::SequenceGap));
            }
            _ => {}
        }
        let start = match self.input {
            TestStreamInput::Empty => chunk.source().captured().start(),
            TestStreamInput::Captured(source) => source.captured().start(),
        };
        let captured = TimeRange::new(start, chunk.source().captured().end()).unwrap();
        let source = UtteranceSpan::new(self.id, captured).unwrap();
        self.input = TestStreamInput::Captured(source);
        let output_source = match self.case {
            TranscriptCase::WrongPartialSource => wrong_source(source),
            _ => source,
        };
        match self.case {
            TranscriptCase::RepeatedRevision => self.revision = 1,
            _ => self.revision += 1,
        }
        PartialTranscript::new(
            output_source,
            TRANSCRIPTION_MODEL,
            self.revision,
            "approve".into(),
            limit(128),
        )
        .map_err(AdapterError::InvalidInput)
    }

    fn finish(
        self,
        source: UtteranceSpan,
        work: &WorkContext<'_>,
    ) -> Result<TranscriptOutcome, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        match self.input {
            TestStreamInput::Captured(captured) => assert_eq!(captured, source),
            TestStreamInput::Empty => {
                panic!("runtime must reject empty capture before finalization")
            }
        }
        if matches!(self.case, TranscriptCase::Silence) {
            return Ok(TranscriptOutcome::NoSpeech(source));
        }
        let model = match self.case {
            TranscriptCase::WrongFinalModel => ModelId([9; 32]),
            _ => TRANSCRIPTION_MODEL,
        };
        let transcript = FinalTranscript::new(source, model, "approve".into(), limit(128)).unwrap();
        Ok(TranscriptOutcome::Speech(transcript))
    }
}

impl Drop for TestStream {
    fn drop(&mut self) {
        self.live_decoders.set(self.live_decoders.get() - 1);
    }
}

struct TestSpeaker {
    case: Rc<Cell<SpeakerCase>>,
    calls: Rc<Cell<usize>>,
    timeline: Timeline,
}

impl SpeakerMatcher for TestSpeaker {
    fn availability(&self) -> Availability<()> {
        Availability::Available(())
    }

    fn assess(
        &mut self,
        window: &SpeechWindow,
        enrollment: &EnrollmentRecord,
        work: &WorkContext<'_>,
    ) -> Result<Assessment<SpeakerVerdict>, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        self.calls.set(self.calls.get() + 1);
        assert_eq!(window.audio().samples().len(), 3_200);
        let verdict = match self.case.get() {
            SpeakerCase::Unknown => SpeakerVerdict::Identity(IdentityMatch::Unknown),
            SpeakerCase::Overlap => SpeakerVerdict::OverlappingSpeech,
            SpeakerCase::Insufficient => SpeakerVerdict::InsufficientSpeech,
            SpeakerCase::OldEnrollment => {
                SpeakerVerdict::Identity(IdentityMatch::Matched(support::enrollment(1).identity))
            }
            _ => SpeakerVerdict::Identity(IdentityMatch::Matched(enrollment.identity)),
        };
        if matches!(self.case.get(), SpeakerCase::Late) {
            self.timeline.now.set(work.deadline);
        }
        let source = match self.case.get() {
            SpeakerCase::WrongSource => wrong_source(window.source()),
            _ => window.source(),
        };
        let model = match self.case.get() {
            SpeakerCase::WrongModel => ModelId([9; 32]),
            _ => SPEAKER_MODEL,
        };
        let calibration = match self.case.get() {
            SpeakerCase::WrongCalibration => CalibrationId([9; 32]),
            _ => CALIBRATION,
        };
        Ok(Assessment {
            source,
            model,
            calibration,
            verdict,
        })
    }
}

type TestRuntime = AudioRuntime<TestTranscriber, TestSpeaker>;

struct Journey {
    runtime: TestRuntime,
    timeline: Timeline,
    transcript_case: Rc<Cell<TranscriptCase>>,
    speaker_case: Rc<Cell<SpeakerCase>>,
    live_decoders: Rc<Cell<usize>>,
    speaker_calls: Rc<Cell<usize>>,
    checks: Vec<(&'static str, &'static str)>,
}

impl Journey {
    fn new() -> Self {
        let timeline = Timeline::new();
        let transcript_case = Rc::new(Cell::new(TranscriptCase::Speech));
        let speaker_case = Rc::new(Cell::new(SpeakerCase::Owner));
        let live_decoders = Rc::new(Cell::new(0));
        let speaker_calls = Rc::new(Cell::new(0));
        let transcriber = TestTranscriber {
            case: Rc::clone(&transcript_case),
            live_decoders: Rc::clone(&live_decoders),
            timeline: timeline.clone(),
        };
        let speaker = TestSpeaker {
            case: Rc::clone(&speaker_case),
            calls: Rc::clone(&speaker_calls),
            timeline: timeline.clone(),
        };
        let runtime = AudioRuntime::new(
            ready(SESSION),
            profile(),
            EnrollmentState::Enrolled(support::enrollment(1)),
            transcriber,
            speaker,
        )
        .unwrap();
        Self {
            runtime,
            timeline,
            transcript_case,
            speaker_case,
            live_decoders,
            speaker_calls,
            checks: Vec::new(),
        }
    }

    fn begin(&mut self) -> UtteranceId {
        let deadline = self.timeline.now.get().elapsed.as_millis() as u64 + 1_000;
        self.runtime
            .begin(&self.timeline.context(deadline))
            .unwrap()
    }

    fn push_chunk(
        &mut self,
        id: UtteranceId,
        sequence: u64,
    ) -> Result<PartialTranscript, AdapterError> {
        let start = self.timeline.now.get();
        let audio = frame(start, sequence);
        self.timeline.advance(100);
        let partial = self
            .runtime
            .push(id, audio, &self.timeline.context(u64::MAX));
        if let Ok(snapshot) = &partial {
            assert_eq!(snapshot.source().id(), id);
        }
        partial
    }

    fn capture(&mut self) -> UtteranceId {
        let id = self.begin();
        self.push_chunk(id, 0).unwrap();
        self.push_chunk(id, 1).unwrap();
        id
    }

    fn finish(&mut self, id: UtteranceId) -> Result<(), AdapterError> {
        self.runtime.finish(id, &self.timeline.context(u64::MAX))
    }

    fn check(&mut self, name: &'static str, outcome: &'static str) {
        assert_eq!(self.live_decoders.get(), 0, "decoder retained after {name}");
        self.checks.push((name, outcome));
    }

    fn write_evidence(&self) {
        let mut report = String::from(
            "{\n  \"schemaVersion\": \"voiceid_runtime_journey_v1\",\n  \"capture\": \"generated_pcm\",\n  \"models\": \"deterministic_test_doubles\",\n  \"walletSigning\": false,\n  \"checks\": [\n",
        );
        for (index, (name, outcome)) in self.checks.iter().enumerate() {
            if index != 0 {
                report.push_str(",\n");
            }
            write!(
                report,
                "    {{\"scenario\": \"{name}\", \"outcome\": \"{outcome}\", \"passed\": true}}"
            )
            .unwrap();
        }
        write!(
            report,
            "\n  ],\n  \"liveDecodersAtEnd\": {}\n}}\n",
            self.live_decoders.get()
        )
        .unwrap();
        let output =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/runtime-lifecycle.e2e.json");
        std::fs::create_dir_all(output.parent().unwrap()).unwrap();
        std::fs::write(&output, report).unwrap();
        println!("Lifecycle evidence: {}", output.display());
    }
}

#[test]
fn audio_runtime_lifecycle_journey() {
    let mut journey = Journey::new();
    successful_owner_and_single_consumption(&mut journey);
    speaker_outcomes_and_silence(&mut journey);
    cancellation_and_enrollment_changes(&mut journey);
    invalid_adapter_outputs(&mut journey);
    late_results_and_clock_uncertainty(&mut journey);
    capture_loss_and_restart(&mut journey);
    assert_eq!(journey.runtime.status(), RuntimeStatus::Idle);
    assert_eq!(journey.live_decoders.get(), 0);
    journey.write_evidence();
}

fn successful_owner_and_single_consumption(journey: &mut Journey) {
    let id = journey.begin();
    assert_eq!(
        journey
            .runtime
            .begin(&journey.timeline.context(2_000))
            .err(),
        Some(AdapterError::Overloaded)
    );
    assert_eq!(journey.live_decoders.get(), 1);
    let first = journey.push_chunk(id, 0).unwrap();
    let second = journey.push_chunk(id, 1).unwrap();
    assert!(second.revision() > first.revision());
    assert_eq!(
        second.source().captured().duration(),
        Duration::from_millis(200)
    );
    journey.finish(id).unwrap();
    assert_eq!(
        journey
            .runtime
            .begin(&journey.timeline.context(2_000))
            .err(),
        Some(AdapterError::Overloaded)
    );
    let work = journey.timeline.context(u64::MAX);
    let result = journey.runtime.take_result(id, &work).unwrap();
    let AttributionOutcome::Attributed(attributed) = result.attribution() else {
        panic!("enrolled owner must be attributed");
    };
    assert_eq!(attributed.identity(), support::enrollment(1).identity);
    assert_eq!(attributed.utterance(), second.source());
    assert_eq!(attributed.speaker(), profile().speaker);
    assert!(matches!(result.transcript(), TranscriptOutcome::Speech(_)));
    assert_eq!(
        journey.runtime.take_result(id, &work).err(),
        Some(AdapterError::InvalidInput(InputError::UtteranceMismatch))
    );
    journey.check("owner_stream_and_single_consumption", "attributed_once");
}

fn speaker_outcomes_and_silence(journey: &mut Journey) {
    journey.speaker_case.set(SpeakerCase::Unknown);
    let id = journey.capture();
    journey.finish(id).unwrap();
    let result = journey
        .runtime
        .take_result(id, &journey.timeline.context(u64::MAX))
        .unwrap();
    assert!(matches!(
        result.attribution(),
        AttributionOutcome::Rejected {
            reason: RejectionReason::UnknownSpeaker,
            ..
        }
    ));
    journey.check("different_speaker", "rejected");

    journey.speaker_case.set(SpeakerCase::Overlap);
    let id = journey.capture();
    journey.finish(id).unwrap();
    let result = journey
        .runtime
        .take_result(id, &journey.timeline.context(u64::MAX))
        .unwrap();
    assert!(matches!(
        result.attribution(),
        AttributionOutcome::Ambiguous { .. }
    ));
    journey.check("overlapping_speech", "ambiguous");

    journey.speaker_case.set(SpeakerCase::Insufficient);
    let id = journey.capture();
    journey.finish(id).unwrap();
    let result = journey
        .runtime
        .take_result(id, &journey.timeline.context(u64::MAX))
        .unwrap();
    assert!(matches!(
        result.attribution(),
        AttributionOutcome::Insufficient {
            reason: InsufficientReason::MissingEvidence,
            ..
        }
    ));
    journey.check("insufficient_speaker_evidence", "insufficient");

    journey.transcript_case.set(TranscriptCase::Silence);
    let calls_before = journey.speaker_calls.get();
    let id = journey.capture();
    journey.finish(id).unwrap();
    let result = journey
        .runtime
        .take_result(id, &journey.timeline.context(u64::MAX))
        .unwrap();
    assert!(matches!(
        result.transcript(),
        TranscriptOutcome::NoSpeech(_)
    ));
    assert!(matches!(
        result.attribution(),
        AttributionOutcome::Insufficient { .. }
    ));
    assert_eq!(journey.speaker_calls.get(), calls_before);
    journey.check("finalized_silence", "no_speech_without_speaker_call");
    journey.transcript_case.set(TranscriptCase::Speech);
    journey.speaker_case.set(SpeakerCase::Owner);
}

fn cancellation_and_enrollment_changes(journey: &mut Journey) {
    let id = journey.capture();
    journey.runtime.cancel(id).unwrap();
    assert_eq!(
        journey.finish(id),
        Err(AdapterError::InvalidInput(InputError::UtteranceMismatch))
    );
    journey.check("cancel_pending_utterance", "decoder_closed");

    journey
        .transcript_case
        .set(TranscriptCase::CancelDuringPush);
    let id = journey.begin();
    assert_eq!(
        journey.push_chunk(id, 0).err(),
        Some(AdapterError::Work(WorkError::Cancelled))
    );
    journey.timeline.cancelled.set(false);
    journey.transcript_case.set(TranscriptCase::Speech);
    journey.check("cancel_during_adapter_call", "late_partial_discarded");

    let id = journey.capture();
    journey.finish(id).unwrap();
    journey
        .runtime
        .reload_enrollment(EnrollmentState::Enrolled(support::enrollment(2)))
        .unwrap();
    assert_eq!(
        journey
            .runtime
            .take_result(id, &journey.timeline.context(u64::MAX))
            .err(),
        Some(AdapterError::InvalidInput(InputError::UtteranceMismatch))
    );
    journey.check(
        "replace_enrollment_after_completion",
        "pending_result_invalidated",
    );

    journey.speaker_case.set(SpeakerCase::OldEnrollment);
    let id = journey.capture();
    journey.finish(id).unwrap();
    let result = journey
        .runtime
        .take_result(id, &journey.timeline.context(u64::MAX))
        .unwrap();
    assert!(matches!(
        result.attribution(),
        AttributionOutcome::Insufficient {
            reason: InsufficientReason::InvalidatedEvidence,
            ..
        }
    ));
    journey.check("old_enrollment_match", "insufficient");
    journey.speaker_case.set(SpeakerCase::Owner);

    let id = journey.capture();
    journey
        .runtime
        .reload_enrollment(EnrollmentState::Empty)
        .unwrap();
    assert_eq!(
        journey.finish(id),
        Err(AdapterError::InvalidInput(InputError::UtteranceMismatch))
    );
    assert_eq!(
        journey
            .runtime
            .begin(&journey.timeline.context(u64::MAX))
            .err(),
        Some(AdapterError::Unavailable(UnavailableReason::Missing))
    );
    journey
        .runtime
        .reload_enrollment(EnrollmentState::Enrolled(support::enrollment(2)))
        .unwrap();
    journey.check(
        "delete_enrollment_while_listening",
        "attempt_invalidated_and_admission_denied",
    );
}

fn invalid_adapter_outputs(journey: &mut Journey) {
    journey
        .transcript_case
        .set(TranscriptCase::WrongPartialSource);
    let id = journey.begin();
    assert_eq!(
        journey.push_chunk(id, 0).err(),
        Some(AdapterError::Failed(FailureReason::InvalidOutput))
    );
    journey.check("wrong_partial_utterance", "invalid_output");

    journey
        .transcript_case
        .set(TranscriptCase::RepeatedRevision);
    let id = journey.begin();
    journey.push_chunk(id, 0).unwrap();
    assert_eq!(
        journey.push_chunk(id, 1).err(),
        Some(AdapterError::Failed(FailureReason::InvalidOutput))
    );
    journey.check("out_of_order_partial_revision", "invalid_output");

    journey.transcript_case.set(TranscriptCase::WrongFinalModel);
    let id = journey.capture();
    assert_eq!(
        journey.finish(id),
        Err(AdapterError::Failed(FailureReason::InvalidOutput))
    );
    journey.check("wrong_transcription_model", "invalid_output");
    journey.transcript_case.set(TranscriptCase::Speech);

    for (case, name) in [
        (SpeakerCase::WrongSource, "wrong_speaker_utterance"),
        (SpeakerCase::WrongModel, "wrong_speaker_model"),
        (SpeakerCase::WrongCalibration, "wrong_speaker_calibration"),
    ] {
        journey.speaker_case.set(case);
        let id = journey.capture();
        assert_eq!(
            journey.finish(id),
            Err(AdapterError::Failed(FailureReason::InvalidOutput))
        );
        journey.check(name, "invalid_output");
    }
    journey.speaker_case.set(SpeakerCase::Owner);

    journey.transcript_case.set(TranscriptCase::Unavailable);
    assert_eq!(
        journey
            .runtime
            .begin(&journey.timeline.context(u64::MAX))
            .err(),
        Some(AdapterError::Unavailable(UnavailableReason::Missing))
    );
    journey.check("missing_model", "unavailable");
    journey.transcript_case.set(TranscriptCase::Speech);
}

fn late_results_and_clock_uncertainty(journey: &mut Journey) {
    journey.speaker_case.set(SpeakerCase::Late);
    let id = journey.capture();
    assert_eq!(
        journey.finish(id),
        Err(AdapterError::Work(WorkError::DeadlineExceeded))
    );
    journey.check(
        "adapter_finishes_at_original_deadline",
        "discarded_despite_later_caller_deadline",
    );
    journey.speaker_case.set(SpeakerCase::Owner);

    let id = journey.capture();
    journey.finish(id).unwrap();
    journey.timeline.advance(800);
    assert_eq!(
        journey
            .runtime
            .take_result(id, &journey.timeline.context(u64::MAX))
            .err(),
        Some(AdapterError::Work(WorkError::DeadlineExceeded))
    );
    journey.check("result_consumption_at_deadline", "expired");

    let start = journey.timeline.now.get();
    let id = journey
        .runtime
        .begin(
            &journey
                .timeline
                .context(start.elapsed.as_millis() as u64 + 10_000),
        )
        .unwrap();
    journey.push_chunk(id, 0).unwrap();
    journey.push_chunk(id, 1).unwrap();
    journey.finish(id).unwrap();
    journey.timeline.advance(299);
    assert_eq!(
        journey
            .runtime
            .take_result(id, &journey.timeline.context(u64::MAX))
            .err(),
        Some(AdapterError::Work(WorkError::DeadlineExceeded))
    );
    journey.check(
        "evidence_age_includes_clock_uncertainty",
        "expired_at_worst_case_bound",
    );
}

fn capture_loss_and_restart(journey: &mut Journey) {
    let old = journey.begin();
    journey.push_chunk(old, 0).unwrap();
    assert_eq!(
        journey.push_chunk(old, 2).err(),
        Some(AdapterError::Discontinuity(Discontinuity::SequenceGap))
    );
    assert_eq!(
        journey.runtime.status(),
        RuntimeStatus::Stopped(StopReason::Discontinuity(Discontinuity::SequenceGap))
    );
    assert_eq!(
        journey.runtime.restart(ready(SESSION)),
        Err(AdapterError::InvalidInput(InputError::SessionMismatch))
    );
    journey.check("capture_gap_and_reused_session", "stopped");

    journey.timeline.now.set(time(RESTARTED_SESSION, 100));
    journey.runtime.restart(ready(RESTARTED_SESSION)).unwrap();
    let id = journey.begin();
    assert_ne!(id.session, old.session);
    assert!(id.sequence > old.sequence);
    let old_audio = frame(time(SESSION, 100), 0);
    assert_eq!(
        journey
            .runtime
            .push(old, old_audio, &journey.timeline.context(u64::MAX))
            .err(),
        Some(AdapterError::InvalidInput(InputError::UtteranceMismatch))
    );
    assert_eq!(journey.runtime.status(), RuntimeStatus::Listening(id));
    journey.push_chunk(id, 0).unwrap();
    journey.push_chunk(id, 1).unwrap();
    journey.finish(id).unwrap();
    journey
        .runtime
        .take_result(id, &journey.timeline.context(u64::MAX))
        .unwrap();
    journey.check(
        "restart_and_old_epoch_submission",
        "fresh_attempt_preserved",
    );

    journey.transcript_case.set(TranscriptCase::Discontinuity);
    let id = journey.begin();
    assert_eq!(
        journey.push_chunk(id, 0).err(),
        Some(AdapterError::Discontinuity(Discontinuity::SequenceGap))
    );
    assert!(matches!(
        journey.runtime.status(),
        RuntimeStatus::Stopped(_)
    ));
    journey.check("adapter_reports_discontinuity", "session_stopped");
    journey.transcript_case.set(TranscriptCase::Speech);

    let final_session = CaptureSessionId([3; 16]);
    journey.timeline.now.set(time(final_session, 100));
    journey.runtime.restart(ready(final_session)).unwrap();
    let id = journey.begin();
    journey.push_chunk(id, 0).unwrap();
    journey.push_chunk(id, 1).unwrap();
    assert_eq!(
        journey.push_chunk(id, 2).err(),
        Some(AdapterError::InvalidInput(InputError::LimitExceeded))
    );
    journey.check("cumulative_utterance_bound", "attempt_released");

    let id = journey.capture();
    journey.finish(id).unwrap();
    journey.runtime.stop(StopReason::Closed);
    assert_eq!(
        journey
            .runtime
            .take_result(id, &journey.timeline.context(u64::MAX))
            .err(),
        Some(AdapterError::InvalidInput(InputError::UtteranceMismatch))
    );
    journey.check("close_with_pending_result", "pending_result_invalidated");
    let next_session = CaptureSessionId([4; 16]);
    journey.timeline.now.set(time(next_session, 100));
    journey.runtime.restart(ready(next_session)).unwrap();
}

fn limit(value: usize) -> NonZeroUsize {
    NonZeroUsize::new(value).unwrap()
}

fn time(session: CaptureSessionId, milliseconds: u64) -> CaptureTime {
    CaptureTime {
        session,
        elapsed: Duration::from_millis(milliseconds),
    }
}

fn ready(session: CaptureSessionId) -> CaptureReady<AudioFormat> {
    CaptureReady {
        profile: ProfileId([3; 32]),
        format: AudioFormat {
            sample_rate_hz: NonZeroU32::new(16_000).unwrap(),
            channels: NonZeroU16::new(1).unwrap(),
        },
        clock: ClockMapping {
            source_origin: Duration::ZERO,
            local_origin: time(session, 0),
            maximum_error: Duration::from_millis(1),
        },
    }
}

fn frame(start: CaptureTime, sequence: u64) -> AudioFrame {
    AudioFrame::new(
        &ready(start.session),
        FrameStamp {
            sequence,
            captured_at: start,
        },
        vec![0.25; 1_600],
        limit(1_600),
    )
    .unwrap()
}

fn profile() -> AudioProfile {
    AudioProfile {
        id: ProfileId([7; 32]),
        transcription_model: TRANSCRIPTION_MODEL,
        speaker: SupportingGate {
            model: SPEAKER_MODEL,
            calibration: CALIBRATION,
        },
        maximum_samples: limit(3_200),
        maximum_duration: Duration::from_millis(300),
        maximum_text_bytes: limit(128),
        maximum_evidence_age: Duration::from_millis(500),
    }
}

fn wrong_source(source: UtteranceSpan) -> UtteranceSpan {
    let id = UtteranceId {
        session: source.id().session,
        sequence: source.id().sequence + 1,
    };
    UtteranceSpan::new(id, source.captured()).unwrap()
}
