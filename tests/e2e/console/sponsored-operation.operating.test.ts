import { expect, test } from './harness';
import { fundAccountAndVerifyReceipt } from './billing-funding-documents.journey';
import { publishAndVerifyGasPolicy } from './gas-sponsorship.journey';
import { publishAndVerifyTransactionPolicy } from './policy-governance.journey';

test('Owner funds and governs a sponsored operation', async ({ console }, testInfo) => {
  test.setTimeout(300_000);
  await console.provisionCompletedTenant();
  await console.page.goto('/dashboard/gas-sponsorship');
  const readiness = console.page.getByRole('region', { name: 'Gas sponsorship balance readiness' });
  await readiness.getByRole('button', { name: 'Top up balance', exact: true }).click();
  await expect(console.page).toHaveURL(/\/dashboard\/billing\/account$/);

  await test.step(
    'Fund the account and verify the persisted receipt',
    fundAccountAndVerifyReceipt.bind(null, console, testInfo),
  );
  await test.step(
    'Publish sponsorship coverage and follow its audit link',
    publishAndVerifyGasPolicy.bind(null, console, testInfo),
  );
  await expect(readiness).toContainText('$25.00');
  await expect(readiness.getByRole('button', { name: 'Top up balance', exact: true })).toHaveCount(
    0,
  );
  await test.step(
    'Simulate allowed and denied operations, publish, and verify governance',
    publishAndVerifyTransactionPolicy.bind(null, console, testInfo),
  );
});
