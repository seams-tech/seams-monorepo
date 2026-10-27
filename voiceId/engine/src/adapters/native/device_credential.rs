//! One wallet-bound device credential. Voice never derives either secret.

use base64ct::{Base64UrlUnpadded, Encoding};
use ed25519_dalek::{Signer, SigningKey};
use security_framework::random::SecRandom;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::adapters::StoreError;
use crate::domain::{DeviceId, EnrollmentId, EnrollmentRef};

const RECORD_MAGIC: &[u8; 4] = b"VDK1";
const CHALLENGE_DOMAIN: &[u8] = b"seams:wallet-session:voiceid-device:v1|";
const MAXIMUM_ID_BYTES: usize = 128;
const MAXIMUM_CHALLENGE_BYTES: usize = 4096;
const FIXED_BYTES: usize = 4 + 16 + 16 + 8 + 2 + 2 + 32 + 32;

pub struct DeviceCredential {
    device: DeviceId,
    enrollment: EnrollmentRef,
    wallet_id: String,
    wallet_auth_method_id: String,
    signing_key: SigningKey,
    factor_secret: [u8; 32],
}

// Field order matches the Wallet's alphabetized JSON challenge encoding.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeviceChallenge {
    audience: String,
    challenge_id: String,
    device_key_id: String,
    expires_at_ms: u64,
    issued_at_ms: u64,
    kind: String,
    nonce: String,
    request_origin: String,
    wallet_auth_method_id: String,
    wallet_authority_id: String,
    wallet_id: String,
}

impl DeviceCredential {
    pub fn generate(
        device: DeviceId,
        enrollment: EnrollmentRef,
        wallet_id: &str,
        wallet_auth_method_id: &str,
    ) -> Result<Self, StoreError> {
        require_identity(wallet_id, wallet_auth_method_id)?;
        let random = SecRandom::default();
        let mut seed = [0; 32];
        random.copy_bytes(&mut seed).map_err(random_failed)?;
        let mut factor_secret = [0; 32];
        if random.copy_bytes(&mut factor_secret).is_err() {
            seed.zeroize();
            return Err(StoreError::Failed);
        }
        let signing_key = SigningKey::from_bytes(&seed);
        seed.zeroize();
        Ok(Self {
            device,
            enrollment,
            wallet_id: wallet_id.to_owned(),
            wallet_auth_method_id: wallet_auth_method_id.to_owned(),
            signing_key,
            factor_secret,
        })
    }

    pub fn decode(
        bytes: &[u8],
        expected_device: DeviceId,
        expected_enrollment: EnrollmentRef,
        wallet_id: &str,
        wallet_auth_method_id: &str,
    ) -> Result<Self, StoreError> {
        require_identity(wallet_id, wallet_auth_method_id)?;
        if bytes.len() < FIXED_BYTES || &bytes[..4] != RECORD_MAGIC {
            return Err(StoreError::InvalidRecord);
        }
        let device = DeviceId(bytes[4..20].try_into().map_err(invalid_record)?);
        if device != expected_device {
            return Err(StoreError::InvalidRecord);
        }
        let enrollment_id = EnrollmentId(bytes[20..36].try_into().map_err(invalid_record)?);
        let enrollment_version =
            u64::from_le_bytes(bytes[36..44].try_into().map_err(invalid_record)?);
        let enrollment = EnrollmentRef {
            id: enrollment_id,
            version: std::num::NonZeroU64::new(enrollment_version)
                .ok_or(StoreError::InvalidRecord)?,
        };
        if enrollment != expected_enrollment {
            return Err(StoreError::InvalidRecord);
        }
        let wallet_len = usize::from(u16::from_le_bytes(
            bytes[44..46].try_into().map_err(invalid_record)?,
        ));
        let method_len = usize::from(u16::from_le_bytes(
            bytes[46..48].try_into().map_err(invalid_record)?,
        ));
        if wallet_len == 0
            || method_len == 0
            || wallet_len > MAXIMUM_ID_BYTES
            || method_len > MAXIMUM_ID_BYTES
            || bytes.len() != FIXED_BYTES + wallet_len + method_len
        {
            return Err(StoreError::InvalidRecord);
        }
        let wallet_end = 48 + wallet_len;
        let method_end = wallet_end + method_len;
        if bytes[48..wallet_end] != wallet_id.as_bytes()[..]
            || bytes[wallet_end..method_end] != wallet_auth_method_id.as_bytes()[..]
        {
            return Err(StoreError::InvalidRecord);
        }
        let mut seed: [u8; 32] = bytes[method_end..method_end + 32]
            .try_into()
            .map_err(invalid_record)?;
        let signing_key = SigningKey::from_bytes(&seed);
        seed.zeroize();
        let factor_secret = bytes[method_end + 32..]
            .try_into()
            .map_err(invalid_record)?;
        Ok(Self {
            device,
            enrollment,
            wallet_id: wallet_id.to_owned(),
            wallet_auth_method_id: wallet_auth_method_id.to_owned(),
            signing_key,
            factor_secret,
        })
    }

    pub fn encode(&self) -> Zeroizing<Vec<u8>> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(
            FIXED_BYTES + self.wallet_id.len() + self.wallet_auth_method_id.len(),
        ));
        bytes.extend_from_slice(RECORD_MAGIC);
        bytes.extend_from_slice(&self.device.0);
        bytes.extend_from_slice(&self.enrollment.id.0);
        bytes.extend_from_slice(&self.enrollment.version.get().to_le_bytes());
        bytes.extend_from_slice(&(self.wallet_id.len() as u16).to_le_bytes());
        bytes.extend_from_slice(&(self.wallet_auth_method_id.len() as u16).to_le_bytes());
        bytes.extend_from_slice(self.wallet_id.as_bytes());
        bytes.extend_from_slice(self.wallet_auth_method_id.as_bytes());
        let mut seed = self.signing_key.to_bytes();
        bytes.extend_from_slice(&seed);
        seed.zeroize();
        bytes.extend_from_slice(&self.factor_secret);
        bytes
    }

    pub fn wallet_id(&self) -> &str {
        &self.wallet_id
    }

    pub fn enrollment(&self) -> EnrollmentRef {
        self.enrollment
    }

    pub fn wallet_auth_method_id(&self) -> &str {
        &self.wallet_auth_method_id
    }

    pub fn public_key_b64u(&self) -> String {
        Base64UrlUnpadded::encode_string(self.signing_key.verifying_key().as_bytes())
    }

    pub fn device_key_id_b64u(&self) -> String {
        let digest = Sha256::digest(self.signing_key.verifying_key().as_bytes());
        Base64UrlUnpadded::encode_string(&digest)
    }

    pub fn factor_secret_b64u(&self) -> String {
        Base64UrlUnpadded::encode_string(&self.factor_secret)
    }

    pub fn sign_challenge(
        &self,
        raw_challenge: &Value,
        caller_origin: &str,
        now_ms: u64,
    ) -> Result<String, StoreError> {
        let challenge: DeviceChallenge =
            serde_json::from_value(raw_challenge.clone()).map_err(invalid_record)?;
        if challenge.kind != "voiceid_wallet_session_challenge_v1"
            || challenge.wallet_id != self.wallet_id
            || challenge.wallet_auth_method_id != self.wallet_auth_method_id
            || challenge.device_key_id != self.device_key_id_b64u()
            || challenge.request_origin != caller_origin
            || challenge.wallet_authority_id.is_empty()
            || challenge.challenge_id.is_empty()
            || challenge.nonce.is_empty()
            || challenge.audience.is_empty()
            || challenge.issued_at_ms > now_ms.saturating_add(5_000)
            || now_ms >= challenge.expires_at_ms
            || challenge.expires_at_ms <= challenge.issued_at_ms
            || challenge.expires_at_ms - challenge.issued_at_ms > 60_000
        {
            return Err(StoreError::InvalidRecord);
        }
        let encoded = serde_json::to_vec(&challenge).map_err(invalid_record)?;
        if encoded.len() + CHALLENGE_DOMAIN.len() > MAXIMUM_CHALLENGE_BYTES {
            return Err(StoreError::InvalidRecord);
        }
        let mut message = Vec::with_capacity(CHALLENGE_DOMAIN.len() + encoded.len());
        message.extend_from_slice(CHALLENGE_DOMAIN);
        message.extend_from_slice(&encoded);
        let signature = self.signing_key.sign(&message);
        Ok(Base64UrlUnpadded::encode_string(&signature.to_bytes()))
    }
}

impl Drop for DeviceCredential {
    fn drop(&mut self) {
        self.factor_secret.zeroize();
    }
}

fn require_identity(wallet_id: &str, wallet_auth_method_id: &str) -> Result<(), StoreError> {
    if !valid_identity(wallet_id)
        || !valid_identity(wallet_auth_method_id)
        || !wallet_auth_method_id.starts_with("wallet-auth-method:")
    {
        return Err(StoreError::InvalidRecord);
    }
    Ok(())
}

fn valid_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAXIMUM_ID_BYTES
        && value.is_ascii()
        && value.bytes().all(is_graphic_ascii)
}

fn is_graphic_ascii(byte: u8) -> bool {
    byte.is_ascii_graphic()
}

fn random_failed<E>(_: E) -> StoreError {
    StoreError::Failed
}

fn invalid_record<E>(_: E) -> StoreError {
    StoreError::InvalidRecord
}
