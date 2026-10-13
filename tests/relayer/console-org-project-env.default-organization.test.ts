import { test, expect } from '@playwright/test';
import { createInMemoryConsoleOrgProjectService } from '@seams-internal/console-server/orgProjectEnv/index';

test.describe('console default organization resolution', () => {
  test('in-memory service returns the only persisted organization', async () => {
    const service = createInMemoryConsoleOrgProjectService();
    await service.upsertOrganization(
      { orgId: 'org_watchbook', actorUserId: 'user-single-org' },
      { name: 'Watchbook' },
    );

    await expect(service.findDefaultOrganization()).resolves.toMatchObject({
      id: 'org_watchbook',
      name: 'Watchbook',
    });
  });

  test('in-memory service returns null when persisted organizations are ambiguous', async () => {
    const service = createInMemoryConsoleOrgProjectService();
    for (const orgId of ['org_watchbook', 'org_platform']) {
      await service.upsertOrganization(
        { orgId, actorUserId: 'user-multi-org' },
        { name: orgId },
      );
    }

    await expect(service.findDefaultOrganization()).resolves.toBeNull();
  });
});
