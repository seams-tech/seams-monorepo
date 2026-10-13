import { expect, test } from '@playwright/test';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type {
  AcceptedServiceReceiptV1,
  PlatformResult,
  PlatformScopeV1,
  ServiceBindingRequestV1,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import type { AccountServiceProvisioningAdapterV1 } from '../../../packages/console-server-ts/src/accountPlatform/provisioning';
import type { ServiceProvisionDeliveryV1 } from '../../../packages/console-server-ts/src/accountPlatform/types';
import type { ConsoleAccountIdentityContext } from '../../../packages/console-server-ts/src/account/service';
import type { D1DatabaseLike } from '../../../packages/console-server-ts/src/boundary/d1';
import {
  ConsoleSessionService,
  type ConsoleSessionJwtHooks,
} from '../../../packages/console-server-ts/src/boundary/session';
import { createAppSessionConsoleAuthAdapter } from '../../../packages/console-server-ts/src/router/consoleAppSessionAuth';
import {
  createAccountConsoleRouter,
  type AccountConsoleFetchHandler,
} from '../../../packages/console-server-ts/src/router/cloudflare/createAccountConsoleRouter';
import { createCloudflareD1AccountServiceBundle } from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { WalletServiceProvisioningAdapter } from '../../../packages/wallet-console-server-ts/src/accountPlatform/provisioning';
import { createD1ConsoleApiKeyService } from '../../../packages/wallet-console-server-ts/src/apiKeys/d1';
import type { ConsoleApiKeyService } from '../../../packages/wallet-console-server-ts/src/apiKeys/service';
import { WALLET_API_CREDENTIAL_SCOPE_VALIDATION } from '../../../packages/wallet-console-shared-ts/src/apiKeyScopes';
import { createD1ConsoleWalletEnvironmentService } from '../../../packages/wallet-console-server-ts/src/environments/d1';
import {
  createRouterApiKeyAuthAdapter,
  createRouterApiPublishableKeyAuthAdapter,
} from '../../../packages/wallet-console-server-ts/src/router/routerApiKeyAuth';
import { createWalletProjectEnvironmentResolver } from '../../../packages/wallet-console-server-ts/src/router/projectEnvironmentAdapter';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/wallet-activation');
const namespace = 'shared-account-wallet-activation';
const deploymentId = 'wallet-activation-acceptance';
const origin = 'https://wallet.acceptance.invalid';
const owner = { orgId: 'organisation-wallet-activation', actorUserId: 'verified-activation-owner' };
const tokenSecret = 'isolated-wallet-activation-session-secret';

function now(): Date {
  return new Date('2026-10-13T02:00:00.000Z');
}

function runtime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Wallet activation acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: 'wallet-activation' },
    d1Persist: path.join(output, 'state'),
  });
}

async function databaseFor(worker: Miniflare): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database('CONSOLE_DB');
  if (!isD1DatabaseLike(database)) throw new Error('Wallet activation D1 binding is unavailable');
  return database;
}

async function migrate(database: D1DatabaseLike): Promise<readonly string[]> {
  const directory = path.join(
    repository,
    'packages/wallet-console-server-ts/migrations/d1-console',
  );
  const applied: string[] = [];
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    for (const statement of unstable_splitSqlQuery(
      await readFile(path.join(directory, name), 'utf8'),
    )) {
      await database.prepare(statement).run();
    }
    applied.push(name);
  }
  return applied;
}

function signToken(input: Parameters<ConsoleSessionJwtHooks['signToken']>[0]): string {
  const payload = Buffer.from(JSON.stringify(input.payload)).toString('base64url');
  const signature = createHmac('sha256', tokenSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyToken(token: string): { valid: boolean; payload?: unknown } {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return { valid: false };
  const supplied = Buffer.from(signature, 'base64url');
  const expected = createHmac('sha256', tokenSecret).update(payload).digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return { valid: false };
  return { valid: true, payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) };
}

function setCookie(token: string): string {
  return `activation-session=${token}; HttpOnly; Path=/`;
}

function clearCookie(): string {
  return 'activation-session=; Max-Age=0; Path=/';
}

function ready(): void {}

function sessions(): ConsoleSessionService {
  return new ConsoleSessionService({
    jwt: { signToken, verifyToken },
    cookie: {
      name: 'activation-session',
      buildSetHeader: setCookie,
      buildClearHeader: clearCookie,
    },
  });
}

function ownerIdentity(): ConsoleAccountIdentityContext {
  return {
    userId: owner.actorUserId,
    email: 'owner@activation.invalid',
    name: 'Activation owner',
    provider: 'oidc',
    platformSupport: false,
    orgId: null,
    projectId: null,
  };
}

class InterruptibleProvisioningAdapter implements AccountServiceProvisioningAdapterV1 {
  readonly consoleHref = '/dashboard/overview';
  private connection: 'online' | 'offline' = 'online';

  constructor(private readonly adapter: WalletServiceProvisioningAdapter) {}

  get authority() {
    return this.adapter.authority;
  }

  disconnect(): void {
    this.connection = 'offline';
  }

  reconnect(): void {
    this.connection = 'online';
  }

  createBinding(scope: PlatformScopeV1): ServiceBindingRequestV1 {
    return this.adapter.createBinding(scope);
  }

  async provision(
    delivery: ServiceProvisionDeliveryV1,
  ): Promise<
    PlatformResult<
      AcceptedServiceReceiptV1,
      { readonly code: 'unavailable' | 'provisioning_failed' }
    >
  > {
    if (this.connection === 'offline') return { kind: 'rejected', error: { code: 'unavailable' } };
    return await this.adapter.provision(delivery);
  }
}

async function compose(database: D1DatabaseLike) {
  const core = await createCloudflareD1AccountServiceBundle({
    database,
    namespace,
    ensureSchema: true,
    now,
    externalDeletionGuard: null,
  });
  const environments = await createD1ConsoleWalletEnvironmentService({
    database,
    namespace,
    ensureSchema: true,
    now,
  });
  const apiKeys = await createD1ConsoleApiKeyService({
    deploymentId,
    database,
    namespace,
    ensureSchema: true,
    now,
    scopeValidation: WALLET_API_CREDENTIAL_SCOPE_VALIDATION,
  });
  const walletAdapter = new WalletServiceProvisioningAdapter({
    deploymentId,
    namespace,
    environments,
    billing: core.billing,
    orgProjects: core.orgProjects,
  });
  const delivery = new InterruptibleProvisioningAdapter(walletAdapter);
  const session = sessions();
  const auth = createAppSessionConsoleAuthAdapter({
    session,
    organizationAccess: core.organizationAccess,
  });
  const router = createAccountConsoleRouter({
    services: core,
    auth,
    session,
    readyCheck: ready,
    walletProvisioning: delivery,
    satyrProvisioning: null,
    billingStripeWebhookSigningSecret: 'whsec_isolated_wallet_activation_acceptance',
    corsOrigins: [origin],
  });
  return {
    core,
    environments,
    apiKeys,
    delivery,
    session,
    router,
    secretAuth: createRouterApiKeyAuthAdapter(apiKeys),
    publishableAuth: createRouterApiPublishableKeyAuthAdapter(apiKeys),
    environmentResolver: createWalletProjectEnvironmentResolver({
      database,
      namespace,
      deploymentId,
    }),
  };
}

async function issueSession(session: ConsoleSessionService): Promise<string> {
  return session.signJwt(owner.actorUserId, {
    kind: 'app_session_v1',
    appSessionVersion: 'wallet-activation-acceptance',
    orgId: owner.orgId,
    email: 'owner@activation.invalid',
    provider: 'oidc',
    oidcProvider: 'google',
    oidcEmailVerified: true,
  });
}

async function changeService(
  router: AccountConsoleFetchHandler,
  token: string,
  projectId: string,
  command: 'enable' | 'disable' | 'archive',
  operationId: string,
  desiredRevision: number,
): Promise<Response> {
  return router(
    new Request(`${origin}/console/projects/${projectId}/services/wallet/${command}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({ operationId, desiredRevision }),
    }),
  );
}

async function credentials(apiKeys: ConsoleApiKeyService, projectId: string) {
  const environmentId = `${projectId}:dev`;
  const secret = await apiKeys.createApiKey(owner, {
    kind: 'secret_key',
    name: `${projectId} secret`,
    environmentId,
    scopes: ['wallets.read'],
  });
  const publishable = await apiKeys.createApiKey(owner, {
    kind: 'publishable_key',
    name: `${projectId} browser`,
    environmentId,
    allowedOrigins: [origin],
    rateLimitBucket: 'acceptance',
    quotaBucket: 'acceptance',
  });
  expect(secret.secret).toMatch(/^sk_dev_[A-Za-z0-9]{32}$/);
  expect(publishable.secret).toMatch(/^pk_dev_[A-Za-z0-9]{32}$/);
  expect(secret.apiKey.id).toMatch(/^ak_dev_[0-9a-f]{16}$/);
  expect(publishable.apiKey.id).toMatch(/^ak_dev_[0-9a-f]{16}$/);
  return { environmentId, secret: secret.secret, publishable: publishable.secret };
}

async function environmentCount(database: D1DatabaseLike, projectId: string): Promise<number> {
  const result = await database
    .prepare('SELECT count(*) AS count FROM environments WHERE namespace = ? AND project_id = ?')
    .bind(namespace, projectId)
    .first<number>('count');
  if (result === null) throw new Error('Environment count is unavailable');
  return result;
}

function environmentId(environment: { id: string }): string {
  return environment.id;
}

async function snapshot(database: D1DatabaseLike): Promise<unknown> {
  const instances = await database
    .prepare(
      'SELECT id, org_id, project_id, desired_state, desired_revision, observed_state, observed_revision, phase FROM platform_service_instances ORDER BY id',
    )
    .all();
  const environments = await database
    .prepare(
      'SELECT id, project_id, env_key, runtime_version, status FROM environments ORDER BY id',
    )
    .all();
  const keys = await database
    .prepare('SELECT id, kind, environment_id, status, secret_version FROM api_keys ORDER BY id')
    .all();
  const receipts = await database
    .prepare(
      'SELECT operation_id, result, disposition FROM platform_provision_receipts ORDER BY operation_id',
    )
    .all();
  return {
    instances: instances.results,
    environments: environments.results,
    keys: keys.results,
    receipts: receipts.results,
  };
}

test('Wallet activation API controls native credentials across delayed shutdown and restart', async () => {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  let worker = runtime();
  try {
    let database = await databaseFor(worker);
    const migrations = await migrate(database);
    let product = await compose(database);
    await product.core.account.createOrganization(ownerIdentity(), {
      id: owner.orgId,
      name: 'Wallet activation account',
    });
    await product.core.orgProjects.createProject(owner, {
      id: 'wallet-project-a',
      name: 'Wallet A',
    });
    await product.core.orgProjects.createProject(owner, {
      id: 'wallet-project-b',
      name: 'Wallet B',
    });
    await product.core.orgProjects.createProject(owner, {
      id: 'unbound-wallet-project',
      name: 'Unbound native scope',
    });
    expect(await environmentCount(database, 'wallet-project-a')).toBe(0);
    expect(await environmentCount(database, 'wallet-project-b')).toBe(0);
    await product.core.billing.grantManualSupportCredit(owner, {
      amountMinor: 5000,
      reasonCode: 'wallet_activation_acceptance',
      note: 'Isolated acceptance balance',
      idempotencyKey: 'activation-credit',
    });
    let token = await issueSession(product.session);
    const activation = await changeService(
      product.router,
      token,
      'wallet-project-a',
      'enable',
      'enable-a-1',
      1,
    );
    expect(activation.status).toBe(200);
    expect(await activation.json()).toMatchObject({
      ok: true,
      instance: { state: { kind: 'active', desiredRevision: 1, observedRevision: 1 } },
    });
    expect(await environmentCount(database, 'wallet-project-a')).toBe(3);
    expect(await environmentCount(database, 'wallet-project-b')).toBe(0);
    const replayedActivation = await changeService(
      product.router,
      token,
      'wallet-project-a',
      'enable',
      'enable-a-1',
      1,
    );
    expect(replayedActivation.status).toBe(200);
    expect(await environmentCount(database, 'wallet-project-a')).toBe(3);
    const keyA = await credentials(product.apiKeys, 'wallet-project-a');
    expect(
      (
        await product.secretAuth.authenticate({
          secret: keyA.secret,
          endpoint: '/wallets',
          requiredScopes: ['wallets.read'],
          environmentId: keyA.environmentId,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await product.publishableAuth.authenticate({
          secret: keyA.publishable,
          origin,
          environmentId: keyA.environmentId,
        })
      ).ok,
    ).toBe(true);
    expect(
      (await changeService(product.router, token, 'wallet-project-b', 'enable', 'enable-b-1', 1))
        .status,
    ).toBe(200);
    const keyB = await credentials(product.apiKeys, 'wallet-project-b');
    await product.environments.provisionProjectEnvironments(owner, {
      projectId: 'unbound-wallet-project',
      liveAccess: 'enabled',
    });
    const unbound = await credentials(product.apiKeys, 'unbound-wallet-project');
    expect(
      (
        await product.secretAuth.authenticate({
          secret: unbound.secret,
          endpoint: '/wallets',
          requiredScopes: ['wallets.read'],
          environmentId: unbound.environmentId,
        })
      ).ok,
    ).toBe(false);
    product.delivery.disconnect();
    const pendingShutdown = await changeService(
      product.router,
      token,
      'wallet-project-a',
      'disable',
      'disable-a-2',
      2,
    );
    expect(pendingShutdown.status).toBe(200);
    expect(await pendingShutdown.json()).toMatchObject({
      ok: true,
      instance: { state: { kind: 'disabled', shutdown: { kind: 'pending' } } },
    });
    const physical = await product.environments.listEnvironments(owner, {
      projectId: 'wallet-project-a',
    });
    expect(physical[0].status).toBe('ACTIVE');
    expect(
      (
        await product.secretAuth.authenticate({
          secret: keyA.secret,
          endpoint: '/wallets',
          requiredScopes: ['wallets.read'],
          environmentId: keyA.environmentId,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await product.publishableAuth.authenticate({
          secret: keyA.publishable,
          origin,
          environmentId: keyA.environmentId,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await product.secretAuth.authenticate({
          secret: keyB.secret,
          endpoint: '/wallets',
          requiredScopes: ['wallets.read'],
          environmentId: keyB.environmentId,
        })
      ).ok,
    ).toBe(true);
    const resolved = await product.environmentResolver.listEnvironments({
      ...owner,
      roles: ['OWNER'],
    });
    expect(resolved.map(environmentId)).not.toContain(keyA.environmentId);
    expect(resolved.map(environmentId)).toContain(keyB.environmentId);
    expect(resolved.map(environmentId)).not.toContain(unbound.environmentId);
    const beforeRestart = await snapshot(database);
    await writeFile(
      path.join(output, 'before-restart.json'),
      `${JSON.stringify(beforeRestart, null, 2)}\n`,
    );
    await worker.dispose();
    worker = runtime();
    database = await databaseFor(worker);
    product = await compose(database);
    expect(await snapshot(database)).toEqual(beforeRestart);
    expect(
      (
        await product.secretAuth.authenticate({
          secret: keyA.secret,
          endpoint: '/wallets',
          requiredScopes: ['wallets.read'],
          environmentId: keyA.environmentId,
        })
      ).ok,
    ).toBe(false);
    token = await issueSession(product.session);
    const resumedShutdown = await changeService(
      product.router,
      token,
      'wallet-project-a',
      'disable',
      'disable-a-2',
      2,
    );
    expect(resumedShutdown.status).toBe(200);
    expect(await resumedShutdown.json()).toMatchObject({
      ok: true,
      instance: { state: { kind: 'disabled', shutdown: { kind: 'confirmed' } } },
    });
    const reenabled = await changeService(
      product.router,
      token,
      'wallet-project-a',
      'enable',
      'enable-a-3',
      3,
    );
    expect(reenabled.status).toBe(200);
    expect(await environmentCount(database, 'wallet-project-a')).toBe(3);
    expect(
      (
        await product.secretAuth.authenticate({
          secret: keyA.secret,
          endpoint: '/wallets',
          requiredScopes: ['wallets.read'],
          environmentId: keyA.environmentId,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await product.publishableAuth.authenticate({
          secret: keyA.publishable,
          origin,
          environmentId: keyA.environmentId,
        })
      ).ok,
    ).toBe(true);
    const afterRestart = await snapshot(database);
    await writeFile(
      path.join(output, 'after-restart.json'),
      `${JSON.stringify(afterRestart, null, 2)}\n`,
    );
    const report = {
      version: 1,
      passed: true,
      command:
        'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-wallet-activation.e2e.test.ts',
      migrations,
      evidence: ['before-restart.json', 'after-restart.json'],
      checks: [
        'account projects start without Wallet environments',
        'real Wallet activation API',
        'activation replay preserves three environments',
        'native key formats remain unchanged',
        'secret and publishable key admission',
        'unbound native project denied',
        'desired disable denies before physical shutdown',
        'other Wallet project remains active',
        'environment resolver requires platform binding',
        'restart preserves pending shutdown',
        'durable replay completes shutdown',
        're-enable preserves credentials and environment IDs',
      ],
    };
    await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await worker.dispose();
  }
});
