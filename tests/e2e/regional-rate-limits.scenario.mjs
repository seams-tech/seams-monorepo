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

function store(api, client) {
  return api.createD1EmailOtpRateLimits(
    {
      emailOtp: { rateLimits: policies },
      emailOtpRateLimitCounter: client.rateLimitCounter(),
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
  isolatedIdentity,
  consoleBridge,
  runtime,
}) {
  let totalRequests = 0;
  for (const scope of Object.keys(policies)) {
    const scopedRequest = { ...request, scope };
    const requests = [];
    for (const bridge of bridges.values()) {
      const limiter = store(api, bridge.publisher);
      requests.push(limiter.consume(scopedRequest), limiter.consume(scopedRequest));
    }
    const results = await Promise.all(requests);
    totalRequests += results.length;
    assert.equal(results.filter(succeeded).length, 3, scope);
    for (const result of results) {
      if (result.ok) continue;
      assert.equal(result.code, 'rate_limited');
      assert.ok(result.retryAfterMs > 0);
      assert.ok(result.resetAtMs > Date.now());
    }
    assert.equal((await store(api, isolatedIdentity).consume(scopedRequest)).ok, true);
  }
  consoleBridge.available = false;
  try {
    await assert.rejects(store(api, bridges.get('US').publisher).consume(request));
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
    accepted: 12,
    limited: 12,
    policyScopes: Object.keys(policies),
    projectScopesIndependent: true,
    outagesHaveNoRegionalFallback: true,
    scope:
      'Production Email OTP policy/key generation and shared D1 counter through three admitted regional clients. Writer admission is fixture-controlled; hosted HTTP retry headers are outside this scenario.',
  };
}
