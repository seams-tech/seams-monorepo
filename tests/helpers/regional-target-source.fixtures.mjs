import assert from 'node:assert/strict';

// The session, method and authority are read from D1. Protocol material remains
// controlled until this scenario includes a real owner custody ceremony.
export class RegionalTargetSourceFixture {
  reads = 0;
  plans = 0;

  constructor(api, bridge, database, scope) {
    this.api = api;
    this.bridge = bridge;
    this.authorities = new api.D1WalletAuthorityStore({ database, scope });
    this.methods = new api.D1WalletAuthMethodStore({
      database,
      namespace: scope.namespace,
      orgId: scope.orgId,
      projectId: scope.projectId,
      envId: scope.envId,
    });
  }

  async readVerifiedSourceV1(request) {
    this.reads++;
    const issued = await this.bridge.service.readWalletSessionAuthorizationV2ByIdentity({
      tenantId: this.bridge.tenantId,
      walletId: request.walletId,
      walletSessionId: request.walletSessionId,
      authorizationId: request.authorizationId,
      nowMs: request.requestedAtMs,
    });
    assert.ok(issued);
    const authority = await this.authorities.readById(issued.session.authorityId);
    const authMethod = await this.methods.readByIdV2({
      walletAuthMethodId: issued.session.walletAuthMethodId,
    });
    assert.equal(authority.state, 'active');
    assert.equal(authMethod.status, 'active');
    assert.equal(authMethod.walletAuthorityId, authority.authorityId);
    assert.equal(authority.walletId, request.walletId);
    assert.equal(authority.authorityDigestB64u, issued.session.authorityDigestB64u);
    return {
      authority,
      authMethod,
      signerManifest: this.api.buildExactAdministeredSignerManifestV1([
        authority.signerActivations.ed25519.signer,
      ]),
      keyManifestDigestB64u: Buffer.alloc(32, 41).toString('base64url'),
      principalId: issued.session.principalId,
      expiresAtMs: issued.session.expiresAtMs,
      authorityDigestB64u: authority.authorityDigestB64u,
      verifiedRevocationEpoch: authority.revocationEpoch,
      verifiedAtMs: request.requestedAtMs,
    };
  }

  planSourceContributionPreparationV1(input) {
    this.plans++;
    const activation = input.source.authority.signerActivations.ed25519;
    const fixture = this.api.buildOrdinaryEd25519ReservationPreparationFixture(
      'regional-target',
      activation.materialActivation,
    );
    // Reverse the fixture's two distinct activations: the persisted owner
    // activation is the source, while its generated sibling is the target.
    const sourceBinding = fixture.targetBinding;
    const targetBinding = fixture.sourceContribution.sourceBinding;
    const targetMaterialActivation = this.api.routerAbMpcMaterialActivationRefFromWire(
      targetBinding.material_activation,
    );
    const workerKey = Buffer.alloc(32, 51);
    return this.api.parseLinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1([
      {
        kind: 'linked_device_ed25519_source_contribution_preparation_v1',
        linkSessionId: input.registration.linkSessionId,
        enrollmentId: input.registration.enrollmentId,
        sourceAuthorityId: input.source.authority.authorityId,
        walletKeyId: activation.signer.walletKeyId,
        targetDeviceId: input.registration.deviceId,
        targetFactorVerificationDigestB64u: input.targetFactor.verificationDigestB64u,
        sourceBinding,
        targetAdmission: {
          binding: targetBinding,
          keyset: {
            deriver_a_input_public_key: Array.from(Buffer.alloc(32, 52)),
            deriver_b_input_public_key: Array.from(Buffer.alloc(32, 53)),
            signing_worker_recipient_public_key: Array.from(workerKey),
          },
        },
        applicationBinding: fixture.applicationBinding,
        sourceRevocationEpoch: input.source.verifiedRevocationEpoch,
        participantIds: [1, 2],
        targetMaterialActivation,
        targetClientRecipientPublicKeyB64u:
          input.registration.ordinarySignerMaterialRecipientRequests[0].recipientPublicKeyB64u,
        targetSigningWorkerRecipientPublicKeyB64u: workerKey.toString('base64url'),
        sourceRegisteredPublicKeyB64u: activation.signer.registeredPublicKeyB64u,
      },
    ]);
  }
}
