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
