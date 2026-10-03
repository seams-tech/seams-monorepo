import assert from 'node:assert/strict';
import { RegionalDeviceProofFixture } from '../helpers/regional-device-proof.fixtures.mjs';
import {
  buildRegionalLinkOwnerFixture,
  RegionalLinkOwnerAuthorizationFixture,
} from '../helpers/regional-link-home.fixtures.mjs';

export async function verifyRegionalLinkHttp({ api, runtime, bridges, signerScope }) {
  for (const [region, bridge] of bridges) {
    bridge.linkRoutes = api.createD1LinkedDeviceRouteServiceV1({
      database: await runtime.getD1Database('SIGNER_DB', region),
      scope: signerScope,
      bootstrap: bridge.publisher.linkedDeviceBootstrap(),
      proofNonces: bridge.publisher.linkedDeviceProofNonces(),
      ownerAuthorization: new RegionalLinkOwnerAuthorizationFixture(),
      authenticateOwnerRequestV1: unexpectedOwnerRequest,
      targetCredential: {},
    });
  }
  const fixture = new RegionalDeviceProofFixture();
  const us = await runtime.getWorker('US');
  const apac = await runtime.getWorker('APAC');
  const weur = bridges.get('WEUR');
  try {
    const create = await fixture.createRequest(api, 'http-home-retry');
    const { payload } = await create.clone().json();
    assert.equal((await send(us, create)).status, 200);
    const path = `/wallet/device-linking/v1/sessions/${encodeURIComponent(payload.linkSessionId)}`;
    const unclaimed = await send(
      apac,
      await fixture.signedRequest(api, payload, 'GET', path, null),
    );
    assert.equal(unclaimed.status, 200);
    assert.equal((await unclaimed.json()).session.state.state, 'displaying_qr');
    const claimed = await weur.linkRoutes.sessionService.claimSessionV1({
      payload,
      nowMs: Date.now(),
      owner: buildRegionalLinkOwnerFixture(api, weur),
    });
    assert.equal(claimed.outcome, 'applied');
    const poll = await send(apac, await fixture.signedRequest(api, payload, 'GET', path, null));
    assert.equal(poll.status, 200);
    assert.equal(poll.headers.get('x-test-region'), 'WEUR');
    assert.equal((await poll.json()).session.state.state, 'claimed');
    const cancel = await send(
      apac,
      await fixture.signedRequest(api, payload, 'POST', `${path}/cancel`, {
        kind: 'linked_device_session_cancel_claimed_request_v1',
        linkSessionId: payload.linkSessionId,
        enrollmentId: claimed.record.claimTranscript.value.enrollmentId,
        deviceId: claimed.record.claimTranscript.value.deviceId,
        reason: 'user_cancelled',
        requestedAtMs: Date.now(),
      }),
    );
    assert.equal(cancel.status, 200, await cancel.clone().text());
    assert.equal((await cancel.json()).session.state.state, 'cancelled');
    const retry = await send(us, await fixture.createReplayRequest(api, payload));
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).session.state.state, 'cancelled');
    assert.equal(retry.headers.get('x-test-region'), 'WEUR');
    const database = await runtime.getD1Database('SIGNER_DB', 'WEUR');
    await database.batch([
      database
        .prepare('DELETE FROM linked_device_session_transcripts WHERE link_session_id = ?')
        .bind(payload.linkSessionId),
      database
        .prepare('DELETE FROM linked_device_sessions WHERE link_session_id = ?')
        .bind(payload.linkSessionId),
    ]);
    const deleted = await send(apac, await fixture.createReplayRequest(api, payload));
    assert.equal(deleted.status, 409);
    const missing = await send(us, await fixture.signedRequest(api, payload, 'GET', path, null));
    assert.equal(missing.status, 404);
    return {
      sharedHttpCreateAndPoll: true,
      signedTravelPollAndCancel: true,
      createRetryReturnsCurrentHomeState: true,
      cleanupRetryCannotResurrect: true,
      scope:
        'Real signed create/poll/cancel HTTP routes through regional dispatch and Console authority. Owner claim authorization is controlled; approval, delivery and authority installation remain open.',
    };
  } finally {
    for (const bridge of bridges.values()) bridge.linkRoutes = null;
  }
}
function unexpectedOwnerRequest() {
  throw new Error('Target-only HTTP scenario must not authenticate an owner');
}

async function send(worker, request) {
  return worker.fetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    ...(request.method === 'GET' ? {} : { body: await request.arrayBuffer() }),
  });
}
