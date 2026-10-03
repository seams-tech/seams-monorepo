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
  directory,
  catalog,
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
  const terminalRaces = await verifyTerminalClaims({
    api,
    directory,
    catalog,
    bridges,
    signerScope,
  });
  return {
    terminalRaces,
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

async function reserveTerminalHome({ api, directory, catalog, signerScope }, region, index) {
  const wallet = api.WalletOwnershipKey.parse({
    namespace: signerScope.namespace,
    organizationId: signerScope.orgId,
    projectId: signerScope.projectId,
    environmentId: signerScope.envId,
    walletId: `wallet:terminal-${index}`,
  });
  const home = catalog.select(region);
  const registrationId = `terminal-${index}`;
  const requestDigest = 'b'.repeat(64);
  const reserved = await directory.reserve({
    allocation: 'provided',
    wallet,
    proposedHome: home,
    registrationId,
    requestDigest,
    deploymentLane: 'test',
    nowMs: Date.now(),
    proposedRegistrationAllocation: api.RegistrationSetupAllocation.parse({
      ceremonyId: `wrc_terminal-${index}`,
      preparationId: `regprep_terminal-${index}`,
      walletAuthorityId: `wallet-authority:terminal-${index}`,
      deviceId: `device:terminal-${index}`,
      walletAuthMethodId: `wallet-auth-method:terminal-${index}`,
    }),
  });
  assert.equal(reserved.ok, true);
  return { wallet, home, registrationId, requestDigest };
}

async function verifyTerminalClaims(input) {
  let index = 0;
  for (const [region, bridge] of input.bridges) {
    const claimedHome = await reserveTerminalHome(input, region, index++);
    const credential = {
      walletId: claimedHome.wallet.walletId,
      rpId: 'wallet.test',
      credentialIdB64u: Buffer.from(`terminal-${index}`).toString('base64url'),
    };
    assert.equal(await bridge.publisher.claim(credential), true);
    await assert.rejects(
      bridge.publisher.complete({ ...claimedHome, outcome: 'cancelled' }),
      /Wallet home completion failed: HTTP 409/,
    );
    assert.equal((await input.directory.find(claimedHome.wallet)).state, 'reserved');
    assert.equal(await bridge.publisher.claim(credential), true);
    assert.equal(
      (await bridge.publisher.complete({ ...claimedHome, outcome: 'established' })).state,
      'established',
    );

    const cancelledHome = await reserveTerminalHome(input, region, index++);
    await bridge.publisher.complete({ ...cancelledHome, outcome: 'cancelled' });
    assert.equal(
      await bridge.publisher.claim({
        ...credential,
        walletId: cancelledHome.wallet.walletId,
        credentialIdB64u: Buffer.from(`terminal-${index}`).toString('base64url'),
      }),
      false,
    );

    const racingHome = await reserveTerminalHome(input, region, index++);
    const racingCredential = {
      ...credential,
      walletId: racingHome.wallet.walletId,
      credentialIdB64u: Buffer.from(`terminal-${index}`).toString('base64url'),
    };
    const [claim, cancel] = await Promise.allSettled([
      bridge.publisher.claim(racingCredential),
      bridge.publisher.complete({ ...racingHome, outcome: 'cancelled' }),
    ]);
    assert.equal(claim.status, 'fulfilled');
    const assignment = await input.directory.find(racingHome.wallet);
    if (claim.value) {
      assert.equal(cancel.status, 'rejected');
      assert.match(cancel.reason.message, /Wallet home completion failed: HTTP 409/);
      assert.equal(assignment.state, 'reserved');
    } else {
      assert.equal(cancel.status, 'fulfilled');
      assert.equal(assignment.state, 'cancelled');
    }
    assert.equal(await bridge.publisher.claim(racingCredential), claim.value);
  }
  return {
    homes: index,
    regions: input.bridges.size,
    claimedHomesCannotCancel: true,
    cancelledHomesCannotClaim: true,
    concurrentClaimAndCancellationAreExclusive: true,
  };
}
