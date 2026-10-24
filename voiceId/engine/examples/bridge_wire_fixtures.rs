//! Generate synthetic replies through the production native bridge serializer.
#[path = "../src/adapters/native/local_bridge/wire.rs"]
mod wire;

use wire::{Binding, Reply};

fn binding() -> Binding {
    Binding {
        attempt_id: "00000000-0000-0000-0000-000000000001".into(),
        operation_hash: "a".repeat(64),
        expires_at_ms: 1,
    }
}

fn main() -> Result<(), serde_json::Error> {
    let id = "00000000-0000-0000-0000-000000000001";
    let replies = [
        Reply::Status {
            id: id.into(),
            enrollment: "ready",
        },
        Reply::Listening { binding: binding() },
        Reply::Result {
            binding: binding(),
            outcome: "approved",
        },
        Reply::DeviceListening { id: id.into() },
        Reply::ActivationApproved {
            id: id.into(),
            public_key_b64u: "B".repeat(43),
            device_key_id: "C".repeat(43),
            factor_secret_b64u: "A".repeat(43),
        },
        Reply::UnlockApproved {
            id: id.into(),
            signature_b64u: "D".repeat(86),
            factor_secret_b64u: "A".repeat(43),
        },
        Reply::DeviceRejected {
            id: id.into(),
            outcome: "cancelled",
        },
    ];
    serde_json::to_writer(std::io::stdout(), &replies)
}
