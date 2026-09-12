import { expect, test } from './harness';

test('NEAR gas policy preserves case-sensitive methods through edit and publication', async ({
  console,
}) => {
  await console.provisionCompletedTenant();
  const { page, api, tenant } = console;
  const name = `Case-sensitive NEAR ${tenant.orgId}`;
  const created = await api.post('/console/policies', {
    data: {
      kind: 'GAS_SPONSORSHIP',
      name,
      rules: {
        kind: 'near_delegate',
        executionMode: 'near_delegate',
        scopeType: 'ENVIRONMENT',
        projectId: tenant.projectId,
        environmentId: tenant.environmentId,
        networkClass: 'TESTNET',
        enabled: true,
        allowedDelegateActions: [
          {
            receiverId: 'guest-book.testnet',
            methods: ['addMessage', 'addmessage'],
            maxDepositYocto: '0',
            allowTransfers: false,
          },
        ],
        spendCap: { mode: 'NONE', period: 'MONTHLY', capsByChain: [] },
      },
    },
  });
  expect(created.ok()).toBe(true);
  await page.goto('/dashboard/gas-sponsorship');
  const row = page.getByRole('row').filter({ hasText: name });
  await row.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Edit gas sponsorship policy modal' });
  await expect(modal.getByLabel('Allowed methods (comma or newline separated)')).toHaveValue(
    'addMessage, addmessage',
  );
  await modal.getByRole('button', { name: 'Save sponsorship policy', exact: true }).click();
  await expect(modal).toBeHidden();
  await page.reload();
  await row.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(modal.getByLabel('Allowed methods (comma or newline separated)')).toHaveValue(
    'addMessage, addmessage',
  );
  const snapshotResponse = await api.get(
    `/console/runtime-snapshots/latest?environmentId=${encodeURIComponent(tenant.environmentId)}&projectId=${encodeURIComponent(tenant.projectId)}`,
  );
  expect(snapshotResponse.ok()).toBe(true);
  const snapshot: unknown = await snapshotResponse.json();
  expect(snapshot).toMatchObject({
    ok: true,
    snapshot: {
      payload: {
        gasSponsorship: {
          policies: expect.arrayContaining([
            expect.objectContaining({
              allowedDelegateActions: [
                expect.objectContaining({ methods: ['addMessage', 'addmessage'] }),
              ],
            }),
          ]),
        },
      },
    },
  });
});
