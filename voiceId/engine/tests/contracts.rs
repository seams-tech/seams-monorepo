use std::cell::Cell;
use std::num::{NonZeroU16, NonZeroU32, NonZeroU64, NonZeroUsize};
use std::time::Duration;

use voiceid_engine::domain::{
    AudioFormat, AudioFrame, CalibrationId, CaptureReady, CaptureSessionId, CaptureTime,
    ClockMapping, CoordinateFrameId, DeviceId, EnrollmentId, EnrollmentRef, FrameStamp,
    IdentityMatch, InputError, ModelId, ProfileId, TimeRange, UnavailableReason, VideoFormat,
    VideoFrame,
};
use voiceid_engine::enrollment::{
    EnrollmentRecord, EnrollmentReplacement, FaceEnrollment, TemplateData, VoiceTemplate,
};
use voiceid_engine::presence::{
    Location, PositionEstimate, RecentPresence, TrackId, VisualAssessment, VisualObservation,
};
use voiceid_engine::runtime::{Cancellation, Clock, WorkContext, WorkError};
use voiceid_engine::utterance::{
    FinalTranscript, PartialTranscript, SpeechWindow, UtteranceId, UtteranceSpan,
};

const SESSION: CaptureSessionId = CaptureSessionId([1; 16]);
const OTHER_SESSION: CaptureSessionId = CaptureSessionId([2; 16]);
const MODEL: ModelId = ModelId([1; 32]);
const CALIBRATION: CalibrationId = CalibrationId([2; 32]);

fn limit(value: usize) -> NonZeroUsize {
    NonZeroUsize::new(value).unwrap()
}

fn time(milliseconds: u64) -> CaptureTime {
    CaptureTime {
        session: SESSION,
        elapsed: Duration::from_millis(milliseconds),
    }
}

fn stamp(milliseconds: u64) -> FrameStamp {
    FrameStamp {
        sequence: 0,
        captured_at: time(milliseconds),
    }
}

fn ready<Format>(format: Format) -> CaptureReady<Format> {
    CaptureReady {
        profile: ProfileId([3; 32]),
        format,
        clock: ClockMapping {
            source_origin: Duration::ZERO,
            local_origin: time(0),
            maximum_error: Duration::from_micros(50),
        },
    }
}

fn audio_ready(channels: u16) -> CaptureReady<AudioFormat> {
    ready(AudioFormat {
        sample_rate_hz: NonZeroU32::new(16_000).unwrap(),
        channels: NonZeroU16::new(channels).unwrap(),
    })
}

fn audio(channels: u16) -> AudioFrame {
    AudioFrame::new(
        &audio_ready(channels),
        stamp(100),
        vec![0.25; 1_600],
        limit(1_600),
    )
    .unwrap()
}

fn utterance() -> UtteranceId {
    UtteranceId {
        session: SESSION,
        sequence: 7,
    }
}

fn source() -> UtteranceSpan {
    UtteranceSpan::new(utterance(), TimeRange::new(time(100), time(200)).unwrap()).unwrap()
}

fn observation() -> VisualObservation {
    VisualObservation::new(
        TrackId {
            session: SESSION,
            sequence: 9,
        },
        time(100),
        Location::Unavailable(UnavailableReason::Uncalibrated),
        IdentityMatch::Unknown,
    )
    .unwrap()
}

fn enrollment(version: u64) -> EnrollmentRecord {
    EnrollmentRecord {
        identity: EnrollmentRef {
            id: EnrollmentId([4; 16]),
            version: NonZeroU64::new(version).unwrap(),
        },
        device: DeviceId([5; 16]),
        voice: VoiceTemplate(
            TemplateData::new(MODEL, NonZeroU32::new(1).unwrap(), vec![1, 2, 3], limit(3)).unwrap(),
        ),
        face: FaceEnrollment::Disabled,
    }
}

#[test]
fn time_ranges_require_one_epoch_and_expire_at_the_exact_deadline() {
    let range = TimeRange::new(time(100), time(200)).unwrap();
    assert!(!range.contains(time(99)));
    assert!(range.contains(time(100)));
    assert!(range.contains(time(199)));
    assert!(!range.contains(time(200)));
    assert_eq!(range.duration(), Duration::from_millis(100));
    let other = CaptureTime {
        session: OTHER_SESSION,
        elapsed: time(150).elapsed,
    };
    assert!(!range.contains(other));
    assert_eq!(
        TimeRange::new(time(100), other),
        Err(InputError::SessionMismatch)
    );
    assert_eq!(
        TimeRange::new(time(100), time(100)),
        Err(InputError::InvalidTimeRange)
    );
    assert_eq!(
        TimeRange::new(time(200), time(100)),
        Err(InputError::InvalidTimeRange)
    );
}

#[test]
fn audio_preserves_interleaved_channels_and_derives_duration_per_channel() {
    let frame = audio(2);
    assert_eq!(frame.format().channels.get(), 2);
    assert_eq!(frame.samples(), &[0.25; 1_600]);
    assert_eq!(frame.stamp(), stamp(100));
    assert_eq!(frame.span().duration(), Duration::from_millis(50));
    assert_eq!(frame.span().end(), time(150));
}

#[test]
fn audio_rejects_empty_oversized_malformed_and_nonfinite_pcm() {
    let cases = [
        (vec![], InputError::Empty),
        (vec![0.0; 5], InputError::LimitExceeded),
        (vec![0.0; 3], InputError::InvalidAudio),
        (vec![f32::NAN, 0.0], InputError::InvalidAudio),
        (vec![f32::INFINITY, 0.0], InputError::InvalidAudio),
        (vec![-1.01, 0.0], InputError::InvalidAudio),
        (vec![1.01, 0.0], InputError::InvalidAudio),
    ];
    for (samples, error) in cases {
        assert_eq!(
            AudioFrame::new(&audio_ready(2), stamp(0), samples, limit(4)).err(),
            Some(error)
        );
    }
    assert!(AudioFrame::new(&audio_ready(2), stamp(0), vec![-1.0, 1.0], limit(2)).is_ok());
}

#[test]
fn capture_rejects_cross_epoch_frames_and_timestamp_overflow() {
    let mut wrong_epoch = stamp(100);
    wrong_epoch.captured_at.session = OTHER_SESSION;
    assert_eq!(
        AudioFrame::new(&audio_ready(1), wrong_epoch, vec![0.0], limit(1)).err(),
        Some(InputError::SessionMismatch)
    );
    let overflow = FrameStamp {
        sequence: 1,
        captured_at: CaptureTime {
            session: SESSION,
            elapsed: Duration::MAX,
        },
    };
    assert_eq!(
        AudioFrame::new(&audio_ready(1), overflow, vec![0.0], limit(1)).err(),
        Some(InputError::InvalidTimeRange)
    );
    let video = ready(VideoFormat {
        width: NonZeroU32::new(1).unwrap(),
        height: NonZeroU32::new(1).unwrap(),
    });
    assert_eq!(
        VideoFrame::new(&video, wrong_epoch, vec![0; 3], limit(3)).err(),
        Some(InputError::SessionMismatch)
    );
}

#[test]
fn video_requires_exact_bounded_rgb8_dimensions() {
    let format = ready(VideoFormat {
        width: NonZeroU32::new(2).unwrap(),
        height: NonZeroU32::new(2).unwrap(),
    });
    let frame = VideoFrame::new(&format, stamp(100), vec![10; 12], limit(12)).unwrap();
    assert_eq!(frame.pixels(), &[10; 12]);
    assert_eq!(frame.format(), format.format);
    assert_eq!(frame.stamp(), stamp(100));
    assert_eq!(
        VideoFrame::new(&format, stamp(100), vec![0; 11], limit(12)).err(),
        Some(InputError::InvalidVideo)
    );
    assert_eq!(
        VideoFrame::new(&format, stamp(100), vec![0; 12], limit(11)).err(),
        Some(InputError::LimitExceeded)
    );
    let overflow = ready(VideoFormat {
        width: NonZeroU32::MAX,
        height: NonZeroU32::MAX,
    });
    assert_eq!(
        VideoFrame::new(&overflow, stamp(100), vec![], limit(12)).err(),
        Some(InputError::InvalidVideo)
    );
}

#[test]
fn model_windows_require_bounded_mono_and_the_current_utterance_epoch() {
    let window = SpeechWindow::new(utterance(), audio(1), Duration::from_millis(100)).unwrap();
    assert_eq!(window.source(), source());
    assert_eq!(window.audio().samples().len(), 1_600);
    assert_eq!(
        SpeechWindow::new(utterance(), audio(2), Duration::from_secs(1)).err(),
        Some(InputError::InvalidAudio)
    );
    assert_eq!(
        SpeechWindow::new(utterance(), audio(1), Duration::from_millis(99)).err(),
        Some(InputError::LimitExceeded)
    );
    let other = UtteranceId {
        session: OTHER_SESSION,
        sequence: utterance().sequence,
    };
    assert_eq!(
        SpeechWindow::new(other, audio(1), Duration::from_secs(1)).err(),
        Some(InputError::SessionMismatch)
    );
}

#[test]
fn partial_text_can_be_empty_while_final_text_is_nonempty_and_bounded() {
    let partial = PartialTranscript::new(source(), MODEL, 1, String::new(), limit(10)).unwrap();
    assert_eq!(partial.source(), source());
    assert_eq!(partial.revision(), 1);
    assert_eq!(partial.text(), "");
    assert_eq!(partial.model(), MODEL);
    let final_text = FinalTranscript::new(source(), MODEL, "hello".into(), limit(5)).unwrap();
    assert_eq!(final_text.source(), source());
    assert_eq!(final_text.text(), "hello");
    assert_eq!(final_text.model(), MODEL);
    assert_eq!(
        FinalTranscript::new(source(), MODEL, " \n ".into(), limit(5)).err(),
        Some(InputError::Empty)
    );
    assert_eq!(
        FinalTranscript::new(source(), MODEL, "ééé".into(), limit(5)).err(),
        Some(InputError::LimitExceeded)
    );
    assert_eq!(
        PartialTranscript::new(source(), MODEL, 2, "longer".into(), limit(5)).err(),
        Some(InputError::LimitExceeded)
    );
}

#[test]
fn recent_presence_preserves_capture_time_and_has_a_bounded_exclusive_deadline() {
    let seen = observation();
    let recent = RecentPresence::new(seen, time(200), Duration::from_millis(100)).unwrap();
    assert_eq!(recent.observation(), seen);
    assert_eq!(recent.observation().captured_at(), time(100));
    assert!(recent.validity().contains(time(199)));
    assert!(!recent.validity().contains(time(200)));
    assert_eq!(
        RecentPresence::new(seen, time(201), Duration::from_millis(100)),
        Err(InputError::LimitExceeded)
    );
    let other = CaptureTime {
        session: OTHER_SESSION,
        elapsed: time(200).elapsed,
    };
    assert_eq!(
        RecentPresence::new(seen, other, Duration::from_secs(1)),
        Err(InputError::SessionMismatch)
    );
}

#[test]
fn visual_results_require_bounded_unique_tracks_from_the_exact_frame() {
    let seen = observation();
    let result =
        VisualAssessment::new(stamp(100), MODEL, CALIBRATION, vec![seen], limit(1)).unwrap();
    assert_eq!(result.observations(), &[seen]);
    assert_eq!(result.stamp(), stamp(100));
    assert_eq!(result.model(), MODEL);
    assert_eq!(result.calibration(), CALIBRATION);
    assert_eq!(
        VisualAssessment::new(stamp(101), MODEL, CALIBRATION, vec![seen], limit(1)).err(),
        Some(InputError::InvalidTimeRange)
    );
    assert_eq!(
        VisualAssessment::new(stamp(100), MODEL, CALIBRATION, vec![seen, seen], limit(2)).err(),
        Some(InputError::DuplicateTrack)
    );
    assert_eq!(
        VisualAssessment::new(stamp(100), MODEL, CALIBRATION, vec![seen, seen], limit(1)).err(),
        Some(InputError::LimitExceeded)
    );
    assert!(VisualAssessment::new(stamp(100), MODEL, CALIBRATION, vec![], limit(1)).is_ok());
    let other = TrackId {
        session: OTHER_SESSION,
        sequence: 9,
    };
    assert_eq!(
        VisualObservation::new(other, time(100), seen.location(), seen.identity()),
        Err(InputError::SessionMismatch)
    );
}

#[test]
fn location_keeps_uncertainty_and_rejects_nonfinite_geometry() {
    let frame = CoordinateFrameId([8; 16]);
    let position = PositionEstimate::new(frame, [1.0, 2.0, 3.0], 0.5).unwrap();
    assert_eq!(position.frame(), frame);
    assert_eq!(position.meters(), [1.0, 2.0, 3.0]);
    assert_eq!(position.uncertainty_meters(), 0.5);
    for uncertainty in [-1.0, f32::NAN, f32::INFINITY] {
        assert_eq!(
            PositionEstimate::new(frame, [0.0; 3], uncertainty),
            Err(InputError::InvalidPosition)
        );
    }
    assert_eq!(
        PositionEstimate::new(frame, [f32::NAN, 0.0, 0.0], 0.0),
        Err(InputError::InvalidPosition)
    );
}

#[test]
fn templates_are_bounded_and_replacement_advances_the_same_identity() {
    let original = enrollment(1);
    let replacement = enrollment(2);
    let update = EnrollmentReplacement::new(original.identity, &replacement).unwrap();
    assert_eq!(update.expected(), original.identity);
    assert_eq!(update.replacement().identity, replacement.identity);
    assert_eq!(replacement.voice.0.bytes(), &[1, 2, 3]);
    assert_eq!(replacement.voice.0.model(), MODEL);
    assert_eq!(replacement.voice.0.format_version().get(), 1);
    assert!(matches!(replacement.face, FaceEnrollment::Disabled));
    assert_eq!(
        EnrollmentReplacement::new(original.identity, &original).err(),
        Some(InputError::InvalidReplacement)
    );
    assert_eq!(
        EnrollmentReplacement::new(replacement.identity, &original).err(),
        Some(InputError::InvalidReplacement)
    );
    let mut other = enrollment(3);
    other.identity.id = EnrollmentId([9; 16]);
    assert_eq!(
        EnrollmentReplacement::new(original.identity, &other).err(),
        Some(InputError::InvalidReplacement)
    );
    let version = NonZeroU32::new(1).unwrap();
    assert_eq!(
        TemplateData::new(MODEL, version, vec![], limit(1)).err(),
        Some(InputError::Empty)
    );
    assert_eq!(
        TemplateData::new(MODEL, version, vec![1, 2], limit(1)).err(),
        Some(InputError::LimitExceeded)
    );
}

struct TestClock(Cell<CaptureTime>);

impl Clock for TestClock {
    fn now(&self) -> CaptureTime {
        self.0.get()
    }
}

struct TestCancellation(Cell<bool>);

impl Cancellation for TestCancellation {
    fn is_cancelled(&self) -> bool {
        self.0.get()
    }
}

#[test]
fn work_checks_detect_cancellation_exact_deadlines_and_epoch_changes() {
    let clock = TestClock(Cell::new(time(100)));
    let cancellation = TestCancellation(Cell::new(false));
    let work = WorkContext {
        deadline: time(200),
        clock: &clock,
        cancellation: &cancellation,
    };
    assert_eq!(work.check(), Ok(()));
    clock.0.set(time(200));
    assert_eq!(work.check(), Err(WorkError::DeadlineExceeded));
    clock.0.set(CaptureTime {
        session: OTHER_SESSION,
        elapsed: time(100).elapsed,
    });
    assert_eq!(work.check(), Err(WorkError::SessionChanged));
    cancellation.0.set(true);
    assert_eq!(work.check(), Err(WorkError::Cancelled));
}
