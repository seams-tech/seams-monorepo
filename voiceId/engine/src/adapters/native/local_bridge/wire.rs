//! Native bridge replies shared with the end-to-end wire fixture producer.

use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Binding {
    pub(super) attempt_id: String,
    pub(super) operation_hash: String,
    pub(super) expires_at_ms: u64,
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(super) enum Reply {
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
    DeviceListening {
        id: String,
    },
    ActivationApproved {
        id: String,
        public_key_b64u: String,
        device_key_id: String,
        factor_secret_b64u: String,
    },
    UnlockApproved {
        id: String,
        signature_b64u: String,
        factor_secret_b64u: String,
    },
    DeviceRejected {
        id: String,
        outcome: &'static str,
    },
}
