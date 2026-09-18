//! Session lifecycle, bounded work, deadlines, cancellation, and stage coordination.
//! Work contracts only; scheduling and lifecycle transitions are a later checkpoint.

use crate::domain::CaptureTime;

/// Injected monotonic clock in the current capture epoch. Never use wall-clock time.
pub trait Clock {
    /// Read time without blocking. An epoch change invalidates outstanding work.
    fn now(&self) -> CaptureTime;
}

/// Read-only cancellation view, supplied by the runtime for one unit of work.
pub trait Cancellation {
    /// Once true, this value stays true for the remainder of the work's lifetime.
    fn is_cancelled(&self) -> bool;
}

/// A stage must stop contributing results after any of these conditions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkError {
    /// The owning request was cancelled.
    Cancelled,
    /// The exclusive deadline has been reached.
    DeadlineExceeded,
    /// The runtime clock moved into another capture epoch.
    SessionChanged,
}

/// Required deadline and cancellation context for every potentially blocking adapter call.
pub struct WorkContext<'a> {
    /// Exclusive completion deadline in the capture epoch.
    pub deadline: CaptureTime,
    /// Runtime-owned monotonic time source.
    pub clock: &'a dyn Clock,
    /// Runtime-owned cancellation state.
    pub cancellation: &'a dyn Cancellation,
}

impl WorkContext<'_> {
    /// Check admission or completion. Call before work, between interruptible chunks,
    /// and after native work returns. The runtime independently checks before consumption.
    /// Cancellation never permits releasing memory still used by a native reader.
    pub fn check(&self) -> Result<(), WorkError> {
        if self.cancellation.is_cancelled() {
            return Err(WorkError::Cancelled);
        }
        let now = self.clock.now();
        if now.session != self.deadline.session {
            return Err(WorkError::SessionChanged);
        }
        if now.elapsed >= self.deadline.elapsed {
            return Err(WorkError::DeadlineExceeded);
        }
        Ok(())
    }
}
