import assert from 'node:assert/strict';
import { GoogleOidcFixture } from '../helpers/google-oidc.fixtures.mjs';
import { buildGoogleEnrollmentFixture } from '../helpers/regional-authentication.fixtures.mjs';

class ScopedDatabase {
  constructor(api, database, scope) {
    this.api = api;
    this.database = database;
    this.scope = scope;
  }
  prepare(sql, values) {
    return this.api.prepareD1TenantStatement(this.database, this.scope, sql, values);
  }
}
class NoRegistrationRateLimit {
  consume() {
    throw new Error('Selected-wallet login must not start registration');
  }
}
class GoogleLoginHome {
  constructor(api, region, resolver, scope) {
    this.api = api;
    this.region = region;
    this.resolver = resolver;
    this.scope = scope;
  }
  async handle(request) {
    const parsed = this.api.parseGoogleLoginVerifyRequest(await request.json());
    if (!parsed.ok) return Response.json(parsed.body, { status: parsed.status });
    const proof = await this.api.verifyGoogleOidcToken(
      'regional-google-test',
      parsed.request.idToken,
    );
    if (!proof.ok) return Response.json(proof, { status: 400 });
    const account = { providerSubject: `google:${proof.sub}`, email: proof.email };
    const result = await this.resolver.resolve({
      providerSubject: account.providerSubject,
      email: account.email,
      accountMode: parsed.request.accountMode,
      loginWalletId: parsed.request.loginWalletId,
      runtimePolicyScope: this.scope,
      restartRegistrationOffer: parsed.request.restartRegistrationOffer,
    });
    return Response.json({ region: this.region, result }, { status: result.ok ? 200 : 400 });
  }
}

export async function verifyRegionalGoogleLogin(input) {
  const proofs = new GoogleOidcFixture();
  proofs.install();
  try {
    return await runGoogleLoginScenario(input, proofs);
  } finally {
    proofs.restore();
  }
}

async function runGoogleLoginScenario(
  { api, runtime, bridges, signerScope, consoleBridge, directory, catalog },
  proofs,
) {
  const accounts = new Map();
  const observations = [];
  for (const [region, bridge] of bridges) {
    const database = await runtime.getD1Database('SIGNER_DB', region);
    const scoped = new ScopedDatabase(api, database, signerScope);
    const prepare = scoped.prepare.bind(scoped);
    const enrollments = new api.CloudflareD1EmailOtpEnrollmentStore({ prepare });
    const identities = api.createD1IdentityStore({ identityStore: bridge.publisher });
    const scope = {
      orgId: signerScope.orgId,
      projectId: signerScope.projectId,
      envId: signerScope.envId,
      signingRootVersion: '1',
    };
    const resolver = new api.CloudflareD1GoogleEmailOtpSessionResolver({
      emailOtpEnrollments: enrollments,
      identityStore: identities,
      linkIdentity: identities.linkSubjectToUserId.bind(identities),
      emailOtpRateLimits: new NoRegistrationRateLimit(),
      registrationAttempts: api.createD1GoogleRegistrationAttempts(
        {
          googleRegistrationAttempts: bridge.authority.registrationOffers(),
        },
        prepare,
      ),
      production: true,
    });
    for (const suffix of ['', '-other']) {
      const account = {
        providerSubject: `google:${region}${suffix}`,
        email: `${region.toLowerCase()}${suffix}@example.test`,
      };
      accounts.set(`${region}${suffix}`, proofs.token(`${region}${suffix}`));
      const walletId = `${bridge.issued.session.walletId}${suffix}`;
      await enrollments.putEnrollment(
        buildGoogleEnrollmentFixture(
          api,
          walletId,
          account.providerSubject,
          account.email,
          signerScope.orgId,
        ),
      );
      if (suffix)
        assert.equal(
          (
            await identities.linkSubjectToUserId({
              userId: walletId,
              subject: `wallet:${account.providerSubject}`,
            })
          ).ok,
          true,
        );
    }
    bridge.google = new GoogleLoginHome(api, region, resolver, scope);
    bridge.googleEnrollments = enrollments;
    bridge.googleIdentities = identities;
  }
  const offers = await verifySharedRegistrationOffers({
    api,
    directory,
    catalog,
    runtime,
    bridges,
    proofs,
    signerScope,
    consoleBridge,
  });
  const missingHomeSubject = 'wallet:google:missing-home';
  const identityAuthority = bridges.get('US').googleIdentities;
  assert.equal(
    (
      await identityAuthority.linkSubjectToUserId({
        userId: 'wallet-without-home',
        subject: missingHomeSubject,
      })
    ).ok,
    true,
  );
  const missingHome = await (
    await runtime.getWorker('APAC')
  ).fetch(
    'https://wallet.test/auth/google/verify',
    post({
      account_mode: 'login',
      id_token: proofs.token('missing-home'),
      project_environment_id: signerScope.envId,
    }),
  );
  assert.equal(missingHome.status, 404);
  assert.equal((await missingHome.json()).code, 'wallet_home_unavailable');
  assert.equal(
    (
      await identityAuthority.deleteSubjectLinkForDevCleanup({
        userId: 'wallet-without-home',
        subject: missingHomeSubject,
      })
    ).ok,
    true,
  );
  for (const [region, bridge] of bridges) {
    const ingress = await runtime.getWorker(region === 'US' ? 'APAC' : 'US');
    const foreign = bridges.get(region === 'US' ? 'WEUR' : 'US');
    const body = {
      account_mode: 'login',
      wallet_id: bridge.issued.session.walletId,
      id_token: accounts.get(region),
      project_environment_id: signerScope.envId,
    };
    const success = await ingress.fetch('https://wallet.test/auth/google/verify', post(body));
    assert.equal(success.status, 200);
    const selected = await success.json();
    assert.equal(selected.region, region);
    assert.equal(selected.result.walletId, bridge.issued.session.walletId);
    const discoveryBody = {
      account_mode: 'login',
      id_token: accounts.get(region),
      project_environment_id: signerScope.envId,
    };
    const discovered = await ingress.fetch(
      'https://wallet.test/auth/google/verify',
      post(discoveryBody),
    );
    assert.equal(discovered.status, 200);
    const discoveryResult = await discovered.json();
    assert.equal(discoveryResult.region, region);
    assert.equal(discoveryResult.result.walletId, bridge.issued.session.walletId);
    const discoveryConflict = await ingress.fetch(
      'https://wallet.test/auth/google/verify',
      post(discoveryBody, foreign.issued.operationCredential.token),
    );
    assert.equal(discoveryConflict.status, 403);
    const wrongHome = await (
      await runtime.getWorker(`home-${foreign.region}`)
    ).fetch('https://wallet.test/auth/google/verify', post(discoveryBody));
    assert.equal(wrongHome.status, 409);
    consoleBridge.available = false;
    try {
      const unavailable = await ingress.fetch(
        'https://wallet.test/auth/google/verify',
        post(discoveryBody),
      );
      assert.equal(unavailable.status, 503);
      for (const invalidToken of [
        proofs.token(region, { aud: 'wrong-client' }),
        proofs.token(region, { exp: 1 }),
        tamperedToken(accounts.get(region)),
      ]) {
        const invalid = await ingress.fetch(
          'https://wallet.test/auth/google/verify',
          post({ ...discoveryBody, id_token: invalidToken }),
        );
        assert.equal(
          invalid.status,
          400,
          'Invalid proof must fail before unavailable identity authority',
        );
      }
    } finally {
      consoleBridge.available = true;
    }
    const mismatch = await ingress.fetch(
      'https://wallet.test/auth/google/verify',
      post({ ...body, id_token: accounts.get(`${region}-other`) }),
    );
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json()).result.code, 'wallet_identity_mismatch');
    assert.equal(
      await bridge.googleIdentities.getUserIdBySubject(`wallet:google:${region}-other`),
      `${bridge.issued.session.walletId}-other`,
    );
    const conflict = await ingress.fetch(
      'https://wallet.test/auth/google/verify',
      post(body, foreign.issued.operationCredential.token),
    );
    assert.equal(conflict.status, 403);
    const register = await ingress.fetch(
      'https://wallet.test/auth/google/verify',
      post({ ...body, account_mode: 'register' }),
    );
    assert.equal(register.status, 400);
    consoleBridge.available = false;
    try {
      const outage = await ingress.fetch('https://wallet.test/auth/google/verify', post(body));
      assert.equal(outage.status, 503);
    } finally {
      consoleBridge.available = true;
    }
    await bridge.googleEnrollments.deleteEnrollment(bridge.issued.session.walletId);
    const missing = await ingress.fetch('https://wallet.test/auth/google/verify', post(body));
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).result.code, 'wallet_identity_mismatch');
    const stale = await ingress.fetch(
      'https://wallet.test/auth/google/verify',
      post(discoveryBody),
    );
    assert.equal(stale.status, 400);
    assert.equal((await stale.json()).result.code, 'stale_identity_mapping');
    observations.push({
      home: region,
      walletId: selected.result.walletId,
      discoveredHome: discoveryResult.region,
    });
  }
  return {
    observations,
    offers,
    selectedWalletDoesNotFallBackToAnotherWallet: true,
    verifiedProviderDiscoveryReachesHome: true,
    invalidProofRejectedBeforeIdentityLookup: true,
    receivingHomeRejectsSecondHop: true,
    linkedIdentityWithoutHomeFailsClosed: true,
    missingEnrollmentDoesNotStartRegistration: true,
    sessionConflictsAndDirectoryOutagesFailClosed: true,
    scope:
      'Production Google RSA signature/claims validation, shared identity authority, regional dispatch, resolver and home-local enrollment stores. JWKS are fixture keys; enrollment ciphertext is synthetic. Registration offers and live Google/hosted latency remain outside this scenario.',
  };
}
function post(body, token = null) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}

function tamperedToken(token) {
  const [header, body, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  claims.sub = 'forged-provider';
  return `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
}

async function verifySharedRegistrationOffers({
  api,
  directory,
  catalog,
  runtime,
  bridges,
  proofs,
  signerScope,
  consoleBridge,
}) {
  const request = {
    account_mode: 'register',
    id_token: proofs.token('new-wallet-owner'),
    project_environment_id: signerScope.envId,
  };
  const pending = [];
  for (const region of bridges.keys()) {
    const worker = await runtime.getWorker(region);
    pending.push(worker.fetch('https://wallet.test/auth/google/verify', post(request)));
  }
  const results = [];
  for (const response of await Promise.all(pending)) {
    assert.equal(response.status, 200);
    const { result } = await response.json();
    assert.equal(result.mode, 'register_started');
    results.push(result);
  }
  const first = results[0];
  for (const result of results) {
    assert.equal(result.registrationAttemptId, first.registrationAttemptId);
    assert.deepEqual(result.offer, first.offer);
    assert.equal(result.walletId, first.walletId);
  }
  for (const [region, bridge] of bridges) {
    const retry = await (
      await runtime.getWorker(region)
    ).fetch('https://wallet.test/auth/google/verify', post(request));
    assert.equal((await retry.json()).result.registrationAttemptId, first.registrationAttemptId);
    const store = bridge.authority.registrationOffers();
    assert.equal((await store.read(first.registrationAttemptId)).walletId, first.walletId);
    assert.equal(
      await store.hasLiveStartedWalletAttempt({ walletId: first.walletId, nowMs: Date.now() }),
      true,
    );
    assert.equal(
      await (await runtime.getD1Database('SIGNER_DB', region))
        .prepare('SELECT COUNT(*) AS count FROM email_otp_registration_attempts')
        .first('count'),
      0,
    );
  }
  const us = bridges.get('US').authority.registrationOffers();
  const record = await us.read(first.registrationAttemptId);
  await assert.rejects(
    us.findStarted({
      providerSubject: record.providerSubject,
      email: record.email,
      orgId: signerScope.orgId,
      ownerProofBindingDigest: record.ownerProofBindingDigest,
      runtimePolicyScope: {
        orgId: signerScope.orgId,
        projectId: 'other-project',
        envId: signerScope.envId,
        signingRootVersion: '1',
      },
    }),
  );
  consoleBridge.available = false;
  try {
    await assert.rejects(us.read(first.registrationAttemptId));
    await assert.rejects(
      us.findStarted({
        providerSubject: record.providerSubject,
        email: record.email,
        orgId: signerScope.orgId,
        ownerProofBindingDigest: record.ownerProofBindingDigest,
        runtimePolicyScope: record.runtimePolicyScope,
      }),
    );
  } finally {
    consoleBridge.available = true;
  }
  const restart = await (
    await runtime.getWorker('APAC')
  ).fetch(
    'https://wallet.test/auth/google/verify',
    post({ ...request, restart_registration_offer: true }),
  );
  assert.equal(restart.status, 200);
  const replacement = (await restart.json()).result;
  assert.notEqual(replacement.registrationAttemptId, first.registrationAttemptId);
  assert.equal((await us.read(first.registrationAttemptId)).state, 'abandoned');
  await assert.rejects(us.put(record));
  assert.equal((await us.read(first.registrationAttemptId)).state, 'abandoned');
  const resumed = await (
    await runtime.getWorker('WEUR')
  ).fetch('https://wallet.test/auth/google/verify', post(request));
  assert.equal(
    (await resumed.json()).result.registrationAttemptId,
    replacement.registrationAttemptId,
  );
  const initialSelection = await us.read(replacement.registrationAttemptId);
  assert.equal(
    (
      await us.complete({
        attemptId: replacement.registrationAttemptId,
        walletId: replacement.walletId,
      })
    ).ok,
    false,
  );
  const claims = [];
  const competing = replacement.offer.candidates.slice(1, 3);
  for (const [index, region] of ['US', 'WEUR'].entries()) {
    const candidate = competing[index];
    claims.push(
      bridges
        .get(region)
        .authority.registrationOffers()
        .claimCandidate({
          attemptId: replacement.registrationAttemptId,
          candidateId: candidate.candidateId,
          walletId: candidate.walletId,
          intentDigest: `verified-intent-${region}`,
        }),
    );
  }
  const decisions = await Promise.all(claims);
  assert.equal(decisions.filter(isSuccessfulClaim).length, 1);
  const winnerIndex = decisions[0].ok ? 0 : 1;
  const winner = competing[winnerIndex];
  const intentDigest = `verified-intent-${winnerIndex === 0 ? 'US' : 'WEUR'}`;
  const apac = bridges.get('APAC').authority.registrationOffers();
  assert.equal(
    (
      await apac.claimCandidate({
        attemptId: replacement.registrationAttemptId,
        candidateId: winner.candidateId,
        walletId: winner.walletId,
        intentDigest,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await apac.claimCandidate({
        attemptId: replacement.registrationAttemptId,
        candidateId: winner.candidateId,
        walletId: winner.walletId,
        intentDigest: 'different-intent',
      })
    ).ok,
    false,
  );
  await assert.rejects(us.put(initialSelection));
  const selected = await apac.read(replacement.registrationAttemptId);
  assert.equal(selected.walletId, winner.walletId);
  assert.equal(selected.selectedCandidateId, winner.candidateId);
  await assert.rejects(
    apac.put(
      api.abandonedGoogleEmailOtpRegistrationAttemptRecord({
        record: selected,
        failureCode: 'offer_restarted_by_user',
        updatedAtMs: Date.now(),
      }),
    ),
  );
  assert.equal((await us.read(replacement.registrationAttemptId)).walletId, winner.walletId);
  assert.equal(
    (
      await us.claimCandidate({
        attemptId: first.registrationAttemptId,
        candidateId: first.offer.selectedCandidateId,
        walletId: first.walletId,
        intentDigest: 'late-abandoned-intent',
      })
    ).ok,
    false,
  );
  const completion = { attemptId: replacement.registrationAttemptId, walletId: winner.walletId };
  const sharedIdentities = bridges.get('US').googleIdentities;
  const identitySubject = `wallet:${selected.providerSubject}`;
  const previousOwner = 'previous-owner-wallet';
  assert.equal(
    (
      await sharedIdentities.linkSubjectToUserId({
        userId: previousOwner,
        subject: identitySubject,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await sharedIdentities.linkSubjectToUserId({
        userId: previousOwner,
        subject: 'wallet:google:other-factor',
      })
    ).ok,
    true,
  );
  assert.equal((await us.complete(completion)).ok, false);
  assert.equal((await us.read(completion.attemptId)).state, 'started');
  assert.equal(await sharedIdentities.getUserIdBySubject(identitySubject), previousOwner);
  assert.equal(
    (
      await sharedIdentities.unlinkSubjectFromUserId({
        userId: previousOwner,
        subject: 'wallet:google:other-factor',
      })
    ).ok,
    true,
  );
  await consoleBridge.database.exec(
    "CREATE TRIGGER fixture_reject_offer_completion BEFORE UPDATE ON email_otp_registration_attempts WHEN NEW.state = 'active' BEGIN SELECT RAISE(ABORT, 'injected completion failure'); END",
  );
  try {
    await assert.rejects(us.complete(completion));
    assert.equal((await us.read(completion.attemptId)).state, 'started');
    assert.equal(await sharedIdentities.getUserIdBySubject(identitySubject), previousOwner);
  } finally {
    await consoleBridge.database.exec('DROP TRIGGER fixture_reject_offer_completion');
  }
  await consoleBridge.database
    .prepare(
      `UPDATE email_otp_registration_attempts
    SET expires_at_ms = created_at_ms + 1,
      record_json = json_set(record_json, '$.expiresAtMs', created_at_ms + 1)
    WHERE attempt_id = ?`,
    )
    .bind(completion.attemptId)
    .run();
  assert.equal((await us.complete(completion)).ok, false);
  await us.cleanupExpired(Date.now() + 60 * 60_000);
  assert.equal((await us.read(completion.attemptId)).state, 'started');
  assert.equal(
    await us.hasLiveStartedWalletAttempt({ walletId: completion.walletId, nowMs: Date.now() }),
    true,
  );
  await assert.rejects(
    bridges
      .get('US')
      .publisher.registrationOffer({ operation: 'delete', input: completion.attemptId }),
  );
  assert.equal((await us.read(completion.attemptId)).walletId, completion.walletId);
  const committed = { ...completion, intentDigest };
  await assert.rejects(us.completeCommitted(committed));
  const wallet = api.WalletOwnershipKey.parse({
    namespace: signerScope.namespace,
    organizationId: signerScope.orgId,
    projectId: signerScope.projectId,
    environmentId: signerScope.envId,
    walletId: completion.walletId,
  });
  const reserved = await directory.reserve({
    allocation: 'provided',
    wallet,
    proposedHome: catalog.select('US'),
    registrationId: 'interrupted-offer-registration',
    deploymentLane: 'test',
    requestDigest: 'b'.repeat(64),
    nowMs: Date.now(),
    proposedRegistrationAllocation: api.RegistrationSetupAllocation.parse({
      ceremonyId: `wrc_${'i'.repeat(43)}`,
      preparationId: 'regprep_interrupted',
      walletAuthorityId: 'wallet-authority:interrupted',
      deviceId: 'device:interrupted',
      walletAuthMethodId: 'wallet-auth-method:interrupted',
    }),
  });
  assert.equal(reserved.ok, true);
  await assert.rejects(apac.completeCommitted(committed));
  assert.equal(
    (await us.completeCommitted({ ...committed, intentDigest: 'wrong-intent' })).ok,
    false,
  );
  const completed = await Promise.all([
    bridges.get('US').google.resolver.completeCommittedRegistrationAttempt({
      registrationAttemptId: completion.attemptId,
      walletId: completion.walletId,
      intentDigest,
    }),
    us.completeCommitted(committed),
  ]);
  assert.ok(completed.every(isSuccessfulClaim));
  assert.equal((await us.read(completion.attemptId)).state, 'active');
  assert.equal(await sharedIdentities.getUserIdBySubject(identitySubject), winner.walletId);
  await us.cleanupExpired(Date.now() + 60 * 60_000);
  assert.equal((await apac.complete(completion)).ok, true);
  assert.equal(
    (await apac.complete({ attemptId: completion.attemptId, walletId: previousOwner })).ok,
    false,
  );
  await assert.rejects(us.put(selected));
  const terminalInput = {
    wallet,
    home: reserved.assignment.home,
    registrationId: reserved.assignment.registrationId,
    requestDigest: reserved.assignment.requestDigest,
    outcome: 'cancelled',
  };
  await assert.rejects(bridges.get('US').publisher.complete(terminalInput));
  assert.equal((await directory.find(wallet)).state, 'reserved');
  await assert.rejects(
    bridges.get('APAC').publisher.complete({ ...terminalInput, outcome: 'established' }),
  );
  assert.equal(
    (await bridges.get('US').publisher.complete({ ...terminalInput, outcome: 'established' }))
      .state,
    'established',
  );
  const cancelResponse = await (
    await runtime.getWorker('US')
  ).fetch(
    'https://wallet.test/auth/google/verify',
    post({
      account_mode: 'register',
      id_token: proofs.token('cancelled-owner'),
      project_environment_id: signerScope.envId,
    }),
  );
  assert.equal(cancelResponse.status, 200);
  const cancelOffer = (await cancelResponse.json()).result;
  const cancelCandidate = cancelOffer.offer.candidates[0];
  assert.equal(
    (
      await us.claimCandidate({
        attemptId: cancelOffer.registrationAttemptId,
        candidateId: cancelCandidate.candidateId,
        walletId: cancelCandidate.walletId,
        intentDigest: 'cancelled-intent',
      })
    ).ok,
    true,
  );
  const cancelledWallet = api.WalletOwnershipKey.parse({
    namespace: signerScope.namespace,
    organizationId: signerScope.orgId,
    projectId: signerScope.projectId,
    environmentId: signerScope.envId,
    walletId: cancelCandidate.walletId,
  });
  const cancelReservation = await directory.reserve({
    allocation: 'provided',
    wallet: cancelledWallet,
    proposedHome: catalog.select('US'),
    registrationId: 'cancelled-offer-registration',
    deploymentLane: 'test',
    requestDigest: 'c'.repeat(64),
    nowMs: Date.now(),
    proposedRegistrationAllocation: api.RegistrationSetupAllocation.parse({
      ceremonyId: `wrc_${'c'.repeat(43)}`,
      preparationId: 'regprep_cancelled',
      walletAuthorityId: 'wallet-authority:cancelled',
      deviceId: 'device:cancelled',
      walletAuthMethodId: 'wallet-auth-method:cancelled',
    }),
  });
  assert.equal(cancelReservation.ok, true);
  const cancelled = await bridges.get('US').publisher.complete({
    wallet: cancelledWallet,
    home: cancelReservation.assignment.home,
    registrationId: cancelReservation.assignment.registrationId,
    requestDigest: cancelReservation.assignment.requestDigest,
    outcome: 'cancelled',
  });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(await us.read(cancelOffer.registrationAttemptId), null);
  assert.equal(
    await us.hasLiveStartedWalletAttempt({ walletId: cancelCandidate.walletId, nowMs: Date.now() }),
    false,
  );
  await assert.rejects(
    us.completeCommitted({
      attemptId: cancelOffer.registrationAttemptId,
      walletId: cancelCandidate.walletId,
      intentDigest: 'cancelled-intent',
    }),
  );
  assert.equal((await directory.find(cancelledWallet)).state, 'cancelled');
  return {
    cancelledHomeAtomicallyReleasesPendingOffer: true,
    completedOfferPreventsHomeCancellation: true,
    terminalHomeRequiresAssignedWriter: true,
    expiredClaimSurvivesCleanupForCommittedRetry: true,
    claimedWalletRemainsUnavailableForReallocation: true,
    unrestrictedOfferDeleteIsUnavailable: true,
    committedRetryRequiresHomeAndOriginalIntent: true,
    completionPublishesIdentityAndOfferAtomically: true,
    completionFailureRollsBackIdentityMove: true,
    completionRetrySurvivesOfferExpiryCleanup: true,
    multiIdentityMoveRemainsRejected: true,
    unclaimedOfferCannotComplete: true,
    candidateClaimsHaveOneWinner: true,
    identicalIntentRetrySucceeds: true,
    candidateRetargetingAndIntentSubstitutionRejected: true,
    claimedOffersCannotBeRestarted: true,
    concurrentRegionalOffersHaveOneWinner: true,
    allRegionsReuseCandidatesAndIdentity: true,
    explicitRestartReplacesSharedOffer: true,
    staleWritesCannotResurrectAbandonedOffers: true,
    scopeMismatchAndOutagesFailClosed: true,
    regionalOfferStoresRemainEmpty: true,
    scope:
      'Concurrent offer creation through production resolver/Console/D1, plus competing candidate claims through the shared store. Completion runs through the production resolver/shared transaction with injected D1 failure. Expired-claim completion uses a real directory reservation and admitted home writer; the regional custody commit/crash replay and terminal reservation cleanup remain separate acceptance gates.',
  };
}

function isSuccessfulClaim(result) {
  return result.ok;
}
