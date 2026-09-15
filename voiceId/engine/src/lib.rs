//! Portable local VoiceID values and adapter contracts.
//!
//! Adapters run inside the trusted local host. These types describe evidence;
//! they provide no sensor attestation or permission to execute a command.

#![deny(unsafe_code)]
#![deny(missing_docs)]

pub mod adapters;
pub mod attribution;
mod consumers;
pub mod domain;
pub mod enrollment;
pub mod presence;
pub mod runtime;
pub mod utterance;
