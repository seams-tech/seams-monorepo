import assert from 'node:assert/strict';
import bs58 from 'bs58';

// Parser-valid synthetic registration material; no Yao ceremony executes here.
export function buildRegionalOwnerSigner(api, scope, walletId) {
  const materialActivation = api.buildMpcMaterialActivationRefFixture('regional-owner', walletId);
  const fixture = api.buildOrdinaryEd25519ReservationPreparationFixture(
    'regional-owner',
    materialActivation,
  );
  const contribution = fixture.sourceContribution;
  const binding = fixture.targetBinding;
  const runtimePolicyScope = {
    orgId: scope.orgId,
    projectId: scope.projectId,
    envId: scope.envId,
    signingRootVersion: binding.lifecycle.root_share_epoch,
  };
  const signingRootId = `${scope.projectId}:${scope.envId}`;
  const nearEd25519SigningKeyId = fixture.applicationBinding.near_ed25519_signing_key_id;
  const publicKeyBytes = contribution.activationReceipt.registered_public_key;
  const nearAccountId = Buffer.from(publicKeyBytes).toString('hex');
  const record = api.parseWalletEd25519SignerRecord(
    api.buildYaoEd25519WalletSignerRecord({
      walletId,
      nearAccountId,
      nearEd25519SigningKeyId,
      thresholdSessionId: binding.lifecycle.session_id,
      signerSlot: 1,
      publicKey: `ed25519:${bs58.encode(Uint8Array.from(publicKeyBytes))}`,
      signingWorkerId: binding.lifecycle.selected_server_id,
      keyVersion: '1',
      participantIds: contribution.participantIds,
      signingRootId,
      signingRootVersion: runtimePolicyScope.signingRootVersion,
      runtimePolicyScope,
      activeYaoCapability: {
        version: 'wallet_ed25519_yao_registration_capability_v1',
        activeCapabilityBinding: binding.session_id,
        nearAccountId,
        runtimePolicyScope,
        admissionRequest: {
          scope: {
            lifecycle_id: binding.lifecycle.lifecycle_id,
            root_share_epoch: binding.lifecycle.root_share_epoch,
            account_id: walletId,
            threshold_session_id: binding.lifecycle.session_id,
            signer_set_id: binding.lifecycle.signer_set_id,
            signing_worker_id: binding.lifecycle.selected_server_id,
            material_activation: binding.material_activation,
          },
          application_binding: {
            wallet_id: walletId,
            near_ed25519_signing_key_id: nearEd25519SigningKeyId,
            signing_root_id: signingRootId,
            key_creation_signer_slot: 1,
          },
          participant_ids: contribution.participantIds,
        },
        admissionReceipt: {
          binding,
          keyset: {
            deriver_a_input_public_key: Array.from(Buffer.alloc(32, 52)),
            deriver_b_input_public_key: Array.from(Buffer.alloc(32, 53)),
            signing_worker_recipient_public_key: Array.from(Buffer.alloc(32, 51)),
          },
        },
        activationResult: {
          binding,
          deriver_a_client_package: contribution.deriver_a_client_package,
          deriver_b_client_package: contribution.deriver_b_client_package,
          public_receipt: contribution.activationReceipt,
        },
      },
      custodyKeyManifestDigestB64u: Buffer.alloc(32, 41).toString('base64url'),
      now: Date.now(),
    }),
  );
  assert.ok(record, 'regional owner signer must pass the production persistence parser');
  return {
    record,
    materialActivation,
    identity: {
      walletKeyId: `wallet-key:ed25519:${walletId}:${nearEd25519SigningKeyId}`,
      registeredPublicKeyB64u: Buffer.from(publicKeyBytes).toString('base64url'),
    },
  };
}
