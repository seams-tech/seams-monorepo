import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const accountId = '0123456789abcdef0123456789abcdef';
const versionA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const versionB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const deploymentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const secretMarker = 'fixture-secret-must-never-appear-in-evidence';

type Scenario =
  | 'matching'
  | 'wrong_database'
  | 'missing_binding'
  | 'duplicate_binding'
  | 'wrong_version'
  | 'deployment_changed'
  | 'weights_changed'
  | 'invalid_weights'
  | 'provider_denied';

class ProviderFixture {
  scenario: Scenario = 'matching';
  readonly reads: string[] = [];
  readonly deployments = new Map<string, number>();

  constructor(readonly databaseId: string) {}

  respond(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== 'GET' || request.headers.authorization !== `Bearer ${secretMarker}`) {
      response.writeHead(405).end();
      return;
    }
    const pathname = request.url ?? '';
    this.reads.push(pathname);
    const match = pathname.match(
      /^\/client\/v4\/accounts\/0123456789abcdef0123456789abcdef\/workers\/scripts\/(seams-sdk-d1-(?:gateway|wallet-runtime)-testnet)\/(deployments|versions\/[a-f0-9-]+)$/u,
    );
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    if (this.scenario === 'provider_denied') {
      response.writeHead(403).end(JSON.stringify({ errors: [{ message: secretMarker }] }));
      return;
    }
    const worker = match[1];
    const operation = match[2];
    let result: unknown;
    if (operation === 'deployments') {
      const reads = (this.deployments.get(worker) ?? 0) + 1;
      this.deployments.set(worker, reads);
      const changed = reads > 1;
      const second = this.scenario === 'invalid_weights' ? 24 : 25;
      result = {
        deployments: [
          {
            id: changed && this.scenario === 'deployment_changed' ? versionB : deploymentId,
            strategy: 'percentage',
            versions: [
              {
                version_id: versionA,
                percentage: changed && this.scenario === 'weights_changed' ? 50 : 75,
              },
              {
                version_id: versionB,
                percentage: changed && this.scenario === 'weights_changed' ? 50 : second,
              },
            ],
          },
        ],
      };
    } else {
      const versionId = operation.slice('versions/'.length);
      const minorityRuntime = worker.includes('wallet-runtime') && versionId === versionB;
      const binding = {
        type: 'd1',
        name: 'SIGNER_DB',
        id: minorityRuntime && this.scenario === 'wrong_database' ? versionA : this.databaseId,
      };
      const bindings: unknown[] = [
        { type: 'secret_text', name: 'PRIVATE_SECRET', text: secretMarker },
      ];
      if (!(minorityRuntime && this.scenario === 'missing_binding')) bindings.push(binding);
      if (minorityRuntime && this.scenario === 'duplicate_binding') bindings.push(binding);
      result = {
        id: minorityRuntime && this.scenario === 'wrong_version' ? versionA : versionId,
        resources: { bindings },
      };
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ success: true, result }));
  }
}

async function runCli(origin: string, output: string): Promise<number> {
  try {
    await execute(
      process.execPath,
      [
        '--import',
        path.join(root, 'tests/fixtures/tenant-deployment/provider-api-transport.mjs'),
        path.join(root, 'scripts/verify-tenant-d1-bindings.mjs'),
        '--lane',
        'production-testnet',
        '--output',
        output,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: accountId,
          CLOUDFLARE_API_TOKEN: secretMarker,
          TENANT_PROVIDER_FIXTURE_ORIGIN: origin,
        },
      },
    );
    return 0;
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'number')
      return error.code;
    throw error;
  }
}

test('provider checkpoint checks both gradual-rollout writers and rejects drift without leaking provider secrets', async ({
  request,
}, testInfo) => {
  const targets = JSON.parse(
    await readFile(path.join(root, 'deployment/wallet-system/targets.json'), 'utf8'),
  );
  // Use the deployment command's real target resource, with only the provider HTTP boundary controlled.
  const databaseId =
    targets.production.lanes.testnet.provisioning.gatewayDeploymentConfig.resources.signerD1.id;
  if (typeof databaseId !== 'string') throw new Error('Configured signer D1 is missing');
  const fixture = new ProviderFixture(databaseId);
  const server = createServer(fixture.respond.bind(fixture));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('provider fixture has no address');
  const origin = `http://127.0.0.1:${address.port}`;
  const observations = [];
  try {
    expect((await request.get(origin)).status()).toBe(405);
    const scenarios: readonly Scenario[] = [
      'matching',
      'wrong_database',
      'missing_binding',
      'duplicate_binding',
      'wrong_version',
      'deployment_changed',
      'weights_changed',
      'invalid_weights',
      'provider_denied',
    ];
    for (const scenario of scenarios) {
      fixture.scenario = scenario;
      fixture.reads.length = 0;
      fixture.deployments.clear();
      const output = testInfo.outputPath(`${scenario}.json`);
      const exitCode = await runCli(origin, output);
      const raw = await readFile(output, 'utf8');
      const result = JSON.parse(raw);
      expect(raw).not.toContain(secretMarker);
      expect(result.runtimeChallengeVerified).toBe(false);
      expect(result.activationAuthorized).toBe(false);
      if (scenario === 'matching') {
        expect(exitCode).toBe(0);
        expect(result.status).toBe('provider_bindings_match');
        expect(result.workers).toHaveLength(2);
        for (const worker of result.workers) {
          expect(worker.versions).toHaveLength(2);
          expect(
            worker.versions.map((version: { databaseId: string }) => version.databaseId),
          ).toEqual([fixture.databaseId, fixture.databaseId]);
        }
        expect(fixture.reads).toHaveLength(8);
        // A rerun cannot silently retain or replace a previous successful checkpoint.
        expect(await runCli(origin, output)).toBe(1);
        expect(await readFile(output, 'utf8')).toBe(raw);
        expect(fixture.reads).toHaveLength(8);
      } else {
        expect(exitCode).toBe(1);
        expect(result.status).toBe('failed');
        expect(result.workers).toBeUndefined();
      }
      observations.push({ scenario, exitCode, result, providerReads: fixture.reads.length });
    }
    const evidence = {
      kind: 'provider_binding_checkpoint_e2e_v1',
      checkedAt: new Date().toISOString(),
      transport: 'actual Node CLI against controlled loopback Cloudflare API fixture',
      remoteCloudflareUsed: false,
      observations,
    };
    const evidencePath = testInfo.outputPath('provider-binding-checkpoint-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach('provider-binding-checkpoint', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
});
