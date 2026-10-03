import assert from 'node:assert/strict';
import { browserTargetRegistration } from '../helpers/regional-browser-registration.fixtures.mjs';

export async function verifyRegionalBrowserRegistration({
  api,
  runtime,
  bridges,
  deviceFixture,
  preparation,
  headers,
  signerScope,
}) {
  const registration = await browserTargetRegistration(api, preparation);
  const verifier = new api.LinkedDeviceWebAuthnRegistrationVerifierV1('wallet.test');
  const verified = await verifier.verifyRegistrationV1({
    preparation,
    registration,
    expectedOrigin: 'https://wallet.test',
  });
  assert.equal(verified.kind, 'verified', JSON.stringify(verified));
  assert.equal(
    verified.credential.credentialIdB64u,
    registration.webauthnRegistration.credentialIdB64u,
  );
  const altered = JSON.parse(JSON.stringify(registration));
  const clientData = JSON.parse(
    Buffer.from(altered.webauthnRegistration.clientDataJsonB64u, 'base64url').toString(),
  );
  clientData.challenge = Buffer.alloc(32, 99).toString('base64url');
  altered.webauthnRegistration.clientDataJsonB64u = Buffer.from(
    JSON.stringify(clientData),
  ).toString('base64url');
  const rejected = await verifier.verifyRegistrationV1({
    preparation,
    registration: api.parseLinkedDeviceTargetCredentialRegistrationV1(altered),
    expectedOrigin: 'https://wallet.test',
  });
  assert.equal(rejected.kind, 'rejected');
  const wrongConfiguration = await verifier.verifyRegistrationV1({
    preparation,
    registration,
    expectedOrigin: 'https://other.test',
  });
  assert.equal(wrongConfiguration.kind, 'rejected');
  const weur = bridges.get('WEUR');
  const source = new UnavailableSourceFixture();
  weur.linkRoutes.targetCredential = new api.D1LinkedDeviceTargetCredentialProviderV1({
    database: await runtime.getD1Database('SIGNER_DB', 'WEUR'),
    scope: signerScope,
    planner: {},
    verifier,
    sourceContributionPreparationPlanner: {},
    verifiedLinkBuilder: { source },
  });
  const ingress = await runtime.getWorker('APAC');
  const database = await runtime.getD1Database('SIGNER_DB', 'WEUR');
  const http = { api, deviceFixture, ingress, headers };
  const invalid = await submitCredential(http, altered);
  assert.equal(invalid.status, 400);
  assert.equal(source.reads, 0);
  assert.equal(await reservationCount(database, preparation.linkSessionId), 0);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await submitCredential(http, registration);
    assert.equal(response.headers.get('x-test-region'), 'WEUR');
    assert.equal(response.status, 400, await response.clone().text());
    assert.match((await response.json()).message, /Controlled source unavailable/u);
    assert.equal(source.reads, attempt);
    assert.equal(await reservationCount(database, preparation.linkSessionId), 0);
  }
  const row = await database
    .prepare('SELECT state FROM linked_device_target_credentials WHERE link_session_id = ?')
    .bind(preparation.linkSessionId)
    .first();
  assert.equal(row.state, 'prepared');
  return {
    browser: 'Chromium virtual authenticator',
    realRegistrationVerified: true,
    alteredChallengeRejected: true,
    changedConfigurationRejected: true,
    credentialHttpAtHome: true,
    sourceFailureDoesNotRegisterCredential: true,
    failedRegistrationReleasesReservation: true,
    freshProofRetryReachesSourceAgain: true,
    scope:
      'Real browser WebAuthn response and target verifier, signed credential HTTP at WEUR. Source lookup deliberately fails after factor verification; successful credential persistence, source contribution and final installation remain open.',
  };
}
class UnavailableSourceFixture {
  reads = 0;
  readVerifiedSourceV1() {
    this.reads++;
    throw new Error('Controlled source unavailable');
  }
}

async function submitCredential(input, registration) {
  const request = await input.deviceFixture.signedRequest(
    input.api,
    { linkSessionId: registration.linkSessionId },
    'POST',
    `/wallet/device-linking/v1/sessions/${encodeURIComponent(registration.linkSessionId)}/credential`,
    registration,
  );
  for (const [name, value] of Object.entries(input.headers)) request.headers.set(name, value);
  return input.ingress.fetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: await request.arrayBuffer(),
  });
}
async function reservationCount(database, linkSessionId) {
  return database
    .prepare(
      'SELECT count(*) AS count FROM linked_device_target_commit_reservations WHERE link_session_id = ?',
    )
    .bind(linkSessionId)
    .first('count');
}
