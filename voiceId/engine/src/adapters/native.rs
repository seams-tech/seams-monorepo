//! Native model loading and inference, including Moonshine's C ABI.
//! Assets are explicitly provisioned and verified. Inference never downloads assets.

mod artifacts;
mod ecapa;
// Unsafe operations are confined to the pinned Moonshine C ABI and owned native handles.
#[allow(unsafe_code)]
mod moonshine;

pub use artifacts::{VerifiedFile, VerifiedModelDirectory};
pub use ecapa::{EcapaCalibration, EcapaMatcher, SpeakerEmbedding};
pub use moonshine::{MoonshineLimits, MoonshineStream, MoonshineTranscriber};
