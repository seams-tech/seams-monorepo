//! Native model loading and inference, including Moonshine's C ABI.
//! Assets are explicitly provisioned and verified. Inference never downloads assets.

mod artifacts;
mod ecapa;
// Unsafe operations are confined to the pinned Moonshine C ABI and owned native handles.
#[allow(unsafe_code)]
mod moonshine;

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
