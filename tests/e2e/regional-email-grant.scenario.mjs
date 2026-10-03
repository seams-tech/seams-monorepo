import assert from 'node:assert/strict';
import { RegionalDeviceProofFixture } from '../helpers/regional-device-proof.fixtures.mjs';
import { deliveryRecipient } from '../helpers/regional-target-preparation.fixtures.mjs';
import {
  ControlledEmailVerification,
  PausedEmailGrantStore,
} from '../helpers/regional-email-grant.fixtures.mjs';

export async function verifyRegionalEmailGrant({ api, runtime, bridges, signerScope }) {
  const device = new RegionalDeviceProofFixture();
  const home = bridges.get('WEUR');
  const ingress = await runtime.getWorker('APAC');
  const database = await runtime.getD1Database('SIGNER_DB', 'WEUR');
  const original = await device.createRequest(api, 'email-grant-race');
  const raw = (await original.json()).payload;
  raw.targetFactor = { kind: 'email_otp' };
  raw.targetEmail = 'regional-grant@example.test';
  const payload = api.parseQrLinkedDeviceSessionPayloadV5(raw);
  const path = `/wallet/device-linking/v1/sessions/${encodeURIComponent(payload.linkSessionId)}`;
  assert.equal((await send(ingress, await device.createReplayRequest(api, payload))).status, 200);
  const claimed = await ownerPost(ingress, home, `${path}/claim`, {
    kind: 'linked_device_session_claim_request_v1',
    payload,
  });
  assert.equal(claimed.status, 200, await claimed.clone().text());
  const claim = await claimed.json();
  const owner = home.linkApproval.owner;
  const approval = api.buildLinkedDeviceApprovalV1({
    linkSessionId: payload.linkSessionId,
    walletId: claim.walletId,
    enrollmentId: claim.enrollmentId,
    deviceId: claim.deviceId,
    linkPublicKeyB64u: payload.linkPublicKeyB64u,
    devicePublicKeyB64u: payload.devicePublicKeyB64u,
    permission: payload.requestedPermission,
    targetFactor: {
      kind: 'email_otp',
      targetEmail: 'regional-grant@example.test',
      enrollment: { kind: 'new_enrollment' },
    },
    ownerAuthorization: api.buildWalletSessionLinkedDeviceOwnerAuthorizationV1({
      walletSessionId: owner.walletSessionId,
      authorizationId: owner.authorizationId,
    }),
    approvedAtMs: Date.now(),
    expiresAtMs: claim.claimExpiresAtMs,
  });
  const approved = await ownerPost(ingress, home, `${path}/approval`, approval);
  assert.equal(approved.status, 200, await approved.clone().text());
  const session = await home.linkRoutes.sessionService.getSessionV1({
    linkSessionId: payload.linkSessionId,
    nowMs: Date.now(),
  });
  const target = new api.D1LinkedDeviceTargetCredentialProviderV1({
    database,
    scope: signerScope,
    planner: home.linkSource.targetPlanner,
    verifier: {},
    sourceContributionPreparationPlanner: {},
    verifiedLinkBuilder: {},
  });
  await target.getTargetPreparationV1({
    session,
    approval,
    access: 'create_or_replay',
    expectedOrigin: 'https://wallet.test',
    deliveryRecipientPublicKey65B64u: deliveryRecipient(),
    requestedAtMs: Date.now(),
  });
  home.linkRoutes.targetCredential = target;
  const store = new api.D1LinkedDeviceEmailOtpGrantStoreV1({ database, scope: signerScope });
  const controlled = new ControlledEmailVerification();
  const options = {
    orgId: signerScope.orgId,
    issuer: {},
    verifier: controlled,
    enrollments: controlled,
    walletAuthMethods: {},
    walletAuthorities: {},
    serverSeal: {},
    grants: store,
  };
  home.linkRoutes.emailOtpTargetFactor = new api.D1LinkedDeviceEmailOtpTargetFactorV1(options);
  const challengeId = Buffer.alloc(16, 83).toString('base64url');
  const challenge = await home.linkRoutes.sessionService.recordEmailOtpChallengeStateV1({
    linkSessionId: session.linkSessionId,
    expectedRevision: session.revision,
    challenge: {
      challengeId,
      workerEphemeralPublicKey65B64u: deliveryRecipient(),
      maskedEmailHint: 'regional-grant@example.test',
      expiresAtMs: approval.expiresAtMs,
      resendAvailableAtMs: Date.now(),
    },
    nowMs: Date.now(),
  });
  assert.equal(challenge.outcome, 'applied');
  const verification = {
    kind: 'linked_device_email_otp_challenge_verify_request_v1',
    linkSessionId: session.linkSessionId,
    challengeId,
    otpCode: '123456',
  };
  const issued = await send(
    ingress,
    await device.signedRequest(
      api,
      payload,
      'POST',
      `${path}/email-otp/challenge/verify`,
      verification,
    ),
  );
  assert.equal(issued.status, 200, await issued.clone().text());
  const grant = (await issued.json()).verificationGrant;
  await database.batch(
    store.buildConsumeStatementsV1({ grantId: grant.grantId, consumedAtMs: Date.now() }),
  );
  assert.equal((await store.readByIdV1(grant.grantId)).state.kind, 'consumed');
  await assert.rejects(
    database.batch(
      store.buildConsumeStatementsV1({
        grantId: grant.grantId,
        consumedAtMs: Date.now(),
      }),
    ),
  );

  const paused = new PausedEmailGrantStore(store);
  options.grants = paused;
  home.linkRoutes.emailOtpTargetFactor = new api.D1LinkedDeviceEmailOtpTargetFactorV1(options);
  const pending = send(
    ingress,
    await device.signedRequest(
      api,
      payload,
      'POST',
      `${path}/email-otp/challenge/verify`,
      verification,
    ),
  );
  try {
    await paused.waitForGrant();
    const cancelled = await send(
      ingress,
      await device.signedRequest(api, payload, 'POST', `${path}/cancel`, {
        kind: 'linked_device_session_cancel_claimed_request_v1',
        linkSessionId: payload.linkSessionId,
        enrollmentId: claim.enrollmentId,
        deviceId: claim.deviceId,
        reason: 'user_cancelled',
        requestedAtMs: Date.now(),
      }),
    );
    assert.equal(cancelled.status, 200, await cancelled.clone().text());
  } finally {
    paused.released.resolve();
    await pending;
  }
  const late = await pending;
  assert.equal(late.status, 403, await late.clone().text());
  for (const region of bridges.keys()) {
    const regional = await runtime.getD1Database('SIGNER_DB', region);
    assert.equal(
      await regional
        .prepare(
          'SELECT count(*) AS count FROM linked_device_email_otp_grants WHERE link_session_id = ?',
        )
        .bind(payload.linkSessionId)
        .first('count'),
      0,
    );
  }
  return {
    home: 'WEUR',
    consumedOnce: true,
    secondConsumptionRejected: true,
    cancellationPreventsLateIssuance: true,
    scope:
      'Production regional HTTP, grant creation and D1 consumption; OTP verification and challenge delivery are controlled fixtures.',
  };
}

function ownerPost(ingress, home, path, body) {
  return ingress.fetch(`https://wallet.test${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${home.issued.operationCredential.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function send(ingress, request) {
  return ingress.fetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: await request.arrayBuffer(),
  });
}
