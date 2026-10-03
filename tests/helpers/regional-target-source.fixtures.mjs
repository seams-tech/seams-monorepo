import assert from 'node:assert/strict';

// Production readers and planner operate on the persisted synthetic owner signer.
export class RegionalTargetSourceFixture {
  reads = 0;
  plans = 0;

  constructor(api, bridge, database, scope) {
    this.api = api;
    this.walletStore = new api.D1WalletStore({
      database,
      namespace: scope.namespace,
      orgId: scope.orgId,
      projectId: scope.projectId,
      envId: scope.envId,
    });
    this.authorityStore = new api.D1WalletAuthorityStore({ database, scope });
    this.authMethodStore = new api.D1WalletAuthMethodStore({
      database,
      namespace: scope.namespace,
      orgId: scope.orgId,
      projectId: scope.projectId,
      envId: scope.envId,
    });
    this.source = api.createD1LinkedDeviceVerifiedLinkSourceReaderV1({
      authorizationService: bridge.service,
      tenantId: bridge.tenantId,
      authorityStore: this.authorityStore,
      authMethodStore: this.authMethodStore,
      walletStore: this.walletStore,
    });
    const children = api.createD1LinkedDeviceOwnerSourceChildReaderV1({
      walletAuthMethodStore: this.authMethodStore,
      walletStore: this.walletStore,
      readLinkedEd25519SourceV1: this.readOwnerInstallation.bind(this),
      readLinkedEcdsaSourceV1: this.readOwnerInstallation.bind(this),
    });
    const metadata = api.createD1LinkedDeviceOwnerAuthorizationMetadataSourceV1({
      sessionStore: new api.D1LinkedDeviceSessionStoreV1({ database, scope }),
      readVerifiedSourceV1: this.readVerifiedSourceV1.bind(this),
      readOwnerSourceChildV1: children.readOwnerSourceChildV1,
    });
    const provider = api.createD1LinkedDeviceOwnerAuthorizationProviderV1({
      metadata,
      walletRegistration: this,
      targetPlanner: { targetPasskeyRpId: 'wallet.test' },
    });
    this.planner = new api.D1LinkedDeviceSourceContributionPreparationPlannerV1({
      resolveOwnerSourceChildV1: provider.ownerSourceResolver.resolveOwnerSourceChildV1,
      deriverAInputPublicKeyB64u: Buffer.alloc(32, 52).toString('base64url'),
      deriverBInputPublicKeyB64u: Buffer.alloc(32, 53).toString('base64url'),
      signingWorkerRecipientPublicKeyB64u: Buffer.alloc(32, 51).toString('base64url'),
    });
  }

  readVerifiedSourceV1(request) {
    this.reads++;
    return this.source.readVerifiedSourceV1(request);
  }

  planSourceContributionPreparationV1(input) {
    this.plans++;
    return this.planner.planSourceContributionPreparationV1(input);
  }

  async readOwnerInstallation(input) {
    const authority = await this.authorityStore.readById(input.authorityId);
    assert.equal(authority.provenance.kind, 'wallet_registration');
    return null;
  }

  listWalletAuthMethods(input) {
    return this.authMethodStore.listForWalletV2(input);
  }

  async listWalletSigners(input) {
    const ed25519 = await this.walletStore.listEd25519SignersForWallet(input);
    const ecdsa = await this.walletStore.listEcdsaSignersForWallet(input);
    return [...ed25519, ...ecdsa];
  }

  resolveActiveOwnerWalletExecutionLane(input) {
    assert.equal(input.authorization.kind, 'wallet_auth_method');
    return this.api.resolveActiveOwnerWalletExecutionLane({
      source: this,
      walletId: input.walletId,
      walletAuthMethodId: input.authorization.walletAuthMethodId,
      expectedMaterialActivation: input.expectedMaterialActivation,
    });
  }
}
