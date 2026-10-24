import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readBackendLane } from '../../../scripts/deployment-targets.mjs';
import { CloudflareD1Operator } from './cloudflare-d1-operator.mjs';

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
  const lane = input.lane;
  const namespace = lane.accountNamespace;
  const result = await input.provider.query(lane.console.database.id, ENVIRONMENT_LOOKUP, [
    namespace,
    lane.identity.organizationId,
    lane.identity.projectId,
    lane.identity.environmentId,
  ]);
  const rows = result.rows;
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
    accountDatabaseId: lane.console.database.id,
    state: bindings.some(isActiveBinding) ? 'assigned' : 'unassigned',
    bindings,
    deploymentChanged: false,
  };
}

function isActiveBinding(binding) {
  return binding.active;
}

async function main() {
  const record = await inspectGetSignalDeployment({
    lane: readBackendLane('getsignal-testnet'),
    provider: new CloudflareD1Operator({
      accountId: requireEnvironmentValue('CLOUDFLARE_ACCOUNT_ID'),
      apiToken: requireEnvironmentValue('CLOUDFLARE_API_TOKEN'),
      fetcher: fetch,
    }),
    sourceRevision: requireEnvironmentValue('GITHUB_SHA'),
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
