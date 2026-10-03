import assert from 'node:assert/strict';
import {
  ConcurrentTargetPreparationFixture,
  deliveryRecipient,
} from '../helpers/regional-target-preparation.fixtures.mjs';

export async function verifyRegionalTargetPreparation({
  api,
  runtime,
  bridges,
  signerScope,
  session,
  approval,
}) {
  const planner = new ConcurrentTargetPreparationFixture(api);
  const provider = new api.D1LinkedDeviceTargetCredentialProviderV1({
    database: await runtime.getD1Database('SIGNER_DB', 'WEUR'),
    scope: signerScope,
    planner,
    verifier: {},
    sourceContributionPreparationPlanner: {},
    verifiedLinkBuilder: {},
  });
  const input = {
    session,
    approval,
    access: 'create_or_replay',
    expectedOrigin: 'https://wallet.test',
    deliveryRecipientPublicKey65B64u: deliveryRecipient(),
    requestedAtMs: Date.now(),
  };
  const attempts = await Promise.allSettled([
    provider.getTargetPreparationV1(input),
    provider.getTargetPreparationV1(input),
  ]);
  assert.equal(attempts.filter(fulfilled).length, 2, attempts.map(describeAttempt).join('\n'));
  assert.equal(planner.created, 2);
  assert.deepEqual(attempts[0].value, attempts[1].value);
  assert.deepEqual(await provider.getTargetPreparationV1(input), attempts[0].value);
  const changed = await provider.getTargetPreparationV1({
    ...input,
    deliveryRecipientPublicKey65B64u: deliveryRecipient(),
  });
  assert.equal(changed.kind, 'conflict');
  for (const region of bridges.keys()) {
    const database = await runtime.getD1Database('SIGNER_DB', region);
    const count = await database
      .prepare(
        'SELECT count(*) AS count FROM linked_device_target_credentials WHERE link_session_id = ?',
      )
      .bind(session.linkSessionId)
      .first('count');
    assert.equal(count, region === 'WEUR' ? 1 : 0);
  }
  return {
    concurrentPreparations: 2,
    durablePreparations: 1,
    identicalReplay: true,
    changedRecipientConflicts: true,
    scope:
      'Production D1 target credential provider after regional HTTP approval; planner is controlled to force concurrent fresh challenges. Target preparation HTTP authentication, WebAuthn registration, source contribution and installation remain open.',
  };
}
function fulfilled(result) {
  return result.status === 'fulfilled';
}
function describeAttempt(result) {
  return result.status === 'rejected' ? String(result.reason) : result.value.kind;
}
