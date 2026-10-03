export function buildRegionalLinkOwnerFixture(api, bridge) {
  return {
    walletId: bridge.issued.session.walletId,
    walletSessionId: bridge.issued.session.walletSessionId,
    authorizationId: bridge.issued.session.authorizationId,
    expiresAtMs: Date.now() + 60_000,
    permission: api.buildFullOwnerDelegatedWalletAuthorityV1(),
    curve: 'ed25519',
    keyManifestDigestB64u: Buffer.alloc(32, 41).toString('base64url'),
  };
}

export class RegionalLinkOwnerAuthorizationFixture {
  allowed = true;
  async authorizeOwnerClaimV1({ payload, owner }) {
    if (!this.allowed)
      return { kind: 'denied', code: 'unauthorized', message: 'Owner denied by fixture' };
    return {
      kind: 'authorized',
      identity: {
        walletId: owner.walletId,
        enrollmentId: `enrollment:${payload.linkSessionId}`,
        deviceId: `device:${payload.linkSessionId}`,
        claimExpiresAtMs: payload.expiresAtMs,
      },
    };
  }
  authorizeOwnerApprovalV1() {
    throw new Error('Owner approval is outside the routing scenario');
  }
}

export class RegionalLinkApprovalFixture {
  constructor(api, bridge) {
    this.api = api;
    this.bridge = bridge;
    this.owner = buildRegionalLinkOwnerFixture(api, bridge);
    const provider = api.createD1LinkedDeviceOwnerAuthorizationProviderV1({
      walletRegistration: {},
      metadata: { readVerifiedOwnerSourceFactsV1: this.readSourceFacts.bind(this) },
      targetPlanner: { preparationTtlMs: 30_000, targetPasskeyRpId: 'wallet.test' },
    });
    this.ownerAuthorization = provider.ownerAuthorization;
  }

  readSourceFacts() {
    return Promise.resolve({
      signerManifest: this.api.buildExactAdministeredSignerManifestV1([
        this.bridge.ownerAuthority.signerActivations.ed25519.signer,
      ]),
      keyManifestDigestsB64u: { ed25519: this.owner.keyManifestDigestB64u },
      sourceAuthorityDigestB64u: this.bridge.ownerAuthority.authorityDigestB64u,
    });
  }

  async authenticateOwner(input) {
    if (
      input.request.headers.get('authorization') !==
      `Bearer ${this.bridge.issued.operationCredential.token}`
    ) {
      return { kind: 'denied', code: 'unauthorized', message: 'Owner fixture token differs' };
    }
    return {
      kind: 'authorized',
      owner: this.owner,
      body: input.method === 'GET' ? null : await input.request.json(),
      binding: {
        kind: 'linked_device_owner_request_binding_v1',
        method: input.method,
        pathname: input.pathname,
        bodyDigestB64u: input.bodyDigestB64u,
        expiresAtMs: this.owner.expiresAtMs,
      },
    };
  }

  approval(claim, payload) {
    return this.api.buildLinkedDeviceApprovalV1({
      linkSessionId: payload.linkSessionId,
      walletId: claim.walletId,
      enrollmentId: claim.enrollmentId,
      deviceId: claim.deviceId,
      linkPublicKeyB64u: payload.linkPublicKeyB64u,
      devicePublicKeyB64u: payload.devicePublicKeyB64u,
      permission: payload.requestedPermission,
      targetFactor: payload.targetFactor,
      ownerAuthorization: this.api.buildWalletSessionLinkedDeviceOwnerAuthorizationV1({
        walletSessionId: this.owner.walletSessionId,
        authorizationId: this.owner.authorizationId,
      }),
      approvedAtMs: Date.now(),
      expiresAtMs: claim.claimExpiresAtMs,
    });
  }
}
