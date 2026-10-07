import assert from 'node:assert/strict';

const policies = {
  challenge: { limit: 3, windowMs: 60_000 },
  verify: { limit: 3, windowMs: 60_000 },
  grant: { limit: 3, windowMs: 60_000 },
  googleRegistrationAttempt: { limit: 3, windowMs: 60_000 },
};
const request = {
  kind: 'regional',
  scope: 'challenge',
  action: 'regional-limit',
  providerSubject: 'google:rate-limit-owner',
};

function store(api, database, scope) {
  return api.createD1EmailOtpRateLimits(
    { database, emailOtp: { rateLimits: policies } },
    api.prepareD1TenantStatement.bind(null, database, {
      namespace: scope.namespace,
      orgId: scope.organizationId,
      projectId: scope.projectId,
      envId: scope.environmentId,
    }),
  );
}
function succeeded(result) {
  return result.ok;
}

export async function verifyRegionalRateLimits({
  api,
  bridges,
  scope: tenantScope,
  isolatedScope,
  consoleBridge,
  runtime,
}) {
  let totalRequests = 0;
  let accepted = 0;
  const regions = [];
  consoleBridge.available = false;
  try {
    for (const region of bridges.keys()) {
      const database = await runtime.getD1Database('SIGNER_DB', region);
      for (const scope of Object.keys(policies)) {
        const scopedRequest = { ...request, scope };
        const limiter = store(api, database, tenantScope);
        const requests = [];
        for (let attempt = 0; attempt < 8; attempt += 1) {
          requests.push(limiter.consume(scopedRequest));
        }
        const results = await Promise.all(requests);
        totalRequests += results.length;
        const allowed = results.filter(succeeded).length;
        assert.equal(allowed, 3, `${region}: ${scope}`);
        accepted += allowed;
        for (const result of results) {
          if (result.ok) continue;
          assert.equal(result.code, 'rate_limited');
          assert.ok(result.retryAfterMs > 0);
        }
        assert.equal((await store(api, database, isolatedScope).consume(scopedRequest)).ok, true);
      }
      regions.push(region);
    }
    // A real database error must remain a failure, without a remote fallback.
    const database = await runtime.getD1Database('SIGNER_DB', regions[0]);
    await database
      .prepare('ALTER TABLE email_otp_rate_limits RENAME TO unavailable_counters')
      .run();
    try {
      await assert.rejects(store(api, database, tenantScope).consume(request), /no such table/);
    } finally {
      await database
        .prepare('ALTER TABLE unavailable_counters RENAME TO email_otp_rate_limits')
        .run();
    }
  } finally {
    consoleBridge.available = true;
  }
  return {
    totalRequests,
    accepted,
    limited: totalRequests - accepted,
    regions,
    policyScopes: Object.keys(policies),
    regionalAllowancesIndependent: true,
    projectScopesIndependent: true,
    consoleOutageAccepted: true,
    counterStorageFailureFailsClosed: true,
    scope:
      'Production OTP spam limits use each regional signer D1 during Console outage. No shared counter database. Wallet relocation is verified by authorization-transfer acceptance.',
  };
}
