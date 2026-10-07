import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmod, cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);

class PagesProvider {
  readonly reads: string[] = [];
  constructor(readonly directory: string) {}

  async handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://fixture');
    this.reads.push(url.pathname);
    const relative = url.pathname.replace(/^\//, '');
    const filename = path.resolve(this.directory, relative);
    if (!filename.startsWith(this.directory + path.sep)) {
      response.writeHead(400).end();
      return;
    }
    try {
      const resource =
        url.pathname.endsWith('/') || url.pathname.endsWith('/wallet-settings')
          ? path.join(this.directory, relative.split('/')[0], 'index.html')
          : filename;
      const content = await readFile(resource);
      response.setHeader(
        'content-type',
        resource.endsWith('.json') ? 'application/json' : 'text/html',
      );
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  }
}

async function prepareCheckout(checkout: string) {
  const files = [
    'scripts/deploy-surface.mjs',
    'scripts/deployment-targets.mjs',
    'scripts/deployment-smoke.mjs',
    'deployment/wallet-system/targets.json',
    'deployment/console/targets.json',
    'packages/wallet-console-server-ts/scripts/gateway-deployment-config.mjs',
    'apps/wallet-console/package.json',
  ];
  for (const file of files) {
    await mkdir(path.dirname(path.join(checkout, file)), { recursive: true });
    await cp(path.join(root, file), path.join(checkout, file));
  }
  for (const directory of ['apps/wallet-console/src', 'apps/wallet-console/wallet-host']) {
    await cp(path.join(root, directory), path.join(checkout, directory), { recursive: true });
  }
  await symlink(path.join(root, 'node_modules'), path.join(checkout, 'node_modules'));
}

function buildEnvironment(
  checkout: string,
  providerDirectory: string,
  origin: string,
  realPnpm: string,
) {
  const env: NodeJS.ProcessEnv = {
    PATH: `${path.join(checkout, 'bin')}:${process.env.PATH}`,
    HOME: process.env.HOME,
    GITHUB_REF: 'refs/heads/main',
    CLOUDFLARE_API_TOKEN: 'local-fixture-only',
    CLOUDFLARE_ACCOUNT_ID: 'local-fixture-only',
    CF_PAGES_PROJECT_WALLET_TESTNET: 'fixture-testnet',
    FRONTEND_REAL_PNPM: realPnpm,
    FRONTEND_PROVIDER_DIRECTORY: providerDirectory,
    FRONTEND_PROVIDER_ORIGIN: origin,
    FRONTEND_DEPLOY_LOG: path.join(checkout, 'deployments.jsonl'),
    NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'tests/fixtures/tenant-deployment/frontend-pages-transport.mjs'))}`,
  };
  for (const network of ['TESTNET', 'MAINNET']) {
    env[`VITE_${network}_NEAR_NETWORK`] = network.toLowerCase();
    env[`VITE_${network}_NEAR_RPC_URL`] = 'https://rpc.example.test';
    env[`VITE_${network}_NEAR_EXPLORER`] = 'https://explorer.example.test';
    env[`VITE_${network}_SIGNING_SESSION_PERSISTENCE_MODE`] = 'sealed_refresh_v1';
  }
  return env;
}

async function runFrontend(
  checkout: string,
  env: NodeJS.ProcessEnv,
  operation: string,
  args: string[],
) {
  return execute(
    process.execPath,
    [
      path.join(checkout, 'scripts/deploy-surface.mjs'),
      operation,
      '--site',
      'production',
      '--component',
      'wallet-host',
      ...args,
    ],
    { cwd: checkout, env, maxBuffer: 8 * 1024 * 1024 },
  );
}

test('a testnet frontend build, deploy and smoke preserves the mainnet deployment', async ({
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const checkout = testInfo.outputPath('checkout');
  await prepareCheckout(checkout);
  await mkdir(path.join(checkout, 'bin'));
  await cp(
    path.join(root, 'tests/fixtures/tenant-deployment/frontend-pages-command.mjs'),
    path.join(checkout, 'bin/pnpm'),
  );
  await chmod(path.join(checkout, 'bin/pnpm'), 0o755);
  const realPnpm = (await execute('which', ['pnpm'])).stdout.trim();
  const providerDirectory = testInfo.outputPath('pages');
  await mkdir(path.join(providerDirectory, 'fixture-mainnet'), { recursive: true });
  const mainnet = path.join(providerDirectory, 'fixture-mainnet/index.html');
  await writeFile(mainnet, 'Existing mainnet release');
  const before = createHash('sha256')
    .update(await readFile(mainnet))
    .digest('hex');
  const provider = new PagesProvider(providerDirectory);
  const server = createServer(provider.handle.bind(provider));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const env = buildEnvironment(
    checkout,
    providerDirectory,
    `http://127.0.0.1:${address.port}`,
    realPnpm,
  );
  try {
    for (const operation of ['build', 'deploy', 'smoke']) {
      const result = await runFrontend(checkout, env, operation, ['--lane', 'production-testnet']);
      await writeFile(testInfo.outputPath(`${operation}.log`), result.stdout + result.stderr);
    }
    const manifest = JSON.parse(
      await readFile(
        path.join(providerDirectory, 'fixture-testnet/wallet-assets.manifest.json'),
        'utf8',
      ),
    );
    const deployments = [];
    for (const line of (await readFile(path.join(checkout, 'deployments.jsonl'), 'utf8'))
      .trim()
      .split('\n')) {
      deployments.push(JSON.parse(line));
    }
    expect(deployments).toEqual([
      {
        project: 'fixture-testnet',
        output: path.join(checkout, '.release-artifacts/wallet-host/production-testnet'),
      },
    ]);
    expect(provider.reads).toHaveLength(5);
    for (const request of provider.reads) expect(request).toMatch(/^\/fixture-testnet\//);
    const smokeRequests = [...provider.reads];
    const mainnetResponse = await request.get(`http://127.0.0.1:${address.port}/fixture-mainnet/`);
    expect(mainnetResponse.status()).toBe(200);
    expect(await mainnetResponse.text()).toBe('Existing mainnet release');
    const after = createHash('sha256')
      .update(await readFile(mainnet))
      .digest('hex');
    expect(after).toBe(before);
    await expect(
      runFrontend(checkout, env, 'deploy', ['--lane', 'staging-testnet']),
    ).rejects.toThrow('does not belong');
    await expect(
      runFrontend(checkout, env, 'deploy', [
        '--lane',
        'production-testnet',
        '--lane',
        'production-mainnet',
      ]),
    ).rejects.toThrow('only be provided once');
    await expect(
      runFrontend(checkout, env, 'deploy', ['--component', 'all', '--lane', 'production-testnet']),
    ).rejects.toThrow('requires --component wallet-host');
    const mainnetEnv = { ...env, CF_PAGES_PROJECT_WALLET_MAINNET: 'fixture-mainnet' };
    await expect(
      runFrontend(checkout, mainnetEnv, 'deploy', ['--lane', 'production-mainnet']),
    ).rejects.toThrow('Hosted wallet Pages output is missing');
    expect(await readFile(path.join(checkout, 'deployments.jsonl'), 'utf8')).toBe(
      JSON.stringify(deployments[0]) + '\n',
    );
    await writeFile(
      testInfo.outputPath('frontend-lane-evidence.json'),
      JSON.stringify(
        {
          packageVersion: manifest.packageVersion,
          deployments,
          smokeRequests,
          unselectedMainnet: { before, after },
          invalidSelectionRejected: true,
          mismatchedBuildScopeRejected: true,
          provider: 'local Pages emulator',
        },
        null,
        2,
      ),
    );
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});
