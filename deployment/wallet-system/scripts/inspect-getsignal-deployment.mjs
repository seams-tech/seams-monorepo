import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readBackendLane } from '../../../scripts/deployment-targets.mjs';

const ENVIRONMENT_LOOKUP = `
  SELECT e.namespace, e.id AS environment_id, e.project_id, e.org_id, e.status,
         binding.deployment_lane, binding.revision,
         active.revision IS NOT NULL AS is_active,
         json_extract(binding.binding_json, '$.surfaces.gatewayOrigin') AS gateway_origin,
         json_extract(binding.binding_json, '$.surfaces.hostedWalletOrigin') AS wallet_origin
    FROM environments AS e
    LEFT JOIN tenant_deployment_bindings AS binding
      ON binding.namespace = e.namespace AND binding.org_id = e.org_id
     AND binding.project_id = e.project_id AND binding.environment_id = e.id
    LEFT JOIN active_tenant_deployment_bindings AS active
      ON active.deployment_lane = binding.deployment_lane AND active.revision = binding.revision
   WHERE e.namespace = ?1 AND e.org_id = ?2 AND e.project_id = ?3 AND e.id = ?4
   ORDER BY binding.created_at_ms DESC
   LIMIT 257`;

export async function inspectGetSignalDeployment(input) {
  const lane = readBackendLane('getsignal-testnet');
  const control = readBackendLane(lane.controlPlaneLane);
  if (control.provisioning.kind !== 'provisioned') {
    throw new Error('The recorded account control plane is unavailable');
  }
  const namespace = control.provisioning.gatewayDeploymentConfig.tenant.namespace;
  const response = await input.fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/d1/database/${control.console.database.id}/query`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sql: ENVIRONMENT_LOOKUP,
        params: [
          namespace,
          lane.identity.organizationId,
          lane.identity.projectId,
          lane.identity.environmentId,
        ],
      }),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    },
  );
  if (!response.ok)
    throw new Error(`Account registry inspection failed with HTTP ${response.status}`);
  const envelope = await response.json();
  if (
    envelope?.success !== true ||
    !Array.isArray(envelope.result) ||
    envelope.result.length !== 1 ||
    envelope.result[0]?.success !== true ||
    !Array.isArray(envelope.result[0].results)
  ) {
    throw new Error('Account registry inspection returned an invalid D1 response');
  }
  const rows = envelope.result[0].results;
  if (rows.length === 0)
    throw new Error('GetSignal environment was not found in its recorded account control plane');
  if (rows.length > 256) throw new Error('GetSignal binding history requires an operator review');
  const bindings = [];
  for (const row of rows) {
    if (
      row.namespace !== namespace ||
      row.environment_id !== lane.identity.environmentId ||
      row.project_id !== lane.identity.projectId ||
      row.org_id !== lane.identity.organizationId ||
      row.status !== 'ACTIVE'
    ) {
      throw new Error('GetSignal registry identity or environment status differs');
    }
    if (row.deployment_lane === null) continue;
    if (
      typeof row.deployment_lane !== 'string' ||
      typeof row.revision !== 'string' ||
      typeof row.gateway_origin !== 'string' ||
      typeof row.wallet_origin !== 'string' ||
      ![0, 1].includes(row.is_active)
    ) {
      throw new Error('GetSignal registry contains an invalid deployment binding');
    }
    bindings.push({
      deploymentLane: row.deployment_lane,
      revision: row.revision,
      active: row.is_active === 1,
      gatewayOrigin: row.gateway_origin,
      walletOrigin: row.wallet_origin,
    });
  }
  return {
    observedAt: new Date().toISOString(),
    sourceRevision: input.sourceRevision,
    lane: lane.id,
    namespace,
    identity: lane.identity,
    accountDatabaseId: control.console.database.id,
    state: bindings.some(isActiveBinding) ? 'assigned' : 'unassigned',
    bindings,
    deploymentChanged: false,
  };
}

function isActiveBinding(binding) {
  return binding.active;
}

async function main() {
  const accountId = requireEnvironmentValue('CLOUDFLARE_ACCOUNT_ID');
  if (!/^[0-9a-f]{32}$/u.test(accountId)) throw new Error('Invalid Cloudflare account ID');
  const record = await inspectGetSignalDeployment({
    accountId,
    apiToken: requireEnvironmentValue('CLOUDFLARE_API_TOKEN'),
    sourceRevision: requireEnvironmentValue('GITHUB_SHA'),
    fetcher: fetch,
  });
  const output = path.resolve('.release-artifacts/getsignal/inspection.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify(record, null, 2) + '\n');
}

function requireEnvironmentValue(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function failed(error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Inspection failed'}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(failed);
}
