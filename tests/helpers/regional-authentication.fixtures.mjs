export function buildPasskeyCredentialBindingFixture(method, nowMs) {
  if (method.kind !== 'passkey') throw new Error('Passkey auth method required');
  return {
    version: 'webauthn_credential_binding_v1',
    userId: method.walletId,
    rpId: method.rpId,
    credentialIdB64u: method.credentialIdB64u,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function buildGoogleEnrollmentFixture(api, walletId, providerSubject, email, orgId) {
  const nowMs = Date.now();
  const record = api.parseEmailOtpWalletEnrollmentRow({
    record_json: JSON.stringify({
      version: 'email_otp_wallet_enrollment_v1',
      walletId,
      providerUserId: providerSubject,
      orgId,
      verifiedEmail: email,
      enrollmentId: `enrollment:${walletId}`,
      enrollmentVersion: '1',
      enrollmentSealKeyVersion: '1',
      clientUnlockPublicKeyB64u: Buffer.alloc(33, 1).toString('base64url'),
      unlockKeyVersion: '1',
      serverSealedFactorCiphertextB64u: Buffer.alloc(48, 2).toString('base64url'),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    }),
    updated_at_ms: nowMs,
  });
  if (!record) throw new Error('Invalid Google enrollment fixture');
  return record;
}
