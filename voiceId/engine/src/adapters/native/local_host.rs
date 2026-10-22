//! Native development-host composition, deliberate enrollment, and bounded speech collection.

use std::collections::VecDeque;
use std::fs::File;
use std::io::Read;
use std::num::{NonZeroU16, NonZeroU32, NonZeroU64, NonZeroUsize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use security_framework::random::SecRandom;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::{
    EcapaCalibration, EcapaMatcher, MoonshineLimits, MoonshineTranscriber, SpeakerEmbedding,
    VerifiedFile, VerifiedModelDirectory,
};
use crate::adapters::{AdapterError, AudioCapture, CaptureEvent};
use crate::domain::{
    AudioFormat, AudioFrame, CaptureReady, CaptureSessionId, CaptureTime, ClockMapping, DeviceId,
    EnrollmentId, EnrollmentRef, FailureReason, FrameStamp, InputError, ModelId, ProfileId,
};
use crate::enrollment::{EnrollmentRecord, FaceEnrollment};
use crate::runtime::{AudioProfile, AudioRuntime, Cancellation, Clock, WorkContext};
use crate::utterance::{FinalTranscript, SpeechWindow, UtteranceId};

/// Maximum utterance length accepted by this development host.
pub const HOST_MAXIMUM_SAMPLES: usize = 160_000;
/// Fixed canonical chunk size, ten milliseconds at 16 kHz.
pub const HOST_CHUNK_SAMPLES: usize = 160;
const MAXIMUM_FILE_BYTES: u64 = 128 * 1024 * 1024;

/// Real monotonic host clock with a fresh random capture epoch.
pub struct LocalClock {
    origin: Instant,
    session: CaptureSessionId,
    cancelled: AtomicBool,
}

impl LocalClock {
    /// Allocate a new epoch. No previous host's capture identity can be reused.
    pub fn new() -> Result<Self, AdapterError> {
        Ok(Self {
            origin: Instant::now(),
            session: CaptureSessionId(random_id()?),
            cancelled: AtomicBool::new(false),
        })
    }

    /// Allocate an exclusive deadline once for the complete host operation.
    pub fn work_for(&self, duration: Duration) -> WorkContext<'_> {
        WorkContext {
            deadline: CaptureTime {
                session: self.session,
                elapsed: self.origin.elapsed() + duration,
            },
            clock: self,
            cancellation: self,
        }
    }

    /// Permanently cancel work in this epoch.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub(super) fn origin(&self) -> Instant {
        self.origin
    }

    /// Canonical format and clock metadata for this development capture profile.
    /// The 25 ms engineering bound still requires live-device qualification.
    pub fn capture_ready(&self, profile: ProfileId) -> CaptureReady<AudioFormat> {
        CaptureReady {
            profile,
            format: AudioFormat {
                sample_rate_hz: NonZeroU32::new(16000).unwrap(),
                channels: NonZeroU16::MIN,
            },
            clock: ClockMapping {
                source_origin: Duration::ZERO,
                local_origin: CaptureTime {
                    session: self.session,
                    elapsed: Duration::ZERO,
                },
                maximum_error: Duration::from_millis(25),
            },
        }
    }
}

impl Clock for LocalClock {
    fn now(&self) -> CaptureTime {
        CaptureTime {
            session: self.session,
            elapsed: self.origin.elapsed(),
        }
    }
}
impl Cancellation for LocalClock {
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelInputs {
    schema_version: String,
    model_directory: PathBuf,
    moonshine_library: FileInput,
    onnx_runtime_library: FileInput,
    speaker_model: FileInput,
    speaker_accept_similarity: f32,
    speaker_minimum_samples: usize,
    speaker_minimum_rms: f32,
}

#[derive(Deserialize)]
struct FileInput {
    path: PathBuf,
    sha256: [u8; 32],
}

/// Verified native adapters and the exact matching runtime profile.
/// Model metadata comes from the existing explicit provisioning command.
pub struct LocalModels {
    /// Fresh-utterance native transcription adapter.
    pub transcriber: MoonshineTranscriber,
    /// Native waveform speaker adapter, also used during deliberate enrollment.
    pub matcher: EcapaMatcher,
    /// Model-bound bounded runtime profile. Its speaker gate is a development setting.
    pub profile: AudioProfile,
}

impl LocalModels {
    /// Read bounded provisioning metadata and verify every loaded artifact.
    /// Reference templates and fixture cases in research inputs are never consumed here.
    pub fn load(path: &Path, work: &WorkContext<'_>) -> Result<Self, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        let mut bytes = Vec::new();
        File::open(path)
            .map_err(model_failure)?
            .take(1_048_577)
            .read_to_end(&mut bytes)
            .map_err(model_failure)?;
        if bytes.len() > 1_048_576 {
            return Err(AdapterError::InvalidInput(InputError::LimitExceeded));
        }
        let input: ModelInputs = serde_json::from_slice(&bytes).map_err(model_failure)?;
        bytes.fill(0);
        if input.schema_version != "voiceid_native_journey_input_v1" {
            return Err(AdapterError::Failed(FailureReason::InvalidOutput));
        }
        let runtime = verify_file(&input.onnx_runtime_library, work)?;
        let transcriber = MoonshineTranscriber::load(
            verify_file(&input.moonshine_library, work)?,
            verify_file(&input.onnx_runtime_library, work)?,
            VerifiedModelDirectory::moonshine_tiny(&input.model_directory, work)?,
            MoonshineLimits {
                maximum_samples: limit(HOST_MAXIMUM_SAMPLES)?,
                maximum_text_bytes: limit(4096)?,
                maximum_lines: limit(32)?,
            },
            work,
        )?;
        let calibration = EcapaCalibration::new(
            ModelId(input.speaker_model.sha256),
            input.speaker_accept_similarity,
            limit(input.speaker_minimum_samples)?,
            limit(HOST_MAXIMUM_SAMPLES)?,
            input.speaker_minimum_rms,
        )?;
        let matcher = EcapaMatcher::load(
            &runtime,
            verify_file(&input.speaker_model, work)?,
            calibration,
            work,
        )?;
        let mut identity = Sha256::new();
        identity.update(b"voiceid-local-host-development-v1\0");
        identity.update(transcriber.model_id().0);
        identity.update(calibration.gate().calibration.0);
        let profile = AudioProfile {
            id: ProfileId(identity.finalize().into()),
            transcription_model: transcriber.model_id(),
            speaker: calibration.gate(),
            maximum_samples: limit(HOST_MAXIMUM_SAMPLES)?,
            maximum_duration: Duration::from_secs(10),
            maximum_text_bytes: limit(4096)?,
            maximum_evidence_age: Duration::from_secs(30),
        };
        Ok(Self {
            transcriber,
            matcher,
            profile,
        })
    }
}

/// Different collection policies keep enrollment's speech requirement explicit.
#[derive(Clone, Copy)]
pub enum CollectionPurpose {
    /// At least two seconds of voiced frames for each deliberate enrollment prompt.
    Enrollment,
    /// At least half a second of voiced frames for a command attempt.
    Command,
}

/// Collect one bounded utterance after explicit host activation.
/// Uses a development RMS endpoint: 200 ms pre-roll and 800 ms trailing silence.
/// The returned window preserves source times. Capture loss never finalizes partial speech.
pub fn collect_utterance<C: AudioCapture>(
    capture: &mut C,
    purpose: CollectionPurpose,
    work: &WorkContext<'_>,
) -> Result<SpeechWindow, AdapterError> {
    let mut pre_roll = VecDeque::new();
    let mut state = CollectionState::Waiting;
    let mut samples = Vec::new();
    let mut last: Option<FrameStamp> = None;
    let mut speech_samples = 0;
    let mut quiet_samples = 0;
    loop {
        work.check().map_err(AdapterError::Work)?;
        let frame = match capture.next_frame(work)? {
            CaptureEvent::Frame(frame) => frame,
            CaptureEvent::Discontinuity(reason) => return Err(AdapterError::Discontinuity(reason)),
            CaptureEvent::Ended => return Err(AdapterError::Failed(FailureReason::Device)),
        };
        if frame.format() != capture.ready().format || frame.samples().len() != HOST_CHUNK_SAMPLES {
            return Err(AdapterError::InvalidInput(InputError::InvalidAudio));
        }
        if let Some(previous) = last
            && (frame.stamp().sequence != previous.sequence + 1
                || frame.stamp().captured_at.elapsed
                    != previous.captured_at.elapsed + sample_duration(HOST_CHUNK_SAMPLES))
        {
            return Err(AdapterError::Discontinuity(
                crate::domain::Discontinuity::SequenceGap,
            ));
        }
        last = Some(frame.stamp());
        let voiced = frame_rms(frame.samples()) >= 0.006;
        match state {
            CollectionState::Waiting => {
                pre_roll.push_back(frame);
                if pre_roll.len() > 20 {
                    pre_roll.pop_front();
                }
                if !voiced {
                    continue;
                }
                let first = pre_roll
                    .front()
                    .ok_or(AdapterError::InvalidInput(InputError::Empty))?
                    .stamp();
                state = CollectionState::Speaking(first);
                for frame in pre_roll.drain(..) {
                    samples.extend_from_slice(frame.samples());
                }
                speech_samples = HOST_CHUNK_SAMPLES;
            }
            CollectionState::Speaking(_) => {
                samples.extend_from_slice(frame.samples());
                if voiced {
                    speech_samples += HOST_CHUNK_SAMPLES;
                    quiet_samples = 0;
                } else {
                    quiet_samples += HOST_CHUNK_SAMPLES;
                }
            }
        }
        if samples.len() >= HOST_MAXIMUM_SAMPLES {
            return Err(AdapterError::InvalidInput(InputError::LimitExceeded));
        }
        if quiet_samples < 12_800 {
            continue;
        }
        let minimum = match purpose {
            CollectionPurpose::Enrollment => 32_000,
            CollectionPurpose::Command => 8_000,
        };
        if speech_samples < minimum {
            return Err(AdapterError::InvalidInput(InputError::InvalidAudio));
        }
        let CollectionState::Speaking(first) = state else {
            unreachable!()
        };
        let audio = AudioFrame::new(
            capture.ready(),
            first,
            samples,
            limit(HOST_MAXIMUM_SAMPLES)?,
        )
        .map_err(AdapterError::InvalidInput)?;
        return SpeechWindow::new(
            UtteranceId {
                session: first.captured_at.session,
                sequence: first.sequence,
            },
            audio,
            Duration::from_secs(10),
        )
        .map_err(AdapterError::InvalidInput);
    }
}

enum CollectionState {
    Waiting,
    Speaking(FrameStamp),
}

/// Command text from a finalized transcript. This value grants no approval authority.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpokenCommand {
    /// Exact phrase: I approve this operation.
    Approve,
    /// Exact phrase: I cancel this operation.
    Cancel,
    /// Other words, including extra or contradictory command text.
    Unrecognized,
}

/// Normalize final ASR text once and require a complete exact command phrase.
pub fn spoken_command(transcript: &FinalTranscript) -> SpokenCommand {
    let mut canonical = String::new();
    for character in transcript.text().chars() {
        if character.is_ascii_alphanumeric() {
            canonical.push(character.to_ascii_lowercase());
        } else if !canonical.is_empty() && !canonical.ends_with(' ') {
            canonical.push(' ');
        }
    }
    match canonical.trim() {
        "i approve this operation" => SpokenCommand::Approve,
        "i cancel this operation" => SpokenCommand::Cancel,
        _ => SpokenCommand::Unrecognized,
    }
}

/// Build a new single-owner record only after all three captures pass consistency checks.
pub fn enroll_captures(
    device: DeviceId,
    captures: [SpeakerEmbedding; 3],
) -> Result<EnrollmentRecord, AdapterError> {
    Ok(EnrollmentRecord {
        identity: EnrollmentRef {
            id: EnrollmentId(random_id()?),
            version: NonZeroU64::MIN,
        },
        device,
        voice: SpeakerEmbedding::enroll_three(captures, 0.6)?,
        face: FaceEnrollment::Disabled,
    })
}

/// Submit collected source chunks through the runtime and finalize one pending result.
/// Begin the attempt before capture. The consumer still owns result consumption.
pub fn finish_capture(
    runtime: &mut AudioRuntime<MoonshineTranscriber, EcapaMatcher>,
    id: UtteranceId,
    ready: &CaptureReady<AudioFormat>,
    captured: &SpeechWindow,
    work: &WorkContext<'_>,
) -> Result<(), AdapterError> {
    let first = captured.audio().stamp();
    for (sequence, samples) in captured
        .audio()
        .samples()
        .chunks(HOST_CHUNK_SAMPLES)
        .enumerate()
    {
        let stamp = FrameStamp {
            sequence: first.sequence + sequence as u64,
            captured_at: CaptureTime {
                session: first.captured_at.session,
                elapsed: first.captured_at.elapsed + sample_duration(sequence * HOST_CHUNK_SAMPLES),
            },
        };
        let audio = AudioFrame::new(ready, stamp, samples.to_vec(), limit(HOST_CHUNK_SAMPLES)?)
            .map_err(AdapterError::InvalidInput)?;
        runtime.push(id, audio, work)?;
    }
    runtime.finish(id, work)
}

pub(super) fn sample_duration(samples: usize) -> Duration {
    Duration::from_nanos(samples as u64 * 62_500)
}
pub(super) fn limit(value: usize) -> Result<NonZeroUsize, AdapterError> {
    NonZeroUsize::new(value).ok_or(AdapterError::InvalidInput(InputError::Empty))
}
fn verify_file(file: &FileInput, work: &WorkContext<'_>) -> Result<VerifiedFile, AdapterError> {
    VerifiedFile::read(&file.path, file.sha256, MAXIMUM_FILE_BYTES, work)
}
fn random_id() -> Result<[u8; 16], AdapterError> {
    let mut id = [0; 16];
    SecRandom::default()
        .copy_bytes(&mut id)
        .map_err(model_failure)?;
    Ok(id)
}
fn model_failure<E>(_: E) -> AdapterError {
    AdapterError::Failed(FailureReason::Model)
}
fn frame_rms(samples: &[f32]) -> f64 {
    let mut sum = 0.0;
    for sample in samples {
        sum += f64::from(*sample).powi(2);
    }
    (sum / samples.len() as f64).sqrt()
}
