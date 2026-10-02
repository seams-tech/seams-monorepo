import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isD1DatabaseLike, type D1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  consoleWalletKeyString,
  type ConsoleWalletKey,
} from '../../packages/wallet-console-shared-ts/src/walletIdentity';
import type { ConsoleWallet } from '../../packages/wallet-console-server-ts/src/wallets/types';

const root = fileURLToPath(new URL('../../', import.meta.url));
const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
const identityPath = '/internal/wallet-runtime/v1/wallet-identities';

interface SeededWallet {
  wallet: ConsoleWallet;
  envKey: string;
}

class RpcProvider {
  calls = 0;
  failTempo = false;

  async fetch(request: Request): Promise<Response> {
    this.calls += 1;
    const body = (await request.json()) as { method: string; params: any };
    switch (body.method) {
      case 'query':
        return Response.json({
          error: { cause: { name: 'UNKNOWN_ACCOUNT' }, data: 'Account does not exist' },
        });
      case 'eth_call': {
        if (this.failTempo) return new Response('unavailable', { status: 503 });
        const ordinal = BigInt(`0x${body.params[0].data.slice(-2)}`);
        return Response.json({ result: `0x${(ordinal * 10_000n).toString(16)}` });
      }
      case 'eth_getBalance':
        return Response.json({ result: '0x0' });
      default:
        throw new Error(`Unexpected RPC method: ${body.method}`);
    }
  }
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function walletKey(wallet: ConsoleWalletKey): ConsoleWalletKey {
  return { id: wallet.id, projectId: wallet.projectId, environmentId: wallet.environmentId };
}

async function applyMigrations(database: D1DatabaseLike, directory: string) {
  const hashes = [];
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    if (name === '0053_wallet_projection_identity.sql') {
      await seedPreviousWalletProjection(database);
    }
    const source = await readFile(path.join(directory, name), 'utf8');
    for (const sql of unstable_splitSqlQuery(source)) await database.prepare(sql).run();
    hashes.push({ name, sha256: createHash('sha256').update(source).digest('hex') });
  }
  return hashes;
}

async function seedPreviousWalletProjection(database: D1DatabaseLike): Promise<void> {
  await database
    .prepare(
      `INSERT INTO wallet_index
    (namespace, org_id, id, project_id, environment_id, user_id, external_ref_id,
     address, chain, wallet_type, status, policy_id, balance_minor,
     last_activity_at_ms, created_at_ms, updated_at_ms)
    VALUES ('migration', 'org', 'wallet', 'project', 'environment', 'user', 'ref',
      'wallet', 'Multichain', 'EOA', 'ACTIVE', NULL, 999, 1, 1, 1)`,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO wallet_balance_snapshots
    (namespace, org_id, wallet_id, near_account_id, evm_address, near_balance_yocto,
     tempo_alpha_usd_raw, arc_balance_wei, stablecoin_balance_minor, funded, observed_at_ms)
    VALUES ('migration', 'org', 'wallet', 'wallet.testnet',
      '0x1111111111111111111111111111111111111111', '0', '9990000', '0', 999, 1, 1)`,
    )
    .run();
}

async function seedSignerIdentities(
  database: D1DatabaseLike,
  namespace: string,
  orgId: string,
  seeds: readonly SeededWallet[],
  offset: number,
) {
  for (const [index, seed] of seeds.entries()) {
    const walletId = seed.wallet.id;
    const nearAccountId = `${namespace}-${orgId}-${index}.testnet`;
    const address = `0x${(offset + index + 1).toString(16).padStart(40, '0')}`;
    // Public identity projections only; this fixture never exercises a signing ceremony.
    const ed25519 = {
      version: 'wallet_signer_ed25519_v1',
      walletId,
      signerId: 'ed25519:fixture',
      nearAccountId,
    };
    const ecdsa = {
      version: 'wallet_signer_ecdsa_v1',
      walletId,
      signerId: 'ecdsa:eip155:1',
      chainTargetKey: 'eip155:1',
      walletKey: { thresholdOwnerAddress: address },
    };
    for (const [family, target, record] of [
      ['ed25519', null, ed25519],
      ['ecdsa', 'eip155:1', ecdsa],
    ] as const) {
      await database
        .prepare(
          `INSERT INTO wallet_signers
        (namespace, org_id, project_id, env_id, wallet_id, signer_family, signer_id,
         chain_target_key, record_json, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        )
        .bind(
          namespace,
          orgId,
          seed.wallet.projectId,
          seed.envKey,
          walletId,
          family,
          record.signerId,
          target,
          JSON.stringify(record),
        )
        .run();
    }
  }
}

test('Console preserves full wallet scope through Runtime, pagination and cached balance refresh', async ({}, testInfo) => {
  test.skip(!candidate, 'Requires a packed Wallet Server candidate; see the R152 release review');
  test.setTimeout(120_000);
  if (!candidate) throw new Error('Candidate is required');
  const packageJsonPath = path.resolve(candidate, 'package.json');
  const definition = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  expect(definition.name).toBe('@seams/wallet-server');
  const resolveCandidate = createRequire(packageJsonPath);
  const aliases: Record<string, string> = {};
  for (const key of Object.keys(definition.exports)) {
    if (key.includes('*')) continue;
    const specifier = key === '.' ? definition.name : `${definition.name}/${key.slice(2)}`;
    aliases[specifier] = resolveCandidate.resolve(specifier);
  }
  const output = testInfo.outputPath('workers');
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: [path.join(root, 'tests/helpers/walletIdentityConsoleWorker.ts')],
    outfile: path.join(output, 'console.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    tsconfig: path.join(root, 'tests/tsconfig.playwright.json'),
    alias: aliases,
    loader: { '.wasm': 'binary' },
  });
  await build({
    stdin: {
      contents: `import { handleSplitGatewayWalletRuntimeRequest } from '@seams/wallet-server/hosted-wallet-gateway';
export default { async fetch(request, env) {
  return await handleSplitGatewayWalletRuntimeRequest(request, env) ?? new Response('Not found', { status: 404 });
}};`,
      resolveDir: root,
    },
    outfile: path.join(output, 'runtime.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: aliases,
    loader: { '.wasm': 'binary' },
  });
  const rpc = new RpcProvider();
  const consoleWorkers = [
    ['console', 'namespace-a', 'org-a', 'runtime-a'],
    ['console-b', 'namespace-b', 'org-a', 'runtime-b'],
    ['console-other-org', 'namespace-a', 'org-other', 'runtime-a'],
    ['console-wrong-response', 'namespace-a', 'org-a', 'wrong-runtime'],
  ].map(([name, namespace, orgId, runtime]) => ({
    name,
    modules: true,
    scriptPath: path.join(output, 'console.js'),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    bindings: { NAMESPACE: namespace, ORG_ID: orgId },
    d1Databases: { CONSOLE_DB: 'console-database' },
    serviceBindings: { WALLET_RUNTIME: runtime, RPC: rpc.fetch.bind(rpc) },
  }));
  const runtimeWorkers = ['a', 'b'].map((suffix) => ({
    name: `runtime-${suffix}`,
    modules: true,
    scriptPath: path.join(output, 'runtime.js'),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    bindings: { SEAMS_TENANT_STORAGE_NAMESPACE: `namespace-${suffix}` },
    d1Databases: { SIGNER_DB: 'signer-database' },
  }));
  const runtime = new Miniflare({
    workers: [
      ...consoleWorkers,
      ...runtimeWorkers,
      {
        name: 'wrong-runtime',
        modules: true,
        script: `export default { async fetch(request) {
      const body = await request.json();
      return Response.json({ identities: body.wallets.map(wallet => ({
        ...wallet, envId: 'unexpected-environment', nearAccountId: 'wrong.testnet',
        evmAddress: '0x1111111111111111111111111111111111111111'
      })) });
    }};`,
      },
    ],
  });
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'console');
    const signerDatabase = await runtime.getD1Database('SIGNER_DB', 'runtime-a');
    if (!isD1DatabaseLike(database) || !isD1DatabaseLike(signerDatabase))
      throw new Error('D1 unavailable');
    const consoleMigrations = await applyMigrations(
      database,
      path.join(root, 'packages/wallet-console-server-ts/migrations/d1-console'),
    );
    const signerMigrations = await applyMigrations(
      signerDatabase,
      path.join(candidate, 'migrations/d1-signer'),
    );
    const migratedWallet = await database
      .prepare(
        "SELECT id, project_id, environment_id, balance_minor FROM wallet_index WHERE namespace = 'migration'",
      )
      .first();
    expect(migratedWallet).toEqual({
      id: 'wallet',
      project_id: 'project',
      environment_id: 'environment',
      balance_minor: 0,
    });
    expect(
      (
        await database
          .prepare("SELECT * FROM wallet_balance_snapshots WHERE namespace = 'migration'")
          .all()
      ).results,
    ).toEqual([]);
    const consoleA = await runtime.getWorker('console');
    const consoleB = await runtime.getWorker('console-b');
    const otherOrg = await runtime.getWorker('console-other-org');
    const wrongResponse = await runtime.getWorker('console-wrong-response');
    const runtimeA = await runtime.getWorker('runtime-a');
    const seedsA = (await (
      await consoleA.fetch('https://console.test/fixture/seed')
    ).json()) as SeededWallet[];
    const seedsB = (await (
      await consoleB.fetch('https://console.test/fixture/seed')
    ).json()) as SeededWallet[];
    expect(seedsA).toHaveLength(3);
    expect(seedsB).toHaveLength(3);
    await seedSignerIdentities(signerDatabase, 'namespace-a', 'org-a', seedsA, 0);
    await seedSignerIdentities(signerDatabase, 'namespace-b', 'org-a', seedsB, 10);
    await seedSignerIdentities(signerDatabase, 'namespace-a', 'org-other', seedsA, 20);
    const keysA = seedsA.map((seed) => walletKey(seed.wallet));
    const keysB = seedsB.map((seed) => walletKey(seed.wallet));

    for (const sortBy of ['createdAt', 'balance', 'lastActivity']) {
      for (const sortOrder of ['asc', 'desc']) {
        const found: ConsoleWalletKey[] = [];
        let cursor = '';
        do {
          const params = new URLSearchParams({ limit: '1', sortBy, sortOrder });
          if (cursor) params.set('cursor', cursor);
          const response = await consoleA.fetch(`https://console.test/console/wallets?${params}`);
          expect(response.status).toBe(200);
          const body = (await response.json()) as { wallets: ConsoleWallet[]; nextCursor?: string };
          found.push(...body.wallets.map(walletKey));
          cursor = body.nextCursor ?? '';
          expect(found.length).toBeLessThanOrEqual(3);
        } while (cursor);
        expect(found.map(consoleWalletKeyString).sort()).toEqual(
          keysA.map(consoleWalletKeyString).sort(),
        );
      }
    }

    expect(
      (await consoleA.fetch('https://console.test/console/wallets/shared-wallet')).status,
    ).toBe(400);
    const exact = new URLSearchParams({
      projectId: keysA[0].projectId,
      environmentId: keysA[0].environmentId,
    });
    expect(
      (await consoleA.fetch(`https://console.test/console/wallets/shared-wallet?${exact}`)).status,
    ).toBe(200);
    expect(
      (await otherOrg.fetch(`https://console.test/console/wallets/shared-wallet?${exact}`)).status,
    ).toBe(404);
    const missingScope = await runtimeA.fetch(
      `https://wallet-runtime.internal${identityPath}`,
      post({
        orgId: 'org-a',
        wallets: [{ walletId: 'shared-wallet', projectId: keysA[0].projectId }],
      }),
    );
    expect(missingScope.status).toBe(400);
    const otherOrgIdentities = (await (
      await runtimeA.fetch(
        `https://wallet-runtime.internal${identityPath}`,
        post({
          orgId: 'org-other',
          wallets: seedsA.map((seed) => ({
            walletId: seed.wallet.id,
            projectId: seed.wallet.projectId,
            envId: seed.envKey,
          })),
        }),
      )
    ).json()) as { identities: { evmAddress: string }[] };
    expect(
      otherOrgIdentities.identities.map((identity) => Number(BigInt(identity.evmAddress))),
    ).toEqual([21, 22, 23]);

    const refreshed = await consoleA.fetch(
      'https://console.test/console/wallets/balances/refresh',
      post({ wallets: keysA }),
    );
    expect(refreshed.status).toBe(200);
    const first = (await refreshed.json()) as any;
    expect(first.failures).toEqual([]);
    expect(first.refreshedWallets).toEqual(keysA);
    expect(first.wallets.map((wallet: ConsoleWallet) => wallet.balanceMinor)).toEqual([1, 2, 3]);
    const otherNamespace = (await (
      await consoleB.fetch(
        'https://console.test/console/wallets/balances/refresh',
        post({ wallets: keysB }),
      )
    ).json()) as any;
    expect(otherNamespace.wallets.map((wallet: ConsoleWallet) => wallet.balanceMinor)).toEqual([
      11, 12, 13,
    ]);
    const callsAfterRefresh = rpc.calls;
    const cached = (await (
      await consoleA.fetch(
        'https://console.test/console/wallets/balances/refresh',
        post({ wallets: keysA }),
      )
    ).json()) as any;
    expect(cached.freshWallets).toEqual(keysA);
    expect(cached.refreshedWallets).toEqual([]);
    expect(rpc.calls).toBe(callsAfterRefresh);
    expect(
      (
        await otherOrg.fetch(
          'https://console.test/console/wallets/balances/refresh',
          post({ wallets: keysA }),
        )
      ).status,
    ).toBe(200);
    expect(rpc.calls).toBe(callsAfterRefresh);
    await wrongResponse.fetch('https://console.test/fixture/advance-clock');
    expect(
      (
        await wrongResponse.fetch(
          'https://console.test/console/wallets/balances/refresh',
          post({ wallets: keysA }),
        )
      ).status,
    ).toBe(500);
    expect(rpc.calls).toBe(callsAfterRefresh);
    await consoleA.fetch('https://console.test/fixture/advance-clock');
    rpc.failTempo = true;
    const failed = (await (
      await consoleA.fetch(
        'https://console.test/console/wallets/balances/refresh',
        post({ wallets: keysA }),
      )
    ).json()) as any;
    expect(failed.failures).toEqual(
      keysA.map((wallet) => ({ wallet, message: 'eth_call returned HTTP 503' })),
    );
    expect(failed.wallets.map((wallet: ConsoleWallet) => wallet.balanceMinor)).toEqual([1, 2, 3]);
    const rows = await database
      .prepare(
        'SELECT namespace, org_id, project_id, environment_id, wallet_id, stablecoin_balance_minor FROM wallet_balance_snapshots ORDER BY namespace, org_id, project_id, environment_id, wallet_id',
      )
      .all();
    expect(rows.results).toHaveLength(6);
    expect((await database.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    const evidence = {
      candidateVersion: definition.version,
      candidateEntrySha256: createHash('sha256')
        .update(
          await readFile(resolveCandidate.resolve('@seams/wallet-server/hosted-wallet-gateway')),
        )
        .digest('hex'),
      migratedWallet,
      consoleMigrations,
      signerMigrations,
      keysA,
      keysB,
      first,
      otherNamespace,
      cached,
      failed,
      otherOrgIdentities,
      rpcCalls: rpc.calls,
      snapshots: rows.results,
    };
    const evidencePath = testInfo.outputPath('wallet-identity-evidence.json');
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    await testInfo.attach('wallet-identity-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
});
