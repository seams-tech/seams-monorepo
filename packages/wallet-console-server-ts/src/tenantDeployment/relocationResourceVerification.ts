import { isPlainObject, queryD1One, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { WalletHome } from '../walletPlacement/home';
import { TenantDeploymentD1ResourceIdentityV1 } from './deploymentResource';
import type { TenantD1ResourceVerifierV1 } from './resourceChallenge';
import {
  TenantResourceVerificationV1,
  type TenantDeploymentResourceVerificationsV1,
} from './resourceVerification';

type ProviderWriter = {
  readonly workerName: string;
  readonly deploymentId: string;
  readonly versions: readonly [
    { readonly versionId: string; readonly percentage: 100; readonly databaseId: string },
  ];
};

// Reuses the deployment challenge protocol. Stored activation proofs identify the
// writers; only new provider observations and runtime challenges authorize a move.
export class RelocationResourceVerifier {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly namespace: string,
    private readonly deploymentLane: string,
    private readonly apiToken: string,
    private readonly runtime: TenantD1ResourceVerifierV1,
  ) {}

  async verify(
    source: WalletHome,
    destination: WalletHome,
  ): Promise<TenantDeploymentResourceVerificationsV1> {
    if (!this.apiToken.trim())
      throw new Error('Relocation resource verification credential is unavailable');
    const sourceProof = await this.verifyHome(source);
    const destinationProof = await this.verifyHome(destination);
    return [sourceProof, destinationProof];
  }

  private async verifyHome(home: WalletHome): Promise<TenantResourceVerificationV1> {
    const row = await queryD1One(
      this.database,
      `SELECT
        json_extract(proof.value, '$.authority.gateway.workerName') AS gateway,
        json_extract(proof.value, '$.authority.walletRuntime.workerName') AS runtime
      FROM active_tenant_deployment_bindings active
      JOIN tenant_deployment_activations activation
        ON activation.deployment_lane = active.deployment_lane
        AND activation.activation_sequence = active.activation_sequence
        AND activation.binding_revision = active.revision,
      json_each(activation.resource_verifications_json) proof
      WHERE active.deployment_lane = ?1
        AND json_extract(proof.value, '$.resource.namespace') = ?2
        AND json_extract(proof.value, '$.resource.accountId') = ?3
        AND json_extract(proof.value, '$.resource.databaseId') = ?4
        AND json_extract(proof.value, '$.authority.kind') = 'cloudflare'`,
      [this.deploymentLane, this.namespace, home.accountId, home.databaseId],
    );
    if (
      !row ||
      typeof row.gateway !== 'string' ||
      !row.gateway ||
      typeof row.runtime !== 'string' ||
      !row.runtime ||
      row.gateway === row.runtime
    )
      throw new Error('Relocation resource has no admitted writer identities');
    const beforeTime = new Date().toISOString();
    const before = [
      await this.readWriter(home, row.gateway),
      await this.readWriter(home, row.runtime),
    ];
    const challengeId = randomHex();
    const expectedProof = randomHex();
    const issuedAtMs = Date.now();
    const resource = TenantDeploymentD1ResourceIdentityV1.parse({
      namespace: this.namespace,
      accountId: home.accountId,
      databaseId: home.databaseId,
    });
    try {
      await this.query(
        home,
        'INSERT INTO deployment_resource_challenges (namespace, challenge_id, account_id, database_id, proof, issued_at_ms, expires_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7)',
        [
          this.namespace,
          challengeId,
          home.accountId,
          home.databaseId,
          expectedProof,
          issuedAtMs,
          issuedAtMs + 300_000,
        ],
      );
      const checkpoint = await this.runtime.verify({
        deploymentLane: this.deploymentLane,
        resource,
        challengeId,
        expectedProof,
      });
      const after = [
        await this.readWriter(home, row.gateway),
        await this.readWriter(home, row.runtime),
      ];
      if (
        JSON.stringify(before) !== JSON.stringify(after) ||
        checkpoint.writerVersions.gateway !== before[0].versions[0].versionId ||
        checkpoint.writerVersions.walletRuntime !== before[1].versions[0].versionId
      )
        throw new Error('Relocation writer deployment changed during verification');
      return TenantResourceVerificationV1.fromOperatorCheckpoint(
        {
          kind: 'tenant_d1_resource_checkpoint_v1',
          deploymentLane: this.deploymentLane,
          resource,
          challengeId,
          checkedAtMs: checkpoint.checkedAtMs,
          expiresAtMs: checkpoint.expiresAtMs,
          providerCheckedBefore: beforeTime,
          providerCheckedAfter: new Date().toISOString(),
          workers: after,
          writerVersions: checkpoint.writerVersions,
          runtimeChallengeVerified: true,
          activationAuthorized: false,
        },
        Date.now(),
      );
    } finally {
      await this.query(
        home,
        'DELETE FROM deployment_resource_challenges WHERE namespace = ?1 AND challenge_id = ?2 AND proof = ?3',
        [this.namespace, challengeId, expectedProof],
      );
    }
  }

  private async readWriter(home: WalletHome, workerName: string): Promise<ProviderWriter> {
    const path = `workers/scripts/${encodeURIComponent(workerName)}`;
    const deploymentResult = await this.provider(home.accountId, `${path}/deployments`, null);
    if (!isPlainObject(deploymentResult) || !Array.isArray(deploymentResult.deployments))
      throw new Error('Serving deployments are unavailable');
    const deployment: unknown = deploymentResult.deployments[0];
    if (
      !isPlainObject(deployment) ||
      typeof deployment.id !== 'string' ||
      deployment.strategy !== 'percentage' ||
      !Array.isArray(deployment.versions) ||
      deployment.versions.length !== 1
    )
      throw new Error('Relocation requires one serving writer version');
    const version: unknown = deployment.versions[0];
    if (
      !isPlainObject(version) ||
      typeof version.version_id !== 'string' ||
      version.percentage !== 100
    )
      throw new Error('Relocation requires one fully serving writer version');
    const details = await this.provider(
      home.accountId,
      `${path}/versions/${encodeURIComponent(version.version_id)}`,
      null,
    );
    if (
      !isPlainObject(details) ||
      details.id !== version.version_id ||
      !isPlainObject(details.resources) ||
      !Array.isArray(details.resources.bindings)
    )
      throw new Error('Writer version bindings are unavailable');
    let matched = false;
    for (const binding of details.resources.bindings) {
      if (!isPlainObject(binding) || binding.name !== 'SIGNER_DB') continue;
      if (matched || binding.type !== 'd1' || binding.id !== home.databaseId)
        throw new Error('Writer database binding differs from the admitted resource');
      matched = true;
    }
    if (!matched) throw new Error('Writer database binding is missing');
    return {
      workerName,
      deploymentId: deployment.id,
      versions: [{ versionId: version.version_id, percentage: 100, databaseId: home.databaseId }],
    };
  }

  private async query(
    home: WalletHome,
    sql: string,
    params: readonly (string | number)[],
  ): Promise<void> {
    const result = await this.provider(home.accountId, `d1/database/${home.databaseId}/query`, {
      sql,
      params,
    });
    if (
      !Array.isArray(result) ||
      result.length !== 1 ||
      !isPlainObject(result[0]) ||
      result[0].success !== true
    )
      throw new Error('Resource challenge query did not succeed');
  }

  private async provider(
    accountId: string,
    path: string,
    body: { readonly sql: string; readonly params: readonly (string | number)[] } | null,
  ): Promise<unknown> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/${path}`,
      {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    if (!response.ok) throw new Error(`Resource verification returned HTTP ${response.status}`);
    const raw: unknown = await response.json();
    if (!isPlainObject(raw) || raw.success !== true)
      throw new Error('Resource verification failed');
    return raw.result;
  }
}

function randomHex(): string {
  let encoded = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(32)))
    encoded += byte.toString(16).padStart(2, '0');
  return encoded;
}
