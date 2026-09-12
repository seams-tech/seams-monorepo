import { expect, test } from '@playwright/test';
import { base64UrlEncode } from '../../packages/shared-ts/src/utils/encoders';
import {
  parseWebAuthnAuthenticationCredential,
  parseWebAuthnClientDataJsonBase64url,
  webAuthnCredentialIdB64uFromCredential,
} from '../../packages/wallet-server/src/router/auth/webAuthnCredentialCodecs';
import {
  parseNearPublicKey,
  parseWebAuthnLoginChallengeRecord,
  parseWebAuthnSyncChallengeRecord,
} from '../../packages/wallet-server/src/router/cloudflare/d1/webauthn/d1WebAuthnRecords';

const loginChallenge = {
  version: 'webauthn_login_challenge_v1',
  challengeId: 'challenge-login',
  userId: 'wallet:webauthn-records',
  rpId: 'example.test',
  challengeB64u: 'AQID',
  createdAtMs: 1_000,
  expiresAtMs: 2_000,
};

test('WebAuthn challenge decoders accept current JSON and reject class instances or extra fields', () => {
  class UnsupportedChallenge {
    constructor(value: typeof loginChallenge) {
      Object.assign(this, value);
    }
  }

  expect(parseWebAuthnLoginChallengeRecord(loginChallenge)).toEqual(loginChallenge);
  expect(parseWebAuthnLoginChallengeRecord(new UnsupportedChallenge(loginChallenge))).toBeNull();
  expect(parseWebAuthnLoginChallengeRecord({ ...loginChallenge, unexpected: true })).toBeNull();
});

test('WebAuthn sync and NEAR public-key decoders keep optional fields exact', () => {
  expect(
    parseWebAuthnSyncChallengeRecord({
      version: 'webauthn_sync_challenge_v1',
      challengeId: 'challenge-sync',
      rpId: 'example.test',
      challengeB64u: 'AQID',
      createdAtMs: 1_000,
      expiresAtMs: 2_000,
    }),
  ).toMatchObject({ version: 'webauthn_sync_challenge_v1' });
  expect(
    parseWebAuthnSyncChallengeRecord({
      version: 'webauthn_sync_challenge_v1',
      challengeId: 'challenge-sync',
      rpId: 'example.test',
      expectedUserId: 'wallet:webauthn-records',
      challengeB64u: 'AQID',
      createdAtMs: 1_000,
      expiresAtMs: 2_000,
    }),
  ).toMatchObject({ expectedUserId: 'wallet:webauthn-records' });
  expect(
    parseWebAuthnSyncChallengeRecord({
      version: 'webauthn_sync_challenge_v1',
      challengeId: 'challenge-sync',
      rpId: 'example.test',
      expectedUserId: undefined,
      challengeB64u: 'AQID',
      createdAtMs: 1_000,
      expiresAtMs: 2_000,
    }),
  ).toBeNull();
  expect(
    parseNearPublicKey({
      record_json: JSON.stringify({
        publicKey: 'ed25519:public',
        kind: 'threshold',
        signerSlot: 1,
        createdAtMs: 1_000,
        updatedAtMs: 2_000,
      }),
    }),
  ).toMatchObject({ kind: 'threshold', signerSlot: 1 });
});

test('WebAuthn credential codecs preserve the current credential and client-data shapes', () => {
  const clientDataJSONB64u = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: 'challenge-codec',
        origin: 'https://example.test',
      }),
    ),
  );
  const credential = {
    id: 'credential-codec',
    rawId: 'AQID',
    type: 'public-key',
    authenticatorAttachment: null,
    response: {
      clientDataJSON: clientDataJSONB64u,
      authenticatorData: 'BA',
      signature: 'BQ',
      userHandle: null,
    },
    clientExtensionResults: { appid: false },
  };

  expect(parseWebAuthnClientDataJsonBase64url(clientDataJSONB64u)).toEqual({
    type: 'webauthn.get',
    challenge: 'challenge-codec',
    origin: 'https://example.test',
  });
  expect(parseWebAuthnAuthenticationCredential(credential)).toEqual(credential);
  expect(webAuthnCredentialIdB64uFromCredential(credential)).toEqual({
    ok: true,
    credentialIdB64u: 'AQID',
  });
  expect(parseWebAuthnAuthenticationCredential({ ...credential, response: null })).toBeNull();
});
