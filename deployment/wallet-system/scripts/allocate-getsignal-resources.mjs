import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readBackendLane } from '../../../scripts/deployment-targets.mjs';
import { inspectGetSignalDeployment } from './inspect-getsignal-deployment.mjs';
import { CloudflareD1Operator } from './cloudflare-d1-operator.mjs';

const REGIONAL_DATABASES = Object.freeze([
  { region: 'US', hint: 'enam', providerRegions: ['ENAM', 'WNAM'] },
  { region: 'WEUR', hint: 'weur', providerRegions: ['WEUR'] },
  { region: 'APAC', hint: 'apac', providerRegions: ['APAC'] },
  { region: 'OC', hint: 'oc', providerRegions: ['OC'] },
]);

export async function allocateGetSignalResources(input) {
  const lane = readBackendLane('getsignal-testnet');
  if (lane.provisioning.kind !== 'pending') {
    throw new Error('GetSignal already has prepared resources; use its recorded deployment');
  }
  const inspection = await inspectGetSignalDeployment(input);
  switch (inspection.state) {
    case 'assigned':
      throw new Error(
        'GetSignal already has an active deployment assignment; review it before provisioning',
      );
    case 'unassigned':
      break;
    default:
      throw new Error('Unknown GetSignal assignment state');
  }
  const regional = [];
  for (const placement of REGIONAL_DATABASES) {
    const allocation = await input.provider.allocateEmptyDatabase(
      `seams-signer-getsignal-${placement.region.toLowerCase()}`,
      placement.hint,
    );
    if (!placement.providerRegions.includes(allocation.database.location.region)) {
      throw new Error(`Unexpected primary region for ${allocation.database.name}`);
    }
    regional.push({ region: placement.region, kind: allocation.kind, database: allocation.database });
  }
  const deriverA = await allocatePrivateRole(input.provider, 'deriver-a');
  const deriverB = await allocateColocatedDeriverB(input, deriverA.database.location.colo);
  const signingWorker = await allocatePrivateRole(input.provider, 'signing-worker');
  return {
    kind: 'getsignal_resource_allocation_v1',
    observedAt: new Date().toISOString(),
    sourceRevision: input.sourceRevision,
    lane: lane.id,
    identity: lane.identity,
    accountDatabaseId: inspection.accountDatabaseId,
    namespace: inspection.namespace,
    regional,
    privateRoles: { deriverA, deriverB, signingWorker },
    deploymentActivated: false,
  };
}

async function allocateColocatedDeriverB(input, expectedColo) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const allocation = await allocatePrivateRole(input.provider, 'deriver-b');
    if (allocation.database.location.colo === expectedColo) return allocation;
    if (allocation.kind !== 'created') {
      throw new Error('An existing GetSignal Deriver B database requires a placement review');
    }
    const current = await inspectGetSignalDeployment(input);
    if (current.state !== 'unassigned') {
      throw new Error('GetSignal assignment changed during resource allocation');
    }
    await input.provider.removeEmptyCreatedDatabase(allocation.database);
    console.log(
      JSON.stringify({
        event: 'getsignal_empty_candidate_removed',
        database: allocation.database,
        attempt,
      }),
    );
  }
  throw new Error(
    'Deriver primary co-location could not be verified within three fresh candidates',
  );
}

async function allocatePrivateRole(provider, role) {
  const allocation = await provider.allocateEmptyDatabase(
    `seams-private-getsignal-${role}`,
    'apac',
  );
  if (allocation.database.location.region !== 'APAC') {
    throw new Error(`Unexpected private signing region for ${allocation.database.name}`);
  }
  return allocation;
}

async function main() {
  const record = await allocateGetSignalResources({
    provider: new CloudflareD1Operator({
      accountId: requiredEnvironmentValue('CLOUDFLARE_ACCOUNT_ID'),
      apiToken: requiredEnvironmentValue('CLOUDFLARE_API_TOKEN'),
      fetcher: fetch,
    }),
    sourceRevision: requiredEnvironmentValue('GITHUB_SHA'),
  });
  const output = path.resolve('.release-artifacts/getsignal/resources.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  console.log('GETSIGNAL_ALLOCATION_EVIDENCE=' + JSON.stringify(record));
}

function requiredEnvironmentValue(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function failed(error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Allocation failed'}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(failed);
}
