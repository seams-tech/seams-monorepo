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

async function call(runtime: Miniflare, body: unknown, ingress = 'ingress-a', loseReply = false) {
  const service = await runtime.getWorker(ingress);
  return service.fetch(`https://authority.test/${loseReply ? '?loseReply=1' : ''}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function placementStatus(runtime: Miniflare, key: WalletOwnershipKey) {
  const service = await runtime.getWorker('ingress-b');
  return service.fetch(
    'https://wallet-placement.internal/internal/wallet-placement/v1/placement-status',
    {
      method: 'POST',
      body: JSON.stringify({ wallet: key }),
    },
  );
}

async function relocationCommand(
  runtime: Miniflare,
  key: WalletOwnershipKey,
  attempt: WalletRelocationAttempt,
  kind: 'freeze' | 'verify' | 'activate' | 'cleanup',
  home = source,
  role = 'gateway',
  versionId = relocationWriterVersion(home.databaseId, role),
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
      },
      body: JSON.stringify({ wallet: key, attempt, kind }),
    },
  );
  return responseBody(response);
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
    const original = await establish(runtime, 'traveller');
    expect(await responseBody(await placementStatus(runtime, wallet('traveller')))).toEqual({
      state: 'settled',
      home: source,
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
    expect(freezeCommand).toMatchObject({
      ok: true,
      command: {
        wallet: request.wallet,
        moveId: request.moveId,
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
    expect(freezingStatus).toMatchObject({
      state: 'moving',
      move: {
        moveId: request.moveId,
        progress: {
          state: 'freezing',
          execution: { state: 'running', attempt: freezeAttempt },
        },
      },
    });
    expect(await responseBody(await placementStatus(runtime, request.wallet))).toEqual(
      freezingStatus,
    );
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
        operation: { kind: 'verify', receipt: { kind: 'source_fence', manifestDigest: manifest } },
      },
    });
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
          state: 'cutover',
          activation: { state: 'awaiting_activation' },
        },
      },
    });
    observations.push(cutoverStatus);
    expect(await (await call(runtime, { action: 'home', wallet: request.wallet })).json()).toEqual({
      code: 'wallet_relocation_in_progress',
    });
    const activationAttempt = await claim(runtime, request, 'cutover', admittedAtMs + 400);
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
          receipt: { kind: 'destination_verification', manifestDigest: manifest },
        },
      },
    });
    observations.push(activationCommand);
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
        },
      },
    });
    observations.push(cleanupCommand);
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
          state: 'cutover',
          activation: { state: 'activated' },
          execution: { state: 'retry_wait', retryAtMs: admittedAtMs + 1430 },
        },
      },
    });
    observations.push(cleanupStatus);
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
      home: destination,
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
      expect(await responseBody(await placementStatus(runtime, returnMove.wallet))).toMatchObject({
        state: 'moving',
        move: objectValue(failed.move),
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
