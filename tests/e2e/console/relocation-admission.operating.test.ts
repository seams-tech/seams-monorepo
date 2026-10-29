import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  isD1DatabaseLike,
  isPlainObject,
  type D1DatabaseLike,
} from '@seams/wallet-server/cloud-host';
import {
  activateConsoleDeploymentFixture,
  fourRegionBinding,
} from '../../helpers/tenantDeploymentFixtures';
import { registrationCompletionSession } from '../../fixtures/tenant-deployment/registrationHomeAdmission';
import { relocationFixtureBindings } from '../../fixtures/tenant-deployment/walletRelocationPreparation';
import {
  relocationCustodyNamespaces,
  relocationResourceVerification,
  relocationWriterVersion,
} from '../../fixtures/tenant-deployment/walletRelocationResources';
import {
  RegistrationSetupAllocation,
  WalletHome,
  WalletHomeCatalog,
  WalletOwnershipKey,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/home';
import { handleWalletHomeServiceRequest, WALLET_HOME_SERVICE_ORIGIN, WALLET_HOME_SERVICE_BASE_PATH } from '../../../packages/wallet-console-server-ts/src/walletPlacement/service';
import { D1WalletHomeDirectory } from '../../../packages/wallet-console-server-ts/src/walletPlacement/d1';
import {
  WALLET_RELOCATION_ADMISSION_URL,
  handleWalletRelocationAdmission,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationAdmission';
import {
  WalletRelocationRequest,
  type WalletRelocation,
} from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocation';
import { D1WalletRelocations } from '../../../packages/wallet-console-server-ts/src/walletPlacement/relocationStore';
import { WalletRegionalDispatch } from '../../../packages/wallet-console-server-ts/src/walletPlacement/regionalDispatch';
import { parseTenantRuntimeWriterV1 } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/resourceVerification';
import type { RelocationResourceVerification } from '../../../packages/wallet-console-server-ts/src/tenantDeployment/relocationResourceVerification';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scope = {
  namespace: 'relocation-admission-e2e',
  organizationId: 'owner',
  projectId: 'project',
  environmentId: 'project:dev',
} as const;
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
const catalog = WalletHomeCatalog.parse([
  WalletHome.parse({
    region: 'US',
    accountId,
    databaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }),
  source,
  WalletHome.parse({
    region: 'APAC',
    accountId,
    databaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  }),
  destination,
]);
const writer = parseTenantRuntimeWriterV1(
  'gateway',
  relocationWriterVersion(source.databaseId, 'gateway'),
  { accountId: source.accountId, databaseId: source.databaseId },
);

class DenyingSourceGateway {
  reads = 0;

  async fetch(request: Request): Promise<Response> {
    expect(request.url).toBe(
      'https://wallet-relocation.internal/internal/wallet-relocation/v1/authorization/owner-approval',
    );
    expect(request.method).toBe('POST');
    this.reads += 1;
    return Response.json({ kind: 'denied' });
  }
}

class DenyingOtherRegionGateway {
  reads = 0;

  async fetch(): Promise<Response> {
    this.reads += 1;
    return Response.json({ kind: 'denied' });
  }
}

class AdmissionObservation {
  readonly admittedMoveIds: string[] = [];

  async onAdmitted(move: WalletRelocation): Promise<void> {
    this.admittedMoveIds.push(move.moveId);
  }
}

async function unexpectedResourceVerification(): Promise<never> {
  throw new Error('A denied request or exact retry must not verify resources');
}

async function databaseFor(runtime: Miniflare): Promise<D1DatabaseLike> {
  const database = await runtime.getD1Database('DIRECTORY');
  if (!isD1DatabaseLike(database)) throw new Error('Console D1 binding is unavailable');
  return database;
}

async function migrate(database: D1DatabaseLike): Promise<void> {
  const directory = path.join(repoRoot, 'packages/wallet-console-server-ts/migrations/d1-console');
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    const sql = await readFile(path.join(directory, name), 'utf8');
    for (const statement of unstable_splitSqlQuery(sql)) {
      await database.prepare(statement).run();
    }
  }
}

async function establishWallet(
  directory: D1WalletHomeDirectory,
  walletId: string,
  nowMs: number,
): Promise<WalletOwnershipKey> {
  const wallet = WalletOwnershipKey.parse({ ...scope, walletId });
  const allocation = RegistrationSetupAllocation.parse({
    ceremonyId: `wrc_${walletId}`,
    preparationId: `regprep_${walletId}`,
    walletAuthorityId: `wallet-authority:${walletId}`,
    deviceId: `device:${walletId}`,
    walletAuthMethodId: `wallet-auth-method:${walletId}`,
  });
  const reservation = await directory.reserve({
    allocation: 'provided',
    wallet,
    proposedHome: source,
    registrationId: `register-${walletId}`,
    deploymentLane: 'test',
    requestDigest: '1'.repeat(64),
    proposedRegistrationAllocation: allocation,
    nowMs,
  });
  expect(reservation.ok).toBe(true);
  await directory.complete({
    wallet,
    home: source,
    ceremonyId: allocation.ceremonyId,
    outcome: 'established',
    session: await registrationCompletionSession(walletId),
    deploymentLane: 'test',
    nowMs: nowMs + 1,
  });
  return wallet;
}

function relocation(wallet: WalletOwnershipKey): WalletRelocationRequest {
  return WalletRelocationRequest.parse({
    wallet,
    moveId: `wmove_${randomBytes(32).toString('base64url')}`,
    authorityId: `wallet-authority:${wallet.walletId}`,
    expectedGeneration: 1,
    destination,
  });
}

async function requestAdmission(
  database: D1DatabaseLike,
  request: WalletRelocationRequest,
  gateways: WalletRegionalDispatch,
  observation: AdmissionObservation,
): Promise<Response> {
  const prepared = relocationFixtureBindings(request, Date.now(), undefined, undefined);
  return handleWalletRelocationAdmission(
    new Request(WALLET_RELOCATION_ADMISSION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet: request.wallet,
        moveId: request.moveId,
        authorityId: request.authorityId,
        expectedGeneration: request.expectedGeneration,
        destinationRegion: request.destination.region,
        requestDigest: await request.digest(),
      }),
    }),
    {
      database,
      catalog,
      scope,
      writer,
      deploymentLane: 'test',
      bindings: { gateways, runtimes: prepared.runtimes },
      verifyResources: unexpectedResourceVerification,
      clock: Date.now,
      onAdmitted: observation.onAdmitted.bind(observation),
    },
  );
}

async function journalRows(
  database: D1DatabaseLike,
  wallet: WalletOwnershipKey,
): Promise<readonly unknown[]> {
  const result = await database
    .prepare(
      `SELECT move_id, request_digest, state, admitted_at_ms, resource_verifications_json,
      preparation_json FROM wallet_relocations
      WHERE namespace = ? AND organization_id = ? AND project_id = ?
        AND environment_id = ? AND wallet_id = ?`,
    )
    .bind(
      wallet.namespace,
      wallet.organizationId,
      wallet.projectId,
      wallet.environmentId,
      wallet.walletId,
    )
    .all();
  if (!result.results) throw new Error('Relocation journal query returned no rows field');
  return result.results;
}

test('Console admission resumes an exact journal row and denies a new move without source approval', async ({
  request: http,
}, testInfo) => {
  test.setTimeout(120_000);
  void http;
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null, { status: 404 }); } };',
    compatibilityDate: '2026-06-12',
    d1Databases: { DIRECTORY: 'directory' },
  });
  try {
    const database = await databaseFor(runtime);
    await migrate(database);
    await activateConsoleDeploymentFixture(
      database,
      await fourRegionBinding(Date.now(), 'test', scope),
    );
    const directory = new D1WalletHomeDirectory(database, catalog);
    const nowMs = Date.now();
    const retryWallet = await establishWallet(directory, 'retry-wallet', nowMs);
    const deniedWallet = await establishWallet(directory, 'denied-wallet', nowMs);
    const retryRequest = relocation(retryWallet);
    const deniedRequest = relocation(deniedWallet);
    const journal = new D1WalletRelocations(database, catalog);
    const verification: RelocationResourceVerification = {
      resources: [
        relocationResourceVerification(source, scope.namespace, nowMs),
        relocationResourceVerification(destination, scope.namespace, nowMs),
      ],
      custody: relocationCustodyNamespaces(source, destination),
    };
    const firstAdmission = await journal.admit(
      retryRequest,
      verification,
      'test',
      relocationFixtureBindings(retryRequest, nowMs, undefined, undefined),
      Date.now,
    );
    expect(firstAdmission).toMatchObject({ ok: true, disposition: 'admitted' });

    const sourceGateway = new DenyingSourceGateway();
    const usGateway = new DenyingOtherRegionGateway();
    const apacGateway = new DenyingOtherRegionGateway();
    const ocGateway = new DenyingOtherRegionGateway();
    const gateways = new WalletRegionalDispatch({
      WALLET_GATEWAY_US: usGateway,
      WALLET_GATEWAY_WEUR: sourceGateway,
      WALLET_GATEWAY_APAC: apacGateway,
      WALLET_GATEWAY_OC: ocGateway,
    });
    const observation = new AdmissionObservation();
    const originalRows = await journalRows(database, retryWallet);
    expect(originalRows).toHaveLength(1);
    const resumed = await requestAdmission(database, retryRequest, gateways, observation);
    const resumedBody = await resumed.json();
    expect(resumed.status).toBe(200);
    expect(resumedBody).toMatchObject({
      state: 'moving',
      move: { moveId: retryRequest.moveId },
    });
    if (
      !isPlainObject(resumedBody) ||
      !isPlainObject(resumedBody.move) ||
      typeof resumedBody.move.moveId !== 'string'
    ) {
      throw new Error('Console relocation status response is invalid');
    }
    expect(observation.admittedMoveIds).toEqual([retryRequest.moveId]);
    const sourceReadsAfterRetry = sourceGateway.reads;
    const otherRegionReadsAfterRetry = {
      US: usGateway.reads,
      APAC: apacGateway.reads,
      OC: ocGateway.reads,
    };
    const rowsAfterRetry = await journalRows(database, retryWallet);
    expect(sourceReadsAfterRetry).toBe(0);
    expect(otherRegionReadsAfterRetry).toEqual({ US: 0, APAC: 0, OC: 0 });
    expect(rowsAfterRetry).toEqual(originalRows);

    const denied = await requestAdmission(database, deniedRequest, gateways, observation);
    const deniedBody = await denied.json();
    expect(denied.status).toBe(409);
    expect(deniedBody).toEqual({ ok: false, code: 'owner_approval_required' });
    if (!isPlainObject(deniedBody) || typeof deniedBody.code !== 'string') {
      throw new Error('Console relocation denial response is invalid');
    }
    const sourceReadsAfterDenial = sourceGateway.reads;
    const otherRegionReadsAfterDenial = {
      US: usGateway.reads,
      APAC: apacGateway.reads,
      OC: ocGateway.reads,
    };
    const rowsAfterDenial = await journalRows(database, deniedWallet);
    expect(sourceReadsAfterDenial).toBe(1);
    expect(otherRegionReadsAfterDenial).toEqual({ US: 0, APAC: 0, OC: 0 });
    expect(observation.admittedMoveIds).toEqual([retryRequest.moveId]);
    expect(rowsAfterDenial).toEqual([]);

    const artifact = testInfo.outputPath('relocation-admission.json');
    await writeFile(
      artifact,
      JSON.stringify(
        {
          scope:
            'Production Console admission and D1 journal with a denying source Gateway binding.',
          existingJournal: {
            responseStatus: resumed.status,
            moveId: resumedBody.move.moveId,
            sourceApprovalReads: sourceReadsAfterRetry,
            otherRegionApprovalReads: otherRegionReadsAfterRetry,
            journalRowsBefore: originalRows.length,
            journalRowsAfter: rowsAfterRetry.length,
          },
          missingJournal: {
            responseStatus: denied.status,
            responseCode: deniedBody.code,
            sourceApprovalReads: sourceReadsAfterDenial,
            otherRegionApprovalReads: otherRegionReadsAfterDenial,
            journalRowsAfter: rowsAfterDenial.length,
          },
        },
        null,
        2,
      ),
    );
    await testInfo.attach('relocation-admission', {
      path: artifact,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
});


test('owner-only registration completes and replays without publishing a session locator', verifyOwnerOnlyRegistration);

async function verifyOwnerOnlyRegistration({ request: _request }: { request: import('@playwright/test').APIRequestContext }, testInfo: import('@playwright/test').TestInfo): Promise<void> {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null, { status: 404 }); } };',
    compatibilityDate: '2026-06-12',
    d1Databases: { DIRECTORY: 'owner-only-directory' },
  });
  try {
    const database = await databaseFor(runtime);
    await migrate(database);
    await activateConsoleDeploymentFixture(database, await fourRegionBinding(Date.now(), 'test', scope));
    const directory = new D1WalletHomeDirectory(database, catalog);
    const wallet = WalletOwnershipKey.parse({ ...scope, walletId: 'owner-operation-wallet' });
    const allocation = RegistrationSetupAllocation.parse({
      ceremonyId: 'wrc_owner-operation-wallet', preparationId: 'regprep_owner-operation-wallet',
      walletAuthorityId: 'wallet-authority:owner-operation-wallet', deviceId: 'device:owner-operation-wallet',
      walletAuthMethodId: 'wallet-auth-method:owner-operation-wallet',
    });
    const reservation = await directory.reserve({
      allocation: 'provided', wallet, proposedHome: source, registrationId: 'owner-only-registration',
      deploymentLane: 'test', requestDigest: '2'.repeat(64), proposedRegistrationAllocation: allocation,
      nowMs: Date.now(),
    });
    expect(reservation.ok).toBe(true);
    const options = {
      database, writer, catalogJson: JSON.stringify(catalog), admittedResources: catalog.deploymentResources(),
      scope, environmentKey: 'test', deploymentLane: 'test',
    };
    const body = { wallet, home: source, ceremonyId: allocation.ceremonyId, outcome: 'established', session: { kind: 'none' } };
    const first = await handleWalletHomeServiceRequest(registrationCompletionRequest(body), options);
    expect(first?.status, await first?.clone().text()).toBe(200);
    const replay = await handleWalletHomeServiceRequest(registrationCompletionRequest(body), options);
    expect(replay?.status, await replay?.clone().text()).toBe(200);
    expect(await first?.json()).toEqual(await replay?.json());
    const wrongWriter = await handleWalletHomeServiceRequest(registrationCompletionRequest({ ...body, home: destination }), options);
    expect(wrongWriter?.status).toBe(403);
    const locators = await database.prepare('SELECT COUNT(*) AS count FROM wallet_session_locators').first<{ count: number }>();
    expect(locators?.count).toBe(0);
    const display = await database.prepare('SELECT COUNT(*) AS count FROM wallet_index WHERE id = ?').bind(wallet.walletId).first<{ count: number }>();
    expect(display?.count).toBe(1);
    const assignment = await directory.find(wallet);
    expect(assignment?.state).toBe('established');
    const evidence = { scope: 'Console registration completion over the service boundary with D1 storage', assignment, locators: locators?.count, displayRows: display?.count, replayStatus: replay?.status, wrongWriterStatus: wrongWriter?.status };
    const artifact = testInfo.outputPath('owner-only-registration.json');
    await writeFile(artifact, JSON.stringify(evidence, null, 2));
    await testInfo.attach('owner-only-registration', { path: artifact, contentType: 'application/json' });
  } finally { await runtime.dispose(); }
}

function registrationCompletionRequest(body: unknown): Request {
  return new Request(`${WALLET_HOME_SERVICE_ORIGIN}${WALLET_HOME_SERVICE_BASE_PATH}/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
