import assert from 'node:assert/strict';

const policies = {
  challenge: { limit: 3, windowMs: 60_000 },
  verify: { limit: 3, windowMs: 60_000 },
  grant: { limit: 3, windowMs: 60_000 },
  googleRegistrationAttempt: { limit: 3, windowMs: 60_000 },
};
const request = {
  scope: 'challenge',
  action: 'regional-limit',
  providerSubject: 'google:rate-limit-owner',
};

function store(api, database, scope) {
  return api.createD1EmailOtpRateLimits(
    {
      emailOtp: { rateLimits: policies },
      emailOtpRateLimitCounter: api.createSharedEmailOtpRateLimitCounter(database, scope),
    },
    forbiddenRegionalPrepare,
  );
}
function forbiddenRegionalPrepare() {
  throw new Error('Hosted rate limits must not use a regional counter');
}
function succeeded(result) {
  return result.ok;
}

export async function verifyRegionalRateLimits({
  api,
  bridges,
  counterDatabase,
  scope: tenantScope,
  isolatedScope,
  consoleBridge,
  runtime,
}) {
  let totalRequests = 0;
  let accepted = 0;
  for (const scope of Object.keys(policies)) {
    const scopedRequest = { ...request, scope };
    const requests = [];
    for (const _region of bridges.keys()) {
      const limiter = store(api, counterDatabase, tenantScope);
      requests.push(limiter.consume(scopedRequest), limiter.consume(scopedRequest));
    }
    const results = await Promise.all(requests);
    totalRequests += results.length;
    const allowed = results.filter(succeeded).length;
    assert.equal(allowed, 3, scope);
    accepted += allowed;
    for (const result of results) {
      if (result.ok) continue;
      assert.equal(result.code, 'rate_limited');
      assert.ok(result.retryAfterMs > 0);
      assert.ok(result.resetAtMs > Date.now());
    }
    assert.equal(
      (await store(api, counterDatabase, isolatedScope).consume(scopedRequest)).ok,
      true,
    );
  }
  consoleBridge.available = false;
  try {
    assert.equal(
      (
        await store(api, counterDatabase, tenantScope).consume({
          ...request,
          action: 'console-outage',
        })
      ).ok,
      true,
    );
    await counterDatabase.prepare('DROP TABLE email_otp_rate_limits').run();
    await assert.rejects(
      store(api, counterDatabase, tenantScope).consume(request),
      /no such table: email_otp_rate_limits/,
    );
  } finally {
    consoleBridge.available = true;
  }
  for (const region of bridges.keys()) {
    assert.equal(
      await (await runtime.getD1Database('SIGNER_DB', region))
        .prepare('SELECT COUNT(*) AS count FROM email_otp_rate_limits')
        .first('count'),
      0,
    );
  }
  return {
    totalRequests,
    accepted,
    limited: totalRequests - accepted,
    policyScopes: Object.keys(policies),
    projectScopesIndependent: true,
    consoleOutageAccepted: true,
    counterStorageFailureFailsClosed: true,
    outagesHaveNoRegionalFallback: true,
    scope:
      'Production Email OTP policy/key generation and isolated shared D1 counter across regional callers. Console is unavailable for the outage check. Hosted HTTP retry headers are outside this scenario.',
  };
}
