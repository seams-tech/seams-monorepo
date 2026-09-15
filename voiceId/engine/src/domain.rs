//! Shared capture, utterance, enrollment, observation, and attribution values.
//! Owns no device access, model implementation, application policy, or wallet types.

use std::num::{NonZeroU16, NonZeroU32, NonZeroU64, NonZeroUsize};
use std::time::Duration;

/// Host-generated capture epoch. Allocate a fresh value on restart or discontinuity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaptureSessionId(pub [u8; 16]);

/// Stable local enrollment identifier; independent of its template version.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EnrollmentId(pub [u8; 16]);

/// Local storage device identity, bound into protected template metadata.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DeviceId(pub [u8; 16]);

/// Exact provisioned model artifact revision, including preprocessing configuration.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModelId(pub [u8; 32]);

/// Exact calibrated gate revision for a model and device profile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CalibrationId(pub [u8; 32]);

/// Configured capture or attribution profile revision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProfileId(pub [u8; 32]);

/// Spatial reference frame revision, including the applicable pose/geometry mapping.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CoordinateFrameId(pub [u8; 16]);

/// One immutable enrollment version. Replacement invalidates references to the old version.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EnrollmentRef {
    /// Stable enrollment identity.
    pub id: EnrollmentId,
    /// Monotonically increasing template-set version.
    pub version: NonZeroU64,
}

/// An identity assessment. Unknown and ambiguous results carry no owner identity.
///
/// ```compile_fail
/// use voiceid_engine::domain::{EnrollmentRef, IdentityMatch};
/// fn invent_owner(owner: EnrollmentRef) -> IdentityMatch {
///     IdentityMatch::Unknown(owner)
/// }
/// ```
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IdentityMatch {
    /// The current evidence matched an enrolled template version.
    Matched(EnrollmentRef),
    /// No enrolled identity matched.
    Unknown,
    /// Evidence cannot select one speaker or identity.
    Ambiguous,
}

/// Time since the local capture epoch, after acquisition-clock normalization.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaptureTime {
    /// Epoch shared by audio, video, and the runtime clock.
    pub session: CaptureSessionId,
    /// Monotonic elapsed time; never wall-clock time.
    pub elapsed: Duration,
}

/// Boundary validation failure. Payloads omit media and biometric data.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputError {
    /// Values belong to different capture epochs.
    SessionMismatch,
    /// Input belongs to another utterance in the same capture session.
    UtteranceMismatch,
    /// A time range is empty, reversed, or overflows.
    InvalidTimeRange,
    /// Input is empty where data is required.
    Empty,
    /// Input exceeds a configured bound.
    LimitExceeded,
    /// PCM length, channel layout, or sample values are invalid.
    InvalidAudio,
    /// Video dimensions and byte length disagree.
    InvalidVideo,
    /// Coordinates or uncertainty are non-finite or outside their valid range.
    InvalidPosition,
    /// A visual result repeats the same track in one frame.
    DuplicateTrack,
    /// Replacement does not advance the same enrollment's version.
    InvalidReplacement,
}

/// Nonempty half-open interval within one capture epoch: `[start, end)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeRange {
    start: CaptureTime,
    end: CaptureTime,
}

impl TimeRange {
    /// Validate one epoch and strictly increasing times at the input boundary.
    pub fn new(start: CaptureTime, end: CaptureTime) -> Result<Self, InputError> {
        if start.session != end.session {
            return Err(InputError::SessionMismatch);
        }
        if start.elapsed >= end.elapsed {
            return Err(InputError::InvalidTimeRange);
        }
        Ok(Self { start, end })
    }

    /// Inclusive beginning.
    pub fn start(self) -> CaptureTime {
        self.start
    }

    /// Exclusive end or expiration deadline.
    pub fn end(self) -> CaptureTime {
        self.end
    }

    /// Length in the shared monotonic timeline.
    pub fn duration(self) -> Duration {
        self.end.elapsed - self.start.elapsed
    }

    /// Cross-epoch times and the exact expiration deadline are outside the range.
    pub fn contains(self, time: CaptureTime) -> bool {
        time.session == self.start.session
            && time.elapsed >= self.start.elapsed
            && time.elapsed < self.end.elapsed
    }
}

/// Source-clock mapping established by acquisition for one uninterrupted epoch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClockMapping {
    /// Source device's elapsed time at synchronization.
    pub source_origin: Duration,
    /// Corresponding normalized local capture time.
    pub local_origin: CaptureTime,
    /// Qualified upper bound on mapping error.
    pub maximum_error: Duration,
}

/// A usable sensor's required profile and clock mapping.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaptureReady<Format> {
    /// Exact configured capture profile.
    pub profile: ProfileId,
    /// Validated media format.
    pub format: Format,
    /// Source-to-local clock mapping for this stream.
    pub clock: ClockMapping,
}

/// A missing capability cannot provide observations through this state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Availability<T> {
    /// Usable configuration or capability.
    Available(T),
    /// No usable capability was provisioned or permitted.
    Unavailable(UnavailableReason),
    /// An installed capability failed.
    Failed(FailureReason),
}

/// Explicit reasons a capability cannot contribute evidence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnavailableReason {
    /// No device or artifact was provisioned locally.
    Missing,
    /// Local configuration disabled this capability.
    Disabled,
    /// The host denied access.
    PermissionDenied,
    /// This target cannot implement the capability.
    Unsupported,
    /// No qualified calibration or coordinate mapping is available.
    Uncalibrated,
}

/// Bounded diagnostic categories; vendor messages remain outside domain control flow.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailureReason {
    /// Device acquisition failed.
    Device,
    /// Model loading or inference failed.
    Model,
    /// A backend returned malformed or inconsistent output.
    InvalidOutput,
    /// Protected local storage failed.
    Storage,
}

/// Why continuity ended. Every variant invalidates affected pending evidence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Discontinuity {
    /// Capture sequence numbers skipped or repeated.
    SequenceGap,
    /// A bounded queue or media ring overflowed.
    Overflow,
    /// A source device or its format changed.
    DeviceChanged,
    /// Source clock reset or its mapping became invalid.
    ClockReset,
}

/// Per-stream sequence identity and normalized acquisition time.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameStamp {
    /// Monotonically increasing sequence number within this sensor stream.
    pub sequence: u64,
    /// Time of the first audio sample or camera exposure.
    pub captured_at: CaptureTime,
}

/// Interleaved PCM layout. Channel order is defined by the capture profile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AudioFormat {
    /// Samples per second per channel.
    pub sample_rate_hz: NonZeroU32,
    /// Preserved source channels. One channel provides no array direction.
    pub channels: NonZeroU16,
}

/// Owned, bounded interleaved PCM. Deliberately implements neither `Clone` nor `Debug`.
///
/// ```compile_fail
/// use voiceid_engine::domain::AudioFrame;
/// fn copy_media(frame: AudioFrame) { let _ = frame.clone(); }
/// ```
///
/// ```compile_fail
/// use voiceid_engine::domain::AudioFrame;
/// fn log_media(frame: AudioFrame) { println!("{frame:?}"); }
/// ```
pub struct AudioFrame {
    stamp: FrameStamp,
    format: AudioFormat,
    span: TimeRange,
    samples: Vec<f32>,
}

impl AudioFrame {
    /// Take ownership after validating the ready stream, configured size limit,
    /// normalized finite PCM in `[-1, 1]`, and whole interleaved sample frames.
    /// The host binding checks the limit before allocating or copying raw input.
    pub fn new(
        ready: &CaptureReady<AudioFormat>,
        stamp: FrameStamp,
        samples: Vec<f32>,
        max_samples: NonZeroUsize,
    ) -> Result<Self, InputError> {
        if stamp.captured_at.session != ready.clock.local_origin.session {
            return Err(InputError::SessionMismatch);
        }
        if samples.is_empty() {
            return Err(InputError::Empty);
        }
        if samples.len() > max_samples.get() {
            return Err(InputError::LimitExceeded);
        }
        let channels = usize::from(ready.format.channels.get());
        if !samples.len().is_multiple_of(channels) {
            return Err(InputError::InvalidAudio);
        }
        for sample in &samples {
            if !sample.is_finite() || !(-1.0..=1.0).contains(sample) {
                return Err(InputError::InvalidAudio);
            }
        }
        let sample_frames =
            u64::try_from(samples.len() / channels).map_err(|_| InputError::LimitExceeded)?;
        let rate = u64::from(ready.format.sample_rate_hz.get());
        let duration = Duration::from_secs(sample_frames / rate)
            + Duration::from_nanos((sample_frames % rate) * 1_000_000_000 / rate);
        let end = CaptureTime {
            session: stamp.captured_at.session,
            elapsed: stamp
                .captured_at
                .elapsed
                .checked_add(duration)
                .ok_or(InputError::InvalidTimeRange)?,
        };
        let span = TimeRange::new(stamp.captured_at, end)?;
        Ok(Self {
            stamp,
            format: ready.format,
            span,
            samples,
        })
    }

    /// Source sequence and acquisition time.
    pub fn stamp(&self) -> FrameStamp {
        self.stamp
    }

    /// Source format, including preserved channel count.
    pub fn format(&self) -> AudioFormat {
        self.format
    }

    /// Sample-derived time interval, rounded down to nanoseconds.
    pub fn span(&self) -> TimeRange {
        self.span
    }

    /// Immutable borrow valid only for the lifetime of this frame.
    pub fn samples(&self) -> &[f32] {
        &self.samples
    }
}

/// Contiguous RGB8 input for the first portable visual boundary.
/// Platform-specific camera formats are converted by the capture adapter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VideoFormat {
    /// Pixels per row, with no stride padding in normalized input.
    pub width: NonZeroU32,
    /// Number of rows.
    pub height: NonZeroU32,
}

/// Owned, bounded RGB8 frame. Media is excluded from automatic logs and copies.
pub struct VideoFrame {
    stamp: FrameStamp,
    format: VideoFormat,
    pixels: Vec<u8>,
}

impl VideoFrame {
    /// Validate the ready stream and exact RGB8 length before accepting ownership.
    /// Bindings must check `max_bytes` before allocating the input buffer.
    pub fn new(
        ready: &CaptureReady<VideoFormat>,
        stamp: FrameStamp,
        pixels: Vec<u8>,
        max_bytes: NonZeroUsize,
    ) -> Result<Self, InputError> {
        if stamp.captured_at.session != ready.clock.local_origin.session {
            return Err(InputError::SessionMismatch);
        }
        if pixels.len() > max_bytes.get() {
            return Err(InputError::LimitExceeded);
        }
        let expected = u64::from(ready.format.width.get())
            .checked_mul(u64::from(ready.format.height.get()))
            .and_then(rgb_byte_count)
            .ok_or(InputError::InvalidVideo)?;
        if u64::try_from(pixels.len()).ok() != Some(expected) {
            return Err(InputError::InvalidVideo);
        }
        Ok(Self {
            stamp,
            format: ready.format,
            pixels,
        })
    }

    /// Source sequence and acquisition time.
    pub fn stamp(&self) -> FrameStamp {
        self.stamp
    }

    /// Normalized frame dimensions.
    pub fn format(&self) -> VideoFormat {
        self.format
    }

    /// Immutable RGB8 borrow valid only while this frame is alive.
    pub fn pixels(&self) -> &[u8] {
        &self.pixels
    }
}

fn rgb_byte_count(pixels: u64) -> Option<u64> {
    pixels.checked_mul(3)
}
