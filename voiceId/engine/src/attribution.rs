//! Current-utterance attribution from voice, visual, and spatial observations.
//! Produces attribution outcomes without executing commands or wallet operations.

use crate::domain::{CalibrationId, EnrollmentRef, ModelId, ProfileId, TimeRange};
use crate::presence::{RecentPresence, VisualObservation};
use crate::utterance::UtteranceSpan;

/// Exact independently calibrated voice gate that supported attribution.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SupportingGate {
    /// Provisioned model artifact revision.
    pub model: ModelId,
    /// Gate calibration revision.
    pub calibration: CalibrationId,
}

/// Visual support used by the qualified attribution profile.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PresenceSupport {
    /// Explicitly qualified audio-only path; no visual confirmation is claimed.
    AudioOnly,
    /// Qualified concurrent visual observation.
    Current {
        /// Observation associated with the current speaker.
        observation: VisualObservation,
        /// Visual model and calibration used for the association.
        gate: SupportingGate,
    },
    /// Qualified recent-context path with original timestamp and bounded horizon.
    Recent {
        /// Still-valid last-seen context, subject to early continuity invalidation.
        presence: RecentPresence,
        /// Visual model and calibration used for the association.
        gate: SupportingGate,
    },
}

/// Successful perception result. Construction is reserved for the future attribution
/// coordinator; there is no public success constructor or executable command here.
///
/// ```compile_fail
/// use voiceid_engine::attribution::{AttributedUtterance, PresenceSupport, SupportingGate};
/// use voiceid_engine::domain::{EnrollmentRef, ProfileId, TimeRange};
/// use voiceid_engine::utterance::UtteranceSpan;
/// fn fabricate(utterance: UtteranceSpan, identity: EnrollmentRef, profile: ProfileId,
///     gate: SupportingGate, validity: TimeRange) -> AttributedUtterance {
///     AttributedUtterance {
///         utterance, identity, profile, speaker: gate, presentation_attack: gate,
///         presence: PresenceSupport::AudioOnly, validity,
///     }
/// }
/// ```
#[derive(Debug, PartialEq)]
pub struct AttributedUtterance {
    utterance: UtteranceSpan,
    identity: EnrollmentRef,
    profile: ProfileId,
    speaker: SupportingGate,
    presentation_attack: SupportingGate,
    presence: PresenceSupport,
    validity: TimeRange,
}

impl AttributedUtterance {
    /// Exact utterance being attributed; its capture epoch is part of the key.
    pub fn utterance(&self) -> UtteranceSpan {
        self.utterance
    }
    /// Matched owner's current enrollment version.
    pub fn identity(&self) -> EnrollmentRef {
        self.identity
    }
    /// Qualified attribution profile revision.
    pub fn profile(&self) -> ProfileId {
        self.profile
    }
    /// Current-utterance speaker gate.
    pub fn speaker(&self) -> SupportingGate {
        self.speaker
    }
    /// Independent current-utterance presentation-attack gate.
    pub fn presentation_attack(&self) -> SupportingGate {
        self.presentation_attack
    }
    /// Visual or explicitly audio-only support.
    pub fn presence(&self) -> PresenceSupport {
        self.presence
    }
    /// Exclusive decision lifetime, bounded by all supporting evidence.
    pub fn validity(&self) -> TimeRange {
        self.validity
    }
}

/// Evidence that affirmatively rejects attribution of a fresh utterance.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RejectionReason {
    /// Current speaker did not match the enrolled owner.
    UnknownSpeaker,
    /// Current evidence suggests playback or another presentation attack.
    SuspectedAttack,
    /// Visual/spatial evidence contradicts the proposed speaker.
    ContradictoryPresence,
    /// The source is the robot's own speech or is clearly background audio.
    BackgroundOrSelfSpeech,
}

/// Required evidence that could not be obtained for the current utterance.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InsufficientReason {
    /// A required capability or qualified current evidence is absent.
    MissingEvidence,
    /// A deadline, session, enrollment version, or continuity check invalidated evidence.
    InvalidatedEvidence,
}

/// Per-utterance outcome. Only `Attributed` carries a matched identity and support.
/// Consumer action policy and the robot safety controller remain separate gates.
#[derive(Debug, PartialEq)]
pub enum AttributionOutcome {
    /// Current speech was attributed under the selected profile.
    Attributed(Box<AttributedUtterance>),
    /// A fresh utterance or scene reacquisition is required.
    Ambiguous {
        /// Current source being assessed.
        utterance: UtteranceSpan,
    },
    /// Evidence affirmatively failed an attribution requirement.
    Rejected {
        /// Current source being assessed.
        utterance: UtteranceSpan,
        /// Domain reason; no executable payload is available.
        reason: RejectionReason,
    },
    /// Available evidence cannot support an attribution decision.
    Insufficient {
        /// Current source being assessed.
        utterance: UtteranceSpan,
        /// Domain reason; missing checks never become a success.
        reason: InsufficientReason,
    },
}
