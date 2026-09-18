//! Deliberate enrollment, template lifecycle, and the template-storage boundary.
//! Device storage mechanisms and model-specific extraction belong to adapters.

use std::num::{NonZeroU32, NonZeroUsize};

use crate::domain::{DeviceId, EnrollmentRef, InputError, ModelId};

/// Bounded model-specific template bytes. No automatic logging or cloning.
/// This is plaintext in local memory; encryption belongs to the protected store.
pub struct TemplateData {
    model: ModelId,
    format_version: NonZeroU32,
    bytes: Vec<u8>,
}

impl TemplateData {
    /// Accept a nonempty template under a locally configured byte limit.
    /// A backend must validate its model-specific encoding before constructing this value.
    pub fn new(
        model: ModelId,
        format_version: NonZeroU32,
        bytes: Vec<u8>,
        maximum_bytes: NonZeroUsize,
    ) -> Result<Self, InputError> {
        if bytes.is_empty() {
            return Err(InputError::Empty);
        }
        if bytes.len() > maximum_bytes.get() {
            return Err(InputError::LimitExceeded);
        }
        Ok(Self {
            model,
            format_version,
            bytes,
        })
    }

    /// Exact model artifact revision defining these bytes.
    pub fn model(&self) -> ModelId {
        self.model
    }
    /// Encoding version validated by the model adapter.
    pub fn format_version(&self) -> NonZeroU32 {
        self.format_version
    }
    /// Borrow sensitive template bytes only for the duration of local work.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

/// Voice-template modality is explicit at matching boundaries.
pub struct VoiceTemplate(pub TemplateData);

/// Face-template modality is explicit at visual boundaries.
pub struct FaceTemplate(pub TemplateData);

/// Deliberate optional face enrollment; absence provides no face identity evidence.
pub enum FaceEnrollment {
    /// No consented face template was enrolled.
    Disabled,
    /// Template paired with the voice enrollment through approved local setup.
    Enrolled(FaceTemplate),
}

/// One atomic template set for the initial single-owner scope.
/// The enrollment coordinator must approve collection/stability before committing it.
pub struct EnrollmentRecord {
    /// Identity and version shared by every modality in this record.
    pub identity: EnrollmentRef,
    /// Device whose protected storage owns this record.
    pub device: DeviceId,
    /// Required voice template.
    pub voice: VoiceTemplate,
    /// Explicit consented face enrollment state.
    pub face: FaceEnrollment,
}

/// Protected storage lookup result; absence cannot contain usable templates.
pub enum EnrollmentState {
    /// Local setup has not committed an enrollment.
    Empty,
    /// Authenticated and decoded record, bound to this store's device identity.
    Enrolled(EnrollmentRecord),
}

/// Atomic compare-and-replace request with validated enrollment-version ordering.
pub struct EnrollmentReplacement<'a> {
    expected: EnrollmentRef,
    replacement: &'a EnrollmentRecord,
}

impl<'a> EnrollmentReplacement<'a> {
    /// Require the same identity and a strictly greater version.
    /// The store atomically checks the expected version and its own device binding.
    pub fn new(
        expected: EnrollmentRef,
        replacement: &'a EnrollmentRecord,
    ) -> Result<Self, InputError> {
        if expected.id != replacement.identity.id
            || expected.version >= replacement.identity.version
        {
            return Err(InputError::InvalidReplacement);
        }
        Ok(Self {
            expected,
            replacement,
        })
    }

    /// Version that must still exist at commit time.
    pub fn expected(&self) -> EnrollmentRef {
        self.expected
    }
    /// Entire new record; modalities cannot be partially committed.
    pub fn replacement(&self) -> &EnrollmentRecord {
        self.replacement
    }
}
