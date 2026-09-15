//! Current, recent, expired, and departed participant context on a local timeline.
//! Consumes observations without acquiring camera frames or granting authority.

use std::time::Duration;

use crate::domain::{
    CalibrationId, CaptureSessionId, CaptureTime, CoordinateFrameId, FrameStamp, IdentityMatch,
    InputError, ModelId, TimeRange, UnavailableReason,
};

/// Visual track key, scoped to an uninterrupted capture epoch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrackId {
    /// Capture epoch shared with the audio timeline.
    pub session: CaptureSessionId,
    /// Track sequence; a lost or crossing-ambiguous track must never reuse continuity.
    pub sequence: u64,
}

/// Qualified three-dimensional location with explicit uncertainty.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PositionEstimate {
    frame: CoordinateFrameId,
    meters: [f32; 3],
    uncertainty_meters: f32,
}

impl PositionEstimate {
    /// Reject non-finite coordinates and negative/non-finite uncertainty.
    pub fn new(
        frame: CoordinateFrameId,
        meters: [f32; 3],
        uncertainty_meters: f32,
    ) -> Result<Self, InputError> {
        for coordinate in meters {
            if !coordinate.is_finite() {
                return Err(InputError::InvalidPosition);
            }
        }
        if !uncertainty_meters.is_finite() || uncertainty_meters < 0.0 {
            return Err(InputError::InvalidPosition);
        }
        Ok(Self {
            frame,
            meters,
            uncertainty_meters,
        })
    }

    /// Applicable geometry/pose reference frame.
    pub fn frame(self) -> CoordinateFrameId {
        self.frame
    }
    /// XYZ coordinates in meters.
    pub fn meters(self) -> [f32; 3] {
        self.meters
    }
    /// Qualified radius of location uncertainty.
    pub fn uncertainty_meters(self) -> f32 {
        self.uncertainty_meters
    }
}

/// Spatial information stays explicitly unavailable when geometry or pose is unqualified.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Location {
    /// Position in a known frame with uncertainty.
    Located(PositionEstimate),
    /// A track may still be visible without a usable spatial estimate.
    Unavailable(UnavailableReason),
}

/// A normalized visual observation. Seeing a track supplies no command authority.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VisualObservation {
    track: TrackId,
    captured_at: CaptureTime,
    location: Location,
    identity: IdentityMatch,
}

impl VisualObservation {
    /// Bind the observation to the track's capture epoch.
    pub fn new(
        track: TrackId,
        captured_at: CaptureTime,
        location: Location,
        identity: IdentityMatch,
    ) -> Result<Self, InputError> {
        if track.session != captured_at.session {
            return Err(InputError::SessionMismatch);
        }
        Ok(Self {
            track,
            captured_at,
            location,
            identity,
        })
    }

    /// Session-scoped track identity.
    pub fn track(self) -> TrackId {
        self.track
    }
    /// Original capture time, retained when the observation becomes recent context.
    pub fn captured_at(self) -> CaptureTime {
        self.captured_at
    }
    /// Spatial estimate or its explicit absence.
    pub fn location(self) -> Location {
        self.location
    }
    /// Face identity state; unknown carries no enrollment reference.
    pub fn identity(self) -> IdentityMatch {
        self.identity
    }
}

/// Last-seen observation with a bounded retention window. No timestamp refresh is implied.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RecentPresence {
    observation: VisualObservation,
    validity: TimeRange,
}

impl RecentPresence {
    /// Enforce the configured maximum age in the original capture epoch.
    pub fn new(
        observation: VisualObservation,
        valid_until: CaptureTime,
        maximum_age: Duration,
    ) -> Result<Self, InputError> {
        let validity = TimeRange::new(observation.captured_at(), valid_until)?;
        if validity.duration() > maximum_age {
            return Err(InputError::LimitExceeded);
        }
        Ok(Self {
            observation,
            validity,
        })
    }

    /// Unmodified last-seen observation.
    pub fn observation(self) -> VisualObservation {
        self.observation
    }
    /// Bounded half-open time window; continuity invalidations can end it earlier.
    pub fn validity(self) -> TimeRange {
        self.validity
    }
}

/// Per-track presence state; terminal branches carry no active observation.
///
/// ```compile_fail
/// use voiceid_engine::presence::{PresenceState, VisualObservation};
/// fn retain_after_departure(observation: VisualObservation) -> PresenceState {
///     PresenceState::Departed(observation)
/// }
/// ```
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PresenceState {
    /// Track observed in the current assessment window.
    Current(VisualObservation),
    /// Earlier observation, usable only while its time and continuity checks hold.
    Recent(RecentPresence),
    /// Retention horizon ended.
    Expired(TrackId),
    /// Departure was observed; remembered presence is immediately invalidated.
    Departed(TrackId),
    /// Tracking ambiguity or contradictory scene evidence invalidated continuity.
    Invalidated(TrackId),
}

/// Bounded visual adapter output for one source frame.
#[derive(Clone, Debug, PartialEq)]
pub struct VisualAssessment {
    stamp: FrameStamp,
    model: ModelId,
    calibration: CalibrationId,
    observations: Vec<VisualObservation>,
}

impl VisualAssessment {
    /// Validate every track against the exact input frame and configured track limit.
    pub fn new(
        stamp: FrameStamp,
        model: ModelId,
        calibration: CalibrationId,
        observations: Vec<VisualObservation>,
        maximum_tracks: std::num::NonZeroUsize,
    ) -> Result<Self, InputError> {
        if observations.len() > maximum_tracks.get() {
            return Err(InputError::LimitExceeded);
        }
        let mut tracks = Vec::with_capacity(observations.len());
        for observation in &observations {
            if observation.captured_at() != stamp.captured_at {
                return Err(InputError::InvalidTimeRange);
            }
            if tracks.contains(&observation.track()) {
                return Err(InputError::DuplicateTrack);
            }
            tracks.push(observation.track());
        }
        Ok(Self {
            stamp,
            model,
            calibration,
            observations,
        })
    }

    /// Original source frame sequence and time.
    pub fn stamp(&self) -> FrameStamp {
        self.stamp
    }
    /// Exact model revision.
    pub fn model(&self) -> ModelId {
        self.model
    }
    /// Qualified visual configuration revision.
    pub fn calibration(&self) -> CalibrationId {
        self.calibration
    }
    /// Borrowed observations, bounded by the configured maximum track count.
    pub fn observations(&self) -> &[VisualObservation] {
        &self.observations
    }
}
