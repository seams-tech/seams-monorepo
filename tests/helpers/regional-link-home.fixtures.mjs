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
  constructor(api, bridge, source) {
    this.api = api;
    this.owner = buildRegionalLinkOwnerFixture(api, bridge);
    this.authenticateOwner = api.createDeviceLinkingOwnerRequestAuthenticatorV1({
      authorizationSessions: {
        tenantId: bridge.tenantId,
        readWalletSessionAuthorizationV2ByOperationCredential:
          api.readActiveWalletSessionCredential.bind(null, bridge.service),
        readExhaustedWalletSessionAuthorizationV2CandidateByOperationCredential:
          api.readExhaustedWalletSessionCredential.bind(null, bridge.service),
      },
    });
    const provider = api.createD1LinkedDeviceOwnerAuthorizationProviderV1({
      walletRegistration: source,
      metadata: source.metadata,
      targetPlanner: { preparationTtlMs: 30_000, targetPasskeyRpId: 'wallet.test' },
    });
    this.ownerAuthorization = provider.ownerAuthorization;
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
