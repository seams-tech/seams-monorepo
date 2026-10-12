import { createHash } from 'node:crypto';
import type { Route, TestInfo } from '@playwright/test';
import { decodeTenantDeploymentPublicProjectionV1 } from '@seams-internal/wallet-console-shared/tenant-deployment';
import { expect, type ConsoleOperatingHarness, type ConsoleProject } from './harness';

export async function verifyAccountAndTeam(
  console: ConsoleOperatingHarness,
  project: ConsoleProject,
  testInfo: TestInfo,
): Promise<void> {
  const { page, tenant } = console;
  await page.goto('/dashboard/account-settings');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Edit profile modal' });
  const originalName = await profile.getByLabel('Display name').inputValue();
  const displayName = `Owner ${tenant.orgId}`;
  try {
    await profile.getByLabel('Display name').fill(displayName);
    await profile.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(profile).toBeHidden();
    await page.reload();
    await expect(page.getByLabel('Account settings page')).toContainText(displayName);
    await testInfo.attach('saved-owner-profile', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  } finally {
    // The login fixture is account-wide, including when a browser assertion fails.
    const restored = await console.api.patch('/console/account/profile', {
      data: { displayName: originalName },
    });
    expect(restored.ok()).toBe(true);
  }

  await page.goto('/dashboard/team-members');
  await page.getByRole('button', { name: 'Invite member', exact: true }).click();
  const invitation = page.getByRole('dialog', { name: 'Invite organization member' });
  const email = `operator-${tenant.orgId}@example.test`;
  await invitation.getByLabel('Verified email').fill(email);
  await invitation.getByLabel('Organization role').selectOption('MEMBER');
  await invitation.getByLabel(project.name, { exact: true }).selectOption('viewer');
  await invitation.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(invitation).toBeHidden();
  const invitedRow = page
    .getByRole('table', { name: 'Pending organization invitations' })
    .getByRole('row')
    .filter({ hasText: email });
  await expect(invitedRow).toContainText('1 project');
  await page.reload();
  await expect(invitedRow).toContainText('1 project');
  const invitations = await console.api.get('/console/organization/invitations');
  expect(invitations.ok()).toBe(true);
  expect(await invitations.json()).toMatchObject({
    ok: true,
    invitations: expect.arrayContaining([
      expect.objectContaining({
        email,
        role: 'MEMBER',
        kind: 'pending',
        projectAccess: [{ projectId: project.id, accessLevel: 'viewer' }],
      }),
    ]),
  });
  await invitedRow.getByRole('button', { name: 'Resend', exact: true }).click();
  await expect(page.getByText(`Invitation resent to ${email}.`, { exact: true })).toBeVisible();
  await testInfo.attach('team-invitation', {
    body: await invitedRow.screenshot(),
    contentType: 'image/png',
  });
  await invitedRow.getByRole('button', { name: `More actions for invitation ${email}` }).click();
  await page.getByRole('menuitem', { name: 'Revoke', exact: true }).click();
  await expect(invitedRow).toHaveCount(0);
  await page.reload();
  await expect(invitedRow).toHaveCount(0);
}

export async function verifyCredentialLifecycle(
  console: ConsoleOperatingHarness,
  keyName: string,
  originalSecret: string,
  testInfo: TestInfo,
): Promise<void> {
  const { page } = console;
  await page.goto('/dashboard/api-keys');
  const row = page
    .getByRole('table', { name: 'Credentials table' })
    .getByRole('row')
    .filter({ hasText: keyName });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit credential modal' });
  const editedName = `${keyName} edited`;
  await edit.getByLabel('Name', { exact: true }).fill(editedName);
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(edit).toBeHidden();
  await page.reload();
  await expect(row).toContainText(editedName);
  await row.getByRole('button', { name: `More actions for ${editedName}` }).click();
  await page.getByRole('menuitem', { name: 'Rotate', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Credential action confirmation modal' });
  await confirmation.getByRole('button', { name: 'Rotate', exact: true }).click();
  await expect(confirmation).toBeHidden();
  const secret = page.locator('code').filter({ hasText: /^pk_dev_[A-Za-z0-9]{32}$/ });
  await expect(secret).toHaveCount(1);
  const rotatedSecret = (await secret.innerText()).trim();
  expect(rotatedSecret).not.toBe(originalSecret);
  await page.reload();
  await expect(secret).toHaveCount(0);
  await row.getByRole('button', { name: `More actions for ${editedName}` }).click();
  await page.getByRole('menuitem', { name: 'Revoke', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await page.reload();
  await expect(row).toContainText('Revoked');
  await testInfo.attach('credential-lifecycle', {
    body: JSON.stringify(
      {
        name: editedName,
        rotatedSecretSha256: createHash('sha256').update(rotatedSecret).digest('hex'),
        status: 'REVOKED',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
}

class DeploymentProjectionFixture {
  constructor(private readonly body: string) {}

  async serve(route: Route): Promise<void> {
    await route.fulfill({ status: 200, contentType: 'application/json', body: this.body });
  }
}

export async function verifyDeploymentStatus(
  console: ConsoleOperatingHarness,
  environmentId: string,
  publishableKey: string,
  testInfo: TestInfo,
): Promise<void> {
  const { page } = console;
  const applicationOrigin = new URL(page.url()).origin;
  const hostedWalletOrigin = process.env.SEAMS_INTENDED_WALLET_ORIGIN || 'https://localhost:4002';
  const gatewayOrigin = process.env.SEAMS_INTENDED_ROUTER_URL || 'https://localhost:4101';
  // The managed Console stack has no tenant cutover. Only its external gateway
  // projection is controlled here; account, audit, and all mutations use real APIs.
  const decoded = decodeTenantDeploymentPublicProjectionV1({
    kind: 'tenant_deployment_public_projection_v1',
    revision: `tdb_${'a'.repeat(64)}`,
    mode: { kind: 'development_testnet_v1', environment: 'development', network: 'testnet' },
    environmentId,
    publishableKey,
    allowedOrigins: [applicationOrigin, hostedWalletOrigin].sort(),
    applicationOrigin,
    hostedWalletOrigin,
    gatewayOrigin,
    relyingPartyId: new URL(hostedWalletOrigin).hostname,
  });
  if (!decoded.ok) throw new Error(decoded.message);
  const fixture = new DeploymentProjectionFixture(JSON.stringify(decoded.value));
  const projectionUrl = `${gatewayOrigin}/.well-known/seams-tenant-deployment.json`;
  await page.route(projectionUrl, fixture.serve.bind(fixture));
  try {
    await page.goto('/dashboard/deployment-status');
    await expect(
      page.getByRole('heading', { name: 'Deployment status', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Active and verified', { exact: true })).toBeVisible();
    const binding = page.getByRole('region', { name: 'Immutable binding' });
    await expect(binding).toContainText(environmentId);
    await expect(binding).toContainText(applicationOrigin);
    await expect(binding).toContainText(gatewayOrigin);
    await page.reload();
    await expect(page.getByText('Active and verified', { exact: true })).toBeVisible();
    await testInfo.attach('deployment-status', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  } finally {
    await page.unroute(projectionUrl);
  }
}
