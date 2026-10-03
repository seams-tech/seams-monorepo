import { verifyRegionalTargetPreparation } from './regional-target-preparation.scenario.mjs';
import assert from 'node:assert/strict';
import { RegionalDeviceProofFixture } from '../helpers/regional-device-proof.fixtures.mjs';
import {
  buildRegionalLinkOwnerFixture,
  RegionalLinkApprovalFixture,
} from '../helpers/regional-link-home.fixtures.mjs';

export async function verifyRegionalLinkHttp({ api, runtime, bridges, signerScope }) {
  for (const [region, bridge] of bridges) {
    bridge.linkApproval = new RegionalLinkApprovalFixture(api, bridge);
    bridge.linkRoutes = api.createD1LinkedDeviceRouteServiceV1({
      database: await runtime.getD1Database('SIGNER_DB', region),
      scope: signerScope,
      bootstrap: bridge.publisher.linkedDeviceBootstrap(),
      proofNonces: bridge.publisher.linkedDeviceProofNonces(),
      ownerAuthorization: bridge.linkApproval.ownerAuthorization,
      authenticateOwnerRequestV1: bridge.linkApproval.authenticateOwner.bind(bridge.linkApproval),
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
    const approval = weur.linkApproval.approval(claimed.record.claimTranscript.value, payload);
    const rejected = await ownerPost(us, bridges.get('US'), `${path}/approval`, approval);
    assert.equal(rejected.status, 403);
    const approved = await ownerPost(apac, weur, `${path}/approval`, approval);
    assert.equal(approved.status, 200, await approved.clone().text());
    assert.equal(approved.headers.get('x-test-region'), 'WEUR');
    const repeated = await ownerPost(us, weur, `${path}/approval`, approval);
    assert.equal(repeated.status, 200);
    const changedApproval = JSON.parse(JSON.stringify(approval));
    changedApproval.expiresAtMs -= 1;
    assert.equal((await ownerPost(apac, weur, `${path}/approval`, changedApproval)).status, 409);
    const deliveryRequest = await fixture.signedRequest(
      api,
      payload,
      'GET',
      `${path}/approval`,
      null,
    );
    const corruptRequest = deliveryRequest.clone();
    const corruptProof = JSON.parse(
      Buffer.from(
        corruptRequest.headers.get(api.LINKED_DEVICE_REQUEST_PROOF_HEADER_V1),
        'base64url',
      ).toString(),
    );
    corruptProof.signatureB64u = Buffer.alloc(64).toString('base64url');
    corruptRequest.headers.set(
      api.LINKED_DEVICE_REQUEST_PROOF_HEADER_V1,
      Buffer.from(JSON.stringify(corruptProof)).toString('base64url'),
    );
    assert.equal((await send(us, corruptRequest)).status, 401);
    const delivery = await send(apac, deliveryRequest);
    assert.equal(delivery.status, 200);
    assert.deepEqual((await delivery.json()).approval, JSON.parse(JSON.stringify(approval)));
    for (const region of bridges.keys()) {
      const database = await runtime.getD1Database('SIGNER_DB', region);
      const count = await database
        .prepare(
          "SELECT count(*) AS count FROM linked_device_session_transcripts WHERE link_session_id = ? AND transcript_kind = 'approval'",
        )
        .bind(payload.linkSessionId)
        .first('count');
      assert.equal(count, region === 'WEUR' ? 1 : 0);
    }
    const preparation = await verifyRegionalTargetPreparation({
      api,
      runtime,
      bridges,
      signerScope,
      approval,
      session: await weur.linkRoutes.sessionService.getSessionV1({
        linkSessionId: payload.linkSessionId,
        nowMs: Date.now(),
      }),
    });
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
    const terminalDelivery = await send(
      us,
      await fixture.signedRequest(api, payload, 'GET', `${path}/approval`, null),
    );
    assert.equal(terminalDelivery.status, 409);
    assert.equal((await terminalDelivery.json()).outcome, 'invalid_state');
    const retry = await send(us, await fixture.createReplayRequest(api, payload));
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).session.state.state, 'cancelled');
    assert.equal(retry.headers.get('x-test-region'), 'WEUR');
    const database = await runtime.getD1Database('SIGNER_DB', 'WEUR');
    await database.batch([
      database
        .prepare('DELETE FROM linked_device_target_credentials WHERE link_session_id = ?')
        .bind(payload.linkSessionId),
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
      preparation,
      approvalPersistedOnlyAtHome: true,
      approvalReplayAcrossRegions: true,
      changedApprovalRejected: true,
      signedApprovalDelivery: true,
      invalidProofCannotReadApprovalOrConsumeNonce: true,
      cancelledApprovalNotDelivered: true,
      crossWalletApprovalRejected: true,
      sharedHttpCreateAndPoll: true,
      signedTravelPollAndCancel: true,
      createRetryReturnsCurrentHomeState: true,
      cleanupRetryCannotResurrect: true,
      scope:
        'Real signed device requests, production owner claim/approval rules, regional HTTP dispatch and D1 approval persistence/delivery. Owner HTTP authentication and source metadata are controlled; provisioning, committed package delivery and authority installation remain open.',
    };
  } finally {
    for (const bridge of bridges.values()) bridge.linkRoutes = null;
  }
}
function ownerPost(worker, bridge, pathname, body) {
  return worker.fetch(`https://wallet.test${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bridge.issued.operationCredential.token}`,
    },
    body: JSON.stringify(body),
  });
}

async function send(worker, request) {
  return worker.fetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    ...(request.method === 'GET' ? {} : { body: await request.arrayBuffer() }),
  });
}
