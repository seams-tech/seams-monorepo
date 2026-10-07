import type { TestInfo } from '@playwright/test';
import { expect, type ConsoleOperatingHarness } from './harness';

export async function publishAndVerifyGasPolicy(
  console: ConsoleOperatingHarness,
  testInfo: TestInfo,
): Promise<void> {
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

  await page.goto('/dashboard/audit');
  await page.getByLabel('Search events').fill(name);
  const publicationRow = page
    .getByRole('row')
    .filter({ hasText: 'Published policy' })
    .filter({ hasText: name });
  await publicationRow.getByRole('button', { name: /^View/ }).click();
  const policyLink = page.getByRole('link', { name, exact: true }).first();
  await expect(policyLink).toHaveAttribute('href', /\/dashboard\/gas-sponsorship\?policyId=/);
  await policyLink.click();
  await expect(page).toHaveURL(/\/dashboard\/gas-sponsorship\?policyId=/);
  const coverage = page.getByRole('dialog', { name: 'View gas sponsorship coverage modal' });
  await expect(coverage).toContainText(name);
  await expect(coverage).toContainText('guest-book.testnet');
  await expect(coverage).toContainText('addMessage');
  await expect(coverage).toContainText('addmessage');
  await page.reload();
  await expect(coverage).toContainText(name);
  await expect(coverage).toContainText('guest-book.testnet');
  await testInfo.attach('audit-gas-policy-coverage', {
    body: await coverage.screenshot(),
    contentType: 'image/png',
  });
  await testInfo.attach('published-runtime-snapshot', {
    body: JSON.stringify(snapshot, null, 2),
    contentType: 'application/json',
  });
  await coverage.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(coverage).toBeHidden();
  await expect(page).toHaveURL(/\/dashboard\/gas-sponsorship$/);
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
  await expect(coverage).toBeHidden();
}
