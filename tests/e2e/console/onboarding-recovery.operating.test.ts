import type { Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expect, test } from './harness';

class InterruptedProjectCreation {
  readonly projectIds: string[] = [];

  async handle(route: Route): Promise<void> {
    const body = route.request().postDataJSON();
    const id: unknown = body?.project?.id;
    if (typeof id !== 'string' || !id)
      throw new Error('Project request omitted its retry identity');
    this.projectIds.push(id);
    switch (this.projectIds.length) {
      case 1:
        // The request never reaches the server. Reload must retain its identity.
        await this.timeout(route);
        return;
      case 2: {
        // The server commits, but the proxy loses the successful response.
        const response = await route.fetch();
        expect(response.status(), await response.text()).toBe(201);
        await this.timeout(route);
        return;
      }
      default:
        await route.continue();
    }
  }

  private async timeout(route: Route): Promise<void> {
    await route.fulfill({
      status: 408,
      json: { ok: false, code: 'request_timeout', message: 'The project request timed out.' },
    });
  }
}

class DeploymentProjectionResponse {
  constructor(
    public status: number,
    public body: unknown,
  ) {}

  async handle(route: Route): Promise<void> {
    await route.fulfill({ status: this.status, json: this.body });
  }
}

test('Owner recovers project creation across reload and lost replies while activation is pending', async ({
  console,
}, testInfo) => {
  const { page, api, tenant } = console;
  const interrupted = new InterruptedProjectCreation();
  await page.route('**/console/onboarding/project', interrupted.handle.bind(interrupted));
  await page.goto('/dashboard/onboarding');
  const project = page.getByRole('region', { name: 'Create project' });
  await project.getByLabel('Project name').fill(tenant.projectName);
  await project.getByRole('button', { name: 'Finish onboarding' }).click();
  await expect(page.getByText('The project request timed out.', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(project.getByLabel('Project name')).toHaveValue(tenant.projectName);
  await project.getByRole('button', { name: 'Finish onboarding' }).click();
  await expect(page.getByText('The project request timed out.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/overview\/?$/);
  expect(interrupted.projectIds).toHaveLength(3);
  expect(new Set(interrupted.projectIds).size).toBe(1);
  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard\/overview\/?$/);
  const resources = await console.readTenantResources();
  expect(resources.project.id).toBe(interrupted.projectIds[0]);
  const state = await api.get('/console/onboarding/state');
  const onboarding = await state.json();
  expect(onboarding).toMatchObject({
    state: { activeProjectCount: 1, onboardingComplete: true },
  });
  const wrongMethod = await api.get('/console/onboarding/project');
  expect(wrongMethod.status()).toBe(405);
  expect(wrongMethod.headers().allow).toBe('POST');

  // Control only the external Gateway discovery response. Console mutations above
  // use the real D1 stack; protected activation is covered by the Worker E2E suite.
  const projection = new DeploymentProjectionResponse(503, {
    ok: false,
    code: 'tenant_deployment_unavailable',
  });
  await page.route(
    '**/.well-known/seams-tenant-deployment.json',
    projection.handle.bind(projection),
  );
  await page.waitForLoadState('networkidle');
  await page.goto('/dashboard/deployment-status');
  const pending = page.getByRole('region', { name: 'Awaiting activation' });
  await expect(pending).toContainText(resources.environment.id);
  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(pending).toBeVisible();
  const screenshotPath = testInfo.outputPath('awaiting-activation.png');
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach('awaiting-activation', { path: screenshotPath, contentType: 'image/png' });

  projection.body = { ok: false, code: 'upstream_unavailable' };
  await page.getByRole('button', { name: 'Refresh deployment status' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The active deployment projection is unavailable.',
  );
  await expect(pending).toHaveCount(0);
  projection.status = 200;
  projection.body = { environmentId: resources.environment.id };
  await page.getByRole('button', { name: 'Refresh deployment status' }).click();
  await expect(page.getByRole('alert')).toHaveText('The active deployment projection is invalid.');

  const gatewayOrigin = process.env.SEAMS_INTENDED_ROUTER_URL || 'https://localhost:4101';
  const hostedWalletOrigin = process.env.SEAMS_INTENDED_WALLET_ORIGIN || 'https://localhost:4002';
  const applicationOrigin = new URL(page.url()).origin;
  const activeProjection = {
    kind: 'tenant_deployment_public_projection_v1',
    revision: `tdb_${'b'.repeat(64)}`,
    mode: { kind: 'development_testnet_v1', environment: 'development', network: 'testnet' },
    environmentId: 'another-project:dev',
    publishableKey: `pk_dev_${'a'.repeat(32)}`,
    allowedOrigins: [applicationOrigin, hostedWalletOrigin].sort(),
    applicationOrigin,
    hostedWalletOrigin,
    gatewayOrigin,
    relyingPartyId: new URL(hostedWalletOrigin).hostname,
  };
  projection.body = activeProjection;
  await page.getByRole('button', { name: 'Refresh deployment status' }).click();
  await expect(page.getByRole('region', { name: 'Environment not deployed' })).toContainText(
    'another-project:dev',
  );
  await expect(page.getByText('Active and verified', { exact: true })).toHaveCount(0);
  activeProjection.environmentId = resources.environment.id;
  await page.getByRole('button', { name: 'Refresh deployment status' }).click();
  await expect(page.getByText('Active and verified', { exact: true })).toBeVisible();
  const evidencePath = testInfo.outputPath('onboarding-recovery-evidence.json');
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        projectIds: interrupted.projectIds,
        environmentId: resources.environment.id,
        projectCount: onboarding.state.activeProjectCount,
        wrongMethodStatus: wrongMethod.status(),
        states: ['awaiting_activation', 'unavailable', 'invalid', 'unbound', 'ready'],
        gatewayProjection: 'controlled external response',
      },
      null,
      2,
    ),
  );
  await testInfo.attach('onboarding-recovery-evidence', {
    path: evidencePath,
    contentType: 'application/json',
  });
});
