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
      restartRegistrationOffer: false,
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
  { api, runtime, bridges, signerScope, consoleBridge },
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
      registrationAttempts: new api.CloudflareD1GoogleEmailOtpRegistrationAttemptStore({
        prepare,
        orgId: signerScope.orgId,
      }),
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
