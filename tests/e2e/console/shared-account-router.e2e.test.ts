import { expect, test } from '@playwright/test';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { createD1ConsoleAccountService } from '../../../packages/console-server-ts/src/account/d1';
import { D1AccountPlatformService } from '../../../packages/console-server-ts/src/accountPlatform/d1';
import { createD1ConsoleAuditService } from '../../../packages/console-server-ts/src/audit/d1';
import { createD1ConsoleBillingService } from '../../../packages/console-server-ts/src/billing/d1';
import { D1BillingUsageService } from '../../../packages/console-server-ts/src/billing/usage';
import { createD1ConsoleBillingPrepaidReservationService } from '../../../packages/console-server-ts/src/billingPrepaidReservations/d1';
import { ConsoleSessionService } from '../../../packages/console-server-ts/src/boundary/session';
import type { D1DatabaseLike } from '../../../packages/console-server-ts/src/boundary/d1';
import { createInMemoryConsoleOnboardingService } from '../../../packages/console-server-ts/src/onboarding/service';
import { createD1ConsoleOrgProjectService } from '../../../packages/console-server-ts/src/orgProjectEnv/d1';
import { createAppSessionConsoleAuthAdapter } from '../../../packages/console-server-ts/src/router/consoleAppSessionAuth';
import {
  createAccountConsoleRouter,
  type AccountConsoleFetchHandler,
} from '../../../packages/console-server-ts/src/router/cloudflare/createAccountConsoleRouter';
import { createD1ConsoleOrganizationAccessService } from '../../../packages/console-server-ts/src/teamRbac/d1';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const evidenceDirectory = path.join(
  repository,
  '.artifacts/shared-account-platform/account-router',
);
const namespace = 'account-router-acceptance';
const invitationToken = 'account-router-invitation-secret';
const tokenSecret = 'isolated-account-router-session-secret';

function createRuntime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Account router acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { ACCOUNT_DB: 'account-router' },
    d1Persist: path.join(evidenceDirectory, 'state'),
  });
}

function isDatabase(input: unknown): input is D1DatabaseLike {
  return (
    typeof input === 'object' &&
    input !== null &&
    'prepare' in input &&
    typeof input.prepare === 'function' &&
    'batch' in input &&
    typeof input.batch === 'function' &&
    'exec' in input &&
    typeof input.exec === 'function'
  );
}

async function databaseFrom(runtime: Miniflare): Promise<D1DatabaseLike> {
  const database = await runtime.getD1Database('ACCOUNT_DB');
  if (!isDatabase(database)) throw new Error('Account D1 binding is unavailable');
  return database;
}

async function migrate(database: D1DatabaseLike): Promise<void> {
  const directory = path.join(repository, 'packages/console-server-ts/migrations/d1-console-core');
  for (const filename of (await readdir(directory)).sort()) {
    if (!filename.endsWith('.sql')) continue;
    const sql = await readFile(path.join(directory, filename), 'utf8');
    for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
  }
}

function signToken(input: { header: { typ: 'JWT' }; payload: Record<string, unknown> }): string {
  const payload = Buffer.from(JSON.stringify(input.payload)).toString('base64url');
  const signature = createHmac('sha256', tokenSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyToken(token: string): { valid: boolean; payload?: unknown } {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return { valid: false };
  const actual = Buffer.from(signature, 'base64url');
  const expected = createHmac('sha256', tokenSecret).update(payload).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return { valid: false };
  try {
    return { valid: true, payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) };
  } catch {
    return { valid: false };
  }
}

function setCookie(token: string): string {
  return `account-session=${token}; HttpOnly; Path=/`;
}
function clearCookie(): string {
  return 'account-session=; Max-Age=0; Path=/';
}
function ready(): void {}
function knownInvitationToken(): string {
  return invitationToken;
}
async function allowEmptyOrganizationDeletion(): Promise<void> {}

function createSession(): ConsoleSessionService {
  return new ConsoleSessionService({
    jwt: { signToken, verifyToken },
    cookie: { name: 'account-session', buildSetHeader: setCookie, buildClearHeader: clearCookie },
  });
}

async function composeAccountRouter(database: D1DatabaseLike) {
  const orgProjects = await createD1ConsoleOrgProjectService({
    database,
    namespace,
    ensureSchema: true,
  });
  const organizationAccess = await createD1ConsoleOrganizationAccessService({
    database,
    namespace,
    ensureSchema: true,
    createInvitationToken: knownInvitationToken,
  });
  const audit = await createD1ConsoleAuditService({ database, namespace });
  const billing = await createD1ConsoleBillingService({ database, namespace });
  const account = await createD1ConsoleAccountService({
    database,
    namespace,
    ensureSchema: true,
    orgProjectEnv: orgProjects,
    organizationAccess,
    deletion: { assertOrganizationCanBeDeleted: allowEmptyOrganizationDeletion },
  });
  const onboarding = createInMemoryConsoleOnboardingService({
    orgProjectEnv: orgProjects,
    organizationAccess,
  });
  const accountPlatform = new D1AccountPlatformService({ database, namespace, organizationAccess });
  await accountPlatform.ensureSchema();
  const funds = await createD1ConsoleBillingPrepaidReservationService({
    database,
    namespace,
    platform: accountPlatform,
    billing,
  });
  const billingUsage = new D1BillingUsageService({
    billing,
    database,
    namespace,
    funds,
    satyrTestPricing: { kind: 'disabled' },
  });
  await billingUsage.ensureSchema();
  const session = createSession();
  const auth = createAppSessionConsoleAuthAdapter({
    session,
    organizationAccess,
    provisioning: { orgProjectEnv: orgProjects, audit },
  });
  const router = createAccountConsoleRouter({
    services: {
      account,
      accountPlatform,
      audit,
      billing,
      funds,
      billingUsage,
      webhooks: null,
      onboarding,
      orgProjects,
      organizationAccess,
    },
    auth,
    session,
    readyCheck: ready,
    walletProvisioning: null,
    satyrProvisioning: null,
    billingStripeWebhookSigningSecret: null,
    corsOrigins: ['https://account.acceptance.invalid'],
  });
  return { router, session, orgProjects, organizationAccess, billing };
}

async function issueSession(
  session: ConsoleSessionService,
  userId: string,
  email: string,
  orgId: string,
): Promise<string> {
  return session.signJwt(userId, {
    kind: 'app_session_v1',
    appSessionVersion: 'account-router-acceptance-v1',
    orgId,
    email,
    provider: 'oidc',
    oidcProvider: 'google',
    oidcEmailVerified: true,
    environmentId: 'obsolete-wallet-selection',
  });
}

async function request(
  router: AccountConsoleFetchHandler,
  token: string,
  route: string,
  method = 'GET',
  body: unknown = null,
): Promise<Response> {
  return router(
    new Request(`https://account.acceptance.invalid${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://account.acceptance.invalid',
        'Content-Type': 'application/json',
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function recordUiFixture(router: AccountConsoleFetchHandler, token: string): Promise<void> {
  const directory = path.join(evidenceDirectory, 'ui-fixture');
  await mkdir(directory, { recursive: true });
  const routes = [
    { filename: 'session.json', route: '/console/session' },
    { filename: 'organizations.json', route: '/console/account/organizations' },
    { filename: 'projects.json', route: '/console/projects' },
    { filename: 'onboarding.json', route: '/console/onboarding/state' },
    { filename: 'services.json', route: '/console/projects/project_account_only/services' },
  ];
  for (const entry of routes) {
    const response = await request(router, token, entry.route);
    expect(response.status).toBe(200);
    await writeFile(
      path.join(directory, entry.filename),
      `${JSON.stringify(await response.json(), null, 2)}\n`,
    );
  }
}

function object(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error('Expected a response object');
  return input as Record<string, unknown>;
}

function text(input: unknown): string {
  if (typeof input !== 'string' || !input) throw new Error('Expected a response identifier');
  return input;
}

test('account-only routes preserve project access, rotate scope, and revoke an active session after restart', async () => {
  await rm(evidenceDirectory, { recursive: true, force: true });
  await mkdir(evidenceDirectory, { recursive: true });
  let runtime = createRuntime();
  try {
    let database = await databaseFrom(runtime);
    await migrate(database);
    const first = await composeAccountRouter(database);
    await first.orgProjects.upsertOrganization(
      { orgId: 'org_account_owner', actorUserId: 'owner' },
      { name: 'Account owner' },
    );
    await first.organizationAccess.bootstrapInitialOwner({
      orgId: 'org_account_owner',
      userId: 'owner',
      email: 'owner@acceptance.invalid',
      displayName: 'Owner',
    });
    await first.orgProjects.upsertOrganization(
      { orgId: 'org_account_member', actorUserId: 'member' },
      { name: 'Member account' },
    );
    await first.organizationAccess.bootstrapInitialOwner({
      orgId: 'org_account_member',
      userId: 'member',
      email: 'member@acceptance.invalid',
      displayName: 'Member',
    });
    const ownerToken = await issueSession(
      first.session,
      'owner',
      'owner@acceptance.invalid',
      'org_account_owner',
    );
    const memberHomeToken = await issueSession(
      first.session,
      'member',
      'member@acceptance.invalid',
      'org_account_member',
    );
    const sessionResponse = await request(first.router, ownerToken, '/console/session');
    expect(sessionResponse.status).toBe(200);
    const claims = object(object(await sessionResponse.json()).claims);
    expect(claims).not.toHaveProperty('environmentId');
    await first.billing.grantManualSupportCredit(
      { orgId: 'org_account_owner', actorUserId: 'owner' },
      {
        amountMinor: 500,
        reasonCode: 'account_router_acceptance',
        note: 'Isolated account acceptance credit',
        idempotencyKey: 'account-router-support-credit',
      },
    );
    const checkout = await request(
      first.router,
      ownerToken,
      '/console/billing/stripe/checkout-session',
      'POST',
      { creditPackId: 'usd_10' },
    );
    expect(checkout.status).toBe(201);
    const checkoutId = text(object(object(await checkout.json()).checkoutSession).id);
    const reconciled = await request(
      first.router,
      ownerToken,
      '/console/billing/stripe/checkout-session/reconcile',
      'POST',
      { checkoutSessionId: checkoutId },
    );
    expect(reconciled.status, await reconciled.clone().text()).toBe(200);
    const purchase = object(object(await reconciled.json()).result);
    expect(purchase.settledNow).toBe(true);
    const replayed = await request(
      first.router,
      ownerToken,
      '/console/billing/stripe/checkout-session/reconcile',
      'POST',
      { checkoutSessionId: checkoutId },
    );
    expect(object(object(await replayed.json()).result).settledNow).toBe(false);
    const billingOverview = await request(first.router, ownerToken, '/console/billing/overview');
    expect(object(object(await billingOverview.json()).overview).creditBalanceMinor).toBe(1500);
    const receiptId = text(object(purchase.invoice).id);
    const receiptPath = `/console/billing/invoices/${encodeURIComponent(receiptId)}`;
    expect((await request(first.router, ownerToken, receiptPath)).status).toBe(200);
    expect((await request(first.router, ownerToken, `${receiptPath}/activity`)).status).toBe(200);
    expect((await request(first.router, ownerToken, `${receiptPath}/line-items`)).status).toBe(200);
    const receiptPdf = await request(first.router, ownerToken, `${receiptPath}/pdf`);
    expect(receiptPdf.status).toBe(200);
    expect(receiptPdf.headers.get('Content-Type')).toBe('application/pdf');
    const pdfBytes = Buffer.from(await receiptPdf.arrayBuffer());
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
    await writeFile(path.join(evidenceDirectory, 'purchase-receipt.pdf'), pdfBytes);
    const receiptDigest = createHash('sha256').update(pdfBytes).digest('hex');

    const created = await request(first.router, ownerToken, '/console/onboarding/project', 'POST', {
      project: { id: 'project_account_only', name: 'Account only project' },
    });
    expect(created.status).toBe(201);
    const projectResult = object(object(await created.json()).result);
    expect(projectResult).not.toHaveProperty('environment');
    const stateResponse = await request(first.router, ownerToken, '/console/onboarding/state');
    const state = object(object(await stateResponse.json()).state);
    expect(state.onboardingComplete).toBe(true);
    await recordUiFixture(first.router, ownerToken);
    expect(state).not.toHaveProperty('selectedEnvironmentId');
    expect((await request(first.router, ownerToken, '/console/environments')).status).toBe(404);
    const noServiceResponse = await request(
      first.router,
      ownerToken,
      '/console/projects/project_account_only/services',
    );
    expect(noServiceResponse.status).toBe(200);
    expect(object(await noServiceResponse.json()).instances).toEqual([]);
    expect(
      (
        await request(
          first.router,
          ownerToken,
          '/console/projects/project_account_only/services/wallet/enable',
          'POST',
          { operationId: 'unavailable-wallet-enable', desiredRevision: 1 },
        )
      ).status,
    ).toBe(409);

    const invited = await request(
      first.router,
      ownerToken,
      '/console/organization/invitations',
      'POST',
      {
        email: 'member@acceptance.invalid',
        role: 'MEMBER',
        projectAccess: [{ projectId: 'project_account_only', accessLevel: 'viewer' }],
      },
    );
    expect(invited.status).toBe(201);
    const invitation = object(object(await invited.json()).invitation);
    const invitationId = text(invitation.id);
    const accepted = await request(
      first.router,
      memberHomeToken,
      `/console/account/invitations/${invitationId}/accept`,
      'POST',
      { token: invitationToken },
    );
    expect(accepted.status).toBe(200);
    const membershipId = text(object(object(await accepted.json()).membership).id);
    const memberToken = await issueSession(
      first.session,
      'member',
      'member@acceptance.invalid',
      'org_account_owner',
    );
    const memberProjects = await request(first.router, memberToken, '/console/projects');
    expect(memberProjects.status).toBe(200);
    expect(object(await memberProjects.json()).projects).toHaveLength(1);
    expect((await request(first.router, memberToken, '/console/billing/overview')).status).toBe(
      403,
    );
    expect(
      (
        await request(first.router, memberToken, '/console/projects', 'POST', {
          name: 'Forbidden project',
        })
      ).status,
    ).toBe(403);

    const newOrganization = await request(
      first.router,
      ownerToken,
      '/console/account/organizations',
      'POST',
      { name: 'Second account organization' },
    );
    expect(newOrganization.status).toBe(201);
    const newOrganizationId = text(object(object(await newOrganization.json()).organization).id);
    const switched = await request(
      first.router,
      ownerToken,
      `/console/account/organizations/${newOrganizationId}/switch-context`,
      'POST',
      {},
    );
    expect(switched.status).toBe(200);
    expect(object(object(await switched.json()).context)).not.toHaveProperty('environmentId');
    expect(switched.headers.get('Set-Cookie')).toContain('account-session=');

    await runtime.dispose();
    runtime = createRuntime();
    database = await databaseFrom(runtime);
    const restarted = await composeAccountRouter(database);
    const persistedOverview = await request(
      restarted.router,
      ownerToken,
      '/console/billing/overview',
    );
    expect(object(object(await persistedOverview.json()).overview).creditBalanceMinor).toBe(1500);
    expect((await request(restarted.router, memberToken, '/console/projects')).status).toBe(200);
    const suspensions = await Promise.all([
      request(
        restarted.router,
        ownerToken,
        `/console/organization/memberships/${membershipId}/suspend`,
        'POST',
        {},
      ),
      request(
        restarted.router,
        ownerToken,
        `/console/organization/memberships/${membershipId}/suspend`,
        'POST',
        {},
      ),
    ]);
    const suspensionStatuses = suspensions.map(responseStatus).sort();
    expect(suspensionStatuses).toEqual([200, 409]);
    let suspension = suspensions[0];
    if (suspension.status !== 200) suspension = suspensions[1];
    const suspendedMembership = await database
      .prepare('SELECT kind FROM organization_memberships WHERE namespace = ? AND id = ?')
      .bind(namespace, membershipId)
      .first<{ kind: string }>();
    await writeFile(
      path.join(evidenceDirectory, 'suspension.json'),
      `${JSON.stringify({ status: suspension.status, response: await suspension.clone().json(), persistedMembership: suspendedMembership, competingRequestStatuses: suspensionStatuses }, null, 2)}\n`,
    );
    expect(suspension.status, await suspension.clone().text()).toBe(200);
    const revoked = await request(restarted.router, memberToken, '/console/projects');
    expect(revoked.status).toBe(403);
    const tables = await database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all<{ name: string }>();
    const tableNames = (tables.results ?? []).map(tableName);
    const environmentCount = await database
      .prepare('SELECT COUNT(*) AS count FROM environments')
      .first<{ count: number }>();
    const apiKeyCount = await database
      .prepare('SELECT COUNT(*) AS count FROM api_keys')
      .first<{ count: number }>();
    expect(environmentCount?.count).toBe(0);
    expect(apiKeyCount?.count).toBe(0);
    const report = {
      version: 1,
      scenario: 'account-only HTTP composition with durable access revocation',
      organizationId: 'org_account_owner',
      projectId: 'project_account_only',
      membershipId,
      newOrganizationId,
      accountSessionOmitsEnvironment: true,
      accountOnboardingCompleteWithoutWallet: true,
      walletEnvironmentRouteStatus: 404,
      walletEnableWithoutAdapterStatus: 409,
      viewerProjectCreationStatus: 403,
      suspendedSessionStatus: revoked.status,
      postedBalanceMinorAfterRestart: 1500,
      purchaseReceipt: {
        invoiceId: receiptId,
        sha256: receiptDigest,
        filename: 'purchase-receipt.pdf',
      },
      competingSuspensionStatuses: suspensionStatuses,
      persistedTables: tableNames,
    };
    await writeFile(
      path.join(evidenceDirectory, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } finally {
    await runtime.dispose();
  }
});

function tableName(row: { name: string }): string {
  return row.name;
}

function responseStatus(response: Response): number {
  return response.status;
}
