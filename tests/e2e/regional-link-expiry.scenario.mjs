import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { RegionalDeviceProofFixture } from '../helpers/regional-device-proof.fixtures.mjs';
import { deliveryRecipient } from '../helpers/regional-target-preparation.fixtures.mjs';

export async function verifyRegionalLinkExpiry({ api, runtime, bridges, signerScope }) {
  const device = new RegionalDeviceProofFixture();
  const sessions = [];
  for (const [region, home] of bridges) {
    const ingress = await runtime.getWorker(region === 'US' ? 'APAC' : 'US');
    for (const stage of ['unclaimed', 'prepared']) {
      const create = await device.createRequest(api, `expiry-${region}-${stage}`);
      const { payload } = await create.clone().json();
      const path = `/wallet/device-linking/v1/sessions/${encodeURIComponent(payload.linkSessionId)}`;
      const database = await runtime.getD1Database('SIGNER_DB', region);
      assert.equal((await send(ingress, create)).status, 200);
      if (stage === 'prepared') {
        await home.linkSource.walletStore.putSigner(home.ownerSigner);
        const claimResponse = await ownerPost(ingress, home, `${path}/claim`, {
          kind: 'linked_device_session_claim_request_v1',
          payload,
        });
        assert.equal(claimResponse.status, 200, await claimResponse.clone().text());
        const approval = home.linkApproval.approval(await claimResponse.json(), payload);
        const approved = await ownerPost(ingress, home, `${path}/approval`, approval);
        assert.equal(approved.status, 200, await approved.clone().text());
        const provider = new api.D1LinkedDeviceTargetCredentialProviderV1({
          database,
          scope: signerScope,
          planner: home.linkSource.targetPlanner,
          verifier: {},
          sourceContributionPreparationPlanner: {},
          verifiedLinkBuilder: {},
        });
        await provider.getTargetPreparationV1({
          session: await home.linkRoutes.sessionService.getSessionV1({
            linkSessionId: payload.linkSessionId,
            nowMs: Date.now(),
          }),
          approval,
          access: 'create_or_replay',
          expectedOrigin: 'https://wallet.test',
          deliveryRecipientPublicKey65B64u: deliveryRecipient(),
          requestedAtMs: Date.now(),
        });
        assert.equal(await count(database, 'linked_device_target_credentials', payload), 1);
        assert.equal(await count(database, 'linked_device_session_transcripts', payload), 2);
      }
      sessions.push({ region, home, ingress, database, stage, path, payload });
    }
  }

  const sharedDatabase = await runtime.getD1Database('CONSOLE_DB', 'console');
  let expiresAtMs = Math.max(...sessions.map(sessionExpiry));
  let originalProofNonces = 0;
  for (const { payload } of sessions) {
    const nonces = await sharedDatabase
      .prepare(
        'SELECT count(*) AS count, max(expires_at_ms) AS expiry FROM linked_device_request_proof_nonces WHERE link_session_id = ?',
      )
      .bind(payload.linkSessionId)
      .first();
    assert.ok(nonces.count > 0);
    originalProofNonces += nonces.count;
    expiresAtMs = Math.max(expiresAtMs, nonces.expiry);
  }
  await setTimeout(Math.max(0, expiresAtMs - Date.now()) + 25);
  const observations = [];
  for (const session of sessions) {
    const { region, home, ingress, database, stage, path, payload } = session;
    const poll = await send(ingress, await device.signedRequest(api, payload, 'GET', path, null));
    assert.equal(poll.status, 200, await poll.clone().text());
    assert.equal((await poll.json()).session.state.state, 'expired');
    if (stage === 'prepared') assert.equal(poll.headers.get('x-test-region'), region);
    const replay = await send(ingress, await device.signedRequest(api, payload, 'GET', path, null));
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).session.state.state, 'expired');
    const delivery = await send(
      ingress,
      await device.signedRequest(api, payload, 'GET', `${path}/approval`, null),
    );
    assert.equal(delivery.status, 409);
    assert.equal((await delivery.json()).outcome, 'invalid_state');
    const stores = [];
    for (const candidateRegion of bridges.keys()) {
      const candidateDatabase = await runtime.getD1Database('SIGNER_DB', candidateRegion);
      const rows = {};
      for (const table of [
        'linked_device_session_transcripts',
        'linked_device_target_credentials',
        'linked_device_target_commit_reservations',
        'linked_device_email_otp_grants',
        'linked_device_ed25519_export_root_transfers',
        'linked_device_authority_allocations',
      ]) {
        rows[table] = await count(candidateDatabase, table, payload);
        assert.equal(rows[table], 0, `${candidateRegion}/${table}/${stage}`);
      }
      const terminalSessions = await count(candidateDatabase, 'linked_device_sessions', payload);
      assert.equal(terminalSessions, stage === 'prepared' && candidateRegion === region ? 1 : 0);
      stores.push({ region: candidateRegion, terminalSessions, rows });
    }
    const locator = api.WalletRouteLocator.parse({
      kind: 'linked_device',
      value: payload.linkSessionId,
    });
    const route = await home.publisher.findRoute(locator);
    if (stage === 'prepared') {
      assert.equal(route.wallet.walletId, home.issued.session.walletId);
      await database
        .prepare('DELETE FROM linked_device_sessions WHERE link_session_id = ?')
        .bind(payload.linkSessionId)
        .run();
      const missing = await send(
        ingress,
        await device.signedRequest(api, payload, 'GET', path, null),
      );
      assert.equal(missing.status, 404);
      assert.equal(
        (await home.publisher.findRoute(locator)).wallet.walletId,
        home.issued.session.walletId,
      );
    } else {
      assert.equal(route, null);
    }
    const renewed = api.parseQrLinkedDeviceSessionPayloadV5({
      ...payload,
      issuedAtMs: Date.now(),
      expiresAtMs: Date.now() + 30_000,
    });
    const recreate = await send(ingress, await device.createReplayRequest(api, renewed));
    assert.equal(recreate.status, 409, await recreate.clone().text());
    for (const candidateRegion of bridges.keys()) {
      assert.equal(
        await count(
          await runtime.getD1Database('SIGNER_DB', candidateRegion),
          'linked_device_sessions',
          payload,
        ),
        0,
      );
    }
    observations.push({
      region,
      stage,
      expiredPollStatus: poll.status,
      replayStatus: replay.status,
      approvalStatus: delivery.status,
      recreationStatus: recreate.status,
      stores,
      retainedHome: route ? region : null,
    });
  }
  let freshProofNonces = 0;
  for (const { payload } of sessions) {
    const expired = await sharedDatabase
      .prepare(
        'SELECT count(*) AS count FROM linked_device_request_proof_nonces WHERE link_session_id = ? AND expires_at_ms <= ?',
      )
      .bind(payload.linkSessionId, expiresAtMs)
      .first('count');
    assert.equal(expired, 0, 'Subsequent device proofs must prune expired shared nonces');
    freshProofNonces += await count(sharedDatabase, 'linked_device_request_proof_nonces', payload);
    for (const region of bridges.keys()) {
      assert.equal(
        await count(
          await runtime.getD1Database('SIGNER_DB', region),
          'linked_device_request_proof_nonces',
          payload,
        ),
        0,
      );
    }
  }
  assert.ok(freshProofNonces > 0, 'Unexpired replay guards must remain in Console');
  return {
    observations,
    proofNonces: {
      original: originalProofNonces,
      expiredRemaining: 0,
      freshRetained: freshProofNonces,
    },
    scope:
      'Real elapsed QR expiry, signed foreign-ingress polling, production Console/Gateway dispatch and D1 terminal cleanup. Prepared sessions have persisted approval and target preparation; signer material is synthetic. Terminal-row pruning is injected directly; no scheduled pruning or process restart is claimed.',
  };
}

function sessionExpiry(session) {
  return session.payload.expiresAtMs;
}

async function count(database, table, payload) {
  return database
    .prepare(`SELECT count(*) AS count FROM ${table} WHERE link_session_id = ?`)
    .bind(payload.linkSessionId)
    .first('count');
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
    ...(request.method === 'GET' ? {} : { body: await request.arrayBuffer() }),
  });
}
