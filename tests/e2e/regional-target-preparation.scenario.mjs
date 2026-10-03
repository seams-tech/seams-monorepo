import { verifyRegionalBrowserRegistration } from './regional-target-registration.scenario.mjs';
import assert from 'node:assert/strict';
import {
  ConcurrentTargetPreparationFixture,
  deliveryRecipient,
} from '../helpers/regional-target-preparation.fixtures.mjs';

export async function verifyRegionalTargetPreparation({
  api,
  deviceFixture,
  runtime,
  bridges,
  signerScope,
  session,
  approval,
}) {
  const planner = new ConcurrentTargetPreparationFixture(
    bridges.get('WEUR').linkSource.targetPlanner,
  );
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
  const apiKeys = api.createInMemoryConsoleApiKeyService({
    scopeValidation: api.WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
  });
  const credential = await apiKeys.createApiKey(
    { orgId: signerScope.orgId, actorUserId: 'regional-target-test' },
    {
      kind: 'publishable_key',
      name: 'Regional target preparation',
      environmentId: signerScope.envId,
      allowedOrigins: ['https://wallet.test'],
      rateLimitBucket: 'default',
      quotaBucket: 'default',
    },
  );
  for (const [region, bridge] of bridges) {
    bridge.targetPublishableKeyAuth = api.createRouterApiPublishableKeyAuthAdapter(apiKeys);
    bridge.linkRoutes.targetCredential =
      region === 'WEUR'
        ? provider
        : new api.D1LinkedDeviceTargetCredentialProviderV1({
            database: await runtime.getD1Database('SIGNER_DB', region),
            scope: signerScope,
            planner,
            verifier: {},
            sourceContributionPreparationPlanner: {},
            verifiedLinkBuilder: {},
          });
  }
  const ingress = await runtime.getWorker('APAC');
  const validHeaders = {
    authorization: `Bearer ${credential.secret}`,
    origin: 'https://wallet.test',
    'x-seams-environment-id': signerScope.envId,
  };
  const httpInput = {
    api,
    deviceFixture,
    ingress,
    session,
    recipient: input.deliveryRecipientPublicKey65B64u,
  };
  const missingKey = await requestPreparation(httpInput, {
    origin: validHeaders.origin,
    'x-seams-environment-id': signerScope.envId,
  });
  assert.equal(missingKey.status, 401, await missingKey.clone().text());
  const invalidKey = await requestPreparation(httpInput, {
    ...validHeaders,
    authorization: 'Bearer pk_invalid',
  });
  assert.equal(invalidKey.status, 401);
  const missingOrigin = await requestPreparation(httpInput, {
    authorization: validHeaders.authorization,
    'x-seams-environment-id': signerScope.envId,
  });
  assert.equal(missingOrigin.status, 403);
  const wrongOrigin = await requestPreparation(httpInput, {
    ...validHeaders,
    origin: 'https://untrusted.test',
  });
  assert.equal(wrongOrigin.status, 403);
  const wrongEnvironment = await requestPreparation(httpInput, {
    ...validHeaders,
    'x-seams-environment-id': 'another-environment',
  });
  assert.equal(wrongEnvironment.status, 403);
  const accepted = await requestPreparation(httpInput, validHeaders);
  assert.equal(accepted.status, 200, await accepted.clone().text());
  assert.equal(accepted.headers.get('x-test-region'), 'WEUR');
  assert.deepEqual(await accepted.json(), JSON.parse(JSON.stringify(attempts[0].value)));
  const changedHttp = await requestPreparation(
    { ...httpInput, recipient: deliveryRecipient() },
    validHeaders,
  );
  assert.equal(changedHttp.status, 409);
  assert.equal(planner.created, 2);
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
  const registration = await verifyRegionalBrowserRegistration({
    api,
    runtime,
    bridges,
    deviceFixture,
    preparation: attempts[0].value,
    headers: validHeaders,
    signerScope,
  });
  return {
    registration,
    preparationHttpAtHome: true,
    productionTargetPreparationPlanner: true,
    publishableKeyOriginAndEnvironmentEnforced: true,
    preparationHttpRecipientConflict: true,
    concurrentPreparations: 2,
    durablePreparations: 1,
    identicalReplay: true,
    changedRecipientConflicts: true,
    scope:
      'Regional preparation HTTP route with real device signatures and production Console key/origin/environment authentication using in-memory key storage. D1 provider, target preparation planner and home dispatch use production code; only concurrent entry is synchronized by the fixture. Browser registration and production source preparation run in the nested scenario. Contribution execution and installation remain open.',
  };
}
function fulfilled(result) {
  return result.status === 'fulfilled';
}
function describeAttempt(result) {
  return result.status === 'rejected' ? String(result.reason) : result.value.kind;
}

async function requestPreparation(input, headers) {
  const request = await input.deviceFixture.signedRequest(
    input.api,
    input.session.qrPayload,
    'POST',
    `/wallet/device-linking/v1/sessions/${encodeURIComponent(input.session.linkSessionId)}/target-preparation`,
    {
      kind: 'linked_device_target_preparation_request_v1',
      linkSessionId: input.session.linkSessionId,
      deliveryRecipientPublicKey65B64u: input.recipient,
    },
  );
  for (const [name, value] of Object.entries(headers)) request.headers.set(name, value);
  return input.ingress.fetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: await request.arrayBuffer(),
  });
}
