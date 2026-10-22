//! Utterance segmentation and association of transcript and voice-stage results.
//! Model execution belongs to adapters; identity attribution has its own module.

use std::num::NonZeroUsize;
use std::time::Duration;

use crate::domain::{
    AudioFrame, CalibrationId, CaptureSessionId, IdentityMatch, InputError, ModelId, TimeRange,
};

/// Unique utterance within one uninterrupted capture session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UtteranceId {
    /// Capture epoch; results from older epochs are unusable.
    pub session: CaptureSessionId,
    /// Runtime-assigned sequence, never reused in this session.
    pub sequence: u64,
}

/// Utterance identity bound to the exact captured evidence interval.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UtteranceSpan {
    id: UtteranceId,
    captured: TimeRange,
}

impl UtteranceSpan {
    /// Reject a window from a different capture session.
    pub fn new(id: UtteranceId, captured: TimeRange) -> Result<Self, InputError> {
        if id.session != captured.start().session {
            return Err(InputError::SessionMismatch);
        }
        Ok(Self { id, captured })
    }

    /// Shared key used to correlate every stage result.
    pub fn id(self) -> UtteranceId {
        self.id
    }

    /// Exact source interval; earlier speech is separate evidence.
    pub fn captured(self) -> TimeRange {
        self.captured
    }
}

/// Owned mono PCM for one bounded model window or incremental chunk.
pub struct SpeechWindow {
    source: UtteranceSpan,
    audio: AudioFrame,
}

impl SpeechWindow {
    /// Accept an explicitly derived mono view. This performs no resampling or downmixing.
    /// `max_duration` comes from the locally selected model/runtime profile.
    pub fn new(
        utterance: UtteranceId,
        audio: AudioFrame,
        max_duration: Duration,
    ) -> Result<Self, InputError> {
        if audio.format().channels.get() != 1 {
            return Err(InputError::InvalidAudio);
        }
        if audio.span().duration() > max_duration {
            return Err(InputError::LimitExceeded);
        }
        let source = UtteranceSpan::new(utterance, audio.span())?;
        Ok(Self { source, audio })
    }

    /// Exact source interval and utterance identity.
    pub fn source(&self) -> UtteranceSpan {
        self.source
    }

    /// Borrowed model input. Adapters may only retain it while the call is active.
    pub fn audio(&self) -> &AudioFrame {
        &self.audio
    }
}

/// Replaceable full-text snapshot from an active incremental decoder.
/// It cannot be used where a final transcript is required.
///
/// ```compile_fail
/// use voiceid_engine::utterance::{FinalTranscript, PartialTranscript};
/// fn finalized_only(_: FinalTranscript) {}
/// fn premature(partial: PartialTranscript) { finalized_only(partial); }
/// ```
pub struct PartialTranscript {
    source: UtteranceSpan,
    model: ModelId,
    revision: u64,
    text: String,
}

impl PartialTranscript {
    /// Normalize backend line revisions into one full snapshot, bounded in UTF-8 bytes.
    /// Empty text is valid before recognition; revisions increase within the stream.
    pub fn new(
        source: UtteranceSpan,
        model: ModelId,
        revision: u64,
        text: String,
        max_bytes: NonZeroUsize,
    ) -> Result<Self, InputError> {
        if text.len() > max_bytes.get() {
            return Err(InputError::LimitExceeded);
        }
        Ok(Self {
            source,
            model,
            revision,
            text,
        })
    }

    /// Audio consumed through this snapshot.
    pub fn source(&self) -> UtteranceSpan {
        self.source
    }
    /// Exact model revision.
    pub fn model(&self) -> ModelId {
        self.model
    }
    /// Monotonic full-snapshot revision; replacement never appends duplicate text.
    pub fn revision(&self) -> u64 {
        self.revision
    }
    /// Borrowed sensitive text, excluded from `Debug` and automatic copying.
    pub fn text(&self) -> &str {
        &self.text
    }
}

/// Immutable transcript emitted only after a successful decoder final drain.
pub struct FinalTranscript {
    source: UtteranceSpan,
    model: ModelId,
    text: String,
}

/// Final decoder outcome. Silence or unrecognized speech is an ordinary result.
pub enum TranscriptOutcome {
    /// Nonempty finalized text from the closed utterance.
    Speech(FinalTranscript),
    /// Decoder finalized successfully without recognized text.
    NoSpeech(UtteranceSpan),
}

impl FinalTranscript {
    /// Accept bounded final text from an adapter. There is no conversion from partial
    /// transcripts; the adapter must finalize and validate its native decoder output.
    pub fn new(
        source: UtteranceSpan,
        model: ModelId,
        text: String,
        max_bytes: NonZeroUsize,
    ) -> Result<Self, InputError> {
        if text.len() > max_bytes.get() {
            return Err(InputError::LimitExceeded);
        }
        if text.trim().is_empty() {
            return Err(InputError::Empty);
        }
        Ok(Self {
            source,
            model,
            text,
        })
    }

    /// Full, closed utterance source interval.
    pub fn source(&self) -> UtteranceSpan {
        self.source
    }
    /// Exact model revision.
    pub fn model(&self) -> ModelId {
        self.model
    }
    /// Borrowed sensitive text; callers must keep it out of ordinary logs.
    pub fn text(&self) -> &str {
        &self.text
    }
}

/// A calibrated stage's verdict bound to current source evidence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Assessment<T> {
    /// Exact utterance and interval assessed; the runtime checks result correlation.
    pub source: UtteranceSpan,
    /// Exact offline model artifact revision.
    pub model: ModelId,
    /// Device/model gate calibration applied by the adapter.
    pub calibration: CalibrationId,
    /// Domain verdict, independent of diagnostic scores.
    pub verdict: T,
}

/// Current-window speaker assessment; insufficient evidence cannot carry an identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpeakerVerdict {
    /// Quality-qualified matching outcome, including unknown or ambiguous.
    Identity(IdentityMatch),
    /// Too little clean speech for a match assessment.
    InsufficientSpeech,
    /// More than one simultaneous speaker was detected.
    OverlappingSpeech,
}
