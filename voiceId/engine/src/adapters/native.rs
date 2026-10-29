//! Native model loading and inference, including Moonshine's C ABI and whisper.cpp.
//! Assets are explicitly provisioned and verified. Inference never downloads assets;
//! opt-in voice models download only through `VoiceModel::install`.

mod artifacts;
mod ecapa;
// Unsafe operations are confined to the pinned Moonshine C ABI and owned native handles.
#[allow(unsafe_code)]
mod moonshine;
mod voice_models;
#[cfg(target_os = "macos")]
mod whisper;

#[cfg(target_os = "macos")]
pub(crate) mod device_credential;
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod keychain;
#[cfg(target_os = "macos")]
pub use keychain::KeychainStore;
#[cfg(target_os = "macos")]
mod capture;
#[cfg(target_os = "macos")]
pub mod local_bridge;
#[cfg(target_os = "macos")]
pub mod local_host;
#[cfg(target_os = "macos")]
pub(crate) mod session;
#[cfg(target_os = "macos")]
pub use capture::{CaptureNormalizer, Microphone, PreparedMicrophone};

pub use artifacts::{VerifiedFile, VerifiedModelDirectory};
pub use ecapa::{EcapaCalibration, EcapaMatcher, SpeakerEmbedding};
pub use moonshine::{MoonshineLimits, MoonshineStream, MoonshineTranscriber};
pub use voice_models::{
    DEFAULT_WHISPER_MODEL, InstallState, VoiceModel, WHISPER_LARGE_V3_TURBO_Q5_0,
    WHISPER_LARGE_V3_TURBO_Q8_0, voice_model,
};
#[cfg(target_os = "macos")]
pub use whisper::{WhisperLanguage, WhisperLimits, WhisperStream, WhisperTranscriber};
