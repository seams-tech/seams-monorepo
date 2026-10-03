import { createECDH, randomBytes } from 'node:crypto';

export function deliveryRecipient() {
  const recipient = createECDH('prime256v1');
  recipient.generateKeys();
  return recipient.getPublicKey().toString('base64url');
}

export class ConcurrentTargetPreparationFixture {
  barrier = Promise.withResolvers();
  created = 0;
  constructor(api) {
    this.api = api;
  }

  async createTargetPreparationV1(input) {
    this.created++;
    if (this.created === 2) this.barrier.resolve();
    await this.barrier.promise;
    const signer = input.session.approvalTranscript.sourceSignerManifest.signers[0];
    const method = `wallet-auth-method:${randomBytes(32).toString('base64url')}`;
    return this.api.buildLinkedDeviceTargetPreparationV1({
      linkSessionId: input.approval.linkSessionId,
      walletId: input.approval.walletId,
      enrollmentId: input.approval.enrollmentId,
      deviceId: input.approval.deviceId,
      walletAuthMethodId: method,
      deliveryRecipientPublicKey65B64u: input.deliveryRecipientPublicKey65B64u,
      ed25519ExportRoot: {
        kind: 'linked_device_ed25519_export_root_preparation_v1',
        walletKeyId: signer.walletKeyId,
        applicationBindingDigestB64u:
          input.session.approvalTranscript.sourceKeyManifestDigestsB64u.ed25519,
        registeredPublicKeyB64u: signer.registeredPublicKeyB64u,
        revocationEpoch: 0,
      },
      targetFactor: input.approval.targetFactor,
      passkeyCreationOptions: {
        kind: 'webauthn_add_auth_method_registration_v1',
        walletAuthMethodId: method,
        challengeId: randomBytes(16).toString('base64url'),
        challengeB64u: randomBytes(32).toString('base64url'),
        rpId: 'wallet.test',
        user: {
          idB64u: Buffer.from(input.approval.walletId).toString('base64url'),
          name: input.approval.walletId,
          displayName: input.approval.walletId,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        timeoutMs: 60_000,
        attestation: 'none',
        extensions: {
          prf: {
            eval: {
              firstB64u: Buffer.alloc(32, 1).toString('base64url'),
              secondB64u: Buffer.alloc(32, 2).toString('base64url'),
            },
          },
        },
        excludeCredentials: [],
      },
      passkeyConfigurationDigestB64u:
        await this.api.computeLinkedDevicePasskeyTargetConfigurationDigestV1({
          rpId: 'wallet.test',
          expectedOrigin: input.expectedOrigin,
        }),
      ordinarySignerMaterialRecipientRequirements: [
        {
          kind: 'ordinary_signer_material_recipient_requirement_v1',
          walletKeyId: signer.walletKeyId,
          keyFamily: signer.keyFamily,
        },
      ],
      issuedAtMs: input.requestedAtMs,
      expiresAtMs: input.approval.expiresAtMs,
    });
  }
}
