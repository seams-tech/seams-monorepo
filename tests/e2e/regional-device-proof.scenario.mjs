import assert from 'node:assert/strict';
import { RegionalDeviceProofFixture } from '../helpers/regional-device-proof.fixtures.mjs';

export async function verifyRegionalDeviceProofs({
  api,
  runtime,
  bridges,
  consoleBridge,
  isolatedIdentity,
  signerScope,
  authorityDatabase,
}) {
  const services = [];
  for (const [region, bridge] of bridges) {
    const database = await runtime.getD1Database('SIGNER_DB', region);
    services.push(
      api.createD1LinkedDeviceRouteServiceV1({
        database,
        scope: signerScope,
        proofNonces: bridge.publisher.linkedDeviceProofNonces(),
        ownerAuthorization: {},
        authenticateOwnerRequestV1: unexpectedOwnerRequest,
        targetCredential: {},
      }),
    );
  }
  const fixture = new RegionalDeviceProofFixture();
  const proof = await fixture.create(api, 'concurrent');
  const attempts = await Promise.all(services.map(verifyProof.bind(null, proof)));
  assert.equal(attempts.filter(isAuthorized).length, 1, JSON.stringify(attempts));
  assert.equal(attempts.filter(isReplayed).length, services.length - 1);
  for (const service of services)
    assert.equal((await service.verifyPublicSessionProofV1(proof)).code, 'replayed');

  const malformed = await fixture.create(api, 'signature');
  malformed.proof.signatureB64u = Buffer.alloc(64).toString('base64url');
  assert.equal((await services[0].verifyPublicSessionProofV1(malformed)).code, 'invalid');
  assert.equal(
    await authorityDatabase
      .prepare('SELECT COUNT(*) AS count FROM linked_device_request_proof_nonces')
      .first('count'),
    1,
  );

  const outageRequest = await fixture.createRequest(api, 'http-outage');
  const unavailableProof = await fixture.create(api, 'outage');
  consoleBridge.available = false;
  try {
    const response = await api.handleDeviceLinking({
      method: 'POST',
      pathname: new URL(outageRequest.url).pathname,
      request: outageRequest,
      service: { deviceLinking: services[0] },
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'unavailable');
    for (const service of services)
      assert.equal(
        (await service.verifyPublicSessionProofV1(unavailableProof)).code,
        'unavailable',
      );
  } finally {
    consoleBridge.available = true;
  }
  assert.equal((await services[1].verifyPublicSessionProofV1(unavailableProof)).kind, 'authorized');
  const lostReply = await fixture.create(api, 'lost-reply');
  consoleBridge.dropNextNonceReply = true;
  assert.equal((await services[0].verifyPublicSessionProofV1(lostReply)).code, 'unavailable');
  assert.equal((await services[2].verifyPublicSessionProofV1(lostReply)).code, 'replayed');
  const expired = await fixture.create(api, 'expired', Date.now() - 60_000);
  expired.requestedAtMs = Date.now();
  assert.equal((await services[1].verifyPublicSessionProofV1(expired)).code, 'expired');
  const isolatedService = api.createD1LinkedDeviceRouteServiceV1({
    database: await runtime.getD1Database('SIGNER_DB', 'US'),
    scope: signerScope,
    proofNonces: isolatedIdentity.linkedDeviceProofNonces(),
    ownerAuthorization: {},
    authenticateOwnerRequestV1: unexpectedOwnerRequest,
    targetCredential: {},
  });
  assert.equal((await isolatedService.verifyPublicSessionProofV1(proof)).kind, 'authorized');
  for (const region of bridges.keys()) {
    const database = await runtime.getD1Database('SIGNER_DB', region);
    assert.equal(
      await database
        .prepare('SELECT COUNT(*) AS count FROM linked_device_request_proof_nonces')
        .first('count'),
      0,
    );
  }
  return {
    contenders: attempts.length,
    authorized: 1,
    replays: services.length - 1,
    subsequentReplaysRejected: true,
    invalidSignatureDoesNotConsume: true,
    outageFailsClosedWithoutLocalFallback: true,
    createRouteReportsUnavailable503: true,
    retryAfterOutageSucceeds: true,
    projectScopeIsolated: true,
    lostAcknowledgementCannotReuseNonce: true,
    expiredProofRejected: true,
    regionalNonceTablesEmpty: true,
    scope:
      'Real Ed25519 request proofs, production route-service verifier and Console authority over Worker transports; QR session creation, home binding and linked-device installation are outside this scenario.',
  };
}
function verifyProof(proof, service) {
  return service.verifyPublicSessionProofV1(proof);
}
function isAuthorized(result) {
  return result.kind === 'authorized';
}
function isReplayed(result) {
  return result.kind === 'denied' && result.code === 'replayed';
}
function unexpectedOwnerRequest() {
  throw new Error('Public device proof must not authorize an owner');
}
