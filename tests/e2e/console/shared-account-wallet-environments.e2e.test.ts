import { expect, test } from '@playwright/test';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import {
  ServiceProvisionCommandV1,
  ServiceTenantBindingV1,
  parseServiceProvisionReceiptV1,
  readServiceBindingRequest,
  type PlatformResult,
  type PlatformScopeV1,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import type { D1DatabaseLike } from '../../../packages/console-server-ts/src/boundary';
import { createD1AccountPlatformService } from '../../../packages/console-server-ts/src/accountPlatform/d1';
import { createD1ConsoleOrgProjectService } from '../../../packages/console-server-ts/src/orgProjectEnv';
import { createD1ConsoleOrganizationAccessService } from '../../../packages/console-server-ts/src/teamRbac';
import { createD1ConsoleBillingService } from '../../../packages/console-server-ts/src/billing';
import {
  createD1ConsoleWalletEnvironmentService,
  provisionWalletProjectEnvironments,
  serializeWalletEnvironment,
  type ConsoleWalletEnvironment,
} from '../../../packages/wallet-console-server-ts/src/environments';
import { walletProjectEnvironment } from '../../../packages/wallet-console-server-ts/src/router/projectEnvironmentAdapter';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/wallet-environments');
const namespace = 'wallet-environment-acceptance';
const context = { orgId: 'wallet-owner-org', actorUserId: 'verified-wallet-owner' };
const nativeProject = 'preserved-native-wallet-project';
const platformProject = 'platform-wallet-project';
const producer = { serviceId: 'wallet', deploymentId: 'wallet-environment-acceptance' } as const;
const instanceId = 'preserved-wallet-instance';

function now(): Date {
  return new Date('2026-10-13T05:00:00.000Z');
}

function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}

function runtime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Wallet environment ownership"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: 'wallet-environments', ACCOUNT_DB: 'account-only' },
    d1Persist: path.join(output, 'state'),
  });
}

async function databaseOf(worker: Miniflare, binding: string): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database(binding);
  if (!isD1DatabaseLike(database)) throw new Error('Acceptance D1 binding is unavailable');
  return database;
}

async function migrateSource(database: D1DatabaseLike): Promise<void> {
  const directory = path.join(
    repository,
    'packages/wallet-console-server-ts/migrations/d1-console',
  );
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    const sql = await readFile(path.join(directory, name), 'utf8');
    for (const statement of unstable_splitSqlQuery(sql)) await database.prepare(statement).run();
  }
}

function snapshot(environments: readonly ConsoleWalletEnvironment[]) {
  return environments.map(walletProjectEnvironment);
}

function isDevelopment(environment: ConsoleWalletEnvironment): boolean {
  return environment.key === 'dev';
}

function isProduction(environment: ConsoleWalletEnvironment): boolean {
  return environment.key === 'prod';
}

function isStaging(environment: ConsoleWalletEnvironment): boolean {
  return environment.key === 'staging';
}

function isLive(environment: ConsoleWalletEnvironment): boolean {
  return environment.key !== 'dev';
}

function isCurrentEnvironment(environment: ConsoleWalletEnvironment): boolean {
  return environment.key !== 'staging';
}

function environmentStatus(
  environment: ConsoleWalletEnvironment,
): ConsoleWalletEnvironment['status'] {
  return environment.status;
}

function environmentWithKey(
  environments: readonly ConsoleWalletEnvironment[],
  key: ConsoleWalletEnvironment['key'],
): ConsoleWalletEnvironment {
  for (const environment of environments) {
    if (environment.key === key) return environment;
  }
  throw new Error(`Environment ${key} is missing`);
}

function bound(scope: PlatformScopeV1): ServiceTenantBindingV1 {
  return accepted(
    ServiceTenantBindingV1.parse({
      instanceId,
      scope,
      nativeScope: {
        serviceId: 'wallet',
        deploymentId: producer.deploymentId,
        namespace,
        nativeOrganizationId: context.orgId,
        nativeProjectId: nativeProject,
      },
    }),
  );
}

function command(
  scope: PlatformScopeV1,
  revision: number,
  action: 'enable' | 'disable' | 'archive',
): ServiceProvisionCommandV1 {
  const binding =
    revision === 1
      ? readServiceBindingRequest({
          kind: 'attach_existing_scope',
          nativeScope: bound(scope).nativeScope,
          authorityEvidence: { sourceRecordId: nativeProject, sourceDigest: '0'.repeat(64) },
        })
      : bound(scope);
  return accepted(
    ServiceProvisionCommandV1.parse({
      version: 1,
      instanceId,
      operationId: `wallet-environment-operation-${revision}`,
      desiredRevision: revision,
      command: action,
      binding,
    }),
  );
}

function receipt(scope: PlatformScopeV1, request: ServiceProvisionCommandV1) {
  let result: 'active' | 'disabled' | 'archived';
  switch (request.command) {
    case 'enable':
      result = 'active';
      break;
    case 'disable':
      result = 'disabled';
      break;
    case 'archive':
      result = 'archived';
      break;
  }
  return accepted(
    parseServiceProvisionReceiptV1({
      version: 1,
      operationId: request.operationId,
      instanceId,
      desiredRevision: request.desiredRevision,
      result,
      binding: bound(scope),
    }),
  );
}

async function walletEnvironmentScenario(): Promise<void> {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  let worker = runtime();
  try {
    const accountDatabase = await databaseOf(worker, 'ACCOUNT_DB');
    const accountProjects = await createD1ConsoleOrgProjectService({
      database: accountDatabase,
      namespace,
      now,
      ensureSchema: true,
    });
    await accountProjects.upsertOrganization(context, { name: 'Account without Wallet' });
    const genericProject = await accountProjects.createProject(context, {
      id: 'account-only-project',
      name: 'Satyr project',
    });
    expect(genericProject).not.toHaveProperty('environmentCount');
    const walletTables = await accountDatabase
      .prepare("SELECT name FROM sqlite_master WHERE name = 'environments'")
      .all();
    expect(walletTables.results).toEqual([]);

    let database = await databaseOf(worker, 'CONSOLE_DB');
    await migrateSource(database);
    const projects = await createD1ConsoleOrgProjectService({ database, namespace, now });
    await projects.upsertOrganization(context, { name: 'Preserved Wallet account' });
    await projects.createProject(context, { id: nativeProject, name: 'Preserved Wallet project' });
    await projects.createProject(context, { id: platformProject, name: 'Mapped account project' });
    await projects.createProject(context, {
      id: 'unfunded-wallet-project',
      name: 'Unfunded Wallet',
    });
    const access = await createD1ConsoleOrganizationAccessService({ database, namespace, now });
    await access.bootstrapInitialOwner({
      orgId: context.orgId,
      userId: context.actorUserId,
      email: 'wallet-owner@acceptance.invalid',
      displayName: 'Acceptance owner',
    });
    let environments = await createD1ConsoleWalletEnvironmentService({ database, namespace, now });
    expect(await environments.listEnvironments(context)).toEqual([]);
    await environments.createEnvironment(context, {
      id: 'existing-development-environment',
      projectId: nativeProject,
      key: 'dev',
      signingRootVersion: 'owner-signing-version-7',
      name: 'Existing development',
      status: 'ACTIVE',
    });
    const staging = await environments.createEnvironment(context, {
      id: 'existing-archived-staging',
      projectId: nativeProject,
      key: 'staging',
      signingRootVersion: 'owner-signing-version-3',
      status: 'DISABLED',
    });
    await environments.archiveEnvironment(context, staging.id);
    await environments.createEnvironment(context, {
      id: 'existing-production-environment',
      projectId: nativeProject,
      key: 'prod',
      signingRootVersion: 'owner-signing-version-9',
      status: 'DISABLED',
    });
    const original = await environments.listEnvironments(context, { projectId: nativeProject });
    const billing = await createD1ConsoleBillingService({ database, namespace, now });
    const unfunded = await provisionWalletProjectEnvironments({
      environments,
      billing,
      context,
      projectId: 'unfunded-wallet-project',
    });
    expect(unfunded.find(isDevelopment)?.status).toBe('ACTIVE');
    expect(unfunded.filter(isLive).map(environmentStatus)).toEqual(['DISABLED', 'DISABLED']);
    await billing.grantManualSupportCredit(context, {
      amountMinor: 1000,
      reasonCode: 'wallet_environment_acceptance',
      note: 'Isolated acceptance funds',
      idempotencyKey: 'wallet-environment-credit',
    });
    expect(
      snapshot(
        await provisionWalletProjectEnvironments({
          environments,
          billing,
          context,
          projectId: 'unfunded-wallet-project',
        }),
      ),
    ).toEqual(snapshot(unfunded));

    let platform = createD1AccountPlatformService({
      database,
      namespace,
      organizationAccess: access,
      now,
    });
    await platform.ensureSchema();
    const scope = accepted(await platform.bindProjectBilling(context, platformProject));
    const enable = command(scope, 1, 'enable');
    accepted(await platform.requestProvision(context, { scope, command: enable }));
    const enabled = await environments.setProjectAvailability(context, {
      projectId: nativeProject,
      availability: 'enabled',
      liveAccess: 'enabled',
      authority: { scope, instanceId, desiredRevision: 1 },
    });
    expect(enabled.kind).toBe('applied');
    expect(
      await environments.setProjectAvailability(context, {
        projectId: 'unfunded-wallet-project',
        availability: 'enabled',
        liveAccess: 'enabled',
        authority: { scope, instanceId, desiredRevision: 1 },
      }),
    ).toEqual({ kind: 'stale' });
    expect(
      snapshot(
        await environments.listEnvironments(context, { projectId: 'unfunded-wallet-project' }),
      ),
    ).toEqual(snapshot(unfunded));
    accepted(await platform.acknowledgeProvision(producer, receipt(scope, enable)));
    const disable = command(scope, 2, 'disable');
    accepted(await platform.requestProvision(context, { scope, command: disable }));
    expect(
      (
        await environments.setProjectAvailability(context, {
          projectId: nativeProject,
          availability: 'disabled',
          liveAccess: 'disabled',
          authority: { scope, instanceId, desiredRevision: 2 },
        })
      ).kind,
    ).toBe('applied');
    accepted(await platform.acknowledgeProvision(producer, receipt(scope, disable)));
    expect(
      await environments.setProjectAvailability(context, {
        projectId: nativeProject,
        availability: 'enabled',
        liveAccess: 'enabled',
        authority: { scope, instanceId, desiredRevision: 1 },
      }),
    ).toEqual({ kind: 'stale' });
    const disabled = await environments.listEnvironments(context, { projectId: nativeProject });
    expect(disabled.filter(isCurrentEnvironment).map(environmentStatus)).toEqual([
      'DISABLED',
      'DISABLED',
    ]);

    await worker.dispose();
    worker = runtime();
    database = await databaseOf(worker, 'CONSOLE_DB');
    environments = await createD1ConsoleWalletEnvironmentService({ database, namespace, now });
    expect(
      snapshot(await environments.listEnvironments(context, { projectId: nativeProject })),
    ).toEqual(snapshot(disabled));
    const restartedAccess = await createD1ConsoleOrganizationAccessService({
      database,
      namespace,
      now,
    });
    platform = createD1AccountPlatformService({
      database,
      namespace,
      organizationAccess: restartedAccess,
      now,
    });
    const reenable = command(scope, 3, 'enable');
    accepted(await platform.requestProvision(context, { scope, command: reenable }));
    expect(
      (
        await environments.setProjectAvailability(context, {
          projectId: nativeProject,
          availability: 'enabled',
          liveAccess: 'enabled',
          authority: { scope, instanceId, desiredRevision: 3 },
        })
      ).kind,
    ).toBe('applied');
    accepted(await platform.acknowledgeProvision(producer, receipt(scope, reenable)));
    const restored = await environments.listEnvironments(context, { projectId: nativeProject });
    for (const environment of restored) {
      const previous = environmentWithKey(original, environment.key);
      expect(environment.id).toBe(previous.id);
      expect(environment.signingRootVersion).toBe(previous.signingRootVersion);
      expect(serializeWalletEnvironment(environment).runtimeVersion).toBe(
        previous.signingRootVersion,
      );
    }
    expect(restored.find(isStaging)?.status).toBe('ARCHIVED');
    expect(restored.find(isProduction)?.status).toBe('ACTIVE');
    const physical = await database
      .prepare(
        'SELECT id, runtime_version FROM environments WHERE namespace = ? AND project_id = ? ORDER BY id',
      )
      .bind(namespace, nativeProject)
      .all();
    await writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          version: 1,
          passed: true,
          command:
            'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-wallet-environments.e2e.test.ts',
          genericProject,
          original: snapshot(original),
          disabled: snapshot(disabled),
          restored: snapshot(restored),
          physicalRows: physical.results,
          guarantees: [
            'generic projects have no Wallet schema dependency',
            'live environments start disabled without prepaid funds',
            'retries preserve native identifiers and signing root versions',
            'stale enable cannot overwrite a newer disable',
            'archive survives later enable',
            'D1 restart preserves state',
            'credential wire runtimeVersion remains unchanged',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await worker.dispose();
  }
}

test(
  'Wallet owns persistent environments and rejects stale provisioning after disable',
  walletEnvironmentScenario,
);
