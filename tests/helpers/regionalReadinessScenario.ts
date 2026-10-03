import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TenantDeploymentD1ResourceIdentityV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/deploymentResource';
import {
  combineTenantDeploymentRuntimeInspectorsV1,
  createTenantDeploymentRuntimeInspectionClientV1,
} from '../../packages/wallet-console-server-ts/src/tenantDeployment/runtimeInspection';
import { candidatePackageAliases } from './walletServerCandidate';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

class RuntimeTransport {
  available = true;
  constructor(readonly worker: Awaited<ReturnType<Miniflare['getWorker']>>) {}

  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    if (!this.available) return new Response('Runtime unavailable', { status: 503 });
    const request = new Request(input, init);
    const response = await this.worker.fetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
      signal: request.signal,
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: Object.fromEntries(response.headers),
    });
  }
}

function runtimeWorker(output: string, name: string, databaseId: string) {
  return {
    name,
    modules: true,
    scriptPath: path.join(output, 'runtime.js'),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    bindings: {
      SEAMS_TENANT_STORAGE_NAMESPACE: 'wallet',
      SEAMS_TENANT_DEPLOYMENT_LANE: 'renewal',
      SEAMS_D1_HOME_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      SEAMS_D1_HOME_DATABASE_ID: databaseId,
    },
    d1Databases: { SIGNER_DB: databaseId },
  };
}

function resource(databaseId: string) {
  return TenantDeploymentD1ResourceIdentityV1.parse({
    namespace: 'wallet',
    accountId: '0123456789abcdef0123456789abcdef',
    databaseId,
  });
}

export async function regionalReadinessScenario(output: string) {
  await mkdir(output, { recursive: true });
  const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
  await build({
    entryPoints: {
      runtime: path.join(
        repoRoot,
        'packages/wallet-console-server-ts/src/router/cloudflare/d1WalletRuntimeWorker.ts',
      ),
    },
    outdir: output,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*', 'cloudflare:workers'],
    loader: { '.wasm': 'file' },
    alias: candidate ? candidatePackageAliases(candidate) : {},
    tsconfig: path.join(repoRoot, 'packages/wallet-console-server-ts/tsconfig.json'),
  });
  const us = resource('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const weur = resource('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  const apac = resource('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  const runtime = new Miniflare({
    workers: [
      {
        name: 'console',
        modules: true,
        script: 'export default { fetch() { return new Response("fixture"); } };',
        d1Databases: { CONSOLE_DB: 'renewal-console' },
      },
      runtimeWorker(output, 'runtime-us', us.databaseId),
      runtimeWorker(output, 'runtime-weur', weur.databaseId),
      runtimeWorker(output, 'runtime-apac', apac.databaseId),
    ],
  });
  try {
    const usTransport = new RuntimeTransport(await runtime.getWorker('runtime-us'));
    const weurTransport = new RuntimeTransport(await runtime.getWorker('runtime-weur'));
    const apacTransport = new RuntimeTransport(await runtime.getWorker('runtime-apac'));
    const usInspector = createTenantDeploymentRuntimeInspectionClientV1(usTransport, us);
    const weurInspector = createTenantDeploymentRuntimeInspectionClientV1(weurTransport, weur);
    const apacInspector = createTenantDeploymentRuntimeInspectionClientV1(apacTransport, apac);
    return {
      runtime,
      inspector: combineTenantDeploymentRuntimeInspectorsV1([
        usInspector,
        weurInspector,
        apacInspector,
      ]),
      apacTransport,
      wrongResourceInspector: createTenantDeploymentRuntimeInspectionClientV1(weurTransport, us),
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
