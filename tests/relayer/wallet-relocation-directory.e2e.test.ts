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
  WalletRelocationRequest,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/relocation';

import {
  WalletRelocationAttempt,
  type WalletRelocationPhase,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/relocationExecution';
import {
  relocationSourceFence,
  relocationDestinationVerification,
  relocationDestinationActivation,
  relocationSourceCleanup,
} from '../fixtures/tenant-deployment/walletRelocationReceipts';

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

const manifest = '9'.repeat(64);

function fence(request: WalletRelocationRequest, recordedAtMs = admittedAtMs + 100) {
  return relocationSourceFence(request, source, recordedAtMs, manifest);
}

function verification(request: WalletRelocationRequest) {
  return relocationDestinationVerification(request, admittedAtMs + 200, manifest);
}

function attemptIdentity(): string {
  return `wattempt_${randomBytes(32).toString('base64url')}`;
}

async function claim(
  runtime: Miniflare,
  request: WalletRelocationRequest,
  phase: WalletRelocationPhase,
  nowMs = admittedAtMs,
): Promise<WalletRelocationAttempt> {
  const response = await responseBody(
    await call(runtime, { action: 'claim', request, phase, attemptId: attemptIdentity(), nowMs }),
  );
  expect(response.ok).toBe(true);
  return attemptFromResponse(response);
}

function attemptFromResponse(response: Record<string, unknown>): WalletRelocationAttempt {
  const move = objectValue(response.move);
  const progress = objectValue(move.progress);
  const execution = objectValue(progress.execution);
  return WalletRelocationAttempt.parse(execution.attempt);
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected record');
  return value as Record<string, unknown>;
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
    const claimedId = attemptIdentity();
    const claimRace = await Promise.all([
      call(
        runtime,
        { action: 'claim', request, phase: 'freezing', attemptId: claimedId, nowMs: admittedAtMs },
        'ingress-a',
        true,
      ),
      call(
        runtime,
        { action: 'claim', request, phase: 'freezing', attemptId: claimedId, nowMs: admittedAtMs },
        'ingress-b',
      ),
    ]);
    expect(claimRace[0].status).toBe(503);
    const freezeAttempt = attemptFromResponse(await responseBody(claimRace[1]));
    expect(freezeAttempt.number).toBe(1);
    expect(
      await (
        await call(runtime, {
          action: 'switch',
          request,
          attempt: freezeAttempt,
          nowMs: admittedAtMs + 300,
        })
      ).json(),
    ).toEqual({ ok: false, code: 'phase_conflict' });
    expect(
      await (
        await call(runtime, {
          action: 'verify',
          request,
          attempt: freezeAttempt,
          receipt: verification(request),
        })
      ).json(),
    ).toEqual({ ok: false, code: 'phase_conflict' });
    await expect(
      database
        .prepare("UPDATE wallet_homes SET region = 'APAC' WHERE wallet_id = 'traveller'")
        .run(),
    ).rejects.toThrow();
    const sourceFence = fence(request);
    expect(
      await (
        await call(runtime, {
          action: 'fence',
          request,
          attempt: freezeAttempt,
          receipt: sourceFence,
        })
      ).json(),
    ).toMatchObject({ ok: true, move: { progress: { state: 'copying' } } });
    expect(
      await (
        await call(runtime, {
          action: 'fence',
          request,
          attempt: freezeAttempt,
          receipt: fence(request, admittedAtMs + 101),
        })
      ).json(),
    ).toEqual({ ok: false, code: 'receipt_conflict' });
    const copyAttempt = await claim(runtime, request, 'copying', admittedAtMs + 100);
    expect(
      await (
        await call(runtime, {
          action: 'verify',
          request,
          attempt: copyAttempt,
          receipt: verification(request),
        })
      ).json(),
    ).toMatchObject({ ok: true, move: { progress: { state: 'verified' } } });
    observations.push(await (await call(runtime, { action: 'status', request })).json());

    await runtime.dispose();
    runtime = start(directory);
    const switchAttempt = await claim(runtime, request, 'verified', admittedAtMs + 200);
    const lostSwitch = await call(
      runtime,
      { action: 'switch', request, attempt: switchAttempt, nowMs: admittedAtMs + 300 },
      'ingress-b',
      true,
    );
    expect(lostSwitch.status).toBe(503);
    const switched = await (
      await call(runtime, {
        action: 'switch',
        request,
        attempt: switchAttempt,
        nowMs: admittedAtMs + 400,
      })
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
    const completionAttempt = await claim(runtime, request, 'cutover', admittedAtMs + 400);
    const cutoverDatabase = await runtime.getD1Database('CONSOLE_DB', 'ingress-a');
    await expect(
      cutoverDatabase
        .prepare(
          `UPDATE wallet_relocations SET state = 'completed', completed_at_ms = ?,
       execution_state = NULL, execution_revision = execution_revision + 1,
       execution_attempt = 0, execution_attempt_id = NULL, execution_started_at_ms = NULL
       WHERE wallet_id = 'traveller'`,
        )
        .bind(admittedAtMs + 500)
        .run(),
    ).rejects.toThrow();
    const activation = relocationDestinationActivation(request, admittedAtMs + 410, manifest);
    const cleanup = relocationSourceCleanup(request, source, admittedAtMs + 450, manifest);
    expect(
      await (
        await call(runtime, {
          action: 'complete',
          request,
          attempt: completionAttempt,
          activation,
          cleanup: relocationSourceCleanup(request, source, admittedAtMs + 450, '8'.repeat(64)),
          nowMs: admittedAtMs + 500,
        })
      ).json(),
    ).toEqual({ ok: false, code: 'receipt_conflict' });
    expect(
      (
        await call(
          runtime,
          {
            action: 'complete',
            request,
            attempt: completionAttempt,
            activation,
            cleanup,
            nowMs: admittedAtMs + 500,
          },
          'ingress-a',
          true,
        )
      ).status,
    ).toBe(503);
    await runtime.dispose();
    runtime = start(directory);
    const completed = await responseBody(
      await call(runtime, {
        action: 'complete',
        request,
        attempt: completionAttempt,
        activation,
        cleanup,
        nowMs: admittedAtMs + 500,
      }),
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
    let retryNow = admittedAtMs + WALLET_RELOCATION_COOLDOWN_MS;
    let lastAttempt = await claim(runtime, returnMove, 'freezing', retryNow);
    const firstAttempt = lastAttempt;
    expect(
      await (
        await call(runtime, {
          action: 'claim',
          request: returnMove,
          phase: 'freezing',
          attemptId: attemptIdentity(),
          nowMs: retryNow,
        })
      ).json(),
    ).toEqual({ ok: false, code: 'attempt_conflict' });
    for (let number = 1; number <= 6; number += 1) {
      expect(lastAttempt.number).toBe(number);
      const failed = await responseBody(
        await call(runtime, {
          action: 'fail',
          request: returnMove,
          attempt: lastAttempt,
          code: 'transport_unavailable',
          nowMs: retryNow,
        }),
      );
      expect(failed).toMatchObject({
        ok: true,
        move: { progress: { execution: { state: number === 6 ? 'blocked' : 'retry_wait' } } },
      });
      observations.push(failed);
      if (number === 3) {
        await runtime.dispose();
        runtime = start(directory);
      }
      if (number < 6) {
        const retryAtMs = retryNow + 1000 * 2 ** (number - 1);
        expect(
          await (
            await call(runtime, {
              action: 'claim',
              request: returnMove,
              phase: 'freezing',
              attemptId: attemptIdentity(),
              nowMs: retryAtMs - 1,
            })
          ).json(),
        ).toEqual({ ok: false, code: 'retry_wait', retryAtMs });
        retryNow = retryAtMs;
        lastAttempt = await claim(runtime, returnMove, 'freezing', retryNow);
      }
    }
    expect(
      await (
        await call(runtime, {
          action: 'claim',
          request: returnMove,
          phase: 'freezing',
          attemptId: attemptIdentity(),
          nowMs: retryNow,
        })
      ).json(),
    ).toEqual({ ok: false, code: 'execution_blocked' });
    expect(
      await (
        await call(runtime, {
          action: 'fail',
          request: returnMove,
          attempt: firstAttempt,
          code: 'transport_unavailable',
          nowMs: retryNow,
        })
      ).json(),
    ).toEqual({ ok: false, code: 'attempt_conflict' });
    expect(
      await (
        await call(runtime, { action: 'resume', request: returnMove, attempt: lastAttempt })
      ).json(),
    ).toMatchObject({ ok: true, move: { progress: { execution: { state: 'ready', run: 2 } } } });
    const recovered = await claim(runtime, returnMove, 'freezing', retryNow);
    expect(recovered.number).toBe(1);
    expect(recovered.run).toBe(2);
    expect(
      await (
        await call(runtime, {
          action: 'fail',
          request: returnMove,
          attempt: recovered,
          code: 'content_conflict',
          nowMs: retryNow,
        })
      ).json(),
    ).toMatchObject({
      ok: true,
      move: { progress: { execution: { state: 'blocked', code: 'content_conflict' } } },
    });
    observations.push(
      await (await call(runtime, { action: 'status', request: returnMove })).json(),
    );
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
