use std::fs::{DirBuilder, File, OpenOptions, TryLockError};
use std::num::{NonZeroU32, NonZeroU64, NonZeroUsize};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::PathBuf;

use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::data::CFData;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::{CFString, CFStringRef};
use objc2::{
    class, msg_send,
    rc::Retained,
    runtime::{AnyObject, Bool},
};
use security_framework::random::SecRandom;
use security_framework_sys::base::{
    errSecDuplicateItem as ERR_DUPLICATE, errSecItemNotFound as ERR_NOT_FOUND,
};
use security_framework_sys::item::*;
use security_framework_sys::keychain_item::{
    SecItemAdd, SecItemCopyMatching, SecItemDelete, SecItemUpdate,
};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::device_credential::DeviceCredential;
use super::ecapa::SpeakerEmbedding;
use crate::adapters::{StoreError, TemplateStore};
use crate::domain::{DeviceId, EnrollmentId, EnrollmentRef, ModelId, UnavailableReason};
use crate::enrollment::{
    EnrollmentRecord, EnrollmentReplacement, EnrollmentState, FaceEnrollment, TemplateData,
    VoiceTemplate,
};
use crate::runtime::WorkContext;

#[link(name = "LocalAuthentication", kind = "framework")]
unsafe extern "C" {}

const VOICE_BYTES: usize = 192 * 4;
const RECORD_BYTES: usize = 4 + 16 + 16 + 8 + 32 + VOICE_BYTES;
type Query = Vec<(CFString, CFType)>;

// This public Security constant is absent from security-framework-sys 2.17.0.
#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    static kSecAttrGeneric: CFStringRef;
}

/// Single-owner ECAPA storage in the user's encrypted login Keychain.
/// Items do not synchronize to iCloud. This supplies no hardware-attestation claim.
/// One exclusive process lease serializes all application access to each namespace.
/// Keep this handle alive for the whole capture/approval lifecycle.
pub struct KeychainStore {
    service: String,
    device: DeviceId,
    _lease: File,
}

impl KeychainStore {
    /// Open one application namespace. Opening creates only a random device identifier.
    /// The host must serialize enrollment mutation with in-memory evidence invalidation.
    pub fn open(service: &str, work: &WorkContext<'_>) -> Result<Self, StoreError> {
        if !service.starts_with("com.seams.voiceid.") || service.len() > 128 || !service.is_ascii()
        {
            return Err(StoreError::InvalidRecord);
        }
        work.check().map_err(StoreError::Work)?;
        let service = service.to_ascii_lowercase();
        let lease = namespace_lease(&service)?;
        work.check().map_err(StoreError::Work)?;
        let query = base_query(&service, "device");
        let device = match read_data(query.clone())? {
            Some(bytes) => device_id(&bytes)?,
            None => {
                let mut bytes = [0; 16];
                SecRandom::default()
                    .copy_bytes(&mut bytes)
                    .map_err(storage_unavailable)?;
                work.check().map_err(StoreError::Work)?;
                let mut add = query.clone();
                add.push(pair(
                    unsafe { kSecValueData },
                    CFData::from_buffer(&bytes).into_CFType(),
                ));
                let status = unsafe {
                    SecItemAdd(dictionary(&add).as_concrete_TypeRef(), std::ptr::null_mut())
                };
                match status {
                    0 => DeviceId(bytes),
                    ERR_DUPLICATE => {
                        let bytes = read_data(query)?.ok_or(StoreError::Failed)?;
                        device_id(&bytes)?
                    }
                    _ => return Err(status_error(status, false)),
                }
            }
        };
        work.check().map_err(StoreError::Work)?;
        Ok(Self {
            service,
            device,
            _lease: lease,
        })
    }

    fn owner_query(&self) -> Query {
        base_query(&self.service, "owner")
    }

    fn expected_query(&self, expected: EnrollmentRef) -> Query {
        let mut query = self.owner_query();
        query.push(pair(
            unsafe { kSecAttrGeneric },
            CFData::from_buffer(&reference_bytes(self.device, expected)).into_CFType(),
        ));
        query
    }

    /// Create one independent key and factor for a Wallet activation.
    /// The wallet and method identity select a separate Keychain item.
    pub(crate) fn create_device_credential(
        &mut self,
        enrollment: EnrollmentRef,
        wallet_id: &str,
        wallet_auth_method_id: &str,
        work: &WorkContext<'_>,
    ) -> Result<DeviceCredential, StoreError> {
        work.check().map_err(StoreError::Work)?;
        let credential =
            DeviceCredential::generate(self.device, enrollment, wallet_id, wallet_auth_method_id)?;
        let bytes = credential.encode();
        let mut query = self.credential_query(wallet_id, wallet_auth_method_id);
        query.push(pair(
            unsafe { kSecValueData },
            CFData::from_buffer(&bytes).into_CFType(),
        ));
        work.check().map_err(StoreError::Work)?;
        let status = unsafe {
            SecItemAdd(
                dictionary(&query).as_concrete_TypeRef(),
                std::ptr::null_mut(),
            )
        };
        mutation_result(status)?;
        Ok(credential)
    }

    pub(crate) fn load_device_credential(
        &self,
        enrollment: EnrollmentRef,
        wallet_id: &str,
        wallet_auth_method_id: &str,
        work: &WorkContext<'_>,
    ) -> Result<Option<DeviceCredential>, StoreError> {
        work.check().map_err(StoreError::Work)?;
        let query = self.credential_query(wallet_id, wallet_auth_method_id);
        let result = read_data(query)?;
        work.check().map_err(StoreError::Work)?;
        match result {
            None => Ok(None),
            Some(bytes) => {
                let bytes = Zeroizing::new(bytes);
                DeviceCredential::decode(
                    &bytes,
                    self.device,
                    enrollment,
                    wallet_id,
                    wallet_auth_method_id,
                )
                .map(Some)
            }
        }
    }

    fn credential_query(&self, wallet_id: &str, wallet_auth_method_id: &str) -> Query {
        let mut digest = Sha256::new();
        digest.update(wallet_id.as_bytes());
        digest.update([0]);
        digest.update(wallet_auth_method_id.as_bytes());
        let account = format!("wallet-device:{:x}", digest.finalize());
        base_query(&self.service, &account)
    }

    /// Remove an empty namespace's device identifier after a disposable local journey.
    /// The caller must stop all users of this namespace before destroying it.
    pub fn destroy_empty(self, work: &WorkContext<'_>) -> Result<(), StoreError> {
        work.check().map_err(StoreError::Work)?;
        if read_data(self.owner_query())?.is_some() {
            return Err(StoreError::Conflict);
        }
        work.check().map_err(StoreError::Work)?;
        let query = base_query(&self.service, "device");
        let status = unsafe { SecItemDelete(dictionary(&query).as_concrete_TypeRef()) };
        match status {
            0 | ERR_NOT_FOUND => Ok(()),
            _ => Err(status_error(status, true)),
        }
    }
}

impl TemplateStore for KeychainStore {
    fn device(&self) -> DeviceId {
        self.device
    }

    fn load(&mut self, work: &WorkContext<'_>) -> Result<EnrollmentState, StoreError> {
        work.check().map_err(StoreError::Work)?;
        let result = match read_data(self.owner_query())? {
            None => EnrollmentState::Empty,
            Some(mut bytes) => {
                let record = decode_record(&bytes, self.device);
                bytes.fill(0);
                EnrollmentState::Enrolled(record?)
            }
        };
        work.check().map_err(StoreError::Work)?;
        Ok(result)
    }

    fn create(
        &mut self,
        record: &EnrollmentRecord,
        work: &WorkContext<'_>,
    ) -> Result<(), StoreError> {
        let mut bytes = encode_record(record, self.device)?;
        let mut query = self.owner_query();
        query.push(pair(
            unsafe { kSecValueData },
            CFData::from_buffer(&bytes).into_CFType(),
        ));
        bytes.fill(0);
        query.push(pair(
            unsafe { kSecAttrGeneric },
            CFData::from_buffer(&reference_bytes(self.device, record.identity)).into_CFType(),
        ));
        work.check().map_err(StoreError::Work)?;
        let status = unsafe {
            SecItemAdd(
                dictionary(&query).as_concrete_TypeRef(),
                std::ptr::null_mut(),
            )
        };
        mutation_result(status)
    }

    fn replace(
        &mut self,
        replacement: EnrollmentReplacement<'_>,
        work: &WorkContext<'_>,
    ) -> Result<(), StoreError> {
        let record = replacement.replacement();
        let mut bytes = encode_record(record, self.device)?;
        let attributes = vec![
            pair(
                unsafe { kSecValueData },
                CFData::from_buffer(&bytes).into_CFType(),
            ),
            pair(
                unsafe { kSecAttrGeneric },
                CFData::from_buffer(&reference_bytes(self.device, record.identity)).into_CFType(),
            ),
        ];
        bytes.fill(0);
        let query = self.expected_query(replacement.expected());
        work.check().map_err(StoreError::Work)?;
        let status = unsafe {
            SecItemUpdate(
                dictionary(&query).as_concrete_TypeRef(),
                dictionary(&attributes).as_concrete_TypeRef(),
            )
        };
        mutation_result(status)
    }

    fn delete(
        &mut self,
        expected: EnrollmentRef,
        work: &WorkContext<'_>,
    ) -> Result<(), StoreError> {
        let query = self.expected_query(expected);
        work.check().map_err(StoreError::Work)?;
        let status = unsafe { SecItemDelete(dictionary(&query).as_concrete_TypeRef()) };
        mutation_result(status)
    }
}

fn encode_record(record: &EnrollmentRecord, device: DeviceId) -> Result<Vec<u8>, StoreError> {
    if record.device != device || !matches!(record.face, FaceEnrollment::Disabled) {
        return Err(StoreError::InvalidRecord);
    }
    SpeakerEmbedding::from_template(&record.voice, record.voice.0.model())
        .map_err(invalid_record)?;
    let mut bytes = Vec::with_capacity(RECORD_BYTES);
    bytes.extend_from_slice(b"VID1");
    bytes.extend_from_slice(&reference_bytes(device, record.identity));
    bytes.extend_from_slice(&record.voice.0.model().0);
    bytes.extend_from_slice(record.voice.0.bytes());
    Ok(bytes)
}

fn decode_record(bytes: &[u8], device: DeviceId) -> Result<EnrollmentRecord, StoreError> {
    // Fixed wire order: VID1 | device16 | enrollment16 | versionLE8 | model32 | voice768.
    if bytes.len() != RECORD_BYTES || &bytes[..4] != b"VID1" || bytes[4..20] != device.0 {
        return Err(StoreError::InvalidRecord);
    }
    let id = EnrollmentId(bytes[20..36].try_into().map_err(invalid_record)?);
    let version = u64::from_le_bytes(bytes[36..44].try_into().map_err(invalid_record)?);
    let version = NonZeroU64::new(version).ok_or(StoreError::InvalidRecord)?;
    let model = ModelId(bytes[44..76].try_into().map_err(invalid_record)?);
    let voice = VoiceTemplate(
        TemplateData::new(
            model,
            NonZeroU32::MIN,
            bytes[76..].to_vec(),
            NonZeroUsize::new(VOICE_BYTES).unwrap(),
        )
        .map_err(invalid_record)?,
    );
    let voice = SpeakerEmbedding::from_template(&voice, model)
        .map_err(invalid_record)?
        .into_voice_template()
        .map_err(invalid_record)?;
    Ok(EnrollmentRecord {
        identity: EnrollmentRef { id, version },
        device,
        voice,
        face: FaceEnrollment::Disabled,
    })
}

fn reference_bytes(device: DeviceId, reference: EnrollmentRef) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(40);
    bytes.extend_from_slice(&device.0);
    bytes.extend_from_slice(&reference.id.0);
    bytes.extend_from_slice(&reference.version.get().to_le_bytes());
    bytes
}

fn device_id(bytes: &[u8]) -> Result<DeviceId, StoreError> {
    Ok(DeviceId(bytes.try_into().map_err(invalid_record)?))
}

fn base_query(service: &str, account: &str) -> Query {
    // A capture request must never open an OS authentication dialog. Existing
    // Keychain authorization remains required; unavailable access fails closed.
    let context: Retained<AnyObject> = unsafe { msg_send![class!(LAContext), new] };
    unsafe {
        let _: () = msg_send![&*context, setInteractionNotAllowed: Bool::YES];
    }
    let context = unsafe { CFType::wrap_under_get_rule(Retained::as_ptr(&context).cast()) };
    vec![
        pair(unsafe { kSecUseAuthenticationContext }, context),
        pair(
            unsafe { kSecClass },
            unsafe { CFString::wrap_under_get_rule(kSecClassGenericPassword) }.into_CFType(),
        ),
        pair(
            unsafe { kSecAttrService },
            CFString::new(service).into_CFType(),
        ),
        pair(
            unsafe { kSecAttrAccount },
            CFString::new(account).into_CFType(),
        ),
        pair(
            unsafe { kSecAttrSynchronizable },
            CFBoolean::false_value().into_CFType(),
        ),
    ]
}

fn pair(key: CFStringRef, value: CFType) -> (CFString, CFType) {
    // Only static Security framework keys enter this private helper.
    (unsafe { CFString::wrap_under_get_rule(key) }, value)
}

fn dictionary(pairs: &Query) -> CFDictionary<CFString, CFType> {
    CFDictionary::from_CFType_pairs(pairs)
}

fn read_data(mut query: Query) -> Result<Option<Vec<u8>>, StoreError> {
    query.push(pair(
        unsafe { kSecReturnData },
        CFBoolean::true_value().into_CFType(),
    ));
    let mut result = std::ptr::null();
    let status =
        unsafe { SecItemCopyMatching(dictionary(&query).as_concrete_TypeRef(), &mut result) };
    if status == ERR_NOT_FOUND {
        return Ok(None);
    }
    if status != 0 {
        return Err(status_error(status, false));
    }
    if result.is_null() {
        return Err(StoreError::InvalidRecord);
    }
    // CopyMatching returns one owned CF object. Its type and size are checked before copying.
    let value = unsafe { CFType::wrap_under_create_rule(result) };
    let data = value
        .downcast::<CFData>()
        .ok_or(StoreError::InvalidRecord)?;
    if data.len() > RECORD_BYTES as isize {
        return Err(StoreError::InvalidRecord);
    }
    Ok(Some(data.bytes().to_vec()))
}

fn mutation_result(status: i32) -> Result<(), StoreError> {
    match status {
        0 => Ok(()),
        ERR_DUPLICATE | ERR_NOT_FOUND => Err(StoreError::Conflict),
        _ => Err(status_error(status, true)),
    }
}

fn status_error(status: i32, mutation: bool) -> StoreError {
    match status {
        -25291 | -25293 | -25308 | -128 => {
            StoreError::Unavailable(UnavailableReason::PermissionDenied)
        }
        _ if mutation => StoreError::CommitUncertain,
        _ => StoreError::Failed,
    }
}
fn invalid_record<E>(_: E) -> StoreError {
    StoreError::InvalidRecord
}
fn storage_unavailable<E>(_: E) -> StoreError {
    StoreError::Unavailable(UnavailableReason::Missing)
}

fn namespace_lease(service: &str) -> Result<File, StoreError> {
    let user_directory =
        std::env::var_os("HOME").ok_or(StoreError::Unavailable(UnavailableReason::Missing))?;
    let directory =
        PathBuf::from(user_directory).join("Library/Application Support/Seams/VoiceID/locks");
    if !directory.is_absolute() {
        return Err(StoreError::Unavailable(UnavailableReason::Missing));
    }
    DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&directory)
        .map_err(storage_unavailable)?;
    let name = format!("{:x}.lock", Sha256::digest(service.as_bytes()));
    let lease = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(directory.join(name))
        .map_err(storage_unavailable)?;
    match lease.try_lock() {
        Ok(()) => Ok(lease),
        Err(TryLockError::WouldBlock) => Err(StoreError::Conflict),
        Err(TryLockError::Error(_)) => Err(StoreError::Unavailable(UnavailableReason::Missing)),
    }
    // Lock files remain present. Removing a locked inode would permit a second owner.
}
