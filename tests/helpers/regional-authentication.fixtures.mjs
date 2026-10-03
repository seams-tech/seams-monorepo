import { createHash, generateKeyPairSync, sign } from 'node:crypto';

export function buildPasskeyCredentialBindingFixture(
  method,
  nowMs,
  credentialIdB64u = method.credentialIdB64u,
) {
  if (method.kind !== 'passkey') throw new Error('Passkey auth method required');
  return {
    version: 'webauthn_credential_binding_v1',
    userId: method.walletId,
    rpId: method.rpId,
    credentialIdB64u,
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

export function buildWalletlessSyncChallengeFixture(challenge, rpId) {
  return {
    version: 'webauthn_sync_challenge_v1',
    challengeId: challenge.challengeId,
    rpId,
    challengeB64u: challenge.challengeB64u,
    createdAtMs: Date.now(),
    expiresAtMs: challenge.expiresAtMs,
  };
}

export class RegionalPasskeyAuthenticator {
  constructor(method) {
    this.method = method;
    this.keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    // COSE EC2 key: kty=2, alg=-7, crv=1, followed by the P-256 coordinates.
    this.publicKey = Buffer.concat([
      Buffer.from('a5010203262001215820', 'hex'),
      Buffer.from(jwk.x, 'base64url'),
      Buffer.from('225820', 'hex'),
      Buffer.from(jwk.y, 'base64url'),
    ]).toString('base64url');
  }

  activeMethod(api) {
    return api.buildWalletAuthMethodRecordV2({
      version: 'wallet_auth_method_v2',
      walletAuthMethodId: this.method.walletAuthMethodId,
      walletId: this.method.walletId,
      walletAuthorityId: this.method.walletAuthorityId,
      kind: 'passkey',
      status: 'active',
      rpId: this.method.rpId,
      credentialIdB64u: this.method.credentialIdB64u,
      credentialPublicKeyB64u: this.publicKey,
      counter: 0,
      createdAtMs: this.method.createdAtMs,
      updatedAtMs: this.method.updatedAtMs,
      activatedAtMs: this.method.activatedAtMs,
    });
  }

  record(nowMs) {
    return {
      credentialIdB64u: this.method.credentialIdB64u,
      credentialPublicKeyB64u: this.publicKey,
      counter: 0,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      deviceInfo: {
        label: 'Regional acceptance authenticator',
        browser: 'unknown',
        os: 'unknown',
        synced: false,
        transports: ['internal'],
      },
    };
  }

  assertion(challenge, origin = `https://${this.method.rpId}`) {
    const clientData = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: challenge.challengeB64u,
        origin,
        crossOrigin: false,
      }),
    );
    const authenticatorData = Buffer.concat([
      createHash('sha256').update(this.method.rpId).digest(),
      Buffer.from([5, 0, 0, 0, 0]),
    ]);
    const signature = sign(
      'sha256',
      Buffer.concat([authenticatorData, createHash('sha256').update(clientData).digest()]),
      this.keys.privateKey,
    );
    return {
      challengeId: challenge.challengeId,
      webauthn_authentication: {
        id: this.method.credentialIdB64u,
        rawId: this.method.credentialIdB64u,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData.toString('base64url'),
          authenticatorData: authenticatorData.toString('base64url'),
          signature: signature.toString('base64url'),
        },
      },
    };
  }
}

export function buildDiscoveryCredentialBindingFixture(method, nowMs) {
  return {
    version: 'webauthn_credential_binding_v1',
    userId: method.walletId,
    rpId: method.rpId,
    credentialIdB64u: method.credentialIdB64u,
    nearAccountId: 'regional-discovery.testnet',
    nearEd25519SigningKeyId: 'regional-discovery-key',
    signerSlot: 1,
    publicKey: 'ed25519:11111111111111111111111111111111',
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export class DiscoveryManifestFixture {
  async getEd25519KeyManifestBySlot() {
    return { custodyKeyManifestDigestB64u: Buffer.alloc(32, 33).toString('base64url') };
  }
}

export function buildRevokedPasskeyMethodFixture(api, method, nowMs) {
  return api.buildWalletAuthMethodRecordV2({
    version: 'wallet_auth_method_v2',
    walletAuthMethodId: method.walletAuthMethodId,
    walletId: method.walletId,
    walletAuthorityId: method.walletAuthorityId,
    kind: 'passkey',
    status: 'revoked',
    rpId: method.rpId,
    credentialIdB64u: method.credentialIdB64u,
    credentialPublicKeyB64u: method.credentialPublicKeyB64u,
    counter: method.counter,
    createdAtMs: method.createdAtMs,
    updatedAtMs: nowMs,
    activatedAtMs: method.activatedAtMs,
    revokedAtMs: nowMs,
  });
}
