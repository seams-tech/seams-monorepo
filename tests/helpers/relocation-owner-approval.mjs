import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function approveRelocationOwner(context, move, candidate) {
  const { api, signerScope: scope } = context;
  const database = context.regions.get('WEUR').database;
  const { seedExecutionGeneration } = await import(
    pathToFileURL(resolve(candidate, '../../tests/e2e/execution-generation.scenario.mjs'))
  );
  const nowMs = Date.now();
  const keys = generateKeyPairSync('ed25519');
  const publicKey = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x, 'base64url');
  const cose = Buffer.concat([Buffer.from('a4010103272006215820', 'hex'), publicKey]);
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'composed-relocation',
    materialActivation: api.routerAbMpcMaterialActivationRefFromWire(
      JSON.parse(context.registration.delivery).delivery.deriver_a.binding.material_activation,
    ),
    ed25519Signer: {
      walletKeyId: 'wallet-key:composed',
      registeredPublicKeyB64u: Buffer.from(
        context.registration.publicReceipt.registered_public_key,
      ).toString('base64url'),
    },
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    tenantId: scope.orgId,
    credentialPublicKeyB64u: cose.toString('base64url'),
    expiresAtMs: nowMs + 300_000,
    identity: {
      walletId: context.wallet.walletId,
      authorityId: move.authorityId,
      walletAuthMethodId: 'wallet-auth-method:composed',
      rpId: 'wallet.example.test',
    },
  });
  await seedExecutionGeneration({ api, database, scope, walletId: context.wallet.walletId });
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: fixture.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: fixture.authMethod }),
  ]);
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  const authorizationSessions = new api.AuthorizationService({
    policy: api.capabilityPolicyPort,
    sessions: store,
    grants: store,
    evidence: store,
    authorizedOperations: store,
    audit: {},
  });
  const issued = await authorizationSessions.issueDirectWalletSessionAuthorizationV2({
    tenantId: fixture.issuedSession.session.tenantId,
    principalId: fixture.issuedSession.session.principalId,
    walletId: fixture.authority.walletId,
    authority: fixture.authority,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    mintId: fixture.issuedSession.session.mintId,
    remainingUses: 7,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 300_000,
  });
  assert.equal(issued.kind, 'issued');
  const origin = api.parseSessionOrigin('https://wallet.example.test');
  const owner = await api.WalletRelocationOwnerRequest.authenticate({
    request: new Request('https://gateway.example.test/wallet/placement/v1/relocations', {
      method: 'POST',
      headers: { authorization: `Bearer ${issued.operationCredential.token}`, origin },
      body: '{}',
    }),
    walletId: context.wallet.walletId,
    tenantId: issued.session.tenantId,
    scope,
    allowedOrigins: [origin],
    authorizationSessions,
    nowMs,
  });
  assert.ok(owner, 'The real session must authenticate the owner');
  const authenticators = new api.CloudflareD1WebAuthnStore({ database, ...scope });
  await authenticators.writeAuthenticator({
    userId: context.wallet.walletId,
    record: {
      credentialIdB64u: fixture.authMethod.credentialIdB64u,
      credentialPublicKeyB64u: fixture.authMethod.credentialPublicKeyB64u,
      counter: 0,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      deviceInfo: {
        label: 'Composed authenticator',
        browser: 'other',
        os: 'other',
        synced: false,
        transports: [],
      },
    },
  });
  const binding = api.WalletRelocationChallengeBinding.parse({
    walletId: context.wallet.walletId,
    moveId: move.moveId,
    requestDigestHex: await move.digest(),
    sourceGeneration: 1,
    destinationRegion: 'APAC',
    authorityId: fixture.authority.authorityId,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    credentialDigestHex: createHash('sha256')
      .update(issued.operationCredential.token)
      .digest('hex'),
    credentialExpiresAtMs: nowMs + 300_000,
    origin,
  });
  const challenges = new api.D1WalletRelocationChallenges(database, scope);
  const challenge = await challenges.issue(binding, nowMs, nowMs + 60_000);
  const credential = relocationAssertion(
    keys.privateKey,
    fixture.authMethod,
    challenge.challengeB64u,
    origin,
  );
  const approvals = new api.D1WalletRelocationApprovals(database, scope);
  const result = await approvals.approvePasskey({ owner, binding, credential, nowMs: Date.now() });
  assert.equal(result.kind, 'approved');
}

function relocationAssertion(privateKey, method, challenge, origin) {
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
  const flags = Buffer.from([5, 0, 0, 0, 1]);
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(method.rpId).digest(),
    flags,
  ]);
  const signed = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(clientData).digest(),
  ]);
  return {
    id: method.credentialIdB64u,
    rawId: method.credentialIdB64u,
    type: 'public-key',
    response: {
      clientDataJSON: clientData.toString('base64url'),
      authenticatorData: authenticatorData.toString('base64url'),
      signature: sign(null, signed, privateKey).toString('base64url'),
      userHandle: null,
    },
  };
}
