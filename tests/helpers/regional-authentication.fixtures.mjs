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
