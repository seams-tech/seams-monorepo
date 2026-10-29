//! Opt-in voice model files. Voice is off until the person turns it on.
//!
//! No package bundles these files and inference never downloads them. A host calls
//! [`VoiceModel::install`] only after the person has seen the download size and
//! agreed to it, and [`VoiceModel::remove`] when the person turns voice off.

use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use sha2::{Digest, Sha256};

use super::artifacts::parse_digest;
use crate::adapters::AdapterError;
use crate::domain::{FailureReason, UnavailableReason};
use crate::runtime::WorkContext;

const READ_CHUNK_BYTES: usize = 1 << 20;
const DOWNLOAD_ATTEMPTS: u32 = 5;

/// One pinned model file that a host may download after the person opts in.
pub struct VoiceModel {
    /// Stable catalog identifier.
    pub id: &'static str,
    /// File name inside the host's voice model directory.
    pub file_name: &'static str,
    /// HTTPS source at an immutable revision.
    pub url: &'static str,
    /// Exact published size in bytes, shown to the person before the download.
    pub bytes: u64,
    /// Lowercase hexadecimal SHA-256 of the published file.
    pub sha256: &'static str,
    /// Licence of the model weights.
    pub license: &'static str,
}

/// Whisper large-v3-turbo with 8-bit weights, from the whisper.cpp model repository.
pub const WHISPER_LARGE_V3_TURBO_Q8_0: VoiceModel = VoiceModel {
    id: "whisper-large-v3-turbo-q8_0",
    file_name: "ggml-large-v3-turbo-q8_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q8_0.bin",
    bytes: 874_188_075,
    sha256: "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1",
    license: "MIT",
};

/// Whisper large-v3-turbo with 5-bit weights, from the whisper.cpp model repository.
pub const WHISPER_LARGE_V3_TURBO_Q5_0: VoiceModel = VoiceModel {
    id: "whisper-large-v3-turbo-q5_0",
    file_name: "ggml-large-v3-turbo-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin",
    bytes: 574_041_195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    license: "MIT",
};

/// The model that `voice on` installs. 8-bit weights matched the full model on the
/// approval bench at about half the download.
pub const DEFAULT_WHISPER_MODEL: &VoiceModel = &WHISPER_LARGE_V3_TURBO_Q8_0;

/// Catalog lookup for host metadata files.
pub fn voice_model(id: &str) -> Option<&'static VoiceModel> {
    [&WHISPER_LARGE_V3_TURBO_Q8_0, &WHISPER_LARGE_V3_TURBO_Q5_0]
        .into_iter()
        .find(|model| model.id == id)
}

/// Local state of one model file. Only loading verifies the digest.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallState {
    /// The person has not turned voice on, or turned it off.
    NotInstalled,
    /// An interrupted download that the next install resumes.
    Partial {
        /// Bytes already on disk.
        bytes: u64,
    },
    /// The complete file is present.
    Installed,
}

enum Step {
    Retry,
    Stop(AdapterError),
}

impl VoiceModel {
    /// Final file location in `directory`.
    pub fn path(&self, directory: &Path) -> PathBuf {
        directory.join(self.file_name)
    }

    fn partial_path(&self, directory: &Path) -> PathBuf {
        directory.join(format!("{}.partial", self.file_name))
    }

    /// Read file metadata only. This never touches the network or the model bytes.
    pub fn state(&self, directory: &Path) -> InstallState {
        if let Ok(metadata) = fs::symlink_metadata(self.path(directory))
            && metadata.file_type().is_file()
            && metadata.len() == self.bytes
        {
            return InstallState::Installed;
        }
        match fs::symlink_metadata(self.partial_path(directory)) {
            Ok(metadata) if metadata.file_type().is_file() => InstallState::Partial {
                bytes: metadata.len(),
            },
            _ => InstallState::NotInstalled,
        }
    }

    /// Download, resume, and verify the pinned file. Call this only after the person
    /// opted in. The file appears at [`VoiceModel::path`] only after its size and
    /// SHA-256 match. An interrupted download keeps its bytes for the next call.
    pub fn install(
        &self,
        directory: &Path,
        progress: &mut dyn FnMut(u64, u64),
        work: &WorkContext<'_>,
    ) -> Result<PathBuf, AdapterError> {
        work.check().map_err(AdapterError::Work)?;
        let expected = parse_digest(self.sha256)?;
        fs::create_dir_all(directory).map_err(storage_failure)?;
        let target = self.path(directory);
        if self.state(directory) == InstallState::Installed {
            if digest_file(&target, work)? == expected {
                progress(self.bytes, self.bytes);
                return Ok(target);
            }
            fs::remove_file(&target).map_err(storage_failure)?;
        }
        let partial = self.partial_path(directory);
        let mut attempt = 0;
        loop {
            match self.download(&partial, progress, work) {
                Ok(()) => break,
                Err(Step::Retry) if attempt + 1 < DOWNLOAD_ATTEMPTS => {
                    attempt += 1;
                    work.check().map_err(AdapterError::Work)?;
                    std::thread::sleep(Duration::from_secs(u64::from(attempt) * 2));
                }
                Err(Step::Retry) => {
                    return Err(AdapterError::Unavailable(UnavailableReason::Missing));
                }
                Err(Step::Stop(error)) => return Err(error),
            }
        }
        if digest_file(&partial, work)? != expected {
            fs::remove_file(&partial).map_err(storage_failure)?;
            return Err(AdapterError::Failed(FailureReason::InvalidOutput));
        }
        fs::rename(&partial, &target).map_err(storage_failure)?;
        File::open(directory)
            .and_then(|directory| directory.sync_all())
            .map_err(storage_failure)?;
        Ok(target)
    }

    /// Delete the file and any partial download, for example when the person turns voice off.
    pub fn remove(&self, directory: &Path) -> Result<(), AdapterError> {
        for path in [self.path(directory), self.partial_path(directory)] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(storage_failure(error)),
            }
        }
        Ok(())
    }

    fn download(
        &self,
        partial: &Path,
        progress: &mut dyn FnMut(u64, u64),
        work: &WorkContext<'_>,
    ) -> Result<(), Step> {
        let mut offset = match fs::symlink_metadata(partial) {
            Ok(metadata) if metadata.file_type().is_file() => metadata.len(),
            Ok(_) => return Err(Step::Stop(storage_failure(()))),
            Err(error) if error.kind() == ErrorKind::NotFound => 0,
            Err(error) => return Err(Step::Stop(storage_failure(error))),
        };
        if offset > self.bytes {
            offset = 0;
        }
        if offset == self.bytes {
            return Ok(());
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .https_only(true)
            .max_redirects(10)
            .timeout_connect(Some(Duration::from_secs(30)))
            .timeout_recv_response(Some(Duration::from_secs(60)))
            .build()
            .into();
        let mut request = agent.get(self.url);
        if offset > 0 {
            request = request.header("Range", format!("bytes={offset}-"));
        }
        let response = request.call().map_err(|_| Step::Retry)?;
        let start = match response.status().as_u16() {
            200 => 0,
            206 if content_range_start(&response) == Some(offset) => offset,
            _ => return Err(Step::Retry),
        };
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(partial)
            .map_err(|error| Step::Stop(storage_failure(error)))?;
        file.set_len(start)
            .and_then(|()| file.seek(SeekFrom::Start(start)).map(drop))
            .map_err(|error| Step::Stop(storage_failure(error)))?;
        let mut reader = response
            .into_body()
            .into_with_config()
            .limit(self.bytes - start)
            .reader();
        let mut buffer = vec![0; READ_CHUNK_BYTES];
        let mut written = start;
        loop {
            work.check()
                .map_err(|error| Step::Stop(AdapterError::Work(error)))?;
            let count = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => count,
                Err(_) => {
                    file.sync_all()
                        .map_err(|error| Step::Stop(storage_failure(error)))?;
                    return Err(Step::Retry);
                }
            };
            file.write_all(&buffer[..count])
                .map_err(|error| Step::Stop(storage_failure(error)))?;
            written += count as u64;
            progress(written, self.bytes);
        }
        file.sync_all()
            .map_err(|error| Step::Stop(storage_failure(error)))?;
        if written != self.bytes {
            return Err(Step::Retry);
        }
        Ok(())
    }
}

fn content_range_start(response: &ureq::http::Response<ureq::Body>) -> Option<u64> {
    let value = response.headers().get("content-range")?.to_str().ok()?;
    let range = value.strip_prefix("bytes ")?;
    range.split_once('-')?.0.parse().ok()
}

/// Stream a file through SHA-256 without keeping its bytes.
fn digest_file(path: &Path, work: &WorkContext<'_>) -> Result<[u8; 32], AdapterError> {
    let mut file = File::open(path).map_err(storage_failure)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; READ_CHUNK_BYTES];
    loop {
        work.check().map_err(AdapterError::Work)?;
        let count = file.read(&mut buffer).map_err(storage_failure)?;
        if count == 0 {
            return Ok(hasher.finalize().into());
        }
        hasher.update(&buffer[..count]);
    }
}

fn storage_failure<E>(_: E) -> AdapterError {
    AdapterError::Failed(FailureReason::Storage)
}
