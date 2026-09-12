import { expect, test } from '@playwright/test';
import {
  createWalletAddAuthMethodIntent,
  createWalletAddSignerIntent,
  fetchWalletEcdsaKeyFactsInventoryWithOperationCredential,
  fetchWalletEcdsaKeyFactsInventoryWithWebAuthn,
  finalizeWalletAddAuthMethod,
  revokeWalletAuthMethod,
  respondWalletRegistration,
  activateWalletRegistration,
  requestAddAuthMethodEmailOtpChallenge,
  setupWalletRegistration,
} from '../../packages/wallet/src/core/rpcClients/relayer/walletRegistration';
import {
  buildEmailOtpWalletAuthAuthority,
  buildPasskeyWalletAuthAuthority,
} from '../../packages/shared-ts/src/utils/walletAuthAuthority';
import {
  addAuthMethodIntentGrantFromString,
  computeRegistrationIntentDigestB64u,
  walletIdFromString,
  type RegistrationIntentV1,
} from '../../packages/shared-ts/src/utils/registrationIntent';
import { parseWebAuthnRpId } from '../../packages/shared-ts/src/utils/domainIds';
import { parseWalletSessionId } from '../../packages/shared-ts/src/authorization/capabilityKinds';
import { unknownWebAuthnAuthenticatorDeviceInfo } from '../../packages/shared-ts/src/utils/webauthnDeviceInfo';

/**
 * Refactor 94C. Strict boundary parsers for routes 2 and 3.
 *
 * The discriminated signer plan is the mechanism that keeps a mixed-plan
 * wallet from silently registering as ECDSA-only when its deferred NEAR work
 * never arrives. These pin that the parser enforces it rather than narrowing.
 */

const RELAYER = 'https://relay.example';

function withStubbedFetch<T>(
  body: unknown,
  run: () => Promise<T>,
  observeRequest?: (init: RequestInit | undefined) => void,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    observeRequest?.(init);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

const ADD_SIGNER_INTENT_WALLET_ID = walletIdFromString('wallet-add-signer-intent');
const ADD_SIGNER_INTENT = {
  version: 'add_signer_intent_v1' as const,
  walletId: ADD_SIGNER_INTENT_WALLET_ID,
  signerSelection: {
    mode: 'ed25519' as const,
    ed25519: {
      mode: 'create_implicit_near_account' as const,
      signerSlot: 2,
      participantIds: [1, 2],
      keyPurpose: 'signing',
      keyVersion: 'router-ab-ed25519-yao-v1',
      derivationVersion: 1,
    },
  },
  nonceB64u: 'add-signer-intent-parser-nonce',
};

function createAddSignerIntentRequest() {
  return {
    relayerUrl: RELAYER,
    walletId: ADD_SIGNER_INTENT_WALLET_ID,
    request: {
      walletId: ADD_SIGNER_INTENT_WALLET_ID,
      signerSelection: ADD_SIGNER_INTENT.signerSelection,
    },
    auth: { publishableKey: 'publishable-key', environmentId: 'environment-id' },
  };
}

test('add-signer intent parses the exact response boundary', async () => {
  const result = await withStubbedFetch(
    {
      ok: true,
      intent: ADD_SIGNER_INTENT,
      addSignerIntentDigestB64u: 'A'.repeat(43),
      addSignerIntentGrant: ' add-signer-intent-grant ',
      expiresAtMs: 123,
    },
    () => createWalletAddSignerIntent(createAddSignerIntentRequest()),
  );

  expect(result).toEqual({
    ok: true,
    intent: ADD_SIGNER_INTENT,
    addSignerIntentDigestB64u: 'A'.repeat(43),
    addSignerIntentGrant: 'add-signer-intent-grant',
    expiresAtMs: 123,
  });
});

test('add-signer intent rejects a malformed digest from the relayer', async () => {
  await expect(
    withStubbedFetch(
      {
        ok: true,
        intent: ADD_SIGNER_INTENT,
        addSignerIntentDigestB64u: 'malformed-digest',
        addSignerIntentGrant: 'add-signer-intent-grant',
        expiresAtMs: 123,
      },
      () => createWalletAddSignerIntent(createAddSignerIntentRequest()),
    ),
  ).rejects.toThrow('invalid addSignerIntentDigestB64u');
});

const ADD_AUTH_METHOD_INTENT_WALLET_ID = walletIdFromString('wallet-add-auth-intent');
const ADD_AUTH_METHOD_INTENT = {
  version: 'add_auth_method_intent_v1' as const,
  walletId: ADD_AUTH_METHOD_INTENT_WALLET_ID,
  authMethod: { kind: 'passkey' as const, rpId: 'wallet.example.test' },
  targetWalletAuthMethodId: 'wallet-auth-method:target',
  caller: 'linked_device_ceremony' as const,
  nonceB64u: 'add-auth-intent-parser-nonce',
};

function createAddAuthMethodIntentRequest() {
  return {
    relayerUrl: RELAYER,
    walletId: ADD_AUTH_METHOD_INTENT_WALLET_ID,
    request: {
      walletId: ADD_AUTH_METHOD_INTENT_WALLET_ID,
      rpId: 'wallet.example.test',
      authMethod: { kind: 'passkey' as const, rpId: 'wallet.example.test' },
      caller: { caller: 'linked_device_ceremony' as const },
    },
    auth: { publishableKey: 'publishable-key', environmentId: 'environment-id' },
  };
}

test('add-auth-method intent parses the exact response boundary', async () => {
  const result = await withStubbedFetch(
    {
      ok: true,
      intent: ADD_AUTH_METHOD_INTENT,
      addAuthMethodIntentDigestB64u: 'A'.repeat(43),
      addAuthMethodIntentGrant: ' add-auth-method-intent-grant ',
      expiresAtMs: 456,
    },
    () => createWalletAddAuthMethodIntent(createAddAuthMethodIntentRequest()),
  );

  expect(result).toEqual({
    ok: true,
    intent: ADD_AUTH_METHOD_INTENT,
    addAuthMethodIntentDigestB64u: 'A'.repeat(43),
    addAuthMethodIntentGrant: 'add-auth-method-intent-grant',
    expiresAtMs: 456,
  });
});

test('add-auth-method intent rejects a malformed digest from the relayer', async () => {
  await expect(
    withStubbedFetch(
      {
        ok: true,
        intent: ADD_AUTH_METHOD_INTENT,
        addAuthMethodIntentDigestB64u: 'malformed-digest',
        addAuthMethodIntentGrant: 'add-auth-method-intent-grant',
        expiresAtMs: 456,
      },
      () => createWalletAddAuthMethodIntent(createAddAuthMethodIntentRequest()),
    ),
  ).rejects.toThrow('invalid addAuthMethodIntentDigestB64u');
});

const REVOKE_WALLET_ID = walletIdFromString('wallet-revoke-auth-method');

function createRevokeWalletAuthMethodRequest() {
  return {
    relayerUrl: RELAYER,
    walletId: REVOKE_WALLET_ID,
    walletAuthMethodId: 'wallet-auth-method:target',
    requestedAtMs: 789,
    sourceProof: {
      kind: 'email_otp' as const,
      challengeId: 'email-otp-challenge:revoke',
      otpCode: '123456',
      ownerProofBindingDigest: 'owner-proof-digest:revoke',
    },
  };
}

test('auth-method revoke parses a revoked passkey response with its rpId', async () => {
  const result = await withStubbedFetch(
    {
      ok: true,
      walletId: REVOKE_WALLET_ID,
      authMethod: { kind: 'passkey', status: 'revoked' },
      rpId: 'wallet.example.test',
    },
    () => revokeWalletAuthMethod(createRevokeWalletAuthMethodRequest()),
  );

  expect(result).toEqual({
    ok: true,
    walletId: REVOKE_WALLET_ID,
    authMethod: { kind: 'passkey', status: 'revoked' },
    rpId: 'wallet.example.test',
  });
});

test('auth-method revoke parses a revoked Email OTP response without an rpId', async () => {
  const result = await withStubbedFetch(
    {
      ok: true,
      walletId: REVOKE_WALLET_ID,
      authMethod: { kind: 'email_otp', status: 'revoked' },
    },
    () => revokeWalletAuthMethod(createRevokeWalletAuthMethodRequest()),
  );

  expect(result).toEqual({
    ok: true,
    walletId: REVOKE_WALLET_ID,
    authMethod: { kind: 'email_otp', status: 'revoked' },
  });
});

test('auth-method revoke rejects an Email OTP response carrying a passkey rpId', async () => {
  await expect(
    withStubbedFetch(
      {
        ok: true,
        walletId: REVOKE_WALLET_ID,
        authMethod: { kind: 'email_otp', status: 'revoked' },
        rpId: 'wallet.example.test',
      },
      () => revokeWalletAuthMethod(createRevokeWalletAuthMethodRequest()),
    ),
  ).rejects.toThrow(/contains unexpected rpId/);
});

const EMAIL_OTP_CHALLENGE_REQUEST = {
  relayerUrl: RELAYER,
  walletId: walletIdFromString('wallet-email-otp-challenge'),
  addAuthMethodIntentGrant: addAuthMethodIntentGrantFromString('email-otp-intent-grant'),
  addAuthMethodIntentDigestB64u: 'A'.repeat(43),
};

test('Email OTP challenge parses a successful response with an empty email hint', async () => {
  const result = await withStubbedFetch(
    {
      ok: true,
      challengeId: 'email-otp-challenge:1',
      expiresAtMs: 123,
      emailHint: '',
    },
    () => requestAddAuthMethodEmailOtpChallenge(EMAIL_OTP_CHALLENGE_REQUEST),
  );

  expect(result).toEqual({
    challengeId: 'email-otp-challenge:1',
    expiresAtMs: 123,
    emailHint: '',
  });
});

test('Email OTP challenge rejects malformed responses', async () => {
  await expect(
    withStubbedFetch(
      {
        ok: true,
        challengeId: 'email-otp-challenge:1',
        expiresAtMs: 123,
        emailHint: 'o***@example.test',
        extra: true,
      },
      () => requestAddAuthMethodEmailOtpChallenge(EMAIL_OTP_CHALLENGE_REQUEST),
    ),
  ).rejects.toThrow(/contains unexpected extra/);

  await expect(
    withStubbedFetch(
      {
        ok: 'true',
        challengeId: 'email-otp-challenge:1',
        expiresAtMs: 123,
        emailHint: 'o***@example.test',
      },
      () => requestAddAuthMethodEmailOtpChallenge(EMAIL_OTP_CHALLENGE_REQUEST),
    ),
  ).rejects.toThrow(/is not successful/);

  await expect(
    withStubbedFetch(
      {
        ok: true,
        challengeId: 'email-otp-challenge:1',
        expiresAtMs: 0,
        emailHint: 'o***@example.test',
      },
      () => requestAddAuthMethodEmailOtpChallenge(EMAIL_OTP_CHALLENGE_REQUEST),
    ),
  ).rejects.toThrow(/invalid expiresAtMs/);

  await expect(
    withStubbedFetch(
      {
        ok: true,
        challengeId: 'email-otp-challenge:1',
        expiresAtMs: 123,
        emailHint: 42,
      },
      () => requestAddAuthMethodEmailOtpChallenge(EMAIL_OTP_CHALLENGE_REQUEST),
    ),
  ).rejects.toThrow(/invalid emailHint/);

  await expect(
    withStubbedFetch(
      {
        ok: true,
        challengeId: '   ',
        expiresAtMs: 123,
        emailHint: 'o***@example.test',
      },
      () => requestAddAuthMethodEmailOtpChallenge(EMAIL_OTP_CHALLENGE_REQUEST),
    ),
  ).rejects.toThrow(/missing challengeId/);
});

const FINALIZE_WALLET_ID = walletIdFromString('wallet-add-auth-method-finalize');
const FINALIZE_RP_ID_RESULT = parseWebAuthnRpId('wallet.example.test');
if (!FINALIZE_RP_ID_RESULT.ok) throw new Error(FINALIZE_RP_ID_RESULT.error.message);
const FINALIZE_RP_ID = FINALIZE_RP_ID_RESULT.value;
const FINALIZE_PASSKEY_CREDENTIAL_ID = 'credential-add-auth-method-finalize';
const FINALIZE_PASSKEY_AUTHORITY = buildPasskeyWalletAuthAuthority({
  walletId: FINALIZE_WALLET_ID,
  rpId: FINALIZE_RP_ID,
  credentialIdB64u: FINALIZE_PASSKEY_CREDENTIAL_ID,
});
const FINALIZE_EMAIL_AUTHORITY = buildEmailOtpWalletAuthAuthority({
  walletId: FINALIZE_WALLET_ID,
  provider: 'email',
  providerUserId: 'owner@example.test',
  emailHashHex: 'email-hash-add-auth-method-finalize',
});
const FINALIZE_REQUEST = {
  relayerUrl: RELAYER,
  walletId: FINALIZE_WALLET_ID,
  addAuthMethodCeremonyId: 'add-auth-method-ceremony-finalize',
};

test('add-auth-method finalize parses passkey and Email OTP success branches', async () => {
  const passkeyResponse = {
    ok: true,
    walletId: FINALIZE_WALLET_ID,
    authority: FINALIZE_PASSKEY_AUTHORITY,
    rpId: FINALIZE_RP_ID,
    authMethod: {
      kind: 'passkey' as const,
      status: 'active' as const,
      credentialIdB64u: FINALIZE_PASSKEY_CREDENTIAL_ID,
      credentialPublicKeyB64u: 'public-key-add-auth-method-finalize',
      counter: 0,
      device: unknownWebAuthnAuthenticatorDeviceInfo(),
    },
  };
  expect(
    await withStubbedFetch(passkeyResponse, () => finalizeWalletAddAuthMethod(FINALIZE_REQUEST)),
  ).toEqual(passkeyResponse);

  const emailOtpResponse = {
    ok: true,
    walletId: FINALIZE_WALLET_ID,
    authority: FINALIZE_EMAIL_AUTHORITY,
    authMethod: { kind: 'email_otp' as const, status: 'active' as const },
  };
  expect(
    await withStubbedFetch(emailOtpResponse, () => finalizeWalletAddAuthMethod(FINALIZE_REQUEST)),
  ).toEqual(emailOtpResponse);
});

test('add-auth-method finalize rejects Email OTP responses with passkey-only fields', async () => {
  await expect(
    withStubbedFetch(
      {
        ok: true,
        walletId: FINALIZE_WALLET_ID,
        authority: FINALIZE_EMAIL_AUTHORITY,
        rpId: FINALIZE_RP_ID,
        authMethod: { kind: 'email_otp', status: 'active' },
      },
      () => finalizeWalletAddAuthMethod(FINALIZE_REQUEST),
    ),
  ).rejects.toThrow(/contains unexpected rpId/);

  await expect(
    withStubbedFetch(
      {
        ok: true,
        walletId: FINALIZE_WALLET_ID,
        authority: FINALIZE_EMAIL_AUTHORITY,
        authMethod: {
          kind: 'email_otp',
          status: 'active',
          credentialIdB64u: FINALIZE_PASSKEY_CREDENTIAL_ID,
        },
      },
      () => finalizeWalletAddAuthMethod(FINALIZE_REQUEST),
    ),
  ).rejects.toThrow(/contains unexpected credentialIdB64u/);
});

const ECDSA_INVENTORY_WALLET_ID = walletIdFromString('wallet-ecdsa-key-facts-inventory');
const ECDSA_INVENTORY_SESSION_ID_RESULT = parseWalletSessionId(
  'wallet-session:ecdsa-key-facts-inventory',
);
if (!ECDSA_INVENTORY_SESSION_ID_RESULT.ok) {
  throw new Error(ECDSA_INVENTORY_SESSION_ID_RESULT.error.message);
}
const ECDSA_INVENTORY_OPERATION_CREDENTIAL = {
  kind: 'opaque_hosted_wallet_session_operation_credential_v1' as const,
  token: 'hosted-wallet-session-operation-token',
  walletSessionId: ECDSA_INVENTORY_SESSION_ID_RESULT.value,
};
const ECDSA_INVENTORY_WEBAUTHN_CREDENTIAL = {
  id: 'credential-ecdsa-key-facts-inventory',
  rawId: 'credential-ecdsa-key-facts-inventory',
  type: 'public-key',
  authenticatorAttachment: 'platform',
  response: {
    clientDataJSON: 'client-data',
    authenticatorData: 'authenticator-data',
    signature: 'signature',
    userHandle: undefined,
  },
  clientExtensionResults: {
    prf: {
      results: {
        first: 'first-prf',
        second: undefined,
      },
    },
  },
};
const ECDSA_INVENTORY_OPERATION_REQUEST = {
  relayerUrl: RELAYER,
  walletId: ECDSA_INVENTORY_WALLET_ID,
  rpId: 'wallet.example.test',
  operationCredential: ECDSA_INVENTORY_OPERATION_CREDENTIAL,
  keyTargets: [],
};
const ECDSA_INVENTORY_WEBAUTHN_REQUEST = {
  relayerUrl: RELAYER,
  walletId: ECDSA_INVENTORY_WALLET_ID,
  rpId: 'wallet.example.test',
  credential: ECDSA_INVENTORY_WEBAUTHN_CREDENTIAL,
  keyTargets: [],
  serverNonceB64u: 'server-nonce',
  expectedChallengeDigestB64u: 'expected-challenge-digest',
};

test('ECDSA key-facts inventory parses the exact envelope for both credentials', async () => {
  const response = {
    ok: true,
    ecdsaKeyIdentityTargets: [],
    diagnostics: { traceId: 'inventory-diagnostic', nested: { opaque: true } },
  };
  const expected = { ok: true, records: [], diagnostics: response.diagnostics };

  expect(
    await withStubbedFetch(response, () =>
      fetchWalletEcdsaKeyFactsInventoryWithOperationCredential(ECDSA_INVENTORY_OPERATION_REQUEST),
    ),
  ).toEqual(expected);
  expect(
    await withStubbedFetch(response, () =>
      fetchWalletEcdsaKeyFactsInventoryWithWebAuthn(ECDSA_INVENTORY_WEBAUTHN_REQUEST),
    ),
  ).toEqual(expected);
});

test('ECDSA key-facts inventory rejects a missing or non-array target list', async () => {
  await expect(
    withStubbedFetch({ ok: true, diagnostics: { traceId: 'missing-targets' } }, () =>
      fetchWalletEcdsaKeyFactsInventoryWithOperationCredential(ECDSA_INVENTORY_OPERATION_REQUEST),
    ),
  ).rejects.toThrow(/missing ecdsaKeyIdentityTargets/);

  await expect(
    withStubbedFetch(
      { ok: true, ecdsaKeyIdentityTargets: {}, diagnostics: { traceId: 'invalid-targets' } },
      () => fetchWalletEcdsaKeyFactsInventoryWithWebAuthn(ECDSA_INVENTORY_WEBAUTHN_REQUEST),
    ),
  ).rejects.toThrow(/ecdsaKeyIdentityTargets must be an array/);
});

const SETUP_WALLET_ID = walletIdFromString('wallet-registration-setup');
const SETUP_RP_ID_RESULT = parseWebAuthnRpId('wallet.example.test');
if (!SETUP_RP_ID_RESULT.ok) throw new Error(SETUP_RP_ID_RESULT.error.message);
const SETUP_RP_ID = SETUP_RP_ID_RESULT.value;
const SETUP_INTENT = {
  version: 'registration_intent_v1' as const,
  walletId: SETUP_WALLET_ID,
  authMethod: { kind: 'passkey' as const, rpId: SETUP_RP_ID },
  signerSelection: {
    kind: 'signer_set' as const,
    signers: [
      {
        kind: 'near_ed25519' as const,
        accountProvisioning: {
          kind: 'implicit_account' as const,
          accountIdSource: 'ed25519_public_key' as const,
        },
        signerSlot: 1,
        participantIds: [1, 2],
        derivationVersion: 1,
      },
    ],
  },
  foundingWalletAuthMethodId: 'wallet-auth-method:registration-setup',
  nonceB64u: 'registration-setup-nonce',
};

const SETUP_RESPONSE = {
  ok: true as const,
  registrationCeremonyId: 'wrc_registration_setup',
  walletId: SETUP_WALLET_ID,
  walletAuthMethodId: 'wallet-auth-method:registration-setup',
  registrationIntentDigestB64u: 'A'.repeat(43),
  intent: SETUP_INTENT,
  signedSetup: 'signed-registration-setup',
  kind: 'near_ed25519' as const,
};

const SETUP_REQUEST = {
  relayerUrl: RELAYER,
  request: {
    authMethod: SETUP_INTENT.authMethod,
    signerSelection: SETUP_INTENT.signerSelection,
  },
  auth: { publishableKey: 'publishable-key', environmentId: 'environment-id' },
};

const SETUP_ECDSA_WALLET_ID = walletIdFromString('wallet-registration-ecdsa');
const SETUP_ECDSA_AUTH_METHOD_ID = 'wallet-auth-method:registration-ecdsa';
const SETUP_ECDSA_TARGET = {
  kind: 'evm' as const,
  namespace: 'eip155' as const,
  chainId: 8453,
};
const SETUP_ECDSA_SCOPE = {
  orgId: 'org-registration',
  projectId: 'project-registration',
  envId: 'env-registration',
  signingRootVersion: 'root-share-epoch-1',
};
const SETUP_ECDSA_INTENT: RegistrationIntentV1 = {
  version: 'registration_intent_v1',
  walletId: SETUP_ECDSA_WALLET_ID,
  authMethod: { kind: 'passkey', rpId: SETUP_RP_ID },
  signerSelection: {
    kind: 'signer_set',
    signers: [
      {
        kind: 'evm_family_ecdsa',
        participantIds: [1, 2],
        chainTargets: [SETUP_ECDSA_TARGET],
      },
    ],
  },
  foundingWalletAuthMethodId: SETUP_ECDSA_AUTH_METHOD_ID,
  runtimePolicyScope: SETUP_ECDSA_SCOPE,
  nonceB64u: 'registration-ecdsa-nonce',
};

function setupEcdsaStrictRegistration(lifecycleId: string, walletId: string) {
  return {
    registration_purpose: 'wallet_registration' as const,
    context: { application_binding_digest_b64u: 'A'.repeat(43) },
    lifecycle: {
      lifecycle_id: lifecycleId,
      work_kind: 'registration_prepare' as const,
      primitive_request_kind: 'registration' as const,
      root_share_epoch: 'root-share-epoch-1',
      account_id: walletId,
      session_id: 'threshold-session-registration',
      signer_set_id: 'signer-set-registration',
      selected_server_id: 'signing-worker-registration',
    },
    signer_set: {
      signer_set_id: 'signer-set-registration',
      policy: 'all_2' as const,
      signer_a: {
        role: 'signer_a' as const,
        signer_id: 'signer-a-registration',
        key_epoch: 'epoch-registration',
      },
      signer_b: {
        role: 'signer_b' as const,
        signer_id: 'signer-b-registration',
        key_epoch: 'epoch-registration',
      },
      selected_server: {
        server_id: 'signing-worker-registration',
        key_epoch: 'epoch-registration',
        recipient_encryption_key: `x25519:${'1'.repeat(64)}`,
      },
    },
    router_id: 'router-registration',
    client_id: walletId,
    replay_nonce: 'registration-replay-nonce',
    expires_at_ms: 1_900_000_000_000,
    deriver_recipient_keys: {
      deriver_a: {
        role: 'signer_a' as const,
        key_epoch: 'epoch-registration',
        public_key: `x25519:${'2'.repeat(64)}`,
      },
      deriver_b: {
        role: 'signer_b' as const,
        key_epoch: 'epoch-registration',
        public_key: `x25519:${'3'.repeat(64)}`,
      },
    },
  };
}

function setupEcdsaResponse(kind: 'evm_family_ecdsa' | 'near_ed25519_and_evm_family_ecdsa') {
  const intent: RegistrationIntentV1 =
    kind === 'evm_family_ecdsa'
      ? SETUP_ECDSA_INTENT
      : {
          ...SETUP_ECDSA_INTENT,
          signerSelection: {
            kind: 'signer_set',
            signers: [
              {
                kind: 'near_ed25519',
                accountProvisioning: {
                  kind: 'implicit_account',
                  accountIdSource: 'ed25519_public_key',
                },
                signerSlot: 1,
                participantIds: [1, 2],
                derivationVersion: 1,
              },
              ...SETUP_ECDSA_INTENT.signerSelection.signers,
            ],
          },
        };
  const registrationCeremonyId =
    kind === 'evm_family_ecdsa' ? 'wrc_registration_ecdsa' : 'wrc_registration_mixed';
  return {
    ok: true as const,
    registrationCeremonyId,
    walletId: SETUP_ECDSA_WALLET_ID,
    walletAuthMethodId: SETUP_ECDSA_AUTH_METHOD_ID,
    registrationIntentDigestB64u: '',
    intent,
    signedSetup: `signed-${kind}`,
    kind,
    ecdsa: {
      kind: 'evm_family_ecdsa_keygen' as const,
      chainTargets: [SETUP_ECDSA_TARGET],
      prepare: {
        formatVersion: 'ecdsa-derivation-role-local' as const,
        walletId: String(SETUP_ECDSA_WALLET_ID),
        evmFamilySigningKeySlotId: 'evm-family-signing-key:registration',
        ecdsaThresholdKeyId: 'ecdsa-threshold-key:registration',
        signingRootId: 'project-registration:env-registration',
        signingRootVersion: 'root-share-epoch-1',
        keyScope: 'evm-family' as const,
        relayerKeyId: 'ecdsa-relayer-key:registration',
        registrationPreparationId: 'regprep_registration',
        requestId: 'registration-request',
        thresholdSessionId: 'threshold-session-registration',
        ttlMs: 300_000,
        remainingUses: 3,
        participantIds: [1, 2],
        runtimePolicyScope: SETUP_ECDSA_SCOPE,
      },
      strictRegistration: setupEcdsaStrictRegistration(
        registrationCeremonyId,
        String(SETUP_ECDSA_WALLET_ID),
      ),
    },
  };
}

async function setupResponseWithDigest<T extends { intent: RegistrationIntentV1 }>(
  response: T,
): Promise<T & { registrationIntentDigestB64u: string }> {
  return {
    ...response,
    registrationIntentDigestB64u: await computeRegistrationIntentDigestB64u(response.intent),
  };
}

const SETUP_ECDSA_REQUEST = {
  relayerUrl: RELAYER,
  request: {
    wallet: { kind: 'provided' as const, walletId: SETUP_ECDSA_WALLET_ID },
    authMethod: SETUP_ECDSA_INTENT.authMethod,
    signerSelection: SETUP_ECDSA_INTENT.signerSelection,
  },
  auth: { publishableKey: 'publishable-key', environmentId: 'environment-id' },
};

const SETUP_MIXED_REQUEST = {
  ...SETUP_ECDSA_REQUEST,
  request: {
    ...SETUP_ECDSA_REQUEST.request,
    signerSelection: setupEcdsaResponse('near_ed25519_and_evm_family_ecdsa').intent.signerSelection,
  },
};

test('setup parses an Ed25519-only response without an ECDSA payload', async () => {
  const response = {
    ...SETUP_RESPONSE,
    registrationIntentDigestB64u: await computeRegistrationIntentDigestB64u(SETUP_INTENT),
  };
  const result = await withStubbedFetch(response, () => setupWalletRegistration(SETUP_REQUEST));

  expect(result).toEqual(response);
  expect(result.ok).toBe(true);
  if (result.ok) expect('ecdsa' in result).toBe(false);
});

test('setup enforces the ECDSA field for each signer-plan branch', async () => {
  const response = {
    ...SETUP_RESPONSE,
    registrationIntentDigestB64u: await computeRegistrationIntentDigestB64u(SETUP_INTENT),
  };
  await expect(
    withStubbedFetch({ ...response, ecdsa: {} }, () => setupWalletRegistration(SETUP_REQUEST)),
  ).rejects.toThrow(/contains unexpected ecdsa/);

  await expect(
    withStubbedFetch({ ...response, kind: 'evm_family_ecdsa' as const }, () =>
      setupWalletRegistration(SETUP_REQUEST),
    ),
  ).rejects.toThrow(/missing ecdsa/);

  await expect(
    withStubbedFetch({ ...response, kind: 'near_ed25519_and_evm_family_ecdsa' as const }, () =>
      setupWalletRegistration(SETUP_REQUEST),
    ),
  ).rejects.toThrow(/missing ecdsa/);
});

test('setup preserves an omitted ECDSA networkSlug', async () => {
  const response = await setupResponseWithDigest(setupEcdsaResponse('evm_family_ecdsa'));
  const result = await withStubbedFetch(response, () =>
    setupWalletRegistration(SETUP_ECDSA_REQUEST),
  );

  expect(result).toEqual(response);
  expect(result.ok).toBe(true);
  if (result.ok && result.kind !== 'near_ed25519') {
    expect(result.ecdsa.chainTargets[0]).toEqual(SETUP_ECDSA_TARGET);
    expect('networkSlug' in result.ecdsa.chainTargets[0]).toBe(false);
  }
});

test('setup accepts a mixed signer response with the exact ECDSA payload', async () => {
  const response = await setupResponseWithDigest(
    setupEcdsaResponse('near_ed25519_and_evm_family_ecdsa'),
  );
  const result = await withStubbedFetch(response, () =>
    setupWalletRegistration(SETUP_MIXED_REQUEST),
  );

  expect(result).toEqual(response);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.kind).toBe('near_ed25519_and_evm_family_ecdsa');
});

test('setup rejects nested unknown fields and scalar coercion', async () => {
  const response = await setupResponseWithDigest(setupEcdsaResponse('evm_family_ecdsa'));
  await expect(
    withStubbedFetch(
      {
        ...response,
        intent: {
          ...response.intent,
          authMethod: { ...response.intent.authMethod, nestedExtra: { value: true } },
        },
      },
      () => setupWalletRegistration(SETUP_ECDSA_REQUEST),
    ),
  ).rejects.toThrow(/authMethod contains unexpected nestedExtra/);

  await expect(
    withStubbedFetch(
      {
        ...response,
        ecdsa: {
          ...response.ecdsa,
          chainTargets: [{ ...SETUP_ECDSA_TARGET, chainId: '8453' }],
        },
      },
      () => setupWalletRegistration(SETUP_ECDSA_REQUEST),
    ),
  ).rejects.toThrow(/chainId must be a safe integer/);
});

test('setup binds ECDSA targets and strict identities to the ceremony', async () => {
  const response = await setupResponseWithDigest(setupEcdsaResponse('evm_family_ecdsa'));
  await expect(
    withStubbedFetch(
      {
        ...response,
        ecdsa: {
          ...response.ecdsa,
          chainTargets: [{ ...SETUP_ECDSA_TARGET, chainId: 1 }],
        },
      },
      () => setupWalletRegistration(SETUP_ECDSA_REQUEST),
    ),
  ).rejects.toThrow(/ECDSA chainTargets do not match intent/);

  const changedStrictRegistration = {
    ...response.ecdsa.strictRegistration,
    lifecycle: {
      ...response.ecdsa.strictRegistration.lifecycle,
      lifecycle_id: 'wrc_other_ceremony',
    },
  };
  await expect(
    withStubbedFetch(
      {
        ...response,
        ecdsa: { ...response.ecdsa, strictRegistration: changedStrictRegistration },
      },
      () => setupWalletRegistration(SETUP_ECDSA_REQUEST),
    ),
  ).rejects.toThrow(/ECDSA identities do not match response/);
});

test('setup binds the response intent to the requested signer selection', async () => {
  const response = await setupResponseWithDigest(setupEcdsaResponse('evm_family_ecdsa'));
  const changedRequest = {
    ...SETUP_ECDSA_REQUEST,
    request: {
      ...SETUP_ECDSA_REQUEST.request,
      signerSelection: {
        ...SETUP_ECDSA_REQUEST.request.signerSelection,
        signers: [
          {
            ...SETUP_ECDSA_REQUEST.request.signerSelection.signers[0],
            chainTargets: [{ ...SETUP_ECDSA_TARGET, chainId: 1 }],
          },
        ],
      },
    },
  };

  await expect(
    withStubbedFetch(response, () => setupWalletRegistration(changedRequest)),
  ).rejects.toThrow(/intent does not match request/);
});

test('setup rejects malformed ECDSA request targets before fetch', async () => {
  const malformedRequests = [
    {
      ...SETUP_ECDSA_REQUEST,
      request: {
        ...SETUP_ECDSA_REQUEST.request,
        signerSelection: {
          ...SETUP_ECDSA_REQUEST.request.signerSelection,
          signers: [
            {
              ...SETUP_ECDSA_REQUEST.request.signerSelection.signers[0]!,
              chainTargets: [{ ...SETUP_ECDSA_TARGET, extra: true }],
            },
          ],
        },
      },
    },
    {
      ...SETUP_ECDSA_REQUEST,
      request: {
        ...SETUP_ECDSA_REQUEST.request,
        signerSelection: {
          ...SETUP_ECDSA_REQUEST.request.signerSelection,
          signers: [
            {
              ...SETUP_ECDSA_REQUEST.request.signerSelection.signers[0]!,
              chainTargets: [null],
            },
          ],
        },
      },
    },
  ];

  for (const request of malformedRequests) {
    let fetchCalls = 0;
    await expect(
      withStubbedFetch(
        {},
        () => setupWalletRegistration(request),
        () => {
          fetchCalls += 1;
        },
      ),
    ).rejects.toThrow(/request signerSelection is invalid/);
    expect(fetchCalls).toBe(0);
  }
});

test('setup sends canonical normalized signer values after preflight', async () => {
  const response = await setupResponseWithDigest(setupEcdsaResponse('evm_family_ecdsa'));
  const request = {
    ...SETUP_ECDSA_REQUEST,
    request: {
      ...SETUP_ECDSA_REQUEST.request,
      signerSelection: {
        kind: 'signer_set' as const,
        signers: [
          {
            kind: 'evm_family_ecdsa' as const,
            participantIds: [1, 2],
            chainTargets: [
              {
                chainId: SETUP_ECDSA_TARGET.chainId,
                namespace: SETUP_ECDSA_TARGET.namespace,
                kind: SETUP_ECDSA_TARGET.kind,
              },
            ],
            ignoredBranchField: true,
          },
        ],
      },
    },
  };
  let requestBody: string | undefined;
  const result = await withStubbedFetch(
    response,
    () => setupWalletRegistration(request),
    (init) => {
      requestBody = typeof init?.body === 'string' ? init.body : undefined;
    },
  );

  expect(result).toEqual(response);
  expect(requestBody).toBe(
    JSON.stringify({
      wallet: {
        kind: 'provided',
        walletId: SETUP_ECDSA_WALLET_ID,
      },
      signerSelection: {
        kind: 'signer_set',
        signers: [
          {
            kind: 'evm_family_ecdsa',
            participantIds: [1, 2],
            chainTargets: [
              {
                kind: 'evm',
                namespace: 'eip155',
                chainId: 8453,
              },
            ],
          },
        ],
      },
      authMethod: {
        kind: 'passkey',
        rpId: SETUP_RP_ID,
      },
    }),
  );
});

const RESPOND_ARGS = {
  relayerUrl: RELAYER,
  registrationCeremonyId: 'wrc_test',
  signerPlanKind: 'near_ed25519_and_evm_family_ecdsa' as const,
  signedSetup: 'signed-setup-token',
  kind: 'passkey' as const,
  webauthnRegistration: {},
  ecdsa: {
    kind: 'router_ab_ecdsa_registration_v1' as const,
    strictRegistration: {} as never,
    requestDigestB64u: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },
};

test('respond sends the signer plan and authority proof at the route boundary', async () => {
  const { buildFixtureRespondEd25519DeferredWork } =
    await import('../helpers/ed25519YaoAdmissionFixtures');
  let requestBody: Record<string, unknown> | null = null;
  await withStubbedFetch(
    {
      ok: true,
      registrationCeremonyId: 'wrc_test',
      kind: 'near_ed25519',
      ed25519: buildFixtureRespondEd25519DeferredWork({ lifecycleId: 'wrc_test' }),
    },
    () =>
      respondWalletRegistration({
        relayerUrl: RELAYER,
        registrationCeremonyId: 'wrc_test',
        signerPlanKind: 'near_ed25519',
        signedSetup: 'signed-setup-token',
        kind: 'email_otp',
        emailOtpRegistrationProof: {} as never,
      }),
    (init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    },
  );
  expect(requestBody).toMatchObject({
    registrationCeremonyId: 'wrc_test',
    kind: 'near_ed25519',
    emailOtpRegistrationProof: {},
  });
  expect(requestBody).not.toHaveProperty('authority');
});

test('respond rejects a mixed plan whose deferred NEAR work is missing', async () => {
  /* The caller asked for a NEAR branch. Narrowing this to ECDSA-only would
     register a wallet the user believes has NEAR and silently does not. */
  await expect(
    withStubbedFetch(
      {
        ok: true,
        registrationCeremonyId: 'wrc_test',
        kind: 'near_ed25519_and_evm_family_ecdsa',
        ecdsa: { kind: 'router_ab_ecdsa_registration_forwarded_v1', strictResult: {} },
      },
      () => respondWalletRegistration(RESPOND_ARGS),
    ),
  ).rejects.toThrow(/ed25519/i);
});

test('respond rejects an ECDSA-only plan that carries deferred NEAR work', async () => {
  await expect(
    withStubbedFetch(
      {
        ok: true,
        registrationCeremonyId: 'wrc_test',
        kind: 'evm_family_ecdsa',
        ecdsa: { kind: 'router_ab_ecdsa_registration_forwarded_v1', strictResult: {} },
        ed25519: { status: 'deferred', admissionRequest: {}, admissionReceipt: {} },
      },
      () => respondWalletRegistration(RESPOND_ARGS),
    ),
  ).rejects.toThrow(/contains unexpected ed25519/);
});

test('respond rejects an unknown signer-plan kind', async () => {
  await expect(
    withStubbedFetch(
      {
        ok: true,
        registrationCeremonyId: 'wrc_test',
        kind: 'secp256r1_passkey_only',
        ecdsa: { kind: 'router_ab_ecdsa_registration_forwarded_v1', strictResult: {} },
      },
      () => respondWalletRegistration(RESPOND_ARGS),
    ),
  ).rejects.toThrow(/kind is invalid/);
});

test('respond rejects an Ed25519-only plan carrying ECDSA proof bundles', async () => {
  /* No ECDSA leg ran for this plan, so bundles cannot exist. Accepting them
     would mean verifying proofs for a ceremony that never produced any. */
  await expect(
    withStubbedFetch(
      {
        ok: true,
        registrationCeremonyId: 'wrc_test',
        kind: 'near_ed25519',
        ecdsa: { kind: 'router_ab_ecdsa_registration_forwarded_v1', strictResult: {} },
        ed25519: { status: 'deferred', admissionRequest: {}, admissionReceipt: {} },
      },
      () => respondWalletRegistration(RESPOND_ARGS),
    ),
  ).rejects.toThrow(/contains unexpected ecdsa/);
});

test('respond accepts an Ed25519-only plan with only deferred NEAR work', async () => {
  const { buildFixtureRespondEd25519DeferredWork } =
    await import('../helpers/ed25519YaoAdmissionFixtures');
  const result = await withStubbedFetch(
    {
      ok: true,
      registrationCeremonyId: 'wrc_test',
      kind: 'near_ed25519',
      ed25519: buildFixtureRespondEd25519DeferredWork({ lifecycleId: 'wrc_test' }),
    },
    () => respondWalletRegistration(RESPOND_ARGS),
  );
  expect(result.kind).toBe('near_ed25519');
  /* The wallet's sole signer is still deferred — never awaited here. */
  expect(result.ed25519?.status).toBe('deferred');
  expect('ecdsa' in result).toBe(false);
});

test('respond rejects deferred NEAR work claiming a non-deferred status', async () => {
  /* Only the client decides when this work runs. A server claiming it is
     already provisioning would invite the caller to await it. */
  await expect(
    withStubbedFetch(
      {
        ok: true,
        registrationCeremonyId: 'wrc_test',
        kind: 'near_ed25519_and_evm_family_ecdsa',
        ecdsa: { kind: 'router_ab_ecdsa_registration_forwarded_v1', strictResult: {} },
        ed25519: { status: 'provisioning', admissionRequest: {}, admissionReceipt: {} },
      },
      () => respondWalletRegistration(RESPOND_ARGS),
    ),
  ).rejects.toThrow(/status is invalid/);
});

const ACTIVATE_ARGS = {
  relayerUrl: RELAYER,
  registrationCeremonyId: 'wrc_test',
  signerPlanKind: 'evm_family_ecdsa' as const,
  signedSetup: 'signed-setup-token',
  idempotencyKey: 'idem-1',
  ecdsa: { clientActivation: {} as never },
};

test('activate rejects a nearProvisioning snapshot carrying more than a status', async () => {
  /* NEAR identifiers before readiness are exactly what the deferred lifecycle
     exists to prevent; the snapshot is a status and nothing else. */
  await expect(
    withStubbedFetch(
      {
        ok: true,
        kind: 'evm_family_ecdsa',
        walletId: 'w.testnet',
        ecdsa: { walletKeys: [] },
        nearProvisioning: { status: 'near_pending', nearAccountId: 'leaked.testnet' },
      },
      () => activateWalletRegistration(ACTIVATE_ARGS),
    ),
  ).rejects.toThrow(/nearProvisioning contains unexpected nearAccountId/);
});

test('activate rejects a nearProvisioning status other than near_pending', async () => {
  await expect(
    withStubbedFetch(
      {
        ok: true,
        kind: 'evm_family_ecdsa',
        walletId: 'w.testnet',
        ecdsa: { walletKeys: [] },
        nearProvisioning: { status: 'ready' },
      },
      () => activateWalletRegistration(ACTIVATE_ARGS),
    ),
  ).rejects.toThrow(/nearProvisioning status is invalid/);
});

test('activate rejects a response missing the activation payload', async () => {
  /* Activate absorbed derivation/activate as well as finalize, so `ecdsa`
     carries the wallet keys *and* the activation payload. Without `activation`
     and `bootstrap` the client cannot build its ECDSA session, and the wallet
     would register server-side while being unable to sign — so this fails at
     the boundary rather than producing an unusable wallet. */
  await expect(
    withStubbedFetch(
      { ok: true, kind: 'evm_family_ecdsa', walletId: 'w.testnet', ecdsa: { walletKeys: [] } },
      () => activateWalletRegistration(ACTIVATE_ARGS),
    ),
  ).rejects.toThrow(/missing the activation payload/);
});

test('activate accepts an Ed25519 wallet pending signer provisioning', async () => {
  const walletId = 'pending-ed25519.testnet';
  const rpId = 'example.test';
  const credentialIdB64u = 'credential-id';
  const authority = buildPasskeyWalletAuthAuthority({ walletId, rpId, credentialIdB64u });

  const result = await withStubbedFetch(
    {
      ok: true,
      kind: 'near_ed25519',
      walletId,
      authority,
      rpId,
      authMethod: {
        kind: 'passkey',
        credentialIdB64u,
        credentialPublicKeyB64u: 'credential-public-key',
      },
      nearProvisioning: { status: 'near_pending' },
    },
    () =>
      activateWalletRegistration({
        relayerUrl: RELAYER,
        registrationCeremonyId: 'wrc_pending_ed25519',
        signerPlanKind: 'near_ed25519',
        signedSetup: 'signed-setup-token',
        idempotencyKey: 'idem-pending-ed25519',
      }),
  );

  expect(result).toMatchObject({
    ok: true,
    kind: 'near_ed25519',
    walletId,
    nearProvisioning: { status: 'near_pending' },
  });
  expect(result).not.toHaveProperty('authorityScope');
});
