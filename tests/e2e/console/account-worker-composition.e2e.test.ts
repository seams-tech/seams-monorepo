import { expect, test, type TestInfo } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import type { D1DatabaseLike } from '../../../packages/console-server-ts/src/boundary/d1';
import { createCloudflareD1AccountServiceBundle } from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { createHmacSessionAdapter } from '../../../packages/wallet-console-server-ts/src/router/cloudflare/d1StagingSession';
import {
  createAesGcmConsoleWebhookSecretCipher,
  createD1ConsoleWebhookService,
} from '../../../packages/console-server-ts/src/webhooks/d1';
import { WALLET_CONSOLE_WEBHOOK_EVENT_CATEGORY_VALIDATION } from '../../../packages/wallet-console-shared-ts/src/webhookEventCategories';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/p2-console-review/account-composition');
const namespace = 'p2-account-worker';
const owner = { orgId: 'p2-account', actorUserId: 'google:p2-owner' };
const sessionSecret = 'p2-account-composition-session-secret';
const webhookKey = new Uint8Array(32).fill(8);

test(
  'both Workers serve accounts without Wallet or payment config and preserve canonical billing effects',
  accountWorkerJourney,
);

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid acceptance response');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Acceptance text missing');
  return value;
}

async function buildWorker(name: 'hosted' | 'local'): Promise<string> {
  const directory = path.join(output, name);
  await mkdir(directory, { recursive: true });
  const source = name === 'hosted' ? 'd1ConsoleStagingWorker' : 'd1LocalDevWorker';
  const config = path.join(directory, 'build.json');
  await writeFile(
    config,
    JSON.stringify({
      name: `p2-account-${name}`,
      main: path.join(
        repository,
        `packages/wallet-console-server-ts/src/router/cloudflare/${source}.ts`,
      ),
      compatibility_date: '2026-07-17',
      compatibility_flags: ['nodejs_compat'],
    }),
  );
  const result = spawnSync(
    'pnpm',
    ['exec', 'wrangler', 'deploy', '--dry-run', '--config', config, '--outdir', directory],
    {
      cwd: repository,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
        WRANGLER_SEND_METRICS: 'false',
      },
    },
  );
  if (result.status !== 0) throw new Error(`Worker build failed: ${result.stderr}`);
  return path.join(directory, `${source}.js`);
}

class PaymentEndpoints {
  readonly requests: string[] = [];
  readonly webhookEvents: string[] = [];
  private checkout: Record<string, unknown> | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.requests.push(`${request.method} ${url.pathname}`);
    if (url.hostname === 'hooks.acceptance.invalid') {
      this.webhookEvents.push(text(object(await request.json()).type));
      return new Response('accepted');
    }
    if (url.hostname !== 'api.stripe.com') throw new Error('Unexpected outbound request');
    if (url.pathname === '/v1/customers') return Response.json({ id: 'cus_p2' });
    if (url.pathname === '/v1/checkout/sessions' && request.method === 'POST') {
      const form = new URLSearchParams(await request.text());
      this.checkout = {
        id: 'cs_p2',
        url: 'https://checkout.stripe.com/p2',
        customer: 'cus_p2',
        payment_intent: 'pi_p2',
        payment_status: 'paid',
        status: 'complete',
        amount_total: 1000,
        currency: 'usd',
        client_reference_id: form.get('client_reference_id'),
        metadata: {
          org_id: form.get('metadata[org_id]'),
          purchase_id: form.get('metadata[purchase_id]'),
          credit_pack_id: form.get('metadata[credit_pack_id]'),
        },
      };
      return Response.json(this.checkout);
    }
    if (url.pathname === '/v1/checkout/sessions/cs_p2' && this.checkout !== null)
      return Response.json(this.checkout);
    if (url.pathname === '/v1/refunds') return Response.json({ id: 're_p2', status: 'succeeded' });
    throw new Error(`Unexpected Stripe route: ${url.pathname}`);
  }
}

function call(
  worker: Awaited<ReturnType<Miniflare['getWorker']>>,
  token: string,
  route: string,
  body: unknown = null,
): ReturnType<Awaited<ReturnType<Miniflare['getWorker']>>['fetch']> {
  return worker.fetch(`https://account.acceptance.invalid${route}`, {
    method: body === null ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
}

async function migrate(database: D1DatabaseLike): Promise<void> {
  const directory = path.join(
    repository,
    'packages/wallet-console-server-ts/migrations/d1-console',
  );
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    for (const sql of unstable_splitSqlQuery(await readFile(path.join(directory, name), 'utf8')))
      await database.prepare(sql).run();
  }
}

async function accountWorkerJourney(
  { browserName: _browserName }: { browserName: string },
  info: TestInfo,
): Promise<void> {
  info.setTimeout(120000);
  const hosted = await buildWorker('hosted');
  const local = await buildWorker('local');
  const providers = new PaymentEndpoints();
  const bindings = {
    SEAMS_TENANT_STORAGE_NAMESPACE: namespace,
    CONSOLE_SESSION_HMAC_SECRET: sessionSecret,
    CONSOLE_SESSION_ISSUER: 'p2-account',
    CONSOLE_SESSION_AUDIENCE: 'p2-account',
    CONSOLE_BASE_URL: 'https://account.acceptance.invalid',
    CONSOLE_PLATFORM_SUPPORT_EMAILS: 'owner@p2.invalid',
    CONSOLE_WEBHOOK_SECRET_KEY_ID: 'p2-webhooks',
    CONSOLE_WEBHOOK_SECRET_KEY_B64U: Buffer.from(webhookKey).toString('base64url'),
    SEAMS_WALLET_HOME_CATALOG_JSON: 'invalid-wallet-config',
    TENANT_ROOT_GRANT_AUTHORITY_SIGNING_SEED: 'invalid-wallet-config',
  };
  const runtime = new Miniflare({
    workers: [
      {
        name: 'hosted-missing',
        modules: true,
        modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
        scriptPath: hosted,
        modulesRoot: path.dirname(hosted),
        compatibilityDate: '2026-07-17',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { CONSOLE_DB: namespace },
        bindings,
        outboundService: providers.fetch.bind(providers),
      },
      {
        name: 'hosted-invalid',
        modules: true,
        modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
        scriptPath: hosted,
        modulesRoot: path.dirname(hosted),
        compatibilityDate: '2026-07-17',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { CONSOLE_DB: namespace },
        bindings: { ...bindings, STRIPE_API_SK: 'pk_invalid' },
        outboundService: providers.fetch.bind(providers),
      },
      {
        name: 'local-invalid',
        modules: true,
        modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
        scriptPath: local,
        modulesRoot: path.dirname(local),
        compatibilityDate: '2026-07-17',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { CONSOLE_DB: namespace },
        bindings: { ...bindings, STRIPE_API_SK: 'pk_invalid' },
        outboundService: providers.fetch.bind(providers),
      },
      {
        name: 'hosted-payments',
        modules: true,
        modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
        scriptPath: hosted,
        modulesRoot: path.dirname(hosted),
        compatibilityDate: '2026-07-17',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { CONSOLE_DB: namespace },
        bindings: { ...bindings, STRIPE_API_SK: 'sk_test_isolated' },
        outboundService: providers.fetch.bind(providers),
      },
    ],
  });
  try {
    const database = await runtime.getD1Database('CONSOLE_DB', 'hosted-missing');
    if (!isD1DatabaseLike(database)) throw new Error('Acceptance D1 missing');
    await migrate(database);
    const core = await createCloudflareD1AccountServiceBundle({
      database,
      namespace,
      ensureSchema: false,
      externalDeletionGuard: null,
    });
    await core.orgProjects.upsertOrganization(owner, { name: 'P2 account acceptance' });
    await core.organizationAccess.bootstrapInitialOwner({
      orgId: owner.orgId,
      userId: owner.actorUserId,
      email: 'owner@p2.invalid',
      displayName: 'P2 owner',
    });
    const session = createHmacSessionAdapter({
      secret: sessionSecret,
      issuer: 'p2-account',
      audience: 'p2-account',
    });
    const token = await session.signJwt(owner.actorUserId, {
      kind: 'console_session_v1',
      orgId: owner.orgId,
      email: 'owner@p2.invalid',
      provider: 'oidc',
    });
    const statuses: Record<string, unknown> = {};
    for (const name of ['hosted-missing', 'hosted-invalid', 'local-invalid']) {
      const worker = await runtime.getWorker(name);
      for (const route of [
        '/console/healthz',
        '/console/readyz',
        '/console/session',
        '/console/account/profile',
        '/console/billing/overview',
      ]) {
        const response = await call(worker, token, route);
        expect(response.status, `${name} ${route}: ${await response.clone().text()}`).toBe(200);
      }
      const denied = await call(worker, token, '/console/billing/stripe/checkout-session', {
        creditPackId: 'usd_10',
      });
      expect(denied.status, await denied.clone().text()).toBe(503);
      expect(await denied.json()).toMatchObject({ code: 'payment_provider_unavailable' });
      const invitation = await call(worker, token, '/console/organization/invitations', {
        email: 'invitee@p2.invalid',
        role: 'ADMIN',
        adminPermissions: ['billing.view'],
      });
      expect(invitation.status, await invitation.clone().text()).toBe(503);
      statuses[name] = { account: 200, checkout: denied.status, invitation: invitation.status };
    }
    expect(providers.requests).toEqual([]);
    expect(
      await database
        .prepare('SELECT COUNT(*) AS count FROM billing_credit_purchases')
        .first('count'),
    ).toBe(0);
    expect(
      await database
        .prepare('SELECT COUNT(*) AS count FROM organization_invitations')
        .first('count'),
    ).toBe(0);

    const webhooks = await createD1ConsoleWebhookService({
      database,
      namespace,
      ensureSchema: false,
      categoryValidation: WALLET_CONSOLE_WEBHOOK_EVENT_CATEGORY_VALIDATION,
      secretCipher: createAesGcmConsoleWebhookSecretCipher({
        keyId: 'p2-webhooks',
        keyBytes: webhookKey,
      }),
    });
    await webhooks.createEndpoint(owner, {
      url: 'https://hooks.acceptance.invalid/events',
      eventCategories: ['BILLING'],
    });
    const worker = await runtime.getWorker('hosted-payments');
    const checkout = await call(worker, token, '/console/billing/stripe/checkout-session', {
      creditPackId: 'usd_10',
    });
    expect(checkout.status, await checkout.clone().text()).toBe(201);
    const purchaseId = text(object(object(await checkout.json()).checkoutSession).purchaseId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        (
          await call(worker, token, '/console/billing/stripe/checkout-session/reconcile', {
            checkoutSessionId: 'cs_p2',
          })
        ).status,
      ).toBe(200);
    }
    const support = await call(
      worker,
      token,
      '/console/platform/billing/adjustments/support-credit',
      {
        orgId: owner.orgId,
        amountMinor: 10000,
        reasonCode: 'p2_acceptance',
        note: 'Acceptance support adjustment',
        idempotencyKey: 'p2-support-credit',
      },
    );
    expect(support.status, await support.clone().text()).toBe(201);
    const overview = object(
      object(await (await call(worker, token, '/console/billing/overview')).json()).overview,
    );
    expect(overview.creditBalanceMinor).toBe(11000);
    expect(overview).toHaveProperty('trailing30DaySponsoredSpendMinor', 0);
    expect(
      (await call(worker, token, `/console/platform/billing/account?orgId=${owner.orgId}`)).status,
    ).toBe(200);
    expect(providers.webhookEvents).toContain('billing.balance.recovered');
    const refused = await call(
      await runtime.getWorker('hosted-invalid'),
      token,
      '/console/platform/billing/refunds',
      {
        orgId: owner.orgId,
        purchaseId,
        amountMinor: 100,
        reason: 'Acceptance refund',
        idempotencyKey: 'p2-invalid-refund',
      },
    );
    expect(refused.status).toBe(503);
    expect(
      await database.prepare('SELECT COUNT(*) AS count FROM billing_refunds').first('count'),
    ).toBe(0);
    const refund = await call(worker, token, '/console/platform/billing/refunds', {
      orgId: owner.orgId,
      purchaseId,
      amountMinor: 100,
      reason: 'Acceptance refund',
      idempotencyKey: 'p2-real-refund',
    });
    expect(refund.status, await refund.clone().text()).toBe(201);
    expect(
      object(
        await (
          await call(worker, token, `/console/platform/billing/account?orgId=${owner.orgId}`)
        ).json(),
      ),
    ).toHaveProperty('result');
    const evidence = {
      passed: true,
      statuses,
      creditBeforeRefundMinor: overview.creditBalanceMinor,
      providerRequests: providers.requests,
      webhookEvents: providers.webhookEvents,
      checks: [
        'account reads without Wallet bindings',
        'missing and malformed payment config refuses mutations',
        'invitation encryption unavailable leaves no invitation',
        'no implicit simulated credits or refunds',
        'one payment settlement on replay',
        'support billing routes preserved',
        'Wallet summary and balance notifications preserved',
      ],
    };
    const artifact = path.join(output, 'acceptance.json');
    await writeFile(artifact, JSON.stringify(evidence, null, 2));
    await info.attach('account-worker-composition', {
      path: artifact,
      contentType: 'application/json',
    });
  } finally {
    await runtime.dispose();
  }
}
