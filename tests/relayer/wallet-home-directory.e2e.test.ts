import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WalletHome,
  WalletHomeCatalog,
  WalletOwnershipKey,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { WalletHomeServiceClient } from '../../packages/wallet-console-server-ts/src/walletPlacement/serviceClient';
import { parseTenantRuntimeWriterV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/homeVerification';
import {
  WALLET_HOME_SERVICE_BASE_PATH,
  WALLET_HOME_SERVICE_ORIGIN,
} from '../../packages/wallet-console-server-ts/src/walletPlacement/service';

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

class MiniflareWalletHomeServiceBinding {
  private loseNextReservationResponse = false;

  constructor(private readonly runtime: Miniflare) {}

  injectLostReservationResponse(): void {
    this.loseNextReservationResponse = true;
  }

  async fetch(request: Request): Promise<Response> {
    const service = await this.runtime.getWorker('ingress-b');
    const response = await service.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: await request.text(),
    });
    if (
      this.loseNextReservationResponse &&
      new URL(request.url).pathname === `${WALLET_HOME_SERVICE_BASE_PATH}/reserve`
    ) {
      this.loseNextReservationResponse = false;
      return Response.json({ ok: false, code: 'injected_lost_response' }, { status: 503 });
    }
    return response;
  }
}

function reservation(walletId: string, home: WalletHome, projectId = 'project') {
  return {
    action: 'reserve',
    allocation: 'provided',
    requestDigest: 'a'.repeat(64),
    wallet: walletKey(walletId, projectId),
    home,
    registrationId: `register-${walletId}`,
    registrationAllocation: {
      ceremonyId: `wrc_${walletId}`,
      preparationId: `regprep_${walletId}`,
      walletAuthorityId: `wallet-authority:${walletId}`,
      deviceId: `device:${walletId}`,
      walletAuthMethodId: `wallet-auth-method:${walletId}`,
    },
  };
}

async function call(runtime: Miniflare, body: unknown, loseReply = false, ingress = 'ingress-a') {
  const service = await runtime.getWorker(ingress);
  return service.fetch(`https://authority.test/${loseReply ? '?loseReply=1' : ''}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function serviceCall(
  runtime: Miniflare,
  operation: string,
  body: unknown,
): Promise<Response> {
  const service = await runtime.getWorker('ingress-b');
  return service.fetch(
    `${WALLET_HOME_SERVICE_ORIGIN}${WALLET_HOME_SERVICE_BASE_PATH}/${operation}`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
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
  const appliedMigrations: Array<{ name: string; sha256: string }> = [];
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'ingress-a');
    const migrationsDirectory = path.join(
      repoRoot,
      'packages/wallet-console-server-ts/migrations/d1-console',
    );
    for (const name of (await readdir(migrationsDirectory)).sort()) {
      if (!name.endsWith('.sql')) continue;
      const source = await readFile(path.join(migrationsDirectory, name), 'utf8');
      for (const sql of unstable_splitSqlQuery(source)) await database.prepare(sql).run();
      appliedMigrations.push({ name, sha256: createHash('sha256').update(source).digest('hex') });
    }
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

    const changedRequest = await call(runtime, {
      ...reservation('traveller', homes[1]),
      requestDigest: 'b'.repeat(64),
    });
    expect(changedRequest.status).toBe(409);
    expect(await changedRequest.json()).toMatchObject({
      code: 'request_conflict',
      assignment: assigned,
    });
    const invalidDigest = await call(runtime, {
      ...reservation('invalid-digest', homes[1]),
      requestDigest: 'not-a-digest',
    });
    expect(invalidDigest.status).toBe(400);
    const unknownResource = await call(runtime, {
      ...reservation('unadmitted-resource', homes[1]),
      home: WalletHome.parse({
        region: 'WEUR',
        accountId,
        databaseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
    });
    expect(unknownResource.status).toBe(400);
    expect(await unknownResource.json()).toMatchObject({ code: 'invalid_input' });
    expect(
      (await call(runtime, { action: 'find', wallet: walletKey('unadmitted-resource') })).status,
    ).toBe(404);
    const ingress = await runtime.getWorker('ingress-a');
    const baselineLocation = await ingress.fetch('https://authority.test/', {
      method: 'POST',
      body: JSON.stringify({ action: 'select' }),
    });
    const spoofedLocation = await ingress.fetch('https://authority.test/', {
      method: 'POST',
      headers: { 'x-seams-home-region': 'APAC' },
      body: JSON.stringify({ action: 'select', region: 'APAC' }),
    });
    expect(await spoofedLocation.json()).toEqual(await baselineLocation.json());

    const serviceReservation = {
      ...reservation('service-wallet', homes[2]),
      ingressRegion: 'US',
    };
    const serviceFirst = await serviceCall(runtime, 'reserve', serviceReservation);
    expect(serviceFirst.status).toBe(200);
    expect(await serviceFirst.json()).toMatchObject({
      disposition: 'reserved',
      assignment: { home: homes[0] },
    });
    const crossScope = await serviceCall(runtime, 'reserve', {
      ...serviceReservation,
      wallet: walletKey('cross-scope', 'another-project'),
    });
    expect(crossScope.status).toBe(403);
    expect(await crossScope.json()).toMatchObject({ code: 'scope_conflict' });
    const pauseTime = Date.now();
    await database
      .prepare(
        `INSERT INTO tenant_deployment_cutovers
         (operation_id, deployment_lane, state_kind, state_json, record_revision,
          created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)`,
      )
      .bind('pause-wallet-registration', 'test', 'ready', '{}', pauseTime)
      .run();
    const pausedService = await serviceCall(runtime, 'reserve', {
      ...reservation('paused-service', homes[0]),
      ingressRegion: 'US',
    });
    expect(pausedService.status).toBe(503);
    expect(await pausedService.json()).toMatchObject({ code: 'registration_paused' });
    const pausedRetry = await serviceCall(runtime, 'reserve', serviceReservation);
    expect(pausedRetry.status).toBe(503);
    expect(await pausedRetry.json()).toMatchObject({ code: 'registration_paused' });
    await database
      .prepare('DELETE FROM tenant_deployment_cutovers WHERE operation_id = ?1')
      .bind('pause-wallet-registration')
      .run();
    const serviceRetry = await serviceCall(runtime, 'reserve', {
      ...serviceReservation,
      ingressRegion: 'APAC',
      home: homes[2],
    });
    expect(serviceRetry.status).toBe(200);
    expect(await serviceRetry.json()).toMatchObject({
      disposition: 'reused',
      assignment: { home: homes[0] },
    });
    expect(
      (
        await serviceCall(runtime, 'complete', {
          ...serviceReservation,
          home: homes[2],
          outcome: 'established',
        })
      ).status,
    ).toBe(409);
    const serviceCompleted = await serviceCall(runtime, 'complete', {
      ...serviceReservation,
      home: homes[0],
      outcome: 'established',
    });
    expect(serviceCompleted.status).toBe(200);
    expect(await serviceCompleted.json()).toMatchObject({
      assignment: { state: 'established', home: homes[0] },
    });
    const byCeremony = await serviceCall(runtime, 'find-by-ceremony', {
      ceremonyId: 'wrc_service-wallet',
    });
    expect(byCeremony.status).toBe(200);
    expect(await byCeremony.json()).toMatchObject({
      assignment: { wallet: { walletId: 'service-wallet' }, home: homes[0] },
    });
    const clientBinding = new MiniflareWalletHomeServiceBinding(runtime);
    const serviceClient = new WalletHomeServiceClient(
      clientBinding,
      parseTenantRuntimeWriterV1('gateway', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      {
        namespace: 'shared',
        organizationId: 'owner',
        projectId: 'project',
        environmentId: 'test',
      },
      WalletHomeCatalog.parse(homes),
    );
    const clientInput = reservation('service-client', homes[2]);
    const clientReserved = await serviceClient.reserve({
      allocation: 'provided',
      wallet: clientInput.wallet,
      ingressRegion: 'APAC',
      registrationId: clientInput.registrationId,
      requestDigest: clientInput.requestDigest,
      proposedRegistrationAllocation: clientInput.registrationAllocation,
    });
    expect(clientReserved).toMatchObject({ ok: true, disposition: 'reserved' });
    if (!clientReserved.ok) throw new Error('Service client did not reserve a wallet');
    expect(clientReserved.assignment.home.matches(homes[2])).toBe(true);
    expect((await serviceClient.find(clientInput.wallet))?.wallet.matches(clientInput.wallet)).toBe(
      true,
    );
    expect(await serviceClient.find(walletKey('unknown-client-wallet'))).toBeNull();
    await expect(
      serviceClient.find(walletKey('service-client', 'other-project')),
    ).rejects.toMatchObject({ code: 'scope_conflict' });
    expect(
      (
        await serviceClient.findByCeremony(clientInput.registrationAllocation.ceremonyId)
      )?.home.matches(homes[2]),
    ).toBe(true);
    const clientCompleted = await serviceClient.complete({
      wallet: clientInput.wallet,
      home: homes[2],
      registrationId: clientInput.registrationId,
      requestDigest: clientInput.requestDigest,
      outcome: 'established',
    });
    expect(clientCompleted.state).toBe('established');
    observations.push({ stage: 'service_client_roundtrip', assignment: clientCompleted });
    const firstCandidate = reservation('client-loss-a', homes[1]);
    const nextCandidate = reservation('client-loss-b', homes[0]);
    const lostRequest = {
      allocation: 'server_allocated' as const,
      candidate: firstCandidate.wallet,
      ingressRegion: 'WEUR' as const,
      registrationId: firstCandidate.registrationId,
      requestDigest: firstCandidate.requestDigest,
      proposedRegistrationAllocation: firstCandidate.registrationAllocation,
    };
    clientBinding.injectLostReservationResponse();
    await expect(serviceClient.reserve(lostRequest)).rejects.toThrow(
      'Wallet home reservation failed: HTTP 503',
    );
    const replayedReservation = await serviceClient.reserve({
      ...lostRequest,
      candidate: nextCandidate.wallet,
      ingressRegion: 'US',
      proposedRegistrationAllocation: nextCandidate.registrationAllocation,
    });
    expect(replayedReservation).toMatchObject({ ok: true, disposition: 'reused' });
    if (!replayedReservation.ok) throw new Error('Lost response did not replay the reservation');
    expect(replayedReservation.assignment.wallet.matches(firstCandidate.wallet)).toBe(true);
    expect(replayedReservation.assignment.home.matches(homes[1])).toBe(true);
    expect(replayedReservation.assignment.registrationAllocation).toEqual(
      firstCandidate.registrationAllocation,
    );
    observations.push({
      stage: 'service_client_lost_reply',
      assignment: replayedReservation.assignment,
    });
    const duplicateCeremony = await call(runtime, {
      ...reservation('ceremony-collision', homes[1]),
      registrationAllocation: {
        ...reservation('ceremony-collision', homes[1]).registrationAllocation,
        ceremonyId: 'wrc_service-wallet',
      },
    });
    expect(duplicateCeremony.status).toBe(409);
    expect(await duplicateCeremony.json()).toMatchObject({ code: 'ceremony_conflict' });
    expect(
      (await call(runtime, { action: 'find', wallet: walletKey('ceremony-collision') })).status,
    ).toBe(404);
    observations.push({ stage: 'service_admission', walletId: 'service-wallet', home: homes[0] });

    const allocations = [];
    for (let index = 0; index < 9; index += 1) {
      allocations.push(
        call(
          runtime,
          {
            ...reservation(`candidate-${index}`, homes[index % 3]),
            allocation: 'server_allocated',
            registrationId: 'one-server-registration',
          },
          false,
          index % 2 ? 'ingress-a' : 'ingress-b',
        ),
      );
    }
    const allocatedOutcomes = [];
    for (const response of await Promise.all(allocations)) {
      expect(response.status).toBe(200);
      allocatedOutcomes.push(await response.json());
    }
    const allocated = allocatedOutcomes[0].assignment;
    expect(allocated.registrationAllocation.ceremonyId).toMatch(/^wrc_candidate-\d$/u);
    expect(allocatedOutcomes.filter((outcome) => outcome.disposition === 'reserved')).toHaveLength(
      1,
    );
    for (const outcome of allocatedOutcomes) expect(outcome.assignment).toEqual(allocated);
    observations.push({ stage: 'server_allocation_race', outcomes: allocatedOutcomes });
    const changedAllocation = await call(runtime, {
      ...reservation(allocated.wallet.walletId, homes[0]),
      registrationId: 'one-server-registration',
    });
    expect(changedAllocation.status).toBe(409);
    expect(await changedAllocation.json()).toMatchObject({ code: 'request_conflict' });
    const generatedCollision = await call(runtime, {
      ...reservation('traveller', homes[0]),
      allocation: 'server_allocated',
      registrationId: 'allocation-after-collision',
    });
    expect(generatedCollision.status).toBe(409);
    expect(await generatedCollision.json()).toMatchObject({ code: 'wallet_conflict' });
    const generatedRetry = await call(
      runtime,
      {
        ...reservation('collision-replacement', homes[0]),
        allocation: 'server_allocated',
        registrationId: 'allocation-after-collision',
      },
      true,
    );
    expect(generatedRetry.status).toBe(503);

    const interrupted = reservation('lost-reply', homes[1]);
    expect((await call(runtime, interrupted, true)).status).toBe(503);
    await runtime.dispose();
    runtime = start(directory);
    const generatedAfterRestart = await call(runtime, {
      ...reservation('discarded-new-candidate', homes[2]),
      allocation: 'server_allocated',
      registrationId: 'allocation-after-collision',
    });
    expect(await generatedAfterRestart.json()).toMatchObject({
      ok: true,
      disposition: 'reused',
      assignment: { wallet: { walletId: 'collision-replacement' }, home: homes[0] },
    });
    const retry = await call(runtime, reservation('lost-reply', homes[2]));
    expect(await retry.json()).toMatchObject({
      ok: true,
      disposition: 'reused',
      assignment: {
        home: homes[1],
        registrationAllocation: interrupted.registrationAllocation,
      },
    });
    const wrongCompletion = await call(runtime, {
      ...interrupted,
      action: 'complete',
      outcome: 'established',
      requestDigest: 'c'.repeat(64),
    });
    expect(wrongCompletion.status).toBe(409);
    expect(
      await (await call(runtime, { action: 'find', wallet: interrupted.wallet })).json(),
    ).toMatchObject({ state: 'reserved' });
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
    const cancelledRetry = await call(runtime, reservation('cancelled', homes[2]));
    expect(cancelledRetry.status).toBe(409);
    expect(await cancelledRetry.json()).toMatchObject({
      code: 'registration_cancelled',
      assignment: { state: 'cancelled', home: homes[0] },
    });
    const cancelledCeremony = await serviceCall(runtime, 'find-by-ceremony', {
      ceremonyId: 'wrc_cancelled',
    });
    expect(cancelledCeremony.status).toBe(404);
    const foreignProject = reservation('lost-reply', homes[2], 'separate-project');
    const foreignProjectWithCeremony = {
      ...foreignProject,
      registrationAllocation: {
        ...foreignProject.registrationAllocation,
        ceremonyId: 'wrc_lost-reply-foreign',
      },
    };
    expect(await (await call(runtime, foreignProjectWithCeremony)).json()).toMatchObject({
      disposition: 'reserved',
      assignment: { home: homes[2] },
    });
    const foreignCeremony = await serviceCall(runtime, 'find-by-ceremony', {
      ceremonyId: 'wrc_lost-reply-foreign',
    });
    expect(foreignCeremony.status).toBe(404);

    const persisted = await runtime.getD1Database('CONSOLE_DB', 'ingress-a');
    for (const sql of [
      "UPDATE wallet_homes SET region = 'US' WHERE wallet_id = 'lost-reply' AND project_id = 'project'",
      "DELETE FROM wallet_homes WHERE wallet_id = 'lost-reply'",
      "UPDATE wallet_homes SET request_digest = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', state = 'established', completed_at_ms = reserved_at_ms WHERE wallet_id = 'traveller'",
      "UPDATE wallet_homes SET ceremony_id = 'wrc_replaced' WHERE wallet_id = 'traveller'",
      "INSERT OR REPLACE INTO wallet_homes SELECT * FROM wallet_homes WHERE wallet_id = 'lost-reply'",
      `INSERT OR REPLACE INTO wallet_homes
       SELECT namespace, organization_id, project_id, environment_id,
              'ceremony-replacement', 'register-ceremony-replacement', request_digest,
              allocation, ceremony_id, preparation_id, wallet_authority_id, device_id,
              wallet_auth_method_id, region, account_id, database_id, state,
              reserved_at_ms, completed_at_ms
         FROM wallet_homes WHERE wallet_id = 'service-wallet'`,
    ])
      await expect(persisted.prepare(sql).run()).rejects.toThrow(
        /wallet home (identity is immutable|transition is invalid)/,
      );
    expect(
      await (await call(runtime, { action: 'find', wallet: interrupted.wallet })).json(),
    ).toEqual(established);
    expect(
      await (await call(runtime, { action: 'find', wallet: walletKey('traveller') })).json(),
    ).toEqual(assigned);
    const rows = await persisted
      .prepare('SELECT * FROM wallet_homes ORDER BY project_id, wallet_id')
      .all();
    expect(rows.results).toHaveLength(18);
    const receipt = {
      kind: 'wallet_home_directory_e2e_v1',
      observations,
      rows: rows.results,
      migrationSha256: createHash('sha256').update(migration).digest('hex'),
      appliedMigrations,
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
