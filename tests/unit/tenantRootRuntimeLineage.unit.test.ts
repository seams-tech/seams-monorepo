import { expect, test } from '@playwright/test';
import type {
  RouterApiProjectEnvironment,
  RouterApiProjectEnvironmentResolver,
} from '@seams/wallet-server/cloud-host';
import type { TenantRootIdentityV1 } from '../../packages/shared-ts/src/tenant-root/tenantRootIdentity';
import { resolveRuntimeTenantRootLineage } from '@seams/wallet-server/cloud-host';

const SCOPE = {
  orgId: 'org_testtenant01',
  projectId: 'project-alpha',
  envId: 'dev',
  signingRootId: 'project-alpha:dev',
  signingRootVersion: 'default',
};

class EnvironmentRecords implements RouterApiProjectEnvironmentResolver {
  constructor(private readonly environment: RouterApiProjectEnvironment) {}

  async listEnvironments(
    context: Parameters<RouterApiProjectEnvironmentResolver['listEnvironments']>[0],
  ) {
    expect(context.orgId).toBe(SCOPE.orgId);
    expect(context.projectId).toBe(SCOPE.projectId);
    return [this.environment];
  }
}

class RecordedRootLookup {
  readonly identities: TenantRootIdentityV1[] = [];

  async resolveActiveLineage(identity: TenantRootIdentityV1) {
    this.identities.push(identity);
    return { identityDigestB64u: 'identity-digest', custodyLineageB64u: 'custody-lineage' };
  }
}

function environmentRecord(): RouterApiProjectEnvironment {
  return {
    id: 'env-opaque-123',
    projectId: SCOPE.projectId,
    key: 'dev',
    signingRootVersion: 'default',
    status: 'ACTIVE',
  };
}

test('runtime lineage resolves the Console environment ID before exact root lookup', async () => {
  const roots = new RecordedRootLookup();
  const result = await resolveRuntimeTenantRootLineage(
    new EnvironmentRecords(environmentRecord()),
    roots,
    SCOPE,
  );
  expect(result?.custodyLineageB64u).toBe('custody-lineage');
  expect(roots.identities).toHaveLength(1);
  expect(roots.identities[0]).toEqual({ ...SCOPE, envId: 'env-opaque-123' });
});

test('runtime lineage refuses mismatched and inactive environments without looking up a root', async () => {
  const roots = new RecordedRootLookup();
  const records = [
    { ...environmentRecord(), projectId: 'project-other' },
    { ...environmentRecord(), key: 'prod' },
    { ...environmentRecord(), signingRootVersion: 'other-version' },
    { ...environmentRecord(), status: 'ARCHIVED' },
  ];
  for (const record of records) {
    expect(
      await resolveRuntimeTenantRootLineage(new EnvironmentRecords(record), roots, SCOPE),
    ).toBeNull();
  }
  expect(roots.identities).toEqual([]);
});

test('runtime lineage refuses a signing-root selector outside its runtime scope', async () => {
  const roots = new RecordedRootLookup();
  await expect(
    resolveRuntimeTenantRootLineage(new EnvironmentRecords(environmentRecord()), roots, {
      ...SCOPE,
      signingRootId: 'project-alpha:prod',
    }),
  ).rejects.toThrow('Signing-root ID does not match');
  expect(roots.identities).toEqual([]);
});
