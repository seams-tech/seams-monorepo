use std::collections::BTreeMap;
use std::ffi::{CString, c_char, c_void};
use std::num::NonZeroUsize;
use std::rc::Rc;

use libloading::Library;
use sha2::{Digest, Sha256};

use super::{VerifiedFile, VerifiedModelDirectory};
use crate::adapters::{AdapterError, Transcriber, TranscriptStream};
use crate::domain::{Availability, FailureReason, InputError, ModelId, TimeRange};
use crate::runtime::WorkContext;
use crate::utterance::{
    FinalTranscript, PartialTranscript, SpeechWindow, TranscriptOutcome, UtteranceId, UtteranceSpan,
};

const C_ABI_VERSION: i32 = 30_000;
const TINY_STREAMING_ARCHITECTURE: u32 = 2;
const SAMPLE_RATE_HZ: i32 = 16_000;
const MAXIMUM_CHUNK_SAMPLES: usize = 1_600;
const UPDATE_INTERVAL_SAMPLES: usize = 8_000;
const MODEL_AUDIO_BLOCK_SAMPLES: usize = 1_280;
const FORCE_UPDATE: u32 = 1;

/// Required resource bounds for one native Tiny Streaming utterance.
#[derive(Clone, Copy)]
pub struct MoonshineLimits {
    /// Maximum cumulative mono sample count before finalization.
    pub maximum_samples: NonZeroUsize,
    /// Maximum total UTF-8 transcript bytes.
    pub maximum_text_bytes: NonZeroUsize,
    /// Maximum retained native transcript lines.
    pub maximum_lines: NonZeroUsize,
}

/// Provisioned native Moonshine Tiny adapter. Each utterance receives a fresh decoder.
pub struct MoonshineTranscriber {
    api: Rc<MoonshineApi>,
    model: Rc<VerifiedModelDirectory>,
    model_id: ModelId,
    limits: MoonshineLimits,
}

impl MoonshineTranscriber {
    /// Load verified local native libraries. This performs no network access.
    /// The declared supported build is Moonshine 0.1.5, C ABI 30000, on 64-bit hosts.
    pub fn load(
        library: VerifiedFile,
        onnx_runtime: VerifiedFile,
        model: VerifiedModelDirectory,
        limits: MoonshineLimits,
        work: &WorkContext<'_>,
    ) -> Result<Self, AdapterError> {
        let mut identity = Sha256::new();
        identity.update(b"voiceid-moonshine-host-utterance-v1\0vad=0;hop=160;lookbehind=160;segment=0;update=8000;zero-tail=1280+block-alignment;abi=30000\0");
        identity.update(model.id().0);
        identity.update(library.digest());
        identity.update(onnx_runtime.digest());
        let model_id = ModelId(identity.finalize().into());
        let api = MoonshineApi::load(&library, &onnx_runtime, work)?;
        Ok(Self {
            api: Rc::new(api),
            model: Rc::new(model),
            model_id,
            limits,
        })
    }

    /// Identity of the model assets, native libraries, and fixed utterance preprocessing.
    pub fn model_id(&self) -> ModelId {
        self.model_id
    }
}

impl Transcriber for MoonshineTranscriber {
    type Stream = MoonshineStream;

    fn availability(&self) -> Availability<()> {
        Availability::Available(())
    }

    fn start(
        &mut self,
        utterance: UtteranceId,
        work: &WorkContext<'_>,
    ) -> Result<Self::Stream, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        self.model.verify_on_disk(work)?;
        let decoder = NativeDecoder::load(Rc::clone(&self.api), &self.model, work)?;
        let handle = unsafe { (self.api.create_stream)(decoder.handle, 0) };
        if handle < 0 {
            return Err(model_failure());
        }
        let native = NativeStream { decoder, handle };
        check_code(unsafe { (self.api.start_stream)(native.decoder.handle, native.handle) })?;
        work.check().map_err(AdapterError::Work)?;
        Ok(MoonshineStream {
            native,
            model_id: self.model_id,
            id: utterance,
            limits: self.limits,
            state: StreamState::Empty,
            revision: 0,
            samples_since_update: 0,
            lines: BTreeMap::new(),
        })
    }
}

enum StreamState {
    Empty,
    Captured {
        source: UtteranceSpan,
        last_sequence: u64,
        samples: usize,
    },
    Failed,
}

struct TranscriptLine {
    started_at: f32,
    text: String,
    complete: bool,
}

/// One native utterance. Finalization consumes it; dropping it closes both native handles.
pub struct MoonshineStream {
    native: NativeStream,
    model_id: ModelId,
    id: UtteranceId,
    limits: MoonshineLimits,
    state: StreamState,
    revision: u64,
    samples_since_update: usize,
    lines: BTreeMap<u64, TranscriptLine>,
}

impl TranscriptStream for MoonshineStream {
    fn push(
        &mut self,
        chunk: &SpeechWindow,
        work: &WorkContext<'_>,
    ) -> Result<PartialTranscript, AdapterError> {
        let previous = std::mem::replace(&mut self.state, StreamState::Failed);
        work.check().map_err(AdapterError::Work)?;
        if chunk.source().id() != self.id {
            return Err(AdapterError::InvalidInput(InputError::UtteranceMismatch));
        }
        if chunk.audio().format().channels.get() != 1
            || chunk.audio().format().sample_rate_hz.get() != SAMPLE_RATE_HZ as u32
            || chunk.audio().samples().len() > MAXIMUM_CHUNK_SAMPLES
        {
            return Err(AdapterError::InvalidInput(InputError::InvalidAudio));
        }
        let (start, consumed) = match previous {
            StreamState::Empty => (chunk.source().captured().start(), 0),
            StreamState::Captured {
                source,
                last_sequence,
                samples,
            } => {
                if last_sequence.checked_add(1) != Some(chunk.audio().stamp().sequence)
                    || source.captured().end() != chunk.source().captured().start()
                {
                    return Err(AdapterError::Discontinuity(
                        crate::domain::Discontinuity::SequenceGap,
                    ));
                }
                (source.captured().start(), samples)
            }
            StreamState::Failed => return Err(model_failure()),
        };
        let samples = consumed
            .checked_add(chunk.audio().samples().len())
            .ok_or(AdapterError::InvalidInput(InputError::LimitExceeded))?;
        if samples > self.limits.maximum_samples.get() {
            return Err(AdapterError::InvalidInput(InputError::LimitExceeded));
        }
        let captured = TimeRange::new(start, chunk.source().captured().end())
            .map_err(AdapterError::InvalidInput)?;
        let source = UtteranceSpan::new(self.id, captured).map_err(AdapterError::InvalidInput)?;
        // The C API synchronously copies these borrowed samples into its owned stream.
        check_code(unsafe {
            (self.native.decoder.api.add_audio)(
                self.native.decoder.handle,
                self.native.handle,
                chunk.audio().samples().as_ptr(),
                chunk.audio().samples().len() as u64,
                SAMPLE_RATE_HZ,
                0,
            )
        })?;
        self.samples_since_update += chunk.audio().samples().len();
        if self.samples_since_update >= UPDATE_INTERVAL_SAMPLES {
            self.update(false, work)?;
            self.samples_since_update = 0;
        }
        work.check().map_err(AdapterError::Work)?;
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(AdapterError::InvalidInput(InputError::LimitExceeded))?;
        let text = self.text()?;
        self.state = StreamState::Captured {
            source,
            last_sequence: chunk.audio().stamp().sequence,
            samples,
        };
        PartialTranscript::new(
            source,
            self.model_id,
            self.revision,
            text,
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
        let samples = match self.state {
            StreamState::Captured {
                source: actual,
                samples,
                ..
            } if actual == source => samples,
            StreamState::Empty | StreamState::Captured { .. } | StreamState::Failed => {
                return Err(AdapterError::InvalidInput(InputError::UtteranceMismatch));
            }
        };
        let padding = MODEL_AUDIO_BLOCK_SAMPLES
            + (MODEL_AUDIO_BLOCK_SAMPLES - samples % MODEL_AUDIO_BLOCK_SAMPLES)
                % MODEL_AUDIO_BLOCK_SAMPLES;
        let tail = [0.0; MODEL_AUDIO_BLOCK_SAMPLES * 2];
        // Moonshine ingests full 80 ms blocks. Flush every source sample and one zero block.
        // Model padding does not extend the captured source interval.
        check_code(unsafe {
            (self.native.decoder.api.add_audio)(
                self.native.decoder.handle,
                self.native.handle,
                tail.as_ptr(),
                padding as u64,
                SAMPLE_RATE_HZ,
                0,
            )
        })?;
        check_code(unsafe {
            (self.native.decoder.api.stop_stream)(self.native.decoder.handle, self.native.handle)
        })?;
        self.update(true, work)?;
        work.check().map_err(AdapterError::Work)?;
        let text = self.text()?;
        if text.is_empty() {
            return Ok(TranscriptOutcome::NoSpeech(source));
        }
        let transcript =
            FinalTranscript::new(source, self.model_id, text, self.limits.maximum_text_bytes)
                .map_err(AdapterError::InvalidInput)?;
        Ok(TranscriptOutcome::Speech(transcript))
    }
}

impl MoonshineStream {
    fn update(&mut self, finalizing: bool, work: &WorkContext<'_>) -> Result<(), AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        let mut transcript = std::ptr::null();
        check_code(unsafe {
            (self.native.decoder.api.transcribe)(
                self.native.decoder.handle,
                self.native.handle,
                if finalizing { FORCE_UPDATE } else { 0 },
                &mut transcript,
            )
        })?;
        work.check().map_err(AdapterError::Work)?;
        if transcript.is_null() {
            return Err(invalid_output());
        }
        // The pinned C API owns this result until the next call to this decoder.
        let result = unsafe { &*transcript };
        let count = usize::try_from(result.line_count).map_err(invalid_model_output)?;
        if count > self.limits.maximum_lines.get() || (count != 0 && result.lines.is_null()) {
            return Err(invalid_output());
        }
        for index in 0..count {
            let line = unsafe { &*result.lines.add(index) };
            if !line.start_time.is_finite()
                || line.start_time < 0.0
                || (finalizing && line.is_complete == 0)
            {
                return Err(invalid_output());
            }
            let text = bounded_text(line.text, self.limits.maximum_text_bytes.get())?;
            self.lines.insert(
                line.id,
                TranscriptLine {
                    started_at: line.start_time,
                    text,
                    complete: line.is_complete != 0,
                },
            );
        }
        if self.lines.len() > self.limits.maximum_lines.get() {
            return Err(invalid_output());
        }
        if finalizing {
            for line in self.lines.values() {
                if !line.complete {
                    return Err(invalid_output());
                }
            }
        }
        self.text()?;
        Ok(())
    }

    fn text(&self) -> Result<String, AdapterError> {
        let mut ordered: Vec<_> = self.lines.iter().collect();
        ordered.sort_by(compare_lines);
        let mut text = String::new();
        for (_, line) in ordered {
            let line_text = line.text.trim();
            if line_text.is_empty() {
                continue;
            }
            let separator = usize::from(!text.is_empty());
            if text.len() + separator + line_text.len() > self.limits.maximum_text_bytes.get() {
                return Err(AdapterError::InvalidInput(InputError::LimitExceeded));
            }
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(line_text);
        }
        Ok(text)
    }
}

fn compare_lines(
    left: &(&u64, &TranscriptLine),
    right: &(&u64, &TranscriptLine),
) -> std::cmp::Ordering {
    left.1
        .started_at
        .total_cmp(&right.1.started_at)
        .then(left.0.cmp(right.0))
}

fn bounded_text(pointer: *const c_char, maximum: usize) -> Result<String, AdapterError> {
    if pointer.is_null() {
        return Err(invalid_output());
    }
    let mut bytes = Vec::new();
    // The native ABI guarantees a valid NUL-terminated string. Stop copying at our bound.
    for offset in 0..=maximum {
        let byte = unsafe { pointer.add(offset).read() } as u8;
        if byte == 0 {
            return String::from_utf8(bytes).map_err(invalid_model_output);
        }
        if offset == maximum {
            break;
        }
        bytes.push(byte);
    }
    Err(AdapterError::InvalidInput(InputError::LimitExceeded))
}

type LoadDecoder = unsafe extern "C" fn(*const c_char, u32, *const c_void, u64, i32) -> i32;
type FreeDecoder = unsafe extern "C" fn(i32);
type CreateStream = unsafe extern "C" fn(i32, u32) -> i32;
type StreamOperation = unsafe extern "C" fn(i32, i32) -> i32;
type AddAudio = unsafe extern "C" fn(i32, i32, *const f32, u64, i32, u32) -> i32;
type Transcribe = unsafe extern "C" fn(i32, i32, u32, *mut *const TranscriptC) -> i32;

struct MoonshineApi {
    _library: Library,
    _runtime: Library,
    load: LoadDecoder,
    free: FreeDecoder,
    create_stream: CreateStream,
    start_stream: StreamOperation,
    stop_stream: StreamOperation,
    free_stream: StreamOperation,
    add_audio: AddAudio,
    transcribe: Transcribe,
}

impl MoonshineApi {
    fn load(
        library: &VerifiedFile,
        runtime: &VerifiedFile,
        work: &WorkContext<'_>,
    ) -> Result<Self, AdapterError> {
        library.verify_on_disk(work)?;
        runtime.verify_on_disk(work)?;
        // Only explicitly verified local library paths reach the platform loader.
        let runtime_library = unsafe { Library::new(runtime.path()) }.map_err(model_load_error)?;
        let library = unsafe { Library::new(library.path()) }.map_err(model_load_error)?;
        let version: unsafe extern "C" fn() -> i32 = symbol(&library, b"moonshine_get_version\0")?;
        if unsafe { version() } != C_ABI_VERSION {
            return Err(invalid_output());
        }
        let api = Self {
            load: symbol(&library, b"moonshine_load_transcriber_from_files\0")?,
            free: symbol(&library, b"moonshine_free_transcriber\0")?,
            create_stream: symbol(&library, b"moonshine_create_stream\0")?,
            start_stream: symbol(&library, b"moonshine_start_stream\0")?,
            stop_stream: symbol(&library, b"moonshine_stop_stream\0")?,
            free_stream: symbol(&library, b"moonshine_free_stream\0")?,
            add_audio: symbol(&library, b"moonshine_transcribe_add_audio_to_stream\0")?,
            transcribe: symbol(&library, b"moonshine_transcribe_stream\0")?,
            _runtime: runtime_library,
            _library: library,
        };
        work.check().map_err(AdapterError::Work)?;
        Ok(api)
    }
}

fn symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, AdapterError> {
    // Each requested type matches its declaration in the pinned Moonshine C ABI.
    let symbol = unsafe { library.get::<T>(name) }.map_err(model_load_error)?;
    Ok(*symbol)
}

struct NativeDecoder {
    api: Rc<MoonshineApi>,
    handle: i32,
}

impl NativeDecoder {
    fn load(
        api: Rc<MoonshineApi>,
        model: &VerifiedModelDirectory,
        work: &WorkContext<'_>,
    ) -> Result<Self, AdapterError> {
        let path = CString::new(model.moonshine_path().as_os_str().as_encoded_bytes())
            .map_err(invalid_path)?;
        let options = [
            NativeOption {
                name: c"vad_threshold".as_ptr(),
                value: c"0".as_ptr(),
            },
            NativeOption {
                name: c"vad_hop_size".as_ptr(),
                value: c"160".as_ptr(),
            },
            NativeOption {
                name: c"vad_look_behind_sample_count".as_ptr(),
                value: c"160".as_ptr(),
            },
            NativeOption {
                name: c"vad_max_segment_duration".as_ptr(),
                value: c"0".as_ptr(),
            },
            NativeOption {
                name: c"transcription_interval".as_ptr(),
                value: c"0.5".as_ptr(),
            },
        ];
        let handle = unsafe {
            (api.load)(
                path.as_ptr(),
                TINY_STREAMING_ARCHITECTURE,
                options.as_ptr().cast(),
                options.len() as u64,
                C_ABI_VERSION,
            )
        };
        if handle < 0 {
            return Err(model_failure());
        }
        let decoder = Self { api, handle };
        work.check().map_err(AdapterError::Work)?;
        Ok(decoder)
    }
}

impl Drop for NativeDecoder {
    fn drop(&mut self) {
        unsafe { (self.api.free)(self.handle) };
    }
}

struct NativeStream {
    decoder: NativeDecoder,
    handle: i32,
}

impl Drop for NativeStream {
    fn drop(&mut self) {
        unsafe { (self.decoder.api.free_stream)(self.decoder.handle, self.handle) };
    }
}

#[repr(C)]
struct NativeOption {
    name: *const c_char,
    value: *const c_char,
}

#[repr(C)]
struct TranscriptC {
    lines: *const TranscriptLineC,
    line_count: u64,
}

#[repr(C)]
struct TranscriptLineC {
    text: *const c_char,
    audio_data: *const f32,
    audio_data_count: usize,
    start_time: f32,
    duration: f32,
    id: u64,
    is_complete: i8,
    is_updated: i8,
    is_new: i8,
    has_text_changed: i8,
    have_speakers_changed: i8,
    speaker_spans: *const c_void,
    speaker_span_count: u64,
    last_transcription_latency_ms: u32,
    words: *const c_void,
    word_count: u64,
}

const _: () = assert!(std::mem::size_of::<TranscriptLineC>() == 88);
const _: () = assert!(std::mem::size_of::<TranscriptC>() == 16);

fn check_code(code: i32) -> Result<(), AdapterError> {
    if code == 0 {
        Ok(())
    } else {
        Err(model_failure())
    }
}

fn model_failure() -> AdapterError {
    AdapterError::Failed(FailureReason::Model)
}
fn model_load_error<E>(_: E) -> AdapterError {
    model_failure()
}
fn invalid_model_output<E>(_: E) -> AdapterError {
    invalid_output()
}
fn invalid_path<E>(_: E) -> AdapterError {
    AdapterError::InvalidInput(InputError::InvalidReplacement)
}
fn invalid_output() -> AdapterError {
    AdapterError::Failed(FailureReason::InvalidOutput)
}
