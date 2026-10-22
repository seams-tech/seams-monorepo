use std::num::{NonZeroU32, NonZeroUsize};

use ort::session::Session;
use ort::value::TensorRef;
use sha2::{Digest, Sha256};

use super::VerifiedFile;
use crate::adapters::{AdapterError, SpeakerMatcher};
use crate::attribution::SupportingGate;
use crate::domain::{
    Availability, CalibrationId, FailureReason, IdentityMatch, InputError, ModelId,
};
use crate::enrollment::{EnrollmentRecord, TemplateData, VoiceTemplate};
use crate::runtime::WorkContext;
use crate::utterance::{Assessment, SpeakerVerdict, SpeechWindow};

const EMBEDDING_DIMENSIONS: usize = 192;
const TEMPLATE_BYTES: usize = EMBEDDING_DIMENSIONS * size_of::<f32>();

/// Explicit development/qualified speaker gate for one exact ONNX model artifact.
/// The identity commits to all parameters. Calibration quality remains a measured property.
#[derive(Clone, Copy)]
pub struct EcapaCalibration {
    gate: SupportingGate,
    accept_similarity: f32,
    minimum_samples: NonZeroUsize,
    maximum_samples: NonZeroUsize,
    minimum_rms: f32,
}

impl EcapaCalibration {
    /// Normalize finite thresholds and nonempty speech bounds once at configuration loading.
    pub fn new(
        model: ModelId,
        accept_similarity: f32,
        minimum_samples: NonZeroUsize,
        maximum_samples: NonZeroUsize,
        minimum_rms: f32,
    ) -> Result<Self, AdapterError> {
        if !accept_similarity.is_finite()
            || !(-1.0..=1.0).contains(&accept_similarity)
            || !minimum_rms.is_finite()
            || !(0.0..=1.0).contains(&minimum_rms)
            || minimum_rms == 0.0
            || minimum_samples > maximum_samples
        {
            return Err(AdapterError::InvalidInput(InputError::InvalidAudio));
        }
        let mut identity = Sha256::new();
        identity.update(b"voiceid-ecapa-audio-gate-v1\0");
        identity.update(model.0);
        identity.update(accept_similarity.to_le_bytes());
        identity.update((minimum_samples.get() as u64).to_le_bytes());
        identity.update((maximum_samples.get() as u64).to_le_bytes());
        identity.update(minimum_rms.to_le_bytes());
        Ok(Self {
            gate: SupportingGate {
                model,
                calibration: CalibrationId(identity.finalize().into()),
            },
            accept_similarity,
            minimum_samples,
            maximum_samples,
            minimum_rms,
        })
    }

    /// Exact model and gate configuration required by the runtime profile.
    pub fn gate(self) -> SupportingGate {
        self.gate
    }
}

/// Finite, unit-normalized speaker vector, bound to its model and excluded from logging.
pub struct SpeakerEmbedding {
    model: ModelId,
    values: [f32; EMBEDDING_DIMENSIONS],
}

impl SpeakerEmbedding {
    /// Parse model output or consented reference vectors at their boundary.
    pub fn from_values(model: ModelId, values: &[f32]) -> Result<Self, AdapterError> {
        let mut normalized = [0.0; EMBEDDING_DIMENSIONS];
        if values.len() != EMBEDDING_DIMENSIONS {
            return Err(invalid_output());
        }
        let mut squared_norm = 0.0_f64;
        for value in values {
            if !value.is_finite() {
                return Err(invalid_output());
            }
            squared_norm += f64::from(*value).powi(2);
        }
        if squared_norm <= f64::EPSILON {
            return Err(invalid_output());
        }
        let norm = squared_norm.sqrt();
        for (output, value) in normalized.iter_mut().zip(values) {
            *output = (f64::from(*value) / norm) as f32;
        }
        Ok(Self {
            model,
            values: normalized,
        })
    }

    /// Compare two vectors only when they use the same exact model encoding.
    pub fn similarity(&self, other: &Self) -> Result<f32, AdapterError> {
        if self.model != other.model {
            return Err(AdapterError::InvalidInput(InputError::InvalidReplacement));
        }
        let mut score = 0.0_f64;
        for (left, right) in self.values.iter().zip(other.values) {
            score += f64::from(*left) * f64::from(right);
        }
        Ok((score as f32).clamp(-1.0, 1.0))
    }

    /// Encode a validated voice template. Deliberate setup approval still belongs to enrollment.
    pub fn into_voice_template(self) -> Result<VoiceTemplate, AdapterError> {
        let mut bytes = Vec::with_capacity(TEMPLATE_BYTES);
        for value in self.values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        let template = TemplateData::new(
            self.model,
            NonZeroU32::MIN,
            bytes,
            NonZeroUsize::new(TEMPLATE_BYTES).expect("nonempty fixed ECAPA encoding"),
        )
        .map_err(AdapterError::InvalidInput)?;
        Ok(VoiceTemplate(template))
    }

    fn from_template(
        template: &VoiceTemplate,
        expected_model: ModelId,
    ) -> Result<Self, AdapterError> {
        if template.0.model() != expected_model
            || template.0.format_version() != NonZeroU32::MIN
            || template.0.bytes().len() != TEMPLATE_BYTES
        {
            return Err(AdapterError::InvalidInput(InputError::InvalidReplacement));
        }
        let mut values = [0.0; EMBEDDING_DIMENSIONS];
        for (value, bytes) in values
            .iter_mut()
            .zip(template.0.bytes().chunks_exact(size_of::<f32>()))
        {
            let encoded: [u8; 4] = bytes.try_into().map_err(invalid_model_output)?;
            *value = f32::from_le_bytes(encoded);
        }
        Self::from_values(expected_model, &values)
    }
}

/// Full waveform-to-embedding ECAPA ONNX adapter on explicitly verified ONNX Runtime.
/// It supplies simple duration/energy gates and makes no overlap or spoof-detection claim.
pub struct EcapaMatcher {
    session: Session,
    calibration: EcapaCalibration,
}

impl EcapaMatcher {
    /// Load the verified graph from the same bytes whose digest identifies its templates.
    pub fn load(
        runtime: &VerifiedFile,
        model: VerifiedFile,
        calibration: EcapaCalibration,
        work: &WorkContext<'_>,
    ) -> Result<Self, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        if ModelId(model.digest()) != calibration.gate.model {
            return Err(AdapterError::InvalidInput(InputError::InvalidReplacement));
        }
        runtime.verify_on_disk(work)?;
        ort::init_from(runtime.path())
            .map_err(model_failure)?
            .commit();
        verify_loaded_runtime(runtime)?;
        let session = Session::builder()
            .map_err(model_failure)?
            .with_intra_threads(1)
            .map_err(model_failure)?
            .with_inter_threads(1)
            .map_err(model_failure)?
            .commit_from_memory(model.bytes())
            .map_err(model_failure)?;
        work.check().map_err(AdapterError::Work)?;
        Ok(Self {
            session,
            calibration,
        })
    }

    /// Extract one bounded mono 16 kHz utterance without retaining caller-owned PCM.
    pub fn extract(
        &mut self,
        window: &SpeechWindow,
        work: &WorkContext<'_>,
    ) -> Result<SpeakerEmbedding, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        if window.audio().format().sample_rate_hz.get() != 16_000
            || window.audio().samples().len() > self.calibration.maximum_samples.get()
        {
            return Err(AdapterError::InvalidInput(InputError::InvalidAudio));
        }
        let samples = window.audio().samples();
        let input =
            TensorRef::from_array_view(([1, samples.len()], samples)).map_err(model_failure)?;
        let mut outputs = self
            .session
            .run(ort::inputs!["samples" => input])
            .map_err(model_failure)?;
        let output = outputs.get("embedding").ok_or_else(invalid_output)?;
        let (_, values) = output
            .try_extract_tensor::<f32>()
            .map_err(invalid_model_output)?;
        let embedding = SpeakerEmbedding::from_values(self.calibration.gate.model, values);
        // The view borrows PCM until synchronous inference completes. Only the output copy is owned here.
        let output = outputs.get_mut("embedding").ok_or_else(invalid_output)?;
        let (_, values) = output
            .try_extract_tensor_mut::<f32>()
            .map_err(invalid_model_output)?;
        values.fill(0.0);
        work.check().map_err(AdapterError::Work)?;
        embedding
    }
}

impl SpeakerMatcher for EcapaMatcher {
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
        let reference =
            SpeakerEmbedding::from_template(&enrollment.voice, self.calibration.gate.model)?;
        let mut squared_energy = 0.0_f64;
        for sample in window.audio().samples() {
            squared_energy += f64::from(*sample).powi(2);
        }
        let rms = (squared_energy / window.audio().samples().len() as f64).sqrt();
        let verdict = if window.audio().samples().len() < self.calibration.minimum_samples.get()
            || rms < f64::from(self.calibration.minimum_rms)
        {
            SpeakerVerdict::InsufficientSpeech
        } else {
            let embedding = self.extract(window, work)?;
            let score = embedding.similarity(&reference)?;
            if score >= self.calibration.accept_similarity {
                SpeakerVerdict::Identity(IdentityMatch::Matched(enrollment.identity))
            } else {
                SpeakerVerdict::Identity(IdentityMatch::Unknown)
            }
        };
        work.check().map_err(AdapterError::Work)?;
        Ok(Assessment {
            source: window.source(),
            model: self.calibration.gate.model,
            calibration: self.calibration.gate.calibration,
            verdict,
        })
    }
}

// Compare the actual process-global ORT API table with the explicitly verified library.
// An earlier initialization from another library cannot silently replace this runtime.
#[allow(unsafe_code)]
fn verify_loaded_runtime(runtime: &VerifiedFile) -> Result<(), AdapterError> {
    let library = unsafe { libloading::Library::new(runtime.path()) }.map_err(model_failure)?;
    let get_api_base: libloading::Symbol<
        unsafe extern "system" fn() -> *const ort::sys::OrtApiBase,
    > = unsafe { library.get(b"OrtGetApiBase\0") }.map_err(model_failure)?;
    let base = unsafe { get_api_base() };
    if base.is_null() {
        return Err(invalid_output());
    }
    let api = unsafe { ((*base).GetApi)(ort::MINOR_VERSION) };
    if api.is_null() || !std::ptr::eq(api, ort::api()) {
        return Err(invalid_output());
    }
    Ok(())
}

fn model_failure<E>(_: E) -> AdapterError {
    AdapterError::Failed(FailureReason::Model)
}
fn invalid_model_output<E>(_: E) -> AdapterError {
    invalid_output()
}
fn invalid_output() -> AdapterError {
    AdapterError::Failed(FailureReason::InvalidOutput)
}
