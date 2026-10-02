import { randomBytes } from 'node:crypto';
import { inspectBindings } from './verify-tenant-d1-bindings.mjs';
import { walletRuntimeWorkerNameFor } from '../packages/wallet-console-server-ts/scripts/render-d1-gateway-config.mjs';

function servingVersion(checkpoint, workerName) {
  for (const worker of checkpoint.workers) {
    if (worker.workerName !== workerName) continue;
    if (worker.versions.length !== 1 || worker.versions[0].percentage !== 100)
      throw new Error('Runtime home verification requires one serving version per writer');
    return worker.versions[0].versionId;
  }
  throw new Error('Runtime home verification is missing a writer');
}

async function executeChallengeQuery(accountId, databaseId, apiToken, sql, params) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`D1 challenge query failed with HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  if (
    body?.success !== true ||
    !Array.isArray(body.result) ||
    body.result.length !== 1 ||
    body.result[0]?.success !== true
  ) {
    throw new Error('D1 challenge query did not succeed');
  }
}

export async function verifyTenantHomeChallenge(lane, oidcToken) {
  if (lane.provisioning.kind !== 'provisioned') throw new Error('Lane is not provisioned');
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
  if (!/^[a-f0-9]{32}$/u.test(accountId) || !apiToken.trim())
    throw new Error('Cloudflare account and API token are required for the database challenge');
  const deployment = lane.provisioning.gatewayDeploymentConfig;
  const databaseId = deployment.resources.signerD1.id;
  const namespace = deployment.tenant.namespace;
  const providerBefore = await inspectBindings(lane, accountId, apiToken);
  const gatewayName = lane.resources.gateway.workerName;
  const gatewayVersion = servingVersion(providerBefore, gatewayName);
  const walletRuntimeVersion = servingVersion(
    providerBefore,
    walletRuntimeWorkerNameFor(gatewayName),
  );
  const challengeId = randomBytes(32).toString('hex');
  const expectedProof = randomBytes(32).toString('hex');
  const issuedAtMs = Date.now();
  try {
    await executeChallengeQuery(
      accountId,
      databaseId,
      apiToken,
      'INSERT INTO namespace_home_challenges (namespace, challenge_id, account_id, database_id, proof, issued_at_ms, expires_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7)',
      [
        namespace,
        challengeId,
        accountId,
        databaseId,
        expectedProof,
        issuedAtMs,
        issuedAtMs + 300_000,
      ],
    );
    const response = await fetch(
      `${lane.console.origin}/internal/tenant-deployment/v1/verify-home`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${oidcToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ deploymentLane: lane.id, challengeId, expectedProof }),
        redirect: 'error',
        signal: AbortSignal.timeout(45_000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      throw new Error(`Runtime home verification failed with HTTP ${response.status}`);
    }
    const result = body.result;
    if (
      result?.kind !== 'tenant_d1_runtime_home_checkpoint_v1' ||
      result.challengeId !== challengeId ||
      result.deploymentLane !== lane.id ||
      result.home?.namespace !== namespace ||
      result.home?.accountId !== accountId ||
      result.home?.databaseId !== databaseId ||
      result.activationAuthorized !== false ||
      result.writerVersions?.gateway !== gatewayVersion ||
      result.writerVersions?.walletRuntime !== walletRuntimeVersion ||
      !Number.isSafeInteger(result.checkedAtMs) ||
      result.checkedAtMs < issuedAtMs ||
      result.checkedAtMs > Date.now() ||
      result.expiresAtMs !== issuedAtMs + 300_000 ||
      result.expiresAtMs <= Date.now()
    ) {
      throw new Error('Console returned an invalid runtime home checkpoint');
    }
    const providerAfter = await inspectBindings(lane, accountId, apiToken);
    if (JSON.stringify(providerBefore.workers) !== JSON.stringify(providerAfter.workers))
      throw new Error('Writer deployment changed across the runtime challenge');
    if (result.expiresAtMs <= Date.now())
      throw new Error('Runtime home challenge expired during provider verification');
    return {
      kind: 'tenant_d1_home_checkpoint_v1',
      deploymentLane: lane.id,
      home: { namespace, accountId, databaseId },
      challengeId,
      checkedAtMs: result.checkedAtMs,
      expiresAtMs: result.expiresAtMs,
      providerCheckedBefore: providerBefore.checkedAt,
      providerCheckedAfter: providerAfter.checkedAt,
      workers: providerAfter.workers,
      writerVersions: { gateway: gatewayVersion, walletRuntime: walletRuntimeVersion },
      runtimeChallengeVerified: true,
      activationAuthorized: false,
    };
  } finally {
    // Also clean up when an INSERT committed but its response was lost.
    await executeChallengeQuery(
      accountId,
      databaseId,
      apiToken,
      'DELETE FROM namespace_home_challenges WHERE namespace = ?1 AND challenge_id = ?2 AND proof = ?3',
      [namespace, challengeId, expectedProof],
    );
  }
}
