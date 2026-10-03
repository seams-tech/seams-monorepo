import assert from 'node:assert/strict';

class RecoveryHomeFixture {
  constructor(api, store, database, scope, walletId, region) {
    this.api = api;
    this.store = store;
    this.database = database;
    this.scope = scope;
    this.walletId = walletId;
    this.region = region;
    this.operations = new Set();
  }

  async handle(request) {
    const body = await request.json();
    if (new URL(request.url).pathname === '/wallets/recovery/prepare') {
      const bytes = this.api.base64UrlDecode(body.recoveryCodeB64u);
      const digest = await this.api.deriveRecoveryCodeLocatorV1FromBytes(bytes);
      bytes.fill(0);
      const located = await this.store.readRecoveryCodeLocator(digest);
      if (!located) return refusedCode();
      const operationId = `wallet-recovery-operation:${this.region}`;
      await this.store.publishRecoveryOperation(located.walletId, operationId);
      this.operations.add(operationId);
      return Response.json({ region: this.region, walletId: located.walletId, operationId });
    }
    if (
      [
        '/wallets/recovery/read',
        '/wallets/recovery/rotate',
        '/wallets/recovery/acknowledge-backup',
      ].includes(new URL(request.url).pathname)
    ) {
      const set = await this.store.readRecoveryEnvelopeSet(body.walletId);
      return Response.json({ region: this.region, found: Boolean(set) });
    }
    if (!this.operations.has(body.recoveryOperationId)) return refusedCode();
    return Response.json({ region: this.region, walletId: this.walletId });
  }
}

export async function verifyRegionalRecoveryRouting({
  api,
  runtime,
  bridges,
  consoleBridge,
  authorityDatabase,
  signerScope,
}) {
  const observations = [];
  for (const [region, bridge] of bridges) {
    const database = await runtime.getD1Database('SIGNER_DB', region);
    const walletId = bridge.issued.session.walletId;
    const store = new api.CloudflareD1WalletCustodyCommitStore({
      database,
      scope: signerScope,
      recoveryRouting: bridge.publisher,
    });
    bridge.recovery = new RecoveryHomeFixture(api, store, database, signerScope, walletId, region);
    const fixture = await recoveryCustodyFixture(api, bridge.issued.session, region, 1);
    bridge.recoveryCode = fixture.codes[0];
    bridge.recoveryDigest = fixture.commit.recoveryCodeLocators[0].locatorB64u;
    consoleBridge.available = false;
    await assert.rejects(store.commitRegistration(fixture.commit));
    assert.equal(await store.readRecoveryEnvelopeSet(walletId), null);
    consoleBridge.available = true;
    const committed = await store.commitRegistration(fixture.commit);
    assert.equal(committed.kind, 'committed');
    assert.equal((await store.commitRegistration(fixture.commit)).kind, 'already_exists');
  }
  for (const [region, bridge] of bridges) {
    const ingress = await runtime.getWorker(region === 'US' ? 'APAC' : 'US');
    const prepared = await ingress.fetch(
      'https://wallet.test/wallets/recovery/prepare',
      post({ recoveryCodeB64u: bridge.recoveryCode }),
    );
    assert.equal(prepared.status, 200);
    const preparation = await prepared.json();
    assert.equal(preparation.region, region);
    for (const suffix of [
      'finalize',
      'google/verify',
      'email-otp/verify',
      'email-otp/release',
      'google-email-otp/finalize',
    ]) {
      const response = await ingress.fetch(
        `https://wallet.test/wallets/recovery/${suffix}`,
        post({ recoveryOperationId: preparation.operationId }),
      );
      assert.deepEqual(await response.json(), { region, walletId: bridge.issued.session.walletId });
    }
    for (const suffix of ['read', 'rotate', 'acknowledge-backup']) {
      const response = await ingress.fetch(
        `https://wallet.test/wallets/recovery/${suffix}`,
        post({ walletId: bridge.issued.session.walletId }),
      );
      assert.deepEqual(await response.json(), { region, found: true });
    }
    const wrong = bridges.get(region === 'US' ? 'WEUR' : 'US');
    const mismatch = await ingress.fetch(
      'https://wallet.test/wallets/recovery/finalize',
      post({
        recoveryOperationId: preparation.operationId,
        walletId: wrong.issued.session.walletId,
      }),
    );
    assert.equal(mismatch.status, 401);
    const wrongWriter = await wrong.publisher.publishRecovery({
      kind: 'codes',
      walletId: bridge.issued.session.walletId,
      locators: [bridge.recoveryDigest],
    });
    assert.equal(wrongWriter.ok, false);
    const rejected = await ingress.fetch('https://wallet.test/wallets/recovery/prepare', {
      ...post({ recoveryCodeB64u: bridge.recoveryCode }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${wrong.linkedCredential}`,
      },
    });
    assert.equal(rejected.status, 403);
    const storedSet = await bridge.recovery.store.readRecoveryEnvelopeSet(
      bridge.issued.session.walletId,
    );
    assert.ok(storedSet);
    const replacement = await recoveryCustodyFixture(api, bridge.issued.session, region, 2);
    consoleBridge.available = false;
    await assert.rejects(
      bridge.recovery.store.replaceRecoveryEnvelopeSetAndPreserveBackupAcknowledgement({
        record: replacement.commit.recoverySet,
        expectedRecoverySetVersion: storedSet.storeVersion,
        recoveryCodeLocators: replacement.commit.recoveryCodeLocators,
      }),
    );
    consoleBridge.available = true;
    assert.ok(await bridge.recovery.store.readRecoveryCodeLocator(bridge.recoveryDigest));
    const rotated =
      await bridge.recovery.store.replaceRecoveryEnvelopeSetAndPreserveBackupAcknowledgement({
        record: replacement.commit.recoverySet,
        expectedRecoverySetVersion: storedSet.storeVersion,
        recoveryCodeLocators: replacement.commit.recoveryCodeLocators,
      });
    assert.equal(rotated.kind, 'stored');
    const retired = await ingress.fetch(
      'https://wallet.test/wallets/recovery/prepare',
      post({ recoveryCodeB64u: bridge.recoveryCode }),
    );
    assert.deepEqual(await retired.json(), rejectedCodeBody());
    assert.equal(retired.status, 401);
    observations.push({
      region,
      operationId: preparation.operationId,
      continuations: 5,
      administrationRoutes: 3,
      retiredCodeRejectedAtHome: true,
    });
  }
  const us = bridges.get('US');
  const weur = bridges.get('WEUR');
  const collisionDigest = await api.deriveRecoveryCodeLocatorV1FromBytes(
    new Uint8Array(api.EMAIL_OTP_RECOVERY_KEY_BYTE_LENGTH).fill(9),
  );
  const contenders = await Promise.all([
    us.publisher.publishRecovery({
      kind: 'codes',
      walletId: us.issued.session.walletId,
      locators: [collisionDigest],
    }),
    weur.publisher.publishRecovery({
      kind: 'codes',
      walletId: weur.issued.session.walletId,
      locators: [collisionDigest],
    }),
  ]);
  assert.equal(contenders.filter(won).length, 1);
  const loser = contenders[0].ok ? weur : us;
  const freshDigest = await api.deriveRecoveryCodeLocatorV1FromBytes(
    new Uint8Array(api.EMAIL_OTP_RECOVERY_KEY_BYTE_LENGTH).fill(10),
  );
  assert.equal(
    (
      await loser.publisher.publishRecovery({
        kind: 'codes',
        walletId: loser.issued.session.walletId,
        locators: [freshDigest, collisionDigest],
      })
    ).ok,
    false,
  );
  assert.equal(
    await authorityDatabase
      .prepare('SELECT COUNT(*) AS count FROM wallet_recovery_routes WHERE value = ?1')
      .bind(freshDigest)
      .first('count'),
    0,
  );
  const beforeOutage = await authorityDatabase
    .prepare('SELECT COUNT(*) AS count FROM wallet_recovery_routes')
    .first('count');
  consoleBridge.available = false;
  await assert.rejects(
    us.publisher.publishRecovery({
      kind: 'codes',
      walletId: us.issued.session.walletId,
      locators: [freshDigest],
    }),
  );
  const ingress = await runtime.getWorker('APAC');
  const outage = await ingress.fetch(
    'https://wallet.test/wallets/recovery/prepare',
    post({ recoveryCodeB64u: us.recoveryCode }),
  );
  assert.equal(outage.status, 503);
  consoleBridge.available = true;
  assert.equal(
    await authorityDatabase
      .prepare('SELECT COUNT(*) AS count FROM wallet_recovery_routes')
      .first('count'),
    beforeOutage,
  );
  const unknown = await ingress.fetch(
    'https://wallet.test/wallets/recovery/prepare',
    post({
      recoveryCodeB64u: api.base64UrlEncode(
        new Uint8Array(api.EMAIL_OTP_RECOVERY_KEY_BYTE_LENGTH).fill(11),
      ),
    }),
  );
  assert.equal(unknown.status, 401);
  assert.deepEqual(await unknown.json(), rejectedCodeBody());
  const rows = await authorityDatabase
    .prepare('SELECT kind, value, wallet_id FROM wallet_recovery_routes')
    .all();
  for (const bridge of bridges.values())
    assert.ok(!JSON.stringify(rows.results).includes(bridge.recoveryCode));
  return {
    observations,
    sameCodeConcurrentClaimsHaveOneWinner: true,
    mixedCollisionClaimsInsertNothing: true,
    wrongHomeWriterRejected: true,
    directoryOutageFailsClosed: true,
    codeSecretsAbsentFromDirectory: true,
    scope:
      'Production directory/dispatch and home-local locator reader; code issuance, retirement and operation proof checks use controlled fixtures. No custody cryptography or full recovery ceremony.',
  };
}

function won(result) {
  return result.ok;
}
function post(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
function rejectedCodeBody() {
  return {
    ok: false,
    code: 'recovery_code_rejected',
    message: 'that recovery code cannot be used',
  };
}
function refusedCode() {
  return Response.json(rejectedCodeBody(), { status: 401 });
}

async function recoveryCustodyFixture(api, session, region, issuance) {
  const walletId = session.walletId;
  const now = 1_790_000_000_000 + issuance;
  const nonce = api.parseEnvelopeNonceB64u(api.base64UrlEncode(new Uint8Array(12)));
  const ciphertext = api.parseEnvelopeCiphertextB64u(api.base64UrlEncode(new Uint8Array(48)));
  const digest = await api.digestOpaqueValue('synthetic recovery custody fixture');
  const wraps = [];
  const locators = [];
  const codes = [];
  for (let index = 0; index < api.EMAIL_OTP_RECOVERY_KEY_COUNT; index += 1) {
    const bytes = new Uint8Array(api.EMAIL_OTP_RECOVERY_KEY_BYTE_LENGTH).fill(region.charCodeAt(0));
    bytes[0] = issuance;
    bytes[1] = index;
    codes.push(api.base64UrlEncode(bytes));
    const recoveryKeyId = await api.deriveWalletRecoveryKeyIdFromBytes({
      walletId,
      codeBytes: bytes,
    });
    const locatorB64u = await api.deriveRecoveryCodeLocatorV1FromBytes(bytes);
    bytes.fill(0);
    locators.push({ walletId, recoveryKeyId, locatorB64u });
    wraps.push(
      api.buildWalletRecoveryManifestKekWrap({
        recoveryKeyId,
        nonceB64u: nonce,
        wrappedManifestKekB64u: ciphertext,
        aadHashB64u: digest,
        lifecycle: { state: 'active', issuedAtMs: now },
      }),
    );
  }
  const recoverySet = api.parseWalletRecoveryEnvelopeSetRecord(
    api.buildWalletRecoveryEnvelopeSetRecord({
      walletId,
      manifestKekWraps: wraps,
      entries: [
        api.buildWalletCustodySeedRecoveryEntry({
          nonceB64u: nonce,
          wrappedCustodySecretB64u: ciphertext,
          aadHashB64u: digest,
        }),
      ],
      issuedAtMs: now,
      updatedAtMs: now,
    }),
    { expectedWalletId: walletId },
  );
  const envelopeId = api.parsePasskeyEnvelopeId(`recovery-fixture-${region}-${issuance}`);
  assert.equal(envelopeId.ok, true);
  const envelope = api.buildPasskeyCustodyEnvelopeRecord({
    envelopeId: envelopeId.value,
    walletId,
    ownership: api.buildMethodBoundEnvelopeOwnership(session.walletAuthMethodId),
    binding: api.parsePasskeyCustodySecretBinding({
      kind: 'wallet_custody_seed_v1',
      derivationScheme: 'wallet_seed_parallel_hkdf_sha256_v1',
    }),
    factor: api.buildEmailOtpEnvelopeFactor({
      enrollmentId: `fixture-${region}`,
      enrollmentSealKeyVersion: 'fixture-v1',
    }),
    envelopeRevision: api.parseEnvelopeRevision(1),
    nonceB64u: nonce,
    sealedCustodySecretB64u: ciphertext,
    ciphertextDigestB64u: digest,
    aadHashB64u: digest,
    lifecycle: api.buildActiveEnvelopeLifecycle({ activatedAtMs: now }),
    createdAtMs: now,
    updatedAtMs: now,
  });
  return {
    codes,
    commit: {
      envelope,
      recoverySet,
      recoveryCodeLocators: locators,
      recoveryBackupAcknowledgement: api.buildWalletRecoveryBackupAcknowledgementV1({
        walletId,
        issuedAtMs: now,
        acknowledgedAtMs: now,
      }),
    },
  };
}
