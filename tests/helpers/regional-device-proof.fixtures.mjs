import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export class RegionalDeviceProofFixture {
  constructor() {
    this.keys = generateKeyPairSync('ed25519');
    this.publicKey = this.keys.publicKey.export({ format: 'jwk' }).x;
  }

  async createRequest(api, label) {
    const input = await this.create(api, label);
    const payload = api.parseQrLinkedDeviceSessionPayloadV5({
      version: 'v5',
      purpose: 'linked_device_lane_creation',
      linkSessionId: input.proof.linkSessionId,
      linkPublicKeyB64u: this.publicKey,
      devicePublicKeyB64u: this.publicKey,
      requestedPermission: api.buildFullOwnerDelegatedWalletAuthorityV1(),
      issuedAtMs: input.proof.issuedAtMs,
      expiresAtMs: input.proof.expiresAtMs,
      targetFactor: { kind: 'passkey_prf' },
    });
    return this.createReplayRequest(api, payload);
  }

  createReplayRequest(api, payload) {
    return this.signedRequest(api, payload, 'POST', '/wallet/device-linking/v1/sessions', {
      kind: 'linked_device_session_create_request_v1',
      payload,
    });
  }

  async signedRequest(api, payload, method, pathname, body) {
    const encodedBody = method === 'GET' ? '' : JSON.stringify(body);
    const now = Date.now();
    const proof = {
      kind: 'linked_device_request_proof_v1',
      linkSessionId: payload.linkSessionId,
      devicePublicKeyDigestB64u: await api.computeLinkedDevicePublicKeyDigestV1(this.publicKey),
      requestNonceB64u: randomBytes(32).toString('base64url'),
      method,
      canonicalPath: pathname,
      bodyDigestB64u: createHash('sha256').update(encodedBody).digest('base64url'),
      issuedAtMs: now,
      expiresAtMs: now + 30_000,
      signatureB64u: Buffer.alloc(64).toString('base64url'),
    };
    proof.signatureB64u = sign(
      null,
      api.encodeLinkedDeviceRequestProofV1(proof),
      this.keys.privateKey,
    ).toString('base64url');
    return new Request(`https://wallet.test${pathname}`, {
      method,
      headers: {
        'content-type': 'application/json',
        [api.LINKED_DEVICE_REQUEST_PROOF_HEADER_V1]: Buffer.from(JSON.stringify(proof)).toString(
          'base64url',
        ),
      },
      ...(method === 'GET' ? {} : { body: encodedBody }),
    });
  }

  async create(api, label, nowMs = Date.now()) {
    const digest = await api.computeLinkedDevicePublicKeyDigestV1(this.publicKey);
    const unsigned = {
      kind: 'linked_device_request_proof_v1',
      linkSessionId: `link-session:regional-${label}`,
      devicePublicKeyDigestB64u: digest,
      requestNonceB64u: randomBytes(32).toString('base64url'),
      method: 'POST',
      canonicalPath: '/wallet/device-linking/v1/sessions',
      bodyDigestB64u: createHash('sha256').update(label).digest('base64url'),
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + 30_000,
      signatureB64u: Buffer.alloc(64).toString('base64url'),
    };
    unsigned.signatureB64u = sign(
      null,
      api.encodeLinkedDeviceRequestProofV1(unsigned),
      this.keys.privateKey,
    ).toString('base64url');
    const proof = api.parseLinkedDeviceRequestProofV1(unsigned);
    return {
      payload: { linkSessionId: proof.linkSessionId, devicePublicKeyB64u: this.publicKey },
      proof,
      method: proof.method,
      canonicalPath: proof.canonicalPath,
      bodyDigestB64u: proof.bodyDigestB64u,
      devicePublicKeyDigestB64u: digest,
      requestedAtMs: nowMs,
    };
  }
}
