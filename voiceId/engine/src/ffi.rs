//! Versioned macOS C boundary. Every handle belongs to its creating OS thread.
//! Inputs are copied during calls. Results contain no media, templates, or signing authority.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;

use crate::adapters::native::local_host::SpokenCommand;
use crate::adapters::native::session::{
    NativeError, NativeOutcome, NativeResult, NativeSession, NativeStatus, RequestId, allocate_id,
};
use crate::runtime::Cancellation;

// A C call owns the session thread until it returns. C cancellation is admitted
// between synchronous calls, through the existing request handle.
struct CallInProgress;
impl Cancellation for CallInProgress {
    fn is_cancelled(&self) -> bool {
        false
    }
}

const MAXIMUM_SESSIONS: usize = 4;
thread_local! { static SESSIONS: RefCell<BTreeMap<u64, NativeSession>> = const { RefCell::new(BTreeMap::new()) }; }

/// Caller-owned fixed result layout. Valid outputs remain empty after failure.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct VoiceIdResultV1 {
    /// Exact consumed request handle.
    pub request: u64,
    /// Exclusive expiry on the session's monotonic clock, in nanoseconds.
    pub valid_until_ns: u64,
    /// Matched, rejected, ambiguous, or insufficient. See the C header.
    pub outcome: u32,
    /// Exact spoken command for a matched speaker, otherwise zero.
    pub command: u32,
}

enum Call {
    Open {
        models: PathBuf,
        namespace: String,
    },
    Close(u64),
    CloseEmpty(u64),
    Now(u64),
    Status(u64),
    Begin {
        session: u64,
        timeout_ms: u32,
    },
    Push {
        session: u64,
        request: RequestId,
        sequence: u64,
        captured_at_ns: u64,
        samples: Vec<f32>,
    },
    Finish {
        session: u64,
        request: RequestId,
    },
    Take {
        session: u64,
        request: RequestId,
    },
    Cancel {
        session: u64,
        request: RequestId,
    },
    EnrollBegin(u64),
    EnrollSample {
        session: u64,
        request: RequestId,
        captured_at_ns: u64,
        samples: Vec<f32>,
    },
    Delete(u64),
}
enum Reply {
    Empty,
    Number(u64),
    Result(NativeResult),
}

/// Return the exact supported C ABI version. No models or device are opened.
#[unsafe(no_mangle)]
pub extern "C" fn voiceid_abi_version() -> u32 {
    1
}

/// Load verified model metadata and acquire one protected enrollment namespace.
/// # Safety
/// Input buffers must be readable for their declared lengths. Output must point to writable u64 memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn voiceid_open_v1(
    models: *const u8,
    models_len: usize,
    namespace: *const u8,
    namespace_len: usize,
    output: *mut u64,
) -> u32 {
    if !valid_output(output) {
        return status(NativeError::InvalidInput);
    }
    unsafe {
        output.write(0);
    }
    let path = match unsafe { copy_text(models, models_len, 4096) } {
        Ok(path) => PathBuf::from(path),
        Err(error) => return status(error),
    };
    if !path.is_absolute() {
        return status(NativeError::InvalidInput);
    }
    let namespace = match unsafe { copy_text(namespace, namespace_len, 128) } {
        Ok(value) => value,
        Err(error) => return status(error),
    };
    unsafe {
        number_reply(
            output,
            Call::Open {
                models: path,
                namespace,
            },
        )
    }
}

/// Close one session, dropping active work and invalidating all its request handles.
#[unsafe(no_mangle)]
pub extern "C" fn voiceid_close_v1(session: u64) -> u32 {
    unit_reply(Call::Close(session))
}

/// Consume a session and remove its device metadata if its namespace is idle and empty.
/// The handle is consumed even when protected storage rejects namespace removal.
#[unsafe(no_mangle)]
pub extern "C" fn voiceid_close_empty_namespace_v1(session: u64) -> u32 {
    unit_reply(Call::CloseEmpty(session))
}

/// Read the session's monotonic time for capture-clock mapping.
/// # Safety
/// Output must point to writable u64 memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn voiceid_now_v1(session: u64, output: *mut u64) -> u32 {
    unsafe { number_reply(output, Call::Now(session)) }
}

/// Read current readiness. Status values grant no wallet authority.
/// # Safety
/// Output must point to writable u64 memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn voiceid_status_v1(session: u64, output: *mut u64) -> u32 {
    unsafe { number_reply(output, Call::Status(session)) }
}

/// Allocate one attempt before capture. Timeout must be between 250 and 30000 ms.
/// # Safety
/// Output must point to writable u64 memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn voiceid_begin_v1(session: u64, timeout_ms: u32, output: *mut u64) -> u32 {
    unsafe {
        number_reply(
            output,
            Call::Begin {
                session,
                timeout_ms,
            },
        )
    }
}

/// Copy one bounded contiguous mono 16 kHz PCM chunk into the current attempt.
/// # Safety
/// Samples must be aligned readable f32 memory for sample_count elements, between 1 and 1600.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn voiceid_push_v1(
    session: u64,
    request: u64,
    sequence: u64,
    captured_at_ns: u64,
    samples: *const f32,
    sample_count: usize,
) -> u32 {
    let request = match RequestId::parse(request) {
        Ok(id) => id,
        Err(error) => return status(error),
    };
    let samples = match unsafe { copy_pcm(samples, sample_count, 1600) } {
        Ok(samples) => samples,
        Err(error) => return status(error),
    };
    unit_reply(Call::Push {
        session,
        request,
        sequence,
        captured_at_ns,
        samples,
    })
}

/// Finalize one attempt. Its result remains pending until take or cancel.
#[unsafe(no_mangle)]
pub extern "C" fn voiceid_finish_v1(session: u64, request: u64) -> u32 {
    match RequestId::parse(request) {
        Ok(request) => unit_reply(Call::Finish { session, request }),
        Err(error) => status(error),
    }
}

/// Consume one fresh finalized perception result. Repeated delivery cannot succeed.
/// # Safety
/// Output must point to writable, aligned VoiceIdResultV1 memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn voiceid_take_v1(
    session: u64,
    request: u64,
    output: *mut VoiceIdResultV1,
) -> u32 {
    if !valid_output(output) {
        return status(NativeError::InvalidInput);
    }
    unsafe {
        output.write(VoiceIdResultV1::default());
    }
    let request = match RequestId::parse(request) {
        Ok(id) => id,
        Err(error) => return status(error),
    };
    match protected(Call::Take { session, request }) {
        Ok(Reply::Result(result)) => {
            unsafe {
                output.write(result_layout(result));
            }
            0
        }
        Ok(Reply::Empty | Reply::Number(_)) => status(NativeError::Failed),
        Err(error) => status(error),
    }
}

/// Cancel the exact active attempt or deliberate enrollment collection.
#[unsafe(no_mangle)]
pub extern "C" fn voiceid_cancel_v1(session: u64, request: u64) -> u32 {
    match RequestId::parse(request) {
        Ok(request) => unit_reply(Call::Cancel { session, request }),
        Err(error) => status(error),
    }
}

/// Begin deliberate three-capture setup only when no enrollment exists.
/// # Safety
/// Output must point to writable u64 memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn voiceid_enrollment_begin_v1(session: u64, output: *mut u64) -> u32 {
    unsafe { number_reply(output, Call::EnrollBegin(session)) }
}

/// Copy one complete enrollment capture. Return 2, 1, then 0 remaining captures.
/// Captures must follow begin, must not overlap, and must contain trailing silence.
/// # Safety
/// Samples must be readable aligned f32 memory for at most 160000 elements.
/// Output must point to writable u64 memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn voiceid_enrollment_sample_v1(
    session: u64,
    request: u64,
    captured_at_ns: u64,
    samples: *const f32,
    sample_count: usize,
    output: *mut u64,
) -> u32 {
    if !valid_output(output) {
        return status(NativeError::InvalidInput);
    }
    unsafe {
        output.write(0);
    }
    let request = match RequestId::parse(request) {
        Ok(id) => id,
        Err(error) => return status(error),
    };
    let samples = match unsafe { copy_pcm(samples, sample_count, 160000) } {
        Ok(samples) => samples,
        Err(error) => return status(error),
    };
    unsafe {
        number_reply(
            output,
            Call::EnrollSample {
                session,
                request,
                captured_at_ns,
                samples,
            },
        )
    }
}

/// Invalidate pending work and delete the protected owner enrollment.
#[unsafe(no_mangle)]
pub extern "C" fn voiceid_enrollment_delete_v1(session: u64) -> u32 {
    unit_reply(Call::Delete(session))
}

fn protected(call: Call) -> Result<Reply, NativeError> {
    match catch_unwind(AssertUnwindSafe(|| execute(call))) {
        Ok(result) => result,
        Err(_) => {
            let _ = SESSIONS.try_with(clear_sessions);
            Err(NativeError::Panicked)
        }
    }
}
fn execute(call: Call) -> Result<Reply, NativeError> {
    SESSIONS
        .try_with(|sessions| execute_borrowed(sessions, call))
        .map_err(registry_unavailable)?
}
fn execute_borrowed(
    sessions: &RefCell<BTreeMap<u64, NativeSession>>,
    call: Call,
) -> Result<Reply, NativeError> {
    let mut sessions = sessions.try_borrow_mut().map_err(registry_busy)?;
    match call {
        Call::Open { models, namespace } => {
            if sessions.len() >= MAXIMUM_SESSIONS {
                return Err(NativeError::Busy);
            }
            let session = NativeSession::open(&models, &namespace, &CallInProgress)?;
            let handle = allocate_id()?;
            sessions.insert(handle, session);
            Ok(Reply::Number(handle))
        }
        Call::Close(handle) => {
            sessions.remove(&handle).ok_or(NativeError::InvalidHandle)?;
            Ok(Reply::Empty)
        }
        Call::CloseEmpty(handle) => {
            sessions
                .remove(&handle)
                .ok_or(NativeError::InvalidHandle)?
                .close_empty_namespace()?;
            Ok(Reply::Empty)
        }
        Call::Now(handle) => Ok(Reply::Number(session(&mut sessions, handle)?.now_ns()?)),
        Call::Status(handle) => Ok(Reply::Number(status_value(
            session(&mut sessions, handle)?.status()?,
        ))),
        Call::Begin {
            session: handle,
            timeout_ms,
        } => Ok(Reply::Number(
            session(&mut sessions, handle)?.begin(timeout_ms)?.raw(),
        )),
        Call::Push {
            session: handle,
            request,
            sequence,
            captured_at_ns,
            samples,
        } => {
            session(&mut sessions, handle)?.push(request, sequence, captured_at_ns, samples)?;
            Ok(Reply::Empty)
        }
        Call::Finish {
            session: handle,
            request,
        } => {
            session(&mut sessions, handle)?.finish(request)?;
            Ok(Reply::Empty)
        }
        Call::Take {
            session: handle,
            request,
        } => Ok(Reply::Result(
            session(&mut sessions, handle)?.take(request)?,
        )),
        Call::Cancel {
            session: handle,
            request,
        } => {
            session(&mut sessions, handle)?.cancel(request)?;
            Ok(Reply::Empty)
        }
        Call::EnrollBegin(handle) => Ok(Reply::Number(
            session(&mut sessions, handle)?.enrollment_begin()?.raw(),
        )),
        Call::EnrollSample {
            session: handle,
            request,
            captured_at_ns,
            samples,
        } => Ok(Reply::Number(u64::from(
            session(&mut sessions, handle)?.enrollment_sample(request, captured_at_ns, samples)?,
        ))),
        Call::Delete(handle) => {
            session(&mut sessions, handle)?.delete_enrollment()?;
            Ok(Reply::Empty)
        }
    }
}
fn session(
    sessions: &mut BTreeMap<u64, NativeSession>,
    handle: u64,
) -> Result<&mut NativeSession, NativeError> {
    sessions.get_mut(&handle).ok_or(NativeError::InvalidHandle)
}
fn clear_sessions(sessions: &RefCell<BTreeMap<u64, NativeSession>>) {
    if let Ok(mut sessions) = sessions.try_borrow_mut() {
        sessions.clear();
    }
}
fn registry_busy<E>(_: E) -> NativeError {
    NativeError::Busy
}
fn registry_unavailable<E>(_: E) -> NativeError {
    NativeError::Stopped
}

unsafe fn number_reply(output: *mut u64, call: Call) -> u32 {
    if !valid_output(output) {
        return status(NativeError::InvalidInput);
    }
    unsafe {
        output.write(0);
    }
    match protected(call) {
        Ok(Reply::Number(number)) => {
            unsafe {
                output.write(number);
            }
            0
        }
        Ok(Reply::Empty | Reply::Result(_)) => status(NativeError::Failed),
        Err(error) => status(error),
    }
}
fn unit_reply(call: Call) -> u32 {
    match protected(call) {
        Ok(Reply::Empty) => 0,
        Ok(Reply::Number(_) | Reply::Result(_)) => status(NativeError::Failed),
        Err(error) => status(error),
    }
}
fn valid_output<T>(pointer: *mut T) -> bool {
    !pointer.is_null() && pointer.is_aligned()
}
unsafe fn copy_text(
    pointer: *const u8,
    length: usize,
    maximum: usize,
) -> Result<String, NativeError> {
    if pointer.is_null() || length == 0 || length > maximum {
        return Err(NativeError::InvalidInput);
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    if bytes.contains(&0) {
        return Err(NativeError::InvalidInput);
    }
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(invalid_boundary)
}
unsafe fn copy_pcm(
    pointer: *const f32,
    length: usize,
    maximum: usize,
) -> Result<Vec<f32>, NativeError> {
    if pointer.is_null() || !pointer.is_aligned() || length == 0 || length > maximum {
        return Err(NativeError::InvalidInput);
    }
    Ok(unsafe { std::slice::from_raw_parts(pointer, length) }.to_vec())
}
fn invalid_boundary<E>(_: E) -> NativeError {
    NativeError::InvalidInput
}
fn result_layout(result: NativeResult) -> VoiceIdResultV1 {
    let (outcome, command) = match result.outcome {
        NativeOutcome::Matched(command) => (
            1,
            match command {
                SpokenCommand::Approve => 1,
                SpokenCommand::Cancel => 2,
                SpokenCommand::Unrecognized => 3,
            },
        ),
        NativeOutcome::Rejected => (2, 0),
        NativeOutcome::Ambiguous => (3, 0),
        NativeOutcome::Insufficient => (4, 0),
    };
    VoiceIdResultV1 {
        request: result.request.raw(),
        valid_until_ns: result.valid_until_ns,
        outcome,
        command,
    }
}
fn status_value(value: NativeStatus) -> u64 {
    match value {
        NativeStatus::Empty => 1,
        NativeStatus::Ready => 2,
        NativeStatus::Listening => 3,
        NativeStatus::Completed => 4,
        NativeStatus::Enrolling => 5,
        NativeStatus::Stopped => 6,
    }
}
fn status(error: NativeError) -> u32 {
    match error {
        NativeError::InvalidInput => 1,
        NativeError::InvalidHandle => 2,
        NativeError::Busy => 3,
        NativeError::Missing => 4,
        NativeError::Expired => 5,
        NativeError::Cancelled => 6,
        NativeError::Discontinuity => 7,
        NativeError::Failed => 8,
        NativeError::Conflict => 9,
        NativeError::NotReady => 10,
        NativeError::Stopped => 11,
        NativeError::Panicked => 12,
    }
}
