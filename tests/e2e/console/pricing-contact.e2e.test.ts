import { expect, test, type Route } from '@playwright/test';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { appDirectory } from '../../helpers/consoleBrowser.fixtures';

test.use({ trace: 'retain-on-failure', screenshot: 'only-on-failure' });

async function refuseMailClient(route: Route): Promise<void> {
  await route.abort();
}

test('Enterprise calculator prefill rejects edited values, recomputes USD prices, and survives the mailto fallback', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const require = createRequire(import.meta.url);
  const { createServer } = await import(require.resolve('vite', { paths: [appDirectory] }));
  const frontend = await createServer({
    configFile: `${appDirectory}vite.config.ts`,
    root: appDirectory,
    base: '/',
    cacheDir: testInfo.outputPath('vite'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    define: {
      'import.meta.env.VITE_SITE_ORIGIN': 'window.location.origin',
      'import.meta.env.VITE_WALLET_SITE_ORIGIN': 'window.location.origin',
    },
  });
  try {
    await frontend.listen();
    const appUrl: unknown = frontend.resolvedUrls?.local[0];
    if (typeof appUrl !== 'string') throw new Error('Pricing frontend did not start');
    await page.route('mailto:**', refuseMailClient);
    await page.goto(new URL('/pricing/', appUrl).href);
    const calculator = page.getByRole('region', { name: /Estimate/ });
    await calculator.getByRole('link', { name: 'Contact sales', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Growth estimate: USD 479.00/month');
    await expect(dialog).toContainText('Pro estimate: USD 399.00/month');
    await expect(dialog).toContainText('Enterprise floor: USD 384.00/month');
    await expect(dialog.getByLabel('Project details', { exact: true })).toHaveValue('');
    await dialog.getByLabel('Name', { exact: true }).fill('Acceptance visitor');
    await dialog.getByLabel('Work email', { exact: true }).fill('visitor@example.test');
    await dialog.getByLabel('Company', { exact: true }).fill('Acceptance company');
    await dialog
      .getByLabel('Project details', { exact: true })
      .fill('A wallet integration with 100,000 users.');
    await dialog.getByRole('button', { name: 'Email sales' }).click();
    const copied = dialog.getByRole('textbox', { name: /If your email app/ });
    await expect(copied).toContainText('Growth estimate: USD 479.00/month');
    await page.screenshot({ path: testInfo.outputPath('contact-prefill.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Remove pricing context' }).click();
    await dialog.getByRole('button', { name: 'Email sales' }).click();
    await expect(copied).not.toContainText('Growth estimate');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const invalid = [
      'users=301&per_day=10',
      'users=100000&per_day=1.5',
      'users=100000&per_day=51',
      'users=100000&users=500&per_day=10',
      'users=1e5&per_day=10',
    ];
    for (const inputs of invalid) {
      await page.goto(
        new URL(
          `/pricing/#contact?plan=enterprise&src=pricing_calculator&${inputs}&price=1`,
          appUrl,
        ).href,
      );
      await expect(dialog).toBeVisible();
      await expect(dialog).not.toContainText('Growth estimate');
      await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('');
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await page.goto(
      new URL(
        '/pricing/#contact?plan=enterprise&src=pricing_calculator&users=300&per_day=1&price=0',
        appUrl,
      ).href,
    );
    await expect(dialog).toContainText('Growth estimate: USD 99.00/month');
    await expect(dialog).toContainText('Pro estimate: USD 399.00/month');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('contact-mobile.png'), fullPage: false });
    await writeFile(
      testInfo.outputPath('contact-evidence.json'),
      JSON.stringify(
        {
          inputsRejected: invalid,
          pricesRecomputed: true,
          urlPricesIgnored: true,
          mailtoFallbackVerified: true,
          draftRetained: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await frontend.close();
  }
});
