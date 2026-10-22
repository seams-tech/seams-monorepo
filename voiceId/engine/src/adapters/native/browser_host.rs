//! Chrome native messaging for one local voice check. No wallet secrets cross this boundary.

use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{SyncSender, sync_channel};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::Microphone;
use super::local_host::{CollectionPurpose, LocalClock, SpokenCommand, collect_utterance};
use super::session::{NativeOutcome, NativeSession, NativeStatus};
use crate::adapters::AdapterError;
use crate::runtime::{Cancellation, WorkContext};
use crate::utterance::SpeechWindow;

const EXTENSION_ORIGIN: &str = "chrome-extension://ackhkimailmgolplljlhgoclgdjcgdba/";
const MAXIMUM_MESSAGE_BYTES: usize = 4096;

/// Local capture port. The browser protocol never accepts audio or an audio file path.
/// A journey host can replay synthetic audio through the same native inference path.
pub trait CommandCapture {
    /// Collect one bounded command after the wallet's explicit capture request.
    fn collect(
        &mut self,
        clock: &LocalClock,
        work: &WorkContext<'_>,
        on_started: &mut dyn FnMut() -> Result<(), AdapterError>,
    ) -> Result<SpeechWindow, AdapterError>;
}

/// Production default-microphone capture. No audio is retained after the check.
pub struct MicrophoneCommand;
impl CommandCapture for MicrophoneCommand {
    fn collect(
        &mut self,
        clock: &LocalClock,
        work: &WorkContext<'_>,
        on_started: &mut dyn FnMut() -> Result<(), AdapterError>,
    ) -> Result<SpeechWindow, AdapterError> {
        let mut microphone = Microphone::prepare(clock, work)?.start(work)?;
        on_started()?;
        collect_utterance(&mut microphone, CollectionPurpose::Command, work)
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    attempt_id: String,
    operation_hash: String,
    expires_at_ms: u64,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Status { id: String },
    Listen { binding: Binding },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Reply {
    Listening {
        binding: Binding,
    },
    Status {
        id: String,
        enrollment: &'static str,
    },
    Result {
        binding: Binding,
        outcome: &'static str,
    },
}

pub(crate) struct PortCancellation(AtomicBool);
impl Cancellation for PortCancellation {
    fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// Serve one Chrome connection on standard input/output. The first argument is
/// Chrome's caller origin, checked against the pinned prototype extension.
/// Disconnects, extra messages, malformed framing, and expiry prevent approval.
pub fn run(
    models: &Path,
    namespace: &str,
    caller_origin: &str,
    capture: &mut impl CommandCapture,
) -> Result<(), String> {
    if caller_origin != EXTENSION_ORIGIN || !models.is_absolute() {
        return Err("VoiceID native host caller or model path is invalid".into());
    }
    let cancellation = Arc::new(PortCancellation(AtomicBool::new(false)));
    let (sender, receiver) = sync_channel(1);
    let reader_cancellation = Arc::clone(&cancellation);
    std::thread::spawn(move || read_connection(sender, reader_cancellation));
    let request = receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(error_text)??;
    let started = Instant::now();
    let budget = validate_request(&request)?;
    let mut session =
        NativeSession::open(models, namespace, cancellation.as_ref()).map_err(error_text)?;
    if cancellation.is_cancelled() {
        return Err("VoiceID connection closed".into());
    }
    let reply = match request {
        Request::Status { id } => {
            let enrollment = match session.status().map_err(error_text)? {
                NativeStatus::Ready => "ready",
                NativeStatus::Empty => "empty",
                _ => return Err("VoiceID host is unavailable".into()),
            };
            Reply::Status { id, enrollment }
        }
        Request::Listen { binding } => {
            let remaining = budget.saturating_sub(started.elapsed());
            let outcome = if remaining < Duration::from_millis(250) {
                "failed"
            } else {
                let mut on_started = || {
                    write_reply(&Reply::Listening {
                        binding: binding.clone(),
                    })
                    .map_err(notification_failed)
                };
                let checked = session.listen_capture(
                    remaining.as_millis() as u32,
                    capture,
                    cancellation.as_ref(),
                    &mut on_started,
                );
                match checked {
                    Ok(NativeOutcome::Matched(SpokenCommand::Approve)) => "approved",
                    Ok(NativeOutcome::Matched(SpokenCommand::Cancel)) => "cancelled",
                    Ok(_) => "rejected",
                    Err(_) => "failed",
                }
            };
            let outcome = if started.elapsed() >= budget || now_ms()? >= binding.expires_at_ms {
                "failed"
            } else {
                outcome
            };
            Reply::Result { binding, outcome }
        }
    };
    if cancellation.is_cancelled() {
        return Err("VoiceID connection closed".into());
    }
    write_reply(&reply)
}

fn validate_request(request: &Request) -> Result<Duration, String> {
    match request {
        Request::Status { id } if valid_attempt(id) => Ok(Duration::from_secs(60)),
        Request::Listen { binding } => {
            if !valid_attempt(&binding.attempt_id)
                || binding.operation_hash.len() != 64
                || !binding.operation_hash.bytes().all(is_lower_hex)
            {
                return Err("VoiceID binding is invalid".into());
            }
            let remaining = binding.expires_at_ms.saturating_sub(now_ms()?);
            // This bridge's 25 s budget stays below the native profile's 30 s
            // evidence age, including the capture clock's uncertainty bound.
            if !(250..=25_000).contains(&remaining) {
                return Err("VoiceID binding expired or exceeds the capture limit".into());
            }
            Ok(Duration::from_millis(remaining))
        }
        _ => Err("VoiceID request is invalid".into()),
    }
}

fn valid_attempt(value: &str) -> bool {
    value.len() == 36 && value.bytes().all(is_attempt_byte)
}
fn is_attempt_byte(value: u8) -> bool {
    value == b'-' || is_lower_hex(value)
}
fn is_lower_hex(value: u8) -> bool {
    value.is_ascii_digit() || (b'a'..=b'f').contains(&value)
}
fn now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(error_text)?
        .as_millis()
        .try_into()
        .map_err(error_text)
}

fn read_connection(
    sender: SyncSender<Result<Request, String>>,
    cancellation: Arc<PortCancellation>,
) {
    let input = io::stdin();
    let mut input = input.lock();
    let first = read_request(&mut input);
    if sender.send(first).is_err() {
        cancellation.0.store(true, Ordering::Release);
        return;
    }
    // The connection admits exactly one request. EOF cancels capture. Any further
    // byte also invalidates the request, including a duplicate listen message.
    let mut byte = [0];
    let _ = input.read(&mut byte);
    cancellation.0.store(true, Ordering::Release);
}

fn read_request(input: &mut impl Read) -> Result<Request, String> {
    let mut header = [0; 4];
    input.read_exact(&mut header).map_err(error_text)?;
    let length = u32::from_ne_bytes(header) as usize;
    if length == 0 || length > MAXIMUM_MESSAGE_BYTES {
        return Err("VoiceID native message length is invalid".into());
    }
    let mut body = vec![0; length];
    input.read_exact(&mut body).map_err(error_text)?;
    serde_json::from_slice(&body).map_err(error_text)
}

fn write_reply(reply: &Reply) -> Result<(), String> {
    let body = serde_json::to_vec(reply).map_err(error_text)?;
    let mut output = io::stdout().lock();
    output
        .write_all(&(body.len() as u32).to_ne_bytes())
        .map_err(error_text)?;
    output.write_all(&body).map_err(error_text)?;
    output.flush().map_err(error_text)
}

fn error_text(error: impl std::fmt::Debug) -> String {
    format!("VoiceID native messaging: {error:?}")
}

fn notification_failed(_error: String) -> AdapterError {
    AdapterError::Work(crate::runtime::WorkError::Cancelled)
}
