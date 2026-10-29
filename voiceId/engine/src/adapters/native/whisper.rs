use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use sha2::{Digest, Sha256};
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

use super::VerifiedFile;
use super::artifacts::parse_digest;
use super::voice_models::{InstallState, VoiceModel};
use crate::adapters::{AdapterError, Transcriber, TranscriptStream};
use crate::domain::{
    Availability, FailureReason, InputError, ModelId, TimeRange, UnavailableReason,
};
use crate::runtime::WorkContext;
use crate::utterance::{
    FinalTranscript, PartialTranscript, SpeechWindow, TranscriptOutcome, UtteranceId, UtteranceSpan,
};

const SAMPLE_RATE_HZ: u32 = 16_000;
const MAXIMUM_CHUNK_SAMPLES: usize = 1_600;
// whisper.cpp returns no segment for input under one second. Zero padding reaches it.
const MINIMUM_DECODE_SAMPLES: usize = 16_800;
const DECODER_THREADS: i32 = 4;
// Ten seconds of speech is about 60 tokens. The bound stops a repetition loop early.
const MAXIMUM_TOKENS: i32 = 128;

/// Required resource bounds for one Whisper utterance.
#[derive(Clone, Copy)]
pub struct WhisperLimits {
    /// Maximum cumulative mono sample count before finalization.
    pub maximum_samples: NonZeroUsize,
    /// Maximum total UTF-8 transcript bytes.
    pub maximum_text_bytes: NonZeroUsize,
}

/// Spoken language. Whisper does not detect it, so a result cannot switch language.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WhisperLanguage {
    /// English.
    English,
    /// Japanese.
    Japanese,
}

impl WhisperLanguage {
    fn code(self) -> &'static str {
        match self {
            Self::English => "en",
            Self::Japanese => "ja",
        }
    }
}

/// Opt-in Whisper adapter on whisper.cpp with the Apple GPU.
/// Construction reads no model bytes. The model loads on the first utterance or on
/// [`WhisperTranscriber::prepare`], from bytes that match the catalog digest.
pub struct WhisperTranscriber {
    model: &'static VoiceModel,
    directory: PathBuf,
    digest: [u8; 32],
    model_id: ModelId,
    language: WhisperLanguage,
    limits: WhisperLimits,
    context: Option<Rc<WhisperContext>>,
}

impl WhisperTranscriber {
    /// Describe one catalog model in the host's voice model directory.
    pub fn new(
        model: &'static VoiceModel,
        directory: &Path,
        language: WhisperLanguage,
        limits: WhisperLimits,
    ) -> Result<Self, AdapterError> {
        let digest = parse_digest(model.sha256)?;
        let mut identity = Sha256::new();
        identity.update(b"voiceid-whisper-cpp-utterance-v1\0whisper-rs=0.16.0;whisper.cpp=1.8.3;greedy;temperature=0;fallback=0;context=0;single-segment;suppress-nst;minimum=16800;tokens=128\0");
        identity.update(language.code());
        identity.update(digest);
        Ok(Self {
            model,
            directory: directory.to_path_buf(),
            digest,
            model_id: ModelId(identity.finalize().into()),
            language,
            limits,
            context: None,
        })
    }

    /// Identity of the model file, runtime version, and fixed decoding settings.
    pub fn model_id(&self) -> ModelId {
        self.model_id
    }

    /// True while the model occupies memory.
    pub fn is_loaded(&self) -> bool {
        self.context.is_some()
    }

    /// Load and verify the model now, for example when the person opens a voice screen.
    /// A missing file stays `Unavailable(Missing)`; this never downloads it.
    pub fn prepare(&mut self, work: &WorkContext<'_>) -> Result<(), AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        if self.context.is_some() {
            return Ok(());
        }
        if self.model.state(&self.directory) != InstallState::Installed {
            return Err(AdapterError::Unavailable(UnavailableReason::Missing));
        }
        let file = VerifiedFile::read(
            &self.model.path(&self.directory),
            self.digest,
            self.model.bytes,
            work,
        )?;
        whisper_rs::install_logging_hooks();
        let mut parameters = WhisperContextParameters::default();
        parameters.use_gpu(true).flash_attn(true);
        // whisper.cpp copies the verified bytes into its own tensors before it returns.
        let context = WhisperContext::new_from_buffer_with_params(file.bytes(), parameters)
            .map_err(model_failure)?;
        drop(file);
        work.check().map_err(AdapterError::Work)?;
        self.context = Some(Rc::new(context));
        Ok(())
    }

    /// Release the model memory. The next utterance loads it again.
    pub fn unload(&mut self) {
        self.context = None;
    }
}

impl Transcriber for WhisperTranscriber {
    type Stream = WhisperStream;

    fn availability(&self) -> Availability<()> {
        if self.context.is_some() || self.model.state(&self.directory) == InstallState::Installed {
            Availability::Available(())
        } else {
            Availability::Unavailable(UnavailableReason::Missing)
        }
    }

    fn start(
        &mut self,
        utterance: UtteranceId,
        work: &WorkContext<'_>,
    ) -> Result<Self::Stream, AdapterError> {
        self.prepare(work)?;
        let context = self.context.as_ref().ok_or_else(|| model_failure(()))?;
        let state = context.create_state().map_err(model_failure)?;
        work.check().map_err(AdapterError::Work)?;
        Ok(WhisperStream {
            state,
            model_id: self.model_id,
            language: self.language,
            id: utterance,
            limits: self.limits,
            progress: StreamState::Empty,
            revision: 0,
            samples: Vec::new(),
        })
    }
}

enum StreamState {
    Empty,
    Captured {
        source: UtteranceSpan,
        last_sequence: u64,
    },
    Failed,
}

/// One Whisper utterance. Whisper decodes the whole window at `finish`, so partial
/// snapshots carry no text. Dropping the stream releases its decoder state.
pub struct WhisperStream {
    state: WhisperState,
    model_id: ModelId,
    language: WhisperLanguage,
    id: UtteranceId,
    limits: WhisperLimits,
    progress: StreamState,
    revision: u64,
    samples: Vec<f32>,
}

impl TranscriptStream for WhisperStream {
    fn push(
        &mut self,
        chunk: &SpeechWindow,
        work: &WorkContext<'_>,
    ) -> Result<PartialTranscript, AdapterError> {
        let previous = std::mem::replace(&mut self.progress, StreamState::Failed);
        work.check().map_err(AdapterError::Work)?;
        if chunk.source().id() != self.id {
            return Err(AdapterError::InvalidInput(InputError::UtteranceMismatch));
        }
        if chunk.audio().format().channels.get() != 1
            || chunk.audio().format().sample_rate_hz.get() != SAMPLE_RATE_HZ
            || chunk.audio().samples().len() > MAXIMUM_CHUNK_SAMPLES
        {
            return Err(AdapterError::InvalidInput(InputError::InvalidAudio));
        }
        let start = match previous {
            StreamState::Empty => chunk.source().captured().start(),
            StreamState::Captured {
                source,
                last_sequence,
            } => {
                if last_sequence.checked_add(1) != Some(chunk.audio().stamp().sequence)
                    || source.captured().end() != chunk.source().captured().start()
                {
                    return Err(AdapterError::Discontinuity(
                        crate::domain::Discontinuity::SequenceGap,
                    ));
                }
                source.captured().start()
            }
            StreamState::Failed => return Err(model_failure(())),
        };
        let samples = self
            .samples
            .len()
            .checked_add(chunk.audio().samples().len())
            .ok_or(AdapterError::InvalidInput(InputError::LimitExceeded))?;
        if samples > self.limits.maximum_samples.get() {
            return Err(AdapterError::InvalidInput(InputError::LimitExceeded));
        }
        let captured = TimeRange::new(start, chunk.source().captured().end())
            .map_err(AdapterError::InvalidInput)?;
        let source = UtteranceSpan::new(self.id, captured).map_err(AdapterError::InvalidInput)?;
        self.samples.extend_from_slice(chunk.audio().samples());
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(AdapterError::InvalidInput(InputError::LimitExceeded))?;
        self.progress = StreamState::Captured {
            source,
            last_sequence: chunk.audio().stamp().sequence,
        };
        PartialTranscript::new(
            source,
            self.model_id,
            self.revision,
            String::new(),
            self.limits.maximum_text_bytes,
        )
        .map_err(AdapterError::InvalidInput)
    }

    fn finish(
        mut self,
        source: UtteranceSpan,
        work: &WorkContext<'_>,
    ) -> Result<TranscriptOutcome, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        match self.progress {
            StreamState::Captured { source: actual, .. } if actual == source => {}
            StreamState::Empty | StreamState::Captured { .. } | StreamState::Failed => {
                return Err(AdapterError::InvalidInput(InputError::UtteranceMismatch));
            }
        }
        let mut samples = std::mem::take(&mut self.samples);
        // Model padding does not extend the captured source interval.
        if samples.len() < MINIMUM_DECODE_SAMPLES {
            samples.resize(MINIMUM_DECODE_SAMPLES, 0.0);
        }
        // The decode is uninterruptible and bounded by the sample and token limits.
        // whisper-rs 0.16 `set_abort_callback_safe` casts its closure to the wrong
        // type, so this adapter sets no abort callback.
        let mut parameters = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        parameters.set_language(Some(self.language.code()));
        parameters.set_translate(false);
        parameters.set_no_context(true);
        parameters.set_single_segment(true);
        parameters.set_no_timestamps(true);
        parameters.set_suppress_blank(true);
        parameters.set_suppress_nst(true);
        parameters.set_temperature(0.0);
        parameters.set_temperature_inc(0.0);
        parameters.set_n_threads(DECODER_THREADS);
        parameters.set_print_special(false);
        parameters.set_print_progress(false);
        parameters.set_print_realtime(false);
        parameters.set_print_timestamps(false);
        parameters.set_max_tokens(MAXIMUM_TOKENS);
        let decoded = self.state.full(parameters, &samples);
        samples.fill(0.0);
        work.check().map_err(AdapterError::Work)?;
        decoded.map_err(model_failure)?;
        let mut text = String::new();
        for segment in self.state.as_iter() {
            let piece = segment.to_str().map_err(invalid_output)?.trim();
            if piece.is_empty() {
                continue;
            }
            let separator = usize::from(!text.is_empty());
            if text.len() + separator + piece.len() > self.limits.maximum_text_bytes.get() {
                return Err(AdapterError::InvalidInput(InputError::LimitExceeded));
            }
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(piece);
        }
        if text.is_empty() {
            return Ok(TranscriptOutcome::NoSpeech(source));
        }
        let transcript =
            FinalTranscript::new(source, self.model_id, text, self.limits.maximum_text_bytes)
                .map_err(AdapterError::InvalidInput)?;
        Ok(TranscriptOutcome::Speech(transcript))
    }
}

fn model_failure<E>(_: E) -> AdapterError {
    AdapterError::Failed(FailureReason::Model)
}
fn invalid_output<E>(_: E) -> AdapterError {
    AdapterError::Failed(FailureReason::InvalidOutput)
}
