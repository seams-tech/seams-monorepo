import { expect, test } from '@playwright/test';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createD1ConsoleAccountService } from '../../../packages/console-server-ts/src/account/d1';
import type {
  AccountOrganizationDeletionPort,
  ConsoleAccountIdentityContext,
} from '../../../packages/console-server-ts/src/account/service';
import { ConsoleSessionService } from '../../../packages/console-server-ts/src/boundary/session';
import type { ConsoleSessionJwtHooks } from '../../../packages/console-server-ts/src/boundary/session';
import type { D1DatabaseLike } from '../../../packages/console-server-ts/src/boundary/d1';
import { parseCreateConsoleOnboardingProjectRequest } from '../../../packages/console-server-ts/src/onboarding/requests';
import { createCloudflareD1AccountServiceBundle } from '../../../packages/console-server-ts/src/router/cloudflare/d1AccountServices';
import { createAppSessionConsoleAuthAdapter } from '../../../packages/console-server-ts/src/router/consoleAppSessionAuth';
import { buildConsoleContextSwitchSessionClaims } from '../../../packages/console-server-ts/src/router/consoleSessionContext';
import type { ConsoleBillingService } from '../../../packages/console-server-ts/src/billing/service';
import {
  ServiceProvisionCommandV1,
  type PlatformResult,
} from '../../../packages/console-shared-ts/src/accountPlatform';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/onboarding');
const namespace = 'shared-account-onboarding-v1';
const sessionSecret = 'isolated-account-onboarding-acceptance-secret';

function now(): Date {
  return new Date('2026-10-13T00:00:00.000Z');
}

function runtime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Account onboarding acceptance"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: 'account-onboarding' },
    d1Persist: path.join(output, 'state'),
  });
}

async function databaseFor(worker: Miniflare): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database('CONSOLE_DB');
  if (!isD1DatabaseLike(database)) throw new Error('Account D1 binding is unavailable');
  return database;
}

async function migrate(database: D1DatabaseLike): Promise<readonly string[]> {
  const directory = path.join(repository, 'packages/console-server-ts/migrations/d1-console-core');
  const applied: string[] = [];
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    const sql = await readFile(path.join(directory, name), 'utf8');
    for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
    applied.push(name);
  }
  return applied;
}

function signSessionToken(input: Parameters<ConsoleSessionJwtHooks['signToken']>[0]): string {
  const header = Buffer.from(JSON.stringify(input.header)).toString('base64url');
  const payload = Buffer.from(JSON.stringify(input.payload)).toString('base64url');
  const content = `${header}.${payload}`;
  const signature = createHmac('sha256', sessionSecret).update(content).digest('base64url');
  return `${content}.${signature}`;
}

function verifySessionToken(token: string): { valid: boolean; payload?: unknown } {
  const [header, payload, signature, excess] = token.split('.');
  if (!header || !payload || !signature || excess) return { valid: false };
  const expected = createHmac('sha256', sessionSecret).update(`${header}.${payload}`).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
    return { valid: false };
  }
  return { valid: true, payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) };
}

function buildSetHeader(token: string): string {
  return `account-session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

function buildClearHeader(): string {
  return 'account-session=; Max-Age=0; Path=/';
}

function sessions(): ConsoleSessionService {
  return new ConsoleSessionService({
    jwt: { signToken: signSessionToken, verifyToken: verifySessionToken },
    cookie: { name: 'account-session', buildSetHeader, buildClearHeader },
  });
}

function ownerContext(orgId: string | null): ConsoleAccountIdentityContext {
  if (orgId === null) {
    return {
      userId: 'owner-onboarding',
      email: 'owner@onboarding.invalid',
      name: 'Account owner',
      provider: 'oidc',
      platformSupport: false,
      orgId: null,
      projectId: null,
    };
  }
  return {
    userId: 'owner-onboarding',
    email: 'owner@onboarding.invalid',
    name: 'Account owner',
    provider: 'oidc',
    platformSupport: false,
    orgId,
    projectId: null,
  };
}

async function compose(database: D1DatabaseLike) {
  const services = await createCloudflareD1AccountServiceBundle({
    database,
    namespace,
    now,
    ensureSchema: true,
    externalDeletionGuard: null,
  });
  return {
    projects: services.orgProjects,
    access: services.organizationAccess,
    onboarding: services.onboarding,
    account: services.account,
    billing: services.billing,
    platform: services.accountPlatform,
  };
}

async function operationalCounts(database: D1DatabaseLike) {
  const tables = await database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('environments', 'api_keys', 'wallet_index')",
    )
    .all<{ name: string }>();
  const names = new Set<string>();
  for (const table of tables.results ?? []) names.add(table.name);
  const environments = names.has('environments')
    ? await database
        .prepare('SELECT COUNT(*) AS count FROM environments WHERE namespace = ?')
        .bind(namespace)
        .first<{ count: number }>()
    : null;
  const apiKeys = names.has('api_keys')
    ? await database
        .prepare('SELECT COUNT(*) AS count FROM api_keys WHERE namespace = ?')
        .bind(namespace)
        .first<{ count: number }>()
    : null;
  const wallets = names.has('wallet_index')
    ? await database
        .prepare('SELECT COUNT(*) AS count FROM wallet_index WHERE namespace = ?')
        .bind(namespace)
        .first<{ count: number }>()
    : null;
  return {
    environments: environments?.count ?? 0,
    apiKeys: apiKeys?.count ?? 0,
    wallets: wallets?.count ?? 0,
  };
}

function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}

class BillingDuringDeletion implements AccountOrganizationDeletionPort {
  constructor(private readonly billing: ConsoleBillingService) {}

  async assertOrganizationCanBeDeleted(ctx: { orgId: string; actorUserId: string }): Promise<void> {
    expect((await this.billing.getOverview(ctx)).creditBalanceMinor).toBe(0);
    await this.billing.grantManualSupportCredit(ctx, {
      amountMinor: 100,
      reasonCode: 'concurrent_deletion_acceptance',
      note: 'Accepted money arrives after the deletion precheck',
      idempotencyKey: 'accepted-while-deletion-starts',
    });
  }
}

class ProvisioningDuringDeletion implements AccountOrganizationDeletionPort {
  constructor(private readonly database: D1DatabaseLike) {}

  async assertOrganizationCanBeDeleted(ctx: { orgId: string; actorUserId: string }): Promise<void> {
    await this.database
      .prepare(
        `UPDATE platform_service_instances SET desired_revision = desired_revision + 1,
         phase = 'provisioning' WHERE namespace = ? AND org_id = ?`,
      )
      .bind(namespace, ctx.orgId)
      .run();
  }
}

async function verifyDeletion(
  database: D1DatabaseLike,
  services: Awaited<ReturnType<typeof compose>>,
) {
  const selectedAccount = ownerContext('org_account_a');
  const empty = await services.account.createOrganization(selectedAccount, {
    id: 'org_empty_delete',
    name: 'Empty account',
  });
  const emptyContext = { orgId: empty.id, actorUserId: selectedAccount.userId };
  await services.projects.createProject(emptyContext, {
    id: 'project_empty_delete',
    name: 'Empty platform project',
  });
  accepted(await services.platform.bindProjectBilling(emptyContext, 'project_empty_delete'));
  await services.billing.getOverview(emptyContext);
  await expect(
    database
      .prepare(
        "DELETE FROM organization_memberships WHERE namespace = ? AND org_id = ? AND role = 'OWNER'",
      )
      .bind(namespace, empty.id)
      .run(),
  ).rejects.toThrow('last_owner_required');
  expect(await services.account.deleteOrganization(selectedAccount, empty.id)).toEqual({
    orgId: empty.id,
    organizationName: empty.name,
  });
  expect(
    await services.access.lookupAuthorization({ orgId: empty.id, userId: selectedAccount.userId }),
  ).toBeNull();
  const leftovers = await database
    .prepare(
      'SELECT 1 AS retained FROM organization_billing_accounts WHERE namespace = ?1 AND org_id = ?2 UNION ALL SELECT 1 FROM billing_accounts WHERE namespace = ?1 AND org_id = ?2 UNION ALL SELECT 1 FROM project_billing_bindings WHERE namespace = ?1 AND org_id = ?2',
    )
    .bind(namespace, empty.id)
    .all();
  expect(leftovers.results).toEqual([]);

  const retained = await services.account.createOrganization(selectedAccount, {
    id: 'org_instance_delete',
    name: 'Retained service account',
  });
  const retainedContext = { orgId: retained.id, actorUserId: selectedAccount.userId };
  await services.projects.createProject(retainedContext, {
    id: 'project_instance_delete',
    name: 'Pending service',
  });
  const scope = accepted(
    await services.platform.bindProjectBilling(retainedContext, 'project_instance_delete'),
  );
  const command = accepted(
    ServiceProvisionCommandV1.parse({
      version: 1,
      instanceId: 'instance_retained_delete',
      operationId: 'operation_retained_delete',
      desiredRevision: 1,
      command: 'enable',
      binding: {
        kind: 'create_native_scope',
        serviceId: 'satyr',
        parent: scope,
        configuration: {
          deploymentId: 'isolated-satyr',
          placementCellId: 'acceptance-apac',
          environment: 'development',
        },
      },
    }),
  );
  accepted(await services.platform.requestProvision(retainedContext, { scope, command }));
  await expect(
    services.account.deleteOrganization(selectedAccount, retained.id),
  ).rejects.toMatchObject({ code: 'organization_delete_has_service_instances' });
  expect(
    await services.access.lookupAuthorization({
      orgId: retained.id,
      userId: selectedAccount.userId,
    }),
  ).toMatchObject({ kind: 'authorized', role: 'OWNER' });

  const provisioningRace = await createD1ConsoleAccountService({
    database,
    namespace,
    now,
    orgProjectEnv: services.projects,
    organizationAccess: services.access,
    deletion: new ProvisioningDuringDeletion(database),
  });
  await expect(
    provisioningRace.deleteOrganization(selectedAccount, retained.id),
  ).rejects.toMatchObject({
    code: 'organization_delete_scope_changed',
    status: 409,
  });
  expect(
    await database
      .prepare(
        'SELECT desired_revision FROM platform_service_instances WHERE namespace = ? AND id = ?',
      )
      .bind(namespace, 'instance_retained_delete')
      .first<number>('desired_revision'),
  ).toBe(2);

  const racing = await services.account.createOrganization(selectedAccount, {
    id: 'org_billing_delete',
    name: 'Accepted billing account',
  });
  const racingContext = { orgId: racing.id, actorUserId: selectedAccount.userId };
  await services.projects.createProject(racingContext, {
    id: 'project_billing_delete',
    name: 'Accepted billing project',
  });
  const before = accepted(
    await services.platform.bindProjectBilling(racingContext, 'project_billing_delete'),
  );
  const racingAccount = await createD1ConsoleAccountService({
    database,
    namespace,
    now,
    orgProjectEnv: services.projects,
    organizationAccess: services.access,
    deletion: new BillingDuringDeletion(services.billing),
  });
  await expect(racingAccount.deleteOrganization(selectedAccount, racing.id)).rejects.toMatchObject({
    code: 'organization_delete_has_billing_history',
  });
  expect(
    await services.access.lookupAuthorization({ orgId: racing.id, userId: selectedAccount.userId }),
  ).toMatchObject({ kind: 'authorized', role: 'OWNER' });
  expect(
    accepted(await services.platform.bindProjectBilling(racingContext, before.projectId)),
  ).toEqual(before);
  expect((await services.billing.getOverview(racingContext)).creditBalanceMinor).toBe(100);
  await expect(
    services.account.deleteOrganization(selectedAccount, racing.id),
  ).rejects.toMatchObject({ code: 'organization_delete_has_billing_history' });
  return {
    emptyOrganizationDeleted: true,
    finalOwnerRemovalDenied: true,
    retainedInstancePreservedOwner: true,
    billingDuringDeletionPreservedMoneyAndOwner: true,
  };
}

test('account onboarding persists without Wallet resources and denies a revoked stale session', async () => {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  let worker = runtime();
  try {
    const database = await databaseFor(worker);
    const migrations = await migrate(database);
    const first = await compose(database);
    const accountA = await first.account.createOrganization(ownerContext(null), {
      id: 'org_account_a',
      name: 'Account A',
    });
    const accountB = await first.account.createOrganization(ownerContext(null), {
      id: 'org_account_b',
      name: 'Account B',
    });
    expect(accountA.onboardingComplete).toBe(false);
    expect(accountB.onboardingComplete).toBe(false);
    const onboardingContext = {
      orgId: accountA.id,
      actorUserId: 'owner-onboarding',
      actorEmail: 'owner@onboarding.invalid',
      actorDisplayName: 'Account owner',
      projectId: null,
    };
    const created = await first.onboarding.createOnboardingProject(onboardingContext, {
      project: { id: 'project_account_a', name: 'Platform A' },
    });
    expect(created.state.currentStep).toBe('complete');
    expect(created.state.complete).toBe(true);
    expect(created).not.toHaveProperty('environment');
    const retried = await first.onboarding.createOnboardingProject(onboardingContext, {
      project: { id: 'project_account_a', name: 'Platform A' },
    });
    expect(retried.created.project).toBe(false);
    await first.onboarding.createOnboardingProject(onboardingContext, {
      project: { id: 'project_account_a_private', name: 'Other platform project' },
    });
    await first.onboarding.createOnboardingProject(
      { ...onboardingContext, orgId: accountB.id },
      { project: { id: 'project_account_b', name: 'Platform B' } },
    );
    expect(await operationalCounts(database)).toEqual({ environments: 0, apiKeys: 0, wallets: 0 });
    expect(() =>
      parseCreateConsoleOnboardingProjectRequest({
        project: { name: 'Invalid Wallet input' },
        environment: { name: 'Development' },
      }),
    ).toThrow('platform project only');

    const invitation = await first.access.invite(
      { orgId: accountA.id, actorUserId: 'owner-onboarding' },
      {
        email: 'member@onboarding.invalid',
        role: 'MEMBER',
        projectAccess: [{ projectId: created.project.id, accessLevel: 'viewer' }],
      },
    );
    const membership = await first.access.acceptInvitation(
      { userId: 'member-onboarding', verifiedEmail: 'member@onboarding.invalid' },
      invitation.invitation.id,
      { token: invitation.token },
    );
    const session = sessions();
    const staleToken = await session.signJwt('member-onboarding', {
      kind: 'app_session_v1',
      appSessionVersion: 'acceptance-v1',
      provider: 'oidc',
      email: 'member@onboarding.invalid',
      orgId: accountA.id,
      projectId: 'project_account_a_private',
      environmentId: 'foreign-wallet-environment',
    });
    const auth = createAppSessionConsoleAuthAdapter({
      session,
      organizationAccess: first.access,
      provisioning: { orgProjectEnv: first.projects },
    });
    const authorized = await auth.authenticate({ authorization: `Bearer ${staleToken}` });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) throw new Error('Member did not receive account authorization');
    expect(authorized.claims.projectId).toBe(created.project.id);
    expect(authorized.claims).not.toHaveProperty('environmentId');
    const switched = await first.account.switchOrganizationContext(
      ownerContext(accountA.id),
      accountB.id,
    );
    const switchClaims = buildConsoleContextSwitchSessionClaims(
      { environmentId: 'stale-wallet-environment', provider: 'oidc' },
      switched,
    );
    expect(switched.projectId).toBe('project_account_b');
    expect(switched).not.toHaveProperty('environmentId');
    expect(switchClaims).not.toHaveProperty('environmentId');
    const beforeRestart = await first.account.listOrganizations(ownerContext(accountA.id));
    await writeFile(
      path.join(output, 'account-state.json'),
      JSON.stringify({ created, beforeRestart, switched, authorized: authorized.claims }, null, 2),
    );

    await worker.dispose();
    worker = runtime();
    const restartedDatabase = await databaseFor(worker);
    const restarted = await compose(restartedDatabase);
    expect(await restarted.account.listOrganizations(ownerContext(accountA.id))).toEqual(
      beforeRestart,
    );
    expect(await operationalCounts(restartedDatabase)).toEqual({
      environments: 0,
      apiKeys: 0,
      wallets: 0,
    });
    await restarted.access.removeMembership(
      { orgId: accountA.id, actorUserId: 'owner-onboarding' },
      membership.id,
    );
    const restartedAuth = createAppSessionConsoleAuthAdapter({
      session,
      organizationAccess: restarted.access,
      provisioning: { orgProjectEnv: restarted.projects },
    });
    const revoked = await restartedAuth.authenticate({ authorization: `Bearer ${staleToken}` });
    expect(revoked).toMatchObject({ ok: false, code: 'forbidden', status: 403 });
    const crossOrganization = await session.signJwt('member-onboarding', {
      kind: 'app_session_v1',
      appSessionVersion: 'acceptance-v1',
      orgId: accountB.id,
      provider: 'oidc',
    });
    expect(
      await restartedAuth.authenticate({ authorization: `Bearer ${crossOrganization}` }),
    ).toMatchObject({ ok: false, code: 'forbidden' });
    const deletion = await verifyDeletion(restartedDatabase, restarted);
    await writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          version: 1,
          scenario: 'account-only-onboarding-restart-and-revocation',
          command:
            'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-onboarding.e2e.test.ts --reporter=line',
          fixtureVersion: namespace,
          migrations,
          organizations: 2,
          projects: 3,
          operationalCounts: await operationalCounts(restartedDatabase),
          deletion,
          completedWithoutWallet: true,
          retryCreatedDuplicateProject: retried.created.project,
          restartPreservedAccounts: true,
          staleSessionAfterRevocation: revoked,
          accountSwitchRetainedEnvironment: 'environmentId' in switchClaims,
        },
        null,
        2,
      ),
    );
  } finally {
    await worker.dispose();
  }
});
