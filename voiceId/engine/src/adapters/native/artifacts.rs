use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::adapters::AdapterError;
use crate::domain::{FailureReason, InputError, ModelId, UnavailableReason};
use crate::runtime::WorkContext;

const MODEL_MANIFEST: &[u8] = include_bytes!("../../../../verifier-spike/model-manifest.json");
const MAXIMUM_MODEL_FILE_BYTES: u64 = 128 * 1024 * 1024;

/// File verified against an explicitly supplied expected digest, under a byte limit.
/// The host must obtain the expected digest from trusted release/development metadata.
pub struct VerifiedFile {
    path: PathBuf,
    digest: [u8; 32],
    bytes: Vec<u8>,
}

impl VerifiedFile {
    /// Read a regular file once, bound its size, and verify the bytes actually read.
    pub fn read(
        path: &Path,
        expected: [u8; 32],
        maximum_bytes: u64,
        work: &WorkContext<'_>,
    ) -> Result<Self, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        let metadata = fs::symlink_metadata(path).map_err(unavailable_model)?;
        if !metadata.file_type().is_file() || metadata.len() > maximum_bytes {
            return Err(AdapterError::InvalidInput(InputError::LimitExceeded));
        }
        let mut file = fs::File::open(path).map_err(unavailable_model)?;
        let mut bytes = Vec::new();
        file.by_ref()
            .take(maximum_bytes.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(model_failure)?;
        if bytes.len() as u64 > maximum_bytes || bytes.is_empty() {
            return Err(AdapterError::InvalidInput(InputError::LimitExceeded));
        }
        let actual: [u8; 32] = Sha256::digest(&bytes).into();
        if actual != expected {
            return Err(AdapterError::Failed(FailureReason::InvalidOutput));
        }
        work.check().map_err(AdapterError::Work)?;
        Ok(Self {
            path: fs::canonicalize(path).map_err(model_failure)?,
            digest: actual,
            bytes,
        })
    }

    /// Verified bytes retained for an in-memory model loader.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Digest of the retained file bytes.
    pub fn digest(&self) -> [u8; 32] {
        self.digest
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn verify_on_disk(&self, work: &WorkContext<'_>) -> Result<(), AdapterError> {
        Self::read(&self.path, self.digest, self.bytes.len() as u64, work).map(drop)
    }
}

/// A model tree checked against the existing manifest embedded in this compiled engine.
/// File-based native loaders require the trusted host to prevent mutation during loading.
pub struct VerifiedModelDirectory {
    directory: PathBuf,
    id: ModelId,
    files: Vec<VerifiedFile>,
}

impl VerifiedModelDirectory {
    /// Verify provisioned Tiny Streaming assets from `verifier-spike/model-manifest.json`.
    /// Relative paths are normalized here and never accepted by model core logic.
    pub fn moonshine_tiny(
        model_directory: &Path,
        work: &WorkContext<'_>,
    ) -> Result<Self, AdapterError> {
        let manifest: ModelManifest =
            serde_json::from_slice(MODEL_MANIFEST).map_err(invalid_model_output)?;
        if manifest.schema_version != "voice_id_model_manifest_v1" {
            return Err(AdapterError::Failed(FailureReason::InvalidOutput));
        }
        let artifact = tiny_artifact(manifest.artifacts)?;
        let directory = model_directory.join(relative_path(&artifact.relative_path)?);
        let mut files = Vec::new();
        let mut canonical = Sha256::new();
        for entry in artifact.files {
            let path = directory.join(relative_path(&entry.path)?);
            let file = VerifiedFile::read(
                &path,
                parse_digest(&entry.sha256)?,
                entry.bytes.min(MAXIMUM_MODEL_FILE_BYTES),
                work,
            )?;
            if file.bytes.len() as u64 != entry.bytes {
                return Err(AdapterError::Failed(FailureReason::InvalidOutput));
            }
            canonical.update(format!(
                "{}\t{}\t{}\n",
                entry.path, entry.bytes, entry.sha256
            ));
            files.push(file);
        }
        let digest: [u8; 32] = canonical.finalize().into();
        if digest != parse_digest(&artifact.tree_sha256)? {
            return Err(AdapterError::Failed(FailureReason::InvalidOutput));
        }
        Ok(Self {
            directory,
            id: ModelId(digest),
            files,
        })
    }

    /// Identity of the exact manifest-bound model tree.
    pub fn id(&self) -> ModelId {
        self.id
    }

    pub(super) fn moonshine_path(&self) -> PathBuf {
        self.directory
            .join("download.moonshine.ai/model/tiny-streaming-en/quantized")
    }

    pub(super) fn verify_on_disk(&self, work: &WorkContext<'_>) -> Result<(), AdapterError> {
        for file in &self.files {
            file.verify_on_disk(work)?;
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelManifest {
    schema_version: String,
    artifacts: Vec<ModelArtifact>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelArtifact {
    id: String,
    relative_path: String,
    tree_sha256: String,
    files: Vec<ModelFile>,
}

#[derive(Deserialize)]
struct ModelFile {
    path: String,
    bytes: u64,
    sha256: String,
}

fn relative_path(value: &str) -> Result<&Path, AdapterError> {
    let path = Path::new(value);
    if path.as_os_str().is_empty() {
        return Err(AdapterError::InvalidInput(InputError::Empty));
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(AdapterError::InvalidInput(InputError::InvalidReplacement));
        }
    }
    Ok(path)
}

pub(super) fn parse_digest(value: &str) -> Result<[u8; 32], AdapterError> {
    if value.len() != 64 || !value.is_ascii() {
        return Err(AdapterError::InvalidInput(InputError::InvalidReplacement));
    }
    let mut bytes = [0; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).map_err(invalid_digest)?;
    }
    Ok(bytes)
}

fn tiny_artifact(artifacts: Vec<ModelArtifact>) -> Result<ModelArtifact, AdapterError> {
    for artifact in artifacts {
        if artifact.id == "moonshine-streaming-tiny-native-quantized" {
            return Ok(artifact);
        }
    }
    Err(AdapterError::Unavailable(UnavailableReason::Unsupported))
}

fn unavailable_model<E>(_: E) -> AdapterError {
    AdapterError::Unavailable(UnavailableReason::Missing)
}
fn model_failure<E>(_: E) -> AdapterError {
    AdapterError::Failed(FailureReason::Model)
}
fn invalid_model_output<E>(_: E) -> AdapterError {
    AdapterError::Failed(FailureReason::InvalidOutput)
}
fn invalid_digest<E>(_: E) -> AdapterError {
    AdapterError::InvalidInput(InputError::InvalidReplacement)
}
