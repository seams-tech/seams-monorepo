//! Synchronous, bounded local adapter contracts. The later runtime owns scheduling.
//!
//! Input borrows end when the call returns. Implementations must finish or join every
//! native reader before returning, including on error. Cancellation is cooperative:
//! an uninterruptible call keeps its inputs alive and discards late output. No trait
//! implies `Send`, `Sync`, threads, networking, model downloads, or a plugin registry.
//! Dropping a live capture/decoder releases its native resources and cancels work.

use crate::domain::{
    AudioFormat, AudioFrame, Availability, CaptureReady, DeviceId, Discontinuity, EnrollmentRef,
    FailureReason, InputError, UnavailableReason, VideoFormat, VideoFrame,
};
use crate::enrollment::{EnrollmentRecord, EnrollmentReplacement, EnrollmentState};
use crate::presence::VisualAssessment;
use crate::runtime::{WorkContext, WorkError};
use crate::utterance::{
    Assessment, PartialTranscript, PresentationVerdict, SpeakerVerdict, SpeechWindow,
    TranscriptOutcome, UtteranceId, UtteranceSpan,
};

/// Recoverable adapter failure; errors never contain a successful observation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdapterError {
    /// Input failed the adapter's format, identity, or configured-limit contract.
    InvalidInput(InputError),
    /// Streaming input lost continuity; the current stream must be dropped.
    Discontinuity(Discontinuity),
    /// No usable local capability.
    Unavailable(UnavailableReason),
    /// Installed capability failed.
    Failed(FailureReason),
    /// Bounded worker/queue admission rejected the request.
    Overloaded,
    /// Request lost its cancellation/deadline/session eligibility.
    Work(WorkError),
}

/// Outcome from an already-open capture adapter.
pub enum CaptureEvent<Frame> {
    /// Owned, normalized media within the configured input limit.
    Frame(Frame),
    /// Terminal continuity loss. Drop/reopen with a fresh capture session.
    Discontinuity(Discontinuity),
    /// Terminal ordinary shutdown; no more frames may be emitted.
    Ended,
}

/// Open audio stream. Opening returns `Availability<impl AudioCapture>` at composition.
pub trait AudioCapture {
    /// Validated profile/clock mapping, fixed for this stream's lifetime.
    fn ready(&self) -> &CaptureReady<AudioFormat>;
    /// Transfer one bounded frame or terminal event; observe work cancellation/deadline.
    fn next_frame(
        &mut self,
        work: &WorkContext<'_>,
    ) -> Result<CaptureEvent<AudioFrame>, AdapterError>;
}

/// Open camera stream. Opening returns `Availability<impl VideoCapture>` at composition.
pub trait VideoCapture {
    /// Validated profile/clock mapping, fixed for this stream's lifetime.
    fn ready(&self) -> &CaptureReady<VideoFormat>;
    /// Transfer one bounded RGB8 frame or terminal event.
    fn next_frame(
        &mut self,
        work: &WorkContext<'_>,
    ) -> Result<CaptureEvent<VideoFrame>, AdapterError>;
}

/// Locally provisioned incremental recognizer; native Moonshine is the first backend.
pub trait Transcriber {
    /// Utterance-scoped decoder. A fresh stream cannot contain another utterance's text.
    type Stream: TranscriptStream;

    /// Explicit model availability; inference must never download missing assets.
    fn availability(&self) -> Availability<()>;
    /// Start one utterance. Missing model, admission, or work eligibility returns an error.
    fn start(
        &mut self,
        utterance: UtteranceId,
        work: &WorkContext<'_>,
    ) -> Result<Self::Stream, AdapterError>;
}

/// One active incremental decoder. `finish` consumes it; cancellation uses `Drop`.
///
/// ```compile_fail
/// use voiceid_engine::adapters::TranscriptStream;
/// use voiceid_engine::runtime::WorkContext;
/// use voiceid_engine::utterance::{SpeechWindow, UtteranceSpan};
/// fn reuse<S: TranscriptStream>(mut stream: S, span: UtteranceSpan,
///     chunk: &SpeechWindow, work: &WorkContext<'_>) {
///     let _ = stream.finish(span, work);
///     let _ = stream.push(chunk, work);
/// }
/// ```
pub trait TranscriptStream: Sized {
    /// Consume each contiguous chunk exactly once. Reject wrong utterance/session,
    /// reordered/gapped audio, unsupported format, or cumulative configured limits.
    /// Return a bounded full snapshot; native callbacks never escape this call.
    fn push(
        &mut self,
        chunk: &SpeechWindow,
        work: &WorkContext<'_>,
    ) -> Result<PartialTranscript, AdapterError>;
    /// Drain final decoder output for the exact accumulated source interval. Verify all
    /// lines finalized; errors and cancellation cannot return a final transcript.
    /// Successful finalization without recognized text returns `NoSpeech`.
    fn finish(
        self,
        source: UtteranceSpan,
        work: &WorkContext<'_>,
    ) -> Result<TranscriptOutcome, AdapterError>;
}

/// Independent current-window speaker/quality gate against the enrolled voice modality.
pub trait SpeakerMatcher {
    /// Model and calibration must both be provisioned and qualified.
    fn availability(&self) -> Availability<()>;
    /// Assess this exact source. Reject incompatible template/model versions.
    fn assess(
        &mut self,
        window: &SpeechWindow,
        enrollment: &EnrollmentRecord,
        work: &WorkContext<'_>,
    ) -> Result<Assessment<SpeakerVerdict>, AdapterError>;
}

/// Presentation-attack detection (PAD), separate from speaker identity and ASR.
pub trait PresentationAttackDetector {
    /// Missing or uncalibrated models provide no passing gate.
    fn availability(&self) -> Availability<()>;
    /// Evaluate a bounded current-utterance window independently of speaker similarity.
    fn assess(
        &mut self,
        window: &SpeechWindow,
        work: &WorkContext<'_>,
    ) -> Result<Assessment<PresentationVerdict>, AdapterError>;
}

/// Frame analysis/tracking with bounded adapter-owned temporal state, cleared on epoch change.
pub trait VisualAnalyzer {
    /// Missing camera/model/calibration remains explicit.
    fn availability(&self) -> Availability<()>;
    /// Return at most the configured track count for the exact input frame.
    /// Empty enrollment or disabled face enrollment permits unknown-identity tracking only.
    /// Any retained frame copy is adapter-owned, bounded, and released on drop/reset.
    fn analyze(
        &mut self,
        frame: &VideoFrame,
        enrollment: &EnrollmentState,
        work: &WorkContext<'_>,
    ) -> Result<VisualAssessment, AdapterError>;
}

/// Atomic protected-storage failure; persistence conflicts are ordinary domain outcomes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreError {
    /// Required key protection or local storage is unavailable.
    Unavailable(UnavailableReason),
    /// Create/replace/delete precondition no longer matches durable state.
    Conflict,
    /// Record belongs to a different device or fails authenticated decoding.
    InvalidRecord,
    /// Storage operation failed with its prior committed state preserved.
    Failed,
    /// An I/O failure left commit status unknown. Invalidate in-memory evidence and
    /// authenticate/reload durable state before accepting further work.
    CommitUncertain,
    /// Work stopped before the atomic commit point; durable state is unchanged.
    Work(WorkError),
}

/// One device's single-owner template store. No plaintext filesystem implementation exists.
/// Encrypt/authenticate with a randomly generated device-protected key and bind device,
/// enrollment/version, modality, model, and encoding version. No key derives from voice.
///
/// Mutations are atomic and return success after the commit point, even if cancellation
/// arrives during commit. Report `Work` only when nothing committed; uncertain persistence
/// uses `CommitUncertain`. The runtime serializes mutations with evidence invalidation;
/// successful or uncertain mutations invalidate old references.
pub trait TemplateStore {
    /// Device binding required for every loaded or committed record.
    fn device(&self) -> DeviceId;
    /// Authenticate/decode within configured template limits; return owned plaintext in RAM.
    fn load(&mut self, work: &WorkContext<'_>) -> Result<EnrollmentState, StoreError>;
    /// Commit the entire approved template set only if no enrollment exists.
    fn create(
        &mut self,
        record: &EnrollmentRecord,
        work: &WorkContext<'_>,
    ) -> Result<(), StoreError>;
    /// Atomically compare the old version and replace the whole template set.
    fn replace(
        &mut self,
        replacement: EnrollmentReplacement<'_>,
        work: &WorkContext<'_>,
    ) -> Result<(), StoreError>;
    /// Delete only the expected version; return conflict if it has changed or is absent.
    fn delete(&mut self, expected: EnrollmentRef, work: &WorkContext<'_>)
    -> Result<(), StoreError>;
}

#[cfg(not(target_family = "wasm"))]
mod native;
