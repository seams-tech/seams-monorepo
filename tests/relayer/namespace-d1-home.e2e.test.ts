import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NamespaceD1HomeV1 } from '../../packages/wallet-console-server-ts/src/tenantDeployment/namespaceHome';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const accountId = '0123456789abcdef0123456789abcdef';
const databaseA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const databaseB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function runtimeAt(directory: string): Miniflare {
  return new Miniflare({
    host: '127.0.0.1',
    port: 0,
    d1Persist: path.join(directory, 'd1'),
    workers: [authorityWorker(directory, 'lane-a'), authorityWorker(directory, 'lane-b')],
  });
}

function authorityWorker(directory: string, name: string) {
  return {
    name,
    modules: true,
    scriptPath: path.join(directory, 'authority.js'),
    compatibilityDate: '2026-04-17',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { CONSOLE_DB: 'namespace-home-authority' },
  };
}

function homeFor(namespace: string, databaseId: string): NamespaceD1HomeV1 {
  return NamespaceD1HomeV1.parse({ namespace, accountId, databaseId });
}

function parseOutcome(raw: unknown) {
  if (typeof raw !== 'object' || raw === null || !('ok' in raw) || !('assignment' in raw)) {
    throw new Error('invalid reservation response');
  }
  if (raw.ok === true && 'disposition' in raw) {
    const disposition = raw.disposition;
    if (disposition !== 'reserved' && disposition !== 'reused') {
      throw new Error('invalid reservation disposition');
    }
    return { ok: true, disposition, assignment: raw.assignment } as const;
  }
  if (raw.ok === false && 'code' in raw && raw.code === 'namespace_home_conflict') {
    return { ok: false, code: raw.code, assignment: raw.assignment } as const;
  }
  throw new Error('invalid reservation outcome');
}

test('namespace home survives competing lanes, lost responses and authority restart', async ({
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const directory = testInfo.outputPath('authority');
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: [
      path.join(repoRoot, 'tests/fixtures/tenant-deployment/namespaceHomeAuthority.ts'),
    ],
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
      'packages/wallet-console-server-ts/migrations/d1-console/0047_namespace_d1_homes.sql',
    ),
    'utf8',
  );
  let runtime = runtimeAt(directory);
  const observations = [];
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'lane-a');
    for (const statement of unstable_splitSqlQuery(migration)) {
      await database.prepare(statement).run();
    }
    const empty = await request.get(`${await runtime.ready}?namespace=pending-provisioning`);
    expect(empty.status()).toBe(404);
    const laneA = await runtime.getWorker('lane-a');
    const laneB = await runtime.getWorker('lane-b');
    const attempts = [];
    for (let index = 0; index < 12; index += 1) {
      const lane = index % 2 === 0 ? laneA : laneB;
      const home = homeFor('competing-namespace', index % 2 === 0 ? databaseA : databaseB);
      attempts.push(
        lane.fetch('https://authority.test/', { method: 'POST', body: JSON.stringify(home) }),
      );
    }
    const responses = await Promise.all(attempts);
    let reserved = 0;
    let reused = 0;
    let conflicts = 0;
    const assignmentResponse = await laneA.fetch(
      'https://authority.test/?namespace=competing-namespace',
    );
    const assignment = await assignmentResponse.json();
    expect(assignmentResponse.status).toBe(200);
    for (const response of responses) {
      const outcome = parseOutcome(await response.json());
      expect(outcome.assignment).toEqual(assignment);
      if (response.status === 409) {
        expect(outcome).toMatchObject({ ok: false, code: 'namespace_home_conflict' });
        conflicts += 1;
      } else {
        expect(response.status).toBe(200);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) throw new Error('expected successful reservation');
        if (outcome.disposition === 'reserved') reserved += 1;
        else if (outcome.disposition === 'reused') reused += 1;
        else throw new Error('unexpected reservation disposition');
      }
      observations.push({ stage: 'race', status: response.status, outcome });
    }
    expect({ reserved, reused, conflicts }).toEqual({ reserved: 1, reused: 5, conflicts: 6 });

    const interruptedHome = homeFor('pending-provisioning', databaseA);
    const lost = await laneA.fetch('https://authority.test/?discardResponse=1', {
      method: 'POST',
      body: JSON.stringify(interruptedHome),
    });
    expect(lost.status).toBe(503);
    const beforeRestart = await laneA.fetch(
      'https://authority.test/?namespace=pending-provisioning',
    );
    const pendingAssignment = await beforeRestart.json();
    expect(beforeRestart.status).toBe(200);
    await runtime.dispose();
    runtime = runtimeAt(directory);
    const restarted = await runtime.getWorker('lane-b');
    const retry = await restarted.fetch('https://authority.test/', {
      method: 'POST',
      body: JSON.stringify(interruptedHome),
    });
    const retryOutcome = await retry.json();
    expect(retry.status).toBe(200);
    expect(retryOutcome).toEqual({
      ok: true,
      disposition: 'reused',
      assignment: pendingAssignment,
    });
    observations.push({
      stage: 'retry_after_restart',
      status: retry.status,
      outcome: retryOutcome,
    });

    for (const alternative of [
      homeFor('pending-provisioning', databaseB),
      NamespaceD1HomeV1.parse({
        namespace: 'pending-provisioning',
        accountId: 'f'.repeat(32),
        databaseId: databaseA,
      }),
    ]) {
      const conflict = await restarted.fetch('https://authority.test/', {
        method: 'POST',
        body: JSON.stringify(alternative),
      });
      const outcome = parseOutcome(await conflict.json());
      expect(conflict.status).toBe(409);
      expect(outcome.assignment).toEqual(pendingAssignment);
      observations.push({ stage: 'pending_conflict', status: conflict.status, outcome });
    }
    const sharedHome = await restarted.fetch('https://authority.test/', {
      method: 'POST',
      body: JSON.stringify(homeFor('another-namespace', databaseA)),
    });
    expect(sharedHome.status).toBe(200);
    const malformed = await restarted.fetch('https://authority.test/', {
      method: 'POST',
      body: JSON.stringify({ namespace: 'bad-home', accountId, databaseId: 'weur' }),
    });
    expect(malformed.status).toBe(400);
    const absent = await restarted.fetch('https://authority.test/?namespace=bad-home');
    expect(absent.status).toBe(404);

    const persisted = await runtime.getD1Database('CONSOLE_DB', 'lane-b');
    const mutations = [
      "UPDATE namespace_d1_homes SET database_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' WHERE namespace = 'pending-provisioning'",
      "DELETE FROM namespace_d1_homes WHERE namespace = 'pending-provisioning'",
      "INSERT OR REPLACE INTO namespace_d1_homes VALUES ('pending-provisioning', '0123456789abcdef0123456789abcdef', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1800000000000)",
    ];
    for (const sql of mutations) {
      await expect(persisted.prepare(sql).run()).rejects.toThrow('namespace D1 home is immutable');
      observations.push({ stage: 'database_guard', sql, rejected: true });
    }
    const final = await restarted.fetch('https://authority.test/?namespace=pending-provisioning');
    expect(await final.json()).toEqual(pendingAssignment);
    const count = await persisted
      .prepare('SELECT count(*) AS total FROM namespace_d1_homes')
      .first('total');
    expect(count).toBe(3);
    const evidence = {
      kind: 'namespace_d1_home_authority_e2e_v1',
      at: new Date().toISOString(),
      topology:
        'two test Worker transports → production Console store → shared persistent local D1',
      migrationSha256: createHash('sha256').update(migration).digest('hex'),
      workerBundleSha256: createHash('sha256')
        .update(await readFile(path.join(directory, 'authority.js')))
        .digest('hex'),
      race: { reserved, reused, conflicts },
      pendingReservationSurvivedRestart: true,
      sharedDatabaseAcrossNamespaces: true,
      invalidResourceRejected: true,
      observations,
      physicalResourceVerified: false,
      provisioningIntegrationVerified: false,
      regionalLatencyMeasured: false,
    };
    const evidencePath = testInfo.outputPath('namespace-home-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach('namespace-home-evidence', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
});
