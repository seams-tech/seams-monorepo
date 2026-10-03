import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RegistrationSetupAllocation,
  WalletHome,
  WalletOwnershipKey,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import {
  WALLET_RELOCATION_COOLDOWN_MS,
  WalletRelocationReceipt,
  WalletRelocationRequest,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const accountId = '0123456789abcdef0123456789abcdef';
const source = WalletHome.parse({
  region: 'WEUR',
  accountId,
  databaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
});
const destination = WalletHome.parse({
  region: 'APAC',
  accountId,
  databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
});
const thirdHome = WalletHome.parse({
  region: 'US',
  accountId,
  databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
});
const admittedAtMs = 1_791_000_000_000;

function wallet(walletId: string): WalletOwnershipKey {
  return WalletOwnershipKey.parse({
    namespace: 'shared',
    organizationId: 'owner',
    projectId: 'project',
    environmentId: 'test',
    walletId,
  });
}

function relocation(
  walletId: string,
  home: WalletHome,
  generation = 1,
  moveId = `wmove_${randomBytes(32).toString('base64url')}`,
  authorityId = `wallet-authority:${walletId}`,
): WalletRelocationRequest {
  return WalletRelocationRequest.parse({
    wallet: wallet(walletId),
    destination: home,
    expectedGeneration: generation,
    moveId,
    authorityId,
  });
}

function fence(
  request: WalletRelocationRequest,
  recordedAtMs = admittedAtMs + 100,
): WalletRelocationReceipt<'source_fence'> {
  return WalletRelocationReceipt.parse(
    {
      kind: 'source_fence',
      wallet: request.wallet,
      moveId: request.moveId,
      home: source,
      generation: request.expectedGeneration,
      recordedAtMs,
      participants: {
        gateway: 'a'.repeat(64),
        walletRuntime: 'b'.repeat(64),
        router: 'c'.repeat(64),
        deriverA: 'd'.repeat(64),
        deriverB: 'e'.repeat(64),
        signingWorker: 'f'.repeat(64),
        presignSessions: '0'.repeat(64),
      },
    },
    'source_fence',
  );
}

function verification(
  request: WalletRelocationRequest,
): WalletRelocationReceipt<'destination_verification'> {
  return WalletRelocationReceipt.parse(
    {
      kind: 'destination_verification',
      wallet: request.wallet,
      moveId: request.moveId,
      home: request.destination,
      generation: request.expectedGeneration + 1,
      recordedAtMs: admittedAtMs + 200,
      participants: {
        gateway: 'a'.repeat(64),
        walletRuntime: 'b'.repeat(64),
        router: 'c'.repeat(64),
        deriverA: 'd'.repeat(64),
        deriverB: 'e'.repeat(64),
        signingWorker: 'f'.repeat(64),
        presignSessions: '0'.repeat(64),
      },
    },
    'destination_verification',
  );
}

function start(directory: string): Miniflare {
  const worker = {
    modules: true,
    modulesRoot: directory,
    scriptPath: path.join(directory, 'authority.js'),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { CONSOLE_DB: 'wallet-directory' },
    bindings: { CATALOG_JSON: JSON.stringify([source, destination, thirdHome]) },
  };
  return new Miniflare({
    host: '127.0.0.1',
    port: 0,
    d1Persist: path.join(directory, 'd1'),
    workers: [
      { ...worker, name: 'ingress-a' },
      { ...worker, name: 'ingress-b' },
    ],
  });
}

async function call(runtime: Miniflare, body: unknown, ingress = 'ingress-a', loseReply = false) {
  const service = await runtime.getWorker(ingress);
  return service.fetch(`https://authority.test/${loseReply ? '?loseReply=1' : ''}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function establish(runtime: Miniflare, walletId: string): Promise<Record<string, unknown>> {
  const allocation = RegistrationSetupAllocation.parse({
    ceremonyId: `wrc_${walletId}`,
    preparationId: `regprep_${walletId}`,
    walletAuthorityId: `wallet-authority:${walletId}`,
    deviceId: `device:${walletId}`,
    walletAuthMethodId: `wallet-auth-method:${walletId}`,
  });
  const response = await call(runtime, {
    action: 'establish',
    wallet: wallet(walletId),
    region: source.region,
    allocation,
    registrationId: `register-${walletId}`,
    requestDigest: '1'.repeat(64),
    nowMs: admittedAtMs - 100,
  });
  expect(response.status).toBe(200);
  return responseBody(response);
}

async function responseBody(response: {
  json(): Promise<unknown>;
}): Promise<Record<string, unknown>> {
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a response record');
  return value as Record<string, unknown>;
}

test('relocation directory serializes competing moves and survives lost replies and restart', async ({
  request: http,
}, testInfo) => {
  test.setTimeout(120_000);
  void http;
  const directory = testInfo.outputPath('authority');
  await mkdir(directory, { recursive: true });
  const candidate = process.env.SEAMS_WALLET_SERVER_CANDIDATE;
  await build({
    entryPoints: [
      path.join(repoRoot, 'tests/fixtures/tenant-deployment/walletRelocationAuthority.ts'),
    ],
    outfile: path.join(directory, 'authority.js'),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*', 'cloudflare:*'],
    loader: { '.wasm': 'file' },
    tsconfig: path.join(repoRoot, 'packages/wallet-console-server-ts/tsconfig.json'),
    alias: candidate
      ? {
          '@seams/wallet-server/cloud-host': createRequire(
            path.resolve(candidate, 'package.json'),
          ).resolve('@seams/wallet-server/cloud-host'),
        }
      : {},
  });
  let runtime = start(directory);
  const observations: unknown[] = [];
  const migrations: Array<{ name: string; sha256: string }> = [];
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'ingress-a');
    const migrationDirectory = path.join(
      repoRoot,
      'packages/wallet-console-server-ts/migrations/d1-console',
    );
    for (const name of (await readdir(migrationDirectory)).sort()) {
      if (!name.endsWith('.sql')) continue;
      const sql = await readFile(path.join(migrationDirectory, name), 'utf8');
      for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
      migrations.push({ name, sha256: createHash('sha256').update(sql).digest('hex') });
    }
    const original = await establish(runtime, 'traveller');
    const unrelated = await establish(runtime, 'unrelated');
    const request = relocation(
      'traveller',
      destination,
      1,
      undefined,
      'wallet-authority:linked-owner',
    );
    expect(
      await (
        await call(runtime, {
          action: 'admit',
          request: relocation('traveller', destination, 2),
          nowMs: admittedAtMs,
        })
      ).json(),
    ).toEqual({ ok: false, code: 'stale_generation' });
    expect(
      await (
        await call(runtime, {
          action: 'admit',
          request: relocation('traveller', source),
          nowMs: admittedAtMs,
        })
      ).json(),
    ).toMatchObject({ ok: true, disposition: 'unchanged', assignment: original });

    const races = await Promise.all([
      call(runtime, { action: 'admit', request, nowMs: admittedAtMs }, 'ingress-a', true),
      call(runtime, { action: 'admit', request, nowMs: admittedAtMs }, 'ingress-b'),
    ]);
    expect(races[0].status).toBe(503);
    expect(await races[1].json()).toMatchObject({
      ok: true,
      move: { sourceGeneration: 1, destinationGeneration: 2, progress: { state: 'freezing' } },
    });
    expect(
      await (await call(runtime, { action: 'admit', request, nowMs: admittedAtMs + 1 })).json(),
    ).toMatchObject({ ok: true, disposition: 'reused' });
    expect(
      await (
        await call(runtime, {
          action: 'admit',
          request: relocation('traveller', thirdHome),
          nowMs: admittedAtMs,
        })
      ).json(),
    ).toEqual({ ok: false, code: 'move_in_progress' });
    expect(
      await (
        await call(runtime, {
          action: 'admit',
          request: relocation('traveller', thirdHome, 1, request.moveId),
          nowMs: admittedAtMs,
        })
      ).json(),
    ).toEqual({ ok: false, code: 'request_conflict' });
    expect(await (await call(runtime, { action: 'home', wallet: request.wallet })).json()).toEqual({
      code: 'wallet_relocation_in_progress',
    });
    expect(
      await (await call(runtime, { action: 'home', wallet: wallet('unrelated') })).json(),
    ).toEqual(unrelated);
    expect(
      await (await call(runtime, { action: 'switch', request, nowMs: admittedAtMs + 300 })).json(),
    ).toEqual({ ok: false, code: 'phase_conflict' });
    expect(
      await (
        await call(runtime, { action: 'verify', request, receipt: verification(request) })
      ).json(),
    ).toEqual({ ok: false, code: 'phase_conflict' });
    await expect(
      database
        .prepare("UPDATE wallet_homes SET region = 'APAC' WHERE wallet_id = 'traveller'")
        .run(),
    ).rejects.toThrow();
    const sourceFence = fence(request);
    expect(
      await (await call(runtime, { action: 'fence', request, receipt: sourceFence })).json(),
    ).toMatchObject({ ok: true, move: { progress: { state: 'copying' } } });
    expect(
      await (
        await call(runtime, {
          action: 'fence',
          request,
          receipt: fence(request, admittedAtMs + 101),
        })
      ).json(),
    ).toEqual({ ok: false, code: 'receipt_conflict' });
    expect(
      await (
        await call(runtime, { action: 'verify', request, receipt: verification(request) })
      ).json(),
    ).toMatchObject({ ok: true, move: { progress: { state: 'verified' } } });
    observations.push(await (await call(runtime, { action: 'status', request })).json());

    await runtime.dispose();
    runtime = start(directory);
    const lostSwitch = await call(
      runtime,
      { action: 'switch', request, nowMs: admittedAtMs + 300 },
      'ingress-b',
      true,
    );
    expect(lostSwitch.status).toBe(503);
    const switched = await (
      await call(runtime, { action: 'switch', request, nowMs: admittedAtMs + 400 })
    ).json();
    expect(switched).toMatchObject({
      ok: true,
      move: { progress: { state: 'cutover', cutoverAtMs: admittedAtMs + 300 } },
    });
    observations.push(switched);
    const newAssignment = await (
      await call(runtime, { action: 'home', wallet: request.wallet })
    ).json();
    expect(newAssignment).toEqual({ ...original, home: destination, ownershipGeneration: 2 });
    const completed = await responseBody(
      await call(runtime, { action: 'complete', request, nowMs: admittedAtMs + 500 }),
    );
    expect(completed).toMatchObject({ ok: true, move: { progress: { state: 'completed' } } });
    expect(
      await (await call(runtime, { action: 'admit', request, nowMs: admittedAtMs + 600 })).json(),
    ).toMatchObject({ ok: true, disposition: 'reused', move: completed.move });
    expect(
      await (
        await call(runtime, {
          action: 'admit',
          request: relocation('traveller', destination, 2),
          nowMs: admittedAtMs + 600,
        })
      ).json(),
    ).toMatchObject({ ok: true, disposition: 'unchanged', assignment: newAssignment });
    const returnMove = relocation('traveller', source, 2);
    expect(
      await (
        await call(runtime, {
          action: 'admit',
          request: returnMove,
          nowMs: admittedAtMs + WALLET_RELOCATION_COOLDOWN_MS - 1,
        })
      ).json(),
    ).toEqual({
      ok: false,
      code: 'cooldown',
      retryAtMs: admittedAtMs + WALLET_RELOCATION_COOLDOWN_MS,
    });
    const returning = await (
      await call(runtime, {
        action: 'admit',
        request: returnMove,
        nowMs: admittedAtMs + WALLET_RELOCATION_COOLDOWN_MS,
      })
    ).json();
    expect(returning).toMatchObject({
      ok: true,
      disposition: 'admitted',
      move: {
        source: destination,
        destination: source,
        sourceGeneration: 2,
        destinationGeneration: 3,
      },
    });
    const reopened = await runtime.getD1Database('CONSOLE_DB', 'ingress-a');
    await expect(
      reopened.prepare("DELETE FROM wallet_relocations WHERE wallet_id = 'traveller'").run(),
    ).rejects.toThrow();
    expect(
      await reopened
        .prepare('SELECT COUNT(*) AS count FROM wallet_relocations')
        .first<number>('count'),
    ).toBe(2);
    const history = await reopened
      .prepare(
        'SELECT move_id, state, source_generation, destination_generation, admitted_at_ms FROM wallet_relocations ORDER BY admitted_at_ms',
      )
      .all();
    observations.push(completed, returning, history.results);
    await writeFile(
      testInfo.outputPath('wallet-relocation-directory-evidence.json'),
      JSON.stringify(
        {
          scope:
            'Directory control plane only; participant receipts are synthetic. No backend transfer or writer-fence claim.',
          migrations,
          authoritySha256: createHash('sha256')
            .update(await readFile(path.join(directory, 'authority.js')))
            .digest('hex'),
          original,
          newAssignment,
          unrelated,
          observations,
        },
        null,
        2,
      ),
    );
  } finally {
    await runtime.dispose();
  }
});
