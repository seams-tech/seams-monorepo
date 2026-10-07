import assert from 'node:assert/strict';

export async function verifyRegionalSharedIdentity({
  isolatedIdentity,
  runtime,
  bridges,
  consoleBridge,
  authorityDatabase,
}) {
  const us = bridges.get('US');
  const weur = bridges.get('WEUR');
  const apac = bridges.get('APAC');
  const subject = 'wallet:google:shared-identity-race';
  const attempts = await Promise.all([
    us.publisher.linkSubjectToUserId({ userId: us.issued.session.walletId, subject }),
    weur.publisher.linkSubjectToUserId({ userId: weur.issued.session.walletId, subject }),
  ]);
  assert.equal(attempts.filter(won).length, 1);
  const owner = attempts[0].ok ? us : weur;
  const other = attempts[0].ok ? weur : us;
  for (const bridge of bridges.values()) {
    assert.equal(await bridge.publisher.getUserIdBySubject(subject), owner.issued.session.walletId);
    assert.ok(
      (await bridge.publisher.listSubjectsByUserId(owner.issued.session.walletId)).includes(
        subject,
      ),
    );
  }
  assert.equal(
    (await other.publisher.linkSubjectToUserId({ userId: other.issued.session.walletId, subject }))
      .ok,
    false,
  );
  assert.equal(
    (await owner.publisher.linkSubjectToUserId({ userId: owner.issued.session.walletId, subject }))
      .ok,
    true,
  );
  assert.equal(await isolatedIdentity.getUserIdBySubject(subject), null);
  assert.equal(
    (
      await isolatedIdentity.linkSubjectToUserId({
        userId: 'isolated-wallet',
        subject,
      })
    ).ok,
    true,
  );
  assert.equal(await isolatedIdentity.getUserIdBySubject(subject), 'isolated-wallet');
  assert.equal(await apac.publisher.getUserIdBySubject(subject), owner.issued.session.walletId);
  assert.equal(
    (
      await isolatedIdentity.deleteSubjectLinkForDevCleanup({
        userId: 'isolated-wallet',
        subject,
      })
    ).ok,
    true,
  );
  const second = 'wallet:google:shared-identity-second';
  assert.equal(
    (
      await owner.publisher.linkSubjectToUserId({
        userId: owner.issued.session.walletId,
        subject: second,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await other.publisher.linkSubjectToUserId({
        userId: other.issued.session.walletId,
        subject,
        allowMoveIfSoleIdentity: true,
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await owner.publisher.unlinkSubjectFromUserId({
        userId: owner.issued.session.walletId,
        subject: second,
      })
    ).ok,
    true,
  );
  const moved = await other.publisher.linkSubjectToUserId({
    userId: other.issued.session.walletId,
    subject,
    allowMoveIfSoleIdentity: true,
  });
  assert.equal(moved.ok, true);
  assert.equal(moved.movedFromUserId, owner.issued.session.walletId);
  assert.equal(await apac.publisher.getUserIdBySubject(subject), other.issued.session.walletId);
  assert.equal(
    (
      await owner.publisher.deleteSubjectLinkForDevCleanup({
        userId: owner.issued.session.walletId,
        subject,
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await other.publisher.deleteSubjectLinkForDevCleanup({
        userId: other.issued.session.walletId,
        subject,
      })
    ).ok,
    true,
  );
  assert.equal(await apac.publisher.getUserIdBySubject(subject), null);
  consoleBridge.available = false;
  try {
    await assert.rejects(us.publisher.getUserIdBySubject(subject));
    await assert.rejects(
      us.publisher.linkSubjectToUserId({ userId: us.issued.session.walletId, subject }),
    );
  } finally {
    consoleBridge.available = true;
  }
  assert.equal(
    await authorityDatabase.prepare('SELECT COUNT(*) AS count FROM identity_links').first('count'),
    0,
  );
  for (const region of bridges.keys()) {
    assert.equal(
      await (await runtime.getD1Database('SIGNER_DB', region))
        .prepare('SELECT COUNT(*) AS count FROM identity_links')
        .first('count'),
      0,
    );
  }
  return {
    concurrentClaimHasOneWinner: true,
    allRegionsReadSameAuthority: true,
    authenticatedProjectScopesRemainIsolated: true,
    soleIdentityMoveAndUnlinkRulesPreserved: true,
    outagesDoNotFallBackToRegionalStores: true,
    scope:
      'Production Console service and D1 identity store through four admitted regional clients. Writer admission is controlled by the composition fixture; registration offers and provider discovery forwarding are outside this scenario.',
  };
}
function won(result) {
  return result.ok;
}
