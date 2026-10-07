import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const credential = 'private-d1-gateway-router-auth';
const preparePath = '/router-ab/ed25519/sign/prepare';
const finalizePath = '/router-ab/ed25519/sign';

class LostFinalizeReply {
  committed = null;
  constructor(router) {
    this.router = router;
  }
  async fetch(url, init) {
    const response = await this.router.fetch(url, init);
    if (new URL(url).pathname === finalizePath && !this.committed) {
      assert.equal(response.status, 200, await response.clone().text());
      this.committed = await response.json();
      return new Response('Injected lost finalize reply after commit', { status: 503 });
    }
    return response;
  }
}

export async function prepareSigningBeforeMove(custody, publicRoot) {
  const api = await import(
    pathToFileURL(
      resolve(publicRoot, 'crates/router-ab-cloudflare/scripts/ed25519-signing-evidence.mjs'),
    )
  );
  const router = await custody.topology.getWorker('router');
  const activation = custody.registration.result.result.result;
  const fixture = api.signingFixture(publicRoot, {
    command: 'prepare',
    activation,
    identity: custody.fixture.tenant_root_creation.identity,
    ownership_generation: 1,
    expires_at_ms: Date.now() + 120_000,
  });
  const prepare = { ...fixture.prepare, authorized_operation: fixture.authorized_operation };
  const response = await api.post(router, preparePath, prepare, credential);
  assert.equal(response.status, 200, await response.clone().text());
  const prepared = await response.json();
  const finalize = api.signingFixture(publicRoot, {
    command: 'finalize',
    activation,
    client_recipient_seed: custody.fixture.activation.client_recipient_seed,
    prepare: fixture.prepare,
    prepared,
    authorized_operation: fixture.authorized_operation,
  });
  return { api, router, activation, fixture, prepare, finalize, prepared };
}

export async function finalizeWhileMoveWaits(pending) {
  const lost = new LostFinalizeReply(pending.router);
  const first = await pending.api.post(lost, finalizePath, pending.finalize, credential);
  assert.equal(first.status, 503);
  const retried = await pending.api.post(lost, finalizePath, pending.finalize, credential);
  assert.equal(retried.status, 200, await retried.clone().text());
  const signature = await retried.json();
  assert.deepEqual(signature, lost.committed);
  return {
    signatureSha256Hex: pending.api.verifySigningResponse(
      signature,
      pending.fixture,
      pending.activation,
    ),
    lostFinalizeReplyRecoveredBeforeCutover: true,
    signature,
  };
}

export async function verifySigningReplayAfterMove(pending, custody, signature) {
  const destination = await custody.topology.getWorker('destination-router');
  const sourceResponse = await pending.api.post(
    pending.router,
    finalizePath,
    pending.finalize,
    credential,
  );
  const destinationResponse = await pending.api.post(
    destination,
    finalizePath,
    pending.finalize,
    credential,
  );
  assert.notEqual(
    sourceResponse.status,
    200,
    'Retired source must reject the original finalization',
  );
  assert.match(await sourceResponse.text(), /Ed25519 source signing has settled/);
  assert.equal(destinationResponse.status, 200, await destinationResponse.clone().text());
  assert.deepEqual(await destinationResponse.json(), signature);
  const changed = structuredClone(pending.finalize);
  changed.authorized_operation.binding.ownership_generation = 2;
  const changedResponse = await pending.api.post(destination, finalizePath, changed, credential);
  assert.notEqual(
    changedResponse.status,
    200,
    'A changed request must not reuse the terminal result',
  );
  assert.match(await changedResponse.text(), /different request material/);
  return {
    retiredSourceReasonVerified: true,
    changedFinalizationReasonVerified: true,
    retiredSourceStatus: sourceResponse.status,
    destinationTerminalReplayVerified: true,
    changedFinalizationStatus: changedResponse.status,
  };
}
