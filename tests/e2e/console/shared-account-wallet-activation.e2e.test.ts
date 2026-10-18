import { expect, test, type Browser, type Page, type Route, type TestInfo } from '@playwright/test';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { createRequire } from 'node:module';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type {
  AcceptedServiceReceiptV1,
  PlatformResult,
  PlatformScopeV1,
  ServiceBindingRequestV1,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import {
  dispatchAccountServiceProvision,
  runAccountServiceProvisioning,
  type AccountServiceProvisioningAdapterV1,
} from '../../../packages/console-server-ts/src/accountPlatform/provisioning';
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
import { createCloudflareConsoleRouter } from '../../../packages/wallet-console-server-ts/src/router/cloudflare/createCloudflareConsoleRouter';
import {
  HostedConsoleAuthHandler,
  type HostedConsoleIdentityPort,
} from '../../../packages/wallet-console-server-ts/src/router/hostedConsoleAuth';
import { createConsoleSessionAuthAdapter } from '../../../packages/wallet-console-server-ts/src/router/cloudflare/d1StagingSession';
import type {
  ConsoleGithubLoginResult,
  ConsoleGoogleLoginResult,
} from '../../../packages/console-server-ts/src/boundary/providerIdentity';
import {
  buildOrganizationInvitationEmailV1,
  renderOrganizationInvitationEmailV1,
} from '../../../packages/console-server-ts/src/email/templates';

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

function runtime(persistence = path.join(output, 'state')): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Wallet activation acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: 'wallet-activation' },
    d1Persist: persistence,
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
  calls = 0;

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
    this.calls += 1;
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
    auth,
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
      instance: { state: { kind: 'provisioning', desiredRevision: 1 } },
    });
    await dispatchAccountServiceProvision({
      platform: product.core.accountPlatform,
      adapter: product.delivery,
      operationId: 'enable-a-1',
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
    await dispatchAccountServiceProvision({
      platform: product.core.accountPlatform,
      adapter: product.delivery,
      operationId: 'enable-b-1',
    });
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
      instance: { state: { kind: 'disabled', shutdown: { kind: 'pending' } } },
    });
    await dispatchAccountServiceProvision({
      platform: product.core.accountPlatform,
      adapter: product.delivery,
      operationId: 'disable-a-2',
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
    await dispatchAccountServiceProvision({
      platform: product.core.accountPlatform,
      adapter: product.delivery,
      operationId: 'enable-a-3',
    });
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
    product.delivery.disconnect();
    const provisionCalls = product.delivery.calls;
    for (let index = 0; index < 21; index += 1) {
      const projectId = `queued-${index.toString().padStart(2, '0')}`;
      await product.core.orgProjects.createProject(owner, { id: projectId, name: projectId });
      const response = await changeService(
        product.router,
        token,
        projectId,
        'enable',
        projectId,
        1,
      );
      expect(response.status).toBe(200);
    }
    expect(product.delivery.calls).toBe(provisionCalls);
    expect(
      await runAccountServiceProvisioning({
        platform: product.core.accountPlatform,
        adapter: product.delivery,
        limit: 20,
      }),
    ).toEqual({ delivered: 0, failed: 0, pending: 20 });
    product.delivery.reconnect();
    expect(
      await runAccountServiceProvisioning({
        platform: product.core.accountPlatform,
        adapter: product.delivery,
        limit: 1,
      }),
    ).toEqual({ delivered: 1, failed: 0, pending: 0 });
    expect(await environmentCount(database, 'queued-20')).toBe(3);
    const report = {
      version: 1,
      passed: true,
      requestProvisionCalls: 0,
      unavailableOlderOperations: 20,
      laterOperationDelivered: true,
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

class WalletConsoleBrowserIdentity implements HostedConsoleIdentityPort {
  async verifyGoogleLogin(): Promise<ConsoleGoogleLoginResult> {
    return {
      ok: false,
      verified: false,
      code: 'not_configured',
      message: 'This isolated journey uses GitHub sign-in',
    };
  }

  async verifyGithubOAuthCode(input: { code: string }): Promise<ConsoleGithubLoginResult> {
    switch (input.code) {
      case 'fresh-wallet-user':
        return {
          ok: true,
          verified: true,
          userId: 'fresh-wallet-user',
          providerSubject: 'fresh-wallet-user',
          sub: 'fresh-wallet-user',
          email: 'fresh@activation.invalid',
          name: 'Fresh Wallet user',
        };
      case 'invited-platform-user':
        return {
          ok: true,
          verified: true,
          userId: 'invited-platform-user',
          providerSubject: 'invited-platform-user',
          sub: 'invited-platform-user',
          email: 'invited@activation.invalid',
          name: 'Invited teammate',
        };
      case 'unscoped-wallet-identity':
        return {
          ok: true,
          verified: true,
          userId: 'unscoped-wallet-browser-user',
          providerSubject: 'unscoped-wallet-browser-user',
          sub: 'unscoped-wallet-browser-user',
          email: 'unscoped@activation.invalid',
          name: 'New Wallet user',
        };
      case 'wallet-activation-owner':
        return {
          ok: true,
          verified: true,
          userId: owner.actorUserId,
          providerSubject: owner.actorUserId,
          sub: owner.actorUserId,
          email: 'owner@activation.invalid',
          name: 'Activation owner',
        };
      default:
        return {
          ok: false,
          verified: false,
          code: 'not_verified',
          message: 'Unknown isolated provider code',
        };
    }
  }
}

async function recordBrowserGoogleIdentity(): Promise<void> {}

function browserSessionToken(response: Response): string {
  const cookie = response.headers.get('Set-Cookie');
  const prefix = 'activation-session=';
  if (!cookie?.startsWith(prefix)) throw new Error('Console did not issue a session cookie');
  const token = cookie.slice(prefix.length).split(';')[0];
  if (!token) throw new Error('Console issued an empty session cookie');
  return token;
}

async function issueBrowserSession(
  handler: HostedConsoleAuthHandler,
  code: string,
): Promise<string> {
  const response = await handler.fetch(
    new Request(`${origin}/console/auth/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }),
  );
  expect(response.status).toBe(200);
  return browserSessionToken(response);
}

async function switchBrowserOrganization(
  handler: HostedConsoleAuthHandler,
  token: string,
  orgId: string,
): Promise<string> {
  const response = await handler.fetch(
    new Request(`${origin}/console/account/organizations/${orgId}/switch-context`, {
      method: 'POST',
      headers: { Cookie: `activation-session=${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    }),
  );
  expect(response.status).toBe(200);
  return browserSessionToken(response);
}

async function createBrowserForeignAccount(
  handler: HostedConsoleAuthHandler,
  session: ConsoleSessionService,
  identityToken: string,
): Promise<string> {
  const response = await handler.fetch(
    new Request(`${origin}/console/account/organizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `activation-session=${identityToken}`,
      },
      body: JSON.stringify({ name: 'Foreign wallet account', slug: 'foreign-wallet-account' }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get('Set-Cookie');
  if (!cookie) throw new Error('Foreign account creation did not issue a session');
  const parsed = await session.parse({ cookie: cookie.split(';')[0] });
  if (
    !parsed.ok ||
    parsed.claims.kind !== 'console_session_v1' ||
    typeof parsed.claims.orgId !== 'string'
  ) {
    throw new Error('Foreign account creation did not return a scoped session');
  }
  return parsed.claims.orgId;
}

async function completeBrowserGithubAuthorization(
  consoleUrl: string,
  code: string,
  route: Route,
): Promise<void> {
  const request = new URL(route.request().url());
  const callback = request.searchParams.get('redirect_uri');
  const state = request.searchParams.get('state');
  if (callback !== new URL('/dashboard/login', consoleUrl).href || !state) {
    throw new Error('Console selected an unexpected provider callback');
  }
  const redirect = new URL(callback);
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('state', state);
  await route.fulfill({ status: 302, headers: { Location: redirect.href } });
}

class WalletConsoleBrowserTransport {
  readonly enableRequests: string[] = [];
  readonly organizationSwitches: string[] = [];
  readonly authExchanges: { readonly status: number; readonly body: unknown }[] = [];
  private loseNextEnableReply = true;
  private readonly pending: Promise<unknown>[] = [];

  constructor(private readonly handlers: ReadonlyMap<string, HostedConsoleAuthHandler>) {}

  waitUntil(work: Promise<unknown>): void {
    this.pending.push(work);
  }

  passThroughOnException(): void {
    throw new Error('The isolated Console test has no upstream fallback');
  }

  async handle(route: Route): Promise<void> {
    const incoming = route.request();
    const url = new URL(incoming.url());
    const contextSwitch = url.pathname.match(
      /^\/console\/account\/organizations\/([^/]+)\/switch-context$/,
    );
    if (incoming.method() === 'POST' && contextSwitch) {
      this.organizationSwitches.push(decodeURIComponent(contextSwitch[1]));
    }
    const enable = incoming.method() === 'POST' && url.pathname.endsWith('/services/wallet/enable');
    if (enable) this.enableRequests.push(incoming.postData() ?? '');
    const request = new Request(`${origin}${url.pathname}${url.search}`, {
      method: incoming.method(),
      headers: {
        Cookie: incoming.headers().cookie ?? '',
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: incoming.postData(),
    });
    const handler = this.handlers.get(url.origin);
    if (!handler) throw new Error('Console frontend has no authentication handler');
    const response = await handler.fetch(request, {}, this);
    await Promise.all(this.pending.splice(0));
    if (incoming.method() === 'POST' && url.pathname === '/console/auth/github') {
      this.authExchanges.push({ status: response.status, body: await response.clone().json() });
    }
    if (enable && this.loseNextEnableReply) {
      this.loseNextEnableReply = false;
      await route.abort('failed');
      return;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const cookie = response.headers.get('Set-Cookie');
    if (cookie !== null) headers['Set-Cookie'] = cookie;
    await route.fulfill({
      status: response.status,
      headers,
      body: await response.text(),
    });
  }
}

function createBrowserAuthHandler(
  product: Awaited<ReturnType<typeof compose>>,
  router: ReturnType<typeof createCloudflareConsoleRouter>,
  consoleUrl: string,
): HostedConsoleAuthHandler {
  return new HostedConsoleAuthHandler({
    handler: router,
    identity: new WalletConsoleBrowserIdentity(),
    recordVerifiedGoogleIdentity: recordBrowserGoogleIdentity,
    providers: {
      google: { configured: false },
      github: {
        configured: true,
        clientId: 'isolated-wallet-console-client',
        callbackUrl: new URL('/dashboard/login', consoleUrl).href,
      },
    },
    session: product.session,
    account: product.core.account,
    organizationAccess: product.core.organizationAccess,
    corsOrigins: [origin],
  });
}

async function completeFreshUserAuthorization(
  origins: readonly string[],
  route: Route,
): Promise<void> {
  const authorization = new URL(route.request().url());
  const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '');
  expect(origins).toContain(callback.origin);
  await completeBrowserGithubAuthorization(callback.origin, 'fresh-wallet-user', route);
}

async function verifyFreshUserOnboarding(input: {
  readonly browser: Browser;
  readonly database: D1DatabaseLike;
  readonly appUrl: string;
  readonly platformUrl: string;
  readonly handlers: ReadonlyMap<string, HostedConsoleAuthHandler>;
  readonly evidence: string;
}): Promise<void> {
  const page = await input.browser.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(15_000);
  const context = page.context();
  const transport = new WalletConsoleBrowserTransport(input.handlers);
  await context.tracing.start({ screenshots: true, snapshots: true });
  try {
    await page.route('**/console/**', transport.handle.bind(transport));
    await page.route(
      'https://github.com/login/oauth/authorize?*',
      completeFreshUserAuthorization.bind(null, [
        new URL(input.appUrl).origin,
        new URL(input.platformUrl).origin,
      ]),
    );
    await page.goto(new URL('/dashboard/login?db_network=mainnet', input.appUrl).href);
    await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Continue with GitHub', exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).origin).toBe(new URL(input.platformUrl).origin);
    await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Name your organization', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(input.evidence, 'fresh-organization-step.png'),
      fullPage: true,
    });
    await page.getByLabel('Organization name', { exact: true }).fill('Fresh customer');
    await page.getByRole('button', { name: 'Continue to project setup', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Create your first project', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Create your first project', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(input.evidence, 'fresh-project-step.png'),
      fullPage: true,
    });
    await page.getByRole('textbox', { name: /^Project name/ }).fill('Fresh Wallet');
    const walletEntry = page.waitForRequest(
      (request) =>
        request.isNavigationRequest() &&
        new URL(request.url()).origin === new URL(input.appUrl).origin,
    );
    await page.getByRole('button', { name: 'Finish onboarding', exact: true }).click();
    // Wallet onboarding ends in Wallet Console with the new organization and
    // project, not in Platform account settings.
    const selected = new URL((await walletEntry).url());
    expect(selected.pathname).toBe('/dashboard/overview');
    expect(selected.searchParams.get('db_network')).toBe('mainnet');
    const orgId = selected.searchParams.get('db_org');
    const projectId = selected.searchParams.get('db_project');
    if (!orgId || !projectId) throw new Error('New account omitted its selected project');
    expect(await environmentCount(input.database, projectId)).toBe(0);
    await expect(
      page.getByRole('button', { name: 'Continue with GitHub', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(input.evidence, 'fresh-account-ready.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).click();
    // A lost activation reply must resume the same setup after a reload.
    await expect(page.getByRole('heading', { name: 'Wallet setup unavailable' })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Manage your wallets', exact: true }),
    ).toBeVisible();
    expect(await environmentCount(input.database, projectId)).toBe(3);
    expect(transport.enableRequests).toHaveLength(1);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Manage your wallets', exact: true }),
    ).toBeVisible();
    const accountHref = await page
      .getByRole('link', { name: 'Account settings', exact: true })
      .getAttribute('href');
    if (!accountHref) throw new Error('Wallet omitted the selected account link');
    expect(new URL(accountHref).searchParams.get('db_org')).toBe(orgId);
    expect(new URL(accountHref).searchParams.get('db_project')).toBe(projectId);
    expect(transport.enableRequests).toHaveLength(1);
    await page.screenshot({
      path: path.join(input.evidence, 'fresh-wallet-ready.png'),
      fullPage: true,
    });
    // Creating another organisation also replaces the account session before
    // document navigation. Its project must stay in the newly created account.
    await page.goto(accountHref);
    await page.getByRole('button', { name: 'Create an organization', exact: true }).click();
    await page.getByLabel('Organization name', { exact: true }).fill('Second fresh account');
    await page.getByRole('button', { name: 'Continue to project setup', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Create your first project', exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole('textbox', { name: /^Project name/ }).fill('Second fresh project');
    await page.getByRole('button', { name: 'Finish onboarding', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Second fresh account' })).toContainText(
      'Current',
    );
    const secondAccountHref = await page
      .getByRole('link', { name: 'Wallet Console', exact: true })
      .getAttribute('href');
    if (!secondAccountHref) throw new Error('Second account omitted its Wallet link');
    const secondSelection = new URL(secondAccountHref);
    expect(secondSelection.searchParams.get('db_org')).not.toBe(orgId);
    expect(secondSelection.searchParams.get('db_network')).toBe('mainnet');
    const secondProjectId = secondSelection.searchParams.get('db_project');
    if (!secondProjectId) throw new Error('Second account omitted its project');
    expect(await environmentCount(input.database, secondProjectId)).toBe(0);
    expect(await environmentCount(input.database, projectId)).toBe(3);
    await writeFile(
      path.join(input.evidence, 'fresh-user-report.json'),
      JSON.stringify(
        {
          organizationId: orgId,
          projectId,
          accountCreation: true,
          projectCreation: true,
          reloadDuringOnboarding: true,
          separateHostAuthentication: true,
          selectedNetwork: 'mainnet',
          environments: 3,
          lostActivationReplyRecovered: true,
          noDuplicateActivationAfterReload: true,
          additionalAccountCreationPreservesSelection: true,
          additionalProjectId: secondProjectId,
          authExchanges: transport.authExchanges,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.tracing.stop({ path: path.join(input.evidence, 'fresh-user-trace.zip') });
    await context.close();
  }
}

async function verifyAutomaticWalletSetup(
  { page, browser }: { page: Page; browser: Browser },
  testInfo: TestInfo,
): Promise<void> {
  testInfo.setTimeout(180_000);
  const evidence = testInfo.outputPath('automatic-wallet-setup');
  await mkdir(evidence, { recursive: true });
  // Use the application's installed Vite so this journey needs no running local stack.
  const appDirectory = path.join(repository, 'apps/wallet-console');
  const appRequire = createRequire(path.join(appDirectory, 'package.json'));
  const { createServer } = await import(appRequire.resolve('vite'));
  const platform = await createServer({
    configFile: path.join(appDirectory, 'vite.console.config.ts'),
    cacheDir: path.join(evidence, 'vite-platform'),
    mode: 'platform',
    base: '/',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    define: {
      'import.meta.env.VITE_SITE_ORIGIN': 'window.location.origin',
      'import.meta.env.VITE_CONSOLE_BASE_URL': 'window.location.origin',
      'import.meta.env.VITE_TESTNET_CONSOLE_BASE_URL': 'window.location.origin',
      'import.meta.env.VITE_MAINNET_CONSOLE_BASE_URL': 'window.location.origin',
      'import.meta.env.VITE_RELAYER_URL': 'window.location.origin',
    },
  });
  await platform.listen();
  const platformUrl: unknown = platform.resolvedUrls?.local[0];
  if (typeof platformUrl !== 'string') throw new Error('Platform frontend did not start');
  const frontend = await createServer({
    configFile: path.join(appDirectory, 'vite.console.config.ts'),
    cacheDir: path.join(evidence, 'vite-wallet'),
    mode: 'wallet',
    base: '/',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    define: {
      'import.meta.env.VITE_SITE_ORIGIN': 'window.location.origin',
      'import.meta.env.VITE_CONSOLE_BASE_URL': 'window.location.origin',
      'import.meta.env.VITE_TESTNET_CONSOLE_BASE_URL': 'window.location.origin',
      'import.meta.env.VITE_MAINNET_CONSOLE_BASE_URL': 'window.location.origin',
      'import.meta.env.VITE_RELAYER_URL': 'window.location.origin',
      'import.meta.env.VITE_PLATFORM_CONSOLE_ORIGIN': JSON.stringify(platformUrl),
    },
  });
  const worker = runtime(path.join(evidence, 'state'));
  await page.context().tracing.start({ screenshots: true, snapshots: true });
  try {
    await frontend.listen();
    const resolvedUrl: unknown = frontend.resolvedUrls?.local[0];
    if (typeof resolvedUrl !== 'string') throw new Error('Console frontend did not start');
    const walletOrigin = new URL(resolvedUrl);
    walletOrigin.hostname = 'localhost';
    const appUrl = walletOrigin.href;
    platform.config.define['import.meta.env.VITE_WALLET_CONSOLE_ORIGIN'] = JSON.stringify(appUrl);
    const database = await databaseFor(worker);
    await migrate(database);
    const product = await compose(database);
    await product.core.account.createOrganization(ownerIdentity(), {
      id: owner.orgId,
      name: 'Automatic Wallet setup',
    });
    const projectId = 'automatic-wallet-project';
    const defaultProjectId = 'default-wallet-project';
    await product.core.orgProjects.createProject(owner, {
      id: defaultProjectId,
      name: 'Default Wallet',
    });
    await product.core.orgProjects.createProject(owner, {
      id: projectId,
      name: 'Selected Wallet',
    });
    const secondOrgId = 'second-wallet-account';
    const secondProjectId = 'second-account-wallet-project';
    await product.core.account.createOrganization(ownerIdentity(), {
      id: secondOrgId,
      name: 'Second Wallet account',
    });
    await product.core.orgProjects.createProject(
      { orgId: secondOrgId, actorUserId: owner.actorUserId },
      { id: secondProjectId, name: 'Second account Wallet' },
    );
    const router = createCloudflareConsoleRouter({
      auth: createConsoleSessionAuthAdapter({
        session: product.session,
        organizationAccess: product.core.organizationAccess,
      }),
      session: product.session,
      account: product.core.account,
      accountPlatform: product.core.accountPlatform,
      orgProjects: product.core.orgProjects,
      organizationAccess: product.core.organizationAccess,
      onboarding: product.core.onboarding,
      billing: product.core.billing,
      audit: product.core.audit,
      walletEnvironments: product.environments,
      apiKeys: product.apiKeys,
      walletProvisioning: product.delivery,
      satyrProvisioning: null,
      corsOrigins: [origin],
    });
    const token = await issueSession(product.session);
    const handler = createBrowserAuthHandler(product, router, appUrl);
    const platformHandler = createBrowserAuthHandler(product, router, platformUrl);
    const initialWalletToken = await issueBrowserSession(handler, 'unscoped-wallet-identity');
    const foreignOrgId = await createBrowserForeignAccount(
      handler,
      product.session,
      initialWalletToken,
    );
    const platformToken = await issueBrowserSession(handler, 'wallet-activation-owner');
    await page.context().addCookies([
      {
        name: 'activation-session',
        value: platformToken,
        url: platformUrl,
        httpOnly: true,
        sameSite: 'Lax',
      },
      {
        name: 'activation-session',
        value: initialWalletToken,
        url: appUrl,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const transport = new WalletConsoleBrowserTransport(
      new Map([
        [new URL(appUrl).origin, handler],
        [new URL(platformUrl).origin, platformHandler],
      ]),
    );
    await page.route('**/console/**', transport.handle.bind(transport));
    await page.route(
      'https://github.com/login/oauth/authorize?*',
      completeBrowserGithubAuthorization.bind(null, appUrl, 'wallet-activation-owner'),
    );
    await page.goto(new URL('/dashboard/account-settings', platformUrl).href);
    await expect(page.getByLabel('Account settings page')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Project services', exact: true })).toHaveCount(0);
    expect(await environmentCount(database, projectId)).toBe(0);
    expect(transport.enableRequests).toHaveLength(0);

    const originalAccount = page.getByRole('row').filter({ hasText: 'Automatic Wallet setup' });
    const secondAccount = page.getByRole('row').filter({ hasText: 'Second Wallet account' });
    await originalAccount.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(originalAccount).toContainText('Current');
    await secondAccount.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(secondAccount).toContainText('Current');
    await page.reload();
    await expect(secondAccount).toContainText('Current');
    await originalAccount.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(originalAccount).toContainText('Current');
    await page.reload();
    await expect(originalAccount).toContainText('Current');
    expect(transport.organizationSwitches).toEqual([secondOrgId, owner.orgId]);
    await page.screenshot({
      path: path.join(evidence, 'account-switch-reloaded.png'),
      fullPage: true,
    });

    const walletEntry = new URL('/dashboard/api-keys', appUrl);
    walletEntry.searchParams.set('db_org', owner.orgId);
    walletEntry.searchParams.set('db_project', projectId);
    walletEntry.searchParams.set('db_network', 'mainnet');
    await page.goto(walletEntry.href);
    await expect(
      page.getByRole('button', { name: 'Continue with GitHub', exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).origin).toBe(walletOrigin.origin);
    expect(transport.enableRequests).toHaveLength(0);
    expect(await environmentCount(database, projectId)).toBe(0);
    await page.screenshot({
      path: path.join(evidence, 'wallet-reauthentication.png'),
      fullPage: true,
    });

    // Reauthentication returns through a fixed callback with no selection parameters.
    // The first enable is durably accepted, but both its delivery and reply are lost.
    product.delivery.disconnect();
    await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Wallet setup unavailable' })).toBeVisible();
    expect(new URL(page.url()).origin).toBe(walletOrigin.origin);
    const callbackAccountHref = await page
      .getByRole('link', { name: 'Account settings', exact: true })
      .getAttribute('href');
    if (!callbackAccountHref) throw new Error('Wallet omitted the Platform account link');
    expect(new URL(callbackAccountHref).searchParams.get('db_network')).toBe('mainnet');
    expect(new URL(callbackAccountHref).searchParams.get('db_project')).toBe(projectId);
    expect(transport.authExchanges).toEqual([
      { status: 200, body: { ok: true, session: { kind: 'console_session_v1' } } },
    ]);
    expect(transport.enableRequests).toHaveLength(1);
    expect(await environmentCount(database, projectId)).toBe(0);
    product.delivery.reconnect();
    await page.reload();
    await expect.poll(environmentCount.bind(null, database, projectId)).toBe(3);
    await page.goto(new URL('/dashboard/api-keys', appUrl).href);
    await expect(
      page.getByRole('button', { name: 'Create credential', exact: true }),
    ).toBeVisible();
    expect(transport.enableRequests).toHaveLength(2);
    expect(transport.enableRequests[1]).toBe(transport.enableRequests[0]);
    expect(await environmentCount(database, projectId)).toBe(3);
    expect(await environmentCount(database, defaultProjectId)).toBe(0);
    expect(await environmentCount(database, secondProjectId)).toBe(0);
    const instances = await product.core.accountPlatform.listInstances(owner, projectId);
    expect(instances).toMatchObject({
      kind: 'accepted',
      value: [{ serviceId: 'wallet', state: { kind: 'active' } }],
    });
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Create credential', exact: true }),
    ).toBeVisible();
    expect(transport.enableRequests).toHaveLength(2);
    await page.screenshot({ path: path.join(evidence, 'wallet-ready.png'), fullPage: true });
    const accountLink = page.getByRole('link', { name: 'Account settings', exact: true });
    const accountHref = await accountLink.getAttribute('href');
    if (!accountHref) throw new Error('Wallet omitted the Platform account link');
    expect(new URL(accountHref).origin).toBe(new URL(platformUrl).origin);
    // A Wallet environment must not change the selected account authority.
    expect(new URL(accountHref).searchParams.get('db_network')).toBe('mainnet');
    expect(new URL(accountHref).searchParams.get('db_project')).toBe(projectId);
    await accountLink.click();
    await expect(page.getByLabel('Account settings page')).toBeVisible();
    await expect(page.getByRole('link', { name: 'API Keys', exact: true })).toHaveCount(0);
    expect(transport.enableRequests).toHaveLength(2);
    await page.screenshot({ path: path.join(evidence, 'platform-account.png'), fullPage: true });
    await page.goto(new URL('/dashboard/api-keys', appUrl).href);
    await expect(
      page.getByRole('button', { name: 'Create credential', exact: true }),
    ).toBeVisible();

    const secondWalletEntry = new URL('/dashboard/api-keys', appUrl);
    secondWalletEntry.searchParams.set('db_org', secondOrgId);
    secondWalletEntry.searchParams.set('db_project', secondProjectId);
    secondWalletEntry.searchParams.set('db_network', 'mainnet');
    // An incomplete account in the cookie must not redirect an owned-project link.
    const incompleteOrgId = 'account-without-projects';
    await product.core.account.createOrganization(ownerIdentity(), {
      id: incompleteOrgId,
      name: 'Account without projects',
    });
    await page.context().addCookies([
      {
        name: 'activation-session',
        value: await switchBrowserOrganization(handler, platformToken, incompleteOrgId),
        url: appUrl,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto(secondWalletEntry.href);
    await expect(page.getByRole('button', { name: 'Create credential', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    expect(await environmentCount(database, secondProjectId)).toBe(3);
    expect(transport.enableRequests).toHaveLength(3);

    const foreignEntry = new URL('/dashboard/api-keys', appUrl);
    foreignEntry.searchParams.set('db_org', foreignOrgId);
    foreignEntry.searchParams.set('db_project', defaultProjectId);
    foreignEntry.searchParams.set('db_network', 'mainnet');
    await page.goto(foreignEntry.href);
    await expect(
      page.getByRole('heading', { name: 'Unable to open this project', exact: true }),
    ).toBeVisible();
    expect(transport.enableRequests).toHaveLength(3);
    expect(await environmentCount(database, defaultProjectId)).toBe(0);
    // The fixed post-login entry must also show denied context instead of waiting forever.
    foreignEntry.pathname = '/dashboard';
    await page.goto(foreignEntry.href);
    await expect(
      page.getByRole('heading', { name: 'Unable to open this project', exact: true }),
    ).toBeVisible();
    expect(transport.enableRequests).toHaveLength(3);
    await page.screenshot({
      path: path.join(evidence, 'foreign-context-denied.png'),
      fullPage: true,
    });
    await page.goto(walletEntry.href);
    await expect(
      page.getByRole('button', { name: 'Create credential', exact: true }),
    ).toBeVisible();
    expect(transport.enableRequests).toHaveLength(3);

    const invitation = await product.core.organizationAccess.invite(owner, {
      email: 'invited@activation.invalid',
      role: 'MEMBER',
      projectAccess: [{ projectId, accessLevel: 'viewer' }],
    });
    const email = renderOrganizationInvitationEmailV1(
      buildOrganizationInvitationEmailV1({
        invitationId: invitation.invitation.id,
        organizationName: 'Automatic Wallet setup',
        inviterDisplayName: 'Activation owner',
        invitedRole: 'MEMBER',
        consoleBaseUrl: `${appUrl}?db_network=testnet`,
        expiresAt: invitation.invitation.expiresAt,
      }),
      invitation.token,
    );
    await writeFile(path.join(evidence, 'invitation-email.html'), email.html);
    const invitationHref = email.text.match(/Accept the invitation: (\S+)/)?.[1];
    if (!invitationHref) throw new Error('Invitation email omitted its acceptance link');
    expect(new URL(invitationHref).searchParams.get('db_network')).toBe('testnet');
    const anonymousAcceptance = await platformHandler.fetch(
      new Request(`${origin}/console/account/invitations/${invitation.invitation.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: invitation.token }),
      }),
    );
    expect(anonymousAcceptance.status).toBe(401);
    await page.goto(invitationHref);
    await expect(page.getByRole('heading', { name: 'Join your team', exact: true })).toBeVisible();
    expect(new URL(page.url()).origin).toBe(new URL(platformUrl).origin);
    expect(new URL(page.url()).searchParams.has('token')).toBe(false);
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('another email address');
    await page.screenshot({
      path: path.join(evidence, 'invitation-wrong-account.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Use another account', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Continue with GitHub', exact: true }),
    ).toBeVisible();
    await page.unroute('https://github.com/login/oauth/authorize?*');
    await page.route(
      'https://github.com/login/oauth/authorize?*',
      completeBrowserGithubAuthorization.bind(null, platformUrl, 'invited-platform-user'),
    );
    await page.goto(invitationHref);
    await page.getByRole('link', { name: 'Sign in to accept', exact: true }).click();
    await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Join your team', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Accept invitation', exact: true }),
    ).toBeVisible();
    expect(transport.authExchanges.at(-1)).toEqual({
      status: 200,
      body: { ok: true, session: { kind: 'console_identity_v1' } },
    });
    const badTokenLink = new URL(invitationHref);
    badTokenLink.hostname = new URL(platformUrl).hostname;
    badTokenLink.port = new URL(platformUrl).port;
    badTokenLink.searchParams.set('token', 'incorrect-invitation-token');
    await page.goto(badTokenLink.href);
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Invitation token is invalid');
    await page.goto(invitationHref);
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(page.getByLabel('Account settings page')).toBeVisible();
    const authorization = await product.core.organizationAccess.lookupAuthorization({
      orgId: owner.orgId,
      userId: 'invited-platform-user',
    });
    expect(authorization).toMatchObject({
      kind: 'authorized',
      role: 'MEMBER',
      projectAccess: { kind: 'assigned', assignments: [{ projectId, accessLevel: 'viewer' }] },
    });
    expect(await environmentCount(database, projectId)).toBe(3);
    expect(transport.enableRequests).toHaveLength(3);
    await page.screenshot({ path: path.join(evidence, 'invitation-accepted.png'), fullPage: true });
    await page.goto(invitationHref);
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Invitation is already accepted');
    const revoked = await product.core.organizationAccess.invite(owner, {
      email: 'revoked@activation.invalid',
      role: 'MEMBER',
      projectAccess: [{ projectId, accessLevel: 'viewer' }],
    });
    await product.core.organizationAccess.revokeInvitation(owner, revoked.invitation.id);
    const revokedHref = new URL('/dashboard/invitations/accept', platformUrl);
    revokedHref.searchParams.set('invitation_id', revoked.invitation.id);
    revokedHref.searchParams.set('token', revoked.token);
    await page.goto(revokedHref.href);
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Invitation is already revoked');
    await page.getByRole('button', { name: 'Go to console', exact: true }).click();
    await expect(page.getByLabel('Account settings page')).toBeVisible();
    await page.goto(walletEntry.href);
    await expect(
      page.getByRole('button', { name: 'Create credential', exact: true }),
    ).toBeVisible();

    const disabled = await changeService(
      product.router,
      token,
      projectId,
      'disable',
      'disable-auto',
      2,
    );
    expect(disabled.status).toBe(200);
    await page.reload();
    await expect(
      page.getByText('Wallet access is disabled for this project.', { exact: false }),
    ).toBeVisible();
    expect(transport.enableRequests).toHaveLength(3);
    await verifyFreshUserOnboarding({
      browser,
      database,
      appUrl,
      platformUrl,
      handlers: new Map([
        [new URL(appUrl).origin, handler],
        [new URL(platformUrl).origin, platformHandler],
      ]),
      evidence,
    });
    await writeFile(
      path.join(evidence, 'report.json'),
      JSON.stringify(
        {
          projectId,
          defaultProjectId,
          secondOrgId,
          secondProjectId,
          foreignContextDenied: true,
          ownedAccountSelectionPreserved: true,
          accountSettingsSwitchSurvivesReload: true,
          accountSettingsSwitchHasNoReverseRequest: true,
          incompleteAccountDoesNotOverrideRequestedAccount: true,
          reauthenticatedAfterUnscopedIdentity: true,
          networkPreservedAfterProviderCallback: true,
          developmentSelectionPreservesAccountNetwork: true,
          invitationAcceptance: {
            fixedProviderCallback: true,
            walletLinkRedirectsToPlatform: true,
            unscopedRecipientAccepted: true,
            anonymousRedemptionRejected: true,
            wrongAccountRejected: true,
            wrongTokenRejected: true,
            replayRejected: true,
            revokedInvitationRejected: true,
            assignedProjectAccessPreserved: true,
            walletProvisioningRequests: 0,
          },
          authExchanges: transport.authExchanges,
          defaultProjectEnvironments: await environmentCount(database, defaultProjectId),
          accountPageEnableRequests: 0,
          enableRequests: transport.enableRequests,
          environments: await environmentCount(database, projectId),
          disabledStatePreserved: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await page.context().tracing.stop({ path: path.join(evidence, 'trace.zip') });
    await frontend.close();
    await platform.close();
    await worker.dispose();
  }
}

test(
  'Separate consoles recover Wallet setup and redeem invitations for new teammates',
  verifyAutomaticWalletSetup,
);
