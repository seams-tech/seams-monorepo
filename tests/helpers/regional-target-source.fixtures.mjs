// Production source reads use D1; contribution planning remains controlled.
export class RegionalTargetSourceFixture {
  reads = 0;
  plans = 0;

  constructor(api, bridge, database, scope) {
    this.api = api;
    this.bridge = bridge;
    this.walletStore = new api.D1WalletStore({
      database,
      namespace: scope.namespace,
      orgId: scope.orgId,
      projectId: scope.projectId,
      envId: scope.envId,
    });
    this.source = api.createD1LinkedDeviceVerifiedLinkSourceReaderV1({
      authorizationService: bridge.service,
      tenantId: bridge.tenantId,
      authorityStore: new api.D1WalletAuthorityStore({ database, scope }),
      authMethodStore: new api.D1WalletAuthMethodStore({
        database,
        namespace: scope.namespace,
        orgId: scope.orgId,
        projectId: scope.projectId,
        envId: scope.envId,
      }),
      walletStore: this.walletStore,
    });
  }

  readVerifiedSourceV1(request) {
    this.reads++;
    return this.source.readVerifiedSourceV1(request);
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
