//! Session lifecycle, bounded work, deadlines, cancellation, and stage coordination.
//! One synchronous audio attempt runs at a time. Model implementations remain injected.

use std::num::NonZeroUsize;
use std::time::Duration;

use crate::adapters::{AdapterError, SpeakerMatcher, Transcriber, TranscriptStream};
use crate::attribution::{AttributionOutcome, InsufficientReason, SupportingGate, attribute_audio};
use crate::domain::{
    AudioFormat, AudioFrame, Availability, CaptureReady, CaptureTime, Discontinuity, EnrollmentRef,
    FailureReason, FrameStamp, InputError, ModelId, ProfileId, TimeRange, UnavailableReason,
};
use crate::enrollment::EnrollmentState;
use crate::utterance::{
    PartialTranscript, SpeechWindow, TranscriptOutcome, UtteranceId, UtteranceSpan,
};

const CANONICAL_SAMPLE_RATE_HZ: u32 = 16_000;

/// Injected monotonic clock in the current capture epoch. Never use wall-clock time.
pub trait Clock {
    /// Read time without blocking. An epoch change invalidates outstanding work.
    fn now(&self) -> CaptureTime;
}

/// Read-only cancellation view, supplied by the runtime for one unit of work.
pub trait Cancellation {
    /// Once true, this value stays true for the remainder of the work's lifetime.
    fn is_cancelled(&self) -> bool;
}

/// A stage must stop contributing results after any of these conditions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkError {
    /// The owning request was cancelled.
    Cancelled,
    /// The exclusive deadline has been reached.
    DeadlineExceeded,
    /// The runtime clock moved into another capture epoch.
    SessionChanged,
}

/// Required deadline and cancellation context for every potentially blocking adapter call.
pub struct WorkContext<'a> {
    /// Exclusive completion deadline in the capture epoch.
    pub deadline: CaptureTime,
    /// Runtime-owned monotonic time source.
    pub clock: &'a dyn Clock,
    /// Runtime-owned cancellation state.
    pub cancellation: &'a dyn Cancellation,
}

impl WorkContext<'_> {
    /// Check admission or completion. Call before work, between interruptible chunks,
    /// and after native work returns. The runtime independently checks before consumption.
    /// Cancellation never permits releasing memory still used by a native reader.
    pub fn check(&self) -> Result<(), WorkError> {
        if self.cancellation.is_cancelled() {
            return Err(WorkError::Cancelled);
        }
        let now = self.clock.now();
        if now.session != self.deadline.session {
            return Err(WorkError::SessionChanged);
        }
        if now.elapsed >= self.deadline.elapsed {
            return Err(WorkError::DeadlineExceeded);
        }
        Ok(())
    }
}

/// Immutable local audio profile. Constructors validate its bounds before starting work.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AudioProfile {
    /// Exact attribution configuration revision.
    pub id: ProfileId,
    /// Required transcription artifact revision.
    pub transcription_model: ModelId,
    /// Required speaker artifact and calibration revisions.
    pub speaker: SupportingGate,
    /// Maximum retained mono sample count for one utterance.
    pub maximum_samples: NonZeroUsize,
    /// Maximum captured duration for one utterance.
    pub maximum_duration: Duration,
    /// Maximum UTF-8 bytes in a partial or final transcript.
    pub maximum_text_bytes: NonZeroUsize,
    /// Maximum age of the first sample, including capture-clock uncertainty.
    pub maximum_evidence_age: Duration,
}

/// Terminal capture/session state. A fresh epoch is required before more work.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopReason {
    /// Explicit close, lock, or host shutdown.
    Closed,
    /// Capture or clock continuity ended.
    Discontinuity(Discontinuity),
}

/// Read-only lifecycle view. It contains no transcript, media, or approval authority.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeStatus {
    /// No pending utterance or result.
    Idle,
    /// One utterance owns the decoder and bounded audio buffer.
    Listening(UtteranceId),
    /// One finalized result awaits consumption or cancellation.
    Completed(UtteranceId),
    /// Capture must restart with a fresh session identity.
    Stopped(StopReason),
}

/// Finalized perception output. This grants no robot action or wallet signing authority.
/// The consumer must bind any approval to its own pending operation and lifecycle.
///
/// ```compile_fail
/// use voiceid_engine::attribution::AttributionOutcome;
/// use voiceid_engine::domain::TimeRange;
/// use voiceid_engine::runtime::CompletedUtterance;
/// use voiceid_engine::utterance::TranscriptOutcome;
/// fn fabricate(transcript: TranscriptOutcome, attribution: AttributionOutcome,
///     validity: TimeRange) -> CompletedUtterance {
///     CompletedUtterance { transcript, attribution, validity }
/// }
/// ```
pub struct CompletedUtterance {
    transcript: TranscriptOutcome,
    attribution: AttributionOutcome,
    validity: TimeRange,
}

impl CompletedUtterance {
    /// Final decoder outcome; partial snapshots cannot enter this result.
    pub fn transcript(&self) -> &TranscriptOutcome {
        &self.transcript
    }

    /// Source-bound speaker outcome under the configured audio-only profile.
    pub fn attribution(&self) -> &AttributionOutcome {
        &self.attribution
    }

    /// Exclusive lifetime checked again when the runtime releases this result.
    pub fn validity(&self) -> TimeRange {
        self.validity
    }
}

enum AudioBuffer {
    Empty,
    Captured {
        first: FrameStamp,
        last_sequence: u64,
        end: CaptureTime,
        samples: Vec<f32>,
    },
}

struct ActiveUtterance<S> {
    id: UtteranceId,
    opened_at: CaptureTime,
    deadline: CaptureTime,
    stream: S,
    revision: u64,
    audio: AudioBuffer,
}

struct PendingResult {
    id: UtteranceId,
    owner: EnrollmentRef,
    result: CompletedUtterance,
}

enum RuntimeState<S> {
    Idle,
    Listening(ActiveUtterance<S>),
    Completed(PendingResult),
    Stopped(StopReason),
}

/// Bounded audio coordinator for a user-controlled device. No PAD or visual gate runs.
/// Capture acquisition, segmentation, model provisioning, and protected storage stay external.
/// An adapter must finish all native readers before returning, including after cancellation.
pub struct AudioRuntime<T: Transcriber, M> {
    ready: CaptureReady<AudioFormat>,
    profile: AudioProfile,
    enrollment: EnrollmentState,
    transcriber: T,
    matcher: M,
    next_utterance: u64,
    last_observed: CaptureTime,
    state: RuntimeState<T::Stream>,
}

impl<T: Transcriber, M: SpeakerMatcher> AudioRuntime<T, M> {
    /// Compose one mono capture session with authenticated enrollment state and model adapters.
    /// Artifact identities name already provisioned adapters; this constructor loads no models.
    pub fn new(
        ready: CaptureReady<AudioFormat>,
        profile: AudioProfile,
        enrollment: EnrollmentState,
        transcriber: T,
        matcher: M,
    ) -> Result<Self, AdapterError> {
        validate_configuration(&ready, profile)?;
        validate_enrollment(&enrollment, profile)?;
        Ok(Self {
            ready,
            profile,
            enrollment,
            transcriber,
            matcher,
            next_utterance: 0,
            last_observed: ready.clock.local_origin,
            state: RuntimeState::Idle,
        })
    }

    /// Inspect the actual lifecycle without exposing retained sensitive data.
    pub fn status(&self) -> RuntimeStatus {
        match &self.state {
            RuntimeState::Idle => RuntimeStatus::Idle,
            RuntimeState::Listening(active) => RuntimeStatus::Listening(active.id),
            RuntimeState::Completed(pending) => RuntimeStatus::Completed(pending.id),
            RuntimeState::Stopped(reason) => RuntimeStatus::Stopped(*reason),
        }
    }

    /// Open a fresh utterance after the consumer presents its operation or starts listening.
    /// The first sample must follow this call. Busy admission preserves existing work.
    pub fn begin(&mut self, work: &WorkContext<'_>) -> Result<UtteranceId, AdapterError> {
        match self.state {
            RuntimeState::Idle => {}
            RuntimeState::Listening(_) | RuntimeState::Completed(_) => {
                return Err(AdapterError::Overloaded);
            }
            RuntimeState::Stopped(_) => {
                return Err(AdapterError::Unavailable(UnavailableReason::Missing));
            }
        }
        let opened_at = self.check_work(work.deadline, work)?;
        self.owner()?;
        require_available(self.transcriber.availability())?;
        require_available(self.matcher.availability())?;
        let id = UtteranceId {
            session: self.ready.clock.local_origin.session,
            sequence: self.next_utterance,
        };
        self.next_utterance = self
            .next_utterance
            .checked_add(1)
            .ok_or(AdapterError::InvalidInput(InputError::LimitExceeded))?;
        let started = self.transcriber.start(id, work);
        let stream = self.stage_result(started, work.deadline, work)?;
        self.state = RuntimeState::Listening(ActiveUtterance {
            id,
            opened_at,
            deadline: work.deadline,
            stream,
            revision: 0,
            audio: AudioBuffer::Empty,
        });
        Ok(id)
    }

    /// Submit one contiguous mono chunk. A failed push drops this attempt's decoder/buffer.
    /// A stale utterance identity cannot cancel or modify another active attempt.
    pub fn push(
        &mut self,
        id: UtteranceId,
        audio: AudioFrame,
        work: &WorkContext<'_>,
    ) -> Result<PartialTranscript, AdapterError> {
        let mut active = self.take_active(id)?;
        let work = bounded_work(active.deadline, work);
        let now = self.check_work(active.deadline, &work)?;
        if audio.format() != self.ready.format {
            self.stop(StopReason::Discontinuity(Discontinuity::DeviceChanged));
            return Err(AdapterError::Discontinuity(Discontinuity::DeviceChanged));
        }
        if audio.span().start().session != id.session {
            return Err(AdapterError::InvalidInput(InputError::SessionMismatch));
        }
        let latest_end = now.elapsed.saturating_add(self.ready.clock.maximum_error);
        if audio.span().start().elapsed < active.opened_at.elapsed
            || audio.span().end().elapsed > latest_end
        {
            return Err(AdapterError::InvalidInput(InputError::InvalidTimeRange));
        }
        let chunk = SpeechWindow::new(id, audio, self.profile.maximum_duration)
            .map_err(AdapterError::InvalidInput)?;
        let source = match active.audio.source_after(&chunk, self.profile) {
            Ok(source) => source,
            Err(error @ AdapterError::Discontinuity(reason)) => {
                self.stop(StopReason::Discontinuity(reason));
                return Err(error);
            }
            Err(error) => return Err(error),
        };
        let pushed = active.stream.push(&chunk, &work);
        let partial = self.stage_result(pushed, active.deadline, &work)?;
        if partial.source() != source
            || partial.model() != self.profile.transcription_model
            || partial.revision() <= active.revision
            || partial.text().len() > self.profile.maximum_text_bytes.get()
        {
            return Err(AdapterError::Failed(FailureReason::InvalidOutput));
        }
        active.audio.append(&chunk);
        active.revision = partial.revision();
        self.state = RuntimeState::Listening(active);
        Ok(partial)
    }

    /// Consume the decoder, assess the exact accumulated speech, and retain one result.
    /// The original deadline cannot be extended by passing a later work context.
    pub fn finish(&mut self, id: UtteranceId, work: &WorkContext<'_>) -> Result<(), AdapterError> {
        let active = self.take_active(id)?;
        let work = bounded_work(active.deadline, work);
        self.check_work(active.deadline, &work)?;
        let window = active.audio.into_window(id, &self.ready, self.profile)?;
        let source = window.source();
        let finished = active.stream.finish(source, &work);
        let transcript = self.stage_result(finished, active.deadline, &work)?;
        validate_transcript(&transcript, source, self.profile)?;
        let owner = self.owner()?;
        let assessment = match &transcript {
            TranscriptOutcome::Speech(_) => {
                let EnrollmentState::Enrolled(record) = &self.enrollment else {
                    return Err(AdapterError::Unavailable(UnavailableReason::Missing));
                };
                let assessed = self.matcher.assess(&window, record, &work);
                let assessment = self.stage_result(assessed, active.deadline, &work)?;
                if assessment.source != source
                    || assessment.model != self.profile.speaker.model
                    || assessment.calibration != self.profile.speaker.calibration
                {
                    return Err(AdapterError::Failed(FailureReason::InvalidOutput));
                }
                Some(assessment)
            }
            TranscriptOutcome::NoSpeech(_) => None,
        };
        let now = self.check_work(active.deadline, &work)?;
        let evidence_deadline = source
            .captured()
            .start()
            .elapsed
            .saturating_add(self.profile.maximum_evidence_age)
            .saturating_sub(self.ready.clock.maximum_error);
        let end = CaptureTime {
            session: id.session,
            elapsed: active.deadline.elapsed.min(evidence_deadline),
        };
        if now.elapsed >= end.elapsed {
            return Err(AdapterError::Work(WorkError::DeadlineExceeded));
        }
        let validity = TimeRange::new(now, end).map_err(AdapterError::InvalidInput)?;
        let attribution = match assessment {
            Some(assessment) => attribute_audio(assessment, owner, self.profile.id, validity),
            None => AttributionOutcome::Insufficient {
                utterance: source,
                reason: InsufficientReason::MissingEvidence,
            },
        };
        self.state = RuntimeState::Completed(PendingResult {
            id,
            owner,
            result: CompletedUtterance {
                transcript,
                attribution,
                validity,
            },
        });
        Ok(())
    }

    /// Release this result once, after rechecking cancellation, age, epoch, and enrollment.
    pub fn take_result(
        &mut self,
        id: UtteranceId,
        work: &WorkContext<'_>,
    ) -> Result<CompletedUtterance, AdapterError> {
        let state = std::mem::replace(&mut self.state, RuntimeState::Idle);
        let pending = match state {
            RuntimeState::Completed(pending) if pending.id == id => pending,
            other => {
                self.state = other;
                return Err(AdapterError::InvalidInput(InputError::UtteranceMismatch));
            }
        };
        self.check_work(pending.result.validity.end(), work)?;
        if self.owner()? != pending.owner {
            return Err(AdapterError::InvalidInput(InputError::InvalidReplacement));
        }
        Ok(pending.result)
    }

    /// Cancel one active or completed attempt without affecting a different utterance.
    pub fn cancel(&mut self, id: UtteranceId) -> Result<(), AdapterError> {
        let matches = match &self.state {
            RuntimeState::Listening(active) => active.id == id,
            RuntimeState::Completed(pending) => pending.id == id,
            RuntimeState::Idle | RuntimeState::Stopped(_) => false,
        };
        if !matches {
            return Err(AdapterError::InvalidInput(InputError::UtteranceMismatch));
        }
        self.state = RuntimeState::Idle;
        Ok(())
    }

    /// Invalidate pending evidence before installing an authenticated storage reload.
    /// Failed validation leaves enrollment empty. Durable writes belong to `TemplateStore`.
    pub fn reload_enrollment(&mut self, enrollment: EnrollmentState) -> Result<(), AdapterError> {
        if !matches!(self.state, RuntimeState::Stopped(_)) {
            self.state = RuntimeState::Idle;
        }
        self.enrollment = EnrollmentState::Empty;
        validate_enrollment(&enrollment, self.profile)?;
        self.enrollment = enrollment;
        Ok(())
    }

    /// Drop retained media, the decoder, and pending output. No authority survives a stop.
    pub fn stop(&mut self, reason: StopReason) {
        self.state = RuntimeState::Stopped(reason);
    }

    /// Restart acquisition with a different epoch. Utterance sequences never reset.
    /// Replacing models or the attribution profile requires constructing a new runtime.
    pub fn restart(&mut self, ready: CaptureReady<AudioFormat>) -> Result<(), AdapterError> {
        self.stop(StopReason::Closed);
        validate_configuration(&ready, self.profile)?;
        if ready.clock.local_origin.session == self.ready.clock.local_origin.session {
            return Err(AdapterError::InvalidInput(InputError::SessionMismatch));
        }
        self.ready = ready;
        self.last_observed = ready.clock.local_origin;
        self.state = RuntimeState::Idle;
        Ok(())
    }

    fn owner(&self) -> Result<EnrollmentRef, AdapterError> {
        match &self.enrollment {
            EnrollmentState::Enrolled(record) => Ok(record.identity),
            EnrollmentState::Empty => Err(AdapterError::Unavailable(UnavailableReason::Missing)),
        }
    }

    fn stage_result<R>(
        &mut self,
        result: Result<R, AdapterError>,
        deadline: CaptureTime,
        work: &WorkContext<'_>,
    ) -> Result<R, AdapterError> {
        self.check_work(deadline, work)?;
        if let Err(AdapterError::Discontinuity(reason)) = &result {
            self.stop(StopReason::Discontinuity(*reason));
        }
        result
    }

    fn take_active(&mut self, id: UtteranceId) -> Result<ActiveUtterance<T::Stream>, AdapterError> {
        let state = std::mem::replace(&mut self.state, RuntimeState::Idle);
        match state {
            RuntimeState::Listening(active) if active.id == id => Ok(active),
            other => {
                self.state = other;
                Err(AdapterError::InvalidInput(InputError::UtteranceMismatch))
            }
        }
    }

    fn check_work(
        &mut self,
        deadline: CaptureTime,
        work: &WorkContext<'_>,
    ) -> Result<CaptureTime, AdapterError> {
        if let Err(error) = work.check() {
            if error == WorkError::SessionChanged {
                self.stop(StopReason::Discontinuity(Discontinuity::ClockReset));
            }
            return Err(AdapterError::Work(error));
        }
        let now = work.clock.now();
        if now.session != self.ready.clock.local_origin.session || now.session != deadline.session {
            self.stop(StopReason::Discontinuity(Discontinuity::ClockReset));
            return Err(AdapterError::Work(WorkError::SessionChanged));
        }
        if now.elapsed < self.last_observed.elapsed {
            self.stop(StopReason::Discontinuity(Discontinuity::ClockReset));
            return Err(AdapterError::Discontinuity(Discontinuity::ClockReset));
        }
        self.last_observed = now;
        if now.elapsed >= deadline.elapsed {
            return Err(AdapterError::Work(WorkError::DeadlineExceeded));
        }
        Ok(now)
    }
}

impl AudioBuffer {
    fn source_after(
        &self,
        chunk: &SpeechWindow,
        profile: AudioProfile,
    ) -> Result<UtteranceSpan, AdapterError> {
        let (start, previous_samples) = match self {
            Self::Empty => (chunk.audio().span().start(), 0),
            Self::Captured {
                first,
                last_sequence,
                end,
                samples,
            } => {
                if last_sequence.checked_add(1) != Some(chunk.audio().stamp().sequence)
                    || *end != chunk.audio().span().start()
                {
                    return Err(AdapterError::Discontinuity(Discontinuity::SequenceGap));
                }
                (first.captured_at, samples.len())
            }
        };
        let count = previous_samples
            .checked_add(chunk.audio().samples().len())
            .ok_or(AdapterError::InvalidInput(InputError::LimitExceeded))?;
        let captured = TimeRange::new(start, chunk.audio().span().end())
            .map_err(AdapterError::InvalidInput)?;
        if count > profile.maximum_samples.get() || captured.duration() > profile.maximum_duration {
            return Err(AdapterError::InvalidInput(InputError::LimitExceeded));
        }
        UtteranceSpan::new(chunk.source().id(), captured).map_err(AdapterError::InvalidInput)
    }

    fn append(&mut self, chunk: &SpeechWindow) {
        match self {
            Self::Empty => {
                *self = Self::Captured {
                    first: chunk.audio().stamp(),
                    last_sequence: chunk.audio().stamp().sequence,
                    end: chunk.audio().span().end(),
                    samples: chunk.audio().samples().to_vec(),
                };
            }
            Self::Captured {
                last_sequence,
                end,
                samples,
                ..
            } => {
                samples.extend_from_slice(chunk.audio().samples());
                *last_sequence = chunk.audio().stamp().sequence;
                *end = chunk.audio().span().end();
            }
        }
    }

    fn into_window(
        self,
        id: UtteranceId,
        ready: &CaptureReady<AudioFormat>,
        profile: AudioProfile,
    ) -> Result<SpeechWindow, AdapterError> {
        match self {
            Self::Empty => Err(AdapterError::InvalidInput(InputError::Empty)),
            Self::Captured { first, samples, .. } => {
                let audio = AudioFrame::new(ready, first, samples, profile.maximum_samples)
                    .map_err(AdapterError::InvalidInput)?;
                SpeechWindow::new(id, audio, profile.maximum_duration)
                    .map_err(AdapterError::InvalidInput)
            }
        }
    }
}

fn validate_configuration(
    ready: &CaptureReady<AudioFormat>,
    profile: AudioProfile,
) -> Result<(), AdapterError> {
    if ready.format.channels.get() != 1
        || ready.format.sample_rate_hz.get() != CANONICAL_SAMPLE_RATE_HZ
    {
        return Err(AdapterError::InvalidInput(InputError::InvalidAudio));
    }
    if profile.maximum_duration.is_zero() || profile.maximum_evidence_age.is_zero() {
        return Err(AdapterError::InvalidInput(InputError::InvalidTimeRange));
    }
    Ok(())
}

fn bounded_work<'a>(deadline: CaptureTime, work: &WorkContext<'a>) -> WorkContext<'a> {
    WorkContext {
        deadline: CaptureTime {
            session: work.deadline.session,
            elapsed: deadline.elapsed.min(work.deadline.elapsed),
        },
        clock: work.clock,
        cancellation: work.cancellation,
    }
}

fn validate_enrollment(
    enrollment: &EnrollmentState,
    profile: AudioProfile,
) -> Result<(), AdapterError> {
    if let EnrollmentState::Enrolled(record) = enrollment
        && record.voice.0.model() != profile.speaker.model
    {
        return Err(AdapterError::InvalidInput(InputError::InvalidReplacement));
    }
    Ok(())
}

fn require_available(availability: Availability<()>) -> Result<(), AdapterError> {
    match availability {
        Availability::Available(()) => Ok(()),
        Availability::Unavailable(reason) => Err(AdapterError::Unavailable(reason)),
        Availability::Failed(reason) => Err(AdapterError::Failed(reason)),
    }
}

fn validate_transcript(
    transcript: &TranscriptOutcome,
    source: UtteranceSpan,
    profile: AudioProfile,
) -> Result<(), AdapterError> {
    let valid = match transcript {
        TranscriptOutcome::Speech(final_text) => {
            final_text.source() == source
                && final_text.model() == profile.transcription_model
                && final_text.text().len() <= profile.maximum_text_bytes.get()
        }
        TranscriptOutcome::NoSpeech(span) => *span == source,
    };
    if valid {
        Ok(())
    } else {
        Err(AdapterError::Failed(FailureReason::InvalidOutput))
    }
}
