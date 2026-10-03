import assert from 'node:assert/strict';
import { buildPasskeyCredentialBindingFixture } from '../helpers/regional-authentication.fixtures.mjs';

async function insertBinding(store, record) {
  const statement = await store.prepareCredentialBindingInsertStatement(record);
  await statement.run();
}
function fulfilled(result) {
  return result.status === 'fulfilled';
}

export async function verifyRegionalPasskeyClaims({
  api,
  runtime,
  bridges,
  consoleBridge,
  signerScope,
}) {
  const credentialId = Buffer.alloc(32, 83).toString('base64url');
  const contenders = [];
  const stores = new Map();
  for (const [region, bridge] of bridges) {
    const database = await runtime.getD1Database('SIGNER_DB', region);
    const store = new api.CloudflareD1WebAuthnStore({
      database,
      ...signerScope,
      credentialClaims: bridge.publisher,
    });
    stores.set(region, store);
    contenders.push(
      insertBinding(
        store,
        buildPasskeyCredentialBindingFixture(bridge.authMethod, Date.now(), credentialId),
      ),
    );
  }
  const results = await Promise.allSettled(contenders);
  assert.equal(results.filter(fulfilled).length, 1);
  for (const result of results) {
    if (result.status === 'rejected') {
      assert.match(result.reason.message, /Passkey credential belongs to another wallet or home/);
    }
  }
  let committed = 0;
  for (const store of stores.values()) {
    if (await store.readBindingByCredentialId(credentialId)) committed += 1;
  }
  assert.equal(committed, 1);

  const us = bridges.get('US');
  const interruptedId = Buffer.alloc(32, 84).toString('base64url');
  const record = buildPasskeyCredentialBindingFixture(us.authMethod, Date.now(), interruptedId);
  await stores.get('US').prepareCredentialBindingInsertStatement(record);
  assert.equal(await stores.get('US').readBindingByCredentialId(interruptedId), null);
  await assert.rejects(
    insertBinding(
      stores.get('APAC'),
      buildPasskeyCredentialBindingFixture(
        bridges.get('APAC').authMethod,
        Date.now(),
        interruptedId,
      ),
    ),
  );
  await insertBinding(stores.get('US'), record);
  assert.equal(
    (await stores.get('US').readBindingByCredentialId(interruptedId)).userId,
    record.userId,
  );
  assert.equal(
    await bridges.get('APAC').publisher.claim({
      walletId: record.userId,
      rpId: record.rpId,
      credentialIdB64u: interruptedId,
    }),
    false,
  );

  consoleBridge.available = false;
  try {
    await assert.rejects(
      insertBinding(
        stores.get('WEUR'),
        buildPasskeyCredentialBindingFixture(
          bridges.get('WEUR').authMethod,
          Date.now(),
          Buffer.alloc(32, 85).toString('base64url'),
        ),
      ),
    );
  } finally {
    consoleBridge.available = true;
  }
  return {
    competingRegions: results.length,
    committedOwners: committed,
    reservationSurvivesInterruptedRegionalWrite: true,
    reservationAloneCreatesNoLocalBinding: true,
    originalOwnerCanRetry: true,
    foreignWriterRejected: true,
    outageRejectsBeforeRegionalWrite: true,
    scope:
      'Production credential-binding promotion through three admitted home writers and shared D1 authority. Complete registration, recovery and linked-device ceremonies remain separate acceptance gates.',
  };
}
