use std::num::{NonZeroU32, NonZeroU64, NonZeroUsize};

use voiceid_engine::domain::{DeviceId, EnrollmentId, EnrollmentRef, ModelId};
use voiceid_engine::enrollment::{EnrollmentRecord, FaceEnrollment, TemplateData, VoiceTemplate};

pub fn enrollment(version: u64) -> EnrollmentRecord {
    EnrollmentRecord {
        identity: EnrollmentRef {
            id: EnrollmentId([4; 16]),
            version: NonZeroU64::new(version).unwrap(),
        },
        device: DeviceId([5; 16]),
        voice: VoiceTemplate(
            TemplateData::new(
                ModelId([1; 32]),
                NonZeroU32::new(1).unwrap(),
                vec![1, 2, 3],
                NonZeroUsize::new(3).unwrap(),
            )
            .unwrap(),
        ),
        face: FaceEnrollment::Disabled,
    }
}
