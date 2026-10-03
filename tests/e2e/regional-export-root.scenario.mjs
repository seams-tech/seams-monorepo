import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

export async function verifyRegionalExportRootRelay(input) {
  const { api, runtime, bridges, preparation } = input;
  const facts = preparation.ed25519ExportRoot;
  assert.ok(facts);
  const recipient = api.parseLinkedDeviceEd25519ExportRootRecipientV1({
    kind: 'linked_device_ed25519_export_root_recipient_v1',
    linkSessionId: preparation.linkSessionId,
    walletId: preparation.walletId,
    walletKeyId: facts.walletKeyId,
    enrollmentId: preparation.enrollmentId,
    deviceId: preparation.deviceId,
    targetFactor: preparation.targetFactor,
    revocationEpoch: facts.revocationEpoch,
    applicationBindingDigestB64u: facts.applicationBindingDigestB64u,
    registeredPublicKeyB64u: facts.registeredPublicKeyB64u,
    transferAlg: 'x25519-hkdf-sha256-chacha20poly1305-v1',
    recipientPublicKeyB64u: publicKey(),
    registeredAtMs: Date.now(),
  });
  const base = `/wallet/device-linking/v1/sessions/${encodeURIComponent(preparation.linkSessionId)}`;
  const recipientPath = `${base}/ed25519-export-root-recipient`;
  const packagePath = `${base}/ed25519-export-root`;
  const owner = bridges.get('WEUR');
  const us = await runtime.getWorker('US');
  const apac = await runtime.getWorker('APAC');
  assert.equal((await deviceRequest(input, us, packagePath, 'GET', null)).status, 204);
  for (const [ingress, outcome] of [[apac, 'applied'], [us, 'replayed']]) {
    const response = await deviceRequest(input, ingress, recipientPath, 'POST', recipient);
    await expectWrite(response, outcome);
  }
  const readRecipient = await ownerRequest(us, owner, recipientPath, 'GET', null);
  assert.equal(readRecipient.status, 200);
  assert.deepEqual(await readRecipient.json(), recipient);
  const changedRecipient = JSON.parse(JSON.stringify(recipient));
  changedRecipient.recipientPublicKeyB64u = publicKey();
  assert.equal(
    (await deviceRequest(input, us, recipientPath, 'POST', changedRecipient)).status,
    409,
  );
  // Opaque bytes exercise relay persistence; the real protocol contract owns decryption.
  const rawPackage = JSON.parse(JSON.stringify(recipient));
  delete rawPackage.registeredAtMs;
  rawPackage.kind = 'linked_device_ed25519_export_root_package_v1';
  rawPackage.ephemeralPublicKeyB64u = publicKey();
  rawPackage.nonceB64u = Buffer.alloc(12, 3).toString('base64url');
  rawPackage.sealedExportRootB64u = Buffer.alloc(48, 4).toString('base64url');
  rawPackage.bindingDigestB64u = Buffer.alloc(32, 5).toString('base64url');
  rawPackage.ciphertextDigestB64u = Buffer.alloc(32, 6).toString('base64url');
  rawPackage.sealedAtMs = Date.now();
  const sealedPackage = api.parseLinkedDeviceEd25519ExportRootPackageV1(rawPackage);
  const submission = {
    kind: 'linked_device_ed25519_export_root_submission_v1',
    linkSessionId: preparation.linkSessionId,
    package: sealedPackage,
  };
  for (const [ingress, outcome] of [[us, 'applied'], [apac, 'replayed']]) {
    await expectWrite(await ownerRequest(ingress, owner, packagePath, 'POST', submission), outcome);
  }
  const changedPackage = JSON.parse(JSON.stringify(submission));
  changedPackage.package.sealedExportRootB64u = Buffer.alloc(48, 7).toString('base64url');
  assert.equal((await ownerRequest(us, owner, packagePath, 'POST', changedPackage)).status, 409);
  const delivered = await deviceRequest(input, apac, packagePath, 'GET', null);
  assert.equal(delivered.status, 200);
  assert.equal(delivered.headers.get('x-test-region'), 'WEUR');
  assert.deepEqual(await delivered.json(), sealedPackage);
  for (const region of bridges.keys()) {
    const database = await runtime.getD1Database('SIGNER_DB', region);
    const count = await database.prepare(
      'SELECT count(*) AS count FROM linked_device_ed25519_export_root_transfers WHERE link_session_id = ?',
    ).bind(preparation.linkSessionId).first('count');
    assert.equal(count, region === 'WEUR' ? 1 : 0);
  }
  return {
    home: 'WEUR',
    recipientAndPackagePersistedOnlyAtHome: true,
    crossIngressRetriesReplay: true,
    changedRecipientAndPackageConflict: true,
    deliveredPackageMatchesSubmission: true,
    scope: 'Production authenticated HTTP and D1 relay with opaque fixture ciphertext; encryption, installation and cleanup are separate gates.',
  };
}

function publicKey() {
  return generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' }).x;
}

async function deviceRequest(input, ingress, path, method, body) {
  const request = await input.deviceFixture.signedRequest(
    input.api, input.preparation, method, path, body,
  );
  for (const [name, value] of Object.entries(input.headers)) request.headers.set(name, value);
  return ingress.fetch(request.url, {
    method,
    headers: Object.fromEntries(request.headers),
    ...(method === 'GET' ? {} : { body: await request.arrayBuffer() }),
  });
}

function ownerRequest(ingress, owner, path, method, body) {
  return ingress.fetch(`https://wallet.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${owner.issued.operationCredential.token}`,
      'content-type': 'application/json',
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}

async function expectWrite(response, outcome) {
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('x-test-region'), 'WEUR');
  assert.equal((await response.json()).outcome, outcome);
}
