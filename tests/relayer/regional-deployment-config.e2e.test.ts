import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const packageRoot = path.join(repositoryRoot, 'packages/wallet-console-server-ts');
const renderer = path.join(packageRoot, 'scripts/render-d1-gateway-config.mjs');
const allocations = path.join(
  repositoryRoot,
  'tests/fixtures/tenant-deployment/allocated-regional-targets.mjs',
);
const accountId = '0123456789abcdef0123456789abcdef';
const resources = [
  {
    region: 'US',
    databaseId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    placement: 'aws:us-east-1',
    suffix: '-us',
  },
  {
    region: 'WEUR',
    databaseId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    placement: 'aws:eu-west-2',
    suffix: '-weur',
  },
  {
    region: 'APAC',
    databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    placement: 'aws:ap-southeast-1',
    suffix: '',
  },
  {
    region: 'OC',
    databaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    placement: 'aws:ap-southeast-2',
    suffix: '-oc',
  },
];

function runRenderer(
  worker: string,
  region: string,
  output: string,
  allocated: boolean,
  pendingCounter = false,
  counterReuse = 'none',
) {
  const args = allocated ? ['--import', allocations] : [];
  args.push(renderer, '--lane', 'production-testnet', '--worker', worker, '--output', output);
  if (region) args.push('--region', region);
  return execute(process.execPath, args, {
    cwd: packageRoot,
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: accountId,
      SEAMS_TEST_PENDING_OTP_COUNTER: pendingCounter ? '1' : '0',
      SEAMS_TEST_COUNTER_DATABASE_REUSE: counterReuse,
    },
  });
}

test('regional rollout renders one shared Console and four isolated writer pairs, refusing missing allocations', async ({
  request: _request,
}, testInfo) => {
  const rejectedCounterBindings = [];
  for (const reuse of ['console', 'signer', 'other-lane']) {
    const output = testInfo.outputPath(`rejected-counter-${reuse}.json`);
    await expect(runRenderer('gateway', 'US', output, true, false, reuse)).rejects.toThrow(
      /distinct database|identities must be distinct|backend D1 identities/,
    );
    await expect(readFile(output)).rejects.toThrow();
    rejectedCounterBindings.push(reuse);
  }
  const configs = [];
  const catalog = [];
  const gatewayBindings = [];
  const runtimeBindings = [];
  for (const resource of resources) {
    catalog.push({ region: resource.region, accountId, databaseId: resource.databaseId });
    gatewayBindings.push({
      binding: `WALLET_GATEWAY_${resource.region}`,
      service: `seams-sdk-d1-gateway-testnet${resource.suffix}`,
    });
    runtimeBindings.push({
      binding: `WALLET_RUNTIME_${resource.region}`,
      service: `seams-sdk-d1-wallet-runtime-testnet${resource.suffix}`,
    });
  }
  for (const worker of ['gateway', 'wallet-runtime', 'console']) {
    const regions = worker === 'console' ? [''] : ['US', 'WEUR', 'APAC', 'OC'];
    for (const region of regions) {
      const output = testInfo.outputPath(`${worker}-${region || 'shared'}.json`);
      await expect(runRenderer(worker, region, output, false)).rejects.toThrow(
        'US signer D1 allocation is pending',
      );
      await expect(readFile(output)).rejects.toThrow();
      if (worker === 'gateway') {
        await expect(runRenderer(worker, region, output, true, true)).rejects.toThrow(
          'shared Email OTP counter D1 allocation is pending',
        );
        await expect(readFile(output)).rejects.toThrow();
      }
      await runRenderer(worker, region, output, true);
      const config = JSON.parse(await readFile(output, 'utf8'));
      expect(JSON.parse(config.vars.SEAMS_WALLET_HOME_CATALOG_JSON)).toEqual(catalog);
      expect(config.workers_dev).toBe(false);
      if (worker === 'console') {
        expect(config.d1_databases).toHaveLength(1);
        expect(config.d1_databases[0].binding).toBe('CONSOLE_DB');
        expect(config.services).toEqual([
          ...gatewayBindings,
          ...runtimeBindings,
          { binding: 'WALLET_RUNTIME', service: 'seams-sdk-d1-wallet-runtime-testnet' },
        ]);
        expect(config.vars.SEAMS_D1_HOME_DATABASE_ID).toBeUndefined();
        expect(config.placement).toBeUndefined();
      } else {
        const resource = resources.find(matchesRegion.bind(null, region));
        if (!resource) throw new Error('Missing regional resource');
        expect(config.d1_databases).toHaveLength(worker === 'gateway' ? 2 : 1);
        expect(config.d1_databases[0]).toMatchObject({
          binding: 'SIGNER_DB',
          database_id: resource.databaseId,
        });
        expect(config.vars.SEAMS_D1_HOME_DATABASE_ID).toBe(resource.databaseId);
        expect(config.placement).toEqual({ region: resource.placement });
        if (worker === 'gateway') {
          expect(config.d1_databases[1]).toMatchObject({
            binding: 'EMAIL_OTP_RATE_LIMIT_DB',
            database_id: '99999999-9999-4999-8999-999999999999',
            migrations_dir: path.join(packageRoot, 'migrations/d1-email-otp-rate-limit'),
          });
          expect(config.services).toEqual(expect.arrayContaining(gatewayBindings));
          expect(config.routes).toHaveLength(region === 'APAC' ? 1 : 0);
        } else {
          expect(config.routes).toBeUndefined();
        }
      }
      configs.push(config);
    }
  }
  const evidence = testInfo.outputPath('regional-deployment-config-evidence.json');
  await writeFile(
    evidence,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        remoteCloudflareUsed: false,
        rejectedCounterBindings,
        allocationSource: 'child-process fixture; canonical US/WEUR/OC allocations remain pending',
        configs,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('regional-deployment-config', {
    path: evidence,
    contentType: 'application/json',
  });
});

function matchesRegion(region: string, resource: { region: string }): boolean {
  return resource.region === region;
}
