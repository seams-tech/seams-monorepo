import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import {
  decodeTenantRootIdentityWireV1,
  encodeTenantRootIdentityV1,
} from '../../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import { IntendedBehaviourHarness } from './harness';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ROUTER_REFRESH = 'http://127.0.0.1:4102/router-ab/internal/tenant-root/refresh/v1/execute';
const CONSOLE_STATUS = 'http://127.0.0.1:4100/console/tenant-root/security/status';

type TenantRootRotationJobStatusV1 = 'preparing' | 'installing' | 'verifying';

type TenantRootRotationJobReadbackV1 = {
  readonly status: TenantRootRotationJobStatusV1;
  readonly jobId: string;
  readonly requestedAt: string;
};

type ConsoleTenantRootStatusV1 = {
  readonly identity: string;
  readonly custodyLineageId: string;
  readonly lifecycleRevision: number;
  readonly operationalShares: {
    readonly activeEpoch: number;
    readonly rootCommitmentFingerprintB64u: string;
    readonly job: TenantRootRotationJobReadbackV1 | null;
  };
};

type RotationFixtures = {
  context: BrowserContext;
  page: Page;
  request: APIRequestContext;
};

type PreparedRotation = Awaited<ReturnType<typeof prepareRotation>>;

async function createRotationHarness(
  fixtures: RotationFixtures,
): Promise<IntendedBehaviourHarness> {
  const harness = new IntendedBehaviourHarness({
    context: fixtures.context,
    page: fixtures.page,
    request: fixtures.request,
    flow: 'passkey.registration',
    networkMode: 'managed_local',
  });
  await harness.initialize();
  return harness;
}

async function assertWalletLifecycle(
  harness: IntendedBehaviourHarness,
  testInfo: TestInfo,
): Promise<void> {
  await harness.attachTrace(testInfo);
  harness.assertNoLifecycleViolations();
  harness.assertNoWrongAuthPath();
}

function localDeriverProcessGroup(): number {
  const pids = new Set(
    execFileSync('lsof', ['-nP', '-t', '-iTCP:4103', '-sTCP:LISTEN'], { encoding: 'utf8' })
      .trim()
      .split('\n'),
  );
  expect(pids.size).toBe(1);
  const pid = Number([...pids][0]);
  expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
  const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  expect(command).toContain('workerd');
  const group = Number(
    execFileSync('ps', ['-p', String(pid), '-o', 'pgid='], { encoding: 'utf8' }).trim(),
  );
  expect(Number.isSafeInteger(group) && group > 1).toBe(true);
  const leader = execFileSync('ps', ['-p', String(group), '-o', 'command='], { encoding: 'utf8' });
  expect(leader).toContain('wrangler.deriver-a.toml');
  return group;
}

function ignorePendingRotationFailure(): void {}

async function readConsoleTenantRootStatus(
  request: APIRequestContext,
  consoleHeaders: Record<string, string>,
): Promise<ConsoleTenantRootStatusV1> {
  const response = await request.get(CONSOLE_STATUS, { headers: consoleHeaders, timeout: 5_000 });
  expect(response.status()).toBe(200);
  return (await response.json()).status;
}

async function waitForPreparingRotationJob(
  request: APIRequestContext,
  consoleHeaders: Record<string, string>,
  operationId: string,
): Promise<TenantRootRotationJobReadbackV1> {
  const deadline = Date.now() + 10_000;
  let lastJob: TenantRootRotationJobReadbackV1 | null = null;
  while (Date.now() < deadline) {
    const status = await readConsoleTenantRootStatus(request, consoleHeaders);
    lastJob = status.operationalShares.job;
    if (lastJob?.jobId === operationId) {
      expect(lastJob.status).toBe('preparing');
      expect(Number.isFinite(Date.parse(lastJob.requestedAt))).toBe(true);
      return lastJob;
    }
    await setTimeout(100);
  }
  throw new Error(`Router did not expose preparing job ${operationId}: ${JSON.stringify(lastJob)}`);
}

async function prepareRotation(request: APIRequestContext) {
  expect(new URL(process.env.SEAMS_INTENDED_ROUTER_URL || 'https://localhost:4101').hostname).toBe(
    'localhost',
  );
  const runtimeRoot =
    process.env.SEAMS_INTENDED_ROUTER_AB_ROOT ||
    path.join(tmpdir(), `${path.basename(REPO_ROOT)}-intended-router-ab`);
  const secrets = parse(
    readFileSync(path.join(runtimeRoot, '.runtime/router-ab-strict/.dev.vars.router')),
  );
  const secret = secrets.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET;
  expect(typeof secret === 'string' && secret.length > 0).toBe(true);
  const headers = {
    'x-router-ab-internal-service-auth': secret,
    'content-type': 'application/json',
  };
  const cookie = process.env.SEAMS_INTENDED_CONSOLE_COOKIE;
  if (!cookie) throw new Error('Managed Console session is missing');
  const consoleHeaders = { Cookie: cookie };
  const before = await readConsoleTenantRootStatus(request, consoleHeaders);
  expect(before.operationalShares.job).toBeNull();
  const identity = decodeTenantRootIdentityWireV1(before.identity);
  if (!identity.ok) throw new Error('Console returned an invalid tenant identity');
  const operationId = randomUUID();
  const binding = {
    operation_id: operationId,
    identity_digest_b64u: createHash('sha256')
      .update(encodeTenantRootIdentityV1(identity.value))
      .digest('base64url'),
    custody_lineage_b64u: before.custodyLineageId,
    expected_lifecycle_revision: before.lifecycleRevision,
    expires_at_ms: Date.now() + 180_000,
    trigger: 'manual',
  };
  return { before, binding, headers, consoleHeaders };
}

async function completeRotation(request: APIRequestContext, rotation: PreparedRotation) {
  const { before, binding, headers, consoleHeaders } = rotation;
  const completed = await request.post(ROUTER_REFRESH, {
    headers,
    data: binding,
    timeout: 180_000,
  });
  expect(completed.status(), await completed.text()).toBe(200);
  const receipt = await completed.json();
  expect(receipt).toMatchObject({
    activation_receipt_digest_b64u: expect.any(String),
    retirement: { kind: 'confirmed' },
  });
  expect(receipt.activation_receipt_digest_b64u).not.toBe('');
  const after = await readConsoleTenantRootStatus(request, consoleHeaders);
  expect(after.operationalShares.job).toBeNull();
  expect(after.lifecycleRevision).toBe(receipt.lifecycle_revision);
  expect(after.lifecycleRevision).toBeGreaterThan(before.lifecycleRevision);
  expect(after.operationalShares.activeEpoch).toBe(before.operationalShares.activeEpoch + 1);
  expect(after.operationalShares.rootCommitmentFingerprintB64u).toBe(
    before.operationalShares.rootCommitmentFingerprintB64u,
  );
  return after;
}

async function verifySigningDuringRotation(
  { context, page, request }: RotationFixtures,
  testInfo: TestInfo,
): Promise<void> {
  const harness = await createRotationHarness({ context, page, request });
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.signNearTransaction('post_registration');
  const prepared = await prepareRotation(request);
  const { binding, headers, consoleHeaders } = prepared;
  const operationId = binding.operation_id;
  const deriverGroup = localDeriverProcessGroup();
  process.kill(-deriverGroup, 'SIGSTOP');
  const rotation = fetch(ROUTER_REFRESH, {
    method: 'POST',
    headers,
    body: JSON.stringify(binding),
    signal: AbortSignal.timeout(180_000),
  });
  void rotation.catch(ignorePendingRotationFailure);
  let preparing: TenantRootRotationJobReadbackV1 | null = null;
  try {
    await setTimeout(250);
    preparing = await waitForPreparingRotationJob(request, consoleHeaders, operationId);
    const conflict = await request.post(ROUTER_REFRESH, {
      headers,
      data: { ...binding, operation_id: randomUUID() },
      timeout: 5_000,
    });
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'tenant_root_refresh_in_progress' });
    await harness.signNearTransaction('post_registration');
  } finally {
    process.kill(-deriverGroup, 'SIGCONT');
  }
  const interrupted = await rotation;
  expect([200, 500]).toContain(interrupted.status);
  const after = await completeRotation(request, prepared);
  const throttled = await request.post(ROUTER_REFRESH, {
    headers,
    data: {
      ...binding,
      operation_id: randomUUID(),
      expected_lifecycle_revision: after.lifecycleRevision,
    },
  });
  expect(throttled.status()).toBe(429);
  const cooldown = await throttled.json();
  expect(cooldown.code).toBe('tenant_root_refresh_throttled');
  expect(cooldown.retry_at_ms).toBeGreaterThan(Date.now());
  expect(cooldown.retry_at_ms).toBeLessThanOrEqual(Date.now() + 60_000);
  await harness.signNearTransaction('post_registration');
  await assertWalletLifecycle(harness, testInfo);
  console.log(
    JSON.stringify({
      operationId,
      interruptedStatus: interrupted.status,
      progress: { preparing },
      epoch: after.operationalShares.activeEpoch,
      verifiedSignatures: ['before', 'deriver_stopped_rotation_pending', 'after'],
    }),
  );
}

test(
  'normal signing remains available while tenant-root rotation waits for a stopped Deriver',
  verifySigningDuringRotation,
);

async function verifyWarmEcdsaSigningAfterRotation(
  { context, page, request }: RotationFixtures,
  testInfo: TestInfo,
): Promise<void> {
  const harness = await createRotationHarness({ context, page, request });
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.signTempoTransaction('post_registration');

  const rotation = await prepareRotation(request);
  await completeRotation(request, rotation);

  await harness.signTempoTransaction('post_registration');
  await harness.signArcEvmTransaction('post_registration');
  await assertWalletLifecycle(harness, testInfo);
}

test(
  'tenant-root rotation preserves warm Tempo and Arc/EVM signing addresses',
  verifyWarmEcdsaSigningAfterRotation,
);

async function verifyColdUnlockAfterRotation(
  { context, page, request }: RotationFixtures,
  testInfo: TestInfo,
): Promise<void> {
  const harness = await createRotationHarness({ context, page, request });
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.signNearTransaction('post_registration');
  await harness.signTempoAndArcEvmConcurrently('post_registration');

  const rotation = await prepareRotation(request);
  await completeRotation(request, rotation);

  await harness.syncPasskeyWalletFromEmptyStorage();
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoAndArcEvmConcurrently('post_unlock');
  await assertWalletLifecycle(harness, testInfo);
}

test(
  'tenant-root rotation preserves Ed25519 and ECDSA keys through cold unlock from empty storage',
  verifyColdUnlockAfterRotation,
);

async function verifyWalletRecoveryAfterRotation(
  { context, page, request }: RotationFixtures,
  testInfo: TestInfo,
): Promise<void> {
  const harness = await createRotationHarness({ context, page, request });
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.signNearTransaction('post_registration');
  await harness.signTempoAndArcEvmConcurrently('post_registration');

  const rotation = await prepareRotation(request);
  await completeRotation(request, rotation);

  await harness.recoverPasskeyWalletFromFreshBrowser();
  await harness.assertRecoveryAuthorityIsAdditive('passkey');
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoAndArcEvmConcurrently('post_unlock');
  await harness.assertConsumedRecoveryCodeReportedAsUsed();
  await assertWalletLifecycle(harness, testInfo);
}

test(
  'a recovery code issued before tenant-root rotation restores the original Ed25519 and ECDSA keys',
  verifyWalletRecoveryAfterRotation,
);
