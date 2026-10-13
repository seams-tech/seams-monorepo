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
  type AcceptedServiceReceiptV1,
  type PlatformResult,
  type PlatformScopeV1,
  type ServiceBindingRequestV1,
} from '../../../packages/console-shared-ts/src/accountPlatform';
import { integer } from '../../../packages/console-shared-ts/src/accountPlatform/boundary';
import {
  createD1AccountPlatformService,
  type D1AccountPlatformService,
} from '../../../packages/console-server-ts/src/accountPlatform/d1';
import type { D1DatabaseLike, D1Row } from '../../../packages/console-server-ts/src/boundary/d1';
import { createD1ConsoleOrgProjectService } from '../../../packages/console-server-ts/src/orgProjectEnv/d1';
import { createD1ConsoleOrganizationAccessService } from '../../../packages/console-server-ts/src/teamRbac/d1';
import type {
  ConsoleOrganizationAccessService,
  OrganizationAuthorizationLookup,
} from '../../../packages/console-server-ts/src/teamRbac/service';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, '.artifacts/shared-account-platform/instances');
const namespace = 'account-instance-acceptance';
const owner = { orgId: 'organisation-a', actorUserId: 'verified-owner' };
const otherOwner = { orgId: 'organisation-b', actorUserId: 'verified-owner' };
const walletProducer = { serviceId: 'wallet', deploymentId: 'wallet-acceptance' } as const;
const satyrProducer = { serviceId: 'satyr', deploymentId: 'satyr-acceptance' } as const;

function now(): Date {
  return new Date('2026-10-13T02:00:00.000Z');
}

function walletAdmission(nativeProjectId: string) {
  return { namespace: 'wallet-native', nativeOrganizationId: 'native-wallet-org', nativeProjectId };
}

function accepted<T, E>(result: PlatformResult<T, E>): T {
  if (result.kind === 'rejected') throw new Error(JSON.stringify(result.error));
  return result.value;
}

function runtime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("Durable service instances"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: 'account-instances' },
    d1Persist: path.join(output, 'state'),
  });
}

async function databaseOf(worker: Miniflare): Promise<D1DatabaseLike> {
  const database = await worker.getD1Database('CONSOLE_DB');
  if (!isD1DatabaseLike(database)) throw new Error('Acceptance D1 binding is unavailable');
  return database;
}

async function migrate(database: D1DatabaseLike): Promise<void> {
  const directory = path.join(
    repository,
    'packages/wallet-console-server-ts/migrations/d1-console',
  );
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.sql')) continue;
    for (const statement of unstable_splitSqlQuery(
      await readFile(path.join(directory, name), 'utf8'),
    )) {
      await database.prepare(statement).run();
    }
  }
}

async function seed(database: D1DatabaseLike): Promise<ConsoleOrganizationAccessService> {
  const projects = await createD1ConsoleOrgProjectService({ database, namespace, now });
  const access = await createD1ConsoleOrganizationAccessService({ database, namespace, now });
  for (const ctx of [owner, otherOwner]) {
    await projects.upsertOrganization(ctx, { name: ctx.orgId });
    await access.bootstrapInitialOwner({
      orgId: ctx.orgId,
      userId: ctx.actorUserId,
      email: 'owner@acceptance.invalid',
      displayName: 'Acceptance owner',
    });
  }
  await projects.createProject(owner, { id: 'project-a', name: 'Two services' });
  await projects.createProject(owner, { id: 'project-a-second', name: 'Another Wallet project' });
  await projects.createProject(otherOwner, { id: 'project-b', name: 'Separate account' });
  return access;
}

function provision(
  instanceId: string,
  operationId: string,
  revision: number,
  command: 'enable' | 'disable' | 'archive',
  binding: ServiceBindingRequestV1 | ServiceTenantBindingV1,
): ServiceProvisionCommandV1 {
  return accepted(
    ServiceProvisionCommandV1.parse({
      version: 1,
      instanceId,
      operationId,
      desiredRevision: revision,
      command,
      binding,
    }),
  );
}

function walletRequest(scope: PlatformScopeV1, nativeProjectId: string): ServiceBindingRequestV1 {
  return readServiceBindingRequest({
    kind: 'attach_existing_scope',
    nativeScope: {
      serviceId: 'wallet',
      deploymentId: walletProducer.deploymentId,
      namespace: 'wallet-native',
      nativeOrganizationId: 'native-wallet-org',
      nativeProjectId,
    },
    authorityEvidence: {
      sourceRecordId: `${scope.organizationId}/${nativeProjectId}`,
      sourceDigest: '0'.repeat(64),
    },
  });
}

function satyrRequest(scope: PlatformScopeV1): ServiceBindingRequestV1 {
  return readServiceBindingRequest({
    kind: 'create_native_scope',
    serviceId: 'satyr',
    parent: scope,
    configuration: {
      deploymentId: satyrProducer.deploymentId,
      placementCellId: 'acceptance-apac',
      environment: 'development',
    },
  });
}

function bound(
  scope: PlatformScopeV1,
  instanceId: string,
  service: 'wallet' | 'satyr',
  nativeId: string,
): ServiceTenantBindingV1 {
  if (service === 'wallet') {
    return accepted(
      ServiceTenantBindingV1.parse({
        instanceId,
        scope,
        nativeScope: {
          serviceId: service,
          deploymentId: walletProducer.deploymentId,
          namespace: 'wallet-native',
          nativeOrganizationId: 'native-wallet-org',
          nativeProjectId: nativeId,
        },
      }),
    );
  }
  return accepted(
    ServiceTenantBindingV1.parse({
      instanceId,
      scope,
      nativeScope: {
        serviceId: service,
        deploymentId: satyrProducer.deploymentId,
        nativeOrganizationId: nativeId,
      },
    }),
  );
}

function receipt(
  command: ServiceProvisionCommandV1,
  binding: ServiceTenantBindingV1,
): AcceptedServiceReceiptV1 {
  let result: AcceptedServiceReceiptV1['result'];
  switch (command.command) {
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
      operationId: command.operationId,
      instanceId: command.instanceId,
      desiredRevision: command.desiredRevision,
      result,
      binding,
    }),
  );
}

/** Revoke real membership after lookup and before the command transaction. */
class RevocationHandler implements ProxyHandler<ConsoleOrganizationAccessService> {
  constructor(private readonly membershipId: string) {}

  get(target: ConsoleOrganizationAccessService, key: string | symbol): unknown {
    if (key === 'lookupAuthorization') return this.lookupAndRevoke.bind(this, target);
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  }

  async lookupAndRevoke(
    target: ConsoleOrganizationAccessService,
    lookup: OrganizationAuthorizationLookup,
  ) {
    const authorization = await target.lookupAuthorization(lookup);
    await target.removeMembership(owner, this.membershipId);
    return authorization;
  }
}

async function verifyRevocation(
  database: D1DatabaseLike,
  access: ConsoleOrganizationAccessService,
  scope: PlatformScopeV1,
): Promise<void> {
  const invitation = await access.invite(owner, {
    email: 'admin@acceptance.invalid',
    role: 'ADMIN',
    adminPermissions: ['projects.manage'],
  });
  const membership = await access.acceptInvitation(
    { userId: 'verified-admin', verifiedEmail: 'admin@acceptance.invalid' },
    invitation.invitation.id,
    { token: invitation.token },
  );
  const revokingAccess = new Proxy(access, new RevocationHandler(membership.id));
  const store = createD1AccountPlatformService({
    database,
    namespace,
    organizationAccess: revokingAccess,
    now,
  });
  const command = provision(
    'revoked-instance',
    'revoked-operation',
    1,
    'enable',
    satyrRequest(scope),
  );
  expect(
    await store.requestProvision(
      { orgId: owner.orgId, actorUserId: membership.userId },
      { scope, command },
    ),
  ).toEqual({ kind: 'rejected', error: { code: 'scope_forbidden' } });
  const operation = await database
    .prepare('SELECT id FROM platform_provision_operations WHERE namespace = ? AND id = ?')
    .bind(namespace, command.operationId)
    .first();
  expect(operation).toBeNull();
}

async function snapshot(database: D1DatabaseLike): Promise<unknown> {
  const instances = await database
    .prepare(
      'SELECT id, org_id, project_id, service_id, desired_revision, desired_state, observed_revision, observed_state, phase FROM platform_service_instances ORDER BY id',
    )
    .all();
  const operations = await database
    .prepare(
      'SELECT id, instance_id, desired_revision, command, status, payload_digest FROM platform_provision_operations ORDER BY id',
    )
    .all();
  const receipts = await database
    .prepare(
      'SELECT operation_id, result, disposition FROM platform_provision_receipts ORDER BY operation_id',
    )
    .all();
  const walletBindings = await database
    .prepare(
      'SELECT instance_id, deployment_id, native_namespace, native_org_id, native_project_id FROM wallet_service_bindings ORDER BY instance_id',
    )
    .all();
  const satyrBindings = await database
    .prepare(
      'SELECT instance_id, deployment_id, native_org_id FROM satyr_service_bindings ORDER BY instance_id',
    )
    .all();
  const instanceAccess = await database
    .prepare(
      `SELECT a.instance_id, a.membership_id, m.user_id,
      m.kind AS membership_kind, a.access, a.access_revision, a.revoked_authority_revision
      FROM platform_instance_access a JOIN organization_memberships m
        ON m.namespace = a.namespace AND m.org_id = a.org_id AND m.id = a.membership_id
      ORDER BY a.instance_id, m.user_id, a.access_revision`,
    )
    .all();
  return {
    instances: instances.results,
    operations: operations.results,
    receipts: receipts.results,
    walletBindings: walletBindings.results,
    satyrBindings: satyrBindings.results,
    instanceAccess: instanceAccess.results,
  };
}

async function setFixtureInstanceAccess(
  database: D1DatabaseLike,
  instanceId: string,
  membershipId: string,
  value: 'allowed' | 'revoked',
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO platform_instance_access
    (namespace, org_id, instance_id, membership_id, access, granted_by_user_id, updated_at_ms)
    SELECT namespace, org_id, ?, id, ?, ?, ? FROM organization_memberships
    WHERE namespace = ? AND org_id = ? AND id = ? AND kind = 'ACTIVE'
    ON CONFLICT(namespace, instance_id, membership_id) DO UPDATE SET access = excluded.access,
      updated_at_ms = excluded.updated_at_ms`,
    )
    .bind(
      instanceId,
      value,
      owner.actorUserId,
      now().getTime(),
      namespace,
      owner.orgId,
      membershipId,
    )
    .run();
}

async function instanceAccessRevision(
  database: D1DatabaseLike,
  instanceId: string,
  membershipId: string,
) {
  const row = await database
    .prepare(
      `SELECT access, access_revision FROM platform_instance_access
    WHERE namespace = ? AND instance_id = ? AND membership_id = ?`,
    )
    .bind(namespace, instanceId, membershipId)
    .first<D1Row>();
  if (!row || (row.access !== 'allowed' && row.access !== 'revoked'))
    throw new Error('Instance access receipt is unavailable');
  return { access: row.access, revision: integer(row.access_revision, 'access_revision', 1) };
}

async function verifyRejoinedInstanceAccess(
  database: D1DatabaseLike,
  access: ConsoleOrganizationAccessService,
): Promise<void> {
  const account = {
    userId: 'verified-rejoined-user',
    verifiedEmail: 'rejoined@acceptance.invalid',
  };
  const firstInvitation = await access.invite(owner, {
    email: account.verifiedEmail,
    role: 'MEMBER',
    projectAccess: [{ projectId: 'project-a', accessLevel: 'editor' }],
  });
  const first = await access.acceptInvitation(account, firstInvitation.invitation.id, {
    token: firstInvitation.token,
  });
  await setFixtureInstanceAccess(database, 'satyr-a', first.id, 'allowed');
  const firstGrant = await instanceAccessRevision(database, 'satyr-a', first.id);
  expect(firstGrant.access).toBe('allowed');
  await access.removeMembership(owner, first.id);
  expect(await instanceAccessRevision(database, 'satyr-a', first.id)).toEqual({
    access: 'revoked',
    revision: firstGrant.revision,
  });

  const secondInvitation = await access.invite(owner, {
    email: account.verifiedEmail,
    role: 'MEMBER',
    projectAccess: [{ projectId: 'project-a', accessLevel: 'editor' }],
  });
  const second = await access.acceptInvitation(account, secondInvitation.invitation.id, {
    token: secondInvitation.token,
  });
  expect(second.id).not.toBe(first.id);
  await setFixtureInstanceAccess(database, 'satyr-a', second.id, 'allowed');
  const secondGrant = await instanceAccessRevision(database, 'satyr-a', second.id);
  expect(secondGrant.revision).toBeGreaterThan(firstGrant.revision);
  await setFixtureInstanceAccess(database, 'satyr-a', second.id, 'revoked');
  await setFixtureInstanceAccess(database, 'satyr-a', second.id, 'allowed');
  const regranted = await instanceAccessRevision(database, 'satyr-a', second.id);
  expect(regranted.revision).toBeGreaterThan(secondGrant.revision);
  await setFixtureInstanceAccess(database, 'wallet-second', second.id, 'allowed');
  const otherInstance = await instanceAccessRevision(database, 'wallet-second', second.id);
  expect(otherInstance.revision).toBeLessThan(regranted.revision);
  await writeFile(
    path.join(output, 'rejoined-access.json'),
    `${JSON.stringify(
      {
        firstMembershipId: first.id,
        secondMembershipId: second.id,
        firstGrant,
        secondGrant,
        regranted,
        otherInstance,
      },
      null,
      2,
    )}\n`,
  );
}

async function platform(
  database: D1DatabaseLike,
  access: ConsoleOrganizationAccessService,
): Promise<D1AccountPlatformService> {
  const store = createD1AccountPlatformService({
    database,
    namespace,
    organizationAccess: access,
    now,
  });
  await store.ensureSchema();
  return store;
}

test('durable service commands preserve tenant bindings and reject stale authority across restart', async () => {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  let worker = runtime();
  try {
    let database = await databaseOf(worker);
    await migrate(database);
    let access = await seed(database);
    let store = await platform(database, access);
    const scopes = await Promise.all([
      store.bindProjectBilling(owner, 'project-a'),
      store.bindProjectBilling(owner, 'project-a-second'),
      store.bindProjectBilling(otherOwner, 'project-b'),
    ]);
    const a = accepted(scopes[0]);
    const second = accepted(scopes[1]);
    const b = accepted(scopes[2]);
    expect(a.billingAccountId).toBe(second.billingAccountId);
    expect(a.billingAccountId).not.toBe(b.billingAccountId);
    const wallet = provision(
      'wallet-a',
      'wallet-enable-1',
      1,
      'enable',
      walletRequest(a, 'native-project-a'),
    );
    const satyr = provision('satyr-a', 'satyr-enable-1', 1, 'enable', satyrRequest(a));
    expect(
      accepted(await store.requestProvision(owner, { scope: a, command: wallet })).state.kind,
    ).toBe('provisioning');
    accepted(await store.requestProvision(owner, { scope: a, command: satyr }));
    const secondWallet = provision(
      'wallet-second',
      'wallet-second-enable',
      1,
      'enable',
      walletRequest(second, 'native-project-second'),
    );
    accepted(await store.requestProvision(owner, { scope: second, command: secondWallet }));
    const walletBinding = bound(a, wallet.instanceId, 'wallet', 'native-project-a');
    const satyrBinding = bound(a, satyr.instanceId, 'satyr', 'native-satyr-a');
    expect((await store.pendingProvision(walletProducer, 100)).length).toBe(2);
    expect(
      (await store.pendingProvision({ serviceId: 'wallet', deploymentId: 'other-deployment' }, 100))
        .length,
    ).toBe(0);
    const secondWalletBinding = bound(
      second,
      secondWallet.instanceId,
      'wallet',
      'native-project-second',
    );
    accepted(
      await store.acknowledgeProvision(walletProducer, receipt(secondWallet, secondWalletBinding)),
    );
    expect(
      accepted(
        await store.checkWalletAdmission(walletProducer, walletAdmission('native-project-second')),
      ),
    ).toEqual(second);
    expect(
      await store.checkWalletAdmission(walletProducer, walletAdmission('unbound-project')),
    ).toEqual({ kind: 'rejected', error: { code: 'scope_forbidden' } });
    const conflicting = provision(
      'wallet-a',
      wallet.operationId,
      1,
      'enable',
      walletRequest(a, 'changed-project'),
    );
    expect(await store.requestProvision(owner, { scope: a, command: conflicting })).toEqual({
      kind: 'rejected',
      error: { code: 'operation_conflict' },
    });
    expect(await store.requestProvision(otherOwner, { scope: a, command: wallet })).toEqual({
      kind: 'rejected',
      error: { code: 'scope_forbidden' },
    });
    expect(await store.acknowledgeProvision(satyrProducer, receipt(wallet, walletBinding))).toEqual(
      { kind: 'rejected', error: { code: 'scope_forbidden' } },
    );
    const replay = await Promise.all([
      store.requestProvision(owner, { scope: a, command: wallet }),
      store.requestProvision(owner, { scope: a, command: wallet }),
    ]);
    expect(replay.map(accepted).length).toBe(2);
    expect(
      accepted(await store.acknowledgeProvision(satyrProducer, receipt(satyr, satyrBinding)))
        .instance.state.kind,
    ).toBe('active');
    // Disable during initial provisioning. Its delayed activation can record observation only.
    const disable = provision(wallet.instanceId, 'wallet-disable-2', 2, 'disable', wallet.binding);
    expect(
      accepted(await store.requestProvision(owner, { scope: a, command: disable })).state.kind,
    ).toBe('disabled');
    const staleReceipt = accepted(
      await store.acknowledgeProvision(walletProducer, receipt(wallet, walletBinding)),
    );
    expect(staleReceipt.disposition).toBe('stale');
    expect(staleReceipt.instance.state.kind).toBe('disabled');
    await verifyRejoinedInstanceAccess(database, access);
    const beforeRestart = await snapshot(database);
    await writeFile(
      path.join(output, 'before-restart.json'),
      `${JSON.stringify(beforeRestart, null, 2)}\n`,
    );
    await worker.dispose();
    worker = runtime();
    database = await databaseOf(worker);
    access = await createD1ConsoleOrganizationAccessService({ database, namespace, now });
    store = await platform(database, access);
    expect(await snapshot(database)).toEqual(beforeRestart);
    expect(
      accepted(await store.acknowledgeProvision(walletProducer, receipt(wallet, walletBinding)))
        .disposition,
    ).toBe('stale');
    expect(accepted(await store.getInstance(owner, satyr.instanceId)).state.kind).toBe('active');
    expect(
      accepted(await store.acknowledgeProvision(walletProducer, receipt(disable, walletBinding)))
        .instance.state.kind,
    ).toBe('disabled');
    const enable = provision(wallet.instanceId, 'wallet-enable-3', 3, 'enable', walletBinding);
    accepted(await store.requestProvision(owner, { scope: a, command: enable }));
    expect(
      accepted(await store.acknowledgeProvision(walletProducer, receipt(enable, walletBinding)))
        .instance.state.kind,
    ).toBe('active');
    expect(
      accepted(
        await store.checkWalletAdmission(walletProducer, walletAdmission('native-project-a')),
      ),
    ).toEqual(a);
    const disableAgain = provision(
      wallet.instanceId,
      'wallet-disable-4',
      4,
      'disable',
      walletBinding,
    );
    accepted(await store.requestProvision(owner, { scope: a, command: disableAgain }));
    expect(
      await store.checkWalletAdmission(walletProducer, walletAdmission('native-project-a')),
    ).toEqual({ kind: 'rejected', error: { code: 'scope_forbidden' } });
    expect(
      accepted(
        await store.checkWalletAdmission(walletProducer, walletAdmission('native-project-second')),
      ),
    ).toEqual(second);
    accepted(
      await store.acknowledgeProvision(walletProducer, receipt(disableAgain, walletBinding)),
    );
    const archive = provision(wallet.instanceId, 'wallet-archive-5', 5, 'archive', walletBinding);
    accepted(await store.requestProvision(owner, { scope: a, command: archive }));
    expect(
      accepted(await store.acknowledgeProvision(walletProducer, receipt(archive, walletBinding)))
        .instance.state.kind,
    ).toBe('archived');
    expect(
      await store.checkWalletAdmission(walletProducer, walletAdmission('native-project-a')),
    ).toEqual({ kind: 'rejected', error: { code: 'scope_forbidden' } });
    const archivedEnable = provision(
      wallet.instanceId,
      'wallet-enable-6',
      6,
      'enable',
      walletBinding,
    );
    expect(await store.requestProvision(owner, { scope: a, command: archivedEnable })).toEqual({
      kind: 'rejected',
      error: { code: 'instance_archived' },
    });
    const reuse = provision(
      'wallet-binding-reuse',
      'reuse-archived-native-project',
      1,
      'enable',
      walletRequest(b, 'native-project-a'),
    );
    expect(await store.requestProvision(otherOwner, { scope: b, command: reuse })).toEqual({
      kind: 'rejected',
      error: { code: 'binding_conflict' },
    });
    // A different native project under the same Wallet organisation remains valid.
    const competingA = provision(
      'wallet-b-one',
      'concurrent-one',
      1,
      'enable',
      walletRequest(b, 'native-project-b-one'),
    );
    const competingB = provision(
      'wallet-b-two',
      'concurrent-two',
      1,
      'enable',
      walletRequest(b, 'native-project-b-two'),
    );
    const concurrent = await Promise.all([
      store.requestProvision(otherOwner, { scope: b, command: competingA }),
      store.requestProvision(otherOwner, { scope: b, command: competingB }),
    ]);
    expect(concurrent.filter(isAccepted).length).toBe(1);
    expect(concurrent.filter(isRejected).length).toBe(1);
    const satyrB = provision('satyr-b', 'satyr-b-enable-1', 1, 'enable', satyrRequest(b));
    accepted(await store.requestProvision(otherOwner, { scope: b, command: satyrB }));
    expect(
      accepted(
        await store.failProvision(satyrProducer, {
          operationId: satyrB.operationId,
          failureCode: 'native_capacity_unavailable',
        }),
      ).state.kind,
    ).toBe('failed');
    const retryB = provision(satyrB.instanceId, 'satyr-b-retry-2', 2, 'enable', satyrB.binding);
    accepted(await store.requestProvision(otherOwner, { scope: b, command: retryB }));
    const reusedSatyrBinding = bound(b, satyrB.instanceId, 'satyr', 'native-satyr-a');
    expect(
      await store.acknowledgeProvision(satyrProducer, receipt(retryB, reusedSatyrBinding)),
    ).toEqual({
      kind: 'rejected',
      error: { code: 'binding_conflict' },
    });
    const satyrBBinding = bound(b, satyrB.instanceId, 'satyr', 'native-satyr-b');
    expect(
      accepted(await store.acknowledgeProvision(satyrProducer, receipt(retryB, satyrBBinding)))
        .instance.state.kind,
    ).toBe('active');
    await verifyRevocation(database, access, second);
    await expect(store.assertOrganizationCanBeDeleted(owner)).rejects.toThrow(
      'service_instances_exist',
    );
    const after = await snapshot(database);
    await writeFile(path.join(output, 'after-restart.json'), `${JSON.stringify(after, null, 2)}\n`);
    const report = {
      version: 1,
      passed: true,
      command:
        'pnpm -C tests exec playwright test -c playwright.config.ts e2e/console/shared-account-instances.e2e.test.ts',
      evidence: ['before-restart.json', 'after-restart.json'],
      checks: [
        'one payer per organisation',
        'separate organisation payers',
        'persisted command outbox',
        'matching replay',
        'conflicting replay',
        'scoped producer authority',
        'disable during provisioning',
        'stale activation after disable',
        'persisted receipt disposition',
        'restart replay',
        'independent active Satyr',
        'disable and re-enable same binding',
        'archive retains native uniqueness',
        'concurrent project service collision',
        'membership revocation transaction guard',
        'failed provisioning retry',
        'Satyr native tenant collision',
        'Wallet native admission requires current active binding',
        'disable revokes native admission before shutdown receipt',
        'another Wallet project retains native admission',
      ],
    };
    await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await worker.dispose();
  }
});

function isAccepted<T, E>(result: PlatformResult<T, E>): boolean {
  return result.kind === 'accepted';
}

function isRejected<T, E>(result: PlatformResult<T, E>): boolean {
  return result.kind === 'rejected';
}
