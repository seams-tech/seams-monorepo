//! Safe, thread-confined composition behind the native C boundary.

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::num::NonZeroUsize;
use std::path::Path;
use std::rc::Rc;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::device_credential::DeviceCredential;
use super::local_bridge::CommandCapture;
use super::local_host::{
    CollectionPurpose, HOST_CHUNK_SAMPLES, HOST_MAXIMUM_SAMPLES, LocalClock, LocalModels,
    SpokenCommand, collect_utterance, enroll_captures, spoken_command,
};
use super::{EcapaMatcher, KeychainStore, MoonshineTranscriber, SpeakerEmbedding};
use crate::adapters::{
    AdapterError, AudioCapture, CaptureEvent, SpeakerMatcher, StoreError, TemplateStore,
};
use crate::attribution::AttributionOutcome;
use crate::domain::{
    AudioFormat, AudioFrame, Availability, CaptureReady, CaptureTime, EnrollmentRef, FrameStamp,
    InputError, ProfileId,
};
use crate::enrollment::{EnrollmentRecord, EnrollmentState};
use crate::runtime::{
    AudioRuntime, Cancellation, Clock, RuntimeStatus, StopReason, WorkContext, WorkError,
};
use crate::utterance::{Assessment, SpeakerVerdict, SpeechWindow, TranscriptOutcome, UtteranceId};

static NEXT_ID: OnceLock<AtomicU64> = OnceLock::new();

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct RequestId(u64);
impl RequestId {
    pub(crate) fn parse(value: u64) -> Result<Self, NativeError> {
        if value == 0 {
            Err(NativeError::InvalidInput)
        } else {
            Ok(Self(value))
        }
    }
    pub(crate) fn raw(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeError {
    InvalidInput,
    InvalidHandle,
    Busy,
    Missing,
    Expired,
    Cancelled,
    Discontinuity,
    Failed,
    Conflict,
    NotReady,
    Stopped,
    Panicked,
    KeychainAccessRequired,
}

pub(crate) enum NativeOutcome {
    Matched(SpokenCommand),
    Rejected,
    Ambiguous,
    Insufficient,
}

pub(crate) enum DeviceCaptureOutcome<T> {
    Approved(T),
    Cancelled,
    Rejected,
}

pub(crate) struct DeviceActivation {
    pub(crate) public_key_b64u: String,
    pub(crate) device_key_id: String,
    pub(crate) factor_secret_b64u: String,
}

pub(crate) struct DeviceUnlock {
    pub(crate) signature_b64u: String,
    pub(crate) factor_secret_b64u: String,
}

pub(crate) struct DeviceUnlockRequest<'a> {
    pub(crate) wallet_id: &'a str,
    pub(crate) wallet_auth_method_id: &'a str,
    pub(crate) challenge: &'a Value,
    pub(crate) caller_origin: &'a str,
}

enum CredentialAccess {
    Existing,
    CreateIfMissing,
}
pub(crate) struct NativeResult {
    pub(crate) request: RequestId,
    pub(crate) valid_until_ns: u64,
    pub(crate) outcome: NativeOutcome,
}

#[derive(Clone, Copy)]
pub(crate) enum NativeStatus {
    Empty,
    Ready,
    Listening,
    Completed,
    Enrolling,
    Stopped,
}

struct SharedMatcher(Rc<RefCell<EcapaMatcher>>);
impl SpeakerMatcher for SharedMatcher {
    fn availability(&self) -> Availability<()> {
        match self.0.try_borrow() {
            Ok(matcher) => matcher.availability(),
            Err(_) => Availability::Failed(crate::domain::FailureReason::Model),
        }
    }
    fn assess(
        &mut self,
        window: &SpeechWindow,
        enrollment: &EnrollmentRecord,
        work: &WorkContext<'_>,
    ) -> Result<Assessment<SpeakerVerdict>, AdapterError> {
        self.0
            .try_borrow_mut()
            .map_err(matcher_busy)?
            .assess(window, enrollment, work)
    }
}

type NativeRuntime = AudioRuntime<MoonshineTranscriber, SharedMatcher>;
struct Attempt {
    request: RequestId,
    utterance: UtteranceId,
    deadline: CaptureTime,
}
struct Setup {
    request: RequestId,
    opened_at: CaptureTime,
    deadline: CaptureTime,
    captures: SetupCaptures,
}
enum SetupCaptures {
    Empty,
    One {
        first: Box<SpeakerEmbedding>,
        end: Duration,
    },
    Two {
        first: Box<SpeakerEmbedding>,
        second: Box<SpeakerEmbedding>,
        end: Duration,
    },
}
enum RequestState {
    Idle,
    Attempt(Attempt),
    Enrollment(Setup),
    Stopped,
}

pub(crate) struct NativeSession {
    clock: LocalClock,
    store: KeychainStore,
    enrollment: Option<EnrollmentRef>,
    credential: Option<DeviceCredential>,
    matcher: Rc<RefCell<EcapaMatcher>>,
    runtime: NativeRuntime,
    ready: CaptureReady<AudioFormat>,
    state: RequestState,
}

impl NativeSession {
    pub(crate) fn open(
        models: &Path,
        namespace: &str,
        cancellation: &impl Cancellation,
    ) -> Result<Self, NativeError> {
        let clock = LocalClock::new().map_err(adapter_error)?;
        let work = WorkContext {
            deadline: clock.work_for(Duration::from_secs(60)).deadline,
            clock: &clock,
            cancellation,
        };
        // Model setup can outlive a disconnected browser port. Keep it outside
        // the enrollment lease so a cancelled startup cannot block its replacement.
        let models = LocalModels::load(models, &work).map_err(adapter_error)?;
        work.check().map_err(work_error)?;
        let mut store = KeychainStore::open(namespace, &work).map_err(store_error)?;
        let enrollment = store.load(&work).map_err(store_error)?;
        let identity = enrollment_identity(&enrollment);
        let ready = clock.capture_ready(ProfileId(
            Sha256::digest(
                b"voiceid-c-abi-capture-v1\0mono-f32;16000hz;host-timestamps;25ms-bound\0",
            )
            .into(),
        ));
        let matcher = Rc::new(RefCell::new(models.matcher));
        let runtime = AudioRuntime::new(
            ready,
            models.profile,
            enrollment,
            models.transcriber,
            SharedMatcher(matcher.clone()),
        )
        .map_err(adapter_error)?;
        Ok(Self {
            clock,
            store,
            enrollment: identity,
            credential: None,
            matcher,
            runtime,
            ready,
            state: RequestState::Idle,
        })
    }

    pub(crate) fn now_ns(&self) -> Result<u64, NativeError> {
        nanoseconds(self.clock.now().elapsed)
    }

    pub(crate) fn status(&mut self) -> Result<NativeStatus, NativeError> {
        match &self.state {
            RequestState::Stopped => Ok(NativeStatus::Stopped),
            RequestState::Enrollment(_) => Ok(NativeStatus::Enrolling),
            RequestState::Attempt(_) => match self.runtime.status() {
                RuntimeStatus::Listening(_) => Ok(NativeStatus::Listening),
                RuntimeStatus::Completed(_) => Ok(NativeStatus::Completed),
                RuntimeStatus::Idle | RuntimeStatus::Stopped(_) => Ok(NativeStatus::Stopped),
            },
            RequestState::Idle => match self.enrollment {
                None => Ok(NativeStatus::Empty),
                Some(_) => Ok(NativeStatus::Ready),
            },
        }
    }

    pub(crate) fn begin(&mut self, timeout_ms: u32) -> Result<RequestId, NativeError> {
        self.require_idle()?;
        if !(250..=30_000).contains(&timeout_ms) {
            return Err(NativeError::InvalidInput);
        }
        self.enrollment.ok_or(NativeError::Missing)?;
        let deadline = self
            .clock
            .work_for(Duration::from_millis(u64::from(timeout_ms)))
            .deadline;
        let work = context(deadline, &self.clock);
        let request = RequestId(allocate_id()?);
        let utterance = self.runtime.begin(&work).map_err(adapter_error)?;
        self.state = RequestState::Attempt(Attempt {
            request,
            utterance,
            deadline: work.deadline,
        });
        Ok(request)
    }

    pub(crate) fn listen_capture(
        &mut self,
        timeout_ms: u32,
        capture: &mut impl CommandCapture,
        cancellation: &impl Cancellation,
        on_started: &mut dyn FnMut() -> Result<(), AdapterError>,
    ) -> Result<NativeOutcome, NativeError> {
        let request = self.begin(timeout_ms)?;
        let result = self.collect_command(request, capture, cancellation, on_started);
        if result.is_err() {
            let _ = self.cancel(request);
        }
        result
    }

    pub(crate) fn activate_capture(
        &mut self,
        wallet_id: &str,
        wallet_auth_method_id: &str,
        timeout_ms: u32,
        capture: &mut impl CommandCapture,
        cancellation: &impl Cancellation,
        on_started: &mut dyn FnMut() -> Result<(), AdapterError>,
    ) -> Result<DeviceCaptureOutcome<DeviceActivation>, NativeError> {
        match self.listen_capture(timeout_ms, capture, cancellation, on_started)? {
            NativeOutcome::Matched(SpokenCommand::Approve) => {}
            NativeOutcome::Matched(SpokenCommand::Cancel) => {
                return Ok(DeviceCaptureOutcome::Cancelled);
            }
            _ => return Ok(DeviceCaptureOutcome::Rejected),
        }
        if cancellation.is_cancelled() {
            return Err(NativeError::Cancelled);
        }
        let credential = self.device_credential(
            wallet_id,
            wallet_auth_method_id,
            CredentialAccess::CreateIfMissing,
        )?;
        Ok(DeviceCaptureOutcome::Approved(DeviceActivation {
            public_key_b64u: credential.public_key_b64u(),
            device_key_id: credential.device_key_id_b64u(),
            factor_secret_b64u: credential.factor_secret_b64u(),
        }))
    }

    pub(crate) fn unlock_capture(
        &mut self,
        request: DeviceUnlockRequest<'_>,
        timeout_ms: u32,
        capture: &mut impl CommandCapture,
        cancellation: &impl Cancellation,
        on_started: &mut dyn FnMut() -> Result<(), AdapterError>,
    ) -> Result<DeviceCaptureOutcome<DeviceUnlock>, NativeError> {
        match self.listen_capture(timeout_ms, capture, cancellation, on_started)? {
            NativeOutcome::Matched(SpokenCommand::Approve) => {}
            NativeOutcome::Matched(SpokenCommand::Cancel) => {
                return Ok(DeviceCaptureOutcome::Cancelled);
            }
            _ => return Ok(DeviceCaptureOutcome::Rejected),
        }
        if cancellation.is_cancelled() {
            return Err(NativeError::Cancelled);
        }
        let credential = self.device_credential(
            request.wallet_id,
            request.wallet_auth_method_id,
            CredentialAccess::Existing,
        )?;
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(id_exhausted)?
            .as_millis()
            .try_into()
            .map_err(id_exhausted)?;
        let signature_b64u = credential
            .sign_challenge(request.challenge, request.caller_origin, now_ms)
            .map_err(store_error)?;
        Ok(DeviceCaptureOutcome::Approved(DeviceUnlock {
            signature_b64u,
            factor_secret_b64u: credential.factor_secret_b64u(),
        }))
    }

    fn device_credential(
        &mut self,
        wallet_id: &str,
        wallet_auth_method_id: &str,
        access: CredentialAccess,
    ) -> Result<&DeviceCredential, NativeError> {
        let enrollment = self.enrollment.ok_or(NativeError::Missing)?;
        let cached = match &self.credential {
            Some(credential) => {
                credential.enrollment() == enrollment
                    && credential.wallet_id() == wallet_id
                    && credential.wallet_auth_method_id() == wallet_auth_method_id
            }
            None => false,
        };
        if !cached {
            let work = self.clock.work_for(Duration::from_secs(15));
            let loaded = self
                .store
                .load_device_credential(enrollment, wallet_id, wallet_auth_method_id, &work)
                .map_err(store_error)?;
            let credential = match loaded {
                Some(credential) => credential,
                None if matches!(access, CredentialAccess::CreateIfMissing) => self
                    .store
                    .create_device_credential(enrollment, wallet_id, wallet_auth_method_id, &work)
                    .map_err(store_error)?,
                None => return Err(NativeError::Missing),
            };
            self.credential = Some(credential);
        }
        self.credential.as_ref().ok_or(NativeError::Failed)
    }

    fn collect_command(
        &mut self,
        request: RequestId,
        capture: &mut impl CommandCapture,
        cancellation: &impl Cancellation,
        on_started: &mut dyn FnMut() -> Result<(), AdapterError>,
    ) -> Result<NativeOutcome, NativeError> {
        let deadline = self.attempt(request)?.deadline;
        let captured = {
            let work = WorkContext {
                deadline,
                clock: &self.clock,
                cancellation,
            };
            work.check().map_err(work_error)?;
            let captured = capture
                .collect(&self.clock, &work, on_started)
                .map_err(adapter_error)?;
            work.check().map_err(work_error)?;
            captured
        };
        let first = captured.audio().stamp();
        for (sequence, samples) in captured
            .audio()
            .samples()
            .chunks(HOST_CHUNK_SAMPLES)
            .enumerate()
        {
            if cancellation.is_cancelled() {
                return Err(NativeError::Cancelled);
            }
            let at = nanoseconds(
                first.captured_at.elapsed
                    + super::local_host::sample_duration(sequence * HOST_CHUNK_SAMPLES),
            )?;
            self.push(request, sequence as u64, at, samples.to_vec())?;
        }
        if cancellation.is_cancelled() {
            return Err(NativeError::Cancelled);
        }
        self.finish(request)?;
        if cancellation.is_cancelled() {
            return Err(NativeError::Cancelled);
        }
        Ok(self.take(request)?.outcome)
    }

    pub(crate) fn push(
        &mut self,
        request: RequestId,
        sequence: u64,
        captured_at_ns: u64,
        samples: Vec<f32>,
    ) -> Result<(), NativeError> {
        let attempt = self.attempt(request)?;
        let utterance = attempt.utterance;
        let deadline = attempt.deadline;
        let work = context(deadline, &self.clock);
        let audio = AudioFrame::new(
            &self.ready,
            FrameStamp {
                sequence,
                captured_at: CaptureTime {
                    session: utterance.session,
                    elapsed: Duration::from_nanos(captured_at_ns),
                },
            },
            samples,
            NonZeroUsize::new(1600).unwrap(),
        )
        .map_err(input_error)?;
        let pushed = self
            .runtime
            .push(utterance, audio, &work)
            .map(drop)
            .map_err(adapter_error);
        self.after_stage(pushed)
    }

    pub(crate) fn finish(&mut self, request: RequestId) -> Result<(), NativeError> {
        let attempt = self.attempt(request)?;
        if !matches!(self.runtime.status(), RuntimeStatus::Listening(_)) {
            return Err(NativeError::NotReady);
        }
        let utterance = attempt.utterance;
        let work = context(attempt.deadline, &self.clock);
        let result = self.runtime.finish(utterance, &work).map_err(adapter_error);
        self.after_stage(result)
    }

    pub(crate) fn take(&mut self, request: RequestId) -> Result<NativeResult, NativeError> {
        let attempt = self.attempt(request)?;
        let utterance = attempt.utterance;
        let work = context(attempt.deadline, &self.clock);
        if let Err(error) = work.check() {
            self.runtime.cancel(utterance).map_err(adapter_error)?;
            self.state = RequestState::Idle;
            return Err(work_error(error));
        }
        if !matches!(self.runtime.status(), RuntimeStatus::Completed(_)) {
            return Err(NativeError::NotReady);
        }
        let result = self
            .runtime
            .take_result(utterance, &work)
            .map_err(adapter_error);
        self.state = RequestState::Idle;
        let result = result?;
        let outcome = match result.attribution() {
            AttributionOutcome::Attributed(_) => match result.transcript() {
                TranscriptOutcome::Speech(text) => NativeOutcome::Matched(spoken_command(text)),
                TranscriptOutcome::NoSpeech(_) => NativeOutcome::Insufficient,
            },
            AttributionOutcome::Rejected { .. } => NativeOutcome::Rejected,
            AttributionOutcome::Ambiguous { .. } => NativeOutcome::Ambiguous,
            AttributionOutcome::Insufficient { .. } => NativeOutcome::Insufficient,
        };
        Ok(NativeResult {
            request,
            valid_until_ns: nanoseconds(result.validity().end().elapsed)?,
            outcome,
        })
    }

    pub(crate) fn cancel(&mut self, request: RequestId) -> Result<(), NativeError> {
        match &self.state {
            RequestState::Attempt(attempt) if attempt.request == request => {
                self.runtime
                    .cancel(attempt.utterance)
                    .map_err(adapter_error)?;
            }
            RequestState::Enrollment(setup) if setup.request == request => {}
            _ => return Err(NativeError::InvalidHandle),
        }
        self.state = RequestState::Idle;
        Ok(())
    }

    pub(crate) fn enrollment_begin(&mut self) -> Result<RequestId, NativeError> {
        self.require_idle()?;
        let work = self.clock.work_for(Duration::from_secs(90));
        if self.enrollment.is_some() {
            return Err(NativeError::Conflict);
        }
        let request = RequestId(allocate_id()?);
        self.state = RequestState::Enrollment(Setup {
            request,
            opened_at: self.clock.now(),
            deadline: work.deadline,
            captures: SetupCaptures::Empty,
        });
        Ok(request)
    }

    pub(crate) fn enrollment_sample(
        &mut self,
        request: RequestId,
        captured_at_ns: u64,
        samples: Vec<f32>,
    ) -> Result<u32, NativeError> {
        if !matches!(&self.state, RequestState::Enrollment(setup) if setup.request == request) {
            return Err(NativeError::InvalidHandle);
        }
        let RequestState::Enrollment(setup) =
            std::mem::replace(&mut self.state, RequestState::Idle)
        else {
            unreachable!()
        };
        let work = context(setup.deadline, &self.clock);
        work.check().map_err(work_error)?;
        let captured_at = CaptureTime {
            session: setup.opened_at.session,
            elapsed: Duration::from_nanos(captured_at_ns),
        };
        let minimum_start = match &setup.captures {
            SetupCaptures::Empty => setup.opened_at.elapsed,
            SetupCaptures::One { end, .. } | SetupCaptures::Two { end, .. } => *end,
        };
        let duration = Duration::from_nanos(samples.len() as u64 * 62_500);
        let end = captured_at
            .elapsed
            .checked_add(duration)
            .ok_or(NativeError::InvalidInput)?;
        if captured_at.elapsed < minimum_start
            || end > self.clock.now().elapsed + self.ready.clock.maximum_error
            || !samples.len().is_multiple_of(HOST_CHUNK_SAMPLES)
        {
            return Err(NativeError::InvalidInput);
        }
        let mut capture = BufferedCapture::new(self.ready, captured_at, samples)?;
        let window = collect_utterance(&mut capture, CollectionPurpose::Enrollment, &work)
            .map_err(adapter_error)?;
        let embedding = self
            .matcher
            .try_borrow_mut()
            .map_err(registry_busy)?
            .extract(&window, &work)
            .map_err(adapter_error)?;
        let captures = match setup.captures {
            SetupCaptures::Empty => SetupCaptures::One {
                first: Box::new(embedding),
                end,
            },
            SetupCaptures::One { first, .. } => SetupCaptures::Two {
                first,
                second: Box::new(embedding),
                end,
            },
            SetupCaptures::Two { first, second, .. } => {
                let record = enroll_captures(self.store.device(), [*first, *second, embedding])
                    .map_err(adapter_error)?;
                if let Err(error) = self.store.create(&record, &work) {
                    self.runtime.stop(StopReason::Closed);
                    self.state = RequestState::Stopped;
                    return Err(store_error(error));
                }
                self.install_enrollment(EnrollmentState::Enrolled(record))?;
                return Ok(0);
            }
        };
        let remaining = match captures {
            SetupCaptures::One { .. } => 2,
            SetupCaptures::Two { .. } => 1,
            SetupCaptures::Empty => unreachable!(),
        };
        self.state = RequestState::Enrollment(Setup {
            request,
            opened_at: setup.opened_at,
            deadline: setup.deadline,
            captures,
        });
        Ok(remaining)
    }

    pub(crate) fn delete_enrollment(&mut self) -> Result<(), NativeError> {
        if matches!(self.state, RequestState::Stopped) {
            return Err(NativeError::Stopped);
        }
        let identity = self.enrollment.ok_or(NativeError::Missing)?;
        self.credential = None;
        self.install_enrollment(EnrollmentState::Empty)?;
        let work = self.clock.work_for(Duration::from_secs(5));
        if let Err(error) = self.store.delete(identity, &work) {
            self.runtime.stop(StopReason::Closed);
            self.state = RequestState::Stopped;
            return Err(store_error(error));
        }
        Ok(())
    }

    pub(crate) fn close_empty_namespace(mut self) -> Result<(), NativeError> {
        self.require_idle()?;
        self.runtime.stop(StopReason::Closed);
        self.store
            .destroy_empty(&self.clock.work_for(Duration::from_secs(5)))
            .map_err(store_error)
    }

    fn require_idle(&self) -> Result<(), NativeError> {
        match self.state {
            RequestState::Idle => Ok(()),
            RequestState::Stopped => Err(NativeError::Stopped),
            RequestState::Attempt(_) | RequestState::Enrollment(_) => Err(NativeError::Busy),
        }
    }

    fn install_enrollment(&mut self, enrollment: EnrollmentState) -> Result<(), NativeError> {
        self.state = RequestState::Idle;
        let identity = enrollment_identity(&enrollment);
        if let Err(error) = self.runtime.reload_enrollment(enrollment) {
            self.runtime.stop(StopReason::Closed);
            self.state = RequestState::Stopped;
            return Err(adapter_error(error));
        }
        self.enrollment = identity;
        Ok(())
    }
    fn attempt(&self, request: RequestId) -> Result<&Attempt, NativeError> {
        match &self.state {
            RequestState::Attempt(attempt) if attempt.request == request => Ok(attempt),
            RequestState::Stopped => Err(NativeError::Stopped),
            _ => Err(NativeError::InvalidHandle),
        }
    }
    fn after_stage(&mut self, result: Result<(), NativeError>) -> Result<(), NativeError> {
        if result.is_err() {
            self.state = match self.runtime.status() {
                RuntimeStatus::Stopped(_) => RequestState::Stopped,
                RuntimeStatus::Idle => RequestState::Idle,
                RuntimeStatus::Listening(_) | RuntimeStatus::Completed(_) => return result,
            };
        }
        result
    }
}

struct BufferedCapture {
    ready: CaptureReady<AudioFormat>,
    frames: VecDeque<AudioFrame>,
}
impl BufferedCapture {
    fn new(
        ready: CaptureReady<AudioFormat>,
        first: CaptureTime,
        samples: Vec<f32>,
    ) -> Result<Self, NativeError> {
        if samples.is_empty() || samples.len() > HOST_MAXIMUM_SAMPLES {
            return Err(NativeError::InvalidInput);
        }
        let mut frames = VecDeque::new();
        for (sequence, chunk) in samples.chunks(HOST_CHUNK_SAMPLES).enumerate() {
            let stamp = FrameStamp {
                sequence: sequence as u64,
                captured_at: CaptureTime {
                    session: first.session,
                    elapsed: first.elapsed + Duration::from_nanos(sequence as u64 * 10_000_000),
                },
            };
            frames.push_back(
                AudioFrame::new(
                    &ready,
                    stamp,
                    chunk.to_vec(),
                    NonZeroUsize::new(HOST_CHUNK_SAMPLES).unwrap(),
                )
                .map_err(input_error)?,
            );
        }
        Ok(Self { ready, frames })
    }
}
impl AudioCapture for BufferedCapture {
    fn ready(&self) -> &CaptureReady<AudioFormat> {
        &self.ready
    }
    fn next_frame(
        &mut self,
        work: &WorkContext<'_>,
    ) -> Result<CaptureEvent<AudioFrame>, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        Ok(match self.frames.pop_front() {
            Some(frame) => CaptureEvent::Frame(frame),
            None => CaptureEvent::Ended,
        })
    }
}

pub(crate) fn allocate_id() -> Result<u64, NativeError> {
    if NEXT_ID.get().is_none() {
        let mut seed = [0; 8];
        security_framework::random::SecRandom::default()
            .copy_bytes(&mut seed)
            .map_err(id_exhausted)?;
        let initial = (u64::from_le_bytes(seed) & (u64::MAX >> 1)) | 1;
        let _ = NEXT_ID.set(AtomicU64::new(initial));
    }
    NEXT_ID
        .get()
        .ok_or(NativeError::Failed)?
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, advance_id)
        .map_err(id_exhausted)
}
fn advance_id(value: u64) -> Option<u64> {
    value.checked_add(1)
}
fn id_exhausted<E>(_: E) -> NativeError {
    NativeError::Failed
}
fn context(deadline: CaptureTime, clock: &LocalClock) -> WorkContext<'_> {
    WorkContext {
        deadline,
        clock,
        cancellation: clock,
    }
}
fn enrollment_identity(state: &EnrollmentState) -> Option<EnrollmentRef> {
    match state {
        EnrollmentState::Empty => None,
        EnrollmentState::Enrolled(record) => Some(record.identity),
    }
}
fn nanoseconds(duration: Duration) -> Result<u64, NativeError> {
    u64::try_from(duration.as_nanos()).map_err(id_exhausted)
}
fn input_error(_: InputError) -> NativeError {
    NativeError::InvalidInput
}
fn matcher_busy<E>(_: E) -> AdapterError {
    AdapterError::Overloaded
}
fn registry_busy<E>(_: E) -> NativeError {
    NativeError::Busy
}
fn work_error(error: WorkError) -> NativeError {
    match error {
        WorkError::Cancelled => NativeError::Cancelled,
        WorkError::DeadlineExceeded => NativeError::Expired,
        WorkError::SessionChanged => NativeError::Discontinuity,
    }
}
fn adapter_error(error: AdapterError) -> NativeError {
    match error {
        AdapterError::InvalidInput(_) => NativeError::InvalidInput,
        AdapterError::Discontinuity(_) => NativeError::Discontinuity,
        AdapterError::Unavailable(_) => NativeError::Missing,
        AdapterError::Failed(_) => NativeError::Failed,
        AdapterError::Overloaded => NativeError::Busy,
        AdapterError::Work(error) => work_error(error),
    }
}
fn store_error(error: StoreError) -> NativeError {
    match error {
        StoreError::Conflict => NativeError::Conflict,
        StoreError::Unavailable(crate::domain::UnavailableReason::PermissionDenied) => {
            NativeError::KeychainAccessRequired
        }
        StoreError::Unavailable(_) => NativeError::Missing,
        StoreError::InvalidRecord | StoreError::Failed | StoreError::CommitUncertain => {
            NativeError::Failed
        }
        StoreError::Work(error) => work_error(error),
    }
}
