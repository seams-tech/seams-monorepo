import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WalletHome,
  WalletOwnershipKey,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/home';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const accountId = '0123456789abcdef0123456789abcdef';
const homes = [
  WalletHome.parse({ region: 'US', accountId, databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
  WalletHome.parse({
    region: 'WEUR',
    accountId,
    databaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }),
  WalletHome.parse({
    region: 'APAC',
    accountId,
    databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  }),
];

function walletKey(walletId: string, projectId = 'project'): WalletOwnershipKey {
  return WalletOwnershipKey.parse({
    namespace: 'shared',
    organizationId: 'owner',
    projectId,
    environmentId: 'test',
    walletId,
  });
}

function worker(directory: string, name: string) {
  return {
    name,
    modules: true,
    scriptPath: path.join(directory, 'authority.js'),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { CONSOLE_DB: 'wallet-directory' },
  };
}

function start(directory: string): Miniflare {
  return new Miniflare({
    host: '127.0.0.1',
    port: 0,
    d1Persist: path.join(directory, 'd1'),
    workers: [worker(directory, 'ingress-a'), worker(directory, 'ingress-b')],
  });
}

function reservation(walletId: string, home: WalletHome, projectId = 'project') {
  return {
    action: 'reserve',
    wallet: walletKey(walletId, projectId),
    home,
    registrationId: `register-${walletId}`,
  };
}

async function call(runtime: Miniflare, body: unknown, loseReply = false, ingress = 'ingress-a') {
  const service = await runtime.getWorker(ingress);
  return service.fetch(`https://authority.test/${loseReply ? '?loseReply=1' : ''}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

test('wallet homes are independent within a tenant and durable across competing registrations, travel and restart', async ({
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const directory = testInfo.outputPath('authority');
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, 'tests/fixtures/tenant-deployment/walletHomeAuthority.ts')],
    outfile: path.join(directory, 'authority.js'),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*'],
    loader: { '.wasm': 'file' },
    tsconfig: path.join(repoRoot, 'packages/wallet-console-server-ts/tsconfig.json'),
  });
  const migration = await readFile(
    path.join(
      repoRoot,
      'packages/wallet-console-server-ts/migrations/d1-console/0051_wallet_homes.sql',
    ),
    'utf8',
  );
  let runtime = start(directory);
  const observations = [];
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'ingress-a');
    for (const sql of unstable_splitSqlQuery(migration)) await database.prepare(sql).run();
    const missing = await request.post(String(await runtime.ready), {
      data: { action: 'find', wallet: walletKey('missing') },
    });
    expect(missing.status()).toBe(404);
    for (const order of [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
    ]) {
      for (const regionIndex of order) {
        const home = homes[regionIndex];
        const data = reservation(`${order.join('')}-${home.region}`, home);
        const response = await call(runtime, data);
        expect(response.status).toBe(200);
        const outcome = await response.json();
        expect(outcome).toMatchObject({
          ok: true,
          disposition: 'reserved',
          assignment: { state: 'reserved', home },
        });
        observations.push({ stage: 'registration_order', order, outcome });
      }
    }
    const attempts = [];
    for (let index = 0; index < 12; index += 1) {
      attempts.push(
        call(
          runtime,
          reservation('traveller', homes[index % 3]),
          false,
          index % 2 ? 'ingress-a' : 'ingress-b',
        ),
      );
    }
    const outcomes = [];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(200);
      outcomes.push(await response.json());
    }
    expect(outcomes.filter((outcome) => outcome.disposition === 'reserved')).toHaveLength(1);
    const assigned = outcomes[0].assignment;
    for (const outcome of outcomes) expect(outcome.assignment).toEqual(assigned);
    observations.push({ stage: 'competing_ingress', outcomes });

    const duplicateWallet = await call(runtime, {
      ...reservation('traveller', homes[0]),
      registrationId: 'different-registration',
    });
    expect(duplicateWallet.status).toBe(409);
    expect(await duplicateWallet.json()).toMatchObject({ code: 'wallet_conflict' });
    const duplicateOperation = await call(runtime, {
      ...reservation('another-wallet', homes[0]),
      registrationId: 'register-traveller',
    });
    expect(duplicateOperation.status).toBe(409);
    expect(await duplicateOperation.json()).toMatchObject({ code: 'registration_conflict' });
    expect(
      (await call(runtime, { action: 'find', wallet: walletKey('another-wallet') })).status,
    ).toBe(404);

    const interrupted = reservation('lost-reply', homes[1]);
    expect((await call(runtime, interrupted, true)).status).toBe(503);
    await runtime.dispose();
    runtime = start(directory);
    const retry = await call(runtime, reservation('lost-reply', homes[2]));
    expect(await retry.json()).toMatchObject({
      ok: true,
      disposition: 'reused',
      assignment: { home: homes[1] },
    });
    const completed = await call(runtime, {
      ...interrupted,
      action: 'complete',
      outcome: 'established',
    });
    const established = await completed.json();
    expect(completed.status).toBe(200);
    expect(established.state).toBe('established');
    expect(
      await (
        await call(runtime, { ...interrupted, action: 'complete', outcome: 'established' })
      ).json(),
    ).toEqual(established);
    expect(
      (await call(runtime, { ...interrupted, action: 'complete', outcome: 'cancelled' })).status,
    ).toBe(409);
    expect(
      (
        await call(runtime, {
          ...interrupted,
          action: 'complete',
          outcome: 'established',
          home: homes[2],
        })
      ).status,
    ).toBe(409);
    observations.push({ stage: 'reply_loss_restart_completion', assignment: established });

    const cancelledInput = reservation('cancelled', homes[0]);
    await call(runtime, cancelledInput);
    expect(
      (await call(runtime, { ...cancelledInput, action: 'complete', outcome: 'cancelled' })).status,
    ).toBe(200);
    expect(
      (await call(runtime, { ...cancelledInput, action: 'complete', outcome: 'established' }))
        .status,
    ).toBe(409);
    expect(await (await call(runtime, reservation('cancelled', homes[2]))).json()).toMatchObject({
      assignment: { state: 'cancelled', home: homes[0] },
    });
    expect(
      await (await call(runtime, reservation('lost-reply', homes[2], 'separate-project'))).json(),
    ).toMatchObject({ disposition: 'reserved', assignment: { home: homes[2] } });

    const persisted = await runtime.getD1Database('CONSOLE_DB', 'ingress-a');
    for (const sql of [
      "UPDATE wallet_homes SET region = 'US' WHERE wallet_id = 'lost-reply' AND project_id = 'project'",
      "DELETE FROM wallet_homes WHERE wallet_id = 'lost-reply'",
      "INSERT OR REPLACE INTO wallet_homes SELECT * FROM wallet_homes WHERE wallet_id = 'lost-reply'",
    ])
      await expect(persisted.prepare(sql).run()).rejects.toThrow(
        /wallet home (identity is immutable|transition is invalid)/,
      );
    expect(
      await (await call(runtime, { action: 'find', wallet: interrupted.wallet })).json(),
    ).toEqual(established);
    const rows = await persisted
      .prepare('SELECT * FROM wallet_homes ORDER BY project_id, wallet_id')
      .all();
    expect(rows.results).toHaveLength(13);
    const receipt = {
      kind: 'wallet_home_directory_e2e_v1',
      observations,
      rows: rows.results,
      migrationSha256: createHash('sha256').update(migration).digest('hex'),
      workerSha256: createHash('sha256')
        .update(await readFile(path.join(directory, 'authority.js')))
        .digest('hex'),
      topology: 'two Worker transports sharing persistent local D1',
      hostedRoutingVerified: false,
      regionalLatencyMeasured: false,
    };
    const evidencePath = testInfo.outputPath('wallet-home-evidence.json');
    await writeFile(evidencePath, JSON.stringify(receipt, null, 2) + '\n');
    await testInfo.attach('wallet-home-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
});
