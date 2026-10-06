import { establishedRuntimeAdmission, executionAdmissionClient, verifyExecutionAdmissionResponses, verifyRegistrationExecutionAdmission } from './execution-authority.scenario';
import { verifyAuthorizationRegionalTransfer, verifyAuthorizationRegionalLifecycle } from './authorization-transfer.scenario';
import { verifyRelocationReadRouting } from './relocation-routing.scenario';
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
  relocationAuthorizationManifest,
  relocationSourceFence,
  relocationDestinationVerification,
  relocationDestinationActivation,
  relocationSourceCleanup,
} from '../fixtures/tenant-deployment/walletRelocationReceipts';
import { relocationWriterVersion } from '../fixtures/tenant-deployment/walletRelocationResources';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const accountId = '0123456789abcdef0123456789abcdef';
const source = WalletHome.parse({
  region: 'WEUR',
  accountId,
  databaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
});
const destination = WalletHome.parse({
  region: 'OC',
  accountId,
  databaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
});
const thirdHome = WalletHome.parse({
  region: 'US',
  accountId,
  databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
});
const apacHome = WalletHome.parse({
  region: 'APAC',
  accountId,
  databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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
    bindings: { CATALOG_JSON: JSON.stringify([source, destination, thirdHome, apacHome]) },
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

async function restart(runtime: Miniflare, directory: string): Promise<Miniflare> {
  await runtime.dispose();
  return start(directory);
}

async function call(runtime: Miniflare, body: unknown, ingress = 'ingress-a', loseReply = false) {
  const service = await runtime.getWorker(ingress);
  return service.fetch(`https://authority.test/${loseReply ? '?loseReply=1' : ''}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function placementStatus(runtime: Miniflare, key: WalletOwnershipKey, catalogJson?: string) {
  const service = await runtime.getWorker('ingress-b');
  return service.fetch(
    'https://wallet-placement.internal/internal/wallet-placement/v1/placement-status',
    {
      method: 'POST',
      body: JSON.stringify({ wallet: key }),
      headers: catalogJson === undefined ? {} : { 'x-test-catalog-json': catalogJson },
    },
  );
}

async function moveStatus(runtime: Miniflare, key: WalletOwnershipKey, moveId: string) {
  const service = await runtime.getWorker('ingress-b');
  return service.fetch(
    'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-status',
    {
      method: 'POST',
      headers: { 'x-test-catalog-json': '{malformed' },
      body: JSON.stringify({ wallet: key, moveId }),
    },
  );
}

async function resolveRelocationRequest(
  runtime: Miniflare,
  request: WalletRelocationRequest,
  writerHome = source,
) {
  const service = await runtime.getWorker('ingress-b');
  return service.fetch(
    'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-request',
    {
      method: 'POST',
      headers: { 'x-seams-writer-database': writerHome.databaseId },
      body: JSON.stringify({ wallet: request.wallet, moveId: request.moveId,
        destinationRegion: request.destination.region, expectedGeneration: request.expectedGeneration,
        authorityId: request.authorityId }),
    },
  );
}

async function replayMove(
  runtime: Miniflare,
  request: WalletRelocationRequest,
  requestDigest: string,
  key = request.wallet,
) {
  const service = await runtime.getWorker('ingress-b');
  return service.fetch(
    'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-replay',
    {
      method: 'POST',
      headers: { 'x-test-catalog-json': '{malformed' },
      body: JSON.stringify({ wallet: key, moveId: request.moveId, requestDigest }),
    },
  );
}

async function publishAuthorizationManifest(
  runtime: Miniflare,
  request: WalletRelocationRequest,
  attempt: WalletRelocationAttempt,
  manifest: ReturnType<typeof relocationAuthorizationManifest>,
  home = source,
) {
  const service = await runtime.getWorker('ingress-b');
  return service.fetch(
    'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-authorization-manifest',
    {
      method: 'POST',
      headers: {
        'x-seams-writer-role': 'gateway',
        'x-seams-writer-version': relocationWriterVersion(home.databaseId, 'gateway'),
        'x-seams-writer-account': home.accountId,
        'x-seams-writer-database': home.databaseId,
      },
      body: JSON.stringify({ wallet: request.wallet, attempt, manifest }),
    },
  );
}

async function relocationCommand(
  runtime: Miniflare,
  key: WalletOwnershipKey,
  attempt: WalletRelocationAttempt,
  kind: 'freeze' | 'export' | 'import_authorization' | 'verify' | 'activate' | 'cleanup',
  home = source,
  role = 'gateway',
  versionId = relocationWriterVersion(home.databaseId, role),
  catalogJson?: string,
) {
  const service = await runtime.getWorker('ingress-b');
  const response = await service.fetch(
    'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-command',
    {
      method: 'POST',
      headers: {
        'x-seams-writer-role': role,
        'x-seams-writer-version': versionId,
        'x-seams-writer-account': home.accountId,
        'x-seams-writer-database': home.databaseId,
        ...(catalogJson === undefined ? {} : { 'x-test-catalog-json': catalogJson }),
      },
      body: JSON.stringify({ wallet: key, attempt, kind }),
    },
  );
  return responseBody(response);
}

async function runtimeSourceCommand(
  runtime: Miniflare,
  request: WalletRelocationRequest,
  attempt: WalletRelocationAttempt,
  operation: 'ed25519-settle' | 'ed25519-capture' | 'ecdsa-freeze' | 'router-freeze',
  home = source,
  role = 'walletRuntime',
) {
  const service = await runtime.getWorker('ingress-b');
  const response = await service.fetch(
    'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-runtime-source',
    {
      method: 'POST',
      headers: {
        'x-seams-writer-role': role,
        'x-seams-writer-version': relocationWriterVersion(home.databaseId, role),
        'x-seams-writer-account': home.accountId,
        'x-seams-writer-database': home.databaseId,
      },
      body: JSON.stringify({ wallet: request.wallet, attempt, operation }),
    },
  );
  return responseBody(response);
}

async function routerSourceReceipt(
  runtime: Miniflare,
  request: WalletRelocationRequest,
  attempt: WalletRelocationAttempt,
  digest: string,
) {
  const service = await runtime.getWorker('ingress-b');
  return responseBody(await service.fetch(
    'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-router-receipt',
    {
      method: 'POST',
      headers: {
        'x-seams-writer-role': 'walletRuntime',
        'x-seams-writer-version': relocationWriterVersion(source.databaseId, 'walletRuntime'),
        'x-seams-writer-account': source.accountId,
        'x-seams-writer-database': source.databaseId,
      },
      body: JSON.stringify({ wallet: request.wallet, attempt, receipt: {
        request: {
          owner: { org_id: request.wallet.organizationId, project_id: request.wallet.projectId,
            env_id: request.wallet.environmentId, wallet_id: request.wallet.walletId },
          move_id: request.moveId, request_digest_hex: await request.digest(),
          source_generation: 1, destination_generation: 2,
        },
        records_digest_hex: digest, record_count: 1,
      } }),
    },
  ));
}

async function routerExportCommand(runtime: Miniflare, request: WalletRelocationRequest,
  attempt: WalletRelocationAttempt, recordIndex: number, home = source) {
  const service = await runtime.getWorker('ingress-b');
  return responseBody(await service.fetch(
    'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-router-export', {
      method: 'POST',
      headers: {
        'x-seams-writer-role': 'walletRuntime',
        'x-seams-writer-version': relocationWriterVersion(home.databaseId, 'walletRuntime'),
        'x-seams-writer-account': home.accountId,
        'x-seams-writer-database': home.databaseId,
      },
      body: JSON.stringify({ wallet: request.wallet, attempt, recordIndex, segmentIndex: 0 }),
    },
  ));
}

async function routerDestinationCommand(runtime: Miniflare, request: WalletRelocationRequest,
  attempt: WalletRelocationAttempt, operation: 'status' | 'verify' | 'import' | 'activate', home = destination) {
  const service = await runtime.getWorker('ingress-b');
  return responseBody(await service.fetch(
    'https://wallet-placement.internal/internal/wallet-placement/v1/relocation-router-destination', {
      method: 'POST',
      headers: {
        'x-seams-writer-role': 'walletRuntime',
        'x-seams-writer-version': relocationWriterVersion(home.databaseId, 'walletRuntime'),
        'x-seams-writer-account': home.accountId,
        'x-seams-writer-database': home.databaseId,
      },
      body: JSON.stringify({ wallet: request.wallet, attempt, operation }),
    },
  ));
}

async function executionAuthority(runtime: Miniflare, key: WalletOwnershipKey, home: WalletHome) {
  return executionAdmissionClient(runtime, key, home, [source, destination, thirdHome, apacHome], 'honest');
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

async function readOwnershipLocators(database: D1Database) {
  const [sessions, passkeys, routes] = await database.batch([
    database.prepare('SELECT * FROM wallet_session_locators ORDER BY digest'),
    database.prepare('SELECT * FROM wallet_passkey_claims ORDER BY credential_id'),
    database.prepare('SELECT * FROM wallet_routes ORDER BY value'),
  ]);
  return { sessions: sessions.results, passkeys: passkeys.results, routes: routes.results };
}

async function finishPriorMove(runtime: Miniflare, request: WalletRelocationRequest) {
  const freeze = await claim(runtime, request, 'freezing', admittedAtMs);
  expect(
    await responseBody(
      await call(runtime, { action: 'fence', request, attempt: freeze, receipt: fence(request) }),
    ),
  ).toMatchObject({ ok: true });
  const copy = await claim(runtime, request, 'copying', admittedAtMs + 100);
  expect(
    await responseBody(
      await call(runtime, {
        action: 'verify',
        request,
        attempt: copy,
        receipt: verification(request),
      }),
    ),
  ).toMatchObject({ ok: true });
  const switchAttempt = await claim(runtime, request, 'verified', admittedAtMs + 200);
  expect(
    await responseBody(
      await call(runtime, {
        action: 'switch',
        request,
        attempt: switchAttempt,
        nowMs: admittedAtMs + 300,
      }),
    ),
  ).toMatchObject({ ok: true });
  const activate = await claim(runtime, request, 'cutover', admittedAtMs + 400);
  const activation = relocationDestinationActivation(request, admittedAtMs + 410, manifest);
  expect(
    await responseBody(
      await call(runtime, { action: 'activate', request, attempt: activate, activation }),
    ),
  ).toMatchObject({ ok: true });
  const cleanup = relocationSourceCleanup(request, source, admittedAtMs + 420, manifest);
  expect(
    await responseBody(
      await call(runtime, {
        action: 'complete',
        request,
        attempt: activate,
        cleanup,
        nowMs: admittedAtMs + 430,
      }),
    ),
  ).toMatchObject({ ok: true });
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
      if (name === '0072_wallet_oceania.sql') {
        await establish(runtime, 'pre-upgrade');
        const owner = wallet('pre-upgrade');
        const identity = [
          owner.namespace,
          owner.organizationId,
          owner.projectId,
          owner.environmentId,
        ];
        await database.batch([
          database
            .prepare(
              `INSERT INTO wallet_session_locators
            VALUES (?, ?, ?, ?, 'credential', ?, ?, ?)`,
            )
            .bind(...identity, 'a'.repeat(43), owner.walletId, admittedAtMs + 60_000),
          database
            .prepare('INSERT INTO wallet_passkey_claims VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(...identity, 'wallet.test', 'pre-upgrade-passkey', owner.walletId),
          database
            .prepare(`INSERT INTO wallet_routes VALUES (?, ?, ?, ?, 'linked_device', ?, ?)`)
            .bind(...identity, 'pre-upgrade-installation', owner.walletId),
        ]);
        const locatorsBefore = await readOwnershipLocators(database);
        const pending = relocation('pre-upgrade', apacHome);
        // Seed the prior persistence contract, independently of today's admission API.
        await database
          .prepare(
            `INSERT INTO wallet_relocations (
          namespace, organization_id, project_id, environment_id, wallet_id,
          move_id, request_digest, authority_id, source_region, source_account_id, source_database_id,
          destination_region, destination_account_id, destination_database_id,
          source_generation, destination_generation, state, admitted_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 2, 'freezing', ?)`,
          )
          .bind(
            ...identity,
            owner.walletId,
            pending.moveId,
            await pending.digest(),
            pending.authorityId,
            source.region,
            source.accountId,
            source.databaseId,
            apacHome.region,
            apacHome.accountId,
            apacHome.databaseId,
            admittedAtMs,
          )
          .run();
        const beforeUpgrade = {
          move: await responseBody(await call(runtime, { action: 'status', request: pending })),
        };
        await database.batch(unstable_splitSqlQuery(sql).map(database.prepare.bind(database)));
        const afterUpgrade = await call(runtime, { action: 'status', request: pending });
        expect(await responseBody(afterUpgrade)).toEqual(beforeUpgrade.move);
        expect((await database.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
        expect(await readOwnershipLocators(database)).toEqual(locatorsBefore);
        observations.push({
          migrationPreservedPendingRelocation: true,
          move: beforeUpgrade,
          preservedOwnershipLocators: locatorsBefore,
        });
      } else if (name === '0075_wallet_relocation_resources.sql') {
        await expect(
          database.batch(unstable_splitSqlQuery(sql).map(database.prepare.bind(database))),
        ).rejects.toThrow();
        const prior = await database
          .prepare("SELECT move_id FROM wallet_relocations WHERE wallet_id = 'pre-upgrade'")
          .first<string>('move_id');
        if (!prior) throw new Error('Prior migration fixture is missing');
        const pending = relocation('pre-upgrade', apacHome, 1, prior);
        await finishPriorMove(runtime, pending);
        await database.batch(unstable_splitSqlQuery(sql).map(database.prepare.bind(database)));
        observations.push({ resourceUpgradeRejectedPendingMove: true });
      } else {
        for (const statement of unstable_splitSqlQuery(sql))
          await database.prepare(statement).run();
      }
      migrations.push({ name, sha256: createHash('sha256').update(sql).digest('hex') });
    }
    observations.push(await verifyRegistrationExecutionAdmission(
      runtime, wallet('registration-execution'), source, destination,
      [source, destination, thirdHome, apacHome],
    ));
    const original = await establish(runtime, 'traveller');
    observations.push(await verifyExecutionAdmissionResponses(
      runtime, wallet('traveller'), source, [source, destination, thirdHome, apacHome],
    ));

    expect(await executionAuthority(runtime, wallet('traveller'), source)).toMatchObject({
      ok: true, authority: { wallet: wallet('traveller'), home: source, generation: 1, participant: 'gateway' },
    });
    expect(await executionAuthority(runtime, wallet('traveller'), destination)).toEqual({
      ok: false, code: 'writer_home_mismatch',
    });

    expect(await responseBody(await placementStatus(runtime, wallet('traveller')))).toEqual({
      state: 'settled',
      region: source.region,
      generation: 1,
      nextMoveAtMs: 0,
    });
    expect(await responseBody(await placementStatus(runtime, wallet('missing')))).toEqual({
      state: 'unavailable',
      code: 'not_found',
    });
    const foreignWallet = WalletOwnershipKey.parse({
      namespace: 'shared',
      organizationId: 'another-owner',
      projectId: 'project',
      environmentId: 'test',
      walletId: 'traveller',
    });
    expect((await placementStatus(runtime, foreignWallet)).status).toBe(403);
    const unrelated = await establish(runtime, 'unrelated');
    const request = relocation(
      'traveller',
      destination,
      1,
      undefined,
      'wallet-authority:linked-owner',
    );
    const resolved = await responseBody(await resolveRelocationRequest(runtime, request));
    expect(resolved).toEqual({ kind: 'resolved', requestDigest: await request.digest(),
      sourceGeneration: 1, destinationRegion: destination.region });
    expect(await responseBody(await resolveRelocationRequest(runtime, request))).toEqual(resolved);
    expect((await resolveRelocationRequest(runtime, request, destination)).status).toBe(403);
    expect((await resolveRelocationRequest(runtime, relocation('traveller', destination, 2))).status).toBe(409);
    const unchanged = await responseBody(await resolveRelocationRequest(runtime, relocation('traveller', source)));
    expect(unchanged).toMatchObject({ kind: 'unchanged', placement: { state: 'settled', generation: 1, nextMoveAtMs: 0 } });
    expect(await responseBody(await placementStatus(runtime, request.wallet))).toEqual({
      state: 'settled', region: source.region, generation: 1, nextMoveAtMs: 0,
    });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM wallet_relocations WHERE wallet_id = 'traveller'").first<number>('count')).toBe(0);
    observations.push({ requestResolutionPinsCatalogDigestWithoutPausingOrCooldown: true });

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

    expect(
      await responseBody(
        await call(runtime, {
          action: 'admit',
          request,
          nowMs: admittedAtMs,
          preparedDestination: thirdHome,
        }),
      ),
    ).toEqual({ code: 'readiness_invalid' });
    expect(
      await responseBody(
        await call(runtime, {
          action: 'admit',
          request,
          nowMs: admittedAtMs,
          preparationAtMs: admittedAtMs - 300_000,
        }),
      ),
    ).toEqual({ code: 'readiness_invalid' });
    expect(
      await responseBody(await call(runtime, { action: 'home', wallet: request.wallet })),
    ).toEqual(original);
    expect(await (await call(runtime, { action: 'status', request })).json()).toBeNull();
    observations.push({ failedResourcePreparationLeftSourceActive: true });

    // The last role refuses after the other six prepare. The source stays usable.
    expect(
      await responseBody(
        await call(runtime, {
          action: 'admit',
          request,
          nowMs: admittedAtMs,
          failedParticipant: 'presignSessions',
        }),
      ),
    ).toEqual({ code: 'invalid_record' });
    expect(
      await responseBody(await call(runtime, { action: 'home', wallet: request.wallet })),
    ).toEqual(original);
    expect(await (await call(runtime, { action: 'status', request })).json()).toBeNull();
    observations.push({ lastParticipantPreparationFailureLeftSourceActive: true });

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
      await responseBody(
        await call(runtime, {
          action: 'admit',
          request,
          nowMs: admittedAtMs + 300_001,
          failedParticipant: 'gateway',
          preparationAtMs: admittedAtMs,
        }),
      ),
    ).toMatchObject({ ok: true, disposition: 'reused' });
    const pinnedPreparation = await database
      .prepare("SELECT preparation_json FROM wallet_relocations WHERE wallet_id = 'traveller'")
      .first<string>('preparation_json');
    expect(pinnedPreparation).not.toBeNull();
    const preparationEvidence = JSON.parse(pinnedPreparation!);
    expect(preparationEvidence.requestDigest).toBe(await request.digest());
    expect(preparationEvidence.receipts).toHaveLength(7);
    await expect(
      database
        .prepare(
          "UPDATE wallet_relocations SET preparation_json = NULL WHERE wallet_id = 'traveller'",
        )
        .run(),
    ).rejects.toThrow();
    observations.push({ pinnedPreparation: preparationEvidence, replaySkippedPreparation: true });
    observations.push(
      await verifyRelocationReadRouting(runtime, request, source, [
        source, destination, thirdHome, apacHome,
      ]),
    );
    const pinnedResources = await database
      .prepare(
        "SELECT resource_verifications_json FROM wallet_relocations WHERE wallet_id = 'traveller'",
      )
      .first<string>('resource_verifications_json');
    expect(
      await responseBody(
        await call(runtime, {
          action: 'admit',
          request,
          nowMs: admittedAtMs + 300_000,
          preparationAtMs: admittedAtMs,
          preparedDestination: thirdHome,
        }),
      ),
    ).toMatchObject({ ok: true, disposition: 'reused' });
    expect(
      await database
        .prepare(
          "SELECT resource_verifications_json FROM wallet_relocations WHERE wallet_id = 'traveller'",
        )
        .first<string>('resource_verifications_json'),
    ).toBe(pinnedResources);
    await expect(
      database
        .prepare(
          "UPDATE wallet_relocations SET resource_verifications_json = NULL WHERE wallet_id = 'traveller'",
        )
        .run(),
    ).rejects.toThrow();
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
    const freezeCommand = await relocationCommand(runtime, request.wallet, freezeAttempt, 'freeze');
    const runtimeSettlement = await runtimeSourceCommand(runtime, request, freezeAttempt, 'ed25519-settle');
    expect(runtimeSettlement).toEqual({
      ok: true,
      command: {
        operation: 'ed25519-settle',
        payload: {
          scope: {
            org_id: request.wallet.organizationId,
            project_id: request.wallet.projectId,
            project_environment_id: request.wallet.environmentId,
            wallet_id: request.wallet.walletId,
          },
          request: { move_id: request.moveId, source_generation: 1, invalidated_at_ms: admittedAtMs },
        },
      },
    });
    expect(await runtimeSourceCommand(runtime, request, freezeAttempt, 'ed25519-settle')).toEqual(runtimeSettlement);
    expect(await runtimeSourceCommand(runtime, request, freezeAttempt, 'ed25519-capture')).toMatchObject({
      ok: true, command: { operation: 'ed25519-capture', payload: { command: 'capture' } },
    });
    expect(await runtimeSourceCommand(runtime, request, freezeAttempt, 'ecdsa-freeze')).toMatchObject({
      ok: true, command: { operation: 'ecdsa-freeze' },
    });
    expect(await runtimeSourceCommand(runtime, request, freezeAttempt, 'ecdsa-freeze', destination)).toEqual({
      ok: false, code: 'participant_conflict',
    });
    expect(await runtimeSourceCommand(runtime, request, freezeAttempt, 'ecdsa-freeze', source, 'gateway')).toEqual({
      ok: false, code: 'participant_conflict',
    });
    const routerFreeze = await runtimeSourceCommand(runtime, request, freezeAttempt, 'router-freeze');
    expect(routerFreeze).toEqual({
      ok: true,
      command: {
        operation: 'router-freeze',
        payload: {
          owner: { org_id: request.wallet.organizationId, project_id: request.wallet.projectId, env_id: request.wallet.environmentId, wallet_id: request.wallet.walletId },
          move_id: request.moveId,
          request_digest_hex: await request.digest(),
          source_generation: 1,
          destination_generation: 2,
        },
      },
    });
    expect(await runtimeSourceCommand(runtime, request, freezeAttempt, 'router-freeze')).toEqual(routerFreeze);
    const routerReceipt = await routerSourceReceipt(runtime, request, freezeAttempt, 'a'.repeat(64));
    expect(routerReceipt).toMatchObject({ ok: true, receipt: { record_count: 1 } });
    expect(await routerSourceReceipt(runtime, request, freezeAttempt, 'a'.repeat(64))).toEqual(routerReceipt);
    expect(await routerSourceReceipt(runtime, request, freezeAttempt, 'b'.repeat(64))).toEqual({
      ok: false, code: 'receipt_conflict',
    });
    expect(await routerExportCommand(runtime, request, freezeAttempt, 0)).toEqual({
      ok: false, code: 'phase_conflict',
    });
    observations.push({ routerSourceReceiptPreservesExactInventory: true });
    observations.push({ runtimeSourceCommandsUsePinnedJournalIdentity: true });

    expect(
      await relocationCommand(
        runtime,
        request.wallet,
        freezeAttempt,
        'freeze',
        source,
        'gateway',
        thirdHome.databaseId,
      ),
    ).toEqual({
      ok: false,
      code: 'participant_conflict',
    });
    for (const catalogJson of ['', '{malformed', JSON.stringify([thirdHome])]) {
      expect(await relocationCommand(
        runtime, request.wallet, freezeAttempt, 'freeze', source, 'gateway',
        relocationWriterVersion(source.databaseId, 'gateway'), catalogJson,
      )).toEqual(freezeCommand);
      expect(await relocationCommand(
        runtime, request.wallet, freezeAttempt, 'freeze', source, 'gateway',
        thirdHome.databaseId, catalogJson,
      )).toEqual({ ok: false, code: 'participant_conflict' });
    }
    observations.push({ commandRetriesUsePinnedResourcesWithoutCurrentCatalog: true });
    expect(freezeCommand).toMatchObject({
      ok: true,
      command: {
        wallet: request.wallet,
        moveId: request.moveId,
        requestDigest: await request.digest(),
        participant: 'gateway',
        home: source,
        generation: 1,
        operation: { kind: 'freeze' },
      },
    });
    expect(await relocationCommand(runtime, request.wallet, freezeAttempt, 'freeze')).toEqual(
      freezeCommand,
    );
    expect(
      await relocationCommand(runtime, request.wallet, freezeAttempt, 'freeze', destination),
    ).toEqual({
      ok: false,
      code: 'participant_conflict',
    });
    expect(await relocationCommand(runtime, request.wallet, freezeAttempt, 'cleanup')).toEqual({
      ok: false,
      code: 'phase_conflict',
    });
    expect(await relocationCommand(runtime, wallet('unrelated'), freezeAttempt, 'freeze')).toEqual({
      ok: false,
      code: 'attempt_conflict',
    });
    observations.push(freezeCommand);
    const freezingStatus = await responseBody(await placementStatus(runtime, request.wallet));
    expect(await responseBody(await placementStatus(runtime, request.wallet))).toEqual(
      freezingStatus,
    );
    expect(freezingStatus).toEqual({
      state: 'moving',
      move: {
        moveId: request.moveId,
        sourceRegion: source.region,
        destinationRegion: destination.region,
        sourceGeneration: 1,
        destinationGeneration: 2,
        admittedAtMs,
        nextMoveAtMs: admittedAtMs + WALLET_RELOCATION_COOLDOWN_MS,
        progress: { state: 'freezing', availability: 'paused', execution: { state: 'running' } },
      },
    });
    for (const catalogJson of ['', '{malformed', JSON.stringify([thirdHome])]) {
      expect(await responseBody(await placementStatus(runtime, request.wallet, catalogJson))).toEqual(freezingStatus);
    }
    expect((await placementStatus(runtime, foreignWallet, '')).status).toBe(403);
    observations.push({ statusIndependentOfCatalog: true, statusStillChecksTenantScope: true });
    expect(await responseBody(await moveStatus(runtime, request.wallet, request.moveId))).toEqual(freezingStatus);
    expect((await moveStatus(runtime, foreignWallet, request.moveId)).status).toBe(403);
    expect((await moveStatus(runtime, request.wallet, 'invalid')).status).toBe(400);
    const unrelatedMoveRead = await moveStatus(runtime, wallet('unrelated'), request.moveId);
    expect(unrelatedMoveRead.status).toBe(404);
    expect(await responseBody(unrelatedMoveRead)).toEqual({ state: 'unavailable', code: 'not_found' });
    expect(await responseBody(await replayMove(runtime, request, await request.digest()))).toEqual(freezingStatus);
    const conflictingReplay = await replayMove(runtime, request, '0'.repeat(64));
    expect(conflictingReplay.status).toBe(409);
    expect(await responseBody(conflictingReplay)).toEqual({ ok: false, code: 'request_conflict' });
    expect((await replayMove(runtime, request, await request.digest(), foreignWallet)).status).toBe(403);
    expect((await replayMove(runtime, request, await request.digest(), wallet('unrelated'))).status).toBe(404);
    expect((await replayMove(runtime, request, 'invalid')).status).toBe(400);
    observations.push(freezingStatus);
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
    expect(await executionAuthority(runtime, request.wallet, source)).toEqual({
      ok: false, code: 'wallet_paused',
    });
    expect(await executionAuthority(runtime, request.wallet, destination)).toEqual({
      ok: false, code: 'wallet_paused',
    });
    expect(await establishedRuntimeAdmission(runtime, request.wallet, source, [source, destination, thirdHome, apacHome])).toMatchObject({
      ok: false, code: 'wallet_paused',
    });
    const authorizationManifest = relocationAuthorizationManifest();
    observations.push(await verifyAuthorizationRegionalLifecycle(
      await runtime.getD1Database('CONSOLE_DB', 'ingress-a'), request.wallet, freezeAttempt, source, 'freeze', authorizationManifest,
    ));
    expect(
      (
        await publishAuthorizationManifest(
          runtime,
          request,
          freezeAttempt,
          authorizationManifest,
          destination,
        )
      ).status,
    ).toBe(409);
    const pinnedAuthorization = await responseBody(
      await publishAuthorizationManifest(runtime, request, freezeAttempt, authorizationManifest),
    );
    expect(pinnedAuthorization).toEqual({
      ok: true,
      manifest: JSON.parse(authorizationManifest.encoded()),
    });
    expect(
      await responseBody(
        await publishAuthorizationManifest(runtime, request, freezeAttempt, authorizationManifest),
      ),
    ).toEqual(pinnedAuthorization);
    expect(
      (
        await publishAuthorizationManifest(
          runtime,
          request,
          freezeAttempt,
          relocationAuthorizationManifest('7'.repeat(64)),
        )
      ).status,
    ).toBe(409);
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
    expect(
      await relocationCommand(runtime, request.wallet, freezeAttempt, "export"),
    ).toEqual({
      ok: false,
      code: "attempt_conflict",
    });
    const copyAttempt = await claim(
      runtime,
      request,
      "copying",
      admittedAtMs + 100,
    );
    const routerExport = await routerExportCommand(runtime, request, copyAttempt, 0);
    expect(routerExport).toMatchObject({ ok: true, command: {
      kind: 'export', record_index: 0, segment_index: 0, chunk_bytes: 4096,
      receipt: { records_digest_hex: 'a'.repeat(64), record_count: 1 },
    } });
    expect(await routerExportCommand(runtime, request, copyAttempt, 0)).toEqual(routerExport);
    expect(await routerExportCommand(runtime, request, copyAttempt, 1)).toEqual({ ok: false, code: 'invalid_cursor' });
    expect(await routerExportCommand(runtime, request, copyAttempt, 0, destination)).toEqual({ ok: false, code: 'participant_conflict' });
    const routerStatus = await routerDestinationCommand(runtime, request, copyAttempt, 'status');
    expect(routerStatus).toMatchObject({ ok: true, command: {
      kind: 'status', chunk_bytes: 4096,
      receipt: { request: { source_generation: 1, destination_generation: 2 }, records_digest_hex: 'a'.repeat(64) },
    } });
    expect(await routerDestinationCommand(runtime, request, copyAttempt, 'status')).toEqual(routerStatus);
    expect(await routerDestinationCommand(runtime, request, copyAttempt, 'verify')).toMatchObject({
      ok: true, command: { kind: 'verify', receipt: { records_digest_hex: 'a'.repeat(64) } },
    });
    expect(await routerDestinationCommand(runtime, request, copyAttempt, 'verify', source)).toEqual({
      ok: false, code: 'participant_conflict',
    });
    expect(await routerDestinationCommand(runtime, request, freezeAttempt, 'verify')).toEqual({
      ok: false, code: 'attempt_conflict',
    });
    const routerImport = await routerDestinationCommand(runtime, request, copyAttempt, 'import');
    expect(routerImport).toMatchObject({ ok: true, command: { kind: 'import', chunk_bytes: 4096,
      receipt: { records_digest_hex: 'a'.repeat(64), record_count: 1 } } });
    expect(await routerDestinationCommand(runtime, request, copyAttempt, 'import')).toEqual(routerImport);
    expect(await routerDestinationCommand(runtime, request, copyAttempt, 'import', source)).toEqual({ ok: false, code: 'participant_conflict' });
    expect(await routerDestinationCommand(runtime, request, copyAttempt, 'activate')).toEqual({ ok: false, code: 'phase_conflict' });
    observations.push({ routerDestinationCommandsUsePinnedReceipt: true });
    observations.push({ routerExportUsesStoredReceipt: true });
    const exportCommand = await relocationCommand(
      runtime,
      request.wallet,
      copyAttempt,
      "export",
    );
    expect(exportCommand).toMatchObject({
      ok: true,
      command: {
        home: source,
        generation: 1,
        requestDigest: await request.digest(),
        operation: {
          kind: "export",
          receipt: { kind: "source_fence", manifestDigest: manifest },
        },
      },
    });
    expect(
      await relocationCommand(runtime, request.wallet, copyAttempt, "export"),
    ).toEqual(exportCommand);
    expect(
      await relocationCommand(
        runtime,
        request.wallet,
        copyAttempt,
        "export",
        destination,
      ),
    ).toEqual({
      ok: false,
      code: "participant_conflict",
    });
    observations.push({
      sourceExportCommand: exportCommand,
      destinationCannotAuthorizeSourceExport: true,
    });
    const authorizationImport = await relocationCommand(
      runtime,
      request.wallet,
      copyAttempt,
      'import_authorization',
      destination,
    );
    expect(authorizationImport).toMatchObject({
      ok: true,
      command: {
        home: destination,
        generation: 2,
        operation: {
          kind: 'import_authorization',
          manifest: JSON.parse(authorizationManifest.encoded()),
          physicalResource: `${destination.databaseId}/gateway/2`,
        },
      },
    });
    expect(
      await relocationCommand(runtime, request.wallet, copyAttempt, 'import_authorization'),
    ).toEqual({ ok: false, code: 'participant_conflict' });
    expect(
      await relocationCommand(
        runtime,
        request.wallet,
        copyAttempt,
        'import_authorization',
        destination,
        'walletRuntime',
      ),
    ).toEqual({ ok: false, code: 'participant_conflict' });
    await expect(
      database
        .prepare(
          "UPDATE wallet_relocations SET authorization_manifest_json = NULL WHERE wallet_id = 'traveller'",
        )
        .run(),
    ).rejects.toThrow();
    expect(
      await relocationCommand(
        runtime,
        request.wallet,
        copyAttempt,
        'import_authorization',
        destination,
      ),
    ).toEqual(authorizationImport);
    observations.push({
      pinnedAuthorization,
      authorizationImport,
      authorizationManifestImmutable: true,
    });
    observations.push(await verifyAuthorizationRegionalTransfer(
      database, request.wallet, copyAttempt, source, destination,
    ));
    const verificationCommand = await relocationCommand(
      runtime,
      request.wallet,
      copyAttempt,
      'verify',
      destination,
    );
    expect(verificationCommand).toMatchObject({
      ok: true,
      command: {
        home: destination,
        generation: 2,
        operation: {
          kind: 'verify',
          physicalResource: `${destination.databaseId}/gateway/2`,
          receipt: { kind: 'source_fence', manifestDigest: manifest },
        },
      },
    });
    expect(
      await relocationCommand(
        runtime,
        request.wallet,
        copyAttempt,
        'verify',
        destination,
        'gateway',
        relocationWriterVersion(destination.databaseId, 'gateway'),
        '{malformed',
      ),
    ).toEqual(verificationCommand);
    expect(
      await relocationCommand(
        runtime,
        request.wallet,
        copyAttempt,
        'verify',
        destination,
        'walletRuntime',
      ),
    ).toMatchObject({
      ok: true,
      command: {
        participant: 'walletRuntime',
        operation: {
          kind: 'verify',
          physicalResource: `${destination.databaseId}/walletRuntime/2`,
        },
      },
    });
    observations.push({ destinationCommandsUsePreparedParticipantResources: true });
    observations.push(verificationCommand);
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
      move: {
        progress: {
          state: 'cutover',
          activation: { state: 'awaiting_activation' },
          cutoverAtMs: admittedAtMs + 300,
        },
      },
    });
    observations.push(switched);
    const cutoverStatus = await responseBody(await placementStatus(runtime, request.wallet));
    expect(cutoverStatus).toMatchObject({
      state: 'moving',
      move: {
        moveId: request.moveId,
        progress: {
          state: 'activating',
          availability: 'paused',
        },
      },
    });
    observations.push(cutoverStatus);
    expect(await executionAuthority(runtime, request.wallet, destination)).toEqual({
      ok: false, code: 'wallet_paused',
    });

    expect(await (await call(runtime, { action: 'home', wallet: request.wallet })).json()).toEqual({
      code: 'wallet_relocation_in_progress',
    });
    const activationAttempt = await claim(runtime, request, 'cutover', admittedAtMs + 400);
    const routerActivation = await routerDestinationCommand(runtime, request, activationAttempt, 'activate');
    expect(routerActivation).toMatchObject({ ok: true, command: { kind: 'activate', receipt: {
      records_digest_hex: 'a'.repeat(64), request: { source_generation: 1, destination_generation: 2 },
    } } });
    expect(await routerDestinationCommand(runtime, request, activationAttempt, 'activate')).toEqual(routerActivation);
    expect(await routerDestinationCommand(runtime, request, activationAttempt, 'activate', source)).toEqual({ ok: false, code: 'participant_conflict' });

    expect(await relocationCommand(runtime, request.wallet, freezeAttempt, 'freeze')).toEqual({
      ok: false,
      code: 'attempt_conflict',
    });
    expect(await relocationCommand(runtime, request.wallet, activationAttempt, 'cleanup')).toEqual({
      ok: false,
      code: 'phase_conflict',
    });
    const activationCommand = await relocationCommand(
      runtime,
      request.wallet,
      activationAttempt,
      'activate',
      destination,
      'walletRuntime',
    );
    expect(activationCommand).toMatchObject({
      ok: true,
      command: {
        participant: 'walletRuntime',
        home: destination,
        generation: 2,
        operation: {
          kind: 'activate',
          physicalResource: `${destination.databaseId}/walletRuntime/2`,
          manifest: JSON.parse(authorizationManifest.encoded()),
          receipt: { kind: 'destination_verification', manifestDigest: manifest },
        },
      },
    });
    observations.push(activationCommand);
    observations.push(await verifyAuthorizationRegionalLifecycle(
      await runtime.getD1Database('CONSOLE_DB', 'ingress-a'), request.wallet, activationAttempt, destination, 'activate', authorizationManifest,
    ));
    const cutoverDatabase = await runtime.getD1Database('CONSOLE_DB', 'ingress-a');
    expect(
      await cutoverDatabase
        .prepare(
          "SELECT region, ownership_generation, placement_state FROM wallet_homes WHERE wallet_id = 'traveller'",
        )
        .first(),
    ).toEqual({ region: destination.region, ownership_generation: 2, placement_state: 'paused' });
    await expect(
      cutoverDatabase
        .prepare("UPDATE wallet_homes SET placement_state = 'active' WHERE wallet_id = 'traveller'")
        .run(),
    ).rejects.toThrow();
    const destinationPublication = {
      action: 'publish-route',
      wallet: request.wallet,
      home: destination,
      locator: { kind: 'passkey_challenge', value: randomBytes(16).toString('base64url') },
    };
    expect(await responseBody(await call(runtime, destinationPublication))).toEqual({
      published: false,
    });
    expect(
      await responseBody(
        await call(runtime, {
          action: 'publish-route',
          wallet: wallet('unrelated'),
          home: source,
          locator: { kind: 'passkey_challenge', value: randomBytes(16).toString('base64url') },
        }),
      ),
    ).toEqual({ published: true });
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
    observations.push(
      await verifyRelocationReadRouting(runtime, request, source, [
        source, destination, thirdHome, apacHome,
      ]),
    );
    const activation = relocationDestinationActivation(request, admittedAtMs + 410, manifest);
    const cleanup = relocationSourceCleanup(request, source, admittedAtMs + 1500, manifest);
    expect(
      await responseBody(
        await call(runtime, {
          action: 'complete',
          request,
          attempt: activationAttempt,
          cleanup,
          nowMs: admittedAtMs + 1600,
        }),
      ),
    ).toEqual({ ok: false, code: 'phase_conflict' });
    await expect(
      cutoverDatabase
        .prepare(
          `UPDATE wallet_relocations SET state = 'completed', completed_at_ms = ?,
       destination_activation_json = ?, source_cleanup_json = ?, execution_state = NULL,
       execution_revision = execution_revision + 1, execution_attempt = 0,
       execution_attempt_id = NULL, execution_started_at_ms = NULL WHERE wallet_id = 'traveller'`,
        )
        .bind(admittedAtMs + 1600, JSON.stringify(activation), JSON.stringify(cleanup))
        .run(),
    ).rejects.toThrow();
    expect(
      await responseBody(
        await call(runtime, {
          action: 'activate',
          request,
          attempt: activationAttempt,
          activation: relocationDestinationActivation(request, admittedAtMs + 410, '8'.repeat(64)),
        }),
      ),
    ).toEqual({ ok: false, code: 'receipt_conflict' });
    const lostActivation = await call(
      runtime,
      {
        action: 'activate',
        request,
        attempt: activationAttempt,
        activation,
      },
      'ingress-a',
      true,
    );
    expect(lostActivation.status).toBe(503);
    await runtime.dispose();
    runtime = start(directory);
    const activated = await responseBody(
      await call(runtime, {
        action: 'activate',
        request,
        attempt: activationAttempt,
        activation,
      }),
    );
    expect(activated).toMatchObject({
      ok: true,
      move: {
        progress: {
          state: 'cutover',
          activation: { state: 'activated', receipt: activation },
          execution: { state: 'running', attempt: activationAttempt },
        },
      },
    });
    observations.push(activated);
    expect(await executionAuthority(runtime, request.wallet, destination)).toMatchObject({
      ok: true, authority: { wallet: request.wallet, home: destination, generation: 2, participant: 'gateway' },
    });
    expect(await executionAuthority(runtime, request.wallet, source)).toEqual({
      ok: false, code: 'writer_home_mismatch',
    });
    expect(await establishedRuntimeAdmission(runtime, request.wallet, destination, [source, destination, thirdHome, apacHome])).toEqual({
      ok: true, ownershipGeneration: 2, purpose: 'ordinary',
    });
    expect(await establishedRuntimeAdmission(runtime, request.wallet, source, [source, destination, thirdHome, apacHome])).toMatchObject({
      ok: false, code: 'writer_home_mismatch',
    });
    observations.push({ executionAuthorityRequiresActiveLocalGeneration: true, establishedRuntimeFollowsActivatedGeneration: true });

    expect(
      await relocationCommand(runtime, request.wallet, activationAttempt, 'activate', destination),
    ).toEqual({
      ok: false,
      code: 'phase_conflict',
    });
    const cleanupCommand = await relocationCommand(
      runtime,
      request.wallet,
      activationAttempt,
      'cleanup',
    );
    expect(cleanupCommand).toMatchObject({
      ok: true,
      command: {
        home: source,
        generation: 1,
        operation: {
          kind: 'cleanup',
          receipt: { kind: 'destination_activation', manifestDigest: manifest },
          manifest: JSON.parse(authorizationManifest.encoded()),
        },
      },
    });
    observations.push(cleanupCommand);
    observations.push(await verifyAuthorizationRegionalLifecycle(
      await runtime.getD1Database('CONSOLE_DB', 'ingress-a'), request.wallet, activationAttempt, source, 'cleanup', authorizationManifest,
    ));
    const newAssignment = await responseBody(
      await call(runtime, { action: 'home', wallet: request.wallet }),
    );
    expect(newAssignment).toEqual({ ...original, home: destination, ownershipGeneration: 2 });
    expect(await responseBody(await call(runtime, destinationPublication))).toEqual({
      published: true,
    });
    expect(
      await responseBody(
        await call(runtime, {
          action: 'publish-route',
          wallet: request.wallet,
          home: source,
          locator: { kind: 'passkey_challenge', value: randomBytes(16).toString('base64url') },
        }),
      ),
    ).toEqual({ published: false });
    observations.push({
      activationGate: {
        pausedAtDestinationBeforeActivation: true,
        destinationPublicationAfterActivation: true,
        retiredSourcePublicationRejected: true,
        unrelatedWalletUnaffected: true,
      },
    });
    expect(
      await responseBody(
        await call(runtime, {
          action: 'activate',
          request,
          attempt: activationAttempt,
          activation: relocationDestinationActivation(request, admittedAtMs + 411, manifest),
        }),
      ),
    ).toEqual({ ok: false, code: 'receipt_conflict' });
    const cleanupFailure = await responseBody(
      await call(runtime, {
        action: 'fail',
        request,
        attempt: activationAttempt,
        code: 'transport_unavailable',
        nowMs: admittedAtMs + 430,
      }),
    );
    expect(cleanupFailure).toMatchObject({
      ok: true,
      move: {
        progress: {
          state: 'cutover',
          activation: { state: 'activated', receipt: activation },
          execution: { state: 'retry_wait', retryAtMs: admittedAtMs + 1430 },
        },
      },
    });
    observations.push(cleanupFailure);
    expect(await relocationCommand(runtime, request.wallet, activationAttempt, 'cleanup')).toEqual({
      ok: false,
      code: 'attempt_conflict',
    });
    const cleanupStatus = await responseBody(await placementStatus(runtime, request.wallet));
    expect(cleanupStatus).toMatchObject({
      state: 'moving',
      move: {
        moveId: request.moveId,
        progress: {
          state: 'cleanup',
          availability: 'active',
          execution: { state: 'retry_wait', retryAtMs: admittedAtMs + 1430 },
        },
      },
    });
    expect(await responseBody(await placementStatus(runtime, request.wallet, ''))).toEqual(cleanupStatus);
    observations.push(cleanupStatus);
    observations.push(
      await verifyRelocationReadRouting(runtime, request, destination, [
        source, destination, thirdHome, apacHome,
      ]),
    );

    await runtime.dispose();
    runtime = start(directory);
    expect(
      await responseBody(await call(runtime, { action: 'home', wallet: request.wallet })),
    ).toEqual(newAssignment);
    expect(
      await responseBody(
        await call(runtime, {
          action: 'admit',
          request: relocation('traveller', source, 2),
          nowMs: admittedAtMs + WALLET_RELOCATION_COOLDOWN_MS,
        }),
      ),
    ).toEqual({ ok: false, code: 'move_in_progress' });
    expect(
      await responseBody(
        await call(runtime, {
          action: 'activate',
          request,
          attempt: activationAttempt,
          activation,
        }),
      ),
    ).toEqual(cleanupFailure);
    const completionAttempt = await claim(runtime, request, 'cutover', admittedAtMs + 1430);
    expect(await relocationCommand(runtime, request.wallet, completionAttempt, 'cleanup')).toEqual(
      cleanupCommand,
    );
    expect(completionAttempt.number).toBe(2);
    expect(completionAttempt.run).toBe(activationAttempt.run);
    expect(
      await responseBody(
        await call(runtime, {
          action: 'complete',
          request,
          attempt: activationAttempt,
          cleanup,
          nowMs: admittedAtMs + 1600,
        }),
      ),
    ).toEqual({ ok: false, code: 'attempt_conflict' });
    expect(
      await (
        await call(runtime, {
          action: 'complete',
          request,
          attempt: completionAttempt,
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
            cleanup,
            nowMs: admittedAtMs + 1600,
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
        cleanup,
        nowMs: admittedAtMs + 1600,
      }),
    );
    expect(completed).toMatchObject({ ok: true, move: { progress: { state: 'completed' } } });
    expect(await responseBody(await placementStatus(runtime, request.wallet))).toEqual({
      state: 'settled',
      region: destination.region,
      generation: 2,
      nextMoveAtMs: admittedAtMs + WALLET_RELOCATION_COOLDOWN_MS,
    });
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
    const completedStatus = await responseBody(await moveStatus(runtime, request.wallet, request.moveId));
    expect(completedStatus).toEqual({
      state: 'completed',
      moveId: request.moveId,
      sourceRegion: source.region,
      destinationRegion: destination.region,
      sourceGeneration: 1,
      destinationGeneration: 2,
      admittedAtMs,
      completedAtMs: objectValue(objectValue(completed.move).progress).completedAtMs,
    });
    observations.push(completedStatus);
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
    expect(await responseBody(await moveStatus(runtime, request.wallet, request.moveId))).toEqual(completedStatus);
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
      expect(await responseBody(await placementStatus(runtime, returnMove.wallet))).toMatchObject({
        state: 'moving',
        move: {
          moveId: returnMove.moveId,
          progress: { execution: { state: number === 6 ? 'blocked' : 'retry_wait' } },
        },
      });
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
        .prepare("SELECT COUNT(*) AS count FROM wallet_relocations WHERE wallet_id = 'traveller'")
        .first<number>('count'),
    ).toBe(2);
    const history = await reopened
      .prepare(
        'SELECT move_id, state, source_generation, destination_generation, admitted_at_ms FROM wallet_relocations ORDER BY admitted_at_ms',
      )
      .all();
    expect(await responseBody(await moveStatus(runtime, request.wallet, request.moveId))).toEqual(completedStatus);
    expect(await responseBody(await replayMove(runtime, request, await request.digest()))).toEqual(completedStatus);
    observations.push(
      await verifyRelocationReadRouting(runtime, request, destination, [
        source, destination, thirdHome, apacHome,
      ]),
    );
    observations.push({ exactReplayAfterRestartIgnoresCatalogAndPreservesHistoricalMove: true });
    observations.push({ historicalMoveReadableDuringReturnAndAfterRestart: true });
    await establish(runtime, "coordinator");
    const coordinated = relocation("coordinator", destination);
    expect(
      (
        await responseBody(
          await call(runtime, {
            action: "admit",
            request: coordinated,
            nowMs: admittedAtMs,
          }),
        )
      ).ok,
    ).toBe(true);
    const pendingFreeze = await responseBody(
      await call(runtime, {
        action: 'advance',
        request: coordinated,
        attemptId: attemptIdentity(),
        receipt: null,
        nowMs: admittedAtMs + 50,
      }),
    );
    const freezingProgress = objectValue(objectValue(pendingFreeze.move).progress);
    expect(freezingProgress.state).toBe('freezing');
    expect(objectValue(freezingProgress.execution).state).toBe('running');
    runtime = await restart(runtime, directory);
    expect(
      await responseBody(
        await call(runtime, {
          action: 'advance',
          request: coordinated,
          attemptId: attemptIdentity(),
          receipt: null,
          nowMs: admittedAtMs + 100,
        }),
      ),
    ).toEqual(pendingFreeze);
    const lostFence = await call(
      runtime,
      {
        action: "advance",
        request: coordinated,
        attemptId: attemptIdentity(),
        receipt: fence(coordinated),
        nowMs: admittedAtMs + 110,
      },
      "ingress-a",
      true,
    );
    expect(lostFence.status).toBe(503);
    runtime = await restart(runtime, directory);
    const pendingCopy = await responseBody(await call(runtime, {
      action: 'advance',
      request: coordinated,
      attemptId: attemptIdentity(),
      receipt: null,
      nowMs: admittedAtMs + 150,
    }));
    const pendingProgress = objectValue(objectValue(pendingCopy.move).progress);
    expect(pendingProgress.state).toBe('copying');
    expect(objectValue(pendingProgress.execution).state).toBe('running');
    runtime = await restart(runtime, directory);
    expect(await responseBody(await call(runtime, {
      action: 'advance',
      request: coordinated,
      attemptId: attemptIdentity(),
      receipt: null,
      nowMs: admittedAtMs + 180,
    }))).toEqual(pendingCopy);
    const copiedByCoordinator = await responseBody(
      await call(runtime, {
        action: "advance",
        request: coordinated,
        attemptId: attemptIdentity(),
        receipt: verification(coordinated),
        nowMs: admittedAtMs + 210,
      }),
    );
    expect(
      objectValue(objectValue(copiedByCoordinator.move).progress).state,
    ).toBe("verified");
    const switchedByCoordinator = await responseBody(
      await call(runtime, {
        action: "advance",
        request: coordinated,
        attemptId: attemptIdentity(),
        nowMs: admittedAtMs + 300,
      }),
    );
    expect(
      objectValue(objectValue(switchedByCoordinator.move).progress).state,
    ).toBe("cutover");
    const activatedByCoordinator = await responseBody(
      await call(runtime, {
        action: "advance",
        request: coordinated,
        attemptId: attemptIdentity(),
        receipt: relocationDestinationActivation(
          coordinated,
          admittedAtMs + 400,
          manifest,
        ),
        nowMs: admittedAtMs + 410,
      }),
    );
    expect(
      objectValue(
        objectValue(objectValue(activatedByCoordinator.move).progress).activation,
      ).state,
    ).toBe("activated");
    runtime = await restart(runtime, directory);
    const pendingCleanup = await responseBody(await call(runtime, {
      action: 'advance', request: coordinated, attemptId: attemptIdentity(), receipt: null,
      nowMs: admittedAtMs + 450,
    }));
    const pendingCleanupProgress = objectValue(objectValue(pendingCleanup.move).progress);
    expect(objectValue(pendingCleanupProgress.activation).state).toBe('activated');
    expect(objectValue(pendingCleanupProgress.execution).state).toBe('running');
    runtime = await restart(runtime, directory);
    expect(await responseBody(await call(runtime, {
      action: 'advance', request: coordinated, attemptId: attemptIdentity(), receipt: null,
      nowMs: admittedAtMs + 460,
    }))).toEqual(pendingCleanup);
    const coordinatorCleanupFailure = await responseBody(
      await call(runtime, {
        action: "advance",
        request: coordinated,
        attemptId: attemptIdentity(),
        failure: "transport_unavailable",
        nowMs: admittedAtMs + 500,
      }),
    );
    const failedProgress = objectValue(
      objectValue(coordinatorCleanupFailure.move).progress,
    );
    expect(objectValue(failedProgress.execution).state).toBe("retry_wait");
    expect(objectValue(failedProgress.activation).state).toBe("activated");
    const activeDuringCleanup = await responseBody(
      await placementStatus(runtime, coordinated.wallet),
    );
    expect(
      objectValue(objectValue(activeDuringCleanup.move).progress).availability,
    ).toBe("active");
    const tooEarly = await responseBody(
      await call(runtime, {
        action: "advance",
        request: coordinated,
        attemptId: attemptIdentity(),
        nowMs: admittedAtMs + 600,
      }),
    );
    expect(tooEarly.code).toBe("retry_wait");
    const coordinatorCompleted = await responseBody(
      await call(runtime, {
        action: "advance",
        request: coordinated,
        attemptId: attemptIdentity(),
        receipt: relocationSourceCleanup(
          coordinated,
          source,
          admittedAtMs + 1600,
          manifest,
        ),
        nowMs: admittedAtMs + 1610,
      }),
    );
    expect(
      objectValue(objectValue(coordinatorCompleted.move).progress).state,
    ).toBe("completed");
    expect(
      await responseBody(
        await call(runtime, {
          action: "advance",
          request: coordinated,
          attemptId: attemptIdentity(),
          nowMs: admittedAtMs + 1700,
        }),
      ),
    ).toEqual(coordinatorCompleted);
    await establish(runtime, "coordinator-conflict");
    const conflicted = relocation("coordinator-conflict", destination);
    await call(runtime, {
      action: "admit",
      request: conflicted,
      nowMs: admittedAtMs,
    });
    await call(runtime, {
      action: "advance",
      request: conflicted,
      attemptId: attemptIdentity(),
      receipt: fence(conflicted),
      nowMs: admittedAtMs + 110,
    });
    const blockedByCoordinator = await responseBody(
      await call(runtime, {
        action: "advance",
        request: conflicted,
        attemptId: attemptIdentity(),
        receipt: relocationDestinationVerification(
          conflicted,
          admittedAtMs + 200,
          "8".repeat(64),
        ),
        nowMs: admittedAtMs + 210,
      }),
    );
    const blockedExecution = objectValue(
      objectValue(objectValue(blockedByCoordinator.move).progress).execution,
    );
    expect(blockedExecution.state).toBe("blocked");
    expect(blockedExecution.code).toBe("receipt_conflict");
    observations.push({
      coordinator: {
        lostFenceReplyResumesNextPhaseAfterRestart: true,
        pendingDrainPreservesRunningAttemptAcrossRestart: true,
        pendingChunksPreserveRunningAttemptAcrossRestart: true,
        activationPersistsBeforeCleanup: true,
        cleanupFailureLeavesDestinationActive: true,
        retryDelayEnforced: true,
        completionReplaySkipsEffects: true,
        conflictingReceiptBlocksExecution: true,
        completed: coordinatorCompleted,
      },
    });
    const missingWriter = await call(runtime, {
      action: "bound-placement",
      request: coordinated,
      withoutBinding: true,
    });
    expect(missingWriter.status).toBe(409);
    const boundPlacement = await responseBody(
      await call(runtime, {
        action: "bound-placement",
        request: coordinated,
      }),
    );
    expect(boundPlacement).toEqual(
      await responseBody(await placementStatus(runtime, coordinated.wallet)),
    );
    expect(
      await responseBody(
        await call(runtime, {
          action: "bound-placement",
          request: coordinated,
          spoofWriter: true,
        }),
      ),
    ).toEqual(boundPlacement);
    observations.push({
      placementBinding: {
        missingWriterRejected: true,
        verifiedLocalWriterReachesDirectory: true,
        callerWriterHeadersReplaced: true,
        placement: boundPlacement,
      },
    });
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
