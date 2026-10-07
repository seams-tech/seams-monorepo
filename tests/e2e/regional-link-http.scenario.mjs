import { verifyRegionalEmailGrant } from './regional-email-grant.scenario.mjs';
import { verifyRegionalLinkExpiry } from './regional-link-expiry.scenario.mjs';
import { PausedReservationDatabase } from '../helpers/regional-reservation-race.fixtures.mjs';
import { PausedTargetPreparationFixture, deliveryRecipient } from '../helpers/regional-target-preparation.fixtures.mjs';
import { PausedExportRootWrites } from '../helpers/regional-export-root-race.fixtures.mjs';
import { RegionalTargetSourceFixture } from '../helpers/regional-target-source.fixtures.mjs';
import { verifyRegionalTargetPreparation } from './regional-target-preparation.scenario.mjs';
import assert from 'node:assert/strict';
import { RegionalDeviceProofFixture } from '../helpers/regional-device-proof.fixtures.mjs';
import { RegionalLinkApprovalFixture } from '../helpers/regional-link-home.fixtures.mjs';

export async function verifyRegionalLinkHttp({ api, runtime, bridges, signerScope }) {
  for (const [region, bridge] of bridges) {
    const database = await runtime.getD1Database('SIGNER_DB', region);
    bridge.linkSource = new RegionalTargetSourceFixture(api, bridge, database, signerScope);
    bridge.linkApproval = new RegionalLinkApprovalFixture(api, bridge, bridge.linkSource);
    bridge.linkRoutes = api.createD1LinkedDeviceRouteServiceV1({
      database,
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
  const delayedPlanner = new PausedTargetPreparationFixture(weur.linkSource.targetPlanner);
  const reservationRace = new PausedReservationDatabase(await runtime.getD1Database('SIGNER_DB', 'WEUR'));
  let delayedPreparation = Promise.resolve();
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
    const claimRequest = { kind: 'linked_device_session_claim_request_v1', payload };
    const claimed = await ownerPost(apac, weur, `${path}/claim`, claimRequest);
    assert.equal(claimed.status, 200, await claimed.clone().text());
    assert.equal(claimed.headers.get('x-test-region'), 'WEUR');
    const claim = await claimed.json();
    assert.equal(claim.walletId, weur.issued.session.walletId);
    const claimRetry = await ownerPost(us, weur, `${path}/claim`, claimRequest);
    assert.equal(claimRetry.status, 200, await claimRetry.clone().text());
    assert.deepEqual(await claimRetry.json(), claim);
    const poll = await send(apac, await fixture.signedRequest(api, payload, 'GET', path, null));
    assert.equal(poll.status, 200);
    assert.equal(poll.headers.get('x-test-region'), 'WEUR');
    assert.equal((await poll.json()).session.state.state, 'claimed');
    const approval = weur.linkApproval.approval(claim, payload);
    const rejected = await ownerPost(us, bridges.get('US'), `${path}/approval`, approval);
    assert.equal(rejected.status, 403);
    const unavailable = await ownerPost(apac, weur, `${path}/approval`, approval);
    assert.equal(unavailable.status, 401, await unavailable.clone().text());
    assert.match((await unavailable.json()).message, /owner source key manifest is unavailable/u);
    const pending = await weur.linkRoutes.sessionService.getSessionV1({
      linkSessionId: payload.linkSessionId,
      nowMs: Date.now(),
    });
    assert.equal(pending.state.state, 'claimed');
    assert.equal(pending.approvalTranscript, undefined);
    await weur.linkSource.walletStore.putSigner(weur.ownerSigner);
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
    const delayedProvider = new api.D1LinkedDeviceTargetCredentialProviderV1({
      database: await runtime.getD1Database('SIGNER_DB', 'WEUR'),
      scope: signerScope,
      planner: delayedPlanner,
      verifier: {},
      sourceContributionPreparationPlanner: {},
      verifiedLinkBuilder: {},
    });
    delayedPreparation = delayedProvider.getTargetPreparationV1({
      session: await weur.linkRoutes.sessionService.getSessionV1({
        linkSessionId: payload.linkSessionId,
        nowMs: Date.now(),
      }),
      approval,
      access: 'create_or_replay',
      expectedOrigin: 'https://wallet.test',
      deliveryRecipientPublicKey65B64u: deliveryRecipient(),
      requestedAtMs: Date.now(),
    });
    await delayedPlanner.waitForPreparation();
    const preparation = await verifyRegionalTargetPreparation({
      reservationRace,
      api,
      deviceFixture: fixture,
      runtime,
      bridges,
      signerScope,
      approval,
      session: await weur.linkRoutes.sessionService.getSessionV1({
        linkSessionId: payload.linkSessionId,
        nowMs: Date.now(),
      }),
    });
    const relay = new PausedExportRootWrites(weur.linkRoutes.ed25519ExportRoot);
    const transfer = await relay.readTransferV1(payload.linkSessionId);
    assert.equal(transfer.state, 'sealed');
    weur.linkRoutes.ed25519ExportRoot = relay;
    const delayedRecipient = send(us, await fixture.signedRequest(
      api, payload, 'POST', `${path}/ed25519-export-root-recipient`, transfer.recipient,
    ));
    const delayedPackage = ownerPost(apac, weur, `${path}/ed25519-export-root`, {
      kind: 'linked_device_ed25519_export_root_submission_v1',
      linkSessionId: payload.linkSessionId,
      package: transfer.package,
    });
    try {
      await relay.waitForWrites();
      const cancel = await send(
        apac,
        await fixture.signedRequest(api, payload, 'POST', `${path}/cancel`, {
          kind: 'linked_device_session_cancel_claimed_request_v1',
          linkSessionId: payload.linkSessionId,
          enrollmentId: claim.enrollmentId,
          deviceId: claim.deviceId,
          reason: 'user_cancelled',
          requestedAtMs: Date.now(),
        }),
      );
      assert.equal(cancel.status, 200, await cancel.clone().text());
      assert.equal((await cancel.json()).session.state.state, 'cancelled');
    } finally {
      relay.released.resolve();
    }
    const recipientAfterCancel = await delayedRecipient;
    const packageAfterCancel = await delayedPackage;
    assert.equal(recipientAfterCancel.status, 409, await recipientAfterCancel.clone().text());
    assert.equal(packageAfterCancel.status, 409, await packageAfterCancel.clone().text());
    weur.linkRoutes.ed25519ExportRoot = relay.port;
    const registrationAfterCancel = await reservationRace.finish();
    assert.equal(reservationRace.insertedRows, 0);
    assert.equal(registrationAfterCancel.outcome, 'invalid_input');
    assert.match(registrationAfterCancel.message, /no longer accepts target credential registration/u);
    delayedPlanner.released.resolve();
    const preparationAfterCancel = await delayedPreparation;
    assert.equal(preparationAfterCancel.kind, 'conflict');
    const homeDatabase = await runtime.getD1Database('SIGNER_DB', 'WEUR');
    assert.equal(await homeDatabase.prepare(
      'SELECT count(*) AS count FROM linked_device_target_credentials WHERE link_session_id = ?',
    ).bind(payload.linkSessionId).first('count'), 0);


    for (const ingress of [us, apac]) {
      const recipient = await ingress.fetch(`https://wallet.test${path}/ed25519-export-root-recipient`, {
        method: 'GET',
        headers: { authorization: `Bearer ${weur.issued.operationCredential.token}` },
      });
      assert.equal(recipient.status, 409, await recipient.clone().text());
      assert.equal((await recipient.json()).outcome, 'invalid_state');
      for (const method of ['GET', 'POST']) {
        const suffix = method === 'GET' ? 'ed25519-export-root' : 'ed25519-export-root-recipient';
        const request = await fixture.signedRequest(
          api,
          payload,
          method,
          `${path}/${suffix}`,
          method === 'GET' ? null : {},
        );
        const packageResponse = await send(ingress, request);
        assert.equal(packageResponse.status, 409, await packageResponse.clone().text());
        assert.equal((await packageResponse.json()).outcome, 'invalid_state');
      }
      const submit = await ownerPost(ingress, weur, `${path}/ed25519-export-root`, {});
      assert.equal(submit.status, 409, await submit.clone().text());
      assert.equal((await submit.json()).outcome, 'invalid_state');
    }
    const terminalDelivery = await send(
      us,
      await fixture.signedRequest(api, payload, 'GET', `${path}/approval`, null),
    );
    assert.equal(terminalDelivery.status, 409);
    assert.equal((await terminalDelivery.json()).outcome, 'invalid_state');
    for (const ingress of [us, apac]) {
      const latePreparation = await ingress.fetch(
        `https://wallet.test${path}/source-contribution-preparation`,
        {
          headers: { authorization: `Bearer ${weur.issued.operationCredential.token}` },
        },
      );
      assert.equal(latePreparation.status, 409, await latePreparation.clone().text());
      assert.equal((await latePreparation.json()).outcome, 'invalid_state');
      const lateExecution = await ownerPost(
        ingress,
        weur,
        `${path}/source-contribution/execute`,
        {},
      );
      assert.equal(lateExecution.status, 409, await lateExecution.clone().text());
      assert.equal((await lateExecution.json()).outcome, 'invalid_state');
    }
    const retry = await send(us, await fixture.createReplayRequest(api, payload));
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).session.state.state, 'cancelled');
    assert.equal(retry.headers.get('x-test-region'), 'WEUR');
    const database = await runtime.getD1Database('SIGNER_DB', 'WEUR');
    assert.equal(await database.prepare(
      'SELECT count(*) AS count FROM linked_device_ed25519_export_root_transfers WHERE link_session_id = ?',
    ).bind(payload.linkSessionId).first('count'), 0);
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
    const emailGrant = await verifyRegionalEmailGrant({ api, runtime, bridges, signerScope });
    const expiry = await verifyRegionalLinkExpiry({ api, runtime, bridges, signerScope });
    return {
      expiry,
      emailGrant,
      admittedRegistrationCannotReserveAfterCancellation: true,
      delayedPlannerCannotResurrectCancelledPreparation: true,
      admittedRelayWritesCannotResurrectCancelledTransfer: true,
      terminalExportRootRequestsRejected: true,
      authenticatedClaimHttpAtHome: true,
      claimHttpReplayAcrossRegions: true,
      productionApprovalSourceFacts: true,
      missingSourceSignerRejectsApproval: true,
      preparation,
      approvalPersistedOnlyAtHome: true,
      approvalReplayAcrossRegions: true,
      changedApprovalRejected: true,
      signedApprovalDelivery: true,
      invalidProofCannotReadApprovalOrConsumeNonce: true,
      cancelledApprovalNotDelivered: true,
      cancelledSourcePreparationAndExecutionRejected: true,
      crossWalletApprovalRejected: true,
      sharedHttpCreateAndPoll: true,
      signedTravelPollAndCancel: true,
      createRetryReturnsCurrentHomeState: true,
      cleanupRetryCannotResurrect: true,
      scope:
        'Real signed device requests, production owner claim/approval rules, regional HTTP dispatch and D1 approval persistence/delivery. Owner HTTP authentication and approval source metadata use production D1 readers. Owner signer material is synthetic; provisioning, committed package delivery and authority installation remain open.',
    };
  } finally {
    reservationRace.released.resolve();
    delayedPlanner.released.resolve();
    await Promise.allSettled([delayedPreparation, reservationRace.result]);
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
